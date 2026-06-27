import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addToonOutlines, applyMaterialGrain, applyToonMaterials, } from "@vessel-dsp/visual-effects";
export function validateCabinetProfile(profile) {
    const diagnostics = [];
    if (profile.schema !== "vessel-cabinet-profile/v1") {
        diagnostics.push("schema must be vessel-cabinet-profile/v1");
    }
    if (profile.brandName.trim().length === 0) {
        diagnostics.push("brandName is required");
    }
    if (profile.modelName !== undefined && profile.modelName.trim().length === 0) {
        diagnostics.push("modelName must not be empty when provided");
    }
    for (const [key, value] of Object.entries(profile.dimensionsMm)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            diagnostics.push(`dimensionsMm.${key} must be a positive number`);
        }
    }
    return { valid: diagnostics.length === 0, diagnostics };
}
export function createCabinetPreviewLayout(profile) {
    const validation = validateCabinetProfile(profile);
    if (!validation.valid) {
        throw new Error(validation.diagnostics.join("; "));
    }
    const width = profile.dimensionsMm.widthMm;
    const height = profile.dimensionsMm.heightMm;
    const appearance = resolveCabinetAppearance(profile);
    const grille = {
        centerMm: { x: 0, y: 0, z: roundMm(profile.dimensionsMm.depthMm / 2 + 2) },
        sizeMm: {
            widthMm: roundMm(width * 0.82),
            heightMm: roundMm(height * 0.72),
        },
    };
    const layout = {
        schema: "vessel-cabinet-preview-layout/v1",
        brandName: profile.brandName,
        enclosureColor: profile.enclosureColor,
        appearance,
        body: { dimensionsMm: profile.dimensionsMm },
        grille,
    };
    if (profile.modelName === undefined) {
        return layout;
    }
    return {
        ...layout,
        modelName: profile.modelName,
    };
}
function resolveCabinetAppearance(profile) {
    const appearance = profile.appearance;
    return {
        grilleColor: appearance?.grilleColor ?? "#1f2937",
        brandLabelColor: appearance?.brandLabelColor ?? "#f8fafc",
        modelLabelColor: appearance?.modelLabelColor ?? "#e5e7eb",
        labelFontFamily: appearance?.labelFontFamily ?? "vessel-vector",
        brandLabelFontSizeMm: positiveOrDefault(appearance?.brandLabelFontSizeMm, 22),
        modelLabelFontSizeMm: positiveOrDefault(appearance?.modelLabelFontSizeMm, 10),
        cornerProtectorColor: appearance?.cornerProtectorColor ?? "#020617",
    };
}
export function createCabinetPreviewObject3D(profile, options = {}) {
    const layout = createCabinetPreviewLayout(profile);
    const root = new THREE.Group();
    root.name = "cabinet-preview";
    root.userData = { schema: "vessel-cabinet-preview/v1", profile, layout };
    const body = boxMesh("cabinet-body", layout.body.dimensionsMm.widthMm, layout.body.dimensionsMm.heightMm, layout.body.dimensionsMm.depthMm, layout.enclosureColor);
    root.add(body);
    addCabinetTrim(root, layout);
    addCabinetCornerCaps(root, layout);
    addCabinetLabels(root, layout);
    const grille = boxMesh("cabinet-grille", layout.grille.sizeMm.widthMm, layout.grille.sizeMm.heightMm, 4, layout.appearance.grilleColor);
    grille.position.set(layout.grille.centerMm.x, layout.grille.centerMm.y, layout.grille.centerMm.z);
    root.add(grille);
    addCabinetGrilleNet(root, layout);
    if (options.effects !== undefined) {
        applyToonMaterials(root, options.effects);
        addToonOutlines(root, options.effects);
        applyMaterialGrain(root, options.effects);
    }
    return root;
}
function addCabinetGrilleNet(root, layout) {
    const width = layout.grille.sizeMm.widthMm;
    const height = layout.grille.sizeMm.heightMm;
    const group = new THREE.Group();
    group.name = "cabinet-grille-net";
    group.position.set(layout.grille.centerMm.x, layout.grille.centerMm.y, layout.grille.centerMm.z + 2.6);
    group.userData = {
        kind: "cabinet-grille-diagonal-net",
        spacingMm: CABINET_GRILLE_NET_SPACING_MM,
    };
    const lineMaterial = new THREE.MeshStandardMaterial({
        color: CABINET_GRILLE_NET_COLOR,
        roughness: 0.92,
        metalness: 0,
    });
    let index = 0;
    for (const direction of [-1, 1]) {
        for (const segment of clippedDiagonalSegments(width, height, CABINET_GRILLE_NET_SPACING_MM, direction)) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(segment.lengthMm, CABINET_GRILLE_NET_STROKE_MM, CABINET_GRILLE_NET_DEPTH_MM), lineMaterial);
            line.name = `cabinet-grille-net-${direction > 0 ? "positive" : "negative"}-${index}`;
            line.position.set(segment.center.x, segment.center.y, 0);
            line.rotation.z = segment.rotationRad;
            line.userData = {
                kind: "cabinet-grille-net-line",
                direction: direction > 0 ? "positive" : "negative",
            };
            group.add(line);
            index += 1;
        }
    }
    root.add(group);
}
function addCabinetTrim(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const trimZ = depth / 2 + 6;
    const trimColor = "#e5e7eb";
    const top = boxMesh("cabinet-trim-top", width * 0.84, 5, 3, trimColor);
    top.position.set(0, height * 0.36, trimZ);
    const bottom = boxMesh("cabinet-trim-bottom", width * 0.84, 5, 3, trimColor);
    bottom.position.set(0, -height * 0.36, trimZ);
    const left = boxMesh("cabinet-trim-left", 5, height * 0.72, 3, trimColor);
    left.position.set(-width * 0.42, 0, trimZ);
    const right = boxMesh("cabinet-trim-right", 5, height * 0.72, 3, trimColor);
    right.position.set(width * 0.42, 0, trimZ);
    root.add(top, bottom, left, right);
}
function addCabinetCornerCaps(root, layout) {
    const width = layout.body.dimensionsMm.widthMm;
    const height = layout.body.dimensionsMm.heightMm;
    const depth = layout.body.dimensionsMm.depthMm;
    const capSize = Math.min(width, height) * 0.075;
    const positions = [
        [
            "cabinet-corner-top-left",
            -width / 2 + capSize / 2,
            height / 2 - capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "cabinet-corner-top-right",
            width / 2 - capSize / 2,
            height / 2 - capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "cabinet-corner-bottom-left",
            -width / 2 + capSize / 2,
            -height / 2 + capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "cabinet-corner-bottom-right",
            width / 2 - capSize / 2,
            -height / 2 + capSize / 2,
            depth / 2 - capSize / 2,
        ],
        [
            "cabinet-corner-back-top-left",
            -width / 2 + capSize / 2,
            height / 2 - capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "cabinet-corner-back-top-right",
            width / 2 - capSize / 2,
            height / 2 - capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "cabinet-corner-back-bottom-left",
            -width / 2 + capSize / 2,
            -height / 2 + capSize / 2,
            -depth / 2 + capSize / 2,
        ],
        [
            "cabinet-corner-back-bottom-right",
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
function addCabinetLabels(root, layout) {
    const depth = layout.body.dimensionsMm.depthMm;
    const z = depth / 2 + 8;
    const grilleTopY = layout.grille.centerMm.y + layout.grille.sizeMm.heightMm / 2;
    const grilleBottomY = layout.grille.centerMm.y - layout.grille.sizeMm.heightMm / 2;
    const grilleRightX = layout.grille.centerMm.x + layout.grille.sizeMm.widthMm / 2;
    const brand = vectorTextLabel("cabinet-brand-label", layout.brandName, layout.appearance.brandLabelColor, layout.appearance.brandLabelFontSizeMm, layout.appearance.labelFontFamily, 2, { outlineColor: "#000000" });
    brand.position.set(0, grilleTopY - layout.appearance.brandLabelFontSizeMm * 1.75, z);
    brand.userData = {
        ...brand.userData,
        kind: "cabinet-brand-label",
        text: layout.brandName,
    };
    root.add(brand);
    if (layout.modelName === undefined) {
        return;
    }
    const model = vectorTextLabel("cabinet-model-label", layout.modelName, layout.appearance.modelLabelColor, layout.appearance.modelLabelFontSizeMm, layout.appearance.labelFontFamily, 2, { outlineColor: "#000000" });
    model.position.set(rightAlignedGroupX(model, grilleRightX - 8), grilleBottomY + layout.appearance.modelLabelFontSizeMm, z);
    model.userData = {
        ...model.userData,
        kind: "cabinet-model-label",
        text: layout.modelName,
    };
    root.add(model);
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
const CABINET_GRILLE_NET_SPACING_MM = 36;
const CABINET_GRILLE_NET_STROKE_MM = 1.6;
const CABINET_GRILLE_NET_DEPTH_MM = 1.2;
const CABINET_GRILLE_NET_COLOR = "#cccccc";
function roundedBoxGeometry(widthMm, heightMm, depthMm, radiusMm = roundedBoxRadius(widthMm, heightMm, depthMm)) {
    return new RoundedBoxGeometry(widthMm, heightMm, depthMm, ROUNDED_BOX_SEGMENTS, radiusMm);
}
function roundedBoxRadius(widthMm, heightMm, depthMm) {
    const smallestDimension = Math.min(widthMm, heightMm, depthMm);
    const maxValidRadius = Math.max(0, smallestDimension / 2 - ROUNDED_BOX_RADIUS_EPSILON_MM);
    const preferredRadius = Math.max(ROUNDED_BOX_MIN_RADIUS_MM, Math.min(ROUNDED_BOX_MAX_RADIUS_MM, smallestDimension * ROUNDED_BOX_RADIUS_RATIO));
    return roundMm(Math.min(maxValidRadius, preferredRadius));
}
function clippedDiagonalSegments(widthMm, heightMm, spacingMm, direction) {
    const halfWidth = widthMm / 2;
    const halfHeight = heightMm / 2;
    const rotationRad = Math.atan2(direction * heightMm, widthMm);
    const unitX = Math.cos(rotationRad);
    const unitY = Math.sin(rotationRad);
    const normalX = -unitY;
    const normalY = unitX;
    const cornerOffsets = [
        normalX * -halfWidth + normalY * -halfHeight,
        normalX * -halfWidth + normalY * halfHeight,
        normalX * halfWidth + normalY * -halfHeight,
        normalX * halfWidth + normalY * halfHeight,
    ];
    const minOffset = Math.min(...cornerOffsets);
    const maxOffset = Math.max(...cornerOffsets);
    const firstOffset = Math.ceil(minOffset / spacingMm) * spacingMm;
    const segments = [];
    for (let offset = firstOffset; offset <= maxOffset + 0.001; offset += spacingMm) {
        const point = { x: normalX * offset, y: normalY * offset };
        const extents = clippedLineExtents(point, { x: unitX, y: unitY }, { halfWidth, halfHeight });
        if (extents === null || extents.maxT - extents.minT < spacingMm * 0.35) {
            continue;
        }
        const centerT = (extents.minT + extents.maxT) / 2;
        segments.push({
            center: {
                x: roundMm(point.x + unitX * centerT),
                y: roundMm(point.y + unitY * centerT),
            },
            lengthMm: roundMm(extents.maxT - extents.minT),
            rotationRad,
        });
    }
    return segments;
}
function clippedLineExtents(point, direction, bounds) {
    const values = [];
    for (const x of [-bounds.halfWidth, bounds.halfWidth]) {
        const t = (x - point.x) / direction.x;
        const y = point.y + direction.y * t;
        if (y >= -bounds.halfHeight - 0.001 && y <= bounds.halfHeight + 0.001) {
            values.push(t);
        }
    }
    for (const y of [-bounds.halfHeight, bounds.halfHeight]) {
        const t = (y - point.y) / direction.y;
        const x = point.x + direction.x * t;
        if (x >= -bounds.halfWidth - 0.001 && x <= bounds.halfWidth + 0.001) {
            values.push(t);
        }
    }
    if (values.length < 2) {
        return null;
    }
    return {
        minT: Math.min(...values),
        maxT: Math.max(...values),
    };
}
function vectorTextLabel(name, text, color, heightMm, fontFamily, depthMm, options = {}) {
    const outlineWidthMm = options.outlineWidthMm ?? Math.max(0.8, heightMm * 0.08);
    const outlineDepthOffsetMm = options.outlineDepthOffsetMm ?? Math.max(0.4, depthMm * 0.35);
    const group = new THREE.Group();
    group.name = name;
    group.userData = {
        kind: "vector-text-label",
        text,
        fontFamily,
        fontSizeMm: heightMm,
        ...(options.outlineColor === undefined
            ? {}
            : {
                outlineColor: options.outlineColor,
                outlineWidthMm,
            }),
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
                stroke.userData = { kind: "vector-text-fill" };
                stroke.position.set(cursor + column * cell, ((glyph.length - 1) / 2 - row) * cell, 0);
                group.add(stroke);
                if (options.outlineColor !== undefined) {
                    const outline = boxMesh(`${name}-outline-${group.children.length}`, cell * 0.78 + outlineWidthMm, cell * 0.78 + outlineWidthMm, Math.max(0.4, depthMm * 0.45), options.outlineColor);
                    outline.userData = { kind: "vector-text-outline" };
                    outline.position.set(cursor + column * cell, ((glyph.length - 1) / 2 - row) * cell, -outlineDepthOffsetMm);
                    group.add(outline);
                }
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
export function createCabinetPreviewGlb(profile) {
    const layout = createCabinetPreviewLayout(profile);
    return {
        schema: "vessel-cabinet-preview-glb/v1",
        mimeType: "model/gltf-binary",
        bytes: encodeMetadataGlb("vessel-cabinet-preview-glb/v1", {
            profile,
            layout,
            generated: true,
        }),
        preview: { layout },
    };
}
function encodeMetadataGlb(schema, metadata) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify({
        asset: {
            version: "2.0",
            generator: "@vessel-dsp/cabinet",
            extras: metadata,
        },
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
function positiveOrDefault(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}
function roundMm(value) {
    return Math.round(value * 1000) / 1000;
}
//# sourceMappingURL=index.js.map
