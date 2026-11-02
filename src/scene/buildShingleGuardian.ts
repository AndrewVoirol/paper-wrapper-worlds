import * as THREE from 'three/webgpu';
import {
  type PaperSceneUniforms,
  createPaperShingleMaterial,
  createCreasedPaperStripGeometry,
} from '../shaders/paperCraftShader';

export interface ShinglePlacement {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  toneShift: number;     // [-1..1]
  warmCollarMix: number; // [0..1] (0 = silver-grey weathered cedar, 1 = warm russet collar/brow)
  grainPhase: number;    // [0..1]
}

function createSeededRandom(seed = 1337): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0x00ffffff) / 0x01000000;
  };
}

/**
 * Generates the complete set of layered cedar shingles & structural wood planks for the
 * crouching forest guardian sculpture (matching the user's photograph of the wooden shingle
 * troll crouching at the edge of the pond).
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

  const addOrientedShingle = (
    pos: THREE.Vector3,
    outwardNormal: THREE.Vector3,
    downDir: THREE.Vector3,
    width: number,
    length: number,
    thickness: number,
    warmCollarMix: number,
    tiltOutRad = 0.16,
    toneOverride?: number
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
      tiltOutRad + (rand() - 0.5) * 0.08
    );
    const yawQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (rand() - 0.5) * 0.11
    );
    tmpQuat.multiply(tiltQ).multiply(yawQ);

    placements.push({
      position: pos.clone(),
      quaternion: tmpQuat.clone(),
      scale: new THREE.Vector3(width, length, thickness),
      toneShift: toneOverride !== undefined ? toneOverride : (rand() - 0.5) * 1.65,
      warmCollarMix,
      grainPhase: rand(),
    });
  };

  // ============================================================================
  // 1. BARREL TORSO / ROUNDED BELLY (Overlapping Vertical Courses of Cedar Shingles)
  // ============================================================================
  // Torso center sits at (0, 0.88, -0.92), leaning forward over the pond shoreline
  const torsoRows = 14;
  for (let r = 0; r < torsoRows; r++) {
    const v = r / (torsoRows - 1); // 0 = bottom near earth/feet, 1 = upper hunched back/shoulders
    const y = 0.14 + v * 1.48;
    // Barrel profile: broad rounded belly, tapering slightly at bottom and top
    const radiusX = 0.82 * Math.sin(v * Math.PI * 0.84 + 0.22) + 0.19;
    const radiusZ = 0.72 * Math.sin(v * Math.PI * 0.84 + 0.22) + 0.18;
    const centerZ = -0.98 + Math.pow(v, 1.35) * 0.32;

    const cols = Math.max(18, Math.round(radiusX * 34));
    for (let c = 0; c < cols; c++) {
      const theta = ((c + (r % 2) * 0.5) / cols) * Math.PI * 2;
      const jitterTheta = theta + (rand() - 0.5) * 0.045;
      const sx = Math.sin(jitterTheta) * radiusX;
      const sz = Math.cos(jitterTheta) * radiusZ;

      tmpPos.set(sx, y + (rand() - 0.5) * 0.025, centerZ + sz);
      const normal = new THREE.Vector3(
        Math.sin(jitterTheta) / radiusX,
        (v - 0.45) * 0.35,
        Math.cos(jitterTheta) / radiusZ
      ).normalize();

      const shingleW = 0.13 + rand() * 0.055;
      const shingleH = 0.21 + rand() * 0.065;
      // Front upper chest beneath the head gets warm russet cedar transition
      const isFrontChest = Math.cos(jitterTheta) > 0.25 && v > 0.55;
      // Only let torso shingles cover the front up to v = 0.65 where the warm russet collar bib takes over
      if (Math.cos(jitterTheta) > 0.35 && v > 0.64 && v < 0.92) {
        continue;
      }
      const warmMix = isFrontChest
        ? Math.min(1.0, (v - 0.55) * 2.2 * Math.cos(jitterTheta)) * 0.85
        : rand() * 0.18;

      addOrientedShingle(
        tmpPos,
        normal,
        new THREE.Vector3(0, -1, 0.12),
        shingleW,
        shingleH,
        0.032,
        warmMix,
        0.18
      );
    }
  }

  // ============================================================================
  // 2. RADIALLY LAYERED WARM CEDAR COLLAR / NECK RUFF (Fanning Down Chest Under Chin)
  // ============================================================================
  // In the photo, long warm reddish-brown cedar shingles radiate downward in a bib/fan
  // directly beneath the chin and across the upper chest between the shoulders.
  const chinPivot = new THREE.Vector3(0, 1.48, -0.44);
  const collarCourses = 4;
  for (let course = 0; course < collarCourses; course++) {
    const cFrac = course / (collarCourses - 1); // 0 = inner ruff right under chin, 1 = outer chest fan
    const radialLen = 0.24 + cFrac * 0.38;
    const count = 17 + course * 5;
    for (let i = 0; i < count; i++) {
      // Fan angle across front chest (-78 deg to +78 deg)
      const fanAngle = ((i / (count - 1)) - 0.5) * Math.PI * 0.86;
      const sinA = Math.sin(fanAngle);
      const cosA = Math.cos(fanAngle);

      // Course follows the rounded upper chest contour downward and outward in front of the torso (`z > -0.18`)
      const px = chinPivot.x + sinA * (0.18 + radialLen * 0.96);
      const py = chinPivot.y - cosA * radialLen * 0.78 - Math.abs(sinA) * 0.06;
      const pz = -0.12 + cosA * 0.18 - cFrac * 0.02;

      tmpPos.set(px, py, pz);

      const outNormal = new THREE.Vector3(sinA * 0.45, 0.28, cosA * 0.88).normalize();
      const shingleDown = new THREE.Vector3(sinA * 0.65, -0.74, cosA * 0.18).normalize();

      addOrientedShingle(
        tmpPos,
        outNormal,
        shingleDown,
        0.125 + rand() * 0.035,
        0.26 + rand() * 0.05,
        0.038,
        0.88 + rand() * 0.12, // Rich warm russet-cedar collar shingles
        0.19
      );
    }
  }

  // ============================================================================
  // 3. SCULPTED WOODEN HEAD (Smooth Plank Skull Cap, Heavy V-Brow, Dark Eyes, Wedge Nose, Ears)
  // ============================================================================
  // Head is tucked forward over the collar, gazing down into the pond reflection
  const headCenter = new THREE.Vector3(0, 1.68, -0.26);

  // Overlapping horizontal wooden planks across the rounded cranium dome (no gaps!)
  const headLatRows = 7;
  for (let r = 0; r < headLatRows; r++) {
    const phi = (r / (headLatRows - 1)) * (Math.PI * 0.64);
    const ringRadius = Math.sin(phi) * 0.43 + 0.06;
    const y = headCenter.y + Math.cos(phi) * 0.35;
    const cols = Math.max(10, Math.round(ringRadius * 32));
    for (let c = 0; c < cols; c++) {
      const theta = ((c + (r % 2) * 0.5) / cols) * Math.PI * 2;
      const nx = Math.sin(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.cos(theta) * Math.sin(phi);

      tmpPos.set(headCenter.x + nx * 0.43, y, headCenter.z + nz * 0.44);
      addOrientedShingle(
        tmpPos,
        new THREE.Vector3(nx, ny + 0.22, nz).normalize(),
        new THREE.Vector3(0, -1, 0.32).normalize(),
        0.18 + rand() * 0.03,
        0.19 + rand() * 0.03,
        0.042,
        0.06 + rand() * 0.12,
        0.06
      );
    }
  }

  // Heavy overhanging V-shaped brow ridge planks + recessed dark eye sockets
  for (let side of [-1, 1]) {
    for (let s = 0; s < 5; s++) {
      const frac = s / 4;
      const bx = side * (0.05 + frac * 0.32);
      const by = headCenter.y - 0.01 + frac * 0.09;
      const bz = headCenter.z + 0.44 - frac * 0.12;
      addOrientedShingle(
        new THREE.Vector3(bx, by, bz),
        new THREE.Vector3(side * 0.22, 0.28, 0.94).normalize(),
        new THREE.Vector3(side * 0.78, 0.24, -0.2).normalize(),
        0.135,
        0.15,
        0.055,
        0.22,
        0.06,
        0.45 // Bright top-lit brow plank
      );
    }

    // Deep dark wooden eye socket directly underneath the brow overhang
    for (let e = 0; e < 2; e++) {
      addOrientedShingle(
        new THREE.Vector3(side * (0.14 + e * 0.09), headCenter.y - 0.08, headCenter.z + 0.39 - e * 0.03),
        new THREE.Vector3(side * 0.2, -0.2, 0.95).normalize(),
        new THREE.Vector3(side * 0.85, -0.12, -0.15).normalize(),
        0.12,
        0.10,
        0.045,
        0.95,
        0.0,
        -0.98 // Deep shadow inside eye socket
      );
    }

    // Warm russet cheek/mustache shingles flanking the nose
    for (let ck = 0; ck < 4; ck++) {
      const cf = ck / 3;
      addOrientedShingle(
        new THREE.Vector3(side * (0.10 + cf * 0.22), headCenter.y - 0.18 - cf * 0.04, headCenter.z + 0.38 - cf * 0.08),
        new THREE.Vector3(side * 0.45, -0.15, 0.88).normalize(),
        new THREE.Vector3(side * 0.4, -0.85, 0.2).normalize(),
        0.10,
        0.18,
        0.038,
        0.85,
        0.14
      );
    }

    // Pointed troll ears jutting up and out from the upper temples
    for (let e = 0; e < 3; e++) {
      const ef = e / 2;
      addOrientedShingle(
        new THREE.Vector3(
          side * (0.42 + ef * 0.16),
          headCenter.y + 0.10 + ef * 0.11,
          headCenter.z - 0.02 - ef * 0.04
        ),
        new THREE.Vector3(side * 0.7, 0.45, 0.4).normalize(),
        new THREE.Vector3(side * 0.75, 0.45, -0.2).normalize(),
        0.095 - ef * 0.02,
        0.21,
        0.035,
        0.25,
        0.05
      );
    }
  }

  // Prominent wedged wooden nose bridge & tip pointing down toward the pond
  for (let n = 0; n < 4; n++) {
    const nf = n / 3;
    addOrientedShingle(
      new THREE.Vector3(0, headCenter.y - 0.04 - nf * 0.17, headCenter.z + 0.46 + nf * 0.06),
      new THREE.Vector3(0, 0.12, 0.99).normalize(),
      new THREE.Vector3(0, -1, 0.22).normalize(),
      0.115 + (1.0 - nf) * 0.03,
      0.15,
      0.058,
      0.32,
      0.10,
      0.25
    );
  }

  // ============================================================================
  // 4. LONG ARTICULATED ARMS & 5-SPLAYED WOODEN FINGERS AT THE WATER'S EDGE
  // ============================================================================
  // Notice the asymmetry in the photo:
  // - Viewer-left arm (`side = -1`, creature's right arm) slopes continuously diagonal-outward
  //   with long splayed fingers fanned toward the viewer-left shoreline.
  // - Viewer-right arm (`side = +1`, creature's left arm) bends at the elbow so the forearm
  //   drops nearly vertical into the right hand with 5 splayed fingers.
  for (let side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 0.74, 1.56, -0.72);
    const elbow =
      side < 0
        ? new THREE.Vector3(-1.12, 0.96, -0.18) // Smooth diagonal slope on viewer-left
        : new THREE.Vector3(1.26, 1.04, -0.16); // Higher, wider elbow bend on viewer-right
    const wrist =
      side < 0
        ? new THREE.Vector3(-1.38, 0.22, 0.28)
        : new THREE.Vector3(1.22, 0.22, 0.30);

    const buildLimbSegment = (
      pStart: THREE.Vector3,
      pEnd: THREE.Vector3,
      rStart: number,
      rEnd: number,
      rings: number,
      facets: number,
      isUpperShoulder: boolean
    ) => {
      const axis = new THREE.Vector3().subVectors(pEnd, pStart);
      const segLen = axis.length();
      const axisDir = axis.clone().normalize();

      const ref = Math.abs(axisDir.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0);
      const uVec = new THREE.Vector3().crossVectors(axisDir, ref).normalize();
      const vVec = new THREE.Vector3().crossVectors(axisDir, uVec).normalize();

      for (let i = 0; i < rings; i++) {
        const t = i / rings;
        const ringCenter = new THREE.Vector3().lerpVectors(pStart, pEnd, t + 0.5 / rings);
        const radius = THREE.MathUtils.lerp(rStart, rEnd, t);
        const ringHeight = (segLen / rings) * 1.16;

        for (let f = 0; f < facets; f++) {
          const angle = ((f + (i % 2) * 0.35) / facets) * Math.PI * 2;
          const radial = new THREE.Vector3()
            .addScaledVector(uVec, Math.cos(angle))
            .addScaledVector(vVec, Math.sin(angle))
            .normalize();

          const plankPos = ringCenter.clone().addScaledVector(radial, radius);
          const warm = isUpperShoulder && t < 0.35 ? 0.28 : 0.08 + rand() * 0.14;
          addOrientedShingle(
            plankPos,
            radial,
            axisDir,
            ((2 * Math.PI * radius) / facets) * 1.06,
            ringHeight,
            0.04,
            warm,
            isUpperShoulder ? 0.14 : 0.06
          );
        }
      }
    };

    buildLimbSegment(shoulder, elbow, 0.29, 0.20, 6, 9, true);
    buildLimbSegment(elbow, wrist, 0.19, 0.14, 4, 8, false);

    // Broad wooden hand dorsum at wrist
    addOrientedShingle(
      new THREE.Vector3(wrist.x, 0.16, wrist.z + 0.07),
      new THREE.Vector3(0, 0.88, 0.45).normalize(),
      new THREE.Vector3(side * 0.12, -0.35, 0.92).normalize(),
      0.32,
      0.26,
      0.06,
      0.22,
      0.04
    );

    // 5 Splayed Wooden Plank Fingers resting on the shoreline bank
    const fingerAngles =
      side < 0
        ? [-1.18, -0.82, -0.44, -0.05, 0.32] // Left hand fans strongly outward to the left
        : [-0.42, -0.06, 0.28, 0.62, 0.96];  // Right hand fans forward and right

    fingerAngles.forEach((fAngle, fIdx) => {
      const isThumb = (side < 0 && fIdx === 4) || (side > 0 && fIdx === 0);
      const fLen = isThumb ? 0.38 : 0.54 + (fIdx === 2 ? 0.08 : 0.0);
      const dirX = Math.sin(fAngle);
      const dirZ = Math.cos(fAngle);

      for (let ph = 0; ph < 2; ph++) {
        const pf = (ph + 0.5) / 2;
        const fx = wrist.x + dirX * (0.13 + pf * fLen);
        const fz = wrist.z + 0.05 + dirZ * (0.13 + pf * fLen);
        const fy = 0.09 - ph * 0.03;

        addOrientedShingle(
          new THREE.Vector3(fx, fy, fz),
          new THREE.Vector3(0, 0.95, 0.25).normalize(),
          new THREE.Vector3(dirX, -0.1, dirZ).normalize(),
          0.085 - ph * 0.008,
          fLen * 0.54,
          0.055,
          0.35 + rand() * 0.18,
          0.03
        );
      }
    });
  }

  // ============================================================================
  // 5. CROUCHED WOODEN FEET & CHUNKY TOES TUCKED UNDER THE BELLY
  // ============================================================================
  for (let side of [-1, 1]) {
    const ankle = new THREE.Vector3(side * 0.48, 0.20, -0.26);
    for (let c = 0; c < 6; c++) {
      const a = (c / 6) * Math.PI * 2;
      addOrientedShingle(
        new THREE.Vector3(ankle.x + Math.sin(a) * 0.18, 0.22, ankle.z + Math.cos(a) * 0.18),
        new THREE.Vector3(Math.sin(a), 0.3, Math.cos(a)).normalize(),
        new THREE.Vector3(0, -1, 0.2).normalize(),
        0.13,
        0.20,
        0.045,
        0.2,
        0.11
      );
    }

    for (let tIdx = 0; tIdx < 4; tIdx++) {
      const spread = (tIdx - 1.5) * 0.16 + side * 0.12;
      const toeDirX = Math.sin(spread);
      const toeDirZ = Math.cos(spread);
      const toeLen = 0.34 - Math.abs(tIdx - 1.2) * 0.04;

      for (let seg = 0; seg < 2; seg++) {
        const sf = (seg + 0.5) / 2;
        addOrientedShingle(
          new THREE.Vector3(
            ankle.x + toeDirX * (0.11 + sf * toeLen),
            0.10 - seg * 0.028,
            ankle.z + 0.08 + toeDirZ * (0.11 + sf * toeLen)
          ),
          new THREE.Vector3(0, 0.92, 0.35).normalize(),
          new THREE.Vector3(toeDirX, -0.1, toeDirZ).normalize(),
          0.105,
          toeLen * 0.55,
          0.072,
          0.44 + rand() * 0.2,
          0.03
        );
      }
    }
  }

  return placements;
}

/**
 * Builds the `THREE.InstancedMesh` for either the upright guardian or its inverted underwater reflection.
 * Uses positive scales + an explicit reflection matrix across `Y = waterLevelY` so normals and
 * winding order stay clean without inside-out dark faces.
 */
