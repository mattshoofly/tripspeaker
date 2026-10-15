import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('https://trip-speaker.netlify.app/');
const results = await page.evaluate(async () => {
  async function gather(config, label) {
    const pc = new RTCPeerConnection(config);
    pc.createDataChannel('probe');
    const types = new Set(); const addrs = [];
    pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate) { const c = e.candidate; types.add(c.type); if (c.type !== 'host') addrs.push(`${c.type} ${c.protocol} ${c.address}:${c.port}`); } };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => { const t = setTimeout(r, 8000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }; });
    pc.close();
    return { label, types: [...types], sample: addrs.slice(0, 3) };
  }
  return [
    await gather({ iceServers: [{ urls: ['turn:staticauth.openrelay.metered.ca:80', 'turn:staticauth.openrelay.metered.ca:443', 'turn:staticauth.openrelay.metered.ca:80?transport=tcp', 'turns:staticauth.openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }], iceTransportPolicy: 'relay' }, 'Open Relay (relay only)'),
    await gather({ iceServers: [{ urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }], iceTransportPolicy: 'relay' }, 'PeerJS TURN (relay only)'),
  ];
});
console.log(JSON.stringify(results, null, 1));
await browser.close();
