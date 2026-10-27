// @vitest-environment node
/**
 * [DLM-DB-*] — Lối "chỉ đặt lại MẬT KHẨU tài khoản uat.*" (`prisma/seed-uat/chay-dat-lai-mat-khau.ts`) trên Postgres THẬT, đi qua ĐÚNG hàm mà nút
 * `noi_hoc_vien_lead = dat-lai-mat-khau-uat-ghi` chạy (`docDatLaiMatKhau` → `datLaiMatKhau`).
 *
 *   [DLM-DB-01] dry-run (đọc) KHÔNG ghi gì: ảnh chụp mọi dòng User + đếm các bảng khác y nguyên; liệt kê đúng tập "sẽ đặt lại"
 *   [DLM-DB-02] apply: mọi tài khoản uat.* còn đăng nhập được so khớp mật khẩu MỚI bằng CHÍNH bcrypt.compare mà `lib/auth.ts` dùng, mật khẩu CŨ không còn khớp; cờ buộc đổi mật khẩu về false
 *   [DLM-DB-03] tài khoản KHÔNG thuộc DANH_SACH (kể cả tên trông giống uat.*) nguyên vẹn từng cột
 *   [DLM-DB-04] tài khoản uat.* đã xoá mềm / isActive=false / DISABLED nguyên vẹn (không sống lại), và nằm trong `boQua`
 *   [DLM-DB-05] chỉ `password` + `mustChangePassword` (+ updatedAt) của tài khoản được đặt lại đổi; bảng khác (employee · userOrgRole · course · paymentMethod · auditLog) đếm không đổi
 *   [DLM-DB-06] chạy lần hai: không còn gì để đặt lại (mọi tài khoản còn đăng nhập được đã khớp), băm không bị ghi lại
 *
 * LUẬT 18: toàn bộ luồng ở `beforeAll`, ca chỉ đọc kết quả. Chạy: `pnpm test:hoa-hong-db` (DB trống đã `migrate deploy`).
 */
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { datLaiMatKhau, docDatLaiMatKhau, emailUatTatCa, seedTaiKhoan } from "../../prisma/seed-uat/00-tai-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { damBaoToChuc } from "../lead-intake/_nguon-fixture";

