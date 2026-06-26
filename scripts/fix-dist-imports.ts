import { Glob } from "bun";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELATIVE_ESM_SPECIFIER =
	/(\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)(['"])/g;

export function rewriteRelativeEsmSpecifiers(
	source: string,
	fileUrl: URL,
	existingFiles?: ReadonlySet<string>,
): string {
	const filePath = fileURLToPath(fileUrl);
	return source.replace(
		RELATIVE_ESM_SPECIFIER,
		(
			match: string,
			prefix: string,
			quote: string,
			specifier: string,
			closingQuote: string,
		) => {
			if (quote !== closingQuote || hasExtension(specifier)) {
				return match;
			}

			const resolved = resolveSpecifier(filePath, specifier, existingFiles);
			if (resolved === specifier) {
				return match;
			}

			return `${prefix}${quote}${resolved}${closingQuote}`;
		},
	);
}

export async function rewriteDistImports(distDir = "dist"): Promise<void> {
	const glob = new Glob("**/*.js");
	for await (const relativePath of glob.scan({
		cwd: distDir,
		onlyFiles: true,
	})) {
		const filePath = resolve(distDir, relativePath);
		const fileUrl = pathToFileURL(filePath);
		const source = await readFile(filePath, "utf8");
		const rewritten = rewriteRelativeEsmSpecifiers(source, fileUrl);
		if (rewritten !== source) {
			await writeFile(filePath, rewritten);
		}
	}
}

function resolveSpecifier(
	filePath: string,
	specifier: string,
	existingFiles?: ReadonlySet<string>,
): string {
	const absoluteBase = resolve(dirname(filePath), specifier);
	if (fileExists(`${absoluteBase}.js`, existingFiles)) {
		return `${specifier}.js`;
	}
	if (fileExists(resolve(absoluteBase, "index.js"), existingFiles)) {
		return `${specifier}/index.js`;
	}
	return specifier;
}

function fileExists(
	filePath: string,
	existingFiles?: ReadonlySet<string>,
): boolean {
	return existingFiles?.has(filePath) ?? existsSync(filePath);
}

function hasExtension(specifier: string): boolean {
	const lastSegment = specifier.split("/").at(-1) ?? "";
	return /\.[a-zA-Z0-9]+$/.test(lastSegment);
}

if (import.meta.main) {
	await rewriteDistImports(process.argv[2] ?? "dist");
}
