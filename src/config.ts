import { normalizeNamespace, stableHash } from './core/roomCode';

/**
 * Connection configuration. Everything here ships to the browser and is
 * public: only signaling locations and public STUN/TURN entries belong here,
 * never private credentials.
 */

export interface SignalingConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
  key: string;
}

export interface ConnectionConfig {
  /** null means PeerJS's public cloud server. */
  signaling: SignalingConfig | null;
  /** null keeps PeerJS's default ICE servers. */
  iceServers: RTCIceServer[] | null;
  namespace: string;
}

export const CONNECTION_OVERRIDE_KEY = 'tripspeaker:connection';

function env(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function parseIceServers(raw: unknown): RTCIceServer[] | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const servers: RTCIceServer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const list = Array.isArray(urls) ? urls : [urls];
    if (!list.length || !list.every((u) => typeof u === 'string' && /^(stun|stuns|turn|turns):/.test(u))) return null;
    const server: RTCIceServer = { urls: list as string[] };
    if (typeof username === 'string') server.username = username;
    if (typeof credential === 'string') server.credential = credential;
    servers.push(server);
  }
  return servers;
}

export function parseSignaling(raw: unknown): SignalingConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.host !== 'string' || !r.host.trim()) return null;
  const port = Number(r.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const path = typeof r.path === 'string' && r.path ? r.path : '/';
  return {
    host: r.host.trim(),
    port,
    path,
    secure: r.secure === undefined ? port === 443 : Boolean(r.secure),
    key: typeof r.key === 'string' && r.key ? r.key : 'peerjs',
  };
}

function envSignaling(): SignalingConfig | null {
  const host = env('VITE_PEER_HOST');
  if (!host) return null;
  return parseSignaling({
    host,
    port: env('VITE_PEER_PORT') ?? '443',
    path: env('VITE_PEER_PATH') ?? '/',
    secure: env('VITE_PEER_SECURE') ? env('VITE_PEER_SECURE') === 'true' : undefined,
    key: env('VITE_PEER_KEY'),
  });
}

export interface StoredOverride {
  signaling?: unknown;
  iceServers?: unknown;
  namespace?: unknown;
}

export function readOverride(): StoredOverride | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONNECTION_OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as StoredOverride) : null;
  } catch {
    return null;
  }
}

export function writeOverride(value: StoredOverride | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(CONNECTION_OVERRIDE_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(CONNECTION_OVERRIDE_KEY);
  } catch {
    /* storage unavailable: settings simply do not persist */
  }
}

export function defaultNamespace(): string {
  const explicit = env('VITE_ROOM_NAMESPACE');
  if (explicit) return normalizeNamespace(explicit);
  const host = typeof location !== 'undefined' ? location.host : 'local';
  return normalizeNamespace(`tripspeaker-v1-${stableHash(host)}`);
}

export function resolveConnectionConfig(): ConnectionConfig {
  const override = readOverride();
  const signaling = (override?.signaling !== undefined ? parseSignaling(override.signaling) : null) ?? envSignaling();
  const iceServers =
    (override?.iceServers !== undefined ? parseIceServers(override.iceServers) : null) ??
    (env('VITE_ICE_SERVERS') ? parseIceServers(env('VITE_ICE_SERVERS')) : null);
  const namespace =
    typeof override?.namespace === 'string' && override.namespace.trim()
      ? normalizeNamespace(override.namespace)
      : defaultNamespace();
  return { signaling, iceServers, namespace };
}

export function describeSignaling(config: ConnectionConfig): string {
  if (!config.signaling) return 'PeerJS public server (0.peerjs.com)';
  const s = config.signaling;
  return `${s.secure ? 'wss' : 'ws'}://${s.host}:${s.port}${s.path}`;
}
