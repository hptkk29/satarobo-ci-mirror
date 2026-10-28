// @vitest-environment node
/**
 * TRẦN TỔNG % GIẢM CỦA DÒNG THEO PHẠM VI HỌC, CÀI RIÊNG THEO CƠ SỞ — Postgres thật [20/10/2026].
 *
 * Chủ dự án (trong chat 20/10/2026): *"trần mức giảm thì để max 25% mà cho qlcs tự chỉnh cho từng cơ sở được"*.
 *
 * Thứ bộ này canh mà test thuần KHÔNG canh được:
 *   · **Mặc định 25** khi chưa cài gì (cả hai tầng DB trống).
 *   · **Quản lý cơ sở chỉnh ĐÚNG cơ sở mình** và cơ sở khác không nhúc nhích — đọc bằng `getSetting(khoá, { orgUnitId })`.
 *   · **BẪY `orgUnitId`**: `getSetting(khoá)` bỏ trống chỉ đọc mức toàn cục ⇒ QLCS chỉnh mà đường ghi vẫn xét số chung. `[TGP-DB-04]` đo
 *     đúng khoảng cách đó (CS1 = 20 nhưng bản không-orgUnitId vẫn ra 25) để lý do truyền `orgUnitId` có số đo, không chỉ có lời dặn.
 *   · **QLCS KHÔNG sửa được cơ sở khác** — và dòng KHÔNG được ghi (cổng đứng trước phép ghi).
 *   · **Biên của tham số** lấy khuôn `orders.maxDiscountPercent` (số nguyên 1–100): 0, 101, 25,5 bị từ chối; 40 và 100 qua — tức QLCS NÂNG
 *     được quá 25%. Đó là câu hỏi mở với chủ dự án; ca `[TGP-DB-06]` ghim hiện trạng để khi chủ dự án chốt "chỉ hạ" thì ca này đỏ buộc sửa cùng lúc.
 *   · **Giao diện cấu hình bày đúng**: bộ nạp "Cài riêng theo cơ sở" chỉ trả cơ sở trong phạm vi của QLCS.
 *
 * ⚠️ LUẬT 18 — mỗi ca dựng lại hiện trường của chính nó. ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_TGP_`; `assertTestDb()`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { clearCenterSetting, getSetting, setCenterSetting, setGlobalSetting, clearSettingsCache } from "../../lib/settings/service";
import { docCaiRiengTheoCoSo } from "../../lib/settings/co-so-cau-hinh";
import { coSoSuaDuoc } from "../../lib/settings/quyen-co-so";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;
const P = "CI_TGP_";
const KHOA = "billing.scopeMaxDiscountPercent";

if (!RUN) console.warn("[tran-giam-pham-vi-co-so] SKIP: DATABASE_URL không trỏ Postgres local.");

let W: { cs1: string; cs2: string; quanTriId: string; qlcs1Id: string };

async function cleanup() {
  await db.centerSetting.deleteMany({ where: { key: KHOA } });
  await db.systemSetting.deleteMany({ where: { key: KHOA } });
  const users = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  clearSettingsCache();
}

/** Hiện trường sạch của MỘT ca: không dòng toàn hệ, không dòng cơ sở. */
async function hienTruongSach() {
  await db.centerSetting.deleteMany({ where: { key: KHOA } });
  await db.systemSetting.deleteMany({ where: { key: KHOA } });
  clearSettingsCache();
}

const demDong = (orgUnitId: string) => db.centerSetting.count({ where: { orgUnitId, key: KHOA } });