export function createGuardianInstancedMesh(
  placements: ShinglePlacement[],
  uniforms: PaperSceneUniforms,
  isReflected: boolean,
  waterLevelY = 0.0
): THREE.InstancedMesh {
  // Creased, deckle-curled paper strip geometry instead of flat rectangular boxes
  const geom = createCreasedPaperStripGeometry();

  const count = placements.length;
  const variationArray = new Float32Array(count * 3);

  const mat = createPaperShingleMaterial(uniforms, {
    role: isReflected ? 'reflected-shingle' : 'shingle',
  });
  if (isReflected) {
    mat.side = THREE.DoubleSide;
  }

  const mesh = new THREE.InstancedMesh(geom, mat, count);
  const dummyMat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const p = placements[i];
    if (isReflected) {
      // Mirror across Y = waterLevelY and project Z slightly forward (+0.52) toward the viewer's pond plane
      // so the reflected head, russet collar, and arms sit directly beneath the shoreline hands in the water!
      pos.set(p.position.x, 2 * waterLevelY - p.position.y * 0.92, p.position.z + 0.55);
      // Mirror orientation across horizontal plane without negative scale inversion
      quat.set(p.quaternion.x, -p.quaternion.y, p.quaternion.z, -p.quaternion.w).normalize();
      scale.copy(p.scale);
    } else {
      pos.copy(p.position);
      quat.copy(p.quaternion);
      scale.copy(p.scale);
    }

    dummyMat.compose(pos, quat, scale);
    mesh.setMatrixAt(i, dummyMat);

    variationArray[i * 3 + 0] = p.toneShift;
    variationArray[i * 3 + 1] = p.warmCollarMix;
    variationArray[i * 3 + 2] = p.grainPhase;
  }

  geom.setAttribute('aVariation', new THREE.InstancedBufferAttribute(variationArray, 3));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = !isReflected;
  mesh.receiveShadow = !isReflected;
  return mesh;
}
