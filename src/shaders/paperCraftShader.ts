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
} from 'three/tsl';
import { DEFAULT_PARAMS, PALETTE_PRESETS, type PaperPalettePreset } from '../types';

/**
 * Shared uniform bundle for the entire Paper-Wrapper Worlds scene so all TSL materials
 * (shingle guardian, origami canopy, pleated paper trunks, 6-layer torn-paper island,
 * subtle watercolor sky wash, and Kubelka-Munk pond) respond instantaneously (< 0.05 ms).
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
  public readonly uBrushRadius = uniform(2.15);
  public readonly uBrushActive = uniform(0.0);

  // 4 persistent wash trail stamps inside the central vignette
  public readonly uWashTrail0 = uniform(new THREE.Vector4(-1.65, -0.55, 2.35, 0.96));
  public readonly uWashTrail1 = uniform(new THREE.Vector4(1.65, -0.45, 2.35, 0.94));
  public readonly uWashTrail2 = uniform(new THREE.Vector4(0.0, 1.95, 2.50, 0.95));
  public readonly uWashTrail3 = uniform(new THREE.Vector4(0.0, -1.35, 2.45, 0.94));

  // 4 interactive pond droplet ripples (x = worldX, y = worldZ, z = birthTime, w = strength)
  public readonly uRipple0 = uniform(new THREE.Vector4(0.0, 1.15, -99.0, 0.0));
  public readonly uRipple1 = uniform(new THREE.Vector4(-0.95, 0.85, -99.0, 0.0));
  public readonly uRipple2 = uniform(new THREE.Vector4(0.95, 0.88, -99.0, 0.0));
  public readonly uRipple3 = uniform(new THREE.Vector4(0.0, 1.75, -99.0, 0.0));

  // Palette color uniforms (stored as sRGB [0..1] in THREE.Vector3; converted via exact IEC sRGB->Linear at output)
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
    // Derive uPaperBacking from the exact hex string used by scene.background for 0.000 LSB parity
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
 * Shared shoreline curve `z = shoreZ(x)` in world coordinates.
 */
export function evalShorelineZJS(x: number): number {
  const absX = Math.abs(x);
  const t = Math.max(0, Math.min(1, (absX - 0.9) / (2.4 - 0.9)));
  const smoothFlank = t * t * (3 - 2 * t);
  return 0.20 + Math.cos(x * 0.95) * 0.10 + smoothFlank * 0.18;
}

export const evaluateShorelineZ = Fn(([x_in]: [any]) => {
  const x = float(x_in);
  return float(0.20)
    .add(cos(x.mul(0.95)).mul(0.10))
    .add(smoothstep(float(0.9), float(2.4), abs(x)).mul(0.18));
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
 * Evaluates the tightly bound (~6.3m span) 3D diorama wash envelope.
 */
export const evaluateDioramaWashReveal = Fn(([worldPos_in, uniforms]: [any, PaperSceneUniforms]) => {
  const wp = vec3(worldPos_in);
  const xz = vec2(wp.x, wp.z);

  const fbmBroad = fbmPaper2D(xz.mul(0.95)).sub(0.5).mul(0.42);
  const fbmFine = fbmPaper2D(xz.mul(3.6).add(vec2(7.1, 3.9))).sub(0.5).mul(0.16);
  const edgePerturb = fbmBroad.add(fbmFine).mul(uniforms.uWatercolorBleed.mul(0.65).add(0.35));

  const centeredXZ = vec2(xz.x.div(3.30), xz.y.sub(0.58).div(3.36));
  const normDist = length(centeredXZ);

  const outerVignetteWall = float(1.0).sub(
    smoothstep(float(0.76), float(1.01), normDist.add(edgePerturb.mul(0.55)))
  );

  const baseCoreMask = float(1.0).sub(
    smoothstep(float(0.62), float(0.91), normDist.add(edgePerturb.mul(0.70)))
  );

  const dCursor = length(xz.sub(vec2(uniforms.uCursorWorld.x, uniforms.uCursorWorld.z)));
  const cursorMask = float(1.0)
    .sub(smoothstep(uniforms.uBrushRadius.mul(0.35), uniforms.uBrushRadius, dCursor.add(edgePerturb.mul(0.85))))
    .mul(uniforms.uBrushActive);

  const d0 = length(xz.sub(uniforms.uWashTrail0.xy));
  const m0 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail0.z.mul(0.42), uniforms.uWashTrail0.z, d0.add(edgePerturb.mul(0.9))))
    .mul(uniforms.uWashTrail0.w);

  const d1 = length(xz.sub(uniforms.uWashTrail1.xy));
  const m1 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail1.z.mul(0.42), uniforms.uWashTrail1.z, d1.add(edgePerturb.mul(0.9))))
    .mul(uniforms.uWashTrail1.w);

  const d2 = length(xz.sub(uniforms.uWashTrail2.xy));
  const m2 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail2.z.mul(0.42), uniforms.uWashTrail2.z, d2.add(edgePerturb.mul(0.9))))
    .mul(uniforms.uWashTrail2.w);

  const d3 = length(xz.sub(uniforms.uWashTrail3.xy));
  const m3 = float(1.0)
    .sub(smoothstep(uniforms.uWashTrail3.z.mul(0.42), uniforms.uWashTrail3.z, d3.add(edgePerturb.mul(0.9))))
    .mul(uniforms.uWashTrail3.w);

  const interactiveRaw = max(max(baseCoreMask, cursorMask), max(max(m0, m1), max(m2, m3)));
  const interactiveBound = min(interactiveRaw, outerVignetteWall);

  return clamp(mix(interactiveBound, outerVignetteWall, uniforms.uRevealMode), float(0.0), float(1.0));
});

