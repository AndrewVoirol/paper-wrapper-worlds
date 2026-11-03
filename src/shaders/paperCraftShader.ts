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
  cameraPosition,
  attribute,
  varying,
} from 'three/tsl';
import { DEFAULT_PARAMS, PALETTE_PRESETS, type PaperPalettePreset } from '../types';

export const WATER_LEVEL_Y = 0.008;

/**
 * Shared uniform bundle for Paper-Wrapper Worlds.
 * All TSL materials (compressed-sheet guardian, pleated origami boughs, creased bark channels,
 * folded cove bank, botanical sky wash, and Kubelka-Munk pond) share these uniforms (< 0.05 ms updates).
 */
export class PaperSceneUniforms {
  public readonly uTime = uniform(0.0);
  public readonly uPaperTooth = uniform(DEFAULT_PARAMS.paperTooth);
  public readonly uWatercolorBleed = uniform(DEFAULT_PARAMS.watercolorBleed);
  public readonly uPondRippleStrength = uniform(DEFAULT_PARAMS.pondRippleStrength);
  public readonly uShingleRoughness = uniform(DEFAULT_PARAMS.shingleRoughness);
  public readonly uWindBreeze = uniform(DEFAULT_PARAMS.windBreeze);
  public readonly uRevealMode = uniform(0.0); // 0.0 = interactive wash reveal, 1.0 = full vignette

  // Interactive cursor / brush wash state in world XZ coordinates
  public readonly uCursorWorld = uniform(new THREE.Vector3(0.0, 0.5, 0.0));
  public readonly uBrushRadius = uniform(2.45);
  public readonly uBrushActive = uniform(0.0);

  // 4 persistent wash trail stamps framing the central guardian, tall canopy & deep pond mirror
  public readonly uWashTrail0 = uniform(new THREE.Vector4(-2.25, -0.75, 3.45, 0.96));
  public readonly uWashTrail1 = uniform(new THREE.Vector4(2.25, -0.55, 3.45, 0.95));
  public readonly uWashTrail2 = uniform(new THREE.Vector4(0.0, 2.95, 4.15, 0.96));
  public readonly uWashTrail3 = uniform(new THREE.Vector4(0.0, -1.85, 3.45, 0.95));

  // 4 interactive pond droplet ripples (x = worldX, y = worldZ, z = birthTime, w = strength)
  public readonly uRipple0 = uniform(new THREE.Vector4(0.0, 1.25, -99.0, 0.0));
  public readonly uRipple1 = uniform(new THREE.Vector4(-1.05, 0.85, -99.0, 0.0));
  public readonly uRipple2 = uniform(new THREE.Vector4(1.05, 0.88, -99.0, 0.0));
  public readonly uRipple3 = uniform(new THREE.Vector4(0.15, 2.15, -99.0, 0.0));

  // Palette color uniforms (stored as sRGB [0..1]; converted via exact IEC sRGB->Linear at output)
  public readonly uPaperBacking = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].paperBackingRGB));
  public readonly uShingleWeather = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].shingleWeatherRGB));
  public readonly uCollarWarmCedar = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].collarWarmCedarRGB));
  public readonly uPondDeepMoss = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].pondDeepMossRGB));
  public readonly uPondAmberTannin = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].pondAmberTanninRGB));
  public readonly uCanopyOlive = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].canopyOliveRGB));
  public readonly uLeafLitter = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].leafLitterRGB));
  public readonly uSkyZenith = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].skyZenithRGB));
  public readonly uSkyHorizon = uniform(new THREE.Vector3(...PALETTE_PRESETS[0].skyHorizonRGB));

  private readonly _tmpColor = new THREE.Color();

  public applyPalette(palette: PaperPalettePreset): void {
    this._tmpColor.set(palette.paperBgHex);
    const srgb = { r: 0, g: 0, b: 0 };
    this._tmpColor.getRGB(srgb, THREE.SRGBColorSpace);
    this.uPaperBacking.value.set(srgb.r, srgb.g, srgb.b);

    this.uShingleWeather.value.set(...palette.shingleWeatherRGB);
    this.uCollarWarmCedar.value.set(...palette.collarWarmCedarRGB);
    this.uPondDeepMoss.value.set(...palette.pondDeepMossRGB);
    this.uPondAmberTannin.value.set(...palette.pondAmberTanninRGB);
    this.uCanopyOlive.value.set(...palette.canopyOliveRGB);
    this.uLeafLitter.value.set(...palette.leafLitterRGB);
    this.uSkyZenith.value.set(...palette.skyZenithRGB);
    this.uSkyHorizon.value.set(...palette.skyHorizonRGB);
  }
}

/**
 * Exact IEC 61966-2-1 sRGB -> Linear transfer in TSL so `uPaperBacking` matches
 * `THREE.Scene.background = new THREE.Color(paperBgHex)` with zero RGB step on WebGPU.
 */
export const srgbToLinearVec3 = Fn(([c_in]: [any]) => {
  const c = clamp(vec3(c_in), vec3(0.0), vec3(1.0));
  const lo = c.div(12.92);
  const hi = pow(c.add(vec3(0.055)).div(1.055), vec3(2.4));
  return mix(lo, hi, smoothstep(vec3(0.039), vec3(0.041), c));
});

/**
 * 2D hash & smooth value noise in TSL (uniform control flow, Apple Silicon floor-safe).
 */
export const hash21 = Fn(([p_in]: [any]) => {
  const p = vec2(p_in);
  const h = dot(p, vec2(127.1, 311.7));
  const s = sin(h).mul(43758.5453123);
  return s.sub(floor(s));
});

