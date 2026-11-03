import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  WATER_LEVEL_Y,
  createPaperShingleMaterial,
  createFoldedPaperLeafGeometry,
  createOrigamiFloatingLeafGeometry,
  createSculptedPaperTrunkGeometry,
  createFoldedPaperLimbGeometry,
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
 * Builds the Compressed Origami × Watercolor Washi Woodland Cove Diorama (`IMG_0382.DNG` scale & split):
 * 0. Upright & Planar-Reflected Wet-on-Wet Sky Wash (`skyMesh`, `skyReflMesh`, `renderOrder = 0`)
 *    with right-hand low afternoon sun clearing (`x ≈ +2.35, y ≈ +2.28`).
 * 1. Non-Indexed Angular-Faceted & Tucked Cove Embankment (`bankMesh`, `y >= WATER_LEVEL_Y`, `z <= shoreZ`).
 * 2. Origami Folded Limestone Slabs, Right-Bank Cairn & 2-Post Trailhead Placard (+ planar reflections).
 * 3. 24 Multi-Depth Tall Creased Bark-Sheet Trunks (`3.8m – 5.9m`, ~4× guardian height) + Upward V-Branches.
 * 4. 3D Compressed Accordion-Pleated Origami Bough Fans grouped into 3 broad watercolor color regions
 *    with deliberate open vertical sky slits + 16 V-folded floating pond leaves.
 * 5. Foreground Kubelka-Munk Olive-Tannin Watercolor Pond Surface (`pondMesh`, `renderOrder = 4`).
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
    const skyH = isReflected ? 7.8 : 5.2;
    const skyW = isReflected ? 24.0 : 14.4;
    const geom = new THREE.PlaneGeometry(skyW, skyH, 56, 32);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const sx = pos.getX(i);
      const rawY = pos.getY(i) + skyH * 0.5 + 0.05;
      // Tilt reflected sky dome gently forward at high `rawY` so steep foreground pond rays always hit sky wash!
      const sz = isReflected
        ? -4.15 + sx * sx * 0.02 + Math.max(0, rawY - 2.2) * 0.68
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
  // 1. ANGULAR-FACETED & TUCKED MOSSY COVE EMBANKMENT (`bankMesh`)
  // ============================================================================
  const indexedBank = new THREE.PlaneGeometry(10.8, 5.8, 38, 24);
  indexedBank.rotateX(-Math.PI / 2);

  const bPos = indexedBank.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i);
    const z = bPos.getZ(i) - 1.38;
    bPos.setZ(i, z);

    const shoreZ = evalShorelineZJS(x);
    const distBehind = shoreZ - z;

    if (distBehind <= -0.05) {
      bPos.setY(i, WATER_LEVEL_Y - 0.015);
    } else {
      const slope = Math.max(0, distBehind);
      const diagCrease =
        Math.abs(((x * 0.52 + z * 0.38 + 4.0) % 1.0) - 0.5) * 0.075 +
        Math.sin(x * 0.9 - z * 1.1) * 0.026;
      const tuckStep = Math.floor(slope * 1.1) * 0.036;
      const rawBankY = 0.024 + Math.min(0.62, Math.pow(slope, 0.85) * 0.18 + tuckStep + diagCrease);

      const padWeight = Math.exp(-(x * x) / 2.2) * Math.exp(-Math.pow(z + 0.56, 2) / 1.15);
      const padBlendedY = THREE.MathUtils.lerp(rawBankY, 0.056, padWeight * 0.82);
      const shoreRamp = THREE.MathUtils.smoothstep(distBehind, -0.03, 0.15);
      const finalY = Math.max(
        WATER_LEVEL_Y + 0.002,
        THREE.MathUtils.lerp(WATER_LEVEL_Y + 0.002, padBlendedY, shoreRamp)
      );
      bPos.setY(i, finalY);
    }
  }

  const bankGeom = indexedBank.toNonIndexed();
  indexedBank.dispose();
  bankGeom.computeVertexNormals();

  const bCount = bankGeom.attributes.position.count;
  const bankVars = new Float32Array(bCount * 3);
  for (let tri = 0; tri < bCount; tri += 3) {
    const tShift = (rand() - 0.5) * 0.16;
    const wShift = 0.22 + rand() * 0.32;
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
  // 2. SHORELINE WEATHERED STONES, CENTRAL FLAT SLAB & RIGHT COVE STONES (`Photo 1:1`)
  // ============================================================================
  const stoneSpecs: Array<{
    pos: [number, number, number];
    scale: [number, number, number];
    rotY: number;
  }> = [
    // Prominent flat pale weathered limestone slab centered right in front of the Guardian's feet!
    { pos: [-0.04, 0.046, 0.14], scale: [0.54, 0.068, 0.25], rotY: 0.06 },
    // Small shoreline stones near left & right hands (`media_1793684401016_7f0a395e.jpg`)
    { pos: [-1.22, 0.038, 0.22], scale: [0.24, 0.062, 0.18], rotY: 0.14 },
    { pos: [-1.92, 0.044, 0.24], scale: [0.28, 0.072, 0.20], rotY: -0.22 },
    { pos: [0.88, 0.036, 0.22], scale: [0.20, 0.056, 0.16], rotY: -0.14 },
    // Two pale angular shoreline stones on the viewer-right bank (`x ≈ 1.72..2.08` in close-up photo!)
    { pos: [1.72, 0.058, 0.28], scale: [0.29, 0.095, 0.22], rotY: 0.28 },
    { pos: [2.06, 0.052, 0.32], scale: [0.24, 0.082, 0.19], rotY: -0.34 },
    // Outer right-cove stone cairn & 2-post trailhead placard (`IMG_0382.DNG` wide cove frame)
    { pos: [2.48, 0.072, 0.38], scale: [0.32, 0.12, 0.24], rotY: -0.22 },
    { pos: [2.50, 0.155, 0.37], scale: [0.21, 0.10, 0.18], rotY: 0.20 },
    { pos: [3.10, 0.42, 0.48], scale: [0.30, 0.19, 0.04], rotY: -0.32 },
  ];

  const stoneGeom = new THREE.DodecahedronGeometry(0.5, 0);
  const stoneMat = createPaperShingleMaterial(uniforms, { role: 'stone' });
  const stoneReflGeom = stoneGeom.clone();
  const stoneReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-stone' });

  const stoneInstanced = new THREE.InstancedMesh(stoneGeom, stoneMat, stoneSpecs.length);
  const stoneReflInstanced = new THREE.InstancedMesh(stoneReflGeom, stoneReflMat, stoneSpecs.length);
  const stoneVars = new Float32Array(stoneSpecs.length * 3);

  stoneSpecs.forEach((s, idx) => {
    const isPlacard = idx === stoneSpecs.length - 1;
    q.setFromEuler(
      new THREE.Euler(
        isPlacard ? 0.06 : (rand() - 0.5) * 0.15,
        s.rotY,
        isPlacard ? 0.0 : (rand() - 0.5) * 0.15
      )
    );
    dummy.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(...s.scale));
    stoneInstanced.setMatrixAt(idx, dummy);

    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    stoneReflInstanced.setMatrixAt(idx, dummyRefl);

    stoneVars[idx * 3 + 0] = isPlacard ? 0.28 : (rand() - 0.5) * 0.28;
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
  // 3. 15 SLENDER LATE-AUTUMN WOODLAND TRUNKS (`2.35m – 3.18m`, feathered inside Washi frame!)
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
  }> = [
    // Left woodland stems (framed behind fallen mossy logs just like `media_1793684401016_7f0a395e.jpg`)
    { x: -3.72, z: -0.92, baseY: 0.08, trunkH: 2.38, radius: 0.082, leanX: -0.04, leanZ: 0.02, limbs: 2 },
    { x: -2.98, z: -1.48, baseY: 0.12, trunkH: 2.75, radius: 0.092, leanX: 0.02, leanZ: 0.01, limbs: 2 },
    { x: -2.22, z: -1.68, baseY: 0.14, trunkH: 2.98, radius: 0.098, leanX: -0.02, leanZ: 0.01, limbs: 2 },
    { x: -1.52, z: -1.92, baseY: 0.15, trunkH: 3.08, radius: 0.080, leanX: 0.03, leanZ: 0.02, limbs: 2 },

    // Airy central background stems (parted around `x ≈ -0.30` sky clearing above the Guardian!)
    { x: -0.86, z: -2.32, baseY: 0.17, trunkH: 3.16, radius: 0.078, leanX: -0.02, leanZ: 0.01, limbs: 2 },
    { x: 0.28, z: -2.38, baseY: 0.18, trunkH: 3.18, radius: 0.086, leanX: 0.02, leanZ: 0.01, limbs: 2 },
    { x: 1.06, z: -1.96, baseY: 0.15, trunkH: 3.04, radius: 0.090, leanX: 0.03, leanZ: 0.02, limbs: 2 },

    // Right sunlit clearing grove with forked bare late-autumn branches (`photo right half!`)
    { x: 1.74, z: -1.62, baseY: 0.12, trunkH: 2.92, radius: 0.096, leanX: -0.01, leanZ: 0.01, limbs: 3 },
    { x: 2.36, z: -2.08, baseY: 0.15, trunkH: 2.78, radius: 0.080, leanX: 0.04, leanZ: 0.02, limbs: 3 },
    { x: 2.98, z: -1.42, baseY: 0.11, trunkH: 2.62, radius: 0.086, leanX: 0.05, leanZ: 0.02, limbs: 2 },
    { x: 3.68, z: -0.84, baseY: 0.08, trunkH: 2.28, radius: 0.078, leanX: 0.07, leanZ: 0.02, limbs: 2 },

    // Delicate deeper background saplings (creating vertical pond reflections through open sky washes!)
    { x: -2.58, z: -2.78, baseY: 0.20, trunkH: 2.82, radius: 0.058, leanX: 0.01, leanZ: 0.0, limbs: 1 },
    { x: -1.24, z: -2.92, baseY: 0.20, trunkH: 2.98, radius: 0.056, leanX: -0.01, leanZ: 0.0, limbs: 1 },
    { x: 0.68, z: -2.88, baseY: 0.20, trunkH: 2.96, radius: 0.056, leanX: -0.01, leanZ: 0.0, limbs: 1 },
    { x: 2.08, z: -2.85, baseY: 0.20, trunkH: 2.72, radius: 0.058, leanX: 0.02, leanZ: 0.0, limbs: 1 },
  ];

  // Mossy fallen logs behind Guardian's left flank (`photo left bank`) + 2 trailhead sign posts (`x ≈ 3.10`)
  const auxWoodSpecs = [
    { pos: [-2.05, 0.21, -0.66], rot: [0.14, 0.38, 1.44], scale: [0.112, 1.42, 0.112], tone: -0.32 },
    { pos: [-1.84, 0.14, -0.40], rot: [0.08, 0.24, 1.49], scale: [0.094, 1.16, 0.094], tone: -0.24 },
    { pos: [2.99, 0.24, 0.51], rot: [0.0, 0.0, 0.01], scale: [0.022, 0.38, 0.022], tone: 0.10 },
    { pos: [3.21, 0.24, 0.45], rot: [0.0, 0.0, -0.01], scale: [0.022, 0.38, 0.022], tone: 0.10 },
  ];

  const trunkGeom = createSculptedPaperTrunkGeometry();
  const trunkReflGeom = trunkGeom.clone();
  const trunkMat = createPaperShingleMaterial(uniforms, { role: 'trunk' });
  const trunkReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-trunk' });

  const totalTrunks = treeSpecs.length + auxWoodSpecs.length;
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

    const tTone = (rand() - 0.5) * 0.32;
    const tWarm = tr.x > 1.2 ? 0.36 + rand() * 0.22 : 0.16 + rand() * 0.20;
    trunkVars[wCursor * 3 + 0] = tTone;
    trunkVars[wCursor * 3 + 1] = tWarm;
    trunkVars[wCursor * 3 + 2] = rand();
    wCursor++;

    for (let b = 0; b < tr.limbs; b++) {
      const side = b % 2 === 0 ? -1 : 1;
      const attachFrac = 0.38 + (b / Math.max(1, tr.limbs)) * 0.44;
      const attachY = tr.baseY + tr.trunkH * attachFrac;
      const isSunClearingTree = tr.x > 1.65;
      const limbLen = isSunClearingTree ? 0.95 + rand() * 0.42 : 0.82 + rand() * 0.28;
      const yaw = (side > 0 ? -0.15 : Math.PI + 0.15) + (rand() - 0.5) * 0.52;
      q.setFromEuler(new THREE.Euler(0.10, yaw, side * -0.16));
      dummy.compose(
        new THREE.Vector3(tr.x, attachY, tr.z),
        q,
        new THREE.Vector3(limbLen, limbLen * 0.95, limbLen)
      );
      limbInstanced.setMatrixAt(lCursor, dummy);
      dummyRefl.copy(dummy).premultiply(reflPlaneMat);
      limbReflInstanced.setMatrixAt(lCursor, dummyRefl);

      limbVars[lCursor * 3 + 0] = tTone;
      limbVars[lCursor * 3 + 1] = tWarm;
      limbVars[lCursor * 3 + 2] = rand();
      lCursor++;
    }
  });

  auxWoodSpecs.forEach((aw) => {
    q.setFromEuler(new THREE.Euler(aw.rot[0], aw.rot[1], aw.rot[2]));
    dummy.compose(new THREE.Vector3(...aw.pos), q, new THREE.Vector3(...aw.scale));
    trunkInstanced.setMatrixAt(wCursor, dummy);
    dummyRefl.copy(dummy).premultiply(reflPlaneMat);
    trunkReflInstanced.setMatrixAt(wCursor, dummyRefl);

    trunkVars[wCursor * 3 + 0] = aw.tone;
    trunkVars[wCursor * 3 + 1] = 0.22;
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
  // 4. ASYMMETRIC ORIGAMI DIHEDRAL BOUGH CLUSTERS (`IMG_0382` DENSE COVE + 3 ZONES)
  // ============================================================================
  const boughPlacements: Array<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    tone: number;
    warmth: number;
    phase: number;
  }> = [];

  const addOrigamiBoughCascade = (opts: {
    x: number;
    z: number;
    yStart: number;
    yEnd: number;
    tiers: number;
    baseWidth: number;
    topWidth: number;
    warmth: number;
    pitchBase: number;
    yawSeed: number;
  }) => {
    for (let k = 0; k < opts.tiers; k++) {
      const frac = opts.tiers > 1 ? k / (opts.tiers - 1) : 0.5;
      const y = THREE.MathUtils.lerp(opts.yStart, opts.yEnd, frac);
      const w = THREE.MathUtils.lerp(opts.baseWidth, opts.topWidth, frac);
      // Orient bough cluster primarily forward toward the pond (`yaw ∈ [-0.55, +0.55]`) with organic stagger!
      const yaw = opts.yawSeed + Math.sin(k * 2.3 + opts.x) * 0.42 + (rand() - 0.5) * 0.22;
      const pitch = opts.pitchBase - frac * 0.12;
      const roll = (rand() - 0.5) * 0.20;
      const bQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));

      boughPlacements.push({
        pos: new THREE.Vector3(
          opts.x + Math.sin(k * 1.9 + opts.z) * 0.14,
          y,
          opts.z + Math.cos(k * 1.6) * 0.12
        ),
        quat: bQuat,
        scale: new THREE.Vector3(w, 0.95 + frac * 0.24, w * 0.95),
        tone: -0.20 + frac * 0.42,
        warmth: opts.warmth,
        phase: rand(),
      });
    }
  };

  // A. Light, Airy Woodland Understory Shrubs (`34` delicate bough sprays total — open sky windows everywhere!)
  addOrigamiBoughCascade({
    x: -2.48, z: -1.18, yStart: 0.44, yEnd: 1.32, tiers: 2,
    baseWidth: 1.06, topWidth: 0.82, warmth: 0.18, pitchBase: 0.22, yawSeed: 0.22,
  });
  addOrigamiBoughCascade({
    x: -1.36, z: -1.62, yStart: 0.56, yEnd: 1.35, tiers: 2,
    baseWidth: 1.04, topWidth: 0.78, warmth: 0.10, pitchBase: 0.18, yawSeed: 0.10,
  });
  addOrigamiBoughCascade({
    x: 0.88, z: -1.58, yStart: 0.52, yEnd: 1.38, tiers: 2,
    baseWidth: 1.05, topWidth: 0.78, warmth: 0.12, pitchBase: 0.18, yawSeed: -0.08,
  });
  addOrigamiBoughCascade({
    x: 1.78, z: -1.34, yStart: 0.42, yEnd: 1.15, tiers: 2,
    baseWidth: 0.98, topWidth: 0.72, warmth: 0.18, pitchBase: 0.20, yawSeed: -0.16,
  });

  // Low shoreline bramble tucked beside left fallen logs (`media_1793684401016_7f0a395e.jpg`)
  addOrigamiBoughCascade({
    x: -2.18, z: -0.46, yStart: 0.18, yEnd: 0.44, tiers: 2,
    baseWidth: 0.84, topWidth: 0.62, warmth: 0.08, pitchBase: 0.24, yawSeed: 0.18,
  });

  // B. Broad Region 1 — Airy Upper-Left Autumn Russet-Ochre Boughs (`feathered cleanly inside Washi frame!`)
  addOrigamiBoughCascade({
    x: -3.55, z: -0.92, yStart: 1.18, yEnd: 2.38, tiers: 3,
    baseWidth: 1.16, topWidth: 0.68, warmth: 0.88, pitchBase: 0.22, yawSeed: 0.26,
  });
  addOrigamiBoughCascade({
    x: -2.68, z: -1.46, yStart: 1.48, yEnd: 2.78, tiers: 3,
    baseWidth: 1.18, topWidth: 0.66, warmth: 0.92, pitchBase: 0.20, yawSeed: 0.14,
  });
  addOrigamiBoughCascade({
    x: -1.68, z: -1.82, yStart: 1.75, yEnd: 2.95, tiers: 3,
    baseWidth: 1.08, topWidth: 0.62, warmth: 0.72, pitchBase: 0.18, yawSeed: 0.06,
  });

  // C. Broad Region 2 — Parted Central Olive-Sage Upper Canopy (open luminous sky clearing above Guardian!)
  addOrigamiBoughCascade({
    x: -0.92, z: -2.28, yStart: 2.05, yEnd: 3.05, tiers: 3,
    baseWidth: 1.04, topWidth: 0.54, warmth: 0.10, pitchBase: 0.16, yawSeed: 0.04,
  });
  addOrigamiBoughCascade({
    x: 0.44, z: -2.24, yStart: 1.85, yEnd: 3.08, tiers: 3,
    baseWidth: 1.08, topWidth: 0.56, warmth: 0.08, pitchBase: 0.17, yawSeed: -0.05,
  });
  addOrigamiBoughCascade({
    x: 1.24, z: -1.88, yStart: 1.72, yEnd: 2.92, tiers: 3,
    baseWidth: 1.04, topWidth: 0.58, warmth: 0.16, pitchBase: 0.19, yawSeed: -0.12,
  });

  // D. Broad Region 3 — Right Sunlit Clearing Sprays (`sparse golden-olive clusters around bare winter branches!`)
  addOrigamiBoughCascade({
    x: 2.18, z: -1.85, yStart: 1.92, yEnd: 2.82, tiers: 2,
    baseWidth: 1.02, topWidth: 0.60, warmth: 0.30, pitchBase: 0.18, yawSeed: -0.20,
  });
  addOrigamiBoughCascade({
    x: 2.98, z: -1.42, yStart: 1.62, yEnd: 2.58, tiers: 2,
    baseWidth: 1.05, topWidth: 0.62, warmth: 0.38, pitchBase: 0.20, yawSeed: -0.26,
  });
  addOrigamiBoughCascade({
    x: 3.62, z: -0.86, yStart: 1.08, yEnd: 2.18, tiers: 2,
    baseWidth: 1.02, topWidth: 0.60, warmth: 0.42, pitchBase: 0.22, yawSeed: -0.32,
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

  // E. 16 Miniature 2-Facet V-Folded Origami Floating Autumn Leaves on the Pond (`below fingertip scale`)
  const floatCount = 16;
  const floatGeom = createOrigamiFloatingLeafGeometry();
  const floatMesh = new THREE.InstancedMesh(floatGeom, folMat, floatCount);
  const floatVars = new Float32Array(floatCount * 3);
  let placedLeaves = 0;

  while (placedLeaves < floatCount) {
    const lx = (rand() - 0.5) * 6.2;
    const shoreAtX = evalShorelineZJS(lx);
    const lz = shoreAtX + 0.30 + rand() * 3.45;
    if (Math.hypot(lx / 4.2, (lz - 2.85) / 2.85) > 0.84) continue;

    const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
    const s = 0.082 + rand() * 0.042;
    dummy.compose(
      new THREE.Vector3(lx, WATER_LEVEL_Y + 0.005, lz),
      fq,
      new THREE.Vector3(s, 1.0, s * 1.25)
    );
    floatMesh.setMatrixAt(placedLeaves, dummy);
    floatVars[placedLeaves * 3 + 0] = 0.14 + rand() * 0.24;
    floatVars[placedLeaves * 3 + 1] = 0.72 + rand() * 0.26;
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
    foliageCount: boughPlacements.length + floatCount,
  };
}
