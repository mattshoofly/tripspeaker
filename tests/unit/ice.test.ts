import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iceResponse } from '../../netlify/functions/ice.mts';
import { classifyFailure, describeReport, type ConnectionReport } from '../../src/net/diagnose';
import { DEFAULT_STUN, dropBlockedPorts, hasRelay, resetManagedIceCache, resolveIceServers } from '../../src/net/ice';

const config = { signaling: null, iceServers: null, namespace: 'ns' };
const turn = { urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:53?transport=udp'], username: 'u', credential: 'c' };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ICE configuration', () => {
  beforeEach(() => resetManagedIceCache());

  it('drops port-53 URLs that browsers refuse, and detects relays', () => {
    expect(dropBlockedPorts([turn])).toEqual([{ ...turn, urls: ['turn:turn.example.com:3478?transport=udp'] }]);
    expect(dropBlockedPorts([{ urls: 'turn:x.example:53' }])).toEqual([]);
    expect(hasRelay(DEFAULT_STUN)).toBe(false);
    expect(hasRelay([turn])).toBe(true);
  });

  it('uses STUN only when the deployment offers no relay', async () => {
    const notFound = vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await resolveIceServers(config, notFound as unknown as typeof fetch)).toEqual(DEFAULT_STUN);
    resetManagedIceCache();
    const failing = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await resolveIceServers(config, failing as unknown as typeof fetch)).toEqual(DEFAULT_STUN);
  });

  it('adds managed relay credentials when the function provides them, once per page', async () => {
    const managed = vi.fn(async () => jsonResponse({ iceServers: [turn] }));
    const servers = await resolveIceServers(config, managed as unknown as typeof fetch);
    expect(servers).toEqual([...DEFAULT_STUN, { ...turn, urls: ['turn:turn.example.com:3478?transport=udp'] }]);
    await resolveIceServers(config, managed as unknown as typeof fetch);
    expect(managed).toHaveBeenCalledTimes(1);
  });

  it('lets explicit configuration win over everything else', async () => {
    const managed = vi.fn(async () => jsonResponse({ iceServers: [turn] }));
    const explicit = [{ urls: 'stun:stun.example.org:3478' }];
    expect(await resolveIceServers({ ...config, iceServers: explicit }, managed as unknown as typeof fetch)).toBe(explicit);
    expect(managed).not.toHaveBeenCalled();
  });
});

describe('relay credentials function', () => {
  const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
  const req = (referer?: string) =>
    new Request('https://trip-speaker.netlify.app/.netlify/functions/ice', { headers: referer ? { Referer: referer } : {} });

  it('reports configuration on a direct visit without handing out credentials', async () => {
    const fetchImpl = vi.fn();
    const res = await iceResponse(env({ CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't' }), req(), fetchImpl as unknown as typeof fetch);
    expect(await res.json()).toEqual({ configured: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses requests from other sites', async () => {
    const res = await iceResponse(env({ CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't' }), req('https://elsewhere.example/'));
    expect(res.status).toBe(403);
  });

  it('returns no servers when no relay is configured', async () => {
    const res = await iceResponse(env({}), req('https://trip-speaker.netlify.app/?room=0047'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ iceServers: [] });
  });

  it('exchanges the server-side key for short-lived credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, turn] }, 201));
    const res = await iceResponse(
      env({ CLOUDFLARE_TURN_KEY_ID: 'key/1', CLOUDFLARE_TURN_API_TOKEN: 'secret' }),
      req('https://trip-speaker.netlify.app/'),
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key%2F1/credentials/generate-ice-servers');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ ttl: 43200 });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { ...turn, urls: ['turn:turn.example.com:3478?transport=udp'] }],
    });
  });

  it('reports provider failures without leaking details', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: ['bad token'] }, 401));
    const res = await iceResponse(env({ CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't' }), req('https://trip-speaker.netlify.app/'), fetchImpl as unknown as typeof fetch);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ iceServers: [], error: 'Relay provider returned 401' });
  });
});

describe('connection failure classification', () => {
  const base: ConnectionReport = {
    answered: true,
    iceState: 'checking',
    local: { host: 2, mdns: 2, srflx: 1, relay: 0 },
    remote: { host: 2, mdns: 2, srflx: 1, relay: 0 },
    pairsTried: 4,
    pairsSucceeded: 0,
    relayConfigured: false,
  };

  it('separates a silent host from a blocked network', () => {
    const none = { host: 0, mdns: 0, srflx: 0, relay: 0 };
    expect(classifyFailure({ ...base, answered: false, remote: none })).toBe('host-silent');
    // No local route means no candidate pairs, so stats list no remote candidates even though the host answered.
    expect(classifyFailure({ ...base, local: none, remote: none })).toBe('no-local-path');
    expect(classifyFailure(base)).toBe('unreachable');
  });

  it('describes what was tried in plain language', () => {
    const facts = describeReport(base).join(' ');
    expect(facts).toContain('The host’s laptop answered.');
    expect(facts).toContain('4 routes were tried; 0 worked.');
    expect(facts).toContain('No relay server is configured');
  });
});