export const noise2D = Fn(([p_in]: [any]) => {
  const p = vec2(p_in);
  const i = floor(p);
  const f = p.sub(i);
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * 3-octave irrational-angle rotated FBM for organic kozo/mulberry bast fibers & watercolor wash bleed.
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
 * Shared asymmetric shoreline curve `z = shoreZ(x)` matching `IMG_0382.DNG`:
 * - Nearly horizontal behind the crouching guardian (`z ≈ 0.20..0.28`),
 * - Curving forward on the right flank (`x > 1.45 -> 4.35`) into the stone cairn & trailhead cove.
 */
export function evalShorelineZJS(x: number): number {
  const rightT = Math.max(0, Math.min(1, (x - 1.42) / (4.35 - 1.42)));
  const rightCove = rightT * rightT * (3 - 2 * rightT) * 1.18;
  const leftT = Math.max(0, Math.min(1, (-x - 1.85) / (4.35 - 1.85)));
  const leftCove = leftT * leftT * (3 - 2 * leftT) * 0.22;
  return 0.19 + Math.cos(x * 0.88) * 0.085 + rightCove + leftCove;
}

export const evaluateShorelineZ = Fn(([x_in]: [any]) => {
  const x = float(x_in);
  const rightCove = smoothstep(float(1.42), float(4.35), x).mul(1.18);
  const leftCove = smoothstep(float(1.85), float(4.35), x.negate()).mul(0.22);
  return float(0.19)
    .add(cos(x.mul(0.88)).mul(0.085))
    .add(rightCove)
    .add(leftCove);
});

/**
 * Evaluates a single physical radial capillary-gravity ripple ring at world XZ
 * from a Vec4 impulse `(originX, originZ, birthTime, strength)`.
 */
export function evaluateSingleRipple(xz_in: any, rippleVec_in: any, time_in: any): any {
  const xz = vec2(xz_in);
  const rv = rippleVec_in;
  const age = max(float(time_in).sub(rv.z), float(0.0));
  const activeGate = smoothstep(float(0.0), float(0.05), age).mul(
    float(1.0).sub(smoothstep(float(3.2), float(4.8), age))
  );
  const dist = length(xz.sub(rv.xy));
  const waveRadius = age.mul(1.28);
  const envelope = exp(dist.sub(waveRadius).mul(dist.sub(waveRadius)).mul(-3.5)).mul(
    exp(age.mul(-0.66))
  );
  const phase = dist.sub(waveRadius).mul(16.5);
  return sin(phase).mul(envelope).mul(rv.w).mul(activeGate);
}

/**
 * Evaluates combined dynamic pointer droplet ripples (`uRipple0..3`) at world XZ.
 */
export function evaluateDynamicRipples(xz_in: any, uniforms: PaperSceneUniforms): any {
  const xz = vec2(xz_in);
  const t = uniforms.uTime;
  const r0 = float(evaluateSingleRipple(xz, uniforms.uRipple0, t));
  const r1 = float(evaluateSingleRipple(xz, uniforms.uRipple1, t));
  const r2 = float(evaluateSingleRipple(xz, uniforms.uRipple2, t));
  const r3 = float(evaluateSingleRipple(xz, uniforms.uRipple3, t));
  return r0.add(r1).add(r2).add(r3);
}

/**
 * Physical Kubelka-Munk 2-Flux Radiative Transfer Function in TSL.
 * Evaluates true film thickness `d` inside `coth(b * S * d)` against the warm Washi backing `Rg`.
 */
export const evalKubelkaMunk2Flux = Fn(
  ([Rg_in, Rinf_in, S_in, thickness_in]: [any, any, any, any]) => {
    const Rg = clamp(vec3(Rg_in), vec3(0.02), vec3(0.99));
    const Rinf = clamp(vec3(Rinf_in), vec3(0.03), vec3(0.96));
    const S = max(vec3(S_in), vec3(0.05));
    const dRaw = max(float(thickness_in), float(0.0));
    const d = max(dRaw, float(0.0001));

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
    const km = clamp(numer.div(denom), vec3(0.0), vec3(1.0));

    return mix(Rg, km, smoothstep(float(0.0), float(0.002), dRaw));
  }
);

/**
 * Evaluates the asymmetric woodland cove diorama wash reveal envelope (`~9.8m` wide × `10.4m` deep).
 */
export const evaluateDioramaWashReveal = Fn(([worldPos_in, uniforms]: [any, PaperSceneUniforms]) => {
  const wp = vec3(worldPos_in);
  const xz = vec2(wp.x, wp.z);

  const fbmBroad = fbmPaper2D(xz.mul(0.64)).sub(0.5).mul(0.38);
  const fbmFine = fbmPaper2D(xz.mul(2.4).add(vec2(7.1, 3.9))).sub(0.5).mul(0.13);
  const edgePerturb = fbmBroad.add(fbmFine).mul(uniforms.uWatercolorBleed.mul(0.65).add(0.35));

  const centeredXZ = vec2(xz.x.div(4.88), xz.y.sub(0.95).div(5.25));
  const normDist = length(centeredXZ);

  const outerVignetteWall = float(1.0).sub(
    smoothstep(float(0.56), float(1.04), normDist.add(edgePerturb.mul(0.52)))
  );

  const baseCoreMask = float(1.0).sub(
    smoothstep(float(0.46), float(0.96), normDist.add(edgePerturb.mul(0.62)))
  );

  const dCursor = length(xz.sub(vec2(uniforms.uCursorWorld.x, uniforms.uCursorWorld.z)));
  const cursorMask = float(1.0)
    .sub(smoothstep(uniforms.uBrushRadius.mul(0.35), uniforms.uBrushRadius, dCursor.add(edgePerturb.mul(0.75))))
    .mul(uniforms.uBrushActive);

  const d0 = length(xz.sub(uniforms.uWashTrail0.xy));
  const m0 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail0.z.mul(0.45), uniforms.uWashTrail0.z, d0.add(edgePerturb.mul(0.75))))
    .mul(uniforms.uWashTrail0.w);

  const d1 = length(xz.sub(uniforms.uWashTrail1.xy));
  const m1 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail1.z.mul(0.45), uniforms.uWashTrail1.z, d1.add(edgePerturb.mul(0.75))))
    .mul(uniforms.uWashTrail1.w);

  const d2 = length(xz.sub(uniforms.uWashTrail2.xy));
  const m2 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail2.z.mul(0.45), uniforms.uWashTrail2.z, d2.add(edgePerturb.mul(0.75))))
    .mul(uniforms.uWashTrail2.w);

  const d3 = length(xz.sub(uniforms.uWashTrail3.xy));
  const m3 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail3.z.mul(0.45), uniforms.uWashTrail3.z, d3.add(edgePerturb.mul(0.75))))
    .mul(uniforms.uWashTrail3.w);

  const interactiveRaw = max(max(baseCoreMask, cursorMask), max(max(m0, m1), max(m2, m3)));
  const interactiveBound = min(interactiveRaw, outerVignetteWall);

  return clamp(mix(interactiveBound, outerVignetteWall, uniforms.uRevealMode), float(0.0), float(1.0));
});

/**
 * Evaluates the upper forest crown envelope (`y` up to `~4.25m` at center, tapering gently on outer flanks
 * so the complete conifer/oak crowns + watercolor sky wash fit inside `Pond Mirror` without clipping).
 */
export const evaluateCanopyCrownEnvelope = Fn(([worldPos_in, uniforms]: [any, PaperSceneUniforms]) => {
  const wp = vec3(worldPos_in);
  const fbmCrown = fbmPaper2D(vec2(wp.x.mul(1.15), wp.y.mul(1.05).add(wp.z.mul(0.8)))).sub(0.5).mul(0.38);
  const archDrop = wp.x.div(4.65).mul(wp.x.div(4.65)).mul(0.62);
  const effectiveY = wp.y.add(archDrop).add(fbmCrown.mul(uniforms.uWatercolorBleed.mul(0.55).add(0.35)));
  return float(1.0).sub(smoothstep(float(2.68), float(3.42), effectiveY));
});

/**
 * Evaluates ONLY the outer watercolor wash margin of the foreground pond (`xz` in world coordinates),
 * WITHOUT fading at `shoreZ`. Extends a wide, soft wet-on-wet feather onto raw `#f2ebd9` Washi.
 */
export const evaluatePondOuterWashMask = Fn(([xz_in, uniforms]: [any, PaperSceneUniforms]) => {
  const xz = vec2(xz_in);

  const washBroad = fbmPaper2D(xz.mul(0.58).add(vec2(2.4, 5.1))).sub(0.5).mul(0.34);
  const washMed = fbmPaper2D(xz.mul(1.45).add(vec2(8.2, 1.7))).sub(0.5).mul(0.11);
  const washBleed = washBroad.add(washMed).mul(uniforms.uWatercolorBleed.mul(0.65).add(0.35));

  const ovalVec = vec2(xz.x.div(4.78), xz.y.sub(2.85).div(3.32));
  const ovalDist = length(ovalVec).add(washBleed.mul(0.46));
  // Wide soft watercolor puddle feather (`0.48 -> 1.04`) so zero jagged cutout edge ever forms!
  const outerOvalFade = float(1.0).sub(smoothstep(float(0.48), float(1.04), ovalDist));

  const revealMask = evaluateDioramaWashReveal(vec3(xz.x, float(0.0), xz.y), uniforms);
  return clamp(
    outerOvalFade.mul(smoothstep(float(0.02), float(0.58), revealMask)),
    float(0.0),
    float(1.0)
  );
});

/**
 * Shared foreground watercolor pond cove mask (`xz` in world coordinates).
 * Extends deep into the foreground (`z` up to `~5.85m`) and meets `shoreZ` cleanly with zero gap.
 */
export const evaluatePondBasinMask = Fn(([xz_in, uniforms]: [any, PaperSceneUniforms]) => {
  const xz = vec2(xz_in);
  const shoreZ = evaluateShorelineZ(xz.x);
  const outerMask = evaluatePondOuterWashMask(xz, uniforms);
  const shoreFade = smoothstep(float(-0.045), float(0.015), xz.y.sub(shoreZ));
  return clamp(outerMask.mul(shoreFade), float(0.0), float(1.0));
});

/**
 * Builds a Compressed Dihedral-Creased & Tucked Paper Pleat Geometry (`width = 1`, `length = 1`).
 * - Deliberate central mountain crease ridge (`u = 0`) splitting two crisp planar facets (`~19°` dihedral),
 * - Angular tucked lower flare overlapping the course below (`v = -0.5`),
 * - Thin side & bottom cut-paper return edges (no 4-sided white sticker border, zero sub-fingertip stripes).
 */
