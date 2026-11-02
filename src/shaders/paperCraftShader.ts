import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  vec2,
  vec3,
  float,
  sin,
  cos,
  dot,
  fract,
  floor,
  mix,
  clamp,
  smoothstep,
  sqrt,
  max,
  min,
  abs,
  pow,
  exp,
  length,
  positionLocal,
  positionWorld,
  normalWorld,
  attribute,
} from 'three/tsl';
import { DEFAULT_PARAMS, PALETTE_PRESETS, type PaperPalettePreset } from '../types';

/**
 * Shared uniform bundle for the entire Paper-Wrapper Worlds scene so all TSL materials
 * (shingle guardian, paper foliage, shoreline earth, and Kubelka-Munk watercolor pond)
 * respond instantaneously (< 0.05 ms) to parameter, palette, ripple, and brush updates
 * with zero pipeline recompilation.
 */
export class PaperSceneUniforms {
  public readonly uTime = uniform(0.0);
  public readonly uPaperTooth = uniform(DEFAULT_PARAMS.paperTooth);
  public readonly uWatercolorBleed = uniform(DEFAULT_PARAMS.watercolorBleed);
  public readonly uPondRippleStrength = uniform(DEFAULT_PARAMS.pondRippleStrength);
  public readonly uShingleRoughness = uniform(DEFAULT_PARAMS.shingleRoughness);
  public readonly uWindBreeze = uniform(DEFAULT_PARAMS.windBreeze);
  public readonly uRevealMode = uniform(0.0); // 0.0 = interactive wash reveal, 1.0 = full diorama

  // Interactive cursor / brush wash state in world XZ coordinates
  public readonly uCursorWorld = uniform(new THREE.Vector3(0.0, 0.5, 0.0));
  public readonly uBrushRadius = uniform(2.8);
  public readonly uBrushActive = uniform(0.0);

  // 4 persistent wash trail stamps (xy = world XZ, z = radius, w = strength)
  public readonly uWashTrail0 = uniform(new THREE.Vector4(-2.2, -0.4, 3.6, 1.0));
  public readonly uWashTrail1 = uniform(new THREE.Vector4(2.3, -0.3, 3.6, 0.95));
  public readonly uWashTrail2 = uniform(new THREE.Vector4(0.0, 1.8, 3.4, 0.92));
  public readonly uWashTrail3 = uniform(new THREE.Vector4(-3.4, 0.6, 3.1, 0.88));

  // 4 interactive pond droplet ripples (x = worldX, y = worldZ, z = birthTime, w = strength)
  public readonly uRipple0 = uniform(new THREE.Vector4(0.0, 1.2, -99.0, 0.0));
  public readonly uRipple1 = uniform(new THREE.Vector4(-1.1, 0.9, -99.0, 0.0));
  public readonly uRipple2 = uniform(new THREE.Vector4(1.1, 0.95, -99.0, 0.0));
  public readonly uRipple3 = uniform(new THREE.Vector4(0.0, 2.1, -99.0, 0.0));

  // Palette color uniforms (stored as THREE.Vector3 so TSL treats them as Node<"vec3">)
  public readonly uPaperBacking = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].paperBackingRGB));
  public readonly uShingleWeather = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].shingleWeatherRGB));
  public readonly uCollarWarmCedar = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].collarWarmCedarRGB));
  public readonly uPondDeepMoss = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].pondDeepMossRGB));
  public readonly uPondAmberTannin = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].pondAmberTanninRGB));
  public readonly uCanopyOlive = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].canopyOliveRGB));
  public readonly uLeafLitter = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].leafLitterRGB));

  public applyPalette(palette: PaperPalettePreset): void {
    this.uPaperBacking.value.set(...palette.paperBackingRGB);
    this.uShingleWeather.value.set(...palette.shingleWeatherRGB);
    this.uCollarWarmCedar.value.set(...palette.collarWarmCedarRGB);
    this.uPondDeepMoss.value.set(...palette.pondDeepMossRGB);
    this.uPondAmberTannin.value.set(...palette.pondAmberTanninRGB);
    this.uCanopyOlive.value.set(...palette.canopyOliveRGB);
    this.uLeafLitter.value.set(...palette.leafLitterRGB);
  }
}

/**
 * 2D hash & smooth value noise in TSL (uniform control flow, Apple Silicon fract-safe).
 */
