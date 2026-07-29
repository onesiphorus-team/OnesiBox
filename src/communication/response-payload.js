/**
 * Extract the actual payload from a backend API response body.
 *
 * Laravel API Resources are wrapped in a `data` key unless the backend calls
 * JsonResource::withoutWrapping(), which this project does not do. Reading the
 * response body directly therefore yields `undefined` for every field.
 * This helper tolerates both shapes so the client keeps working if the backend
 * ever drops the wrapper.
 *
 * Exact rules, because this module is generic and collection endpoints share
 * the same envelope (`/appliances/commands` returns `{data: [...], meta: {…}}`):
 *
 * - `body.data` is an object or an array → that value, unwrapped. A collection
 *   yields the array itself, never the envelope around it.
 * - `body.data` is absent, null or a scalar → `body` unchanged. A scalar `data`
 *   is treated as an ordinary field of an unwrapped payload, not as a wrapper.
 * - `body` is not a plain object (null, scalar, or a bare top-level array, which
 *   no Resource ever produces) → null.
 *
 * @param {*} body - Response body (already unwrapped from axios `response.data`).
 * @returns {object|Array|null} The payload, or null when there is none.
 */
function unwrapPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const inner = body.data;
  if (inner && typeof inner === 'object') {
    return inner;
  }
  return body;
}

module.exports = { unwrapPayload };
