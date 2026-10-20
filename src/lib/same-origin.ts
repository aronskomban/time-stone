/**
 * Pure same-origin (CSRF) decision for state-changing requests.
 * Kept dependency-free so it can be unit tested without the database.
 */

export type OriginHeaders = {
  origin?: string | null;
  referer?: string | null;
  "x-app-origin"?: string | null;
  "sec-fetch-site"?: string | null;
};

export type OriginDecision = { ok: true } | { ok: false; message: string; status: number };

const CROSS_ORIGIN: OriginDecision = { ok: false, message: "Cross-origin request rejected", status: 403 };
const MISSING: OriginDecision = { ok: false, message: "Request origin is required", status: 403 };
const INVALID: OriginDecision = { ok: false, message: "Request origin is invalid", status: 403 };

/**
 * host:port of a URL, with default ports dropped and the host lowercased.
 * Scheme is not compared: TLS-terminating proxies report the internal hop's
 * scheme, which often does not match the browser's https origin.
 */
export function hostPortOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
    return `${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}

/**
 * Accepts a full origin (`https://app.example`) or a bare host
 * (`app.example`, optionally quoted). Bare hosts are treated as https.
 * Returns null when the value cannot be parsed — never throws.
 */
export function parseConfiguredOrigin(raw?: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/^["']+|["']+$/g, "");
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Decision rules, in order:
 *
 * 1. Browser Origin, then Referer, then the app-attested X-App-Origin the
 *    frontend attaches to every POST. The first present signal must parse and
 *    its host:port must be in the allowed set (the inbound Host and, when
 *    configured, APP_ORIGIN). Cross-origin fetch/XHR POSTs always carry a
 *    real Origin, so a browser attacker cannot spoof a matching host.
 * 2. If the browser sent Sec-Fetch-Site and it is not "same-origin", reject
 *    even when a matching header is present.
 * 3. With no Origin/Referer/X-App-Origin, a browser-certified
 *    Sec-Fetch-Site: same-origin is accepted (Safari / no-referrer pages).
 * 4. Anything else is rejected. Validation is never skipped.
 */
export function evaluateSameOrigin(headers: OriginHeaders, allowedHosts: string | string[]): OriginDecision {
  const allowed = new Set(
    (Array.isArray(allowedHosts) ? allowedHosts : [allowedHosts])
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  const signals: Array<[string | null | undefined, OriginDecision]> = [
    [emptyToNull(headers.origin), INVALID],
    [emptyToNull(headers.referer), INVALID],
    [emptyToNull(headers["x-app-origin"]), INVALID],
  ];
  const first = signals.find(([value]) => value);
  const secFetchSite = (headers["sec-fetch-site"] ?? "").trim().toLowerCase();

  if (first) {
    const [value, invalidDecision] = first;
    if ((value as string).toLowerCase() === "null") return INVALID;
    const hostPort = hostPortOf(value as string);
    if (hostPort === null) return invalidDecision;
    if (!allowed.has(hostPort)) return CROSS_ORIGIN;
    if (secFetchSite && secFetchSite !== "same-origin") return CROSS_ORIGIN;
    return { ok: true };
  }

  if (secFetchSite === "same-origin") return { ok: true };
  return MISSING;
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * host:port the client used to reach the app, from x-forwarded-host / Host.
 * request.url is a last resort: some runtimes build it from the bind address
 * (0.0.0.0), which never matches the browser origin.
 */
export function inboundHostPort(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "";
  const bare = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "");
  if (bare) {
    const parts = bare.split(":");
    const port = parts.length > 1 ? parts.pop() : "";
    const name = parts.join(":").toLowerCase();
    if (port && (port === "80" || port === "443")) return name;
    return port ? `${name}:${port}` : name;
  }
  const url = new URL(request.url);
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  return `${url.hostname.toLowerCase()}${port}`;
}

/** Inbound request host plus a parsed APP_ORIGIN host, if configured. */
export function allowedHostPorts(request: Request, configuredOrigin?: string | null): string[] {
  const hosts = new Set<string>();
  hosts.add(inboundHostPort(request));
  const configured = parseConfiguredOrigin(configuredOrigin);
  if (configured) {
    const host = hostPortOf(configured);
    if (host) hosts.add(host);
  }
  return [...hosts];
}
