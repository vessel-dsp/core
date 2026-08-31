/**
 * Shared token normalization for vocabulary lookups.
 *
 * Consumers and authors vary case, spacing and separators for the same token, so
 * every vocabulary in the model compares normalized forms. Extracted because the
 * same four lines were duplicated in `validation.ts` and `panel/extract.ts`, and
 * a second copy is how two vocabularies drift apart.
 */
export function normalizeToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");
}