/**
 * Evaluates the upper canopy crown arch bound (`y` up to ~3.45m at center, curving down on flanks).
 * Unlike before, solid cut-paper leaves & trunks stay 100% crisp and opaque inside the canopy crown,
 * and only lighten their cardstock glaze gracefully at the very outermost crown arch tips!
 */
export const evaluateCanopyCrownEnvelope = Fn(([worldPos_in, uniforms]: [any, PaperSceneUniforms]) => {
  const wp = vec3(worldPos_in);
  const fbmCrown = fbmPaper2D(vec2(wp.x.mul(1.75), wp.y.mul(1.65).add(wp.z.mul(1.1)))).sub(0.5).mul(0.32);
  const archDrop = wp.x.div(2.95).mul(wp.x.div(2.95)).mul(0.52);
  const effectiveY = wp.y.add(archDrop).add(fbmCrown.mul(uniforms.uWatercolorBleed.mul(0.5).add(0.4)));
  return float(1.0).sub(smoothstep(float(3.45), float(3.92), effectiveY));
});

/**
 * Shared oval foreground watercolor pond basin mask (`xz` in world coordinates).
 */
export const evaluatePondBasinMask = Fn(([xz_in, uniforms]: [any, PaperSceneUniforms]) => {
  const xz = vec2(xz_in);
  const shoreZ = evaluateShorelineZ(xz.x);

  const washBroad = fbmPaper2D(xz.mul(1.15).add(vec2(2.4, 5.1))).sub(0.5).mul(0.32);
  const washFine = fbmPaper2D(xz.mul(4.2).add(vec2(8.2, 1.7))).sub(0.5).mul(0.11);
  const washBleed = washBroad.add(washFine).mul(uniforms.uWatercolorBleed.mul(0.65).add(0.35));

  const ovalVec = vec2(xz.x.div(2.68), xz.y.sub(1.98).div(1.96));
  const ovalDist = length(ovalVec).add(washBleed.mul(0.60));
  const outerOvalFade = float(1.0).sub(smoothstep(float(0.54), float(0.99), ovalDist));

  const shoreDist = xz.y.sub(shoreZ).add(washFine.mul(0.35));
  const shoreFade = smoothstep(float(0.01), float(0.38), shoreDist);

  const revealMask = evaluateDioramaWashReveal(vec3(xz.x, float(0.0), xz.y), uniforms);
  return clamp(
    outerOvalFade.mul(shoreFade).mul(smoothstep(float(0.04), float(0.38), revealMask)),
    float(0.0),
    float(1.0)
  );
});

/**
 * Builds a physical Creased & Curled Paper Strip BufferGeometry (`width = 1`, `length = 1`)
 * with non-indexed flat-faceted creases and explicit per-card `aCardCoord` (`vec2`).
 */
