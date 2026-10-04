# @vessel-dsp/player

Embeddable browser player shell for VesselDSP circuits: a `<vessel-player>`
custom element over a DOM-free `PlayerController` state machine, with blog
input / NAM / IR source lists, control forwarding, and telemetry passthrough.
The shell owns no audio path itself: the page registers an engine factory and
every controller on the page uses it. It depends on `@vessel-dsp/chain`,
`@vessel-dsp/compiler`, `@vessel-dsp/core`, and `@vessel-dsp/runtime`.

## Install

`@vessel-dsp/player` 0.2.1 is on npm (0.1.1 pulled the broken runtime 0.2.0 through chain 0.1.0; 0.1.x has no real engine, use 0.2.1 or later):

```bash
bun add @vessel-dsp/player
```

## Usage

Drop the element on a page and point it at a `.vdsp` source plus JSON source
lists. `src` is the circuit, `inputs`/`nam`/`ir` are pickable sources, and
`fallback` is the blog audio played when the browser has no player engine:

```html
<vessel-player
  src="/circuits/big-muff-pi.vdsp"
  inputs='[{"id":"di","label":"DI Guitar","src":"/audio/di.wav"}]'
  nam='[{"id":"jcm800","label":"JCM800","src":"/models/jcm800.nam"}]'
  ir='[{"id":"v30","label":"Vintage 30","src":"/irs/v30.wav"}]'
  fallback="/audio/big-muff-pi.mp3"
></vessel-player>
```

Every `src` in those lists passes the same safety check: http(s) absolute
URLs plus same-origin relative URLs only. `javascript:`, `data:`, `blob:`,
`file:`, protocol-relative URLs, and anything with control characters or
backslashes is refused, and an unsafe entry fails the whole list with a
closed reason (`unsafe-src`, `not-json`, `not-array`, `item-not-object`,
`missing-id-or-label-or-src`, `duplicate-id`). The check is DOM-free, so it
runs anywhere:

```ts
import { isSafeSrc, parseSourceList } from "@vessel-dsp/player";

console.log(isSafeSrc("/audio/di-guitar.wav"));
console.log(isSafeSrc("javascript:alert(1)"));
console.log(JSON.stringify(parseSourceList('[{"id":"di","label":"DI Guitar","src":"/audio/di.wav"}]')));
console.log(JSON.stringify(parseSourceList("not json")));
```

```text
true
false
{"items":[{"id":"di","label":"DI Guitar","src":"/audio/di.wav"}]}
{"reason":"not-json"}
```

## Controller

`PlayerController` is the DOM-free state machine the element wraps; tests and
non-DOM hosts drive it directly. States are `idle` (no src yet), `loading`,
`ready`, `playing`, `fallback` (no audio path), and `error`. `play()` must be
called from a user gesture. Selections (`selectInput`, `selectNam`,
`selectIr`), `setControl(id, value)`, and `pause()` are refused with typed
`PlayerError` reasons (`no-engine`, `engine-unavailable`, `not-ready`,
`unknown-input`, `unknown-nam`, `unknown-ir`, `unknown-control`,
`invalid-control-value`, `load-failed`, `engine-error`, `disposed`) — compare
`reason`, never the message text. `settled()` resolves when the controller
leaves loading; `dispose()` releases the engine.

The engine itself is registered per page with `setEngineFactory(factory)`
(read it back with `getEngineFactory()`); pass null to unregister. With no
factory registered the controller takes the fallback path and playback needs
the blog fallback audio. There is no real engine in 0.1.0: production pages
leave the factory unset, and the element renders the fallback.

## NAM models

A NAM source entry has the same shape as every other source list entry --
`{ id, label, src }`, where `id` may be omitted and is then derived as
`source-<index>` -- and its `src` passes the same safety check (http(s)
absolute URLs plus same-origin relative URLs only):

```html
<vessel-player nam='[{"id":"jcm800","label":"JCM800","src":"/models/jcm800.nam"}]'></vessel-player>
```

