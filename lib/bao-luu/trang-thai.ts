// lib/bao-luu/trang-thai.ts — MÁY TRẠNG THÁI của hồ sơ bảo lưu. THUẦN, không DB.
//
// Nguồn: docs/bao-luu/spec.md §B. Đây là chỗ DUY NHẤT trả lời "từ trạng thái A sang B có hợp lệ
// không" và "trạng thái này thì `isActive` là gì" — hàm chuyển trạng thái ở Phiên 3 và cron ở
// Phiên 5 cùng hỏi ở đây, không tự viết lại điều kiện.
//
//   PENDING ─▶ APPROVED ─▶ ACTIVE ─▶ RESUME_PENDING ─▶ ENDED
//      │          │           │ ▲              ▲
//      ▼          ▼           ▼ │              │
//   REJECTED   CANCELLED   OVERDUE ─▶ NOTICE_SENT ─▶ TERMINATED ──(RESTORE, chỉ ngoại lệ)──▶ ACTIVE
//
// ⚠️ `StudentReserveStatus` lấy từ Prisma bằng `import type` — thêm trạng thái vào enum mà quên
// khai ở bảng dưới là `tsc` đỏ (bảng `CHO_PHEP` là `Record` ĐỦ khoá, không mặc định — luật 7).
import type { StudentReserveStatus, StudentReserveType } from "@prisma/client";

export type TrangThai = StudentReserveStatus;
export type LoaiHoSo = StudentReserveType;

/**
 * Trạng thái ĐÃ ĐÓNG: hồ sơ không còn chiếm "một hồ sơ mở mỗi ghi danh". Khớp ĐÚNG vế `NOT IN (…)` của
 * chỉ mục duy nhất từng phần `StudentReserve_enrollment_open_key` — lưới `[BL2-ST-07]` đối chiếu hai
 * bên, đổi một bên mà quên bên kia là đỏ.
 */
export const TRANG_THAI_DONG: readonly TrangThai[] = ["ENDED", "TERMINATED", "REJECTED", "CANCELLED"];

export function laTrangThaiMo(s: TrangThai): boolean {
  return !TRANG_THAI_DONG.includes(s);
}

/**
 * Trạng thái mà học viên ĐANG nghỉ — quyền lợi chưa hết, ghi danh còn giữ.
 *
 * ⚠️ `APPROVED` KHÔNG nằm đây: đã duyệt nhưng chưa tới ngày bắt đầu thì bé vẫn đang học (BR-13 chỉ
 * rút bé khỏi lớp ở START). `TERMINATED` cũng không: quyền lợi đã hết, ghi danh đóng (BR-20).
 */
const DANG_NGHI: readonly TrangThai[] = ["ACTIVE", "RESUME_PENDING", "OVERDUE", "NOTICE_SENT"];

/**
 * Giá trị của cột phi chuẩn hoá `isActive` ứng với một trạng thái. ⚠️ Chỉ HÀM CHUYỂN TRẠNG THÁI được
 * ghi `isActive`, và nó lấy giá trị từ đây — lưới `[BL2-ISACTIVE]` canh mọi chỗ ghi khác.
 */
export function suyRaIsActive(s: TrangThai): boolean {
  return DANG_NGHI.includes(s);
}

/**
 * Bảng chuyển hợp lệ — `Record` ĐỦ khoá, KHÔNG có mặc định.
 *
 * Ghi chú các cạnh dễ hỏi:
 *   · `ACTIVE → ENDED` là phục học SỚM (Q4: không cần duyệt riêng), không đi qua `RESUME_PENDING`.
 *   · `OVERDUE/NOTICE_SENT → ACTIVE` là GIA HẠN (nếu còn lượt — luật đếm lượt ở hàm gia hạn, không ở đây).
 *   · `TERMINATED → ACTIVE` là RESTORE: bảng này cho phép CẠNH, còn QUYỀN (`bao-luu:exception`) và LÝ DO
 *     bắt buộc do hàm chuyển trạng thái kiểm.
 *   · Không có cạnh `* → TERMINATED` ngoài `NOTICE_SENT`: chưa gửi thông báo chính thức thì KHÔNG BAO GIỜ
 *     tự chấm dứt (BR-19).
 */
export const CHO_PHEP: Record<TrangThai, readonly TrangThai[]> = {
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["RESUME_PENDING", "OVERDUE", "ENDED"],
  RESUME_PENDING: ["ENDED"],
  OVERDUE: ["NOTICE_SENT", "ACTIVE", "RESUME_PENDING"],
  NOTICE_SENT: ["TERMINATED", "ACTIVE", "RESUME_PENDING"],
  TERMINATED: ["ACTIVE"],
  ENDED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * Trạng thái mà loại CENTER KHÔNG BAO GIỜ vào (BR-23): bảo lưu do Trung tâm không tự chấm dứt. Quá ngày
 * dự kiến mở lại thì NHẮC quản lý chọn (chờ tiếp · chuyển khoá · sinh yêu cầu hoàn) chứ không đổi trạng thái.
 * TODO(bao-luu Q-center-overdue): mặc định cấm cả `OVERDUE` cho CENTER vì "OVERDUE" là bước đệm của chấm dứt.
 */
const CENTER_CAM: readonly TrangThai[] = ["OVERDUE", "NOTICE_SENT", "TERMINATED"];

export type KetQuaChuyen = { ok: true } | { ok: false; ly: string };

export function kiemChuyen(tu: TrangThai, den: TrangThai, loai: LoaiHoSo): KetQuaChuyen {
  if (tu === den) return { ok: false, ly: `Hồ sơ đã ở trạng thái ${tu}` };
  if (!CHO_PHEP[tu].includes(den)) {
    return { ok: false, ly: `Không chuyển được từ ${tu} sang ${den}` };
  }
  if (loai === "CENTER" && CENTER_CAM.includes(den)) {
    return { ok: false, ly: "Bảo lưu do Trung tâm không đi nhánh quá hạn → chấm dứt" };
  }
  return { ok: true };
}
