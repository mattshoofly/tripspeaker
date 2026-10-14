export function BrandSymbol({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="brand-symbol">
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.25 12c1.1 0 1.45-3.6 2.8-3.6s1.75 7.2 2.95 7.2 1.5-5.1 2.85-5.1 1.3 1.5 2.9 1.5"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <BrandSymbol />
      <span className="wordmark-text">Trip Speaker</span>
    </span>
  );
}
