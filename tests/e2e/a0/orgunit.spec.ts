/**
 * A0-01 — OrgUnit DB layer (schema + service + seed). Chạy trên Postgres LOCAL.
 * Case tag [A0-01-T..] để đối chiếu RTM ticket A0-01.
 *
 * ⚠️ CẬP NHẬT 11/08/2026 (Nền Hệ thống P1 · US-05) — HÌNH CÂY ĐÃ ĐỔI theo quyết định của
 * chủ dự án, lấy BA 08/08 §1.1 làm chuẩn (README bàn giao §1: "xung đột ở đâu → BA thắng"):
 *
 *     TRƯỚC:  SATAROBO (ROOT) → HO, CS1, CS2  ngang hàng   (Doc 15 OI-1)
 *     SAU:    HO (gốc) → DANANG (REGION) → CS1, CS2
 *
 * Ba khẳng định dưới đây ĐỔI CHIỀU, và đó chính là NỘI DUNG của quyết định — không phải
 * test bị hỏng: getSubtreeCenterIds(HO) nay trả đủ danh sách cơ sở thay vì []; tổ tiên của
 * CS1 nay có thêm DANANG; và cây mặc định không còn node ROOT nào.
 * Đây KHÔNG phải nới quyền: buildActor() vốn đã cấp cross-center cho mọi role đặt tại
 * HO/ROOT qua nhánh isHoLevel riêng — nay hai đường cho cùng một kết quả.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg } from "../_helpers/seed";
import { OrgRuleError } from "../../../lib/org/types";
import {
  createOrgUnit,
  getOrgUnit,
  getSubtreeCenterIds,
  getAncestors,
  isAncestor,
  listOrgUnits,
  softDeleteOrgUnit,
  updateOrgUnit,
} from "../../../lib/org/org-service";

async function expectOrgError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof OrgRuleError) {
      expect(e.code).toBe(code);
      return;
    }
    throw e;
  }
  throw new Error(`Mong đợi OrgRuleError(${code}) nhưng không có lỗi nào`);
}

async function byCode(code: string) {
  return db.orgUnit.findUnique({ where: { code } });
}

/** Tạo 2 Center cũ (CS1/CS2) để OrgUnit CENTER link centerId (cho AC5). */
async function seedCenters() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-test", address: "211 NHT", city: "" } });
  await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-test", address: "114 HD", city: "" } });
}

