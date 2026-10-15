/**
 * Optional relay (TURN) credentials for restrictive networks.
 *
 * Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN in Netlify's
 * environment variables (never with a VITE_ prefix). This function trades
 * that long-lived key for short-lived credentials, so no secret reaches the
 * browser. Without the variables it reports that no relay is configured.
 */

export interface EnvReader {
  get(name: string): string | undefined;
}

const CREDENTIAL_TTL_SECONDS = 12 * 60 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Same-site page requests carry a Referer (or Origin) for this host; direct visits don't. */
function fromThisSite(request: Request): boolean | null {
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return null;
  try {
    return new URL(source).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function withoutBlockedPorts(servers: unknown[]): unknown[] {
  return servers
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const entry = s as { urls?: unknown };
      const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u));
      return urls.length ? { ...entry, urls } : null;
    })
    .filter(Boolean);
}

export async function iceResponse(env: EnvReader, request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const keyId = env.get('CLOUDFLARE_TURN_KEY_ID');
  const token = env.get('CLOUDFLARE_TURN_API_TOKEN');
  const configured = Boolean(keyId && token);
  const site = fromThisSite(request);
  // Visiting the URL directly shows whether a relay is set up, without credentials.
  if (site === null) return json({ configured });
  if (!site) return json({ iceServers: [] }, 403);
  if (!configured) return json({ iceServers: [] });
  try {
    const res = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId!)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
    });
    if (!res.ok) return json({ iceServers: [], error: `Relay provider returned ${res.status}` }, 502);
    const data = (await res.json()) as { iceServers?: unknown };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return json({ iceServers: withoutBlockedPorts(list) });
  } catch {
    return json({ iceServers: [], error: 'Relay provider unreachable' }, 502);
  }
}

export default (request: Request): Promise<Response> => iceResponse({ get: (name) => process.env[name] }, request);
