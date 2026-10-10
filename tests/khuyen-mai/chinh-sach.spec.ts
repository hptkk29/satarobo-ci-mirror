// @vitest-environment node
/**
 * Chính sách khuyến mãi — nghiệp vụ ban hành / sửa / thu hồi / mã voucher, trên Postgres THẬT.
 *
 * 02/10/2026 — các ca `[D1-SV-*]` dời nguyên từ `tests/agents/cong-cu-dot1.spec.ts` khi gỡ Cổng dữ
 * liệu agent (chủ dự án chốt: gỡ cổng, GIỮ khuyến mãi). Các ca công cụ agent `[D1-KM*]` không dời:
 * công cụ đã gỡ; luật hiệu lực mà chúng canh vẫn có lưới thuần ở `lib/khuyen-mai/hieu-luc.test.ts`.
 *
 * Dữ liệu đặt ở năm 2098–2099 (ngày TUYỆT ĐỐI truyền qua tham số — luật 19) và mang tiền tố
 * `CI_KM_` / `CI.KM.` / `CIKM` để dọn đúng phần của mình.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import {
  LoiKhuyenMai,
  banHanhChinhSach,
  batTatVoucher,
  suaChinhSach,
  themVoucher,
  thuHoiChinhSach,
  type NguoiThaoTac,
} from "../../lib/khuyen-mai/chinh-sach";

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn("[khuyen-mai] SKIP: DATABASE_URL không trỏ Postgres local (hoặc thiếu ALLOW_DB_RESET).");

const P = "CI_KM_";
const HOOK = 240_000;
const CA = 60_000;

let GD: NguoiThaoTac;
const ID: Record<string, string> = {};

async function cleanup() {
  const cs = await db.promotionPolicy.findMany({ where: { documentCode: { startsWith: "CI.KM." } }, select: { id: true } });
  const csIds = cs.map((c) => c.id);
  const vch = await db.voucher.findMany({ where: { OR: [{ code: { startsWith: "CIKM" } }, { policyId: { in: csIds } }] }, select: { id: true } });
  const vIds = vch.map((v) => v.id);
  await db.voucherRedemption.deleteMany({ where: { voucherId: { in: vIds } } });
  await db.voucher.deleteMany({ where: { id: { in: vIds } } });
  await db.promotionPolicy.deleteMany({ where: { id: { in: csIds } } });
  const nguoi = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  const uIds = nguoi.map((u) => u.id);
  if (uIds.length) {
    await db.staffNotification.deleteMany({ where: { userId: { in: uIds } } });
    await db.userOrgRole.deleteMany({ where: { userId: { in: uIds } } });
    await db.user.deleteMany({ where: { id: { in: uIds } } });
  }
}

async function vai(code: string) {
  return (await db.roleDef.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
}

async function nguoiCoVai(ten: string, code: string, orgUnit: string) {
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}@ci.test`, name: `${P}${ten}`, role: "SALES_CSM" });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: ID[orgUnit]!, roleId: await vai(code), grantedById: GD.userId } });
  return u.id;
}

describe.skipIf(!RUN)("Chính sách khuyến mãi — nghiệp vụ (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const gd = await seedUser({ email: `${P.toLowerCase()}gd@ci.test`, name: `${P}Giám đốc`, role: "SUPER_ADMIN" });
    GD = { userId: gd.id, ten: `${P}Giám đốc` };
    for (const code of ["HO", "CS1", "CS2"]) {
      ID[code] = (await db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
    }
    // Người tra cứu khuyến mãi (nhận thông báo).
    ID.saleCs1 = await nguoiCoVai("sale-cs1", "CENTER_SALES_CSM", "CS1");
    ID.saleCs2 = await nguoiCoVai("sale-cs2", "CENTER_SALES_CSM", "CS2");
    ID.mktHo = await nguoiCoVai("mkt-ho", "HO_MARKETING", "HO");
  }, HOOK);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK);

  const tao = (ma: string, tu: string, den: string, coSo: string[] = [], lanTao = "2098-01-01T01:00:00Z") =>
    banHanhChinhSach(
      GD,
      { maVanBan: ma, ten: `CI ${ma}`, noiDungUuDai: `Ưu đãi của ${ma}.`, dieuKien: null, tuNgay: tu, denNgay: den, coSo, khoaHoc: [], tep: null },
      new Date(lanTao),
    );

  it("[KM-SV-01] ban hành phạm vi CS1 ⇒ báo Sale CS1 + người neo Hội sở; KHÔNG báo Sale CS2, không báo người ban hành", { timeout: CA }, async () => {
    const r = await tao("CI.KM.QD.1", "2099-01-01", "2099-12-31", [ID.CS1!]);
    const nhan = await db.staffNotification.findMany({ where: { dedupeKey: `khuyen-mai.ban-hanh:${r.id}` }, select: { userId: true, href: true } });
    const ai = new Set(nhan.map((n) => n.userId));
    expect(ai.has(ID.saleCs1!)).toBe(true);
    expect(ai.has(ID.mktHo!)).toBe(true);
    expect(ai.has(ID.saleCs2!)).toBe(false);
    expect(ai.has(GD.userId)).toBe(false);
    expect(nhan[0]!.href).toBe(`/khuyen-mai/${r.id}`);
    expect(r.soNguoiDuocBao).toBe(nhan.length);
  });

  it("[KM-SV-02] trùng mã văn bản ⇒ TRUNG_MA, không tạo dòng thứ hai", { timeout: CA }, async () => {
    await tao("CI.KM.QD.TRUNG", "2099-01-01", "2099-12-31");
    await expect(tao("CI.KM.QD.TRUNG", "2099-01-01", "2099-12-31")).rejects.toMatchObject({ ma: "TRUNG_MA" });
    expect(await db.promotionPolicy.count({ where: { documentCode: "CI.KM.QD.TRUNG" } })).toBe(1);
  });

  it("[KM-SV-03] thu hồi ⇒ mọi mã bị tắt, báo Sale, không thu hồi lần hai; mã không bật lại/không thêm được", { timeout: CA }, async () => {
    const r = await tao("CI.KM.QD.6", "2099-01-01", "2099-12-31", [ID.CS1!]);
    const v = await themVoucher(
      GD,
      { chinhSachId: r.id, ma: "CIKMTHUHOI", kieu: "FIXED", phanTram: null, soTien: 300_000, giamToiDa: null, donToiThieu: 0, soLuong: 10, ghiChu: null },
      new Date("2099-01-05T01:00:00Z"),
    );
    await thuHoiChinhSach(GD, { id: r.id, lyDo: "Hết ngân sách chương trình CI" }, new Date("2099-02-10T08:00:00Z"));
    expect((await db.voucher.findUniqueOrThrow({ where: { id: v.id } })).isActive).toBe(false);
    const bao = await db.staffNotification.findFirst({ where: { dedupeKey: `khuyen-mai.thu-hoi:${r.id}`, userId: ID.saleCs1 } });
    expect(bao?.body).toContain("Hết ngân sách chương trình CI");
    await expect(thuHoiChinhSach(GD, { id: r.id, lyDo: "lần hai lần hai" }, new Date("2099-02-11T00:00:00Z"))).rejects.toMatchObject({ ma: "SAI_TRANG_THAI" });
    await expect(batTatVoucher(GD, { id: v.id, bat: true }, new Date("2099-02-11T00:00:00Z"))).rejects.toBeInstanceOf(LoiKhuyenMai);
    await expect(
      themVoucher(
        GD,
        { chinhSachId: r.id, ma: "CIKMSAU", kieu: "PERCENT", phanTram: 5, soTien: null, giamToiDa: null, donToiThieu: 0, soLuong: null, ghiChu: null },
        new Date("2099-02-11T00:00:00Z"),
      ),
    ).rejects.toMatchObject({ ma: "SAI_TRANG_THAI" });
    await expect(suaChinhSach(GD, {
      id: r.id, maVanBan: "CI.KM.QD.6", ten: "x x x", noiDungUuDai: "Ưu đãi đã sửa lại.", dieuKien: null,
      tuNgay: "2099-01-01", denNgay: "2099-12-31", coSo: [], khoaHoc: [], tep: null,
    }, new Date("2099-02-11T00:00:00Z"))).rejects.toMatchObject({ ma: "SAI_TRANG_THAI" });
  });

  it("[KM-SV-04] sửa ngày hiệu lực ⇒ hiệu lực của MÃ đi theo (cùng transaction)", { timeout: CA }, async () => {
    const r = await tao("CI.KM.QD.SUA", "2099-01-01", "2099-06-30");
    const v = await themVoucher(
      GD,
      { chinhSachId: r.id, ma: "CIKMSUA", kieu: "PERCENT", phanTram: 5, soTien: null, giamToiDa: 200_000, donToiThieu: 0, soLuong: null, ghiChu: null },
      new Date("2099-01-05T01:00:00Z"),
    );
    await suaChinhSach(GD, {
      id: r.id, maVanBan: "CI.KM.QD.SUA", ten: "CI sửa", noiDungUuDai: "Ưu đãi đã sửa lại.", dieuKien: null,
      tuNgay: "2099-02-01", denNgay: "2099-09-30", coSo: [], khoaHoc: [], tep: null,
    }, new Date("2099-01-10T00:00:00Z"));
    const sau = await db.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(sau.validFrom.toISOString()).toBe("2099-01-31T17:00:00.000Z");
    expect(sau.validUntil.toISOString()).toBe("2099-09-30T16:59:59.999Z");
    await expect(
      themVoucher(
        GD,
        { chinhSachId: r.id, ma: "CIKMSUA", kieu: "PERCENT", phanTram: 5, soTien: null, giamToiDa: null, donToiThieu: 0, soLuong: null, ghiChu: null },
        new Date("2099-02-05T01:00:00Z"),
      ),
    ).rejects.toMatchObject({ ma: "TRUNG_MA" });
  });

  it("[KM-SV-05] sửa LÙI ngày kết thúc về trước hôm nay ⇒ từ chối (phải dùng Thu hồi); giữ nguyên ngày cũ thì được", { timeout: CA }, async () => {
    const r = await tao("CI.KM.QD.LUI", "2099-01-01", "2099-06-30");
    const sua = (denNgay: string, now: string) =>
      suaChinhSach(GD, {
        id: r.id, maVanBan: "CI.KM.QD.LUI", ten: "CI lùi ngày", noiDungUuDai: "Ưu đãi của văn bản lùi ngày.", dieuKien: null,
        tuNgay: "2099-01-01", denNgay, coSo: [], khoaHoc: [], tep: null,
      }, new Date(now));
    // Hôm nay 10/03: đặt kết thúc 01/03 = dừng giữa chừng không lý do, không báo Sale.
    await expect(sua("2099-03-01", "2099-03-10T03:00:00Z")).rejects.toMatchObject({ ma: "DU_LIEU_SAI" });
    // Sửa chính tả sau khi văn bản đã hết hạn (ngày cũ giữ nguyên, đã qua) vẫn phải được.
    await expect(sua("2099-06-30", "2099-08-01T03:00:00Z")).resolves.toBeUndefined();
  });

  it("[KM-SV-07] tệp văn bản: URL do SERVER dựng từ khoá — URL client gửi (javascript:) bị bỏ", { timeout: CA }, async () => {
    const cu = { a: process.env.R2_ACCOUNT_ID, k: process.env.R2_ACCESS_KEY_ID, s: process.env.R2_SECRET_ACCESS_KEY, b: process.env.R2_BUCKET_NAME, u: process.env.R2_PUBLIC_URL };
    Object.assign(process.env, { R2_ACCOUNT_ID: "ci", R2_ACCESS_KEY_ID: "ci", R2_SECRET_ACCESS_KEY: "ci", R2_BUCKET_NAME: "ci", R2_PUBLIC_URL: "https://cdn.ci.test" });
    try {
      const { chinhSachSchema } = await import("../../lib/validators/khuyen-mai");
      // Đầu vào THÔ như form gửi lên (bản đã parse mang `dieuKien: null` và parse lại sẽ hỏng vì lý do KHÁC).
      const tho = {
        maVanBan: "CI.KM.QD.TEP", ten: "CI có tệp", noiDungUuDai: "Ưu đãi của văn bản có tệp.",
        tuNgay: "2099-01-01", denNgay: "2099-12-31",
        tep: { key: "uploads/documents/2099-01/sr-qd-tep-abc12345.pdf", ten: "SR.QD.TEP.pdf", url: "javascript:alert(1)" },
      };
      const r = await banHanhChinhSach(GD, chinhSachSchema.parse(tho), new Date("2099-01-01T01:00:00Z"));
      const dong = await db.promotionPolicy.findUniqueOrThrow({ where: { id: r.id } });
      expect(dong.fileUrl).toBe("https://cdn.ci.test/uploads/documents/2099-01/sr-qd-tep-abc12345.pdf");
      // Đối chứng dương: cùng đầu vào thô, chỉ đổi mã văn bản ⇒ HỢP LỆ.
      expect(chinhSachSchema.safeParse({ ...tho, maVanBan: "CI.KM.QD.TEP3" }).success).toBe(true);
      // Khoá ngoài thư mục tải lên ⇒ từ chối ngay ở khuôn.
      for (const key of ["javascript:alert(1)", "https://ke-xau.example/x.pdf", "uploads/videos/x.mp4", "../uploads/documents/x.pdf", "uploads/documents/../../x.pdf"]) {
        expect(chinhSachSchema.safeParse({ ...tho, maVanBan: "CI.KM.QD.TEP2", tep: { key, ten: "x" } }).success, key).toBe(false);
      }
    } finally {
      for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: cu.a, R2_ACCESS_KEY_ID: cu.k, R2_SECRET_ACCESS_KEY: cu.s, R2_BUCKET_NAME: cu.b, R2_PUBLIC_URL: cu.u })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
