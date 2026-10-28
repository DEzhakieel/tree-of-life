import { Component, type ReactNode, useEffect, useState } from 'react';
import { SceneView } from './components/SceneView.js';
import { TopBar } from './components/TopBar.js';
import { Toolbar } from './components/Toolbar.js';
import { LineagePanel } from './components/LineagePanel.js';
import { AgentInspector } from './components/AgentInspector.js';
import { TerminalDock } from './terminal/TerminalDock.js';
import { LEFT_DOCK, RIGHT_DOCK } from './components/docks.js';
import { startSession, destroySession } from './net/session.js';
import { useStore } from './store/useStore.js';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#f87171', padding: 24, fontFamily: 'monospace', fontSize: 13, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          <h2 style={{ color: '#f87171', marginBottom: 8 }}>Render Error</h2>
          <div style={{ marginBottom: 16 }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#f8717133',
              color: '#f87171',
              border: '1px solid #f8717166',
              padding: '6px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const workerError = useStore((s) => s.workerError);

  useEffect(() => {
    void (async () => {
      try {
        const world = await startSession({ mode: 'local' });
        useStore.getState().setWorld(world);
        useStore.getState().setConnected(true);
      } catch (err: any) {
        console.error('failed to auto-start local world', err);
        setBootError(err?.message ?? String(err));
      }
    })();
    return () => destroySession();
  }, []);

  if (bootError) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#fbbf24', padding: 24, fontFamily: 'monospace', fontSize: 13, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
        <h2 style={{ color: '#fbbf24', marginBottom: 8 }}>Boot Error (worker failed to start)</h2>
        <div style={{ marginBottom: 16 }}>{bootError}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: '#fbbf2433',
            color: '#fbbf24',
            border: '1px solid #fbbf2466',
            padding: '6px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (workerError) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#111', color: '#f87171', padding: 24, fontFamily: 'monospace', fontSize: 13, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
        <h2 style={{ color: '#f87171', marginBottom: 8 }}>Worker Error (simulation crashed)</h2>
        <div style={{ marginBottom: 16 }}>{workerError}</div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: '#f8717133',
            color: '#f87171',
            border: '1px solid #f8717166',
            padding: '6px 12px',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="relative h-full w-full overflow-hidden bg-[#03040c] text-zinc-100">
      <SceneView />
      <TopBar />
      <div className="pointer-events-auto absolute left-3 top-14 z-20 flex max-h-[calc(100vh-7.5rem)] w-56 flex-col gap-2 overflow-y-auto overscroll-contain pb-24">
        {/* selection-driven instruments stay pinned while the rail scrolls */}
        <div className="sticky top-0 z-10 flex flex-col gap-2">
          <AgentInspector />
          <LineagePanel />
        </div>
        {LEFT_DOCK.map(({ id, Component }) => (
          <Component key={id} id={id} />
        ))}
      </div>
      <div className="pointer-events-auto absolute right-3 top-14 z-20 flex max-h-[calc(100vh-7.5rem)] w-64 flex-col gap-2 overflow-y-auto overscroll-contain pb-24">
        {RIGHT_DOCK.map(({ id, Component }) => (
          <Component key={id} id={id} />
        ))}
      </div>
      <Toolbar />
      <TerminalDock />
    </div>
    </ErrorBoundary>
  );
}
