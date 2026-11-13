// @vitest-environment node
/**
 * [TNK-*] — TẦM NHÌN CƠ SỞ ĐO THEO CHÍNH KHOÁ, KHÔNG THEO TIỀN TỐ (rà độc lập 20/10/2026, HIGH «người kiêm hai vai thấy toàn bộ sổ hoa hồng cơ sở khác»). THUẦN, không DB.
 *
 * Gốc: `PermEntry.centerScope` gắn cho MỌI quyền của một dòng vai, và `getModelVisibleCenterIds` HỢP centerScope của mọi quyền cùng tiền tố model (`commission:` ⊃ view-self + view-center …).
 * Người kiêm QLCS@CS1 (view-center) + Sale@CS2 (CHỈ view-self) nhận tầm nhìn [CS1, CS2] ở chỗ chỉ khoá view-center được phép mở. Mọi ca cách ly cũ dựng actor MỘT vai ⇒ không thấy.
 * Mỗi ca «không thấy» dưới đây có ĐỐI CHỨNG DƯƠNG (luật 11): vai gốc vẫn thấy cơ sở mình / vai HO thấy tất.
 *
 *   [TNK-01] `tamNhinCuaKhoa`: chỉ đo CHÍNH khoá; hợp các dòng cùng khoá; ALL/grant/SUPER_ADMIN; không giữ khoá ⇒ [] (không rơi về visibleCenterIds)
 *   [TNK-02] (đã gỡ — chiều `scopedDb` của KỲ nay do `phamViKy` ở ky-doc.ts đo bằng chính khoá; ca hành vi: `[KV-05]` Postgres thật + lưới `[TNK-W3]`)
 *   [TNK-03] `phamViNguoiXem` (sổ · giải thích · vì sao · chi tiết nguồn · báo cáo affiliate dùng chung)
 *   [TNK-04] `phamViKhieuNai` — tầm nhìn người duyệt = khoá `commission_disputes:review`
 *   [TNK-05] `phamViDeXuat` — mỗi nguồn gốc đo bằng khoá duyệt của nó
 *   [TNK-06] `whereNhatKy` kênh «nhat-ky» — theo từng loại thực thể, bằng khoá mở loại đó
 *   [TNK-W1..W3] lưới ghim dây nối: các đường đọc KHÔNG quay lại gộp theo tiền tố
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Actor, PermEntry } from "@/lib/auth/actor";
import { tamNhinCuaKhoa } from "@/lib/auth/quyen-tai-co-so";

import { phamViDeXuat } from "./de-xuat-doc";
import { phamViNguoiXem } from "./doc-so";
import { phamViKhieuNai } from "./khieu-nai-doc";
import { whereNhatKy } from "./nhat-ky-doc";

const perm = (action: string, centerScope: PermEntry["centerScope"], roleCode = "FX"): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "ou", roleCode, centerScope });
const actor = (permissions: PermEntry[], o: Partial<Actor> = {}): Actor =>
  ({ userId: "u-kiem", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions, visibleCenterIds: ["CS1", "CS2"], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), ...o }) as Actor;

/** Mô hình seed: CENTER_MANAGER có view-self + view-center (+ khoá khác); CENTER_SALES_CSM CHỈ view-self; HO_MARKETING CHỈ view-self (ALL). */
const qlcsCs1 = [perm("commission:view-self", ["CS1"], "CM"), perm("commission:view-center", ["CS1"], "CM"), perm("commission_disputes:review", ["CS1"], "CM"), perm("commission_periods:manage", ["CS1"], "CM")];
const saleCs2 = [perm("commission:view-self", ["CS2"], "SALE")];
const hoMarketing = [perm("commission:view-self", "ALL", "HO_MKT")];
const keToanHo = [perm("commission:view-self", "ALL", "HO_KT"), perm("commission:view-center", "ALL", "HO_KT"), perm("commission_periods:manage", "ALL", "HO_KT"), perm("commission_disputes:review", "ALL", "HO_KT")];

