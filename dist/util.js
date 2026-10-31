import { readFileSync } from 'node:fs';
/** Plugin version, read once from package.json (shown as firmware revision in HomeKit). */
export const PLUGIN_VERSION = (() => {
    try {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
})();
/**
 * HomeKit names must start and end with a letter or number and may only contain letters,
 * numbers, spaces, apostrophes, hyphens, commas and periods. Invalid names are rejected
 * by Homebridge 2 / iOS, so everything coming from the panel is sanitised.
 */
export function safeName(name, fallback = 'Total Connect') {
    const cleaned = name
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N} '\-,.]/gu, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .slice(0, 64)
        .trim();
    return cleaned || fallback;
}
export function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=util.js.map