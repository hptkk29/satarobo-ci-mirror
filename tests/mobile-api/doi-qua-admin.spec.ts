import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phiên giả lập (đổi được từng ca); quyền + tầm nhìn cơ sở dùng ĐƯỜNG THẬT (matrix v1 + resolveActor trên Postgres) — không giả lập checkPermission.
let phien: { user: { id: string; name: string; email: string; role: string; roles: string[] } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => phien), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { datHanMucAction, dieuChinhTonKhoAction, luuQuaAction, xuLyYeuCauAction } from "@/app/(admin)/admin/satacoin/doi-qua/_actions";
import { db } from "@/lib/db";
import { taoYeuCauDoiQua } from "@/lib/satacoin/doi-qua";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

/**
 * [DQA-DB] MÀN NHÂN SỰ ĐỔI QUÀ (WP8) — server action trên POSTGRES THẬT, quyền theo đường THẬT như PROD: RBAC v2 BẬT, RoleDef/RolePermission từ `prisma/seed-roles.ts` (kiểm luôn việc cấp
 * `satacoin:redeem` cho CENTER_MANAGER), UserOrgRole gắn Admin ở HO và QLCS ở CS1 — không giả lập checkPermission/resolveActor.
 *   [DQA-DB-01] chưa đăng nhập / giáo viên / phụ huynh / QLCS không có quyền ⇒ từ chối TRƯỚC mọi phép ghi (không đổi trạng thái, không tồn kho, không hạn mức)
 *   [DQA-DB-02] Admin: duyệt ⇒ giao ⇒ trừ coin đúng MỘT lần + có audit; từ chối bắt buộc lý do; từ chối hoàn coin + hoàn kho
 *   [DQA-DB-03] tồn kho: nhập (+) / xuất (−) theo độ lệch, không bao giờ âm; cơ sở/quà không tồn tại ⇒ từ chối; mọi lần đều có audit
 *   [DQA-DB-04] danh mục: tên ngắn / giá 0 ⇒ từ chối; đổi giá KHÔNG đổi yêu cầu đang giữ (đã chụp giá)
 *   [DQA-DB-05] hạn mức giáo viên: chỉ Admin đặt (QLCS ⇒ từ chối); giá trị xấu ⇒ từ chối; audit ghi giá trị cũ/mới
 *   [DQA-DB-06] QLCS CS1: duyệt/giao yêu cầu của CS1 ĐƯỢC; yêu cầu của CS2 ⇒ «Không tìm thấy» (cách ly cơ sở); nhập kho CS1 được, CS2 ⇒ từ chối; sửa danh mục được; đặt hạn mức không
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "dqatest-";
const ids: Record<string, string> = {};
const dangNhapLa = (k: string, role: string) => {
  phien = { user: { id: ids[k]!, name: `${NS}${k}`, email: `${NS}${k}@ci.test`, role, roles: [role] } };
};
let cs1Id = "";
let cs2Id = "";

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: uids } }, { entityId: { startsWith: NS } }] } });
  await db.sataCoinRedemption.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinGiftStock.deleteMany({ where: { gift: { name: { startsWith: NS } } } });
  await db.sataCoinGift.deleteMany({ where: { name: { startsWith: NS } } });
  await db.teacherCoinQuota.deleteMany({ where: { userId: { in: uids } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
}

describe.skipIf(!RUN)("[DQA-DB] màn nhân sự đổi quà — server action, Postgres thật", () => {
  let quaId = "";
  let ycId = "";
  let ycCs2 = "";
  beforeAll(async () => {
    assertTestDb();
    process.env.RBAC_V2_ENABLED = "true"; // như PROD: quyền đọc từ DB
    await don();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1Id = (await db.center.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2Id = (await db.center.findUniqueOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;
    const ou = async (code: string) => (await db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    const goc = (await db.orgUnit.findFirstOrThrow({ where: { type: { in: ["ROOT", "HO"] } }, orderBy: { depth: "asc" }, select: { id: true } })).id;
    for (const [k, role] of [["admin", "SUPER_ADMIN"], ["qlcs", "CENTER_MANAGER"], ["gv", "TEACHER"], ["ph", "PARENT"]] as const) {
      ids[k] = (await seedUser({ email: `${NS}${k}@ci.test`, name: `${NS}${k}`, role, centerId: k === "qlcs" ? cs1Id : null })).id;
    }
    const vai = async (code: string) => (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    await db.userOrgRole.createMany({
      data: [
        { userId: ids.admin!, orgUnitId: goc, roleId: await vai("SUPER_ADMIN"), grantedById: ids.admin! },
        { userId: ids.qlcs!, orgUnitId: await ou("CS1"), roleId: await vai("CENTER_MANAGER"), grantedById: ids.admin! },
      ],
      skipDuplicates: true,
    });
    await db.student.create({ data: { id: `${NS}hs`, name: `${NS}hs`, parentUserId: ids.ph, centerId: cs1Id } as never });
    await db.student.create({ data: { id: `${NS}hs-cs2`, name: `${NS}hs-cs2`, centerId: cs2Id } as never });
    await db.sataCoinTransaction.create({ data: { studentId: `${NS}hs`, amount: 300, type: "ADJUST", reason: "TEST_NAP", centerId: cs1Id } as never });
    await db.sataCoinTransaction.create({ data: { studentId: `${NS}hs-cs2`, amount: 100, type: "ADJUST", reason: "TEST_NAP", centerId: cs2Id } as never });
    const g = await db.sataCoinGift.create({ data: { name: `${NS}Gấu bông`, coinCost: 60, isActive: true } });
    quaId = g.id;
    await db.sataCoinGiftStock.create({ data: { giftId: quaId, centerId: cs1Id, quantity: 3 } });
    await db.sataCoinGiftStock.create({ data: { giftId: quaId, centerId: cs2Id, quantity: 3 } });
    ycId = (await taoYeuCauDoiQua({ studentId: `${NS}hs`, giftId: quaId, requestedByUserId: ids.ph!, idempotencyKey: "khoa-dqa-0001" })).yeuCau.id;
    ycCs2 = (await taoYeuCauDoiQua({ studentId: `${NS}hs-cs2`, giftId: quaId, requestedByUserId: ids.ph!, idempotencyKey: "khoa-dqa-0002" })).yeuCau.id;
  }, 120_000);
  afterAll(async () => {
    phien = null;
    delete process.env.RBAC_V2_ENABLED;
    await don();
  });
  beforeEach(() => {
    phien = null;
  });

  const trangThai = async () => (await db.sataCoinRedemption.findUniqueOrThrow({ where: { id: ycId } })).status;
  const ton = async () => (await db.sataCoinGiftStock.findFirstOrThrow({ where: { giftId: quaId, centerId: cs1Id } })).quantity;

  it("[DQA-DB-01] chưa đăng nhập / GV / PH / QLCS-không-quyền ⇒ từ chối trước mọi phép ghi", async () => {
    const truocTon = await ton();
    const truocQuota = await db.teacherCoinQuota.count({ where: { userId: ids.gv } });
    const thu = async () => [
      await xuLyYeuCauAction({ redemptionId: ycId, hanhDong: "DUYET" }),
      await luuQuaAction({ name: `${NS}Quà lậu`, coinCost: 5, isActive: true }),
      await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 5, reason: "lậu" }),
      await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 999999 }),
    ];
    // chưa đăng nhập
    for (const r of await thu()) expect(r).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    // giáo viên / phụ huynh: không có `satacoin:redeem` / `satacoin:quota`
    for (const [k, role] of [["gv", "TEACHER"], ["ph", "PARENT"]] as const) {
      dangNhapLa(k, role);
      for (const r of await thu()) expect([k, r]).toEqual([k, { ok: false, error: "Không có quyền" }]);
    }
    // QLCS có `satacoin:redeem` nhưng KHÔNG có `satacoin:quota`
    dangNhapLa("qlcs", "CENTER_MANAGER");
    expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 50 })).toEqual({ ok: false, error: "Không có quyền" });
    // Không có phép ghi nào lọt qua.
    expect(await trangThai()).toBe("REQUESTED");
    expect(await ton()).toBe(truocTon);
    expect(await db.sataCoinGift.count({ where: { name: `${NS}Quà lậu` } })).toBe(0);
    expect(await db.teacherCoinQuota.count({ where: { userId: ids.gv } })).toBe(truocQuota);
  });

  it("[DQA-DB-02] Admin: duyệt → giao ⇒ trừ coin MỘT lần + audit; từ chối cần lý do và hoàn coin + kho", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    expect(await xuLyYeuCauAction({ redemptionId: "khong-co", hanhDong: "DUYET" })).toMatchObject({ ok: false, error: "Không tìm thấy yêu cầu" });
    expect(await xuLyYeuCauAction({ redemptionId: ycId, hanhDong: "HOAN_TAT" })).toMatchObject({ ok: false }); // chưa duyệt không giao được
    expect(await xuLyYeuCauAction({ redemptionId: ycId, hanhDong: "DUYET" })).toEqual({ ok: true });
    expect(await trangThai()).toBe("APPROVED");
    expect(await xuLyYeuCauAction({ redemptionId: ycId, hanhDong: "HOAN_TAT" })).toEqual({ ok: true });
    expect(await xuLyYeuCauAction({ redemptionId: ycId, hanhDong: "HOAN_TAT" })).toMatchObject({ ok: false }); // giao lần hai ⇒ từ chối
    expect(await trangThai()).toBe("DELIVERED");
    expect(await db.sataCoinTransaction.count({ where: { studentId: `${NS}hs`, type: "SPEND" } })).toBe(1);
    const vi = await db.sataCoinTransaction.aggregate({ where: { studentId: `${NS}hs` }, _sum: { amount: true } });
    expect(vi._sum.amount).toBe(240); // 300 − 60
    const audit = await db.auditLog.findMany({ where: { entityType: "SataCoinRedemption", entityId: ycId }, select: { action: true, actorId: true } });
    expect(audit.map((a) => a.action).sort()).toEqual(["satacoin.redemption.duyet", "satacoin.redemption.hoan_tat"]);
    expect(audit.every((a) => a.actorId === ids.admin)).toBe(true);

    // Yêu cầu thứ hai: từ chối BẮT BUỘC lý do; có lý do ⇒ hoàn kho, coin vẫn nguyên.
    const y2 = (await taoYeuCauDoiQua({ studentId: `${NS}hs`, giftId: quaId, requestedByUserId: ids.ph!, idempotencyKey: "khoa-dqa-0002" })).yeuCau.id;
    const tonTruoc = await ton();
    expect(await xuLyYeuCauAction({ redemptionId: y2, hanhDong: "TU_CHOI" })).toEqual({ ok: false, error: "Vui lòng ghi lý do từ chối" });
    expect(await xuLyYeuCauAction({ redemptionId: y2, hanhDong: "TU_CHOI", ghiChu: "ab" })).toMatchObject({ ok: false });
    expect(await xuLyYeuCauAction({ redemptionId: y2, hanhDong: "TU_CHOI", ghiChu: "Hết quà thật ở kho" })).toEqual({ ok: true });
    expect(await ton()).toBe(tonTruoc + 1);
    expect((await db.sataCoinRedemption.findUniqueOrThrow({ where: { id: y2 } })).status).toBe("REJECTED");
    expect((await db.sataCoinTransaction.aggregate({ where: { studentId: `${NS}hs` }, _sum: { amount: true } }))._sum.amount).toBe(240);
  });

  it("[DQA-DB-03] tồn kho: +nhập / −xuất theo độ lệch, không âm; cơ sở/quà không có ⇒ từ chối; có audit", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    const t0 = await ton();
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 5, reason: "Nhập lô mới" })).toEqual({ ok: true });
    expect(await ton()).toBe(t0 + 5);
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: -(t0 + 6), reason: "Xuất quá tay" })).toEqual({ ok: false, error: "Tồn kho không đủ để giảm" });
    expect(await ton()).toBe(t0 + 5);
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: -(t0 + 5), reason: "Xuất hết" })).toEqual({ ok: true });
    expect(await ton()).toBe(0);
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 0, reason: "Không đổi" })).toMatchObject({ ok: false });
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 3, reason: "x" })).toMatchObject({ ok: false }); // thiếu lý do
    expect(await dieuChinhTonKhoAction({ giftId: "khong-co", centerId: cs1Id, delta: 3, reason: "Quà lạ" })).toEqual({ ok: false, error: "Không tìm thấy quà hoặc cơ sở" });
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: "co-so-la", delta: 3, reason: "Cơ sở lạ" })).toEqual({ ok: false, error: "Không tìm thấy quà hoặc cơ sở" });
    expect(await db.auditLog.count({ where: { entityType: "SataCoinGiftStock", entityId: `${quaId}:${cs1Id}`, action: "satacoin.stock.adjust" } })).toBe(2); // chỉ hai lần THÀNH CÔNG có audit; các lần bị từ chối không ghi gì
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 4, reason: "Nhập lại" })).toEqual({ ok: true }); // trả kho về 4 cho ca sau
  });

  it("[DQA-DB-04] danh mục: tên ngắn / giá 0 ⇒ từ chối; đổi giá KHÔNG đổi yêu cầu đang giữ", async () => {
    dangNhapLa("admin", "SUPER_ADMIN");
    expect(await luuQuaAction({ name: "a", coinCost: 10, isActive: true })).toMatchObject({ ok: false });
    expect(await luuQuaAction({ name: `${NS}Giá không`, coinCost: 0, isActive: true })).toMatchObject({ ok: false });
    expect(await luuQuaAction({ name: `${NS}Giá lẻ`, coinCost: 1.5, isActive: true })).toMatchObject({ ok: false });
    const y3 = (await taoYeuCauDoiQua({ studentId: `${NS}hs`, giftId: quaId, requestedByUserId: ids.ph!, idempotencyKey: "khoa-dqa-0003" })).yeuCau.id;
    expect(await luuQuaAction({ id: quaId, name: `${NS}Gấu bông`, coinCost: 999, isActive: true })).toEqual({ ok: true });
    expect((await db.sataCoinGift.findUniqueOrThrow({ where: { id: quaId } })).coinCost).toBe(999);
    expect((await db.sataCoinRedemption.findUniqueOrThrow({ where: { id: y3 } })).coinCost).toBe(60); // ảnh chụp giá lúc gửi
    expect(await luuQuaAction({ id: "khong-co", name: `${NS}Ma`, coinCost: 5, isActive: true })).toEqual({ ok: false, error: "Không tìm thấy món quà" });
    expect(await luuQuaAction({ name: `${NS}Quà mới`, coinCost: 25, isActive: true })).toEqual({ ok: true });
    expect(await luuQuaAction({ id: quaId, name: `${NS}Gấu bông`, coinCost: 60, isActive: true })).toEqual({ ok: true }); // trả giá về 60 cho ca sau (các ca dùng chung fixture)
  });

  it("[DQA-DB-05] hạn mức GV: chỉ Admin; giá trị xấu ⇒ từ chối; audit giá trị cũ/mới", async () => {
    dangNhapLa("qlcs", "CENTER_MANAGER");
    expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 100 })).toEqual({ ok: false, error: "Không có quyền" });
    dangNhapLa("admin", "SUPER_ADMIN");
    for (const cap of [-5, 1.5, 2_000_000]) expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: cap })).toMatchObject({ ok: false });
    expect(await datHanMucAction({ teacherUserId: ids.ph, capPerMonth: 10 })).toEqual({ ok: false, error: "Không tìm thấy giáo viên" });
    expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 100 })).toEqual({ ok: true });
    expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 150, note: "Tăng theo tháng thi đua" })).toEqual({ ok: true });
    expect((await db.teacherCoinQuota.findUniqueOrThrow({ where: { userId: ids.gv! } })).capPerMonth).toBe(150);
    const a = await db.auditLog.findMany({ where: { entityType: "TeacherCoinQuota", entityId: ids.gv }, orderBy: { createdAt: "asc" }, select: { oldValues: true, newValues: true } });
    expect(a.map((x) => [x.oldValues, x.newValues])).toEqual([[{ capPerMonth: null }, { capPerMonth: 100 }], [{ capPerMonth: 100 }, { capPerMonth: 150 }]]);
  });

  it("[DQA-DB-06] QLCS CS1: yêu cầu CS1 được; yêu cầu/kho CS2 ⇒ từ chối (cách ly); danh mục được; hạn mức không", async () => {
    dangNhapLa("qlcs", "CENTER_MANAGER");
    // Cùng một người, hai cơ sở: CS2 ⇒ «không tìm thấy» (không lộ sự tồn tại).
    expect(await xuLyYeuCauAction({ redemptionId: ycCs2, hanhDong: "DUYET" })).toEqual({ ok: false, error: "Không tìm thấy yêu cầu" });
    expect((await db.sataCoinRedemption.findUniqueOrThrow({ where: { id: ycCs2 } })).status).toBe("REQUESTED");
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs2Id, delta: 5, reason: "Nhập lậu CS2" })).toEqual({ ok: false, error: "Không có quyền với cơ sở này" });
    expect((await db.sataCoinGiftStock.findFirstOrThrow({ where: { giftId: quaId, centerId: cs2Id } })).quantity).toBe(2); // 3 − 1 giữ chỗ của yêu cầu CS2; KHÔNG bị nhập lậu
    // Đối chứng DƯƠNG (luật: ca «không thấy» luôn phải kèm «vai kia THẤY»): chính QLCS này làm được ở CS1.
    expect(await dieuChinhTonKhoAction({ giftId: quaId, centerId: cs1Id, delta: 1, reason: "Nhập thêm CS1" })).toEqual({ ok: true });
    const y = (await taoYeuCauDoiQua({ studentId: `${NS}hs`, giftId: quaId, requestedByUserId: ids.ph!, idempotencyKey: "khoa-dqa-0006" })).yeuCau.id;
    expect(await xuLyYeuCauAction({ redemptionId: y, hanhDong: "DUYET" })).toEqual({ ok: true });
    // Danh mục TOÀN CỤC: QLCS KHÔNG tạo/sửa được (chủ dự án chốt 19/11) — tạo mới và đổi giá quà có sẵn đều bị từ chối, dữ liệu không đổi.
    const giaTruoc = (await db.sataCoinGift.findUniqueOrThrow({ where: { id: quaId } })).coinCost;
    expect(await luuQuaAction({ name: `${NS}Quà QLCS`, coinCost: 15, isActive: true })).toEqual({ ok: false, error: "Không có quyền" });
    expect(await luuQuaAction({ id: quaId, name: `${NS}Gấu bông`, coinCost: 1, isActive: false })).toEqual({ ok: false, error: "Không có quyền" });
    expect(await db.sataCoinGift.count({ where: { name: `${NS}Quà QLCS` } })).toBe(0);
    const sau = await db.sataCoinGift.findUniqueOrThrow({ where: { id: quaId } });
    expect([sau.coinCost, sau.isActive]).toEqual([giaTruoc, true]);
    expect(await datHanMucAction({ teacherUserId: ids.gv, capPerMonth: 10 })).toEqual({ ok: false, error: "Không có quyền" });
    // Admin (toàn hệ) duyệt được cả yêu cầu CS2 và là người DUY NHẤT sửa được danh mục toàn cục (đối chứng dương).
    dangNhapLa("admin", "SUPER_ADMIN");
    expect(await xuLyYeuCauAction({ redemptionId: ycCs2, hanhDong: "DUYET" })).toEqual({ ok: true });
    expect(await luuQuaAction({ name: `${NS}Quà Admin`, coinCost: 15, isActive: true })).toEqual({ ok: true });
  });
});
