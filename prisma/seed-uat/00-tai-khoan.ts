// prisma/seed-uat/00-tai-khoan.ts — 12 tài khoản `uat.*` + hồ sơ nhân sự + vai trò.
//
// VÌ SAO BƯỚC NÀY TỒN TẠI. Ban đầu 12 tài khoản được tạo tay trên giao diện, và
// `layUat()` chỉ việc đọc lên. Nhưng DB dev (= DB của môi trường `test`) đã bị xoá
// sạch BA LẦN trong hai ngày 22–23/08/2026, và mỗi lần xoá là mất luôn tài khoản ⇒
// bộ seed 12k dòng không chạy nổi vì thiếu người phụ trách. Tạo lại bằng tay 12 lần
// là việc của máy, không phải của người.
//
// HAI TẦNG VAI TRÒ, PHẢI GHI CẢ HAI
//  · `User.role` / `User.roles[]` — enum `Role` 9 giá trị, là thứ RBAC **v1** đọc.
//    Local/dev chạy v1 (cờ mặc định OFF trong `lib/flags.ts`).
//  · `UserOrgRole(user × OrgUnit × RoleDef)` — là thứ RBAC **v2** đọc, và `test`
//    lẫn `prod` đều đang bật v2. Đây mới là nguồn quyền thật khi nghiệm thu.
//  Hai vai người dùng yêu cầu — HO_SALE và CENTER_CLASS_MANAGER — KHÔNG có mã
//  legacy tương ứng (`lib/auth/legacy-role-map.ts` cố ý xếp chúng vào nhóm "gán
//  tay"). Với hai vai đó, enum v1 chỉ là chỗ dựa gần đúng để tài khoản vào được
//  /admin; quyền thật đến từ `UserOrgRole`.
//
// HỘI SỞ KHÔNG MANG `centerId`. Bản ghi `Center("hoi-so")` là dòng MỒ CÔI đã biết
// (không OrgUnit nào trỏ tới — luật V7 cấm đơn vị HO mang centerId). Gán nó cho
// nhân sự Hội sở từng làm người HO bị neo vai TẠI HO ⇒ `isHoLevel` ⇒ thấy mọi cơ
// sở qua đường không mong muốn. Ở đây nhân sự HO để `centerId = null` và nhận
// quyền cross-center đúng đường: một dòng `UserOrgRole` neo ở OrgUnit `HO`.
//
// PHỤ HUYNH KHÔNG CÓ `UserOrgRole` — cố ý. PARENT là "vai quan hệ"
// (`RELATIONSHIP_ROLE_CODES` trong `lib/auth/actor.ts`): quyền nạp thẳng từ
// `RoleDef` theo `User.role`, và phụ huynh không đứng ở đâu trong cây OrgUnit.
import bcrypt from "bcryptjs";
import { db, buoc, xong } from "./_common";
import type { Department, Role } from "@prisma/client";

/**
 * Mật khẩu chung của tài khoản UAT — BẮT BUỘC đặt bằng env `UAT_PASSWORD` (≥ 8 ký tự).
 *
 * 09/10/2026: bỏ giá trị mặc định cố định. Chuỗi gõ sẵn trong mã nguồn là mật khẩu ai đọc
 * được mã cũng biết — và mã sắp được xuất sang một repo gương PUBLIC cho CI, nên một tài
 * khoản UAT trên test.satarobo.vn dùng chuỗi đó là cửa đăng nhập mở cho người lạ.
 * Thiếu env ⇒ NÉM, không rơi về chuỗi nào. Đọc lười (trong hàm) để chỉ import file thì không ném.
 */
function matKhauUat(): string {
  const v = process.env.UAT_PASSWORD;
  if (!v || v.length < 8) {
    throw new Error(
      "[seed UAT] Thiếu UAT_PASSWORD (≥ 8 ký tự). Không còn mật khẩu mặc định — đặt env " +
        "UAT_PASSWORD trước khi seed (workflow: secret UAT_PASSWORD).",
    );
  }
  return v;
}

type Neo = "HO" | "CS1" | "CS2";

type TaiKhoan = {
  local: string;
  ten: string;
  /** enum v1 — chỗ dựa để vào được /admin và để môi trường chạy v1 không rỗng quyền. */
  legacy: Role;
  /** RoleDef.code — nguồn quyền thật trên test/prod (v2). null = vai quan hệ (PARENT). */
  roleCode: string | null;
  neo: Neo;
  maNhanSu: string | null;
  chucDanh: string;
  phongBan: Department | null;
};

