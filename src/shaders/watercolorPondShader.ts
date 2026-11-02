import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  float,
  sin,
  cos,
  mix,
  clamp,
  smoothstep,
  max,
  abs,
  exp,
  length,
  positionWorld,
  cameraPosition,
  normalize,
} from 'three/tsl';
import {
  type PaperSceneUniforms,
  fbmPaper2D,
  evalKubelkaMunk2Flux,
  evaluateDioramaWashReveal,
} from './paperCraftShader';

/**
 * Evaluates a single physical radial capillary-gravity ripple ring at world XZ
 * from a Vec4 impulse `(originX, originZ, birthTime, strength)`.
 * Zero hardcoded `(0,0)` vectors or polar star harmonics.
 */
function evaluateSingleRipple(xz_in: any, rippleVec_in: any, time_in: any): any {
  const xz = vec2(xz_in);
  const rv = rippleVec_in;
  const age = max(float(time_in).sub(rv.z), float(0.0));
  const activeGate = smoothstep(float(0.0), float(0.05), age).mul(
    float(1.0).sub(smoothstep(float(3.2), float(4.8), age))
  );
  const dist = length(xz.sub(rv.xy));
  const waveRadius = age.mul(1.35);
  const envelope = exp(dist.sub(waveRadius).mul(dist.sub(waveRadius)).mul(-3.2)).mul(
    exp(age.mul(-0.65))
  );
  const phase = dist.sub(waveRadius).mul(16.0);
  return sin(phase).mul(envelope).mul(rv.w).mul(activeGate);
}

/**
 * Creates the Layered Kubelka-Munk Watercolor Pond Surface Material.
 * Features:
 * 1. Semi-translucent multi-layer botanical watercolor washes (Deep Olive Moss + Amber Leaf-Litter Tannin)
 *    evaluated via Kubelka-Munk 2-flux transfer over the inverted reflection of the guardian & trees below.
 * 2. Continuous capillary wave ripples + 4 interactive pointer droplet impulses.
 * 3. Vertical forest canopy reflection streaks broken by horizontal water wave shear (matching the reference photo).
 * 4. Shoreline & submerged-hand evaporative contact-line pinning (*Fuchidori* dark pigment rings).
 */
