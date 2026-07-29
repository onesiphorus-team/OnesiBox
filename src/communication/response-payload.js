/**
 * Extract the actual payload from a backend API response body.
 *
 * Laravel API Resources are wrapped in a `data` key unless the backend calls
 * JsonResource::withoutWrapping(), which this project does not do. Reading the
 * response body directly therefore yields `undefined` for every field.
 * This helper tolerates both shapes so the client keeps working if the backend
 * ever drops the wrapper.
 *
 * @param {*} body - Response body (already unwrapped from axios `response.data`).
 * @returns {object|null} The payload object, or null when there is none.
 */
function unwrapPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const inner = body.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return inner;
  }
  return body;
}

module.exports = { unwrapPayload };
