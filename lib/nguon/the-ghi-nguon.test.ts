// @vitest-environment node
/**
 * [THE-*] — THẺ GHI NGUỒN (`the-ghi-nguon.ts`) + lưới dây nối của các đường dùng nó (closeout 19/10/2026, lane A).
 *
 * Hành vi (THUẦN, không DB):
 *   [THE-01] cấp thẻ: giữ ĐÚNG khoá ở cơ sở của LEAD ⇒ có thẻ; giữ ở cơ sở KHÁC ⇒ null (dù nhìn thấy cả hai)
 *   [THE-02] `centerId` null (lead chưa quy được cơ sở) chỉ SUPER_ADMIN / scope ALL / grant ALLOW; khoá khác ở cùng cơ sở không mượn được
 *   [THE-03] `kiemTheGhiNguon`: thẻ tự dựng (kể cả ép kiểu + đóng băng) · thiếu thẻ · thẻ của lead khác ⇒ ném; thẻ do `capTheGhiNguon` cấp ⇒ qua
 *   [THE-04] bảng khoá được phép mở thẻ = ba khoá đổi nguồn + khoá duyệt referral (không chép chuỗi lệch)
 * Lưới ghim mã nguồn (neo hẹp, bỏ chú thích trước khi đếm, đếm SỐ LẦN — luật 11; ĐÃ CẤY, xem bảng ở docs/source-commission/closeout/final-authz-audit.md):
 *   [THE-W1] `doiNguon(tx,` chỉ có HAI nơi gọi (đổi nguồn lead + duyệt referral), mỗi nơi đúng MỘT lần, và đều truyền `the`
 *   [THE-W2] `capTheGhiNguon(` chỉ được gọi ở HAI nơi — và cả hai truyền ĐỐI TƯỢNG LEAD (không phải referral/đề xuất): cơ sở được kiểm là cơ sở của lead
 *   [THE-W3] `doiNguon` đòi `the` (không tuỳ chọn) và kiểm thẻ TRƯỚC `ghiDoiNguon(`; `ghiNguonKhiDuyetReferral` kiểm thẻ TRƯỚC mọi `tx.`
 *   [THE-W4] `doiNguonLead` cấp thẻ SAU `quyetDinhDoiNguon` và TRƯỚC `doiNguon(`; duyệt referral cấp thẻ TRƯỚC `ghiNguonKhiDuyetReferral(`
 *   [THE-W5] `docChoGanNguon`: tiền chỉ ra khi `quyen.ok || duocXemTien` và `duocXemTien` đòi `coQuyenTaiCoSo(…"payments:view", l.centerId)` (không còn `|| xemTien`)
 *   [THE-M1] khoá GHI DANH MỤC DÙNG CHUNG (`sources:manage` · `commission_policies:manage|activate`) chỉ do vai Hội sở / SUPER_ADMIN giữ — chúng không có cơ sở nào để hỏi, nên «GLOBAL» là đúng nghĩa; vai CƠ SỞ giữ chúng ⇒ đỏ
 *   [THE-W6] chụp lại chủ nguồn: `duPhamViChupLai` đòi CẢ HAI khoá ở tầm toàn hệ thống qua `coQuyenToanHeThong` (không chỉ `isHoLevel`)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_SEED } from "../../prisma/seed-roles";
import type { Actor, PermEntry } from "@/lib/auth/actor";
import { coQuyenToanHeThong } from "@/lib/auth/quyen-tai-co-so";
import { KHOA_QUYEN_DOI_NGUON } from "./doi-nguon";
import { KHOA_CAP_THE_GHI_NGUON, capTheGhiNguon, kiemTheGhiNguon, type TheGhiNguon } from "./the-ghi-nguon";

const A = "co-so-a";
const B = "co-so-b";
const KHOA = KHOA_QUYEN_DOI_NGUON.truocThuc;
const perm = (action: string, centerScope: PermEntry["centerScope"]): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "FX", centerScope });
const actor = (permissions: PermEntry[], extra: Partial<Actor> = {}): Actor =>
  ({ userId: "u1", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions, visibleCenterIds: [A, B], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), ...extra }) as Actor;

describe("[THE] thẻ ghi nguồn — hành vi", () => {
  it("[THE-01] giữ khoá ở CS-A ⇒ thẻ cho lead CS-A; lead CS-B (chỉ nhìn thấy) ⇒ null", () => {
    for (const khoa of KHOA_CAP_THE_GHI_NGUON) {
      const a = actor([perm(khoa, [A])]);
      expect(capTheGhiNguon(a, khoa, { id: "l1", centerId: A }), `${khoa} @A`).not.toBeNull();
      expect(capTheGhiNguon(a, khoa, { id: "l2", centerId: B }), `${khoa} @B`).toBeNull();
    }
  });

  it("[THE-02] centerId null chỉ đúng với SUPER_ADMIN / ALL / grant ALLOW; giữ khoá KHÁC cùng cơ sở không mượn được", () => {
    const lead = { id: "l1", centerId: null };
    expect(capTheGhiNguon(actor([perm(KHOA, [A])]), KHOA, lead)).toBeNull();
    expect(capTheGhiNguon(actor([perm(KHOA, "ALL")], { isHoLevel: true }), KHOA, lead)).not.toBeNull();
    expect(capTheGhiNguon(actor([], { isSuperAdmin: true }), KHOA, lead)).not.toBeNull();
    expect(capTheGhiNguon(actor([], { grantsAllow: new Set([KHOA]) }), KHOA, lead)).not.toBeNull();
    // giữ `leads:overwrite` ở A, hỏi `sources:manage` ở A ⇒ không
    expect(capTheGhiNguon(actor([perm(KHOA_QUYEN_DOI_NGUON.truocThuc, [A])]), KHOA_QUYEN_DOI_NGUON.khoa, { id: "l1", centerId: A })).toBeNull();
  });

  it("[THE-03] kiemTheGhiNguon: thẻ tự dựng / ép kiểu / đóng băng / thiếu / của lead khác ⇒ ném; thẻ đã cấp ⇒ qua", () => {
    const the = capTheGhiNguon(actor([], { isSuperAdmin: true }), KHOA, { id: "l1", centerId: A });
    expect(the).not.toBeNull();
    expect(() => kiemTheGhiNguon(the!, { leadId: "l1" })).not.toThrow();
    expect(() => kiemTheGhiNguon(the!, { leadId: "l2" }), "thẻ của lead khác").toThrow(/lead khác/);
    const tuDung = { leadId: "l1", centerId: A, khoa: KHOA, userId: "u1" };
    expect(() => kiemTheGhiNguon(tuDung as unknown as TheGhiNguon, { leadId: "l1" }), "tự dựng + ép kiểu").toThrow(/thẻ ghi/);
    expect(() => kiemTheGhiNguon(Object.freeze({ ...tuDung }) as unknown as TheGhiNguon, { leadId: "l1" }), "đóng băng tự dựng").toThrow(/thẻ ghi/);
    expect(() => kiemTheGhiNguon({ ...the! } as unknown as TheGhiNguon, { leadId: "l1" }), "bản SAO của thẻ thật").toThrow(/thẻ ghi/);
    expect(() => kiemTheGhiNguon(undefined as unknown as TheGhiNguon, { leadId: "l1" }), "thiếu").toThrow(/thẻ ghi/);
  });

  it("[THE-04] bảng khoá = ba khoá đổi nguồn + khoá duyệt referral", () => {
    expect([...KHOA_CAP_THE_GHI_NGUON].sort()).toEqual([KHOA_QUYEN_DOI_NGUON.truocThuc, KHOA_QUYEN_DOI_NGUON.sauThuc, KHOA_QUYEN_DOI_NGUON.khoa, "affiliate_referrals:manage"].sort());
  });

  it("[THE-05] coQuyenToanHeThong: chỉ SUPER_ADMIN / grant ALLOW / dòng quyền của CHÍNH khoá có scope ALL; `isHoLevel` và khoá khác ở ALL không đủ", () => {
    expect(coQuyenToanHeThong(actor([perm(KHOA, "ALL")]), KHOA)).toBe(true);
    expect(coQuyenToanHeThong(actor([perm(KHOA, [A, B])]), KHOA), "nhiều cơ sở ≠ toàn hệ thống").toBe(false);
    expect(coQuyenToanHeThong(actor([perm("sources:manage", "ALL")]), KHOA), "khoá khác ở ALL").toBe(false);
    expect(coQuyenToanHeThong(actor([], { isHoLevel: true }), KHOA), "isHoLevel trần").toBe(false);
    expect(coQuyenToanHeThong(actor([], { isSuperAdmin: true }), KHOA)).toBe(true);
    expect(coQuyenToanHeThong(actor([], { grantsAllow: new Set([KHOA]) }), KHOA)).toBe(true);
    expect(coQuyenToanHeThong(actor([]), KHOA)).toBe(false);
  });
});

// ── lưới ghim mã nguồn ─────────────────────────────────────────────────────────────────────────────
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;
/** Vị trí khớp đầu tiên; -1 nếu không có. */
const vt = (s: string, mau: RegExp): number => s.search(mau);
/** Thân hàm: từ `dau` tới `cuoi` (loại trừ). */
function khoi(s: string, dau: string, cuoi: string): string {
  const a = s.indexOf(dau);
  const z = s.indexOf(cuoi, a + dau.length);
  expect(a, dau).toBeGreaterThanOrEqual(0);
  expect(z, cuoi).toBeGreaterThan(a);
  return s.slice(a, z);
}

