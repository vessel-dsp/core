import { validateCabinetProfile, parseCircuitDocumentFile } from "@vessel-dsp/core";
import * as fs from "fs";
import * as path from "path";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "../../artifacts";

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}){1,2}$/;

const results: {
  name: string;
  severity: "error" | "warning" | "info";
  diagnostics: string[];
}[] = [];

let totalFiles = 0;
let filesWithAppearance = 0;
let errors = 0;
let warnings = 0;

function isHexString(s: string): boolean {
  return HEX_COLOR_RE.test(s);
}

function validateStompboxAppearance(
  name: string,
  appearance: Record<string, any>,
  slug: string,
  bossColors: Record<string, any>,
) {
  const diags: string[] = [];

  if (!appearance.enclosure?.color) {
    diags.push("missing enclosure color");
  } else if (!isHexString(appearance.enclosure.color)) {
    diags.push(`invalid hex color for enclosure: ${appearance.enclosure.color}`);
  }

  if (appearance.defaults?.label) {
    if (typeof appearance.defaults.label.color !== "string") {
      diags.push("defaults.label.color should be a string");
    } else if (!isHexString(appearance.defaults.label.color)) {
      diags.push(`invalid hex color for label: ${appearance.defaults.label.color}`);
    }
  }

  if (appearance.defaults?.led) {
    if (typeof appearance.defaults.led.color !== "string") {
      diags.push("defaults.led.color should be a string");
    } else if (!isHexString(appearance.defaults.led.color)) {
      diags.push(`invalid hex color for led: ${appearance.defaults.led.color}`);
    }
  }

  if (appearance.defaults?.footswitch) {
    if (typeof appearance.defaults.footswitch.color !== "string") {
      diags.push("defaults.footswitch.color should be a string");
    } else if (!isHexString(appearance.defaults.footswitch.color)) {
      diags.push(`invalid hex color for footswitch: ${appearance.defaults.footswitch.color}`);
    }
  }

  if (appearance.defaults?.audioJack) {
    if (typeof appearance.defaults.audioJack.color !== "string") {
      diags.push("defaults.audioJack.color should be a string");
    } else if (!isHexString(appearance.defaults.audioJack.color)) {
      diags.push(`invalid hex color for audioJack: ${appearance.defaults.audioJack.color}`);
    }
  }

  if (appearance.defaults?.dcJack) {
    if (typeof appearance.defaults.dcJack.color !== "string") {
      diags.push("defaults.dcJack.color should be a string");
    } else if (!isHexString(appearance.defaults.dcJack.color)) {
      diags.push(`invalid hex color for dcJack: ${appearance.defaults.dcJack.color}`);
    }
  }

  if (appearance.amp !== undefined) {
    diags.push("appearance.amp cannot be present when appearance.kind is stompbox");
  }

  if (slug.startsWith("boss-") && bossColors[slug]) {
    const expected = bossColors[slug];
    const actual = appearance.enclosure?.color;
    if (actual && expected.color && actual !== expected.color) {
      diags.push(
        `enclosure color ${actual} differs from boss-colors.json ${expected.color} ${expected.source || ""}`,
      );
    }
  }

  const severity = diags.length > 0 ? "error" : "info";
  if (severity === "error") errors += diags.length;
  return { name, severity, diagnostics: diags };
}

function validateAmpAppearance(
  name: string,
  appearance: Record<string, any>,
  packetSlug: string,
) {
  const diags: string[] = [];

  if (!appearance.enclosureColor) {
    diags.push("missing enclosureColor");
  } else if (!isHexString(appearance.enclosureColor)) {
    diags.push(`invalid hex color for enclosureColor: ${appearance.enclosureColor}`);
  }

  if (appearance.stompbox !== undefined) {
    diags.push("appearance.stompbox cannot be present when appearance.kind is amp");
  }

  if (appearance.appearance) {
    const ampApp = appearance.appearance;
    const fields = [
      "frontPanelColor",
      "controlPanelColor",
      "brandLabelColor",
      "modelLabelColor",
      "knobColor",
      "knobLabelColor",
      "statusColor",
      "cornerProtectorColor",
      "handleGripColor",
    ];
    for (const field of fields) {
      if (ampApp[field] && typeof ampApp[field] === "string" && !isHexString(ampApp[field])) {
        diags.push(`invalid hex color for ${field}: ${ampApp[field]}`);
      }
    }
  }

  const severity = diags.length > 0 ? "error" : "info";
  if (severity === "error") errors += diags.length;
  return { name, severity, diagnostics: diags };
}

function validateCabinetPreviewProfile(cabinetDir: string) {
  const previewPath = path.join(cabinetDir, "preview-profile.json");
  if (!fs.existsSync(previewPath)) {
    return null;
  }
  try {
    const profile = JSON.parse(fs.readFileSync(previewPath, "utf-8"));
    const res = validateCabinetProfile(profile);
    if (!res.valid) {
      return {
        name: `Cabinet: ${path.basename(cabinetDir)}`,
        severity: "error",
        diagnostics: res.diagnostics,
      };
    }
    return null;
  } catch (e: any) {
    return {
      name: `Cabinet: ${path.basename(cabinetDir)}`,
      severity: "error",
      diagnostics: [e.message],
    };
  }
}