export const hash21 = Fn(([p_in]: [any]) => {
  const p = vec2(p_in);
  const h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h).mul(43758.5453123).add(1.0));
});

export const noise2D = Fn(([p_in]: [any]) => {
  const p = vec2(p_in);
  const i = floor(p);
  const f = fract(p.add(1.0)).sub(floor(p.add(1.0)));
  const fRaw = p.sub(i);
  const u = fRaw.mul(fRaw).mul(float(3.0).sub(fRaw.mul(2.0)));

  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(f.x.mul(0.0).add(1.0));
});

/**
 * 3-octave irrational-angle rotated FBM for organic paper bast fibers & watercolor wash bleed.
 */
export const fbmPaper2D = Fn(([p_in]: [any]) => {
  const p0 = vec2(p_in);
  const n0 = noise2D(p0);

  const p1 = vec2(
    p0.x.mul(0.7986).sub(p0.y.mul(0.6018)),
    p0.x.mul(0.6018).add(p0.y.mul(0.7986))
  ).mul(2.07);
  const n1 = noise2D(p1);

  const p2 = vec2(
    p1.x.mul(0.7986).sub(p1.y.mul(0.6018)),
    p1.x.mul(0.6018).add(p1.y.mul(0.7986))
  ).mul(2.13);
  const n2 = noise2D(p2);

  return n0.mul(0.55).add(n1.mul(0.30)).add(n2.mul(0.15));
});

/**
 * Physical Kubelka-Munk 2-Flux Radiative Transfer Function in TSL.
 * Evaluates true film thickness `d` inside `coth(b * S * d)` against the warm Washi backing `Rg`.
 */
export const evalKubelkaMunk2Flux = Fn(
  ([Rg_in, Rinf_in, S_in, thickness_in]: [any, any, any, any]) => {
    const Rg = clamp(vec3(Rg_in), vec3(0.02), vec3(0.99));
    const Rinf = clamp(vec3(Rinf_in), vec3(0.03), vec3(0.96));
    const S = max(vec3(S_in), vec3(0.05));
    const d = max(float(thickness_in), float(0.0001));

    const oneMinusR = vec3(1.0).sub(Rinf);
    const kOverS = oneMinusR.mul(oneMinusR).div(Rinf.mul(2.0));
    const a = vec3(1.0).add(kOverS);
    const b = sqrt(max(a.mul(a).sub(vec3(1.0)), vec3(0.00001)));

    const u = b.mul(S).mul(d);
    const uClamped = clamp(u, vec3(0.001), vec3(12.0));
    const cothApprox = vec3(1.0)
      .div(uClamped)
      .add(uClamped.mul(0.333333))
      .sub(uClamped.mul(uClamped).mul(uClamped).mul(0.022222));
    const cothVal = mix(cothApprox, vec3(1.0), smoothstep(vec3(1.8), vec3(4.5), uClamped));

    const bCoth = b.mul(cothVal);
    const numer = vec3(1.0).sub(Rg.mul(a.sub(bCoth)));
    const denom = max(a.add(bCoth).sub(Rg), vec3(0.001));
    return clamp(numer.div(denom), vec3(0.0), vec3(1.0));
  }
);

/**
 * Evaluates the wide-angle diorama watercolor wash reveal mask across the 3D scene.
 * Scaled elliptically (`x * 0.62, z * 0.78`) to embrace the wider cove shoreline,
 * crimson maple grove on the left, and trailhead clearing on the right.
 */
