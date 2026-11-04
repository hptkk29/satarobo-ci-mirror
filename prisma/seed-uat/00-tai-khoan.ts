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

/** Băm mật khẩu UAT — MỘT chỗ (cost 10) cho cả `seedTaiKhoan` lẫn lối đặt lại mật khẩu; đừng chép `bcrypt.hash` ra chỗ khác. */
async function bamMatKhauUat(): Promise<string> {
  return bcrypt.hash(matKhauUat(), 10);
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
  // Lane C2 «UAT SOURCE FINAL» (TEST-only, như mọi tài khoản trong tệp này): hai người XỬ LÝ hàng chờ hoa hồng (N1 · N2 — bốn mắt) và một người chỉ XEM. KHÔNG đẻ khoá quyền mới:
  // `commission_periods:manage` có sẵn ở HO_ACCOUNTANT (seed-roles) — neo vai TẠI CS1 (không phải HO) ⇒ `centerScope = [CS1]`, nên quyền chỉ có hiệu lực ở cơ sở của hàng chờ (CS1), không thành cross-center.
  // Tài khoản chỉ-xem là CENTER_ACCOUNTANT (cố ý KHÔNG có `commission_periods:manage`). Tên `uat.nguonduyet1` không có dấu chấm thứ hai: regex của `[UAT-DOC-04]` chỉ nhận `uat.[a-z0-9]+`.
  { local: "uat.nguonduyet1", ten: "UAT SOURCE FINAL — Người duyệt N1", legacy: "ACCOUNTANT", roleCode: "HO_ACCOUNTANT", neo: "CS1", maNhanSu: "CS1.KT.N1", chucDanh: "Kế toán đối soát hoa hồng", phongBan: "KE_TOAN" },
  { local: "uat.nguonduyet2", ten: "UAT SOURCE FINAL — Người duyệt N2", legacy: "ACCOUNTANT", roleCode: "HO_ACCOUNTANT", neo: "CS1", maNhanSu: "CS1.KT.N2", chucDanh: "Kế toán đối soát hoa hồng", phongBan: "KE_TOAN" },
  { local: "uat.nguonxem", ten: "UAT SOURCE FINAL — Chỉ xem", legacy: "ACCOUNTANT", roleCode: "CENTER_ACCOUNTANT", neo: "CS1", maNhanSu: "CS1.KT.XEM", chucDanh: "Kế toán cơ sở (chỉ xem)", phongBan: "KE_TOAN" },
  { local: "uat.phuhuynh", ten: "UAT — Phụ huynh", legacy: "PARENT", roleCode: null, neo: "HO", maNhanSu: null, chucDanh: "", phongBan: null },
];

/**
 * TAT_CA: toàn bộ danh sách, GHI ĐÈ mật khẩu + hồ sơ của tài khoản đã có (đường `db:seed:uat`).
 * CHI_TAO_THIEU: CHỈ tài khoản chưa có dòng `User` (kể cả đã xoá mềm — không "sống lại") — không chạm một tài khoản nào đang có
 * (12/10/2026: DB test thiếu uat.sale3/uat.sale5 mà bộ nạp hoa hồng cần; chạy `db:seed:uat` đầy đủ sẽ đặt lại mật khẩu 12 tài khoản + giá khoá học).
 */
export type CheDoTaiKhoan = "TAT_CA" | "CHI_TAO_THIEU";

const emailCua = (tk: { local: string }) => `${tk.local}@satarobo.vn`;

/** Thuần (test không cần DB): tài khoản nào được xử lý ở chế độ này. */
export function chonTaiKhoan<T extends { local: string }>(ds: readonly T[], emailDaCo: ReadonlySet<string>, che: CheDoTaiKhoan): T[] {
  return che === "TAT_CA" ? [...ds] : ds.filter((tk) => !emailDaCo.has(emailCua(tk)));
}

/** Email của MỌI tài khoản trong DANH_SACH (test dùng để biết tập `uat.*` thật, không đoán theo tiền tố). */
export const emailUatTatCa = (): string[] => DANH_SACH.map(emailCua);

async function docEmailDaCo(): Promise<Set<string>> {
  const u = await db.user.findMany({ where: { email: { in: DANH_SACH.map(emailCua) } }, select: { email: true } });
  return new Set(u.flatMap((x) => (x.email ? [x.email] : [])));
}

/** Chỉ đọc: email các tài khoản UAT còn thiếu. */
export async function docTaiKhoanThieu(): Promise<string[]> {
  return chonTaiKhoan(DANH_SACH, await docEmailDaCo(), "CHI_TAO_THIEU").map(emailCua);
}