// Load boss-colors.json
const bossColorsPath = `${ARTIFACTS_DIR}/tmp/boss-colors.json`;
const bossColors: Record<string, any> = fs.existsSync(bossColorsPath)
  ? JSON.parse(fs.readFileSync(bossColorsPath, "utf-8"))
  : {};

// Scan pedal .vdsp files
const pedalDir = `${ARTIFACTS_DIR}/schematics/vessel-dsp`;
if (fs.existsSync(pedalDir)) {
  const pedals = fs.readdirSync(pedalDir).filter((f) => f.endsWith(".vdsp"));
  for (const pedal of pedals) {
    totalFiles++;
    const pedalPath = path.join(pedalDir, pedal);
    try {
      const source = fs.readFileSync(pedalPath, "utf-8");
      const doc = parseCircuitDocumentFile(source, { filename: pedalPath });
      if (doc.appearance) {
        filesWithAppearance++;
        if (doc.appearance.kind === "stompbox") {
          const slug = pedal.replace(".vdsp", "");
          results.push(
            validateStompboxAppearance("Pedal: " + slug, doc.appearance, slug, bossColors),
          );
        } else if (doc.appearance.kind === "amp") {
          results.push(validateAmpAppearance("Pedal: " + pedal, doc.appearance, pedal));
        } else {
          results.push({
            name: "Pedal: " + pedal,
            severity: "error",
            diagnostics: ["invalid appearance.kind: " + doc.appearance.kind],
          });
          errors++;
        }
      }
    } catch (e: any) {
      if (e.message.includes("unsupported component kind")) {
        results.push({
          name: "Pedal: " + pedal,
          severity: "warning",
          diagnostics: ["parser error (not appearance): " + e.message],
        });
        warnings++;
      } else {
        results.push({
          name: "Pedal: " + pedal,
          severity: "error",
          diagnostics: [e.message],
        });
        errors++;
      }
    }
  }
}

// Scan amp .vdsp files
const ampDir = `${ARTIFACTS_DIR}/schematics/vessel-dsp/amps`;
if (fs.existsSync(ampDir)) {
  const amps = fs.readdirSync(ampDir).filter((f) => f.endsWith(".vdsp"));
  for (const amp of amps) {
    totalFiles++;
    const ampPath = path.join(ampDir, amp);
    try {
      const source = fs.readFileSync(ampPath, "utf-8");
      const doc = parseCircuitDocumentFile(source, { filename: ampPath });
      if (doc.appearance) {
        filesWithAppearance++;
        if (doc.appearance.kind === "amp") {
          results.push(
            validateAmpAppearance("Amp: " + amp.replace(".vdsp", ""), doc.appearance, amp),
          );
        } else if (doc.appearance.kind === "stompbox") {
          results.push({
            name: "Amp: " + amp,
            severity: "error",
            diagnostics: ["amp file has stompbox appearance.kind instead of amp"],
          });
          errors++;
        } else {
          results.push({
            name: "Amp: " + amp,
            severity: "error",
            diagnostics: ["invalid appearance.kind: " + doc.appearance.kind],
          });
          errors++;
        }
      }
    } catch (e: any) {
      if (e.message.includes("unsupported component kind")) {
        results.push({
          name: "Amp: " + amp,
          severity: "warning",
          diagnostics: ["parser error (not appearance): " + e.message],
        });
        warnings++;
      } else {
        results.push({
          name: "Amp: " + amp,
          severity: "error",
          diagnostics: [e.message],
        });
        errors++;
      }
    }
  }
}

// Scan cabinet preview profiles
const cabinetDir = `${ARTIFACTS_DIR}/cabinets`;
if (fs.existsSync(cabinetDir)) {
  const cabinets = fs.readdirSync(cabinetDir);
  for (const cabinet of cabinets) {
    const cabinetPath = path.join(cabinetDir, cabinet);
    if (fs.statSync(cabinetPath).isDirectory()) {
      totalFiles++;
      const res = validateCabinetPreviewProfile(cabinetPath);
      if (res) {
        results.push(res);
      }
    }
  }
}

// Print results
console.log("\n=== Appearance Validation Results ===\n");
console.log(`Total files scanned: ${totalFiles}`);
console.log(`Files with appearance blocks: ${filesWithAppearance}`);

const errorResults = results.filter((r) => r.severity === "error");
const warningResults = results.filter((r) => r.severity === "warning");
const infoResults = results.filter((r) => r.severity === "info");

if (errorResults.length > 0) {
  console.log(`\nErrors (${errorResults.length}):`);
  for (const r of errorResults) {
    console.log(`\n  ERROR: ${r.name}`);
    for (const d of r.diagnostics) {
      console.log(`    - ${d}`);
    }
  }
}

if (warningResults.length > 0) {
  console.log(`\nWarnings (${warningResults.length}):`);
  for (const r of warningResults) {
    console.log(`\n  WARN: ${r.name}`);
    for (const d of r.diagnostics) {
      console.log(`    - ${d}`);
    }
  }
}

const passedCount = totalFiles - errorResults.length;
console.log(
  `\nTotal: ${passedCount}/${totalFiles} passed (${errorResults.length} files with errors, ${errors} total errors)`,
);

if (errors > 0) {
  process.exit(1);
}
