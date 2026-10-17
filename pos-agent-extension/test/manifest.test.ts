/**
 * Manifest V3 — QUYỀN TỐI THIỂU (roadmap §6 GĐ5): `permissions` = alarms, storage, tabs;
 * `host_permissions` = portal Techcombank + ĐÚNG MỘT địa chỉ satarobo (hợp đồng §1). Không cửa
 * vào nào từ web (không `externally_connectable`, không `web_accessible_resources`) ⇒ chỉ
 * kết nối ĐI RA.
 */
import { describe, expect, it } from "vitest";
import { dungManifest } from "../src/manifest";
import { PHIEN_BAN } from "../src/lib/hang-so";

describe("Manifest V3", () => {
  it("[EXT-MF-01] quyền đúng ba thứ; host đúng portal + MỘT host satarobo theo môi trường", () => {
    const p = dungManifest("PROD");
    const t = dungManifest("TEST");
    expect(p.permissions).toEqual(["alarms", "storage", "tabs"]);
    expect(t.permissions).toEqual(["alarms", "storage", "tabs"]);
    expect(p.host_permissions).toEqual(["https://merchant.techcombank.com/*", "https://admin.satarobo.vn/*"]);
    expect(t.host_permissions).toEqual(["https://merchant.techcombank.com/*", "https://test.satarobo.vn/*"]);
  });

  it("[EXT-MF-02] hai content script chỉ trên portal, document_start, khung chính; một chạy world MAIN", () => {
    const m = dungManifest("PROD");
    expect(m.content_scripts).toEqual([
      {
        matches: ["https://merchant.techcombank.com/*"],
        js: ["content-isolated.js"],
        run_at: "document_start",
        all_frames: false,
      },
      {
        matches: ["https://merchant.techcombank.com/*"],
        js: ["content-main.js"],
        run_at: "document_start",
        all_frames: false,
        world: "MAIN",
      },
    ]);
  });

  it("[EXT-MF-03] không cửa vào từ web, không quyền tuỳ chọn, CSP mặc định chặt", () => {
    const m = dungManifest("PROD") as unknown as Record<string, unknown>;
    for (const k of ["externally_connectable", "web_accessible_resources", "optional_permissions", "optional_host_permissions"]) {
      expect(m[k]).toBeUndefined();
    }
    expect(m.content_security_policy).toEqual({ extension_pages: "script-src 'self'; object-src 'self'" });
  });

  it("[EXT-MF-04] service worker module, trang options, phiên bản thống nhất, Chrome ≥ 111 (world MAIN)", () => {
    const m = dungManifest("TEST");
    expect(m.manifest_version).toBe(3);
    expect(m.version).toBe(PHIEN_BAN);
    expect(m.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(m.options_ui).toEqual({ page: "options.html", open_in_tab: true });
    expect(Number(m.minimum_chrome_version)).toBeGreaterThanOrEqual(111);
    expect(m.name).toMatch(/SataRobo POS Agent/);
  });
});