describe("[TNK-01] tamNhinCuaKhoa — đo CHÍNH khoá", () => {
  it("[TNK-01a] kiêm QLCS@CS1 + Sale@CS2: view-center chỉ [CS1]; view-self ở CS2 KHÔNG mở view-center (đối chứng: chính khoá view-self thì [CS1, CS2])", () => {
    const a = actor([...qlcsCs1, ...saleCs2]);
    expect(tamNhinCuaKhoa(a, "commission:view-center")).toEqual(["CS1"]);
    expect([...tamNhinCuaKhoa(a, "commission:view-self")].sort()).toEqual(["CS1", "CS2"]);
  });

  it("[TNK-01b] kiêm QLCS@CS1 + HO_MARKETING@HO (view-self ALL): view-center vẫn [CS1], KHÔNG ALL; Kế toán HO ⇒ ALL", () => {
    expect(tamNhinCuaKhoa(actor([...qlcsCs1, ...hoMarketing]), "commission:view-center")).toEqual(["CS1"]);
    expect(tamNhinCuaKhoa(actor(keToanHo), "commission:view-center")).toBe("ALL");
  });

  it("[TNK-01c] hợp các dòng CÙNG khoá (QLCS@CS1 + QLCS@CS2) · nhiều khoá hợp lại · grant ALLOW / SUPER_ADMIN ⇒ ALL", () => {
    const hai = actor([perm("commission:view-center", ["CS1"]), perm("commission:view-center", ["CS2"])]);
    expect([...tamNhinCuaKhoa(hai, "commission:view-center")].sort()).toEqual(["CS1", "CS2"]);
    const nhieuKhoa = actor([perm("commission_periods:manage", ["CS1"]), perm("commission:view-center", ["CS2"])]);
    expect([...tamNhinCuaKhoa(nhieuKhoa, "commission:view-center", "commission_periods:manage")].sort()).toEqual(["CS1", "CS2"]);
    expect(tamNhinCuaKhoa(actor([], { grantsAllow: new Set(["commission:view-center"]) }), "commission:view-center")).toBe("ALL");
    expect(tamNhinCuaKhoa(actor([], { isSuperAdmin: true }), "commission:view-center")).toBe("ALL");
  });

  it("[TNK-01d] không giữ khoá ⇒ [] (KHÔNG rơi về visibleCenterIds / isHoLevel); centerScope null (vai quan hệ) ⇒ []", () => {
    expect(tamNhinCuaKhoa(actor(saleCs2, { isHoLevel: true }), "commission:view-center")).toEqual([]);
    expect(tamNhinCuaKhoa(actor([perm("commission:view-center", null)]), "commission:view-center")).toEqual([]);
    expect(tamNhinCuaKhoa(actor([], { grantsAllow: new Set(["khoa-khac"]) }), "commission:view-center")).toEqual([]);
  });
});

describe("[TNK-03] phamViNguoiXem", () => {
  const where = (a: Actor) => phamViNguoiXem(a);

  it("[TNK-03a] kiêm QLCS@CS1 + Sale@CS2 ⇒ tầm nhìn [CS1] và điều kiện = (của mình ∨ cơ sở CS1); KHÔNG có CS2", () => {
    const r = where(actor([...qlcsCs1, ...saleCs2]));
    expect(r.xemCoSo).toBe(true);
    expect(r.tamCoSo).toEqual(["CS1"]);
    expect(JSON.stringify(r.dieuKien)).toContain('"centerId":{"in":["CS1"]}');
    expect(JSON.stringify(r.dieuKien)).not.toContain("CS2");
  });

  it("[TNK-03b] kiêm QLCS@CS1 + HO_MARKETING@HO ⇒ KHÔNG ALL (dieuKien không rỗng)", () => {
    const r = where(actor([...qlcsCs1, ...hoMarketing]));
    expect(r.tamCoSo).toEqual(["CS1"]);
    expect(r.dieuKien).toHaveLength(1);
  });

  it("[TNK-03c] đối chứng dương: Kế toán HO ⇒ ALL, không điều kiện; Sale thuần ⇒ chỉ dòng của mình (xemCoSo false)", () => {
    const ho = where(actor(keToanHo, { isHoLevel: true }));
    expect(ho.tamCoSo).toBe("ALL");
    expect(ho.dieuKien).toEqual([]);
    const sale = where(actor(saleCs2));
    expect(sale.xemCoSo).toBe(false);
    expect(JSON.stringify(sale.dieuKien)).toContain('"beneficiaryUserId":"u-kiem"');
  });
});

describe("[TNK-04] phamViKhieuNai — tầm nhìn người duyệt", () => {
  it("HR@CS1 (review) kiêm Sale@CS2 (view-self) ⇒ khiếu nại của người khác chỉ ở CS1; đối chứng: HR@HO ⇒ ALL", () => {
    const hrCs1 = [perm("commission:view-self", ["CS1"], "HR"), perm("commission_disputes:review", ["CS1"], "HR")];
    const r = phamViKhieuNai(actor([...hrCs1, ...saleCs2]));
    expect(r.tamCoSo).toEqual(["CS1"]);
    expect(JSON.stringify(r.where)).not.toContain("CS2");
    expect(phamViKhieuNai(actor([perm("commission:view-self", "ALL"), perm("commission_disputes:review", "ALL")], { isHoLevel: true })).tamCoSo).toBe("ALL");
  });
});

