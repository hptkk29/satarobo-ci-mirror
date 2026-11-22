// Cookie consent helpers — NĐ 13/2023/NĐ-CP compliance
// Stores user consent in localStorage with version stamp.
// Bump CONSENT_VERSION when consent terms change to force re-prompt.

export const CONSENT_VERSION = "2026-05-17";
export const CONSENT_STORAGE_KEY = "satarobo:consent:v1";
export const CONSENT_COOKIE_NAME = "satarobo-consent";

export type ConsentCategory = "necessary" | "analytics" | "marketing";

export type ConsentState = {
  version: string;
  acceptedAt: string; // ISO timestamp
  categories: Record<ConsentCategory, boolean>;
};

const DEFAULT_DENIED: ConsentState["categories"] = {
  necessary: true, // always granted (essential cookies)
  analytics: false,
  marketing: false,
};

const DEFAULT_GRANTED: ConsentState["categories"] = {
  necessary: true,
  analytics: true,
  marketing: true,
};

/** Read consent state from localStorage. Returns null if not consented or expired. */
export function readConsent(): ConsentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (parsed.version !== CONSENT_VERSION) return null; // version mismatch → re-prompt
    return parsed;
  } catch {
    return null;
  }
}

/** Persist consent state and broadcast a `consent-change` event for live listeners. */
export function writeConsent(categories: ConsentState["categories"]): ConsentState {
  const state: ConsentState = {
    version: CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    categories,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
    // Also set a cookie so server-side can read it (for SSR/middleware decisions).
    // Expires in 12 months — also document this retention in Privacy policy.
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(
      JSON.stringify(categories),
    )}; max-age=${maxAge}; path=/; samesite=lax`;
    window.dispatchEvent(new CustomEvent("consent-change", { detail: state }));
  }
  return state;
}

export function acceptAll() {
  return writeConsent(DEFAULT_GRANTED);
}

export function rejectAll() {
  return writeConsent(DEFAULT_DENIED);
}

export function hasConsent(category: ConsentCategory): boolean {
  const c = readConsent();
  if (!c) return false;
  return c.categories[category] === true;
}

/** Clear consent — used in Privacy Center "Withdraw consent" button. */
export function clearConsent() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  document.cookie = `${CONSENT_COOKIE_NAME}=; max-age=0; path=/`;
  window.dispatchEvent(new CustomEvent("consent-change", { detail: null }));
}