describe.skipIf(!RUN)("TRẦN % GIẢM PHẠM VI HỌC · cài riêng theo cơ sở (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const cs2 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } });
    const goc = await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } });
    const vaiSuper = await db.roleDef.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" }, select: { id: true } });
    const vaiQlcs = await db.roleDef.findUniqueOrThrow({ where: { code: "CENTER_MANAGER" }, select: { id: true } });
    const quanTri = await seedUser({ email: `${P}admin@ci.test`, name: `${P}Quản trị`, role: "SUPER_ADMIN" });
    const qlcs1 = await seedUser({ email: `${P}qlcs1@ci.test`, name: `${P}QLCS1`, role: "CENTER_MANAGER" });
    await db.userOrgRole.createMany({
      data: [
        { userId: quanTri.id, orgUnitId: goc.id, roleId: vaiSuper.id, grantedById: quanTri.id },
        { userId: qlcs1.id, orgUnitId: cs1.id, roleId: vaiQlcs.id, grantedById: quanTri.id },
      ],
      skipDuplicates: true,
    });
    W = { cs1: cs1.id, cs2: cs2.id, quanTriId: quanTri.id, qlcs1Id: qlcs1.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanup();
    await disconnectDb();
  }, HOOK_TIMEOUT);

  it("[TGP-DB-01] chưa cài gì ⇒ MẶC ĐỊNH 25 ở mọi cơ sở và ở mức toàn hệ", async () => {
    await hienTruongSach();
    expect(await getSetting(KHOA)).toBe(25);
    expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(25);
    expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(25);
  }, CASE_TIMEOUT);

  it("[TGP-DB-02] QLCS1 chỉnh trần cho CS1 = 20 ⇒ CS1 đọc 20, CS2 và mức toàn hệ vẫn 25", async () => {
    await hienTruongSach();
    const actor = await resolveActorUncached(W.qlcs1Id);
    const r = await setCenterSetting(actor, { orgUnitId: W.cs1, key: KHOA, value: 20, reason: "CS1 siết giảm giá", actorName: "ci" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(20);
    expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(25);
    expect(await getSetting(KHOA)).toBe(25);
  }, CASE_TIMEOUT);

  it("[TGP-DB-03] QLCS1 KHÔNG sửa được CS2: FORBIDDEN và KHÔNG có dòng nào được ghi (cổng đứng trước phép ghi)", async () => {
    await hienTruongSach();
    const actor = await resolveActorUncached(W.qlcs1Id);
    const r = await setCenterSetting(actor, { orgUnitId: W.cs2, key: KHOA, value: 10, reason: "thử lấn sang CS2", actorName: "ci" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(await demDong(W.cs2)).toBe(0);
    expect(await getSetting(KHOA, { orgUnitId: W.cs2 })).toBe(25);
  }, CASE_TIMEOUT);

  it("[TGP-DB-04] BẪY orgUnitId: CS1 = 20 nhưng getSetting KHÔNG orgUnitId vẫn ra 25 — lời gọi thiếu orgUnitId đọc SAI cơ sở mà không báo lỗi", async () => {
    await hienTruongSach();
    const actor = await resolveActorUncached(W.quanTriId);
    await setCenterSetting(actor, { orgUnitId: W.cs1, key: KHOA, value: 20, reason: "đo bẫy", actorName: "ci" });
    expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(20);
    expect(await getSetting(KHOA)).toBe(25); // ← đường ghi đơn mà quên truyền orgUnitId sẽ xét số này
  }, CASE_TIMEOUT);

  it("[TGP-DB-05] BIÊN: 0, 101, 25,5 bị TỪ CHỐI (VALIDATION) và không ghi dòng nào; 1 qua", async () => {
    await hienTruongSach();
    const actor = await resolveActorUncached(W.qlcs1Id);
    for (const sai of [0, 101, 25.5, -1, "25"]) {
      const r = await setCenterSetting(actor, { orgUnitId: W.cs1, key: KHOA, value: sai, reason: "thử biên", actorName: "ci" });
      expect(r.ok, `giá trị ${JSON.stringify(sai)} phải bị từ chối`).toBe(false);
    }
    expect(await demDong(W.cs1)).toBe(0);
    const ok = await setCenterSetting(actor, { orgUnitId: W.cs1, key: KHOA, value: 1, reason: "thử biên dưới", actorName: "ci" });
    expect(ok.ok).toBe(true);
  }, CASE_TIMEOUT);

  it("[TGP-DB-06] TRẦN RIÊNG CỦA QLCS = 30 (chủ dự án chốt 20/10 vòng 2): QLCS đặt 30 ⇒ qua; 31/40/100 ⇒ FORBIDDEN và KHÔNG ghi dòng nào; quản trị đặt 40 rồi 100 ⇒ qua", async () => {
    await hienTruongSach();
    const qlcs = await resolveActorUncached(W.qlcs1Id);
    const ok = await setCenterSetting(qlcs, { orgUnitId: W.cs1, key: KHOA, value: 30, reason: "nâng tới trần QLCS", actorName: "ci" });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(30);
    await hienTruongSach();
    for (const vuot of [31, 40, 100]) {
      const r = await setCenterSetting(qlcs, { orgUnitId: W.cs1, key: KHOA, value: vuot, reason: "thử vượt trần QLCS", actorName: "ci" });
      expect(r.ok, `QLCS đặt ${vuot} phải bị từ chối`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    }
    expect(await demDong(W.cs1)).toBe(0);
    const quanTri = await resolveActorUncached(W.quanTriId);
    for (const nang of [40, 100]) {
      const r = await setCenterSetting(quanTri, { orgUnitId: W.cs1, key: KHOA, value: nang, reason: "quản trị nâng trần", actorName: "ci" });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(nang);
    }
  }, CASE_TIMEOUT);

  it("[TGP-DB-06b] GỠ không phải đường nâng vòng: quản trị đặt MỨC TOÀN HỆ = 40 và CS1 = 20 ⇒ QLCS gỡ mức riêng bị FORBIDDEN (gỡ sẽ đẩy CS1 lên 40 > trần 30), dòng 20 còn nguyên; toàn hệ về 25 ⇒ gỡ được", async () => {
    await hienTruongSach();
    const quanTri = await resolveActorUncached(W.quanTriId);
    const qlcs = await resolveActorUncached(W.qlcs1Id);
    await setCenterSetting(quanTri, { orgUnitId: W.cs1, key: KHOA, value: 20, reason: "CS1 siết", actorName: "ci" });
    const g = await setGlobalSetting(quanTri, { key: KHOA, value: 40, reason: "nâng toàn hệ", actorName: "ci" });
    expect(g.ok, JSON.stringify(g)).toBe(true);
    try {
      const r = await clearCenterSetting(qlcs, { orgUnitId: W.cs1, key: KHOA, reason: "thử gỡ", actorName: "ci" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
      expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(20);
    } finally {
      await setGlobalSetting(quanTri, { key: KHOA, value: 25, reason: "khôi phục toàn hệ", actorName: "ci" });
    }
    const ok = await clearCenterSetting(qlcs, { orgUnitId: W.cs1, key: KHOA, reason: "gỡ khi toàn hệ ≤ 30", actorName: "ci" });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await getSetting(KHOA, { orgUnitId: W.cs1 })).toBe(25);
  }, CASE_TIMEOUT);

  it("[TGP-DB-07] màn Cấu hình: QLCS1 chỉ thấy ĐÚNG CS1 trong khối 'Cài riêng theo cơ sở' của khoá này, kèm giá trị riêng; quản trị thấy cả hai", async () => {
    await hienTruongSach();
    const adm = await resolveActorUncached(W.quanTriId);
    await setCenterSetting(adm, { orgUnitId: W.cs1, key: KHOA, value: 20, reason: "dựng hiện trường", actorName: "ci" });
    const qlcs = await resolveActorUncached(W.qlcs1Id);
    const hep = await docCaiRiengTheoCoSo([KHOA], coSoSuaDuoc(qlcs));
    const idHep = (hep[KHOA] ?? []).map((c) => c.orgUnitId);
    expect(idHep).toContain(W.cs1);
    expect(idHep).not.toContain(W.cs2); // không bày cơ sở khác với ô MỞ (luật 12)
    expect((hep[KHOA] ?? []).find((c) => c.orgUnitId === W.cs1)?.giaTriRieng).toBe(20);
    const rong = await docCaiRiengTheoCoSo([KHOA], "TAT_CA");
    const idRong = (rong[KHOA] ?? []).map((c) => c.orgUnitId);
    expect(idRong).toEqual(expect.arrayContaining([W.cs1, W.cs2])); // đối chứng dương: quản trị thấy cả hai
  }, CASE_TIMEOUT);
});
