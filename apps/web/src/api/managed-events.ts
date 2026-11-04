import { AdminAccessError, type AccessController, type AccessDependencies } from '../access/session-controller.ts';

export type ManagedTransportState = 'open' | 'checking' | 'reconnecting' | 'paused' | 'closed';
export interface ManagedEventSubscription { close(): void; reconnect(): void }
export interface ManagedEventsOptions {
  url: () => string; onMessage: (event: MessageEvent<string>) => void;
  onState?: (state: ManagedTransportState) => void; onError?: (event: Event) => void; onLocalClosed?: () => void;
}
export function createManagedEvents(deps: { controller: AccessController; createNative: (url: string) => EventSource; schedule: AccessDependencies['schedule'] }) {
  return (options: ManagedEventsOptions): ManagedEventSubscription => {
    const initial = deps.controller.getContext();
    if (!initial) throw new AdminAccessError('session_unconfirmed');
    const mode = initial.mode;
    const scope = initial.resources; let native: EventSource | null = null;
    let stopped = false; let checking = false; let waitingForAuth = false; let retries = 0;
    let cancelRetry = () => {}; let unsubscribe = () => {}; let unregister = () => {};
    const setState = (state: ManagedTransportState) => options.onState?.(state);
    const usable = () => !stopped && !scope.closed && deps.controller.getContext()?.resources === scope;
    const detach = () => { cancelRetry(); cancelRetry = () => {}; if (native) { const old = native; native = null; old.onopen = old.onmessage = old.onerror = null; old.close(); } };
    const close = () => { if (stopped) return; stopped = true; detach(); unsubscribe(); unregister(); setState('closed'); };
    const retry = () => {
      if (!usable()) return;
      if (retries >= 4) { setState('paused'); return; }
      const ms = 1000 * 2 ** retries++; setState('reconnecting');
      cancelRetry = deps.schedule(() => { cancelRetry = () => {}; if (usable()) connect(); }, ms);
    };
    async function failed(source: EventSource, event: Event) {
      if (stopped || native !== source || checking) return;
      if (mode === 'local') {
        options.onError?.(event);
        if (source.readyState === 2) { close(); options.onLocalClosed?.(); }
        else setState('reconnecting');
        return;
      }
      checking = true; detach(); setState('checking');
      await deps.controller.revalidate('stream-error');
      checking = false; if (stopped || scope.closed) return;
      if (!usable()) { waitingForAuth = true; setState('paused'); return; }
      options.onError?.(event); if (!stopped) retry();
    }
    function connect() {
      if (!usable()) return;
      detach(); setState('reconnecting');
      const source = deps.createNative(options.url()); native = source;
      source.onopen = () => { if (native === source && usable()) setState('open'); };
      source.onmessage = event => { if (native !== source || !usable()) return; retries = 0; options.onMessage(event); };
      source.onerror = event => { void failed(source, event); };
    }
    unsubscribe = deps.controller.subscribe(() => {
      if (stopped || checking) return;
      if (scope.closed) { close(); return; }
      if (!usable()) { detach(); waitingForAuth = true; setState('paused'); }
      else if (waitingForAuth) { waitingForAuth = false; retries = 0; retry(); }
    });
    unregister = scope.track(close); connect();
    return { close, reconnect() { if (!usable() || checking) return; retries = 0; waitingForAuth = false; connect(); } };
  };
}
let productionOpen: ReturnType<typeof createManagedEvents> | undefined;
export function openManagedEvents(options: ManagedEventsOptions): ManagedEventSubscription {
  let subscription: ManagedEventSubscription | undefined; let closed = false;
  void import('../access/runtime').then(({ accessController }) => {
    if (closed) return;
    productionOpen ??= createManagedEvents({ controller: accessController, createNative: url => new EventSource(url), schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } });
    subscription = productionOpen(options);
  }).catch(() => { if (!closed) options.onState?.('paused'); });
  return { close() { closed = true; subscription?.close(); }, reconnect() { if (!closed) subscription?.reconnect(); } };
}
