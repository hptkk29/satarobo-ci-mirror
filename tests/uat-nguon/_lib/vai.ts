// tests/uat-nguon/_lib/vai.ts — danh sách vai UAT dùng được trên test.satarobo.vn.
//
// Nguồn sự thật: `prisma/seed-uat/00-tai-khoan.ts` (mảng DANH_SACH) — email `uat.<tên>@satarobo.vn`, mật khẩu chung = secret
// `UAT_PASSWORD` (không bao giờ nằm trong mã). Lưới `lib/uat/uat-nguon-harness.test.ts` [UNH-VAI] so bảng này với seed, nên thêm/bớt một
// tài khoản ở seed mà quên bảng này là đỏ.
//
// ⚠️ Bộ seed CHỈ có: một QLCS (CS1) · một Kế toán (Hội sở) · KHÔNG có Kế toán cơ sở, KHÔNG có QLCS CS2. Ca nào cần các vai ấy phải
// chờ lane dữ liệu thêm tài khoản — thêm MỘT dòng vào `VAI` dưới đây (kèm `coSo`) là dùng được ngay, không sửa chỗ nào khác.

export type CoSo = "HO" | "CS1" | "CS2";

export type VaiUat = {
  /** Phần trước `@` của email. */
  local: string;
  /** Tên vai nghiệp vụ, để in vào bằng chứng. */
  nhan: string;
  /** `RoleDef.code` (RBAC v2). `PARENT` không có dòng UserOrgRole. */
  roleCode: string;
  coSo: CoSo;
  /** Trang tiếp đất sau đăng nhập (host test ⇒ clean URL; GV/PH được proxy đưa sang site riêng). */
  trangSauDangNhap: RegExp;
};

const ADMIN_HOME = /\/(admin\/)?dashboard(\?|$|\/)/;

export const VAI = {
  admin: { local: "uat.admin", nhan: "Quản trị hệ thống", roleCode: "SUPER_ADMIN", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  giamdoc: { local: "uat.giamdoc", nhan: "Quản lý cơ sở CS1", roleCode: "CENTER_MANAGER", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  sale1: { local: "uat.sale1", nhan: "Tư vấn viên CS1", roleCode: "CENTER_SALES_CSM", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  sale2: { local: "uat.sale2", nhan: "Tư vấn viên CS2", roleCode: "CENTER_SALES_CSM", coSo: "CS2", trangSauDangNhap: ADMIN_HOME },
  saleho: { local: "uat.saleho", nhan: "Kinh doanh Hội sở", roleCode: "HO_SALE", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  giaovu: { local: "uat.giaovu", nhan: "Giáo vụ CS1", roleCode: "CENTER_CLASS_MANAGER", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  daotao: { local: "uat.daotao", nhan: "Đào tạo", roleCode: "TRAINING", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  ketoan: { local: "uat.ketoan", nhan: "Kế toán Hội sở", roleCode: "HO_ACCOUNTANT", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  nhansu: { local: "uat.nhansu", nhan: "Nhân sự Hội sở", roleCode: "HO_HR", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  marketing: { local: "uat.marketing", nhan: "Marketing Hội sở", roleCode: "HO_MARKETING", coSo: "HO", trangSauDangNhap: ADMIN_HOME },
  // Lane C2 «UAT SOURCE FINAL» — ba tài khoản TEST-only xử lý hàng chờ hoa hồng (N1 đề nghị · N2 duyệt · người chỉ xem). Neo CS1 ⇒ `commission_periods:manage` chỉ có hiệu lực ở CS1.
  nguonduyet1: { local: "uat.nguonduyet1", nhan: "Người duyệt hoa hồng N1 (CS1)", roleCode: "HO_ACCOUNTANT", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  nguonduyet2: { local: "uat.nguonduyet2", nhan: "Người duyệt hoa hồng N2 (CS1)", roleCode: "HO_ACCOUNTANT", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  nguonxem: { local: "uat.nguonxem", nhan: "Kế toán cơ sở chỉ xem hoa hồng (CS1)", roleCode: "CENTER_ACCOUNTANT", coSo: "CS1", trangSauDangNhap: ADMIN_HOME },
  giaovien: { local: "uat.giaovien", nhan: "Giáo viên CS1", roleCode: "TEACHER", coSo: "CS1", trangSauDangNhap: /\/teacher(\/|\?|$)/ },
  phuhuynh: { local: "uat.phuhuynh", nhan: "Phụ huynh", roleCode: "PARENT", coSo: "HO", trangSauDangNhap: /\/portal(\/|\?|$)/ },
} as const satisfies Record<string, VaiUat>;

export type KhoaVai = keyof typeof VAI;

export const emailCuaVai = (k: KhoaVai): string => `${VAI[k].local}@satarobo.vn`;
