---
date: 2026-06-27T17:51:11+01:00
researcher: Codex
git_commit: b8275e40332c7b2f96abe8c20c55a66015682eaa
branch: main
repository: circuit-preview-editor
topic: ".vdsp audioBinding Core Contract Handoff"
tags: [implementation, core, vdsp, control-binding, audio-engine]
status: complete
last_updated: 2026-06-27
last_updated_by: Codex
type: implementation_strategy
---

# Handoff: .vdsp audioBinding core contract

## Task(s)

Document why `deviceInterface.controls[].audioBinding` was added to
`@vessel-dsp/core`, what downstream bug it prevents, and what must be verified
before relying on a published package in audio-engine or artifacts tooling.

Status: core contract fixed and release metadata bumped to `0.6.7` in this
checkout. Core source, local `dist`, and the locally packed
`@vessel-dsp/core@0.6.7` tarball preserve `audioBinding` through
parse/serialize. Treat npm publish and downstream reinstall verification as the
remaining external steps before relying on the published package in
audio-engine or artifact tooling.

## Critical References

- `packages/core/src/model/types.ts:222` declares
  `DeviceInterfaceAudioBinding`.
- `packages/core/src/formats/interchange/parser.ts:1103` parses
  `deviceInterface.controls[].audioBinding`.
- `packages/core/src/formats/interchange/serializer.ts:250` serializes
  `deviceInterface.controls[].audioBinding`.
- `packages/core/src/model/validation.ts:1210` validates the binding kind and
  non-empty `controlName`.
- `tests/formats/interchange/parser.test.ts:229` covers round-trip fixture
  behavior.
- `packages/core/src/index.ts:1` exports `VERSION = "0.6.7"` and
  `DeviceInterfaceAudioBinding` from the public package entrypoint.
- `tests/model/validation.test.ts:938` covers invalid audio-binding validation.
- `tests/package.test.ts:825` pins the `0.6.7` package metadata and public
  declaration export.

## Recent Changes

Relevant changes in this checkout:

- `packages/core/src/model/types.ts:222` adds the portable
  `DeviceInterfaceAudioBinding` shape:
  `audioBinding: { kind: "control"; controlName: string }`.
- `packages/core/src/formats/interchange/parser.ts:1103` reads the YAML field
  into `DeviceInterfaceControl`.
- `packages/core/src/formats/interchange/serializer.ts:250` writes the field
  back out.
- `packages/core/src/model/validation.ts:1210` rejects unsupported binding kinds
  and blank runtime control names.
- `packages/core/src/index.ts:1` bumps the exported `VERSION` to `0.6.7` and
  publicly exports `DeviceInterfaceAudioBinding`.
- `packages/core/package.json:3`, `packages/stompbox/package.json:3`, and
  `packages/control-ui/package.json:3` bump the tied package release metadata to
  `0.6.7`; stompbox/control-ui now depend on `@vessel-dsp/core@0.6.7`.
- `CHANGELOG.md:3` documents the `.vdsp` `audioBinding` contract under
  `0.6.7`.
- `tests/package.test.ts:825` verifies the release metadata, compiled `VERSION`,
  and generated declaration export.

## Learnings

The root problem is that component identity is not the same as panel-control or
audio-control identity.

Some `.vdsp` pedals have one source-visible component exposing multiple user
controls. Examples seen downstream:

- Boss BD-2 Blues Driver Keeley Mod: `EQ1` exposes both `Level` and `Phat`.
- Klon Centaur: `U1` exposes both `Gain` and `Output`.

Without an explicit audio binding, downstream hosts may fall back to the bare
component id (`EQ1`, `U1`) or to loose label/id inference. That can make two
physical controls collapse into one source-panel identity. In audio-engine this
showed up as:

- a continuous Level control rendering as a stepped selector/dropdown because it
  inherited the neighboring Phat switch options;
- physical source labels such as HP/LP or source-only controls appearing instead
  of the intended playable audio control;
- host-specific alias tables in `signal-chain.ts`, which are brittle and should
  not be the source of truth.

`audioBinding` is runtime/control-plane metadata. It is not private provenance.
It belongs in portable `.vdsp` because any host that parses the document needs a
stable way to map the physical UI control to the playable runtime parameter.

The field intentionally stays small:

- `kind: "control"` says the target is a runtime/playable audio control.
- `controlName` names the runtime control exposed by the host/compiler program.

This lets source-facing labels remain faithful while the playable control plane
is explicit. For example:

- `EQ1:Level -> Level`
- `EQ1:Phat -> Phat`
- `U1:Gain -> Gain`
- `U1:Output -> Output`
- `BOOST -> Level`

