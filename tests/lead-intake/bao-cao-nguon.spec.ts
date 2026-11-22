// @vitest-environment node
/**
 * [BCN-*] `docLeadTheoNguon` — số lead theo «Nguồn khách hàng» (LeadAttribution.group) cho dashboard, trên Postgres THẬT (audit X · GAP 5A).
 *
 *   [BCN-01] đúng số theo nhóm; lead chưa quy nguồn vào «Chưa quy nguồn» (không biến mất khỏi tổng)
 *   [BCN-02] CÁCH LY CƠ SỞ: actor cơ sở B không thấy lead cơ sở A (đối chứng dương: HO thấy cả hai)
 *   [BCN-03] `Lead.source` (kênh kỹ thuật `sale-form-app`…) KHÔNG xuất hiện — đúng lỗi sụp biểu đồ khi bật cờ
 *   [BCN-04] lead đã xoá mềm không tính; bộ lọc thêm (`where`) áp; `toiDa` cắt nhóm nhưng GIỮ «Chưa quy nguồn»
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `BCN_`. Mỗi ca tự dựng hiện trường (luật 18). Ngày TUYỆT ĐỐI (luật 19).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import type { Actor } from "../../lib/auth/actor";
import { NHAN_CHUA_QUY_NGUON, docLeadTheoNguon } from "../../lib/nguon/doc-bao-cao-nguon";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { damBaoDanhMucGoc, duLieuNguon, type IdNhom } from "./_nguon-fixture";

const P = "BCN_";

function actorCoSo(centerIds: string[]): Actor {
  return {
    userId: "bcn-actor",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  } as Actor;
}
const actorTatCa = (): Actor => ({ ...actorCoSo([]), isSuperAdmin: true, isHoLevel: true }) as Actor;

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo quy nguồn + touchpoint
  await db.center.deleteMany({ where: { code: { startsWith: "BCN" } } });
}

describe.skipIf(!RUN_DB_TESTS)("[BCN] báo cáo lead theo Nguồn khách hàng", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";
  let seq = 0;

  const lead = async (ten: string, centerId: string, p: { groupId?: string; source?: string; deletedAt?: Date; createdAt?: Date } = {}) => {
    seq += 1;
    const l = await db.lead.create({
      data: { parentName: `${P}${ten}`, phone: `09903300${String(seq).padStart(2, "0")}`, status: "MOI", centerId, source: p.source ?? "sale-form-app", deletedAt: p.deletedAt ?? null, ...(p.createdAt ? { createdAt: p.createdAt } : {}) },
    });
    if (p.groupId) await db.$transaction((tx) => taoNguonBanDau(tx, l.id, duLieuNguon(p.groupId!, { matchedRule: `${P}${ten}` }), null));
    return l.id;
  };
  const dem = (rows: { ten: string; soLead: number }[]) => Object.fromEntries(rows.map((r) => [r.ten, r.soLead]));

  beforeEach(async () => {
    await don();
    seq = 0;
    nhom = await damBaoDanhMucGoc(db);
    cA = (await db.center.create({ data: { code: "BCN-A", name: "BCN A", slug: "bcn-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "BCN-B", name: "BCN B", slug: "bcn-b", address: "b", city: "" } })).id;
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  const tenNhom = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id }, select: { name: true } })).name;

  it("[BCN-01] đếm đúng theo nhóm; lead CHƯA quy nguồn ⇒ «Chưa quy nguồn» (không biến mất khỏi tổng)", async () => {
    await lead("a1", cA, { groupId: nhom.PARENT_REFERRAL });
    await lead("a2", cA, { groupId: nhom.PARENT_REFERRAL });
    await lead("a3", cA, { groupId: nhom.PAID_ADS });
    await lead("a4", cA); // không quy nguồn
    const r = await docLeadTheoNguon(scopedDb(actorTatCa()), { where: { parentName: { startsWith: P } } });
    expect(dem(r)).toEqual({ [await tenNhom(nhom.PARENT_REFERRAL)]: 2, [await tenNhom(nhom.PAID_ADS)]: 1, [NHAN_CHUA_QUY_NGUON]: 1 });
    expect(r.reduce((s, x) => s + x.soLead, 0)).toBe(4);
    expect(r[0]!.soLead).toBe(2); // giảm dần
    expect(r.at(-1)!.ten).toBe(NHAN_CHUA_QUY_NGUON); // luôn cuối
  }, 60_000);

  it("[BCN-02] CÁCH LY CƠ SỞ: actor cơ sở B chỉ thấy lead của B (và «Chưa quy nguồn» của B); HO thấy cả hai (đối chứng dương)", async () => {
    await lead("a1", cA, { groupId: nhom.PARENT_REFERRAL });
    await lead("a2", cA); // chưa quy nguồn — thuộc A
    await lead("b1", cB, { groupId: nhom.PAID_ADS });
    const where = { parentName: { startsWith: P } };
    const b = await docLeadTheoNguon(scopedDb(actorCoSo([cB])), { where });
    expect(dem(b)).toEqual({ [await tenNhom(nhom.PAID_ADS)]: 1 });
    const a = await docLeadTheoNguon(scopedDb(actorCoSo([cA])), { where });
    expect(dem(a)).toEqual({ [await tenNhom(nhom.PARENT_REFERRAL)]: 1, [NHAN_CHUA_QUY_NGUON]: 1 });
    const ho = await docLeadTheoNguon(scopedDb(actorTatCa()), { where });
    expect(ho.reduce((s, x) => s + x.soLead, 0)).toBe(3);
  }, 60_000);

  it("[BCN-03] kênh kỹ thuật `Lead.source` KHÔNG xuất hiện ở nhãn: lead nhập qua `sale-form-app` thuộc nhóm nghiệp vụ", async () => {
    await lead("a1", cA, { groupId: nhom.PARENT_REFERRAL, source: "sale-form-app" });
    await lead("a2", cA, { groupId: nhom.PARENT_REFERRAL, source: "Import Excel" });
    const r = await docLeadTheoNguon(scopedDb(actorTatCa()), { where: { parentName: { startsWith: P } } });
    expect(r.map((x) => x.ten)).toEqual([await tenNhom(nhom.PARENT_REFERRAL)]);
    expect(JSON.stringify(r)).not.toMatch(/sale-form-app|Import Excel/);
  }, 60_000);

  it("[BCN-04] lead xoá mềm không tính; `where` thêm áp (khoảng thời gian); `toiDa` cắt nhóm nhưng GIỮ «Chưa quy nguồn»", async () => {
    await lead("x1", cA, { groupId: nhom.PARENT_REFERRAL, deletedAt: new Date("2026-10-01T00:00:00.000Z") });
    await lead("m1", cA, { groupId: nhom.PAID_ADS, createdAt: new Date("2026-09-10T00:00:00.000Z") });
    await lead("m2", cA, { groupId: nhom.PAID_ADS, createdAt: new Date("2026-10-10T00:00:00.000Z") });
    await lead("m3", cA, { groupId: nhom.WALK_IN, createdAt: new Date("2026-10-11T00:00:00.000Z") });
    await lead("m4", cA, { createdAt: new Date("2026-10-12T00:00:00.000Z") });
    const sdb = scopedDb(actorTatCa());
    const goc = { parentName: { startsWith: P } };
    const tatCa = await docLeadTheoNguon(sdb, { where: goc });
    expect(tatCa.reduce((s, x) => s + x.soLead, 0)).toBe(4); // m1..m4, KHÔNG có x1 (đã xoá)

    const tuThang10 = await docLeadTheoNguon(sdb, { where: { ...goc, createdAt: { gte: new Date("2026-10-01T00:00:00.000Z") } } });
    expect(dem(tuThang10)).toEqual({ [await tenNhom(nhom.PAID_ADS)]: 1, [await tenNhom(nhom.WALK_IN)]: 1, [NHAN_CHUA_QUY_NGUON]: 1 });

    const cat = await docLeadTheoNguon(sdb, { where: goc, toiDa: 1 });
    expect(cat).toHaveLength(2); // 1 nhóm đứng đầu + «Chưa quy nguồn» (không chịu toiDa)
    expect(cat[0]!.ten).toBe(await tenNhom(nhom.PAID_ADS));
    expect(cat[1]!.ten).toBe(NHAN_CHUA_QUY_NGUON);
  }, 60_000);
});
