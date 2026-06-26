import {
	propertyBooleanValue,
	propertyNumericValue,
	propertyStringValue,
} from "../../model/properties";
import type { PropertyValue } from "../../model/types";

type MutableProperties = Record<string, PropertyValue>;

export function runtimeDescriptorProperties(
	shortType: string,
	properties: Readonly<Record<string, PropertyValue>>,
): Readonly<Record<string, PropertyValue>> {
	const descriptorType = descriptorTypeForShortType(shortType);
	const out: MutableProperties = {
		DescriptorType: descriptorType,
	};

	switch (descriptorType) {
		case "microblock-tone-stack":
			Object.assign(out, toneStackDescriptor(properties));
			break;
		case "microblock-active-eq":
			Object.assign(out, activeEqDescriptor(properties));
			break;
		case "microblock-delay-chip":
			Object.assign(out, delayChipDescriptor(properties));
			break;
		case "microblock-reverb":
			Object.assign(out, reverbDescriptor(properties));
			break;
		case "microblock-compressor":
			Object.assign(out, compressorDescriptor(properties));
			break;
		case "microblock-octave":
			Object.assign(out, octaveDescriptor(properties));
			break;
		case "microblock-envelope-gain":
		case "microblock-env-filter":
			Object.assign(out, scalarDescriptor(properties, COMMON_RUNTIME_FIELDS));
			break;
		default:
			break;
	}

	return out;
}

function descriptorTypeForShortType(shortType: string): string {
	if (shortType.startsWith("MicroBlock")) {
		const rest = shortType.slice("MicroBlock".length);
		return rest.length === 0
			? "microblock"
			: `microblock-${camelToKebab(rest)}`;
	}
	return camelToKebab(shortType);
}

function camelToKebab(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		.toLowerCase();
}

function toneStackDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	const out: MutableProperties = {};
	addNumber(out, "overallGainDb", properties, ["OverallGainDb"]);
	addNumber(out, "maxSections", properties, ["MaxSections"]);
	const sections = parseToneStackSections(properties);
	if (sections.length > 0) {
		out.sections = sections;
	}
	addString(out, "toneControlName", properties, [
		"ToneControl",
		"ToneControlName",
	]);
	addNumber(out, "minToneWipe", properties, ["MinToneWipe"]);
	addNumber(out, "maxToneWipe", properties, ["MaxToneWipe"]);
	addNumber(out, "defaultToneWipe", properties, [
		"DefaultToneWipe",
		"ToneControlWipe",
	]);
	addNumber(out, "defaultBassWipe", properties, [
		"DefaultBassWipe",
		"BassControlWipe",
	]);
	addNumber(out, "defaultMiddleWipe", properties, [
		"DefaultMiddleWipe",
		"MiddleControlWipe",
	]);
	addNumber(out, "defaultTrebleWipe", properties, [
		"DefaultTrebleWipe",
		"TrebleControlWipe",
	]);
	return out;
}

function activeEqDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	const out = scalarDescriptor(properties, [
		["inputGain", ["InputGain"]],
		["outputGain", ["OutputGain"]],
		["minInputGain", ["MinInputGain"]],
		["maxInputGain", ["MaxInputGain"]],
		["mix", ["Mix"]],
		["minMix", ["MinMix"]],
		["maxMix", ["MaxMix"]],
		["level", ["Level", "OutputLevel"]],
		["minOutputLevel", ["MinOutputLevel"]],
		["maxOutputLevel", ["MaxOutputLevel"]],
		["headroom", ["Headroom"]],
	]);

	const descriptor: MutableProperties = {};
	addNumber(descriptor, "preEmphasisGainDb", properties, [
		"DescriptorPreEmphasisGainDb",
		"PreEmphasisGainDb",
	]);
	addString(descriptor, "saturationMode", properties, ["SaturationMode"]);
	addNumber(descriptor, "saturationPositiveScale", properties, [
		"SaturationPositiveScale",
	]);
	addNumber(descriptor, "saturationNegativeScale", properties, [
		"SaturationNegativeScale",
	]);
	if (Object.keys(descriptor).length > 0) {
		out.descriptor = descriptor;
	}

	const bands = parseActiveEqBands(properties);
	if (bands.length > 0) {
		out.bands = bands;
	}
	return out;
}

function delayChipDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	const out = scalarDescriptor(properties, [
		["inputGain", ["InputGain"]],
		["outputGain", ["OutputGain"]],
		["minDelayMs", ["MinDelayMs"]],
		["maxDelayMs", ["MaxDelayMs"]],
		["defaultDelayMs", ["DefaultDelayMs", "DelayMs"]],
		["feedback", ["Feedback"]],
		["minFeedback", ["MinFeedback"]],
		["maxFeedback", ["MaxFeedback"]],
		["mix", ["Mix"]],
		["level", ["Level", "OutputLevel"]],
		["minOutputLevel", ["MinOutputLevel"]],
		["maxOutputLevel", ["MaxOutputLevel"]],
		["tone", ["Tone"]],
		["modRateHz", ["ModRateHz"]],
		["minModRateHz", ["MinModRateHz"]],
		["maxModRateHz", ["MaxModRateHz"]],
		["modDepthMs", ["ModDepthMs"]],
		["minModDepthMs", ["MinModDepthMs"]],
		["maxModDepthMs", ["MaxModDepthMs"]],
		["inputDrive", ["InputDrive"]],
		["headroom", ["Headroom"]],
		["stereoOutputMode", ["StereoOutputMode"]],
	]);
	addBoolean(out, "wetOnly", properties, ["WetOnly"]);
	addBoolean(out, "dryUnity", properties, ["DryUnity"]);
	addBoolean(out, "hold", properties, ["Hold"]);
	addBoolean(out, "samplerRecordPlay", properties, ["SamplerRecordPlay"]);

	const mechanism: MutableProperties = {};
	addString(mechanism, "memoryType", properties, ["MemoryType"]);
	addNumber(mechanism, "stageCount", properties, ["StageCount"]);
	addNumber(mechanism, "artifactSeed", properties, ["ArtifactSeed"]);
	addNumber(mechanism, "clockNoiseRms", properties, ["ClockNoiseRms"]);
	addNumber(mechanism, "clockFeedthroughHz", properties, [
		"ClockFeedthroughHz",
	]);
	addNumber(mechanism, "clockJitterDepthMs", properties, [
		"ClockJitterDepthMs",
	]);
	addNumber(mechanism, "companderResidualAmount", properties, [
		"CompanderResidualAmount",
	]);
	addNumber(mechanism, "baseBandwidthHz", properties, ["BaseBandwidthHz"]);
	addNumber(mechanism, "darkBandwidthHz", properties, ["DarkBandwidthHz"]);
	addNumber(mechanism, "feedbackLimit", properties, ["FeedbackLimit"]);
	addNumber(mechanism, "quantizationBits", properties, ["QuantizationBits"]);
	addString(mechanism, "memoryCompressionMode", properties, [
		"MemoryCompressionMode",
	]);
	addBoolean(mechanism, "supplySensitive", properties, ["SupplySensitive"]);
	addNumber(mechanism, "minDelayFloorMs", properties, ["MinDelayFloorMs"]);
	addString(mechanism, "dryBlendPolicy", properties, ["DryBlendPolicy"]);
	if (Object.keys(mechanism).length > 0) {
		out.mechanism = mechanism;
	}
	return out;
}

function reverbDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	const out = scalarDescriptor(properties, [
		["inputGain", ["InputGain"]],
		["outputGain", ["OutputGain"]],
		["preDelayMs", ["PreDelayMs"]],
		["decay", ["Decay"]],
		["mix", ["Mix"]],
		["level", ["Level", "OutputLevel"]],
		["minOutputLevel", ["MinOutputLevel"]],
		["maxOutputLevel", ["MaxOutputLevel"]],
		["tone", ["Tone"]],
		["damping", ["Damping"]],
		["size", ["Size"]],
		["modRateHz", ["ModRateHz"]],
		["modDepthMs", ["ModDepthMs"]],
		["headroom", ["Headroom"]],
		["stereoOutputMode", ["StereoOutputMode"]],
	]);

	const algorithm: MutableProperties = {};
	addString(algorithm, "profileAllPassMode", properties, [
		"ProfileAllPassMode",
	]);
	addNumberArray(algorithm, "tankBaseMs", properties, ["TankBaseMs"], 4);
	addNumberArray(
		algorithm,
		"profileAllPassBaseMs",
		properties,
		["ProfileAllPassBaseMs"],
		2,
	);
	addNumberArray(
		algorithm,
		"profileAllPassSizeMs",
		properties,
		["ProfileAllPassSizeMs"],
		2,
	);
	addNumber(algorithm, "brightBandwidthHz", properties, ["BrightBandwidthHz"]);
	addNumber(algorithm, "darkBandwidthHz", properties, ["DarkBandwidthHz"]);
	addNumber(algorithm, "feedbackTrim", properties, ["FeedbackTrim"]);
	addNumber(algorithm, "springFlutterBaseSamples", properties, [
		"SpringFlutterBaseSamples",
	]);
	addNumber(algorithm, "springFlutterSizeSamples", properties, [
		"SpringFlutterSizeSamples",
	]);
	addNumber(algorithm, "dampingMinimum", properties, ["DampingMinimum"]);
	addNumber(algorithm, "dampingScale", properties, ["DampingScale"]);
	if (Object.keys(algorithm).length > 0) {
		out.algorithm = algorithm;
	}
	return out;
}

function compressorDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	const out = scalarDescriptor(properties, [
		["inputGain", ["InputGain"]],
		["outputGain", ["OutputGain"]],
		["detectorMode", ["DetectorMode"]],
		["sensitivity", ["Sensitivity"]],
		["minSensitivity", ["MinSensitivity"]],
		["maxSensitivity", ["MaxSensitivity"]],
		["level", ["Level", "OutputLevel"]],
		["minOutputLevel", ["MinOutputLevel"]],
		["maxOutputLevel", ["MaxOutputLevel"]],
		["attackMs", ["AttackMs"]],
		["minAttackMs", ["MinAttackMs"]],
		["maxAttackMs", ["MaxAttackMs"]],
		["releaseMs", ["ReleaseMs"]],
		["minReleaseMs", ["MinReleaseMs"]],
		["maxReleaseMs", ["MaxReleaseMs"]],
		["ratio", ["Ratio"]],
		["thresholdDb", ["ThresholdDb"]],
		["kneeDb", ["KneeDb"]],
		["mix", ["Mix"]],
		["tone", ["Tone"]],
		["inputDrive", ["InputDrive"]],
		["minInputDrive", ["MinInputDrive"]],
		["maxInputDrive", ["MaxInputDrive"]],
		["headroom", ["Headroom"]],
	]);
	const topology: MutableProperties = {};
	addString(topology, "topology", properties, ["Topology"]);
	addNumber(topology, "otaProfileScale", properties, ["OtaProfileScale"]);
	addNumber(topology, "makeupGainScale", properties, ["MakeupGainScale"]);
	if (Object.keys(topology).length > 0) {
		out.topology = topology;
	}
	return out;
}

function octaveDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
): MutableProperties {
	return scalarDescriptor(properties, [
		["inputGain", ["InputGain"]],
		["outputGain", ["OutputGain"]],
		["algorithm", ["Algorithm", "Mechanism"]],
		["dividerMode", ["DividerMode"]],
		["dividerStages", ["DividerStages"]],
		["trackerCutoffHz", ["TrackerCutoffHz"]],
		["schmittHysteresis", ["SchmittHysteresis"]],
		["gateThreshold", ["GateThreshold"]],
		["gateRelease", ["GateRelease"]],
		["square1CutoffHz", ["Square1CutoffHz"]],
		["square2CutoffHz", ["Square2CutoffHz"]],
		["chopperPreCutoffHz", ["ChopperPreCutoffHz"]],
		["chopperPostCutoffHz", ["ChopperPostCutoffHz"]],
		["chopperControlCutoffHz", ["ChopperControlCutoffHz"]],
		["inputDrive", ["InputDrive"]],
		["minInputDrive", ["MinInputDrive"]],
		["maxInputDrive", ["MaxInputDrive"]],
		["headroom", ["Headroom"]],
		["mix", ["Mix"]],
		["minMix", ["MinMix"]],
		["maxMix", ["MaxMix"]],
		["level", ["Level", "OutputLevel"]],
		["minOutputLevel", ["MinOutputLevel"]],
		["maxOutputLevel", ["MaxOutputLevel"]],
		["toneHz", ["ToneHz"]],
		["minToneHz", ["MinToneHz"]],
		["maxToneHz", ["MaxToneHz"]],
		["directLevel", ["DirectLevel"]],
		["oct1Level", ["Oct1Level"]],
		["oct2Level", ["Oct2Level"]],
		["carrierModRateHz", ["CarrierModRateHz"]],
		["minCarrierModRateHz", ["MinCarrierModRateHz", "MinLfoRateHz"]],
		["maxCarrierModRateHz", ["MaxCarrierModRateHz", "MaxLfoRateHz"]],
		["carrierModAmount", ["CarrierModAmount", "LfoAmount"]],
		["carrierModShape", ["CarrierModShape", "LfoShape"]],
	]);
}

const COMMON_RUNTIME_FIELDS: readonly [string, readonly string[]][] = [
	["inputGain", ["InputGain"]],
	["outputGain", ["OutputGain"]],
	["sensitivity", ["Sensitivity"]],
	["minSensitivity", ["MinSensitivity"]],
	["maxSensitivity", ["MaxSensitivity"]],
	["attackMs", ["AttackMs"]],
	["minAttackMs", ["MinAttackMs"]],
	["maxAttackMs", ["MaxAttackMs"]],
	["releaseMs", ["ReleaseMs"]],
	["minReleaseMs", ["MinReleaseMs"]],
	["maxReleaseMs", ["MaxReleaseMs"]],
	["triggerThreshold", ["TriggerThreshold"]],
	["minGain", ["MinGain"]],
	["level", ["Level", "OutputLevel"]],
	["minOutputLevel", ["MinOutputLevel"]],
	["maxOutputLevel", ["MaxOutputLevel"]],
	["headroom", ["Headroom"]],
	["mix", ["Mix"]],
	["minMix", ["MinMix"]],
	["maxMix", ["MaxMix"]],
];

function scalarDescriptor(
	properties: Readonly<Record<string, PropertyValue>>,
	fields: readonly [string, readonly string[]][],
): MutableProperties {
	const out: MutableProperties = {};
	for (const [target, sources] of fields) {
		addScalar(out, target, properties, sources);
	}
	return out;
}

function addScalar(
	out: MutableProperties,
	target: string,
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): void {
	const numberValue = firstNumber(properties, sourceNames);
	if (numberValue !== undefined) {
		out[target] = numberValue;
		return;
	}
	addString(out, target, properties, sourceNames);
}

function addString(
	out: MutableProperties,
	target: string,
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): void {
	const value = firstString(properties, sourceNames);
	if (value !== undefined && value.length > 0) {
		out[target] = value;
	}
}

function addNumber(
	out: MutableProperties,
	target: string,
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): void {
	const value = firstNumber(properties, sourceNames);
	if (value !== undefined) {
		out[target] = value;
	}
}