## Artifacts

Produced or updated by this work:

- `thoughts/shared/handoffs/general/2026-06-27_17-51-11_vdsp-audio-binding-core-contract.md:1`
- `CHANGELOG.md:3`
- `bun.lock:39`
- `packages/core/src/index.ts:1`
- `packages/core/package.json:3`
- `packages/stompbox/package.json:3`
- `packages/control-ui/package.json:3`
- `tests/package.test.ts:825`

Related downstream files in audio-engine that motivated this contract:

- `/Users/josephcheng/Projects/audio-engine/src/web/App.tsx`
- `/Users/josephcheng/Projects/audio-engine/src/web/signal-chain.ts`
- `/Users/josephcheng/Projects/audio-engine/scripts/check-pedal-library.ts`
- `/Users/josephcheng/Projects/audio-engine/scripts/check-signal-chain.ts`
- `/Users/josephcheng/Projects/audio-engine/.agents/skills/artifact-manager/assets/fixtures/schematics/vessel-dsp/boss-bd-2-blues-driver-keeley-mod.vdsp`
- `/Users/josephcheng/Projects/audio-engine/.agents/skills/artifact-manager/assets/fixtures/schematics/vessel-dsp/klon-centaur.vdsp`

Related upstream artifact-housekeeper guidance:

- `/Users/josephcheng/Projects/artifacts/.agents/skills/housekeeper/SKILL.md`

## Action Items & Next Steps

1. Completed local core verification before publish:

   ```bash
   bun run --cwd packages/core build
   rg -n "audioBinding|DeviceInterfaceAudioBinding" packages/core/dist
   bun test tests/formats/interchange/parser.test.ts tests/model/validation.test.ts
   bun test tests/formats/interchange/parser.test.ts tests/model/validation.test.ts tests/package.test.ts
   bun run --cwd packages/core typecheck
   ```

2. Completed local tarball inspection for `vessel-dsp-core-0.6.7.tgz`; the
   tarball contains the rebuilt files and public declarations:

   ```bash
   bun run --cwd packages/core pack:dry-run
   npm pack --workspace packages/core
   tar -tf vessel-dsp-core-*.tgz | rg "dist/(model/types.d.ts|formats/interchange/parser.js|formats/interchange/serializer.js|model/validation.js)"
   tar -xOf vessel-dsp-core-*.tgz package/dist/model/types.d.ts | rg "DeviceInterfaceAudioBinding|audioBinding"
   tar -xOf vessel-dsp-core-*.tgz package/dist/formats/interchange/parser.js | rg "audioBinding"
   tar -xOf vessel-dsp-core-*.tgz package/dist/formats/interchange/serializer.js | rg "audioBinding"
   ```

3. Publish `@vessel-dsp/core@0.6.7` only after this branch is pushed and any
   required release workflow/tag is created.

4. In audio-engine, install the new version and run this direct acceptance check:

   ```bash
   bun --print 'import { parseCircuitDocumentFile, serializeCircuitDocumentFile } from "@vessel-dsp/core"; const source = `schema: circuit-interchange/v3\nmetadata:\n  name: T\n  description: ""\n  partNumber: ""\nsource: {}\ncomponents: []\nwires: []\ndeviceInterface:\n  controls:\n    - id: Level\n      label: Level\n      kind: knob\n      role: output-level\n      audioBinding:\n        kind: control\n        controlName: Level\ndirectives: []\ndiagnostics: []\nrawAttributes: {}`; const doc = parseCircuitDocumentFile(source, { filename: "t.vdsp" }); console.log(JSON.stringify(doc.deviceInterface?.controls[0])); console.log(serializeCircuitDocumentFile(doc, { format: "vdsp" }).includes("audioBinding"));'
   ```

   Expected result: the parsed control includes `audioBinding`, and the final
   line prints `true`.

5. Then run audio-engine downstream guards:

   ```bash
   bun scripts/check-pedal-library.ts
   bun run check:signal-chain
   bun run check:web
   ```

## Other Notes

Audio-engine currently has local fallback logic and corpus checks that protect
runtime behavior even when core drops `audioBinding`. That is useful as a host
guard, but it is not a substitute for core preserving the portable document
field. Any artifact tooling that parses and reserializes `.vdsp` through a stale
core package can silently remove the binding metadata and reintroduce ambiguous
source-panel controls.

The artifact-housekeeper skill was tightened to tell agents that panel control
identity must remain distinct from component identity, and that explicit
`audioBinding` is required for shared-component or label-mapped controls.
