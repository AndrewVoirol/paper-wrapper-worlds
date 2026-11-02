import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  createPaperShingleMaterial,
  createFoldedPaperLeafGeometry,
  createCreasedPaperStripGeometry,
} from '../shaders/paperCraftShader';
import { createWatercolorPondMaterial } from '../shaders/watercolorPondShader';

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
  foliageCount: number;
}

/**
 * Builds the surrounding Paper-Wrapper Woodland Diorama matching both the portrait and
 * wide-angle reference photographs:
 * 1. Terraced contour-paper shoreline embankment with the curved cove on the right (`x > 2.2`).
 * 2. Shoreline limestone slabs (flat pale stone in front of guardian's feet + stacked stone cairn
 *    on the right bank at `x ≈ 1.85..2.55`) & fallen mossy logs behind the left arm.
 * 3. Wooden trailhead placard / sign on two posts (`x ≈ 3.85`) from the wide-angle photo.
 * 4. Crimson-russet autumn maple tree on the left shoreline (`x ≈ -3.5`), green bush at `x ≈ -2.4`,
 *    and tall vertical woodland trunks with folded origami leaf clusters.
 * 5. Foreground Kubelka-Munk Watercolor Pond (`y = 0.0`) with golden-hour sun-glint reflections.
 */
export function buildWoodlandDiorama(uniforms: PaperSceneUniforms): WoodlandDioramaAssets {
  const rand = createSeededRandom(77123);
  const rootGroup = new THREE.Group();

  // ============================================================================
  // 1. TERRACED CONTOUR-PAPER EMBANKMENT & CURVED RIGHT-HAND COVE
  // ============================================================================
  const bankGeom = new THREE.PlaneGeometry(13.5, 6.8, 96, 56);
  bankGeom.rotateX(-Math.PI / 2);

  const posAttr = bankGeom.attributes.position as THREE.BufferAttribute;
  const varArray = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const zLocal = posAttr.getZ(i);
    const z = zLocal - 1.75;
    posAttr.setZ(i, z);

    // Wide-angle shoreline curve:
    // - Near center (`x` in `[-2..2]`): sits at `z ≈ 0.22 + 0.14 * cos(x * 0.85)`
    // - On the right (`x > 2.0`): curves forward into the right-hand grassy bank (`z` reaches `+1.65`)
    const rightCoveForward = Math.max(0, x - 1.85) * 0.42;
    const shoreZ = 0.22 + Math.cos(x * 0.85) * 0.14 + rightCoveForward;
    const distBehindShore = shoreZ - z;

    let y = -0.38;
    if (distBehindShore > -0.22) {
      const slope = Math.max(0, distBehindShore);
      const rawHill = Math.min(1.75, Math.pow(slope, 0.86) * 0.34);

      // Quantize softly into terraced stacked-cardboard / contour-paper steps (height = 0.085 m per sheet)
      const stepSize = 0.085;
      const sheetIndex = rawHill / stepSize;
      const terracedHill =
        (Math.floor(sheetIndex) + THREE.MathUtils.smoothstep(sheetIndex % 1, 0.15, 0.85)) *
        stepSize;

      const microPaperWave = Math.sin(x * 1.6 + z * 2.0) * 0.025;
      // Flatten gently around the guardian's crouch pad (`x` in `[-1.5..1.5]`, `z` in `[-1.4..0.2]`)
      const guardianPadWeight =
        Math.exp(-(x * x) / 2.2) * Math.exp(-Math.pow(z + 0.65, 2) / 1.1);
      y = THREE.MathUtils.lerp(terracedHill + microPaperWave, 0.075, guardianPadWeight * 0.74);
    }

    // Taper outer island perimeter
    const radialDist = Math.hypot(x * 0.62, (z + 0.4) * 0.78);
    if (radialDist > 4.2) {
      y -= (radialDist - 4.2) * 0.48;
    }

    posAttr.setY(i, y);
    varArray[i * 3 + 0] = (rand() - 0.5) * 0.55;
    varArray[i * 3 + 1] = rand() * 0.65;
    varArray[i * 3 + 2] = rand();
  }

  bankGeom.setAttribute('aVariation', new THREE.BufferAttribute(varArray, 3));
  bankGeom.computeVertexNormals();

  const bankMat = createPaperShingleMaterial(uniforms, { role: 'bank' });
  const bankMesh = new THREE.Mesh(bankGeom, bankMat);
  bankMesh.receiveShadow = true;
  rootGroup.add(bankMesh);

  // ============================================================================
  // 2. SHORELINE FOLDED-PAPER LIMESTONE SLABS & RIGHT-BANK CAIRN
  // ============================================================================
  const stoneSpecs: Array<{ pos: [number, number, number]; scale: [number, number, number]; rotY: number }> = [
    // Center flat pale stone right in front of the guardian's feet
    { pos: [-0.12, 0.06, 0.14], scale: [0.68, 0.10, 0.36], rotY: 0.08 },
    // Left shoreline stones near the guardian's right hand
    { pos: [-1.85, 0.05, 0.32], scale: [0.38, 0.09, 0.26], rotY: -0.24 },
    { pos: [-1.18, 0.04, 0.25], scale: [0.28, 0.08, 0.22], rotY: 0.19 },
    // Right shoreline stone cluster / cairn (prominent in both photos at x ≈ 1.8..2.6)
    { pos: [1.72, 0.06, 0.26], scale: [0.34, 0.11, 0.24], rotY: 0.32 },
    { pos: [2.18, 0.09, 0.34], scale: [0.46, 0.18, 0.34], rotY: -0.28 },
    { pos: [2.42, 0.14, 0.32], scale: [0.38, 0.26, 0.30], rotY: 0.18 }, // Upright angled boulder on right
    { pos: [2.68, 0.07, 0.42], scale: [0.32, 0.12, 0.25], rotY: -0.41 },
  ];

  const stoneGeom = new THREE.DodecahedronGeometry(0.5, 0);
  const stoneMat = createPaperShingleMaterial(uniforms, { role: 'stone' });
  const stoneInstanced = new THREE.InstancedMesh(stoneGeom, stoneMat, stoneSpecs.length * 2);
  const stoneVars = new Float32Array(stoneSpecs.length * 2 * 3);
  const dummy = new THREE.Matrix4();
  const q = new THREE.Quaternion();

  stoneSpecs.forEach((s, idx) => {
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.18, s.rotY, (rand() - 0.5) * 0.18));
    dummy.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(...s.scale));
    stoneInstanced.setMatrixAt(idx, dummy);
    stoneVars[idx * 3 + 0] = 0.48 + rand() * 0.35;
    stoneVars[idx * 3 + 1] = 0.12;
    stoneVars[idx * 3 + 2] = rand();

    const rIdx = stoneSpecs.length + idx;
    dummy.compose(
      new THREE.Vector3(s.pos[0], -s.pos[1], s.pos[2]),
      q,
      new THREE.Vector3(s.scale[0], s.scale[1], s.scale[2])
    );
    stoneInstanced.setMatrixAt(rIdx, dummy);
    stoneVars[rIdx * 3 + 0] = 0.25;
    stoneVars[rIdx * 3 + 1] = 0.1;
    stoneVars[rIdx * 3 + 2] = rand();
  });
  stoneGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(stoneVars, 3));
  stoneInstanced.instanceMatrix.needsUpdate = true;
  rootGroup.add(stoneInstanced);

  // ============================================================================
  // 3. FOREST TREE TRUNKS, FALLEN LOGS & TRAILHEAD WOODEN SIGN (Wide-Angle Photo)
  // ============================================================================
  const treeSpecs: Array<{
    x: number;
    z: number;
    height: number;
    radius: number;
    leanX: number;
    leanZ: number;
  }> = [
    // Left crimson maple & oak grove
    { x: -4.25, z: -0.95, height: 4.8, radius: 0.18, leanX: 0.08, leanZ: 0.04 },
    { x: -3.25, z: -1.65, height: 5.3, radius: 0.21, leanX: 0.04, leanZ: 0.02 },
    { x: -2.25, z: -2.55, height: 5.6, radius: 0.18, leanX: -0.05, leanZ: 0.03 },
    { x: -1.35, z: -2.95, height: 5.4, radius: 0.16, leanX: 0.08, leanZ: 0.01 },
    { x: -0.35, z: -3.15, height: 5.8, radius: 0.23, leanX: -0.03, leanZ: 0.02 },
    { x: 0.85, z: -2.95, height: 5.5, radius: 0.17, leanX: 0.06, leanZ: 0.04 },
    { x: 1.88, z: -1.85, height: 5.3, radius: 0.19, leanX: -0.04, leanZ: 0.02 },
    { x: 2.95, z: -2.35, height: 5.6, radius: 0.22, leanX: 0.03, leanZ: -0.02 },
    // Right trailhead & sun-filter trunks
    { x: 3.65, z: -1.35, height: 5.1, radius: 0.17, leanX: -0.06, leanZ: 0.03 },
    { x: 4.45, z: -0.55, height: 4.9, radius: 0.19, leanX: 0.05, leanZ: 0.02 },
  ];

  const trunkGeom = new THREE.CylinderGeometry(0.74, 1.0, 1.0, 7);
  const trunkMat = createPaperShingleMaterial(uniforms, { role: 'trunk' });
  // +2 fallen logs + 3 sign elements (2 posts + 1 board)
  const totalTrunks = (treeSpecs.length + 5) * 2;
  const trunkInstanced = new THREE.InstancedMesh(trunkGeom, trunkMat, totalTrunks);
  const trunkVars = new Float32Array(totalTrunks * 3);

  let tCursor = 0;
  treeSpecs.forEach((tr) => {
    const baseY = 0.25;
    const centerY = baseY + tr.height * 0.5;
    q.setFromEuler(new THREE.Euler(tr.leanZ, rand() * Math.PI, tr.leanX));
    dummy.compose(
      new THREE.Vector3(tr.x, centerY, tr.z),
      q,
      new THREE.Vector3(tr.radius, tr.height, tr.radius)
    );
    trunkInstanced.setMatrixAt(tCursor, dummy);
    trunkVars[tCursor * 3 + 0] = (rand() - 0.5) * 0.8;
    trunkVars[tCursor * 3 + 1] = rand() * 0.3;
    trunkVars[tCursor * 3 + 2] = rand();
    tCursor++;

    // Reflected tree trunk on left/right flanks (capped at 1.45 m depth so trunks never poke below the pond wash)
    const isCenterBehindGuardian = Math.abs(tr.x) < 1.45;
    const reflH = isCenterBehindGuardian ? 0.001 : Math.min(1.42, tr.height * 0.26);
    dummy.compose(
      new THREE.Vector3(tr.x, -reflH * 0.5 - 0.04, Math.min(1.45, Math.abs(tr.z) * 0.42 + 0.32)),
      q,
      new THREE.Vector3(tr.radius * 0.9, reflH, tr.radius * 0.9)
    );
    trunkInstanced.setMatrixAt(tCursor, dummy);
    trunkVars[tCursor * 3 + 0] = -0.35;
    trunkVars[tCursor * 3 + 1] = 0.1;
    trunkVars[tCursor * 3 + 2] = rand();
    tCursor++;
  });

  // Fallen logs on the left bank + Wooden trailhead placard on the right path (from wide-angle photo)
  const extraWoodElements = [
    // Fallen mossy logs behind guardian's right arm
    { pos: [-2.35, 0.42, -0.85], rot: [0.18, 0.42, 1.38], scale: [0.16, 1.85, 0.16], tone: -0.4 },
    { pos: [-2.15, 0.32, -0.52], rot: [0.12, 0.28, 1.45], scale: [0.14, 1.55, 0.14], tone: -0.35 },
    // Right trailhead wooden sign posts & placard (`x ≈ 3.85, z ≈ -0.15`)
    { pos: [3.72, 0.42, -0.18], rot: [0.0, 0.0, 0.02], scale: [0.035, 0.52, 0.035], tone: 0.25 },
    { pos: [4.04, 0.42, -0.12], rot: [0.0, 0.0, -0.01], scale: [0.035, 0.52, 0.035], tone: 0.25 },
    { pos: [3.88, 0.58, -0.15], rot: [0.08, -0.18, 1.57], scale: [0.14, 0.42, 0.04], tone: 0.75 },
  ];

  extraWoodElements.forEach((el) => {
    q.setFromEuler(new THREE.Euler(el.rot[0], el.rot[1], el.rot[2]));
    dummy.compose(
      new THREE.Vector3(el.pos[0], el.pos[1], el.pos[2]),
      q,
      new THREE.Vector3(el.scale[0], el.scale[1], el.scale[2])
    );
    trunkInstanced.setMatrixAt(tCursor, dummy);
    trunkVars[tCursor * 3 + 0] = el.tone;
    trunkVars[tCursor * 3 + 1] = 0.2;
    trunkVars[tCursor * 3 + 2] = rand();
    tCursor++;

    dummy.compose(
      new THREE.Vector3(el.pos[0], -el.pos[1], Math.abs(el.pos[2]) + 0.35),
      q,
      new THREE.Vector3(el.scale[0], el.scale[1], el.scale[2])
    );
    trunkInstanced.setMatrixAt(tCursor, dummy);
    trunkVars[tCursor * 3 + 0] = el.tone - 0.2;
    trunkVars[tCursor * 3 + 1] = 0.2;
    trunkVars[tCursor * 3 + 2] = rand();
    tCursor++;
  });

  trunkGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(trunkVars, 3));
  trunkInstanced.instanceMatrix.needsUpdate = true;
  rootGroup.add(trunkInstanced);

  // ============================================================================
  // 4. FOLDED ORIGAMI PAPER LEAF CLUSTERS, LEFT CRIMSON MAPLE & FLOATING POND LEAVES
  // ============================================================================
  const foliagePlacements: Array<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
    tone: number;
    warmth: number;
    phase: number;
  }> = [];

  // A. Left Shoreline Crimson-Russet Autumn Maple Tree (`x` in `[-4.8..-2.8]`, `y` in `[0.6..3.6]`)
  for (let i = 0; i < 48; i++) {
    const fx = -3.75 + (rand() - 0.5) * 1.85;
    const fy = 0.65 + rand() * 2.85;
    const fz = -0.75 + (rand() - 0.5) * 1.55;
    const fq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35)
    );
    const s = 0.28 + rand() * 0.32;
    foliagePlacements.push({
      pos: new THREE.Vector3(fx, fy, fz),
      quat: fq,
      scale: new THREE.Vector3(s * 1.15, s, s * 1.35),
      tone: (rand() - 0.5) * 0.7,
      warmth: 0.78 + rand() * 0.22, // Crimson-russet autumn maple tier
      phase: rand(),
    });
  }

  // B. Compact Green Shrub on Left Embankment (`x ≈ -2.55, z ≈ -0.25`) + Right Cove Grasses (`x ≈ 3.8, z ≈ 1.05`)
  for (let i = 0; i < 28; i++) {
    const isRightGrass = i >= 14;
    const fx = isRightGrass ? 3.65 + (rand() - 0.5) * 1.1 : -2.55 + (rand() - 0.5) * 0.85;
    const fz = isRightGrass ? 0.95 + (rand() - 0.5) * 0.95 : -0.25 + (rand() - 0.5) * 0.65;
    const fy = 0.22 + rand() * 0.48;
    const fq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3)
    );
    const s = 0.22 + rand() * 0.22;
    foliagePlacements.push({
      pos: new THREE.Vector3(fx, fy, fz),
      quat: fq,
      scale: new THREE.Vector3(s, s, s * 1.25),
      tone: (rand() - 0.5) * 0.6,
      warmth: 0.05 + rand() * 0.18, // Deep woodland sage-green shrub
      phase: rand(),
    });
  }

  // C. Woodland Canopy & Background Ridge Folded Paper Leaves
  for (let i = 0; i < 145; i++) {
    const isCanopy = i > 55;
    const angle = (rand() - 0.5) * Math.PI * 1.15;
    const radius = isCanopy ? 2.1 + rand() * 2.2 : 1.75 + rand() * 2.1;
    const fx = Math.sin(angle) * radius * 1.35;
    const fz = -Math.cos(angle) * radius - 0.65;
    if (!isCanopy && Math.abs(fx) < 1.28 && fz > -1.55) continue;

    const fy = isCanopy ? 1.85 + rand() * 2.5 : 0.35 + rand() * 1.05;
    const fq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rand() - 0.5) * 0.32, rand() * Math.PI * 2, (rand() - 0.5) * 0.32)
    );
    const s = isCanopy ? 0.35 + rand() * 0.36 : 0.25 + rand() * 0.28;

    foliagePlacements.push({
      pos: new THREE.Vector3(fx, fy, fz),
      quat: fq,
      scale: new THREE.Vector3(s * 1.15, s, s * 1.35),
      tone: (rand() - 0.5) * 0.85,
      warmth: rand() * 0.72,
      phase: rand(),
    });
  }

  // D. Fallen Autumn Paper Leaves Floating on the Pond Surface (`y = 0.015`, matching wide-angle photo)
  for (let i = 0; i < 22; i++) {
    const lx = (rand() - 0.5) * 5.2;
    const lz = 0.45 + rand() * 2.35;
    const fq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
    const s = 0.09 + rand() * 0.07;
    foliagePlacements.push({
      pos: new THREE.Vector3(lx, 0.015, lz),
      quat: fq,
      scale: new THREE.Vector3(s, s * 0.5, s * 1.35),
      tone: 0.25 + rand() * 0.4,
      warmth: 0.65 + rand() * 0.35,
      phase: rand(),
    });
  }

  const folGeom = createFoldedPaperLeafGeometry();
  const folMat = createPaperShingleMaterial(uniforms, { role: 'foliage' });
  const folReflMat = createPaperShingleMaterial(uniforms, { role: 'reflected-foliage' });

  const folMesh = new THREE.InstancedMesh(folGeom, folMat, foliagePlacements.length);
  const folReflGeom = folGeom.clone();
  const folReflMesh = new THREE.InstancedMesh(folReflGeom, folReflMat, foliagePlacements.length);

  const folVars = new Float32Array(foliagePlacements.length * 3);
  foliagePlacements.forEach((fp, i) => {
    dummy.compose(fp.pos, fp.quat, fp.scale);
    folMesh.setMatrixAt(i, dummy);

    const reflZ = Math.min(1.95, Math.abs(fp.pos.z) * 0.48 + 0.25);
    const reflY = -Math.min(1.65, fp.pos.y * 0.45);
    const reflScale = Math.abs(fp.pos.x) < 1.35 || fp.pos.y < 0.1 ? 0.001 : 0.85;
    dummy.compose(
      new THREE.Vector3(fp.pos.x, reflY, reflZ),
      fp.quat,
      new THREE.Vector3(fp.scale.x * reflScale, fp.scale.y * reflScale, fp.scale.z * reflScale)
    );
    folReflMesh.setMatrixAt(i, dummy);

    folVars[i * 3 + 0] = fp.tone;
    folVars[i * 3 + 1] = fp.warmth;
    folVars[i * 3 + 2] = fp.phase;
  });

  folGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folVars, 3));
  folReflGeom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(folVars, 3));
  folMesh.instanceMatrix.needsUpdate = true;
  folReflMesh.instanceMatrix.needsUpdate = true;
  rootGroup.add(folMesh);
  rootGroup.add(folReflMesh);

  // ============================================================================
  // 5. FOREGROUND KUBELKA-MUNK WATERCOLOR POND SURFACE (`y = 0.0`)
  // ============================================================================
  const pondGeom = new THREE.PlaneGeometry(13.5, 6.8, 72, 72);
  pondGeom.rotateX(-Math.PI / 2);
  pondGeom.translate(0, 0.0, 2.35);

  const pondMat = createWatercolorPondMaterial(uniforms);
  const pondMesh = new THREE.Mesh(pondGeom, pondMat);
  pondMesh.renderOrder = 2;
  rootGroup.add(pondMesh);

  return {
    rootGroup,
    pondMesh,
    bankMesh,
    foliageCount: foliagePlacements.length,
  };
}