function addBoolean(
	out: MutableProperties,
	target: string,
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): void {
	const value = firstBoolean(properties, sourceNames);
	if (value !== undefined) {
		out[target] = value;
	}
}

function addNumberArray(
	out: MutableProperties,
	target: string,
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
	expectedLength: number,
): void {
	const values = firstNumberList(properties, sourceNames);
	if (values.length === expectedLength) {
		out[target] = values;
	}
}

function firstString(
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): string | undefined {
	for (const sourceName of sourceNames) {
		const value = propertyStringValue(properties[sourceName]);
		if (value !== null) {
			return value;
		}
	}
	return undefined;
}

function firstNumber(
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): number | undefined {
	for (const sourceName of sourceNames) {
		const value = propertyNumericValue(properties[sourceName]);
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

function firstBoolean(
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): boolean | undefined {
	for (const sourceName of sourceNames) {
		const value = propertyBooleanValue(properties[sourceName]);
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

function firstStringList(
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): readonly string[] {
	const value = firstString(properties, sourceNames);
	if (value === undefined) {
		return [];
	}
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function firstNumberList(
	properties: Readonly<Record<string, PropertyValue>>,
	sourceNames: readonly string[],
): readonly number[] {
	const value = firstString(properties, sourceNames);
	if (value === undefined) {
		return [];
	}
	return parseNumberList(value);
}

function parseNumberList(value: string): readonly number[] {
	return value
		.split(",")
		.map((item) => Number.parseFloat(item.trim()))
		.filter((item) => Number.isFinite(item));
}

function parseToneStackSections(
	properties: Readonly<Record<string, PropertyValue>>,
): readonly MutableProperties[] {
	const value = firstString(properties, ["ToneStackSections", "Sections"]);
	if (value === undefined) {
		return [];
	}
	return value
		.split(";")
		.map((section) => parseToneStackSection(section))
		.filter((section) => section !== null);
}

function parseToneStackSection(value: string): MutableProperties | null {
	const [gain, zeroHz, poleHz] = parseNumberList(value);
	if (gain === undefined || zeroHz === undefined || poleHz === undefined) {
		return null;
	}
	return { gain, zeroHz, poleHz };
}

function parseActiveEqBands(
	properties: Readonly<Record<string, PropertyValue>>,
): readonly MutableProperties[] {
	const frequencies = firstNumberList(properties, ["BandFrequenciesHz"]);
	if (frequencies.length === 0) {
		return [];
	}

	const types = firstStringList(properties, ["BandFilterTypes"]);
	const minFrequencies = firstNumberList(properties, ["MinBandFrequenciesHz"]);
	const maxFrequencies = firstNumberList(properties, ["MaxBandFrequenciesHz"]);
	const gains = firstNumberList(properties, ["BandGainsDb"]);
	const minGains = firstNumberList(properties, ["MinBandGainsDb", "MinGainDb"]);
	const maxGains = firstNumberList(properties, ["MaxBandGainsDb", "MaxGainDb"]);
	const qValues = firstNumberList(properties, ["BandQ", "Q"]);
	const labels = firstStringList(properties, ["BandLabels"]);

	return frequencies.map((frequencyHz, index) => {
		const band: MutableProperties = {
			type: types[index] ?? "peaking",
			frequencyHz,
			minFrequencyHz: numberAt(minFrequencies, index, frequencyHz),
			maxFrequencyHz: numberAt(maxFrequencies, index, frequencyHz),
			gainDb: numberAt(gains, index, 0),
			minGainDb: numberAt(minGains, index, -15),
			maxGainDb: numberAt(maxGains, index, 15),
			q: numberAt(qValues, index, 1),
		};
		const label = labels[index];
		if (label !== undefined) {
			band.label = label;
		}
		return band;
	});
}

function numberAt(
	values: readonly number[],
	index: number,
	fallback: number,
): number {
	return values[index] ?? values[0] ?? fallback;
}
