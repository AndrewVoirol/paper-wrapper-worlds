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
  skyZenithRGB: [number, number, number];
  skyHorizonRGB: [number, number, number];
}

export interface SimulationParams {
  presetId: CameraPreset['id'];
  paletteId: PaperPalettePreset['id'];
  revealMode: 'interactive-wash' | 'full-diorama';
  paperTooth: number;        // 0.0 to 1.0 (Washi bast fiber & cold-press valley granulation)
  watercolorBleed: number;   // 0.0 to 1.0 (Fuchidori edge pinning & wash feathering)
  pondRippleStrength: number;// 0.0 to 1.0 (capillary wave shear & droplet ripple amplitude)
  shingleRoughness: number;  // 0.0 to 1.0 (crease ridge catchlight & tucked overlap shadow)
  windBreeze: number;        // 0.0 to 1.0 (pleated bough sway & guardian breathing)
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'pond-mirror',
    label: 'Pond Mirror',
    subtitle: 'Hero composition — crouching shingle-paper guardian, airy autumn woodland & clear inverted pond reflection',
    position: [0.04, 1.88, 9.65],
    target: [0.02, 0.12, 0.32],
    fov: 40,
  },
  {
    id: 'guardian-portrait',
    label: 'Origami & Face Study',
    subtitle: 'Close study of V-brow visor, pointed wedge nose, radial cedar ruff & vertical shingle courses',
    position: [0.92, 1.48, 3.55],
    target: [-0.02, 0.86, -0.26],
    fov: 35,
  },
  {
    id: 'shoreline-macro',
    label: 'Waterline & Fingers',
    subtitle: 'Grazing view across splayed shoreline fingers, central stone, Fuchidori rings & guardian mirror',
    position: [-1.72, 1.12, 5.25],
    target: [0.02, 0.08, 0.42],
    fov: 37,
  },
  {
    id: 'canopy-overlook',
    label: 'Woodland Cove',
    subtitle: 'Wide watercolor vignette — airy woodland trunks, translucent washes, pond puddle & Washi margins',
    position: [0.32, 2.78, 12.15],
    target: [0.06, 0.28, 0.16],
    fov: 40,
  },
];

export const PALETTE_PRESETS: PaperPalettePreset[] = [
  {
    id: 'autumn-tannin',
    label: 'Autumn Tannin',
    subtitle: 'Silver-driftwood Washi, russet-cedar ruff, airy ochre-olive washes & olive-amber pond mirror',
    paperBgHex: '#f2ebd9',
    paperBackingRGB: [0.949, 0.922, 0.851],
    shingleWeatherRGB: [0.64, 0.62, 0.57],
    collarWarmCedarRGB: [0.54, 0.38, 0.26],
    pondDeepMossRGB: [0.22, 0.26, 0.13],
    pondAmberTanninRGB: [0.45, 0.36, 0.18],
    canopyOliveRGB: [0.33, 0.39, 0.23],
    leafLitterRGB: [0.49, 0.36, 0.25],
    skyZenithRGB: [0.55, 0.65, 0.73],
    skyHorizonRGB: [0.89, 0.80, 0.62],
  },
  {
    id: 'sumi-celadon',
    label: 'Bokusai Celadon',
    subtitle: 'Aged hinoki paper, pine-soot crease shadows, mineral celadon sky mist & malachite-olive water',
    paperBgHex: '#efe8d5',
    paperBackingRGB: [0.937, 0.910, 0.835],
    shingleWeatherRGB: [0.61, 0.62, 0.58],
    collarWarmCedarRGB: [0.48, 0.38, 0.30],
    pondDeepMossRGB: [0.17, 0.26, 0.21],
    pondAmberTanninRGB: [0.30, 0.39, 0.30],
    canopyOliveRGB: [0.29, 0.40, 0.32],
    leafLitterRGB: [0.45, 0.37, 0.29],
    skyZenithRGB: [0.46, 0.58, 0.65],
    skyHorizonRGB: [0.79, 0.77, 0.64],
  },
  {
    id: 'golden-ochre',
    label: 'Late Sun Ochre',
    subtitle: 'Sun-bleached kozo Washi, warm sienna bank, low afternoon clearing sun & amber-olive mirror',
    paperBgHex: '#f5eedc',
    paperBackingRGB: [0.961, 0.933, 0.863],
    shingleWeatherRGB: [0.68, 0.64, 0.58],
    collarWarmCedarRGB: [0.59, 0.41, 0.27],
    pondDeepMossRGB: [0.25, 0.27, 0.14],
    pondAmberTanninRGB: [0.52, 0.40, 0.19],
    canopyOliveRGB: [0.39, 0.43, 0.25],
    leafLitterRGB: [0.55, 0.39, 0.26],
    skyZenithRGB: [0.55, 0.63, 0.71],
    skyHorizonRGB: [0.91, 0.75, 0.52],
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