const DANH_SACH: TaiKhoan[] = [
  { local: "uat.admin", ten: "UAT — Quản trị hệ thống", legacy: "SUPER_ADMIN", roleCode: "SUPER_ADMIN", neo: "HO", maNhanSu: "HO.IT.002", chucDanh: "Quản trị hệ thống", phongBan: "IT" },
  { local: "uat.giamdoc", ten: "UAT — Giám đốc cơ sở 1", legacy: "CENTER_MANAGER", roleCode: "CENTER_MANAGER", neo: "CS1", maNhanSu: "CS1.QL.001", chucDanh: "Giám đốc cơ sở", phongBan: "BAN_GIAM_DOC" },
  { local: "uat.sale1", ten: "UAT — Tư vấn viên CS1", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS1", maNhanSu: "CS1.TVV.001", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  { local: "uat.sale2", ten: "UAT — Tư vấn viên CS2", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS2", maNhanSu: "CS2.TVV.001", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  // 30/08/2026 — thêm 4 tư vấn viên để màn "Quản lý chia lead" có POOL THẬT mà nghiệm
  // thu. Một cơ sở một người thì không nhìn ra được thứ cần nhìn: chia có đều không,
  // tắt một người thì lượt chạy đi đâu, bật lại có bị dồn không.
  // Dồn 3 người vào CS1 (pool 4) và 1 người vào CS2 (pool 2) — cố ý lệch để so hai bên.
  { local: "uat.sale3", ten: "UAT — Tư vấn viên CS1 (2)", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS1", maNhanSu: "CS1.TVV.002", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  { local: "uat.sale4", ten: "UAT — Tư vấn viên CS1 (3)", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS1", maNhanSu: "CS1.TVV.003", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  { local: "uat.sale5", ten: "UAT — Tư vấn viên CS1 (4)", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS1", maNhanSu: "CS1.TVV.004", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  { local: "uat.sale6", ten: "UAT — Tư vấn viên CS2 (2)", legacy: "SALES_CSM", roleCode: "CENTER_SALES_CSM", neo: "CS2", maNhanSu: "CS2.TVV.002", chucDanh: "Tư vấn tuyển sinh", phongBan: "TUYEN_SINH" },
  // HO_SALE: xem lead phạm vi toàn hệ thống, KHÔNG sửa. Không có mã legacy.
  { local: "uat.saleho", ten: "UAT — Kinh doanh Hội sở", legacy: "SALES_CSM", roleCode: "HO_SALE", neo: "HO", maNhanSu: "HO.KD.001", chucDanh: "Chuyên viên kinh doanh", phongBan: "KINH_DOANH" },
  // CENTER_CLASS_MANAGER (giáo vụ): cũng không có mã legacy — mượn CENTER_MANAGER
  // để vào được /admin, quyền thật lấy từ UserOrgRole.
  { local: "uat.giaovu", ten: "UAT — Giáo vụ CS1", legacy: "CENTER_MANAGER", roleCode: "CENTER_CLASS_MANAGER", neo: "CS1", maNhanSu: "CS1.GVU.001", chucDanh: "Giáo vụ", phongBan: "GIAO_VU" },
  { local: "uat.giaovien", ten: "UAT — Giáo viên CS1", legacy: "TEACHER", roleCode: "TEACHER", neo: "CS1", maNhanSu: "CS1.GV.001", chucDanh: "Giáo viên Robotics", phongBan: "GIANG_DAY" },
  { local: "uat.daotao", ten: "UAT — Đào tạo", legacy: "TRAINING", roleCode: "TRAINING", neo: "HO", maNhanSu: "HO.DT.001", chucDanh: "Chuyên viên đào tạo", phongBan: "DAO_TAO" },
  { local: "uat.ketoan", ten: "UAT — Kế toán Hội sở", legacy: "ACCOUNTANT", roleCode: "HO_ACCOUNTANT", neo: "HO", maNhanSu: "HO.KT.001", chucDanh: "Kế toán", phongBan: "KE_TOAN" },
  { local: "uat.nhansu", ten: "UAT — Nhân sự Hội sở", legacy: "HR", roleCode: "HO_HR", neo: "HO", maNhanSu: "HO.NS.001", chucDanh: "Chuyên viên nhân sự", phongBan: "HANH_CHANH_NHAN_SU" },
  { local: "uat.marketing", ten: "UAT — Marketing Hội sở", legacy: "MARKETING", roleCode: "HO_MARKETING", neo: "HO", maNhanSu: "HO.MKT.001", chucDanh: "Chuyên viên marketing", phongBan: "MARKETING" },
  { local: "uat.phuhuynh", ten: "UAT — Phụ huynh", legacy: "PARENT", roleCode: null, neo: "HO", maNhanSu: null, chucDanh: "", phongBan: null },
];

export async function seedTaiKhoan() {
  buoc("Tài khoản UAT");

  const [centers, orgs, roles] = await Promise.all([
    db.center.findMany({ select: { id: true, code: true } }),
    db.orgUnit.findMany({ select: { id: true, code: true } }),
    db.roleDef.findMany({ select: { id: true, code: true } }),
  ]);
  const centerBy = new Map(centers.map((c) => [c.code ?? "", c.id]));
  const orgBy = new Map(orgs.map((o) => [o.code, o.id]));
  const roleBy = new Map(roles.map((r) => [r.code, r.id]));

  const hoOrgId = orgBy.get("HO");
  if (!hoOrgId) throw new Error("Chưa có OrgUnit HO — chạy `pnpm db:seed:orgunit` trước.");

  const hash = await bcrypt.hash(matKhauUat(), 10);
  let nUser = 0;
  let nEmp = 0;
  let nUor = 0;

  for (const tk of DANH_SACH) {
    const email = `${tk.local}@satarobo.vn`;
    // Nhân sự Hội sở KHÔNG mang centerId (xem đầu file).
    const centerId = tk.neo === "HO" ? null : (centerBy.get(tk.neo) ?? null);
    const orgUnitId = orgBy.get(tk.neo) ?? hoOrgId;

    let employeeId: string | null = null;
    if (tk.maNhanSu && tk.phongBan) {
      const emp = await db.employee.upsert({
        where: { employeeCode: tk.maNhanSu },
        update: { fullName: tk.ten, jobTitle: tk.chucDanh, centerId, isActive: true, status: "ACTIVE" },
        create: {
          employeeCode: tk.maNhanSu,
          fullName: tk.ten,
          jobTitle: tk.chucDanh,
          department: tk.phongBan,
          email,
          centerId,
          isActive: true,
          status: "ACTIVE",
          joinedAt: new Date("2026-01-06T00:00:00.000Z"),
        },
        select: { id: true },
      });
      employeeId = emp.id;
      nEmp++;
    }

    const user = await db.user.upsert({
      where: { email },
      update: {
        name: tk.ten,
        role: tk.legacy,
        roles: [tk.legacy],
        centerId,
        orgUnitId,
        employeeId,
        isActive: true,
        deletedAt: null,
        // Mật khẩu ghi đè mỗi lần chạy: DB bị xoá rồi dựng lại thì người nghiệm
        // thu vẫn đăng nhập được bằng đúng một mật khẩu, không phải đi hỏi.
        password: hash,
        mustChangePassword: false,
        accountStatus: "ACTIVE",
      },
      create: {
        email,
        name: tk.ten,
        password: hash,
        role: tk.legacy,
        roles: [tk.legacy],
        centerId,
        orgUnitId,
        employeeId,
        isActive: true,
      },
      select: { id: true },
    });
    nUser++;

    if (tk.roleCode) {
      const roleId = roleBy.get(tk.roleCode);
      if (!roleId) {
        throw new Error(`Thiếu RoleDef "${tk.roleCode}" — chạy \`pnpm db:seed:roles\` trước.`);
      }
      await db.userOrgRole.upsert({
        where: { userId_orgUnitId_roleId: { userId: user.id, orgUnitId, roleId } },
        update: { status: "ACTIVE", effectiveTo: null },
        create: { userId: user.id, orgUnitId, roleId, status: "ACTIVE", grantedById: user.id },
      });
      nUor++;
    }
  }

  xong("Tài khoản UAT", { tài_khoản: nUser, hồ_sơ_nhân_sự: nEmp, vai_trò_v2: nUor });
  console.log(`     · Mật khẩu chung: giá trị env UAT_PASSWORD (không in ra log)`);
}
