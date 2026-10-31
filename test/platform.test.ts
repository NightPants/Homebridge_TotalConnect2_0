import { EventEmitter } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformAccessory } from 'homebridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArmingState, BOOTSTRAP_CONFIG_URL, ResultCode, ZoneStatusFlag, ZoneType } from '../src/api/constants.js';
import { HK } from '../src/model.js';
import { TotalConnectPlatform } from '../src/platform.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const spkiB64 = (publicKey.export({ type: 'spki', format: 'pem' }) as string)
  .replace(/-----.*-----/g, '')
  .replace(/\s+/g, '');

class FakePlatformAccessory extends EventEmitter {
  readonly services: hap.Service[] = [];
  context: Record<string, unknown> = {};

  constructor(
    public displayName: string,
    public readonly UUID: string,
  ) {
    super();
    this.services.push(new hap.Service.AccessoryInformation());
  }

  getService(type: hap.WithUUID<typeof hap.Service> | string): hap.Service | undefined {
    const uuid = typeof type === 'string' ? type : type.UUID;
    return this.services.find((s) => s.UUID === uuid && !s.subtype);
  }

  getServiceById(type: hap.WithUUID<typeof hap.Service> | string, subtype: string): hap.Service | undefined {
    const uuid = typeof type === 'string' ? type : type.UUID;
    return this.services.find((s) => s.UUID === uuid && s.subtype === subtype);
  }

  addService(service: hap.Service): hap.Service {
    this.services.push(service);
    return service;
  }

  removeService(service: hap.Service): void {
    const idx = this.services.indexOf(service);
    if (idx >= 0) {
      this.services.splice(idx, 1);
    }
  }
}

function createMockApi() {
  const bus = new EventEmitter();
  const registered: FakePlatformAccessory[] = [];
  const api = {
    hap,
    platformAccessory: FakePlatformAccessory,
    on: (ev: string, fn: (...args: unknown[]) => void) => bus.on(ev, fn),
    registerPlatformAccessories: (_plugin: string, _platform: string, accs: FakePlatformAccessory[]) => {
      registered.push(...accs);
    },
    updatePlatformAccessories: () => undefined,
    unregisterPlatformAccessories: (_plugin: string, _platform: string, accs: FakePlatformAccessory[]) => {
      for (const a of accs) {
        const idx = registered.indexOf(a);
        if (idx >= 0) {
          registered.splice(idx, 1);
        }
      }
    },
  } as unknown as API;

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logging;

  return { api, bus, registered, log };
}