export function createWatercolorPondMaterial(
  uniforms: PaperSceneUniforms
): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.roughness = 0.25;
  mat.metalness = 0.0;

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const t = uniforms.uTime;

    const revealMask = evaluateDioramaWashReveal(wp, uniforms);

    // 1. Ambient wind capillary waves + 4 interactive droplet ripples
    const ambientWave1 = sin(xz.y.mul(8.5).sub(t.mul(1.8)).add(sin(xz.x.mul(3.2)).mul(0.8)));
    const ambientWave2 = cos(xz.x.mul(6.2).add(xz.y.mul(5.4)).add(t.mul(1.3)));
    const r0 = float(evaluateSingleRipple(xz, uniforms.uRipple0, t));
    const r1 = float(evaluateSingleRipple(xz, uniforms.uRipple1, t));
    const r2 = float(evaluateSingleRipple(xz, uniforms.uRipple2, t));
    const r3 = float(evaluateSingleRipple(xz, uniforms.uRipple3, t));
    const dynamicRipples = r0.add(r1).add(r2).add(r3);

    const totalRipple = float(
      ambientWave1
        .mul(0.35)
        .add(ambientWave2.mul(0.25))
        .add(dynamicRipples.mul(1.8))
        .mul(uniforms.uPondRippleStrength)
    );

    // Perturbed reflection coordinates
    const warpedXZ = xz.add(
      vec2(totalRipple.mul(0.14), float(ambientWave2.mul(0.08).mul(uniforms.uPondRippleStrength)))
    );

    // 2. Paper substrate tooth & multi-layer watercolor wash granulation
    const paperTooth = fbmPaper2D(xz.mul(5.2));
    const washFlow = fbmPaper2D(warpedXZ.mul(1.45).add(vec2(t.mul(0.03), float(0.0))));
    const washDetail = fbmPaper2D(warpedXZ.mul(3.8).sub(vec2(float(0.0), t.mul(0.04))));

    // 3. Forest canopy vertical reflection bands & sky gaps (bright paper showing through canopy gaps,
    //    just like the bottom left/right of the user's photograph)
    const trunkFreq = sin(warpedXZ.x.mul(4.6).add(washFlow.mul(1.8)))
      .mul(0.5)
      .add(0.5);
    const branchCanopy = fbmPaper2D(vec2(warpedXZ.x.mul(3.4), warpedXZ.y.mul(1.6)));
    // Sky openings are stronger toward the left and right foreground pond corners
    const lateralSkyWeight = smoothstep(float(0.65), float(2.4), abs(warpedXZ.x)).mul(
      smoothstep(float(0.1), float(2.8), warpedXZ.y)
    );
    const skyGapMask = smoothstep(float(0.46), float(0.76), trunkFreq.mul(0.6).add(branchCanopy.mul(0.55)))
      .mul(lateralSkyWeight);

    // 4. Shoreline & submerged-paw contact-line pinning (Fuchidori)
    // Match the curved right-hand cove from the wide-angle photo: `shoreZ = 0.22 + 0.14 * cos(x * 0.85) + max(0, x - 1.85) * 0.42`
    const rightCoveOffset = max(float(0.0), xz.x.sub(1.85)).mul(0.42);
    const shoreZ = float(0.22).add(cos(xz.x.mul(0.85)).mul(0.14)).add(rightCoveOffset);
    const distFromShore = max(xz.y.sub(shoreZ), float(0.0));
    const shoreMenuRing = exp(distFromShore.mul(-5.5)).mul(
      smoothstep(float(0.0), float(0.08), distFromShore)
    );

    // Guardian's left and right hands rest right at the waterline: (-1.38, 0.38) and (1.22, 0.38)
    const dLeftHand = length(xz.sub(vec2(-1.38, 0.38)));
    const dRightHand = length(xz.sub(vec2(1.22, 0.38)));
    const handWaterRing = exp(dLeftHand.sub(0.48).mul(dLeftHand.sub(0.48)).mul(-18.0)).add(
      exp(dRightHand.sub(0.48).mul(dRightHand.sub(0.48)).mul(-18.0))
    );

    // Warm golden-hour sun glint on the right side of the pond (`x > 1.1`) + crimson maple reflection on the left (`x < -2.1`)
    const goldenSunWindow = smoothstep(float(1.1), float(3.2), warpedXZ.x).mul(
      smoothstep(float(0.25), float(1.9), warpedXZ.y)
    );
    const crimsonMapleReflection = smoothstep(float(-2.1), float(-4.2), warpedXZ.x).mul(
      float(1.0).sub(smoothstep(float(1.4), float(2.8), warpedXZ.y))
    );

    // Outer diorama wash boundary Fuchidori ring
    const outerEdgeRing = smoothstep(float(0.05), float(0.24), revealMask).mul(
      float(1.0).sub(smoothstep(float(0.24), float(0.52), revealMask))
    );

    const totalPinning = shoreMenuRing
      .mul(0.55)
      .add(handWaterRing.mul(0.65))
      .add(outerEdgeRing.mul(0.95))
      .mul(uniforms.uWatercolorBleed);

    // 5. Layered Kubelka-Munk 2-Flux Glaze Evaluation
    // Layer 1: Warm Amber-Ochre Tannin Wash over Washi Paper Backing
    const dTannin = float(0.75)
      .add(washFlow.mul(0.95))
      .add(paperTooth.sub(0.5).mul(0.45).mul(uniforms.uPaperTooth))
      .add(totalPinning.mul(0.65))
      .mul( float(1.0).sub(skyGapMask.mul(0.78)) );

    const layer1Tannin = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      uniforms.uPondAmberTannin,
      vec3(1.18, 1.12, 1.02),
      dTannin
    );

    // Layer 2: Deep Olive-Umbrous Woodland Moss Wash over Layer 1
    const dMoss = float(0.55)
      .add(washDetail.mul(1.05))
      .add(totalPinning.mul(0.95))
      .add(totalRipple.abs().mul(0.35))
      .mul( float(1.0).sub(skyGapMask.mul(0.85)) );

    const layer2Moss = evalKubelkaMunk2Flux(
      layer1Tannin,
      uniforms.uPondDeepMoss,
      vec3(1.05, 1.14, 0.98),
      dMoss
    );

    // 6. Physical Fresnel grazing sky/paper sheen + ripple crest ink delicacy
    const viewDir = normalize(cameraPosition.sub(wp));
    const cosTheta = clamp(viewDir.y, float(0.05), float(1.0));
    const fresnel = float(0.04).add(
      float(0.96).mul(
        float(1.0).sub(cosTheta).mul(float(1.0).sub(cosTheta)).mul(float(1.0).sub(cosTheta))
      )
    );

    const rippleHighlight = smoothstep(float(0.18), float(0.62), dynamicRipples.abs())
      .mul(0.28)
      .add(fresnel.mul(0.32).add(skyGapMask.mul(0.48)).add(goldenSunWindow.mul(0.38)));

    const mapleTintedWater = mix(
      layer2Moss,
      vec3(0.48, 0.24, 0.16),
      crimsonMapleReflection.mul(0.42)
    );

    const glazedWater = mix(
      mapleTintedWater,
      vec3(uniforms.uPaperBacking),
      clamp(rippleHighlight, float(0.0), float(0.84))
    );

    return mix(uniforms.uPaperBacking, glazedWater, smoothstep(float(0.01), float(0.25), revealMask));
  })();

  // Opacity Node: Semi-translucent over the guardian reflection in the center of the pond so the
  // upside-down wooden shingle sculpture shows through the olive-amber watercolor glazes, while
  // feathering cleanly into the paper background at the outer edges.
  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const revealMask = evaluateDioramaWashReveal(wp, uniforms);

    // Central reflection window where the inverted guardian sits (x in [-1.8..1.8], z in [0.2..2.9])
    const guardianWindowX = float(1.0).sub(smoothstep(float(0.95), float(2.35), abs(xz.x)));
    const guardianWindowZ = smoothstep(float(0.1), float(0.55), xz.y).mul(
      float(1.0).sub(smoothstep(float(2.1), float(3.4), xz.y))
    );
    const reflectionTranslucency = guardianWindowX.mul(guardianWindowZ);

    // Shoreline curve with right-hand cove offset
    const rightCoveOffset = max(float(0.0), xz.x.sub(1.85)).mul(0.42);
    const shoreZ = float(0.22).add(cos(xz.x.mul(0.85)).mul(0.14)).add(rightCoveOffset);
    const shoreTransition = smoothstep(shoreZ.sub(0.28), shoreZ.add(0.24), xz.y);

    // Feather the front and side edges of the rectangular pond mesh (`z > 3.8` or `|x| > 5.2`)
    const frontPondFade = float(1.0)
      .sub(smoothstep(float(3.45), float(4.95), xz.y))
      .mul(float(1.0).sub(smoothstep(float(4.8), float(6.2), abs(xz.x))));

    // Allow ~48% of the inverted 3D shingle guardian below the water plane to shine through
    const baseOpacity = mix(float(0.84), float(0.52), reflectionTranslucency);
    return baseOpacity
      .mul(shoreTransition)
      .mul(frontPondFade)
      .mul(smoothstep(float(0.02), float(0.32), revealMask));
  })();

  return mat;
}
