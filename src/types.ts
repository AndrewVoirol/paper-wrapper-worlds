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
    label: 'Holly Pond Mirror',
    subtitle: 'Hero composition — Little Nis crouching at the edge of Holly Pond above his clear inverted reflection',
    position: [0.04, 1.88, 9.65],
    target: [0.02, 0.12, 0.32],
    fov: 40,
  },
  {
    id: 'guardian-portrait',
    label: 'Little Nis Portrait',
    subtitle: 'Close study of Little Nis’s furrowed brow, wedge nose, russet collar & reclaimed plank courses',
    position: [0.92, 1.48, 3.55],
    target: [-0.02, 0.86, -0.26],
    fov: 35,
  },
  {
    id: 'shoreline-macro',
    label: 'Holly Pond Bank & Hands',
    subtitle: 'Grazing view across Little Nis’s splayed wooden hands on the mossy Holly Pond bank',
    position: [-1.72, 1.12, 5.25],
    target: [0.02, 0.08, 0.42],
    fov: 37,
  },
  {
    id: 'canopy-overlook',
    label: 'Bernheim Trail Clearing',
    subtitle: 'Wide Bernheim Arboretum clearing — autumn trees, translucent washes, Holly Pond & Washi margins',
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

export interface StoryPlate {
  id: 'prologue' | 'plate-1' | 'plate-2' | 'plate-3' | 'plate-4';
  numeral: '0' | 'I' | 'II' | 'III' | 'IV';
  folioLabel: string;
  shortStopLabel: string;
  plateCounter?: string;
  runningCaption: string;
  title: string;
  subtitle?: string;
  body: string;
  whisperCue: string;
  presetId: CameraPreset['id'];
  /** Normalized camera viewOffset [x, y] on wide viewports (>= 920px). Negative x shifts 3D subject right. */
  desktopOffset: [number, number];
  /** Normalized camera viewOffset [x, y] on compact viewports (< 920px). Positive y shifts 3D subject upward. */
  mobileOffset: [number, number];
}

export const STORY_PLATES: StoryPlate[] = [
  {
    id: 'prologue',
    numeral: '0',
    folioLabel: 'Trailhead',
    shortStopLabel: 'Holly Pond',
    runningCaption: 'HOLLY POND · BERNHEIM FOREST',
    title: 'Little Nis',
    subtitle: 'Forest Giants in a Giant Forest · Clermont, Kentucky',
    body: 'At the edge of Holly Pond in Kentucky’s Bernheim Forest, the youngest of three wooden giants crouches on the mossy bank—peering into the still water at a face that looks both familiar and strange.',
    whisperCue: 'Scroll to walk the trail · sweep the paper to wake the wash · touch Holly Pond',
    presetId: 'pond-mirror',
    desktopOffset: [-0.112, 0.01],
    mobileOffset: [0.0, 0.11],
  },
  {
    id: 'plate-1',
    numeral: 'I',
    folioLabel: 'Plate I · The Arboretum',
    shortStopLabel: 'Bernheim Trail',
    plateCounter: '01 / 04',
    runningCaption: 'PLATE I · BERNHEIM FOREST',
    title: 'While the Weather Got Better',
    body: 'In Thomas Dambo’s forest tale, Isak Heartstone walked down from his lonely mountain to winter among Kentucky’s trees with Mama Loumari and their children, Little Elina and Little Nis. While his mother rests against a tree and his sister gathers stones, Nis slipped down the trail to this quiet pond.',
    whisperCue: 'Sweep across the raw paper margin to bloom autumn wash along the trail.',
    presetId: 'canopy-overlook',
    desktopOffset: [-0.115, 0.01],
    mobileOffset: [0.0, 0.11],
  },
  {
    id: 'plate-2',
    numeral: 'II',
    folioLabel: 'Plate II · Salvaged Timber',
    shortStopLabel: 'Forgotten Wood',
    plateCounter: '02 / 04',
    runningCaption: 'PLATE II · SALVAGED TIMBER',
    title: 'Pieced from Forgotten Wood',
    body: 'Built in the spring of 2019 for Bernheim’s ninetieth year, Little Nis was raised from discarded pallets and regional scrap lumber given a second life in the woods. Beneath a fanned russet collar and creased brow, his weathered ribs rise and fall with the hush of the clearing.',
    whisperCue: 'Drag anywhere on the diorama to turn Little Nis in the clearing light.',
    presetId: 'guardian-portrait',
    desktopOffset: [-0.125, 0.0],
    mobileOffset: [0.0, 0.12],
  },
  {
    id: 'plate-3',
    numeral: 'III',
    folioLabel: 'Plate III · Holly Pond Bank',
    shortStopLabel: 'Mossy Bank',
    plateCounter: '03 / 04',
    runningCaption: 'PLATE III · HOLLY POND BANK',
    title: 'Hands on the Mossy Bank',
    body: 'Ten wide wooden planks steady his crouch where the trail meets Holly Pond. Out in the real arboretum, visitors step onto his big wooden hands and feet to share his lookout—right where rough timber meets the dark ring of leaf-stained water.',
    whisperCue: 'Click or sweep across Holly Pond to send ripples out from his fingertips.',
    presetId: 'shoreline-macro',
    desktopOffset: [-0.115, 0.0],
    mobileOffset: [0.0, 0.11],
  },
  {
    id: 'plate-4',
    numeral: 'IV',
    folioLabel: 'Plate IV · The Water Mirror',
    shortStopLabel: 'Water Mirror',
    plateCounter: '04 / 04',
    runningCaption: 'PLATE IV · THE WATER MIRROR',
    title: 'Familiar, Yet So Strange',
    body: 'Walking out from the trees, Little Nis saw something in the water that looked “so familiar, yet so strange.” Beneath the drifting autumn leaves, a second boy of weathered planks hangs upside-down in olive and amber water—scattering into rings when a drop falls, then gathering himself whole again.',
    whisperCue: 'Linger by the pond to orbit freely, or revisit any stop along the trail.',
    presetId: 'pond-mirror',
    desktopOffset: [-0.095, 0.01],
    mobileOffset: [0.0, 0.11],
  },
];