```ts
import { loadNam, NAM_SAMPLE_RATE_TOLERANCE_HZ } from "@vessel-dsp/player";

const info = await loadNam("/models/jcm800.nam", context.sampleRate, {
  fetch: (...args) => fetch(...args),
  probe: (modelText) => chainProbe(modelText), // built from @vessel-dsp/chain 0.1.3: loadNamModel + _nam_getExpectedSampleRate, as NamNode.getInfo() reports
});
console.log(info.expectedSampleRate);
```

`loadNam(src, contextSampleRate, { fetch, probe })` fetches the `.nam` URL,
reads the model's stated rate through the chain NAM engine boundary (the
player never parses the model JSON itself), and compares it to the context
rate. A model stating no rate is accepted at any rate. Nothing resamples a
model: a stated rate differing by more than
`NAM_SAMPLE_RATE_TOLERANCE_HZ` (0.5 Hz, mirroring chain `NamNode`) refuses
instead. All failures throw `NamLoadError`; compare `reason` as a whole
value, never the message text:

| reason | meaning | carries |
|---|---|---|
| `unsafe-src` | src fails the source-list safety check; fetch is never called | `src` |
| `network-or-cors` | fetch or the body read rejected | `src` |
| `http-status` | non-ok response | `src`, `status` |
| `nam-load-failed` | the engine refused the model text; the message is the engine's own text verbatim | `src` |
| `rate-mismatch` | stated rate differs from the context rate | `src`, `expectedSampleRate`, `contextSampleRate` |

Wire validation into the controller with the `namLoader` option (or
`setNamLoader` later), closing over the page's rate -- typically
`(src) => loadNam(src, context.sampleRate, { fetch, probe })`. With a loader
set, `selectNam(id)` validates first and returns a promise: success forwards
to the engine and emits the selection event as before, while a refusal
rejects with a `PlayerError` of the same reason (rates and status carried
over) and touches nothing -- no engine call, no selection change, no state
change, so the controller stays ready for another pick. Unknown ids still
throw synchronously with `unknown-nam` before the loader runs, and
`selectNam(null)` clears synchronously without calling the loader. Without a
loader, `selectNam` forwards synchronously and only `unknown-nam` can fail.
The `PlayerEngine` seam is unchanged: validation happens before the existing
`setNam`, so fakes written against it keep working.

## Real engine (`@vessel-dsp/player/engine`)

The headless shell above plays nothing by itself. For live audio, import
the opt-in subpath (never the main barrel -- the barrel stays SSR-safe and
lean) and register once per page:

```ts
import { registerPlayerEngine } from "@vessel-dsp/player/engine";

registerPlayerEngine();
```

With no arguments the engine compiles the element's `.vdsp` in the page
(via `@vessel-dsp/compiler`), runs one program slot plus an optional NAM
plus an optional IR inside the player's AudioWorklet on the WASM console,
and gates every start with the runtime's admission check: a circuit that
cannot be shown to fit in real time is refused with a typed
`PlayerError` (`admission-refused`, naming the block and the numbers),
never played glitching. Telemetry (`cpuLoad`, `overruns`) flows through
the existing opaque telemetry seam; controls report at program defaults in
`[0, 1]` and forward with `setControl`.

Order matters for static HTML: register the engine factory BEFORE the
element module is evaluated. The element self-registers at import, and
parser-created elements upgrade synchronously at `define()` time, reading
the factory once -- an element upgraded before any factory exists keeps a
fallback controller. So `import "@vessel-dsp/player/engine"` (and call
`registerPlayerEngine`) strictly before `import "@vessel-dsp/player"`,
or create elements dynamically after registering. Framework renderers
that create elements after module evaluation satisfy this naturally.

Lazy boundary, precisely: circuit-text fetch plus compile run at `load()`
so `ready` and the control list precede any gesture (otherwise `play()`
could never leave `loading`). Everything audio -- `AudioContext` (48 kHz
preferred, device rate accepted), the worklet module, both wasm binaries,
input bytes, NAM text, and IR bytes -- waits for the first `play()`
gesture. NAM-engine bytes are fetched only when a NAM is selected.

### Options

Every URL is independently overridable; unset entries resolve against the
package's own shipped files via `import.meta.url`:

