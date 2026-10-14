import type { AccordionEntry } from '../../primitives/Accordion';

export const FAQ: AccordionEntry[] = [
  {
    id: 'wifi',
    title: 'Why Wi-Fi instead of Bluetooth?',
    body: (
      <>
        <p>
          A browser can’t group Bluetooth speakers or send one stream to several Macs. Trip Speaker sends audio from the host laptop to
          each guest over your network with WebRTC, then schedules every laptop to play the same moment about a second later.
        </p>
      </>
    ),
  },
  {
    id: 'browser',
    title: 'Which browser should we use?',
    body: (
      <p>
        Chrome on a Mac, on every laptop. Hosting relies on Chrome’s tab-audio sharing, and timing relies on Chrome’s Web Audio clock.
        Other browsers and phones aren’t supported yet.
      </p>
    ),
  },
  {
    id: 'spotify',
    title: 'How do we share Spotify?',
    body: (
      <>
        <p>
          On the host laptop, open the Spotify web player in a Chrome tab and start a song. In Trip Speaker, choose Share music tab,
          pick the Chrome Tab view, select the Spotify tab, turn on Share tab audio, and click Share. Spotify’s own controls stay in its tab.
        </p>
        <p>
          Whether a tab’s sound can be captured depends on Chrome, the site, and your settings. If the shared tab is silent, Trip Speaker
          tells you instead of guessing.
        </p>
      </>
    ),
  },
  {
    id: 'echo',
    title: 'What if I hear an echo?',
    body: (
      <p>
        Open Hear an echo? on any laptop and play test clicks. If a laptop sounds behind the others, move its timing Earlier; if it
        sounds ahead, move it Later. Laptops a few metres apart will always differ a little, because sound takes time to travel.
      </p>
    ),
  },
  {
    id: 'connect',
    title: 'Why won’t a laptop connect?',
    body: (
      <p>
        Some hotel and campus networks stop devices from reaching each other. Try a phone hotspot or another Wi-Fi network. Trip Speaker
        also needs the internet for a moment to introduce laptops, and every laptop should stay open and awake.
      </p>
    ),
  },
];
