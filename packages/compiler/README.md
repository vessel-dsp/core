# @vessel-dsp/compiler

Circuit compiler turning `.vdsp` / `CircuitDocument` schematic data into compiled simulation `Program` ROMs for VesselDSP.

## Install

```bash
bun add @vessel-dsp/compiler
```

## Usage

```ts
import { compile, emptyRegistry } from "@vessel-dsp/compiler";

const result = compile(vdspSourceText, { registry: emptyRegistry });

if (result.status === "ok") {
  console.log("Compiled program blocks:", result.program.blocks.length);
} else {
  console.error("Compilation refused:", result.reasons);
}
```
