# Trip Speaker

**One track. Every Mac.** Trip Speaker plays one Chrome tab — usually the Spotify web player — through the built-in speakers of two to five MacBooks at once, on a shared timeline so they don't echo each other. One laptop starts a room; everyone else joins with a four-digit code. There's no install, no account, and no Spotify developer key.

It's a static Vite + React + TypeScript app that deploys to Netlify as plain files.

---

## How it works

```
 Host Mac (Chrome)                                         Guest Macs (Chrome)
 ┌──────────────────────────────────────────────┐          ┌──────────────────────────────┐
 │ Spotify tab ──getDisplayMedia (tab audio)──┐ │          │                              │
 │                                            ▼ │  WebRTC  │                              │
 │  capture AudioWorklet: mono PCM16, 20 ms   ──┼─────────►│ renderer AudioWorklet         │
 │  packets stamped with currentFrame           │  data    │  (same code as the host)      │
 │        │ (MessagePort)                       │  channel │                              │
 │        ▼                                     │          │  plays source frame n at      │
 │  renderer AudioWorklet ── speakers           │◄────────►│  hostRef(n) + 1.2 s − θ + trim│
 │  (same delayed path; no direct monitor)      │ control  │                              │
 └──────────────────────────────────────────────┘ (JSON)   └──────────────────────────────┘
            ▲ PeerJS public signaling only introduces the laptops (no audio passes through it)
```

- **Transport:** host → guests star topology over WebRTC data channels via PeerJS 1.5.5. Each guest has a reliable, ordered JSON control channel (handshake, clock sync, room state) and a separate binary audio channel (`serialization: "raw"`, `reliable: false`). In this PeerJS version, `reliable: false` only makes the channel *unordered*; retransmissions stay on. Trip Speaker checks this at runtime and shows it in diagnostics. Each guest has its own send gate on `bufferedAmount`, so one slow laptop drops its own packets instead of stalling anyone else.
- **Audio format:** mono signed 16-bit PCM, about 20 ms per packet, at the host's actual AudioContext rate (48 kHz preferred, 44.1 kHz handled). That is about 768 kbit/s per guest before overhead, which is why rooms stop at five speakers. Each packet has a 32-byte header: version, channel count, frame count, session ID, stream epoch, sequence number, source rate, and the first source frame index. Every field is validated before anything is written or played.
- **Shared timeline:** every packet carries the capture worklet's `currentFrame`. The host publishes a smoothed `getOutputTimestamp()` mapping (host context time ↔ host performance time). Guests estimate the host-minus-guest clock offset θ with four-timestamp exchanges (`θ = ((h2−c1)+(h3−c4))/2`, `rtt = (c4−c1)−(h3−h2)`), using a robust low-RTT trend fit, and map deadlines into their own AudioContext through their own output timestamps. Output latency is not subtracted a second time; it's only added in the reduced-confidence fallback when output timestamps aren't available.
- **Renderer:** a bounded ring indexed by source frame, cubic resampling between any source and output rate, and resampling corrections capped at ±0.25 % for drift. Small timing changes use a short crossfade jump; large discontinuities use a fade-out and rebuffer. Gaps get 3 ms fades, and late packets are discarded rather than played late. The host plays through the exact same renderer with θ = 0.
- **Rooms:** codes come from `crypto.getRandomValues` (rejection-sampled, kept as strings, so "0047" stays "0047"). The host registers `<namespace>-<code>` with PeerJS before showing the room, retrying collisions up to 8 times. Each room has a random session ID, so stale packets from an earlier room that reused the code are rejected. Hosts can lock the room and remove guests. A four-digit code is a way to find each other, not security.

## Run it locally

Requires Node 22 and Chrome.

```bash
npm install
npm run dev          # http://127.0.0.1:4417
```

To try it across laptops on your LAN, run `npm run dev -- --host 0.0.0.0` and open `http://<your-ip>:4417` on each Mac. Note that Chrome only allows tab capture on `https://` or `localhost`, so **host from `localhost` or a deployed HTTPS site**. Guests can use the LAN URL.

Production build:

```bash
npm run build        # type-checks all projects, then builds dist/
npm run preview      # http://127.0.0.1:4418 (serves dist/)
```

## Using it tonight

**Everyone:** Chrome on a Mac, the same Wi-Fi, volume up, built-in speakers, laptops open and plugged in.

