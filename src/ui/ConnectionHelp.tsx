import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { classifyFailure, describeReport, reportText, type ConnectionReport } from '../net/diagnose';

const LOCAL_NETWORK_TIP =
  'On each Mac, open System Settings → Privacy & Security → Local Network and make sure Google Chrome is switched on. Then reload Trip Speaker on both laptops.';

const TIPS: Record<ReturnType<typeof classifyFailure>, string[]> = {
  'host-silent': [
    'Make sure the host’s laptop is awake, with Trip Speaker open and the room still running.',
    'Check the code. It changes every time a room starts.',
    'Both laptops need the same Trip Speaker address.',
  ],
  'no-local-path': [
    'This laptop couldn’t reach the internet test server. Check it’s online and not stuck on a Wi-Fi sign-in page.',
    'Turn off any VPN or firewall app, then try again.',
    LOCAL_NETWORK_TIP,
  ],
  unreachable: [
    LOCAL_NETWORK_TIP,
    'Turn off any VPN on both laptops.',
    'Guest, hotel, and office Wi-Fi often stops laptops from reaching each other. Try a phone hotspot or a home network.',
  ],
};

export function ConnectionHelp({ report }: { report: ConnectionReport }) {
  const [copied, setCopied] = useState(false);
  const kind = classifyFailure(report);
  const tips = [...TIPS[kind]];
  if (kind === 'unreachable' && !report.relayConfigured) {
    tips.push('Networks like that need a relay server. Whoever deployed Trip Speaker can add one (README → Relay for restrictive networks).');
  }
  return (
    <details className="conn-help" data-testid="connection-help" data-kind={kind} open>
      <summary>
        What to try
        <ChevronDown aria-hidden="true" />
      </summary>
      <ol className="conn-tips">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <details className="conn-facts">
        <summary>
          Technical details
          <ChevronDown aria-hidden="true" />
        </summary>
        <ul>
          {describeReport(report).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => {
            void navigator.clipboard?.writeText(reportText(report)).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </details>
    </details>
  );
}
