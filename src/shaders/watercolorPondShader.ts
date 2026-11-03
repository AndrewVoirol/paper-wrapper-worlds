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
  pow,
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
  evaluateShorelineZ,
  evaluatePondBasinMask,
  srgbToLinearVec3,
} from './paperCraftShader';

/**
 * Evaluates a single physical radial capillary-gravity ripple ring at world XZ
 * from a Vec4 impulse `(originX, originZ, birthTime, strength)`.
 */
function evaluateSingleRipple(xz_in: any, rippleVec_in: any, time_in: any): any {
  const xz = vec2(xz_in);
  const rv = rippleVec_in;
  const age = max(float(time_in).sub(rv.z), float(0.0));
  const activeGate = smoothstep(float(0.0), float(0.05), age).mul(
    float(1.0).sub(smoothstep(float(3.2), float(4.8), age))
  );
  const dist = length(xz.sub(rv.xy));
  const waveRadius = age.mul(1.25);
  const envelope = exp(dist.sub(waveRadius).mul(dist.sub(waveRadius)).mul(-3.6)).mul(
    exp(age.mul(-0.68))
  );
  const phase = dist.sub(waveRadius).mul(16.0);
  return sin(phase).mul(envelope).mul(rv.w).mul(activeGate);
}

/**
 * Creates the Subtle Wet-on-Wet Botanical Watercolor Sky Wash Material (`skyBackdropMesh`).
 * Nestled on a concave curved backdrop behind the woodland trunks & vaulted paper canopy:
 * - Upper arch (`y ≈ 2.0 -> 3.55m`): delicate slate-celadon watercolor wash with drifted dry-paper cloud clearings.
 * - Woodland clearing horizon (`y ≈ 0.45 -> 1.95m`): warm golden-ochre mist framing the Guardian's silhouette.
 * - Feathers to exact `0.000` RGB delta (`srgbToLinearVec3`) and `0.0` alpha inside raw Washi margins on all sides.
 */
