import type { AgentEvent } from '@molio/contracts';
import { openManagedEvents, type ManagedEventSubscription, type ManagedTransportState } from './managed-events';
import { accessController } from '../access/runtime';
import { api } from './client';

interface SSEEnvelope { seq: number; runId: string; event: AgentEvent }
export function subscribeToRun(
  runId: string,
  onEvent: (event: AgentEvent, seq?: number) => void,
  onError?: (error: Event) => void,
  onDone?: () => void,
  afterSeq?: number,
  onKeepalive?: () => void,
  onTransportState?: (state: ManagedTransportState) => void,
): ManagedEventSubscription {
  let lastSeq = afterSeq ?? 0; let closed = false; let reconciling = false;
  const subscription = openManagedEvents({
    url: () => `/api/runs/${runId}/events${lastSeq > 0 ? `?after=${lastSeq}` : ''}`,
    onState: onTransportState,
    onMessage(msg) {
      if (closed) return;
      if (typeof window !== 'undefined' && (window as any).__MOLIO_DEBUG_SSE_OPEN_SILENT__ === true) return;
      if (msg.data === 'ping') { onKeepalive?.(); return; }
      try {
        const envelope: SSEEnvelope = JSON.parse(msg.data);
        if (envelope.seq <= lastSeq) return;
        lastSeq = envelope.seq;
        onEvent(envelope.event, envelope.seq);
      } catch { /* non-JSON keepalive */ }
    },
    onLocalClosed: onDone,
    onError(event) {
      onError?.(event);
      const context = accessController.getContext();
      if (!context || context.mode !== 'server' || reconciling || closed) return;
      reconciling = true;
      // EOF is not completion. Only an authoritative terminal run state can
      // finish an empty replay; a running/unknown run keeps its observation.
      void api.getRun(runId).then(run => {
        if (closed || accessController.getContext()?.resources !== context.resources) return;
        if (['succeeded', 'failed', 'canceled'].includes(run.status)) {
          closed = true; subscription.close(); onDone?.();
        }
      }).catch(() => {}).finally(() => { reconciling = false; });
    },
  });
  return { close() { closed = true; subscription.close(); }, reconnect() { if (!closed) subscription.reconnect(); } };
}
