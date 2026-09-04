import { describe, expect, it } from "bun:test";
import {
	collectTerminalRoleWarnings,
	isLegalTerminalRole,
	terminalRolesFor,
} from "../../packages/core/src/model/device-terminal-roles";
import {
	parseVdspCircuitDocument,
	serializeVdspCircuitDocument,
} from "../../packages/core/src";

const document = (kind: string, role: string): string =>
	`schema: circuit-interchange/v3
metadata:
  name: Fuse Kind
components:
  - id: F1
    kind: ${kind}
    name: F1
    sourceTypeName: Circuit.Fuse
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: ${role}
        node: 1
        position:
          x: -10
          y: 0
      - name: b
        role: end
        node: 2
        position:
          x: 10
          y: 0
    properties:
      FuseRating: "2 A Slow Blow"
      Name: F1
nodes:
  - id: 1
    name: IN
  - id: 2
    name: OUT
`;

describe("the fuse component kind", () => {
	it("declares two ends and a holder pin, and no electrode", () => {
		// A fuse conducts until it opens once; there is no anode, no wiper and no contact to
		// select. `pin` is for a holder's mounting lug.
		expect([...terminalRolesFor("fuse")].sort()).toEqual([
			"end",
			"negative",
			"pin",
			"positive",
		]);
		expect(isLegalTerminalRole("fuse", "end")).toBe(true);
		expect(isLegalTerminalRole("fuse", "pin")).toBe(true);
		// The negative control, and the point of a typed vocabulary: a role that belongs to a
		// different kind is refused rather than carried.
		expect(isLegalTerminalRole("fuse", "cathode")).toBe(false);
		expect(isLegalTerminalRole("fuse", "common")).toBe(false);
	});

	it("parses, and survives a serialize/parse round trip as a fuse", () => {
		const parsed = parseVdspCircuitDocument(document("fuse", "end"));
		expect(parsed.components[0]?.kind).toBe("fuse");
		const text = serializeVdspCircuitDocument(parsed);
		expect(parseVdspCircuitDocument(text).components[0]?.kind).toBe("fuse");
	});

	it("still refuses a kind nobody defined", () => {
		// Without this the union is decoration: a typo would arrive as a new kind rather than an
		// error, which is exactly what a closed vocabulary exists to stop.
		expect(() => parseVdspCircuitDocument(document("fuze", "end"))).toThrow(
			/unsupported component kind/,
		);
	});

	it("reports an illegal role on a fuse rather than accepting it", () => {
		const parsed = parseVdspCircuitDocument(document("fuse", "cathode"));
		const warnings = collectTerminalRoleWarnings(parsed.components);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("terminal-role-illegal");
		expect(warnings[0]?.componentId).toBe("F1");
	});
});
