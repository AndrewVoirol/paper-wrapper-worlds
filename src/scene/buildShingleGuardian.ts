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
  toneShift: number;     // Calm sheet variation [-1..1]
  warmCollarMix: number; // [0..1] (0 = silver-weathered driftwood, 1 = warm salvaged cedar)
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
 * Generates structured, staggered salvaged-plank paper courses for Little Nis's
 * bell-shaped crouching torso, high hunched shoulder mantles, 5-course mixed-lumber
 * radial collar ruff, back-nape courses, crouched knees/4-toed feet, and shoreline finger plates.
 * (The plank-wrapped cranium, hooded downcast eyes, multi-plank nose, cupped ears,
 * longitudinal forearm staves, and squared box-plank fingers are built in `buildGuardianSculptedSheetGeometry`.)
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
    jitterScale = 0.38
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
      tiltOutRad + (rand() - 0.5) * 0.042 * jitterScale
    );
    const yawQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (rand() - 0.5) * 0.052 * jitterScale
    );
    tmpQuat.multiply(tiltQ).multiply(yawQ);

    placements.push({
      position: pos.clone(),
      quaternion: tmpQuat.clone(),
      scale: new THREE.Vector3(width, length, thickness),
      toneShift: toneOverride !== undefined ? toneOverride : (rand() - 0.5) * 0.65,
      warmCollarMix,
      grainPhase: rand(),
    });
  };

  // ============================================================================
  // 1. GROUNDED CROUCHING BELL TORSO (`17` staggered courses of salvaged vertical shingles)
  // ============================================================================
  const torsoRows = 17;
  for (let r = 0; r < torsoRows; r++) {
    const v = r / (torsoRows - 1);
    const y = 0.062 + v * 1.31;
    // Heavy crouching bell/pear silhouette matching Bernheim Forest photo: broad lower belly
    // hanging between his knees (`v = 0.10..0.46`), tapering into high hunched shoulders
    const lowBellyBulge = Math.sin(Math.pow(v, 0.70) * Math.PI * 0.88 + 0.34);
    const baseGrounding = (1.0 - v) * 0.185;
    const radiusX = 0.49 * lowBellyBulge + baseGrounding + 0.08;
    const radiusZ = 0.46 * lowBellyBulge + baseGrounding * 0.86 + 0.08;
    const centerZ = -0.80 + Math.pow(v, 1.16) * 0.35;

    const cols = Math.max(26, Math.round(radiusX * 58));
    for (let c = 0; c < cols; c++) {
      const theta = ((c + (r % 2) * 0.5) / cols) * Math.PI * 2 + (rand() - 0.5) * 0.028;
      const sx = Math.sin(theta) * radiusX;
      const sz = Math.cos(theta) * radiusZ;

      // Upper throat opening for the radial salvaged-wood collar ruff & low-slung head
      if (Math.cos(theta) > 0.35 && v > 0.63 && v < 0.96) {
        continue;
      }
      // Subtle crouched groin/under-belly arch right above the central shoreline limestone slab
      if (r === 0 && Math.cos(theta) > 0.84 && Math.abs(sx) < 0.15) {
        continue;
      }

      const staggerY = ((c * 7 + r * 3) % 3 - 1) * 0.019 + (rand() - 0.5) * 0.016;
      tmpPos.set(sx, y + staggerY, centerZ + sz);
      const normal = new THREE.Vector3(
        Math.sin(theta) / radiusX,
        (v - 0.30) * 0.25,
        Math.cos(theta) / radiusZ
      ).normalize();

      const widthJitter = 0.90 + rand() * 0.24;
      const pleatW = ((2 * Math.PI * radiusX) / cols) * 1.22 * widthJitter;
      const pleatH = 0.205 + rand() * 0.048;

      // Cohesive salvaged-pallet lumber mixing: occasional warm weathered cedar boards
      // interleaved naturally among silver-ash driftwood shingles across ribs & belly
      const boardRoll = rand();
      const isUpperChest = Math.cos(theta) > 0.20 && v > 0.48;
      let warmMix = 0.05 + rand() * 0.16;
      if (isUpperChest) {
        warmMix = Math.min(0.68, (v - 0.46) * 1.35 * Math.cos(theta) + rand() * 0.16);
      } else if (boardRoll > 0.80) {
        warmMix = 0.24 + rand() * 0.24;
      }

      addTuckedPleat(
        tmpPos,
        normal,
        new THREE.Vector3(0, -1, 0.09),
        pleatW,
        pleatH,
        0.13,
        warmMix,
        0.125,
        (rand() - 0.5) * 1.42,
        0.48
      );
    }
  }

  // ============================================================================
  // 1B. HIGH HUNCHED SHOULDER-MANTLE COURSES (Rising behind ears/temples with zero neck gap!)
  // ============================================================================
  for (const side of [-1, 1]) {
    for (let sc = 0; sc < 5; sc++) {
      const count = 11;
      for (let i = 0; i < count; i++) {
        const frac = i / (count - 1); // 0 = high nape behind head, 1 = outer shoulder cap
        const px = side * (0.10 + frac * 0.53);
        const py = 1.51 - Math.pow(frac, 1.22) * 0.16 - sc * 0.062;
        const pz = -0.50 + Math.sin(frac * Math.PI * 0.86) * 0.23 - sc * 0.040;
        tmpPos.set(px, py, pz);
        const outN = new THREE.Vector3(side * (0.28 + frac * 0.50), 0.78 - frac * 0.30, 0.45).normalize();
        const downD = new THREE.Vector3(side * 0.76, -0.55, 0.32).normalize();
        const mantleWarm = rand() > 0.76 ? 0.28 + rand() * 0.22 : 0.08 + rand() * 0.16;
        addTuckedPleat(
          tmpPos,
          outN,
          downD,
          0.102 * (0.92 + rand() * 0.18),
          0.235 + (rand() - 0.5) * 0.03,
          0.13,
          mantleWarm,
          0.11,
          (rand() - 0.5) * 1.18,
          0.42
        );
      }
    }
  }

  // ============================================================================
  // 2. SHAGGY SALVAGED-WOOD RADIAL COLLAR RUFF (`5` staggered courses under chin)
  // ============================================================================
  const chinPivot = new THREE.Vector3(0, 1.235, -0.275);
  const collarCourses = 5;
  for (let course = 0; course < collarCourses; course++) {
    const cFrac = course / (collarCourses - 1);
    const baseRadial = 0.13 + cFrac * 0.29;
    const count = 19 + course * 4;
    for (let i = 0; i < count; i++) {
      const fanAngle = (i / (count - 1) - 0.5) * Math.PI * 0.88 + (rand() - 0.5) * 0.025;
      const sinA = Math.sin(fanAngle);
      const cosA = Math.cos(fanAngle);
      // Ragged salvaged-board V-taper: longer down the sternum, with board-by-board lengthtooth
      const vPointScale = 0.70 + Math.pow(Math.max(0, cosA), 1.32) * 0.44;
      const raggedTip = 0.86 + ((i * 5 + course * 3) % 5) * 0.065;
      const radialLen = baseRadial * vPointScale * raggedTip;

      const px = chinPivot.x + sinA * (0.11 + radialLen * 0.92);
      const py = chinPivot.y - cosA * radialLen * 0.87;
      const pz = -0.14 + cosA * 0.185 - cFrac * 0.016;

      tmpPos.set(px, py, pz);
      const outNormal = new THREE.Vector3(sinA * 0.44, 0.24, cosA * 0.87).normalize();
      const pleatDown = new THREE.Vector3(sinA * 0.58, -0.79, cosA * 0.18).normalize();

      // Interleave ~18% pale silver-taupe boards inside the warm cedar ruff so head, collar & belly cohere!
      const isSilverSalvageBoard = (i + course * 2) % 6 === 2;
      const centerWarmth = Math.pow(Math.max(0, cosA), 0.55);
      const collarWarm = isSilverSalvageBoard
        ? 0.28 + rand() * 0.22
        : Math.min(0.96, 0.72 + centerWarmth * 0.20 + rand() * 0.06);

      addTuckedPleat(
        tmpPos,
        outNormal,
        pleatDown,
        0.078 * (0.90 + rand() * 0.22),
        0.205 * (0.84 + 0.22 * cosA) * raggedTip,
        0.14,
        collarWarm,
        0.145,
        (rand() - 0.5) * 0.58,
        0.42
      );
    }
  }

  // ============================================================================
  // 3. BACK-OF-HEAD / NAPE TUCKED COURSES
  // ============================================================================
  const headCenter = new THREE.Vector3(0, 1.35, -0.20);
  for (let r = 1; r < 5; r++) {
    const phi = (r / 5) * (Math.PI * 0.62);
    const y = headCenter.y + Math.cos(phi) * 0.24;
    const cols = 12;
    for (let c = 0; c < cols; c++) {
      const theta = (c / cols) * Math.PI * 2;
      if (Math.cos(theta) >= -0.18) continue;
      const nx = Math.sin(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.cos(theta) * Math.sin(phi);
      tmpPos.set(headCenter.x + nx * 0.315, y, headCenter.z + nz * 0.32);
      addTuckedPleat(
        tmpPos,
        new THREE.Vector3(nx, ny + 0.2, nz).normalize(),
        new THREE.Vector3(0, -1, -0.25).normalize(),
        0.13,
        0.16,
        0.12,
        0.14,
        0.08,
        (rand() - 0.5) * 0.75,
        0.25
      );
    }
  }

  // ============================================================================
  // 4. ASYMMETRIC UPPER ARMS (Diagonal Left Reach vs. Sharp Bent Right Elbow!) & FINGER PLATES
  // ============================================================================
  for (const side of [-1, 1]) {
    const shoulder =
      side < 0
        ? new THREE.Vector3(-0.60, 1.30, -0.50)
        : new THREE.Vector3(0.62, 1.29, -0.48);
    const elbow =
      side < 0
        ? new THREE.Vector3(-0.99, 0.77, -0.14)
        : new THREE.Vector3(1.14, 0.84, -0.10);
    const wrist =
      side < 0
        ? new THREE.Vector3(-1.36, 0.135, 0.26)
        : new THREE.Vector3(1.18, 0.135, 0.28);

    // Longitudinal salvaged upper-arm staves (`4` staggered courses × `10` narrow staves)
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
      const radius = THREE.MathUtils.lerp(0.215, 0.156, t);
      const ringHeight = (segLen / rings) * 1.24;

      for (let f = 0; f < facets; f++) {
        const angle = ((f + (i % 2) * 0.5) / facets) * Math.PI * 2;
        const radial = new THREE.Vector3()
          .addScaledVector(uVec, Math.cos(angle))
          .addScaledVector(vVec, Math.sin(angle))
          .normalize();
        const plankPos = ringCenter.clone().addScaledVector(radial, radius);
        const warm = t < 0.28 ? 0.24 + rand() * 0.12 : 0.08 + (rand() > 0.78 ? 0.24 : rand() * 0.12);
        addTuckedPleat(
          plankPos,
          radial,
          axisDir,
          ((2 * Math.PI * radius) / facets) * 1.18,
          ringHeight,
          0.11,
          warm,
          0.075,
          (rand() - 0.5) * 1.12,
          0.28
        );
      }
    }

    // Shoreline finger under-plates (`10` per hand within `|x| > 1.05, y < 0.22, z > 0.25`)
    const fingerAngles =
      side < 0
        ? [-1.36, -1.08, -0.78, -0.44, -0.08]
        : [-0.26, -0.04, 0.20, 0.44, 0.68];

    fingerAngles.forEach((fAngle, fIdx) => {
      const isThumb = (side < 0 && fIdx === 4) || (side > 0 && fIdx === 0);
      const fLen = isThumb ? 0.37 : 0.53 + (fIdx === 2 ? 0.06 : 0.0);
      const dirX = Math.sin(fAngle);
      const dirZ = Math.cos(fAngle);

      for (let ph = 0; ph < 2; ph++) {
        const pf = (ph + 0.5) / 2;
        const fx = wrist.x + dirX * (0.11 + pf * fLen);
        const fz = wrist.z + 0.06 + dirZ * (0.11 + pf * fLen);
        const fy = 0.048 - ph * 0.016;

        addTuckedPleat(
          new THREE.Vector3(fx, fy, fz),
          new THREE.Vector3(0, 0.96, 0.20).normalize(),
          new THREE.Vector3(dirX, -0.05, dirZ).normalize(),
          0.072 - ph * 0.005,
          fLen * 0.48,
          0.11,
          0.32 + (fIdx % 2) * 0.14,
          0.02,
          (rand() - 0.5) * 0.68,
          0.05
        );
      }
    });
  }

  // ============================================================================
  // 5. TIGHTLY TUCKED CROUCHING KNEES & CHUNKY 4-TOED WOODEN FEET (`Photo 1:1`)
  // ============================================================================
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.39, 0.42, -0.44);
    const ankle = new THREE.Vector3(side * 0.38, 0.125, -0.23);

    for (let kr = 0; kr < 3; kr++) {
      const kt = kr / 2;
      const kCenter = new THREE.Vector3().lerpVectors(hip, ankle, kt);
      const kRad = THREE.MathUtils.lerp(0.205, 0.16, kt);
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
          0.106,
          0.19,
          0.13,
          0.18 + kt * 0.18,
          0.09,
          (rand() - 0.5) * 0.95,
          0.22
        );
      }
    }

    for (let tIdx = 0; tIdx < 4; tIdx++) {
      const spread = (tIdx - 1.5) * 0.175 + side * 0.14;
      const toeDirX = Math.sin(spread);
      const toeDirZ = Math.cos(spread);
      const toeLen = 0.32 - Math.abs(tIdx - 1.5) * 0.024;

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
          0.092,
          toeLen * 0.52,
          0.14,
          0.38 + (tIdx % 2) * 0.12,
          0.03,
          (rand() - 0.5) * 0.68,
          0.12
        );
      }
    }
  }

  return placements;
}

