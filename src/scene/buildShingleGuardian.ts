import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  WATER_LEVEL_Y,
  createPaperShingleMaterial,
  createCreasedPaperStripGeometry,
} from '../shaders/paperCraftShader';

export interface ShinglePlacement {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  toneShift: number;     // Calm sheet variation [-1..1] (scaled gently in shader)
  warmCollarMix: number; // [0..1] (0 = silver-weathered Washi, 1 = warm russet collar)
  grainPhase: number;    // [0..1] fiber seed
}

function createSeededRandom(seed = 1337): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0x00ffffff) / 0x01000000;
  };
}

/**
 * Generates structured, aligned tucked-overlap paper courses for the Guardian's
 * barrel torso, hunched shoulder mantles, 4-course radial warm russet collar fan,
 * back-nape courses, crouched ankles/toes, and shoreline finger under-plates.
 * (The calm facial shell, brow, nose, ears, forearms & V-channel dorsal fingers are built
 * as a continuous deformed origami sheet in `createGuardianSculptedSheetMesh`.)
 */
export function generateGuardianShingles(): ShinglePlacement[] {
  const rand = createSeededRandom(42069);
  const placements: ShinglePlacement[] = [];

  const up = new THREE.Vector3(0, 1, 0);
  const tmpPos = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const tmpTangent = new THREE.Vector3();
  const tmpBitangent = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();

  const addTuckedPleat = (
    pos: THREE.Vector3,
    outwardNormal: THREE.Vector3,
    downDir: THREE.Vector3,
    width: number,
    length: number,
    thickness: number,
    warmCollarMix: number,
    tiltOutRad = 0.13,
    toneOverride?: number,
    jitterScale = 0.35
  ) => {
    tmpNormal.copy(outwardNormal).normalize();
    tmpBitangent.copy(downDir).normalize();
    tmpTangent.crossVectors(tmpBitangent, tmpNormal).normalize();
    if (tmpTangent.lengthSq() < 0.001) {
      tmpTangent.set(1, 0, 0);
    }
    tmpBitangent.crossVectors(tmpNormal, tmpTangent).normalize();

    tmpMat.makeBasis(tmpTangent, tmpBitangent, tmpNormal);
    tmpQuat.setFromRotationMatrix(tmpMat);
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      tiltOutRad + (rand() - 0.5) * 0.035 * jitterScale
    );
    const yawQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (rand() - 0.5) * 0.045 * jitterScale
    );
    tmpQuat.multiply(tiltQ).multiply(yawQ);

    placements.push({
      position: pos.clone(),
      quaternion: tmpQuat.clone(),
      scale: new THREE.Vector3(width, length, thickness),
      toneShift: toneOverride !== undefined ? toneOverride : (rand() - 0.5) * 0.55,
      warmCollarMix,
      grainPhase: rand(),
    });
  };

  // ============================================================================
  // 1. GROUNDED CROUCHING PEAR/BELL TORSO (`15` staggered courses of slender vertical shingles)
  // ============================================================================
  const torsoRows = 15;
  for (let r = 0; r < torsoRows; r++) {
    const v = r / (torsoRows - 1);
    const y = 0.06 + v * 1.30;
    // Grounded pear/A-line crouch matching close-up photo: broad heavy base & lower belly (`v = 0.12..0.42`),
    // tapering smoothly upward into the hunched shoulders (`v = 0.85..1.0`)!
    const lowBellyBulge = Math.sin(Math.pow(v, 0.72) * Math.PI * 0.88 + 0.34);
    const baseGrounding = (1.0 - v) * 0.18;
    const radiusX = 0.48 * lowBellyBulge + baseGrounding + 0.08;
    const radiusZ = 0.45 * lowBellyBulge + baseGrounding * 0.85 + 0.08;
    const centerZ = -0.80 + Math.pow(v, 1.18) * 0.34;

    // Dense columns so each shingle is slender & vertical (`~8.2 cm × 22 cm` = 1:2.7 aspect!)
    const cols = Math.max(25, Math.round(radiusX * 56));
    for (let c = 0; c < cols; c++) {
      const theta = ((c + (r % 2) * 0.5) / cols) * Math.PI * 2 + (rand() - 0.5) * 0.025;
      const sx = Math.sin(theta) * radiusX;
      const sz = Math.cos(theta) * radiusZ;

      // Leave upper front throat opening cleanly for the V-shaped radial cedar ruff & low-slung head
      if (Math.cos(theta) > 0.36 && v > 0.64 && v < 0.96) {
        continue;
      }

      const staggerY = ((c * 7 + r * 3) % 3 - 1) * 0.018 + (rand() - 0.5) * 0.014;
      tmpPos.set(sx, y + staggerY, centerZ + sz);
      const normal = new THREE.Vector3(
        Math.sin(theta) / radiusX,
        (v - 0.32) * 0.26,
        Math.cos(theta) / radiusZ
      ).normalize();

      const pleatW = ((2 * Math.PI * radiusX) / cols) * 1.24;
      const pleatH = 0.225 + (rand() - 0.5) * 0.03;
      const isUpperChest = Math.cos(theta) > 0.22 && v > 0.52;
      const warmMix = isUpperChest
        ? Math.min(1.0, (v - 0.52) * 1.65 * Math.cos(theta)) * 0.62
        : 0.05 + rand() * 0.16;

      addTuckedPleat(
        tmpPos,
        normal,
        new THREE.Vector3(0, -1, 0.09),
        pleatW,
        pleatH,
        0.13,
        warmMix,
        0.11,
        (rand() - 0.5) * 1.35, // Authentic weathered shingle-to-shingle silver/taupe/slate variation!
        0.45
      );
    }
  }

  // ============================================================================
  // 1B. UNIFIED HUNCHED SHOULDER-CAPE ARCHES (Bridging seamlessly behind head/ears to upper arms!)
  // ============================================================================
  for (const side of [-1, 1]) {
    for (let sc = 0; sc < 3; sc++) {
      const count = 10;
      for (let i = 0; i < count; i++) {
        const frac = i / (count - 1); // 0 = high nape behind head, 1 = outer shoulder cap
        const px = side * (0.12 + frac * 0.50);
        const py = 1.47 - Math.pow(frac, 1.25) * 0.14 - sc * 0.075;
        const pz = -0.52 + Math.sin(frac * Math.PI * 0.85) * 0.22 - sc * 0.045;
        tmpPos.set(px, py, pz);
        const outN = new THREE.Vector3(side * (0.30 + frac * 0.48), 0.76 - frac * 0.28, 0.44).normalize();
        const downD = new THREE.Vector3(side * 0.76, -0.55, 0.32).normalize();
        addTuckedPleat(
          tmpPos,
          outN,
          downD,
          0.105,
          0.24,
          0.13,
          0.10 + rand() * 0.16,
          0.10,
          (rand() - 0.5) * 1.1,
          0.35
        );
      }
    }
  }

  // ============================================================================
  // 2. POINTED V-SHAPED RADIAL COLLAR / NECK RUFF (`4` slender courses under chin)
  // ============================================================================
  const chinPivot = new THREE.Vector3(0, 1.25, -0.30);
  const collarCourses = 4;
  for (let course = 0; course < collarCourses; course++) {
    const cFrac = course / (collarCourses - 1);
    const baseRadial = 0.15 + cFrac * 0.27;
    const count = 21 + course * 5;
    for (let i = 0; i < count; i++) {
      const fanAngle = (i / (count - 1) - 0.5) * Math.PI * 0.86;
      const sinA = Math.sin(fanAngle);
      const cosA = Math.cos(fanAngle);
      // Pointed V-taper: longer down the center chest (`cosA ≈ 1`), shorter where tucked under shoulders!
      const vPointScale = 0.72 + Math.pow(Math.max(0, cosA), 1.35) * 0.42;
      const radialLen = baseRadial * vPointScale;

      const px = chinPivot.x + sinA * (0.12 + radialLen * 0.90);
      const py = chinPivot.y - cosA * radialLen * 0.86;
      const pz = -0.15 + cosA * 0.18 - cFrac * 0.015;

      tmpPos.set(px, py, pz);
      const outNormal = new THREE.Vector3(sinA * 0.44, 0.24, cosA * 0.87).normalize();
      const pleatDown = new THREE.Vector3(sinA * 0.58, -0.79, cosA * 0.18).normalize();

      const centerWarmth = Math.pow(Math.max(0, cosA), 0.50);
      const collarWarm = Math.min(0.98, 0.54 + centerWarmth * 0.42 + cFrac * 0.08);

      addTuckedPleat(
        tmpPos,
        outNormal,
        pleatDown,
        0.082,
        0.215 * (0.85 + 0.20 * cosA),
        0.14,
        collarWarm,
        0.14,
        (rand() - 0.5) * 0.95,
        0.35
      );
    }
  }

  // ============================================================================
  // 3. BACK-OF-HEAD / NAPE TUCKED COURSES
  // ============================================================================
  const headCenter = new THREE.Vector3(0, 1.37, -0.22);
  for (let r = 1; r < 5; r++) {
    const phi = (r / 5) * (Math.PI * 0.62);
    const y = headCenter.y + Math.cos(phi) * 0.26;
    const cols = 12;
    for (let c = 0; c < cols; c++) {
      const theta = (c / cols) * Math.PI * 2;
      if (Math.cos(theta) >= -0.18) continue;
      const nx = Math.sin(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.cos(theta) * Math.sin(phi);
      tmpPos.set(headCenter.x + nx * 0.31, y, headCenter.z + nz * 0.32);
      addTuckedPleat(
        tmpPos,
        new THREE.Vector3(nx, ny + 0.2, nz).normalize(),
        new THREE.Vector3(0, -1, -0.25).normalize(),
        0.13,
        0.16,
        0.12,
        0.14,
        0.08,
        (rand() - 0.5) * 0.7,
        0.2
      );
    }
  }

  // ============================================================================
  // 4. ASYMMETRIC UPPER ARMS (Matching Photo Pose!) & SHORELINE FINGER PLATES
  // ============================================================================
  for (const side of [-1, 1]) {
    // Left arm sweeps diagonally out-left; right arm angles out to a distinct bent elbow then drops nearly straight down!
    const shoulder =
      side < 0
        ? new THREE.Vector3(-0.58, 1.31, -0.54)
        : new THREE.Vector3(0.60, 1.30, -0.52);
    const elbow =
      side < 0
        ? new THREE.Vector3(-0.98, 0.78, -0.15)
        : new THREE.Vector3(1.09, 0.84, -0.12);
    const wrist =
      side < 0
        ? new THREE.Vector3(-1.34, 0.14, 0.26)
        : new THREE.Vector3(1.18, 0.14, 0.28);

    // Long slender longitudinal upper-arm staves (`4` courses × `10` narrow staves)
    const rings = 4;
    const facets = 10;
    const axis = new THREE.Vector3().subVectors(elbow, shoulder);
    const segLen = axis.length();
    const axisDir = axis.clone().normalize();
    const uVec = new THREE.Vector3().crossVectors(axisDir, up).normalize();
    const vVec = new THREE.Vector3().crossVectors(axisDir, uVec).normalize();

    for (let i = 0; i < rings; i++) {
      const t = i / rings;
      const ringCenter = new THREE.Vector3().lerpVectors(shoulder, elbow, t + 0.5 / rings);
      const radius = THREE.MathUtils.lerp(0.215, 0.155, t);
      const ringHeight = (segLen / rings) * 1.24;

      for (let f = 0; f < facets; f++) {
        const angle = ((f + (i % 2) * 0.5) / facets) * Math.PI * 2;
        const radial = new THREE.Vector3()
          .addScaledVector(uVec, Math.cos(angle))
          .addScaledVector(vVec, Math.sin(angle))
          .normalize();
        const plankPos = ringCenter.clone().addScaledVector(radial, radius);
        const warm = t < 0.30 ? 0.24 : 0.10 + rand() * 0.12;
        addTuckedPleat(
          plankPos,
          radial,
          axisDir,
          ((2 * Math.PI * radius) / facets) * 1.18,
          ringHeight,
          0.11,
          warm,
          0.07,
          (rand() - 0.5) * 1.05,
          0.25
        );
      }
    }

    // Shoreline finger under-plates (`10` per hand, satisfying `|x| > 1.05, y < 0.22, z > 0.25`)
    const fingerAngles =
      side < 0
        ? [-1.22, -0.88, -0.54, -0.18, 0.16]
        : [-0.18, 0.10, 0.36, 0.62, 0.90];

    fingerAngles.forEach((fAngle, fIdx) => {
      const isThumb = (side < 0 && fIdx === 4) || (side > 0 && fIdx === 0);
      const fLen = isThumb ? 0.38 : 0.52 + (fIdx === 2 ? 0.06 : 0.0);
      const dirX = Math.sin(fAngle);
      const dirZ = Math.cos(fAngle);

      for (let ph = 0; ph < 2; ph++) {
        const pf = (ph + 0.5) / 2;
        const fx = wrist.x + dirX * (0.12 + pf * fLen);
        const fz = wrist.z + 0.05 + dirZ * (0.12 + pf * fLen);
        const fy = 0.052 - ph * 0.018;

        addTuckedPleat(
          new THREE.Vector3(fx, fy, fz),
          new THREE.Vector3(0, 0.95, 0.22).normalize(),
          new THREE.Vector3(dirX, -0.06, dirZ).normalize(),
          0.068 - ph * 0.006,
          fLen * 0.48,
          0.11,
          0.34,
          0.02,
          (rand() - 0.5) * 0.65,
          0.0
        );
      }
    });
  }

  // ============================================================================
  // 5. TIGHTLY TUCKED CROUCHING KNEES & CHUNKY 4-TOED SHORELINE FEET (`Photo 1:1`)
  // ============================================================================
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.38, 0.42, -0.44);
    const ankle = new THREE.Vector3(side * 0.37, 0.13, -0.24);

    for (let kr = 0; kr < 3; kr++) {
      const kt = kr / 2;
      const kCenter = new THREE.Vector3().lerpVectors(hip, ankle, kt);
      const kRad = THREE.MathUtils.lerp(0.20, 0.155, kt);
      for (let c = 0; c < 9; c++) {
        const a = ((c + (kr % 2) * 0.5) / 9) * Math.PI * 2;
        addTuckedPleat(
          new THREE.Vector3(
            kCenter.x + Math.sin(a) * kRad,
            kCenter.y,
            kCenter.z + Math.cos(a) * kRad
          ),
          new THREE.Vector3(Math.sin(a), 0.28, Math.cos(a)).normalize(),
          new THREE.Vector3(0, -1, 0.34).normalize(),
          0.105,
          0.19,
          0.13,
          0.20 + kt * 0.16,
          0.09,
          (rand() - 0.5) * 0.95,
          0.2
        );
      }
    }

    for (let tIdx = 0; tIdx < 4; tIdx++) {
      const spread = (tIdx - 1.5) * 0.17 + side * 0.14;
      const toeDirX = Math.sin(spread);
      const toeDirZ = Math.cos(spread);
      const toeLen = 0.31 - Math.abs(tIdx - 1.5) * 0.025;

      for (let seg = 0; seg < 2; seg++) {
        const sf = (seg + 0.5) / 2;
        addTuckedPleat(
          new THREE.Vector3(
            ankle.x + toeDirX * (0.09 + sf * toeLen),
            0.068 - seg * 0.020,
            ankle.z + 0.08 + toeDirZ * (0.09 + sf * toeLen)
          ),
          new THREE.Vector3(0, 0.92, 0.34).normalize(),
          new THREE.Vector3(toeDirX, -0.08, toeDirZ).normalize(),
          0.088,
          toeLen * 0.52,
          0.14,
          0.42,
          0.03,
          (rand() - 0.5) * 0.65,
          0.1
        );
      }
    }
  }

  return placements;
}

