import { RendererCore } from '../../core/renderer';
import { RENDERER_PROCESSOR, type RendererInbound, type RendererOutbound } from '../workletMessages';

/** Scheduled playback: renders the shared timeline on the audio clock. */
class RendererProcessor extends AudioWorkletProcessor {
  private readonly core = new RendererCore({ outputRate: sampleRate, maxSourceRate: 48000, capacitySeconds: 5 });
  private disposed = false;
  private inputPort: MessagePort | null = null;
  private nextStatsFrame = 0;
  private readonly statsInterval = Math.round(sampleRate / 4);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<RendererInbound>) => this.handle(e.data);
  }

  private handle(msg: RendererInbound): void {
    switch (msg.type) {
      case 'session':
        this.core.setSession(msg.sessionId);
        break;
      case 'timing':
        this.core.setTiming(msg.timing);
        break;
      case 'packet':
        this.core.push(msg.packet);
        break;
      case 'resync':
        this.core.resync();
        break;
      case 'input-port':
        this.inputPort?.close();
        this.inputPort = msg.port;
        this.inputPort.onmessage = (e: MessageEvent<RendererInbound>) => {
          if (e.data.type === 'packet') this.core.push(e.data.packet);
        };
        break;
      case 'dispose':
        this.disposed = true;
        this.inputPort?.close();
        this.inputPort = null;
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const first = out[0];
    this.core.render(first, currentFrame);
    for (let c = 1; c < out.length; c++) out[c].set(first);
    if (currentFrame >= this.nextStatsFrame) {
      this.nextStatsFrame = currentFrame + this.statsInterval;
      const msg: RendererOutbound = { type: 'stats', stats: this.core.stats() };
      this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor(RENDERER_PROCESSOR, RendererProcessor);
