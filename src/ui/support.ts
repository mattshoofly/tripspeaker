export interface SupportReport {
  /** Can play as a speaker at all (Web Audio worklets + WebRTC). */
  canListen: boolean;
  /** Can host: also needs tab capture. */
  canHost: boolean;
  isChrome: boolean;
  isMac: boolean;
  isTouch: boolean;
  missing: string[];
}

interface UAData {
  brands?: { brand: string }[];
  platform?: string;
  mobile?: boolean;
}

export function detectSupport(): SupportReport {
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const ua = nav.userAgent;
  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? [];
  const isChrome = brands.length ? brands.some((b) => b === 'Google Chrome' || b === 'Chromium') : /Chrome\/\d+/.test(ua) && !/Edg\/|OPR\//.test(ua);
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  const isMac = /mac/i.test(platform) || /Macintosh/.test(ua);
  const isTouch = Boolean(nav.userAgentData?.mobile) || /iPhone|iPad|Android/i.test(ua) || (isMac && nav.maxTouchPoints > 1);
  const missing: string[] = [];
  const hasWorklet = typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype;
  if (!hasWorklet) missing.push('AudioWorklet');
  if (typeof RTCPeerConnection === 'undefined') missing.push('WebRTC');
  const hasCapture = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  return {
    canListen: hasWorklet && typeof RTCPeerConnection !== 'undefined',
    canHost: hasWorklet && typeof RTCPeerConnection !== 'undefined' && hasCapture && !isTouch,
    isChrome,
    isMac,
    isTouch,
    missing,
  };
}

export function supportMessage(r: SupportReport): { tone: 'alert' | 'info'; title: string; body: string } | null {
  if (!r.canListen) {
    return {
      tone: 'alert',
      title: 'This browser can’t run Trip Speaker.',
      body: `It’s missing ${r.missing.join(' and ')}. Open Trip Speaker in Chrome on a Mac.`,
    };
  }
  if (r.isTouch) {
    return {
      tone: 'info',
      title: 'Phones and tablets aren’t tested as speakers.',
      body: 'Trip Speaker is built for Chrome on Mac. Joining from this device may not play in sync.',
    };
  }
  if (!r.isChrome || !r.isMac) {
    return {
      tone: 'info',
      title: 'Built for Chrome on Mac.',
      body: 'Other browsers and computers haven’t been tested. Hosting needs Chrome’s tab-audio sharing.',
    };
  }
  return null;
}
