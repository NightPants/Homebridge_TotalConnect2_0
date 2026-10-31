import { autoSensorType, zoneFlags } from '../model.js';
import { errorMessage } from '../util.js';
import { BaseAccessory } from './base.js';
/**
 * One HomeKit sensor per alarm zone. The sensor type is picked from the Honeywell zone type
 * (or overridden in config). Tamper, low battery, supervision and bypass status are exposed via
 * the standard StatusTampered / StatusLowBattery / StatusFault / StatusActive characteristics.
 */
export class ZoneSensorAccessory extends BaseAccessory {
    locationId;
    zoneId;
    kind;
    spec;
    sensor;
    bypassSwitch;
    constructor(platform, accessory, ctx) {
        super(platform, accessory);
        this.locationId = ctx.locationId;
        this.zoneId = ctx.zoneId;
        const { Service, Characteristic } = platform;
        const zone = this.zone();
        const override = platform.zoneOverride(ctx.locationId, ctx.zoneId)?.type;
        this.kind = override && override !== 'auto' && override !== 'hidden' ? override : autoSensorType(zone ?? { name: '', zoneType: undefined });
        this.spec = this.specFor(this.kind);
        this.setInformation(`${this.spec.model} Zone`, `${ctx.locationId}-Z${ctx.zoneId}`);
        // Remove sensor services left over from a previous type selection.
        for (const kind of ['contact', 'motion', 'smoke', 'carbonMonoxide', 'leak', 'occupancy']) {
            const other = this.specFor(kind).service;
            if (other.UUID !== this.spec.service.UUID) {
                this.removeService(other);
            }
        }
        this.sensor = this.ensureService(this.spec.service, accessory.displayName);
        this.sensor.getCharacteristic(this.spec.characteristic).onGet(() => {
            this.assertFresh(this.locationId);
            return this.detectedValue();
        });
        this.sensor.getCharacteristic(Characteristic.StatusTampered);
        this.sensor.getCharacteristic(Characteristic.StatusLowBattery);
        this.sensor.getCharacteristic(Characteristic.StatusFault);
        this.sensor.getCharacteristic(Characteristic.StatusActive);
        if (platform.settings.zoneBypassSwitches && zone?.canBypass) {
            this.bypassSwitch = this.ensureService(Service.Switch, `${accessory.displayName} Bypass`, 'bypass');
            this.bypassSwitch
                .getCharacteristic(Characteristic.On)
                .onGet(() => zoneFlags(this.zone()?.status ?? 0).bypassed)
                .onSet((value) => {
                const z = this.zone();
                if (!z) {
                    return;
                }
                // The API can only clear *all* bypasses on a partition, so "off" un-bypasses the whole partition.
                const action = value ? this.platform.bypassZone(this.locationId, this.zoneId) : this.platform.clearBypass(this.locationId, [z.partitionId]);
                action.catch((err) => {
                    this.platform.logger.error(errorMessage(err));
                    this.refresh();
                });
            });
        }
        else {
            this.removeService(Service.Switch, 'bypass');
        }
    }
    zone() {
        return this.platform.locations.get(this.locationId)?.zones.get(this.zoneId);
    }
    specFor(kind) {
        const { Service, Characteristic: C } = this.platform;
        switch (kind) {
            case 'motion':
                return { service: Service.MotionSensor, characteristic: C.MotionDetected, active: true, inactive: false, model: 'Motion' };
            case 'smoke':
                return {
                    service: Service.SmokeSensor,
                    characteristic: C.SmokeDetected,
                    active: C.SmokeDetected.SMOKE_DETECTED,
                    inactive: C.SmokeDetected.SMOKE_NOT_DETECTED,
                    model: 'Smoke',
                };
            case 'carbonMonoxide':
                return {
                    service: Service.CarbonMonoxideSensor,
                    characteristic: C.CarbonMonoxideDetected,
                    active: C.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL,
                    inactive: C.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
                    model: 'Carbon Monoxide',
                };
            case 'leak':
                return {
                    service: Service.LeakSensor,
                    characteristic: C.LeakDetected,
                    active: C.LeakDetected.LEAK_DETECTED,
                    inactive: C.LeakDetected.LEAK_NOT_DETECTED,
                    model: 'Leak',
                };
            case 'occupancy':
                return {
                    service: Service.OccupancySensor,
                    characteristic: C.OccupancyDetected,
                    active: C.OccupancyDetected.OCCUPANCY_DETECTED,
                    inactive: C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
                    model: 'Occupancy',
                };
            case 'contact':
            default:
                return {
                    service: Service.ContactSensor,
                    characteristic: C.ContactSensorState,
                    active: C.ContactSensorState.CONTACT_NOT_DETECTED,
                    inactive: C.ContactSensorState.CONTACT_DETECTED,
                    model: 'Contact',
                };
        }
    }
    detectedValue() {
        const f = zoneFlags(this.zone()?.status ?? 0);
        return f.faulted || f.triggered ? this.spec.active : this.spec.inactive;
    }
    refresh() {
        const { Characteristic: C } = this.platform;
        const zone = this.zone();
        if (!zone) {
            return;
        }
        const f = zoneFlags(zone.status);
        this.sensor.updateCharacteristic(this.spec.characteristic, this.detectedValue());
        this.sensor.updateCharacteristic(C.StatusTampered, f.tampered ? C.StatusTampered.TAMPERED : C.StatusTampered.NOT_TAMPERED);
        this.sensor.updateCharacteristic(C.StatusLowBattery, f.lowBattery ? C.StatusLowBattery.BATTERY_LEVEL_LOW : C.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        this.sensor.updateCharacteristic(C.StatusFault, f.commFailure || f.trouble ? C.StatusFault.GENERAL_FAULT : C.StatusFault.NO_FAULT);
        this.sensor.updateCharacteristic(C.StatusActive, !f.bypassed && !this.platform.isStale(this.locationId));
        this.bypassSwitch?.updateCharacteristic(C.On, f.bypassed);
    }
}
//# sourceMappingURL=zoneSensor.js.map