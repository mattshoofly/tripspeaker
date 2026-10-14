/**
 * Keeps the screen awake while a room is open, where the browser allows it.
 * This does not keep audio alive if a lid is closed or the Mac sleeps.
 */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async acquire(): Promise<void> {
    if (!this.supported) return;
    if (!this.wanted) document.addEventListener('visibilitychange', this.onVisibility);
    this.wanted = true;
    await this.request();
  }

  private async request(): Promise<void> {
    if (!this.wanted || this.active || document.visibilityState !== 'visible') return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        void sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      /* denied (battery saver, policy) — the app works without it */
    }
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.request();
  };

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) await s.release().catch(() => undefined);
  }
}
