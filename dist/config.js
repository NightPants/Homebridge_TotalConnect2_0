import { ArmType } from './api/constants.js';
export const POLLING_MIN_S = 10;
export const POLLING_MAX_S = 3_600;
export class ConfigError extends Error {
}
const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const intSet = (value) => new Set((Array.isArray(value) ? value : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0));
const USER_CODE_RE = /^(-1|\d{4,8})$/;
function validUserCode(code, where) {
    if (code === undefined || code === null || code === '') {
        return undefined;
    }
    const s = String(code).trim();
    if (!USER_CODE_RE.test(s)) {
        throw new ConfigError(`${where}: user code must be 4-8 digits`);
    }
    return s;
}
/**
 * Validates and normalises the raw config. Credentials can be supplied through the
 * `TOTALCONNECT_USERNAME`, `TOTALCONNECT_PASSWORD` and `TOTALCONNECT_USERCODE` environment
 * variables, which take precedence and keep secrets out of config.json.
 */
export function resolveConfig(raw, env = process.env) {
    const username = (env.TOTALCONNECT_USERNAME ?? raw.username ?? '').trim();
    const password = env.TOTALCONNECT_PASSWORD ?? raw.password ?? '';
    if (!username || !password) {
        throw new ConfigError('Total Connect username and password are required');
    }
    const userCode = validUserCode(env.TOTALCONNECT_USERCODE ?? raw.userCode, 'userCode') ?? '-1';
    const locations = new Map();
    for (const loc of raw.locations ?? []) {
        const id = Number(loc?.locationId);
        if (!Number.isInteger(id) || id <= 0) {
            continue;
        }
        locations.set(id, {
            locationId: id,
            name: loc.name?.trim() || undefined,
            userCode: validUserCode(loc.userCode, `locations[${id}]`),
            enabled: loc.enabled !== false,
        });
    }
    const zoneTypes = ['auto', 'contact', 'motion', 'smoke', 'carbonMonoxide', 'leak', 'occupancy', 'hidden'];
    const zoneOverrides = (raw.zoneOverrides ?? [])
        .filter((o) => Number.isInteger(Number(o?.zoneId)))
        .map((o) => ({
        locationId: o.locationId !== undefined && o.locationId !== null ? Number(o.locationId) : undefined,
        zoneId: Number(o.zoneId),
        name: o.name?.trim() || undefined,
        type: oneOf(o.type, zoneTypes, 'auto'),
    }));
    const pollingS = clamp(raw.pollingInterval, POLLING_MIN_S, POLLING_MAX_S, 30);
    const allSwitches = ['away', 'stay', 'night'];
    return {
        username,
        password,
        userCode,
        locations,
        partitionMode: oneOf(raw.partitionMode, ['combined', 'separate'], 'combined'),
        homeMode: oneOf(raw.homeMode, ['stay', 'stayInstant', 'night', 'away', 'awayInstant'], 'stay'),
        nightMode: oneOf(raw.nightMode, ['auto', 'stay', 'stayInstant', 'night', 'away', 'awayInstant', 'disabled'], 'auto'),
        awayMode: oneOf(raw.awayMode, ['away', 'awayInstant'], 'away'),
        allowDisarm: raw.allowDisarm !== false,
        autoBypassOnArm: raw.autoBypassOnArm === true,
        autoBypassLowBattery: raw.autoBypassLowBattery === true,
        armingSwitches: new Set((raw.armingSwitches ?? []).filter((s) => allSwitches.includes(s))),
        bypassSwitches: raw.bypassSwitches === true,
        alarmSensor: raw.alarmSensor === true,
        zoneExposure: oneOf(raw.zoneExposure, ['all', 'none', 'selected'], 'all'),
        zoneIds: intSet(raw.zoneIds),
        excludeZoneIds: intSet(raw.excludeZoneIds),
        zoneOverrides,
        zoneBypassSwitches: raw.zoneBypassSwitches === true,
        hideButtonZones: raw.hideButtonZones !== false,
        pollingIntervalMs: pollingS * 1_000,
        fastPollingIntervalMs: clamp(raw.fastPollingInterval, 2, 30, 4) * 1_000,
        requestTimeoutMs: clamp(raw.requestTimeout, 5, 120, 30) * 1_000,
        verboseLogging: raw.verboseLogging === true,
    };
}
/** Maps a configured arm mode to the API ArmType. */
export function armTypeFor(mode) {
    switch (mode) {
        case 'away':
            return ArmType.AWAY;
        case 'awayInstant':
            return ArmType.AWAY_INSTANT;
        case 'stayInstant':
            return ArmType.STAY_INSTANT;
        case 'night':
            return ArmType.STAY_NIGHT;
        case 'stay':
        default:
            return ArmType.STAY;
    }
}
//# sourceMappingURL=config.js.map