test.describe("[A0-01] OrgUnit DB layer", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[A0-01-T1-02] seed → 4 OrgUnit: HO gốc → DANANG → CS1/CS2 (AC2, hình mới)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    expect(await db.orgUnit.count()).toBe(4); // HO + DANANG + CS1 + CS2
    const ho = await byCode("HO");
    const dn = await byCode("DANANG");
    const cs1 = await byCode("CS1");
    const cs2 = await byCode("CS2");
    expect(ho?.parentId).toBeNull(); // HO là gốc thật
    expect(await byCode("SATAROBO")).toBeNull(); // không còn ROOT kỹ thuật
    expect(dn?.parentId).toBe(ho?.id);
    expect(cs1?.parentId).toBe(dn?.id);
    expect(cs2?.parentId).toBe(dn?.id);
  });

  test("[A0-01-T1-02b][US-05] seed điền path + depth đúng công thức", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    expect((await byCode("HO"))?.path).toBe("/ho/");
    expect((await byCode("HO"))?.depth).toBe(0);
    expect((await byCode("DANANG"))?.path).toBe("/ho/danang/");
    expect((await byCode("CS1"))?.path).toBe("/ho/danang/cs1/");
    expect((await byCode("CS1"))?.depth).toBe(2);
  });

  test("[A0-01-T3-03] HO & CS2 cùng address vẫn tạo được (AC3)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const cs2 = await byCode("CS2");
    expect(ho?.address).toBe("114 Hoàng Diệu, Đà Nẵng");
    expect(cs2?.address).toBe("114 Hoàng Diệu, Đà Nẵng");
    expect(ho?.id).not.toBe(cs2?.id);
  });

  test("[A0-01-T1-03/04][A0-01-T5-01] getSubtreeCenterIds: HO=[CS1,CS2], DANANG=[CS1,CS2], CS1=[CS1] (AC5)", async () => {
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const dn = await byCode("DANANG");
    const cs1 = await byCode("CS1");
    const cs1Center = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
    const cs2Center = await db.center.findFirst({ where: { code: "CS2" }, select: { id: true } });

    // ĐỔI CHIỀU so với trước P1: HO là tổ tiên của mọi cơ sở nên nhánh của nó chứa cả hai.
    expect((await getSubtreeCenterIds(ho!.id)).sort()).toEqual(
      [cs1Center!.id, cs2Center!.id].sort(),
    );
    expect((await getSubtreeCenterIds(dn!.id)).sort()).toEqual(
      [cs1Center!.id, cs2Center!.id].sort(),
    );
    expect(await getSubtreeCenterIds(cs1!.id)).toEqual([cs1Center!.id]);
  });

  test("[A0-01-T1-05/06] getAncestors + isAncestor", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const cs1 = await byCode("CS1");
    const cs2 = await byCode("CS2");
    const anc = await getAncestors(cs1!.id);
    expect(anc.map((n) => n.code)).toEqual(["CS1", "DANANG", "HO"]);
    expect(await isAncestor(ho!.id, cs2!.id)).toBe(true);
    expect(await isAncestor(cs1!.id, cs2!.id)).toBe(false);
  });

  test("[A0-01-T5-02] thêm CS3 → subtree(HO) tự gồm CS3, không sửa code (AC6)", async () => {
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const dn = await byCode("DANANG");
    const cs3Center = await db.center.create({ data: { code: "CS3", name: "CS3", slug: "cs3-test", address: "X", city: "" } });
    const cs3 = await createOrgUnit({ type: "CENTER", code: "CS3", name: "Cơ sở 3", parentId: dn!.id, centerId: cs3Center.id });
    expect(await getSubtreeCenterIds(ho!.id)).toContain(cs3Center.id);
    // US-05 — node mới nhận path NGAY lúc tạo, không chờ backfill.
    expect(cs3.path).toBe("/ho/danang/cs3/");
    expect(cs3.depth).toBe(2);
  });

  test("[A0-01-T2-01] code trùng → CONFLICT (AC4/V1)", async () => {
    await seedOrg(["HO", "CS1"]);
    const dn = await byCode("DANANG");
    await expectOrgError(
      createOrgUnit({ type: "CENTER", code: "CS1", name: "Trùng", parentId: dn!.id }),
      "ORG_CODE_CONFLICT",
    );
  });

  test("[A0-01-T2-02/04/05/07/08] validations (V2/V3/V4/V7/V9)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const dn = await byCode("DANANG");
    const cs1 = await byCode("CS1");
    // V2 code rỗng
    await expectOrgError(createOrgUnit({ type: "CENTER", code: "", name: "X", parentId: dn!.id }), "ORG_CODE_REQUIRED");
    // V4 non-ROOT/non-HO thiếu parent
    await expectOrgError(createOrgUnit({ type: "CENTER", code: "NOPAR", name: "X" }), "ORG_PARENT_REQUIRED");
    // V4 parent không tồn tại
    await expectOrgError(createOrgUnit({ type: "CENTER", code: "GHOST", name: "X", parentId: "nope" }), "ORG_PARENT_NOT_FOUND");
    // V3 ROOT thứ 2 — cây mặc định KHÔNG còn ROOT nên phải tự dựng cái thứ nhất trước.
    await createOrgUnit({ type: "ROOT", code: "ROOT1", name: "Gốc kỹ thuật" });
    await expectOrgError(createOrgUnit({ type: "ROOT", code: "ROOT2", name: "X" }), "ORG_MULTIPLE_ROOT");
    // V7 centerId cho REGION (HO nay ĐƯỢC phép mang centerId — xem validateCenterId).
    await expectOrgError(
      createOrgUnit({ type: "REGION", code: "VUNGX", name: "X", parentId: ho!.id, centerId: "c1" }),
      "ORG_CENTERID_NOT_CENTER",
    );
    // V9 (US-05 AC3) — CENTER KHÔNG được làm cha của REGION.
    await expectOrgError(
      createOrgUnit({ type: "REGION", code: "VUNGY", name: "Y", parentId: cs1!.id }),
      "ORG_PARENT_TYPE_INVALID",
    );
  });

  test("[A0-01-T7-01] đổi parent tạo cycle → từ chối (V5)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    const cs1 = await byCode("CS1");
    // Dùng chuỗi DEPARTMENT → DEPARTMENT: đây là cặp loại mà V9 (US-05 AC3) CHO PHÉP,
    // nên test chạm được đúng nhánh chống-vòng. Thử "HO xuống dưới DANANG" thì V9 chặn
    // trước (ca đó có test riêng ở orgunit-path.spec.ts).
    const p1 = await createOrgUnit({ type: "DEPARTMENT", code: "PB1", name: "Phòng 1", parentId: cs1!.id });
    const p2 = await createOrgUnit({ type: "DEPARTMENT", code: "PB2", name: "Phòng 2", parentId: p1.id });
    await expectOrgError(updateOrgUnit(p1.id, { parentId: p2.id }), "ORG_CYCLE");
  });

  test("[A0-01-T7-03] soft-delete CS1 → ẩn khỏi list mặc định; subtree(HO) mất CS1 (AC7)", async () => {
    await seedCenters();
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    const cs1 = await byCode("CS1");
    const cs1Center = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
    await softDeleteOrgUnit(cs1!.id);
    const codes = (await listOrgUnits()).map((o) => o.code);
    expect(codes).not.toContain("CS1");
    expect(await getOrgUnit(cs1!.id)).toBeNull();
    expect(await getSubtreeCenterIds(ho!.id)).not.toContain(cs1Center!.id);
    // US-05 — xoá mềm là CLOSED (không phải SUSPENDED): status đi CẶP với isActive.
    const raw = await db.orgUnit.findUnique({ where: { id: cs1!.id } });
    expect(raw?.status).toBe("CLOSED");
    expect(raw?.isActive).toBe(false);
  });

  test("[A0-01-T7-04] soft-delete HO khi còn con → chặn (V8)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    const ho = await byCode("HO");
    await expectOrgError(softDeleteOrgUnit(ho!.id), "ORG_HAS_CHILDREN");
  });

  test("[A0-01-T6-02] seed 2 lần idempotent → vẫn 4 (AC8)", async () => {
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedOrg(["HO", "CS1", "CS2"]);
    expect(await db.orgUnit.count()).toBe(4);
  });
});
