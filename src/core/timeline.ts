import { contextAt, perfAt, type LinearClockMap } from './anchor';

/**
 * Shared playback timeline.
 *
 * Source frame n was captured at host context time n / sourceRate. The host's
 * output mapping turns that into a host performance time; every speaker plays
 * it `commonBufferMs` later, converted into its own clock with theta (host
 * minus client) and into its own AudioContext with its output mapping.
 */

export function hostReferenceMs(frame: number, sourceRate: number, host: LinearClockMap): number {
  return perfAt(host, frame / sourceRate);
}

export function clientDeadlineMs(hostRefMs: number, commonBufferMs: number, thetaMs: number, trimMs: number): number {
  return hostRefMs + commonBufferMs - thetaMs + trimMs;
}

/**
 * Local AudioContext time at which a client deadline is heard. The output
 * mapping already includes output latency, so none is subtracted here.
 */
export function contextDeadline(clientDeadline: number, local: LinearClockMap): number {
  return contextAt(local, clientDeadline);
}

export interface TimelineInputs {
  host: LinearClockMap;
  local: LinearClockMap;
  sourceRate: number;
  outputRate: number;
  thetaMs: number;
  commonBufferMs: number;
  trimMs: number;
}

export function frameContextDeadline(frame: number, t: TimelineInputs): number {
  const hostRef = hostReferenceMs(frame, t.sourceRate, t.host);
  return contextDeadline(clientDeadlineMs(hostRef, t.commonBufferMs, t.thetaMs, t.trimMs), t.local);
}

/** Linear map handed to the renderer: source position for any output frame. */
export interface RendererTiming {
  refOutputFrame: number;
  refSourceFrame: number;
  /** Source frames advanced per output frame (rate ratio including clock slopes). */
  step: number;
}

export function sourceFrameAt(timing: RendererTiming, outputFrame: number): number {
  return timing.refSourceFrame + (outputFrame - timing.refOutputFrame) * timing.step;
}

/**
 * Inverts the deadline chain at a local context time so the renderer gets
 * "at output frame F, source frame N should be heard; advance by step".
 */
export function buildRendererTiming(t: TimelineInputs, atContextTime: number): RendererTiming {
  const clientPerf = perfAt(t.local, atContextTime);
  const hostRef = clientPerf + t.thetaMs - t.commonBufferMs - t.trimMs;
  const hostContextTime = contextAt(t.host, hostRef);
  const step = (t.sourceRate / t.outputRate) * (t.local.slope / t.host.slope);
  return {
    refOutputFrame: atContextTime * t.outputRate,
    refSourceFrame: hostContextTime * t.sourceRate,
    step,
  };
}

export const COMMON_BUFFER_DEFAULT_MS = 1200;
export const COMMON_BUFFER_MIN_MS = 600;
export const COMMON_BUFFER_MAX_MS = 2500;
export const TRIM_LIMIT_MS = 250;

export function clampTrim(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-TRIM_LIMIT_MS, Math.min(TRIM_LIMIT_MS, Math.round(ms)));
}

export function clampCommonBuffer(ms: number): number {
  if (!Number.isFinite(ms)) return COMMON_BUFFER_DEFAULT_MS;
  return Math.max(COMMON_BUFFER_MIN_MS, Math.min(COMMON_BUFFER_MAX_MS, Math.round(ms / 50) * 50));
}
