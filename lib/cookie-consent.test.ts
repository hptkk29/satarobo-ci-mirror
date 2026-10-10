// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readConsent,
  writeConsent,
  acceptAll,
  rejectAll,
  clearConsent,
  hasConsent,
  CONSENT_VERSION,
  CONSENT_STORAGE_KEY,
} from "./cookie-consent";

// Mock localStorage cho test env
const store: Record<string, string> = {};

beforeEach(() => {
  // Reset store
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  // Mock document.cookie
  let cookieStr = "";
  Object.defineProperty(document, "cookie", {
    get: () => cookieStr,
    set: (v: string) => {
      cookieStr = v;
    },
    configurable: true,
  });
  // Mock dispatchEvent
  vi.stubGlobal("window", { ...window, dispatchEvent: vi.fn() });
});

describe("cookie-consent", () => {
  it("readConsent returns null when no consent stored", () => {
    expect(readConsent()).toBeNull();
  });

  it("acceptAll grants all categories", () => {
    const state = acceptAll();
    expect(state.categories).toEqual({
      necessary: true,
      analytics: true,
      marketing: true,
    });
    expect(state.version).toBe(CONSENT_VERSION);
  });

  it("rejectAll keeps only necessary", () => {
    const state = rejectAll();
    expect(state.categories).toEqual({
      necessary: true,
      analytics: false,
      marketing: false,
    });
  });

  it("hasConsent returns true for accepted category", () => {
    acceptAll();
    expect(hasConsent("analytics")).toBe(true);
    expect(hasConsent("marketing")).toBe(true);
  });

  it("hasConsent returns false for rejected category", () => {
    rejectAll();
    expect(hasConsent("analytics")).toBe(false);
    expect(hasConsent("marketing")).toBe(false);
    // necessary always true
    expect(hasConsent("necessary")).toBe(true);
  });

  it("clearConsent removes localStorage entry", () => {
    acceptAll();
    expect(readConsent()).not.toBeNull();
    clearConsent();
    expect(readConsent()).toBeNull();
  });

  it("readConsent returns null when version mismatches (forces re-prompt)", () => {
    // Write a fake old-version state directly
    store[CONSENT_STORAGE_KEY] = JSON.stringify({
      version: "1900-01-01",
      acceptedAt: new Date().toISOString(),
      categories: { necessary: true, analytics: true, marketing: true },
    });
    expect(readConsent()).toBeNull();
  });

  it("writeConsent custom categories", () => {
    const state = writeConsent({
      necessary: true,
      analytics: true,
      marketing: false,
    });
    expect(state.categories.analytics).toBe(true);
    expect(state.categories.marketing).toBe(false);
  });
});
