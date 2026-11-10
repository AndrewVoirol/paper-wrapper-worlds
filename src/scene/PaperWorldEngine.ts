import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_PRESETS,
  DEFAULT_PARAMS,
  PALETTE_PRESETS,
  STORY_PLATES,
  type CameraPreset,
  type SimulationParams,
  type TelemetryState,
} from '../types';
import {
  PaperSceneUniforms,
  WATER_LEVEL_Y,
  evalShorelineZJS,
  createWashiBackdropNode,
} from '../shaders/paperCraftShader';
import {
  generateGuardianShingles,
  createGuardianInstancedMesh,
  createGuardianSculptedSheetMesh,
} from './buildShingleGuardian';
import { buildWoodlandDiorama } from './buildWoodlandDiorama';

/**
 * Core Three.js `r187` `WebGPURenderer` + `TSL` Engine for Paper-Wrapper Worlds.
 * Manages:
 * - Zero-allocation `setAnimationLoop` with `THREE.Timer` (`r183+` canonical clock).
 * - Exact IEC sRGB->Linear parity (`NoToneMapping`) so Washi margins & watercolor washes
 *   converge to `0.000` RGB delta against `scene.background`.
 * - Compressed-sheet Guardian (continuous gentle facial/sleeve origami shell + structured
 *   tucked-overlap courses) & true planar reflection (`M_refl` across `y = WATER_LEVEL_Y`).
 * - Pointer raycasting against the pond cove and island to drive wash reveal stamps & droplet ripples.
 */
export class PaperWorldEngine {
  private container: HTMLElement;
  private renderer!: THREE.WebGPURenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private timer = new THREE.Timer();

  public readonly uniforms = new PaperSceneUniforms();
  private params: SimulationParams = { ...DEFAULT_PARAMS };

  private guardianUpright!: THREE.InstancedMesh;
  private guardianReflected!: THREE.InstancedMesh;
  private guardianSheetUpright!: THREE.Mesh;
  private guardianSheetReflected!: THREE.Mesh;
  private pondMesh!: THREE.Mesh;
  private shingleCount = 0;