describe("[THE-W] thẻ ghi nguồn — dây nối trong mã nguồn", () => {
  const lead = doc("lib/nguon/doi-nguon-lead.ts");
  const aff = doc("lib/nguon/ghi-nguon-affiliate-duyet.ts");
  const xl = doc("lib/affiliate/ghi-referral-xu-ly.ts");
  const ghi = doc("lib/nguon/ghi-nguon.ts");

  it("[THE-W1] `doiNguon(tx,` đúng HAI nơi gọi, mỗi nơi MỘT lần, đều truyền `the:`", () => {
    expect(dem(lead, /\bdoiNguon\(tx,/g)).toBe(1);
    expect(dem(aff, /\bdoiNguon\(tx,/g)).toBe(1);
    expect(lead.slice(vt(lead, /\bdoiNguon\(tx,/))).toMatch(/^doiNguon\(tx, \{\s*leadId: p\.leadId,\s*the: theGhi,/);
    expect(aff).toMatch(/doiNguon\(tx, \{ leadId: p\.leadId, the: p\.the,/);
    // tệp thứ ba bất kỳ trong lib/ + app/ không được gọi `doiNguon(tx,` — bảng đầy đủ ở lưới roster (private) `[GNW-01]`; ở đây chỉ canh hai tệp đã biết + chính định nghĩa
    expect(dem(ghi, /\bdoiNguon\(tx,/g)).toBe(0);
  });

  it("[THE-W2] `capTheGhiNguon(` đúng HAI nơi gọi, và đối tượng truyền vào là LEAD (không `cu`/`thay`/`req`)", () => {
    expect(dem(lead, /\bcapTheGhiNguon\(/g)).toBe(1);
    // Khoá thẻ chọn theo «đã có đầu vào tài chính» (thực thu HOẶC sổ hoa hồng — `dau-vao-tai-chinh.ts`), cùng định nghĩa với cổng quyền; không đếm riêng thực thu (khoản tạm rời thực thu vẫn để lại tiền trong sổ).
    expect(dem(lead, /capTheGhiNguon\(p\.actor, \w+ \? KHOA_QUYEN_DOI_NGUON\.sauThuc : KHOA_QUYEN_DOI_NGUON\.truocThuc, lead\)/g)).toBe(1);
    const bien = lead.match(/capTheGhiNguon\(p\.actor, (\w+) \? KHOA_QUYEN_DOI_NGUON\.sauThuc/)?.[1];
    expect(bien).toBeTruthy();
    expect(dem(lead, new RegExp(`const ${bien} = coDauVaoTaiChinh\\(`, "g"))).toBe(1);
    expect(dem(xl, /\bcapTheGhiNguon\(/g)).toBe(1);
    expect(dem(xl, /capTheGhiNguon\(p\.actor, KHOA_QUYEN_XU_LY_REFERRAL, lead\)/g)).toBe(1);
  });

  it("[THE-W3] `doiNguon` đòi `the` (không tuỳ chọn) và kiểm thẻ trước `ghiDoiNguon(`; `ghiNguonKhiDuyetReferral` kiểm thẻ trước mọi `tx.`", () => {
    const d = khoi(ghi, "export async function doiNguon(", "async function doiNguonKhiGop(");
    expect(d).toMatch(/\bthe: TheGhiNguon;/);
    expect(d).not.toMatch(/\bthe\?:/);
    expect(dem(d, /kiemTheGhiNguon\(input\.the, \{ leadId \}\);/g)).toBe(1);
    expect(vt(d, /kiemTheGhiNguon\(/)).toBeLessThan(vt(d, /\bghiDoiNguon\(/));
    // đường GỘP (không export) là ngoại lệ có chủ đích: nó không đi qua thẻ — gọi từ `gopNguonLead` (script vận hành), không từ người dùng
    expect(khoi(ghi, "async function doiNguonKhiGop(", "async function ghiDoiNguon(")).not.toMatch(/kiemTheGhiNguon/);

    const f = khoi(aff, "export async function ghiNguonKhiDuyetReferral(", "\n}\n");
    expect(f).toMatch(/\bthe: TheGhiNguon;/);
    expect(dem(f, /kiemTheGhiNguon\(p\.the, \{ leadId: p\.leadId \}\);/g)).toBe(1);
    expect(vt(f, /kiemTheGhiNguon\(/)).toBeLessThan(vt(f, /\btx\./));
  });

  it("[THE-W4] thứ tự cấp thẻ: đổi nguồn lead ⇒ SAU `quyetDinhDoiNguon` và TRƯỚC `doiNguon(`; duyệt referral ⇒ TRƯỚC `ghiNguonKhiDuyetReferral(`", () => {
    expect(vt(lead, /\bcapTheGhiNguon\(/)).toBeGreaterThan(vt(lead, /\bquyetDinhDoiNguon\(\{/));
    expect(vt(lead, /\bcapTheGhiNguon\(/)).toBeLessThan(vt(lead, /\bdoiNguon\(tx,/));
    expect(vt(xl, /\bcapTheGhiNguon\(/)).toBeLessThan(vt(xl, /\bghiNguonKhiDuyetReferral\(tx,/));
    expect(xl.slice(vt(xl, /\bghiNguonKhiDuyetReferral\(tx,/))).toMatch(/^ghiNguonKhiDuyetReferral\(tx, \{\s*leadId: cu\.leadId,\s*the: theGhi,/);
    // thẻ không được cấp SAU phép ghi đầu tiên của giao dịch (`tx.affiliateReferral.updateMany`)
    expect(vt(xl, /\bcapTheGhiNguon\(/)).toBeLessThan(vt(xl, /tx\.affiliateReferral\.updateMany\(/));
  });

  it("[THE-W5] Sheet «Gán nguồn»: tiền chỉ ra khi `quyen.ok || duocXemTien`; `duocXemTien` đòi `coQuyenTaiCoSo(…payments:view…, l.centerId)`", () => {
    const g = doc("lib/nguon/doc-gan-nguon.ts");
    expect(dem(g, /const duocXemTien = xemTien && coQuyenTaiCoSo\(p\.actor, "payments:view", l\.centerId\);/g)).toBe(1);
    expect(dem(g, /thucThu: quyen\.ok \|\| duocXemTien \? thucThu : null,/g)).toBe(1);
    expect(g).not.toMatch(/quyen\.ok \|\| xemTien\b/);
    expect(dem(g, /\bthucThu: /g)).toBe(2); // định nghĩa kiểu + MỘT chỗ gán vào payload — chỗ thứ ba là đường rò mới
  });

  it("[THE-W6] chụp lại chủ nguồn: `duPhamViChupLai` đòi CẢ HAI khoá ở tầm toàn hệ thống (`coQuyenToanHeThong`), không chỉ `isHoLevel`", () => {
    const luat = doc("lib/nguon/chup-lai-chu-nguon-luat.ts");
    expect(dem(luat, /KHOA_CHUP_LAI\.every\(\(k\) => coQuyenToanHeThong\(actor, k\)\)/g)).toBe(1);
    expect(luat).toMatch(/export const KHOA_CHUP_LAI = \["sources:manage", "commission_policies:activate"\] as const;/);
  });
});

describe("[THE-M1] khoá ghi danh mục dùng chung chỉ vai Hội sở giữ", () => {
  const VAI_HO = new Set(["SUPER_ADMIN", "GIAM_DOC", "HO_MARKETING", "HO_HR"]);
  for (const khoa of ["sources:manage", "commission_policies:manage", "commission_policies:activate"]) {
    it(`${khoa}: mọi vai giữ khoá ∈ vai Hội sở`, () => {
      const giu = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === khoa)).map((r) => r.code);
      expect(giu.length, `${khoa}: phải có ít nhất một vai giữ (không thì lưới này xanh vì lý do sai)`).toBeGreaterThan(0);
      expect(giu.filter((c) => !VAI_HO.has(c)), `vai CƠ SỞ giữ khoá ghi danh mục dùng chung ${khoa} — người neo ở một cơ sở sẽ sửa được danh mục của MỌI cơ sở (khoá không có cơ sở để hỏi)`).toEqual([]);
    });
  }
});
