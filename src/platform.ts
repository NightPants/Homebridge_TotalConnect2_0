import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';

import { TotalConnectClient } from './api/client.js';
import { AuthenticationError, CommandFailedError, UserCodeError } from './api/errors.js';
import type { ClientLogger } from './api/util.js';
import { SecuritySystemAccessory } from './accessories/securitySystem.js';
import { ZoneSensorAccessory } from './accessories/zoneSensor.js';
import { armTypeFor, ConfigError, resolveConfig, type HomeArmMode, type ResolvedConfig, type TotalConnectPlatformConfig, type ZoneOverride } from './config.js';
import { applyFullStatus, armFamily, partitionFromInfo, shouldExposeZone, zoneFlags, zoneFromInfo, type LocationSnapshot } from './model.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { errorMessage, safeName } from './util.js';

export type AccessoryContext =
  | { kind: 'security'; locationId: number; partitionIds: number[] }
  | { kind: 'zone'; locationId: number; zoneId: number };

export interface AccessoryHandler {
  /** Push the latest snapshot into HomeKit. */
  refresh(): void;
}

const START_RETRY_MIN_MS = 30_000;
const START_RETRY_MAX_MS = 15 * 60_000;
const POLL_BACKOFF_MAX_MS = 5 * 60_000;
/** Max exit delay on Honeywell panels is ~120 s; keep polling fast a bit longer than that. */
const FAST_POLL_WINDOW_MS = 150_000;

/**
 * Dynamic platform: discovers every Total Connect location on the account, creates one
 * Security System accessory per location (or partition) plus optional zone sensors, and keeps
 * them in sync by polling the cloud API.
 */