**Host (the laptop with the music):**
1. Open the Spotify web player (`open.spotify.com`) in a Chrome tab and start a song.
2. Open Trip Speaker in another tab and click **Start a room**. Read out the four-digit code, or use **Invite link**.
3. Click **Share music tab**. In Chrome's picker, choose **Chrome Tab**, select the Spotify tab, turn on **Share tab audio**, and click **Share**.
4. Pick songs and pause in Spotify. Trip Speaker never shows track names and has no playback controls of its own.
5. When you're done, click **End room** at the bottom of the page. It stops every laptop.

**Guests:**
1. Open the same Trip Speaker address, click **Join a room**, type the code (or paste the invite link), add a device name if you like, and click **Join room**.
2. Click **Enable this speaker**. Chrome needs one click before a tab can play sound.
3. Set this Mac's volume. If you hear a doubled beat, open **Hear an echo?**, play test clicks, and nudge this Mac **Earlier** (if it sounds behind) or **Later** (if it sounds ahead).

Every laptop, the host included, plays about 1.2 seconds after the Spotify tab. That shared delay is what lets them line up.

## Deploy to Netlify

`netlify.toml` already sets the build command to `npm run build`, the publish directory to `dist`, Node 22, an SPA fallback that never shadows real files (so `/assets/*.worklet-*.js` always ships as JavaScript), and a `Permissions-Policy` that allows tab capture but no microphone or camera.

**Option A — from a Git repository**
1. Push this project to GitHub, GitLab, or Bitbucket.
2. In Netlify: **Add new site → Import an existing project**, then pick the repository. The build settings come from `netlify.toml`.
3. Deploy. Every laptop opens the resulting `https://…netlify.app` URL.

**Option B — drag and drop**
1. Run `npm ci && npm run build`.
2. In Netlify: **Add new site → Deploy manually**, then drag the `dist/` folder onto the page.

**Option C — Netlify CLI**
```bash
npx netlify-cli deploy --dir=dist            # draft URL
npx netlify-cli deploy --dir=dist --prod     # production
```

After deploying, open the site, start a room, and check in DevTools → Network that `capture.worklet-*.js` and `renderer.worklet-*.js` load with a JavaScript content type.

## Optional configuration

Everything here is public: Vite inlines `VITE_*` values into the browser bundle. Only put signaling locations and public STUN/TURN entries here, never private credentials. See `.env.example`.

| Variable | Purpose |
|---|---|
| `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE` | Use your own PeerJS server instead of `0.peerjs.com` |
| `VITE_ICE_SERVERS` | JSON list of public STUN/TURN servers. If unset, Trip Speaker uses Google and Cloudflare STUN, plus a relay only if one is configured below. (PeerJS's built-in TURN hosts no longer resolve, so they aren't used.) |
| `VITE_ROOM_NAMESPACE` | Keeps rooms from different deployments apart (default: a hash of the site host) |

You can also set these per browser in **Help → Advanced connection**. Every laptop in a room must match.

For testing without the internet, `npm run peer:local` starts a local PeerJS server on port 9417 (path `/ts`). It's for tests and LAN experiments only; production stays a static site.

## If laptops won't connect

"Your network is blocking the connection" means the host answered but the two laptops couldn't open a direct route. The join screen now lists what was tried, under **What to try → Technical details**. In order of likelihood:

1. **macOS Local Network permission.** On each Mac, open **System Settings → Privacy & Security → Local Network**, switch on **Google Chrome**, and reload Trip Speaker on both laptops.
2. **VPNs.** Turn them off on both laptops.
3. **The Wi-Fi keeps devices apart.** Guest, hotel, office, and some mesh networks do this ("client isolation"). Try a phone hotspot or a home network, or add a relay (below).

"The host isn't answering" means the code was found but the host's laptop didn't respond. Check that it's awake, with Trip Speaker open and the room still running.

### Relay for restrictive networks

A TURN relay forwards audio when no direct route exists. Its key is a secret, so it stays in a Netlify Function (`netlify/functions/ice.mts`) that hands the browser short-lived credentials. The key never goes into a `VITE_*` variable.

1. In the Cloudflare dashboard, go to **Realtime → TURN** and create a TURN key. Note the **Key ID** and **API token**.
2. In Netlify, open **Site configuration → Environment variables** and add `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`, scoped to Functions.
3. Redeploy. Visiting `https://<your-site>/.netlify/functions/ice` should show `{"configured":true}`, and Sound settings → diagnostics shows **Relay server (TURN): Configured**.

