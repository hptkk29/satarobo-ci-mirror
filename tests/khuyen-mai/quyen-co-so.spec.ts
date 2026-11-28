// @vitest-environment node
/**
 * [KMP-DB-*] — QUẢN LÝ CƠ SỞ ban hành chính sách khuyến mãi (chủ dự án mở quyền 01/11/2026), chạy ĐÚNG Server Action
 * thật + actor THẬT dựng từ DB (RBAC v2) trên Postgres local.
 *
 * Cái cần chứng minh mà test thuần không chứng minh được: `phamViKhuyenMai` đọc `PermEntry.orgUnitScope` do `resolveActor`
 * dựng từ `UserOrgRole` — nếu trường đó rỗng / lệch không gian id (Center.id thay vì OrgUnit.id) thì QLCS bị khoá oan hoặc
 * (tệ hơn) được mở toang, và mọi ca thuần vẫn xanh.
 *
 *   [KMP-DB-01] phạm vi thật: QLCS@CS1 = đúng OrgUnit CS1 (không CS2); Giám đốc neo Hội sở = TẤT CẢ
 *   [KMP-DB-02] QLCS@CS1: ban hành cho CS1 ⇒ được; CS2 ⇒ bị chặn; trống (toàn hệ thống) ⇒ bị chặn; CS1+CS2 ⇒ bị chặn
 *   [KMP-DB-03] QLCS@CS1: sửa / thu hồi / thêm mã / bật-tắt mã chính sách của CS2 và của TOÀN HỆ THỐNG ⇒ bị chặn, DB không đổi;
 *               đối chứng dương: cùng việc trên chính sách của CS1 ⇒ được
 *   [KMP-DB-04] đối chứng: Giám đốc ban hành toàn hệ thống + sửa chính sách CS2 ⇒ được
 *   [KMP-DB-05] sửa chính sách CS1 nhưng ĐỔI sang CS2 ⇒ bị chặn (kiểm cả vế cơ sở MỚI)
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `CI.KMP.` / `ci_kmp_`. LUẬT 18: mỗi ca tự dựng chính sách của mình.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string; tokenVersion: number } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { phamViKhuyenMai } from "../../lib/khuyen-mai/quyen-co-so";
import { banHanhAction, batTatVoucherAction, suaAction, themVoucherAction, thuHoiAction } from "../../app/(admin)/admin/khuyen-mai/_actions";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn("[khuyen-mai/quyen-co-so] SKIP: DATABASE_URL không trỏ Postgres local (hoặc thiếu ALLOW_DB_RESET).");

const P = "ci_kmp_";
const HOOK = 240_000;
const CA = 60_000;
const ID: Record<string, string> = {};
const NGUOI: Record<string, { id: string; email: string; name: string }> = {};
let seq = 0;

async function don() {
  const cs = await db.promotionPolicy.findMany({ where: { documentCode: { startsWith: "CI.KMP." } }, select: { id: true } });
  const csIds = cs.map((c) => c.id);
  const vch = await db.voucher.findMany({ where: { policyId: { in: csIds } }, select: { id: true } });
  await db.voucherRedemption.deleteMany({ where: { voucherId: { in: vch.map((v) => v.id) } } });
  await db.voucher.deleteMany({ where: { id: { in: vch.map((v) => v.id) } } });
  await db.promotionPolicy.deleteMany({ where: { id: { in: csIds } } });
  const nguoi = await db.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const uIds = nguoi.map((u) => u.id);
  if (uIds.length) {
    await db.staffNotification.deleteMany({ where: { userId: { in: uIds } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: uIds } } });
    await db.user.deleteMany({ where: { id: { in: uIds } } });
  }
}

async function nguoiCoVai(ten: string, code: string, orgUnit: string, roleCu: string) {
  const u = await seedUser({ email: `${P}${ten}@ci.test`, name: `${P}${ten}`, role: roleCu as never });
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } });
  await db.userOrgRole.create({
    data: { userId: u.id, orgUnitId: ID[orgUnit]!, roleId: rd.id, grantedById: u.id, effectiveFrom: new Date(Date.now() - 3_600_000) },
  });
  return { id: u.id, email: `${P}${ten}@ci.test`, name: `${P}${ten}` };
}

const dangNhap = (n: { id: string; email: string; name: string }, role: string) => {
  SESS.current = { user: { id: n.id, role, roles: [role], centerId: null, name: n.name, email: n.email, tokenVersion: 0 } };
};

const ND = (ma: string, coSo: string[], o: Record<string, unknown> = {}) => ({
  maVanBan: ma,
  ten: `CI ${ma}`,
  noiDungUuDai: `Ưu đãi của ${ma} cho phụ huynh.`,
  dieuKien: "",
  tuNgay: "2099-01-01",
  denNgay: "2099-12-31",
  coSo,
  khoaHoc: [] as string[],
  tep: null,
  ...o,
});
const maMoi = () => `CI.KMP.${Date.now().toString(36)}.${seq++}`.toUpperCase();

/** Chính sách dựng THẲNG bằng DB — để ca kiểm chặn không phụ thuộc vào đường ban hành đang được test. */
async function dungChinhSach(coSo: string[]) {
  const ma = maMoi();
  const cs = await db.promotionPolicy.create({
    data: {
      documentCode: ma,
      name: `CI ${ma}`,
      benefitText: "Ưu đãi thử nghiệm đủ dài để qua kiểm tra.",
      validFrom: new Date("2099-01-01T00:00:00Z"),
      validUntil: new Date("2099-12-31T00:00:00Z"),
      orgUnitIds: coSo,
      courseIds: [],
      createdById: NGUOI.gd!.id,
      updatedById: NGUOI.gd!.id,
    },
    select: { id: true },
  });
  return { id: cs.id, ma };
}

