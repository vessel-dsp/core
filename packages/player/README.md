# @vessel-dsp/player

Embeddable browser player shell for VesselDSP circuits: a `<vessel-player>`
custom element over a DOM-free `PlayerController` state machine, with blog
input / NAM / IR source lists, control forwarding, and telemetry passthrough.
The shell owns no audio path itself: the page registers an engine factory and
every controller on the page uses it. It depends on `@vessel-dsp/chain`,
`@vessel-dsp/compiler`, `@vessel-dsp/core`, and `@vessel-dsp/runtime`.

## Install

`@vessel-dsp/player` 0.1.4 is on npm (0.1.1 pulled the broken runtime 0.2.0 through chain 0.1.0; use 0.1.4):

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
