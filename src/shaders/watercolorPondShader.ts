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
  exp,
  length,
  positionWorld,
  cameraPosition,
  normalize,
} from 'three/tsl';
import {
  type PaperSceneUniforms,
  WATER_LEVEL_Y,
  fbmPaper2D,
  evaluateWashiPaperSheetSrgb,
  evalKubelkaMunk2Flux,
  evaluateShorelineZ,
  evaluatePondOuterWashMask,
  evaluatePondBasinMask,
  evaluateDynamicRipples,
  srgbToLinearVec3,
} from './paperCraftShader';

/**
 * Creates the Wet-on-Wet Botanical Watercolor Sky Wash Material (`skyMesh` & `skyReflMesh`).
 * - Upright (`isReflected = false`): Rises behind the late-autumn Bernheim woodland,
 *   transitioning from warm sunlit clearing mist (with a low afternoon sun glow on the right
 *   at `x ≈ +2.05, y ≈ +1.78` matching `IMG_0382`) to cool celadon-slate upper sky.
 * - Reflected (`isReflected = true`): Planar mirror (`y < WATER_LEVEL_Y`) clipped cleanly
 *   to `evaluatePondOuterWashMask(waterHitXZ)` so inter-branch sky windows and the foreground
 *   open sky gleam crisply between dark olive-umber reflected trunks and bare winter twigs.
 */
