import { BOOTSTRAP_CONFIG_URL, CREDENTIAL_CODES, DEFAULT_AUTH_URL, DEFAULT_BRAND, DEFAULT_RESOURCE_URL, NO_USER_CODE, ResultCode, SESSION_CODES, SUCCESS_CODES, TRANSIENT_CODES, TRUSTED_API_HOST_SUFFIXES, } from './constants.js';
import { encryptCredential, toPublicKeyPem } from './crypto.js';
import { AuthenticationError, CommandFailedError, FeatureNotSupportedError, SessionExpiredError, TotalConnectError, TransientError, UserCodeError, } from './errors.js';
import { redact, silentLogger, sleep } from './util.js';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const USER_AGENT = 'homebridge-honeywell-totalconnect';
/** Validates that a URL is HTTPS and points to a trusted Resideo/AlarmNet host. */
export function assertTrustedUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new TotalConnectError(`Refusing to use malformed API URL`);
    }
    const host = parsed.hostname.toLowerCase();
    const trusted = TRUSTED_API_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) || `.${host}` === suffix);
    if (parsed.protocol !== 'https:' || !trusted || parsed.username || parsed.password) {
        throw new TotalConnectError(`Refusing to use untrusted API URL host "${host}"`);
    }
    return parsed.toString().replace(/\/+$/, '');
}
/** Converts a user code string to the integer the API expects, validating it first. */
export function parseUserCode(code) {
    const value = (code ?? '').trim() || NO_USER_CODE;
    if (value === NO_USER_CODE) {
        return -1;
    }
    if (!/^\d{4,8}$/.test(value)) {
        throw new UserCodeError('User code must be 4-8 digits');
    }
    return Number.parseInt(value, 10);
}
/**
 * Typed, resilient client for the Total Connect 2.0 REST API.
 *
 * Auth flow (matches the official web/mobile apps):
 *  1. GET the public bootstrap config to obtain the OAuth client id, the RSA public key, the
 *     app id/version and the API base URLs.
 *  2. POST an OAuth2 password grant to TC2API.Auth/token with the username and password
 *     individually RSA-encrypted.
 *  3. Use the bearer token for every TC2API.TCResource call, refreshing via the refresh token
 *     (or re-logging in) when it expires or a session error is returned.
 */