export function createCreasedPaperStripGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];

  const pushTri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    cardCoords.push(au, av, bu, bv, cu, cv);
  };

  const pushQuad = (
    x0: number, y0: number, z0: number, u0: number, v0: number,
    x1: number, y1: number, z1: number, u1: number, v1: number,
    x2: number, y2: number, z2: number, u2: number, v2: number,
    x3: number, y3: number, z3: number, u3: number, v3: number
  ) => {
    pushTri(x0, y0, z0, u0, v0, x1, y1, z1, u1, v1, x2, y2, z2, u2, v2);
    pushTri(x0, y0, z0, u0, v0, x2, y2, z2, u2, v2, x3, y3, z3, u3, v3);
  };

  // 3 vertical stations (`y = +0.5` tucked top, `y = -0.04` mid crease break, `y = -0.5` overlapping lower lip)
  const ys = [0.5, -0.04, -0.5];
  const halfW = [0.50, 0.49, 0.455];
  const ridgeZ = [0.055, 0.115, 0.185];
  const flankZ = [0.0, 0.032, 0.095];
  const sheetThick = 0.065;

  for (let r = 0; r < 2; r++) {
    const yT = ys[r], yB = ys[r + 1];
    const wT = halfW[r], wB = halfW[r + 1];
    const rzT = ridgeZ[r], rzB = ridgeZ[r + 1];
    const fzT = flankZ[r], fzB = flankZ[r + 1];

    // Left front dihedral facet (CCW facing +Z)
    pushQuad(
      -wB, yB, fzB, -0.5, yB,
      0.0, yB, rzB, 0.0, yB,
      0.0, yT, rzT, 0.0, yT,
      -wT, yT, fzT, -0.5, yT
    );
    // Right front dihedral facet (CCW facing +Z)
    pushQuad(
      0.0, yB, rzB, 0.0, yB,
      wB, yB, fzB, 0.5, yB,
      wT, yT, fzT, 0.5, yT,
      0.0, yT, rzT, 0.0, yT
    );

    // Thin cut-paper side returns (`±w`) so oblique grazing angles show crisp paper thickness
    pushQuad(
      -wB, yB, fzB - sheetThick, -0.5, yB,
      -wB, yB, fzB, -0.5, yB,
      -wT, yT, fzT, -0.5, yT,
      -wT, yT, fzT - sheetThick, -0.5, yT
    );
    pushQuad(
      wB, yB, fzB, 0.5, yB,
      wB, yB, fzB - sheetThick, 0.5, yB,
      wT, yT, fzT - sheetThick, 0.5, yT,
      wT, yT, fzT, 0.5, yT
    );
  }

  // Crisp cut lower edge return lip (`y = -0.5`, facing -Y/+Z)
  const wBot = halfW[2], rzBot = ridgeZ[2], fzBot = flankZ[2];
  pushQuad(
    -wBot, -0.5, fzBot - sheetThick, -0.45, -0.5,
    0.0, -0.5, rzBot - sheetThick, 0.0, -0.5,
    0.0, -0.5, rzBot, 0.0, -0.49,
    -wBot, -0.5, fzBot, -0.45, -0.49
  );
  pushQuad(
    0.0, -0.5, rzBot - sheetThick, 0.0, -0.5,
    wBot, -0.5, fzBot - sheetThick, 0.45, -0.5,
    wBot, -0.5, fzBot, 0.45, -0.49,
    0.0, -0.5, rzBot, 0.0, -0.49
  );

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a Tall Creased & Tucked Bark-Sheet Trunk Geometry (`height = 1`, `y in [-0.5, +0.5]`).
 * - 6 asymmetric accordion-folded vertical facets (alternating mountain ridge & valley fold)
 *   across 20 stations so reflected trunks undulate smoothly across capillary water ripples,
 * - 3 subtle diagonal tucked sleeve overlaps along the trunk height (`sFrac = 0.28, 0.56, 0.82`).
 */
export function createSculptedPaperTrunkGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];

  const pushQuad = (
    x0: number, y0: number, z0: number, u0: number, v0: number,
    x1: number, y1: number, z1: number, u1: number, v1: number,
    x2: number, y2: number, z2: number, u2: number, v2: number,
    x3: number, y3: number, z3: number, u3: number, v3: number
  ) => {
    positions.push(
      x0, y0, z0, x1, y1, z1, x2, y2, z2,
      x0, y0, z0, x2, y2, z2, x3, y3, z3
    );
    cardCoords.push(
      u0, v0, u1, v1, u2, v2,
      u0, v0, u2, v2, u3, v3
    );
  };

  const numVerticesRing = 8; // 4 mountain ridges + 4 valley troughs -> 8 crisp vertical paper facets
  const numStations = 20;

  const evalRingPoint = (sFrac: number, sideIdx: number, tuckFlare = 0.0) => {
    const y = -0.5 + sFrac;
    const rootFlare = Math.exp(-sFrac * 8.5) * 0.28;
    const taper = 1.0 - sFrac * 0.44;
    const isRidge = sideIdx % 2 === 0;
    const pleatMod = isRidge ? 1.09 : 0.87;
    const radius = (taper + rootFlare + tuckFlare) * pleatMod;

    const swayX = Math.sin(sFrac * Math.PI * 1.15) * 0.055;
    const swayZ = Math.cos(sFrac * Math.PI * 0.85) * 0.032;
    const twist = sFrac * 0.26;
    const angle = (sideIdx / numVerticesRing) * Math.PI * 2 + twist;

    return {
      x: Math.sin(angle) * radius + swayX,
      y,
      z: Math.cos(angle) * radius + swayZ,
      cu: isRidge ? 0.0 : 0.42, // 0.0 = longitudinal mountain ridge, 0.42 = valley crease
    };
  };

  for (let i = 0; i < numStations; i++) {
    const t0 = i / numStations;
    const t1 = (i + 1) / numStations;
    // Deliberate tucked bark-sleeve step every 6 stations
    const isSleeveTop = i === 5 || i === 11 || i === 16;
    const flare0 = i === 6 || i === 12 || i === 17 ? 0.048 : 0.0;
    const cv0 = flare0 > 0 ? -0.46 : -0.15;
    const cv1 = isSleeveTop ? 0.42 : 0.12;

    for (let j = 0; j < numVerticesRing; j++) {
      const pBL = evalRingPoint(t0, j, flare0);
      const pBR = evalRingPoint(t0, j + 1, flare0);
      const pTR = evalRingPoint(t1, j + 1, 0.0);
      const pTL = evalRingPoint(t1, j, 0.0);

      pushQuad(
        pBL.x, pBL.y, pBL.z, pBL.cu, cv0,
        pBR.x, pBR.y, pBR.z, pBR.cu, cv0,
        pTR.x, pTR.y, pTR.z, pTR.cu, cv1,
        pTL.x, pTL.y, pTL.z, pTL.cu, cv1
      );
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds an Upward-Sweeping V-Creased Paper Forest Branch + Subsidiary Fork (`t in [0, 1]`).
 * Slender 4-facet creased paper channel reaching steeply upward into the canopy sky windows.
 */
export function createFoldedPaperLimbGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];

  const appendBranchTube = (
    evalCurve: (t: number) => THREE.Vector3,
    rBase: number,
    rTip: number,
    segs: number
  ) => {
    const numSides = 4; // Crisp 4-facet creased diamond paper channel
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const refZ = new THREE.Vector3(0, 0, 1);

    const rings: Array<Array<{ p: THREE.Vector3; cu: number; cv: number }>> = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = evalCurve(t);
      const cNext = evalCurve(Math.min(1.0, t + 0.03));
      const cPrev = evalCurve(Math.max(0.0, t - 0.03));
      tangent.subVectors(cNext, cPrev).normalize();
      normal.crossVectors(tangent, refZ);
      if (normal.lengthSq() < 0.001) normal.set(1, 0, 0);
      normal.normalize();
      binormal.crossVectors(normal, tangent).normalize();

      const r = THREE.MathUtils.lerp(rBase, rTip, t);
      const ring: Array<{ p: THREE.Vector3; cu: number; cv: number }> = [];
      for (let j = 0; j <= numSides; j++) {
        const a = (j / numSides) * Math.PI * 2 + 0.35;
        const aspect = j % 2 === 0 ? 1.15 : 0.82;
        const pt = c
          .clone()
          .addScaledVector(normal, Math.cos(a) * r * aspect)
          .addScaledVector(binormal, Math.sin(a) * r * aspect);
        ring.push({ p: pt, cu: j % 2 === 0 ? 0.0 : 0.42, cv: -0.25 + t * 0.65 });
      }
      rings.push(ring);
    }

    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < numSides; j++) {
        const bL = rings[i][j];
        const bR = rings[i][j + 1];
        const tR = rings[i + 1][j + 1];
        const tL = rings[i + 1][j];
        positions.push(
          bL.p.x, bL.p.y, bL.p.z, bR.p.x, bR.p.y, bR.p.z, tR.p.x, tR.p.y, tR.p.z,
          bL.p.x, bL.p.y, bL.p.z, tR.p.x, tR.p.y, tR.p.z, tL.p.x, tL.p.y, tL.p.z
        );
        cardCoords.push(
          bL.cu, bL.cv, bR.cu, bR.cv, tR.cu, tR.cv,
          bL.cu, bL.cv, tR.cu, tR.cv, tL.cu, tL.cv
        );
      }
    }
  };

  // Primary upward-sweeping limb
  appendBranchTube(
    (t) => new THREE.Vector3(t * 0.38 + t * t * 0.28, t * 1.12 - t * t * 0.08, t * 0.12),
    0.082,
    0.022,
    8
  );
  // Secondary forked twig emerging mid-limb
  appendBranchTube(
    (t) =>
      new THREE.Vector3(
        0.24 + t * 0.14 - t * t * 0.18,
        0.52 + t * 0.68,
        0.06 - t * 0.22
      ),
    0.048,
    0.015,
    5
  );

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a 3D Compressed Accordion-Pleated Origami Bough Shell Geometry (`~1m` span).
 * - Sheet deformation creates true 3D botanical volume: 7 radial mountain/valley accordion pleats
 *   (`14` crisp planar dihedral facets) arched across 3 radial stations into a cupped bough fan,
 *   plus a smaller tucked upper overlap fan (`crown tuck`)!
 * - Zero horizontal flat pancake discs and zero blurry alpha halos: crisp zig-zag cut paper facets.
 */