export function createWatercolorSkyMaterial(
  uniforms: PaperSceneUniforms
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;

  const evaluateSkyEnvelope = Fn(([wp_in]: [any]) => {
    const wp = vec3(wp_in);
    const t = uniforms.uTime;

    const bleedBroad = fbmPaper2D(vec2(wp.x.mul(0.72), wp.y.mul(0.84).add(1.7))).sub(0.5).mul(0.46);
    const bleedFine = fbmPaper2D(vec2(wp.x.mul(2.6).add(4.1), wp.y.mul(2.5))).sub(0.5).mul(0.14);
    const bleed = bleedBroad.add(bleedFine).mul(uniforms.uWatercolorBleed.mul(0.55).add(0.45));

    // Broad, calm wet-on-wet oval/dome wash on the flat background sheet (no cylinder wrap!)
    // Rises cleanly ABOVE the stacked canopy arch (`canopy top ≈ 2.86m` vs `sky wash top ≈ 3.88m`)
    // while still feathering seamlessly to 0.000 inside the raw Washi paper margin (`y_top ≈ 4.30m`)!
    const widthScale = mix(float(3.05), float(3.38), uniforms.uRevealMode);
    const nx = wp.x.div(widthScale);
    const ny = wp.y.sub(2.15).div(1.78);
    const domeDist = length(vec2(nx, ny)).add(bleed.mul(0.32));

    const domeWash = float(1.0).sub(smoothstep(float(0.58), float(1.02), domeDist));
    const bottomHorizonFade = smoothstep(float(0.28), float(1.05), wp.y.add(bleed.mul(0.25)));

    // Gentle drifted dry-paper cloud clearings inside the upper sky band
    const cloudField = fbmPaper2D(vec2(wp.x.mul(0.62).sub(t.mul(0.010)), wp.y.mul(1.18).add(2.3)));
    const cloudSoftness = float(1.0).sub(smoothstep(float(0.60), float(0.90), cloudField).mul(0.34));

    return clamp(domeWash.mul(bottomHorizonFade).mul(cloudSoftness), float(0.0), float(1.0));
  });

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const t = uniforms.uTime;
    const skyEnv = evaluateSkyEnvelope(wp);

    const paperTooth = fbmPaper2D(vec2(wp.x.mul(5.6), wp.y.mul(5.6).add(wp.z.mul(2.2))));
    const mistFlow = fbmPaper2D(vec2(wp.x.mul(1.15).add(t.mul(0.01)), wp.y.mul(1.45)));

    // Warm sunlit clearing glow low between trunks -> cool atmospheric celadon-slate zenith above canopy
    const horizonToZenith = smoothstep(float(0.75), float(2.45), wp.y.add(mistFlow.sub(0.5).mul(0.42)));
    const skyPigment = mix(
      vec3(uniforms.uSkyHorizon),
      vec3(uniforms.uSkyZenith),
      horizonToZenith
    );

    // Delicate wet-on-wet Fuchidori whisper near the upper watercolor wash boundary
    const upperRimPinning = smoothstep(float(0.08), float(0.26), skyEnv)
      .mul(float(1.0).sub(smoothstep(float(0.26), float(0.52), skyEnv)))
      .mul(uniforms.uWatercolorBleed)
      .mul(0.08);

    // Thin Kubelka-Munk watercolor glaze (`d ≈ 0.0 .. 0.34`) so warm #f2ebd9 Washi fibers glow right through
    const dSky = float(0.30)
      .add(mistFlow.sub(0.5).mul(0.12))
      .add(paperTooth.sub(0.5).mul(0.11).mul(uniforms.uPaperTooth))
      .add(upperRimPinning)
      .mul(smoothstep(float(0.0), float(0.68), skyEnv));

    const skyWashSrgb = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      skyPigment,
      vec3(1.12, 1.14, 1.18),
      dSky
    );

    const finalSrgb = mix(
      vec3(uniforms.uPaperBacking),
      skyWashSrgb,
      smoothstep(float(0.01), float(0.22), skyEnv)
    );
    return srgbToLinearVec3(finalSrgb);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const skyEnv = evaluateSkyEnvelope(wp);
    return smoothstep(float(0.01), float(0.32), skyEnv).mul(0.92);
  })();

  return mat;
}

/**
 * Creates the Tightly Bound Kubelka-Munk Watercolor Pond Surface Material (`pondMesh`).
 * Reflects the subtle watercolor sky wash in canopy openings while feathering seamlessly into Washi paper.
 */
