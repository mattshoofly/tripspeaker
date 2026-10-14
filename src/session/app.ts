import { parseInviteCode } from '../core/roomCode';
import { GuestController, type JoinResult } from './guest';
import { HostController } from './host';
import { Store } from './store';

export type AppView =
  | { screen: 'home'; inviteCode: string | null; visit: number }
  | { screen: 'host'; host: HostController }
  | { screen: 'guest'; guest: GuestController };

let visit = 0;

export const app = new Store<AppView>({
  screen: 'home',
  inviteCode: typeof location !== 'undefined' ? parseInviteCode(location.search) : null,
  visit,
});

let pendingGuest: GuestController | null = null;

/** Synchronous so the AudioContext is created inside the click's user activation. */
export function startRoom(name?: string): HostController {
  const current = app.get();
  if (current.screen === 'host' && !current.host.isDisposed) return current.host;
  const host = HostController.start(name);
  app.set({ screen: 'host', host });
  return host;
}

export async function joinRoom(code: string, name: string): Promise<JoinResult> {
  if (pendingGuest) void pendingGuest.dispose();
  const { controller, ready } = GuestController.join(code, name);
  pendingGuest = controller;
  const result = await ready;
  if (pendingGuest !== controller) {
    void controller.dispose();
    return { ok: false, error: 'signaling' };
  }
  pendingGuest = null;
  if (!result.ok) {
    void controller.dispose();
    return result;
  }
  app.set({ screen: 'guest', guest: controller });
  return result;
}

export function cancelJoin(): void {
  if (pendingGuest) void pendingGuest.dispose();
  pendingGuest = null;
}

export function goHome(): void {
  const current = app.get();
  if (current.screen === 'host' && !current.host.isDisposed) void current.host.end();
  if (current.screen === 'guest' && !current.guest.isDisposed) void current.guest.dispose();
  visit++;
  const url = new URL(location.href);
  const inviteCode = parseInviteCode(url.search);
  app.set({ screen: 'home', inviteCode: current.screen === 'guest' ? null : inviteCode, visit });
  if (current.screen === 'guest' && url.searchParams.has('room')) {
    url.searchParams.delete('room');
    history.replaceState(null, '', url.toString());
  }
}

declare global {
  interface Window {
    __tripSpeaker?: {
      view: () => AppView;
      snapshot: () => unknown;
      simulateDrop: () => void;
    };
  }
}

/** Read-only diagnostics used by the browser tests; nothing here is privileged. */
export function installDiagnosticsHook(): void {
  window.__tripSpeaker = {
    view: () => app.get(),
    snapshot: () => {
      const v = app.get();
      if (v.screen === 'host') return v.host.store.get();
      if (v.screen === 'guest') return v.guest.store.get();
      return null;
    },
    simulateDrop: () => {
      const v = app.get();
      if (v.screen === 'guest') v.guest.simulateDrop();
    },
  };
}
