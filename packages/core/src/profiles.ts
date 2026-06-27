import { z } from "zod";

export const ampControlKindSchema = z.enum(["knob", "switch", "led"]);

export const ampAppearanceProfileSchema = z
	.object({
		frontPanelColor: z.string().optional(),
		frontPanelBorderColor: z.string().optional(),
		controlPanelColor: z.string().optional(),
		brandLabelColor: z.string().optional(),
		modelLabelColor: z.string().optional(),
		labelFontFamily: z.string().optional(),
		brandLabelFontSizeMm: z.number().positive().optional(),
		modelLabelFontSizeMm: z.number().positive().optional(),
		knobColor: z.string().optional(),
		knobLabelColor: z.string().optional(),
		knobLabelFontSizeMm: z.number().positive().optional(),
		statusColor: z.string().optional(),
		cornerProtectorColor: z.string().optional(),
		handleGripColor: z.string().optional(),
	})
	.strict();

export const profileDimensionsSchema = z
	.object({
		widthMm: z.number().positive(),
		heightMm: z.number().positive(),
		depthMm: z.number().positive(),
	})
	.strict();

export const ampControlProfileSchema = z
	.object({
		id: z.string().min(1, "Required"),
		kind: ampControlKindSchema,
		label: z.string().min(1, "Required"),
		color: z.string().optional(),
		labelColor: z.string().optional(),
		statusColor: z.string().optional(),
		value: z.number().min(0).max(1).optional(),
		position: z
			.object({
				xRatio: z.number().min(0).max(1),
				yRatio: z.number().min(0).max(1),
			})
			.strict()
			.optional(),
	})
	.strict();

export const ampControlPanelProfileSchema = z
	.object({
		face: z.enum(["front", "top"]).optional(),
		backgroundColor: z.string().optional(),
		controls: z.array(ampControlProfileSchema),
	})
	.strict();

export const ampProfileSchema = z
	.object({
		schema: z.literal("vessel-amp-profile/v1"),
		brandName: z.string().min(1, "Required"),
		modelName: z.string().min(1, "Required"),
		enclosureColor: z.string().min(1, "Required"),
		appearance: ampAppearanceProfileSchema.optional(),
		dimensionsMm: profileDimensionsSchema,
		controlPanel: ampControlPanelProfileSchema,
	})
	.strict();

export const cabinetAppearanceProfileSchema = z
	.object({
		grilleColor: z.string().optional(),
		brandLabelColor: z.string().optional(),
		modelLabelColor: z.string().optional(),
		labelFontFamily: z.string().optional(),
		brandLabelFontSizeMm: z.number().positive().optional(),
		modelLabelFontSizeMm: z.number().positive().optional(),
		cornerProtectorColor: z.string().optional(),
	})
	.strict();

export const cabinetProfileSchema = z
	.object({
		schema: z.literal("vessel-cabinet-profile/v1"),
		brandName: z.string().min(1, "Required"),
		modelName: z.string().min(1, "Required").optional(),
		enclosureColor: z.string().min(1, "Required"),
		appearance: cabinetAppearanceProfileSchema.optional(),
		dimensionsMm: profileDimensionsSchema,
	})
	.strict();

export type AmpControlKind = "knob" | "switch" | "led";

export type AmpAppearanceProfile = Readonly<{
	frontPanelColor?: string;
	frontPanelBorderColor?: string;
	controlPanelColor?: string;
	brandLabelColor?: string;
	modelLabelColor?: string;
	labelFontFamily?: string;
	brandLabelFontSizeMm?: number;
	modelLabelFontSizeMm?: number;
	knobColor?: string;
	knobLabelColor?: string;
	knobLabelFontSizeMm?: number;
	statusColor?: string;
	cornerProtectorColor?: string;
	handleGripColor?: string;
}>;

export type AmpDimensions = Readonly<{
	widthMm: number;
	heightMm: number;
	depthMm: number;
}>;

export type AmpControlProfile = Readonly<{
	id: string;
	kind: AmpControlKind;
	label: string;
	color?: string;
	labelColor?: string;
	statusColor?: string;
	value?: number;
	position?: Readonly<{
		xRatio: number;
		yRatio: number;
	}>;
}>;

export type AmpControlPanelProfile = Readonly<{
	face?: "front" | "top";
	backgroundColor?: string;
	controls: readonly AmpControlProfile[];
}>;

export type AmpProfile = Readonly<{
	schema: "vessel-amp-profile/v1";
	brandName: string;
	modelName: string;
	enclosureColor: string;
	appearance?: AmpAppearanceProfile;
	dimensionsMm: AmpDimensions;
	controlPanel: AmpControlPanelProfile;
}>;

export type CabinetAppearanceProfile = Readonly<{
	grilleColor?: string;
	brandLabelColor?: string;
	modelLabelColor?: string;
	labelFontFamily?: string;
	brandLabelFontSizeMm?: number;
	modelLabelFontSizeMm?: number;
	cornerProtectorColor?: string;
}>;

export type CabinetDimensions = AmpDimensions;

export type CabinetProfile = Readonly<{
	schema: "vessel-cabinet-profile/v1";
	brandName: string;
	modelName?: string;
	enclosureColor: string;
	appearance?: CabinetAppearanceProfile;
	dimensionsMm: CabinetDimensions;
}>;

export type ProfileValidationResult<TProfile> =
	| Readonly<{
			valid: true;
			profile: TProfile;
			diagnostics: readonly [];
	  }>
	| Readonly<{
			valid: false;
			diagnostics: readonly string[];
	  }>;

export type AmpProfileValidation = ProfileValidationResult<AmpProfile>;
export type CabinetProfileValidation = ProfileValidationResult<CabinetProfile>;

export function validateAmpProfile(profile: unknown): AmpProfileValidation {
	return validateProfile<AmpProfile>(ampProfileSchema, profile);
}

export function validateCabinetProfile(
	profile: unknown,
): CabinetProfileValidation {
	return validateProfile<CabinetProfile>(cabinetProfileSchema, profile);
}

function validateProfile<TProfile>(
	schema: z.ZodTypeAny,
	profile: unknown,
): ProfileValidationResult<TProfile> {
	const result = schema.safeParse(profile);
	if (result.success) {
		return { valid: true, profile: result.data as TProfile, diagnostics: [] };
	}
	return {
		valid: false,
		diagnostics: result.error.issues.map(formatZodIssue),
	};
}

function formatZodIssue(issue: z.ZodIssue): string {
	const path = issue.path.length > 0 ? issue.path.join(".") : "profile";
	if (
		issue.path.length === 1 &&
		issue.path[0] === "schema" &&
		(issue.code === z.ZodIssueCode.invalid_literal ||
			(issue.code === z.ZodIssueCode.invalid_type &&
				issue.received === "undefined"))
	) {
		return `${path}: Required; expected ${schemaDescription(issue)}`;
	}
	return `${path}: ${issue.message}`;
}

function schemaDescription(issue: z.ZodIssue): string {
	if (issue.code === z.ZodIssueCode.invalid_literal) {
		return String(issue.expected);
	}
	return "vessel-amp-profile/v1 or vessel-cabinet-profile/v1";
}
