import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  createPaperShingleMaterial,
  createFoldedPaperLeafGeometry,
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
 * Builds the tightly bound (~6.3m span) Paper-Wrapper Woodland Diorama:
 * 0. Concave Wet-on-Wet Botanical Watercolor Sky Wash (`skyMesh`, `renderOrder = 0`)
 *    feathering seamlessly into the `#f2ebd9` Washi paper backdrop behind the canopy.
 * 1. 6-Sheet Layered Torn Deckle-Paper Embankment Island (`bankMesh`, `renderOrder = 2`).
 * 2. Tucked shoreline folded-paper limestone slabs & stone cairn.
 * 3. Sculpted 6-Sleeve Accordion-Pleated Paper Trunks + 14 Angled Paper Boughs (`trunkInstanced`),
 *    terminating cleanly inside the arching paper tree canopy.
 * 4. Vaulted Kirigami 3-Blade V-Folded Paper Canopy Crown (`folMesh`) bounding the top (`+Y`)
 *    of the diorama with crisp flat-faceted folded paper leaves + floating pond leaves.
 * 5. Oval Kubelka-Munk Watercolor Pond (`pondMesh`, `renderOrder = 4`) reflecting the sky & canopy.
 */
export function buildWoodlandDiorama(uniforms: PaperSceneUniforms): WoodlandDioramaAssets {
  const rand = createSeededRandom(77123);
  const rootGroup = new THREE.Group();

  // ============================================================================
  // 0. SUBTLE WET-ON-WET WATERCOLOR SKY WASH BACKDROP (`renderOrder = 0`)
  // ============================================================================
  // Broad, flat/gently-cupped background wash plane behind the woodland (`z ≈ -2.85m`)
  // so it never wraps weirdly around the side flanks and rises cleanly ABOVE the canopy arch!
  const skyGeom = new THREE.PlaneGeometry(9.6, 4.9, 64, 48);
  const skyPos = skyGeom.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < skyPos.count; i++) {
    const sx = skyPos.getX(i);
    const sy = skyPos.getY(i);
    skyPos.setXYZ(i, sx, sy + 2.28, -2.85 + sx * sx * 0.028);
  }
  skyGeom.computeVertexNormals();
  const skyMat = createWatercolorSkyMaterial(uniforms);
  const skyMesh = new THREE.Mesh(skyGeom, skyMat);
  skyMesh.renderOrder = 0;
  rootGroup.add(skyMesh);

  // ============================================================================
  // 1. 6-SHEET LAYERED TORN-PAPER EMBANKMENT ISLAND (`bankMesh`)
  // ============================================================================
  const bankGeom = new THREE.PlaneGeometry(9.6, 5.6, 136, 92);
  bankGeom.rotateX(-Math.PI / 2);

  const posAttr = bankGeom.attributes.position as THREE.BufferAttribute;
  const varArray = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const zLocal = posAttr.getZ(i);
    const z = zLocal - 0.95;
    posAttr.setZ(i, z);

    const shoreZ = evalShorelineZJS(x);
    const distBehindShore = shoreZ - z;

    const bankEllip = Math.hypot(x / 3.26, (z + 0.84) / 1.84);
    const islandTaper = 1.0 - THREE.MathUtils.smoothstep(bankEllip, 0.46, 0.99);

    let y = -0.05;
    if (distBehindShore > -0.22) {
      const slope = Math.max(0, distBehindShore);
      const rawHill = Math.min(0.49, Math.pow(slope, 0.82) * 0.29) * islandTaper;

      // Quantize into 6 crisp stacked contour-paper sheets (~0.076 m per sheet)
      const stepSize = 0.076;
      const sheetIndex = rawHill / stepSize;
      const terracedHill =
        (Math.floor(sheetIndex) + THREE.MathUtils.smoothstep(sheetIndex % 1, 0.14, 0.72)) *
        stepSize;

      const microPaperWave = Math.sin(x * 1.8 + z * 2.2) * 0.012 * islandTaper;

      const guardianPadWeight =
        Math.exp(-(x * x) / 2.0) * Math.exp(-Math.pow(z + 0.62, 2) / 1.05);
      const bankedY = THREE.MathUtils.lerp(
        terracedHill + microPaperWave,
        0.068,
        guardianPadWeight * 0.76
      );

      const shoreRamp = THREE.MathUtils.smoothstep(distBehindShore, -0.22, 0.14);
      y = THREE.MathUtils.lerp(-0.05, Math.max(0.012, bankedY), shoreRamp);
    }

    posAttr.setY(i, y);
    varArray[i * 3 + 0] = (rand() - 0.5) * 0.5;
    varArray[i * 3 + 1] = rand() * 0.6;
    varArray[i * 3 + 2] = rand();
  }

  bankGeom.setAttribute('aVariation', new THREE.BufferAttribute(varArray, 3));
  bankGeom.computeVertexNormals();

  const bankMat = createPaperShingleMaterial(uniforms, { role: 'bank' });
  const bankMesh = new THREE.Mesh(bankGeom, bankMat);
  bankMesh.renderOrder = 2;
  rootGroup.add(bankMesh);

  // ============================================================================
  // 2. TUCKED SHORELINE FOLDED-PAPER LIMESTONE SLABS & CAIRN
  // ============================================================================
  const stoneSpecs: Array<{
    pos: [number, number, number];
    scale: [number, number, number];
    rotY: number;
  }> = [
    { pos: [-0.10, 0.055, 0.15], scale: [0.64, 0.09, 0.34], rotY: 0.08 },
    { pos: [-1.82, 0.05, 0.32], scale: [0.34, 0.085, 0.24], rotY: -0.22 },
    { pos: [-1.14, 0.04, 0.26], scale: [0.26, 0.075, 0.20], rotY: 0.18 },
    { pos: [1.56, 0.055, 0.28], scale: [0.32, 0.10, 0.22], rotY: 0.28 },
    { pos: [1.88, 0.085, 0.35], scale: [0.42, 0.16, 0.30], rotY: -0.26 },
    { pos: [2.08, 0.12, 0.34], scale: [0.32, 0.22, 0.26], rotY: 0.16 },
  ];

  // DodecahedronGeometry(0.5, 0) is already non-indexed with flat planar face normals
  const stoneGeom = new THREE.DodecahedronGeometry(0.5, 0);
  const stoneMat = createPaperShingleMaterial(uniforms, { role: 'stone' });
  const stoneInstanced = new THREE.InstancedMesh(stoneGeom, stoneMat, stoneSpecs.length);
  const stoneVars = new Float32Array(stoneSpecs.length * 3);
  const dummy = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  stoneSpecs.forEach((s, idx) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.16, s.rotY, (rand() - 0.5) * 0.16));
    dummy.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(...s.scale));
    stoneInstanced.setMatrixAt(idx, dummy);
    stoneVars[idx * 3 + 0] = 0.45 + rand() * 0.32;
    stoneVars[idx * 3 + 1] = 0.12;
    stoneVars[idx * 3 + 2] = rand();
  });
  stoneGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(stoneVars, 3));
  stoneInstanced.instanceMatrix.needsUpdate = true;
  stoneInstanced.renderOrder = 3;
  rootGroup.add(stoneInstanced);

  // ============================================================================
  // 3. SMOOTH 6-SIDED FOLDED-PAPER TRUNKS + CLEAN CURVED Y-LIMBS + FALLEN LOGS
  // ============================================================================
  const treeSpecs: Array<{
    x: number;
    z: number;
    baseY: number;
    trunkH: number;
    limbSpan: number;
    radius: number;
    leanX: number;
    leanZ: number;
  }> = [
    { x: -2.04, z: -0.86, baseY: 0.04, trunkH: 0.90, limbSpan: 0.58, radius: 0.136, leanX: -0.04, leanZ: 0.02 },
    { x: -1.52, z: -1.46, baseY: 0.09, trunkH: 1.38, limbSpan: 0.68, radius: 0.148, leanX: -0.04, leanZ: 0.02 },
    { x: -0.90, z: -1.88, baseY: 0.13, trunkH: 1.72, limbSpan: 0.80, radius: 0.158, leanX: -0.03, leanZ: 0.01 },
    { x: 0.92, z: -1.86, baseY: 0.13, trunkH: 1.70, limbSpan: 0.80, radius: 0.156, leanX: 0.03, leanZ: 0.01 },
    { x: 1.54, z: -1.42, baseY: 0.09, trunkH: 1.36, limbSpan: 0.68, radius: 0.146, leanX: 0.04, leanZ: 0.02 },
    { x: 2.06, z: -0.82, baseY: 0.04, trunkH: 0.88, limbSpan: 0.58, radius: 0.134, leanX: 0.04, leanZ: 0.02 },
  ];

  const fallenLogs = [
    { pos: [-1.62, 0.22, -0.56], rot: [0.14, 0.36, 1.44], scale: [0.118, 1.04, 0.118], tone: -0.28 },
    { pos: [-1.46, 0.16, -0.34], rot: [0.08, 0.22, 1.49], scale: [0.102, 0.90, 0.102], tone: -0.20 },
  ];

  const trunkGeom = createSculptedPaperTrunkGeometry();
  const trunkMat = createPaperShingleMaterial(uniforms, { role: 'trunk' });
  const uprightCount = treeSpecs.length + fallenLogs.length;
  const trunkInstanced = new THREE.InstancedMesh(trunkGeom, trunkMat, uprightCount);
  const trunkVars = new Float32Array(uprightCount * 3);

  const trunkReflGeom = trunkGeom.clone();
  const trunkReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-trunk' });
  const trunkReflInstanced = new THREE.InstancedMesh(trunkReflGeom, trunkReflMat, treeSpecs.length);
  const trunkReflVars = new Float32Array(treeSpecs.length * 3);

  // Clean curved 6-sided Y-limbs emerging tangentially out of the top of each trunk
  const limbGeom = createFoldedPaperLimbGeometry();
  const limbCount = treeSpecs.length * 2;
  const limbInstanced = new THREE.InstancedMesh(limbGeom, trunkMat, limbCount);
  const limbVars = new Float32Array(limbCount * 3);

  let wCursor = 0;
  let limbCursor = 0;
  treeSpecs.forEach((tr, idx) => {
    const baseY = tr.baseY;
    const centerY = baseY + tr.trunkH * 0.5;
    q.setFromEuler(new THREE.Euler(tr.leanZ, (idx * 1.1) % (Math.PI * 2), tr.leanX));
    dummy.compose(
      new THREE.Vector3(tr.x, centerY, tr.z),
      q,
      new THREE.Vector3(tr.radius, tr.trunkH, tr.radius)
    );
    trunkInstanced.setMatrixAt(wCursor, dummy);
    const trunkTone = (rand() - 0.5) * 0.35;
    const trunkWarm = 0.22 + rand() * 0.30;
    trunkVars[wCursor * 3 + 0] = trunkTone;
    trunkVars[wCursor * 3 + 1] = trunkWarm;
    trunkVars[wCursor * 3 + 2] = rand();
    wCursor++;

    // Smooth symmetric Y-fork limbs branching outward (`±X`) directly from the trunk crown into the canopy stacks
    const forkBaseY = baseY + tr.trunkH - 0.14;
    for (const side of [-1, 1]) {
      const yaw = side > 0 ? -0.14 : Math.PI + 0.14;
      q.setFromEuler(new THREE.Euler(0.06, yaw, 0.0));
      dummy.compose(
        new THREE.Vector3(tr.x, forkBaseY, tr.z + 0.01),
        q,
        new THREE.Vector3(tr.limbSpan, tr.limbSpan, tr.limbSpan)
      );
      limbInstanced.setMatrixAt(limbCursor, dummy);
      limbVars[limbCursor * 3 + 0] = trunkTone;
      limbVars[limbCursor * 3 + 1] = trunkWarm;
      limbVars[limbCursor * 3 + 2] = rand();
      limbCursor++;
    }

    // Reflected underwater trunk (foreshortened so outer pond crescent stays open for sky reflection)
    const isBehindGuardian = Math.abs(tr.x) < 1.05;
    const reflH = isBehindGuardian ? 0.001 : Math.min(0.62, (tr.trunkH + tr.limbSpan) * 0.26);
    const reflZ = Math.min(0.46, Math.abs(tr.z) * 0.17 + 0.15);
    dummy.compose(
      new THREE.Vector3(tr.x * 0.94, -reflH * 0.5 - 0.02, reflZ),
      q,
      new THREE.Vector3(tr.radius * 0.86, reflH, tr.radius * 0.86)
    );
    trunkReflInstanced.setMatrixAt(idx, dummy);
    trunkReflVars[idx * 3 + 0] = -0.22;
    trunkReflVars[idx * 3 + 1] = 0.18;
    trunkReflVars[idx * 3 + 2] = rand();
  });

  fallenLogs.forEach((el) => {
    q.setFromEuler(new THREE.Euler(el.rot[0], el.rot[1], el.rot[2]));
    dummy.compose(
      new THREE.Vector3(el.pos[0], el.pos[1], el.pos[2]),
      q,
      new THREE.Vector3(el.scale[0], el.scale[1], el.scale[2])
    );
    trunkInstanced.setMatrixAt(wCursor, dummy);
    trunkVars[wCursor * 3 + 0] = el.tone;
    trunkVars[wCursor * 3 + 1] = 0.25;
    trunkVars[wCursor * 3 + 2] = rand();
    wCursor++;
  });

  trunkGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(trunkVars, 3));
  limbGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(limbVars, 3));
  trunkReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(trunkReflVars, 3));
  trunkInstanced.instanceMatrix.needsUpdate = true;
  limbInstanced.instanceMatrix.needsUpdate = true;
  trunkReflInstanced.instanceMatrix.needsUpdate = true;
  trunkInstanced.renderOrder = 3;
  limbInstanced.renderOrder = 3;
  trunkReflInstanced.renderOrder = 1;
  rootGroup.add(trunkInstanced);
  rootGroup.add(limbInstanced);
  rootGroup.add(trunkReflInstanced);

  // ============================================================================
  // 4. STACKED CUT-PAPER CANOPY & BOUGH SHEETS (MATCHING THE 6-SHEET TERRAIN!)
  // ============================================================================
  const foliagePlacements: Array<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    tone: number;
    warmth: number;
    phase: number;
  }> = [];

  // Adds a strictly PARALLEL topographic stack of `layers` deckle-torn Washi sheets:
  // `qSpin` rotates each sheet in its own local plane BEFORE `qTilt`, so all sheets in a stack
  // share the exact same normal vector (zero criss-crossing discs—100% parallel like the 6-sheet terrain!).
  const yAxis = new THREE.Vector3(0, 1, 0);
  const stackUp = new THREE.Vector3();
  const addCutPaperStack = (opts: {
    x: number;
    y: number;
    z: number;
    widthX: number;
    depthZ: number;
    layers: number;
    stepDist: number;
    pitchForward: number;
    rollZ: number;
    warmthBase: number;
    warmthTop: number;
    yawOffset: number;
  }) => {
    const qTilt = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(opts.pitchForward, 0, opts.rollZ, 'XYZ')
    );
    stackUp.set(0, 1, 0).applyQuaternion(qTilt);

    for (let k = 0; k < opts.layers; k++) {
      const frac = opts.layers > 1 ? k / (opts.layers - 1) : 0.5;
      const taper = 1.0 - frac * 0.44;
      const yaw = opts.yawOffset + k * 1.85;
      const qSpin = new THREE.Quaternion().setFromAxisAngle(yAxis, yaw);
      const sheetQuat = qTilt.clone().multiply(qSpin);

      const pos = new THREE.Vector3(opts.x, opts.y, opts.z).addScaledVector(
        stackUp,
        k * opts.stepDist
      );
      foliagePlacements.push({
        pos,
        quat: sheetQuat,
        scale: new THREE.Vector3(opts.widthX * taper, 1.0, opts.depthZ * taper),
        tone: -0.32 + frac * 0.66,
        warmth: THREE.MathUtils.lerp(opts.warmthBase, opts.warmthTop, frac),
        phase: 0.11 + (foliagePlacements.length * 0.173) % 0.87,
      });
    }
  };

  // A. Left Flank Parallel Deckle-Torn Crimson-Amber Maple Bough Stacks (`5` sheets per stack)
  addCutPaperStack({
    x: -2.02, y: 1.24, z: -0.82,
    widthX: 1.72, depthZ: 1.38, layers: 5, stepDist: 0.064,
    pitchForward: 0.20, rollZ: -0.06, warmthBase: 0.90, warmthTop: 0.74, yawOffset: 0.2,
  });
  addCutPaperStack({
    x: -1.66, y: 1.88, z: -1.32,
    widthX: 1.98, depthZ: 1.46, layers: 5, stepDist: 0.064,
    pitchForward: 0.24, rollZ: -0.05, warmthBase: 0.85, warmthTop: 0.65, yawOffset: 1.3,
  });

  // B. Right Flank Parallel Deckle-Torn Olive & Ochre Bough Stacks (`5` sheets per stack)
  addCutPaperStack({
    x: 2.04, y: 1.22, z: -0.78,
    widthX: 1.68, depthZ: 1.36, layers: 5, stepDist: 0.064,
    pitchForward: 0.20, rollZ: 0.06, warmthBase: 0.12, warmthTop: 0.30, yawOffset: 0.7,
  });
  addCutPaperStack({
    x: 1.68, y: 1.86, z: -1.28,
    widthX: 1.94, depthZ: 1.44, layers: 5, stepDist: 0.064,
    pitchForward: 0.24, rollZ: 0.05, warmthBase: 0.18, warmthTop: 0.42, yawOffset: 2.0,
  });

  // C. Broad Overarching Vaulted Canopy Crown (`3` wide overlapping 5-sheet stacks peaking at `y ≈ 2.82m`)
  // Broad horizontal span (`widthX = 2.15..2.32`) avoids a uniform "stepping-stone bead arc",
  // frames the open sky archway behind the Guardian's head (`y = 2.03m`), and leaves `y = 2.82 -> 3.90m` open for the sky!
  addCutPaperStack({
    x: -0.98, y: 2.34, z: -1.68,
    widthX: 2.18, depthZ: 1.48, layers: 5, stepDist: 0.062,
    pitchForward: 0.28, rollZ: -0.06, warmthBase: 0.72, warmthTop: 0.50, yawOffset: 0.6,
  });
  addCutPaperStack({
    x: 0.02, y: 2.52, z: -1.84,
    widthX: 2.34, depthZ: 1.50, layers: 5, stepDist: 0.062,
    pitchForward: 0.30, rollZ: 0.01, warmthBase: 0.48, warmthTop: 0.34, yawOffset: 2.9,
  });
  addCutPaperStack({
    x: 1.00, y: 2.32, z: -1.66,
    widthX: 2.16, depthZ: 1.48, layers: 5, stepDist: 0.062,
    pitchForward: 0.28, rollZ: 0.06, warmthBase: 0.30, warmthTop: 0.24, yawOffset: 4.5,
  });

  // D. Shoreline Mossy-Sage 4-Sheet Torn-Paper Shrub Stacks tucked beside left & right banks
  addCutPaperStack({
    x: -1.80, y: 0.15, z: -0.18,
    widthX: 0.88, depthZ: 0.76, layers: 4, stepDist: 0.048,
    pitchForward: 0.14, rollZ: -0.04, warmthBase: 0.06, warmthTop: 0.18, yawOffset: 0.9,
  });
  addCutPaperStack({
    x: 1.84, y: 0.15, z: -0.14,
    widthX: 0.88, depthZ: 0.76, layers: 4, stepDist: 0.048,
    pitchForward: 0.14, rollZ: 0.04, warmthBase: 0.06, warmthTop: 0.18, yawOffset: 2.4,
  });

  // E. Calm Floating Torn-Paper Autumn Leaves on the Pond Surface (`y = 0.015`)
  const floatingPlacements: Array<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    tone: number;
    warmth: number;
    phase: number;
  }> = [];
  for (let i = 0; i < 12; i++) {
    const lx = (rand() - 0.5) * 2.6;
    const lz = 0.46 + rand() * 1.15;
    const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
    const s = 0.16 + rand() * 0.08;
    floatingPlacements.push({
      pos: new THREE.Vector3(lx, 0.015, lz),
      quat: fq,
      scale: new THREE.Vector3(s, 0.5, s * 1.18),
      tone: 0.22 + rand() * 0.34,
      warmth: 0.65 + rand() * 0.32,
      phase: rand(),
    });
  }

  const folGeom = createFoldedPaperLeafGeometry();
  const folMat = createPaperShingleMaterial(uniforms, { role: 'foliage' });
  const folReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-foliage' });

  const totalUprightFol = foliagePlacements.length + floatingPlacements.length;
  const folMesh = new THREE.InstancedMesh(folGeom, folMat, totalUprightFol);
  const folReflGeom = folGeom.clone();
  const folReflMesh = new THREE.InstancedMesh(folReflGeom, folReflMat, foliagePlacements.length);

  const folVars = new Float32Array(totalUprightFol * 3);
  const folReflVars = new Float32Array(foliagePlacements.length * 3);

  foliagePlacements.forEach((fp, i) => {
    dummy.compose(fp.pos, fp.quat, fp.scale);
    folMesh.setMatrixAt(i, dummy);

    // Projectively calibrated inverted canopy arch reflection (`waterHitZ` curves from `~0.9m` on flanks
    // to `~1.75m` along the central arch, leaving BOTH the inner archway clearing AND the outer foreground
    // pond crescent `z > 1.90m` open to mirror the celadon watercolor sky!)
    const reflZ = Math.min(0.56, 0.14 + Math.max(0, fp.pos.y - 0.95) * 0.24);
    const reflY = -Math.min(0.46, fp.pos.y * 0.165);
    const isBlockingGuardianChest = Math.abs(fp.pos.x) < 1.05 && fp.pos.y < 2.20;
    const reflScale = isBlockingGuardianChest || fp.pos.y < 0.25 ? 0.001 : 0.58;
    dummy.compose(
      new THREE.Vector3(fp.pos.x * 0.90, reflY, reflZ),
      fp.quat,
      new THREE.Vector3(fp.scale.x * reflScale, fp.scale.y * reflScale, fp.scale.z * reflScale)
    );
    folReflMesh.setMatrixAt(i, dummy);

    folVars[i * 3 + 0] = fp.tone;
    folVars[i * 3 + 1] = fp.warmth;
    folVars[i * 3 + 2] = fp.phase;

    folReflVars[i * 3 + 0] = fp.tone;
    folReflVars[i * 3 + 1] = fp.warmth;
    folReflVars[i * 3 + 2] = fp.phase;
  });

  floatingPlacements.forEach((fp, j) => {
    const idx = foliagePlacements.length + j;
    dummy.compose(fp.pos, fp.quat, fp.scale);
    folMesh.setMatrixAt(idx, dummy);
    folVars[idx * 3 + 0] = fp.tone;
    folVars[idx * 3 + 1] = fp.warmth;
    folVars[idx * 3 + 2] = fp.phase;
  });

  folGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folVars, 3));
  folReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folReflVars, 3));
  folMesh.instanceMatrix.needsUpdate = true;
  folReflMesh.instanceMatrix.needsUpdate = true;
  folMesh.renderOrder = 3;
  folReflMesh.renderOrder = 1;
  rootGroup.add(folMesh);
  rootGroup.add(folReflMesh);

  // ============================================================================
  // 5. FOREGROUND KUBELKA-MUNK WATERCOLOR POND SURFACE (`y = 0.008`)
  // ============================================================================
  const pondGeom = new THREE.PlaneGeometry(8.8, 6.4, 96, 96);
  pondGeom.rotateX(-Math.PI / 2);
  pondGeom.translate(0, 0.008, 2.15);

  const pondMat = createWatercolorPondMaterial(uniforms);
  const pondMesh = new THREE.Mesh(pondGeom, pondMat);
  pondMesh.renderOrder = 4;
  rootGroup.add(pondMesh);

  return {
    rootGroup,
    pondMesh,
    bankMesh,
    skyMesh,
    foliageCount: totalUprightFol,
  };
}
