import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  WATER_LEVEL_Y,
  createPaperShingleMaterial,
  createFoldedPaperLeafGeometry,
  createOrigamiFloatingLeafGeometry,
  createSculptedPaperTrunkGeometry,
  createFoldedPaperLimbGeometry,
  createGnarledFallenLogGeometry,
  createFoldedTrailSignGeometry,
  evalShorelineZJS,
} from '../shaders/paperCraftShader';
import {
  createWatercolorPondMaterial,
  createWatercolorSkyMaterial,
} from '../shaders/watercolorPondShader';

function createSeededRandom(seed = 9001): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0x00ffffff) / 0x01000000;
  };
}

export interface WoodlandDioramaAssets {
  rootGroup: THREE.Group;
  pondMesh: THREE.Mesh;
  bankMesh: THREE.Mesh;
  skyMesh: THREE.Mesh;
  foliageCount: number;
}

/**
 * Builds the Bernheim Forest Late-Autumn Paper-Craft & Watercolor Diorama (`Holly Pond` 1:1):
 * 0. Upright & Planar-Reflected Wet-on-Wet Sky Wash (`skyMesh`, `skyReflMesh`, `renderOrder = 0`)
 *    with low afternoon golden sun clearing on the right (`x ≈ +2.02, y ≈ +1.78`).
 * 1. Stepped Torn-Cardstock / Wet-Mud Shoreline Lip & Leaf-Mulch Cove Embankment (`bankMesh`),
 *    with worn footpath curving in from the right trailhead sign.
 * 2. Weathered Shoreline Limestone Slabs, Right-Bank Cairn, Folded Rectangular Trailhead Placard
 *    on 2 Wooden Posts, and 3 Crooked Fallen Logs with Cut Heartwood Ends on the Left Bank.
 * 3. 18 Multi-Depth Pale Sycamore & Dark Oak Trunks + 54 Forked 5-Shoot Bare Winter Limb Lattices.
 * 4. Localized Late-Autumn Paper Foliage (Far-Left Copper Oak, Low Bank Bramble, Narrow Back Spires,
 *    and Sparse Clinging Ochre Sprigs) + 38 Bank Leaf-Litter Scraps & 16 Floating Pond Leaves.
 * 5. Deep Olive-Umbrous & Tannin Kubelka-Munk Watercolor Pond Glaze (`pondMesh`, `renderOrder = 4`).
 */