Relayed audio is about 0.8 Mbit/s per guest and passes through Cloudflare, so the direct route is still preferred whenever it works.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 4417 (dev also serves visual fixtures at `/?fixture=…`) |
| `npm run build` | `tsc -b` across app, worklet, tooling, and test projects, then a production build |
| `npm run preview` | Serves `dist/` on port 4418 |
| `npm run typecheck` | TypeScript only |
| `npm test` / `npm run test:unit` | Vitest unit and simulation tests |
| `npm run test:e2e` | Playwright: real WebRTC audio, UI/accessibility, and fixture visual suites (see TESTING.md) |
| `npm run lint` | oxlint |
| `npm run peer:local` | Local PeerJS signaling server for tests and offline LAN use |

## Project layout

```
src/
  core/        Environment-free logic (unit-tested): room codes, protocol validation, packets,
               clock sync, output-timestamp fitting, deadline math, ring buffer, renderer, status
  audio/       AudioContext engine, tab capture, timing controller, worklets/ (capture + renderer)
  net/         PeerJS wrappers and user-facing error copy
  session/     Host and guest controllers (React-free), app store, prefs, wake lock
  ui/          Screens, primitives (code input, drawer, slider, menu…), GSAP motion, visuals
  styles/      Tokens and component CSS        design/  tokens.ts + contrast math
  fixtures/    Dev-only static states for visual review
tests/
  unit/        Vitest (deterministic simulations with jitter, loss, and drifting clocks)
  e2e/         Playwright: audio/, ui/, visual/
```

## Design notes

- **Palette:** background `#11130F`, surfaces `#1A1D17` / `#24281F`, warm white `#F3F3E9` / `#B4B9AB`, a single lime accent `#D5F86F` (dark text on lime fills), and a soft coral `#F2A68E` used only for alerts. `tests/unit/contrast.test.ts` checks every text and boundary pairing that's actually used. Secondary text is at least 7.5:1, lime buttons are 15.6:1, and control borders are at least 3:1.
- **Type:** Geist Variable (self-hosted) at weights 400/500/600/640, tabular numerals for codes and measurements, and fluid `clamp()` headings with tight leading and slight negative tracking.
- **Motion:** GSAP 3.15 with `@gsap/react` contexts. The headline uses SplitText word reveals masked by line, with `autoSplit`/`onSplit`, playing once per visit. Panel swaps use 8 px rises, drawers slide in over 0.26 s, the speaker strip uses Flip, and below-the-fold sections use ScrollTrigger reveals. CSS handles hover and press states. Reduced motion removes movement and split text, keeps short fades, and defaults the visualizer to Calm.
- **Visualizer:** a canvas level history read straight from an `AnalyserNode` at 24 fps (8 fps in Calm). It never touches React state, pauses off-screen, and settles to a flat baseline on silence.

## Honest limits

- Built for **Chrome on macOS**. Automated tests ran in Chrome 154 on Linux. **Physical MacBooks and real Spotify capture have not been tested yet**; TESTING.md has the checklist.
- Tab capture of Spotify depends on Chrome, the site, and settings. If the shared tab is silent, Trip Speaker says so instead of guessing why.
- Being on the same Wi-Fi doesn't guarantee a connection. Hotel and campus networks often isolate clients, and Chrome needs macOS Local Network permission. Without a configured relay there's no fallback: PeerJS's built-in TURN servers no longer exist, and the free Open Relay credentials no longer work.
- Sync is an engineering target, not a guarantee. Laptops a few metres apart differ by a few milliseconds just from the speed of sound.
- Chrome 154 refuses `echoCancellation: false` for tab audio. Trip Speaker turns off noise suppression and auto-gain where allowed and reports the result in Sound settings.
- No host migration: if the host closes the tab, the room ends.
- Closing a lid or sleeping a Mac stops its audio. A screen wake lock is requested where supported.

## Credits

GSAP and @gsap/react (GreenSock standard license, free), PeerJS (MIT), Lucide (ISC), Geist (OFL). The headline reveal is adapted from React Bits' SplitText (MIT + Commons Clause, © David Haz). Trip Speaker is not affiliated with Spotify.
