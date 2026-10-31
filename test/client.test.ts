import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { TotalConnectClient } from '../src/api/client.js';
import { ArmType, BOOTSTRAP_CONFIG_URL, ResultCode } from '../src/api/constants.js';
import { AuthenticationError, TransientError } from '../src/api/errors.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const spkiB64 = (publicKey.export({ type: 'spki', format: 'pem' }) as string)
  .replace(/-----.*-----/g, '')
  .replace(/\s+/g, '');

const BOOTSTRAP_JSON = {
  RevisionNumber: '3.55.0',
  version: '0.0.1875',
  brandInfo: [{ BrandName: 'totalconnect', AppID: 16808 }],
  AppConfig: [
    {
      tc2APIKey: spkiB64,
      tc2ClientId: 'test-client-id',
      getRESTAuthUrl: 'https://rs.alarmnet.com/TC2API.Auth/token',
      getRESTResourceUrl: 'https://rs.alarmnet.com/TC2API.TCResource/api',
    },
  ],
};

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

describe('TotalConnectClient', () => {
  it('bootstraps, encrypts credentials, calls endpoints and refreshes expired sessions', async () => {
    const calls: { url: string; method: string; body?: string; auth?: string | null }[] = [];
    let statusAttempt = 0;

    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const bodyStr = init?.body ? String(init.body) : undefined;
      calls.push({ url, method, body: bodyStr, auth: headers.get('authorization') });

      if (url === BOOTSTRAP_CONFIG_URL) {
        return jsonResponse(BOOTSTRAP_JSON);
      }
      if (url === 'https://rs.alarmnet.com/TC2API.Auth/token') {
        const params = new URLSearchParams(bodyStr);
        if (params.get('grant_type') === 'refresh_token') {
          return jsonResponse({ access_token: 'token-refreshed', refresh_token: 'rt-2', expires_in: 1200 });
        }
        expect(params.get('username')).not.toBe('alice');
        expect(params.get('password')).not.toBe('s3cret');
        return jsonResponse({ access_token: 'token-initial', refresh_token: 'rt-1', expires_in: 1200 });
      }
      if (url.includes('/v3/authentication/sessiondetails')) {
        return jsonResponse({
          ResultCode: 0,
          SessionDetailsResult: {
            UserInfo: { UserID: 1, Username: 'alice' },
            Locations: [{ LocationID: 42, LocationName: 'Home', SecurityDeviceID: 99 }],
          },
        });
      }
      if (url.includes('/v3/locations/42/partitions/fullStatus')) {
        statusAttempt++;
        if (statusAttempt === 1) {
          // Simulate server-side session expiration -> should refresh token and retry transparently
          return jsonResponse({ ResultCode: ResultCode.INVALID_SESSION });
        }
        return jsonResponse({ ResultCode: 0, ArmingState: 10200, PanelStatus: { Partitions: [], Zones: [] } });
      }
      if (url.includes('/v3/locations/42/devices/99/partitions/arm')) {
        return jsonResponse({ ResultCode: ResultCode.COMMAND_ACCEPTED });
      }
      if (url.includes('/v3/authentication/logout')) {
        return jsonResponse({ ResultCode: 0 });
      }
      return jsonResponse({ ResultCode: 0 });
    };

    const client = new TotalConnectClient({
      username: 'alice',
      password: 's3cret',
      fetchImpl: fetchMock,
      retryBaseDelayMs: 5,
    });

    const session = await client.login();
    expect(session.Locations?.[0].LocationID).toBe(42);

    const status = await client.getFullStatus(42);
    expect(status.ArmingState).toBe(10200);
    expect(statusAttempt).toBe(2);

    const armRes = await client.arm(42, 99, ArmType.STAY, [1], '1234');
    expect(armRes.ResultCode).toBe(ResultCode.COMMAND_ACCEPTED);
    const armCall = calls.find((c) => c.url.includes('/partitions/arm'))!;
    expect(armCall.auth).toBe('Bearer token-refreshed');
    expect(JSON.parse(armCall.body!)).toEqual({ armType: ArmType.STAY, userCode: 1234, partitions: [1] });

    await client.logout();
    expect(client.isAuthenticated).toBe(false);
  });

  it('trips the credential circuit-breaker on bad password to prevent account lockout', async () => {
    let tokenCalls = 0;
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url === BOOTSTRAP_CONFIG_URL) {
        return jsonResponse(BOOTSTRAP_JSON);
      }
      tokenCalls++;
      return jsonResponse({ error: String(ResultCode.BAD_USER_OR_PASSWORD) }, 400);
    };

    const client = new TotalConnectClient({
      username: 'alice',
      password: 'wrong',
      fetchImpl: fetchMock,
      retryBaseDelayMs: 5,
    });

    await expect(client.login()).rejects.toThrow(AuthenticationError);
    // Second call must reject immediately without hitting the token endpoint again
    await expect(client.login()).rejects.toThrow(AuthenticationError);
    expect(tokenCalls).toBe(1);
  });

  it('retries transient 503 responses and succeeds when service recovers', async () => {
    let statusCalls = 0;
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url === BOOTSTRAP_CONFIG_URL) {
        return jsonResponse(BOOTSTRAP_JSON);
      }
      if (url.endsWith('/token')) {
        return jsonResponse({ access_token: 'tok', expires_in: 1200 });
      }
      statusCalls++;
      if (statusCalls < 3) {
        return jsonResponse({ message: 'unavailable' }, 503);
      }
      return jsonResponse({ ResultCode: 0, ArmingState: 10203, PanelStatus: {} });
    };

    const client = new TotalConnectClient({
      username: 'alice',
      password: 'ok',
      fetchImpl: fetchMock,
      maxAttempts: 3,
      retryBaseDelayMs: 5,
    });

    const res = await client.getFullStatus(1);
    expect(res.ArmingState).toBe(10203);
    expect(statusCalls).toBe(3);

    // Exhausting attempts throws TransientError
    const failing = new TotalConnectClient({
      username: 'alice',
      password: 'ok',
      fetchImpl: async (input) =>
        String(input) === BOOTSTRAP_CONFIG_URL ? jsonResponse(BOOTSTRAP_JSON) : jsonResponse({}, 503),
      maxAttempts: 2,
      retryBaseDelayMs: 5,
    });
    await expect(failing.login()).rejects.toThrow(TransientError);
  });
});

