import type { PlatformConfig } from 'homebridge';

import { ArmType } from './api/constants.js';

export type HomeArmMode = 'stay' | 'stayInstant' | 'night' | 'away' | 'awayInstant';
export type NightArmMode = HomeArmMode | 'auto' | 'disabled';
export type AwayArmMode = 'away' | 'awayInstant';
export type PartitionMode = 'combined' | 'separate';
export type ZoneSensorType = 'auto' | 'contact' | 'motion' | 'smoke' | 'carbonMonoxide' | 'leak' | 'occupancy' | 'hidden';
export type ZoneExposure = 'all' | 'none' | 'selected';
export type ArmingSwitch = 'away' | 'stay' | 'night';

export interface ZoneOverride {
  locationId?: number;
  zoneId: number;
  name?: string;
  type?: ZoneSensorType;
}

export interface LocationOverride {
  locationId: number;
  userCode?: string;
  name?: string;
  enabled?: boolean;
}

/** Raw config as written by the Homebridge UI. */
export interface TotalConnectPlatformConfig extends PlatformConfig {
  username?: string;
  password?: string;
  userCode?: string;
  locations?: LocationOverride[];

  partitionMode?: PartitionMode;
  homeMode?: HomeArmMode;
  nightMode?: NightArmMode;
  awayMode?: AwayArmMode;
  allowDisarm?: boolean;

  autoBypassOnArm?: boolean;
  autoBypassLowBattery?: boolean;
  armingSwitches?: ArmingSwitch[];
  bypassSwitches?: boolean;
  alarmSensor?: boolean;

  zoneExposure?: ZoneExposure;
  zoneIds?: number[];
  excludeZoneIds?: number[];
  zoneOverrides?: ZoneOverride[];
  zoneBypassSwitches?: boolean;
  hideButtonZones?: boolean;

  pollingInterval?: number;
  fastPollingInterval?: number;
  requestTimeout?: number;
  verboseLogging?: boolean;
}

/** Validated, defaulted config used by the platform at runtime. */
export interface ResolvedConfig {
  username: string;
  password: string;
  userCode: string;
  locations: Map<number, LocationOverride>;

  partitionMode: PartitionMode;
  homeMode: HomeArmMode;
  nightMode: NightArmMode;
  awayMode: AwayArmMode;
  allowDisarm: boolean;

  autoBypassOnArm: boolean;
  autoBypassLowBattery: boolean;
  armingSwitches: Set<ArmingSwitch>;
  bypassSwitches: boolean;
  alarmSensor: boolean;

  zoneExposure: ZoneExposure;
  zoneIds: Set<number>;
  excludeZoneIds: Set<number>;
  zoneOverrides: ZoneOverride[];
  zoneBypassSwitches: boolean;
  hideButtonZones: boolean;

  pollingIntervalMs: number;
  fastPollingIntervalMs: number;
  requestTimeoutMs: number;
  verboseLogging: boolean;
}

export const POLLING_MIN_S = 10;
export const POLLING_MAX_S = 3_600;

export class ConfigError extends Error {}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const intSet = (value: unknown): Set<number> =>
  new Set(
    (Array.isArray(value) ? value : [])
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0),
  );

const USER_CODE_RE = /^(-1|\d{4,8})$/;

function validUserCode(code: unknown, where: string): string | undefined {
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
export function resolveConfig(raw: TotalConnectPlatformConfig, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const username = (env.TOTALCONNECT_USERNAME ?? raw.username ?? '').trim();
  const password = env.TOTALCONNECT_PASSWORD ?? raw.password ?? '';
  if (!username || !password) {
    throw new ConfigError('Total Connect username and password are required');
  }

  const userCode = validUserCode(env.TOTALCONNECT_USERCODE ?? raw.userCode, 'userCode') ?? '-1';

  const locations = new Map<number, LocationOverride>();
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

  const zoneTypes: ZoneSensorType[] = ['auto', 'contact', 'motion', 'smoke', 'carbonMonoxide', 'leak', 'occupancy', 'hidden'];
  const zoneOverrides: ZoneOverride[] = (raw.zoneOverrides ?? [])
    .filter((o) => Number.isInteger(Number(o?.zoneId)))
    .map((o) => ({
      locationId: o.locationId !== undefined && o.locationId !== null ? Number(o.locationId) : undefined,
      zoneId: Number(o.zoneId),
      name: o.name?.trim() || undefined,
      type: oneOf(o.type, zoneTypes, 'auto'),
    }));

  const pollingS = clamp(raw.pollingInterval, POLLING_MIN_S, POLLING_MAX_S, 30);
  const allSwitches: ArmingSwitch[] = ['away', 'stay', 'night'];

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
    armingSwitches: new Set((raw.armingSwitches ?? []).filter((s): s is ArmingSwitch => allSwitches.includes(s))),
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
export function armTypeFor(mode: HomeArmMode): ArmType {
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

