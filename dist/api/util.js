export const silentLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};
const SENSITIVE_KEYS = /^(password|username|usercode|access_token|refresh_token|authorization|token|client_id|otp)$/i;
/**
 * Deep-copies a value replacing anything that looks like a secret with "[redacted]".
 * Used for every debug log of request/response payloads.
 */
export function redact(value, depth = 0) {
    if (depth > 8 || value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => redact(v, depth + 1));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
}
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(signal.reason);
        return;
    }
    const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }, ms);
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
});
//# sourceMappingURL=util.js.map