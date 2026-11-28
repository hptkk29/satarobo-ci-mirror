// Ánh xạ trạng thái nghiệp vụ → NĂM nhóm màu của danh sách điện thoại (HANDOFF §4: "nếu quá 5 trạng thái thì gom theo
// nhóm màu: Ổn / Cần chú ý / Trễ hoặc lỗi / Chưa bắt đầu / Đã duyệt"). Hàm THUẦN, không import gì — dùng được ở cả server lẫn client.
//
// Khoá là `<TênEnum>.<GIÁ_TRỊ>` chứ không chỉ `<GIÁ_TRỊ>`: `DRAFT`, `REVOKED`, `IN_PROGRESS` có mặt ở nhiều enum với nghĩa
// khác nhau (vd. REVOKED của lượt giao ≠ REVOKED của chứng nhận). Lưới `tests/elearning/nhom-mau-trang-thai.test.ts` đọc
// `prisma/schema.prisma` và đòi MỌI giá trị của MỌI enum trạng thái được khai ở đây — thêm một trạng thái vào schema mà quên
// khai ở đây là đỏ, không phải một chấm xám im lặng.

export type NhomMau = "on" | "chu-y" | "tre-loi" | "chua-bat-dau" | "da-duyet";

/** Nhóm rơi về khi gặp trạng thái lạ: trung tính, không hứa "ổn" cũng không báo "lỗi" oan. */
export const NHOM_MAC_DINH: NhomMau = "chua-bat-dau";

/** Thứ tự + nhãn hiển thị trong chú thích. Màu thật lấy từ token (`state-*`, `primary`). */
export const NHOM_MAU: readonly { id: NhomMau; nhan: string }[] = [
  { id: "on", nhan: "Ổn" },
  { id: "chu-y", nhan: "Cần chú ý" },
  { id: "tre-loi", nhan: "Trễ hoặc lỗi" },
  { id: "chua-bat-dau", nhan: "Chưa bắt đầu" },
  { id: "da-duyet", nhan: "Đã duyệt" },
];

