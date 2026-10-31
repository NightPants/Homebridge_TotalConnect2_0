import type { CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';

import type { TotalConnectPlatform } from '../platform.js';
import { MANUFACTURER } from '../settings.js';
import { PLUGIN_VERSION, safeName } from '../util.js';

/**
 * HAP status codes. `HAPStatus` is an ambient const enum in the Homebridge typings, which cannot
 * be referenced with `isolatedModules`, so the spec values are mirrored here.
 */
export const HAP_STATUS = {
  INSUFFICIENT_PRIVILEGES: -70401,
  SERVICE_COMMUNICATION_FAILURE: -70402,
  INVALID_VALUE_IN_REQUEST: -70410,
} as const;

/** Shared helpers for all accessory handlers. */
export abstract class BaseAccessory {
  protected readonly hap;

  protected constructor(
    protected readonly platform: TotalConnectPlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    this.hap = platform.api.hap;
  }

  protected setInformation(model: string, serial: string): void {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, serial)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, PLUGIN_VERSION);
  }

  /** Gets or creates a (sub)service and gives it a valid, user-visible name. */
  protected ensureService(type: WithUUID<typeof Service>, name: string, subtype?: string): Service {
    const existing = subtype ? this.accessory.getServiceById(type, subtype) : this.accessory.getService(type);
    // Concrete HAP services are constructed as `new Service.X(displayName, subtype)`.
    const ServiceCtor = type as unknown as new (displayName?: string, subtype?: string) => Service;
    const service = existing ?? this.accessory.addService(new ServiceCtor(safeName(name), subtype));
    const { Characteristic } = this.platform;
    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      service.addOptionalCharacteristic(Characteristic.ConfiguredName);
    }
    if (!existing) {
      service.setCharacteristic(Characteristic.ConfiguredName, safeName(name));
    }
    service.setCharacteristic(Characteristic.Name, safeName(name));
    return service;
  }

  protected removeService(type: WithUUID<typeof Service>, subtype?: string): void {
    const service = subtype ? this.accessory.getServiceById(type, subtype) : this.accessory.getService(type);
    if (service) {
      this.accessory.removeService(service);
    }
  }

  /** Throws "No Response" to HomeKit when the cached state is too old. */
  protected assertFresh(locationId: number): void {
    if (this.platform.isStale(locationId)) {
      throw new this.hap.HapStatusError(HAP_STATUS.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /** Momentary switch: turns itself back off after `ms`. */
  protected resetSwitch(service: Service, ms = 1_000): void {
    setTimeout(() => service.updateCharacteristic(this.platform.Characteristic.On, false), ms);
  }

  protected asNumber(value: CharacteristicValue): number {
    return typeof value === 'number' ? value : Number(value);
  }
}