const MA_VOUCHER = () => `CIKMP${Date.now().toString(36)}${seq++}`.toUpperCase().slice(0, 20);

describe.skipIf(!RUN)("[KMP-DB] Quản lý cơ sở ban hành khuyến mãi — chỉ cho cơ sở của mình", () => {
  beforeAll(async () => {
    assertTestDb();
    await don();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    for (const code of ["HO", "CS1", "CS2"]) {
      ID[code] = (await db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    }
    NGUOI.qlcs1 = await nguoiCoVai("qlcs1", "CENTER_MANAGER", "CS1", "CENTER_MANAGER");
    NGUOI.qlcs2 = await nguoiCoVai("qlcs2", "CENTER_MANAGER", "CS2", "CENTER_MANAGER");
    NGUOI.gd = await nguoiCoVai("giamdoc", "GIAM_DOC", "HO", "CENTER_MANAGER");
  }, HOOK);

  afterAll(async () => {
    try {
      await don();
    } finally {
      await disconnectDb();
    }
  }, HOOK);

  it("[KMP-DB-01] phạm vi thật dựng từ actor: QLCS@CS1 = đúng OrgUnit CS1 (không CS2); Giám đốc neo Hội sở = TẤT CẢ", { timeout: CA }, async () => {
    const q1 = phamViKhuyenMai(await resolveActorUncached(NGUOI.qlcs1!.id));
    expect(q1).not.toBe("TAT_CA");
    expect([...(q1 as readonly string[])]).toContain(ID.CS1);
    expect([...(q1 as readonly string[])]).not.toContain(ID.CS2);
    expect([...(q1 as readonly string[])]).not.toContain(ID.HO);
    expect(phamViKhuyenMai(await resolveActorUncached(NGUOI.gd!.id))).toBe("TAT_CA");
  });

  it("[KMP-DB-02] QLCS@CS1 ban hành: CS1 ⇒ được; CS2 / trống (toàn hệ thống) / CS1+CS2 ⇒ bị chặn, không tạo gì", { timeout: CA }, async () => {
    dangNhap(NGUOI.qlcs1!, "CENTER_MANAGER");
    const ok = await banHanhAction(ND(maMoi(), [ID.CS1!]));
    expect(ok).toMatchObject({ ok: true });

    for (const coSo of [[ID.CS2!], [], [ID.CS1!, ID.CS2!]]) {
      const ma = maMoi();
      const r = await banHanhAction(ND(ma, coSo));
      expect(r, JSON.stringify(coSo)).toMatchObject({ ok: false, error: expect.stringMatching(/cơ sở bạn quản lý/) });
      expect(await db.promotionPolicy.count({ where: { documentCode: ma } })).toBe(0);
    }
  });

  it("[KMP-DB-03] QLCS@CS1 sửa/thu hồi/thêm mã/bật-tắt mã chính sách của CS2 và TOÀN HỆ THỐNG ⇒ bị chặn; CS1 ⇒ được", { timeout: CA }, async () => {
    const cs2 = await dungChinhSach([ID.CS2!]);
    const hethong = await dungChinhSach([]);
    const cs1 = await dungChinhSach([ID.CS1!]);
    // Mã của CS2 do GIÁM ĐỐC thêm bằng đúng action thật (dựng tay một Voucher dễ lệch các cột bắt buộc); rồi mới đổi sang QLCS@CS1.
    dangNhap(NGUOI.gd!, "CENTER_MANAGER");
    const themMa = await themVoucherAction({ chinhSachId: cs2.id, ma: MA_VOUCHER(), kieu: "FIXED", phanTram: null, soTien: 100_000, giamToiDa: null, donToiThieu: 0, soLuong: 5 });
    expect(themMa, JSON.stringify(themMa)).toMatchObject({ ok: true });
    const vCs2 = { id: (themMa as { ok: true; data: { id: string } }).data.id };
    dangNhap(NGUOI.qlcs1!, "CENTER_MANAGER");

    for (const muc of [cs2, hethong]) {
      expect(await suaAction({ id: muc.id, ...ND(muc.ma, [ID.CS1!], { ten: "Bị sửa" }) }), `sửa ${muc.ma}`).toMatchObject({ ok: false, error: expect.stringMatching(/ngoài cơ sở bạn quản lý/) });
      expect(await thuHoiAction({ id: muc.id, lyDo: "Thử thu hồi chính sách không thuộc phạm vi" }), `thu hồi ${muc.ma}`).toMatchObject({ ok: false });
      expect(
        await themVoucherAction({ chinhSachId: muc.id, ma: MA_VOUCHER(), kieu: "FIXED", phanTram: null, soTien: 100_000, giamToiDa: null, donToiThieu: 0, soLuong: 5 }),
        `thêm mã ${muc.ma}`,
      ).toMatchObject({ ok: false });
      const sau = await db.promotionPolicy.findUniqueOrThrow({ where: { id: muc.id }, select: { name: true, revokedAt: true } });
      expect(sau.name).not.toBe("Bị sửa");
      expect(sau.revokedAt).toBeNull();
    }
    // ⚠️ id chính sách ở tham số thứ hai KHÔNG được dùng làm bằng chứng phạm vi: gửi id chính sách CS1 để "đánh lạc" ⇒ vẫn bị chặn.
    expect(await batTatVoucherAction({ id: vCs2.id, bat: false }, cs1.id)).toMatchObject({ ok: false, error: expect.stringMatching(/ngoài cơ sở bạn quản lý/) });
    expect((await db.voucher.findUniqueOrThrow({ where: { id: vCs2.id }, select: { isActive: true } })).isActive).toBe(true);

    // Đối chứng dương: cùng việc trên chính sách CS1.
    expect(await suaAction({ id: cs1.id, ...ND(cs1.ma, [ID.CS1!], { ten: "Được sửa" }) })).toMatchObject({ ok: true });
    expect(await thuHoiAction({ id: cs1.id, lyDo: "Thu hồi chính sách của chính cơ sở mình" })).toMatchObject({ ok: true });
  });

  it("[KMP-DB-04] đối chứng: Giám đốc ban hành TOÀN HỆ THỐNG và sửa chính sách của CS2 ⇒ được", { timeout: CA }, async () => {
    dangNhap(NGUOI.gd!, "CENTER_MANAGER");
    expect(await banHanhAction(ND(maMoi(), []))).toMatchObject({ ok: true });
    const cs2 = await dungChinhSach([ID.CS2!]);
    expect(await suaAction({ id: cs2.id, ...ND(cs2.ma, [ID.CS2!], { ten: "Giám đốc sửa" }) })).toMatchObject({ ok: true });
  });

  it("[KMP-DB-05] sửa chính sách CS1 nhưng ĐỔI sang CS2 ⇒ bị chặn (kiểm cả vế cơ sở MỚI)", { timeout: CA }, async () => {
    dangNhap(NGUOI.qlcs1!, "CENTER_MANAGER");
    const cs1 = await dungChinhSach([ID.CS1!]);
    expect(await suaAction({ id: cs1.id, ...ND(cs1.ma, [ID.CS2!]) })).toMatchObject({ ok: false });
    expect((await db.promotionPolicy.findUniqueOrThrow({ where: { id: cs1.id }, select: { orgUnitIds: true } })).orgUnitIds).toEqual([ID.CS1]);
  });
});
