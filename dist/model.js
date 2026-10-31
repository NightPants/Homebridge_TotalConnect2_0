import { ArmingState, ZoneStatusFlag, ZoneType } from './api/constants.js';
const FAMILY = new Map([
    [ArmingState.DISARMED, 'disarmed'],
    [ArmingState.DISARMED_BYPASS, 'disarmed'],
    [ArmingState.DISARMED_ZONE_FAULTED, 'disarmed'],
    [ArmingState.ARMED_AWAY, 'away'],
    [ArmingState.ARMED_AWAY_BYPASS, 'away'],
    [ArmingState.ARMED_AWAY_INSTANT, 'awayInstant'],
    [ArmingState.ARMED_AWAY_INSTANT_BYPASS, 'awayInstant'],
    [ArmingState.ARMED_STAY, 'stay'],
    [ArmingState.ARMED_STAY_BYPASS, 'stay'],
    [ArmingState.ARMED_STAY_OTHER, 'stay'],
    [ArmingState.ARMED_STAY_PROA7, 'stay'],
    [ArmingState.ARMED_STAY_BYPASS_PROA7, 'stay'],
    [ArmingState.ARMED_CUSTOM_BYPASS, 'stay'],
    [ArmingState.ARMED_STAY_INSTANT, 'stayInstant'],
    [ArmingState.ARMED_STAY_INSTANT_BYPASS, 'stayInstant'],
    [ArmingState.ARMED_STAY_INSTANT_PROA7, 'stayInstant'],
    [ArmingState.ARMED_STAY_INSTANT_BYPASS_PROA7, 'stayInstant'],
    [ArmingState.ARMED_STAY_NIGHT, 'night'],
    [ArmingState.ARMED_STAY_NIGHT_BYPASS_PROA7, 'night'],
    [ArmingState.ARMED_STAY_NIGHT_INSTANT_PROA7, 'night'],
    [ArmingState.ARMED_STAY_NIGHT_INSTANT_BYPASS_PROA7, 'night'],
    [ArmingState.ALARMING, 'alarm'],
    [ArmingState.ALARMING_FIRE_SMOKE, 'alarm'],
    [ArmingState.ALARMING_CARBON_MONOXIDE, 'alarm'],
    [ArmingState.ALARMING_CARBON_MONOXIDE_PROA7, 'alarm'],
    [ArmingState.ARMING, 'arming'],
    [ArmingState.DISARMING, 'disarming'],
]);
export function armFamily(state) {
    return (state !== undefined && FAMILY.get(state)) || 'unknown';
}
export function alarmKind(state) {
    switch (state) {
        case ArmingState.ALARMING:
            return 'burglary';
        case ArmingState.ALARMING_FIRE_SMOKE:
            return 'fire';
        case ArmingState.ALARMING_CARBON_MONOXIDE:
        case ArmingState.ALARMING_CARBON_MONOXIDE_PROA7:
            return 'carbonMonoxide';
        default:
            return undefined;
    }
}
export function isBypassedArmingState(state) {
    return (state === ArmingState.DISARMED_BYPASS ||
        state === ArmingState.ARMED_AWAY_BYPASS ||
        state === ArmingState.ARMED_AWAY_INSTANT_BYPASS ||
        state === ArmingState.ARMED_STAY_BYPASS ||
        state === ArmingState.ARMED_STAY_BYPASS_PROA7 ||
        state === ArmingState.ARMED_STAY_INSTANT_BYPASS ||
        state === ArmingState.ARMED_STAY_INSTANT_BYPASS_PROA7 ||
        state === ArmingState.ARMED_STAY_NIGHT_BYPASS_PROA7 ||
        state === ArmingState.ARMED_STAY_NIGHT_INSTANT_BYPASS_PROA7 ||
        state === ArmingState.ARMED_CUSTOM_BYPASS);
}
/** HomeKit SecuritySystem state values (identical numbers for Current and Target, except 4). */
export const HK = {
    STAY: 0,
    AWAY: 1,
    NIGHT: 2,
    DISARMED: 3,
    TRIGGERED: 4,
};
export function resolveModes(config, nightSupported) {
    let night;
    if (config.nightMode === 'auto') {
        night = nightSupported ? 'night' : 'stayInstant';
    }
    else if (config.nightMode !== 'disabled') {
        night = config.nightMode;
    }
    return { home: config.homeMode, night, away: config.awayMode };
}
/** Panel arm mode for a HomeKit target. Returns undefined for DISARM or disabled modes. */
export function modeForTarget(target, modes) {
    switch (target) {
        case HK.STAY:
            return modes.home;
        case HK.NIGHT:
            return modes.night;
        case HK.AWAY:
            return modes.away;
        default:
            return undefined;
    }
}
/**
 * Maps a panel arming state to the HomeKit "current state".
 * Returns undefined for transitional/unknown states (caller should keep the previous value).
 * `preferredTarget` disambiguates when two HomeKit modes map to the same panel mode.
 */
