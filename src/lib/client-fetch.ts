"use client";

/**
 * Single client entry point for all state-changing API requests.
 *
 * Attaches X-App-Origin (the page's own origin) so the server's
 * same-origin check has an app-attested fallback when the browser or a
 * reverse proxy omits the Origin/Referer headers on same-origin POSTs
 * (e.g. Safari). Cross-origin requests cannot misuse this header: the
 * browser always adds a real Origin header to cross-origin POSTs and
 * custom headers trigger a CORS preflight the app does not authorize.
 */
export function appPost(endpoint: string, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    headers["X-App-Origin"] = window.location.origin;
  }
  return fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
    credentials: "same-origin",
    referrerPolicy: "origin",
    cache: "no-store",
  });
}

/**
 * Converts an absolute same-app URL (e.g. http://host/verify-email?token=x)
 * into a relative path so the browser navigates with its own scheme and
 * origin. TLS-terminating proxies report the internal hop's scheme, so an
 * absolute link could point at the wrong scheme; same-app navigation avoids
 * that entirely. Falls back to the input for already-relative paths.
 */
export function sameAppPath(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return url;
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}