  // Pre-allocated raycasting & camera interpolation scratch vectors (zero per-frame GC)
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNDC = new THREE.Vector2(0, 0);
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL_Y);
  private readonly hitPoint = new THREE.Vector3();
  private readonly targetCamPos = new THREE.Vector3(...CAMERA_PRESETS[0].position);
  private readonly targetLookAt = new THREE.Vector3(...CAMERA_PRESETS[0].target);
  private targetFov = CAMERA_PRESETS[0].fov;
  private currentFov = CAMERA_PRESETS[0].fov;
  private readonly targetNormOffset = new THREE.Vector2(0, 0);
  private readonly currentNormOffset = new THREE.Vector2(0, 0);
  private viewportWidth = 1;
  private viewportHeight = 1;
  private isTransitioningCamera = false;

  // Pointer drag vs click discrimination so pond clicks don't interrupt scroll choreography
  private readonly pointerDownClient = new THREE.Vector2(0, 0);
  private isPointerDown = false;
  private isUserOrbiting = false;
  private scrollProgress = 0;
  private lastActivePlateIndex = 0;

  // Ring buffer indices for interactive wash stamps & pond ripples
  private washSlotIndex = 0;
  private rippleSlotIndex = 0;
  private lastWashStampPos = new THREE.Vector2(999, 999);
  private lastRippleTime = -10;

  // Telemetry tracking
  private lastTelemetryTime = 0;
  private smoothedFrameMs = 7.8;
  private onTelemetry?: (state: TelemetryState) => void;
  private interactionTarget?: HTMLElement;
  private boundDomTarget?: HTMLElement;
  private disposed = false;

  constructor(
    container: HTMLElement,
    onTelemetry?: (state: TelemetryState) => void,
    interactionTarget?: HTMLElement
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.interactionTarget = interactionTarget;
  }

  public async init(): Promise<void> {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.viewportWidth = width;
    this.viewportHeight = height;

    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.NoToneMapping;

    await this.renderer.init();
    if (this.disposed) return;

    this.container.innerHTML = '';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // Scene setup with continuous tactile handmade Washi rag paper sheet (`0.000` seam)
    this.scene = new THREE.Scene();
    const initialPalette = PALETTE_PRESETS[0];
    this.scene.background = new THREE.Color(initialPalette.paperBgHex);
    this.uniforms.uSheetAspect.value = width / height;
    this.uniforms.applyPalette(initialPalette);
    (this.scene as any).backgroundNode = createWashiBackdropNode(this.uniforms);

    // Camera & OrbitControls
    const initialPreset = CAMERA_PRESETS[0];
    this.camera = new THREE.PerspectiveCamera(initialPreset.fov, width / height, 0.1, 90);
    this.camera.position.set(...initialPreset.position);

    const controlSurface = this.interactionTarget ?? this.renderer.domElement;
    this.boundDomTarget = controlSurface;
    // Register before OrbitControls so pointerdowns on prose slips or buttons never trigger setPointerCapture
    controlSurface.addEventListener('pointerdown', this.guardCardPointerDown);

    this.controls = new OrbitControls(this.camera, controlSurface);
    this.controls.target.set(...initialPreset.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minPolarAngle = 0.14;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 18.5;
    controlSurface.style.touchAction = 'pan-y';

    // Initialize opening bookplate framing offset immediately so frame 0 matches scrollY = 0
    this.setScrollProgress(0, width < 920, true);
    this.controls.update();

    // 1. Build continuous sculpted origami sheet (head, gentle face, sleeves & V-channel fingers)
    this.guardianSheetUpright = createGuardianSculptedSheetMesh(this.uniforms, false, WATER_LEVEL_Y);
    this.guardianSheetReflected = createGuardianSculptedSheetMesh(this.uniforms, true, WATER_LEVEL_Y);
    this.guardianSheetReflected.renderOrder = 1;
    this.guardianSheetUpright.renderOrder = 2;
    this.scene.add(this.guardianSheetUpright);
    this.scene.add(this.guardianSheetReflected);

    // 2. Build structured tucked-overlap courses (barrel torso, warm russet collar fan & ankles)
    const placements = generateGuardianShingles();
    this.shingleCount = placements.length;
    this.guardianUpright = createGuardianInstancedMesh(placements, this.uniforms, false, WATER_LEVEL_Y);
    this.guardianReflected = createGuardianInstancedMesh(placements, this.uniforms, true, WATER_LEVEL_Y);
    this.guardianReflected.renderOrder = 1;
    this.guardianUpright.renderOrder = 2;
    this.scene.add(this.guardianUpright);
    this.scene.add(this.guardianReflected);

    // 3. Build surrounding pleated woodland diorama, folded cove bank & Kubelka-Munk pond
    const diorama = buildWoodlandDiorama(this.uniforms);
    this.pondMesh = diorama.pondMesh;
    this.scene.add(diorama.rootGroup);
    void this.pondMesh;

    // Seed gentle capillary ripples near the guardian's splayed shoreline fingers at boot
    this.spawnPondRipple(-1.18, 0.86, 0.58);
    this.spawnPondRipple(1.08, 0.92, 0.50);

    // Bind pointer, resize & pagehide listeners
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerUp);
    const dom = this.boundDomTarget ?? this.renderer.domElement;
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointerleave', this.handlePointerLeave);

    // Expose live diagnostic & verification API on window
    (window as any).__PAPER_WORLD__ = {
      engine: this,
      setPreset: (id: CameraPreset['id']) => this.setCameraPreset(id, true),
      setScrollProgress: (u: number, compact?: boolean, immediate = false) =>
        this.setScrollProgress(u, compact ?? this.viewportWidth < 920, immediate),
      recenterView: () => this.recenterToScroll(),
      setParams: (p: Partial<SimulationParams>) => this.updateParams(p),
      spawnRipple: (x: number, z: number, strength = 0.85) => this.spawnPondRipple(x, z, strength),
      stampWash: (x: number, z: number, radius = 2.45) => this.stampWashTrail(x, z, radius),
      getTelemetry: () => this.getSnapshotTelemetry(),
    };

    this.timer.connect(document);
    this.renderer.setAnimationLoop(this.animate);
  }

  private handlePageHide = (ev: PageTransitionEvent): void => {
    if (!ev.persisted) {
      this.dispose();
    }
  };

  private applyCameraProjection(): void {
    if (!this.camera) return;
    this.camera.fov = this.currentFov;
    const ox = this.currentNormOffset.x * this.viewportWidth;
    const oy = this.currentNormOffset.y * this.viewportHeight;
    if (Math.abs(ox) > 0.25 || Math.abs(oy) > 0.25) {
      this.camera.setViewOffset(
        this.viewportWidth,
        this.viewportHeight,
        ox,
        oy,
        this.viewportWidth,
        this.viewportHeight
      );
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  private handleResize = (): void => {
    if (!this.renderer || !this.camera || this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.camera.aspect = width / height;
    this.uniforms.uSheetAspect.value = width / height;
    // Update target offset if crossing compact/wide breakpoint while staying smoothly framed
    this.setScrollProgress(this.scrollProgress, width < 920, false);
    this.applyCameraProjection();
    this.renderer.setSize(width, height);
  };

  private handleWindowPointerUp = (): void => {
    this.isPointerDown = false;
  };

  private updateRayFromEvent(ev: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint) !== null;
  }

  private handlePointerMove = (ev: PointerEvent): void => {
    if (this.isPointerDown) {
      const dragPx = Math.hypot(
        ev.clientX - this.pointerDownClient.x,
        ev.clientY - this.pointerDownClient.y
      );
      if (dragPx > 5) {
        this.isUserOrbiting = true;
        this.isTransitioningCamera = false;
      }
    }

    if (!this.updateRayFromEvent(ev)) return;

    const hx = THREE.MathUtils.clamp(this.hitPoint.x, -4.65, 4.65);
    const hz = THREE.MathUtils.clamp(this.hitPoint.z, -3.65, 5.85);
    this.uniforms.uCursorWorld.value.set(hx, WATER_LEVEL_Y, hz);
    this.uniforms.uBrushActive.value = 1.0;

    const distMoved = Math.hypot(hx - this.lastWashStampPos.x, hz - this.lastWashStampPos.y);
    if (distMoved > 0.45) {
      this.stampWashTrail(hx, hz, 2.45);
      this.lastWashStampPos.set(hx, hz);
    }

    const now = this.uniforms.uTime.value;
    const shoreZ = evalShorelineZJS(hx);
    if (hz > shoreZ + 0.05 && hz < 5.75 && Math.abs(hx) < 4.45 && now - this.lastRippleTime > 0.22 && distMoved > 0.18) {
      this.spawnPondRipple(hx, hz, 0.54);
      this.lastRippleTime = now;
    }
  };

  private guardCardPointerDown = (ev: PointerEvent): void => {
    const target = ev.target as Element | null;
    if (target?.closest('button, a, .prologue-folio-block, .folio-passage-sheet')) {
      ev.stopImmediatePropagation();
    }
  };

  private handlePointerDown = (ev: PointerEvent): void => {
    this.isPointerDown = true;
    this.pointerDownClient.set(ev.clientX, ev.clientY);

    if (!this.updateRayFromEvent(ev)) return;
    const hx = THREE.MathUtils.clamp(this.hitPoint.x, -4.65, 4.65);
    const hz = THREE.MathUtils.clamp(this.hitPoint.z, -3.65, 5.85);

    this.stampWashTrail(hx, hz, 2.75);
    const shoreZ = evalShorelineZJS(hx);
    if (hz > shoreZ - 0.12 && hz < 5.85 && Math.abs(hx) < 4.55) {
      this.spawnPondRipple(hx, Math.max(shoreZ + 0.14, hz), 0.94);
    }
  };

  private handlePointerLeave = (): void => {
    this.uniforms.uBrushActive.value = 0.0;
  };

  public stampWashTrail(x: number, z: number, radius = 2.4): void {
    const slots = [
      this.uniforms.uWashTrail0,
      this.uniforms.uWashTrail1,
      this.uniforms.uWashTrail2,
      this.uniforms.uWashTrail3,
    ];
    const target = slots[this.washSlotIndex % 4];
    target.value.set(x, z, radius, 0.96);
    this.washSlotIndex = (this.washSlotIndex + 1) % 4;
  }

  public spawnPondRipple(x: number, z: number, strength = 0.75): void {
    const slots = [
      this.uniforms.uRipple0,
      this.uniforms.uRipple1,
      this.uniforms.uRipple2,
      this.uniforms.uRipple3,
    ];
    const target = slots[this.rippleSlotIndex % 4];
    target.value.set(x, z, this.uniforms.uTime.value, strength);
    this.rippleSlotIndex = (this.rippleSlotIndex + 1) % 4;
  }

  private findPreset(id: CameraPreset['id']): CameraPreset {
    for (let i = 0; i < CAMERA_PRESETS.length; i++) {
      if (CAMERA_PRESETS[i].id === id) return CAMERA_PRESETS[i];
    }
    return CAMERA_PRESETS[0];
  }

  /**
   * Choreographs camera position, lookAt target, field-of-view, and responsive folio viewOffset
   * continuously across normalized scroll progress `u in [0, 1]` with gentle dwell plateaus
   * at each story plate (`u = 0, 0.25, 0.50, 0.75, 1.00`).
   */
  public setScrollProgress(
    progress: number,
    isCompactViewport = false,
    immediate = false
  ): void {
    const u = THREE.MathUtils.clamp(progress, 0, 1);
    this.scrollProgress = u;

    const segCount = STORY_PLATES.length - 1; // 4 transitions across 5 plates
    const scaled = u * segCount;
    const idxA = Math.min(segCount - 1, Math.max(0, Math.floor(scaled)));
    const idxB = idxA + 1;
    const localU = scaled - idxA;

    // Dwell plateau (18% at each plate center) + Hermite smoothstep glide between plates
    const dwell = 0.18;
    const rawT = THREE.MathUtils.clamp((localU - dwell) / (1.0 - 2.0 * dwell), 0.0, 1.0);
    const t = rawT * rawT * (3.0 - 2.0 * rawT);

    const plateA = STORY_PLATES[idxA];
    const plateB = STORY_PLATES[idxB];
    const presetA = this.findPreset(plateA.presetId);
    const presetB = this.findPreset(plateB.presetId);

    this.targetCamPos.set(
      THREE.MathUtils.lerp(presetA.position[0], presetB.position[0], t),
      THREE.MathUtils.lerp(presetA.position[1], presetB.position[1], t),
      THREE.MathUtils.lerp(presetA.position[2], presetB.position[2], t)
    );
    this.targetLookAt.set(
      THREE.MathUtils.lerp(presetA.target[0], presetB.target[0], t),
      THREE.MathUtils.lerp(presetA.target[1], presetB.target[1], t),
      THREE.MathUtils.lerp(presetA.target[2], presetB.target[2], t)
    );
    this.targetFov = THREE.MathUtils.lerp(presetA.fov, presetB.fov, t);

    const offA = isCompactViewport ? plateA.mobileOffset : plateA.desktopOffset;
    const offB = isCompactViewport ? plateB.mobileOffset : plateB.desktopOffset;
    this.targetNormOffset.set(
      THREE.MathUtils.lerp(offA[0], offB[0], t),
      THREE.MathUtils.lerp(offA[1], offB[1], t)
    );

    const activePlateIdx = Math.round(scaled);
    if (activePlateIdx !== this.lastActivePlateIndex) {
      if (this.renderer) {
        if (activePlateIdx === 1) {
          // Arriving on the Bernheim Arboretum trail blooms warm autumn wash along the woodland bank
          this.stampWashTrail(2.15, -0.45, 2.35);
        } else if (activePlateIdx === 3) {
          // Answer Plate III ("Hands on the Mossy Bank") with a shoreline ripple off Little Nis's left fingers
          this.spawnPondRipple(-1.12, 0.88, 0.68);
        } else if (activePlateIdx === 4) {
          // Answer Plate IV ("Familiar, Yet So Strange") with a quiet droplet ring over his reflection
          this.spawnPondRipple(0.08, 1.38, 0.62);
        }
      }
      this.lastActivePlateIndex = activePlateIdx;
    }

    this.params.presetId = STORY_PLATES[activePlateIdx].presetId;
    this.isUserOrbiting = false;

    if (immediate && this.camera && this.controls) {
      this.camera.position.copy(this.targetCamPos);
      this.controls.target.copy(this.targetLookAt);
      this.currentFov = this.targetFov;
      this.currentNormOffset.copy(this.targetNormOffset);
      this.applyCameraProjection();
      this.controls.update();
      this.isTransitioningCamera = false;
    } else {
      this.isTransitioningCamera = true;
    }
  }

  public recenterToScroll(): void {
    this.setScrollProgress(this.scrollProgress, this.viewportWidth < 920, false);
    this.spawnPondRipple(0.0, 1.12, 0.72);
  }

  public setCameraPreset(presetId: CameraPreset['id'], immediate = false): void {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.params.presetId = presetId;
    this.targetCamPos.set(...preset.position);
    this.targetLookAt.set(...preset.target);
    this.targetFov = preset.fov;
    this.targetNormOffset.set(0, 0);
    this.isUserOrbiting = false;

    if (immediate) {
      this.camera.position.copy(this.targetCamPos);
      this.controls.target.copy(this.targetLookAt);
      this.currentFov = this.targetFov;
      this.currentNormOffset.set(0, 0);
      this.applyCameraProjection();
      this.controls.update();
      this.isTransitioningCamera = false;
    } else {
      this.isTransitioningCamera = true;
    }
  }

  public updateParams(next: Partial<SimulationParams>): void {
    Object.assign(this.params, next);

    if (next.presetId !== undefined) {
      this.setCameraPreset(next.presetId, false);
    }
    if (next.paletteId !== undefined) {
      const pal = PALETTE_PRESETS.find((p) => p.id === next.paletteId);
      if (pal) {
        this.uniforms.applyPalette(pal);
        if (this.scene) {
          this.scene.background = new THREE.Color(pal.paperBgHex);
        }
      }
    }
    if (next.revealMode !== undefined) {
      this.uniforms.uRevealMode.value = next.revealMode === 'full-diorama' ? 1.0 : 0.0;
    }
    if (next.paperTooth !== undefined) {
      this.uniforms.uPaperTooth.value = next.paperTooth;
    }
    if (next.watercolorBleed !== undefined) {
      this.uniforms.uWatercolorBleed.value = next.watercolorBleed;
    }
    if (next.pondRippleStrength !== undefined) {
      this.uniforms.uPondRippleStrength.value = next.pondRippleStrength;
    }
    if (next.shingleRoughness !== undefined) {
      this.uniforms.uShingleRoughness.value = next.shingleRoughness;
    }
    if (next.windBreeze !== undefined) {
      this.uniforms.uWindBreeze.value = next.windBreeze;
    }
  }

  public getSnapshotTelemetry(): TelemetryState {
    const now = this.uniforms.uTime.value;
    const rippleVecs = [
      this.uniforms.uRipple0.value,
      this.uniforms.uRipple1.value,
      this.uniforms.uRipple2.value,
      this.uniforms.uRipple3.value,
    ];
    const activeRipples = rippleVecs.filter((r) => now - r.z >= 0 && now - r.z < 4.5).length;

    return {
      fps: Math.min(120, Math.round(1000 / Math.max(1, this.smoothedFrameMs))),
      frameMs: Number(this.smoothedFrameMs.toFixed(1)),
      shingleCount: this.shingleCount,
      activeRipples,
      revealCoverage: this.params.revealMode === 'full-diorama' ? 100 : 82,
      backend: (this.renderer as any)?.backend?.isWebGPUBackend !== false ? 'WebGPU (TSL)' : 'WebGL2 Fallback',
    };
  }

  private animate = (timestamp: number): void => {
    if (this.disposed) return;
    this.timer.update(timestamp);
    const dt = Math.min(0.1, this.timer.getDelta());
    const elapsed = this.timer.getElapsed();

    this.uniforms.uTime.value = elapsed;

    // Gentle meditative breathing across both the sculpted sheet & tucked courses
    if (this.guardianUpright && this.guardianReflected && this.guardianSheetUpright && this.guardianSheetReflected) {
      const breathScaleY = 1.0 + Math.sin(elapsed * 1.45) * 0.007 * (0.5 + this.params.windBreeze);
      this.guardianUpright.scale.set(1.0, breathScaleY, 1.0);
      this.guardianReflected.scale.set(1.0, breathScaleY, 1.0);
      this.guardianSheetUpright.scale.set(1.0, breathScaleY, 1.0);
      this.guardianSheetReflected.scale.set(1.0, -breathScaleY, 1.0);
    }

    // Periodic ambient pond droplet every ~4.4 seconds inside the foreground mirror cove
    if (elapsed - this.lastRippleTime > 4.4) {
      const side = Math.floor(elapsed) % 2 === 0 ? -1 : 1;
      this.spawnPondRipple(side * 1.05, 0.95 + (elapsed % 1.45), 0.48);
      this.lastRippleTime = elapsed;
    }

    if (this.isTransitioningCamera && !this.isUserOrbiting) {
      const alpha = 1.0 - Math.exp(-dt * 4.8);
      this.camera.position.lerp(this.targetCamPos, alpha);
      this.controls.target.lerp(this.targetLookAt, alpha);

      const fovDelta = Math.abs(this.targetFov - this.currentFov);
      const offDeltaSq = this.currentNormOffset.distanceToSquared(this.targetNormOffset);
      if (fovDelta > 0.002 || offDeltaSq > 1e-7) {
        this.currentFov = THREE.MathUtils.lerp(this.currentFov, this.targetFov, alpha);
        this.currentNormOffset.lerp(this.targetNormOffset, alpha);
        this.applyCameraProjection();
      }

      if (
        this.camera.position.distanceToSquared(this.targetCamPos) < 0.0008 &&
        this.controls.target.distanceToSquared(this.targetLookAt) < 0.0008 &&
        fovDelta <= 0.002 &&
        offDeltaSq <= 1e-7
      ) {
        this.camera.position.copy(this.targetCamPos);
        this.controls.target.copy(this.targetLookAt);
        this.currentFov = this.targetFov;
        this.currentNormOffset.copy(this.targetNormOffset);
        this.applyCameraProjection();
        this.isTransitioningCamera = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const frameMs = dt * 1000;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + frameMs * 0.1;
    if (this.onTelemetry && timestamp - this.lastTelemetryTime > 480) {
      this.lastTelemetryTime = timestamp;
      this.onTelemetry(this.getSnapshotTelemetry());
    }
  };

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    const dom = this.boundDomTarget ?? this.renderer?.domElement;
    if (dom) {
      dom.removeEventListener('pointerdown', this.guardCardPointerDown);
      dom.removeEventListener('pointermove', this.handlePointerMove);
      dom.removeEventListener('pointerdown', this.handlePointerDown);
      dom.removeEventListener('pointerleave', this.handlePointerLeave);
    }
    this.controls?.dispose();
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
  }
}
