import { validateCabinetProfile, parseCircuitDocumentFile } from "@vessel-dsp/core";
import * as fs from "fs";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "../../artifacts";

const results: { name: string; valid: boolean; diagnostics: string[] }[] = [];

// Validate cabinet preview profile
const cabinetPath = `${ARTIFACTS_DIR}/cabinets/fender-59-bassman-4x10/preview-profile.json`;
if (fs.existsSync(cabinetPath)) {
  const profile = JSON.parse(fs.readFileSync(cabinetPath, "utf-8"));
  const res = validateCabinetProfile(profile);
  results.push({
    name: "Cabinet: fender-59-bassman-4x10",
    valid: res.valid,
    diagnostics: res.diagnostics,
  });
}

// Validate pedal .vdsp appearance (stompbox)
const pedalPath = `${ARTIFACTS_DIR}/schematics/vessel-dsp/boss-ds-1.vdsp`;
if (fs.existsSync(pedalPath)) {
  try {
    const source = fs.readFileSync(pedalPath, "utf-8");
    const doc = parseCircuitDocumentFile(source, { filename: pedalPath });
    if (doc.appearance?.kind === "stompbox") {
      const appearance = doc.appearance;
      let valid = true;
      const diags: string[] = [];
      if (!appearance.enclosure?.color) {
        valid = false;
        diags.push("missing enclosure color");
      }
      if (appearance.defaults?.label && typeof appearance.defaults.label.color !== "string") {
        diags.push("defaults.label.color should be a string");
      }
      if (appearance.defaults?.led && typeof appearance.defaults.led.color !== "string") {
        diags.push("defaults.led.color should be a string");
      }
      results.push({
        name: "Pedal (stompbox): boss-ds-1",
        valid,
        diagnostics: diags,
      });
    } else {
      results.push({
        name: "Pedal (stompbox): boss-ds-1",
        valid: false,
        diagnostics: ["appearance.kind is not 'stompbox'"],
      });
    }
  } catch (e: any) {
    results.push({
      name: "Pedal (stompbox): boss-ds-1",
      valid: false,
      diagnostics: [e.message],
    });
  }
}

// Validate amp .vdsp appearance
const ampPath = `${ARTIFACTS_DIR}/schematics/vessel-dsp/amps/fender-5f1-champ.vdsp`;
if (fs.existsSync(ampPath)) {
  try {
    const source = fs.readFileSync(ampPath, "utf-8");
    const doc = parseCircuitDocumentFile(source, { filename: ampPath });
    if (doc.appearance?.kind === "amp") {
      const appearance = doc.appearance;
      let valid = true;
      const diags: string[] = [];
      if (!appearance.enclosureColor) {
        valid = false;
        diags.push("missing enclosureColor");
      }
      if (appearance.appearance) {
        const ampApp = appearance.appearance;
        if (ampApp.frontPanelColor && typeof ampApp.frontPanelColor !== "string") {
          diags.push("frontPanelColor should be a string");
        }
      }
      results.push({
        name: "Amp (amp): fender-5f1-champ",
        valid,
        diagnostics: diags,
      });
    } else {
      results.push({
        name: "Amp (amp): fender-5f1-champ",
        valid: false,
        diagnostics: ["appearance.kind is not 'amp'"],
      });
    }
  } catch (e: any) {
    results.push({
      name: "Amp (amp): fender-5f1-champ",
      valid: false,
      diagnostics: [e.message],
    });
  }
}

// Print results
console.log("\n=== Phase 1 Validation Results ===\n");
let allValid = true;
for (const r of results) {
  const status = r.valid ? "PASS" : "FAIL";
  console.log(`${status}: ${r.name}`);
  if (!r.valid) {
    allValid = false;
    for (const d of r.diagnostics) {
      console.log(`  - ${d}`);
    }
  }
}
console.log(`\nTotal: ${results.filter((r) => r.valid).length}/${results.length} passed\n`);
process.exit(allValid ? 0 : 1);
