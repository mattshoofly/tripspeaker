import { Packetizer } from '../../core/packetizer';
import { clickSampleAt, clickScheduleEnd, duckGainAt, makeClickSchedule, type ClickSchedule } from '../../core/testSignal';
import { CAPTURE_PROCESSOR, type CaptureInbound, type CaptureOutbound, type CaptureProcessorOptions } from '../workletMessages';

/**
 * Downmixes the shared tab to mono, mixes calibration clicks at exact frame
 * positions, and packetizes on the audio thread. Its output is silent: the
 * captured tab is never routed to the speakers undelayed.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  private readonly packetizer: Packetizer;
  private active = false;
  private disposed = false;
  private clicks: ClickSchedule | null = null;
  private clicksEnd = 0;
  private localPort: MessagePort | null = null;
  private mono = new Float32Array(128);
  private levelSumSq = 0;
  private levelCount = 0;
  private levelPeak = 0;
  private readonly levelInterval = Math.round(sampleRate / 10);
  private lastFrameEnd = -1;
  private frameGaps = 0;
  private emitting = false;

  constructor(options?: { processorOptions?: Partial<CaptureProcessorOptions> }) {
    super();
    const opts = options?.processorOptions ?? {};
    this.packetizer = new Packetizer({
      packetFrames: opts.packetFrames ?? Math.round(sampleRate / 50),
      sampleRate,
      sessionId: opts.sessionId ?? 0,
      epoch: opts.epoch ?? 0,
      emit: (packet, firstFrame, sequence) => {
        if (this.localPort) {
          const copy = packet.slice(0);
          this.localPort.postMessage({ type: 'packet', packet: copy }, [copy]);
        }
        const msg: CaptureOutbound = { type: 'packet', packet, firstFrame, sequence };
        this.port.postMessage(msg, [packet]);
      },
    });
    this.port.onmessage = (e: MessageEvent<CaptureInbound>) => this.handle(e.data);
  }

  private handle(msg: CaptureInbound): void {
    switch (msg.type) {
      case 'configure':
        this.packetizer.configure(msg.sessionId, msg.epoch);
        break;
      case 'active':
        this.active = msg.active;
        if (!msg.active) this.packetizer.reset();
        break;
      case 'clicks': {
        const schedule = makeClickSchedule(currentFrame, sampleRate, msg.leadSeconds, msg.count, msg.intervalSeconds);
        this.clicks = schedule;
        this.clicksEnd = clickScheduleEnd(schedule) + Math.round(0.25 * sampleRate);
        const out: CaptureOutbound = { type: 'clicks-scheduled', schedule };
        this.port.postMessage(out);
        break;
      }
      case 'local-port':
        this.localPort?.close();
        this.localPort = msg.port;
        break;
      case 'dispose':
        this.disposed = true;
        this.localPort?.close();
        this.localPort = null;
        break;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const frames = outputs[0]?.[0]?.length ?? inputs[0]?.[0]?.length ?? 128;
    if (this.mono.length !== frames) this.mono = new Float32Array(frames);
    const mono = this.mono;
    if (this.lastFrameEnd >= 0 && currentFrame !== this.lastFrameEnd) this.frameGaps++;
    this.lastFrameEnd = currentFrame + frames;
    const input = inputs[0];
    const channels = input ? input.length : 0;
    if (channels === 0) {
      mono.fill(0);
    } else if (channels === 1) {
      mono.set(input[0]);
    } else {
      const scale = 1 / channels;
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += input[c][i];
        mono[i] = s * scale;
      }
    }

    let sumSq = 0;
    let peak = this.levelPeak;
    for (let i = 0; i < frames; i++) {
      const v = mono[i];
      sumSq += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    this.levelSumSq += sumSq;
    this.levelCount += frames;
    this.levelPeak = peak;
    if (this.levelCount >= this.levelInterval) {
      const msg: CaptureOutbound = {
        type: 'level',
        rms: Math.sqrt(this.levelSumSq / this.levelCount),
        peak: this.levelPeak,
        frame: currentFrame,
        packets: this.packetizer.nextSequence,
        discontinuities: this.packetizer.discontinuities,
        frameGaps: this.frameGaps,
      };
      this.port.postMessage(msg);
      this.levelSumSq = 0;
      this.levelCount = 0;
      this.levelPeak = 0;
    }

    const clicks = this.clicks;
    let clicksLive = false;
    if (clicks) {
      if (currentFrame > this.clicksEnd) {
        this.clicks = null;
      } else {
        clicksLive = true;
        for (let i = 0; i < frames; i++) {
          const f = currentFrame + i;
          mono[i] = mono[i] * duckGainAt(f, clicks) + clickSampleAt(f, clicks);
        }
      }
    }

    if (this.active || clicksLive) {
      this.packetizer.push(mono, currentFrame);
      this.emitting = true;
    } else if (this.emitting) {
      // Pausing emission is intentional, not a clock skip.
      this.packetizer.reset();
      this.emitting = false;
    }
    return true;
  }
}

registerProcessor(CAPTURE_PROCESSOR, CaptureProcessor);