export function createWatercolorSkyMaterial(
  uniforms: PaperSceneUniforms,
  isReflected = false
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;

  const evaluateSkyWash = Fn(([wp_in]: [any]) => {
    const wp = vec3(wp_in);
    const t = uniforms.uTime;
    const skyY = isReflected ? float(2.0 * WATER_LEVEL_Y).sub(wp.y) : wp.y;

    const bleedBroad = fbmPaper2D(vec2(wp.x.mul(0.50), skyY.mul(0.54).add(1.7))).sub(0.5).mul(0.40);
    const bleedFine = fbmPaper2D(vec2(wp.x.mul(1.85).add(4.1), skyY.mul(1.8))).sub(0.5).mul(0.12);
    const bleed = bleedBroad.add(bleedFine).mul(uniforms.uWatercolorBleed.mul(0.55).add(0.45));

    const camPos = cameraPosition;
    const rayDenom = max(camPos.y.sub(wp.y), float(0.001));
    const tWater = clamp(camPos.y.sub(WATER_LEVEL_Y).div(rayDenom), float(0.0), float(1.0));
    const waterHitXZ = mix(vec2(camPos.x, camPos.z), vec2(wp.x, wp.z), tWater);

    const widthScale = mix(float(4.42), float(4.92), uniforms.uRevealMode);
    const sampleX = isReflected ? waterHitXZ.x : wp.x;
    const nx = sampleX.div(widthScale);
    const domeCenterY = float(isReflected ? 2.45 : 1.72);
    const domeHalfY = float(isReflected ? 3.55 : 1.68);
    const ny = skyY.sub(domeCenterY).div(domeHalfY);
    const domeDist = length(vec2(nx, ny)).add(bleed.mul(0.28));

    const domeWash = isReflected
      ? float(1.0)
      : float(1.0).sub(smoothstep(float(0.46), float(1.00), domeDist));
    // Upright sky fades near ground; reflected sky stays solid down to `skyY = 0` so near-shore water reflects dark bank earth
    const horizonFade = isReflected
      ? float(1.0)
      : smoothstep(float(0.05), float(0.52), skyY.add(bleed.mul(0.22)));

    const cloudField = fbmPaper2D(vec2(wp.x.mul(0.44).sub(t.mul(0.007)), skyY.mul(0.78).add(2.3)));
    const cloudSoftness = float(1.0).sub(smoothstep(float(0.58), float(0.92), cloudField).mul(0.32));

    let env: any = clamp(domeWash.mul(horizonFade).mul(cloudSoftness), float(0.0), float(1.0));

    if (isReflected) {
      const shoreZAtHit = evaluateShorelineZ(waterHitXZ.x);
      const inPondBasin = smoothstep(shoreZAtHit.sub(0.12), shoreZAtHit.add(0.008), waterHitXZ.y);
      const outerMask = evaluatePondOuterWashMask(waterHitXZ, uniforms);
      const belowWater = smoothstep(float(WATER_LEVEL_Y + 0.008), float(WATER_LEVEL_Y - 0.014), wp.y);
      env = env.mul(inPondBasin).mul(smoothstep(float(0.02), float(0.54), outerMask)).mul(belowWater);
    }

    return env;
  });

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const t = uniforms.uTime;
    const skyY = isReflected ? float(2.0 * WATER_LEVEL_Y).sub(wp.y) : wp.y;
    const skyEnv = evaluateSkyWash(wp);
    const washiSheetSrgb = evaluateWashiPaperSheetSrgb(uniforms);

    const paperTooth = fbmPaper2D(vec2(wp.x.mul(5.2), skyY.mul(5.2)));
    const mistFlow = fbmPaper2D(vec2(wp.x.mul(0.85).add(t.mul(0.008)), skyY.mul(1.05)));

    // Horizon-to-zenith gradient + right-bank low afternoon sun glow (`IMG_0382` `x ≈ +2.05, y ≈ +1.78`)
    const horizonToZenith = smoothstep(float(0.72), float(3.45), skyY.add(mistFlow.sub(0.5).mul(0.40)));
    const baseSkyPigment = mix(
      vec3(uniforms.uSkyHorizon),
      vec3(uniforms.uSkyZenith),
      horizonToZenith
    );

    const sunDist = length(vec2(wp.x.sub(2.02).mul(0.48), skyY.sub(1.78).mul(0.74)));
    const rightSunClearing = exp(sunDist.mul(sunDist).mul(-1.18));
    // Also a secondary soft clearing behind Little Nis's left-center upper canopy (`close-up photo`)
    const centerClearingDist = length(vec2(wp.x.add(0.48).mul(0.72), skyY.sub(2.15).mul(0.82)));
    const centerSkyClearing = exp(centerClearingDist.mul(centerClearingDist).mul(-1.45));

    const sunlitGold = vec3(0.97, 0.91, 0.76);
    const crispClearing = vec3(0.95, 0.94, 0.89);
    const upperSkyPigment = mix(
      mix(baseSkyPigment, crispClearing, centerSkyClearing.mul(0.52)),
      sunlitGold,
      rightSunClearing.mul(0.78)
    );

    // Tight near-horizon reflected bank shadow (`skyY < 0.38` only) so zero white strip appears at `shoreZ`,
    // while keeping `skyY > 0.42` luminous so sky windows shine cleanly between dark reflected tree trunks!
    const lowBankMirrorMix = isReflected
      ? float(1.0).sub(smoothstep(float(0.02), float(0.38), skyY.add(mistFlow.sub(0.5).mul(0.12))))
      : float(0.0);
    const bankMirrorPigment = mix(
      vec3(uniforms.uPondDeepMoss).mul(0.82),
      vec3(uniforms.uPondAmberTannin).mul(0.88),
      float(0.42)
    );
    const skyPigment = mix(upperSkyPigment, bankMirrorPigment, lowBankMirrorMix.mul(0.94));

    // Delicate wet-on-wet Kubelka-Munk sky wash so reflected sky windows remain luminous against dark branches
    const dSky = float(isReflected ? 0.36 : 0.32)
      .add(lowBankMirrorMix.mul(0.46))
      .sub(rightSunClearing.mul(0.14))
      .sub(centerSkyClearing.mul(0.09))
      .add(mistFlow.sub(0.5).mul(0.10))
      .add(paperTooth.sub(0.5).mul(0.08).mul(uniforms.uPaperTooth))
      .mul(smoothstep(float(0.0), float(0.65), skyEnv));

    const skyWashSrgb = evalKubelkaMunk2Flux(
      washiSheetSrgb,
      skyPigment,
      vec3(1.12, 1.14, 1.18),
      max(float(0.0), dSky)
    );

    const liftedSky = clamp(
      skyWashSrgb.add(vec3(0.045, 0.034, 0.014).mul(rightSunClearing).mul(skyEnv)),
      vec3(0.0),
      vec3(1.0)
    );

    const finalSrgb = mix(
      washiSheetSrgb,
      liftedSky,
      smoothstep(float(0.01), float(0.30), skyEnv)
    );
    return srgbToLinearVec3(finalSrgb);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const skyEnv = evaluateSkyWash(wp);
    return smoothstep(float(0.01), float(0.36), skyEnv).mul(isReflected ? 0.95 : 0.88);
  })();

  return mat;
}

