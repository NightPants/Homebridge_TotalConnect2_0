import { alarmKind, HK, modeForTarget, resolveModes, targetForCurrent, toHomeKitCurrent, } from '../model.js';
import { errorMessage } from '../util.js';
import { BaseAccessory, HAP_STATUS } from './base.js';
/** How long to wait for the panel to reach a requested state before giving up (exit delay + margin). */
const PENDING_TIMEOUT_MS = 180_000;
const SWITCH_TARGET = { away: HK.AWAY, stay: HK.STAY, night: HK.NIGHT };
const SWITCH_LABEL = { away: 'Arm Away', stay: 'Arm Home', night: 'Arm Night' };
/**
 * HomeKit Security System for a location (all partitions) or a single partition.
 *
 * HomeKit → panel:  Home → `homeMode`, Night → `nightMode`, Away → `awayMode`, Off → disarm.
 * Commands are sent asynchronously so HomeKit never times out while the panel responds; the
 * target state stays "pending" until polling confirms the panel reached it.
 */
export class SecuritySystemAccessory extends BaseAccessory {
    service;
    locationId;
    partitionIds;
    modes;
    current = HK.DISARMED;
    target = HK.DISARMED;
    pending;
    armSwitches = new Map();
    bypassSwitch;
    clearBypassSwitch;
    alarmSensor;
    constructor(platform, accessory, ctx) {
        super(platform, accessory);
        this.locationId = ctx.locationId;
        this.partitionIds = ctx.partitionIds;
        const { Service, Characteristic } = platform;
        const settings = platform.settings;
        this.setInformation('Security Panel', `${ctx.locationId}-${ctx.partitionIds.join('-')}`);
        this.modes = resolveModes(settings, this.nightSupported());
        this.service = this.ensureService(Service.SecuritySystem, accessory.displayName);
        const targetValues = [HK.STAY, HK.AWAY, HK.DISARMED];
        if (this.modes.night) {
            targetValues.splice(2, 0, HK.NIGHT);
        }
        this.service
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .setProps({ validValues: targetValues })
            .onGet(() => {
            this.assertFresh(this.locationId);
            return this.target;
        })
            .onSet((value) => this.setTarget(value));
        this.service.getCharacteristic(Characteristic.SecuritySystemCurrentState).onGet(() => {
            this.assertFresh(this.locationId);
            return this.current;
        });
        this.service.getCharacteristic(Characteristic.SecuritySystemAlarmType);
        this.service.getCharacteristic(Characteristic.StatusFault);
        this.service.getCharacteristic(Characteristic.StatusTampered);
        this.setupOptionalServices();
    }
    location() {
        return this.platform.locations.get(this.locationId);
    }
    nightSupported() {
        const loc = this.location();
        if (!loc) {
            return true;
        }
        return this.partitionIds.every((id) => loc.partitions.get(id)?.nightSupported !== false);
    }
    armingState(loc) {
        if (this.partitionIds.length === 1) {
            return loc.partitions.get(this.partitionIds[0])?.armingState ?? loc.armingState;
        }
        return loc.armingState;
    }
    // ---------------------------------------------------------------------------
    // Optional services
    // ---------------------------------------------------------------------------
    setupOptionalServices() {
        const { Service, Characteristic } = this.platform;
        const settings = this.platform.settings;
        const name = this.accessory.displayName;
        for (const kind of Object.keys(SWITCH_TARGET)) {
            const subtype = `arm-${kind}`;
            const enabled = settings.armingSwitches.has(kind) && (kind !== 'night' || !!this.modes.night);
            if (!enabled) {
                this.removeService(Service.Switch, subtype);
                continue;
            }
            const sw = this.ensureService(Service.Switch, `${name} ${SWITCH_LABEL[kind]}`, subtype);
            sw.getCharacteristic(Characteristic.On)
                .onGet(() => this.current === SWITCH_TARGET[kind])
                .onSet((value) => {
                if (value) {
                    this.setTarget(SWITCH_TARGET[kind]);
                }
                else {
                    // Arming switches never disarm (disarm requires the Security System tile, which iOS confirms).
                    setTimeout(() => sw.updateCharacteristic(Characteristic.On, this.current === SWITCH_TARGET[kind]), 500);
                }
            });
            this.armSwitches.set(kind, sw);
        }
        if (settings.bypassSwitches) {
            this.bypassSwitch = this.ensureService(Service.Switch, `${name} Bypass Open Zones`, 'bypass-faulted');
            this.bypassSwitch
                .getCharacteristic(Characteristic.On)
                .onGet(() => false)
                .onSet((value) => {
                if (!value) {
                    return;
                }
                this.platform
                    .bypassFaultedZones(this.locationId, this.partitionIds)
                    .catch((err) => this.platform.logger.error(errorMessage(err)))
                    .finally(() => this.resetSwitch(this.bypassSwitch));
            });
            this.clearBypassSwitch = this.ensureService(Service.Switch, `${name} Clear Bypass`, 'clear-bypass');
            this.clearBypassSwitch
                .getCharacteristic(Characteristic.On)
                .onGet(() => false)
                .onSet((value) => {
                if (!value) {
                    return;
                }
                this.platform
                    .clearBypass(this.locationId, this.partitionIds)
                    .catch((err) => this.platform.logger.error(errorMessage(err)))
                    .finally(() => this.resetSwitch(this.clearBypassSwitch));
            });
        }
        else {
            this.removeService(Service.Switch, 'bypass-faulted');
            this.removeService(Service.Switch, 'clear-bypass');
        }
        if (settings.alarmSensor) {
            this.alarmSensor = this.ensureService(Service.ContactSensor, `${name} Alarm`, 'alarm');
            this.alarmSensor.getCharacteristic(Characteristic.ContactSensorState).onGet(() => {
                this.assertFresh(this.locationId);
                return this.current === HK.TRIGGERED
                    ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                    : Characteristic.ContactSensorState.CONTACT_DETECTED;
            });
        }
        else {
            this.removeService(Service.ContactSensor, 'alarm');
        }
    }
    // ---------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------
    setTarget(value) {
        const { Characteristic } = this.platform;
        const target = this.asNumber(value);
        const settings = this.platform.settings;
        if (target === HK.DISARMED && !settings.allowDisarm) {
            this.platform.logger.warn(`Disarming "${this.accessory.displayName}" from HomeKit is disabled in the plugin settings`);
            setTimeout(() => this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, this.target), 500);
            throw new this.hap.HapStatusError(HAP_STATUS.INSUFFICIENT_PRIVILEGES);
        }
        if (target === this.target && this.current === target && !this.pending) {
            return;
        }
        const mode = modeForTarget(target, this.modes);
        if (target !== HK.DISARMED && !mode) {
            throw new this.hap.HapStatusError(HAP_STATUS.INVALID_VALUE_IN_REQUEST);
        }
        const previousTarget = this.target;
        this.target = target;
        this.pending = { target, expires: Date.now() + PENDING_TIMEOUT_MS };
        this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, target);
        const label = target === HK.DISARMED ? 'disarm' : `arm (${mode})`;
        this.platform.logger.info(`HomeKit requested ${label} for "${this.accessory.displayName}"`);
        const command = target === HK.DISARMED
            ? this.platform.disarm(this.locationId, this.partitionIds)
            : this.platform.arm(this.locationId, this.partitionIds, mode);
        command.catch((err) => {
            this.platform.logger.error(errorMessage(err));
            this.pending = undefined;
            this.target = this.current === HK.TRIGGERED ? previousTarget : this.current;
            this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, this.target);
            this.refresh();
        });
    }
    // ---------------------------------------------------------------------------
    // State sync
    // ---------------------------------------------------------------------------
    refresh() {
        const { Characteristic } = this.platform;
        const loc = this.location();
        if (!loc) {
            return;
        }
        const state = this.armingState(loc);
        const preferred = this.pending?.target ?? this.target;
        const mapped = toHomeKitCurrent(state, this.modes, preferred);
        if (mapped !== undefined) {
            if (mapped !== this.current) {
                this.platform.logger.info(`"${this.accessory.displayName}" is now ${describe(mapped)} (panel state ${state})`);
            }
            this.current = mapped;
        }
        if (this.pending) {
            const reached = this.current === this.pending.target || (this.current === HK.TRIGGERED && this.pending.target !== HK.DISARMED);
            if (reached) {
                this.pending = undefined;
            }
            else if (Date.now() > this.pending.expires) {
                this.platform.logger.warn(`"${this.accessory.displayName}" did not reach ${describe(this.pending.target)} within ${PENDING_TIMEOUT_MS / 1000} s; showing actual panel state`);
                this.pending = undefined;
            }
        }
        if (!this.pending) {
            this.target = targetForCurrent(this.current, this.target);
        }
        const kind = alarmKind(state);
        const fault = loc.acLoss || loc.lowBattery;
        this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, this.current);
        this.service.updateCharacteristic(Characteristic.SecuritySystemTargetState, this.target);
        this.service.updateCharacteristic(Characteristic.SecuritySystemAlarmType, kind ? 1 : 0);
        this.service.updateCharacteristic(Characteristic.StatusFault, fault ? Characteristic.StatusFault.GENERAL_FAULT : Characteristic.StatusFault.NO_FAULT);
        this.service.updateCharacteristic(Characteristic.StatusTampered, loc.tampered ? Characteristic.StatusTampered.TAMPERED : Characteristic.StatusTampered.NOT_TAMPERED);
        for (const [kindKey, sw] of this.armSwitches) {
            sw.updateCharacteristic(Characteristic.On, this.current === SWITCH_TARGET[kindKey]);
        }
        this.alarmSensor?.updateCharacteristic(Characteristic.ContactSensorState, this.current === HK.TRIGGERED ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
    }
}
function describe(state) {
    return ['armed Home', 'armed Away', 'armed Night', 'disarmed', 'ALARM TRIGGERED'][state] ?? String(state);
}
//# sourceMappingURL=securitySystem.js.map