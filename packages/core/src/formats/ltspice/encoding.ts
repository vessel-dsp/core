// LTspice writes .asc files in Windows-1252 on Windows builds, so lone bytes like
// 0xB5 (µ) appear that aren't valid UTF-8. Strict UTF-8 decoding throws on those;
// fall back to Windows-1252 (a superset of Latin-1 within the printable range we
// care about). This is the same heuristic many cross-platform parsers use.
export function decodeLtspiceBytes(bytes: Uint8Array): string {
	try {
		return decodeUtf8Strict(bytes);
	} catch {
		return decodeWindows1252(bytes);
	}
}

const WINDOWS_1252_CONTROL_CODEPOINTS: readonly number[] = [
	0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
	0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018,
	0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
	0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function decodeWindows1252(bytes: Uint8Array): string {
	const codePoints: number[] = [];

	for (const byte of bytes) {
		if (byte >= 0x80 && byte <= 0x9f) {
			codePoints.push(WINDOWS_1252_CONTROL_CODEPOINTS[byte - 0x80] ?? byte);
		} else {
			codePoints.push(byte);
		}
	}

	return codePointsToString(codePoints);
}

function decodeUtf8Strict(bytes: Uint8Array): string {
	const codePoints: number[] = [];

	for (let index = 0; index < bytes.length; ) {
		const first = requireByte(bytes, index);

		if (first <= 0x7f) {
			codePoints.push(first);
			index += 1;
			continue;
		}

		if (first >= 0xc2 && first <= 0xdf) {
			const second = continuationBits(requireByte(bytes, index + 1));
			codePoints.push(((first & 0x1f) << 6) | second);
			index += 2;
			continue;
		}

		if (first >= 0xe0 && first <= 0xef) {
			const secondByte = requireByte(bytes, index + 1);
			const second = continuationBits(secondByte);
			const third = continuationBits(requireByte(bytes, index + 2));

			if (first === 0xe0 && secondByte < 0xa0) {
				throw new Error("Overlong UTF-8 sequence");
			}

			if (first === 0xed && secondByte >= 0xa0) {
				throw new Error("UTF-8 surrogate sequence");
			}

			codePoints.push(((first & 0x0f) << 12) | (second << 6) | third);
			index += 3;
			continue;
		}

		if (first >= 0xf0 && first <= 0xf4) {
			const secondByte = requireByte(bytes, index + 1);
			const second = continuationBits(secondByte);
			const third = continuationBits(requireByte(bytes, index + 2));
			const fourth = continuationBits(requireByte(bytes, index + 3));

			if (first === 0xf0 && secondByte < 0x90) {
				throw new Error("Overlong UTF-8 sequence");
			}

			if (first === 0xf4 && secondByte > 0x8f) {
				throw new Error("UTF-8 code point out of range");
			}

			codePoints.push(
				((first & 0x07) << 18) | (second << 12) | (third << 6) | fourth,
			);
			index += 4;
			continue;
		}

		throw new Error("Invalid UTF-8 sequence");
	}

	return codePointsToString(codePoints);
}

function requireByte(bytes: Uint8Array, index: number): number {
	const byte = bytes[index];
	if (byte === undefined) {
		throw new Error("Truncated byte sequence");
	}

	return byte;
}

function continuationBits(byte: number): number {
	if ((byte & 0xc0) !== 0x80) {
		throw new Error("Invalid UTF-8 continuation byte");
	}

	return byte & 0x3f;
}

function codePointsToString(codePoints: readonly number[]): string {
	const chunks: string[] = [];

	for (let index = 0; index < codePoints.length; index += 8192) {
		chunks.push(String.fromCodePoint(...codePoints.slice(index, index + 8192)));
	}

	return chunks.join("");
}
