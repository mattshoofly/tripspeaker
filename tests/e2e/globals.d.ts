export {};

declare global {
  interface Window {
    __tripSpeaker?: {
      screen: () => string;
      snapshot: () => unknown;
      probe: () => unknown;
      simulateDrop: () => void;
    };
    __tripSpeakerMotion?: { entrances: number };
  }
}
