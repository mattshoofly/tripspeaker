import { useState } from 'react';
import { loadPrefs, savePrefs, type VisualizerMode } from '../../../session/prefs';
import { useReducedMotion } from '../../motion/useReducedMotion';

/** Visualizer preference; reduced motion turns the default live view calm. */
export function useVisualizer(): [VisualizerMode, (m: VisualizerMode) => void] {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<VisualizerMode>(() => loadPrefs().visualizer);
  const effective: VisualizerMode = reduced && mode === 'live' ? 'calm' : mode;
  return [
    effective,
    (m) => {
      setMode(m);
      savePrefs({ visualizer: m });
    },
  ];
}
