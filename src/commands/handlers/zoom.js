const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isZoomUrl } = require('../validator');

// Directory for persistent browser profile
const USER_DATA_DIR = path.join(os.homedir(), '.onesibox-zoom');

// Delay before starting end-of-meeting polling (1h 45m).
// Meetings typically don't end before this, so we don't waste cycles polling early.
const END_DETECTION_START_DELAY_MS = 105 * 60 * 1000;

// How often to poll the Zoom page once detection starts.
const END_DETECTION_POLL_INTERVAL_MS = 30 * 1000;

// Hostnames considered "still inside a Zoom meeting". Anything else (Zoom redirects to
// us02web.zoom.us / zoom.us "leave_url" / about:blank when the host ends) means we're out.
const ZOOM_MEETING_HOST_PATTERN = /(^|\.)zoom\.us$/i;
const ZOOM_MEETING_PATH_PATTERN = /\/wc\//;

// Phrases that Zoom shows on the "meeting ended" / "removed by host" screens, in EN/IT.
// Only full sentences specific enough that they wouldn't appear naturally in chat —
// short phrases like "meeting ended" or "riunione terminata" are excluded to avoid
// false positives if a participant happens to type them after the 1h 45m mark.
const MEETING_ENDED_PHRASES = [
  'this meeting has been ended',
  'the host has ended this meeting',
  "l'host ha terminato",
  'la riunione è stata terminata',
  'è stata terminata dall',
];

// Playwright browser context (persists between calls)
let browserContext = null;
let page = null;

// End-of-meeting detection timers (module-level so they can be cleared from any handler).
let endDetectionStartTimer = null;
let endDetectionPollInterval = null;
let endDetectionTicking = false;

/**
 * Convert Zoom meeting URL to web client format.
 *
 * Handles various Zoom URL formats:
 * - https://us05web.zoom.us/j/123456789?pwd=xxx
 * - https://zoom.us/j/123456789?pwd=xxx
 *
 * @param {string} url - Original Zoom URL
 * @returns {string} - Web client URL
 */
function convertToWebClientUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/');

    // Find meeting ID after /j/
    const jIndex = pathParts.indexOf('j');
    const meetingId = jIndex !== -1 ? pathParts[jIndex + 1] : null;

    if (!meetingId) {
      throw new Error('Cannot extract meeting ID from URL');
    }

    const password = parsedUrl.searchParams.get('pwd');

    let webClientUrl = `https://app.zoom.us/wc/${meetingId}/join`;
    if (password) {
      webClientUrl += `?pwd=${password}`;
    }

    return webClientUrl;
  } catch (error) {
    logger.error('Failed to convert Zoom URL', { url, error: error.message });
    throw error;
  }
}

/**
 * Parse Zoom URL to extract meeting details.
 *
 * @param {string} url - The URL to parse
 * @returns {{ meetingId: string|null, password: string|null }}
 */
function parseZoomUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');

    let meetingId = null;
    let password = null;

    const jIndex = pathParts.indexOf('j');
    if (jIndex !== -1 && pathParts[jIndex + 1]) {
      meetingId = pathParts[jIndex + 1];
    }

    password = urlObj.searchParams.get('pwd');

    return { meetingId, password };
  } catch {
    return { meetingId: null, password: null };
  }
}

/**
 * Close existing Playwright browser context if open.
 */
async function closeBrowserContext() {
  stopMeetingEndDetection();
  if (browserContext) {
    try {
      await browserContext.close();
    } catch (error) {
      logger.warn('Error closing browser context', { error: error.message });
    }
    browserContext = null;
    page = null;
  }
}

/**
 * Check whether the current Playwright page is on a "meeting ended" state.
 *
 * Looks at both URL (Zoom navigates away from /wc/ when the host ends) and visible
 * page text ("Meeting Ended", "L'host ha terminato la riunione", etc.). Returns true
 * if any signal indicates the meeting is no longer active.
 *
 * @param {import('playwright').Page} activePage
 * @returns {Promise<boolean>}
 */
async function checkMeetingEnded(activePage) {
  if (!activePage || activePage.isClosed()) {
    return true;
  }

  let currentUrl;
  try {
    currentUrl = activePage.url();
  } catch {
    return true;
  }

  if (!currentUrl || currentUrl === 'about:blank') {
    return true;
  }

  try {
    const parsed = new URL(currentUrl);
    const hostMatches = ZOOM_MEETING_HOST_PATTERN.test(parsed.hostname);
    const pathMatches = ZOOM_MEETING_PATH_PATTERN.test(parsed.pathname);
    if (!hostMatches || !pathMatches) {
      return true;
    }
  } catch {
    return true;
  }

  try {
    // Cap to 8KB: end-of-meeting banners are short and live near the top of body,
    // so we don't need (and shouldn't ship over IPC) a full chat transcript.
    const bodyText = await activePage.evaluate(
      () => (document.body?.innerText || '').slice(0, 8192)
    );
    const normalized = bodyText.toLowerCase();
    if (MEETING_ENDED_PHRASES.some((phrase) => normalized.includes(phrase))) {
      return true;
    }
  } catch (error) {
    logger.warn('Failed to read Zoom page body for end detection', { error: error.message });
  }

  return false;
}

