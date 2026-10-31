/** Error hierarchy for the Total Connect client. */

export class TotalConnectError extends Error {
  public readonly resultCode?: number;

  constructor(message: string, resultCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.resultCode = resultCode;
  }
}

/** The username/password were rejected or the account is locked. Never retried automatically. */
export class AuthenticationError extends TotalConnectError {}

/** The session/token is no longer valid; re-authentication is required. */
export class SessionExpiredError extends TotalConnectError {}

/** Temporary failure (network, 5xx, panel unreachable). Safe to retry later. */
export class TransientError extends TotalConnectError {}

/** The configured user code was rejected by the panel. */
export class UserCodeError extends TotalConnectError {}

/** The panel refused an arm command, usually because a zone is faulted (open). */
export class CommandFailedError extends TotalConnectError {}

/** The account / hardware does not support the requested feature. */
export class FeatureNotSupportedError extends TotalConnectError {}