export class TotalConnectPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly logger: ClientLogger;
  readonly settings?: ResolvedConfig;
  readonly locations = new Map<number, LocationSnapshot>();

  private client?: TotalConnectClient;
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly handlers = new Map<string, AccessoryHandler>();
  private readonly commandQueues = new Map<number, Promise<unknown>>();
  private readonly autoBypassedLowBattery = new Set<string>();
  private pollTimer?: NodeJS.Timeout;
  private startTimer?: NodeJS.Timeout;
  private fastPollUntil = 0;
  private pollFailures = 0;
  private stopped = false;

  constructor(
    private readonly log: Logging,
    config: TotalConnectPlatformConfig,
    readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    try {
      this.settings = resolveConfig(config ?? ({} as TotalConnectPlatformConfig));
    } catch (err) {
      const msg = err instanceof ConfigError ? err.message : errorMessage(err);
      this.log.error(`Configuration error: ${msg}. The plugin will not start until this is fixed.`);
    }

    const verbose = this.settings?.verboseLogging === true;
    this.logger = {
      debug: (m, ...p) => (verbose ? log.info(`[debug] ${m}`, ...p) : log.debug(m, ...p)),
      info: (m, ...p) => log.info(m, ...p),
      warn: (m, ...p) => log.warn(m, ...p),
      error: (m, ...p) => log.error(m, ...p),
    };

    api.on('didFinishLaunching', () => {
      if (this.settings) {
        void this.start();
      }
    });
    api.on('shutdown', () => void this.shutdown());
  }

  /** Called by Homebridge for every accessory restored from cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private async start(attempt = 0): Promise<void> {
    const settings = this.settings!;
    this.client ??= new TotalConnectClient({
      username: settings.username,
      password: settings.password,
      timeoutMs: settings.requestTimeoutMs,
      logger: this.logger,
    });

    try {
      await this.discover();
      this.schedulePoll(settings.pollingIntervalMs);
    } catch (err) {
      if (this.stopped) {
        return;
      }
      if (err instanceof AuthenticationError) {
        this.log.error(`${err.message} Fix the credentials in the plugin settings and restart Homebridge.`);
        return;
      }
      const delay = Math.min(START_RETRY_MAX_MS, START_RETRY_MIN_MS * 2 ** attempt);
      this.log.warn(`Could not connect to Total Connect (${errorMessage(err)}). Retrying in ${Math.round(delay / 1000)} s.`);
      this.startTimer = setTimeout(() => void this.start(attempt + 1), delay);
    }
  }

  private async shutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.startTimer);
    await this.client?.logout();
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  private async discover(): Promise<void> {
    const settings = this.settings!;
    const client = this.client!;
    const session = await client.login();
    const wanted = new Set<string>();

    for (const loc of session.Locations ?? []) {
      const override = settings.locations.get(loc.LocationID);
      if (override?.enabled === false) {
        this.logger.info(`Skipping disabled location "${loc.LocationName}" (${loc.LocationID})`);
        continue;
      }

      const snapshot: LocationSnapshot = {
        id: loc.LocationID,
        name: safeName(override?.name ?? loc.LocationName, `Location ${loc.LocationID}`),
        deviceId: loc.SecurityDeviceID,
        userCode: override?.userCode ?? settings.userCode,
        armingState: 0,
        partitions: new Map(),
        zones: new Map(),
        acLoss: false,
        lowBattery: false,
        tampered: false,
        updatedAt: 0,
      };

      const partitionConfig = await client.getPartitionConfig(loc.LocationID, loc.SecurityDeviceID);
      for (const p of partitionConfig.Partitions ?? []) {
        snapshot.partitions.set(p.PartitionID, partitionFromInfo(p));
      }
      if (snapshot.partitions.size === 0) {
        snapshot.partitions.set(1, { id: 1, name: 'Partition 1', armingState: 0, nightSupported: true });
      }

      const zoneDetails = await client.getZoneDetails(loc.LocationID);
      for (const z of zoneDetails?.ZoneStatus?.Zones ?? []) {
        snapshot.zones.set(z.ZoneID, zoneFromInfo(loc.LocationID, z));
      }

      applyFullStatus(snapshot, await client.getFullStatus(loc.LocationID));
      this.locations.set(loc.LocationID, snapshot);

      this.logger.info(
        `Found location "${snapshot.name}" (${snapshot.id}) with ${snapshot.partitions.size} partition(s) and ${snapshot.zones.size} zone(s)`,
      );
      if (snapshot.zones.size === 0) {
        this.logger.warn(`No zones reported for "${snapshot.name}". Sync your panel from the Total Connect app if this is unexpected.`);
      }

      // Security system accessories
      const ids = [...snapshot.partitions.keys()].sort((a, b) => a - b);
      const groups = settings.partitionMode === 'separate' && ids.length > 1 ? ids.map((id) => [id]) : [ids];
      for (const partitionIds of groups) {
        const suffix = groups.length > 1 ? `partition:${partitionIds[0]}` : 'panel';
        const name =
          groups.length > 1 ? safeName(`${snapshot.name} ${snapshot.partitions.get(partitionIds[0])!.name}`) : snapshot.name;
        wanted.add(this.ensureAccessory(`${loc.LocationID}:${suffix}`, name, { kind: 'security', locationId: loc.LocationID, partitionIds }));
      }

      // Zone accessories
      for (const zone of snapshot.zones.values()) {
        const zoneOverride = this.zoneOverride(loc.LocationID, zone.id);
        if (!shouldExposeZone(zone, settings, zoneOverride)) {
          continue;
        }
        const name = safeName(zoneOverride?.name ?? zone.name, `Zone ${zone.id}`);
        wanted.add(this.ensureAccessory(`${loc.LocationID}:zone:${zone.id}`, name, { kind: 'zone', locationId: loc.LocationID, zoneId: zone.id }));
      }
    }

    // Remove accessories that no longer exist / are no longer wanted.
    const stale = [...this.cached.values()].filter((acc) => !wanted.has(acc.UUID));
    if (stale.length) {
      this.logger.info(`Removing ${stale.length} accessory(ies) that are no longer configured`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      stale.forEach((acc) => {
        this.cached.delete(acc.UUID);
        this.handlers.delete(acc.UUID);
      });
    }

    this.refreshAll();
  }

  private ensureAccessory(key: string, name: string, context: AccessoryContext): string {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${key}`);
    let accessory = this.cached.get(uuid);
    if (!accessory) {
      accessory = new this.api.platformAccessory<AccessoryContext>(name, uuid);
      accessory.context = context;
      this.createHandler(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.cached.set(uuid, accessory);
      this.logger.info(`Added accessory "${name}"`);
    } else {
      accessory.context = context;
      accessory.displayName = name;
      if (!this.handlers.has(uuid)) {
        this.createHandler(accessory);
      }
      this.api.updatePlatformAccessories([accessory]);
    }
    return uuid;
  }

  private createHandler(accessory: PlatformAccessory): void {
    const ctx = accessory.context as AccessoryContext;
    const handler: AccessoryHandler =
      ctx.kind === 'security' ? new SecuritySystemAccessory(this, accessory, ctx) : new ZoneSensorAccessory(this, accessory, ctx);
    this.handlers.set(accessory.UUID, handler);
  }

  zoneOverride(locationId: number, zoneId: number): ZoneOverride | undefined {
    const overrides = this.settings?.zoneOverrides ?? [];
    return (
      overrides.find((o) => o.zoneId === zoneId && o.locationId === locationId) ??
      overrides.find((o) => o.zoneId === zoneId && o.locationId === undefined)
    );
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private schedulePoll(delay: number): void {
    clearTimeout(this.pollTimer);
    if (this.stopped) {
      return;
    }
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    const settings = this.settings!;
    try {
      for (const id of this.locations.keys()) {
        await this.refreshLocation(id);
      }
      if (this.pollFailures > 0) {
        this.logger.info('Connection to Total Connect restored');
      }
      this.pollFailures = 0;
    } catch (err) {
      this.pollFailures++;
      const level = this.pollFailures === 1 || this.pollFailures % 10 === 0 ? 'warn' : 'debug';
      this.logger[level](`Status update failed (${this.pollFailures}x): ${errorMessage(err)}`);
      if (err instanceof AuthenticationError) {
        this.log.error(`${err.message} Polling stopped; fix the credentials and restart Homebridge.`);
        this.refreshAll();
        return;
      }
    }

    const base = Date.now() < this.fastPollUntil ? settings.fastPollingIntervalMs : settings.pollingIntervalMs;
    const delay = this.pollFailures > 0 ? Math.min(POLL_BACKOFF_MAX_MS, base * 2 ** Math.min(this.pollFailures, 6)) : base;
    this.refreshAll();
    this.schedulePoll(delay);
  }

  async refreshLocation(locationId: number): Promise<void> {
    const snapshot = this.locations.get(locationId);
    if (!snapshot || !this.client) {
      return;
    }
    applyFullStatus(snapshot, await this.client.getFullStatus(locationId));
    void this.autoBypassLowBatteryZones(snapshot);
  }

  /** Temporarily poll quickly so HomeKit reflects arming/disarming without delay. */
  requestFastPolling(windowMs = FAST_POLL_WINDOW_MS): void {
    this.fastPollUntil = Date.now() + windowMs;
    this.schedulePoll(this.settings!.fastPollingIntervalMs);
  }

  /** True when the cached state is too old to be trusted (shown as "No Response"). */
  isStale(locationId: number): boolean {
    const snapshot = this.locations.get(locationId);
    if (!snapshot?.updatedAt) {
      return true;
    }
    const maxAge = Math.max(this.settings!.pollingIntervalMs * 4, 5 * 60_000);
    return Date.now() - snapshot.updatedAt > maxAge;
  }

  private refreshAll(): void {
    for (const handler of this.handlers.values()) {
      try {
        handler.refresh();
      } catch (err) {
        this.logger.debug(`Accessory refresh failed: ${errorMessage(err)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Commands (serialised per location so the panel never receives overlapping commands)
  // ---------------------------------------------------------------------------

  private enqueue<T>(locationId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.commandQueues.get(locationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.commandQueues.set(
      locationId,
      next.catch(() => undefined),
    );
    return next;
  }

  private requireLocation(locationId: number): LocationSnapshot {
    const snapshot = this.locations.get(locationId);
    if (!snapshot || !this.client) {
      throw new Error(`Location ${locationId} is not available`);
    }
    return snapshot;
  }

  arm(locationId: number, partitionIds: number[], mode: HomeArmMode): Promise<void> {
    return this.enqueue(locationId, async () => {
      const loc = this.requireLocation(locationId);
      const armType = armTypeFor(mode);
      try {
        await this.client!.arm(loc.id, loc.deviceId, armType, partitionIds, loc.userCode);
      } catch (err) {
        if (!(err instanceof CommandFailedError) || !this.settings!.autoBypassOnArm) {
          throw this.explain(err, 'arm');
        }
        this.logger.warn(`Arming "${loc.name}" was refused (open zone?). Auto-bypass is enabled; bypassing faulted zones and retrying.`);
        await this.refreshLocation(locationId);
        const bypassed = await this.bypassFaultedZonesNow(loc, partitionIds);
        if (bypassed === 0) {
          throw this.explain(err, 'arm');
        }
        await this.client!.arm(loc.id, loc.deviceId, armType, partitionIds, loc.userCode);
      }
      this.logger.info(`Arm (${mode}) command accepted for "${loc.name}" partition(s) ${partitionIds.join(', ')}`);
      this.requestFastPolling();
    });
  }

  disarm(locationId: number, partitionIds: number[]): Promise<void> {
    return this.enqueue(locationId, async () => {
      const loc = this.requireLocation(locationId);
      try {
        await this.client!.disarm(loc.id, loc.deviceId, partitionIds, loc.userCode);
      } catch (err) {
        throw this.explain(err, 'disarm');
      }
      this.logger.info(`Disarm command accepted for "${loc.name}" partition(s) ${partitionIds.join(', ')}`);
      this.requestFastPolling();
    });
  }

  bypassFaultedZones(locationId: number, partitionIds: number[]): Promise<number> {
    return this.enqueue(locationId, async () => {
      const loc = this.requireLocation(locationId);
      await this.refreshLocation(locationId);
      const count = await this.bypassFaultedZonesNow(loc, partitionIds);
      this.requestFastPolling(30_000);
      return count;
    });
  }

  bypassZone(locationId: number, zoneId: number): Promise<void> {
    return this.enqueue(locationId, async () => {
      const loc = this.requireLocation(locationId);
      const zone = loc.zones.get(zoneId);
      if (zone && !zone.canBypass) {
        throw new Error(`Zone "${zone.name}" cannot be bypassed`);
      }
      try {
        await this.client!.bypassZones(loc.id, loc.deviceId, [zoneId], loc.userCode);
      } catch (err) {
        throw this.explain(err, 'bypass');
      }
      this.logger.info(`Bypassed zone ${zoneId} at "${loc.name}"`);
      this.requestFastPolling(30_000);
    });
  }

  clearBypass(locationId: number, partitionIds: number[]): Promise<void> {
    return this.enqueue(locationId, async () => {
      const loc = this.requireLocation(locationId);
      try {
        await this.client!.clearBypass(loc.id, loc.deviceId, partitionIds, loc.userCode);
      } catch (err) {
        throw this.explain(err, 'clear bypass');
      }
      this.logger.info(`Cleared bypassed zones at "${loc.name}" partition(s) ${partitionIds.join(', ')}`);
      this.requestFastPolling(30_000);
    });
  }

  private async bypassFaultedZonesNow(loc: LocationSnapshot, partitionIds: number[]): Promise<number> {
    const candidates = [...loc.zones.values()].filter((z) => {
      const f = zoneFlags(z.status);
      return partitionIds.includes(z.partitionId) && (f.faulted || f.triggered) && !f.bypassed;
    });
    const bypassable = candidates.filter((z) => z.canBypass);
    for (const z of candidates.filter((c) => !c.canBypass)) {
      this.logger.warn(`Zone "${z.name}" is open but cannot be bypassed`);
    }
    if (bypassable.length === 0) {
      this.logger.info(`No open zones to bypass at "${loc.name}"`);
      return 0;
    }
    try {
      await this.client!.bypassZones(
        loc.id,
        loc.deviceId,
        bypassable.map((z) => z.id),
        loc.userCode,
      );
    } catch (err) {
      throw this.explain(err, 'bypass');
    }
    this.logger.info(`Bypassed ${bypassable.length} zone(s) at "${loc.name}": ${bypassable.map((z) => z.name).join(', ')}`);
    return bypassable.length;
  }

  private async autoBypassLowBatteryZones(loc: LocationSnapshot): Promise<void> {
    if (!this.settings?.autoBypassLowBattery || armFamily(loc.armingState) !== 'disarmed') {
      return;
    }
    const zones = [...loc.zones.values()].filter((z) => {
      const key = `${loc.id}:${z.id}`;
      const f = zoneFlags(z.status);
      if (!f.lowBattery) {
        this.autoBypassedLowBattery.delete(key);
      }
      return f.lowBattery && !f.bypassed && z.canBypass && !this.autoBypassedLowBattery.has(key);
    });
    for (const z of zones) {
      this.autoBypassedLowBattery.add(`${loc.id}:${z.id}`);
      this.logger.warn(`Zone "${z.name}" has a low battery; bypassing it automatically`);
      await this.bypassZone(loc.id, z.id).catch((err) => this.logger.warn(`Auto-bypass of "${z.name}" failed: ${errorMessage(err)}`));
    }
  }

  /** Adds actionable guidance to common failures. */
  private explain(err: unknown, action: string): Error {
    if (err instanceof UserCodeError) {
      return new Error(`Could not ${action}: the panel rejected the user code. Set a valid "userCode" in the plugin settings.`);
    }
    if (err instanceof CommandFailedError) {
      return new Error(`Could not ${action}: the panel refused the command (is a door/window open?). ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

