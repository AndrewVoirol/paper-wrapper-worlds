import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_PRESETS,
  DEFAULT_PARAMS,
  PALETTE_PRESETS,
  type CameraPreset,
  type SimulationParams,
  type TelemetryState,
} from '../types';
import { PaperSceneUniforms } from '../shaders/paperCraftShader';
import {
  generateGuardianShingles,
  createGuardianInstancedMesh,
} from './buildShingleGuardian';
import { buildWoodlandDiorama } from './buildWoodlandDiorama';

/**
 * Core Three.js `r187` `WebGPURenderer` + `TSL` Engine for Paper-Wrapper Worlds.
 * Manages:
 * - Zero-allocation `setAnimationLoop` with `THREE.Timer` (`r183+` canonical clock).
 * - Smooth exponential camera preset transitions + OrbitControls exploration.
 * - Pointer raycasting against the pond plane and sculpture island to drive:
 *   1. Watercolor wash reveal trail blooms (`uWashTrail0..3`, `uCursorWorld`)
 *   2. Physical radial pond droplet ripples (`uRipple0..3`)
 * - Window `__PAPER_WORLD__` diagnostic & QA hook for live verification.
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
  private pondMesh!: THREE.Mesh;
  private shingleCount = 0;

  // Pre-allocated raycasting & camera interpolation scratch vectors (zero per-frame GC)
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNDC = new THREE.Vector2(0, 0);
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly targetCamPos = new THREE.Vector3(...CAMERA_PRESETS[0].position);
  private readonly targetLookAt = new THREE.Vector3(...CAMERA_PRESETS[0].target);
  private isTransitioningCamera = false;

  // Ring buffer indices for interactive wash stamps & pond ripples
  private washSlotIndex = 0;
  private rippleSlotIndex = 0;
  private lastWashStampPos = new THREE.Vector2(999, 999);
  private lastRippleTime = -10;

  // Telemetry tracking
  private frameCount = 0;
  private lastTelemetryTime = 0;
  private smoothedFrameMs = 8.0;
  private onTelemetry?: (state: TelemetryState) => void;
  private disposed = false;

  constructor(container: HTMLElement, onTelemetry?: (state: TelemetryState) => void) {
    this.container = container;
    this.onTelemetry = onTelemetry;
  }

  public async init(): Promise<void> {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    await this.renderer.init();
    if (this.disposed) return;

    // Clear container and mount canvas
    this.container.innerHTML = '';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.container.appendChild(this.renderer.domElement);

    // Scene setup with warm Washi rag paper background
    this.scene = new THREE.Scene();
    const initialPalette = PALETTE_PRESETS[0];
    this.scene.background = new THREE.Color(initialPalette.paperBgHex);
    this.uniforms.applyPalette(initialPalette);

    // Camera & OrbitControls
    const initialPreset = CAMERA_PRESETS[0];
    this.camera = new THREE.PerspectiveCamera(initialPreset.fov, width / height, 0.1, 80);
    this.camera.position.set(...initialPreset.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...initialPreset.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.maxPolarAngle = Math.PI * 0.485; // Keep camera above the paper table plane
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 18.5;
    this.controls.update();

    // Cancel automatic preset glide if the user grabs OrbitControls manually
    this.controls.addEventListener('start', () => {
      this.isTransitioningCamera = false;
    });

    // Warm studio & woodland skylight illumination
    const hemiLight = new THREE.HemisphereLight(0xfcf6e8, 0x6e624c, 1.45);
    hemiLight.position.set(0, 12, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.35);
    sunLight.position.set(5.5, 9.5, 6.2);
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0xdbe4d0, 0.55);
    rimLight.position.set(-6.0, 4.5, -5.0);
    this.scene.add(rimLight);

    // Build the crouching wooden shingle guardian + its inverted pond reflection
    const placements = generateGuardianShingles();
    this.shingleCount = placements.length;
    this.guardianUpright = createGuardianInstancedMesh(placements, this.uniforms, false, 0.0);
    this.guardianReflected = createGuardianInstancedMesh(placements, this.uniforms, true, 0.0);
    this.scene.add(this.guardianUpright);
    this.scene.add(this.guardianReflected);

    // Build surrounding woodland diorama, shoreline stones, trees & watercolor pond
    const diorama = buildWoodlandDiorama(this.uniforms);
    this.pondMesh = diorama.pondMesh;
    this.scene.add(diorama.rootGroup);

    // Seed an initial gentle ripple near the guardian's left hand at boot
    this.spawnPondRipple(-1.15, 0.85, 0.65);
    this.spawnPondRipple(1.10, 0.92, 0.55);

    // Bind pointer & resize listeners
    window.addEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointerleave', this.handlePointerLeave);

    // Expose live diagnostic & verification API on window
    (window as any).__PAPER_WORLD__ = {
      engine: this,
      setPreset: (id: CameraPreset['id']) => this.setCameraPreset(id, true),
      setParams: (p: Partial<SimulationParams>) => this.updateParams(p),
      spawnRipple: (x: number, z: number, strength = 0.85) => this.spawnPondRipple(x, z, strength),
      stampWash: (x: number, z: number, radius = 2.6) => this.stampWashTrail(x, z, radius),
      getTelemetry: () => this.getSnapshotTelemetry(),
    };

    this.timer.connect(document);
    this.renderer.setAnimationLoop(this.animate);
  }

  private handleResize = (): void => {
    if (!this.renderer || !this.camera || this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private updateRayFromEvent(ev: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNDC.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNDC.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint) !== null;
  }

  private handlePointerMove = (ev: PointerEvent): void => {
    if (!this.updateRayFromEvent(ev)) return;

    const hx = THREE.MathUtils.clamp(this.hitPoint.x, -5.0, 5.0);
    const hz = THREE.MathUtils.clamp(this.hitPoint.z, -4.5, 4.8);
    this.uniforms.uCursorWorld.value.set(hx, 0.0, hz);
    this.uniforms.uBrushActive.value = 1.0;

    // Stamp persistent watercolor reveal trail when cursor travels >= 0.45 m
    const distMoved = Math.hypot(hx - this.lastWashStampPos.x, hz - this.lastWashStampPos.y);
    if (distMoved > 0.45) {
      this.stampWashTrail(hx, hz, 2.35);
      this.lastWashStampPos.set(hx, hz);
    }

    // If sweeping over the foreground pond (z > 0.15), spawn gentle capillary ripples
    const now = this.uniforms.uTime.value;
    if (hz > 0.15 && now - this.lastRippleTime > 0.22 && distMoved > 0.18) {
      this.spawnPondRipple(hx, hz, 0.55);
      this.lastRippleTime = now;
    }
  };

  private handlePointerDown = (ev: PointerEvent): void => {
    if (!this.updateRayFromEvent(ev)) return;
    const hx = THREE.MathUtils.clamp(this.hitPoint.x, -5.0, 5.0);
    const hz = THREE.MathUtils.clamp(this.hitPoint.z, -4.5, 4.8);

    this.stampWashTrail(hx, hz, 2.75);
    if (hz > -0.1) {
      this.spawnPondRipple(hx, Math.max(0.25, hz), 0.95);
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
    target.value.set(x, z, radius, 0.95);
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

  public setCameraPreset(presetId: CameraPreset['id'], immediate = false): void {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.params.presetId = presetId;
    this.targetCamPos.set(...preset.position);
    this.targetLookAt.set(...preset.target);
    this.camera.fov = preset.fov;
    this.camera.updateProjectionMatrix();

    if (immediate) {
      this.camera.position.copy(this.targetCamPos);
      this.controls.target.copy(this.targetLookAt);
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
      revealCoverage: this.params.revealMode === 'full-diorama' ? 100 : 78,
      backend: (this.renderer as any)?.backend?.isWebGPUBackend !== false ? 'WebGPU (TSL)' : 'WebGL2 Fallback',
    };
  }

  private animate = (timestamp: number): void => {
    if (this.disposed) return;
    this.timer.update(timestamp);
    const dt = Math.min(0.1, this.timer.getDelta());
    const elapsed = this.timer.getElapsed();

    this.uniforms.uTime.value = elapsed;

    // Gentle meditative breathing of the crouching wooden guardian
    if (this.guardianUpright && this.guardianReflected) {
      const breathScaleY = 1.0 + Math.sin(elapsed * 1.45) * 0.008 * (0.5 + this.params.windBreeze);
      this.guardianUpright.scale.set(1.0, breathScaleY, 1.0);
      this.guardianReflected.scale.set(1.0, breathScaleY, 1.0);
    }

    // Periodic ambient pond droplet every ~4.5 seconds so the reflection stays alive
    if (elapsed - this.lastRippleTime > 4.2) {
      const side = (Math.floor(elapsed) % 2 === 0) ? -1 : 1;
      this.spawnPondRipple(side * 1.15, 0.65 + (elapsed % 1.2), 0.48);
      this.lastRippleTime = elapsed;
    }

    // Smooth camera preset transition
    if (this.isTransitioningCamera) {
      const alpha = 1.0 - Math.exp(-dt * 5.5);
      this.camera.position.lerp(this.targetCamPos, alpha);
      this.controls.target.lerp(this.targetLookAt, alpha);
      if (
        this.camera.position.distanceToSquared(this.targetCamPos) < 0.002 &&
        this.controls.target.distanceToSquared(this.targetLookAt) < 0.002
      ) {
        this.isTransitioningCamera = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // Frame telemetry update (~2 Hz to React UI)
    const frameMs = dt * 1000;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + frameMs * 0.1;
    this.frameCount++;
    if (timestamp - this.lastTelemetryTime > 480) {
      this.lastTelemetryTime = timestamp;
      this.onTelemetry?.(this.getSnapshotTelemetry());
    }
  };

  public dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    if (this.renderer?.domElement) {
      const dom = this.renderer.domElement;
      dom.removeEventListener('pointermove', this.handlePointerMove);
      dom.removeEventListener('pointerdown', this.handlePointerDown);
      dom.removeEventListener('pointerleave', this.handlePointerLeave);
    }
    this.controls?.dispose();
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
  }
}