export function createWatercolorPondMaterial(
  uniforms: PaperSceneUniforms
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const t = uniforms.uTime;

    const pondBasinMask = evaluatePondBasinMask(xz, uniforms);

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

    const warpedXZ = xz.add(
      vec2(totalRipple.mul(0.13), float(ambientWave2.mul(0.075).mul(uniforms.uPondRippleStrength)))
    );

    // 2. Paper substrate tooth & multi-layer watercolor wash granulation
    const paperTooth = fbmPaper2D(xz.mul(5.4));
    const washFlow = fbmPaper2D(warpedXZ.mul(1.55).add(vec2(t.mul(0.025), float(0.0))));
    const washDetail = fbmPaper2D(warpedXZ.mul(3.9).sub(vec2(float(0.0), t.mul(0.035))));

    // 3. Mirrored Sky Zones on the Pond Surface:
    //    (a) Central Archway Opening (`archSkyWindow`: behind the reflected Guardian's crown)
    //    (b) Open Sky ABOVE the Stacked Canopy Arch (`aboveCanopySkyBand`: foreground pond crescent `z > reflectedCanopyOuterZ`)
    //    (c) Subtle sky gaps between reflected trunks
    const archSkyWindow = float(1.0)
      .sub(smoothstep(float(0.48), float(0.96), abs(warpedXZ.x)))
      .mul(smoothstep(float(0.96), float(1.26), warpedXZ.y))
      .mul(float(1.0).sub(smoothstep(float(1.48), float(1.74), warpedXZ.y)));

    // Inverted arch contour on the water plane (`z ≈ 1.94` at center, curving back to `~1.38` on flanks)
    const reflectedCanopyOuterZ = float(1.94)
      .sub(warpedXZ.x.mul(warpedXZ.x).mul(0.13))
      .add(washFlow.sub(0.5).mul(0.18));
    const aboveCanopySkyBand = smoothstep(
      reflectedCanopyOuterZ.sub(0.12),
      reflectedCanopyOuterZ.add(0.20),
      warpedXZ.y
    );

    const trunkFreq = sin(warpedXZ.x.mul(4.4).add(washFlow.mul(1.4)))
      .mul(0.5)
      .add(0.5);
    const branchCanopy = fbmPaper2D(vec2(warpedXZ.x.mul(2.8), warpedXZ.y.mul(1.6)));
    const interTrunkGaps = smoothstep(float(0.58), float(0.86), trunkFreq.mul(0.55).add(branchCanopy.mul(0.5)))
      .mul(smoothstep(float(0.75), float(1.95), abs(warpedXZ.x)))
      .mul(float(1.0).sub(aboveCanopySkyBand));

    const skyReflectionMask = clamp(
      max(max(archSkyWindow.mul(0.95), aboveCanopySkyBand), interTrunkGaps.mul(0.38)),
      float(0.0),
      float(1.0)
    );

    // 4. Shoreline, submerged-hand & delicate outer wash pinning
    const shoreZ = evaluateShorelineZ(xz.x);
    const distFromShore = max(xz.y.sub(shoreZ), float(0.0));
    const shoreMeniscusRing = exp(distFromShore.mul(-5.8)).mul(
      smoothstep(float(0.02), float(0.16), distFromShore)
    );

    const dLeftHand = length(xz.sub(vec2(-1.38, 0.38)));
    const dRightHand = length(xz.sub(vec2(1.22, 0.38)));
    const handWaterRing = exp(dLeftHand.sub(0.46).mul(dLeftHand.sub(0.46)).mul(-18.0)).add(
      exp(dRightHand.sub(0.46).mul(dRightHand.sub(0.46)).mul(-18.0))
    );

    const goldenSunWindow = smoothstep(float(0.85), float(2.35), warpedXZ.x).mul(
      smoothstep(float(0.35), float(1.65), warpedXZ.y)
    );
    const crimsonMapleReflection = smoothstep(float(-0.45), float(-2.35), warpedXZ.x).mul(
      float(1.0).sub(aboveCanopySkyBand)
    );

    const outerWashRing = smoothstep(float(0.12), float(0.30), pondBasinMask).mul(
      float(1.0).sub(smoothstep(float(0.30), float(0.56), pondBasinMask))
    );

    const totalPinning = shoreMeniscusRing
      .mul(0.55)
      .add(handWaterRing.mul(0.62))
      .add(outerWashRing.mul(0.12))
      .mul(uniforms.uWatercolorBleed);

    // 5. Physical Kubelka-Munk 2-Flux Glaze Evaluation
    const washThicknessEnvelope = smoothstep(float(0.0), float(0.50), pondBasinMask);

    // Reflected watercolor sky glaze (`uSkyHorizon` in inner arch clearing -> `uSkyZenith` above canopy)
    const skyCloudSoft = fbmPaper2D(vec2(warpedXZ.x.mul(0.65).sub(t.mul(0.01)), warpedXZ.y.mul(1.15).add(3.1)));
    const skyCloudClear = float(1.0).sub(smoothstep(float(0.62), float(0.90), skyCloudSoft).mul(0.28));
    const skyZenithMix = smoothstep(float(1.18), float(1.92), warpedXZ.y);
    const reflectedSkyPigment = mix(
      vec3(uniforms.uSkyHorizon),
      vec3(uniforms.uSkyZenith),
      skyZenithMix.mul(0.92).add(0.08)
    );
    const dSkyRefl = float(0.38)
      .add(washFlow.sub(0.5).mul(0.10))
      .add(paperTooth.sub(0.5).mul(0.09).mul(uniforms.uPaperTooth))
      .add(outerWashRing.mul(0.09).mul(uniforms.uWatercolorBleed))
      .mul(skyCloudClear)
      .mul(washThicknessEnvelope);

    const reflectedSkyBase = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      reflectedSkyPigment,
      vec3(1.12, 1.14, 1.18),
      dSkyRefl
    );

    // Botanical tannin & moss glazes drop all the way to 0.00 in open sky reflection zones
    // (critical in Kubelka-Munk because dark moss R_inf.b = 0.12 has K/S = 3.23 and turns blue sky green even at 10%!)
    const canopyShadowWeight = pow(clamp(float(1.0).sub(skyReflectionMask), float(0.0), float(1.0)), float(1.65));

    const dTannin = float(0.56)
      .add(washFlow.mul(0.68))
      .add(paperTooth.sub(0.5).mul(0.32).mul(uniforms.uPaperTooth))
      .add(totalPinning.mul(0.52))
      .mul(canopyShadowWeight)
      .mul(washThicknessEnvelope);

    const layer1Tannin = evalKubelkaMunk2Flux(
      reflectedSkyBase,
      uniforms.uPondAmberTannin,
      vec3(1.18, 1.12, 1.02),
      dTannin
    );

    const dMoss = float(0.38)
      .add(washDetail.mul(0.76))
      .add(totalPinning.mul(0.68))
      .add(totalRipple.abs().mul(0.22))
      .mul(canopyShadowWeight)
      .mul(washThicknessEnvelope);

    const layer2Moss = evalKubelkaMunk2Flux(
      layer1Tannin,
      uniforms.uPondDeepMoss,
      vec3(1.06, 1.14, 0.98),
      dMoss
    );

    // 6. Physical Fresnel grazing sky/paper sheen + ripple crest delicacy
    const viewDir = normalize(cameraPosition.sub(wp));
    const cosTheta = clamp(viewDir.y, float(0.05), float(1.0));
    const fresnel = float(0.04).add(
      float(0.96).mul(
        float(1.0).sub(cosTheta).mul(float(1.0).sub(cosTheta)).mul(float(1.0).sub(cosTheta))
      )
    );

    const rippleHighlight = smoothstep(float(0.18), float(0.62), dynamicRipples.abs())
      .mul(0.24)
      .add(fresnel.mul(0.20).add(skyReflectionMask.mul(0.32)).add(goldenSunWindow.mul(0.22).mul(canopyShadowWeight)))
      .mul(washThicknessEnvelope);

    const mapleTintedWater = mix(
      layer2Moss,
      vec3(0.52, 0.27, 0.19),
      crimsonMapleReflection.mul(0.34).mul(canopyShadowWeight).mul(washThicknessEnvelope)
    );

    const glazedWater = mix(
      mapleTintedWater,
      reflectedSkyBase,
      clamp(rippleHighlight, float(0.0), float(0.80))
    );

    const finalSrgb = mix(
      vec3(uniforms.uPaperBacking),
      glazedWater,
      smoothstep(float(0.01), float(0.22), pondBasinMask)
    );
    return srgbToLinearVec3(finalSrgb);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const pondBasinMask = evaluatePondBasinMask(xz, uniforms);

    const guardianWindowX = float(1.0).sub(smoothstep(float(0.88), float(1.95), abs(xz.x)));
    const guardianWindowZ = smoothstep(float(0.18), float(0.58), xz.y).mul(
      float(1.0).sub(smoothstep(float(1.52), float(1.88), xz.y))
    );
    const reflectionTranslucency = guardianWindowX.mul(guardianWindowZ);

    const baseOpacity = mix(float(0.90), float(0.46), reflectionTranslucency);
    return baseOpacity.mul(smoothstep(float(0.0), float(0.42), pondBasinMask));
  })();

  return mat;
}
