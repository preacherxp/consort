import { routeResultSchema, type RouteResult } from '../shared/contracts';

function transportError(status: number) {
  if (status >= 500) return `The site’s API is unavailable (HTTP ${status}). Please try again shortly.`;
  if (status === 401 || status === 403) return `The request was blocked (HTTP ${status}). Check the proxy’s access rules.`;
  return `The server did not return a valid API response (HTTP ${status}). Check that /api routes to the Consort server.`;
}

/** Proxies can return HTML even when the application only ever returns JSON. */
export async function readRoutingResponse(response: Response): Promise<RouteResult> {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !type?.endsWith('+json')) {
    await response.body?.cancel().catch(() => {});
    throw new Error(transportError(response.status));
  }
  let data: unknown;
  try { data = await response.json(); }
  catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error;
    throw new Error(transportError(response.status));
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error.trim().slice(0, 500) : '';
    throw new Error(message || transportError(response.status));
  }
  const parsed = routeResultSchema.safeParse(data);
  if (!parsed.success) throw new Error('The API returned an incomplete recommendation. Please try again.');
  return parsed.data;
}
