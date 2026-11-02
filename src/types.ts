import * as THREE from 'three/webgpu';

export interface CameraPreset {
  id: 'pond-mirror' | 'guardian-portrait' | 'canopy-overlook' | 'shoreline-macro';
  label: string;
  subtitle: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface PaperPalettePreset {
  id: 'autumn-tannin' | 'sumi-celadon' | 'golden-ochre';
  label: string;
  subtitle: string;
  paperBgHex: string;
  paperBackingRGB: [number, number, number];
  shingleWeatherRGB: [number, number, number];
  collarWarmCedarRGB: [number, number, number];
  pondDeepMossRGB: [number, number, number];
  pondAmberTanninRGB: [number, number, number];
  canopyOliveRGB: [number, number, number];
  leafLitterRGB: [number, number, number];
}

export interface SimulationParams {
  presetId: CameraPreset['id'];
  paletteId: PaperPalettePreset['id'];
  revealMode: 'interactive-wash' | 'full-diorama';
  paperTooth: number;        // 0.0 to 1.0 (cold-press texture depth & fiber grain)
  watercolorBleed: number;   // 0.0 to 1.0 (Fuchidori edge pinning & wash feathering)
  pondRippleStrength: number;// 0.0 to 1.0 (reflection distortion & capillary wave amplitude)
  shingleRoughness: number;  // 0.0 to 1.0 (deckle crease shadow & wood-grain contrast)
  windBreeze: number;        // 0.0 to 1.0 (gentle sway of forest branches & guardian breathing)
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'pond-mirror',
    label: 'Pond Mirror',
    subtitle: 'Wide-angle cove framing — crouching paper guardian, crimson maple & pond reflection',
    position: [0.0, 2.45, 10.6],
    target: [0.0, -0.35, 0.0],
    fov: 40,
  },
  {
    id: 'guardian-portrait',
    label: 'Paper Cut Study',
    subtitle: 'Macro study of creased paper shingles, deckle edges, V-brow & russet collar',
    position: [1.55, 2.05, 4.8],
    target: [0.0, 1.08, -0.65],
    fov: 34,
  },
  {
    id: 'shoreline-macro',
    label: 'Waterline Glaze',
    subtitle: 'Low grazing view across splayed paper fingers, cairn stones & Kubelka-Munk ripples',
    position: [-2.35, 0.92, 5.4],
    target: [0.15, 0.25, -0.35],
    fov: 36,
  },
  {
    id: 'canopy-overlook',
    label: 'Wide Cove Panorama',
    subtitle: 'Wide-angle diorama view showing the crimson maple, right cove trailhead & island',
    position: [0.35, 3.15, 13.2],
    target: [0.1, 0.15, -0.2],
    fov: 42,
  },
];

export const PALETTE_PRESETS: PaperPalettePreset[] = [
  {
    id: 'autumn-tannin',
    label: 'Autumn Tannin',
    subtitle: 'Weathered silver-grey cedar, warm russet collar & olive-amber pond glaze',
    paperBgHex: '#f2ebd9',
    paperBackingRGB: [0.949, 0.922, 0.851],
    shingleWeatherRGB: [0.68, 0.66, 0.61],
    collarWarmCedarRGB: [0.58, 0.43, 0.31],
    pondDeepMossRGB: [0.22, 0.24, 0.12],
    pondAmberTanninRGB: [0.44, 0.35, 0.16],
    canopyOliveRGB: [0.39, 0.44, 0.28],
    leafLitterRGB: [0.52, 0.37, 0.26],
  },
  {
    id: 'sumi-celadon',
    label: 'Bokusai Celadon',
    subtitle: 'Aged hinoki wood, pine-soot ink shadows & mineral malachite-indigo water',
    paperBgHex: '#efe8d5',
    paperBackingRGB: [0.937, 0.910, 0.835],
    shingleWeatherRGB: [0.64, 0.65, 0.62],
    collarWarmCedarRGB: [0.51, 0.41, 0.33],
    pondDeepMossRGB: [0.15, 0.25, 0.22],
    pondAmberTanninRGB: [0.28, 0.39, 0.32],
    canopyOliveRGB: [0.33, 0.45, 0.36],
    leafLitterRGB: [0.47, 0.38, 0.30],
  },
  {
    id: 'golden-ochre',
    label: 'Late Sun Ochre',
    subtitle: 'Sun-bleached driftwood shingles, burnt sienna bank & golden-hour reflection',
    paperBgHex: '#f5eedc',
    paperBackingRGB: [0.961, 0.933, 0.863],
    shingleWeatherRGB: [0.73, 0.69, 0.62],
    collarWarmCedarRGB: [0.64, 0.45, 0.29],
    pondDeepMossRGB: [0.26, 0.25, 0.13],
    pondAmberTanninRGB: [0.55, 0.41, 0.18],
    canopyOliveRGB: [0.46, 0.47, 0.27],
    leafLitterRGB: [0.59, 0.41, 0.27],
  },
];

export const DEFAULT_PARAMS: SimulationParams = {
  presetId: 'pond-mirror',
  paletteId: 'autumn-tannin',
  revealMode: 'interactive-wash',
  paperTooth: 0.68,
  watercolorBleed: 0.74,
  pondRippleStrength: 0.58,
  shingleRoughness: 0.72,
  windBreeze: 0.45,
};

export interface RippleImpulse {
  x: number;
  z: number;
  birthTime: number;
  strength: number;
}

export interface TelemetryState {
  fps: number;
  frameMs: number;
  shingleCount: number;
  activeRipples: number;
  revealCoverage: number;
  backend: string;
}
