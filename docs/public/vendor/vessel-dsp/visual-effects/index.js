import * as THREE from "three";
const DEFAULT_TOON_OUTLINE_SCALE = 1.035;
const DEFAULT_CRT_BACKGROUND = {
    enabled: false,
    backgroundColor: "#091833",
    gridColor: "#cccccc",
    gridOpacity: 0.3,
    gridSizePx: 24,
    gridLineWidthPx: 1,
};
export const VESSEL_PREVIEW_EFFECT_DEFAULTS = {
    schema: "vessel-preview-effects/v1",
    toon: false,
    toonEdgeColor: "#69145a",
    grain: false,
    grainScale: 1.15,
    grainIntensity: 0.1,
    glitch: false,
    glitchIntervalSeconds: 8,
    crt: false,
    crtCurvature: 0.15,
    crtScanlineIntensity: 0.2,
    crtScanlineCount: 500,
    crtVignette: 0.75,
    crtRgbShift: 1,
    crtFlicker: 0.05,
    crtBrightness: 1,
    crtContrast: 0.95,
    crtSaturation: 0.96,
    crtBloomIntensity: 0.5,
    crtBloomThreshold: 0.75,
    reducedMotion: false,
};
export function resolvePreviewEffectPreset(input) {
    const reducedMotion = input?.reducedMotion ?? VESSEL_PREVIEW_EFFECT_DEFAULTS.reducedMotion;
    const glitch = (input?.glitch ?? VESSEL_PREVIEW_EFFECT_DEFAULTS.glitch) &&
        !reducedMotion;
    return {
        schema: "vessel-preview-effects/v1",
        toon: input?.toon ?? VESSEL_PREVIEW_EFFECT_DEFAULTS.toon,
        toonEdgeColor: nonEmptyText(input?.toonEdgeColor) ??
            VESSEL_PREVIEW_EFFECT_DEFAULTS.toonEdgeColor,
        grain: input?.grain ?? VESSEL_PREVIEW_EFFECT_DEFAULTS.grain,
        grainScale: positiveNumber(input?.grainScale, VESSEL_PREVIEW_EFFECT_DEFAULTS.grainScale),
        grainIntensity: unitInterval(input?.grainIntensity, VESSEL_PREVIEW_EFFECT_DEFAULTS.grainIntensity),
        glitch,
        glitchIntervalSeconds: positiveNumber(input?.glitchIntervalSeconds, VESSEL_PREVIEW_EFFECT_DEFAULTS.glitchIntervalSeconds),
        crt: input?.crt ?? VESSEL_PREVIEW_EFFECT_DEFAULTS.crt,
        crtCurvature: unitInterval(input?.crtCurvature, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtCurvature),
        crtScanlineIntensity: unitInterval(input?.crtScanlineIntensity, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtScanlineIntensity),
        crtScanlineCount: positiveNumber(input?.crtScanlineCount, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtScanlineCount),
        crtVignette: unitInterval(input?.crtVignette, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtVignette),
        crtRgbShift: unitInterval(input?.crtRgbShift, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtRgbShift),
        crtFlicker: unitInterval(input?.crtFlicker, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtFlicker),
        crtBrightness: nonNegativeNumber(input?.crtBrightness, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBrightness),
        crtContrast: nonNegativeNumber(input?.crtContrast, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtContrast),
        crtSaturation: nonNegativeNumber(input?.crtSaturation, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtSaturation),
        crtBloomIntensity: nonNegativeNumber(input?.crtBloomIntensity, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBloomIntensity),
        crtBloomThreshold: unitInterval(input?.crtBloomThreshold, VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBloomThreshold),
        reducedMotion,
    };
}
export function applyToonMaterials(root, presetInput) {
    const preset = resolvePresetLike(presetInput);
    if (!preset.toon) {
        return root;
    }
    root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
            return;
        }
        object.material = Array.isArray(object.material)
            ? object.material.map((material) => toonMaterialFor(material, preset))
            : toonMaterialFor(object.material, preset);
        object.userData = {
            ...object.userData,
            visualEffects: {
                ...(object.userData.visualEffects ?? {}),
                toon: true,
                toonEdgeColor: preset.toonEdgeColor,
            },
        };
    });
    return root;
}
export function addToonOutlines(root, presetInput) {
    const preset = resolvePresetLike(presetInput);
    if (!preset.toon) {
        return root;
    }
    const existing = new Set(root.children.flatMap((child) => outlineNamesFor(child)));
    root.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object.userData.kind === "toon-outline") {
            return;
        }
        const name = `${object.name || "mesh"}-toon-outline`;
        if (existing.has(name)) {
            return;
        }
        object.geometry.computeBoundingBox();
        const center = object.geometry.boundingBox?.getCenter(new THREE.Vector3());
        if (center === undefined) {
            return;
        }
        const outline = new THREE.Mesh(object.geometry, new THREE.MeshBasicMaterial({
            color: preset.toonEdgeColor,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.9,
        }));
        outline.name = name;
        outline.renderOrder = 20;
        outline.scale.setScalar(DEFAULT_TOON_OUTLINE_SCALE);
        outline.position.copy(center).multiplyScalar(1 - DEFAULT_TOON_OUTLINE_SCALE);
        outline.userData = {
            kind: "toon-outline",
            sourceObjectName: object.name,
            toonEdgeColor: preset.toonEdgeColor,
        };
        object.add(outline);
        existing.add(name);
    });
    return root;
}
function outlineNamesFor(object) {
    const names = [];
    object.traverse((child) => {
        if (child.userData.kind === "toon-outline") {
            names.push(child.name);
        }
    });
    return names;
}
export function applyMaterialGrain(root, presetInput) {
    const preset = resolvePresetLike(presetInput);
    if (!preset.grain) {
        return root;
    }
    root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
            return;
        }
        for (const material of materialsFor(object)) {
            if (material.userData.grainApplied === true) {
                continue;
            }
            const previousOnBeforeCompile = material.onBeforeCompile;
            material.onBeforeCompile = (shader, renderer) => {
                previousOnBeforeCompile.call(material, shader, renderer);
                shader.uniforms.vesselGrainScale = { value: preset.grainScale };
                shader.uniforms.vesselGrainIntensity = {
                    value: preset.grainIntensity,
                };
            };
            material.userData = {
                ...material.userData,
                grainApplied: true,
                grainScale: preset.grainScale,
                grainIntensity: preset.grainIntensity,
            };
            material.needsUpdate = true;
        }
    });
    return root;
}
export function createGlitchPass(presetInput) {
    const preset = resolvePresetLike(presetInput);
    return {
        kind: "vessel-glitch-pass",
        enabled: preset.glitch,
        intervalSeconds: preset.glitchIntervalSeconds,
        preset,
    };
}
export function createScreenGrainPass(presetInput) {
    const preset = resolvePresetLike(presetInput);
    return {
        kind: "vessel-screen-grain-pass",
        enabled: preset.grain,
        grainScale: preset.grainScale,
        grainIntensity: preset.grainIntensity,
        preset,
    };
}
export function createPreviewEffectPipeline(presetInput, options = {}) {
    const preset = resolvePresetLike(presetInput);
    const materialPreset = preset.crt ? { ...preset, grain: false } : preset;
    const crtBackground = resolveCrtBackground(options.crtBackground);
    return {
        kind: "vessel-preview-effect-pipeline",
        preset,
        materialPreset,
        screenPreset: preset,
        crtBackground,
        crtFragmentShader(fragmentShader) {
            return createPreviewCrtFragmentShader(fragmentShader, crtBackground);
        },
    };
}
function resolvePresetLike(preset) {
    return "toon" in preset &&
        "grain" in preset &&
        "glitch" in preset &&
        "reducedMotion" in preset
        ? preset
        : resolvePreviewEffectPreset(preset);
}
function toonMaterialFor(material, preset) {
    if (material.userData.toonApplied === true) {
        return material;
    }
    const source = material;
    const toon = new THREE.MeshToonMaterial({
        color: source.color instanceof THREE.Color
            ? source.color.clone()
            : new THREE.Color("#94a3b8"),
        transparent: material.transparent,
        opacity: material.opacity,
        side: material.side,
    });
    toon.name = `${material.name || "material"}-toon`;
    toon.userData = {
        ...material.userData,
        toonApplied: true,
        toonSourceMaterial: material.name || "anonymous",
        toonEdgeColor: preset.toonEdgeColor,
    };
    return toon;
}
function materialsFor(mesh) {
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
function nonEmptyText(value) {
    return value === undefined || value.trim().length === 0 ? undefined : value;
}
function positiveNumber(value, defaultValue) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : defaultValue;
}
function unitInterval(value, defaultValue) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return defaultValue;
    }
    return Math.min(1, Math.max(0, value));
}
function nonNegativeNumber(value, defaultValue) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : defaultValue;
}
function resolveCrtBackground(background) {
    return {
        enabled: background?.enabled ?? DEFAULT_CRT_BACKGROUND.enabled,
        backgroundColor: nonEmptyText(background?.backgroundColor) ??
            DEFAULT_CRT_BACKGROUND.backgroundColor,
        gridColor: nonEmptyText(background?.gridColor) ?? DEFAULT_CRT_BACKGROUND.gridColor,
        gridOpacity: unitInterval(background?.gridOpacity, DEFAULT_CRT_BACKGROUND.gridOpacity),
        gridSizePx: positiveNumber(background?.gridSizePx, DEFAULT_CRT_BACKGROUND.gridSizePx),
        gridLineWidthPx: positiveNumber(background?.gridLineWidthPx, DEFAULT_CRT_BACKGROUND.gridLineWidthPx),
    };
}
function createPreviewCrtFragmentShader(fragmentShader, background) {
    const grainPars = `varying vec2 vUv;

		uniform float grainScale;
		uniform float grainIntensity;
		uniform float grainIntensityScale;
		uniform vec3 previewBackgroundColor;
		uniform vec3 previewGridColor;
		uniform float previewGridOpacity;
		uniform float previewGridSpacing;
		uniform float previewGridLineWidth;

		float vesselPreviewCrtGrainRandom(vec2 value) {
			return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
		}

		vec3 vesselPreviewCrtBackground() {
			vec2 gridPosition = mod(gl_FragCoord.xy, max(previewGridSpacing, 1.0));
			float verticalLine = 1.0 - step(previewGridLineWidth, gridPosition.x);
			float horizontalLine = 1.0 - step(previewGridLineWidth, gridPosition.y);
			float gridLine = min(1.0, verticalLine + horizontalLine);
			return mix(previewBackgroundColor, previewGridColor, gridLine * previewGridOpacity);
		}`;
    const backgroundComposite = background.enabled
        ? `vec3 vesselPreviewCrtBackgroundColor = vesselPreviewCrtBackground();
			pixel.rgb = mix(vesselPreviewCrtBackgroundColor, pixel.rgb, clamp(pixel.a, 0.0, 1.0));
			pixel.a = 1.0;`
        : "";
    const curvedBoundsClamp = `if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
					uv = clamp(uv, vec2(0.0), vec2(1.0));
				}`;
    const outputEncoding = `float vesselPreviewCrtGrainValue = vesselPreviewCrtGrainRandom(floor(gl_FragCoord.xy / max(grainScale, 0.001)));
			float vesselPreviewCrtGrainDelta = (vesselPreviewCrtGrainValue - 0.5) * grainIntensity * grainIntensityScale;
			pixel.rgb = clamp(pixel.rgb + vec3(vesselPreviewCrtGrainDelta), 0.0, 1.0);
			pixel.rgb = mix(pixel.rgb * 12.92, 1.055 * pow(pixel.rgb, vec3(0.41666)) - 0.055, step(0.0031308, pixel.rgb));
			gl_FragColor = pixel;`;
    return fragmentShader
        .replace("varying vec2 vUv;", grainPars)
        .replace(`if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
					gl_FragColor = vec4(0.0);
					return;
				}`, curvedBoundsClamp)
        .replace("vec4 pixel = texture2D(tDiffuse, uv);", `vec4 pixel = texture2D(tDiffuse, uv);\n\n\t\t\t${backgroundComposite}`)
        .replace("gl_FragColor = pixel;", outputEncoding);
}
//# sourceMappingURL=index.js.map