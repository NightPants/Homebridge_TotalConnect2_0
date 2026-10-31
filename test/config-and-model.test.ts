import { describe, expect, it } from 'vitest';

import { ArmingState, ArmType, ZoneStatusFlag, ZoneType } from '../src/api/constants.js';
import { armTypeFor, ConfigError, resolveConfig } from '../src/config.js';
import {
  alarmKind,
  applyFullStatus,
  autoSensorType,
  HK,
  isButtonZone,
  isBypassedArmingState,
  type LocationSnapshot,
  resolveModes,
  shouldExposeZone,
  targetForCurrent,
  toHomeKitCurrent,
  zoneFlags,
} from '../src/model.js';

describe('config resolution', () => {
  it('applies defaults, clamps intervals and honours environment variables', () => {
    const resolved = resolveConfig(
      {
        platform: 'HoneywellTotalConnect',
        username: 'config-user',
        password: 'config-password',
        pollingInterval: 2, // clamped up to 10s
        fastPollingInterval: 99, // clamped down to 30s
      },
      {
        TOTALCONNECT_USERNAME: ' env-user ',
        TOTALCONNECT_USERCODE: '2468',
      },
    );

    expect(resolved.username).toBe('env-user');
    expect(resolved.password).toBe('config-password');
    expect(resolved.userCode).toBe('2468');
    expect(resolved.pollingIntervalMs).toBe(10_000);
    expect(resolved.fastPollingIntervalMs).toBe(30_000);
    expect(resolved.allowDisarm).toBe(true);
    expect(resolved.hideButtonZones).toBe(true);
    expect(armTypeFor('night')).toBe(ArmType.STAY_NIGHT);
    expect(armTypeFor('stayInstant')).toBe(ArmType.STAY_INSTANT);
    expect(armTypeFor('awayInstant')).toBe(ArmType.AWAY_INSTANT);
  });

  it('rejects missing credentials and malformed user codes', () => {
    expect(() => resolveConfig({ platform: 'HoneywellTotalConnect' }, {})).toThrow(ConfigError);
    expect(() =>
      resolveConfig(
        {
          platform: 'HoneywellTotalConnect',
          username: 'u',
          password: 'p',
          userCode: '99',
        },
        {},
      ),
    ).toThrow(ConfigError);
  });
});

describe('panel state & zone mapping', () => {
  it('maps Vista, Lyric and ProA7 arming states to HomeKit states', () => {
    const autoModes = resolveModes({ homeMode: 'stay', nightMode: 'auto', awayMode: 'away' }, true);
    expect(autoModes.night).toBe('night');

    const fallbackModes = resolveModes({ homeMode: 'stay', nightMode: 'auto', awayMode: 'away' }, false);
    expect(fallbackModes.night).toBe('stayInstant');

    expect(toHomeKitCurrent(ArmingState.DISARMED_ZONE_FAULTED, autoModes)).toBe(HK.DISARMED);
    expect(toHomeKitCurrent(ArmingState.ARMED_STAY_PROA7, autoModes)).toBe(HK.STAY);
    expect(toHomeKitCurrent(ArmingState.ARMED_AWAY_BYPASS, autoModes)).toBe(HK.AWAY);
    expect(toHomeKitCurrent(ArmingState.ARMED_STAY_NIGHT_BYPASS_PROA7, autoModes)).toBe(HK.NIGHT);
    expect(toHomeKitCurrent(ArmingState.ALARMING_FIRE_SMOKE, autoModes)).toBe(HK.TRIGGERED);
    expect(toHomeKitCurrent(ArmingState.ARMING, autoModes)).toBeUndefined();

    expect(alarmKind(ArmingState.ALARMING)).toBe('burglary');
    expect(alarmKind(ArmingState.ALARMING_FIRE_SMOKE)).toBe('fire');
    expect(alarmKind(ArmingState.ALARMING_CARBON_MONOXIDE_PROA7)).toBe('carbonMonoxide');
    expect(alarmKind(ArmingState.ARMED_STAY)).toBeUndefined();

    expect(isBypassedArmingState(ArmingState.ARMED_STAY_BYPASS)).toBe(true);
    expect(isBypassedArmingState(ArmingState.ARMED_STAY)).toBe(false);
    expect(targetForCurrent(HK.TRIGGERED, HK.AWAY)).toBe(HK.AWAY);
    expect(targetForCurrent(HK.DISARMED, HK.AWAY)).toBe(HK.DISARMED);
  });

  it('classifies zones, decodes status flags and filters button zones', () => {
    expect(autoSensorType({ name: 'Hallway', zoneType: ZoneType.INTERIOR_FOLLOWER })).toBe('motion');
    expect(autoSensorType({ name: 'Kitchen', zoneType: ZoneType.FIRE_SMOKE })).toBe('smoke');
    expect(autoSensorType({ name: 'Basement', zoneType: ZoneType.CARBON_MONOXIDE })).toBe('carbonMonoxide');
    expect(autoSensorType({ name: 'Sump Water Sensor', zoneType: ZoneType.MONITOR })).toBe('leak');
    expect(autoSensorType({ name: 'Front Door', zoneType: ZoneType.ENTRY_EXIT_1 })).toBe('contact');

    const fob = {
      locationId: 1,
      id: 99,
      partitionId: 1,
      name: 'Keyfob Arm',
      status: 0,
      zoneType: ZoneType.RF_ARM_AWAY,
      canBypass: false,
    };
    expect(isButtonZone(fob)).toBe(true);
    expect(
      shouldExposeZone(fob, {
        zoneExposure: 'all',
        zoneIds: new Set(),
        excludeZoneIds: new Set(),
        hideButtonZones: true,
      }),
    ).toBe(false);

    const flags = zoneFlags(ZoneStatusFlag.FAULT | ZoneStatusFlag.LOW_BATTERY | ZoneStatusFlag.BYPASSED);
    expect(flags.faulted).toBe(true);
    expect(flags.lowBattery).toBe(true);
    expect(flags.bypassed).toBe(true);
    expect(flags.tampered).toBe(false);
  });

  it('merges fullStatus snapshots accurately', () => {
    const snapshot: LocationSnapshot = {
      id: 10,
      name: 'Home',
      deviceId: 500,
      userCode: '1234',
      armingState: ArmingState.DISARMED,
      partitions: new Map(),
      zones: new Map(),
      acLoss: false,
      lowBattery: false,
      tampered: false,
      updatedAt: 0,
    };

    applyFullStatus(snapshot, {
      ResultCode: 0,
      ArmingState: ArmingState.ARMED_STAY,
      PanelStatus: {
        IsInACLoss: true,
        IsInLowBattery: false,
        IsCoverTampered: true,
        Partitions: [{ PartitionID: 1, PartitionName: 'Main', ArmingState: ArmingState.ARMED_STAY, IsNightStayEnabled: 1 }],
        Zones: [{ ZoneID: 2, ZoneDescription: 'Patio Door', ZoneStatus: ZoneStatusFlag.FAULT, PartitionID: 1, CanBeBypassed: 1 }],
      },
    });

    expect(snapshot.armingState).toBe(ArmingState.ARMED_STAY);
    expect(snapshot.acLoss).toBe(true);
    expect(snapshot.tampered).toBe(true);
    expect(snapshot.partitions.get(1)?.nightSupported).toBe(true);
    expect(snapshot.zones.get(2)?.canBypass).toBe(true);
    expect(zoneFlags(snapshot.zones.get(2)!.status).faulted).toBe(true);
  });
});

