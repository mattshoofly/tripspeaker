# Testing Trip Speaker

This file separates three kinds of evidence:

1. **Automated checks that ran and passed** in this repository (unit simulations, real-browser WebRTC tests, UI and visual checks).
2. **What those checks do not prove.** Everything ran in one Chrome on one Linux machine with a virtual audio device.
3. **The physical acceptance test** you run on real MacBooks with real speakers and Spotify. **It is still pending.**

---

## Run the suites

```bash
npm ci
npx playwright install chrome   # only if Chrome isn't already installed
npm run typecheck               # app, worklet, tooling, and test TypeScript projects
npm test                        # Vitest: unit tests + deterministic audio simulations
npm run test:e2e                # Playwright: audio/, ui/, visual/ projects
npx playwright test --project=audio   # just the real-WebRTC audio tests
```

`npm run test:e2e` starts three servers for you:

| Server | Port | Used by |
|---|---|---|
| Local PeerJS signaling (`scripts/peer-server.mjs`) — **test-only** | 9417 | all browser tests |
| `vite build` + `vite preview` (**the production build**) | 4418 | `audio`, `ui` |
| `vite` dev server (serves dev-only `?fixture=` states) | 4419 | `visual` |

Chrome flags the tests use: `--use-fake-ui-for-media-stream` and `--auto-select-tab-capture-source-by-title=Fixture Music` (so getDisplayMedia picks a real test tab without a human), `--disable-features=WebRtcHideLocalIpsWithMdns` (loopback peers can't resolve mDNS host candidates in the sandbox), and `--autoplay-policy=user-gesture-required`. Every participant is a separate browser context, so each has its own storage, its own `performance.timeOrigin`, and its own PeerJS peer.

---

## 1 · Unit tests (Vitest) — `tests/unit/`

These are deterministic. `sim.ts` drives the real `Packetizer` and `RendererCore` with a seeded network model (base delay, jitter, loss, duplicates, reordering, targeted late packets) and with **independent host and guest audio clocks** (ppm offsets) against a "true" timeline.

| File | Covers |
|---|---|
| `roomCode.test.ts` | leading zeros kept as strings, rejection of modulo bias, invalid codes, paste sanitising (including invite links), invite parsing, PeerJS-safe namespaced IDs, bounded collision retries, never retrying the same code, signaling errors surfaced without retries |
| `protocol.test.ts` | handshake admission (protocol mismatch, locked, full = 5 speakers, resume into a locked/full room, stale session, removed guests, ended), strict message validation and bounds, audio-connection metadata, name sanitising |
| `clockSync.test.ts` | θ formula and sign (host ahead and behind), RTT excluding host processing, impossible samples rejected, low-RTT preference with asymmetric outliers, minimum sample count, **tracking 120 ppm drift within 1 ms**, smoothing vs. snapping |
| `timeline.test.ts` | host reference time, client deadline with θ, trim direction (positive = Later), output-timestamp mapping, **no double latency compensation** (output timestamps used as-is; latency added only in the estimated fallback), round-trip consistency of the deadline chain and renderer map with slopes, host = same engine with θ = 0, two guests with different clock origins landing on the same physical instant, output-timestamp validation, jittery slope fitting, outlier vs. confirmed discontinuity, stale readings |
| `packet.test.ts` | binary round trip, 768 kbit/s payload at 48 kHz, every validation failure (magic, version, channels, frame count, length, rate, frame index NaN/negative/fractional), PCM16 quantisation, packets stamped with capture-thread frame index, discontinuities dropping partial packets |
| `renderer.test.ts` | starts at the deadline (not on arrival), accurate reproduction, **reordering and duplicates give bit-identical output**, gaps skipped with fades (no late replay), late packets discarded and counted, **48→44.1 kHz and 44.1→48 kHz** conversion (frequency, RMS, waveform error), **drift +90/−70 ppm over 60 s with timing noise stays < 1 ms with no resyncs**, trim applied Later with a crossfade, memory bounded / far-future packets refused, stale session and older epoch rejected and newer epoch reset, recovery after a 3 s outage at the current timeline position, fade-out when timing is withdrawn |
| `backpressure.test.ts` | hysteresis gate, **a slow guest never stalls a fast one** and its queue stays bounded, a throwing target doesn't break fan-out |
| `status.test.ts` | "Playing" never derived from an open connection alone, priority of connection problems, mute shown separately, activity hold |
| `contrast.test.ts` | WCAG contrast for every token pairing actually used, 3:1 control boundaries, lime focus ring, and `tokens.css` matching `tokens.ts` |

---

## 2 · Real-browser audio tests (Playwright, production build) — `tests/e2e/audio/`

These use **real local WebRTC** between separate browser contexts through a local PeerJS server, **real AudioWorklets** from the production bundle, and, for the main test, **real `getDisplayMedia` tab capture** of a tab that plays a generated tone. (Chrome picks the tab by title, standing in for a person choosing it in the picker.)

| Test | What it verifies |
|---|---|
| `room.spec.ts` — host and two guests | Creates a real room, reads the code **from the screen**, two guests join with it and click **Enable this speaker**. The host shares the tone tab and the input meter reports sound. Every renderer reaches *playing* with non-silent output, more than 100 packets and 0 underruns. **Clock offset θ is compared with the true difference between the pages' `performance.timeOrigin`.** **The source position each device is scheduled to be heard at is compared on one wall clock across host + guests.** Channel inspection confirms `ordered: false`, `maxRetransmits: null`. Also covers guest volume and mute (gain goes to 0 while the renderer keeps advancing), **a third guest joining mid-song** (host epoch unchanged, no restart, scheduled within tolerance), **a dropped guest reconnecting into the same slot and order**, and **End room** reaching every guest. |
| `errors.spec.ts` | wrong code → "No room found." with the value kept and refocused · incomplete code rejected inline · **signaling unavailable** · **a host ID that registers but never answers → "The host isn't answering."** with host-focused help · **a guest with no usable network route (relay-only ICE, no TURN) → "Your network is blocking the connection."** with Local Network / VPN / isolation steps and technical details, and **the host is told a laptop couldn't connect** · **locked** room refuses, then admits after unlocking · **full** room (host + 4) refuses a 6th · host **removes** a guest · **closing the host tab** ends the room for guests · capture fixtures: **cancel**, **no audio**, **window instead of tab**, **silent tab** (reported without guessing a cause) |
| `rates-and-motion.spec.ts` | **44.1 kHz host → 48 kHz guest and 48 kHz host → 44.1 kHz guest**, both playing, 0 underruns, scheduled together · **playback with animated UI in use (drawers, popovers, trim nudges, viewport resizes), once with motion and once with reduced motion**: underruns, missing samples, late packets, and resyncs must not increase, and frames played must keep pace with wall time |

### Measured in this environment

Chrome 154, Linux, virtual audio output, loopback networking. These are ranges across several runs:

| Measurement | Result |
|---|---|
| Clock offset θ vs. true `timeOrigin` difference (two guests) | **0.06–0.32 ms** error, best RTT 0.6–1.3 ms |
| Scheduled source position, host + 2 guests, one wall clock | **0.37–2.42 ms** spread (threshold 20 ms), all three using measured output timestamps |
| 44.1 kHz host → 48 kHz guest | 0.10–0.55 ms spread, 0 underruns, 0 resyncs |
| 48 kHz host → 44.1 kHz guest | 0.13–4.10 ms spread, 0 underruns, 0 resyncs |
| Mid-song join | third guest scheduled with the host within tolerance; host epoch unchanged, stream not restarted |
| Reconnect | dropped guest back in the same slot and order, playing again |
| Animated UI in use, **reduced motion** | 0 underruns, 0 missing samples, 0 late packets, 0 resyncs in every run |
| Animated UI in use, **motion on** | 0 underruns and 0 missing samples in most runs. In 2 of 5 runs, Chrome **skipped render quanta on the host's audio thread** while the VM was CPU-starved by two Chrome sessions (2–4 "audio clock skips" in host diagnostics). Each skip became one faded gap of 118–235 frames (2.7–5.3 ms) on the guest. In every run, the transport dropped 0 packets, 0 arrived late, and nothing resynced. |
| Default production config (PeerJS **public** signaling, default ICE) | room registered in 1.7 s, guest joined in 1.0 s, guest reached *Playing together* (one manual run from this VM) |

One run with a second Chrome open on the desktop measured a late joiner 22 ms off at 1.5 s after it started. The cause was clock samples inflated by load and a deliberately slow 2 ms-per-update offset slew. Guests now wait for 8 exchanges before playing, smooth faster for the first 10 s, and apply corrections larger than 3 ms with a crossfade instead of a multi-second resample. After that change, three consecutive runs under the same load passed.

The motion-on gaps came from host CPU starvation in this sandbox, not from the UI thread or the network. Audio runs on Chrome's real-time audio thread, separate from GSAP and React. Since then, a skip only loses the skipped frames; the partial packet is sent as a short packet instead of dropped. Trip Speaker also requests `latencyHint: 'playback'`, which gives the audio thread more slack, because the 1.2 s shared delay makes low output latency pointless. Host diagnostics show "audio clock skips" so this is visible on real hardware.

### Live-site connectivity checks

Run from this VM against `https://trip-speaker.netlify.app`:
- Host and guest in separate browser contexts on one machine joined in about 1 s.
- **PeerJS's default TURN hosts (`eu-0`/`us-0.turn.peerjs.com`) don't resolve,** and the old Open Relay static credentials return no relay candidates. So without a configured relay, two laptops that can't reach each other directly have no fallback.
- Google STUN works (server-reflexive candidates gathered).

This is why a laptop on a network that keeps devices apart sees "Your network is blocking the connection". The fix is on the network side (macOS Local Network permission, VPN, client isolation) or an optional Cloudflare relay (README).

### Manual walkthrough in desktop Chrome (recorded)

Two Chrome 154 windows on this VM's desktop, using the dev server and the **default PeerJS public signaling** with default ICE. Steps: Start a room (code 8986) → guest joins with the code → Enable this speaker → host clicks **Share music tab** and goes through **Chrome's real share picker** (Chrome Tab → "Demo Music — generated tone" → Share tab audio on → Share) → host shows "Playing on 2 speakers" and "Sound from your tab", guest shows "Playing together", and both waveforms show the same shape at the same moment → guest calibration nudged to +3 ms Later → host plays test clicks → End room → guest shows "The room has ended." A video review confirmed each step. The review led to one change: the device-name placeholder was mistaken for a pre-filled value, so it now reads "e.g. Sam’s MacBook Air".

**What this does *not* prove:** all contexts share one machine, one monotonic clock, and one virtual audio device, and there's no real Wi-Fi. These numbers show the scheduling chain (capture frame → host anchor → θ → local output timestamp → renderer) is internally consistent end to end. They say nothing about physical alignment of separate MacBook speakers, real Wi-Fi jitter, or macOS output-latency reporting. The capture tests use a generated tone tab and explicit fixtures. **Spotify capture has not been verified.**

---

## 3 · UI, accessibility, and visual tests

**`tests/e2e/ui/` (production build):**
- no horizontal overflow at 1440×900, 1280×800, 390×844 and **720×450 (200% zoom of a 1440×900 MacBook)**; primary actions above the fold at MacBook sizes; code slots fit
- headline entrance plays **once** and isn't replayed by panel toggles or resizes (re-splits sync to the finished state)
- reduced motion: no SplitText masks, no transforms on entrance elements, focus still lands in the code field
- invite link `/?room=0047` opens the join panel with the string `0047`
- code field: typing with stray characters, no auto-join on the fourth digit, arrow keys + Backspace mid-code, select-all, paste of "Code: 00 47" and of a full invite link, Enter submits, inline invalid state with `aria-invalid`
- keyboard order on the entry screen; Help dialog keeps Tab inside, closes on Escape, returns focus
- FAQ toggles with Enter/Space and exposes `aria-expanded` + regions
- every visible control has an accessible name and is at least 44×44 px
- production delivery: both AudioWorklet files return `application/javascript` (not the SPA HTML), are self-contained, and dev fixtures aren't in production

**`tests/e2e/visual/` (dev server fixtures; layout only, no audio):** screenshots at **1440×900, 1280×800, 390×844** for the entry screen, join panel, invalid code, focused code field, host starting/setup/guests waiting/capture error/active/quiet tab with suppression warning/full and locked/ended, guest enable/syncing/waiting/active/reconnecting/needs attention/ended/removed, the calibration drawer (with keyboard trim to "12 milliseconds later"), diagnostics, sound settings, the room menu (arrow-key navigation), and the End-room confirmation (focus on "Keep playing"). Each state is checked for horizontal overflow and clipped text. Screenshots are written to `test-results/visual/<size>/`.

Manual review notes (things fixed during the refinement pass): checklist styling leaked from the picker guide, the mobile volume row grew to 300 px tall, five speaker cards overflowed and overlapped at 1440 px, the volume and mute icons on cards were indistinguishable, the guest panel stayed optimistic while reconnecting, the room-ended heading showed a focus ring from programmatic focus, the SplitText accessible name lost the space after "track.", the blanket reduced-motion CSS delayed `visibility` and broke focus in the join panel, and native modal dialogs let Tab escape to browser chrome.

---

## 4 · Physical acceptance test — **PENDING** (not run; needs real MacBooks)

Run this on the deployed HTTPS site. Use built-in speakers and one Wi-Fi network. Mark each item ✅/❌ and add notes.

| # | Step | Result |
|---|---|---|
| 1 | Deploy to Netlify (see README). | ☐ pending |
| 2 | Open the same deployment in Chrome on two Macs. | ☐ pending |
| 3 | Use built-in speakers and the same Wi-Fi. | ☐ pending |
| 4 | Create a room on Mac A. | ☐ pending |
| 5 | Join on Mac B using the four-digit code. | ☐ pending |
| 6 | Enable both speakers. | ☐ pending |
| 7 | Play generated synchronization clicks (**Test sync → Play test clicks**). | ☐ pending |
| 8 | Confirm both Macs produce audio. | ☐ pending |
| 9 | Adjust timing if necessary (Hear an echo? → Earlier/Later). | ☐ pending |
| 10 | Open Spotify's web player on Mac A. | ☐ pending |
| 11 | Confirm Spotify is playing in that browser. | ☐ pending |
| 12 | Share the Spotify tab with audio enabled. | ☐ pending |
| 13 | Confirm actual music on both Macs. | ☐ pending |
| 14 | Confirm Mac A has **no extra undelayed playback**. Mute Trip Speaker on Mac A; the room should go silent there. If Spotify is still audible, suppression failed and Sound settings will say so. | ☐ pending |
| 15 | Continue for at least 15 minutes. | ☐ pending |
| 16 | Check for growing echo, crackling, drift, or accumulating delay. Diagnostics should show steady *Schedule error*, *Audio buffered ahead* near the shared delay, and no climbing *Underruns*/*Missing samples*. | ☐ pending |
| 17 | Add another Mac mid-song. | ☐ pending |
| 18 | Disconnect and reconnect a guest (toggle its Wi-Fi off for ~5 s). | ☐ pending |
| 19 | Pause and resume Spotify. | ☐ pending |
| 20 | Open settings and use animated controls while music plays. | ☐ pending |
| 21 | End the room and confirm app playback stops on every Mac. | ☐ pending |

### Measuring physical sync

1. Place the Macs side by side with speakers facing the same way. Put a phone or recorder on the centre line, **about equidistant from each laptop** (within ~5 cm). Write the distances down: 34 cm of path difference is about 1 ms.
2. Mute all but two laptops (calibration drawer → Compare speakers), then play test clicks. Each burst is 8 clicks, every 4th accented.
3. Record at 48 kHz. In an audio editor (Audacity is fine), zoom into each click: a single speaker gives one sharp transient, while two out-of-sync speakers give a doubled transient. Measure the gap between the two onsets for several clicks and average them.
4. To tell the laptops apart, mute one at a time: the transient that disappears belongs to the muted Mac.
5. Nudge the late laptop **Earlier** (or the early one **Later**) by the measured gap, then re-measure. Aim for no audible doubling; about 10 ms or less is a reasonable engineering target, not a guarantee.
6. Recheck after changing output devices (Trip Speaker shows "Output changed — recheck sync").

### Spotify capture — **PENDING**

Not verified here (no Spotify session or account in the test environment). Steps 10–14 above are the check. If the shared Spotify tab is silent, Trip Speaker shows "No sound from the tab yet" and doesn't guess at the cause.