export class TotalConnectClient {
    log;
    fetchImpl;
    timeoutMs;
    maxAttempts;
    retryBaseDelayMs;
    brand;
    username;
    password;
    bootstrap;
    token;
    authInFlight;
    credentialsRejected;
    constructor(options) {
        if (!options.username || !options.password) {
            throw new AuthenticationError('Username and password are required');
        }
        this.username = options.username;
        this.password = options.password;
        this.log = options.logger ?? silentLogger;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
        this.retryBaseDelayMs = options.retryBaseDelayMs ?? 2_000;
        this.brand = options.brand ?? DEFAULT_BRAND;
    }
    /** True once a token has been obtained. */
    get isAuthenticated() {
        return !!this.token;
    }
    // ---------------------------------------------------------------------------
    // Authentication
    // ---------------------------------------------------------------------------
    /** Authenticates (if needed) and returns the session details incl. locations. */
    async login() {
        await this.ensureToken();
        return this.getSessionDetails();
    }
    /** Best-effort logout. Never throws. */
    async logout() {
        if (!this.token) {
            return;
        }
        try {
            await this.request('POST', '/v3/authentication/logout', { raw: true });
        }
        catch (err) {
            this.log.debug(`Logout failed (ignored): ${err.message}`);
        }
        finally {
            this.token = undefined;
        }
    }
    async ensureToken() {
        if (this.credentialsRejected) {
            throw this.credentialsRejected;
        }
        if (this.token && Date.now() < this.token.expiresAt - TOKEN_EXPIRY_SKEW_MS) {
            return;
        }
        await this.authenticate();
    }
    /** Single-flight authentication: concurrent callers share one login. */
    authenticate(forceFull = false) {
        if (!this.authInFlight) {
            this.authInFlight = this.doAuthenticate(forceFull).finally(() => {
                this.authInFlight = undefined;
            });
        }
        return this.authInFlight;
    }
    async doAuthenticate(forceFull) {
        if (!forceFull && this.token?.refreshToken) {
            try {
                await this.requestToken({ grant_type: 'refresh_token', refresh_token: this.token.refreshToken });
                this.log.debug('Access token refreshed');
                return;
            }
            catch (err) {
                if (err instanceof AuthenticationError && this.credentialsRejected) {
                    throw err;
                }
                this.log.debug(`Token refresh failed, performing full login: ${err.message}`);
            }
        }
        this.token = undefined;
        const config = await this.getBootstrap(true);
        await this.requestToken({
            grant_type: 'password',
            username: encryptCredential(this.username, config.publicKeyPem),
            password: encryptCredential(this.password, config.publicKeyPem),
        });
        this.log.info('Authenticated with Total Connect');
    }
    async requestToken(params) {
        const config = await this.getBootstrap();
        const body = new URLSearchParams({ ...params, client_id: config.clientId });
        const response = await this.fetchWithTimeout(config.authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                'User-Agent': USER_AGENT,
            },
            body,
        });
        const json = (await this.parseJson(response));
        if (!response.ok || !json.access_token) {
            const code = Number.parseInt(json.error ?? '', 10);
            if (CREDENTIAL_CODES.has(code) || json.error === 'invalid_grant') {
                // Refresh-token rejection is not a credential problem; only a password grant is.
                if (params.grant_type === 'password') {
                    const message = code === ResultCode.ACCOUNT_LOCKED
                        ? 'Total Connect account is locked. Unlock it via the Total Connect app/website.'
                        : 'Total Connect rejected the username or password.';
                    this.credentialsRejected = new AuthenticationError(message, Number.isNaN(code) ? undefined : code);
                    throw this.credentialsRejected;
                }
                throw new SessionExpiredError('Refresh token rejected');
            }
            if (response.status >= 500 || response.status === 429) {
                throw new TransientError(`Auth service unavailable (HTTP ${response.status})`);
            }
            throw new TotalConnectError(`Authentication failed (HTTP ${response.status}${json.error ? `, ${json.error}` : ''})`, Number.isNaN(code) ? undefined : code);
        }
        const expiresIn = Number(json.expires_in ?? 0) || 1_200;
        this.token = {
            accessToken: json.access_token,
            refreshToken: json.refresh_token ?? this.token?.refreshToken,
            expiresAt: Date.now() + expiresIn * 1_000,
        };
    }
    /** Loads (and caches) the public bootstrap config published by Resideo. */
    async getBootstrap(forceReload = false) {
        if (this.bootstrap && !forceReload) {
            return this.bootstrap;
        }
        try {
            const response = await this.fetchWithTimeout(BOOTSTRAP_CONFIG_URL, {
                headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
            });
            if (!response.ok) {
                throw new TransientError(`Bootstrap config unavailable (HTTP ${response.status})`);
            }
            this.bootstrap = this.parseBootstrap(await response.json());
        }
        catch (err) {
            if (this.bootstrap) {
                this.log.warn(`Could not refresh bootstrap config, using cached copy: ${err.message}`);
                return this.bootstrap;
            }
            throw err instanceof TotalConnectError ? err : new TransientError(`Bootstrap config error: ${err.message}`);
        }
        return this.bootstrap;
    }
    parseBootstrap(raw) {
        const cfg = raw;
        const app = cfg.AppConfig?.[0];
        const brand = cfg.brandInfo?.find((b) => b.BrandName === this.brand);
        if (!app?.tc2APIKey || !app.tc2ClientId || !brand?.AppID || !cfg.RevisionNumber || !cfg.version) {
            throw new TransientError('Bootstrap config is missing required fields');
        }
        const pickUrl = (candidate, fallback) => {
            if (!candidate) {
                return fallback;
            }
            try {
                return assertTrustedUrl(candidate);
            }
            catch (err) {
                this.log.warn(`${err.message}; falling back to ${fallback}`);
                return fallback;
            }
        };
        return {
            clientId: app.tc2ClientId,
            publicKeyPem: toPublicKeyPem(app.tc2APIKey),
            appId: brand.AppID,
            appVersion: `${cfg.RevisionNumber}.${cfg.version.split('.').at(-1)}`,
            authUrl: pickUrl(app.getRESTAuthUrl, DEFAULT_AUTH_URL),
            resourceUrl: pickUrl(app.getRESTResourceUrl, DEFAULT_RESOURCE_URL),
        };
    }
    // ---------------------------------------------------------------------------
    // Resource endpoints
    // ---------------------------------------------------------------------------
    async getSessionDetails() {
        const config = await this.getBootstrap();
        const res = await this.request('GET', '/v3/authentication/sessiondetails', {
            query: { appId: config.appId, appVersion: config.appVersion },
        });
        if (!res.SessionDetailsResult) {
            throw new TotalConnectError('Session details missing from response');
        }
        return res.SessionDetailsResult;
    }
    getPartitionConfig(locationId, deviceId) {
        return this.request('GET', `/v1/locations/${locationId}/devices/${deviceId}/partitions/config`);
    }
    getFullStatus(locationId) {
        return this.request('GET', `/v3/locations/${locationId}/partitions/fullStatus`);
    }
    /** Zone metadata incl. zone types. Returns undefined when unsupported by the account. */
    async getZoneDetails(locationId) {
        try {
            return await this.request('GET', `/v1/locations/${locationId}/partitions/zones/0`);
        }
        catch (err) {
            if (err instanceof FeatureNotSupportedError) {
                return undefined;
            }
            throw err;
        }
    }
    arm(locationId, deviceId, armType, partitions, userCode) {
        return this.request('PUT', `/v3/locations/${locationId}/devices/${deviceId}/partitions/arm`, {
            body: { armType, userCode: parseUserCode(userCode), partitions },
        });
    }
    disarm(locationId, deviceId, partitions, userCode) {
        return this.request('PUT', `/v3/locations/${locationId}/devices/${deviceId}/partitions/disArm`, {
            body: { userCode: parseUserCode(userCode), partitions },
        });
    }
    bypassZones(locationId, deviceId, zoneIds, userCode) {
        return this.request('PUT', `/v1/locations/${locationId}/devices/${deviceId}/bypass`, {
            body: { ZoneIds: zoneIds, UserCode: parseUserCode(userCode) },
        });
    }
    clearBypass(locationId, deviceId, partitions, userCode) {
        return this.request('PUT', `/v2/locations/${locationId}/devices/${deviceId}/clearBypass`, {
            body: { userCode: parseUserCode(userCode), partitions },
        });
    }
    // ---------------------------------------------------------------------------
    // Transport
    // ---------------------------------------------------------------------------
    async request(method, path, options = {}) {
        let sessionRetried = false;
        let lastError;
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                await this.ensureToken();
                const config = await this.getBootstrap();
                const url = new URL(config.resourceUrl + path);
                for (const [k, v] of Object.entries(options.query ?? {})) {
                    if (v !== undefined) {
                        url.searchParams.set(k, String(v));
                    }
                }
                this.log.debug(`→ ${method} ${url.pathname}`, options.body ? JSON.stringify(redact(options.body)) : '');
                const response = await this.fetchWithTimeout(url.toString(), {
                    method,
                    headers: {
                        Authorization: `Bearer ${this.token.accessToken}`,
                        Accept: 'application/json',
                        'User-Agent': USER_AGENT,
                        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                    },
                    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                });
                if (response.status === 401) {
                    throw new SessionExpiredError('HTTP 401 from Total Connect');
                }
                if (response.status === 429 || response.status >= 500) {
                    const retryAfter = Number(response.headers.get('retry-after'));
                    throw Object.assign(new TransientError(`HTTP ${response.status} from Total Connect`), {
                        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : undefined,
                    });
                }
                const json = (await this.parseJson(response));
                this.log.debug(`← ${method} ${url.pathname} HTTP ${response.status} ResultCode=${json.ResultCode ?? 'n/a'}`);
                if (!response.ok && json.ResultCode === undefined) {
                    throw new TotalConnectError(`HTTP ${response.status} from Total Connect`);
                }
                const code = json.ResultCode ?? 0;
                if (SESSION_CODES.has(code)) {
                    throw new SessionExpiredError(`Session rejected (${code})`, code);
                }
                if (TRANSIENT_CODES.has(code)) {
                    throw new TransientError(`Panel communication error (${code}${json.ResultData ? `: ${json.ResultData}` : ''})`, code);
                }
                if (!options.raw) {
                    this.assertResult(json);
                }
                return json;
            }
            catch (err) {
                lastError = err;
                if (err instanceof SessionExpiredError) {
                    // Force ensureToken() to refresh / re-login on the next pass.
                    this.token = this.token ? { ...this.token, expiresAt: 0 } : undefined;
                    if (!sessionRetried) {
                        sessionRetried = true;
                        this.log.debug('Session expired; re-authenticating');
                        attempt--; // the first session refresh does not consume a transient retry
                        continue;
                    }
                }
                const retryable = err instanceof TransientError || err instanceof SessionExpiredError;
                if (!retryable || attempt >= this.maxAttempts) {
                    throw err;
                }
                const backoff = err.retryAfterMs ??
                    this.retryBaseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
                this.log.debug(`${err.message}; retry ${attempt}/${this.maxAttempts - 1} in ${backoff} ms`);
                await sleep(backoff);
            }
        }
        throw lastError;
    }
    /** Maps API ResultCodes to typed errors. */
    assertResult(res) {
        const code = res.ResultCode ?? 0;
        if (SUCCESS_CODES.has(code)) {
            return;
        }
        const detail = res.ResultData ? `: ${res.ResultData}` : '';
        switch (code) {
            case ResultCode.USER_CODE_INVALID:
            case ResultCode.USER_CODE_UNAVAILABLE:
                throw new UserCodeError(`User code rejected by panel (${code})`, code);
            case ResultCode.COMMAND_FAILED:
                throw new CommandFailedError(`Panel refused command (${code})${detail}`, code);
            case ResultCode.FAILED_TO_BYPASS_ZONE:
                throw new CommandFailedError(`Failed to bypass zone (${code})${detail}`, code);
            case ResultCode.FEATURE_NOT_SUPPORTED:
                throw new FeatureNotSupportedError(`Feature not supported (${code})`, code);
            default:
                if (CREDENTIAL_CODES.has(code)) {
                    throw new AuthenticationError(`Authentication failed (${code})`, code);
                }
                throw new TotalConnectError(`Total Connect error ${code}${detail}`, code);
        }
    }
    async fetchWithTimeout(url, init) {
        try {
            return await this.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
        }
        catch (err) {
            const name = err.name;
            if (name === 'TimeoutError' || name === 'AbortError') {
                throw new TransientError(`Request timed out after ${this.timeoutMs} ms`);
            }
            throw new TransientError(`Network error: ${err.message}`, undefined, { cause: err });
        }
    }
    async parseJson(response) {
        const text = await response.text();
        if (!text) {
            return {};
        }
        try {
            return JSON.parse(text);
        }
        catch {
            if (response.status >= 500) {
                throw new TransientError(`Non-JSON response (HTTP ${response.status})`);
            }
            throw new TotalConnectError(`Unexpected non-JSON response (HTTP ${response.status})`);
        }
    }
}
//# sourceMappingURL=client.js.map