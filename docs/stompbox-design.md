# Stompbox Package Design Specification

## Overview

`@vessel-dsp/stompbox` is a headless companion library that converts `.vdsp` / `CircuitDocument` panel and enclosure data into physical stompbox drill layouts, 2D preview SVGs, A4 print template SVGs, and assembled 3D preview GLBs.

## Architectural Boundaries

- `@vessel-dsp/core` parses, validates, serializes, and preserves `.vdsp` schema data.
- `@vessel-dsp/stompbox` consumes core `CircuitDocument` panel elements, auto-generates missing physical hardware/placements, and emits layout artifacts.
- UI stays downstream: `@vessel-dsp/stompbox` produces headless artifact data (SVG strings, GLB binary arrays, layout manifests) and does not import React, Three.js, browser canvas, or simulator engines.

## Physical Placement & Hardware Synthesis

1. **Declared vs. Auto-Generated Placement**:
   - When `panel.faces[].elements[].physical` is present in `.vdsp`, stompbox preserves it and tags provenance as `vdsp-declared`.
   - When physical placement is absent, stompbox generates placement automatically and tags provenance as `auto-generated`.

2. **Hardware Synthesis**:
   - Schematic documents often describe only circuit components and controls.
   - `@vessel-dsp/stompbox` synthesizes standard mechanical hardware:
     - Input and output audio jacks (left/right or top faces)
     - Bypass footswitch (3PDT/SPST)
     - Status LED indicator
     - 9V DC power jack (default enabled; explicitly disabled with `includePowerJack: false`)

3. **Part & Enclosure Profiles**:
   - Enclosure geometries (defaulting to Hammond 1590B, supporting 125B, 1590BB, etc.) define inner/outer boundaries, wall thickness, and face orientations.
   - Part profiles define drill hole diameters, clearance envelopes, asset GLB references, and control actuation bounds.

## Public Artifact Outputs

- **Drill Layout Manifest**:
  - Hole coordinates, drill diameters, target enclosure faces, labels, bound IDs, profile IDs, asset references, provenance, and validation diagnostics.
- **Drill Template SVG**:
  - `preview` mode: Lightweight SVG for web/UI display.
  - `print` mode: 1:1 scale A4 SVG with calibration marks, crosshairs, and cut lines for physical fabrication.
- **Stompbox Preview GLB**:
  - Assembles enclosure mesh and component part GLBs into a single self-contained binary GLB.
  - Applies transform matrices, pot/knob rotational states, footswitch travel, and LED illumination states.
- **2D Preview SVG**:
  - Orthographic projection views for `top`, `bottom`, `left`, `right`, `front`, and `back` faces.
