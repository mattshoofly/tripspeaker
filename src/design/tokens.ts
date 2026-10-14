/**
 * Design tokens. src/styles/tokens.css mirrors these values; the contrast
 * test checks both the pairs below and that the CSS has not drifted.
 */
export const color = {
  bg: '#11130F',
  surface: '#1A1D17',
  surfaceHover: '#24281F',
  inset: '#0D0F0B',
  text: '#F3F3E9',
  text2: '#B4B9AB',
  text3: '#8E9486',
  accent: '#D5F86F',
  accentHover: '#E0FB8C',
  accentPressed: '#C4E85A',
  onAccent: '#11130F',
  alert: '#F2A68E',
} as const;

/** Alpha of warm white used for lines over the dark surfaces. */
export const lineAlpha = {
  hairline: 0.1,
  line: 0.18,
  /** Boundaries that identify a control on their own (inputs, slots) need 3:1. */
  control: 0.4,
} as const;

export type ContrastPair = { fg: keyof typeof color; bg: keyof typeof color; min: number; use: string };

export const contrastPairs: ContrastPair[] = [
  { fg: 'text', bg: 'bg', min: 7, use: 'Primary text' },
  { fg: 'text', bg: 'surface', min: 7, use: 'Primary text on surfaces' },
  { fg: 'text', bg: 'surfaceHover', min: 7, use: 'Primary text on hover' },
  { fg: 'text2', bg: 'bg', min: 4.5, use: 'Secondary text' },
  { fg: 'text2', bg: 'surface', min: 4.5, use: 'Secondary text on surfaces' },
  { fg: 'text2', bg: 'surfaceHover', min: 4.5, use: 'Secondary text on hover' },
  { fg: 'text3', bg: 'bg', min: 4.5, use: 'Tertiary labels' },
  { fg: 'text3', bg: 'surface', min: 4.5, use: 'Tertiary labels on surfaces' },
  { fg: 'text3', bg: 'surfaceHover', min: 4.5, use: 'Tertiary labels on hover' },
  { fg: 'text', bg: 'inset', min: 7, use: 'Room code digits' },
  { fg: 'accent', bg: 'bg', min: 4.5, use: 'Lime status text' },
  { fg: 'accent', bg: 'surface', min: 4.5, use: 'Lime status text on surfaces' },
  { fg: 'onAccent', bg: 'accent', min: 7, use: 'Dark text on filled lime buttons' },
  { fg: 'onAccent', bg: 'accentHover', min: 7, use: 'Lime button hover' },
  { fg: 'onAccent', bg: 'accentPressed', min: 7, use: 'Lime button pressed' },
  { fg: 'alert', bg: 'bg', min: 4.5, use: 'Alert text' },
  { fg: 'alert', bg: 'surface', min: 4.5, use: 'Alert text on surfaces' },
  { fg: 'onAccent', bg: 'alert', min: 7, use: 'Dark text on the End room confirm button' },
];
