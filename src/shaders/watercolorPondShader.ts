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
  evalKubelkaMunk2Flux,
  evaluateShorelineZ,
  evaluatePondOuterWashMask,
  evaluatePondBasinMask,
  evaluateDynamicRipples,
  srgbToLinearVec3,
} from './paperCraftShader';

/**
 * Creates the Wet-on-Wet Botanical Watercolor Sky Wash Material (`skyMesh` & `skyReflMesh`).
 * - Upright (`isReflected = false`): Rises behind the `4.15m` woodland (`y ≈ 0.1 -> 4.9m`),
 *   transitioning from warm sunlit clearing mist (with a low afternoon sun glow on the right
 *   at `x ≈ +2.25, y ≈ +1.95` matching `IMG_0382.DNG`) to cool slate-celadon upper sky.
 * - Reflected (`isReflected = true`): Exact planar mirror (`y < WATER_LEVEL_Y`) clipped cleanly
 *   to `evaluatePondOuterWashMask(waterHitXZ)` so inter-crown sky gaps and the right-side pond
 *   sky window shine wet celadon & warm sun-mist washes across the full foreground pond!
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

    const widthScale = mix(float(4.35), float(4.85), uniforms.uRevealMode);
    const sampleX = isReflected ? waterHitXZ.x : wp.x;
    const nx = sampleX.div(widthScale);
    const domeCenterY = float(isReflected ? 2.45 : 1.68);
    const domeHalfY = float(isReflected ? 3.45 : 1.62);
    const ny = skyY.sub(domeCenterY).div(domeHalfY);
    const domeDist = length(vec2(nx, ny)).add(bleed.mul(0.28));

    const domeWash = isReflected
      ? float(1.0)
      : float(1.0).sub(smoothstep(float(0.46), float(1.00), domeDist));
    // Upright sky fades near ground; reflected sky stays solid down to `skyY = 0` so near-shore water reflects mossy bank earth (zero white gap!)
    const horizonFade = isReflected
      ? float(1.0)
      : smoothstep(float(0.05), float(0.55), skyY.add(bleed.mul(0.22)));

    const cloudField = fbmPaper2D(vec2(wp.x.mul(0.46).sub(t.mul(0.008)), skyY.mul(0.82).add(2.3)));
    const cloudSoftness = float(1.0).sub(smoothstep(float(0.56), float(0.90), cloudField).mul(0.38));

    let env: any = clamp(domeWash.mul(horizonFade).mul(cloudSoftness), float(0.0), float(1.0));

    if (isReflected) {
      const shoreZAtHit = evaluateShorelineZ(waterHitXZ.x);
      const inPondBasin = smoothstep(shoreZAtHit.sub(0.14), shoreZAtHit.add(0.01), waterHitXZ.y);
      const outerMask = evaluatePondOuterWashMask(waterHitXZ, uniforms);
      const belowWater = smoothstep(float(WATER_LEVEL_Y + 0.008), float(WATER_LEVEL_Y - 0.015), wp.y);
      env = env.mul(inPondBasin).mul(smoothstep(float(0.02), float(0.56), outerMask)).mul(belowWater);
    }

    return env;
  });

  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const t = uniforms.uTime;
    const skyY = isReflected ? float(2.0 * WATER_LEVEL_Y).sub(wp.y) : wp.y;
    const skyEnv = evaluateSkyWash(wp);

    const paperTooth = fbmPaper2D(vec2(wp.x.mul(5.2), skyY.mul(5.2)));
    const mistFlow = fbmPaper2D(vec2(wp.x.mul(0.85).add(t.mul(0.008)), skyY.mul(1.05)));

    // Horizon-to-zenith gradient + open warm clearing glow behind airy woodland trunks
    const horizonToZenith = smoothstep(float(0.75), float(3.45), skyY.add(mistFlow.sub(0.5).mul(0.42)));
    const baseSkyPigment = mix(
      vec3(uniforms.uSkyHorizon),
      vec3(uniforms.uSkyZenith),
      horizonToZenith
    );

    const sunDist = length(vec2(wp.x.sub(1.65).mul(0.52), skyY.sub(1.85).mul(0.78)));
    const rightSunClearing = exp(sunDist.mul(sunDist).mul(-1.15));
    const sunlitGold = vec3(0.96, 0.90, 0.75);
    const upperSkyPigment = mix(baseSkyPigment, sunlitGold, rightSunClearing.mul(0.72));
    // Near-horizon reflected bank wash (`skyY < 0.62` in reflection): warm mossy-amber bank mirror so zero pale strip appears at `shoreZ`!
    const lowBankMirrorMix = isReflected
      ? float(1.0).sub(smoothstep(float(0.04), float(0.62), skyY.add(mistFlow.sub(0.5).mul(0.18))))
      : float(0.0);
    const bankMirrorPigment = mix(
      vec3(uniforms.uPondAmberTannin),
      vec3(uniforms.uPondDeepMoss).mul(1.18),
      float(0.48)
    );
    const skyPigment = mix(upperSkyPigment, bankMirrorPigment, lowBankMirrorMix.mul(0.88));

    // Translucent wet-on-wet Kubelka-Munk sky wash (`#f2ebd9` paper glows gently through!)
    const dSky = float(isReflected ? 0.42 : 0.34)
      .add(lowBankMirrorMix.mul(0.24))
      .sub(rightSunClearing.mul(isReflected ? 0.16 : 0.15))
      .add(mistFlow.sub(0.5).mul(0.13))
      .add(paperTooth.sub(0.5).mul(0.09).mul(uniforms.uPaperTooth))
      .mul(smoothstep(float(0.0), float(0.68), skyEnv));

    const skyWashSrgb = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      skyPigment,
      vec3(1.12, 1.14, 1.18),
      max(float(0.0), dSky)
    );

    const liftedSky = clamp(
      skyWashSrgb.add(vec3(0.04, 0.03, 0.01).mul(rightSunClearing).mul(skyEnv)),
      vec3(0.0),
      vec3(1.0)
    );

    const finalSrgb = mix(
      vec3(uniforms.uPaperBacking),
      liftedSky,
      smoothstep(float(0.01), float(0.32), skyEnv)
    );
    return srgbToLinearVec3(finalSrgb);
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const skyEnv = evaluateSkyWash(wp);
    return smoothstep(float(0.01), float(0.38), skyEnv).mul(isReflected ? 0.92 : 0.86);
  })();

  return mat;
}

/**
 * Creates the Kubelka-Munk Watercolor Pond Surface Glaze Material (`pondMesh`, `renderOrder = 4`).
 * Composites a wet-on-wet olive-moss & leaf-litter tannin watercolor glaze OVER the 3D planar-reflected
 * woodland, crouching guardian & celadon sky wash:
 * - Zero shoreline white gap: dark evaporative *Fuchidori* contact pinning starts right at `shoreZ`.
 * - Lateral optical balance matching `IMG_0382.DNG`: rich shadowed olive-tannin pond mirror across the
 *   left/center canopy & guardian, opening into a luminous Fresnel celadon-mist sky window on the right.
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

    const ambientWave1 = sin(xz.y.mul(9.2).sub(t.mul(1.85)).add(sin(xz.x.mul(3.1)).mul(0.75)));
    const ambientWave2 = cos(xz.x.mul(5.8).add(xz.y.mul(5.1)).add(t.mul(1.25)));
    const dynamicRipples = evaluateDynamicRipples(xz, uniforms);

    const totalRipple = ambientWave1
      .mul(0.30)
      .add(ambientWave2.mul(0.22))
      .add(dynamicRipples.mul(1.85))
      .mul(uniforms.uPondRippleStrength);

    const warpedXZ = xz.add(
      vec2(totalRipple.mul(0.11), ambientWave2.mul(0.06).mul(uniforms.uPondRippleStrength))
    );

    const paperTooth = fbmPaper2D(xz.mul(5.2));
    const washFlow = fbmPaper2D(warpedXZ.mul(1.05).add(vec2(t.mul(0.016), float(0.0))));
    const backrunBloom = fbmPaper2D(warpedXZ.mul(0.58).add(vec2(float(-2.7), washFlow.mul(0.45))));

    const shoreZ = evaluateShorelineZ(xz.x);
    const distFromShore = max(xz.y.sub(shoreZ), float(0.0));
    // Continuous *Fuchidori* contact pinning right from `distFromShore = 0` so zero pale gap ever forms at `shoreZ`!
    const shoreMeniscusRing = exp(distFromShore.mul(-9.0));

    const dLeftHand = length(xz.sub(vec2(-1.50, 0.46)));
    const dRightHand = length(xz.sub(vec2(1.26, 0.48)));
    const handWaterRing = exp(dLeftHand.sub(0.42).mul(dLeftHand.sub(0.42)).mul(-16.0)).add(
      exp(dRightHand.sub(0.42).mul(dRightHand.sub(0.42)).mul(-16.0))
    );

    // Evaporative watercolor tide-line along the soft outer puddle margin onto `#f2ebd9` Washi!
    const outerWashRing = smoothstep(float(0.06), float(0.24), outerWashMask).mul(
      float(1.0).sub(smoothstep(float(0.24), float(0.52), outerWashMask))
    );

    const totalPinning = shoreMeniscusRing
      .mul(0.76)
      .add(handWaterRing.mul(0.66))
      .add(outerWashRing.mul(0.38))
      .mul(uniforms.uWatercolorBleed);

    const nearBankWeight = float(1.0).sub(smoothstep(float(0.45), float(3.85), distFromShore));
    // Central Guardian Reflection Window (`|x| < 1.58`, `distFromShore < 2.65`): keeps glaze delicate & warm-amber
    // so his pale vertical-shingle reflection shines clearly just like the close-up photo!
    const guardianWindowX = float(1.0).sub(smoothstep(float(0.95), float(1.85), xz.x.abs()));
    const guardianWindowZ = smoothstep(float(0.08), float(0.28), distFromShore).mul(
      float(1.0).sub(smoothstep(float(2.05), float(3.05), distFromShore))
    );
    const guardianMirrorWindow = guardianWindowX.mul(guardianWindowZ);

    const rightSkyWindow = smoothstep(float(0.55), float(2.45), xz.x.add(washFlow.sub(0.5).mul(0.65))).mul(
      smoothstep(float(0.35), float(1.65), distFromShore)
    );
    const washEnvelope = smoothstep(float(0.0), float(0.52), outerWashMask);

    const dTannin = float(0.36)
      .add(nearBankWeight.mul(0.32))
      .sub(rightSkyWindow.mul(0.18))
      .sub(guardianMirrorWindow.mul(0.12))
      .add(washFlow.mul(0.28))
      .add(paperTooth.sub(0.5).mul(0.20).mul(uniforms.uPaperTooth))
      .add(totalPinning.mul(0.58))
      .mul(washEnvelope);

    const layer1Tannin = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      uniforms.uPondAmberTannin,
      vec3(1.16, 1.12, 1.02),
      max(float(0.0), dTannin)
    );

    const dMoss = float(0.26)
      .add(nearBankWeight.mul(0.28))
      .sub(rightSkyWindow.mul(0.18))
      .sub(guardianMirrorWindow.mul(0.15))
      .add(backrunBloom.sub(0.35).mul(0.30))
      .add(totalPinning.mul(0.66))
      .mul(washEnvelope);

    const layer2Moss = evalKubelkaMunk2Flux(
      layer1Tannin,
      uniforms.uPondDeepMoss,
      vec3(1.06, 1.14, 0.98),
      max(float(0.0), dMoss)
    );

    const viewDir = normalize(cameraPosition.sub(wp));
    const cosTheta = clamp(viewDir.y, float(0.05), float(1.0));
    const fresnel = float(0.04).add(
      float(0.96).mul(
        float(1.0).sub(cosTheta).mul(float(1.0).sub(cosTheta)).mul(float(1.0).sub(cosTheta))
      )
    );

    const skySheenColor = evalKubelkaMunk2Flux(
      uniforms.uPaperBacking,
      mix(vec3(uniforms.uSkyZenith), vec3(uniforms.uSkyHorizon), rightSkyWindow.mul(0.58).add(0.22)),
      vec3(1.12, 1.14, 1.18),
      float(0.24)
    );

    // Wet-in-wet watercolor mist/paper bloom on outer flanks (restoring `2e1da22`'s hand-painted watercolor feel!)
    const outerMistBloom = smoothstep(float(0.52), float(0.86), backrunBloom)
      .mul(float(1.0).sub(guardianMirrorWindow.mul(0.85)))
      .mul(0.28);

    const rippleCrestLift = smoothstep(float(0.12), float(0.56), dynamicRipples.abs())
      .mul(0.38)
      .add(fresnel.mul(mix(float(0.26), float(0.54), rightSkyWindow)))
      .add(outerMistBloom)
      .mul(washEnvelope);

    const surfaceGlaze = mix(
      layer2Moss,
      skySheenColor,
      clamp(rippleCrestLift, float(0.0), float(0.78))
    );

    // Soft feathered watercolor puddle edge onto `#f2ebd9` Washi (`0.01 -> 0.44`)
    const finalSrgb = mix(
      vec3(uniforms.uPaperBacking),
      surfaceGlaze,
      smoothstep(float(0.01), float(0.44), outerWashMask)
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

    const shoreMeniscusRing = exp(distFromShore.mul(-9.0));
    const dLeftHand = length(xz.sub(vec2(-1.50, 0.46)));
    const dRightHand = length(xz.sub(vec2(1.26, 0.48)));
    const handWaterRing = exp(dLeftHand.sub(0.42).mul(dLeftHand.sub(0.42)).mul(-16.0)).add(
      exp(dRightHand.sub(0.42).mul(dRightHand.sub(0.42)).mul(-16.0))
    );
    const outerWashRing = smoothstep(float(0.06), float(0.24), outerWashMask).mul(
      float(1.0).sub(smoothstep(float(0.24), float(0.52), outerWashMask))
    );
    const pinning = shoreMeniscusRing
      .mul(0.76)
      .add(handWaterRing.mul(0.66))
      .add(outerWashRing.mul(0.34))
      .mul(uniforms.uWatercolorBleed);

    const guardianWindowX = float(1.0).sub(smoothstep(float(0.95), float(1.85), xz.x.abs()));
    const guardianWindowZ = smoothstep(float(0.08), float(0.28), distFromShore).mul(
      float(1.0).sub(smoothstep(float(2.05), float(3.05), distFromShore))
    );
    const guardianMirrorWindow = guardianWindowX.mul(guardianWindowZ);

    const nearBankWeight = float(1.0).sub(smoothstep(float(0.45), float(3.85), distFromShore));
    const rightSkyWindow = smoothstep(float(0.65), float(2.45), xz.x).mul(
      smoothstep(float(0.35), float(1.65), distFromShore)
    );

    // Keep central Guardian mirror window delicately glazed (`0.16..0.24`) while keeping `shoreZ` richly pinned!
    const baseOpacity = mix(float(0.32), float(0.50), nearBankWeight)
      .sub(guardianMirrorWindow.mul(0.22))
      .sub(rightSkyWindow.mul(0.10))
      .add(pinning.mul(0.42));

    const shoreContactGate = smoothstep(float(-0.045), float(0.008), xz.y.sub(shoreZ));
    const outerPuddleFeather = smoothstep(float(0.0), float(0.48), outerWashMask);
    void pondBasinMask;
    return clamp(baseOpacity, float(0.12), float(0.86)).mul(shoreContactGate).mul(outerPuddleFeather);
  })();

  return mat;
}
