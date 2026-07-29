const { unwrapPayload } = require('./response-payload');

/**
 * Apply the diagnostic screenshot config carried by a heartbeat response.
 *
 * This glue used to live inline in startHeartbeat(). It is a separate exported
 * function so the *read level* is covered by tests: HeartbeatResource is a
 * Laravel API Resource wrapped in a `data` key, so reading
 * `res.screenshot_enabled` directly yields `undefined` and applyServerConfig
 * silently ignores it — no exception, no log, just a server config that never
 * takes effect. Keeping it inline made that regression invisible to CI.
 *
 * @param {*} res - Heartbeat response body, as returned by ApiClient#sendHeartbeat.
 * @param {{applyServerConfig: Function}|null|undefined} scheduler - Screenshot
 *   scheduler, when one is wired.
 * @returns {boolean} True when a config was handed to the scheduler.
 */
function applyHeartbeatResponse(res, scheduler) {
  const payload = unwrapPayload(res);
  if (!scheduler || !payload) {
    return false;
  }

  scheduler.applyServerConfig({
    enabled: payload.screenshot_enabled,
    intervalSeconds: payload.screenshot_interval_seconds,
  });
  return true;
}

module.exports = { applyHeartbeatResponse };