export const evaluateDioramaWashReveal = Fn(([worldPos_in, uniforms]: [any, PaperSceneUniforms]) => {
  const wp = vec3(worldPos_in);
  const xz = vec2(wp.x, wp.z);

  const fbmEdge = fbmPaper2D(xz.mul(0.75)).sub(0.5).mul(1.45);
  const fbmFine = fbmPaper2D(xz.mul(3.2).add(vec2(7.1, 3.9))).sub(0.5).mul(0.48);
  const edgePerturb = fbmEdge.add(fbmFine).mul(uniforms.uWatercolorBleed.mul(0.85).add(0.35));

  // Wide elliptical island envelope matching the wide-angle photo composition
  const distIsland = length(xz.mul(vec2(0.62, 0.78)));
  const baseIslandMask = float(1.0).sub(smoothstep(float(2.95), float(5.15), distIsland.add(edgePerturb)));

  // Cursor live brush bloom + 4 persistent wash trail stamps
  const dCursor = length(xz.sub(vec2(uniforms.uCursorWorld.x, uniforms.uCursorWorld.z)));
  const cursorMask = float(1.0)
    .sub(smoothstep(uniforms.uBrushRadius.mul(0.35), uniforms.uBrushRadius, dCursor.add(edgePerturb.mul(0.55))))
    .mul(uniforms.uBrushActive);

  const d0 = length(xz.sub(uniforms.uWashTrail0.xy));
  const m0 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail0.z.mul(0.45), uniforms.uWashTrail0.z, d0.add(edgePerturb.mul(0.6))))
    .mul(uniforms.uWashTrail0.w);

  const d1 = length(xz.sub(uniforms.uWashTrail1.xy));
  const m1 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail1.z.mul(0.45), uniforms.uWashTrail1.z, d1.add(edgePerturb.mul(0.6))))
    .mul(uniforms.uWashTrail1.w);

  const d2 = length(xz.sub(uniforms.uWashTrail2.xy));
  const m2 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail2.z.mul(0.45), uniforms.uWashTrail2.z, d2.add(edgePerturb.mul(0.6))))
    .mul(uniforms.uWashTrail2.w);

  const d3 = length(xz.sub(uniforms.uWashTrail3.xy));
  const m3 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail3.z.mul(0.45), uniforms.uWashTrail3.z, d3.add(edgePerturb.mul(0.6))))
    .mul(uniforms.uWashTrail3.w);

  const interactiveEnvelope = max(max(baseIslandMask, cursorMask), max(max(m0, m1), max(m2, m3)));
  const fullEnvelope = float(1.0).sub(smoothstep(float(4.55), float(6.15), distIsland.add(edgePerturb.mul(0.75))));

  return clamp(mix(interactiveEnvelope, fullEnvelope, uniforms.uRevealMode), float(0.0), float(1.0));
});

/**
 * Builds a physical Creased & Curled Paper Strip BufferGeometry (`width = 1`, `length = 1`).
 * Instead of a solid brick/box, each piece is a thin layered paper cutout featuring:
 * - A central V-fold score ridge (`|x|`) so the left and right halves catch distinct lighting planes
 * - A gentle upward deckle curl at the bottom hanging edge (`y = -0.5`)
 * - Slight organic corner beveling and thin laminated cardstock thickness (`z`)
 */
