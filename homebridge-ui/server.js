/**
 * Custom Homebridge UI server for homebridge-honeywell-totalconnect.
 *
 * Exposes a single "/discover" request used by the settings screen to test the account and list
 * locations, partitions and zones so users can configure the plugin without guessing IDs.
 * Runs locally inside the (authenticated) Homebridge UI; nothing is persisted and no tokens or
 * credentials are ever returned to the browser.
 */
import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { TotalConnectClient } from '../dist/api/client.js';
import { AuthenticationError } from '../dist/api/errors.js';
import { autoSensorType, isButtonZone, partitionFromInfo, zoneFromInfo, zoneFlags } from '../dist/model.js';

/** Minimum gap between login attempts, to avoid tripping the account lockout. */
const MIN_INTERVAL_MS = 5_000;

class TotalConnectUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.busy = false;
    this.lastAttempt = 0;
    this.onRequest('/discover', (payload) => this.discover(payload));
    this.ready();
  }

  async discover(payload) {
    const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!username || !password) {
      throw new RequestError('Enter your Total Connect username and password first.', { status: 400 });
    }
    if (this.busy) {
      throw new RequestError('A discovery request is already running.', { status: 429 });
    }
    const wait = this.lastAttempt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      throw new RequestError(`Please wait ${Math.ceil(wait / 1000)} s before trying again.`, { status: 429 });
    }

    this.busy = true;
    this.lastAttempt = Date.now();
    const client = new TotalConnectClient({ username, password, timeoutMs: 30_000, maxAttempts: 2 });

    try {
      const session = await client.login();
      const locations = [];

      for (const loc of session.Locations ?? []) {
        const entry = {
          locationId: loc.LocationID,
          name: loc.LocationName,
          deviceId: loc.SecurityDeviceID,
          partitions: [],
          zones: [],
          error: undefined,
        };
        try {
          const partitions = await client.getPartitionConfig(loc.LocationID, loc.SecurityDeviceID);
          entry.partitions = (partitions.Partitions ?? []).map((p) => {
            const snap = partitionFromInfo(p);
            return { id: snap.id, name: snap.name, nightSupported: snap.nightSupported };
          });

          const details = await client.getZoneDetails(loc.LocationID);
          const status = await client.getFullStatus(loc.LocationID);
          const zones = new Map();
          for (const z of details?.ZoneStatus?.Zones ?? []) {
            zones.set(z.ZoneID, zoneFromInfo(loc.LocationID, z));
          }
          for (const z of status.PanelStatus?.Zones ?? []) {
            zones.set(z.ZoneID, zoneFromInfo(loc.LocationID, z, zones.get(z.ZoneID)));
          }
          entry.zones = [...zones.values()]
            .sort((a, b) => a.id - b.id)
            .map((z) => {
              const f = zoneFlags(z.status);
              return {
                id: z.id,
                name: z.name,
                partitionId: z.partitionId,
                zoneType: z.zoneType ?? null,
                suggestedType: isButtonZone(z) ? 'hidden' : autoSensorType(z),
                canBypass: z.canBypass,
                open: f.faulted || f.triggered,
                bypassed: f.bypassed,
                lowBattery: f.lowBattery,
              };
            });
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
        }
        locations.push(entry);
      }

      return { user: session.UserInfo?.Fullname || session.UserInfo?.Username || username, locations };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RequestError(message, { status: err instanceof AuthenticationError ? 401 : 502 });
    } finally {
      this.busy = false;
      await client.logout();
    }
  }
}

(() => new TotalConnectUiServer())();

