/**
 * Turns a failed Grafana datasource-resource response into a message worth
 * showing a user.
 *
 * Discovery calls used to swallow every failure and return an empty list, so
 * a credentials or clock problem looked identical to "this account genuinely
 * has no instances" — there was nothing on screen to act on.
 */
export async function describeResourceError(res: Response, what: string): Promise<Error> {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.Message ?? body?.message ?? body?.error ?? "";
  } catch {
    /* non-JSON body */
  }

  // AWS SigV4 stamps every request and refuses anything signed more than five
  // minutes from its own clock. A drifting laptop clock trips this constantly,
  // and the raw message buries the cause. Azure is unaffected because its
  // OAuth tokens stay valid for about an hour, so the same machine can have
  // working Azure and completely broken AWS.
  if (/SignatureDoesNotMatch|Signature expired|RequestTimeTooSkewed/i.test(detail)) {
    return new Error(
      `${what} failed: this machine's clock is more than 5 minutes from real time, ` +
        `so AWS rejects the request signature. Sync your system clock and retry.`,
    );
  }
  if (/AuthFailure|InvalidClientTokenId|UnrecognizedClient|InvalidAccessKeyId/i.test(detail)) {
    return new Error(`${what} failed: AWS rejected these credentials.`);
  }
  if (/AccessDenied|not authorized|AuthorizationError/i.test(detail)) {
    return new Error(
      `${what} failed: these credentials lack permission. CloudWatchReadOnlyAccess covers what CloudPulse reads.`,
    );
  }
  if (detail) return new Error(`${what} failed: ${detail.slice(0, 220)}`);
  return new Error(`${what} failed (HTTP ${res.status})`);
}
