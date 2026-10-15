import { useEffect, useRef, useState } from 'react';
import { WorldRenderer } from '../render/worldRenderer.js';
import { Canvas2DRenderer } from '../render/canvas2dRenderer.js';
import { agents, intervene, requestAgentSummaries } from '../net/session.js';
import { useStore } from '../store/useStore.js';
import { AgentInspector } from './AgentInspector.js';
import { SpawnDesigner } from './SpawnDesigner.js';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

/** Pick an agent → open the genome inspector, fetching its genome on demand. */
function handlePick(agentId: number): void {
  const st = useStore.getState();
  st.setSelectedAgentId(agentId);
  if (!st.agentsMeta.has(agentId)) requestAgentSummaries();
}

export function SceneView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WorldRenderer | Canvas2DRenderer | null>(null);
  const showMinimap = useStore((s) => s.showMinimap);
  const connected = useStore((s) => s.connected);
  const [renderMode, setRenderMode] = useState<'loading' | '2d' | 'webgl'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = minimapRef.current;
    if (!canvas || !minimap) return;

    if (!hasWebGL()) {
      setRenderMode('2d');
      const r = new Canvas2DRenderer({
        canvas,
        minimapCanvas: minimap,
        agents,
        onPaint: (iv) => intervene(iv),
        onPick: handlePick,
        onZoomChange: (z) => useStore.getState().setCameraZoom(z),
      });
      rendererRef.current = r;
      return () => { r.destroy(); rendererRef.current = null; };
    }

    try {
      const r = new WorldRenderer({
        canvas,
        minimapCanvas: minimap,
        agents,
        onPaint: (iv) => intervene(iv),
        onPick: handlePick,
        onZoomChange: (z) => useStore.getState().setCameraZoom(z),
      });
      rendererRef.current = r;
      setRenderMode('webgl');
      return () => { r.destroy(); rendererRef.current = null; };
    } catch (err) {
      console.warn('WebGL renderer failed, falling back to 2D canvas', err);
      setRenderMode('2d');
      const newCanvas = document.createElement('canvas');
      canvas.parentElement?.insertBefore(newCanvas, canvas);
      newCanvas.className = canvas.className;
      newCanvas.style.cssText = canvas.style.cssText;
      canvas.remove();
      const r = new Canvas2DRenderer({
        canvas: newCanvas,
        minimapCanvas: minimap,
        agents,
        onPaint: (iv) => intervene(iv),
        onPick: handlePick,
        onZoomChange: (z) => useStore.getState().setCameraZoom(z),
      });
      rendererRef.current = r;
      return () => { r.destroy(); rendererRef.current = null; };
    }
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full cursor-crosshair" />
      {renderMode === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#03040c]">
          <div className="text-center">
            <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            <div className="text-sm text-zinc-400">Starting simulation...</div>
          </div>
        </div>
      )}
      {renderMode === '2d' && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
          2D mode (no WebGL)
        </div>
      )}
      {!connected && renderMode !== 'loading' && (
        <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400">
          Disconnected — worker may have crashed
        </div>
      )}
      <div
        className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-white/10 bg-black/50 p-1 shadow-lg"
        style={{ display: showMinimap ? 'block' : 'none' }}
      >
        <canvas ref={minimapRef} />
      </div>
      <AgentInspector />
      <SpawnDesigner />
    </div>
  );
}
