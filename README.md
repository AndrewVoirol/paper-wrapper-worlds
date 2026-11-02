![The Pond Guardian — Paper & Watercolor WebGPU Diorama](screenshots/initial-state.webp)

# Paper-Wrapper Worlds — The Pond Guardian

An interactive **Three.js `r187` `WebGPURenderer` + `TSL` (`three/tsl`)** diorama translating a wooden shingle forest troll sculpture crouching beside a woodland pond into tactile cold-press paper shaders and multi-layer Kubelka-Munk watercolor washes.

## Quick Start

Requires Node.js `20+`.

```bash
git clone https://github.com/andrewvoirol/paper-wrapper-worlds.git
cd paper-wrapper-worlds
npm install
npm run dev
```

## Visual States & Camera Presets

| Pond Mirror (Default Framing) | Shingle Study (Close Portrait) |
| :---: | :---: |
| ![Pond Mirror](screenshots/initial-state.webp) | ![Shingle Study](screenshots/shingle-study.webp) |
| **Waterline Glaze (Bokusai Celadon)** | **Diorama Island (Late Sun Ochre)** |
| ![Waterline Glaze](screenshots/waterline-glaze.webp) | ![Diorama Island](screenshots/diorama-island.webp) |

## How It Works

- **Sweep to Bloom Watercolor Wash**: Move the cursor across the diorama to bloom pigment and paper fiber detail along the edge of the floating island, or switch between **Brush Wash Reveal** and **Full Panorama** in the studio drawer.
- **Drag to Orbit & Inspect**: Orbit 360° around the 778-shingle wooden guardian, or jump between 4 curated camera viewpoints (**Pond Mirror**, **Shingle Study**, **Waterline Glaze**, and **Diorama Island**) in the bottom dock.
- **Click the Pond to Cast Ripples**: Clicking or sweeping across the water surface spawns radial capillary-gravity waves that shear the inverted 3D reflection of the guardian and forest canopy below.

Under the hood, all solid geometry (the barrel-chested cedar-shingle torso, radially fanned russet neck ruff, furrowed V-brow head, articulated plank arms with 5 splayed shoreline fingers, limestone slabs, and woodland trees) is rendered in a single instanced TSL shader pipeline (`paperCraftShader.ts`). Pigment layers evaluate physical **Kubelka-Munk 2-flux radiative transfer** ($\coth(b S d)$) over warm unbleached Washi paper (`#f2ebd9`) with sinuous bast-fiber FBM grain and evaporative contact-line pinning (*Fuchidori* `縁取り`).

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Renderer** | Three.js `0.187.0` (`WebGPURenderer`) |
| **Shading Language** | Three Shading Language (`three/tsl`) |
| **UI Framework** | React `19.3` + Lucide Icons |
| **Build & Test** | Vite `8.3` + TypeScript `7.0` + Vitest `5.1` |
