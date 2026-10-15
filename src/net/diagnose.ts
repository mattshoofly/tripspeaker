/**
 * Summarises why a WebRTC connection attempt failed, from the peer
 * connection's own stats, so the join error can say something actionable.
 */

export interface CandidateCounts {
  host: number;
  mdns: number;
  srflx: number;
  relay: number;
}

export interface ConnectionReport {
  /** The host answered the offer (remote description applied). */
  answered: boolean;
  iceState: string;
  local: CandidateCounts;
  remote: CandidateCounts;
  pairsTried: number;
  pairsSucceeded: number;
  relayConfigured: boolean;
}

export type FailureClass = 'host-silent' | 'no-local-path' | 'unreachable';

const empty = (): CandidateCounts => ({ host: 0, mdns: 0, srflx: 0, relay: 0 });

function tally(counts: CandidateCounts, type: string | undefined, address: string | undefined): void {
  if (type === 'host') {
    counts.host++;
    if (address?.endsWith('.local')) counts.mdns++;
  } else if (type === 'srflx' || type === 'prflx') counts.srflx++;
  else if (type === 'relay') counts.relay++;
}

export async function collectConnectionReport(pc: RTCPeerConnection | null | undefined, relayConfigured: boolean, timeoutMs = 1500): Promise<ConnectionReport | null> {
  if (!pc) return null;
  const local = empty();
  const remote = empty();
  let pairsTried = 0;
  let pairsSucceeded = 0;
  try {
    const stats = await Promise.race([pc.getStats(), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    stats?.forEach((s: RTCStats & Record<string, unknown>) => {
      if (s.type === 'local-candidate') tally(local, s.candidateType as string, (s.address ?? s.ip) as string | undefined);
      else if (s.type === 'remote-candidate') tally(remote, s.candidateType as string, (s.address ?? s.ip) as string | undefined);
      else if (s.type === 'candidate-pair') {
        if (s.state !== 'frozen') pairsTried++;
        if (s.state === 'succeeded') pairsSucceeded++;
      }
    });
  } catch {
    /* closed connection: report what the states say */
  }
  return {
    answered: pc.remoteDescription !== null,
    iceState: pc.iceConnectionState,
    local,
    remote,
    pairsTried,
    pairsSucceeded,
    relayConfigured,
  };
}

const total = (c: CandidateCounts) => c.host + c.srflx + c.relay;

/**
 * Only "never answered" means the host is missing. Chrome lists remote
 * candidates in stats only once they form pairs, so a laptop with no usable
 * local route shows zero remote candidates even when the host replied.
 */
export function classifyFailure(r: ConnectionReport): FailureClass {
  if (!r.answered) return 'host-silent';
  if (r.local.srflx === 0 && r.local.relay === 0) return 'no-local-path';
  return 'unreachable';
}

export function describeReport(r: ConnectionReport): string[] {
  const facts: string[] = [];
  facts.push(r.answered ? 'The host’s laptop answered.' : 'The host’s laptop never answered.');
  facts.push(`This laptop offered ${total(r.local)} network route${total(r.local) === 1 ? '' : 's'} (${r.local.srflx ? 'including an internet-facing one' : 'none internet-facing'}).`);
  if (total(r.remote) > 0) facts.push(`The host offered ${total(r.remote)} route${total(r.remote) === 1 ? '' : 's'}.`);
  facts.push(r.pairsTried ? `${r.pairsTried} route${r.pairsTried === 1 ? ' was' : 's were'} tried; ${r.pairsSucceeded} worked.` : 'No route between the laptops could be tried.');
  facts.push(r.relayConfigured ? 'A relay server is configured.' : 'No relay server is configured, so there is no fallback when a direct route fails.');
  return facts;
}

export function reportText(r: ConnectionReport): string {
  return JSON.stringify({ class: classifyFailure(r), ...r });
}
