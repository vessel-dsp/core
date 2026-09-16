# @vessel-dsp/runtime

Real-time audio simulation runtime and solver console for compiled VesselDSP `Program` ROMs.

## Install

```bash
bun add @vessel-dsp/runtime
```

## Usage

```ts
import { ReferenceRuntime, admissionVerdict } from "@vessel-dsp/runtime";
import { compile } from "@vessel-dsp/compiler";

const compiled = compile(vdspSource);
if (compiled.status === "ok") {
  const runtime = new ReferenceRuntime(compiled.program, 44100);
  const inputBuffer = new Float32Array(128);
  const outputBuffer = new Float32Array(128);
  runtime.process(inputBuffer, outputBuffer);
}
```
