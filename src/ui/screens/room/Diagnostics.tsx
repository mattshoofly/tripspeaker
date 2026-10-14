import type { ClockView, LinkDiagnostics, LocalAudioView } from '../../../session/types';
import type { ChannelInfo } from '../../../net/peer';
import { formatMs } from './shared';

function Row({ k, v, alert }: { k: string; v: string; alert?: boolean }) {
  return (
    <>
      <dt>{k}</dt>
      <dd data-tone={alert ? 'alert' : undefined}>{v}</dd>
    </>
  );
}

function channelText(c: ChannelInfo | null): string {
  if (!c) return 'Not open';
  const reliability =
    c.maxRetransmits !== null ? `${c.maxRetransmits} retransmits` : c.maxPacketLifeTime !== null ? `${c.maxPacketLifeTime} ms lifetime` : 'retransmits until delivered';
  return `${c.ordered ? 'ordered' : 'unordered'}, ${reliability}`;
}

export function Diagnostics({
  local,
  clock,
  links,
  packetsReceived,
  audioChannel,
  role,
}: {
  local: LocalAudioView;
  clock?: ClockView;
  links?: LinkDiagnostics[];
  packetsReceived?: number;
  audioChannel?: ChannelInfo | null;
  role: 'host' | 'guest';
}) {
  const r = local.renderer;
  const t = local.timing;
  const anchor =
    t?.anchorSource === 'output-timestamp' ? 'Measured (getOutputTimestamp)' : t?.anchorSource === 'estimated' ? 'Estimated — reduced confidence' : 'Not yet';
  return (
    <dl className="kv" data-testid="diagnostics">
      {role === 'guest' && clock ? (
        <>
          <Row k="Estimated clock offset (host − this Mac)" v={formatMs(clock.thetaMs, 2)} />
          <Row k="Timing uncertainty (bound)" v={clock.uncertaintyMs === null ? '—' : `± ${clock.uncertaintyMs.toFixed(2)} ms`} />
          <Row k="Best round trip" v={formatMs(clock.rttMs, 2)} />
          <Row k="Clock samples" v={String(clock.samples)} />
        </>
      ) : (
        <Row k="Clock offset" v="0 ms — host is the reference" />
      )}
      <Row k="Output timestamps" v={anchor} alert={t?.anchorSource === 'estimated'} />
      <Row k="Shared delay" v={t ? `${t.commonBufferMs} ms` : '—'} />
      <Row k="Manual trim" v={t ? `${t.trimMs > 0 ? '+' : ''}${t.trimMs} ms` : '—'} />
      <Row k="Audio buffered ahead" v={formatMs(r?.bufferedMs, 0)} />
      <Row k="Schedule error (renderer)" v={r?.errorMs === null || r?.errorMs === undefined ? '—' : formatMs(r.errorMs, 2)} />
      <Row k="Resampling correction" v={r ? `${r.correctionPpm.toFixed(0)} ppm` : '—'} />
      <Row k="Source rate → output rate" v={r && r.sourceRate ? `${r.sourceRate} → ${r.outputRate} Hz` : t ? `— → ${t.outputRate} Hz` : '—'} />
      <Row k="Reported output latency" v={formatMs(t?.outputLatencyMs, 1)} />
      <Row k="Late packets / samples" v={r ? `${r.latePackets} / ${r.lateFrames}` : '—'} alert={(r?.lateFrames ?? 0) > 0} />
      <Row k="Missing samples" v={r ? String(r.missingFrames) : '—'} alert={(r?.missingFrames ?? 0) > 0} />
      <Row k="Underruns" v={r ? String(r.underruns) : '—'} alert={(r?.underruns ?? 0) > 0} />
      <Row k="Resyncs / timing jumps" v={r ? `${r.resyncs} / ${r.jumps}` : '—'} />
      <Row k="Renderer state" v={r?.state ?? '—'} />
      {role === 'guest' ? (
        <>
          <Row k="Audio packets received" v={String(packetsReceived ?? 0)} />
          <Row k="Audio channel" v={channelText(audioChannel ?? null)} />
        </>
      ) : null}
      {role === 'host'
        ? (links ?? []).map((l) => (
            <Row
              key={l.id}
              k={`To ${l.name}`}
              v={`${l.sent} sent · ${l.dropped} dropped (backpressure ×${l.backpressureEpisodes}) · ${Math.round(l.bufferedBytes / 1024)} KB queued · ${channelText(l.channel)}`}
              alert={l.dropped > 0}
            />
          ))
        : null}
    </dl>
  );
}
