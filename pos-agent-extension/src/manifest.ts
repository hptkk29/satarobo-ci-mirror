/**
 * Manifest V3 theo môi trường — script đóng gói ghi ra `manifest.json`. KHÔNG nằm trong gói.
 *
 * Quyền tối thiểu (roadmap §6 GĐ5): `alarms`, `storage`, `tabs`; host = portal Techcombank +
 * ĐÚNG MỘT địa chỉ satarobo (hợp đồng §1) ⇒ hai gói: PROD và TEST. Không `externally_connectable`,
 * không `web_accessible_resources` ⇒ không trang web nào nói chuyện được với extension.
 */
import { PHIEN_BAN, PORTAL_MATCH, SATAROBO_GOC, type MoiTruongSatarobo } from "./lib/hang-so.js";

export interface ContentScriptManifest {
  matches: string[];
  js: string[];
  run_at: "document_start";
  all_frames: false;
  world?: "MAIN";
}

export interface ManifestV3 {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  minimum_chrome_version: string;
  permissions: string[];
  host_permissions: string[];
  background: { service_worker: string; type: "module" };
  content_scripts: ContentScriptManifest[];
  options_ui: { page: string; open_in_tab: boolean };
  action: { default_title: string };
  content_security_policy: { extension_pages: string };
}

export function dungManifest(moiTruong: MoiTruongSatarobo): ManifestV3 {
  return {
    manifest_version: 3,
    name: moiTruong === "PROD" ? "SataRobo POS Agent" : "SataRobo POS Agent (TEST)",
    version: PHIEN_BAN,
    description:
      "Đọc giao dịch thẻ SmartPOS từ merchant portal Techcombank trong phiên người đã đăng nhập và gửi về satarobo. Không lưu mật khẩu, không gửi token.",
    // `world: "MAIN"` cho content script khai trong manifest cần Chrome 111.
    minimum_chrome_version: "111",
    permissions: ["alarms", "storage", "tabs"],
    host_permissions: [PORTAL_MATCH, `${SATAROBO_GOC[moiTruong]}/*`],
    background: { service_worker: "background.js", type: "module" },
    content_scripts: [
      { matches: [PORTAL_MATCH], js: ["content-isolated.js"], run_at: "document_start", all_frames: false },
      { matches: [PORTAL_MATCH], js: ["content-main.js"], run_at: "document_start", all_frames: false, world: "MAIN" },
    ],
    options_ui: { page: "options.html", open_in_tab: true },
    action: { default_title: "SataRobo POS Agent" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}