export function createFoldedPaperLeafGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];

  const pushTri = (
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cv: number
  ) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    cardCoords.push(au, av, bu, bv, cu, cv);
  };

  const pushQuad = (
    x0: number, y0: number, z0: number, u0: number, v0: number,
    x1: number, y1: number, z1: number, u1: number, v1: number,
    x2: number, y2: number, z2: number, u2: number, v2: number,
    x3: number, y3: number, z3: number, u3: number, v3: number
  ) => {
    pushTri(x0, y0, z0, u0, v0, x1, y1, z1, u1, v1, x2, y2, z2, u2, v2);
    pushTri(x0, y0, z0, u0, v0, x2, y2, z2, u2, v2, x3, y3, z3, u3, v3);
  };

  // Builds a single compressed dihedral-creased origami bough spray (`8` crisp facets:
  // tucked stem collar -> cambered central mountain ridge -> flared lateral facets -> angular cut tip)
  const appendDihedralSpray = (opts: {
    ox: number;
    oy: number;
    oz: number;
    yaw: number;
    pitch: number;
    roll: number;
    len: number;
    halfWidth: number;
    ridgeH: number;
    camberY: number;
    isUpperTuck: boolean;
  }) => {
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(opts.pitch, opts.yaw, opts.roll, 'YXZ')
    );
    const xf = (lx: number, ly: number, lz: number): [number, number, number] => {
      const v = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
      return [opts.ox + v.x, opts.oy + v.y, opts.oz + v.z];
    };

    const L = opts.len;
    const W = opts.halfWidth;
    const R = opts.ridgeH;
    const C = opts.camberY;
    const cvBase = opts.isUpperTuck ? 0.24 : 0.42;

    const s0L = xf(-W * 0.34, -R * 0.25, 0.0);
    const s0M = xf(0.0, R * 0.42, 0.02);
    const s0R = xf(W * 0.34, -R * 0.25, 0.0);

    const s1L = xf(-W * 1.0, C - R * 0.85, L * 0.46);
    const s1M = xf(0.0, C + R * 1.05, L * 0.48);
    const s1R = xf(W * 0.94, C - R * 0.82, L * 0.44);

    const s2L = xf(-W * 0.62, C * 0.35 - R * 0.65, L * 0.82);
    const s2M = xf(0.0, C * 0.42 + R * 0.72, L * 0.85);
    const s2R = xf(W * 0.58, C * 0.35 - R * 0.62, L * 0.80);

    const tip = xf(W * 0.04, -C * 0.32, L);

    // Proximal dihedral pair
    pushQuad(
      s1L[0], s1L[1], s1L[2], -0.44, 0.04,
      s1M[0], s1M[1], s1M[2], 0.0, 0.04,
      s0M[0], s0M[1], s0M[2], 0.0, cvBase,
      s0L[0], s0L[1], s0L[2], -0.38, cvBase
    );
    pushQuad(
      s1M[0], s1M[1], s1M[2], 0.0, 0.04,
      s1R[0], s1R[1], s1R[2], 0.44, 0.04,
      s0R[0], s0R[1], s0R[2], 0.38, cvBase,
      s0M[0], s0M[1], s0M[2], 0.0, cvBase
    );

    // Mid-distal dihedral pair (angled facet break -> `sheet deformation makes volume`)
    pushQuad(
      s2L[0], s2L[1], s2L[2], -0.45, -0.30,
      s2M[0], s2M[1], s2M[2], 0.0, -0.30,
      s1M[0], s1M[1], s1M[2], 0.0, 0.04,
      s1L[0], s1L[1], s1L[2], -0.44, 0.04
    );
    pushQuad(
      s2M[0], s2M[1], s2M[2], 0.0, -0.30,
      s2R[0], s2R[1], s2R[2], 0.45, -0.30,
      s1R[0], s1R[1], s1R[2], 0.44, 0.04,
      s1M[0], s1M[1], s1M[2], 0.0, 0.04
    );

    // Crisp angular origami cut tip facets
    pushTri(
      s2L[0], s2L[1], s2L[2], -0.45, -0.30,
      tip[0], tip[1], tip[2], 0.0, -0.49,
      s2M[0], s2M[1], s2M[2], 0.0, -0.30
    );
    pushTri(
      s2M[0], s2M[1], s2M[2], 0.0, -0.30,
      tip[0], tip[1], tip[2], 0.0, -0.49,
      s2R[0], s2R[1], s2R[2], 0.45, -0.30
    );
  };

  // Asymmetric 7-spray overlapping origami bough cluster (zero radial scallop-umbrella symmetry!)
  // Lower sweeping bough tier (`4` broad overlapping sprays)
  appendDihedralSpray({
    ox: -0.14, oy: 0.01, oz: -0.12, yaw: -0.78, pitch: 0.24, roll: 0.14,
    len: 0.66, halfWidth: 0.24, ridgeH: 0.058, camberY: 0.045, isUpperTuck: false,
  });
  appendDihedralSpray({
    ox: -0.04, oy: 0.03, oz: -0.10, yaw: -0.22, pitch: 0.28, roll: -0.06,
    len: 0.72, halfWidth: 0.26, ridgeH: 0.064, camberY: 0.052, isUpperTuck: false,
  });
  appendDihedralSpray({
    ox: 0.06, oy: 0.02, oz: -0.11, yaw: 0.34, pitch: 0.25, roll: 0.08,
    len: 0.68, halfWidth: 0.25, ridgeH: 0.060, camberY: 0.048, isUpperTuck: false,
  });
  appendDihedralSpray({
    ox: 0.16, oy: 0.0, oz: -0.13, yaw: 0.88, pitch: 0.22, roll: -0.15,
    len: 0.61, halfWidth: 0.22, ridgeH: 0.054, camberY: 0.042, isUpperTuck: false,
  });

  // Upper tucked overlapping bough tier (`3` staggered sprays tucked above the lower joints)
  appendDihedralSpray({
    ox: -0.09, oy: 0.11, oz: -0.14, yaw: -0.48, pitch: 0.15, roll: 0.09,
    len: 0.56, halfWidth: 0.21, ridgeH: 0.052, camberY: 0.044, isUpperTuck: true,
  });
  appendDihedralSpray({
    ox: 0.02, oy: 0.13, oz: -0.15, yaw: 0.06, pitch: 0.17, roll: -0.04,
    len: 0.60, halfWidth: 0.22, ridgeH: 0.056, camberY: 0.048, isUpperTuck: true,
  });
  appendDihedralSpray({
    ox: 0.12, oy: 0.10, oz: -0.13, yaw: 0.58, pitch: 0.14, roll: -0.11,
    len: 0.53, halfWidth: 0.20, ridgeH: 0.050, camberY: 0.040, isUpperTuck: true,
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a Miniature 2-Facet V-Folded Origami Floating Leaf (`4` crisp triangles)
 * for the calm autumn leaves resting on the pond surface (`below fingertip scale`).
 */
export function createOrigamiFloatingLeafGeometry(): THREE.BufferGeometry {
  const positions = [
    // Left V-folded wing (stem -> mid-left -> mid-spine, mid-left -> tip -> mid-spine)
    0.0, 0.025, -0.50,  -0.36, 0.055, 0.02,   0.0, 0.005, 0.02,
    -0.36, 0.055, 0.02,  0.0, 0.038, 0.52,    0.0, 0.005, 0.02,
    // Right V-folded wing
    0.0, 0.025, -0.50,   0.0, 0.005, 0.02,    0.36, 0.055, 0.02,
    0.0, 0.005, 0.02,    0.0, 0.038, 0.52,    0.36, 0.055, 0.02,
  ];
  const cardCoords = [
    0.0, -0.45, -0.45, 0.0, 0.0, 0.0,
    -0.45, 0.0, 0.0, 0.48, 0.0, 0.0,
    0.0, -0.45, 0.0, 0.0, 0.45, 0.0,
    0.0, 0.0, 0.0, 0.48, 0.45, 0.0,
  ];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

export type PaperMaterialRole =
  | 'shingle'
  | 'sculpted-shell'
  | 'foliage'
  | 'trunk'
  | 'bank'
  | 'stone'
  | 'reflected-shingle'
  | 'reflected-shell'
  | 'reflected-foliage'
  | 'reflected-trunk'
  | 'reflected-stone';

/**
 * Creates the TSL Compressed Origami × Watercolor Washi Material.
 * - Strictly enforces the sub-fingertip scale cutoff (`< 6 cm`): zero painted woodgrain sine stripes
 *   and zero 4-sided white sticker borders; below fingertip scale only physical paper folds,
 *   cut overlap edges, and sinuous kozo/mulberry bast fibers exist.
 * - Uses 100% opaque Z-buffered cardstock rendering (`alphaTest = 0.5` at outer Washi margins)
 *   for both upright and reflected geometry to eliminate transparent overdraw bloat.
 */
export function createPaperShingleMaterial(
  uniforms: PaperSceneUniforms,
  options: { role: PaperMaterialRole }
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();

  const isReflected =
    options.role === 'reflected-shingle' ||
    options.role === 'reflected-shell' ||
    options.role === 'reflected-foliage' ||
    options.role === 'reflected-trunk' ||
    options.role === 'reflected-stone';
  const isShingle = options.role === 'shingle' || options.role === 'reflected-shingle';
  const isSculptedShell = options.role === 'sculpted-shell' || options.role === 'reflected-shell';
  const isGuardian = isShingle || isSculptedShell;
  const isFoliage = options.role === 'foliage' || options.role === 'reflected-foliage';
  const isTrunk = options.role === 'trunk' || options.role === 'reflected-trunk';
  const isBank = options.role === 'bank';
  const isStone = options.role === 'stone' || options.role === 'reflected-stone';
  const hasCardAttr = isGuardian || isFoliage || isTrunk;

  // DoubleSide ensures planar-mirrored (`det = -1`) and open-pleated bough fans never cull valid paper facets
  mat.side = isFoliage || isReflected || isSculptedShell ? THREE.DoubleSide : THREE.FrontSide;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0.5;

  const aVariation = attribute('aVariation', 'vec3');
  const aCardCoord = hasCardAttr ? attribute('aCardCoord', 'vec2') : vec2(0.0, 0.0);

  // Vertex stage: gentle pleated bough sway (upright) & capillary + pointer-droplet ripple shear (reflected)
  if (isFoliage && !isReflected) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const heightGate = smoothstep(float(0.35), float(2.5), wp.y);
      const breeze = uniforms.uWindBreeze.mul(heightGate);
      const swayX = sin(t.mul(1.25).add(wp.x.mul(0.65)).add(wp.z.mul(0.5))).mul(0.032).mul(breeze);
      const swayZ = cos(t.mul(1.05).add(wp.z.mul(0.75))).mul(0.024).mul(breeze);
      return pos.add(vec3(swayX, float(0.0), swayZ));
    })();
  } else if (isReflected) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const camPos = cameraPosition;
      const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
      const tWater = clamp(camPos.y.sub(WATER_LEVEL_Y).div(rayDenom), float(0.0), float(1.0));
      const waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);

      const dynRip = evaluateDynamicRipples(waterHitXZ, uniforms);
      const rippleScale = isGuardian ? float(0.42) : float(1.15);
      const ambientWaveX = sin(wp.y.mul(14.5).sub(t.mul(2.05)).add(wp.x.mul(3.4))).mul(0.034).mul(rippleScale);
      const ambientWaveZ = cos(wp.x.mul(7.0).add(wp.y.mul(8.2)).add(t.mul(1.55))).mul(0.018).mul(rippleScale);
      const totalShear = ambientWaveX.add(dynRip.mul(0.068)).mul(uniforms.uPondRippleStrength);
      return pos.add(
        vec3(
          totalShear,
          dynRip.mul(0.014).mul(uniforms.uPondRippleStrength),
          totalShear.mul(0.38).add(ambientWaveZ.mul(uniforms.uPondRippleStrength))
        )
      );
    })();
  }

  // Hoist world macro watercolor wash via `varying` so vertex interpolates smooth regional color
  const vMacroWash = varying(
    Fn(() => {
      const wp = positionWorld;
      return fbmPaper2D(vec2(wp.x.mul(0.44).add(3.1), wp.z.mul(0.44).sub(wp.y.mul(0.28))));
    })()
  );

  // Fragment Color Node: True Watercolor Wash × Compressed Origami Paper Synthesis
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const pLocal = positionLocal;
    const nw = normalWorld;
    const varAttr = aVariation;
    const cardUV = hasCardAttr ? aCardCoord : vec2(pLocal.x, pLocal.y);
    const macroWash = vMacroWash;

    // 1. Wide, Feathered Watercolor Envelope (`revealMask` upright, `outerWashMask` reflected)
    let waterHitXZ: any = vec2(wp.x, wp.z);
    let visibilityEnvelope: any = float(1.0);

    if (isReflected) {
      const camPos = cameraPosition;
      const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
      const tWater = clamp(camPos.y.sub(WATER_LEVEL_Y).div(rayDenom), float(0.0), float(1.0));
      waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);
      visibilityEnvelope = evaluatePondOuterWashMask(waterHitXZ, uniforms);
    } else {
      const revealMask = evaluateDioramaWashReveal(wp, uniforms);
      const crownEnv = isTrunk || isFoliage ? evaluateCanopyCrownEnvelope(wp, uniforms) : float(1.0);
      visibilityEnvelope = smoothstep(float(0.01), float(0.62), revealMask).mul(crownEnv);
    }

    // 2. Cold-Press Washi Bast Fibers, Per-Piece Hand-Brushed Puddles & Chromatographic Granulation
    const fiberBaseUV = vec2(
      wp.x.mul(6.8).add(varAttr.z.mul(11.3)),
      wp.y.mul(8.4).add(wp.z.mul(6.8))
    );
    const fiberCurl = fbmPaper2D(fiberBaseUV);
    const strandCoord = vec2(
      fiberBaseUV.x.mul(2.6).add(fiberCurl.mul(1.8)),
      fiberBaseUV.y.mul(0.95).sub(fiberCurl.mul(1.2))
    );
    const kozoFibers = fbmPaper2D(strandCoord.mul(2.4).add(vec2(4.7, 8.3)));

    // Medium-scale wet-on-wet watercolor cauliflower/backrun bloom across the scene
    const wetBackrun = fbmPaper2D(
      vec2(wp.x.mul(1.35).sub(wp.y.mul(0.75)), wp.z.mul(1.35).add(wp.y.mul(0.85))).add(
        vec2(fiberCurl.mul(0.35), float(0.0))
      )
    );
    const washBloomMod = macroWash
      .sub(0.5)
      .mul(0.36)
      .add(wetBackrun.sub(0.5).mul(0.34))
      .mul(uniforms.uWatercolorBleed.mul(0.65).add(0.35));

    // Per-Piece Hand-Painted Watercolor Wash Coordinates (`pieceWashUV` & `brushLoadRamp`):
    // - Individual instanced pieces (`shingle`, `foliage`, `trunk`) get unique per-piece hand-brushed puddles in `cardUV`!
    // - Continuous sculpted sheet (`head/face` & `forearms`) uses continuous 3D sheet coordinates so facial folds stay seamless!
    // - Bank & stones get multi-scale overlapping wet-on-wet brush puddles!
    const seedVec = vec2(varAttr.z.mul(13.7).add(1.9), varAttr.z.mul(8.3).add(4.7));
    const warpJitter = vec2(fiberCurl.sub(0.5).mul(0.34), kozoFibers.sub(0.5).mul(0.26));

    const pieceWashUV = isSculptedShell
      ? vec2(
          pLocal.x.mul(3.1).add(pLocal.z.mul(1.9)),
          pLocal.y.mul(3.1).sub(pLocal.z.mul(1.5))
        ).add(warpJitter)
      : hasCardAttr
        ? vec2(
            cardUV.x.mul(isTrunk ? 2.1 : 1.55),
            cardUV.y.mul(isTrunk ? 2.8 : 1.35)
          )
            .add(seedVec)
            .add(warpJitter)
        : isStone
          ? vec2(wp.x.mul(9.2).add(varAttr.z.mul(11.1)), wp.z.mul(9.2).add(wp.y.mul(5.4))).add(warpJitter)
          : vec2(wp.x.mul(1.85), wp.z.mul(2.15)).add(warpJitter);

    const sheetPuddle = fbmPaper2D(pieceWashUV);

    // Directional hand-brush pigment loading across each cut paper piece (pools toward lower/outer belly, lifts at brush tail)
    const strokeAngle = varAttr.z.sub(0.5).mul(1.15);
    const cardAlong = cardUV.x.mul(sin(strokeAngle)).sub(cardUV.y.mul(cos(strokeAngle)));
    const brushLoadRamp = isSculptedShell
      ? smoothstep(float(-0.42), float(0.42), sheetPuddle.sub(0.5).mul(0.75).sub(cardUV.y.mul(0.55)))
      : hasCardAttr
        ? smoothstep(float(-0.44), float(0.44), cardAlong.add(fiberCurl.sub(0.5).mul(0.28)))
        : isStone
          ? float(1.0).sub(smoothstep(float(0.01), float(0.14), abs(wp.y.sub(WATER_LEVEL_Y))))
          : fbmPaper2D(vec2(wp.x.mul(3.4).add(5.2), wp.z.mul(3.6).sub(2.1)));

    // Gentle brush-bristle channel flow (*Sujime* — 2-3 soft wash channels per strip, NOT fine woodgrain stripes)
    const sujimeFlow = hasCardAttr
      ? sin(cardUV.x.mul(8.5).add(fiberCurl.mul(1.7)).add(varAttr.z.mul(6.28))).mul(0.08)
      : float(0.0);

    // Evaporative *Fuchidori* Watermark Rings inside each painted piece (cauliflower backrun iso-contour + cut-tip meniscus)
    const backrunIso = sheetPuddle.sub(0.43);
    const cauliflowerRing = exp(backrunIso.mul(backrunIso).mul(-115.0));
    const cutTipMeniscusDist = cardUV.y.add(0.34).add(fiberCurl.sub(0.5).mul(0.09));
    const pieceTipFuchidori = hasCardAttr
      ? exp(cutTipMeniscusDist.mul(cutTipMeniscusDist).mul(-135.0)).mul(isSculptedShell ? 0.42 : 0.85)
      : float(0.0);

    const sheetFuchidori = cauliflowerRing
      .mul(isSculptedShell ? 0.36 : 0.58)
      .add(pieceTipFuchidori.mul(0.52))
      .mul(uniforms.uWatercolorBleed.mul(0.72).add(0.28));

    // *Kasure* Dry-Brush Skips & Wet-in-Wet Water-Bloom Thinning (lets `#f2ebd9` Washi paper glow inside painted pieces!)
    const waterBloomLift = float(1.0).sub(smoothstep(float(0.18), float(0.45), sheetPuddle));
    const toothPeakSkip = smoothstep(float(0.54), float(0.85), kozoFibers.mul(0.55).add(fiberCurl.mul(0.45))).mul(
      uniforms.uPaperTooth
    );
    const kasurePaperLift = clamp(
      waterBloomLift
        .mul(isSculptedShell ? 0.36 : 0.54)
        .add(toothPeakSkip.mul(0.30).mul(float(1.0).sub(brushLoadRamp.mul(0.45)))),
      float(0.0),
      float(0.72)
    );

    // Stokes Cold-Press Mineral Granulation (pigment grains settling into paper tooth valleys)
    const granulationValley = float(1.0)
      .sub(smoothstep(float(0.20), float(0.54), fiberCurl))
      .mul(kozoFibers)
      .mul(uniforms.uPaperTooth);

    // Chromatographic Separation Coordinate (*Bunjin-ka*: 0 = thin tea/gold halo, 1 = pooled mineral pigment core)
    const chromaPoolMix = clamp(
      sheetPuddle.mul(0.52).add(brushLoadRamp.mul(0.38)).add(granulationValley.mul(0.24)),
      float(0.0),
      float(1.0)
    );

    const paperToothMod = granulationValley
      .mul(0.26)
      .add(fiberCurl.sub(0.5).mul(0.16).mul(uniforms.uPaperTooth))
      .add(sujimeFlow);

    // 3. Origami Crease Ridges, Valley Pigment Pools & Deckle/Cut-Edge Paper Thinning
    const mountainCreaseMask = hasCardAttr
      ? exp(abs(cardUV.x).mul(-16.0)).mul(isSculptedShell ? 0.58 : 0.88)
      : float(0.0);

    const valleyTroughPool = hasCardAttr
      ? smoothstep(float(0.18), float(0.46), abs(cardUV.x)).mul(isFoliage ? 0.28 : 0.18)
      : float(0.0);

    const tuckedUnderlapShadow = isShingle
      ? smoothstep(float(0.16), float(0.46), cardUV.y).mul(0.24).mul(uniforms.uShingleRoughness)
      : isSculptedShell
        ? smoothstep(float(0.22), float(0.46), cardUV.y).mul(0.18).mul(uniforms.uShingleRoughness)
        : isFoliage
          ? smoothstep(float(0.16), float(0.38), cardUV.y).mul(0.20).mul(uniforms.uShingleRoughness)
          : isTrunk
            ? smoothstep(float(0.22), float(0.44), cardUV.y).mul(0.18).mul(uniforms.uShingleRoughness)
            : float(0.0);

    // Lower cut/deckle edge & fold ridge where watercolor film thins so warm `#f2ebd9` Washi glows through!
    const cutEdgeThinMask = hasCardAttr
      ? float(1.0)
          .sub(smoothstep(float(-0.50), float(-0.36).add(fiberCurl.sub(0.5).mul(0.09)), cardUV.y))
          .mul(isSculptedShell ? 0.38 : 0.66)
      : float(0.0);

    // Evaporative *Fuchidori* pigment ring where watercolor washes dry along outer vignette margins!
    const fuchidoriMarginRing = smoothstep(float(0.08), float(0.26), visibilityEnvelope)
      .mul(float(1.0).sub(smoothstep(float(0.26), float(0.54), visibilityEnvelope)))
      .mul(uniforms.uWatercolorBleed)
      .mul(isGuardian ? 0.38 : 0.74);

    // 4. Hand-Painted Chromatographic Mass-Tones (`baseMassTone`) & Film Thickness (`roleBaseThickness`)
    let baseMassTone: any = vec3(uniforms.uShingleWeather);
    let bankTuckShadow: any = float(0.0);
    let roleBaseThickness: any = float(0.72);

    if (isGuardian) {
      // Hand-painted watercolor strips & sculpted paper facets:
      // - Silver-driftwood shingles chromatographically separate between warm ochre-tea wash halos
      //   and granulating mineral slate-indigo / raw-umber pools!
      // - Collar pleats separate between glowing golden-ochre and deep burnt-sienna chestnut!
      const warmMix = clamp(varAttr.y, float(0.0), float(1.0));
      const shingleVar = clamp(varAttr.x, float(-0.95), float(0.95));
      const plankShift = shingleVar
        .mul(isSculptedShell ? 0.08 : 0.11)
        .add(macroWash.sub(0.5).mul(0.07));
      const deepHollowShadow = clamp(varAttr.x.negate().sub(1.0), float(0.0), float(1.0));

      const silverTeaHalo = vec3(uniforms.uShingleWeather).mul(vec3(1.12, 1.04, 0.88));
      const silverSlatePool = vec3(uniforms.uShingleWeather).mul(vec3(0.84, 0.88, 0.96));
      const handPaintedSilver = mix(silverTeaHalo, silverSlatePool, chromaPoolMix);

      const collarGoldHalo = mix(
        vec3(uniforms.uCollarWarmCedar).mul(vec3(1.22, 1.12, 0.86)),
        vec3(uniforms.uPondAmberTannin).mul(1.28),
        float(0.38)
      );
      const collarChestnutPool = vec3(uniforms.uCollarWarmCedar).mul(vec3(0.86, 0.72, 0.64));
      const handPaintedCollar = mix(collarGoldHalo, collarChestnutPool, chromaPoolMix);

      const dryWash = mix(handPaintedSilver, handPaintedCollar, warmMix).add(vec3(plankShift));

      const heightAboveWater = abs(wp.y.sub(WATER_LEVEL_Y));
      const dampShoreWick = float(1.0)
        .sub(smoothstep(float(0.01), float(0.24), heightAboveWater))
        .mul(smoothstep(float(-0.34), float(0.30), wp.z));
      const dampTint = mix(
        vec3(uniforms.uPondAmberTannin),
        vec3(uniforms.uPondDeepMoss).mul(1.20),
        float(0.45)
      );

      const dampGuardian = mix(dryWash, dampTint, dampShoreWick.mul(0.48));
      const withEyeHollow = mix(dampGuardian, vec3(0.14, 0.10, 0.08), deepHollowShadow.mul(0.93));
      baseMassTone = clamp(
        withEyeHollow.mul(float(1.0).sub(tuckedUnderlapShadow)),
        vec3(0.06),
        vec3(0.92)
      );
      roleBaseThickness = mix(float(0.66), float(1.02), max(warmMix.mul(0.75), deepHollowShadow))
        .add(brushLoadRamp.mul(isSculptedShell ? 0.16 : 0.28))
        .add(shingleVar.mul(-0.10))
        .add(valleyTroughPool);
    } else if (isFoliage) {
      // Hand-painted botanical watercolor paper sprays:
      // Chromatographic separation within EACH folded leaf spray (gamboge/gold wash -> celadon/olive or burnt-sienna pool)!
      const elevY = abs(wp.y.sub(WATER_LEVEL_Y));
      const regionalX = wp.x.add(macroWash.sub(0.5).mul(0.85));
      const leftRussetWash = smoothstep(float(-0.65), float(-2.45), regionalX).mul(
        smoothstep(float(0.65), float(1.55), elevY)
      );
      const rightGoldenWash = smoothstep(float(0.75), float(2.55), regionalX);

      const oliveHalo = mix(vec3(uniforms.uCanopyOlive).mul(1.26), vec3(0.68, 0.62, 0.26), float(0.42));
      const olivePool = mix(vec3(uniforms.uCanopyOlive).mul(0.86), vec3(0.18, 0.34, 0.28), float(0.45));
      const handPaintedOlive = mix(oliveHalo, olivePool, chromaPoolMix);

      const autumnGoldHalo = vec3(0.76, 0.52, 0.22);
      const autumnSiennaPool = vec3(0.48, 0.23, 0.13);
      const handPaintedAutumn = mix(autumnGoldHalo, autumnSiennaPool, chromaPoolMix);

      const sunlitOchreWash = mix(
        vec3(0.74, 0.68, 0.32),
        vec3(uniforms.uCanopyOlive).mul(1.05),
        chromaPoolMix
      );

      const warmAttr = clamp(varAttr.y, float(0.0), float(1.0));
      let zoneColor: any = handPaintedOlive;
      zoneColor = mix(zoneColor, handPaintedAutumn, max(leftRussetWash.mul(0.84), warmAttr.mul(0.74)));
      zoneColor = mix(zoneColor, sunlitOchreWash, rightGoldenWash.mul(0.76));

      const tierShift = varAttr.x.mul(0.07).add(wetBackrun.sub(0.5).mul(0.08));
      baseMassTone = clamp(
        zoneColor.add(vec3(tierShift)).mul(float(1.0).sub(tuckedUnderlapShadow.mul(0.85))),
        vec3(0.10),
        vec3(0.92)
      );
      roleBaseThickness = float(0.38)
        .add(brushLoadRamp.mul(0.32))
        .add(washBloomMod.mul(0.38))
        .add(valleyTroughPool);
    } else if (isTrunk) {
      // Hand-painted bark-sheet paper cylinders: warm buff-ochre wash separating into cool slate-sepia + mossy base wick!
      const barkWarmHalo = vec3(uniforms.uLeafLitter).mul(vec3(1.10, 1.02, 0.88));
      const barkSlatePool = vec3(uniforms.uShingleWeather).mul(vec3(0.64, 0.66, 0.72));
      const barkChromatography = mix(barkWarmHalo, barkSlatePool, chromaPoolMix);

      const baseMossWick = float(1.0).sub(
        smoothstep(float(0.06), float(0.68), abs(wp.y.sub(WATER_LEVEL_Y)).add(fiberCurl.sub(0.5).mul(0.16)))
      );
      const weatheredBark = mix(
        barkChromatography,
        vec3(uniforms.uCanopyOlive).mul(0.88),
        baseMossWick.mul(0.46)
      );

      baseMassTone = clamp(
        weatheredBark.add(vec3(varAttr.x.mul(0.06))).mul(float(1.0).sub(tuckedUnderlapShadow)),
        vec3(0.12),
        vec3(0.86)
      );
      roleBaseThickness = float(0.48)
        .add(brushLoadRamp.mul(0.26))
        .add(washBloomMod.mul(0.32))
        .add(valleyTroughPool);
    } else if (isBank) {
      // Hand-painted cove paper sheet: overlapping ochre, burnt-sienna & olive-moss puddles with visible watermark blooms!
      const shoreZ = evaluateShorelineZ(wp.x);
      const distBehind = max(shoreZ.sub(wp.z), float(0.0));
      const tuckCoord = distBehind
        .mul(1.15)
        .add(wp.x.mul(0.08))
        .add(macroWash.sub(0.5).mul(0.30));
      const tuckFract = tuckCoord.sub(floor(tuckCoord));
      bankTuckShadow = smoothstep(float(0.82), float(0.98), tuckFract)
        .mul(0.12)
        .mul(uniforms.uShingleRoughness)
        .mul(smoothstep(float(0.14), float(0.62), distBehind));

      const ochreHalo = vec3(uniforms.uPondAmberTannin).mul(vec3(1.28, 1.18, 0.92));
      const siennaPool = vec3(uniforms.uLeafLitter).mul(vec3(0.98, 0.86, 0.78));
      const siennaOchre = mix(ochreHalo, siennaPool, chromaPoolMix);

      const mossyPatch = smoothstep(float(0.46), float(0.82), macroWash.mul(0.65).add(sheetPuddle.mul(0.35))).mul(0.42);
      const leafLitterWash = mix(siennaOchre, vec3(uniforms.uCanopyOlive).mul(1.06), mossyPatch);

      const distToWater = wp.z.sub(shoreZ).add(kozoFibers.sub(0.5).mul(0.05));
      const capillaryWetness = smoothstep(float(-0.36), float(0.01), distToWater);
      const wetShoreColor = mix(
        vec3(uniforms.uPondAmberTannin).mul(0.84),
        vec3(uniforms.uPondDeepMoss).mul(1.05),
        smoothstep(float(-0.14), float(0.01), distToWater)
      );

      baseMassTone = mix(leafLitterWash, wetShoreColor, capillaryWetness.mul(0.84));
      roleBaseThickness = float(0.38)
        .add(brushLoadRamp.mul(0.28))
        .add(washBloomMod.mul(0.46))
        .add(capillaryWetness.mul(0.28));
    } else if (isStone) {
      // Hand-painted folded limestone paper facets: mineral slate-buff wash + ochre-moss puddles + Washi highlights!
      const stoneBuffHalo = vec3(0.73, 0.66, 0.53);
      const stoneMineralPool = mix(vec3(0.44, 0.46, 0.42), vec3(uniforms.uCanopyOlive).mul(0.92), brushLoadRamp.mul(0.50));
      const paintedStone = mix(stoneBuffHalo, stoneMineralPool, chromaPoolMix);
      baseMassTone = clamp(paintedStone.add(vec3(varAttr.x.mul(0.07))), vec3(0.22), vec3(0.88));
      roleBaseThickness = float(0.50).add(brushLoadRamp.mul(0.28)).add(washBloomMod.mul(0.26));
    }

    // 5. Physical Kubelka-Munk 2-Flux Film Thickness `d`:
    // Combines *kasure* dry-brush / water-bloom lifts, mountain-ridge & cut-edge paper thinning,
    // cold-press valley granulation, and evaporative *fuchidori* watermark rings!
    const ridgeAndEdgeThinning = clamp(
      mountainCreaseMask
        .mul(0.34)
        .add(cutEdgeThinMask.mul(0.48))
        .mul(uniforms.uShingleRoughness)
        .add(kasurePaperLift.mul(0.62)),
      float(0.0),
      float(0.82)
    );
    const rawThickness = roleBaseThickness
      .mul(float(1.0).sub(ridgeAndEdgeThinning))
      .add(paperToothMod)
      .add(sheetFuchidori.mul(0.38))
      .add(fuchidoriMarginRing.mul(0.44));

    const envelopeFade = smoothstep(float(0.01), float(0.52), visibilityEnvelope);
    const effectiveThickness = max(float(0.0), rawThickness.mul(envelopeFade));

    const kmColor = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      baseMassTone,
      vec3(1.16, 1.12, 1.08),
      effectiveThickness
    );

    // 6. Paper-Facet Lighting + Golden Sun Clearing Rim
    const ySign = float(isReflected ? -1.0 : 1.0);
    const keyLightDir = vec3(0.44, float(0.75).mul(ySign), 0.49);
    const sunClearingDir = vec3(0.58, float(0.46).mul(ySign), -0.66);

    const fiberNormalPerturb = vec3(
      kozoFibers.sub(0.5).mul(0.09).mul(uniforms.uPaperTooth),
      float(0.0),
      fiberCurl.sub(0.5).mul(0.09).mul(uniforms.uPaperTooth)
    );
    const facetNormal = nw.add(fiberNormalPerturb);
    const nDotL = clamp(dot(facetNormal, keyLightDir), float(-1.0), float(1.0));

    const minShade = isFoliage ? float(0.85) : isBank ? float(0.88) : float(0.78);
    const maxShade = isFoliage ? float(1.07) : isBank ? float(1.03) : float(1.09);

    const rawShade = mix(minShade, maxShade, smoothstep(float(-0.34), float(0.66), nDotL));
    const lightingGate = smoothstep(float(0.04), float(0.42), visibilityEnvelope);
    const paperShade = mix(float(1.0), rawShade.sub(bankTuckShadow), lightingGate);

    const backRim = pow(clamp(dot(facetNormal, sunClearingDir), float(0.0), float(1.0)), float(2.1))
      .mul(isBank ? 0.025 : 0.09)
      .mul(lightingGate);

    const obliqueFacetCatch = pow(clamp(float(1.0).sub(abs(nw.y)), float(0.0), float(1.0)), float(2.3))
      .mul(isBank ? 0.012 : 0.038);
    const ridgeHighlight = mountainCreaseMask
      .mul(0.055)
      .add(obliqueFacetCatch)
      .mul(uniforms.uShingleRoughness)
      .mul(lightingGate);

    const shadedPaper = clamp(
      kmColor
        .mul(paperShade)
        .add(vec3(ridgeHighlight))
        .add(vec3(1.0, 0.90, 0.68).mul(backRim)),
      vec3(0.0),
      vec3(1.0)
    );

    if (isReflected) {
      // Crystal-legible Hero Guardian Reflection vs. Soft Watercolor Woodland Reflection (`Photo 1:1`!):
      // - Reflected Guardian (`isGuardian = true`) retains ~84% of its pale silver-Washi & warm-russet
      //   shingle clarity under a delicate olive-amber water tint (`d ≈ 0.14..0.22`)!
      // - Reflected Woodland (`!isGuardian`) dissolves gently into wet olive-tannin & sky watercolor streaks
      //   so background foliage never muddies or overpowers the figure's reflection!
      const depthBelow = clamp(float(WATER_LEVEL_Y).sub(wp.y), float(0.0), float(4.5));
      const washDiff = wetBackrun.sub(0.5).mul(0.18).mul(uniforms.uWatercolorBleed);

      if (isGuardian) {
        const guardianWaterGlaze = evalKubelkaMunk2Flux(
          shadedPaper.mul(vec3(0.95, 0.96, 0.89)),
          mix(vec3(uniforms.uPondAmberTannin), vec3(uniforms.uPondDeepMoss), float(0.38)),
          vec3(1.10, 1.14, 1.02),
          max(float(0.05), float(0.11).add(depthBelow.mul(0.045)).add(washDiff.mul(0.42)))
        );
        const outerPondFade = smoothstep(float(0.04), float(0.48), visibilityEnvelope);
        const finalGuardRefl = mix(vec3(uniforms.uPaperBacking), guardianWaterGlaze, outerPondFade);
        return srgbToLinearVec3(finalGuardRefl);
      }

      const treeGlazeDepth = float(0.30).add(depthBelow.mul(0.10)).add(washDiff);
      const oliveTreeReflect = evalKubelkaMunk2Flux(
        shadedPaper.mul(vec3(0.92, 0.94, 0.85)),
        mix(vec3(uniforms.uPondDeepMoss), vec3(uniforms.uPondAmberTannin), float(0.42)),
        vec3(1.08, 1.14, 0.98),
        max(float(0.10), treeGlazeDepth)
      );

      // Dissolve reflected woodland softly into wet watercolor pond wash (`0.35 -> 2.35m`) so trees read as dreamy watercolor wash!
      const deepWashDissolve = smoothstep(float(0.35), float(2.35), depthBelow.add(washDiff.mul(1.8)));
      const ambientPondWash = evalKubelkaMunk2Flux(
        uniforms.uPaperBacking,
        mix(vec3(uniforms.uPondAmberTannin), vec3(uniforms.uSkyHorizon), float(0.46)),
        vec3(1.12, 1.14, 1.08),
        float(0.34)
      );

      const waterMirrorTone = mix(oliveTreeReflect, ambientPondWash, deepWashDissolve.mul(0.74));
      // Fade reflected trees well inside the pond's outer watercolor puddle margin (`0.20 -> 0.70`) so zero jagged teeth appear!
      const outerTreeFade = smoothstep(float(0.20), float(0.70), visibilityEnvelope);
      const finalReflSrgb = mix(vec3(uniforms.uPaperBacking), waterMirrorTone, outerTreeFade);
      return srgbToLinearVec3(finalReflSrgb);
    }

    const finalFade = smoothstep(float(0.01), float(0.46), visibilityEnvelope);
    const finalSrgb = mix(vec3(uniforms.uPaperBacking), shadedPaper, finalFade);
    return srgbToLinearVec3(finalSrgb);
  })();

  // Binary Cardstock Clip (`alphaTest = 0.5`) — Zero Transparent Overdraw!
  mat.opacityNode = Fn(() => {
    const wp = positionWorld;

    if (isBank) {
      // Geometric Plane Separation Invariant:
      // `bankMesh` clips right at `shoreZ + 0.015` (overlapping the pond glaze start `-0.045..+0.015` with zero gap!)
      const shoreZ = evaluateShorelineZ(wp.x);
      const behindShore = float(1.0).sub(smoothstep(shoreZ.add(0.005), shoreZ.add(0.025), wp.z));
      const revealMask = evaluateDioramaWashReveal(wp, uniforms);
      return behindShore.mul(smoothstep(float(0.01), float(0.04), revealMask));
    }

    if (isReflected) {
      // Clip reflected geometry strictly below `WATER_LEVEL_Y`, in front of `shoreZ - 0.14`, and inside outer Washi margin
      const belowWater = smoothstep(float(WATER_LEVEL_Y + 0.004), float(WATER_LEVEL_Y - 0.004), wp.y);
      const camPos = cameraPosition;
      const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
      const tWater = clamp(camPos.y.sub(WATER_LEVEL_Y).div(rayDenom), float(0.0), float(1.0));
      const waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);
      const shoreZAtHit = evaluateShorelineZ(waterHitXZ.x);
      const inPondBasin = smoothstep(shoreZAtHit.sub(0.16), shoreZAtHit.sub(0.02), waterHitXZ.y);
      const outerMask = evaluatePondOuterWashMask(waterHitXZ, uniforms);
      return belowWater.mul(inPondBasin).mul(smoothstep(float(0.01), float(0.03), outerMask));
    }

    const revealMask = evaluateDioramaWashReveal(wp, uniforms);
    const crownEnv = isTrunk || isFoliage ? evaluateCanopyCrownEnvelope(wp, uniforms) : float(1.0);
    return smoothstep(float(0.01), float(0.03), revealMask.mul(crownEnv));
  })();

  return mat;
}
