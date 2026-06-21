# @vessel-dsp/control-ui

React controls for rendering a VesselDSP `Panel` from `@vessel-dsp/core`.

`control-ui` is the optional browser layer. It does not parse `.vdsp`, run DSP,
own an audio runtime, render schematics, or import stompbox preview code.

## Install

```bash
npm install @vessel-dsp/core @vessel-dsp/control-ui react react-dom
```

Import the default CSS when you want the bundled styling:

```ts
import '@vessel-dsp/control-ui/styles.css';
```

## Controlled Surface

```tsx
import {
    ControlSurface,
    ControlUiThemeProvider,
    createControlUiState,
} from '@vessel-dsp/control-ui';
import { extractPanel, parseCircuitDocumentFile } from '@vessel-dsp/core';

const document = parseCircuitDocumentFile(vdspSource, { filename: 'pedal.vdsp' });
const panel = extractPanel(document);
const state = createControlUiState(panel);

export function PedalControls() {
    return (
        <ControlUiThemeProvider theme={{ accentColor: '#f59e0b' }}>
            <ControlSurface
                panel={panel}
                state={state}
                onMessage={(message) => {
                    audioRuntime.send(message);
                }}
            />
        </ControlUiThemeProvider>
    );
}
```

The surface emits core `PanelMessage` objects. The host app owns transport,
namespacing, and audio-engine routing.

## Styling

The package ships stable `vdsp-control-ui-*` class names and CSS variables.
Every component accepts `className` and `classNames` hooks, so apps can add
Tailwind or other utility classes without forking the controls:

```tsx
<ControlSurface
    panel={panel}
    state={state}
    className="grid-cols-4 gap-4"
    classNames={{
        control: 'shadow-sm',
        knob: 'ring-1 ring-slate-300',
        select: 'text-sm',
    }}
/>
```

Use `ControlUiThemeProvider` to theme a subtree through CSS custom properties.
The provider maps a small theme object to variables such as
`--vdsp-control-ui-accent-color`, `--vdsp-control-ui-control-color`, and
`--vdsp-control-ui-focus-ring-color`.