| option | default | meaning |
|---|---|---|
| `workletUrl` | player `dist/worklet/player-worklet.js` | `addModule` target |
| `dspWasmUrl` | player `dist/wasm/v2_dsp.wasm` | pedal console binary (posted as bytes) |
| `namWasmUrl` | player `dist/wasm/nam-engine.wasm` | NAM binary, fetched only with a NAM |
| `namGlueUrl` | player `dist/wasm/nam-engine-glue.js` | NAM glue, dynamic-imported only with a NAM |
| `program` | unset (fetch + compile `src`) | precompiled Program (object or JSON) to skip compiling |
| `inputs` | unset (silent until picked) | WAV list; the default input is the first entry |
| `inputGainDb` | `0` | input trim, changeable later with `setInputGainDb` |
| `micDeviceId` | unset | `deviceId` for the browser-audio input |
| `probeNam` | built lazily from chain | injected NAM rate probe (tests) |
| `onEngine` | unset | host hook receiving each created engine (meters, proof taps) |

### Next.js usage

Proven against a real production build: Next.js 16.2.10 (Turbopack) `next
build` succeeds with no `fs` stub, no webpack config, and no bundler plugin
-- the page bundle never imports the node-flavoured wasm glue, because the
admission cost is timed inside the worklet -- which bundles the wasm glue
statically with its node-only branch stubbed and loads by URL, never
through the page bundle -- so the page bundle never imports the
node-flavoured glue and no stub or bundler plugin is needed. Requires the release train that
carries the worklet exports (`postV2WorkletMessage` -- newer than runtime
0.2.3 on npm, which lacks it): upgrade runtime first, then chain, then
player, so every package resolves the exports it imports.

`node_modules` is not served, and `new URL(..., import.meta.url)` points
into it, so copy the four served files to `public/` (or a CDN) and pass
overrides. With `app/` router, register in a client component:

```bash
# once per build (paths inside @vessel-dsp/player's dist/)
cp node_modules/@vessel-dsp/player/dist/worklet/player-worklet.js public/vessel-player-worklet.js
cp node_modules/@vessel-dsp/player/dist/wasm/v2_dsp.wasm public/vessel-v2_dsp.wasm
cp node_modules/@vessel-dsp/player/dist/wasm/nam-engine.wasm public/vessel-nam-engine.wasm
cp node_modules/@vessel-dsp/player/dist/wasm/nam-engine-glue.js public/vessel-nam-engine-glue.js
```

```tsx
"use client";
import { useEffect } from "react";
import { registerPlayerEngine } from "@vessel-dsp/player/engine";
import "@vessel-dsp/player"; // registers <vessel-player> (import engine first)

export function Player() {
  useEffect(() => {
    registerPlayerEngine({
      workletUrl: "/vessel-player-worklet.js",
      dspWasmUrl: "/vessel-v2_dsp.wasm",
      namWasmUrl: "/vessel-nam-engine.wasm",
      namGlueUrl: "/vessel-nam-engine-glue.js",
    });
  }, []);
  return <vessel-player src="/circuits/my-pedal.vdsp" />;
}
```

Serve `.wasm` as `application/wasm`; no COOP/COEP headers are needed
(single-threaded builds). The wasm bytes are fetched as `arrayBuffer`, never
streaming-compiled, so the MIME type is not load-bearing, but serve it
correctly anyway. Blog-supplied NAM/IR/WAV URLs are fetched by the
page, so cross-origin entries need `Access-Control-Allow-Origin`;
same-origin assets need nothing. When WebAssembly or AudioWorklet is
missing, the factory refuses with `no-webassembly` / `no-audioworklet`
and the element renders the `fallback` mp3 instead.

Admission on a real page: every start is gated by the cost measured on the
device itself (in-worklet timing plus NAM/IR extras against a quarter of the sample
period, `ADMISSION_CPU_FRACTION`). A circuit that cannot be shown to fit is refused with a typed
`admission-refused` error naming the measured numbers -- never played
glitching. The measurement is load-sensitive (about ±40% observed between
idle and loaded runs on one box), so a marginal pedal may play on an idle
machine and refuse under load; that refusal is the gate working, not a bug.
Heavy pedals belong behind this gate, not around it.
