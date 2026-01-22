const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const logger = require('../../logging/logger');
const { stateManager, STATUS } = require('../../state/state-manager');
const { isZoomUrl } = require('../validator');

// Directory for persistent browser profile
const USER_DATA_DIR = path.join(os.homedir(), '.onesibox-zoom');

// Playwright browser context (persists between calls)
let browserContext = null;
let page = null;

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
  const { meeting_url, participant_name = 'Rosa Iannascoli' } = command.payload;

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
 * @param {object} command - The command object
 * @param {object} browserController - The browser controller
 */
async function leaveZoom(command, browserController) {
  const currentState = stateManager.getState();

  if (currentState.status !== STATUS.CALLING) {
    logger.info('Not in a meeting, nothing to leave');
    return;
  }

  logger.info('Leaving Zoom meeting', {
    meeting_id: currentState.currentMeeting?.meeting_id
  });

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

  // Close browser context
  await closeBrowserContext();

  // Navigate back to standby screen using main browser controller
  await browserController.goToStandby();

  // Update state
  stateManager.leaveMeeting();

  logger.info('Zoom meeting left');
}

module.exports = {
  joinZoom,
  leaveZoom,
  parseZoomUrl,
  convertToWebClientUrl
};