describe('TotalConnectPlatform integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers panel & zones, auto-bypasses open zones on arm, and enforces allowDisarm=false', async () => {
    let armCalls = 0;
    const bypassedBatches: number[][] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === BOOTSTRAP_CONFIG_URL) {
        return new Response(
          JSON.stringify({
            RevisionNumber: '3.55.0',
            version: '0.0.1875',
            brandInfo: [{ BrandName: 'totalconnect', AppID: 16808 }],
            AppConfig: [{ tc2APIKey: spkiB64, tc2ClientId: 'cid' }],
          }),
        );
      }
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 1200 }));
      }
      if (url.includes('/sessiondetails')) {
        return new Response(
          JSON.stringify({
            ResultCode: 0,
            SessionDetailsResult: {
              Locations: [{ LocationID: 7, LocationName: 'Residence', SecurityDeviceID: 77 }],
            },
          }),
        );
      }
      if (url.includes('/partitions/config')) {
        return new Response(
          JSON.stringify({
            ResultCode: 0,
            Partitions: [{ PartitionID: 1, PartitionName: 'Main', ArmingState: ArmingState.DISARMED, IsNightStayEnabled: 1 }],
          }),
        );
      }
      if (url.includes('/partitions/zones/0')) {
        return new Response(
          JSON.stringify({
            ResultCode: 0,
            ZoneStatus: {
              Zones: [
                { ZoneID: 1, ZoneDescription: 'Front Door', PartitionId: 1, ZoneTypeId: ZoneType.ENTRY_EXIT_1, CanBeBypassed: 1, ZoneStatus: ZoneStatusFlag.FAULT },
                { ZoneID: 2, ZoneDescription: 'Keyfob', PartitionId: 1, ZoneTypeId: ZoneType.RF_ARM_AWAY, CanBeBypassed: 0, ZoneStatus: 0 },
              ],
            },
          }),
        );
      }
      if (url.includes('/fullStatus')) {
        return new Response(
          JSON.stringify({
            ResultCode: 0,
            ArmingState: armCalls >= 2 ? ArmingState.ARMED_STAY : ArmingState.DISARMED,
            PanelStatus: {
              Partitions: [{ PartitionID: 1, PartitionName: 'Main', ArmingState: armCalls >= 2 ? ArmingState.ARMED_STAY : ArmingState.DISARMED }],
              Zones: [
                { ZoneID: 1, ZoneDescription: 'Front Door', PartitionID: 1, ZoneTypeID: ZoneType.ENTRY_EXIT_1, CanBeBypassed: 1, ZoneStatus: ZoneStatusFlag.FAULT },
                { ZoneID: 2, ZoneDescription: 'Keyfob', PartitionID: 1, ZoneTypeID: ZoneType.RF_ARM_AWAY, CanBeBypassed: 0, ZoneStatus: 0 },
              ],
            },
          }),
        );
      }
      if (url.includes('/partitions/arm')) {
        armCalls++;
        if (armCalls === 1) {
          // Refuse first arm because zone 1 is open
          return new Response(JSON.stringify({ ResultCode: ResultCode.COMMAND_FAILED, ResultData: 'Zone faulted' }));
        }
        return new Response(JSON.stringify({ ResultCode: ResultCode.COMMAND_ACCEPTED }));
      }
      if (url.includes('/bypass')) {
        const body = JSON.parse(String(init?.body)) as { ZoneIds: number[] };
        bypassedBatches.push(body.ZoneIds);
        return new Response(JSON.stringify({ ResultCode: 0 }));
      }
      return new Response(JSON.stringify({ ResultCode: 0 }));
    });

    const { api, bus, registered, log } = createMockApi();
    const platform = new TotalConnectPlatform(
      log,
      {
        platform: 'HoyTotalConnect',
        username: 'user@example.com',
        password: 'pw',
        userCode: '1234',
        autoBypassOnArm: true,
        allowDisarm: false,
        pollingInterval: 60,
      },
      api,
    );

    // Trigger startup & discovery and inspect registered accessories
    await (platform as unknown as { start(): Promise<void> }).start();

    // Keyfob zone 2 is hidden automatically; we expect 1 panel + 1 contact zone = 2 accessories
    expect(registered.map((a) => a.displayName)).toEqual(['Residence', 'Front Door']);

    // Arm with open zone -> auto-bypasses zone 1 and retries arm
    await platform.arm(7, [1], 'stay');
    expect(bypassedBatches).toEqual([[1]]);
    expect(armCalls).toBe(2);

    // Refresh updates SecuritySystem to STAY
    await platform.refreshLocation(7);
    (platform as unknown as { refreshAll(): void }).refreshAll();

    const panelAcc = registered[0] as unknown as PlatformAccessory;
    const secService = panelAcc.getService(hap.Service.SecuritySystem)!;
    expect(secService.getCharacteristic(hap.Characteristic.SecuritySystemCurrentState).value).toBe(HK.STAY);

    // Disarming via HomeKit when allowDisarm=false throws INSUFFICIENT_PRIVILEGES (-70401)
    const targetChar = secService.getCharacteristic(hap.Characteristic.SecuritySystemTargetState);
    expect(() => {
      // Invoke HAP set handler via internal emit / setValue
      (targetChar as unknown as { setHandler: (v: number) => void }).setHandler(HK.DISARMED);
    }).toThrow();

    bus.emit('shutdown');
  });
});
