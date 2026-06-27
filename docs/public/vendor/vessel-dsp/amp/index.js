import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addToonOutlines, applyMaterialGrain, applyToonMaterials, } from "@vessel-dsp/visual-effects";
export function validateAmpProfile(profile) {
    const diagnostics = [];
    if (profile.schema !== "vessel-amp-profile/v1") {
        diagnostics.push("schema must be vessel-amp-profile/v1");
    }
    if (profile.brandName.trim().length === 0) {
        diagnostics.push("brandName is required");
    }
    if (profile.modelName.trim().length === 0) {
        diagnostics.push("modelName is required");
    }
    for (const [key, value] of Object.entries(profile.dimensionsMm)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            diagnostics.push(`dimensionsMm.${key} must be a positive number`);
        }
    }
    for (const control of profile.controlPanel.controls) {
        if (control.id.trim().length === 0) {
            diagnostics.push("control id is required");
        }
        if (control.label.trim().length === 0) {
            diagnostics.push(`control "${control.id}" label is required`);
        }
    }
    return { valid: diagnostics.length === 0, diagnostics };
}
export function createAmpPreviewLayout(profile) {
    const validation = validateAmpProfile(profile);
    if (!validation.valid) {
        throw new Error(validation.diagnostics.join("; "));
    }
    const width = profile.dimensionsMm.widthMm;
    const height = profile.dimensionsMm.heightMm;
    const depth = profile.dimensionsMm.depthMm;
    const panelHeight = roundMm(Math.max(40, height * 0.28));
    const panelY = roundMm(-height / 2 + panelHeight / 2 + height * 0.08);
    const panelZ = profile.controlPanel.face === "top"
        ? roundMm(depth / 2 + 1)
        : roundMm(depth / 2 + 2);
    const appearance = resolveAmpAppearance(profile);
    const controls = profile.controlPanel.controls.map((control, index, all) => {
        const xRatio = control.position?.xRatio ?? (index + 1) / Math.max(1, all.length + 1);
        const yRatio = control.position?.yRatio ?? 0.5;
        const controlColor = control.color ??
            (control.kind === "knob"
                ? appearance.knobColor
                : control.kind === "led"
                    ? appearance.statusColor
                    : appearance.cornerProtectorColor);
        return {
            id: control.id,
            kind: control.kind,
            label: control.label,
            value: clamp01(control.value ?? 0.5),
            centerMm: {
                x: roundMm((clamp01(xRatio) - 0.5) * width * 0.76),
                y: roundMm(panelY + (0.5 - clamp01(yRatio)) * panelHeight * 0.55),
                z: panelZ,
            },
            radiusMm: control.kind === "knob" ? 11 : 6,
            color: controlColor,
            labelColor: control.labelColor ?? appearance.knobLabelColor,
            statusColor: control.statusColor ?? appearance.statusColor,
        };
    });
    return {
        schema: "vessel-amp-preview-layout/v1",
        brandName: profile.brandName,
        modelName: profile.modelName,
        enclosureColor: profile.enclosureColor,
        appearance,
        body: { dimensionsMm: profile.dimensionsMm },
        controlPanel: {
            face: profile.controlPanel.face ?? "front",
            color: appearance.controlPanelColor,
            centerMm: { x: 0, y: panelY, z: panelZ },
            sizeMm: { widthMm: roundMm(width * 0.86), heightMm: panelHeight },
        },
        controls,
    };
}
function resolveAmpAppearance(profile) {
    const appearance = profile.appearance;
    return {
        frontPanelColor: appearance?.frontPanelColor ?? "#1f2937",
        frontPanelBorderColor: appearance?.frontPanelBorderColor ?? "#f8fafc",
        controlPanelColor: appearance?.controlPanelColor ??
            profile.controlPanel.backgroundColor ??
            "#111827",
        brandLabelColor: appearance?.brandLabelColor ?? "#f8fafc",
        modelLabelColor: appearance?.modelLabelColor ?? "#e5e7eb",
        labelFontFamily: appearance?.labelFontFamily ?? "vessel-vector",
        brandLabelFontSizeMm: positiveOrDefault(appearance?.brandLabelFontSizeMm, 22),
        modelLabelFontSizeMm: positiveOrDefault(appearance?.modelLabelFontSizeMm, 10),
        knobColor: appearance?.knobColor ?? "#d4a73c",
        knobLabelColor: appearance?.knobLabelColor ?? "#111827",
        knobLabelFontSizeMm: positiveOrDefault(appearance?.knobLabelFontSizeMm, 6),
        statusColor: appearance?.statusColor ?? "#ef4444",
        cornerProtectorColor: appearance?.cornerProtectorColor ?? "#020617",
        handleGripColor: appearance?.handleGripColor ?? "#050505",
    };
}
export function createAmpPreviewObject3D(profile, options = {}) {
    const layout = createAmpPreviewLayout(profile);
    const root = new THREE.Group();
    root.name = "amp-preview";
    root.userData = { schema: "vessel-amp-preview/v1", profile, layout };
    const body = boxMesh("amp-body", layout.body.dimensionsMm.widthMm, layout.body.dimensionsMm.heightMm, layout.body.dimensionsMm.depthMm, layout.enclosureColor);
    root.add(body);
    const grilleHeight = Math.max(30, layout.body.dimensionsMm.heightMm * 0.48);
    const grille = boxMesh("amp-grille", layout.body.dimensionsMm.widthMm * 0.82, grilleHeight, 5, layout.appearance.frontPanelColor);
    grille.position.set(0, layout.controlPanel.centerMm.y +
        layout.controlPanel.sizeMm.heightMm / 2 +
        grilleHeight / 2 +
        layout.body.dimensionsMm.heightMm * 0.045, layout.body.dimensionsMm.depthMm / 2 + 3);
    root.add(grille);
    addAmpTrim(root, layout);
    addAmpHandle(root, layout);
    addAmpCornerCaps(root, layout);
    addAmpLabels(root, layout);
    const panel = boxMesh("amp-control-panel", layout.controlPanel.sizeMm.widthMm, layout.controlPanel.sizeMm.heightMm, 4, layout.controlPanel.color);
    panel.position.set(layout.controlPanel.centerMm.x, layout.controlPanel.centerMm.y, layout.controlPanel.centerMm.z);
    root.add(panel);
    for (const control of layout.controls) {
        const mesh = control.kind === "knob"
            ? new THREE.Mesh(new THREE.CylinderGeometry(control.radiusMm, control.radiusMm, 8, 32), new THREE.MeshStandardMaterial({ color: control.color }))
            : new THREE.Mesh(roundedBoxGeometry(control.radiusMm * 1.5, control.radiusMm * 1.5, 5), new THREE.MeshStandardMaterial({
                color: control.kind === "led" ? control.statusColor : control.color,
            }));
        mesh.name = `amp-control-${control.id}`;
        if (control.kind === "knob") {
            mesh.rotation.x = Math.PI / 2;
        }
        mesh.position.set(control.centerMm.x, control.centerMm.y, control.centerMm.z + 4);
        mesh.userData = { kind: "amp-control", control };
        root.add(mesh);
        const label = vectorTextLabel(`amp-control-label-${control.id}`, control.label, control.labelColor, layout.appearance.knobLabelFontSizeMm, layout.appearance.labelFontFamily, 2);
        label.position.set(control.centerMm.x, control.centerMm.y - control.radiusMm - 8, control.centerMm.z + 6);
        label.userData = {
            ...label.userData,
            kind: "amp-control-label",
            text: control.label,
            control,
        };
        root.add(label);
    }
    if (options.effects !== undefined) {
        applyToonMaterials(root, options.effects);
        addToonOutlines(root, options.effects);
        applyMaterialGrain(root, options.effects);
    }
    return root;
}
function addAmpTrim(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const trimZ = depth / 2 + 6;
    const trimColor = layout.appearance.frontPanelBorderColor;
    const trimThickness = 4;
    const grilleHeight = Math.max(30, height * 0.48);
    const grilleCenterY = layout.controlPanel.centerMm.y +
        layout.controlPanel.sizeMm.heightMm / 2 +
        grilleHeight / 2 +
        height * 0.045;
    const frameWidth = width * 0.84;
    const topRailY = grilleCenterY + grilleHeight / 2 + trimThickness / 2;
    const bottomRailY = grilleCenterY - grilleHeight / 2 - trimThickness / 2;
    const sideHeight = topRailY - bottomRailY - trimThickness;
    const sideCenterY = (topRailY + bottomRailY) / 2;
    const top = boxMesh("amp-trim-top", frameWidth, trimThickness, 3, trimColor);
    top.position.set(0, topRailY, trimZ);
    const bottom = boxMesh("amp-trim-bottom", frameWidth, trimThickness, 3, trimColor);
    bottom.position.set(0, bottomRailY, trimZ);
    const left = boxMesh("amp-trim-left", trimThickness, sideHeight, 3, trimColor);
    left.position.set(-frameWidth / 2, sideCenterY, trimZ);
    const right = boxMesh("amp-trim-right", trimThickness, sideHeight, 3, trimColor);
    right.position.set(frameWidth / 2, sideCenterY, trimZ);
    root.add(top, bottom, left, right);
}
function addAmpHandle(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const handleWidth = width * 0.28;
    const handleHeight = 10;
    const mountWidth = 36;
    const handleCenterY = height / 2 + 8;
    const mountOffset = handleWidth / 2 + mountWidth / 2;
    const handle = boxMesh("amp-handle", handleWidth, handleHeight, 16, layout.appearance.handleGripColor);
    handle.position.set(0, handleCenterY, depth * 0.05);
    const leftMount = boxMesh("amp-handle-mount-left", mountWidth, handleHeight, 18, layout.appearance.controlPanelColor);
    leftMount.position.set(-mountOffset, handleCenterY, depth * 0.05);
    const rightMount = boxMesh("amp-handle-mount-right", mountWidth, handleHeight, 18, layout.appearance.controlPanelColor);
    rightMount.position.set(mountOffset, handleCenterY, depth * 0.05);
    root.add(handle, leftMount, rightMount);
}
function addAmpCornerCaps(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const capSize = Math.min(width, height) * 0.095;
    const positions = [
        [
            "amp-corner-top-left",
            -width / 2 + capSize / 2,
            height / 2 - capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "amp-corner-top-right",
            width / 2 - capSize / 2,
            height / 2 - capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "amp-corner-bottom-left",
            -width / 2 + capSize / 2,
            -height / 2 + capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "amp-corner-bottom-right",
            width / 2 - capSize / 2,
            -height / 2 + capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "amp-corner-back-top-left",
            -width / 2 + capSize / 2,
            height / 2 - capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "amp-corner-back-top-right",
            width / 2 - capSize / 2,
            height / 2 - capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "amp-corner-back-bottom-left",
            -width / 2 + capSize / 2,
            -height / 2 + capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "amp-corner-back-bottom-right",
            width / 2 - capSize / 2,
            -height / 2 + capSize / 2,
            -depth / 2 + capSize / 2,
        ],
    ];
    for (const [name, x, y, z] of positions) {
        const cap = boxMesh(name, capSize, capSize, capSize, layout.appearance.cornerProtectorColor);
        cap.position.set(x, y, z);
        root.add(cap);
    }
}
function addAmpLabels(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const z = depth / 2 + 8;
    const grilleHeight = Math.max(30, height * 0.48);
    const grilleCenterY = layout.controlPanel.centerMm.y +
        layout.controlPanel.sizeMm.heightMm / 2 +
        grilleHeight / 2 +
        height * 0.045;
    const grilleBottomY = grilleCenterY - grilleHeight / 2;
    const grilleRightX = (width * 0.82) / 2;
    const brand = vectorTextLabel("amp-brand-label", layout.brandName, layout.appearance.brandLabelColor, layout.appearance.brandLabelFontSizeMm, layout.appearance.labelFontFamily, 2);
    brand.position.set(0, grilleCenterY, z);
    brand.userData = {
        ...brand.userData,
        kind: "amp-brand-label",
        text: layout.brandName,
    };
    const model = vectorTextLabel("amp-model-label", layout.modelName, layout.appearance.modelLabelColor, layout.appearance.modelLabelFontSizeMm, layout.appearance.labelFontFamily, 2);
    model.position.set(rightAlignedGroupX(model, grilleRightX - 8), grilleBottomY + layout.appearance.modelLabelFontSizeMm, z);
    model.userData = {
        ...model.userData,
        kind: "amp-model-label",
        text: layout.modelName,
    };
    root.add(brand, model);
}
export function createAmpPreviewGlb(profile) {
    const layout = createAmpPreviewLayout(profile);
    return {
        schema: "vessel-amp-preview-glb/v1",
        mimeType: "model/gltf-binary",
        bytes: encodeMetadataGlb("vessel-amp-preview-glb/v1", {
            profile,
            layout,
            generated: true,
        }),
        preview: { layout },
    };
}
function boxMesh(name, widthMm, heightMm, depthMm, color) {
    const cornerRadiusMm = roundedBoxRadius(widthMm, heightMm, depthMm);
    const mesh = new THREE.Mesh(roundedBoxGeometry(widthMm, heightMm, depthMm, cornerRadiusMm), new THREE.MeshStandardMaterial({ color }));
    mesh.name = name;
    mesh.userData = {
        ...mesh.userData,
        cornerRadiusMm,
        cornerSegments: ROUNDED_BOX_SEGMENTS,
    };
    return mesh;
}
const ROUNDED_BOX_SEGMENTS = 8;
const ROUNDED_BOX_MAX_RADIUS_MM = 20;
const ROUNDED_BOX_RADIUS_RATIO = 0.22;
const ROUNDED_BOX_MIN_RADIUS_MM = 1.2;
const ROUNDED_BOX_RADIUS_EPSILON_MM = 0.001;
function roundedBoxGeometry(widthMm, heightMm, depthMm, radiusMm = roundedBoxRadius(widthMm, heightMm, depthMm)) {
    return new RoundedBoxGeometry(widthMm, heightMm, depthMm, ROUNDED_BOX_SEGMENTS, radiusMm);
}
function roundedBoxRadius(widthMm, heightMm, depthMm) {
    const smallestDimension = Math.min(widthMm, heightMm, depthMm);
    const maxValidRadius = Math.max(0, smallestDimension / 2 - ROUNDED_BOX_RADIUS_EPSILON_MM);
    const preferredRadius = Math.max(ROUNDED_BOX_MIN_RADIUS_MM, Math.min(ROUNDED_BOX_MAX_RADIUS_MM, smallestDimension * ROUNDED_BOX_RADIUS_RATIO));
    return roundMm(Math.min(maxValidRadius, preferredRadius));
}
function vectorTextLabel(name, text, color, heightMm, fontFamily, depthMm) {
    const group = new THREE.Group();
    group.name = name;
    group.userData = {
        kind: "vector-text-label",
        text,
        fontFamily,
        fontSizeMm: heightMm,
    };
    const cell = heightMm / 5;
    const gap = cell * 0.45;
    let cursor = 0;
    for (const character of text.toUpperCase()) {
        const glyph = GLYPHS[character] ?? GLYPHS["?"];
        if (glyph === undefined) {
            cursor += cell * 2;
            continue;
        }
        for (let row = 0; row < glyph.length; row += 1) {
            const line = glyph[row] ?? "";
            for (let column = 0; column < line.length; column += 1) {
                if (line[column] !== "1") {
                    continue;
                }
                const stroke = boxMesh(`${name}-stroke-${group.children.length}`, cell * 0.78, cell * 0.78, depthMm, color);
                stroke.position.set(cursor + column * cell, ((glyph.length - 1) / 2 - row) * cell, 0);
                group.add(stroke);
            }
        }
        const glyphWidth = glyph[0]?.length ?? 0;
        cursor += glyphWidth === 0 ? cell * 2 : glyphWidth * cell + gap;
    }
    const centerOffset = cursor > 0 ? (cursor - gap) / 2 : 0;
    for (const child of group.children) {
        child.position.x -= centerOffset;
    }
    return group;
}
function rightAlignedGroupX(group, rightEdgeX) {
    let maxX = Number.NEGATIVE_INFINITY;
    for (const child of group.children) {
        const mesh = child;
        if (mesh.geometry === undefined) {
            continue;
        }
        mesh.geometry.computeBoundingBox();
        const boundingBox = mesh.geometry.boundingBox;
        if (boundingBox === null) {
            continue;
        }
        maxX = Math.max(maxX, child.position.x + boundingBox.max.x);
    }
    return Number.isFinite(maxX) ? rightEdgeX - maxX : rightEdgeX;
}
const GLYPHS = {
    " ": ["", "", "", "", ""],
    "-": ["000", "000", "111", "000", "000"],
    "?": ["111", "001", "011", "000", "010"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    A: ["111", "101", "111", "101", "101"],
    B: ["110", "101", "110", "101", "110"],
    C: ["111", "100", "100", "100", "111"],
    D: ["110", "101", "101", "101", "110"],
    E: ["111", "100", "110", "100", "111"],
    F: ["111", "100", "110", "100", "100"],
    G: ["111", "100", "101", "101", "111"],
    H: ["101", "101", "111", "101", "101"],
    I: ["111", "010", "010", "010", "111"],
    J: ["001", "001", "001", "101", "111"],
    K: ["101", "101", "110", "101", "101"],
    L: ["100", "100", "100", "100", "111"],
    M: ["101", "111", "111", "101", "101"],
    N: ["101", "111", "111", "111", "101"],
    O: ["111", "101", "101", "101", "111"],
    P: ["111", "101", "111", "100", "100"],
    Q: ["111", "101", "101", "111", "001"],
    R: ["111", "101", "111", "110", "101"],
    S: ["111", "100", "111", "001", "111"],
    T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "111"],
    V: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "111", "111", "101"],
    X: ["101", "101", "010", "101", "101"],
    Y: ["101", "101", "010", "010", "010"],
    Z: ["111", "001", "010", "100", "111"],
};
function encodeMetadataGlb(schema, metadata) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify({
        asset: { version: "2.0", generator: "@vessel-dsp/amp", extras: metadata },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ name: schema, extras: metadata }],
    }));
    const paddedJsonLength = align4(jsonBytes.byteLength);
    const totalLength = 12 + 8 + paddedJsonLength;
    const bytes = new Uint8Array(totalLength);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, paddedJsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.set(jsonBytes, 20);
    bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJsonLength);
    return bytes;
}
function align4(value) {
    return Math.ceil(value / 4) * 4;
}
function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}
function positiveOrDefault(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}
function roundMm(value) {
    return Math.round(value * 1000) / 1000;
}
//# sourceMappingURL=index.js.map