export function toHomeKitCurrent(state, modes, preferredTarget) {
    const family = armFamily(state);
    switch (family) {
        case 'disarmed':
            return HK.DISARMED;
        case 'alarm':
            return HK.TRIGGERED;
        case 'arming':
        case 'disarming':
        case 'unknown':
            return undefined;
    }
    if (preferredTarget !== undefined && preferredTarget !== HK.DISARMED && modeForTarget(preferredTarget, modes) === family) {
        return preferredTarget;
    }
    if (modes.away === family) {
        return HK.AWAY;
    }
    if (modes.home === family) {
        return HK.STAY;
    }
    if (modes.night === family) {
        return HK.NIGHT;
    }
    // Panel was armed from a keypad/app in a mode not mapped to any HomeKit button.
    if (family === 'away' || family === 'awayInstant') {
        return HK.AWAY;
    }
    if ((family === 'night' || family === 'stayInstant') && modes.night) {
        return HK.NIGHT;
    }
    return HK.STAY;
}
/** Target state that corresponds to a current state (TRIGGERED keeps the previous target). */
export function targetForCurrent(current, previousTarget) {
    return current === HK.TRIGGERED ? previousTarget : current;
}
const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true';
export function partitionFromInfo(info, previous) {
    return {
        id: info.PartitionID,
        name: info.PartitionName?.trim() || previous?.name || `Partition ${info.PartitionID}`,
        armingState: info.ArmingState ?? info.PartitionArmingState ?? previous?.armingState ?? ArmingState.UNKNOWN,
        nightSupported: info.IsNightStayEnabled !== undefined ? toBool(info.IsNightStayEnabled) : (previous?.nightSupported ?? true),
    };
}
export function zoneFromInfo(locationId, info, previous) {
    return {
        locationId,
        id: info.ZoneID,
        partitionId: info.PartitionID ?? info.PartitionId ?? previous?.partitionId ?? 1,
        name: info.ZoneDescription?.trim() || previous?.name || `Zone ${info.ZoneID}`,
        status: info.ZoneStatus ?? previous?.status ?? 0,
        zoneType: info.ZoneTypeId ?? info.ZoneTypeID ?? previous?.zoneType,
        canBypass: info.CanBeBypassed !== undefined ? toBool(info.CanBeBypassed) : (previous?.canBypass ?? false),
        batteryLevel: info.Batterylevel ?? previous?.batteryLevel,
    };
}
/** Merges a `fullStatus` response into a location snapshot (mutates and returns it). */
export function applyFullStatus(location, res) {
    const panel = res.PanelStatus;
    if (res.ArmingState !== undefined) {
        location.armingState = res.ArmingState;
    }
    if (panel) {
        location.acLoss = toBool(panel.IsInACLoss);
        location.lowBattery = toBool(panel.IsInLowBattery) || toBool(panel.IsInBatteryMissing);
        location.tampered = toBool(panel.IsCoverTampered);
        for (const p of panel.Partitions ?? []) {
            if (p?.PartitionID !== undefined) {
                location.partitions.set(p.PartitionID, partitionFromInfo(p, location.partitions.get(p.PartitionID)));
            }
        }
        for (const z of panel.Zones ?? []) {
            if (z?.ZoneID !== undefined) {
                location.zones.set(z.ZoneID, zoneFromInfo(location.id, z, location.zones.get(z.ZoneID)));
            }
        }
    }
    location.updatedAt = Date.now();
    return location;
}
export function zoneFlags(status) {
    return {
        bypassed: (status & ZoneStatusFlag.BYPASSED) !== 0,
        faulted: (status & ZoneStatusFlag.FAULT) !== 0,
        trouble: (status & ZoneStatusFlag.TROUBLE) !== 0,
        tampered: (status & (ZoneStatusFlag.TAMPER | ZoneStatusFlag.TROUBLE)) !== 0,
        commFailure: (status & ZoneStatusFlag.COMMUNICATION_FAILURE) !== 0,
        lowBattery: (status & ZoneStatusFlag.LOW_BATTERY) !== 0,
        triggered: (status & ZoneStatusFlag.TRIGGERED) !== 0,
    };
}
const BUTTON_TYPES = new Set([
    ZoneType.SILENT_24HR,
    ZoneType.AUDIBLE_24HR,
    ZoneType.AUX_24HR,
    ZoneType.PROA7_MEDICAL,
    ZoneType.RF_ARM_STAY,
    ZoneType.RF_ARM_AWAY,
    ZoneType.RF_DISARM,
    ZoneType.LYRIC_KEYPAD,
    ZoneType.KEYSWITCH,
]);
/** Keyfobs, panic buttons, keypads: things that are not useful as HomeKit sensors. */
export function isButtonZone(zone) {
    return zone.zoneType !== undefined && BUTTON_TYPES.has(zone.zoneType);
}
/** Picks a HomeKit sensor type from the zone type, falling back to name heuristics. */
export function autoSensorType(zone) {
    switch (zone.zoneType) {
        case ZoneType.FIRE_SMOKE:
        case ZoneType.FIRE_WITH_VERIFICATION:
            return 'smoke';
        case ZoneType.CARBON_MONOXIDE:
            return 'carbonMonoxide';
        case ZoneType.INTERIOR_FOLLOWER:
        case ZoneType.INTERIOR_DELAY:
            return 'motion';
    }
    const name = zone.name.toLowerCase();
    if (/\b(smoke|fire|heat)\b/.test(name)) {
        return 'smoke';
    }
    if (/\b(co|carbon)\b/.test(name)) {
        return 'carbonMonoxide';
    }
    if (/\b(flood|water|leak)\b/.test(name)) {
        return 'leak';
    }
    if (/\b(motion|pir|mot)\b/.test(name)) {
        return 'motion';
    }
    return 'contact';
}
/** Whether a zone should be exposed to HomeKit given the user's settings. */
export function shouldExposeZone(zone, config, override) {
    if (override?.type === 'hidden') {
        return false;
    }
    if (config.zoneExposure === 'none') {
        return false;
    }
    if (config.excludeZoneIds.has(zone.id)) {
        return false;
    }
    if (config.zoneExposure === 'selected' && !config.zoneIds.has(zone.id)) {
        return false;
    }
    if (config.hideButtonZones && isButtonZone(zone) && (!override?.type || override.type === 'auto')) {
        return false;
    }
    return true;
}
//# sourceMappingURL=model.js.map