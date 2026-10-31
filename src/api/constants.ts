/**
 * Total Connect 2.0 protocol constants.
 *
 * Values were verified against the official TC2 REST help pages
 * (https://rs.alarmnet.com/TC2API.TCResource/Help) and cross-checked against the
 * long-running open-source `total-connect-client` project used by Home Assistant.
 */

/** Hard-coded fallbacks. The plugin prefers the values advertised by the bootstrap config. */
export const BOOTSTRAP_CONFIG_URL = 'https://totalconnect2.com/application.config.json';
export const DEFAULT_AUTH_URL = 'https://rs.alarmnet.com/TC2API.Auth/token';
export const DEFAULT_RESOURCE_URL = 'https://rs.alarmnet.com/TC2API.TCResource/api';

/** Hosts we are willing to send credentials / tokens to. Anything else is rejected. */
export const TRUSTED_API_HOST_SUFFIXES = ['.alarmnet.com'] as const;

/** Brand name in the bootstrap config whose AppID is used for session details. */
export const DEFAULT_BRAND = 'totalconnect';

/** Arm types accepted by `PUT .../partitions/arm` (field `armType`). */
export enum ArmType {
  AWAY = 0,
  STAY = 1,
  STAY_INSTANT = 2,
  AWAY_INSTANT = 3,
  STAY_NIGHT = 4,
}

/** Panel / partition arming states reported by `.../partitions/fullStatus`. */
export enum ArmingState {
  UNKNOWN = 0,

  DISARMED = 10200,
  DISARMED_BYPASS = 10211,
  DISARMED_ZONE_FAULTED = 10214,

  ARMED_AWAY = 10201,
  ARMED_AWAY_BYPASS = 10202,
  ARMED_AWAY_INSTANT = 10205,
  ARMED_AWAY_INSTANT_BYPASS = 10206,

  ARMED_STAY = 10203,
  ARMED_STAY_BYPASS = 10204,
  ARMED_STAY_OTHER = 10226,
  ARMED_STAY_PROA7 = 10230,
  ARMED_STAY_BYPASS_PROA7 = 10231,
  ARMED_CUSTOM_BYPASS = 10223,

  ARMED_STAY_INSTANT = 10209,
  ARMED_STAY_INSTANT_BYPASS = 10210,
  ARMED_STAY_INSTANT_PROA7 = 10232,
  ARMED_STAY_INSTANT_BYPASS_PROA7 = 10233,

  ARMED_STAY_NIGHT = 10218,
  ARMED_STAY_NIGHT_BYPASS_PROA7 = 10219,
  ARMED_STAY_NIGHT_INSTANT_PROA7 = 10220,
  ARMED_STAY_NIGHT_INSTANT_BYPASS_PROA7 = 10221,

  ALARMING = 10207,
  ALARMING_FIRE_SMOKE = 10212,
  ALARMING_CARBON_MONOXIDE = 10213,
  ALARMING_CARBON_MONOXIDE_PROA7 = 10215,

  ARMING = 10307,
  DISARMING = 10308,
}

/** API `ResultCode` values. Positive 4500 means "accepted, in progress". */
export enum ResultCode {
  SUCCESS = 0,
  COMMAND_ACCEPTED = 4500,
  CONNECTION_ERROR = 4101,

  INVALID_SESSION = -102,
  AUTHENTICATION_FAILED = -100,
  FEATURE_NOT_SUPPORTED = -120,
  ACCOUNT_LOCKED = -123,
  BAD_OBJECT_REFERENCE = -400,
  INVALID_PARAMETER = -501,
  FAILED_TO_CONNECT = -4104,
  USER_CODE_INVALID = -4106,
  CANNOT_CONNECT = -4108,
  USER_CODE_UNAVAILABLE = -4114,
  COMMAND_FAILED = -4502,
  FAILED_TO_BYPASS_ZONE = -4504,
  INVALID_SESSION_ID = -30002,
  BAD_USER_OR_PASSWORD = -50004,
}

export const SUCCESS_CODES: ReadonlySet<number> = new Set([ResultCode.SUCCESS, ResultCode.COMMAND_ACCEPTED]);
export const SESSION_CODES: ReadonlySet<number> = new Set([ResultCode.INVALID_SESSION, ResultCode.INVALID_SESSION_ID]);
export const TRANSIENT_CODES: ReadonlySet<number> = new Set([
  ResultCode.CONNECTION_ERROR,
  ResultCode.FAILED_TO_CONNECT,
  ResultCode.CANNOT_CONNECT,
  ResultCode.BAD_OBJECT_REFERENCE,
]);
export const CREDENTIAL_CODES: ReadonlySet<number> = new Set([
  ResultCode.BAD_USER_OR_PASSWORD,
  ResultCode.AUTHENTICATION_FAILED,
  ResultCode.ACCOUNT_LOCKED,
]);

/** Zone status is a bit field. */
export enum ZoneStatusFlag {
  NORMAL = 0,
  BYPASSED = 1,
  /** Only reported when "Sensor Events" are enabled on the account by the dealer. */
  FAULT = 2,
  TROUBLE = 8,
  TAMPER = 16,
  COMMUNICATION_FAILURE = 32,
  LOW_BATTERY = 64,
  TRIGGERED = 256,
}

/** Honeywell zone types (ZoneTypeId). Not exhaustive: unknown values are tolerated. */
export enum ZoneType {
  SECURITY = 0,
  ENTRY_EXIT_1 = 1,
  ENTRY_EXIT_2 = 2,
  PERIMETER = 3,
  INTERIOR_FOLLOWER = 4,
  TROUBLE_ALARM = 5,
  SILENT_24HR = 6,
  AUDIBLE_24HR = 7,
  AUX_24HR = 8,
  FIRE_SMOKE = 9,
  INTERIOR_DELAY = 10,
  MONITOR = 12,
  CARBON_MONOXIDE = 14,
  PROA7_MEDICAL = 15,
  FIRE_WITH_VERIFICATION = 16,
  RF_ARM_STAY = 20,
  RF_ARM_AWAY = 21,
  RF_DISARM = 22,
  NO_ALARM_RESPONSE = 23,
  SILENT_BURGLARY = 24,
  LYRIC_KEYPAD = 50,
  PROA7_GARAGE_MONITOR = 53,
  KEYSWITCH = 77,
  AAV_MONITOR = 81,
  LYRIC_LOCAL_ALARM = 89,
}

/** Default value the API accepts when the panel does not require a user code. */
export const NO_USER_CODE = '-1';

