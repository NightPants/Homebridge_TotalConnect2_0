import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { assertTrustedUrl, parseUserCode } from '../src/api/client.js';
import { encryptCredential, toPublicKeyPem } from '../src/api/crypto.js';
import { TotalConnectError, UserCodeError } from '../src/api/errors.js';
import { redact } from '../src/api/util.js';
import { safeName } from '../src/util.js';

describe('crypto & URL security', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const bareBase64 = spkiPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');

  it('encrypts credentials with RSA PKCS#1 v1.5 from either bare base64 or PEM', () => {
    const cipherB64 = encryptCredential('MySecret!123', bareBase64);
    expect(cipherB64).not.toContain('MySecret');
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(cipherB64, 'base64'),
    ).toString('utf8');
    expect(decrypted).toBe('MySecret!123');

    const pem = toPublicKeyPem(bareBase64);
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    const decrypted2 = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(encryptCredential('user@example.com', pem), 'base64'),
    ).toString('utf8');
    expect(decrypted2).toBe('user@example.com');
  });

  it('pins API URLs to HTTPS alarmnet.com hosts without embedded credentials', () => {
    expect(assertTrustedUrl('https://rs.alarmnet.com/TC2API.TCResource/api/')).toBe(
      'https://rs.alarmnet.com/TC2API.TCResource/api',
    );
    expect(assertTrustedUrl('https://alarmnet.com/path')).toBe('https://alarmnet.com/path');

    expect(() => assertTrustedUrl('http://rs.alarmnet.com/TC2API.TCResource/api')).toThrow(TotalConnectError);
    expect(() => assertTrustedUrl('https://evilalarmnet.com/api')).toThrow(TotalConnectError);
    expect(() => assertTrustedUrl('https://rs.alarmnet.com.attacker.invalid/api')).toThrow(TotalConnectError);
    expect(() => assertTrustedUrl('https://user:pass@rs.alarmnet.com/api')).toThrow(TotalConnectError);
    expect(() => assertTrustedUrl('not a url')).toThrow(TotalConnectError);
  });

  it('validates user codes strictly', () => {
    expect(parseUserCode(undefined)).toBe(-1);
    expect(parseUserCode('')).toBe(-1);
    expect(parseUserCode('-1')).toBe(-1);
    expect(parseUserCode('1234')).toBe(1234);
    expect(parseUserCode(' 045678 ')).toBe(45678);
    expect(() => parseUserCode('123')).toThrow(UserCodeError);
    expect(() => parseUserCode('123456789')).toThrow(UserCodeError);
    expect(() => parseUserCode('12ab')).toThrow(UserCodeError);
  });

  it('redacts sensitive fields deeply in debug payloads', () => {
    const scrubbed = redact({
      armType: 1,
      userCode: 1234,
      nested: {
        Password: 'secret',
        access_token: 'tok',
        refresh_token: 'ref',
        safe: 'visible',
      },
    });
    expect(scrubbed).toEqual({
      armType: 1,
      userCode: '[redacted]',
      nested: {
        Password: '[redacted]',
        access_token: '[redacted]',
        refresh_token: '[redacted]',
        safe: 'visible',
      },
    });
  });

  it('sanitises HomeKit accessory names to valid characters', () => {
    expect(safeName('  Front_Door #1!  ')).toBe('Front Door 1');
    expect(safeName('***', 'Fallback')).toBe('Fallback');
    expect(safeName(" Kid's Room - Window, E. ")).toBe("Kid's Room - Window, E");
  });
});

