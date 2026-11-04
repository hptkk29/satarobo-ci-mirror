// lib/hr/xuat-nhan-su.ts — CỘT của file xuất hồ sơ nhân sự. THUẦN: không DB, không React.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA HÀM THUẦN
//
// Đây là dữ liệu có LƯƠNG và GIẤY TỜ. Một cột lọt ra ngoài quyền là rò thật, và nó rò vào
// một TỆP — thứ rời khỏi hệ thống, chuyển tiếp được, không thu hồi được. Viết inline trong
// route thì không có chỗ cấy lỗi để chứng minh cổng còn sống.
//
// Nhóm quyền lấy y nguyên `getEmployeeFieldVisibility` (`lib/auth/permissions.ts`):
//   basic    — ai xem được màn nhân sự đều thấy
//   contact  — SUPER_ADMIN · CENTER_MANAGER · HR
//   salary   — SUPER_ADMIN · HR · ACCOUNTANT
//   personal — SUPER_ADMIN · HR
//
// ⚠️ KHÔNG chép lại danh sách vai ở đây. Một bản sao thứ hai là một bản sẽ trôi.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI QUYẾT ĐỊNH CÓ CHỦ ĐÍCH, ĐỌC TRƯỚC KHI SỬA
//
// 1. **`nationalId` (CCCD) KHÔNG bao giờ xuất**, kể cả khi người xuất có quyền `personal`.
//    Màn hình và tệp khác nhau ở chỗ tệp rời khỏi hệ thống được. CCCD là trường tệ nhất để
//    rò, và HR cần thì mở hồ sơ trên màn — không cần nó nằm trong một bảng tính đi qua Zalo.
//    Muốn đảo quyết định này thì đảo có chủ đích, đừng thêm cột vì "cho đủ".
//
// 2. **`contact` luôn BẬT trong bản xuất.** Nghe như nới quyền, nhưng không: màn danh sách
//    vốn đã in hai cột Email/SĐT cho mọi người có `employees:view-all`
//    (`nhan-su/page.tsx` — khối `listVisibility` đặt `contact: true`, ghi chú SEC-H04).
//    Giấu ở tệp trong khi màn vẫn hiện thì không bảo vệ được gì, chỉ làm người dùng ngạc
//    nhiên. Tệp KHỚP màn là luật dễ kiểm nhất.
//    ⚠️ Ngày nào màn thôi hiện hai cột đó thì SỬA CẢ HAI nơi cùng lúc.
import type { EmployeeFieldVisibility } from "@/lib/auth/permissions";

/** Một dòng nhân sự đã nạp, sau khi `redactEmployeeFields` đã chạy. */
export type DongNhanSu = {
  employeeCode: string | null;
  fullName: string;
  jobTitle: string | null;
  department: string | null;
  centerName: string | null;
  status: string | null;
  joinedAt: Date | null;
  managerName: string | null;
  vaiTro: string | null;
  isActive: boolean;
  // contact
  email: string | null;
  phone: string | null;
  // salary
  salaryRank: number | null;
  salaryLevel: number | null;
  bhxhBase: number | null;
  // personal
  dateOfBirth: Date | null;
  gender: string | null;
  contractType: string | null;
  endDate: Date | null;
  address: string | null;
  emergencyContact: string | null;
  notes: string | null;
};

export type CotNhanSu = {
  nhan: string;
  lay: (r: DongNhanSu) => string | number | null;
  rong?: number;
  chuoi?: boolean;
  /** Nhóm quyền — `undefined` nghĩa là ai xem được màn cũng thấy. */
  nhom?: "contact" | "salary" | "personal";
};

const NHAN_BO_PHAN: Record<string, string> = {
  BAN_GIAM_DOC: "Ban Giám Đốc",
  DAO_TAO: "Đào Tạo",
  MARKETING: "Marketing",
  KINH_DOANH: "Kinh Doanh",
  IT: "IT",
  HANH_CHANH_NHAN_SU: "Hành Chính Nhân Sự",
  KE_TOAN: "Kế Toán",
  TUYEN_SINH: "Tuyển Sinh",
  GIAO_VU: "Giáo Vụ",
  GIANG_DAY: "Giảng Dạy",
};

const NHAN_TRANG_THAI: Record<string, string> = {
  ACTIVE: "Đang làm",
  ON_LEAVE: "Tạm nghỉ",
  RESIGNED: "Đã nghỉ",
  TERMINATED: "Cho nghỉ",
};

const NHAN_GIOI: Record<string, string> = { MALE: "Nam", FEMALE: "Nữ", OTHER: "Khác" };

export const nhanBoPhan = (d: string | null) =>
  d ? (NHAN_BO_PHAN[d] ?? d.replace(/_/g, " ")) : "";
export const nhanTrangThai = (s: string | null) => (s ? (NHAN_TRANG_THAI[s] ?? s) : "");

