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
