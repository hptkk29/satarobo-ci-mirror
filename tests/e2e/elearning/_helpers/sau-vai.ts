/**
 * Sáu vai của bộ kiểm toán quyền / xuyên phiên (V9.4 P0 + P4): người học (Nhân viên), Đào tạo, Quản lý cơ sở (CS1 và CS2), Kế toán, Marketing, Quản trị tối cao.
 * Dựng bằng DB THẬT (cây đơn vị + vai + hồ sơ nhân sự), đăng nhập bằng form THẬT, trả về hũ cookie theo nhãn.
 */
import type { Browser, BrowserContext } from "@playwright/test";
import { db } from "../../../../lib/db";
import { assertTestDb, seedOrg, seedUser } from "../../_helpers/seed";
import { login } from "../../_helpers/auth";
import { dungVongHoc, type BoDuLieu } from "./seed-elearning";

export type Nhan = keyof typeof EMAIL;

export const EMAIL = {
  HOC_VIEN: "e2e-el-hocvien@satarobo.vn",
  DAO_TAO: "e2e-el-daotao@satarobo.vn",
  QLCS_CS1: "e2e-el-xp-qlcs1@satarobo.vn",
  QLCS_CS2: "e2e-el-xp-qlcs2@satarobo.vn",
  MARKETING: "e2e-el-xp-mkt@satarobo.vn",
  KE_TOAN: "e2e-el-xp-kt@satarobo.vn",
  QTTC: "e2e-el-xp-qttc@satarobo.vn",
} as const;

export const TEN: Record<Nhan, string> = {
  HOC_VIEN: "E2E Người học",
  DAO_TAO: "E2E Đào tạo",
  QLCS_CS1: "XP Quản lý CS1",
  QLCS_CS2: "XP Quản lý CS2",
  MARKETING: "XP Marketing",
  KE_TOAN: "XP Kế toán",
  QTTC: "XP Quản trị tối cao",
};

export const emailSangNhan = new Map<string, Nhan>((Object.entries(EMAIL) as [Nhan, string][]).map(([n, e]) => [e, n]));
export const tenTheoNhan = new Map<Nhan, string>(Object.entries(TEN) as [Nhan, string][]);
export const MOI_NHAN = Object.keys(EMAIL) as Nhan[];

type VaiHeThong = "CENTER_MANAGER" | "MARKETING" | "ACCOUNTANT" | "SUPER_ADMIN";

async function dungNguoiPhu(nhan: Nhan, role: VaiHeThong, vai: string, donVi: string) {
  const u = await seedUser({ email: EMAIL[nhan], name: TEN[nhan], role });
  const ou = await db.orgUnit.findUniqueOrThrow({ where: { code: donVi }, select: { id: true, centerId: true } });
  const ma = `E2E_EL_XP_${nhan}`;
  const nv = await db.employee.upsert({
    where: { employeeCode: ma },
    update: { isActive: true, status: "ACTIVE", centerId: ou.centerId, orgUnitId: ou.id, fullName: TEN[nhan] },
    create: { employeeCode: ma, fullName: TEN[nhan], jobTitle: "Nhân viên", department: "DAO_TAO", isActive: true, status: "ACTIVE", centerId: ou.centerId, orgUnitId: ou.id },
    select: { id: true },
  });
  await db.user.update({ where: { id: u.id }, data: { employeeId: nv.id, centerId: ou.centerId } });
  const rd = await db.roleDef.findUnique({ where: { code: vai }, select: { id: true } });
  if (!rd) throw new Error(`thiếu RoleDef ${vai}`);
  await db.userOrgRole.upsert({
    where: { userId_orgUnitId_roleId: { userId: u.id, orgUnitId: ou.id, roleId: rd.id } },
    update: { status: "ACTIVE" },
    create: { userId: u.id, orgUnitId: ou.id, roleId: rd.id, status: "ACTIVE", grantedById: u.id },
  });
}

export type BoSauVai = { d: BoDuLieu; hu: Map<Nhan, Awaited<ReturnType<BrowserContext["cookies"]>>> };

/** Dựng vòng học (người học + Đào tạo ở CS1) rồi bốn vai phụ; đăng nhập từng người một lần và giữ hũ cookie. */
export async function dungSauVai(browser: Browser): Promise<BoSauVai> {
  assertTestDb();
  const d = await dungVongHoc();
  await seedOrg(["HO", "CS1", "CS2"]);
  await dungNguoiPhu("QLCS_CS1", "CENTER_MANAGER", "CENTER_MANAGER", "CS1");
  await dungNguoiPhu("QLCS_CS2", "CENTER_MANAGER", "CENTER_MANAGER", "CS2");
  await dungNguoiPhu("MARKETING", "MARKETING", "HO_MARKETING", "HO");
  await dungNguoiPhu("KE_TOAN", "ACCOUNTANT", "HO_ACCOUNTANT", "HO");
  await dungNguoiPhu("QTTC", "SUPER_ADMIN", "SUPER_ADMIN", "HO");
  const hu: BoSauVai["hu"] = new Map();
  for (const nhan of MOI_NHAN) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email: EMAIL[nhan], callbackUrl: "/elearning" });
    hu.set(nhan, await ctx.cookies());
    await ctx.close();
  }
  return { d, hu };
}
