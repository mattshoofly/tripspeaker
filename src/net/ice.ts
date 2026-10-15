import { parseIceServers, type ConnectionConfig } from '../config';

/**
 * PeerJS 1.5.5's built-in TURN servers (eu-0/us-0.turn.peerjs.com) no longer
 * resolve, so its default config offers no relay at all. Trip Speaker uses
 * plain STUN by default and adds TURN only when the deployment provides it
 * through /.netlify/functions/ice (credentials stay server-side).
 */
export const DEFAULT_STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export const MANAGED_ICE_ENDPOINT = '/.netlify/functions/ice';

/** Browsers refuse port 53; such URLs only add timeouts. */
export function dropBlockedPorts(servers: RTCIceServer[]): RTCIceServer[] {
  return servers
    .map((s) => {
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
      return { ...s, urls };
    })
    .filter((s) => (s.urls as string[]).length > 0);
}

export function hasRelay(servers: RTCIceServer[]): boolean {
  return servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u)));
}

let managed: Promise<RTCIceServer[] | null> | null = null;

/** Fetches short-lived relay credentials once per page; null when the deployment has none. */
export function fetchManagedIce(fetchImpl: typeof fetch = fetch, timeoutMs = 3000): Promise<RTCIceServer[] | null> {
  if (!managed) {
    managed = (async () => {
      try {
        const res = await fetchImpl(MANAGED_ICE_ENDPOINT, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
        const body = (await res.json()) as { iceServers?: unknown };
        const servers = parseIceServers(body.iceServers);
        return servers && servers.length ? dropBlockedPorts(servers) : null;
      } catch {
        return null;
      }
    })();
  }
  return managed;
}

export function resetManagedIceCache(): void {
  managed = null;
}

/** Explicit configuration wins; otherwise STUN plus any relay the deployment offers. */
export async function resolveIceServers(config: ConnectionConfig, fetchImpl?: typeof fetch): Promise<RTCIceServer[]> {
  if (config.iceServers) return config.iceServers;
  const relay = await fetchManagedIce(fetchImpl);
  return relay ? [...DEFAULT_STUN, ...relay] : DEFAULT_STUN;
}