/**
 * Stop both the deferred start timer and the active polling interval, if any.
 */
function stopMeetingEndDetection() {
  if (endDetectionStartTimer) {
    clearTimeout(endDetectionStartTimer);
    endDetectionStartTimer = null;
  }
  if (endDetectionPollInterval) {
    clearInterval(endDetectionPollInterval);
    endDetectionPollInterval = null;
  }
  endDetectionTicking = false;
}

/**
 * Schedule end-of-meeting polling. After END_DETECTION_START_DELAY_MS we start polling
 * the Playwright page every END_DETECTION_POLL_INTERVAL_MS. When `checkMeetingEnded`
 * returns true, we tear down the browser context and update state — same effect as a
 * manual `leaveZoom`, but triggered by the host closing the meeting.
 *
 * @param {object} browserController - Used to keep the main kiosk browser in standby.
 */
function startMeetingEndDetection(browserController) {
  stopMeetingEndDetection();

  logger.info('Scheduling Zoom end-of-meeting detection', {
    start_delay_ms: END_DETECTION_START_DELAY_MS,
    poll_interval_ms: END_DETECTION_POLL_INTERVAL_MS,
  });

  endDetectionStartTimer = setTimeout(() => {
    endDetectionStartTimer = null;

    if (!browserContext || !page) {
      logger.info('End-detection start fired but no active Zoom session, skipping');
      return;
    }

    logger.info('Starting Zoom end-of-meeting polling');
    endDetectionPollInterval = setInterval(
      () => runEndDetectionTick(browserController),
      END_DETECTION_POLL_INTERVAL_MS
    );
  }, END_DETECTION_START_DELAY_MS);
}

/**
 * One polling tick: read the page, and if the meeting has ended, clean up.
 * Guarded against re-entrance so a slow page evaluation can't overlap with itself.
 *
 * @param {object} browserController
 */
async function runEndDetectionTick(browserController) {
  if (endDetectionTicking) {
    return;
  }
  endDetectionTicking = true;

  try {
    const activePage = page;
    if (!browserContext || !activePage) {
      stopMeetingEndDetection();
      return;
    }

    const ended = await checkMeetingEnded(activePage);
    if (!ended) {
      return;
    }

    logger.info('Detected Zoom meeting ended by host, cleaning up');

    stopMeetingEndDetection();
    await closeBrowserContext();

    if (stateManager.getState().status === STATUS.CALLING) {
      stateManager.leaveMeeting();
    }

    if (browserController && typeof browserController.goToStandby === 'function') {
      try {
        await browserController.goToStandby();
      } catch (error) {
        logger.warn('Failed to return main browser to standby after Zoom end', { error: error.message });
      }
    }
  } catch (error) {
    logger.warn('End-of-meeting tick failed', { error: error.message });
  } finally {
    endDetectionTicking = false;
  }
}

/**
 * Join a Zoom meeting using Playwright automation.
 *
 * This handler:
 * 1. Converts the meeting URL to web client format
 * 2. Launches Playwright with persistent context (for camera/mic permissions)
 * 3. Navigates to the meeting
 * 4. Fills the participant name
 * 5. Clicks the join button
 *
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller (for fallback navigation)
 */