export function createCreasedPaperStripGeometry(): THREE.BufferGeometry {
  const segX = 4;
  const segY = 4;
  const indexedGeom = new THREE.BoxGeometry(1.0, 1.0, 0.22, segX, segY, 1);

  const posIdx = indexedGeom.attributes.position as THREE.BufferAttribute;
  const cardIdx = new Float32Array(posIdx.count * 2);

  for (let i = 0; i < posIdx.count; i++) {
    let x = posIdx.getX(i);
    const y = posIdx.getY(i);
    let z = posIdx.getZ(i);

    cardIdx[i * 2 + 0] = x;
    cardIdx[i * 2 + 1] = y;

    const v = 0.5 - y;
    const absX = Math.abs(x);

    const tipTaper = 1.0 - Math.max(0, v - 0.65) * 0.28;
    x *= tipTaper;

    const centerCreaseZ = (0.5 - absX) * 0.28;
    const bottomCurlZ = Math.pow(Math.max(0, v), 2.2) * 0.34;
    const edgeWaveZ = Math.sin(x * Math.PI * 2.0) * 0.04 * v;

    z += centerCreaseZ + bottomCurlZ + edgeWaveZ;
    posIdx.setXYZ(i, x, y, z);
  }

  indexedGeom.setAttribute('aCardCoord', new THREE.BufferAttribute(cardIdx, 2));
  const geom = indexedGeom.toNonIndexed();
  indexedGeom.dispose();
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a Continuous 6-Sided Folded Kraft-Paper Trunk Geometry (`height = 1`, `y in [-0.5, +0.5]`).
 * - Single clean continuous hexagonal folded-paper column from gentle root flare to crown
 *   (no segmented cone skirts, no jagged teeth, and no white border outlines).
 * - Non-indexed flat vertical facets so each of the 6 folded paper sides catches calm planar light.
 */
export function createSculptedPaperTrunkGeometry(): THREE.BufferGeometry {
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

  const numSides = 6;
  const numStations = 8;

  const evalRingPoint = (sFrac: number, sideIdx: number) => {
    const y = -0.5 + sFrac;
    const rootFlare = Math.exp(-sFrac * 7.5) * 0.22;
    const radius = 0.96 - sFrac * 0.30 + rootFlare;
    const swayX = Math.sin(sFrac * Math.PI) * 0.042;
    const swayZ = Math.sin(sFrac * Math.PI * 0.8) * 0.022;
    const twist = sFrac * 0.14;
    const angle = (sideIdx / numSides) * Math.PI * 2 + twist;
    return {
      x: Math.sin(angle) * radius + swayX,
      y,
      z: Math.cos(angle) * radius + swayZ,
      cv: -0.35 + sFrac * 0.82,
    };
  };

  for (let i = 0; i < numStations; i++) {
    const t0 = i / numStations;
    const t1 = (i + 1) / numStations;
    for (let j = 0; j < numSides; j++) {
      const pBL = evalRingPoint(t0, j);
      const pBR = evalRingPoint(t0, j + 1);
      const pTR = evalRingPoint(t1, j + 1);
      const pTL = evalRingPoint(t1, j);

      pushQuad(
        pBL.x, pBL.y, pBL.z, -0.22, pBL.cv,
        pBR.x, pBR.y, pBR.z, 0.22, pBR.cv,
        pTR.x, pTR.y, pTR.z, 0.22, pTR.cv,
        pTL.x, pTL.y, pTL.z, -0.22, pTL.cv
      );
    }
  }

  for (let j = 0; j < numSides; j++) {
    const p0 = evalRingPoint(1.0, j);
    const p1 = evalRingPoint(1.0, j + 1);
    pushTri(0, 0.5, 0, 0.0, 0.45, p0.x, p0.y, p0.z, 0.2, 0.45, p1.x, p1.y, p1.z, 0.2, 0.45);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a Smoothly Curved 6-Sided Folded-Paper Y-Limb Geometry (`t in [0, 1]`).
 * Starts vertically (`tangent = +Y`) at `(0, 0, 0)` so it emerges seamlessly out of a trunk
 * without jagged stick intersections, curving gently upward into the stacked canopy sheets.
 */
export function createFoldedPaperLimbGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];

  const numSides = 6;
  const numSegs = 8;

  const evalCenter = (t: number) =>
    new THREE.Vector3(t * t * 0.56, t * 0.88 - t * t * 0.14, t * t * 0.06);

  const rings: Array<Array<{ p: THREE.Vector3; cv: number }>> = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const refZ = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i <= numSegs; i++) {
    const t = i / numSegs;
    const c = evalCenter(t);
    const cNext = evalCenter(Math.min(1.0, t + 0.02));
    const cPrev = evalCenter(Math.max(0.0, t - 0.02));
    tangent.subVectors(cNext, cPrev).normalize();
    normal.crossVectors(tangent, refZ).normalize();
    binormal.crossVectors(normal, tangent).normalize();

    const r = 0.132 * (1.0 - t * 0.44);
    const cv = 0.05 + t * 0.42;
    const ring: Array<{ p: THREE.Vector3; cv: number }> = [];
    for (let j = 0; j <= numSides; j++) {
      const a = (j / numSides) * Math.PI * 2;
      const pt = c
        .clone()
        .addScaledVector(normal, Math.cos(a) * r)
        .addScaledVector(binormal, Math.sin(a) * r);
      ring.push({ p: pt, cv });
    }
    rings.push(ring);
  }

  for (let i = 0; i < numSegs; i++) {
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
        -0.2, bL.cv, 0.2, bR.cv, 0.2, tR.cv,
        -0.2, bL.cv, 0.2, tR.cv, -0.2, tL.cv
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
 * Builds a Thin, Gently Flexed Washi Paper Canopy Sheet Geometry (`[-0.5, +0.5]` in X & Z).
 * Its outer silhouette is torn organically in the TSL fragment shader via 2-scale `fbmPaper2D`
 * (`evaluateFoliageDeckleRadius`)—matching the 6-sheet torn-paper terrain island 1:1 without
 * thick foam-board walls or round geometric disc edges!
 */
export function createFoldedPaperLeafGeometry(): THREE.BufferGeometry {
  const segX = 16;
  const segZ = 16;
  const thickness = 0.014;
  const indexed = new THREE.BoxGeometry(1.0, thickness, 1.0, segX, 1, segZ);

  const pos = indexed.attributes.position as THREE.BufferAttribute;
  const card = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r2 = x * x + z * z;
    // Subtle natural paper flex so parallel stacked sheets catch gentle light gradients
    const paperFlex = (0.25 - r2) * 0.055;
    pos.setY(i, y + paperFlex);
    card[i * 2 + 0] = x;
    card[i * 2 + 1] = z;
  }

  indexed.setAttribute('aCardCoord', new THREE.BufferAttribute(card, 2));
  const nonIndexed = indexed.toNonIndexed();
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

export type PaperMaterialRole =
  | 'shingle'
  | 'foliage'
  | 'trunk'
  | 'bank'
  | 'stone'
  | 'reflected-shingle'
  | 'reflected-foliage'
  | 'reflected-trunk';

/**
 * Creates the TSL Tactile Cut-Paper, 6-Sheet Torn-Paper Island & Origami Canopy Material.
 */
export function createPaperShingleMaterial(
  uniforms: PaperSceneUniforms,
  options: { role: PaperMaterialRole }
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();

  const isReflected =
    options.role === 'reflected-shingle' ||
    options.role === 'reflected-foliage' ||
    options.role === 'reflected-trunk';
  const isShingle = options.role === 'shingle' || options.role === 'reflected-shingle';
  const isFoliage = options.role === 'foliage' || options.role === 'reflected-foliage';
  const isTrunk = options.role === 'trunk' || options.role === 'reflected-trunk';
  const isBank = options.role === 'bank';
  const hasCardAttr = isShingle || isFoliage || isTrunk;

  const aVariation = attribute('aVariation', 'vec3');
  const aCardCoord = hasCardAttr ? attribute('aCardCoord', 'vec2') : vec2(0.0, 0.0);

  // Vertex stage: gentle foliage sway & underwater capillary ripple distortion
  if (isFoliage && !isReflected) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const breeze = uniforms.uWindBreeze;
      const swayX = sin(t.mul(1.35).add(wp.x.mul(0.7)).add(wp.z.mul(0.5)))
        .mul(0.036)
        .mul(breeze);
      const swayZ = cos(t.mul(1.1).add(wp.z.mul(0.8)))
        .mul(0.028)
        .mul(breeze);
      return pos.add(vec3(swayX, float(0.0), swayZ));
    })();
  } else if (isReflected) {
    mat.positionNode = Fn(() => {
      const pos = positionLocal;
      const wp = positionWorld;
      const t = uniforms.uTime;
      const rippleWave = sin(wp.z.mul(8.5).sub(t.mul(2.4)).add(wp.x.mul(3.5)))
        .mul(0.042)
        .mul(uniforms.uPondRippleStrength);
      return pos.add(vec3(rippleWave, float(0.0), rippleWave.mul(0.45)));
    })();
  }

  // Torn-paper embankment island progress (`1.0` at core, `0.0` at outer 6th torn sheet rim)
  const evaluateBankSheetProgress = Fn(([wp_in]: [any]) => {
    const wp = vec3(wp_in);
    const xz = vec2(wp.x, wp.z);
    const revealMask = evaluateDioramaWashReveal(wp, uniforms);

    const tearBroad = fbmPaper2D(xz.mul(1.95).add(vec2(1.3, 4.7))).sub(0.5).mul(0.20);
    const tearFine = fbmPaper2D(xz.mul(8.2).add(vec2(5.9, 2.3))).sub(0.5).mul(0.075);
    const tearOffset = tearBroad.add(tearFine);

    // Elliptical 6-sheet embankment centered behind guardian at (0, -0.84), half-axes (3.26m, 1.84m)
    const bankEllip = length(vec2(xz.x.div(3.26), xz.y.add(0.84).div(1.84))).add(tearOffset);
    const radialSheet = clamp(float(1.04).sub(bankEllip).div(0.64), float(0.0), float(1.0));

    return radialSheet.mul(smoothstep(float(0.04), float(0.42), revealMask));
  });

  // Hand-torn deckle contour radius for stacked canopy Washi sheets (`< 0.88` inside torn sheet)
  const evaluateFoliageDeckleRadius = Fn(([cuv_in, phase_in]: [any, any]) => {
    const cuv = vec2(cuv_in);
    const seed = vec2(phase_in.mul(13.7).add(2.1), phase_in.mul(7.9).add(5.4));
    const tearBroad = fbmPaper2D(cuv.mul(3.5).add(seed)).sub(0.5).mul(0.24);
    const tearFine = fbmPaper2D(cuv.mul(12.0).add(seed.mul(1.9))).sub(0.5).mul(0.085);
    // Subtle botanical kidney asymmetry + 2-scale FBM deckle tear (matching the 6-sheet terrain!)
    const kidneyShiftZ = cuv.y.add(cuv.x.mul(cuv.x).mul(0.18).sub(0.03));
    const ellipR = length(vec2(cuv.x.mul(1.86), kidneyShiftZ.mul(2.04)));
    return ellipR.add(tearBroad).add(tearFine);
  });

  // Fragment Color Node (evaluates in sRGB palette space, then outputs exact IEC Linear RGB)
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const pLocal = positionLocal;
    const nw = normalWorld;
    const varAttr = aVariation;
    const cardUV = hasCardAttr ? aCardCoord : vec2(pLocal.x, pLocal.y);

    const revealMask = evaluateDioramaWashReveal(wp, uniforms);
    const crownEnv = isTrunk || (isFoliage && !isReflected)
      ? evaluateCanopyCrownEnvelope(wp, uniforms)
      : float(1.0);

    // 1. Multi-scale paper bast fiber & woodblock striation coordinates
    const grainUV = vec2(
      wp.x.mul(7.2).add(varAttr.z.mul(17.3)),
      wp.y.mul(15.5).add(wp.z.mul(7.2))
    );
    const fiberPrimary = fbmPaper2D(grainUV);
    const fiberFine = fbmPaper2D(grainUV.mul(3.4).add(vec2(4.2, 9.1)));

    // 2. Cut-Paper Sheet Anatomy (`aCardCoord`):
    // - Shingles keep full rectangular perimeter deckle + central spine crease + woodgrain striation.
    // - Stacked Canopy Sheets (`isFoliage`) use true 2-scale FBM deckle-torn contours + delicate cream fiber rim + inter-sheet shadow (matching the 6-sheet terrain 1:1!).
    // - Smooth Folded Trunks (`isTrunk`) rely purely on calm 6-sided planar facets + subtle bast tooth.
    const edgeNoise = fiberFine.sub(0.5).mul(0.14);
    const distEdgeX = abs(cardUV.x).add(edgeNoise.mul(0.55));
    const distEdgeY = abs(cardUV.y).add(edgeNoise.mul(0.55));
    const folDeckleR = isFoliage ? evaluateFoliageDeckleRadius(cardUV, varAttr.z) : float(0.0);
    const cardEdgeMetric = isShingle ? max(distEdgeX, distEdgeY) : float(0.0);

    // Delicate raw-cream Washi fiber rim along shingle edges & hand-torn canopy sheet edges
    const deckleRimMask = isShingle
      ? smoothstep(float(0.35), float(0.475), cardEdgeMetric)
      : isFoliage
        ? smoothstep(float(0.73), float(0.865), folDeckleR)
        : float(0.0);

    // Subtle paper drop-shadow crease along outer card edge
    const cutLineInk = isShingle
      ? smoothstep(float(0.445), float(0.492), cardEdgeMetric)
          .mul(0.25)
          .mul(uniforms.uShingleRoughness)
      : isFoliage
        ? smoothstep(float(0.83), float(0.89), folDeckleR)
            .mul(0.12)
            .mul(uniforms.uShingleRoughness)
        : float(0.0);

    // Central fold highlight ONLY on Guardian shingles
    const origamiSpineHighlight = isShingle
      ? exp(abs(cardUV.x).mul(-16.0))
          .mul(0.12)
          .mul(uniforms.uShingleRoughness)
      : float(0.0);

    // Soft ambient drop shadow cast by the next smaller parallel sheet stacked directly above (`varAttr.x < 0.25`)
    const hasUpperStackSheet = float(1.0).sub(smoothstep(float(0.18), float(0.30), varAttr.x));
    const topUnderlapShadow = isShingle
      ? smoothstep(float(0.14), float(0.46), cardUV.y)
          .mul(0.26)
          .mul(uniforms.uShingleRoughness)
      : isFoliage
        ? float(1.0)
            .sub(smoothstep(float(0.44), float(0.68), folDeckleR))
            .mul(hasUpperStackSheet)
            .mul(0.19)
            .mul(uniforms.uShingleRoughness)
        : isTrunk
          ? smoothstep(float(0.28), float(0.48), cardUV.y)
              .mul(0.22)
              .mul(uniforms.uShingleRoughness)
          : float(0.0);

    const paperGrainStriation = sin(
      cardUV.x.mul(36.0).add(varAttr.z.mul(23.0)).add(fiberPrimary.mul(4.5))
    )
      .mul(0.5)
      .add(0.5);

    const toothEffect = fiberPrimary
      .sub(0.5)
      .mul(0.28)
      .add(fiberFine.sub(0.5).mul(0.16))
      .mul(uniforms.uPaperTooth);

    // 3. Target mass-tone reflectance R_inf by material role
    let baseMassTone: any = vec3(uniforms.uShingleWeather);
    let bankSheetThicknessScale: any = float(1.0);
    let bankStepCreaseShadow: any = float(0.0);
    let bankDeckleRimLift: any = float(0.0);

    if (isShingle) {
      const warmMix = clamp(varAttr.y, float(0.0), float(1.0));
      const toneShift = varAttr.x.mul(0.13);
      const rawCedar = mix(
        vec3(uniforms.uShingleWeather).mul(1.08),
        vec3(uniforms.uCollarWarmCedar).mul(1.12),
        warmMix
      );
      const grainMod = mix(
        float(1.0),
        float(0.80).add(paperGrainStriation.mul(0.26)).sub(topUnderlapShadow),
        uniforms.uShingleRoughness
      );
      baseMassTone = clamp(rawCedar.add(vec3(toneShift)).mul(grainMod), vec3(0.09), vec3(0.94));
    } else if (isFoliage) {
      // Calm, matte watercolor-glazed cut-paper canopy sheets (stepped tonally by sheet tier via varAttr.x)
      const canopyShift = varAttr.x.mul(0.14);
      const autumnWarmth = clamp(varAttr.y, float(0.0), float(1.0));
      const crimsonMaple = vec3(0.67, 0.30, 0.19);
      const oliveOrOchre = mix(
        vec3(uniforms.uCanopyOlive).mul(1.08).add(vec3(canopyShift)),
        vec3(uniforms.uCollarWarmCedar).mul(1.15),
        smoothstep(float(0.18), float(0.66), autumnWarmth)
      );
      const rawLeafTone = mix(
        oliveOrOchre,
        crimsonMaple.add(vec3(canopyShift.mul(0.48))),
        smoothstep(float(0.62), float(0.92), autumnWarmth)
      );
      const sheetMod = float(1.0)
        .add(fiberPrimary.sub(0.5).mul(0.08).mul(uniforms.uPaperTooth))
        .sub(topUnderlapShadow);
      baseMassTone = clamp(rawLeafTone.mul(sheetMod), vec3(0.10), vec3(0.92));
    } else if (isTrunk) {
      // Calm, matte 6-sided folded kraft-paper trunks & Y-limbs (subtle bast fiber, zero busy stripes)
      const rawBark = mix(
        vec3(uniforms.uShingleWeather).mul(0.86),
        vec3(uniforms.uCollarWarmCedar).mul(0.94),
        float(0.46).add(varAttr.y.mul(0.28))
      ).add(vec3(varAttr.x.mul(0.07)));
      const barkPaperMod = float(1.0)
        .add(fiberPrimary.sub(0.5).mul(0.12).mul(uniforms.uPaperTooth))
        .sub(topUnderlapShadow);
      baseMassTone = clamp(rawBark.mul(barkPaperMod), vec3(0.12), vec3(0.90));
    } else if (isBank) {
      // 6 Stacked Torn Deckle-Paper Sheets + Capillary Shoreline Wicking
      const sheetProg = evaluateBankSheetProgress(wp);
      const sheetCount = float(6.0);
      const sheetScaled = sheetProg.mul(sheetCount);
      const sheetIdx = floor(sheetScaled);
      const sheetFract = sheetScaled.sub(sheetIdx);

      // Quantized 6-sheet paper glaze progression: outer sheets step lighter toward raw cream Washi
      const quantLayer = clamp(sheetIdx.add(0.25).div(sheetCount), float(0.0), float(1.0));
      bankSheetThicknessScale = pow(mix(quantLayer, sheetProg, float(0.38)), float(1.32));

      // Bright exposed cream paper fiber rim at each of the 6 torn sheet edges (`sheetFract < 0.22`)
      const tornRim = float(1.0)
        .sub(smoothstep(float(0.03), float(0.23), sheetFract))
        .mul(smoothstep(float(0.04), float(0.20), sheetProg));
      bankDeckleRimLift = tornRim.mul(0.72);

      // Crisp paper drop-shadow crease right beneath each overlapping upper sheet (`sheetFract > 0.80`)
      bankStepCreaseShadow = smoothstep(float(0.79), float(0.97), sheetFract)
        .mul(0.15)
        .mul(uniforms.uShingleRoughness)
        .mul(smoothstep(float(0.10), float(0.38), sheetProg));

      const bankNoise = fbmPaper2D(vec2(wp.x.mul(2.1), wp.z.mul(2.1)));
      const dryBank = mix(
        vec3(uniforms.uLeafLitter).mul(1.14),
        vec3(uniforms.uCollarWarmCedar).mul(1.08),
        bankNoise
      );

      const shoreZ = evaluateShorelineZ(wp.x);
      const distToWater = wp.z.sub(shoreZ).add(fiberFine.sub(0.5).mul(0.14));
      const capillaryWetness = smoothstep(float(-0.34), float(0.06), distToWater);
      const wetShoreColor = mix(
        vec3(uniforms.uPondAmberTannin).mul(1.05),
        vec3(uniforms.uPondDeepMoss).mul(1.15),
        smoothstep(float(-0.14), float(0.08), distToWater)
      );

      baseMassTone = mix(dryBank, wetShoreColor, capillaryWetness.mul(0.76));
    } else if (options.role === 'stone') {
      const slateStone = mix(
        vec3(uniforms.uShingleWeather).mul(0.76),
        vec3(uniforms.uPondDeepMoss).mul(1.24),
        float(0.28)
      );
      baseMassTone = clamp(slateStone.add(vec3(varAttr.x.mul(0.09))), vec3(0.14), vec3(0.82));
    }

    // 4. Physical Kubelka-Munk film thickness (strong deckle thinning on leaves/trunks/shingles so raw cream edges pop!)
    const deckleStrength = isFoliage ? float(0.80) : float(0.74);
    const effectiveDeckleThinning = float(1.0)
      .sub(deckleRimMask.mul(deckleStrength))
      .mul(float(1.0).sub(bankDeckleRimLift));

    const visibilityEnvelope = smoothstep(float(0.02), float(0.45), revealMask)
      .mul(crownEnv)
      .mul(bankSheetThicknessScale);

    const baseThickness = float(isFoliage ? 1.08 : isBank ? 1.08 : 1.18)
      .mul(effectiveDeckleThinning)
      .add(toothEffect.mul(visibilityEnvelope))
      .mul(visibilityEnvelope);

    const effectiveThickness = max(float(0.0), baseThickness);

    const kmColor = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      baseMassTone,
      vec3(1.16, 1.12, 1.08),
      effectiveThickness
    );

    // 5. Crisp Flat-Faceted Origami & Cut-Paper Directional Lighting!
    // Upright foliage & pleated trunks now preserve full X/Z face normals so V-folds catch sharp 2-tone paper contrast!
    const keyLightDir = vec3(0.44, 0.76, 0.47);
    const goldenBacklightDir = vec3(0.55, 0.48, -0.68);
    const effectiveNormal = isReflected
      ? vec3(nw.x.mul(0.52), nw.y.abs().add(0.42), nw.z.mul(0.52))
      : isFoliage
        ? vec3(nw.x.mul(0.42), nw.y.mul(0.55).add(0.52), nw.z.mul(0.42))
        : isBank
          ? vec3(nw.x.mul(0.35), float(0.94), nw.z.mul(0.35))
          : nw;

    const nDotL = clamp(dot(effectiveNormal, keyLightDir), float(-1.0), float(1.0));
    const minShade = isFoliage ? float(0.85) : isBank ? float(0.91) : float(0.81);
    const maxShade = isFoliage ? float(1.05) : isBank ? float(1.03) : float(1.07);
    const rawShade = mix(minShade, maxShade, smoothstep(float(-0.28), float(0.68), nDotL));
    const lightingStrength = smoothstep(float(0.02), float(0.36), visibilityEnvelope);
    const paperShade = mix(
      float(1.0),
      rawShade.sub(cutLineInk).sub(bankStepCreaseShadow),
      lightingStrength
    );

    const backRim = pow(clamp(dot(effectiveNormal, goldenBacklightDir), float(0.0), float(1.0)), float(2.0))
      .mul(isBank ? 0.03 : isFoliage ? 0.06 : 0.10)
      .mul(lightingStrength);
    const creaseRidge = pow(clamp(float(1.0).sub(abs(effectiveNormal.y)), float(0.0), float(1.0)), float(2.0))
      .mul(isBank ? 0.02 : isTrunk ? 0.035 : isFoliage ? 0.04 : 0.07)
      .add(origamiSpineHighlight)
      .add(deckleRimMask.mul(isFoliage ? 0.14 : 0.08))
      .mul(uniforms.uShingleRoughness)
      .mul(lightingStrength);

    const shadedPaper = clamp(
      kmColor
        .mul(paperShade)
        .add(vec3(creaseRidge))
        .add(vec3(1.0, 0.91, 0.72).mul(backRim)),
      vec3(0.0),
      vec3(1.0)
    );

    if (isReflected) {
      const camPos = cameraPosition;
      const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
      const tWater = clamp(camPos.y.div(rayDenom), float(0.0), float(1.0));
      const waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);
      const pondMask = evaluatePondBasinMask(waterHitXZ, uniforms);

      const depthBelow = clamp(wp.y.negate(), float(0.0), float(2.6));
      const waterAtten = exp(depthBelow.mul(-0.52));
      const mossTint = evalKubelkaMunk2Flux(
        uniforms.uPaperBacking,
        uniforms.uPondDeepMoss,
        vec3(1.1, 1.15, 1.0),
        float(0.52)
      );
      const waterGlaze = mix(
        mossTint,
        shadedPaper.mul(vec3(0.88, 0.90, 0.78)),
        waterAtten.mul(0.72)
      );
      const reflBlend = smoothstep(float(0.08), float(0.52), pondMask);
      const finalReflSrgb = mix(vec3(uniforms.uPaperBacking), waterGlaze, reflBlend);
      return srgbToLinearVec3(finalReflSrgb);
    }

    const finalFade = smoothstep(float(0.01), float(0.18), visibilityEnvelope);
    const finalSrgb = mix(vec3(uniforms.uPaperBacking), shadedPaper, finalFade);
    return srgbToLinearVec3(finalSrgb);
  })();

  // Opacity Node:
  // - Bank: 6-sheet deckle outer rim + clean shoreline handoff
  // - Upright Trunks, Leaves & Stones: 100% OPAQUE crisp cut cardstock inside the canopy crown
  //   (alphaTest clip only at outer brush-reveal boundary so leaves never look like blurry ghosts!)
  if (isBank) {
    mat.transparent = true;
    mat.depthWrite = true;
    mat.alphaTest = 0.004;
    mat.opacityNode = Fn(() => {
      const wp = positionWorld;
      const sheetProg = evaluateBankSheetProgress(wp);
      const outerTornAlpha = smoothstep(float(0.025), float(0.11), sheetProg);

      const shoreZ = evaluateShorelineZ(wp.x);
      const fineShoreNoise = fbmPaper2D(vec2(wp.x.mul(6.2), wp.z.mul(6.2))).sub(0.5).mul(0.08);
      const underPondFade = float(1.0).sub(
        smoothstep(shoreZ.add(0.02), shoreZ.add(0.20), wp.z.add(fineShoreNoise))
      );

      return outerTornAlpha.mul(underPondFade);
    })();
  } else if (isReflected) {
    mat.transparent = true;
    mat.depthWrite = options.role === 'reflected-shingle';
    if (options.role === 'reflected-shingle') {
      mat.alphaTest = 0.02;
    }
    mat.opacityNode = Fn(() => {
      const wp = positionWorld;
      const camPos = cameraPosition;
      const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
      const tWater = clamp(camPos.y.div(rayDenom), float(0.0), float(1.0));
      const waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);
      const pondMask = evaluatePondBasinMask(waterHitXZ, uniforms);

      const depthFbm = fbmPaper2D(vec2(wp.x.mul(2.8), wp.y.mul(2.4))).sub(0.5).mul(0.28);
      const depthBelow = wp.y.negate().add(depthFbm);
      const depthFade = float(1.0).sub(smoothstep(float(1.05), float(1.68), depthBelow));
      const roleWeight = float(isFoliage ? 0.56 : isTrunk ? 0.72 : 0.92);
      const folTear = isFoliage
        ? float(1.0).sub(smoothstep(float(0.85), float(0.90), evaluateFoliageDeckleRadius(aCardCoord, aVariation.z)))
        : float(1.0);

      return smoothstep(float(0.18), float(0.58), pondMask).mul(depthFade).mul(roleWeight).mul(folTear);
    })();
  } else if (isFoliage || isTrunk || options.role === 'stone') {
    // Keep upright paper canopy sheets & folded trunks solid cardstock (`depthWrite = true`) with crisp FBM deckle tear!
    mat.transparent = true;
    mat.depthWrite = true;
    mat.alphaTest = 0.04;
    mat.opacityNode = Fn(() => {
      const wp = positionWorld;
      const revealMask = evaluateDioramaWashReveal(wp, uniforms);
      const crownEnv = isTrunk || isFoliage ? evaluateCanopyCrownEnvelope(wp, uniforms) : float(1.0);
      const folTear = isFoliage
        ? float(1.0).sub(smoothstep(float(0.85), float(0.895), evaluateFoliageDeckleRadius(aCardCoord, aVariation.z)))
        : float(1.0);
      return smoothstep(float(0.04), float(0.16), revealMask)
        .mul(smoothstep(float(0.02), float(0.14), crownEnv))
        .mul(folTear);
    })();
  }

  return mat;
}
