import * as THREE from "three";
export type VesselPreviewEffectPreset = Readonly<{
    schema: "vessel-preview-effects/v1";
    toon?: boolean;
    toonEdgeColor?: string;
    grain?: boolean;
    grainScale?: number;
    grainIntensity?: number;
    glitch?: boolean;
    glitchIntervalSeconds?: number;
    crt?: boolean;
    crtCurvature?: number;
    crtScanlineIntensity?: number;
    crtScanlineCount?: number;
    crtVignette?: number;
    crtRgbShift?: number;
    crtFlicker?: number;
    crtBrightness?: number;
    crtContrast?: number;
    crtSaturation?: number;
    crtBloomIntensity?: number;
    crtBloomThreshold?: number;
    reducedMotion?: boolean;
}>;
export type ResolvedVesselPreviewEffectPreset = Readonly<{
    schema: "vessel-preview-effects/v1";
    toon: boolean;
    toonEdgeColor: string;
    grain: boolean;
    grainScale: number;
    grainIntensity: number;
    glitch: boolean;
    glitchIntervalSeconds: number;
    crt: boolean;
    crtCurvature: number;
    crtScanlineIntensity: number;
    crtScanlineCount: number;
    crtVignette: number;
    crtRgbShift: number;
    crtFlicker: number;
    crtBrightness: number;
    crtContrast: number;
    crtSaturation: number;
    crtBloomIntensity: number;
    crtBloomThreshold: number;
    reducedMotion: boolean;
}>;
export type VesselGlitchPass = Readonly<{
    kind: "vessel-glitch-pass";
    enabled: boolean;
    intervalSeconds: number;
    preset: ResolvedVesselPreviewEffectPreset;
}>;
export type VesselScreenGrainPass = Readonly<{
    kind: "vessel-screen-grain-pass";
    enabled: boolean;
    grainScale: number;
    grainIntensity: number;
    preset: ResolvedVesselPreviewEffectPreset;
}>;
export type VesselPreviewCrtBackground = Readonly<{
    enabled: boolean;
    backgroundColor: string;
    gridColor: string;
    gridOpacity: number;
    gridSizePx: number;
    gridLineWidthPx: number;
}>;
export type VesselPreviewEffectPipeline = Readonly<{
    kind: "vessel-preview-effect-pipeline";
    preset: ResolvedVesselPreviewEffectPreset;
    materialPreset: ResolvedVesselPreviewEffectPreset;
    screenPreset: ResolvedVesselPreviewEffectPreset;
    crtBackground: VesselPreviewCrtBackground;
    crtFragmentShader: (fragmentShader: string) => string;
}>;
export declare const VESSEL_PREVIEW_EFFECT_DEFAULTS: ResolvedVesselPreviewEffectPreset;
export declare function resolvePreviewEffectPreset(input: VesselPreviewEffectPreset | undefined): ResolvedVesselPreviewEffectPreset;
export declare function applyToonMaterials(root: THREE.Object3D, presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset): THREE.Object3D;
export declare function addToonOutlines(root: THREE.Object3D, presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset): THREE.Object3D;
export declare function applyMaterialGrain(root: THREE.Object3D, presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset): THREE.Object3D;
export declare function createGlitchPass(presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset): VesselGlitchPass;
export declare function createScreenGrainPass(presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset): VesselScreenGrainPass;
export declare function createPreviewEffectPipeline(presetInput: VesselPreviewEffectPreset | ResolvedVesselPreviewEffectPreset, options?: {
    crtBackground?: Partial<VesselPreviewCrtBackground>;
}): VesselPreviewEffectPipeline;
//# sourceMappingURL=index.d.ts.map