if (!RUN_DB_TESTS) console.warn(`[DLM-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const MK_CU = "mat-khau-cu-truoc-09-10";
const MK_MOI = "mat-khau-moi-tu-secret-uat";
const EM = (l: string) => `${l}@satarobo.vn`;
const EMAIL_LA = ["uat.khongcodanhsach@satarobo.vn", "nguoi.that@example.com"];
/** Ba tài khoản uat.* bị cố ý đặt vào trạng thái KHÔNG đăng nhập được. */
const XOA_MEM = EM("uat.nhansu");
const BI_KHOA = EM("uat.marketing");
const DISABLED = EM("uat.daotao");

type Anh = Awaited<ReturnType<typeof chup>>;
async function chup() {
  return db.user.findMany({ orderBy: { email: "asc" } });
}
async function demBang() {
  return {
    employee: await db.employee.count(),
    userOrgRole: await db.userOrgRole.count(),
    course: await db.course.count(),
    paymentMethod: await db.paymentMethod.count(),
    auditLog: await db.auditLog.count(),
    roleDef: await db.roleDef.count(),
  };
}
const theoEmail = (a: Anh, e: string) => a.find((u) => u.email === e)!;
const boCotDoi = ({ password: _p, mustChangePassword: _m, updatedAt: _u, ...con }: Anh[number]) => con;

let truoc: Anh;
let sauDry: Anh;
let sau: Anh;
let sauLan2: Anh;
let demTruoc: Awaited<ReturnType<typeof demBang>>;
let demSauDry: Awaited<ReturnType<typeof demBang>>;
let demSau: Awaited<ReturnType<typeof demBang>>;
let dry: Awaited<ReturnType<typeof docDatLaiMatKhau>>;
let nGhi = 0;
let lan2: Awaited<ReturnType<typeof docDatLaiMatKhau>>;
let tapUat: string[] = [];

async function don() {
  const ids = (await db.user.findMany({ where: { email: { in: [...EMAIL_LA, ...tapUat] } }, select: { id: true } })).map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { email: { in: EMAIL_LA } } });
  await db.user.updateMany({ where: { email: { in: tapUat } }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
}

describe.skipIf(!RUN_DB_TESTS)("[DLM-DB] đặt lại mật khẩu uat.* — chỉ password + mustChangePassword, chỉ DANH_SACH", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["SUPER_ADMIN", "CENTER_SALES_CSM", "HO_ACCOUNTANT", "CENTER_ACCOUNTANT", "CENTER_MANAGER", "HO_SALE", "HO_MARKETING", "TEACHER", "TRAINING", "HO_HR", "CENTER_CLASS_MANAGER"] });

    // Dựng đúng tình trạng DB test: tài khoản uat.* seed bằng mật khẩu CŨ.
    process.env.UAT_PASSWORD = MK_CU;
    await seedTaiKhoan("TAT_CA");
    tapUat = emailUatTatCa();
    // Hai người KHÔNG thuộc DANH_SACH: một tên trông giống uat.*, một người thật — cùng mật khẩu CŨ.
    const hashCu = await bcrypt.hash(MK_CU, 10);
    for (const email of EMAIL_LA) {
      await db.user.upsert({
        where: { email },
        update: { password: hashCu, mustChangePassword: true, deletedAt: null, isActive: true, accountStatus: "ACTIVE" },
        create: { email, name: "Người ngoài danh sách", password: hashCu, role: "SALES_CSM", roles: ["SALES_CSM"], isActive: true, mustChangePassword: true },
      });
    }
    // Ba tài khoản uat.* không đăng nhập được: đặt vào đúng trạng thái đó (mật khẩu CŨ giữ nguyên).
    await db.user.update({ where: { email: XOA_MEM }, data: { deletedAt: new Date("2026-02-01T00:00:00.000Z") } });
    await db.user.update({ where: { email: BI_KHOA }, data: { isActive: false } });
    await db.user.update({ where: { email: DISABLED }, data: { accountStatus: "DISABLED" } });
    // Một tài khoản đang bị bắt đổi mật khẩu: sau khi đặt lại phải về false.
    await db.user.update({ where: { email: EM("uat.admin") }, data: { mustChangePassword: true } });

    truoc = await chup();
    demTruoc = await demBang();

    // ── Lượt 1: dry-run = chỉ ĐỌC (đổi sang mật khẩu MỚI của secret, như workflow) ──
    process.env.UAT_PASSWORD = MK_MOI;
    dry = await docDatLaiMatKhau();
    sauDry = await chup();
    demSauDry = await demBang();

    // ── Lượt 2: ghi ──
    nGhi = await datLaiMatKhau(dry.datLai);
    sau = await chup();
    demSau = await demBang();

    // ── Lượt 3: chạy lại ──
    lan2 = await docDatLaiMatKhau();
    await datLaiMatKhau(lan2.datLai);
    sauLan2 = await chup();
  }, 180_000);

  afterAll(async () => {
    await don();
  }, 120_000);

  it("[DLM-DB-01] dry-run KHÔNG ghi gì (mọi cột mọi dòng User + đếm bảng khác y nguyên) và liệt kê đúng tập sẽ đặt lại", () => {
    expect(sauDry).toEqual(truoc);
    expect(demSauDry).toEqual(demTruoc);
    const eligible = truoc.filter((u) => u.email && tapUat.includes(u.email) && ![XOA_MEM, BI_KHOA, DISABLED].includes(u.email)).map((u) => u.email).sort();
    expect(eligible.length).toBeGreaterThanOrEqual(15);
    expect(dry.datLai.map((x) => x.email).sort()).toEqual(eligible);
    expect(dry.daKhop).toEqual([]);
  });

  it("[DLM-DB-02] sau khi ghi: mọi tài khoản đặt lại so khớp mật khẩu MỚI bằng bcrypt.compare (đúng phép của lib/auth.ts), mật khẩu CŨ không còn khớp, cờ buộc đổi mật khẩu = false", async () => {
    expect(nGhi).toBe(dry.datLai.length);
    for (const h of dry.datLai) {
      const u = theoEmail(sau, h.email!);
      expect(await bcrypt.compare(MK_MOI, u.password!), h.email!).toBe(true);
      expect(await bcrypt.compare(MK_CU, u.password!), h.email!).toBe(false);
      expect(u.mustChangePassword, h.email!).toBe(false);
    }
    expect(theoEmail(truoc, EM("uat.admin")).mustChangePassword).toBe(true);
  });

  it("[DLM-DB-03] tài khoản KHÔNG thuộc DANH_SACH (tên giống uat.* và người thật) nguyên vẹn từng cột, mật khẩu cũ vẫn khớp", async () => {
    for (const e of EMAIL_LA) {
      expect(theoEmail(sau, e), e).toEqual(theoEmail(truoc, e));
      expect(await bcrypt.compare(MK_CU, theoEmail(sau, e).password!), e).toBe(true);
      expect(dry.datLai.map((x) => x.email)).not.toContain(e);
    }
  });

  it("[DLM-DB-04] uat.* đã xoá mềm / bị khoá / DISABLED nguyên vẹn (không sống lại) và được liệt kê vào boQua đúng lý do", () => {
    for (const e of [XOA_MEM, BI_KHOA, DISABLED]) expect(theoEmail(sau, e), e).toEqual(theoEmail(truoc, e));
    expect(Object.fromEntries(dry.boQua.map((b) => [b.hang.email, b.lyDo]))).toEqual({ [XOA_MEM]: "DA_XOA_MEM", [BI_KHOA]: "BI_KHOA", [DISABLED]: "KHONG_ACTIVE" });
  });

  it("[DLM-DB-05] chỉ password + mustChangePassword + updatedAt của tài khoản được đặt lại đổi; bảng khác đếm không đổi", () => {
    for (const h of dry.datLai) expect(boCotDoi(theoEmail(sau, h.email!)), h.email!).toEqual(boCotDoi(theoEmail(truoc, h.email!)));
    expect(demSau).toEqual(demTruoc);
    expect(sau.length).toBe(truoc.length);
  });

  it("[DLM-DB-06] chạy lần hai: mọi tài khoản đăng nhập được đã khớp, không còn gì để đặt lại, băm KHÔNG bị ghi lại", () => {
    expect(lan2.datLai).toEqual([]);
    expect(lan2.daKhop.map((x) => x.email).sort()).toEqual(dry.datLai.map((x) => x.email).sort());
    for (const h of dry.datLai) expect(theoEmail(sauLan2, h.email!).password, h.email!).toBe(theoEmail(sau, h.email!).password);
  });
});
