# @vessel-dsp/stompbox

Headless stompbox drill-layout and preview manifest helpers for `.vdsp`
documents parsed by `@vessel-dsp/core`.

This package does not render UI. It emits headless artifacts that downstream
tools can display or save:

- drill-layout manifests;
- drill-template SVG strings in `preview` and A4 `print` modes;
- mesh-backed stompbox preview GLB bytes assembled from bundled CAD part GLBs
  and STEP companions, or from a caller-provided `basePath`;
- orthographic preview SVG views for `top`, `bottom`, `left`, and `right`.
- optional text or SVG decals for brand/model/custom sticker artwork.

Drill-template holes are fabrication holes: their circle diameters come from
each part profile's panel drill clearance, such as the PJ-629HAN 9.5 mm drill
and the DC099 8 mm barrel opening. Preview views and collision checks may use
larger visible exterior geometry, such as jack rings, bushings, nuts, and
bezels.

When `.vdsp` physical placement is present, stompbox preserves it as
`vdsp-declared`. When placement or common enclosure hardware is absent, stompbox
generates deterministic `auto-generated` placements for knobs, status LED,
bypass footswitch, input/output jacks, and the 9V connector. Set
`includePowerJack: false` to omit the synthesized 9V connector.

Pass `decals` to preview or drill-template helpers to place custom text or SVG
artwork on the enclosure. Preview SVG views render the decal content on the box,
preview GLB output includes decal plane nodes with text/SVG metadata, drill
template preview mode shows only decal outlines, and A4 print mode places the
decals in a separate sticker sheet area.

## Helper map

Use `FromVdsp` helpers when the caller has serialized `.vdsp` text. Use the
document helpers when the caller has already parsed or edited a
`CircuitDocument`.

| Need | `.vdsp` helper | `CircuitDocument` helper |
| --- | --- | --- |
| Drill hole coordinates and diagnostics | `createStompboxDrillLayoutFromVdsp` | `createStompboxDrillLayout` |
| Drill-template manifest | `createStompboxDrillTemplateFromVdsp` | `createStompboxDrillTemplate` |
| Drill-template SVG string | `createStompboxDrillTemplateSvgFromVdsp` | `createStompboxDrillTemplateSvg` |
| Preview manifest | `createStompboxPreviewFromVdsp` | `createStompboxPreview` |
| Orthographic 2D SVG views | `createStompboxPreviewSvgViewsFromVdsp` | `createStompboxPreviewSvgViews` |
| Mesh-backed 3D GLB bytes | `createStompboxPreviewGlbFromVdsp` | `createStompboxPreviewGlb` |
| Frontend recolor patch | `createStompboxAppearancePatch` | `createStompboxAppearancePatch` |
| Resolved appearance alias | `resolveStompboxAppearance` | `resolveStompboxAppearance` |

Generated docs examples are published at:

- 2D preview SVG: `/core/examples/stompbox-mxr-style-preview-top.svg`
- 3D preview GLB: `/core/examples/stompbox-mxr-style-preview.glb`
- Drill-template preview SVG: `/core/examples/stompbox-mxr-style-drill-template-preview.svg`
- Drill-layout JSON: `/core/examples/stompbox-mxr-style-drill-layout.json`

## Appearance customization

Pass `appearance` to preview, GLB, SVG-view, or drill-template helpers to style
the generated artifacts without changing `.vdsp` placement data. `state` remains
for live values such as knob position, LED on/off, and footswitch pressed state;
`appearance` is for colors, label text, and material hints.

```ts
import {
  createStompboxAppearancePatch,
  createStompboxPreviewFromVdsp,
  createStompboxPreviewSvgViewsFromVdsp,
} from "@vessel-dsp/stompbox";

const appearance = {
  enclosure: { color: "#f97316", strokeColor: "#7c2d12", roughnessFactor: 0.45 },
  template: {
    guideColor: "#0ea5e9",
    foldColor: "#f97316",
    holeStrokeColor: "#7c3aed",
    holeFillColor: "#faf5ff",
    centerDotColor: "#581c87",
  },
  defaults: {
    knob: { color: "#111827", indicatorColor: "#f8fafc" },
    led: { color: "#ef4444", offColor: "#fee2e2" },
    label: { color: "#111827" },
  },
  controls: {
    GAIN: {
      knob: { color: "#facc15", indicatorColor: "#111827" },
      label: { text: "DRIVE", color: "#ffffff" },
    },
    LED1: {
      led: { color: "#22c55e", offColor: "#064e3b" },
      label: { text: "READY", color: "#16a34a" },
    },
  },
} as const;

const preview = createStompboxPreviewFromVdsp(vdspSource, { appearance });
const views = createStompboxPreviewSvgViewsFromVdsp(vdspSource, { appearance });
const patch = createStompboxAppearancePatch(preview);
```

Preview SVG output includes stable hooks such as `data-control-id`,
`data-part-family`, `.knob-body`, `.knob-indicator`, `.led-lens`, `.label-text`,
`.top-panel`, `.hole`, `.drill-hole-center-dot`, `.fold-line`, and
`.guide-line`. Preview GLB output bakes available material colors into copied
GLB materials and writes the same frontend-friendly patch into
`asset.extras.appearance`.