export function buildWoodlandDiorama(uniforms: PaperSceneUniforms): WoodlandDioramaAssets {
  const rand = createSeededRandom(77123);
  const rootGroup = new THREE.Group();
  const reflPlaneMat = new THREE.Matrix4().makeScale(1, -1, 1).setPosition(0, 2 * WATER_LEVEL_Y, 0);
  const dummy = new THREE.Matrix4();
  const dummyRefl = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  // ============================================================================
  // 0. UPRIGHT & REFLECTED WET-ON-WET WATERCOLOR SKY WASH (`renderOrder = 0`)
  // ============================================================================
  const buildSkyPlane = (isReflected: boolean): THREE.Mesh => {
    const skyH = isReflected ? 8.0 : 5.3;
    const skyW = isReflected ? 24.5 : 14.8;
    const geom = new THREE.PlaneGeometry(skyW, skyH, 56, 32);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const sx = pos.getX(i);
      const rawY = pos.getY(i) + skyH * 0.5 + 0.05;
      // Tilt reflected sky dome gently forward at high `rawY` so foreground pond rays always catch sky wash
      const sz = isReflected
        ? -4.15 + sx * sx * 0.02 + Math.max(0, rawY - 2.1) * 0.70
        : -4.15 + sx * sx * 0.022;
      pos.setXYZ(i, sx, isReflected ? 2 * WATER_LEVEL_Y - rawY : rawY, sz);
    }
    geom.computeVertexNormals();
    const mat = createWatercolorSkyMaterial(uniforms, isReflected);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 0;
    return mesh;
  };

  const skyMesh = buildSkyPlane(false);
  const skyReflMesh = buildSkyPlane(true);
  rootGroup.add(skyMesh);
  rootGroup.add(skyReflMesh);

  // ============================================================================
  // 1. STEPPED SHORELINE LIP & LEAF-MULCH COVE EMBANKMENT (`bankMesh`)
  // ============================================================================
  const evalBankHeightAt = (x: number, z: number): number => {
    const shoreZ = evalShorelineZJS(x);
    const distBehind = shoreZ - z;
    if (distBehind <= -0.04) {
      return WATER_LEVEL_Y - 0.016;
    }
    const slope = Math.max(0, distBehind);
    // Crisp 4.4cm vertical torn-cardstock / wet-mud bank lip right at `shoreZ` (`distBehind = 0..0.085m`)
    const lipStep = THREE.MathUtils.smoothstep(distBehind, -0.022, 0.075) * 0.046;
    const diagCrease =
      Math.abs(((x * 0.54 + z * 0.40 + 4.0) % 1.0) - 0.5) * 0.068 +
      Math.sin(x * 1.05 - z * 1.2) * 0.022;
    const tuckStep = Math.floor(slope * 1.15) * 0.034;
    const rawBankY =
      WATER_LEVEL_Y +
      lipStep +
      Math.min(0.64, Math.pow(slope, 0.86) * 0.175 + tuckStep + diagCrease * Math.min(1, slope * 2.5));

    // Grounded flat crouch pad beneath Little Nis's feet & hands
    const padWeight = Math.exp(-(x * x) / 2.35) * Math.exp(-Math.pow(z + 0.52, 2) / 1.15);
    const padBlendedY = THREE.MathUtils.lerp(rawBankY, 0.062, padWeight * 0.78);
    const shoreGate = THREE.MathUtils.smoothstep(distBehind, -0.032, 0.055);
    return Math.max(
      WATER_LEVEL_Y - 0.012,
      THREE.MathUtils.lerp(WATER_LEVEL_Y - 0.012, padBlendedY, shoreGate)
    );
  };

  const indexedBank = new THREE.PlaneGeometry(10.8, 5.8, 64, 38);
  indexedBank.rotateX(-Math.PI / 2);

  const bPos = indexedBank.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i);
    const z = bPos.getZ(i) - 1.38;
    bPos.setZ(i, z);
    bPos.setY(i, evalBankHeightAt(x, z));
  }

  const bankGeom = indexedBank.toNonIndexed();
  indexedBank.dispose();
  bankGeom.computeVertexNormals();

  const bCount = bankGeom.attributes.position.count;
  const bankVars = new Float32Array(bCount * 3);
  for (let tri = 0; tri < bCount; tri += 3) {
    const tShift = (rand() - 0.5) * 0.22;
    const wShift = 0.34 + rand() * 0.38;
    const pSeed = rand();
    for (let k = 0; k < 3; k++) {
      bankVars[(tri + k) * 3 + 0] = tShift;
      bankVars[(tri + k) * 3 + 1] = wShift;
      bankVars[(tri + k) * 3 + 2] = pSeed;
    }
  }
  bankGeom.setAttribute('aVariation', new THREE.BufferAttribute(bankVars, 3));

  const bankMat = createPaperShingleMaterial(uniforms, { role: 'bank' });
  const bankMesh = new THREE.Mesh(bankGeom, bankMat);
  bankMesh.renderOrder = 2;
  rootGroup.add(bankMesh);

  // ============================================================================
  // 2A. SHORELINE WEATHERED LIMESTONE SLABS & RIGHT-COVE CAIRN (`8` real stones only!)
  // ============================================================================
  const stoneSpecs: Array<{
    pos: [number, number, number];
    scale: [number, number, number];
    rotY: number;
  }> = [
    // Prominent flat pale weathered limestone slab centered right in front of Little Nis's feet
    { pos: [-0.04, 0.048, 0.14], scale: [0.56, 0.068, 0.25], rotY: 0.05 },
    // Small flat shoreline stones near left & right hands (`media_1793684401016_7f0a395e.jpg`)
    { pos: [-1.24, 0.040, 0.21], scale: [0.25, 0.060, 0.18], rotY: 0.14 },
    { pos: [-1.96, 0.044, 0.24], scale: [0.28, 0.070, 0.20], rotY: -0.22 },
    { pos: [0.64, 0.036, 0.20], scale: [0.22, 0.048, 0.15], rotY: -0.10 },
    // Two pale angular shoreline stones on the viewer-right bank (`x ≈ 1.72..2.08` in close-up photo)
    { pos: [1.72, 0.060, 0.27], scale: [0.30, 0.096, 0.22], rotY: 0.28 },
    { pos: [2.06, 0.052, 0.31], scale: [0.24, 0.080, 0.19], rotY: -0.34 },
    // Outer right-cove stacked stone cairn (`IMG_0382` wide cove frame)
    { pos: [2.46, 0.074, 0.38], scale: [0.33, 0.12, 0.24], rotY: -0.22 },
    { pos: [2.49, 0.156, 0.37], scale: [0.21, 0.10, 0.18], rotY: 0.22 },
  ];

  const stoneGeom = new THREE.DodecahedronGeometry(0.5, 0);
  const stoneMat = createPaperShingleMaterial(uniforms, { role: 'stone' });
  const stoneReflGeom = stoneGeom.clone();
  const stoneReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-stone' });

  const stoneInstanced = new THREE.InstancedMesh(stoneGeom, stoneMat, stoneSpecs.length);
  const stoneReflInstanced = new THREE.InstancedMesh(stoneReflGeom, stoneReflMat, stoneSpecs.length);
  const stoneVars = new Float32Array(stoneSpecs.length * 3);

  stoneSpecs.forEach((s, idx) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.14, s.rotY, (rand() - 0.5) * 0.14));
    dummy.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(...s.scale));
    stoneInstanced.setMatrixAt(idx, dummy);

    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    stoneReflInstanced.setMatrixAt(idx, dummyRefl);

    stoneVars[idx * 3 + 0] = (rand() - 0.5) * 0.28;
    stoneVars[idx * 3 + 1] = 0.12;
    stoneVars[idx * 3 + 2] = rand();
  });

  stoneGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(stoneVars, 3));
  stoneReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(stoneVars, 3));
  stoneInstanced.instanceMatrix.needsUpdate = true;
  stoneReflInstanced.instanceMatrix.needsUpdate = true;
  stoneInstanced.renderOrder = 2;
  stoneReflInstanced.renderOrder = 1;
  rootGroup.add(stoneInstanced);
  rootGroup.add(stoneReflInstanced);

  // ============================================================================
  // 2B. FOLDED RECTANGULAR RIGHT-BANK TRAILHEAD SIGN (`IMG_0382` `x ≈ 3.10`)
  // ============================================================================
  const placardGeom = createFoldedTrailSignGeometry();
  const placardReflGeom = placardGeom.clone();
  const placardMat = createPaperShingleMaterial(uniforms, { role: 'placard' });
  const placardReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-placard' });

  const placardInstanced = new THREE.InstancedMesh(placardGeom, placardMat, 1);
  const placardReflInstanced = new THREE.InstancedMesh(placardReflGeom, placardReflMat, 1);
  q.setFromEuler(new THREE.Euler(-0.08, -0.32, 0.0));
  dummy.compose(new THREE.Vector3(3.10, 0.43, 0.48), q, new THREE.Vector3(0.35, 0.22, 1.0));
  placardInstanced.setMatrixAt(0, dummy);
  dummyRefl.copy(dummy).premultiply(reflPlaneMat);
  placardReflInstanced.setMatrixAt(0, dummyRefl);

  const placardVars = new Float32Array([0.12, 0.15, 0.42]);
  placardGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(placardVars, 3));
  placardReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(placardVars, 3));
  placardInstanced.instanceMatrix.needsUpdate = true;
  placardReflInstanced.instanceMatrix.needsUpdate = true;
  placardInstanced.renderOrder = 2;
  placardReflInstanced.renderOrder = 1;
  rootGroup.add(placardInstanced);
  rootGroup.add(placardReflInstanced);

  // ============================================================================
  // 2C. LEFT-BANK CROOKED FALLEN LOGS WITH EXPOSED PALE CUT HEARTWOOD ENDS (`Close-Up Photo 1:1`)
  // ============================================================================
  const logSpecs: Array<{
    pos: [number, number, number];
    rot: [number, number, number];
    scale: [number, number, number];
    tone: number;
  }> = [
    // Upper arched deadfall limb curving behind left logs
    { pos: [-2.02, 0.28, -0.68], rot: [1.18, 0.22, -0.82], scale: [0.088, 1.48, 0.088], tone: -0.22 },
    // Prominent cut log pointing forward-left with pale exposed round heartwood end
    { pos: [-1.88, 0.16, -0.46], rot: [1.36, -0.34, -0.28], scale: [0.096, 1.24, 0.096], tone: -0.28 },
    // Lower companion cut log tucked beside it (`double cut-end stack in close-up photo!`)
    { pos: [-2.12, 0.12, -0.38], rot: [1.42, -0.42, -0.18], scale: [0.078, 1.08, 0.078], tone: -0.18 },
  ];

  const logGeom = createGnarledFallenLogGeometry();
  const logReflGeom = logGeom.clone();
  const logMat = createPaperShingleMaterial(uniforms, { role: 'log' });
  const logReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-log' });

  const logInstanced = new THREE.InstancedMesh(logGeom, logMat, logSpecs.length);
  const logReflInstanced = new THREE.InstancedMesh(logReflGeom, logReflMat, logSpecs.length);
  const logVars = new Float32Array(logSpecs.length * 3);

  logSpecs.forEach((lg, idx) => {
    q.setFromEuler(new THREE.Euler(lg.rot[0], lg.rot[1], lg.rot[2]));
    dummy.compose(new THREE.Vector3(...lg.pos), q, new THREE.Vector3(...lg.scale));
    logInstanced.setMatrixAt(idx, dummy);
    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    logReflInstanced.setMatrixAt(idx, dummyRefl);

    logVars[idx * 3 + 0] = lg.tone;
    logVars[idx * 3 + 1] = 0.26;
    logVars[idx * 3 + 2] = rand();
  });

  logGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(logVars, 3));
  logReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(logVars, 3));
  logInstanced.instanceMatrix.needsUpdate = true;
  logReflInstanced.instanceMatrix.needsUpdate = true;
  logInstanced.renderOrder = 2;
  logReflInstanced.renderOrder = 1;
  rootGroup.add(logInstanced);
  rootGroup.add(logReflInstanced);

  // ============================================================================
  // 3. 18 LATE-AUTUMN KENTUCKY HARDWOOD TRUNKS & 54 BARE WINTER BRANCH LATTICES
  // ============================================================================
  const treeSpecs: Array<{
    x: number;
    z: number;
    baseY: number;
    trunkH: number;
    radius: number;
    leanX: number;
    leanZ: number;
    limbs: number;
    sycamoreTone: number;
  }> = [
    // Left woodland stems (pale sycamore at x = -2.86 matching close-up photo left edge + dark oaks)
    { x: -3.76, z: -0.94, baseY: 0.08, trunkH: 2.55, radius: 0.084, leanX: -0.04, leanZ: 0.02, limbs: 3, sycamoreTone: -0.14 },
    { x: -2.88, z: -1.32, baseY: 0.12, trunkH: 3.12, radius: 0.098, leanX: 0.02, leanZ: 0.01, limbs: 3, sycamoreTone: 0.36 },
    { x: -2.18, z: -1.72, baseY: 0.14, trunkH: 3.24, radius: 0.094, leanX: -0.02, leanZ: 0.01, limbs: 3, sycamoreTone: -0.22 },
    { x: -1.48, z: -1.96, baseY: 0.15, trunkH: 3.35, radius: 0.082, leanX: 0.03, leanZ: 0.02, limbs: 3, sycamoreTone: -0.12 },

    // Parted central clearing stems (open bright sky clearing around `x ≈ -0.35` above Little Nis!)
    { x: -0.88, z: -2.34, baseY: 0.17, trunkH: 3.42, radius: 0.078, leanX: -0.02, leanZ: 0.01, limbs: 3, sycamoreTone: -0.18 },
    { x: 0.26, z: -2.38, baseY: 0.18, trunkH: 3.44, radius: 0.086, leanX: 0.02, leanZ: 0.01, limbs: 4, sycamoreTone: 0.16 },
    { x: 1.04, z: -1.94, baseY: 0.15, trunkH: 3.28, radius: 0.088, leanX: 0.03, leanZ: 0.02, limbs: 4, sycamoreTone: -0.16 },

    // Right sunlit grove: prominent pale sycamore/ash trunk at `x = 1.68` (`close-up photo right!`) + bare winter oaks
    { x: 1.68, z: -1.46, baseY: 0.12, trunkH: 3.22, radius: 0.104, leanX: -0.01, leanZ: 0.01, limbs: 4, sycamoreTone: 0.42 },
    { x: 2.34, z: -2.06, baseY: 0.15, trunkH: 3.16, radius: 0.084, leanX: 0.04, leanZ: 0.02, limbs: 4, sycamoreTone: -0.12 },
    { x: 2.98, z: -1.44, baseY: 0.11, trunkH: 2.95, radius: 0.090, leanX: 0.05, leanZ: 0.02, limbs: 4, sycamoreTone: 0.22 },
    { x: 3.68, z: -0.86, baseY: 0.08, trunkH: 2.58, radius: 0.080, leanX: 0.07, leanZ: 0.02, limbs: 3, sycamoreTone: -0.10 },

    // Slender mid/background saplings creating vertical dark trunk & twig reflections across Holly Pond
    { x: -3.28, z: -2.25, baseY: 0.18, trunkH: 2.92, radius: 0.058, leanX: -0.02, leanZ: 0.0, limbs: 2, sycamoreTone: 0.12 },
    { x: -2.48, z: -2.78, baseY: 0.20, trunkH: 3.08, radius: 0.058, leanX: 0.01, leanZ: 0.0, limbs: 2, sycamoreTone: -0.20 },
    { x: -1.22, z: -2.92, baseY: 0.20, trunkH: 3.22, radius: 0.056, leanX: -0.01, leanZ: 0.0, limbs: 2, sycamoreTone: 0.18 },
    { x: -0.24, z: -3.05, baseY: 0.21, trunkH: 3.15, radius: 0.050, leanX: 0.02, leanZ: 0.0, limbs: 2, sycamoreTone: -0.15 },
    { x: 0.68, z: -2.88, baseY: 0.20, trunkH: 3.18, radius: 0.056, leanX: -0.01, leanZ: 0.0, limbs: 3, sycamoreTone: 0.10 },
    { x: 1.98, z: -2.82, baseY: 0.20, trunkH: 3.04, radius: 0.058, leanX: 0.02, leanZ: 0.0, limbs: 3, sycamoreTone: -0.18 },
    { x: 3.24, z: -2.28, baseY: 0.18, trunkH: 2.86, radius: 0.056, leanX: 0.04, leanZ: 0.01, limbs: 2, sycamoreTone: 0.16 },
  ];

  // Two slender wooden signposts supporting the folded rectangular trailhead placard (`x ≈ 3.10`)
  const signPostSpecs = [
    { pos: [2.99, 0.24, 0.51] as [number, number, number], rot: [0.0, 0.0, 0.01] as [number, number, number], scale: [0.020, 0.39, 0.020] as [number, number, number] },
    { pos: [3.21, 0.24, 0.45] as [number, number, number], rot: [0.0, 0.0, -0.01] as [number, number, number], scale: [0.020, 0.39, 0.020] as [number, number, number] },
  ];

  const trunkGeom = createSculptedPaperTrunkGeometry();
  const trunkReflGeom = trunkGeom.clone();
  const trunkMat = createPaperShingleMaterial(uniforms, { role: 'trunk' });
  const trunkReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-trunk' });

  const totalTrunks = treeSpecs.length + signPostSpecs.length;
  const trunkInstanced = new THREE.InstancedMesh(trunkGeom, trunkMat, totalTrunks);
  const trunkReflInstanced = new THREE.InstancedMesh(trunkReflGeom, trunkReflMat, totalTrunks);
  const trunkVars = new Float32Array(totalTrunks * 3);

  const totalLimbs = treeSpecs.reduce((acc, t) => acc + t.limbs, 0);
  const limbGeom = createFoldedPaperLimbGeometry();
  const limbReflGeom = limbGeom.clone();
  const limbInstanced = new THREE.InstancedMesh(limbGeom, trunkMat, totalLimbs);
  const limbReflInstanced = new THREE.InstancedMesh(limbReflGeom, trunkReflMat, totalLimbs);
  const limbVars = new Float32Array(totalLimbs * 3);

  let wCursor = 0;
  let lCursor = 0;

  treeSpecs.forEach((tr, idx) => {
    const centerY = tr.baseY + tr.trunkH * 0.5;
    q.setFromEuler(new THREE.Euler(tr.leanZ, (idx * 1.37) % (Math.PI * 2), tr.leanX));
    dummy.compose(
      new THREE.Vector3(tr.x, centerY, tr.z),
      q,
      new THREE.Vector3(tr.radius, tr.trunkH, tr.radius)
    );
    trunkInstanced.setMatrixAt(wCursor, dummy);
    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    trunkReflInstanced.setMatrixAt(wCursor, dummyRefl);

    const tTone = tr.sycamoreTone + (rand() - 0.5) * 0.12;
    const tWarm = tr.x > 1.2 ? 0.34 + rand() * 0.22 : 0.16 + rand() * 0.18;
    trunkVars[wCursor * 3 + 0] = tTone;
    trunkVars[wCursor * 3 + 1] = tWarm;
    trunkVars[wCursor * 3 + 2] = rand();
    wCursor++;

    for (let b = 0; b < tr.limbs; b++) {
      const side = b % 2 === 0 ? -1 : 1;
      const attachFrac = 0.34 + (b / Math.max(1, tr.limbs)) * 0.54;
      const attachY = tr.baseY + tr.trunkH * attachFrac;
      const isSunClearingTree = tr.x > 1.35;
      const limbLen = isSunClearingTree ? 1.06 + rand() * 0.44 : 0.88 + rand() * 0.34;
      const yaw = (side > 0 ? -0.18 : Math.PI + 0.18) + (rand() - 0.5) * 0.68;
      const pitch = 0.06 + (rand() - 0.5) * 0.16;
      q.setFromEuler(new THREE.Euler(pitch, yaw, side * (-0.12 - attachFrac * 0.08)));
      dummy.compose(
        new THREE.Vector3(tr.x, attachY, tr.z),
        q,
        new THREE.Vector3(limbLen, limbLen * 0.96, limbLen)
      );
      limbInstanced.setMatrixAt(lCursor, dummy);
      dummyRefl.copy(dummy).premultiply(reflPlaneMat);
      limbReflInstanced.setMatrixAt(lCursor, dummyRefl);

      limbVars[lCursor * 3 + 0] = tTone - 0.06;
      limbVars[lCursor * 3 + 1] = tWarm;
      limbVars[lCursor * 3 + 2] = rand();
      lCursor++;
    }
  });

  signPostSpecs.forEach((sp) => {
    q.setFromEuler(new THREE.Euler(sp.rot[0], sp.rot[1], sp.rot[2]));
    dummy.compose(new THREE.Vector3(...sp.pos), q, new THREE.Vector3(...sp.scale));
    trunkInstanced.setMatrixAt(wCursor, dummy);
    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    trunkReflInstanced.setMatrixAt(wCursor, dummyRefl);

    trunkVars[wCursor * 3 + 0] = 0.18;
    trunkVars[wCursor * 3 + 1] = 0.24;
    trunkVars[wCursor * 3 + 2] = rand();
    wCursor++;
  });

  trunkGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(trunkVars, 3));
  trunkReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(trunkVars, 3));
  limbGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(limbVars, 3));
  limbReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(limbVars, 3));

  trunkInstanced.instanceMatrix.needsUpdate = true;
  trunkReflInstanced.instanceMatrix.needsUpdate = true;
  limbInstanced.instanceMatrix.needsUpdate = true;
  limbReflInstanced.instanceMatrix.needsUpdate = true;

  trunkInstanced.renderOrder = 2;
  limbInstanced.renderOrder = 2;
  trunkReflInstanced.renderOrder = 1;
  limbReflInstanced.renderOrder = 1;

  rootGroup.add(trunkInstanced);
  rootGroup.add(limbInstanced);
  rootGroup.add(trunkReflInstanced);
  rootGroup.add(limbReflInstanced);

  // ============================================================================
  // 4. PHOTO-LOCALIZED LATE-AUTUMN FOLIAGE (`Copper Left Oak + Narrow Spires + Open Bare Right Grove`)
  // ============================================================================
  const boughPlacements: Array<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    tone: number;
    warmth: number;
    phase: number;
  }> = [];

  const addPaperFoliageCluster = (opts: {
    x: number;
    z: number;
    yStart: number;
    yEnd: number;
    tiers: number;
    baseWidth: number;
    topWidth: number;
    heightScale?: number;
    warmth: number;
    pitchBase: number;
    yawSeed: number;
  }) => {
    for (let k = 0; k < opts.tiers; k++) {
      const frac = opts.tiers > 1 ? k / (opts.tiers - 1) : 0.5;
      const y = THREE.MathUtils.lerp(opts.yStart, opts.yEnd, frac);
      const w = THREE.MathUtils.lerp(opts.baseWidth, opts.topWidth, frac);
      const hScale = (opts.heightScale ?? 1.0) * (0.94 + frac * 0.24);
      const yaw = opts.yawSeed + Math.sin(k * 2.3 + opts.x) * 0.48 + (rand() - 0.5) * 0.28;
      const pitch = opts.pitchBase - frac * 0.10 + (rand() - 0.5) * 0.08;
      const roll = (rand() - 0.5) * 0.24;
      const bQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

      boughPlacements.push({
        pos: new THREE.Vector3(
          opts.x + Math.sin(k * 1.9 + opts.z) * 0.13,
          y,
          opts.z + Math.cos(k * 1.6) * 0.11
        ),
        quat: bQuat,
        scale: new THREE.Vector3(w, hScale, w * 0.92),
        tone: -0.22 + frac * 0.44,
        warmth: opts.warmth,
        phase: rand(),
      });
    }
  };

  // Zone A — Far-Left Copper-Russet Autumn Oak (`IMG_0382` signature copper tree on left bank!)
  addPaperFoliageCluster({
    x: -3.62, z: -0.88, yStart: 0.78, yEnd: 2.25, tiers: 3,
    baseWidth: 1.08, topWidth: 0.66, warmth: 0.94, pitchBase: 0.20, yawSeed: 0.28,
  });
  addPaperFoliageCluster({
    x: -2.86, z: -1.36, yStart: 1.18, yEnd: 2.68, tiers: 3,
    baseWidth: 1.05, topWidth: 0.62, warmth: 0.92, pitchBase: 0.18, yawSeed: 0.16,
  });
  addPaperFoliageCluster({
    x: -2.18, z: -1.68, yStart: 1.55, yEnd: 2.82, tiers: 2,
    baseWidth: 0.88, topWidth: 0.56, warmth: 0.82, pitchBase: 0.16, yawSeed: 0.08,
  });

  // Zone B — Low Bank Fern/Bramble Bush (`IMG_0382` green bush at `x ≈ -2.42`, kept clear of cut log ends!)
  // & low mossy bank bramble behind Little Nis's right flank (`close-up photo`)
  addPaperFoliageCluster({
    x: -2.52, z: -0.44, yStart: 0.16, yEnd: 0.42, tiers: 2,
    baseWidth: 0.78, topWidth: 0.54, heightScale: 0.85, warmth: 0.06, pitchBase: 0.24, yawSeed: 0.22,
  });
  addPaperFoliageCluster({
    x: -1.42, z: -1.32, yStart: 0.32, yEnd: 0.68, tiers: 2,
    baseWidth: 0.82, topWidth: 0.58, heightScale: 0.85, warmth: 0.14, pitchBase: 0.20, yawSeed: 0.12,
  });
  addPaperFoliageCluster({
    x: 1.28, z: -1.26, yStart: 0.28, yEnd: 0.64, tiers: 2,
    baseWidth: 0.84, topWidth: 0.58, heightScale: 0.85, warmth: 0.12, pitchBase: 0.18, yawSeed: -0.10,
  });
  addPaperFoliageCluster({
    x: 2.18, z: -1.12, yStart: 0.24, yEnd: 0.56, tiers: 2,
    baseWidth: 0.76, topWidth: 0.52, heightScale: 0.82, warmth: 0.16, pitchBase: 0.20, yawSeed: -0.18,
  });

  // Zone C — Tall Slender Woodland Red-Cedar / Pine Spires (`IMG_0382` tall narrow dark-olive spires,
  // parted cleanly around `x ≈ -0.35` so bright clearing sky shines behind Little Nis!)
  addPaperFoliageCluster({
    x: -1.52, z: -2.02, yStart: 1.45, yEnd: 3.12, tiers: 3,
    baseWidth: 0.76, topWidth: 0.42, heightScale: 1.18, warmth: 0.08, pitchBase: 0.14, yawSeed: 0.05,
  });
  addPaperFoliageCluster({
    x: -0.92, z: -2.36, yStart: 1.75, yEnd: 3.28, tiers: 3,
    baseWidth: 0.72, topWidth: 0.38, heightScale: 1.22, warmth: 0.06, pitchBase: 0.14, yawSeed: 0.02,
  });
  addPaperFoliageCluster({
    x: 0.34, z: -2.36, yStart: 1.65, yEnd: 3.28, tiers: 3,
    baseWidth: 0.74, topWidth: 0.40, heightScale: 1.20, warmth: 0.08, pitchBase: 0.15, yawSeed: -0.04,
  });
  addPaperFoliageCluster({
    x: 1.06, z: -1.96, yStart: 1.55, yEnd: 2.98, tiers: 2,
    baseWidth: 0.72, topWidth: 0.44, heightScale: 1.12, warmth: 0.16, pitchBase: 0.16, yawSeed: -0.10,
  });

  // Zone D — Sparse Clinging Late-Autumn Ochre Leaf Sprigs in Right Sunlit Grove
  // (`small delicate clusters so ~80% of the right grove remains open bare crisscrossing winter branches!`)
  addPaperFoliageCluster({
    x: 1.88, z: -1.62, yStart: 1.95, yEnd: 2.65, tiers: 2,
    baseWidth: 0.58, topWidth: 0.42, heightScale: 0.82, warmth: 0.62, pitchBase: 0.18, yawSeed: -0.18,
  });
  addPaperFoliageCluster({
    x: 2.88, z: -1.46, yStart: 1.75, yEnd: 2.48, tiers: 2,
    baseWidth: 0.62, topWidth: 0.44, heightScale: 0.84, warmth: 0.72, pitchBase: 0.20, yawSeed: -0.26,
  });
  addPaperFoliageCluster({
    x: 3.62, z: -0.88, yStart: 1.18, yEnd: 1.92, tiers: 1,
    baseWidth: 0.64, topWidth: 0.52, heightScale: 0.85, warmth: 0.76, pitchBase: 0.22, yawSeed: -0.32,
  });

  const folGeom = createFoldedPaperLeafGeometry();
  const folReflGeom = folGeom.clone();
  const folMat = createPaperShingleMaterial(uniforms, { role: 'foliage' });
  const folReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-foliage' });

  const folMesh = new THREE.InstancedMesh(folGeom, folMat, boughPlacements.length);
  const folReflMesh = new THREE.InstancedMesh(folReflGeom, folReflMat, boughPlacements.length);
  const folVars = new Float32Array(boughPlacements.length * 3);

  boughPlacements.forEach((fp, i) => {
    dummy.compose(fp.pos, fp.quat, fp.scale);
    folMesh.setMatrixAt(i, dummy);

    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    folReflMesh.setMatrixAt(i, dummyRefl);

    folVars[i * 3 + 0] = fp.tone;
    folVars[i * 3 + 1] = fp.warmth;
    folVars[i * 3 + 2] = fp.phase;
  });

  folGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folVars, 3));
  folReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folVars, 3));
  folMesh.instanceMatrix.needsUpdate = true;
  folReflMesh.instanceMatrix.needsUpdate = true;
  folMesh.renderOrder = 2;
  folReflMesh.renderOrder = 1;
  rootGroup.add(folMesh);
  rootGroup.add(folReflMesh);

  // ============================================================================
  // 4B. SCATTERED MINIATURE FOLDED PAPER AUTUMN LEAF-LITTER ON BANK (`38`) + POND (`16`)
  // ============================================================================
  const bankLeafCount = 38;
  const pondLeafCount = 16;
  const totalSmallLeaves = bankLeafCount + pondLeafCount;
  const floatGeom = createOrigamiFloatingLeafGeometry();
  const floatMesh = new THREE.InstancedMesh(floatGeom, folMat, totalSmallLeaves);
  const floatVars = new Float32Array(totalSmallLeaves * 3);
  let placedLeaves = 0;

  // 38 miniature folded russet/ochre/wood-chip scraps scattered across the mossy leaf-mulch bank
  let safety = 0;
  while (placedLeaves < bankLeafCount && safety < 400) {
    safety++;
    const lx = (rand() - 0.5) * 7.2;
    const shoreAtX = evalShorelineZJS(lx);
    const lz = shoreAtX - 0.08 - rand() * 1.45;
    // Avoid overlapping inside Little Nis's solid torso core
    if (Math.hypot(lx, lz + 0.65) < 0.56) continue;

    const by = evalBankHeightAt(lx, lz);
    const fq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.24, rand() * Math.PI * 2, (rand() - 0.5) * 0.24)
    );
    const s = 0.068 + rand() * 0.048;
    dummy.compose(
      new THREE.Vector3(lx, by + 0.008, lz),
      fq,
      new THREE.Vector3(s, 1.0, s * (1.1 + rand() * 0.35))
    );
    floatMesh.setMatrixAt(placedLeaves, dummy);
    floatVars[placedLeaves * 3 + 0] = -0.08 + rand() * 0.42;
    floatVars[placedLeaves * 3 + 1] = 0.68 + rand() * 0.30;
    floatVars[placedLeaves * 3 + 2] = rand();
    placedLeaves++;
  }

  // 16 floating V-folded autumn leaves & small fallen twigs drifting on Holly Pond
  while (placedLeaves < totalSmallLeaves) {
    const lx = (rand() - 0.5) * 6.2;
    const shoreAtX = evalShorelineZJS(lx);
    const lz = shoreAtX + 0.28 + rand() * 3.45;
    if (Math.hypot(lx / 4.2, (lz - 2.85) / 2.85) > 0.84) continue;

    const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
    const s = 0.078 + rand() * 0.042;
    dummy.compose(
      new THREE.Vector3(lx, WATER_LEVEL_Y + 0.005, lz),
      fq,
      new THREE.Vector3(s, 1.0, s * 1.25)
    );
    floatMesh.setMatrixAt(placedLeaves, dummy);
    floatVars[placedLeaves * 3 + 0] = 0.12 + rand() * 0.26;
    floatVars[placedLeaves * 3 + 1] = 0.74 + rand() * 0.24;
    floatVars[placedLeaves * 3 + 2] = rand();
    placedLeaves++;
  }
  floatGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(floatVars, 3));
  floatMesh.instanceMatrix.needsUpdate = true;
  floatMesh.renderOrder = 5;
  rootGroup.add(floatMesh);

  // ============================================================================
  // 5. FOREGROUND KUBELKA-MUNK WATERCOLOR POND GLAZE (`y = WATER_LEVEL_Y`)
  // ============================================================================
  const pondGeom = new THREE.PlaneGeometry(11.4, 7.8, 96, 80);
  pondGeom.rotateX(-Math.PI / 2);
  pondGeom.translate(0, WATER_LEVEL_Y, 2.88);

  const pondMat = createWatercolorPondMaterial(uniforms);
  const pondMesh = new THREE.Mesh(pondGeom, pondMat);
  pondMesh.renderOrder = 4;
  rootGroup.add(pondMesh);

  return {
    rootGroup,
    pondMesh,
    bankMesh,
    skyMesh,
    foliageCount: boughPlacements.length + totalSmallLeaves,
  };
}