/**
 * Ngày dạng `dd/mm/yyyy` giờ VN.
 *
 * ⚠️ Loại mốc Unix 1970: `joinedAt` NULL từng bị ghi thành `0` — **13 hồ sơ trên prod đo
 * 08/09/2026**. Không có cổng này thì file xuất in "01/01/1970" và trông như dữ liệu thật.
 */
export function ngayVn(d: Date | null | undefined): string {
  if (!d) return "";
  if (d.getUTCFullYear() <= 1971) return "";
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return `${String(vn.getUTCDate()).padStart(2, "0")}/${String(vn.getUTCMonth() + 1).padStart(2, "0")}/${vn.getUTCFullYear()}`;
}

/** Mọi cột có thể có, kèm nhóm quyền. Thứ tự ở đây = thứ tự cột trong tệp. */
const MOI_COT: CotNhanSu[] = [
  // `chuoi` bắt buộc: mã NV dạng "0123" bị Excel nuốt số 0 đầu, mà đó đúng là cột dùng để
  // đối chiếu với file Sheet/MISA.
  { nhan: "Mã NV", lay: (r) => r.employeeCode ?? "", rong: 12, chuoi: true },
  { nhan: "Họ tên", lay: (r) => r.fullName, rong: 28 },
  { nhan: "Chức danh", lay: (r) => r.jobTitle ?? "", rong: 22 },
  { nhan: "Bộ phận", lay: (r) => nhanBoPhan(r.department), rong: 20 },
  { nhan: "Cơ sở", lay: (r) => r.centerName ?? "", rong: 26 },
  { nhan: "Trạng thái", lay: (r) => nhanTrangThai(r.status), rong: 12 },
  { nhan: "Ngày vào làm", lay: (r) => ngayVn(r.joinedAt), rong: 13 },
  { nhan: "Quản lý trực tiếp", lay: (r) => r.managerName ?? "", rong: 24 },
  { nhan: "Vai trò hệ thống", lay: (r) => r.vaiTro ?? "", rong: 26 },

  { nhan: "Email", lay: (r) => r.email ?? "", rong: 26, nhom: "contact" },
  // SĐT lưu 2 dạng (`0…` cũ / `84…` mới) — ép Text để không mất số 0 đầu của dạng cũ.
  { nhan: "Số điện thoại", lay: (r) => r.phone ?? "", rong: 14, chuoi: true, nhom: "contact" },

  { nhan: "Ngạch lương", lay: (r) => r.salaryRank, rong: 12, nhom: "salary" },
  { nhan: "Bậc lương", lay: (r) => r.salaryLevel, rong: 11, nhom: "salary" },
  { nhan: "Mức đóng BHXH", lay: (r) => r.bhxhBase, rong: 15, nhom: "salary" },

  { nhan: "Ngày sinh", lay: (r) => ngayVn(r.dateOfBirth), rong: 12, nhom: "personal" },
  { nhan: "Giới tính", lay: (r) => (r.gender ? (NHAN_GIOI[r.gender] ?? r.gender) : ""), rong: 10, nhom: "personal" },
  { nhan: "Loại hợp đồng", lay: (r) => r.contractType ?? "", rong: 16, nhom: "personal" },
  { nhan: "Ngày nghỉ việc", lay: (r) => ngayVn(r.endDate), rong: 13, nhom: "personal" },
  { nhan: "Địa chỉ", lay: (r) => r.address ?? "", rong: 30, nhom: "personal" },
  { nhan: "Liên hệ khẩn cấp", lay: (r) => r.emergencyContact ?? "", rong: 24, nhom: "personal" },
  { nhan: "Ghi chú", lay: (r) => r.notes ?? "", rong: 30, nhom: "personal" },
];

/**
 * Cột được xuất cho MỘT người xem cụ thể.
 *
 * Cột ngoài quyền bị **BỎ HẲN**, không phải để trống: một cột "Mức đóng BHXH" toàn ô rỗng
 * vẫn nói cho người nhận biết hệ thống có trường đó và họ đang bị giấu — và tệ hơn, nó mời
 * người ta đi hỏi xin. Không có cột thì không có câu hỏi.
 */
export function cotXuatNhanSu(v: EmployeeFieldVisibility): CotNhanSu[] {
  return MOI_COT.filter((c) => !c.nhom || v[c.nhom]);
}

/** Nhóm bị cắt, để ghi vào sheet `_watermark` — người nhận biết tệp này KHÔNG đầy đủ. */
export function nhomBiCat(v: EmployeeFieldVisibility): string[] {
  const ra: string[] = [];
  if (!v.contact) ra.push("liên hệ (email · SĐT)");
  if (!v.salary) ra.push("lương (ngạch · bậc · BHXH)");
  if (!v.personal) ra.push("cá nhân (ngày sinh · hợp đồng · địa chỉ · ghi chú)");
  return ra;
}
