# Security Policy

## Credential & Token Protections

`homebridge-honeywell-totalconnect` controls physical home security hardware, so security is treated as a first-class requirement:

1. **RSA-Encrypted Authentication**: Your Total Connect username and password are encrypted locally using Resideo's RSA public key (`PKCS#1 v1.5`) before being sent over HTTPS (`TLS 1.2+`) to `TC2API.Auth/token`. Plaintext credentials never travel on the wire.
2. **Strict Host Pinning & Redirect Blocking**: Every API URL (including dynamic URLs returned by the bootstrap configuration) is validated with `assertTrustedUrl()` to enforce `https:` and a `*.alarmnet.com` hostname without embedded credentials, with HTTP redirects disabled (`redirect: 'error'`). Tokens and credentials are never sent to untrusted hosts.
3. **Zero-Persistence Tokens**: OAuth access and refresh tokens are kept strictly in process memory and invalidated via `/v3/authentication/logout` on Homebridge shutdown.
4. **Account Lockout Circuit Breaker**: If Total Connect rejects a username/password (`-50004`, `-100`, `invalid_grant`) or reports a locked account (`-123`), automatic retries halt immediately so background polling cannot lock out your alarm account.
5. **Automatic Log Redaction**: All debug request/response logging passes through a recursive redactor (`src/api/util.ts`) that scrubs `username`, `password`, `userCode`, `access_token`, `refresh_token`, `Authorization`, and `OTP` values.
6. **Environment Variable Secret Injection**: Credentials and panel user codes can be supplied via `TOTALCONNECT_USERNAME`, `TOTALCONNECT_PASSWORD`, and `TOTALCONNECT_USERCODE` environment variables so secrets never need to be stored in `config.json`.
7. **Minimal Dependency Footprint**: Zero third-party HTTP or crypto runtime dependencies — built entirely on Node.js native `fetch`, `AbortSignal.timeout`, and `node:crypto`, plus `@homebridge/plugin-ui-utils` for the local Homebridge settings UI.
8. **XSS-Safe Custom UI**: The custom Homebridge configuration UI constructs DOM nodes exclusively with `textContent` (never `innerHTML`) and rate-limits login tests.

## Recommended Hardening for Users

- **Create a dedicated Total Connect user** for Homebridge with standard alarm permissions rather than sharing your primary master login.
- **Consider setting `allowDisarm: false`** if you want HomeKit automations and Siri to arm your system without ever being able to disarm it.
- **Restrict permissions on Homebridge's `config.json`** (`chmod 600`) or pass secrets via environment variables in your service unit / container config.

## Reporting a Vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/NightPants/Homebridge_TotalConnect2_0/security/advisories/new) rather than opening a public issue.

