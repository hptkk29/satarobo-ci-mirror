import { z } from "zod";

import { db } from "@/lib/db";

import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * V8 — `POST /parent/checkout/validate`: KIỂM TRƯỚC KHI TẠO ĐƠN cho giỏ «nhiều khoá · nhiều con». CHỈ ĐỌC — không tạo đơn, không tạo học viên, không sửa hồ sơ.
 *
 * Luật cứng (docs V8 mục 6–7):
 *   · MỖI dòng mua tự khai `studentId` (dù chỉ có một con) — máy chủ KHÔNG có «con đang chọn». `studentId` không thuộc phụ huynh của PHIÊN ⇒ cả yêu cầu 404 (không dò được con nhà khác).
 *   · Lược đồ `.strict()`: client gửi giá/tổng tiền/khuyến mãi tự tính ⇒ 400 VALIDATION. Tổng tiền do MÁY CHỦ tính khi tạo đơn, không bao giờ tin client.
 *   · Lỗi hồ sơ trả có CẤU TRÚC `{ field, code, message, scope, studentId? }`; KHÔNG đòi mã số thuế (chỉ bắt buộc khi chọn «xuất cho công ty» — việc của bước hoá đơn).
 *   · Khoá: tra qua CỔNG `TraCuuKhoaBan`. Hôm nay KHÔNG có danh mục khoá Online (Agent E-learning chưa giao thực thể) ⇒ cổng mặc định FAIL-CLOSED (`COURSE_CATALOG_UNAVAILABLE`), `hopLe` luôn false. Không tự dựng bảng khoá/giá song song.
 */

/**
 * TÁCH BỐN LOẠI (chỉ đạo V8.1 mục C) — không loại nào được thành «blocker giả» khiến mọi checkout bị từ chối:
 *   1. HỒ SƠ TỐI THIỂU (chặn): họ tên + SĐT phụ huynh — định danh người mua. Quan hệ phụ huynh–học viên luôn được kiểm (404 khi không thuộc).
 *   2. THÔNG TIN HOÁ ĐƠN: KHÔNG kiểm ở đây (việc của bước hoá đơn; không đòi MST trừ khi «xuất cho công ty»).
 *   3. ĐIỀU KIỆN KHOÁ (do `OnlineCourse` của Agent E-learning quyết, qua cổng `TraCuuKhoaBan`): tuổi/lớp… Chỉ khi cổng trả `CAN_NGAY_SINH` thì ngày sinh mới thành lỗi `REQUIRED` — cho ĐÚNG dòng đó.
 *   4. DỮ LIỆU TUỲ CHỌN (không chặn): ngày sinh học viên (thiết kế PL-Mua-HoSo ghi «để in chứng nhận» — CHƯA có căn cứ nghiệp vụ được duyệt làm bắt buộc) ⇒ chỉ báo ở `thieuTuyChon`.
 * Đổi chính sách ở ĐÂY, một chỗ.
 */
export const YEU_CAU_HO_SO_MUA = { tenPhuHuynh: true, sdtPhuHuynh: true } as const;

export const kiemTruocThanhToanSchema = z
  .object({
    dong: z
      .array(
        z
          .object({
            studentId: z.string().min(1, "Chọn con cho từng khoá.").max(64),
            khoaId: z.string().min(1, "Thiếu mã khoá.").max(64),
          })
          .strict(),
      )
      .min(1, "Giỏ hàng đang trống.")
      .max(20, "Giỏ hàng quá lớn."),
  })
  .strict();
export type KiemTruocThanhToanBody = z.infer<typeof kiemTruocThanhToanSchema>;

export type LoiKiemTruoc = {
  field: string;
  code: "REQUIRED" | "DUPLICATE_LINE" | "COURSE_CATALOG_UNAVAILABLE" | "COURSE_NOT_FOR_SALE" | "ALREADY_OWNED" | "COURSE_ELIGIBILITY";
  message: string;
  scope: "parent" | "student" | "cart" | "catalog";
  studentId?: string;
  /** Vị trí dòng trong giỏ (nếu lỗi thuộc một dòng). */
  dongIndex?: number;
};

export type KetQuaTraCuuKhoa =
  | { trangThai: "BAN_DUOC" }
  | { trangThai: "KHONG_BAN" }
  | { trangThai: "DA_CO_QUYEN_VINH_VIEN" }
  /** Khoá có điều kiện tuổi mà hồ sơ chưa có ngày sinh ⇒ chỉ khi đó ngày sinh mới là lỗi bắt buộc (chính sách nằm ở OnlineCourse, không ở đây). */
  | { trangThai: "CAN_NGAY_SINH" }
  | { trangThai: "KHONG_DU_DIEU_KIEN"; lyDo: string }
  | { trangThai: "KHONG_CO_DANH_MUC" };

/** CỔNG sang danh mục khoá Online + engine entitlement (Agent E-learning). Workstream A chỉ HỎI, không sở hữu. */
export type TraCuuKhoaBan = (khoaId: string, hocVien: { id: string; ngaySinh: Date | null }) => Promise<KetQuaTraCuuKhoa>;
export const traCuuKhoaMacDinh: TraCuuKhoaBan = async () => ({ trangThai: "KHONG_CO_DANH_MUC" });
let traCuu: TraCuuKhoaBan = traCuuKhoaMacDinh;
export function datTraCuuKhoaBan(f: TraCuuKhoaBan | null): void {
  traCuu = f ?? traCuuKhoaMacDinh;
}