async function joinZoom(command, browserController) {
  const { meeting_url, participant_name = 'OnesiBox User' } = command.payload;

  if (!isZoomUrl(meeting_url)) {
    throw new Error('Invalid Zoom URL');
  }

  logger.info('Starting Zoom join process', { meeting_url, participant_name });

  const currentState = stateManager.getState();

  // Interrupt any current playback
  if (currentState.status === STATUS.PLAYING) {
    logger.info('Interrupting media playback for Zoom meeting');
    await browserController.goToStandby();
    stateManager.stopPlaying();
  }

  // Leave existing meeting if in one
  if (currentState.status === STATUS.CALLING) {
    logger.info('Already in a meeting, leaving first');
    await leaveZoom(command, browserController);
  }

  try {
    // Convert URL to web client format
    const webClientUrl = convertToWebClientUrl(meeting_url);
    logger.info('Converted to web client URL', { webClientUrl });

    // Close existing context if any
    await closeBrowserContext();

    // Launch browser with persistent context for camera/mic permissions
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--start-fullscreen',
        '--autoplay-policy=no-user-gesture-required',
      ],
      permissions: ['microphone', 'camera'],
      viewport: null, // Fullscreen
      ignoreHTTPSErrors: true,
    });

    page = browserContext.pages()[0] || await browserContext.newPage();

    // Navigate to Zoom web client
    logger.info('Navigating to Zoom web client');
    await page.goto(webClientUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for the join form to appear (try multiple selectors)
    logger.info('Waiting for join form');

    // Try to find the name input field
    let nameInput = null;
    const nameSelectors = ['#inputname', 'input[type="text"]', '[role="textbox"]', 'input[placeholder*="name" i]'];

    for (const selector of nameSelectors) {
      try {
        nameInput = await page.waitForSelector(selector, { timeout: 5000 });
        if (nameInput) {
          logger.info('Found name input', { selector });
          break;
        }
      } catch {
        // Try next selector
      }
    }

    if (nameInput) {
      // Clear existing value and fill with participant name
      await nameInput.click({ clickCount: 3 }); // Select all
      await nameInput.fill(participant_name);
      logger.info('Filled participant name', { participant_name });
    } else {
      logger.warn('Could not find name input field');
    }

    // Find and click the join button
    const joinButtonTexts = ['Join', 'Entra', 'Partecipa', 'Join Meeting', 'Partecipa alla riunione'];
    let joinClicked = false;

    for (const text of joinButtonTexts) {
      try {
        const button = await page.$(`button:has-text("${text}")`);
        if (button) {
          await button.click();
          joinClicked = true;
          logger.info('Clicked join button', { buttonText: text });
          break;
        }
      } catch {
        // Try next button text
      }
    }

    if (!joinClicked) {
      // Try clicking any visible primary button
      try {
        await page.click('button[type="submit"], button.zm-btn--primary, button.preview-join-button', { timeout: 5000 });
        joinClicked = true;
        logger.info('Clicked join button via fallback selector');
      } catch {
        logger.warn('Could not find join button to click');
      }
    }

    // Parse meeting ID for state tracking
    const parsedUrl = parseZoomUrl(meeting_url);

    // Update state
    stateManager.setMeeting({
      meeting_url,
      meeting_id: parsedUrl.meetingId
    });

    // Schedule background detection of host-ended meetings.
    startMeetingEndDetection(browserController);

    logger.info('Zoom meeting join initiated', {
      meeting_id: parsedUrl.meetingId,
      participant_name
    });

  } catch (error) {
    logger.error('Failed to join Zoom meeting', { error: error.message });

    // Take screenshot for debugging
    if (page) {
      try {
        const screenshotPath = path.join(os.tmpdir(), 'zoom-error-screenshot.png');
        await page.screenshot({ path: screenshotPath });
        logger.info('Debug screenshot saved', { path: screenshotPath });
      } catch {
        // Ignore screenshot errors
      }
    }

    // Cleanup on error
    await closeBrowserContext();

    throw error;
  }
}

/**
 * Leave the current Zoom meeting.
 *
 * This closes the Playwright browser context but does NOT restart the main browser,
 * since the main browser should already be showing the standby screen underneath.
 *
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller (unused but kept for interface consistency)
 */
async function leaveZoom(_command, _browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.CALLING) {
    logger.info('Not in a meeting, nothing to leave');
    return;
  }

  logger.info('Leaving Zoom meeting', {
    meeting_id: currentState.currentMeeting?.meeting_id
  });

  stopMeetingEndDetection();

  try {
    if (page) {
      // Try to click leave button
      const leaveButtonTexts = ['Leave', 'Esci', 'Abbandona', 'Leave Meeting', 'Abbandona riunione'];

      for (const text of leaveButtonTexts) {
        try {
          const button = await page.$(`button:has-text("${text}")`);
          if (button) {
            await button.click();
            logger.info('Clicked leave button', { buttonText: text });

            // Wait a moment for confirmation dialog
            await page.waitForTimeout(1000);

            // Confirm leave if dialog appears
            const confirmTexts = ['Leave Meeting', 'Abbandona riunione', 'Leave'];
            for (const confirmText of confirmTexts) {
              try {
                const confirmButton = await page.$(`button:has-text("${confirmText}")`);
                if (confirmButton) {
                  await confirmButton.click();
                  logger.info('Confirmed leave', { buttonText: confirmText });
                  break;
                }
              } catch {
                // Ignore
              }
            }
            break;
          }
        } catch {
          // Try next button text
        }
      }
    }
  } catch (error) {
    logger.warn('Error clicking leave button', { error: error.message });
  }

  // Close Playwright browser context
  // This closes only the Zoom browser, not the main kiosk browser
  await closeBrowserContext();

  // Update state - the main browser should already be showing standby
  // No need to call browserController.goToStandby() which would restart the browser
  stateManager.leaveMeeting();

  logger.info('Zoom meeting left');
}

/**
 * Cleanup Zoom resources.
 * Should be called during application shutdown to ensure proper cleanup.
 */
async function cleanup() {
  logger.info('Cleaning up Zoom resources');
  stopMeetingEndDetection();
  await closeBrowserContext();
}

/**
 * Check if a Zoom meeting is currently active.
 * @returns {boolean} True if Zoom browser context is open
 */
function isZoomActive() {
  return browserContext !== null;
}

module.exports = {
  joinZoom,
  leaveZoom,
  parseZoomUrl,
  convertToWebClientUrl,
  cleanup,
  isZoomActive,
  checkMeetingEnded,
  startMeetingEndDetection,
  stopMeetingEndDetection,
  END_DETECTION_START_DELAY_MS,
  END_DETECTION_POLL_INTERVAL_MS,
};