/**
 * Builds the Sculpted Origami-Plank Geometry matching the close-up Guardian photograph:
 * 1. Compact, Low-Slung Polygonal Cranium Cap (`rx = 0.31m`), Forward-Jutting Angular V-Brow Visor,
 *    Deeply Recessed Angled Eye Hollows framed by Warm Cheekbone Facets, Narrow Pointed Wedge Nose,
 *    and Two Clean Small Pointed Temple Ears (zero spiky crown cones!).
 * 2. Asymmetric Bent-Elbow Longitudinal-Plank Forearms (`8` slender weathered staves per forearm),
 *    Folded Hand Dorsums, and 5 Blocky/Folded Splayed Shoreline Fingers per hand.
 */
export function buildGuardianSculptedSheetGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const cardCoords: number[] = [];
  const variations: number[] = [];

  const pushTri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    cuA: [number, number],
    cuB: [number, number],
    cuC: [number, number],
    tone: number,
    warm: number,
    seed: number
  ) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    cardCoords.push(cuA[0], cuA[1], cuB[0], cuB[1], cuC[0], cuC[1]);
    variations.push(tone, warm, seed, tone, warm, seed, tone, warm, seed);
  };

  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    u0: [number, number],
    u1: [number, number],
    u2: [number, number],
    u3: [number, number],
    tone: number,
    warm: number,
    seed = 0.37
  ) => {
    pushTri(p0, p1, p2, u0, u1, u2, tone, warm, seed);
    pushTri(p0, p2, p3, u0, u2, u3, tone, warm, seed);
  };

  const hcX = 0.0;
  const hcY = 1.37;
  const hcZ = -0.22;

  // ============================================================================
  // A. COMPACT POLYGONAL CRANIUM HELMET & FORWARD-JUTTING V-BROW VISOR (`Photo 1:1`)
  // ============================================================================
  const capRings: Array<Array<[number, number, number]>> = [];
  const capRowSpecs = [
    { dy: 0.27, rx: 0.11, rz: 0.12, zOff: -0.01 },
    { dy: 0.22, rx: 0.24, rz: 0.25, zOff: 0.02 },
    { dy: 0.12, rx: 0.31, rz: 0.32, zOff: 0.05 },
    { dy: 0.01, rx: 0.31, rz: 0.33, zOff: 0.08 }, // Crisp overhanging V-brow & temple visor rim!
  ];
  const capAngles = [-2.25, -1.52, -0.92, -0.36, 0.0, 0.36, 0.92, 1.52, 2.25];

  for (let r = 0; r < capRowSpecs.length; r++) {
    const sp = capRowSpecs[r];
    const rowPts: Array<[number, number, number]> = [];
    for (let c = 0; c < capAngles.length; c++) {
      const a = capAngles[c];
      // Distinct downward V-dip at center bridge & proud angled outer brow visor ledge!
      const isVisor = r === 3;
      const vDip = isVisor && Math.abs(a) < 0.5 ? -0.042 * Math.cos(a * 2.4) : 0.0;
      const outerLift = isVisor && Math.abs(a) >= 0.32 && Math.abs(a) <= 1.05 ? 0.028 : 0.0;
      const visorJut = isVisor ? Math.max(0, Math.cos(a * 0.92)) * 0.075 : 0.0;
      rowPts.push([
        hcX + Math.sin(a) * sp.rx,
        hcY + sp.dy + vDip + outerLift,
        hcZ + sp.zOff + Math.cos(a) * sp.rz + visorJut,
      ]);
    }
    capRings.push(rowPts);
  }

  const apex: [number, number, number] = [hcX, hcY + 0.285, hcZ - 0.01];
  for (let c = 0; c < capAngles.length - 1; c++) {
    pushTri(
      apex,
      capRings[0][c],
      capRings[0][c + 1],
      [0.0, 0.0],
      [-0.35, -0.30],
      [0.35, -0.30],
      0.16 - (c % 2) * 0.18,
      0.08,
      0.19 + c * 0.06
    );
  }

  const plankTones = [-0.14, 0.18, -0.22, 0.24, 0.16, -0.20, 0.14, -0.12];
  for (let r = 0; r < capRings.length - 1; r++) {
    const cvBot = r === capRings.length - 2 ? -0.47 : -0.32;
    for (let c = 0; c < capAngles.length - 1; c++) {
      const pTone = plankTones[(c + r * 3) % plankTones.length];
      pushQuad(
        capRings[r + 1][c],
        capRings[r + 1][c + 1],
        capRings[r][c + 1],
        capRings[r][c],
        [-0.36, cvBot],
        [0.36, cvBot],
        [0.36, 0.26],
        [-0.36, 0.26],
        pTone,
        0.08 + r * 0.04,
        0.23 + c * 0.07
      );
    }
  }

  // ============================================================================
  // B. NARROW POINTED WEDGE NOSE, ANGLED DARK EYE HOLLOWS, WARM CHEEK FRAMES & EARS
  // ============================================================================
  const glabellaM = capRings[3][4];
  const browInnerL = capRings[3][3];
  const browInnerR = capRings[3][5];
  const browOuterL = capRings[3][2];
  const browOuterR = capRings[3][6];
  const templeBackL = capRings[3][1];
  const templeBackR = capRings[3][7];

  // Narrow, crisp pointed downward-projecting wedge nose (matching close-up photo!)
  const nMidBridgeM: [number, number, number] = [0.0, hcY - 0.085, hcZ + 0.485];
  const nMidBridgeL: [number, number, number] = [-0.048, hcY - 0.088, hcZ + 0.435];
  const nMidBridgeR: [number, number, number] = [0.048, hcY - 0.088, hcZ + 0.435];
  const nTipM: [number, number, number] = [0.0, hcY - 0.195, hcZ + 0.495];
  const nWingL: [number, number, number] = [-0.068, hcY - 0.175, hcZ + 0.415];
  const nWingR: [number, number, number] = [0.068, hcY - 0.175, hcZ + 0.415];
  const nBaseM: [number, number, number] = [0.0, hcY - 0.225, hcZ + 0.395];

  pushQuad(
    nMidBridgeL, nMidBridgeM, glabellaM, browInnerL,
    [-0.40, -0.25], [0.0, -0.25], [0.0, 0.25], [-0.40, 0.25],
    0.14, 0.16, 0.41
  );
  pushQuad(
    nMidBridgeM, nMidBridgeR, browInnerR, glabellaM,
    [0.0, -0.25], [0.40, -0.25], [0.40, 0.25], [0.0, 0.25],
    -0.08, 0.16, 0.41
  );
  pushQuad(
    nWingL, nTipM, nMidBridgeM, nMidBridgeL,
    [-0.44, -0.46], [0.0, -0.46], [0.0, 0.15], [-0.40, 0.15],
    0.16, 0.22, 0.42
  );
  pushQuad(
    nTipM, nWingR, nMidBridgeR, nMidBridgeM,
    [0.0, -0.46], [0.44, -0.46], [0.40, 0.15], [0.0, 0.15],
    -0.10, 0.22, 0.42
  );
  pushTri(nWingL, nBaseM, nTipM, [-0.3, 0.35], [0.0, 0.42], [0.0, -0.4], -1.35, 0.45, 0.43);
  pushTri(nTipM, nBaseM, nWingR, [0.0, -0.4], [0.0, 0.42], [0.3, 0.35], -1.35, 0.45, 0.43);

  for (const side of [-1, 1]) {
    const browIn = side < 0 ? browInnerL : browInnerR;
    const browOut = side < 0 ? browOuterL : browOuterR;
    const templeBack = side < 0 ? templeBackL : templeBackR;
    const nMidSide = side < 0 ? nMidBridgeL : nMidBridgeR;
    const nWing = side < 0 ? nWingL : nWingR;

    const flip = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
      d: [number, number, number],
      tone: number,
      warm: number,
      isTucked = false
    ) => {
      const cvTop = isTucked ? 0.44 : 0.20;
      if (side < 0) {
        pushQuad(a, b, c, d, [-0.36, -0.32], [0.28, -0.32], [0.28, cvTop], [-0.36, cvTop], tone, warm);
      } else {
        pushQuad(b, a, d, c, [-0.36, -0.32], [0.28, -0.32], [0.28, cvTop], [-0.36, cvTop], tone, warm);
      }
    };

    const browMid: [number, number, number] = [
      (browIn[0] + browOut[0]) * 0.5,
      (browIn[1] + browOut[1]) * 0.5 + 0.008,
      (browIn[2] + browOut[2]) * 0.5 + 0.015,
    ];

    // 1. Underside of jutting V-brow visor folding back into the recessed dark eye hollow!
    const socketTopIn: [number, number, number] = [side * 0.068, hcY - 0.048, hcZ + 0.395];
    const socketTopMid: [number, number, number] = [side * 0.165, hcY - 0.025, hcZ + 0.372];
    const socketTopOut: [number, number, number] = [side * 0.258, hcY + 0.002, hcZ + 0.295];

    flip(socketTopIn, socketTopMid, browMid, browIn, -0.35, 0.38, true);
    flip(socketTopMid, socketTopOut, browOut, browMid, -0.30, 0.34, true);

    if (side < 0) {
      pushTri(nMidSide, browIn, socketTopIn, [0.0, -0.2], [0.0, 0.2], [-0.3, -0.2], -0.18, 0.28, 0.44);
    } else {
      pushTri(browIn, nMidSide, socketTopIn, [0.0, 0.2], [0.0, -0.2], [0.3, -0.2], -0.18, 0.28, 0.44);
    }

    // 2. Angled Deep Dark-Umber Eye Hollows (`slanting up-and-outward just like the real troll!`)
    const socketBotIn: [number, number, number] = [side * 0.072, hcY - 0.095, hcZ + 0.388];
    const socketBotMid: [number, number, number] = [side * 0.168, hcY - 0.074, hcZ + 0.366];
    const socketBotOut: [number, number, number] = [side * 0.255, hcY - 0.042, hcZ + 0.292];

    flip(socketBotIn, socketBotMid, socketTopMid, socketTopIn, -1.82, 0.35, true);
    flip(socketBotMid, socketBotOut, socketTopOut, socketTopMid, -1.75, 0.35, true);

    // 3. Angled Warm-Cedar Cheekbone Rim & Jaw Facets framing the eyes & nose (visible in close-up photo!)
    const cheekMid: [number, number, number] = [side * 0.185, hcY - 0.148, hcZ + 0.375];
    const cheekOut: [number, number, number] = [side * 0.288, hcY - 0.105, hcZ + 0.245];
    const templeLow: [number, number, number] = [side * 0.302, hcY - 0.075, hcZ + 0.045];
    const jawIn: [number, number, number] = [side * 0.088, hcY - 0.228, hcZ + 0.365];
    const jawOut: [number, number, number] = [side * 0.225, hcY - 0.198, hcZ + 0.235];

    if (side < 0) {
      pushTri(nWing, nMidSide, socketBotIn, [0.0, -0.3], [0.0, 0.2], [-0.3, 0.1], 0.05, 0.58, 0.46);
    } else {
      pushTri(nMidSide, nWing, socketBotIn, [0.0, 0.2], [0.0, -0.3], [0.3, 0.1], 0.05, 0.58, 0.46);
    }

    flip(nWing, cheekMid, socketBotMid, socketBotIn, 0.08, 0.68, false);
    flip(cheekMid, cheekOut, socketBotOut, socketBotMid, 0.06, 0.58, false);
    flip(cheekOut, templeLow, templeBack, browOut, -0.04, 0.20, false);

    if (side < 0) {
      pushTri(cheekOut, browOut, socketTopOut, [-0.3, -0.2], [0.0, 0.2], [0.2, 0.0], 0.0, 0.24, 0.48);
      pushTri(cheekOut, socketTopOut, socketBotOut, [-0.3, -0.2], [0.2, 0.0], [0.2, -0.2], 0.0, 0.24, 0.48);
    } else {
      pushTri(browOut, cheekOut, socketTopOut, [0.0, 0.2], [-0.3, -0.2], [0.2, 0.0], 0.0, 0.24, 0.48);
      pushTri(socketTopOut, cheekOut, socketBotOut, [0.2, 0.0], [-0.3, -0.2], [0.2, -0.2], 0.0, 0.24, 0.48);
    }

    flip(jawIn, jawOut, cheekMid, nWing, -0.06, 0.76, true);
    if (side < 0) {
      pushTri(jawOut, cheekOut, cheekMid, [-0.25, -0.3], [0.25, 0.1], [-0.1, 0.2], -0.04, 0.55, 0.50);
    } else {
      pushTri(cheekOut, jawOut, cheekMid, [0.25, 0.1], [-0.25, -0.3], [-0.1, 0.2], -0.04, 0.55, 0.50);
    }

    // 4. Clean Small Pointed Temple Ears (`tucked close against the side of the cranium like the photo!`)
    const earTopBase: [number, number, number] = [side * 0.295, hcY + 0.095, hcZ + 0.08];
    const earFrontBase: [number, number, number] = [side * 0.302, hcY + 0.015, hcZ + 0.16];
    const earBackBase: [number, number, number] = [side * 0.288, hcY + 0.015, hcZ + 0.0];
    const earTip: [number, number, number] = [side * 0.395, hcY + 0.145, hcZ + 0.03];

    if (side < 0) {
      pushTri(earFrontBase, earTopBase, earTip, [-0.4, -0.2], [0.0, 0.0], [0.0, -0.48], 0.12, 0.14, 0.61);
      pushTri(earTopBase, earBackBase, earTip, [0.0, 0.0], [0.4, -0.2], [0.0, -0.48], -0.08, 0.18, 0.61);
      pushTri(earBackBase, earFrontBase, earTip, [-0.3, 0.3], [0.3, 0.3], [0.0, -0.45], -0.18, 0.24, 0.61);
    } else {
      pushTri(earTopBase, earFrontBase, earTip, [0.0, 0.0], [-0.4, -0.2], [0.0, -0.48], 0.12, 0.14, 0.61);
      pushTri(earBackBase, earTopBase, earTip, [0.4, -0.2], [0.0, 0.0], [0.0, -0.48], -0.08, 0.18, 0.61);
      pushTri(earFrontBase, earBackBase, earTip, [0.3, 0.3], [-0.3, 0.3], [0.0, -0.45], -0.18, 0.24, 0.61);
    }
  }

  // Warm russet upper-lip / chin tuck under pointed wedge nose
  pushQuad(
    [-0.088, hcY - 0.228, hcZ + 0.365],
    [0.088, hcY - 0.228, hcZ + 0.365],
    nWingR,
    nWingL,
    [-0.25, -0.32],
    [0.25, -0.32],
    [0.25, 0.36],
    [-0.25, 0.36],
    -0.08,
    0.82
  );

  // ============================================================================
  // C. LONGITUDINAL PLANK-STRIP FOREARMS, DORSAL HANDS & 5 SPLAYED FINGERS (`Photo 1:1`)
  // ============================================================================
  const upVec = new THREE.Vector3(0, 1, 0);
  const staveTones = [0.22, -0.18, 0.14, -0.24, 0.19, -0.12, 0.25, -0.16, 0.10, -0.20];

  for (const side of [-1, 1]) {
    const elbow =
      side < 0
        ? new THREE.Vector3(-0.98, 0.80, -0.15)
        : new THREE.Vector3(1.09, 0.86, -0.12);
    const wrist =
      side < 0
        ? new THREE.Vector3(-1.34, 0.14, 0.26)
        : new THREE.Vector3(1.18, 0.14, 0.28);

    const axis = new THREE.Vector3().subVectors(wrist, elbow);
    const axisDir = axis.clone().normalize();
    const uVec = new THREE.Vector3().crossVectors(axisDir, upVec).normalize();
    const vVec = new THREE.Vector3().crossVectors(axisDir, uVec).normalize();

    // 2 long longitudinal plank-stave courses (`elbow -> mid-forearm -> wrist`) with 10 narrow staves!
    const staveCourses = 2;
    const staveSides = 10;

    for (let cIdx = 0; cIdx < staveCourses; cIdx++) {
      const tTop = cIdx === 0 ? 0.0 : 0.47;
      const tBot = cIdx === 0 ? 0.53 : 1.0;
      const cTop = new THREE.Vector3().lerpVectors(elbow, wrist, tTop);
      const cBot = new THREE.Vector3().lerpVectors(elbow, wrist, tBot);

      const rTopBase = THREE.MathUtils.lerp(0.152, 0.106, tTop) * (cIdx === 0 ? 1.0 : 0.96);
      const rBotBase = THREE.MathUtils.lerp(0.152, 0.106, tBot) * (cIdx === 0 ? 1.03 : 1.0);
      const anglePhase = cIdx * 0.31 + 0.15;

      const topRing: Array<[number, number, number]> = [];
      const botRing: Array<[number, number, number]> = [];

      for (let k = 0; k <= staveSides; k++) {
        const ang = (k / staveSides) * Math.PI * 2 + anglePhase;
        const ridgeMod = k % 2 === 0 ? 1.04 : 0.96;
        const pTop = cTop
          .clone()
          .addScaledVector(uVec, Math.cos(ang) * rTopBase * ridgeMod)
          .addScaledVector(vVec, Math.sin(ang) * rTopBase * ridgeMod);
        const pBot = cBot
          .clone()
          .addScaledVector(uVec, Math.cos(ang) * rBotBase * ridgeMod)
          .addScaledVector(vVec, Math.sin(ang) * rBotBase * ridgeMod);
        topRing.push([pTop.x, pTop.y, pTop.z]);
        botRing.push([pBot.x, pBot.y, pBot.z]);
      }

      for (let k = 0; k < staveSides; k++) {
        const sTone = staveTones[(k + cIdx * 3) % staveTones.length];
        const sWarm = 0.08 + ((k * 3 + cIdx) % 4) * 0.05;
        pushQuad(
          botRing[k],
          botRing[k + 1],
          topRing[k + 1],
          topRing[k],
          [-0.42, -0.46],
          [0.42, -0.46],
          [0.42, 0.32],
          [-0.42, 0.32],
          sTone,
          sWarm,
          0.51 + cIdx * 0.09 + k * 0.05
        );
      }
    }

    // Folded Dorsal Hand Shell (`compact flat-faceted wooden/paper hand back`)
    const wx = wrist.x;
    const wz = wrist.z;
    const hRidgeBack: [number, number, number] = [wx, 0.165, wz - 0.02];
    const hRidgeFront: [number, number, number] = [wx + side * 0.01, 0.108, wz + 0.17];
    const hLeftBack: [number, number, number] = [wx - 0.135, 0.135, wz - 0.01];
    const hLeftFront: [number, number, number] = [wx - 0.165, 0.088, wz + 0.16];
    const hRightBack: [number, number, number] = [wx + 0.135, 0.135, wz - 0.01];
    const hRightFront: [number, number, number] = [wx + 0.165, 0.088, wz + 0.16];

    pushQuad(
      hLeftFront, hRidgeFront, hRidgeBack, hLeftBack,
      [-0.42, -0.44], [0.0, -0.44], [0.0, 0.28], [-0.42, 0.28],
      0.10, 0.24, 0.72
    );
    pushQuad(
      hRidgeFront, hRightFront, hRightBack, hRidgeBack,
      [0.0, -0.44], [0.42, -0.44], [0.42, 0.28], [0.0, 0.28],
      -0.06, 0.24, 0.72
    );

    // 5 Articulated Splayed Shoreline Fingers (left hand splays outward-left; right hand splays forward!)
    const fingerAngles =
      side < 0
        ? [-1.22, -0.88, -0.54, -0.18, 0.16]
        : [-0.18, 0.10, 0.36, 0.62, 0.90];

    fingerAngles.forEach((fAngle, fIdx) => {
      const isThumb = (side < 0 && fIdx === 4) || (side > 0 && fIdx === 0);
      const totalLen = isThumb ? 0.40 : 0.55 + (fIdx === 2 ? 0.07 : 0.0);
      const dx = Math.sin(fAngle);
      const dz = Math.cos(fAngle);
      const px = Math.cos(fAngle);
      const pz = -Math.sin(fAngle);

      const stations = [
        { d: 0.10, y: 0.095, hw: 0.042, rh: 0.026 },
        { d: 0.10 + totalLen * 0.52, y: 0.056, hw: 0.038, rh: 0.024 },
        { d: 0.10 + totalLen, y: 0.018, hw: 0.030, rh: 0.016 },
      ];

      for (let ph = 0; ph < 2; ph++) {
        const s0 = stations[ph];
        const s1 = stations[ph + 1];
        const bCx = wx + dx * s0.d;
        const bCz = wz + 0.04 + dz * s0.d;
        const tCx = wx + dx * s1.d;
        const tCz = wz + 0.04 + dz * s1.d;

        const bL: [number, number, number] = [bCx - px * s0.hw, s0.y - s0.rh, bCz - pz * s0.hw];
        const bM: [number, number, number] = [bCx, s0.y + s0.rh, bCz];
        const bR: [number, number, number] = [bCx + px * s0.hw, s0.y - s0.rh, bCz + pz * s0.hw];

        const tL: [number, number, number] = [tCx - px * s1.hw, s1.y - s1.rh, tCz - pz * s1.hw];
        const tM: [number, number, number] = [tCx, s1.y + s1.rh, tCz];
        const tR: [number, number, number] = [tCx + px * s1.hw, s1.y - s1.rh, tCz + pz * s1.hw];

        const cvTop = ph === 1 ? 0.34 : 0.18;
        const cvBot = ph === 1 ? -0.48 : -0.24;
        const warmFinger = 0.28 + ph * 0.14;
        const fTone = (fIdx % 2 === 0 ? 0.12 : -0.10) + ph * 0.04;

        pushQuad(
          tL, tM, bM, bL,
          [-0.45, cvBot], [0.0, cvBot], [0.0, cvTop], [-0.45, cvTop],
          fTone, warmFinger, 0.81 + fIdx * 0.03
        );
        pushQuad(
          tM, tR, bR, bM,
          [0.0, cvBot], [0.45, cvBot], [0.45, cvTop], [0.0, cvTop],
          fTone - 0.12, warmFinger, 0.81 + fIdx * 0.03
        );
      }
    });
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aCardCoord', new THREE.Float32BufferAttribute(cardCoords, 2));
  geom.setAttribute('aVariation', new THREE.Float32BufferAttribute(variations, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds the `THREE.Mesh` for the Guardian's continuous sculpted origami sheet
 * (head, gentle facial planes, forearm sleeves & V-channel fingers) or its exact planar reflection.
 */
export function createGuardianSculptedSheetMesh(
  uniforms: PaperSceneUniforms,
  isReflected: boolean,
  waterLevelY = WATER_LEVEL_Y
): THREE.Mesh {
  const geom = buildGuardianSculptedSheetGeometry();
  const mat = createPaperShingleMaterial(uniforms, {
    role: isReflected ? 'reflected-shell' : 'sculpted-shell',
  });
  const mesh = new THREE.Mesh(geom, mat);
  if (isReflected) {
    mesh.position.set(0, 2 * waterLevelY, 0);
    mesh.scale.set(1, -1, 1);
  }
  return mesh;
}

/**
 * Builds the `THREE.InstancedMesh` for either the upright tucked shingle courses or their
 * exact planar mirror reflection across `Y = waterLevelY` (`M_refl = translate(0, 2*Y, 0) * scale(1, -1, 1)`).
 */
export function createGuardianInstancedMesh(
  placements: ShinglePlacement[],
  uniforms: PaperSceneUniforms,
  isReflected: boolean,
  waterLevelY = WATER_LEVEL_Y
): THREE.InstancedMesh {
  const geom = createCreasedPaperStripGeometry();
  const count = placements.length;
  const variationArray = new Float32Array(count * 3);

  const mat = createPaperShingleMaterial(uniforms, {
    role: isReflected ? 'reflected-shingle' : 'shingle',
  });

  const mesh = new THREE.InstancedMesh(geom, mat, count);
  const dummyMat = new THREE.Matrix4();
  const reflPlaneMat = new THREE.Matrix4().makeScale(1, -1, 1).setPosition(0, 2 * waterLevelY, 0);

  for (let i = 0; i < count; i++) {
    const p = placements[i];
    dummyMat.compose(p.position, p.quaternion, p.scale);
    if (isReflected) {
      dummyMat.premultiply(reflPlaneMat);
    }
    mesh.setMatrixAt(i, dummyMat);

    variationArray[i * 3 + 0] = p.toneShift;
    variationArray[i * 3 + 1] = p.warmCollarMix;
    variationArray[i * 3 + 2] = p.grainPhase;
  }

  geom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(variationArray, 3));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
