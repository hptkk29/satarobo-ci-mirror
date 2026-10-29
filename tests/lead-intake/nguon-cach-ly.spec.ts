import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { db } from "../../lib/db";
import { scopedDb } from "../../lib/db-scope";
import type { Actor } from "../../lib/auth/actor";
import { taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { damBaoDanhMucGoc, duLieuNguon, type IdNhom } from "./_nguon-fixture";

// =============================================================================
// CÁCH LY CƠ SỞ của LeadAttribution / LeadTouchpoint — Postgres LOCAL thật (rà soát 07/10, điểm 4)
//
// Hai bảng KHÔNG có centerId/orgUnitId (DM-8/H15 — ngoại lệ CÓ CHỦ ĐÍCH của luật Nền #3, chủ dự án chấp
// nhận 07/10/2026): cách ly cơ sở của chúng CHỈ có một nguồn là `Lead` đã qua `scopedDb`. Ca này ghim
// đúng phép đó, để PR2 (màn hình + API đọc nguồn) không phá nó mà không ai hay:
//
//   [NCL-01] actor cơ sở B đọc lead + `include attribution/touchpoints` ⇒ chỉ thấy của B
//   [NCL-02] IDOR: findUnique lead cơ sở A với include attribution ⇒ null
//   [NCL-03] bộ lọc LỒNG `where: { attribution: … }` không rò dòng của A (đếm + findFirst)
//   [NCL-04] ĐỐI CHỨNG DƯƠNG: đọc THẲNG bảng (không qua Lead) THẤY cả hai ⇒ vì sao [QN-W11] tồn tại
//
// Cách ly: tiền tố `NCL_`, dọn theo tiền tố — KHÔNG resetDb.
// =============================================================================

const RUN = RUN_DB_TESTS;
const P = "NCL_";

/** Actor cơ sở-cấp tối thiểu: không quyền riêng, không HO ⇒ model Lead rơi về `visibleCenterIds`. */
function actorCoSo(centerIds: string[]): Actor {
  return {
    userId: "ncl-actor",
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

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length) await db.lead.deleteMany({ where: { id: { in: ids } } }); // FK Cascade kéo theo quy nguồn + touchpoint
  await db.center.deleteMany({ where: { code: { startsWith: "NCL" } } });
}

describe.skipIf(!RUN)("Nguồn lead — cách ly cơ sở qua Lead đã scope", () => {
  let nhom: IdNhom;
  let cA = "";
  let cB = "";
  let leadA = "";
  let leadB = "";

  beforeEach(async () => {
    await don();
    nhom = await damBaoDanhMucGoc(db);
    cA = (await db.center.create({ data: { code: "NCL-A", name: "NCL A", slug: "ncl-a", address: "a", city: "" } })).id;
    cB = (await db.center.create({ data: { code: "NCL-B", name: "NCL B", slug: "ncl-b", address: "b", city: "" } })).id;
    leadA = (await db.lead.create({ data: { parentName: `${P}A`, phone: "0990320001", status: "MOI", centerId: cA } })).id;
    leadB = (await db.lead.create({ data: { parentName: `${P}B`, phone: "0990320002", status: "MOI", centerId: cB } })).id;
    // A: nhóm PARENT_REFERRAL + 1 touchpoint (đua thua); B: nhóm PAID_ADS.
    await db.$transaction(async (tx) => {
      await taoNguonBanDau(tx, leadA, duLieuNguon(nhom.PARENT_REFERRAL, { matchedRule: "NCL_A" }), null);
      await taoNguonBanDau(tx, leadA, duLieuNguon(nhom.WALK_IN, { matchedRule: "NCL_A_THUA" }), null); // đua thua ⇒ touchpoint
      await taoNguonBanDau(tx, leadB, duLieuNguon(nhom.PAID_ADS, { matchedRule: "NCL_B" }), null);
    });
  }, 60_000);
  afterAll(async () => {
    await don();
    await db.$disconnect();
  }, 60_000);

  it("[NCL-01] actor cơ sở B đọc lead kèm attribution/touchpoints ⇒ CHỈ thấy của B; actor cơ sở A ngược lại", async () => {
    const rowsB = await scopedDb(actorCoSo([cB])).lead.findMany({
      where: { parentName: { startsWith: P } },
      include: { attribution: true, touchpoints: true },
    });
    expect(rowsB.map((l) => l.id)).toEqual([leadB]);
    expect(rowsB[0]!.attribution?.matchedRule).toBe("NCL_B");
    expect(rowsB[0]!.touchpoints).toHaveLength(0);

    // Chiều ngược (đối chứng dương — nếu cả hai chiều cùng rỗng thì ca này chỉ đo "actor không thấy gì").
    const rowsA = await scopedDb(actorCoSo([cA])).lead.findMany({
      where: { parentName: { startsWith: P } },
      include: { attribution: true, touchpoints: true },
    });
    expect(rowsA.map((l) => l.id)).toEqual([leadA]);
    expect(rowsA[0]!.attribution?.matchedRule).toBe("NCL_A");
    expect(rowsA[0]!.touchpoints).toHaveLength(1);
  }, 60_000);

  it("[NCL-02] IDOR: actor cơ sở B findUnique lead của A kèm include attribution ⇒ null (không lộ nhóm/lý do/người giới thiệu)", async () => {
    const r = await scopedDb(actorCoSo([cB])).lead.findUnique({
      where: { id: leadA },
      include: { attribution: true, touchpoints: true },
    });
    expect(r).toBeNull();
    // Đối chứng dương: cùng câu, đúng cơ sở ⇒ có.
    const ok = await scopedDb(actorCoSo([cA])).lead.findUnique({ where: { id: leadA }, include: { attribution: true } });
    expect(ok?.attribution?.matchedRule).toBe("NCL_A");
  }, 60_000);

  it("[NCL-03] bộ lọc LỒNG theo attribution/touchpoint không rò dòng của cơ sở khác (count + findFirst)", async () => {
    const sB = scopedDb(actorCoSo([cB]));
    // Nhóm của A (PARENT_REFERRAL) — B hỏi theo đúng nhóm đó phải ra 0, không phải 1.
    expect(
      await sB.lead.count({ where: { parentName: { startsWith: P }, attribution: { is: { groupId: nhom.PARENT_REFERRAL } } } }),
    ).toBe(0);
    expect(
      await sB.lead.findFirst({ where: { parentName: { startsWith: P }, touchpoints: { some: { kind: "TAO_LEAD" } } } }),
    ).toBeNull();
    // Đối chứng dương: B hỏi nhóm của CHÍNH B ⇒ 1.
    expect(
      await sB.lead.count({ where: { parentName: { startsWith: P }, attribution: { is: { groupId: nhom.PAID_ADS } } } }),
    ).toBe(1);
  }, 60_000);

  it("[NCL-04] ĐỐI CHỨNG: đọc THẲNG bảng nguồn không qua Lead thấy CẢ HAI cơ sở — cách ly chỉ nằm ở Lead, nên [QN-W11] cấm đọc thẳng", async () => {
    const thang = await db.leadAttribution.findMany({ where: { leadId: { in: [leadA, leadB] } }, select: { leadId: true } });
    expect(thang.map((r) => r.leadId).sort()).toEqual([leadA, leadB].sort());
    const tp = await db.leadTouchpoint.findMany({ where: { leadId: { in: [leadA, leadB] } }, select: { leadId: true } });
    expect(tp.map((r) => r.leadId)).toEqual([leadA]);
  }, 60_000);
});
