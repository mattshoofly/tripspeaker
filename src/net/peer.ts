import Peer, { type DataConnection, type PeerError, type PeerOptions } from 'peerjs';
import type { ConnectionConfig } from '../config';

export type { DataConnection, Peer };

export function createPeer(config: ConnectionConfig, id?: string): Peer {
  const options: PeerOptions = { debug: 1 };
  if (config.signaling) {
    options.host = config.signaling.host;
    options.port = config.signaling.port;
    options.path = config.signaling.path;
    options.secure = config.signaling.secure;
    options.key = config.signaling.key;
  }
  if (config.iceServers) options.config = { iceServers: config.iceServers };
  return id ? new Peer(id, options) : new Peer(options);
}

export type PeerErrorType = PeerError<string>['type'];

export function peerErrorType(err: unknown): string {
  return (err as { type?: string })?.type ?? 'unknown';
}

export type OpenOutcome = { kind: 'open' } | { kind: 'taken' } | { kind: 'error'; error: unknown; type: string };

/** Resolves once the signaling server has registered this peer (or refused it). */
export function waitForOpen(peer: Peer, timeoutMs: number): Promise<OpenOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: OpenOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onError);
      resolve(outcome);
    };
    const onOpen = () => finish({ kind: 'open' });
    const onError = (err: unknown) => {
      const type = peerErrorType(err);
      finish(type === 'unavailable-id' ? { kind: 'taken' } : { kind: 'error', error: err, type });
    };
    const timer = setTimeout(() => finish({ kind: 'error', error: new Error('Signaling timed out'), type: 'timeout' }), timeoutMs);
    if (peer.open) {
      finish({ kind: 'open' });
      return;
    }
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

export interface ChannelInfo {
  ordered: boolean | null;
  maxRetransmits: number | null;
  maxPacketLifeTime: number | null;
  protocol: string | null;
}

export function describeChannel(conn: DataConnection | null): ChannelInfo | null {
  const dc = conn?.dataChannel;
  if (!dc) return null;
  return {
    ordered: dc.ordered ?? null,
    maxRetransmits: dc.maxRetransmits ?? null,
    maxPacketLifeTime: dc.maxPacketLifeTime ?? null,
    protocol: dc.protocol || null,
  };
}

export function bufferedAmount(conn: DataConnection | null): number {
  return conn?.dataChannel?.bufferedAmount ?? 0;
}