describe("[TNK-05] phamViDeXuat — mỗi nguồn gốc đo bằng khoá duyệt của nó", () => {
  it("[TNK-05a] giữ review@CS1 kiêm periods:manage@CS2 ⇒ đề xuất KHIẾU NẠI chỉ CS1, đề xuất ĐỔI NGUỒN chỉ CS2 (không lẫn); đối chứng: mỗi nhánh có mặt", () => {
    const a = actor([perm("commission_disputes:review", ["CS1"], "HR"), perm("commission_periods:manage", ["CS2"], "KT")]);
    const pv = JSON.stringify(phamViDeXuat(a));
    expect(pv).toContain('{"AND":[{"origin":"DISPUTE"},{"centerId":{"in":["CS1"]}}]}');
    expect(pv).toContain('{"AND":[{"origin":"SOURCE_CHANGE"},{"centerId":{"in":["CS2"]}}]}');
  });

  it("[TNK-05b] view-self ở CS2 KHÔNG mở thêm đề xuất của người khác ở CS2 cho người duyệt@CS1", () => {
    const a = actor([perm("commission_disputes:review", ["CS1"], "HR"), perm("commission:view-self", ["CS1"], "HR"), ...saleCs2]);
    const pv = JSON.stringify(phamViDeXuat(a));
    expect(pv).toContain('"in":["CS1"]');
    expect(pv).not.toContain("CS2");
  });
});

describe("[TNK-06] whereNhatKy kênh nhat-ky", () => {
  /** Client giả: `orgUnit.findMany({ where: { centerId: { in } } })` → mỗi cơ sở X có OrgUnit `ou-X`. */
  const client = {
    orgUnit: { findMany: async (a: { where: { centerId: { in: string[] } } }) => a.where.centerId.in.map((c) => ({ id: `ou-${c}` })) },
  } as never;

  it("[TNK-06a] quản kỳ@CS1 + duyệt khiếu nại@CS2 + view-self@CS3 ⇒ nhật ký chỉ ở CS1 và CS2 (hợp các khoá mở tab), KHÔNG có CS3; đối chứng dương: hai cơ sở kia có mặt", async () => {
    const a = actor([perm("commission_periods:manage", ["CS1"], "KT"), perm("commission_disputes:review", ["CS2"], "HR"), perm("commission:view-self", ["CS3"], "SALE")]);
    const w = JSON.stringify(await whereNhatKy(client, a, "nhat-ky"));
    expect(w).toContain("ou-CS1");
    expect(w).toContain("ou-CS2");
    expect(w).not.toContain("ou-CS3");
  });

  it("[TNK-06b] view-self@CS2 không mở nhật ký CS2; không giữ khoá nào ⇒ `orgUnitId IN ()` (không dòng nào); đối chứng dương: QLCS thấy CS1, Kế toán HO ⇒ không giới hạn orgUnit", async () => {
    const w = JSON.stringify(await whereNhatKy(client, actor([...qlcsCs1, ...saleCs2]), "nhat-ky"));
    expect(w).not.toContain("ou-CS2");
    expect(w).toContain("ou-CS1");
    expect(JSON.stringify(await whereNhatKy(client, actor(saleCs2), "nhat-ky"))).toContain('"orgUnitId":{"in":[]}');
    const ho = JSON.stringify(await whereNhatKy(client, actor(keToanHo, { isHoLevel: true }), "nhat-ky"));
    expect(ho).not.toContain("orgUnitId");
    expect(ho).toContain('"entityType":{"in":["CommissionPeriod","CommissionHold","CommissionDispute","SystemSetting"]}');
  });
});

// ── Lưới ghim dây nối: văn bản mã BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng chuỗi đang cấm — bẫy của mọi lưới ghim, xem CLAUDE.md luật 11) ──
const doc = (p: string): string =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp): number => (typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length);

