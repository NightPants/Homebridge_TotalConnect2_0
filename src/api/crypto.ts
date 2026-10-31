import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto';

/**
 * Converts the base64 SPKI key published in the Total Connect bootstrap config into a PEM.
 * Accepts either a bare base64 body or a full PEM.
 */
export function toPublicKeyPem(key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  const body = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

/**
 * Encrypts a credential for the TC2 OAuth token endpoint.
 *
 * The service requires RSA with PKCS#1 v1.5 padding (not OAEP). Credentials therefore never
 * leave the process in clear text, even before TLS is applied.
 */
export function encryptCredential(value: string, publicKey: string | KeyObject): string {
  const key = typeof publicKey === 'string' ? createPublicKey(toPublicKeyPem(publicKey)) : publicKey;
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(value, 'utf8')).toString('base64');
}

