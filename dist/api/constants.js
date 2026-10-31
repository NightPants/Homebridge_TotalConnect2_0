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
export const TRUSTED_API_HOST_SUFFIXES = ['.alarmnet.com'];
/** Brand name in the bootstrap config whose AppID is used for session details. */
export const DEFAULT_BRAND = 'totalconnect';
/** Arm types accepted by `PUT .../partitions/arm` (field `armType`). */
export var ArmType;
(function (ArmType) {
    ArmType[ArmType["AWAY"] = 0] = "AWAY";
    ArmType[ArmType["STAY"] = 1] = "STAY";
    ArmType[ArmType["STAY_INSTANT"] = 2] = "STAY_INSTANT";
    ArmType[ArmType["AWAY_INSTANT"] = 3] = "AWAY_INSTANT";
    ArmType[ArmType["STAY_NIGHT"] = 4] = "STAY_NIGHT";
})(ArmType || (ArmType = {}));
/** Panel / partition arming states reported by `.../partitions/fullStatus`. */
export var ArmingState;
(function (ArmingState) {
    ArmingState[ArmingState["UNKNOWN"] = 0] = "UNKNOWN";
    ArmingState[ArmingState["DISARMED"] = 10200] = "DISARMED";
    ArmingState[ArmingState["DISARMED_BYPASS"] = 10211] = "DISARMED_BYPASS";
    ArmingState[ArmingState["DISARMED_ZONE_FAULTED"] = 10214] = "DISARMED_ZONE_FAULTED";
    ArmingState[ArmingState["ARMED_AWAY"] = 10201] = "ARMED_AWAY";
    ArmingState[ArmingState["ARMED_AWAY_BYPASS"] = 10202] = "ARMED_AWAY_BYPASS";
    ArmingState[ArmingState["ARMED_AWAY_INSTANT"] = 10205] = "ARMED_AWAY_INSTANT";
    ArmingState[ArmingState["ARMED_AWAY_INSTANT_BYPASS"] = 10206] = "ARMED_AWAY_INSTANT_BYPASS";
    ArmingState[ArmingState["ARMED_STAY"] = 10203] = "ARMED_STAY";
    ArmingState[ArmingState["ARMED_STAY_BYPASS"] = 10204] = "ARMED_STAY_BYPASS";
    ArmingState[ArmingState["ARMED_STAY_OTHER"] = 10226] = "ARMED_STAY_OTHER";
    ArmingState[ArmingState["ARMED_STAY_PROA7"] = 10230] = "ARMED_STAY_PROA7";
    ArmingState[ArmingState["ARMED_STAY_BYPASS_PROA7"] = 10231] = "ARMED_STAY_BYPASS_PROA7";
    ArmingState[ArmingState["ARMED_CUSTOM_BYPASS"] = 10223] = "ARMED_CUSTOM_BYPASS";
    ArmingState[ArmingState["ARMED_STAY_INSTANT"] = 10209] = "ARMED_STAY_INSTANT";
    ArmingState[ArmingState["ARMED_STAY_INSTANT_BYPASS"] = 10210] = "ARMED_STAY_INSTANT_BYPASS";
    ArmingState[ArmingState["ARMED_STAY_INSTANT_PROA7"] = 10232] = "ARMED_STAY_INSTANT_PROA7";
    ArmingState[ArmingState["ARMED_STAY_INSTANT_BYPASS_PROA7"] = 10233] = "ARMED_STAY_INSTANT_BYPASS_PROA7";
    ArmingState[ArmingState["ARMED_STAY_NIGHT"] = 10218] = "ARMED_STAY_NIGHT";
    ArmingState[ArmingState["ARMED_STAY_NIGHT_BYPASS_PROA7"] = 10219] = "ARMED_STAY_NIGHT_BYPASS_PROA7";
    ArmingState[ArmingState["ARMED_STAY_NIGHT_INSTANT_PROA7"] = 10220] = "ARMED_STAY_NIGHT_INSTANT_PROA7";
    ArmingState[ArmingState["ARMED_STAY_NIGHT_INSTANT_BYPASS_PROA7"] = 10221] = "ARMED_STAY_NIGHT_INSTANT_BYPASS_PROA7";
    ArmingState[ArmingState["ALARMING"] = 10207] = "ALARMING";
    ArmingState[ArmingState["ALARMING_FIRE_SMOKE"] = 10212] = "ALARMING_FIRE_SMOKE";
    ArmingState[ArmingState["ALARMING_CARBON_MONOXIDE"] = 10213] = "ALARMING_CARBON_MONOXIDE";
    ArmingState[ArmingState["ALARMING_CARBON_MONOXIDE_PROA7"] = 10215] = "ALARMING_CARBON_MONOXIDE_PROA7";
    ArmingState[ArmingState["ARMING"] = 10307] = "ARMING";
    ArmingState[ArmingState["DISARMING"] = 10308] = "DISARMING";
})(ArmingState || (ArmingState = {}));
/** API `ResultCode` values. Positive 4500 means "accepted, in progress". */
export var ResultCode;
(function (ResultCode) {
    ResultCode[ResultCode["SUCCESS"] = 0] = "SUCCESS";
    ResultCode[ResultCode["COMMAND_ACCEPTED"] = 4500] = "COMMAND_ACCEPTED";
    ResultCode[ResultCode["CONNECTION_ERROR"] = 4101] = "CONNECTION_ERROR";
    ResultCode[ResultCode["INVALID_SESSION"] = -102] = "INVALID_SESSION";
    ResultCode[ResultCode["AUTHENTICATION_FAILED"] = -100] = "AUTHENTICATION_FAILED";
    ResultCode[ResultCode["FEATURE_NOT_SUPPORTED"] = -120] = "FEATURE_NOT_SUPPORTED";
    ResultCode[ResultCode["ACCOUNT_LOCKED"] = -123] = "ACCOUNT_LOCKED";
    ResultCode[ResultCode["BAD_OBJECT_REFERENCE"] = -400] = "BAD_OBJECT_REFERENCE";
    ResultCode[ResultCode["INVALID_PARAMETER"] = -501] = "INVALID_PARAMETER";
    ResultCode[ResultCode["FAILED_TO_CONNECT"] = -4104] = "FAILED_TO_CONNECT";
    ResultCode[ResultCode["USER_CODE_INVALID"] = -4106] = "USER_CODE_INVALID";
    ResultCode[ResultCode["CANNOT_CONNECT"] = -4108] = "CANNOT_CONNECT";
    ResultCode[ResultCode["USER_CODE_UNAVAILABLE"] = -4114] = "USER_CODE_UNAVAILABLE";
    ResultCode[ResultCode["COMMAND_FAILED"] = -4502] = "COMMAND_FAILED";
    ResultCode[ResultCode["FAILED_TO_BYPASS_ZONE"] = -4504] = "FAILED_TO_BYPASS_ZONE";
    ResultCode[ResultCode["INVALID_SESSION_ID"] = -30002] = "INVALID_SESSION_ID";
    ResultCode[ResultCode["BAD_USER_OR_PASSWORD"] = -50004] = "BAD_USER_OR_PASSWORD";
})(ResultCode || (ResultCode = {}));
export const SUCCESS_CODES = new Set([ResultCode.SUCCESS, ResultCode.COMMAND_ACCEPTED]);
export const SESSION_CODES = new Set([ResultCode.INVALID_SESSION, ResultCode.INVALID_SESSION_ID]);
export const TRANSIENT_CODES = new Set([
    ResultCode.CONNECTION_ERROR,
    ResultCode.FAILED_TO_CONNECT,
    ResultCode.CANNOT_CONNECT,
    ResultCode.BAD_OBJECT_REFERENCE,
]);
export const CREDENTIAL_CODES = new Set([
    ResultCode.BAD_USER_OR_PASSWORD,
    ResultCode.AUTHENTICATION_FAILED,
    ResultCode.ACCOUNT_LOCKED,
]);
/** Zone status is a bit field. */
export var ZoneStatusFlag;
(function (ZoneStatusFlag) {
    ZoneStatusFlag[ZoneStatusFlag["NORMAL"] = 0] = "NORMAL";
    ZoneStatusFlag[ZoneStatusFlag["BYPASSED"] = 1] = "BYPASSED";
    /** Only reported when "Sensor Events" are enabled on the account by the dealer. */
    ZoneStatusFlag[ZoneStatusFlag["FAULT"] = 2] = "FAULT";
    ZoneStatusFlag[ZoneStatusFlag["TROUBLE"] = 8] = "TROUBLE";
    ZoneStatusFlag[ZoneStatusFlag["TAMPER"] = 16] = "TAMPER";
    ZoneStatusFlag[ZoneStatusFlag["COMMUNICATION_FAILURE"] = 32] = "COMMUNICATION_FAILURE";
    ZoneStatusFlag[ZoneStatusFlag["LOW_BATTERY"] = 64] = "LOW_BATTERY";
    ZoneStatusFlag[ZoneStatusFlag["TRIGGERED"] = 256] = "TRIGGERED";
})(ZoneStatusFlag || (ZoneStatusFlag = {}));
/** Honeywell zone types (ZoneTypeId). Not exhaustive: unknown values are tolerated. */
export var ZoneType;
(function (ZoneType) {
    ZoneType[ZoneType["SECURITY"] = 0] = "SECURITY";
    ZoneType[ZoneType["ENTRY_EXIT_1"] = 1] = "ENTRY_EXIT_1";
    ZoneType[ZoneType["ENTRY_EXIT_2"] = 2] = "ENTRY_EXIT_2";
    ZoneType[ZoneType["PERIMETER"] = 3] = "PERIMETER";
    ZoneType[ZoneType["INTERIOR_FOLLOWER"] = 4] = "INTERIOR_FOLLOWER";
    ZoneType[ZoneType["TROUBLE_ALARM"] = 5] = "TROUBLE_ALARM";
    ZoneType[ZoneType["SILENT_24HR"] = 6] = "SILENT_24HR";
    ZoneType[ZoneType["AUDIBLE_24HR"] = 7] = "AUDIBLE_24HR";
    ZoneType[ZoneType["AUX_24HR"] = 8] = "AUX_24HR";
    ZoneType[ZoneType["FIRE_SMOKE"] = 9] = "FIRE_SMOKE";
    ZoneType[ZoneType["INTERIOR_DELAY"] = 10] = "INTERIOR_DELAY";
    ZoneType[ZoneType["MONITOR"] = 12] = "MONITOR";
    ZoneType[ZoneType["CARBON_MONOXIDE"] = 14] = "CARBON_MONOXIDE";
    ZoneType[ZoneType["PROA7_MEDICAL"] = 15] = "PROA7_MEDICAL";
    ZoneType[ZoneType["FIRE_WITH_VERIFICATION"] = 16] = "FIRE_WITH_VERIFICATION";
    ZoneType[ZoneType["RF_ARM_STAY"] = 20] = "RF_ARM_STAY";
    ZoneType[ZoneType["RF_ARM_AWAY"] = 21] = "RF_ARM_AWAY";
    ZoneType[ZoneType["RF_DISARM"] = 22] = "RF_DISARM";
    ZoneType[ZoneType["NO_ALARM_RESPONSE"] = 23] = "NO_ALARM_RESPONSE";
    ZoneType[ZoneType["SILENT_BURGLARY"] = 24] = "SILENT_BURGLARY";
    ZoneType[ZoneType["LYRIC_KEYPAD"] = 50] = "LYRIC_KEYPAD";
    ZoneType[ZoneType["PROA7_GARAGE_MONITOR"] = 53] = "PROA7_GARAGE_MONITOR";
    ZoneType[ZoneType["KEYSWITCH"] = 77] = "KEYSWITCH";
    ZoneType[ZoneType["AAV_MONITOR"] = 81] = "AAV_MONITOR";
    ZoneType[ZoneType["LYRIC_LOCAL_ALARM"] = 89] = "LYRIC_LOCAL_ALARM";
})(ZoneType || (ZoneType = {}));
/** Default value the API accepts when the panel does not require a user code. */
export const NO_USER_CODE = '-1';
//# sourceMappingURL=constants.js.map