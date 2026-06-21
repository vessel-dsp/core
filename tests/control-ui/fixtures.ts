import type { Panel } from '@vessel-dsp/core';

export const controlUiTestPanel: Panel = {
    placement: {
        faces: [
            {
                id: 'top',
                label: 'Top',
                layout: {
                    kind: 'stompbox-grid',
                    rows: 3,
                    columns: 2,
                    indexing: 'one-based',
                },
                elements: [
                    {
                        id: 'bypass-element',
                        kind: 'footswitch',
                        label: 'Bypass',
                        bind: { componentId: 'SW1', controlId: 'bypass' },
                        grid: { row: 3, column: 1 },
                    },
                    {
                        id: 'gain-element',
                        kind: 'knob',
                        label: 'Gain',
                        bind: { componentId: 'RGAIN', controlId: 'gain' },
                        grid: { row: 1, column: 1 },
                    },
                    {
                        id: 'mode-element',
                        kind: 'selector',
                        label: 'Mode',
                        bind: { componentId: 'RMODE', controlId: 'mode' },
                        grid: { row: 1, column: 2 },
                    },
                    {
                        id: 'eq-element',
                        kind: 'slider',
                        label: 'EQ',
                        bind: { componentId: 'REQ', controlId: 'eq' },
                        grid: { row: 2, column: 1 },
                    },
                    {
                        id: 'bright-element',
                        kind: 'switch',
                        label: 'Bright',
                        bind: { componentId: 'SW2', controlId: 'bright' },
                        grid: { row: 2, column: 2 },
                    },
                    {
                        id: 'status-element',
                        kind: 'led',
                        label: 'Status',
                        bind: { componentId: 'LED1', controlId: 'status' },
                        grid: { row: 3, column: 2 },
                    },
                ],
            },
        ],
    },
    knobs: [
        {
            id: 'gain',
            name: 'Gain',
            taper: 'linear',
            defaultPosition: 0.25,
        },
        {
            id: 'mode',
            name: 'Mode',
            taper: 'linear',
            controlMode: 'stepped',
            defaultPosition: 0.62,
            steps: [
                { index: 0, position: 0, label: 'Clean' },
                { index: 1, position: 0.5, label: 'Crunch' },
                { index: 2, position: 1, label: 'Lead' },
            ],
        },
    ],
    sliders: [
        {
            id: 'eq',
            name: 'EQ',
            defaultPosition: 0.5,
            orientation: 'vertical',
            range: {
                min: -12,
                max: 12,
                unit: 'dB',
                center: 0,
            },
        },
    ],
    switches: [
        {
            id: 'bypass',
            name: 'Bypass',
            switchKind: '3pdt',
            poles: 3,
            positions: 2,
            defaultPosition: 0,
        },
        {
            id: 'bright',
            name: 'Bright',
            switchKind: 'spdt',
            poles: 1,
            positions: 2,
            defaultPosition: 1,
        },
    ],
    leds: [
        {
            id: 'status',
            name: 'Status',
            color: 'red',
        },
    ],
    jacks: [],
};
