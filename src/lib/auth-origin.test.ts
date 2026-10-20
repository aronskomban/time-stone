import { describe, expect, it } from "vitest";
import { evaluateSameOrigin, parseConfiguredOrigin } from "@/lib/same-origin";

const APP_HOST = "app.example:3000";
const APP = "https://app.example:3000";
const CROSS = "https://evil.example";

describe("parseConfiguredOrigin", () => {
  it("accepts a full https origin", () => {
    expect(parseConfiguredOrigin("https://dataspeherecloud.com")).toBe("https://dataspeherecloud.com");
  });

  it("accepts a bare host and treats it as https", () => {
    expect(parseConfiguredOrigin("dataspeherecloud.com")).toBe("https://dataspeherecloud.com");
  });

  it("strips wrapping quotes from .env values", () => {
    expect(parseConfiguredOrigin('"dataspeherecloud.com"')).toBe("https://dataspeherecloud.com");
  });

  it("returns null for empty or unparseable values instead of throwing", () => {
    expect(parseConfiguredOrigin("")).toBeNull();
    expect(parseConfiguredOrigin("   ")).toBeNull();
    expect(parseConfiguredOrigin("not a host")).toBeNull();
  });
});

describe("evaluateSameOrigin", () => {
  it("accepts a matching browser Origin", () => {
    expect(evaluateSameOrigin({ origin: APP }, APP_HOST)).toEqual({ ok: true });
  });

  it("accepts Origin when APP_ORIGIN is one of several allowed hosts", () => {
    expect(evaluateSameOrigin({ origin: "https://dataspeherecloud.com" }, ["preview.example:3000", "dataspeherecloud.com"])).toEqual({ ok: true });
  });

  it("rejects a cross-origin browser Origin even when other headers match", () => {
    const decision = evaluateSameOrigin({ origin: CROSS, referer: `${APP}/signin`, "x-app-origin": APP }, APP_HOST);
    expect(decision).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("rejects an unparseable Origin", () => {
    expect(evaluateSameOrigin({ origin: "not a url" }, APP_HOST)).toEqual({ ok: false, message: "Request origin is invalid", status: 403 });
  });

  it("rejects the opaque Origin null", () => {
    expect(evaluateSameOrigin({ origin: "null" }, APP_HOST)).toEqual({ ok: false, message: "Request origin is invalid", status: 403 });
  });

  it("treats an empty Origin as missing and falls through to Referer", () => {
    expect(evaluateSameOrigin({ origin: "   ", referer: `${APP}/signin` }, APP_HOST)).toEqual({ ok: true });
  });

  it("accepts same origin via Referer when the browser omits Origin (Safari same-origin POSTs)", () => {
    expect(evaluateSameOrigin({ origin: null, referer: `${APP}/signin` }, APP_HOST)).toEqual({ ok: true });
  });

  it("rejects a cross-origin Referer when Origin is absent (form POST attack)", () => {
    const decision = evaluateSameOrigin({ origin: null, referer: `${CROSS}/attack` }, APP_HOST);
    expect(decision).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("accepts the app-attested X-App-Origin when both browser headers are stripped", () => {
    expect(evaluateSameOrigin({ origin: null, referer: null, "x-app-origin": APP }, APP_HOST)).toEqual({ ok: true });
  });

  it("rejects a mismatched X-App-Origin", () => {
    const decision = evaluateSameOrigin({ origin: null, referer: null, "x-app-origin": CROSS }, APP_HOST);
    expect(decision).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("still rejects requests that carry no origin signals and no browser verdict", () => {
    expect(evaluateSameOrigin({ origin: null, referer: null, "x-app-origin": null, "sec-fetch-site": null }, APP_HOST)).toEqual({ ok: false, message: "Request origin is required", status: 403 });
  });

  it("accepts a browser-certified same-origin request that carries no header signals", () => {
    expect(evaluateSameOrigin({ origin: null, referer: null, "x-app-origin": null, "sec-fetch-site": "same-origin" }, APP_HOST)).toEqual({ ok: true });
  });

  it("lets a cross-site Sec-Fetch-Site verdict override matching headers", () => {
    const decision = evaluateSameOrigin({ origin: APP, "sec-fetch-site": "cross-site" }, APP_HOST);
    expect(decision).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("rejects when Sec-Fetch-Site is same-origin but the available header points elsewhere", () => {
    const decision = evaluateSameOrigin({ origin: null, referer: `${CROSS}/page`, "sec-fetch-site": "same-origin" }, APP_HOST);
    expect(decision).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("compares host:port and ignores scheme", () => {
    expect(evaluateSameOrigin({ origin: "http://app.example:3000" }, APP_HOST)).toEqual({ ok: true });
    expect(evaluateSameOrigin({ origin: "http://app.example:3000" }, "app.example")).toEqual({ ok: false, message: "Cross-origin request rejected", status: 403 });
  });

  it("ignores paths and query strings", () => {
    expect(evaluateSameOrigin({ origin: null, referer: `${APP}/signin?next=workspace` }, APP_HOST)).toEqual({ ok: true });
  });

  it("rejects a lookalike host suffix", () => {
    const decision = evaluateSameOrigin({ origin: "https://app.example.evil.example:3000" }, APP_HOST);
    expect(decision.ok).toBe(false);
  });
});
