import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function importDist(path) {
    return import(pathToFileURL(resolve(path)).href);
}

const core = await importDist('packages/core/dist/index.js');
const stompbox = await importDist('packages/stompbox/dist/index.js');

if (typeof core.parseCircuitDocument !== 'function') {
    throw new Error('packages/core/dist/index.js does not export parseCircuitDocument');
}

if (typeof core.serializeCircuitJsonDocument !== 'function') {
    throw new Error('packages/core/dist/index.js does not export serializeCircuitJsonDocument');
}

if (typeof core.parseCircuitJsonDocument !== 'function') {
    throw new Error('packages/core/dist/index.js does not export parseCircuitJsonDocument');
}

if (typeof core.serializeLtspiceAsc !== 'function') {
    throw new Error('packages/core/dist/index.js does not export serializeLtspiceAsc');
}

if (typeof core.convertCircuitDocumentFile !== 'function') {
    throw new Error('packages/core/dist/index.js does not export convertCircuitDocumentFile');
}

if ('SchematicView' in core) {
    throw new Error('packages/core/dist/index.js must stay headless and not export SchematicView');
}

if (typeof stompbox.createStompboxDrillLayoutFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxDrillLayoutFromVdsp');
}

if (typeof stompbox.createStompboxPreviewFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxPreviewFromVdsp');
}

if (typeof stompbox.createStompboxDrillTemplateFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxDrillTemplateFromVdsp');
}

if (typeof stompbox.createStompboxDrillTemplateSvgFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxDrillTemplateSvgFromVdsp');
}

if (typeof stompbox.createStompboxPreviewGlbFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxPreviewGlbFromVdsp');
}

if (typeof stompbox.createStompboxPreviewSvgViewsFromVdsp !== 'function') {
    throw new Error('packages/stompbox/dist/index.js does not export createStompboxPreviewSvgViewsFromVdsp');
}

if ('SchematicView' in stompbox || 'StompboxView' in stompbox) {
    throw new Error('packages/stompbox/dist/index.js must stay headless and not export UI views');
}

console.log('dist entrypoints ok');