const trong = (s: string | null | undefined) => !s || s.trim().length === 0;

export type HoSoPhuHuynh = { ten: string | null; sdt: string | null };
export type HoSoHocVien = { id: string; ngaySinh: Date | null };

/** THUẦN — lỗi hồ sơ TỐI THIỂU còn thiếu (chặn). Ngày sinh học viên KHÔNG nằm ở đây (dữ liệu tuỳ chọn / điều kiện của khoá). */
export function loiHoSoMua(ph: HoSoPhuHuynh): LoiKiemTruoc[] {
  const loi: LoiKiemTruoc[] = [];
  if (YEU_CAU_HO_SO_MUA.tenPhuHuynh && trong(ph.ten)) loi.push({ field: "phuHuynh.ten", code: "REQUIRED", message: "Cần họ tên phụ huynh.", scope: "parent" });
  if (YEU_CAU_HO_SO_MUA.sdtPhuHuynh && trong(ph.sdt)) loi.push({ field: "phuHuynh.sdt", code: "REQUIRED", message: "Cần số điện thoại phụ huynh.", scope: "parent" });
  return loi;
}

/** THUẦN — dữ liệu tuỳ chọn còn trống (KHÔNG chặn). Mỗi học viên một lần. */
export function thieuTuyChon(hocVien: readonly HoSoHocVien[]): Array<{ field: string; scope: "student"; studentId: string }> {
  return hocVien.filter((h) => !h.ngaySinh).map((h) => ({ field: "hocVien.ngaySinh", scope: "student" as const, studentId: h.id }));
}

export type KiemTruocDto = {
  hopLe: boolean;
  loi: LoiKiemTruoc[];
  /** Dữ liệu tuỳ chọn còn trống — KHÔNG chặn thanh toán (không ảnh hưởng `hopLe`). */
  thieuTuyChon: Array<{ field: string; scope: "student"; studentId: string }>;
  /** Các điều máy chủ CHƯA kiểm được vì thiếu phụ thuộc — app không được coi là «đã hợp lệ». */
  chuaKiemDuoc: string[];
};

export async function kiemTruocThanhToan(parentUserId: string, body: KiemTruocThanhToanBody): Promise<KiemTruocDto> {
  const ids = [...new Set(body.dong.map((d) => d.studentId))];
  const con = await db.student.findMany({ where: { id: { in: ids }, parentUserId, deletedAt: null }, select: { id: true, dateOfBirth: true } });
  // Chỉ cần MỘT id lạ là cả yêu cầu 404 — không phân biệt «của nhà khác» với «không có».
  if (con.length !== ids.length) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  const ph = await db.user.findUnique({ where: { id: parentUserId }, select: { name: true, phone: true } });
  const hoSo = con.map((c) => ({ id: c.id, ngaySinh: c.dateOfBirth }));
  const ngaySinhCua = new Map(hoSo.map((h) => [h.id, h.ngaySinh]));
  const loi: LoiKiemTruoc[] = loiHoSoMua({ ten: ph?.name ?? null, sdt: ph?.phone ?? null });

  const thay = new Set<string>();
  const chuaKiemDuoc = new Set<string>();
  for (const [i, d] of body.dong.entries()) {
    const khoa = `${d.studentId}|${d.khoaId}`;
    if (thay.has(khoa)) loi.push({ field: `dong.${i}`, code: "DUPLICATE_LINE", message: "Khoá này đã có trong giỏ cho con này.", scope: "cart", studentId: d.studentId, dongIndex: i });
    thay.add(khoa);
    const kq = await traCuu(d.khoaId, { id: d.studentId, ngaySinh: ngaySinhCua.get(d.studentId) ?? null });
    if (kq.trangThai === "KHONG_CO_DANH_MUC") {
      loi.push({ field: `dong.${i}.khoaId`, code: "COURSE_CATALOG_UNAVAILABLE", message: "Chưa mua được khoá online lúc này.", scope: "catalog", studentId: d.studentId, dongIndex: i });
      chuaKiemDuoc.add("DANH_MUC_KHOA_ONLINE_CHUA_CO");
    } else if (kq.trangThai === "KHONG_BAN") {
      loi.push({ field: `dong.${i}.khoaId`, code: "COURSE_NOT_FOR_SALE", message: "Khoá này hiện không bán.", scope: "catalog", studentId: d.studentId, dongIndex: i });
    } else if (kq.trangThai === "CAN_NGAY_SINH") {
      loi.push({ field: "hocVien.ngaySinh", code: "REQUIRED", message: "Khoá này cần ngày sinh của con để xét điều kiện.", scope: "student", studentId: d.studentId, dongIndex: i });
    } else if (kq.trangThai === "KHONG_DU_DIEU_KIEN") {
      loi.push({ field: `dong.${i}.khoaId`, code: "COURSE_ELIGIBILITY", message: kq.lyDo, scope: "student", studentId: d.studentId, dongIndex: i });
    } else if (kq.trangThai === "DA_CO_QUYEN_VINH_VIEN") {
      loi.push({ field: `dong.${i}.khoaId`, code: "ALREADY_OWNED", message: "Con đã có quyền học vĩnh viễn khoá này.", scope: "student", studentId: d.studentId, dongIndex: i });
    }
  }
  return { hopLe: loi.length === 0, loi, thieuTuyChon: thieuTuyChon(hoSo), chuaKiemDuoc: [...chuaKiemDuoc] };
}