/**
 * Builds the Sculpted Salvaged-Plank Paper Geometry matching the close-up Bernheim photograph:
 * 1. Flatter, Plank-Wrapped Cranium Forehead (`hcY = 1.35`), Furrowed Brow Ledge, Angled Pale
 *    Upper-Eyelid Planks hooding Narrow Dark Downcast Eye Slits (gazing into Holly Pond),
 *    Warm-Cedar Lower Eyelid & Cheekbone Frames, Multi-Plank Sculpted Wooden Nose with Flared
 *    Nostril Wings, Recessed Mouth Crease & Chin Tuck, and Cupped Pointed Wooden Troll Ears.
 * 2. Asymmetric Bent-Elbow Longitudinal-Stave Forearms, Faceted Wooden Hand Backs, and
 *    Squared 3D Box-Plank Splayed Shoreline Fingers with Cut-End Grain Tips.
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
  const hcY = 1.35;
  const hcZ = -0.20;

  // ============================================================================
  // A. FLATTER PLANK-WRAPPED CRANIUM & FURROWED BROW VISOR (`Close-Up Photo 1:1`)
  // ============================================================================
  const capRings: Array<Array<[number, number, number]>> = [];
  const capRowSpecs = [
    { dy: 0.232, rx: 0.13, rz: 0.13, zOff: -0.01 },
    { dy: 0.202, rx: 0.255, rz: 0.25, zOff: 0.02 },
    { dy: 0.112, rx: 0.318, rz: 0.318, zOff: 0.055 },
    { dy: 0.012, rx: 0.316, rz: 0.328, zOff: 0.082 }, // Horizontal-planked overhanging brow visor!
  ];
  const capAngles = [-2.25, -1.52, -0.92, -0.38, 0.0, 0.38, 0.92, 1.52, 2.25];

  for (let r = 0; r < capRowSpecs.length; r++) {
    const sp = capRowSpecs[r];
    const rowPts: Array<[number, number, number]> = [];
    for (let c = 0; c < capAngles.length; c++) {
      const a = capAngles[c];
      const isVisor = r === 3;
      const flattenFront = Math.abs(a) < 0.85 ? -0.018 * Math.cos(a * 1.6) : 0.0;
      const vDip = isVisor && Math.abs(a) < 0.48 ? -0.028 * Math.cos(a * 2.5) : 0.0;
      const outerLift = isVisor && Math.abs(a) >= 0.34 && Math.abs(a) <= 1.05 ? 0.022 : 0.0;
      const visorJut = isVisor ? Math.max(0, Math.cos(a * 0.90)) * 0.078 : 0.0;
      rowPts.push([
        hcX + Math.sin(a) * sp.rx,
        hcY + sp.dy + vDip + outerLift,
        hcZ + sp.zOff + Math.cos(a) * sp.rz + flattenFront + visorJut,
      ]);
    }
    capRings.push(rowPts);
  }

  const apex: [number, number, number] = [hcX, hcY + 0.242, hcZ - 0.01];
  for (let c = 0; c < capAngles.length - 1; c++) {
    pushTri(
      apex,
      capRings[0][c],
      capRings[0][c + 1],
      [0.0, 0.0],
      [-0.38, -0.44],
      [0.38, -0.44],
      0.18 - (c % 2) * 0.20,
      0.08,
      0.19 + c * 0.06
    );
  }

  // Distinct plank-to-plank forehead seam lines (`cvBot = -0.47`) & weathered board tones
  const plankTones = [-0.16, 0.22, -0.24, 0.26, 0.18, -0.22, 0.16, -0.14];
  for (let r = 0; r < capRings.length - 1; r++) {
    const cvBot = -0.47;
    for (let c = 0; c < capAngles.length - 1; c++) {
      const pTone = plankTones[(c + r * 3) % plankTones.length];
      const pWarm = r === 2 && (c === 3 || c === 4) ? 0.18 : 0.07 + (r % 2) * 0.05;
      pushQuad(
        capRings[r + 1][c],
        capRings[r + 1][c + 1],
        capRings[r][c + 1],
        capRings[r][c],
        [-0.42, cvBot],
        [0.42, cvBot],
        [0.42, 0.34],
        [-0.42, 0.34],
        pTone,
        pWarm,
        0.23 + c * 0.07 + r * 0.11
      );
    }
  }

  // ============================================================================
  // B. MULTI-PLANK WOODEN NOSE, HOODED DOWNCAST EYES, MOUTH TUCK & CUPPED TROLL EARS
  // ============================================================================
  const glabellaM = capRings[3][4];
  const browInnerL = capRings[3][3];
  const browInnerR = capRings[3][5];
  const browOuterL = capRings[3][2];
  const browOuterR = capRings[3][6];
  const templeBackL = capRings[3][1];
  const templeBackR = capRings[3][7];

  // Sculpted multi-plank wooden nose with flat dorsal plank, squared tip & flared nostril wings
  const nRootL: [number, number, number] = [-0.036, hcY - 0.012, hcZ + 0.428];
  const nRootR: [number, number, number] = [0.036, hcY - 0.012, hcZ + 0.428];
  const nMidTopL: [number, number, number] = [-0.032, hcY - 0.092, hcZ + 0.486];
  const nMidTopR: [number, number, number] = [0.032, hcY - 0.092, hcZ + 0.486];
  const nMidSideL: [number, number, number] = [-0.058, hcY - 0.095, hcZ + 0.432];
  const nMidSideR: [number, number, number] = [0.058, hcY - 0.095, hcZ + 0.432];

  const nTipTopL: [number, number, number] = [-0.022, hcY - 0.188, hcZ + 0.498];
  const nTipTopR: [number, number, number] = [0.022, hcY - 0.188, hcZ + 0.498];
  const nWingL: [number, number, number] = [-0.078, hcY - 0.176, hcZ + 0.418];
  const nWingR: [number, number, number] = [0.078, hcY - 0.176, hcZ + 0.418];
  const nSubBaseL: [number, number, number] = [-0.032, hcY - 0.214, hcZ + 0.396];
  const nSubBaseR: [number, number, number] = [0.032, hcY - 0.214, hcZ + 0.396];

  // Glabella-to-bridge plank & dorsal nose plank (pale weathered wood catching top light!)
  pushQuad(
    nRootL, nRootR, browInnerR, browInnerL,
    [-0.38, -0.44], [0.38, -0.44], [0.42, 0.30], [-0.42, 0.30],
    0.12, 0.14, 0.40
  );
  pushTri(nRootL, glabellaM, browInnerL, [-0.3, -0.3], [0.0, 0.25], [-0.4, 0.25], 0.10, 0.14, 0.40);
  pushTri(glabellaM, nRootR, browInnerR, [0.0, 0.25], [0.3, -0.3], [0.4, 0.25], 0.10, 0.14, 0.40);

  pushQuad(
    nMidTopL, nMidTopR, nRootR, nRootL,
    [-0.44, -0.46], [0.44, -0.46], [0.44, 0.32], [-0.44, 0.32],
    0.22, 0.15, 0.41
  );
  pushQuad(
    nTipTopL, nTipTopR, nMidTopR, nMidTopL,
    [-0.46, -0.48], [0.46, -0.48], [0.44, 0.34], [-0.44, 0.34],
    0.20, 0.20, 0.42
  );

  // Side walls of nose bridge & flared nostril wings
  pushQuad(
    nMidSideL, nMidTopL, nRootL, browInnerL,
    [-0.42, -0.38], [0.32, -0.38], [0.32, 0.28], [-0.42, 0.28],
    0.04, 0.22, 0.43
  );
  pushQuad(
    nMidTopR, nMidSideR, browInnerR, nRootR,
    [-0.32, -0.38], [0.42, -0.38], [0.42, 0.28], [-0.32, 0.28],
    -0.06, 0.22, 0.43
  );
  pushQuad(
    nWingL, nTipTopL, nMidTopL, nMidSideL,
    [-0.46, -0.46], [0.36, -0.46], [0.36, 0.26], [-0.42, 0.26],
    0.08, 0.28, 0.44
  );
  pushQuad(
    nTipTopR, nWingR, nMidSideR, nMidTopR,
    [-0.36, -0.46], [0.46, -0.46], [0.42, 0.26], [-0.36, 0.26],
    -0.08, 0.28, 0.44
  );

  // Dark recessed underside of nose tip & nostril cavities
  pushQuad(
    nSubBaseL, nSubBaseR, nTipTopR, nTipTopL,
    [-0.35, 0.38], [0.35, 0.38], [0.35, -0.42], [-0.35, -0.42],
    -1.45, 0.48, 0.45
  );
  pushTri(nWingL, nSubBaseL, nTipTopL, [-0.4, 0.35], [0.0, 0.44], [0.0, -0.42], -1.68, 0.50, 0.45);
  pushTri(nTipTopR, nSubBaseR, nWingR, [0.0, -0.42], [0.0, 0.44], [0.4, 0.35], -1.68, 0.50, 0.45);

  for (const side of [-1, 1]) {
    const browIn = side < 0 ? browInnerL : browInnerR;
    const browOut = side < 0 ? browOuterL : browOuterR;
    const templeBack = side < 0 ? templeBackL : templeBackR;
    const nMidSide = side < 0 ? nMidSideL : nMidSideR;
    const nWing = side < 0 ? nWingL : nWingR;
    const nSubBase = side < 0 ? nSubBaseL : nSubBaseR;

    const flip = (
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
      d: [number, number, number],
      tone: number,
      warm: number,
      isTucked = false,
      cvBot = -0.38
    ) => {
      const cvTop = isTucked ? 0.45 : 0.24;
      if (side < 0) {
        pushQuad(a, b, c, d, [-0.42, cvBot], [0.38, cvBot], [0.38, cvTop], [-0.42, cvTop], tone, warm);
      } else {
        pushQuad(b, a, d, c, [-0.42, cvBot], [0.38, cvBot], [0.38, cvTop], [-0.42, cvTop], tone, warm);
      }
    };

    const browMid: [number, number, number] = [
      (browIn[0] + browOut[0]) * 0.5,
      (browIn[1] + browOut[1]) * 0.5 + 0.006,
      (browIn[2] + browOut[2]) * 0.5 + 0.014,
    ];

    // 1. Hooded Pale Salvaged-Plank Upper Eyelid Strip (angled outward, directing gaze down into pond!)
    const lidTopIn: [number, number, number] = [side * 0.068, hcY - 0.032, hcZ + 0.412];
    const lidTopMid: [number, number, number] = [side * 0.168, hcY - 0.012, hcZ + 0.392];
    const lidTopOut: [number, number, number] = [side * 0.262, hcY + 0.012, hcZ + 0.308];

    const lidEdgeIn: [number, number, number] = [side * 0.072, hcY - 0.062, hcZ + 0.418];
    const lidEdgeMid: [number, number, number] = [side * 0.172, hcY - 0.044, hcZ + 0.396];
    const lidEdgeOut: [number, number, number] = [side * 0.260, hcY - 0.018, hcZ + 0.308];

    // Brow-to-lid shadow crease
    flip(lidTopIn, lidTopMid, browMid, browIn, -0.42, 0.32, true, -0.32);
    flip(lidTopMid, lidTopOut, browOut, browMid, -0.36, 0.28, true, -0.32);
    // Distinct pale wooden upper-eyelid plank (`cvBot = -0.48` gives crisp eyelid catchlight!)
    flip(lidEdgeIn, lidEdgeMid, lidTopMid, lidTopIn, 0.18, 0.14, false, -0.48);
    flip(lidEdgeMid, lidEdgeOut, lidTopOut, lidTopMid, 0.14, 0.14, false, -0.48);

    if (side < 0) {
      pushTri(nMidSide, browIn, lidTopIn, [0.0, -0.2], [0.0, 0.2], [-0.3, -0.2], -0.22, 0.26, 0.46);
      pushTri(nMidSide, lidTopIn, lidEdgeIn, [0.0, -0.2], [-0.3, 0.2], [-0.3, -0.3], -0.14, 0.26, 0.46);
    } else {
      pushTri(browIn, nMidSide, lidTopIn, [0.0, 0.2], [0.0, -0.2], [0.3, -0.2], -0.22, 0.26, 0.46);
      pushTri(lidTopIn, nMidSide, lidEdgeIn, [0.3, 0.2], [0.0, -0.2], [0.3, -0.3], -0.14, 0.26, 0.46);
    }

    // 2. Narrow Recessed Dark-Umber Downcast Eye Aperture (`gazing pensively into Holly Pond`)
    const socketBotIn: [number, number, number] = [side * 0.076, hcY - 0.096, hcZ + 0.392];
    const socketBotMid: [number, number, number] = [side * 0.172, hcY - 0.080, hcZ + 0.370];
    const socketBotOut: [number, number, number] = [side * 0.256, hcY - 0.048, hcZ + 0.292];

    if (side < 0) {
      pushTri(nMidSide, lidEdgeIn, socketBotIn, [0.0, 0.2], [-0.3, 0.2], [-0.3, -0.2], -1.85, 0.38, 0.46);
    } else {
      pushTri(lidEdgeIn, nMidSide, socketBotIn, [0.3, 0.2], [0.0, 0.2], [0.3, -0.2], -1.85, 0.38, 0.46);
    }

    flip(socketBotIn, socketBotMid, lidEdgeMid, lidEdgeIn, -1.92, 0.36, true, -0.30);
    flip(socketBotMid, socketBotOut, lidEdgeOut, lidEdgeMid, -1.86, 0.36, true, -0.30);

    // 3. Warm Salvaged-Cedar Lower Eyelid Strip & Faceted Cheekbone Hollows (`Close-Up Photo 1:1`)
    const cheekMid: [number, number, number] = [side * 0.188, hcY - 0.152, hcZ + 0.378];
    const cheekOut: [number, number, number] = [side * 0.290, hcY - 0.108, hcZ + 0.246];
    const templeLow: [number, number, number] = [side * 0.304, hcY - 0.076, hcZ + 0.046];
    const jawIn: [number, number, number] = [side * 0.092, hcY - 0.232, hcZ + 0.362];
    const jawOut: [number, number, number] = [side * 0.226, hcY - 0.198, hcZ + 0.236];

    if (side < 0) {
      pushTri(nWing, nMidSide, socketBotIn, [0.0, -0.3], [0.0, 0.2], [-0.3, 0.1], 0.04, 0.68, 0.47);
    } else {
      pushTri(nMidSide, nWing, socketBotIn, [0.0, 0.2], [0.0, -0.3], [0.3, 0.1], 0.04, 0.68, 0.47);
    }

    flip(nWing, cheekMid, socketBotMid, socketBotIn, 0.06, 0.78, false, -0.44);
    flip(cheekMid, cheekOut, socketBotOut, socketBotMid, 0.04, 0.66, false, -0.44);
    flip(cheekOut, templeLow, templeBack, browOut, -0.04, 0.18, false, -0.38);

    if (side < 0) {
      pushTri(cheekOut, browOut, lidEdgeOut, [-0.3, -0.2], [0.0, 0.2], [0.2, 0.0], 0.0, 0.22, 0.48);
      pushTri(cheekOut, lidEdgeOut, socketBotOut, [-0.3, -0.2], [0.2, 0.0], [0.2, -0.2], -0.10, 0.26, 0.48);
    } else {
      pushTri(browOut, cheekOut, lidEdgeOut, [0.0, 0.2], [-0.3, -0.2], [0.2, 0.0], 0.0, 0.22, 0.48);
      pushTri(lidEdgeOut, cheekOut, socketBotOut, [0.2, 0.0], [-0.3, -0.2], [0.2, -0.2], -0.10, 0.26, 0.48);
    }

    flip(jawIn, jawOut, cheekMid, nWing, -0.08, 0.80, true, -0.40);
    if (side < 0) {
      pushTri(jawOut, cheekOut, cheekMid, [-0.25, -0.3], [0.25, 0.1], [-0.1, 0.2], -0.06, 0.58, 0.50);
      pushTri(jawIn, nWing, nSubBase, [-0.25, -0.3], [0.2, 0.2], [0.0, 0.25], -0.16, 0.82, 0.50);
    } else {
      pushTri(cheekOut, jawOut, cheekMid, [0.25, 0.1], [-0.25, -0.3], [-0.1, 0.2], -0.06, 0.58, 0.50);
      pushTri(nWing, jawIn, nSubBase, [0.2, 0.2], [-0.25, -0.3], [0.0, 0.25], -0.16, 0.82, 0.50);
    }

    // 4. Cupped Pointed Wooden Troll Ears with Recessed Dark Inner-Ear Hollow (`Photo 1:1`)
    const earTopBase: [number, number, number] = [side * 0.296, hcY + 0.108, hcZ + 0.072];
    const earFrontBase: [number, number, number] = [side * 0.306, hcY + 0.012, hcZ + 0.168];
    const earBackBase: [number, number, number] = [side * 0.290, hcY + 0.008, hcZ - 0.012];
    const earTip: [number, number, number] = [side * 0.418, hcY + 0.172, hcZ + 0.036];
    const earHollow: [number, number, number] = [side * 0.332, hcY + 0.062, hcZ + 0.078];

    if (side < 0) {
      // Pale outer wooden ear rim + recessed shadowed inner ear pocket
      pushTri(earFrontBase, earHollow, earTip, [-0.44, -0.25], [0.0, 0.25], [0.0, -0.48], -1.42, 0.42, 0.61);
      pushTri(earHollow, earTopBase, earTip, [0.0, 0.25], [0.44, -0.20], [0.0, -0.48], 0.18, 0.14, 0.61);
      pushTri(earFrontBase, earTopBase, earHollow, [-0.40, -0.20], [0.40, 0.20], [0.0, 0.35], -1.35, 0.44, 0.61);
      pushTri(earTopBase, earBackBase, earTip, [0.0, 0.0], [0.42, -0.25], [0.0, -0.48], 0.10, 0.16, 0.62);
      pushTri(earBackBase, earFrontBase, earTip, [-0.35, 0.25], [0.35, 0.25], [0.0, -0.46], -0.14, 0.20, 0.62);
    } else {
      pushTri(earHollow, earFrontBase, earTip, [0.0, 0.25], [-0.44, -0.25], [0.0, -0.48], -1.42, 0.42, 0.61);
      pushTri(earTopBase, earHollow, earTip, [0.44, -0.20], [0.0, 0.25], [0.0, -0.48], 0.18, 0.14, 0.61);
      pushTri(earTopBase, earFrontBase, earHollow, [0.40, 0.20], [-0.40, -0.20], [0.0, 0.35], -1.35, 0.44, 0.61);
      pushTri(earBackBase, earTopBase, earTip, [0.42, -0.25], [0.0, 0.0], [0.0, -0.48], 0.10, 0.16, 0.62);
      pushTri(earFrontBase, earBackBase, earTip, [0.35, 0.25], [-0.35, 0.25], [0.0, -0.46], -0.14, 0.20, 0.62);
    }
  }

  // Upper lip, shadowed parted mouth crease & compact wooden chin plank tucked into the ruff
  const mouthTopL: [number, number, number] = [-0.082, hcY - 0.228, hcZ + 0.372];
  const mouthTopR: [number, number, number] = [0.082, hcY - 0.228, hcZ + 0.372];
  const mouthCleftL: [number, number, number] = [-0.072, hcY - 0.242, hcZ + 0.348];
  const mouthCleftR: [number, number, number] = [0.072, hcY - 0.242, hcZ + 0.348];
  const chinBotL: [number, number, number] = [-0.058, hcY - 0.268, hcZ + 0.356];
  const chinBotR: [number, number, number] = [0.058, hcY - 0.268, hcZ + 0.356];

  pushQuad(
    mouthTopL, mouthTopR, nSubBaseR, nSubBaseL,
    [-0.36, -0.44], [0.36, -0.44], [0.32, 0.34], [-0.32, 0.34],
    -0.06, 0.80, 0.64
  );
  pushQuad(
    mouthCleftL, mouthCleftR, mouthTopR, mouthTopL,
    [-0.36, 0.38], [0.36, 0.38], [0.36, -0.35], [-0.36, -0.35],
    -1.78, 0.55, 0.65
  );
  pushQuad(
    chinBotL, chinBotR, mouthCleftR, mouthCleftL,
    [-0.38, -0.46], [0.38, -0.46], [0.38, 0.36], [-0.38, 0.36],
    0.04, 0.72, 0.66
  );

  // ============================================================================
  // C. LONGITUDINAL PLANK-STAVE FOREARMS, WOODEN HANDS & BOX-PLANK SPLAYED FINGERS
  // ============================================================================
  const upVec = new THREE.Vector3(0, 1, 0);
  const staveTones = [0.24, -0.18, 0.16, -0.26, 0.20, -0.14, 0.26, -0.16, 0.12, -0.22];

  for (const side of [-1, 1]) {
    const elbow =
      side < 0
        ? new THREE.Vector3(-0.99, 0.79, -0.14)
        : new THREE.Vector3(1.14, 0.86, -0.10);
    const wrist =
      side < 0
        ? new THREE.Vector3(-1.36, 0.135, 0.26)
        : new THREE.Vector3(1.18, 0.135, 0.28);

    const axis = new THREE.Vector3().subVectors(wrist, elbow);
    const axisDir = axis.clone().normalize();
    const uVec = new THREE.Vector3().crossVectors(axisDir, upVec).normalize();
    const vVec = new THREE.Vector3().crossVectors(axisDir, uVec).normalize();

    // 2 staggered courses (`elbow -> mid-forearm -> wrist`) of 10 longitudinal salvaged staves
    const staveCourses = 2;
    const staveSides = 10;

    for (let cIdx = 0; cIdx < staveCourses; cIdx++) {
      const tTop = cIdx === 0 ? 0.0 : 0.46;
      const tBot = cIdx === 0 ? 0.54 : 1.0;
      const cTop = new THREE.Vector3().lerpVectors(elbow, wrist, tTop);
      const cBot = new THREE.Vector3().lerpVectors(elbow, wrist, tBot);

      const rTopBase = THREE.MathUtils.lerp(0.154, 0.108, tTop) * (cIdx === 0 ? 1.0 : 0.96);
      const rBotBase = THREE.MathUtils.lerp(0.154, 0.108, tBot) * (cIdx === 0 ? 1.04 : 1.0);
      const anglePhase = cIdx * 0.31 + 0.15;

      const topRing: Array<[number, number, number]> = [];
      const botRing: Array<[number, number, number]> = [];

      for (let k = 0; k <= staveSides; k++) {
        const ang = (k / staveSides) * Math.PI * 2 + anglePhase;
        const ridgeMod = k % 2 === 0 ? 1.045 : 0.955;
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
        const sWarm = k % 5 === 1 ? 0.28 : 0.08 + ((k * 3 + cIdx) % 4) * 0.05;
        pushQuad(
          botRing[k],
          botRing[k + 1],
          topRing[k + 1],
          topRing[k],
          [-0.44, -0.47],
          [0.44, -0.47],
          [0.44, 0.34],
          [-0.44, 0.34],
          sTone,
          sWarm,
          0.51 + cIdx * 0.09 + k * 0.05
        );
      }
    }

    // Faceted Salvaged-Plank Dorsal Hand Shell
    const wx = wrist.x;
    const wz = wrist.z;
    const hRidgeBack: [number, number, number] = [wx, 0.168, wz - 0.02];
    const hRidgeFront: [number, number, number] = [wx + side * 0.01, 0.110, wz + 0.175];
    const hLeftBack: [number, number, number] = [wx - 0.138, 0.136, wz - 0.01];
    const hLeftFront: [number, number, number] = [wx - 0.168, 0.088, wz + 0.165];
    const hRightBack: [number, number, number] = [wx + 0.138, 0.136, wz - 0.01];
    const hRightFront: [number, number, number] = [wx + 0.168, 0.088, wz + 0.165];

    pushQuad(
      hLeftFront, hRidgeFront, hRidgeBack, hLeftBack,
      [-0.44, -0.46], [0.0, -0.46], [0.0, 0.30], [-0.44, 0.30],
      0.14, 0.24, 0.72
    );
    pushQuad(
      hRidgeFront, hRightFront, hRightBack, hRidgeBack,
      [0.0, -0.46], [0.44, -0.46], [0.44, 0.30], [0.0, 0.30],
      -0.06, 0.24, 0.72
    );

    // 5 Squared 3D Box-Plank Splayed Shoreline Fingers (`matching close-up photo splay & cut plank ends!`)
    const fingerAngles =
      side < 0
        ? [-1.36, -1.08, -0.78, -0.44, -0.08]
        : [-0.26, -0.04, 0.20, 0.44, 0.68];

    fingerAngles.forEach((fAngle, fIdx) => {
      const isThumb = (side < 0 && fIdx === 4) || (side > 0 && fIdx === 0);
      const totalLen = isThumb ? 0.41 : 0.56 + (fIdx === 2 ? 0.07 : fIdx === 1 ? 0.04 : 0.0);
      const dx = Math.sin(fAngle);
      const dz = Math.cos(fAngle);
      const px = Math.cos(fAngle);
      const pz = -Math.sin(fAngle);

      const stations = [
        { d: 0.09, yTop: 0.114, yBot: 0.056, hw: 0.041 },
        { d: 0.09 + totalLen * 0.52, yTop: 0.078, yBot: 0.028, hw: 0.038 },
        { d: 0.09 + totalLen, yTop: 0.044, yBot: 0.004, hw: 0.034 },
      ];

      for (let ph = 0; ph < 2; ph++) {
        const s0 = stations[ph];
        const s1 = stations[ph + 1];
        // Slight vertical step at the knuckle joint (`ph === 1`) for crisp stacked-plank articulation
        const jointStep = ph === 1 ? -0.005 : 0.0;
        const bCx = wx + dx * s0.d;
        const bCz = wz + 0.05 + dz * s0.d;
        const tCx = wx + dx * s1.d;
        const tCz = wz + 0.05 + dz * s1.d;

        const bTopL: [number, number, number] = [bCx - px * s0.hw, s0.yTop + jointStep, bCz - pz * s0.hw];
        const bTopR: [number, number, number] = [bCx + px * s0.hw, s0.yTop + jointStep, bCz + pz * s0.hw];
        const bBotL: [number, number, number] = [bCx - px * s0.hw, s0.yBot, bCz - pz * s0.hw];
        const bBotR: [number, number, number] = [bCx + px * s0.hw, s0.yBot, bCz + pz * s0.hw];

        const tTopL: [number, number, number] = [tCx - px * s1.hw, s1.yTop, tCz - pz * s1.hw];
        const tTopR: [number, number, number] = [tCx + px * s1.hw, s1.yTop, tCz + pz * s1.hw];
        const tBotL: [number, number, number] = [tCx - px * s1.hw, s1.yBot, tCz - pz * s1.hw];
        const tBotR: [number, number, number] = [tCx + px * s1.hw, s1.yBot, tCz + pz * s1.hw];

        const warmFinger = 0.24 + (fIdx % 3) * 0.14 + ph * 0.08;
        const fTone = (fIdx % 2 === 0 ? 0.16 : -0.08) + ph * 0.04;
        const fSeed = 0.81 + fIdx * 0.03 + ph * 0.01;

        // Top broad plank face
        pushQuad(
          tTopL, tTopR, bTopR, bTopL,
          [-0.46, -0.47], [0.46, -0.47], [0.46, 0.36], [-0.46, 0.36],
          fTone, warmFinger, fSeed
        );
        // Left & right vertical plank sidewalls (deeper shadow tone for crisp blocky 2x4 volume!)
        pushQuad(
          tBotL, tTopL, bTopL, bBotL,
          [-0.45, -0.40], [0.45, -0.40], [0.45, 0.36], [-0.45, 0.36],
          fTone - 0.24, warmFinger + 0.06, fSeed
        );
        pushQuad(
          tTopR, tBotR, bBotR, bTopR,
          [-0.45, -0.40], [0.45, -0.40], [0.45, 0.36], [-0.45, 0.36],
          fTone - 0.28, warmFinger + 0.06, fSeed
        );

        // Squared cut-lumber end-cap on fingertip (`ph === 1`) catching warm end-grain light
        if (ph === 1) {
          pushQuad(
            tBotL, tBotR, tTopR, tTopL,
            [-0.48, -0.48], [0.48, -0.48], [0.48, -0.46], [-0.48, -0.46],
            fTone + 0.22, warmFinger + 0.16, fSeed
          );
        }
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
 * Builds the `THREE.Mesh` for the Guardian's continuous sculpted origami-plank sheet
 * (head, hooded downcast facial planes, forearm staves & box-plank fingers) or its planar reflection.
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
