# @vessel-dsp/player

Signal chain playback and DSP composition engine for VesselDSP.

## Install

```bash
bun add @vessel-dsp/player
```

## Usage

```ts
import { ChainPlayer } from "@vessel-dsp/player";
import { compile } from "@vessel-dsp/compiler";

const overdrive = compile(overdriveSource);
const player = new ChainPlayer(44100);

if (overdrive.status === "ok") {
  player.loadChain({
    slots: [
      { id: "od-1", name: "Overdrive", program: overdrive.program }
    ]
  });
}
```