export async function seedTaiKhoan(che: CheDoTaiKhoan) {
  buoc("Tài khoản UAT");
  const dsXuLy = chonTaiKhoan(DANH_SACH, che === "CHI_TAO_THIEU" ? await docEmailDaCo() : new Set<string>(), che);
  if (dsXuLy.length === 0) {
    xong("Tài khoản UAT", { tài_khoản: 0, hồ_sơ_nhân_sự: 0, vai_trò_v2: 0 });
    return;
  }

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

  const hash = await bamMatKhauUat();
  let nUser = 0;
  let nEmp = 0;
  let nUor = 0;

  for (const tk of dsXuLy) {
    const email = emailCua(tk);
    // Nhân sự Hội sở KHÔNG mang centerId (xem đầu file).
    const centerId = tk.neo === "HO" ? null : (centerBy.get(tk.neo) ?? null);
    const orgUnitId = orgBy.get(tk.neo) ?? hoOrgId;

    let employeeId: string | null = null;
    if (tk.maNhanSu && tk.phongBan) {
      const emp = await db.employee.upsert({
        where: { employeeCode: tk.maNhanSu },
        // CHI_TAO_THIEU: hồ sơ nhân sự cùng mã đã có (của ai khác) thì GIỮ NGUYÊN — chế độ này không sửa dữ liệu đang có.
        update: che === "CHI_TAO_THIEU" ? {} : { fullName: tk.ten, jobTitle: tk.chucDanh, centerId, isActive: true, status: "ACTIVE" },
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

// ─── Đặt lại MẬT KHẨU tài khoản `uat.*` (20/10/2026) — chỉ TEST, chỉ một việc ─────────────────────────────────────────
// DB test seed các tài khoản này TRƯỚC 09/10/2026, khi mật khẩu còn là chuỗi mặc định trong mã; secret `UAT_PASSWORD` hiện tại khác ⇒ đăng nhập báo lỗi. `chay-tai-khoan-thieu`
// không giúp được (0 tài khoản thiếu) và `db:seed:uat` đầy đủ còn ghi đè giá khoá học / tài khoản ngân hàng / giáo trình. Lối này chỉ đổi `User.password` + `mustChangePassword`.
// KHÔNG "sống lại" tài khoản đã xoá mềm / bị khoá / DISABLED: đăng nhập không được là quyết định của người, không phải của lối này — liệt kê vào `boQua` kèm lý do.

export type HangMatKhau = { id: string; email: string | null; password: string | null; deletedAt: Date | null; isActive: boolean; accountStatus: string };
export type LyDoBoQua = "DA_XOA_MEM" | "BI_KHOA" | "KHONG_ACTIVE";
export type PhanLoaiDatLai<T extends HangMatKhau> = { datLai: T[]; daKhop: T[]; boQua: { hang: T; lyDo: LyDoBoQua }[] };

/**
 * Thuần (test không cần DB): chia các dòng User có email `uat.*` thành "sẽ đặt lại" / "đã khớp mật khẩu" / "bỏ qua".
 * `emailKhop` = email mà mật khẩu hiện tại ĐÃ so khớp UAT_PASSWORD (tính ở chỗ gọi vì bcrypt chậm và bất đồng bộ).
 * Chỉ nhận email thuộc DANH_SACH — dòng khác bị loại trước mọi thứ, không vào bất kỳ nhóm nào.
 */
export function phanLoaiDatLai<T extends HangMatKhau>(hang: readonly T[], emailKhop: ReadonlySet<string>): PhanLoaiDatLai<T> {
  const uat = new Set(DANH_SACH.map(emailCua));
  const r: PhanLoaiDatLai<T> = { datLai: [], daKhop: [], boQua: [] };
  for (const h of hang) {
    if (!h.email || !uat.has(h.email)) continue;
    if (h.deletedAt) r.boQua.push({ hang: h, lyDo: "DA_XOA_MEM" });
    else if (!h.isActive) r.boQua.push({ hang: h, lyDo: "BI_KHOA" });
    else if (h.accountStatus !== "ACTIVE") r.boQua.push({ hang: h, lyDo: "KHONG_ACTIVE" });
    else if (h.password && emailKhop.has(h.email)) r.daKhop.push(h);
    else r.datLai.push(h);
  }
  return r;
}

/** Đọc + phân loại. Chỉ ĐỌC. Cần UAT_PASSWORD để biết ai đã khớp; thiếu ⇒ NÉM (cùng luật với `seedTaiKhoan`). */
export async function docDatLaiMatKhau(): Promise<PhanLoaiDatLai<HangMatKhau>> {
  const mk = matKhauUat();
  const hang = await db.user.findMany({
    where: { email: { in: DANH_SACH.map(emailCua) } },
    select: { id: true, email: true, password: true, deletedAt: true, isActive: true, accountStatus: true },
  });
  const khop = new Set<string>();
  for (const h of hang) if (h.email && h.password && (await bcrypt.compare(mk, h.password))) khop.add(h.email);
  return phanLoaiDatLai(hang, khop);
}

/**
 * GHI: đặt `password` = băm(UAT_PASSWORD) và `mustChangePassword = false` cho nhóm `datLai`, MỘT giao dịch. Không cột nào khác, không bảng nào khác;
 * `where` lặp lại cả điều kiện "còn đăng nhập được" để một dòng bị xoá mềm/khoá giữa lúc đọc và lúc ghi vẫn không bị đụng. Trả số dòng đã ghi.
 */
export async function datLaiMatKhau(ds: readonly { id: string }[]): Promise<number> {
  if (ds.length === 0) return 0;
  const hash = await bamMatKhauUat();
  const emails = DANH_SACH.map(emailCua);
  return db.$transaction(async (tx) => {
    let n = 0;
    for (const h of ds) {
      const r = await tx.user.updateMany({
        where: { id: h.id, email: { in: emails }, deletedAt: null, isActive: true, accountStatus: "ACTIVE" },
        data: { password: hash, mustChangePassword: false },
      });
      n += r.count;
    }
    return n;
  });
}
