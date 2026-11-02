# Paper-Wrapper Worlds — Engineering & Optical Playbook (`AGENTS.md`)

## 0. Fast Triage & Anti-Relearning Runbook

- **Symbol Map**: `npm run map:symbols -- <keyword>`
- **Blast-Radius Tests**: `npm run test:blast` (or `npm test` for full Vitest suite)
- **Static WGSL & Layout Audit**: `npm run lint:wgsl`
- **Dev Server**: `npm run dev` (runs on `http://localhost:5173`)
- **Production Build**: `npm run build` (`tsc -b && vite build`)
- **Live Optical & Preset Verification**: `npm run bench:optical`

---

## 1. Creative & Architectural Identity

**Paper-Wrapper Worlds (`The Pond Guardian`)** translates a real wooden shingle forest troll sculpture crouching beside a reflective woodland pond into an interactive **Three.js `r187` `WebGPURenderer` + `TSL` (`three/tsl`)** diorama on warm unbleached Washi/rag paper (`#f2ebd9`).

1. **Interactive Reveal Mask (`WashRevealController`)**:
   - Like the Three.js `webgpu_tsl_vfx_linkedparticles` / watercolor diorama reference, the entire 3D world emerges through a soft, feathered watercolor wash mask on warm archival rag paper.
   - Moving the pointer over the sculpture, trees, or pond blooms fresh pigment and fibrous paper detail along the cursor path (`uCursorWorld`, `uBrushRadius`) with organic FBM edge bleed and slow meditative relaxation.
   - Users can toggle between **Interactive Wash Reveal** (cursor blooms detail around the core vignette) and **Full Botanical Panorama** (complete scene unfolded).
2. **Tactile Paper-Cut & Cedar-Shingle Shader (`paperCraftShader.ts`)**:
   - All solid geometry (the crouching wooden shingle guardian, radially layered cedar collar, articulated plank arms and 5-splayed fingers, shoreline rocks, and multi-tiered woodland trunks/foliage) uses a custom TSL `MeshStandardNodeMaterial` combining:
     - **Sinuous Bast Fiber & Cold-Press Tooth**: Multi-octave irrational-angle FBM paper grain modulating surface normals and diffuse grazing light (`clamp(dot(N, L), 0.94, 1.06)`).
     - **Deckle-Edge & Crease Folding**: Subtle paper-fold ridge highlights on geometric edges and layered shingle overlapping shadows.
     - **Kubelka-Munk 2-Flux Pigment Glazes**: Physical film thickness $d$ enters $\coth(b S d)$ directly against the warm paper backing $R_g = (0.949, 0.922, 0.851)$—never flat digital alpha `mix(Rg, color, alpha)`.
3. **Layered Kubelka-Munk Watercolor Pond & Inverted Guardian Reflection (`watercolorPondShader.ts`)**:
   - The foreground pond is the visual centerpiece of the composition (matching the photograph's lower half):
     - **Mirrored Sculpture & Forest Canopy**: An explicit inverted reflection pass / mirrored shingle assembly beneath the water plane, perturbed horizontally and vertically by multi-frequency capillary ripples and pointer-triggered droplet waves.
     - **Multi-Layer Watercolor Glazes (*Bokusai-ga* / Botanical Washes)**: Layered olive-umbrous moss (`R_inf = (0.18, 0.22, 0.11)`), ochre leaf-litter tannins (`R_inf = (0.42, 0.31, 0.14)`), and sky-gap celadon/paper highlights (`#f2ebd9`) evaluated via Kubelka-Munk 2-flux transfer.
     - **Evaporative Contact-Line Pinning (*Fuchidori*)**: Darkened pigment rings along shoreline stones, submerged wooden fingers, and outer wash boundaries where the pond bleeds into raw paper.

---

## 2. WebGPU & TSL (`three/tsl`) Guardrails

1. **Canonical Three.js `r187` Imports**:
   - Always import `THREE` from `'three/webgpu'` and shader nodes from `'three/tsl'`.
   - Call `await renderer.init()` before starting `renderer.setAnimationLoop(...)`.
   - Use `THREE.Timer` instead of deprecated `THREE.Clock`.
2. **Uniform Control Flow in TSL `Fn()`**:
   - Never call implicit-LOD `texture(...)` or derivatives (`fwidth`, `dFdx`, `dFdy`) inside dynamic `If(...)` or `Loop(...)` blocks.
3. **Zero Per-Frame Allocations**:
   - Pre-allocate scratch `THREE.Vector3`, `THREE.Vector2`, `THREE.Matrix4`, `THREE.Color`, and `THREE.Raycaster` objects at module/class scope. Never allocate inside `setAnimationLoop`.
4. **Zero Synthetic Mathematical Tell-Tales**:
   - Never use polar star harmonics $\cos(m\theta)$ ($m \ge 3$) for brush blooms or water ripples. Use irrational-angle rotated FBM and physical radial wave dispersion.
   - Never use hardcoded `(0, 0)` shading vectors for ripples; evaluate ripples relative to actual pointer impact coordinates `(x_impact, z_impact)` and shoreline distance.
