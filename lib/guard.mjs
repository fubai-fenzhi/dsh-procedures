/**
 * Host identity check for HTTP routes.
 * Connection exposes `requestRejection`, which applies the Host/Origin and
 * browser-authentication checks to another Web route. Return the rejection
 * status (401/403) when the request must not be accepted.
 */
export function routeRejection(connection, request) {
  if (!connection || typeof connection.requestRejection !== 'function') return null;
  try {
    return connection.requestRejection({ headers: request.headers }) ?? null;
  } catch {
    // A failed trust check must fail closed.
    return 403;
  }
}
