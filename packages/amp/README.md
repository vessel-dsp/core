# @vessel-dsp/amp

Generated amplifier preview helpers for VesselDSP profile data.

The package accepts a small amp profile with brand, model, enclosure color,
dimensions, and a control panel, then creates deterministic layout data,
a Three.js object graph, and a GLB preview payload.

Use `createAmpProfileFromVdsp()` or `createAmpProfileFromDocument()` when you
want a generated/defaulted amp profile from existing `.vdsp` panel controls.
Pass amp-specific dimensions, colors, and appearance options from the host app
when the source document does not carry visual design intent.

Shared preview effects are delegated to `@vessel-dsp/visual-effects`.