export function createCreasedPaperStripGeometry(): THREE.BufferGeometry {
  const segX = 4; // [-0.5, -0.25, 0.0 (fold spine), +0.25, +0.5]
  const segY = 4; // [-0.5 (bottom deckle tip), -0.25, 0.0, +0.25, +0.5 (pinned top)]
  const geom = new THREE.BoxGeometry(1.0, 1.0, 0.22, segX, segY, 1);

  const pos = geom.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // v = 0 at top pinned root (y = +0.5), v = 1 at bottom hanging tip (y = -0.5)
    const v = 0.5 - y;
    const absX = Math.abs(x);

    // Taper width slightly toward the bottom tip like a hand-cut paper shake
    const tipTaper = 1.0 - Math.max(0, v - 0.65) * 0.28;
    x *= tipTaper;

    // Central origami V-fold ridge along x = 0 + upward paper curl at bottom tip (v -> 1)
    const centerCreaseZ = (0.5 - absX) * 0.28;
    const bottomCurlZ = Math.pow(Math.max(0, v), 2.2) * 0.34;
    const edgeWaveZ = Math.sin(x * Math.PI * 2.0) * 0.04 * v;

    z += centerCreaseZ + bottomCurlZ + edgeWaveZ;

    pos.setXYZ(i, x, y, z);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a folded origami leaf-cluster card geometry (layered paper fan with central midrib crease)
 * so woodland foliage reads unmistakably as hand-cut folded paper layers rather than low-poly stones.
 */
export function createFoldedPaperLeafGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BoxGeometry(1.0, 0.14, 1.0, 4, 1, 4);
  const pos = geom.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    // Diamond/ovate leaf card silhouette tapering at front/back (z)
    const zNorm = Math.abs(z) * 2.0; // 0 at middle, 1 at tips
    const leafProfile = Math.max(0.18, Math.cos(zNorm * Math.PI * 0.44));
    x *= leafProfile;

    // Origami V-crease along the leaf midrib (x = 0) + gentle arch along z
    const midribFoldY = (0.5 - Math.abs(x)) * 0.26;
    const lengthArchY = (0.25 - z * z) * 0.22;
    y += midribFoldY + lengthArchY;

    pos.setXYZ(i, x, y, z);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates the TSL Tactile Cut-Paper & Deckle-Edge Material.
 * Features:
 * - Exposed raw cream Washi paper deckle edges (`positionLocal` perimeter mask)
 * - Origami central fold-spine highlight (`exp(-|x_local| * 14)`)
 * - Dropped shadow band at the top root where the upper shingle overlaps (`y_local -> +0.5`)
 * - Sinuous bast fiber grain + physical Kubelka-Munk 2-flux pigment glazes
 */
export function createPaperShingleMaterial(
  uniforms: PaperSceneUniforms,
  options: {
    role: 'shingle' | 'foliage' | 'trunk' | 'bank' | 'stone' | 'reflected-shingle' | 'reflected-foliage';
  }
): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.roughness = 0.94;
  mat.metalness = 0.0;

  const isReflected = options.role === 'reflected-shingle' || options.role === 'reflected-foliage';
  const isShingle = options.role === 'shingle' || options.role === 'reflected-shingle';
  const isFoliage = options.role === 'foliage' || options.role === 'reflected-foliage';

  const aVariation = attribute('aVariation', 'vec3');

  // Vertex stage: preserve InstancedMesh transforms via `positionLocal`
  if (isFoliage) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const breeze = uniforms.uWindBreeze;
      const swayX = sin(t.mul(1.35).add(wp.x.mul(0.7)).add(wp.z.mul(0.5)))
        .mul(0.048)
        .mul(breeze);
      const swayZ = cos(t.mul(1.1).add(wp.z.mul(0.8)))
        .mul(0.036)
        .mul(breeze);
      return pos.add(vec3(swayX, float(0.0), swayZ));
    })();
  } else if (isReflected) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const rippleWave = sin(wp.z.mul(8.5).sub(t.mul(2.4)).add(wp.x.mul(3.5)))
        .mul(0.044)
        .mul(uniforms.uPondRippleStrength);
      return pos.add(vec3(rippleWave, float(0.0), rippleWave.mul(0.45)));
    })();
  }

  // Fragment color node: Cut-Paper Deckle Rim + Origami Spine Crease + Kubelka-Munk Glaze
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const pLocal = positionLocal;
    const nw = normalWorld;
    const varAttr = aVariation; // .x = tone shift [-1..1], .y = warm/crimson mix [0..1], .z = phase seed

    const revealMask = evaluateDioramaWashReveal(wp, uniforms);

    // 1. Multi-scale paper bast fiber & woodblock striation coordinates
    const grainUV = vec2(
      wp.x.mul(7.2).add(varAttr.z.mul(17.3)),
      wp.y.mul(15.5).add(wp.z.mul(7.2))
    );
    const fiberPrimary = fbmPaper2D(grainUV);
    const fiberFine = fbmPaper2D(grainUV.mul(3.4).add(vec2(4.2, 9.1)));

    // 2. Local Paper Strip Anatomy: Deckle-Edge Rim, Origami Center Crease & Overlap Drop Shadow
    // On unit paper strip/card (`pLocal.x` in `[-0.5..0.5]`, `pLocal.y` in `[-0.5..0.5]`):
    const edgeNoise = fiberFine.sub(0.5).mul(0.16);
    const distEdgeX = abs(pLocal.x).add(edgeNoise.mul(0.6));
    const distEdgeY = abs(isFoliage ? pLocal.z : pLocal.y).add(edgeNoise.mul(0.6));
    const cardEdgeMetric = max(distEdgeX, distEdgeY);

    // Bright exposed cream paper core along hand-torn deckle edges (`cardEdgeMetric > 0.38`)
    const deckleRimMask = isShingle || isFoliage || options.role === 'stone'
      ? smoothstep(float(0.36), float(0.48), cardEdgeMetric)
      : float(0.0);

    // Dark ink/graphite cut-line hairline right at the outer card boundary (`0.43..0.49`)
    const cutLineInk = isShingle || isFoliage
      ? smoothstep(float(0.44), float(0.49), cardEdgeMetric).mul(0.32).mul(uniforms.uShingleRoughness)
      : float(0.0);

    // Crisp origami center spine highlight (`pLocal.x ≈ 0`)
    const origamiSpineHighlight = isShingle || isFoliage
      ? exp(abs(pLocal.x).mul(-14.0)).mul(0.14).mul(uniforms.uShingleRoughness)
      : float(0.0);

    // Self-shadowing at the top of each shingle (`pLocal.y -> +0.5`) where the row above overlaps it,
    // plus a dark shadow band at the bottom cut lip
    const topUnderlapShadow = isShingle
      ? smoothstep(float(0.12), float(0.46), pLocal.y).mul(0.32).mul(uniforms.uShingleRoughness)
      : float(0.0);

    const shingleStriation = sin(
      pLocal.x.mul(38.0).add(varAttr.z.mul(23.0)).add(fiberPrimary.mul(5.0))
    )
      .mul(0.5)
      .add(0.5);

    const toothEffect = fiberPrimary
      .sub(0.5)
      .mul(0.32)
      .add(fiberFine.sub(0.5).mul(0.18))
      .mul(uniforms.uPaperTooth);

    // 3. Determine target mass-tone reflectance R_inf by material role
    let baseMassTone: any = vec3(uniforms.uShingleWeather);
    if (isShingle) {
      const warmMix = clamp(varAttr.y, float(0.0), float(1.0));
      const toneShift = varAttr.x.mul(0.15);
      const rawCedar = mix(vec3(uniforms.uShingleWeather), vec3(uniforms.uCollarWarmCedar), warmMix);
      const grainMod = mix(
        float(1.0),
        float(0.74).add(shingleStriation.mul(0.30)).sub(topUnderlapShadow),
        uniforms.uShingleRoughness
      );
      baseMassTone = clamp(rawCedar.add(vec3(toneShift)).mul(grainMod), vec3(0.07), vec3(0.93));
    } else if (isFoliage) {
      // In the wide-angle photo:
      // - Left shoreline features vibrant crimson/russet autumn maple leaves (`varAttr.y > 0.6`)
      // - Center/right canopy features olive-sage & golden-ochre woodland leaves
      const canopyShift = varAttr.x.mul(0.13);
      const autumnWarmth = clamp(varAttr.y, float(0.0), float(1.0));
      const crimsonMaple = vec3(0.66, 0.27, 0.17);
      const oliveOrOchre = mix(
        vec3(uniforms.uCanopyOlive).add(vec3(canopyShift)),
        vec3(uniforms.uCollarWarmCedar).mul(1.12),
        smoothstep(float(0.15), float(0.65), autumnWarmth)
      );
      baseMassTone = mix(
        oliveOrOchre,
        crimsonMaple.add(vec3(canopyShift.mul(0.5))),
        smoothstep(float(0.62), float(0.92), autumnWarmth)
      );
    } else if (options.role === 'trunk') {
      // Layered paper-bark strips along tree trunks
      const barkRing = sin(wp.y.mul(16.0).add(fiberPrimary.mul(6.0))).mul(0.08).mul(uniforms.uShingleRoughness);
      baseMassTone = mix(
        vec3(uniforms.uShingleWeather).mul(0.70),
        vec3(uniforms.uLeafLitter),
        float(0.38)
      ).add(vec3(varAttr.x.mul(0.09).add(barkRing)));
    } else if (options.role === 'bank') {
      // Terraced contour-paper topographic steps (`sin(wp.y * 42)`) so the ground reads as stacked paper sheets!
      const bankNoise = fbmPaper2D(vec2(wp.x.mul(2.2), wp.z.mul(2.2)));
      const contourStep = smoothstep(
        float(0.75),
        float(0.95),
        sin(wp.y.mul(44.0).add(bankNoise.mul(3.5)))
      )
        .mul(0.14)
        .mul(uniforms.uShingleRoughness);
      const shorelineWetness = float(1.0).sub(smoothstep(float(-0.02), float(0.30), wp.y));
      const dryBank = mix(
        vec3(uniforms.uLeafLitter),
        vec3(uniforms.uCollarWarmCedar).mul(0.92),
        bankNoise
      ).sub(vec3(contourStep));
      baseMassTone = mix(dryBank, vec3(uniforms.uPondDeepMoss).mul(0.85), shorelineWetness.mul(0.62));
    } else if (options.role === 'stone') {
      baseMassTone = vec3(uniforms.uShingleWeather).mul(0.88).add(vec3(varAttr.x.mul(0.09)));
    }

    // 4. Physical Kubelka-Munk film thickness: thins out at the deckle-edge rim (`deckleRimMask`)
    //    so the warm cream paper backing glows through the torn edges of every single paper shingle!
    const deckleThinning = float(1.0).sub(deckleRimMask.mul(0.72));
    const baseThickness = float(isFoliage ? 1.15 : 1.52)
      .mul(deckleThinning)
      .add(toothEffect)
      .mul(smoothstep(float(0.02), float(0.55), revealMask));

    const edgeBand = smoothstep(float(0.05), float(0.26), revealMask).mul(
      float(1.0).sub(smoothstep(float(0.26), float(0.58), revealMask))
    );
    const fuchidoriBoost = edgeBand.mul(uniforms.uWatercolorBleed).mul(0.85);
    const effectiveThickness = baseThickness.add(fuchidoriBoost);

    const kmColor = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      baseMassTone,
      vec3(1.15, 1.12, 1.08),
      effectiveThickness
    );

    // 5. Paper-cut stepped lighting + Golden-Hour Sun Backlight Rim (from upper-right of wide-angle photo)
    const keyLightDir = vec3(0.42, 0.78, 0.45);
    const goldenBacklightDir = vec3(0.58, 0.46, -0.67); // Low afternoon sun through upper-right trees
    const effectiveNormal =
      isReflected || isFoliage ? vec3(nw.x.mul(0.55), nw.y.abs().add(0.35), nw.z.mul(0.55)) : nw;

    const nDotL = clamp(dot(effectiveNormal, keyLightDir), float(-1.0), float(1.0));
    const minShade = isFoliage ? float(0.84) : float(0.74);
    const paperShade = mix(minShade, float(1.09), smoothstep(float(-0.35), float(0.65), nDotL));

    // Warm golden paper-edge translucency & fold ridge highlight
    const backRim = pow(clamp(dot(effectiveNormal, goldenBacklightDir), float(0.0), float(1.0)), float(2.0))
      .mul(0.14);
    const creaseRidge = pow(clamp(float(1.0).sub(abs(effectiveNormal.y)), float(0.0), float(1.0)), float(2.0))
      .mul(0.09)
      .add(origamiSpineHighlight)
      .add(deckleRimMask.mul(0.11))
      .mul(uniforms.uShingleRoughness);

    const shadedPaper = clamp(
      kmColor
        .mul(paperShade.sub(cutLineInk))
        .add(vec3(creaseRidge))
        .add(vec3(1.0, 0.88, 0.65).mul(backRim)),
      vec3(0.0),
      vec3(1.0)
    );

    if (isReflected) {
      const depthBelow = clamp(wp.y.negate(), float(0.0), float(3.5));
      const waterAtten = exp(depthBelow.mul(-0.36));
      const waterGlaze = mix(
        vec3(uniforms.uPondDeepMoss),
        shadedPaper.mul(vec3(0.84, 0.86, 0.72)),
        waterAtten.mul(0.74)
      );
      return mix(vec3(uniforms.uPaperBacking), waterGlaze, smoothstep(float(0.05), float(0.45), revealMask));
    }

    return mix(vec3(uniforms.uPaperBacking), shadedPaper, smoothstep(float(0.01), float(0.22), revealMask));
  })();

  if (isReflected || isFoliage || options.role === 'trunk') {
    mat.transparent = true;
    mat.opacityNode = Fn(() => {
      const wp = positionWorld;
      const revealMask = evaluateDioramaWashReveal(wp, uniforms);
      if (isReflected) {
        const inPondZ = smoothstep(float(0.05), float(0.32), wp.z).mul(
          float(1.0).sub(smoothstep(float(1.65), float(2.55), wp.z))
        );
        const depthFade = float(1.0).sub(smoothstep(float(1.15), float(1.75), wp.y.negate()));
        return smoothstep(float(0.18), float(0.55), revealMask).mul(inPondZ).mul(depthFade);
      }
      return smoothstep(float(0.04), float(0.32), revealMask);
    })();
  }

  return mat;
}
