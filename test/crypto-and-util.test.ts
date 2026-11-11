import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { assertTrustedUrl, parseUserCode } from '../src/api/client.js';
import { encryptCredential, toPublicKeyPem } from '../src/api/crypto.js';
import { TotalConnectError, UserCodeError } from '../src/api/errors.js';
import { redact } from '../src/api/util.js';
import { safeName } from '../src/util.js';

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % mod;
    }
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

/**
 * Node 20 disabled `crypto.privateDecrypt` with `RSA_PKCS1_PADDING` for CVE-2023-46809.
 * Production code only calls `publicEncrypt`; decrypt directly with the test private key
 * to verify both RSA encryption and EME-PKCS1-v1_5 padding structure across all Node LTS releases.
 */
function decryptPkcs1v15(privateKey: KeyObject, cipherB64: string): string {
  const { n, d } = privateKey.export({ format: 'jwk' });
  const modBytes = Buffer.from(n!, 'base64url');
  const mod = BigInt(`0x${modBytes.toString('hex')}`);
  const exp = BigInt(`0x${Buffer.from(d!, 'base64url').toString('hex')}`);
  const cipher = BigInt(`0x${Buffer.from(cipherB64, 'base64').toString('hex')}`);

  const emHex = modPow(cipher, exp, mod).toString(16).padStart(modBytes.length * 2, '0');
  const em = Buffer.from(emHex, 'hex');
  expect(em[0]).toBe(0x00);
  expect(em[1]).toBe(0x02);
  const sep = em.indexOf(0x00, 2);
  expect(sep).toBeGreaterThanOrEqual(10);
  return em.subarray(sep + 1).toString('utf8');
}

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
    expect(decryptPkcs1v15(privateKey, cipherB64)).toBe('MySecret!123');

    const pem = toPublicKeyPem(bareBase64);
    expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    expect(decryptPkcs1v15(privateKey, encryptCredential('user@example.com', pem))).toBe('user@example.com');
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

