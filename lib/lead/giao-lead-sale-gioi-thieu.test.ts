/**
 * [GLS-W*] LƯỚI GHIM DÂY NỐI — bốn đường thu lead từ link giới thiệu đều gọi `giaoLeadChoSaleGioiThieu` với người nhận lấy từ `chuanBiReferral(...).nguoiNhanLead`.
 * Hành vi chạy thật ở `tests/disc-db/giao-lead-sale-gioi-thieu.test.ts` ([GLS-01..05], phủ Tủ sách + DISC); hai đường `/api/leads` và `/intake` chạm HTTP/ingest nên ghim ở đây.
 * Mã TRƯỚC bản vá (20/11/2026): `/api/leads` truyền `aff: null` cố định; ingest chỉ lấy `aff` từ mã NV trên phiếu; DISC/Tủ sách gọi thẳng `autoAssignNewLead`/`chiaChoLead(aff: null)`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[GLS-W] bốn đường gọi giao lead cho Sale giới thiệu", () => {
  it("[GLS-W1] /api/leads: gọi với `coAff?.nguoiNhanLead` và đường chia cũ chỉ chạy khi KHÔNG giao được", () => {
    const s = doc("app/api/leads/route.ts");
    expect(dem(s, /giaoLeadChoSaleGioiThieu\(\{[^}]*nguoiGioiThieu: coAff\?\.nguoiNhanLead \?\? null/g)).toBe(1);
    expect(dem(s, /if \(daGiaoChoSale\) \{[\s\S]{0,40}\} else if \(lead\.centerId\)/g)).toBe(1);
  });
  it("[GLS-W2] /intake: truyền `co?.nguoiNhanLead` vào ingest; ingest dùng nó làm `aff` ở nhánh có cơ sở VÀ gọi giao ở nhánh không cơ sở", () => {
    expect(dem(doc("lib/affiliate/intake-cong-khai.ts"), /nguoiGioiThieuLead: co\?\.nguoiNhanLead \?\? null/g)).toBe(1);
    const g = doc("lib/lead/intake/ingest.ts");
    expect(dem(g, /const aff =\s*ctx\.nguoiGioiThieuLead \?\?/g)).toBe(1);
    expect(dem(g, /giaoLeadChoSaleGioiThieu\(\{[^}]*nguoiGioiThieu: ctx\.nguoiGioiThieuLead \?\? null/g)).toBe(1);
    expect(dem(g, /if \(!daCoChuTuMaGioiThieu && !daGiaoChoSale\)/g)).toBe(1);
  });
  it("[GLS-W3] DISC + Tủ sách: gọi giao với `gioiThieu?.nguoiNhanLead` trước đường chia cũ", () => {
    expect(dem(doc("lib/disc/crm-that.ts"), /if \(await giaoLeadChoSaleGioiThieu\(\{[^}]*nguoiGioiThieu: chuanBi\.gioiThieu\?\.nguoiNhanLead \?\? null[^}]*\}\)\) return;/g)).toBe(1);
    const t = doc("lib/cong-thong-tin/tao-lead.ts");
    expect(dem(t, /nguoiGioiThieu: gioiThieu\?\.nguoiNhanLead \?\? null/g)).toBe(1);
    expect(dem(t, /if \(laLeadMoi && !daGiaoChoSale\)/g)).toBe(1);
  });
  it("[GLS-W4] người nhận lead chỉ được dựng khi lượt giới thiệu HỢP LỆ (lượt xem tay / từ chối không kéo lead về ai)", () => {
    expect(dem(doc("lib/affiliate/nhan-referral.ts"), /quyetDinh\.loai === "HOP_LE" && asset\.party\.employeeId/g)).toBe(1);
  });
});