describe("[TNK-W] dây nối: đường đọc tiền KHÔNG gộp tầm nhìn theo tiền tố model", () => {
  it("[TNK-W1] sổ · hàng chờ sổ · khiếu nại · đề xuất · nhật ký gọi `tamNhinCuaKhoa` và KHÔNG còn `getModelVisibleCenterIds` của model tiền", () => {
    const THEO_TEP: Record<string, { khoa: number }> = {
      "lib/hoa-hong/doc-so.ts": { khoa: 1 },
      "lib/hoa-hong/hang-cho-so-doc.ts": { khoa: 1 },
      "lib/hoa-hong/khieu-nai-doc.ts": { khoa: 1 },
      "lib/hoa-hong/de-xuat-doc.ts": { khoa: 1 },
      "lib/hoa-hong/nhat-ky-doc.ts": { khoa: 1 },
    };
    for (const [tep, { khoa }] of Object.entries(THEO_TEP)) {
      const d = doc(tep);
      expect(dem(d, /\btamNhinCuaKhoa\(/), `${tep} · tamNhinCuaKhoa`).toBe(khoa);
      expect(dem(d, /getModelVisibleCenterIds\(\s*"Commission(?:Transaction|Hold|Dispute|AdjustmentRequest|Period)"/), `${tep} · getModelVisibleCenterIds("Commission…")`).toBe(0);
    }
  });

  it("[TNK-W2] khung module (chip cơ sở) đo ba model tiền bằng khoá gác tab, không bằng tiền tố", () => {
    const d = doc("lib/nguon-hoa-hong/module-scope.ts");
    expect(dem(d, /\btamNhinCuaKhoa\(/)).toBe(3);
    expect(dem(d, /getModelVisibleCenterIds\(\s*"Commission(?:Transaction|Hold|Dispute|AdjustmentRequest|Period)"/)).toBe(0);
    expect(dem(d, /getModelVisibleCenterIds\(\s*"Lead"/)).toBe(1); // Lead không đổi
  });

  it("[TNK-W3] tab Kỳ: mọi truy vấn kỳ đi qua `phamViKy` (đo bằng view-center ∪ periods:manage) NGOÀI `scopedDb` — năm chỗ, một định nghĩa", () => {
    const d = doc("lib/hoa-hong/ky-doc.ts");
    expect(dem(d, /\btamNhinCuaKhoa\(actor, KEY_XEM_CO_SO, KEY_XU_LY_HANG_CHO\)/)).toBe(1);
    expect(dem(d, /\bphamViKy\(actor\)/)).toBe(5);
    // sáu lời đọc kỳ (count + findMany của danh sách dùng CHUNG một `where`) — năm `where` đều mang `phamViKy`
    expect(dem(d, /sdb\.commissionPeriod\.(?:findMany|findFirst|count)\(/)).toBe(6);
  });

  it("[TNK-W4] đổi nguồn + duyệt referral: danh tính ĐỐI TÁC đi vào `danhTinhNguoiNhan` (đổi nguồn) và vào phép giao TU_CLAIM (duyệt) — TRƯỚC phép ghi đầu tiên", () => {
    const doi = doc("lib/nguon/doi-nguon-lead.ts");
    expect(dem(doi, /\bdanhTinhNguoiHuongCuaDoiTac\(/)).toBe(1);
    expect(dem(doi, /referrerAffiliateIdentity: danhTinhDoiTac\b/)).toBe(1);
    const duyet = doc("lib/nguon/ghi-nguon-affiliate-duyet.ts");
    expect(dem(duyet, /\bdanhTinhNguoiHuongCuaDoiTac\(/)).toBe(1);
    expect(dem(duyet, /giaoNhauDanhTinh\(chuLead, nguoiNhan\)\) return \{ ok: false, ma: "TU_CLAIM"/)).toBe(1);
    // phép giao đứng TRƯỚC mọi phép ghi của hàm (taoNguonBanDau / doiNguon)
    expect(duyet.indexOf("giaoNhauDanhTinh(chuLead")).toBeGreaterThan(-1);
    expect(duyet.indexOf("giaoNhauDanhTinh(chuLead")).toBeLessThan(duyet.indexOf("await taoNguonBanDau("));
    expect(duyet.indexOf("giaoNhauDanhTinh(chuLead")).toBeLessThan(duyet.indexOf("await doiNguon("));
  });

  it("[TNK-W5] `leads:overwrite` hỏi TẠI cơ sở của lead ở updateLeadFields + updateLeadNote và ở nhập Excel (từng dòng lead cũ); màn cũ không còn `setLeadAffiliateAction`", () => {
    const fields = doc("app/(admin)/admin/leads/actions.ts");
    expect(dem(fields, /coQuyenTaiCoSo\(actor, 'leads:overwrite', before\.centerId\)/)).toBe(2); // updateLeadFields + updateLeadNote (L1, 20/10) — chi tiết ở `[CL-W6]`
    const imp = doc("app/api/admin/import/leads/route.ts");
    expect(dem(imp, /coQuyenTaiCoSo\(actor, "leads:overwrite", ex\.centerId\)/)).toBe(1);
    expect(dem(imp, /ghiDe: duocDeTaiDay,/)).toBe(1);
    expect(dem(doc("app/(admin)/admin/affiliates/_actions.ts"), /setLeadAffiliateAction/)).toBe(0);
  });

  it("[TNK-W6] công thức CŨ của hoa hồng CRM (`CommissionStatement`, gác `payments:manage`) đo tầm nhìn bằng CHÍNH khoá cổng — không rơi về `visibleCenterIds` gộp mọi vai", () => {
    for (const tep of ["app/(admin)/admin/crm/commission/page.tsx", "app/api/admin/crm/commission-export/route.ts"]) {
      const d = doc(tep);
      expect(dem(d, /tamNhinCuaKhoa\(actor, "payments:manage"\)/), tep).toBe(1);
      expect(dem(d, /getModelVisibleCenterIds/), tep).toBe(0);
    }
  });
});