const BANG: Record<string, NhomMau> = {
  // Ghi danh (lượt học của một người)
  "TrnEnrollmentStatus.NOT_STARTED": "chua-bat-dau",
  "TrnEnrollmentStatus.IN_PROGRESS": "on",
  "TrnEnrollmentStatus.COMPLETED": "da-duyet",
  "TrnEnrollmentStatus.COMPLETED_LATE": "chu-y",
  "TrnEnrollmentStatus.OVERDUE": "tre-loi",
  "TrnEnrollmentStatus.REVOKED": "chua-bat-dau",
  // Tiến độ từng bài
  "TrnLessonProgressStatus.NOT_STARTED": "chua-bat-dau",
  "TrnLessonProgressStatus.IN_PROGRESS": "on",
  "TrnLessonProgressStatus.DONE": "da-duyet",
  // Khoá và phiên bản khoá (vòng đời duyệt)
  "TrnCourseStatus.DRAFT": "chua-bat-dau",
  "TrnCourseStatus.PUBLISHED": "da-duyet",
  "TrnCourseStatus.ARCHIVED": "chua-bat-dau",
  "TrnVersionStatus.DRAFT": "chua-bat-dau",
  "TrnVersionStatus.PENDING_REVIEW": "chu-y",
  "TrnVersionStatus.APPROVED": "da-duyet",
  "TrnVersionStatus.PUBLISHED": "da-duyet",
  "TrnVersionStatus.ARCHIVED": "chua-bat-dau",
  // Chương trình đào tạo
  "TrnProgramStatus.DRAFT": "chua-bat-dau",
  "TrnProgramStatus.PENDING_APPROVAL": "chu-y",
  "TrnProgramStatus.APPROVED": "da-duyet",
  "TrnProgramStatus.RUNNING": "on",
  "TrnProgramStatus.DONE": "da-duyet",
  "TrnProgramStatus.EVALUATED": "da-duyet",
  "TrnProgramStatus.CANCELLED": "chua-bat-dau",
  // Lượt giao
  "TrnAssignmentStatus.ACTIVE": "on",
  "TrnAssignmentStatus.REVOKED": "chua-bat-dau",
  // Bài thi / bài nộp
  "TrnAttemptStatus.IN_PROGRESS": "on",
  "TrnAttemptStatus.SUBMITTED": "chu-y",
  "TrnAttemptStatus.PENDING_GRADE": "chu-y",
  "TrnAttemptStatus.GRADED": "da-duyet",
  "TrnAttemptStatus.ABANDONED": "tre-loi",
  "TrnSubmissionStatus.DRAFT": "chua-bat-dau",
  "TrnSubmissionStatus.SUBMITTED": "chu-y",
  "TrnSubmissionStatus.GRADED": "da-duyet",
  "TrnSubmissionStatus.NEEDS_REVISION": "tre-loi",
  // Chứng nhận
  "TrnCertStatus.VALID": "da-duyet",
  "TrnCertStatus.EXPIRED": "tre-loi",
  "TrnCertStatus.REVOKED": "tre-loi",
  // Đề nghị / phiếu nhu cầu
  "TrnTrainingNeedStatus.NEW": "chu-y",
  "TrnTrainingNeedStatus.APPROVED": "da-duyet",
  // Yêu cầu bắt buộc, khung chấm
  "TrnReqStatus.DRAFT": "chua-bat-dau",
  "TrnReqStatus.ACTIVE": "on",
  "TrnReqStatus.ARCHIVED": "chua-bat-dau",
  "TrnRubricStatus.DRAFT": "chua-bat-dau",
  "TrnRubricStatus.ACTIVE": "on",
  "TrnRubricStatus.ARCHIVED": "chua-bat-dau",
  // Quyền dữ liệu cá nhân, cờ gian lận, nhắc việc, tự động hoá
  "TrnDsrStatus.NEW": "chu-y",
  "TrnDsrStatus.IN_PROGRESS": "on",
  "TrnDsrStatus.DONE": "da-duyet",
  "TrnDsrStatus.REJECTED": "tre-loi",
  "TrnFlagStatus.OPEN": "tre-loi",
  "TrnFlagStatus.APPEALED": "chu-y",
  "TrnFlagStatus.UPHELD": "tre-loi",
  "TrnFlagStatus.REVOKED": "chua-bat-dau",
  "TrnReminderStatus.PENDING": "chu-y",
  "TrnReminderStatus.SENT": "da-duyet",
  "TrnReminderStatus.SKIPPED": "chua-bat-dau",
  "TrnReminderStatus.CANCELLED": "chua-bat-dau",
  "TrnAutoOutcome.APPLIED": "da-duyet",
  "TrnAutoOutcome.SKIPPED": "chua-bat-dau",
  "TrnAutoOutcome.FAILED": "tre-loi",
};

/** Các enum đã khai — để test đối chiếu với schema. */
export const ENUM_TRANG_THAI: readonly string[] = Array.from(new Set(Object.keys(BANG).map((k) => k.split(".")[0])));

/** Nhóm màu của một trạng thái. Lạ ⇒ `NHOM_MAC_DINH` (không ném lỗi: một trạng thái mới không được làm trắng cả danh sách). */
export function nhomMauCuaTrangThai(tenEnum: string, giaTri: string): NhomMau {
  return BANG[`${tenEnum}.${giaTri}`] ?? NHOM_MAC_DINH;
}

/** Trạng thái này đã được khai chưa (để test phân biệt "khai là mặc định" với "quên khai"). */
export function daKhaiTrangThai(tenEnum: string, giaTri: string): boolean {
  return `${tenEnum}.${giaTri}` in BANG;
}

/** Lớp Tailwind cho chấm màu (nền) và chữ — chỉ dùng token, không mã hex. */
export const LOP_CHAM: Record<NhomMau, string> = {
  on: "bg-state-success",
  "chu-y": "bg-state-warning",
  "tre-loi": "bg-state-danger",
  "chua-bat-dau": "bg-muted-foreground/60",
  "da-duyet": "bg-primary-ink",
};

export const LOP_CHU: Record<NhomMau, string> = {
  on: "text-state-success-ink",
  "chu-y": "text-state-warning-ink",
  "tre-loi": "text-state-danger-ink",
  "chua-bat-dau": "text-muted-foreground",
  "da-duyet": "text-primary-ink",
};

/** Chỉ các nhóm CÓ MẶT trong danh sách (giữ thứ tự chuẩn) — chú thích không liệt kê màu không xuất hiện. */
export function nhomCoMat(cac: readonly NhomMau[]): { id: NhomMau; nhan: string }[] {
  const set = new Set(cac);
  return NHOM_MAU.filter((n) => set.has(n.id)).map((n) => ({ ...n }));
}
