import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  generateGuardianShingles,
  buildGuardianSculptedSheetGeometry,
} from '../scene/buildShingleGuardian';
import {
  createCreasedPaperStripGeometry,
  createSculptedPaperTrunkGeometry,
  createFoldedPaperLimbGeometry,
  createFoldedPaperLeafGeometry,
  createOrigamiFloatingLeafGeometry,
} from '../shaders/paperCraftShader';
import { CAMERA_PRESETS, PALETTE_PRESETS, DEFAULT_PARAMS, STORY_PLATES } from '../types';
import { App } from '../App';

describe('Paper-Wrapper Worlds — Guardian Sculpture & Optical Preset Contracts', () => {
  it('generates deterministic cedar shingle placements covering torso, warm collar, head, arms, 5 fingers & feet', () => {
    const shinglesA = generateGuardianShingles();
    const shinglesB = generateGuardianShingles();

    expect(shinglesA.length).toBeGreaterThan(550);
    expect(shinglesA.length).toBe(shinglesB.length);

    // Verify deterministic reproducibility
    for (let i = 0; i < 25; i++) {
      expect(shinglesA[i].position.x).toBeCloseTo(shinglesB[i].position.x, 6);
      expect(shinglesA[i].position.y).toBeCloseTo(shinglesB[i].position.y, 6);
      expect(shinglesA[i].position.z).toBeCloseTo(shinglesB[i].position.z, 6);
      expect(shinglesA[i].warmCollarMix).toBeCloseTo(shinglesB[i].warmCollarMix, 6);
    }

    // Verify presence of warm russet collar shingles (warmCollarMix > 0.7)
    const collarShingles = shinglesA.filter((s) => s.warmCollarMix > 0.7);
    expect(collarShingles.length).toBeGreaterThan(60);

    // Verify left & right splayed shoreline hands extend past |x| > 1.1 near water level (y < 0.25, z > 0.2)
    const leftHandFingers = shinglesA.filter(
      (s) => s.position.x < -1.05 && s.position.y < 0.22 && s.position.z > 0.25
    );
    const rightHandFingers = shinglesA.filter(
      (s) => s.position.x > 1.05 && s.position.y < 0.22 && s.position.z > 0.25
    );
    expect(leftHandFingers.length).toBeGreaterThanOrEqual(10);
    expect(rightHandFingers.length).toBeGreaterThanOrEqual(10);
  });

  it('maintains valid camera presets above the paper plane and physically bounded Kubelka-Munk palettes', () => {
    expect(CAMERA_PRESETS.length).toBe(4);
    for (const preset of CAMERA_PRESETS) {
      // Every camera preset must stay cleanly above the water plane (y > 0.5)
      expect(preset.position[1]).toBeGreaterThan(0.5);
      expect(preset.fov).toBeGreaterThanOrEqual(30);
      expect(preset.fov).toBeLessThanOrEqual(50);
    }

    expect(PALETTE_PRESETS.length).toBe(3);
    for (const pal of PALETTE_PRESETS) {
      for (const ch of pal.paperBackingRGB) {
        expect(ch).toBeGreaterThan(0.8);
        expect(ch).toBeLessThan(1.0);
      }
      for (const ch of pal.pondDeepMossRGB) {
        expect(ch).toBeGreaterThan(0.05);
        expect(ch).toBeLessThan(0.6);
      }
      for (const ch of [...pal.skyZenithRGB, ...pal.skyHorizonRGB]) {
        expect(ch).toBeGreaterThan(0.1);
        expect(ch).toBeLessThan(0.95);
      }
    }

    expect(DEFAULT_PARAMS.paletteId).toBe('autumn-tannin');
    expect(DEFAULT_PARAMS.paperTooth).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.watercolorBleed).toBeGreaterThan(0);
  });

  it('builds non-indexed flat-faceted paper geometries with explicit per-card aCardCoord attributes', () => {
    for (const geom of [
      createCreasedPaperStripGeometry(),
      createSculptedPaperTrunkGeometry(),
      createFoldedPaperLimbGeometry(),
      createFoldedPaperLeafGeometry(),
      createOrigamiFloatingLeafGeometry(),
      buildGuardianSculptedSheetGeometry(),
    ]) {
      expect(geom.index).toBeNull();
      const pos = geom.getAttribute('position');
      const norm = geom.getAttribute('normal');
      const card = geom.getAttribute('aCardCoord');
      expect(pos).toBeDefined();
      expect(norm).toBeDefined();
      expect(card).toBeDefined();
      expect(card.itemSize).toBe(2);
      expect(card.count).toBe(pos.count);
    }
  });

  it('renders the locked single-edition Little Nis Bernheim Forest folio with zero sliders, pills, or debug jargon', () => {
    expect(STORY_PLATES.length).toBe(5);
    const presetIds = new Set(CAMERA_PRESETS.map((p) => p.id));
    for (const plate of STORY_PLATES) {
      expect(presetIds.has(plate.presetId)).toBe(true);
      expect(plate.desktopOffset[0]).toBeLessThan(0); // Shifts 3D subject into right stage on wide screens
    }

    const html = renderToStaticMarkup(React.createElement(App));

    // Zero range sliders or debug telemetry / shader jargon in user-facing UI
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('Kubelka-Munk');
    expect(html).not.toContain('Paper &amp; Glaze Studio');
    expect(html).not.toContain('The Pond Guardian');

    // Authentic Little Nis & Bernheim Forest, Kentucky story arc & colophon provenance
    expect(html).toContain('Little Nis');
    expect(html).toContain('Bernheim Forest');
    expect(html).toContain('Holly Pond');
    expect(html).toContain('Thomas Dambo');
    expect(html).toContain('While the Weather Got Better');
    expect(html).toContain('Pieced from Forgotten Wood');
    expect(html).toContain('Hands on the Mossy Bank');
    expect(html).toContain('Familiar, Yet So Strange');
    expect(html).toContain('Settle Holly Pond');
    expect(html).toContain('Back to Trailhead');
  });
});
