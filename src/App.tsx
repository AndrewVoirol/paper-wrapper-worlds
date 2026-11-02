import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Droplets,
  Eye,
  Layers,
  Palette,
  RotateCcw,
  Sliders,
  Sparkles,
  Wind,
} from 'lucide-react';
import {
  CAMERA_PRESETS,
  DEFAULT_PARAMS,
  PALETTE_PRESETS,
  type CameraPreset,
  type PaperPalettePreset,
  type SimulationParams,
  type TelemetryState,
} from './types';
import { PaperWorldEngine } from './scene/PaperWorldEngine';
import './styles.css';

export function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PaperWorldEngine | null>(null);

  const [params, setParams] = useState<SimulationParams>(DEFAULT_PARAMS);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    fps: 60,
    frameMs: 8.2,
    shingleCount: 680,
    activeRipples: 2,
    revealCoverage: 78,
    backend: 'WebGPU (TSL)',
  });

  // Custom brush cursor ring tracking
  const cursorRingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const engine = new PaperWorldEngine(container, (stats) => {
      setTelemetry(stats);
    });
    engineRef.current = engine;
    engine.init();

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleParamChange = <K extends keyof SimulationParams>(
    key: K,
    value: SimulationParams[K]
  ) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      engineRef.current?.updateParams({ [key]: value });
      return next;
    });
  };

  const handleReset = () => {
    setParams(DEFAULT_PARAMS);
    engineRef.current?.updateParams(DEFAULT_PARAMS);
    engineRef.current?.setCameraPreset(DEFAULT_PARAMS.presetId, false);
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cursorRingRef.current) {
      cursorRingRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      cursorRingRef.current.style.opacity = '1';
    }
  };

  const handleViewportPointerLeave = () => {
    if (cursorRingRef.current) {
      cursorRingRef.current.style.opacity = '0';
    }
  };

  const activePalette =
    PALETTE_PRESETS.find((p) => p.id === params.paletteId) ?? PALETTE_PRESETS[0];

  return (
    <div
      className="paper-world-shell"
      style={{ '--paper-bg': activePalette.paperBgHex } as React.CSSProperties}
    >
      {/* Interactive 3D WebGPU Viewport */}
      <div
        ref={viewportRef}
        className="paper-world-viewport"
        onPointerMove={handleViewportPointerMove}
        onPointerLeave={handleViewportPointerLeave}
      />

      {/* Organic Watercolor Brush Ring Cursor (Matches Three.js reference video) */}
      <div ref={cursorRingRef} className="watercolor-brush-cursor" aria-hidden="true">
        <span className="watercolor-brush-dot" />
      </div>

      {/* Top-Left Archival Title Plate */}
      <header className="field-header-plate">
        <div className="field-seal-pill">
          <span className="label-jp">木彫と水彩</span>
          <span className="seal-divider">・</span>
          <span className="label-en">PAPER &amp; WATERCOLOR DIORAMA</span>
        </div>
        <h1 className="field-title">The Pond Guardian</h1>
        <p className="field-subtitle">
          Layered cedar-shingle paper sculpture &amp; Kubelka-Munk botanical pond reflection.
          Sweep to bloom pigment; drag to orbit; click the water to cast ripples.
        </p>
      </header>

      {/* Top-Right Studio Inspector Drawer Toggle & Telemetry Pill */}
      <div className="top-right-controls">
        <div className="telemetry-badge" title="Live WebGPU TSL Pipeline Telemetry">
          <span className="telemetry-dot" />
          <span>{telemetry.shingleCount} Shingles</span>
          <span className="telemetry-sep">·</span>
          <span>{telemetry.frameMs} ms</span>
        </div>

        <button
          type="button"
          className={`inspector-toggle-btn ${drawerOpen ? 'active' : ''}`}
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
        >
          <Sliders size={15} />
          <span className="label-en">Paper &amp; Glaze Studio</span>
        </button>
      </div>

      {/* Right-Hand Paper & Watercolor Studio Inspector */}
      {drawerOpen && (
        <aside className="studio-drawer" aria-label="Paper and Watercolor Shader Controls">
          <div className="drawer-section">
            <div className="section-header">
              <Palette size={14} />
              <span className="section-title">Pigment &amp; Washi Palette</span>
            </div>
            <div className="palette-grid">
              {PALETTE_PRESETS.map((pal: PaperPalettePreset) => {
                const isSelected = params.paletteId === pal.id;
                return (
                  <button
                    key={pal.id}
                    type="button"
                    className={`palette-card ${isSelected ? 'active' : ''}`}
                    onClick={() => handleParamChange('paletteId', pal.id)}
                  >
                    <div className="palette-swatches">
                      <span
                        className="swatch-chip"
                        style={{
                          backgroundColor: `rgb(${pal.shingleWeatherRGB.map((c) => Math.round(c * 255)).join(',')})`,
                        }}
                      />
                      <span
                        className="swatch-chip"
                        style={{
                          backgroundColor: `rgb(${pal.collarWarmCedarRGB.map((c) => Math.round(c * 255)).join(',')})`,
                        }}
                      />
                      <span
                        className="swatch-chip"
                        style={{
                          backgroundColor: `rgb(${pal.pondDeepMossRGB.map((c) => Math.round(c * 255)).join(',')})`,
                        }}
                      />
                      <span
                        className="swatch-chip"
                        style={{
                          backgroundColor: `rgb(${pal.pondAmberTanninRGB.map((c) => Math.round(c * 255)).join(',')})`,
                        }}
                      />
                    </div>
                    <span className="palette-name">{pal.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="drawer-section">
            <div className="section-header">
              <Eye size={14} />
              <span className="section-title">Diorama Wash Envelope</span>
            </div>
            <div className="mode-toggle-row">
              <button
                type="button"
                className={`mode-btn ${params.revealMode === 'interactive-wash' ? 'active' : ''}`}
                onClick={() => handleParamChange('revealMode', 'interactive-wash')}
              >
                <Sparkles size={13} />
                <span>Brush Wash Reveal</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${params.revealMode === 'full-diorama' ? 'active' : ''}`}
                onClick={() => handleParamChange('revealMode', 'full-diorama')}
              >
                <Layers size={13} />
                <span>Full Panorama</span>
              </button>
            </div>
          </div>

          <div className="drawer-section sliders-group">
            <label className="slider-row">
              <div className="slider-label-line">
                <span>Cold-Press Paper Tooth</span>
                <span className="slider-val">{Math.round(params.paperTooth * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.paperTooth}
                onChange={(e) => handleParamChange('paperTooth', parseFloat(e.target.value))}
              />
            </label>

            <label className="slider-row">
              <div className="slider-label-line">
                <span>Cedar Shingle Grain &amp; Fold</span>
                <span className="slider-val">{Math.round(params.shingleRoughness * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.shingleRoughness}
                onChange={(e) => handleParamChange('shingleRoughness', parseFloat(e.target.value))}
              />
            </label>

            <label className="slider-row">
              <div className="slider-label-line">
                <span>Watercolor Edge Bleed (Fuchidori)</span>
                <span className="slider-val">{Math.round(params.watercolorBleed * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.watercolorBleed}
                onChange={(e) => handleParamChange('watercolorBleed', parseFloat(e.target.value))}
              />
            </label>

            <label className="slider-row">
              <div className="slider-label-line">
                <span>Pond Ripple &amp; Mirror Warp</span>
                <span className="slider-val">{Math.round(params.pondRippleStrength * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.pondRippleStrength}
                onChange={(e) =>
                  handleParamChange('pondRippleStrength', parseFloat(e.target.value))
                }
              />
            </label>

            <label className="slider-row">
              <div className="slider-label-line">
                <span>Woodland Breeze &amp; Breathing</span>
                <span className="slider-val">{Math.round(params.windBreeze * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={params.windBreeze}
                onChange={(e) => handleParamChange('windBreeze', parseFloat(e.target.value))}
              />
            </label>
          </div>

          <div className="drawer-footer">
            <button
              type="button"
              className="action-btn"
              onClick={() => engineRef.current?.spawnPondRipple(0.0, 1.15, 0.95)}
            >
              <Droplets size={14} />
              <span>Cast Pond Droplet</span>
            </button>
            <button type="button" className="action-btn secondary" onClick={handleReset}>
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          </div>
        </aside>
      )}

      {/* Bottom Centered Camera Preset Dock */}
      <nav className="camera-preset-dock" aria-label="Camera Viewpoint Presets">
        {CAMERA_PRESETS.map((preset: CameraPreset) => {
          const isActive = params.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={`preset-pill-btn ${isActive ? 'active' : ''}`}
              onClick={() => handleParamChange('presetId', preset.id)}
              title={preset.subtitle}
            >
              <Camera size={13} />
              <span className="label-en">{preset.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
export default App;