/**
 * Creates the Kubelka-Munk Watercolor Pond Surface Glaze Material (`pondMesh`, `renderOrder = 4`).
 * Composites a translucent olive-umbrous & oak-leaf-tannin watercolor glaze OVER the 3D planar-reflected
 * woodland, bare winter branches, crouching guardian & luminous sky windows:
 * - Zero milky grey haze (`skySheenColor` appears only on capillary ripple crests & far-foreground grazing Fresnel).
 * - Crisp evaporative *Fuchidori* contact-line pinning along `shoreZ`, shoreline stones, submerged hands,
 *   and the feathered outer watercolor puddle tide-line on the `#f2ebd9` Washi sheet.
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
    const outerWashMask = evaluatePondOuterWashMask(xz, uniforms);
    const washiSheetSrgb = evaluateWashiPaperSheetSrgb(uniforms);

    const ambientWave1 = sin(xz.y.mul(9.6).sub(t.mul(1.85)).add(sin(xz.x.mul(3.2)).mul(0.75)));
    const ambientWave2 = cos(xz.x.mul(6.1).add(xz.y.mul(5.2)).add(t.mul(1.25)));
    const dynamicRipples = evaluateDynamicRipples(xz, uniforms);

    const totalRipple = ambientWave1
      .mul(0.28)
      .add(ambientWave2.mul(0.20))
      .add(dynamicRipples.mul(1.85))
      .mul(uniforms.uPondRippleStrength);

    const warpedXZ = xz.add(
      vec2(totalRipple.mul(0.10), ambientWave2.mul(0.055).mul(uniforms.uPondRippleStrength))
    );

    const paperTooth = fbmPaper2D(xz.mul(5.4));
    const washFlow = fbmPaper2D(warpedXZ.mul(1.08).add(vec2(t.mul(0.015), float(0.0))));
    const backrunBloom = fbmPaper2D(warpedXZ.mul(0.62).add(vec2(float(-2.7), washFlow.mul(0.42))));

    const shoreZ = evaluateShorelineZ(xz.x);
    const distFromShore = max(xz.y.sub(shoreZ), float(0.0));
    // Crisp dark *Fuchidori* contact meniscus right at `shoreZ`
    const shoreMeniscusRing = exp(distFromShore.mul(-10.5));

    // Contact-line rings around submerged wooden fingers & shoreline limestone slabs
    const dLeftHand = length(xz.sub(vec2(-1.46, 0.44)));
    const dRightHand = length(xz.sub(vec2(1.18, 0.46)));
    const handWaterRing = exp(dLeftHand.sub(0.38).mul(dLeftHand.sub(0.38)).mul(-18.0)).add(
      exp(dRightHand.sub(0.38).mul(dRightHand.sub(0.38)).mul(-18.0))
    );

    const dCenterSlab = length(vec2(xz.x.add(0.04).mul(1.45), xz.y.sub(0.20).mul(2.4)));
    const dRightStones = length(vec2(xz.x.sub(1.88).mul(1.15), xz.y.sub(0.34).mul(2.2)));
    const stoneMeniscusRing = exp(dCenterSlab.sub(0.34).mul(dCenterSlab.sub(0.34)).mul(-22.0)).add(
      exp(dRightStones.sub(0.36).mul(dRightStones.sub(0.36)).mul(-18.0))
    );

    // Evaporative watercolor tide-line along the feathered outer puddle margin onto handmade Washi
    const outerWashRing = smoothstep(float(0.05), float(0.22), outerWashMask).mul(
      float(1.0).sub(smoothstep(float(0.22), float(0.50), outerWashMask))
    );

    const totalPinning = shoreMeniscusRing
      .mul(0.84)
      .add(handWaterRing.mul(0.68))
      .add(stoneMeniscusRing.mul(0.48))
      .add(outerWashRing.mul(0.46))
      .mul(uniforms.uWatercolorBleed);

    const nearBankWeight = float(1.0).sub(smoothstep(float(0.35), float(3.45), distFromShore));
    // Central Guardian Reflection Window (`|x| < 1.55`, `distFromShore < 2.65`): delicate amber-olive glaze
    // so Little Nis's pale vertical-shingle reflection reads clearly against the dark olive cove water
    const guardianWindowX = float(1.0).sub(smoothstep(float(0.92), float(1.78), xz.x.abs()));
    const guardianWindowZ = smoothstep(float(0.06), float(0.24), distFromShore).mul(
      float(1.0).sub(smoothstep(float(2.05), float(2.95), distFromShore))
    );
    const guardianMirrorWindow = guardianWindowX.mul(guardianWindowZ);

    const rightSkyWindow = smoothstep(float(0.65), float(2.45), xz.x.add(washFlow.sub(0.5).mul(0.55))).mul(
      smoothstep(float(0.30), float(1.55), distFromShore)
    );
    const farOpenSkyWindow = smoothstep(float(2.35), float(4.25), distFromShore);
    const washEnvelope = smoothstep(float(0.0), float(0.50), outerWashMask);

    // Layer 1: Warm bronze oak-leaf tannin watercolor under-wash
    const dTannin = float(0.44)
      .add(nearBankWeight.mul(0.36))
      .sub(rightSkyWindow.mul(0.18))
      .sub(farOpenSkyWindow.mul(0.16))
      .sub(guardianMirrorWindow.mul(0.14))
      .add(washFlow.mul(0.24))
      .add(paperTooth.sub(0.5).mul(0.18).mul(uniforms.uPaperTooth))
      .add(totalPinning.mul(0.64))
      .mul(washEnvelope);

    const layer1Tannin = evalKubelkaMunk2Flux(
      washiSheetSrgb,
      uniforms.uPondAmberTannin,
      vec3(1.16, 1.12, 1.02),
      max(float(0.0), dTannin)
    );

    // Layer 2: Deep Holly Pond olive-umbrous botanical wash (`R_inf = [0.15, 0.18, 0.09]`)
    const dMoss = float(0.38)
      .add(nearBankWeight.mul(0.34))
      .sub(rightSkyWindow.mul(0.20))
      .sub(farOpenSkyWindow.mul(0.18))
      .sub(guardianMirrorWindow.mul(0.16))
      .add(backrunBloom.sub(0.42).mul(0.26))
      .add(totalPinning.mul(0.76))
      .mul(washEnvelope);

    const layer2Moss = evalKubelkaMunk2Flux(
      layer1Tannin,
      uniforms.uPondDeepMoss,
      vec3(1.06, 1.14, 0.98),
      max(float(0.0), dMoss)
    );

    const viewDir = normalize(cameraPosition.sub(wp));
    const cosTheta = clamp(viewDir.y, float(0.05), float(1.0));
    const fresnel = float(0.03).add(
      float(0.97).mul(
        float(1.0).sub(cosTheta).mul(float(1.0).sub(cosTheta)).mul(float(1.0).sub(cosTheta))
      )
    );

    const skySheenColor = evalKubelkaMunk2Flux(
      washiSheetSrgb,
      mix(vec3(uniforms.uSkyZenith), vec3(uniforms.uSkyHorizon), rightSkyWindow.mul(0.62).add(0.22)),
      vec3(1.12, 1.14, 1.18),
      float(0.20)
    );

    // Strictly localized capillary ripple crest catchlights + far-foreground Fresnel sky sheen
    // (Zero blanket milky washout over the mid-pond reflection!)
    const dynamicCrest = smoothstep(float(0.14), float(0.58), dynamicRipples.abs()).mul(0.34);
    const capillaryGlint = smoothstep(float(0.62), float(0.95), ambientWave1.mul(0.6).add(ambientWave2.mul(0.4)))
      .mul(0.09)
      .mul(uniforms.uPondRippleStrength);
    const farFresnelLift = fresnel.mul(farOpenSkyWindow.mul(0.22).add(rightSkyWindow.mul(0.14)));

    const specularGlazeMix = clamp(
      dynamicCrest.add(capillaryGlint).add(farFresnelLift).mul(washEnvelope),
      float(0.0),
      float(0.42)
    );

    const surfaceGlaze = mix(layer2Moss, skySheenColor, specularGlazeMix);

    // Seamless feathered watercolor puddle edge onto the continuous `#f2ebd9` Washi sheet (`0.000` seam)
    const finalSrgb = mix(
      washiSheetSrgb,
      surfaceGlaze,
      smoothstep(float(0.01), float(0.42), outerWashMask)
    );
    void pondBasinMask;
    return srgbToLinearVec3(finalSrgb);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const xz = vec2(wp.x, wp.z);
    const pondBasinMask = evaluatePondBasinMask(xz, uniforms);
    const outerWashMask = evaluatePondOuterWashMask(xz, uniforms);
    const shoreZ = evaluateShorelineZ(xz.x);
    const distFromShore = max(xz.y.sub(shoreZ), float(0.0));
    const dynamicRipples = evaluateDynamicRipples(xz, uniforms);

    const shoreMeniscusRing = exp(distFromShore.mul(-10.5));
    const dLeftHand = length(xz.sub(vec2(-1.46, 0.44)));
    const dRightHand = length(xz.sub(vec2(1.18, 0.46)));
    const handWaterRing = exp(dLeftHand.sub(0.38).mul(dLeftHand.sub(0.38)).mul(-18.0)).add(
      exp(dRightHand.sub(0.38).mul(dRightHand.sub(0.38)).mul(-18.0))
    );
    const dCenterSlab = length(vec2(xz.x.add(0.04).mul(1.45), xz.y.sub(0.20).mul(2.4)));
    const dRightStones = length(vec2(xz.x.sub(1.88).mul(1.15), xz.y.sub(0.34).mul(2.2)));
    const stoneMeniscusRing = exp(dCenterSlab.sub(0.34).mul(dCenterSlab.sub(0.34)).mul(-22.0)).add(
      exp(dRightStones.sub(0.36).mul(dRightStones.sub(0.36)).mul(-18.0))
    );
    const outerWashRing = smoothstep(float(0.05), float(0.22), outerWashMask).mul(
      float(1.0).sub(smoothstep(float(0.22), float(0.50), outerWashMask))
    );
    const pinning = shoreMeniscusRing
      .mul(0.82)
      .add(handWaterRing.mul(0.66))
      .add(stoneMeniscusRing.mul(0.46))
      .add(outerWashRing.mul(0.44))
      .mul(uniforms.uWatercolorBleed);

    const guardianWindowX = float(1.0).sub(smoothstep(float(0.92), float(1.78), xz.x.abs()));
    const guardianWindowZ = smoothstep(float(0.06), float(0.24), distFromShore).mul(
      float(1.0).sub(smoothstep(float(2.05), float(2.95), distFromShore))
    );
    const guardianMirrorWindow = guardianWindowX.mul(guardianWindowZ);

    const nearBankWeight = float(1.0).sub(smoothstep(float(0.40), float(3.40), distFromShore));
    const rightSkyWindow = smoothstep(float(0.65), float(2.45), xz.x).mul(
      smoothstep(float(0.30), float(1.55), distFromShore)
    );
    const farOpenSkyWindow = smoothstep(float(2.40), float(4.30), distFromShore);
    const rippleLift = smoothstep(float(0.14), float(0.58), dynamicRipples.abs()).mul(0.18);

    // Cohesive olive-tannin watercolor glaze (`0.26..0.58`) so sky slits glow warm olive-celadon
    // while dark-olive reflected branches and Little Nis's pale shingle mirror read clearly underneath!
    const baseOpacity = mix(float(0.42), float(0.58), nearBankWeight)
      .sub(guardianMirrorWindow.mul(0.20))
      .sub(rightSkyWindow.mul(0.10))
      .sub(farOpenSkyWindow.mul(0.10))
      .add(pinning.mul(0.38))
      .add(rippleLift);

    const shoreContactGate = smoothstep(float(-0.042), float(0.008), xz.y.sub(shoreZ));
    const outerPuddleFeather = smoothstep(float(0.0), float(0.46), outerWashMask);
    void pondBasinMask;
    return clamp(baseOpacity, float(0.14), float(0.88)).mul(shoreContactGate).mul(outerPuddleFeather);
  })();

  return mat;
}
