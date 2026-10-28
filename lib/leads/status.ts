import type { LeadStatus } from "@prisma/client";

// =============================================================================
// LEAD PIPELINE — nguồn sự thật DUY NHẤT cho trạng thái lead.
//
// GĐ0 (25/08/2026) gom mọi bảng tra cứu về đây (trước đó chép ở 6 nơi, lệch nhau).
// GĐ5 (25/08/2026) rút enum từ 15 xuống 10 giá trị theo đặc tả bàn giao mục 3.
//
// ⚠️ Thêm/bớt giá trị enum: sửa LEAD_STATUS_VALUES rồi để TypeScript dẫn đường —
// mọi `Record<LeadStatus, …>` bên dưới sẽ đỏ cho tới khi khai đủ. Riêng các MẢNG
// thì TS không bắt được, đó là việc của lib/leads/status.test.ts.
// =============================================================================

/**
 * Bộ giá trị LeadStatus theo thứ tự phễu SR.QD.217.
 * `as const` để dùng trực tiếp làm tuple cho `z.enum(...)`.
 */
export const LEAD_STATUS_VALUES = [
  "MOI",
  "DA_LIEN_HE",
  "DANG_TU_VAN",
  "DA_HEN_HOC_THU",
  "DANG_HOC_THU",
  "DA_HOC_THU",
  "CHO_QUYET_DINH",
  "DA_DANG_KY",
  "DANG_NUOI_DUONG",
  "DA_MAT",
] as const satisfies readonly LeadStatus[];

/** Status hợp lệ cho filter + chuyển đổi. */
export const ALL_LEAD_STATUSES: LeadStatus[] = [...LEAD_STATUS_VALUES];

// ─── Nhãn ────────────────────────────────────────────────────────────────────

/** Nhãn đầy đủ — dùng ở bảng, thẻ, chi tiết lead. */
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  MOI: "Mới",
  DA_LIEN_HE: "Đã liên hệ",
  DANG_TU_VAN: "Đang tư vấn",
  DA_HEN_HOC_THU: "Đã hẹn học thử",
  DANG_HOC_THU: "Đang học thử",
  DA_HOC_THU: "Đã học thử",
  CHO_QUYET_DINH: "Chờ quyết định",
  DA_DANG_KY: "Đã đăng ký",
  DANG_NUOI_DUONG: "Đang nuôi dưỡng",
  DA_MAT: "Đã mất",
};

/**
 * Nhãn rút gọn cho trục biểu đồ và phễu.
 * Cố ý KHÁC nhãn đầy đủ: trục biểu đồ hẹp, "Đang nuôi dưỡng" bị cắt chữ.
 */
export const LEAD_STATUS_LABEL_SHORT: Record<LeadStatus, string> = {
  MOI: "Mới",
  DA_LIEN_HE: "Đã liên hệ",
  DANG_TU_VAN: "Đang tư vấn",
  DA_HEN_HOC_THU: "Hẹn học thử",
  DANG_HOC_THU: "Đang học thử",
  DA_HOC_THU: "Đã học thử",
  CHO_QUYET_DINH: "Chờ quyết định",
  DA_DANG_KY: "Đã đăng ký",
  DANG_NUOI_DUONG: "Nuôi dưỡng",
  DA_MAT: "Đã mất",
};

// ─── Màu ─────────────────────────────────────────────────────────────────────

export const LEAD_STATUS_BADGE: Record<LeadStatus, string> = {
  MOI: "bg-sky-100 text-sky-700",
  DA_LIEN_HE: "bg-blue-100 text-blue-700",
  DANG_TU_VAN: "bg-indigo-100 text-indigo-700",
  DA_HEN_HOC_THU: "bg-violet-100 text-violet-700",
  DANG_HOC_THU: "bg-violet-100 text-violet-800",
  DA_HOC_THU: "bg-purple-100 text-purple-700",
  CHO_QUYET_DINH: "bg-orange-100 text-orange-700",
  DA_DANG_KY: "bg-emerald-100 text-emerald-700",
  DANG_NUOI_DUONG: "bg-yellow-100 text-yellow-700",
  DA_MAT: "bg-red-100 text-red-700",
};

// Top border accent cho Kanban column header.
export const LEAD_STATUS_ACCENT: Record<LeadStatus, string> = {
  MOI: "border-sky-400",
  DA_LIEN_HE: "border-blue-400",
  DANG_TU_VAN: "border-indigo-400",
  DA_HEN_HOC_THU: "border-violet-400",
  DANG_HOC_THU: "border-violet-500",
  DA_HOC_THU: "border-purple-400",
  CHO_QUYET_DINH: "border-orange-400",
  DA_DANG_KY: "border-emerald-500",
  DANG_NUOI_DUONG: "border-yellow-400",
  DA_MAT: "border-red-400",
};

/** Sắc thái cho <StatusBadge> ở dashboard quản lý. */
export type LeadStatusVariant = "success" | "warning" | "error" | "info" | "neutral";

export const LEAD_STATUS_VARIANT: Record<LeadStatus, LeadStatusVariant> = {
  MOI: "info",
  DA_LIEN_HE: "warning",
  DANG_TU_VAN: "info",
  DA_HEN_HOC_THU: "info",
  DANG_HOC_THU: "info",
  DA_HOC_THU: "info",
  CHO_QUYET_DINH: "warning",
  DA_DANG_KY: "success",
  DANG_NUOI_DUONG: "warning",
  DA_MAT: "error",
};

/** Chấm/thanh màu đặc cho biểu đồ cột trạng thái ở màn marketing. */
export const LEAD_STATUS_DOT: Record<LeadStatus, string> = {
  MOI: "bg-state-info",
  DA_LIEN_HE: "bg-state-warning",
  DANG_TU_VAN: "bg-state-info",
  DA_HEN_HOC_THU: "bg-primary",
  DANG_HOC_THU: "bg-primary",
  DA_HOC_THU: "bg-primary",
  CHO_QUYET_DINH: "bg-primary",
  DA_DANG_KY: "bg-state-success",
  DANG_NUOI_DUONG: "bg-primary",
  DA_MAT: "bg-gray-400",
};

// ─── Tập con ─────────────────────────────────────────────────────────────────

/**
 * Cột Kanban theo thứ tự vận hành.
 * GĐ5 — nay phủ ĐỦ 10 giá trị (trước đây bỏ DEMO_SCHEDULED vì đã deprecated;
 * giá trị đó không còn tồn tại nên không còn ngoại lệ nào).
 */
export const KANBAN_COLUMNS: LeadStatus[] = [...LEAD_STATUS_VALUES];

/**
 * Lead đã ĐÓNG HẲN — không còn là việc đang mở của sale.
 * Dùng cho: đếm tải round-robin, lọc ứng viên bàn giao, đếm "lead đang mở" ở CRM.
 *
 * ⚠️ CỐ Ý KHÔNG có DA_DANG_KY: lead đã ghi nhận tiền vẫn còn việc phải làm (xếp lớp,
 * chốt convert) nên vẫn tính là tải của sale.
 */
export const LEAD_CLOSED_STATUSES: LeadStatus[] = ["DA_MAT"];

/**
 * Lead KHÔNG còn nằm trong hàng đợi của Sale nào — dùng cho CHỐNG TRÙNG lúc nhập lead.
 *
 * Khác `LEAD_CLOSED_STATUSES` đúng ở chỗ có thêm `DA_DANG_KY`, và khác biệt đó là
 * CỐ Ý — hai câu hỏi khác nhau:
 *   - "Sale này đang gánh bao nhiêu việc?"  → LEAD_CLOSED_STATUSES (lead đã đăng ký
 *     vẫn còn việc: xếp lớp, chốt convert).
 *   - "Gắn con thứ hai vào hồ sơ cũ được không?" → tập này. Gắn vào hồ sơ đã đăng ký
 *     là CHÔN VIỆC: hồ sơ đó không đổi trạng thái nữa, không sinh nhắc việc, không ai
 *     nhìn tới. Mà đây là ca rất thường: nhà cho con thứ nhất nhập học rồi hỏi tiếp
 *     cho con thứ hai trong cùng cửa sổ chống trùng.
 *
 * ⚠️ Trước GĐ5 hai tập này TRÙNG NHAU (đều chứa ENROLLED), nên chỉ cần một hằng. Sau
 * khi gộp ENROLLED vào DA_DANG_KY thì chúng tách đôi — dùng nhầm là mất lead im lặng.
 */
export const LEAD_KHONG_NHAN_THEM_CON: LeadStatus[] = ["DA_DANG_KY", "DA_MAT"];

/**
 * Lead đã RỜI PHỄU tư vấn — tự động hoá không được đẩy trạng thái nữa.
 * Dùng cho: module học thử (tiến độ điểm danh KHÔNG được kéo ngược trạng thái của
 * lead đã đăng ký), và mọi nơi khác cần "sale tự quản từ đây".
 */
export const LEAD_PIPELINE_EXIT_STATUSES: LeadStatus[] = [
  "DA_DANG_KY",
  ...LEAD_CLOSED_STATUSES,
];

/**
 * Lead RỚT KHỎI PHỄU — vào một trong hai bậc này thì `setLeadStatus` ghi lại BẬC
 * TRƯỚC ĐÓ vào `Lead.droppedAtStage` và kèm lý do ở `Lead.lostNote`.
 *
 * ⚠️ Đây là tập DUY NHẤT ép người dùng nhập LÝ DO. Vì sao ép: `droppedAtStage` một
 * mình chỉ trả lời "rụng ở bậc nào", không trả lời "vì sao" — mà báo cáo cần cả hai
 * mới hành động được. `lib/leads/set-status.ts` vốn khai lý do là "bắt buộc về mặt
 * nghiệp vụ" nhưng KHÔNG ép ở tầng đó (nhiều đường vào là máy chạy, không có người
 * để hỏi), nên chỗ ép đúng là tầng người dùng bấm — xem `updateLeadStatus`.
 *
 * `DA_DANG_KY` CỐ Ý không có mặt: đó là rời phễu theo hướng THẮNG, không phải rụng.
 */
export const LEAD_DROP_STATUSES: LeadStatus[] = ["DANG_NUOI_DUONG", "DA_MAT"];

/** Trạng thái này có bắt buộc kèm lý do khi người dùng đổi tay không. */
export function canhBaoCanLyDo(to: LeadStatus): boolean {
  return LEAD_DROP_STATUSES.includes(to);
}

/**
 * Bậc phễu chuyển đổi của dashboard CRM.
 * Lưới chặn bỏ sót nằm ở lib/leads/status.test.ts.
 */
export const LEAD_FUNNEL_STAGES: { name: string; statuses: LeadStatus[] }[] = [
  { name: "Lead mới", statuses: ["MOI"] },
  { name: "Đã liên hệ", statuses: ["DA_LIEN_HE", "DANG_TU_VAN", "DANG_NUOI_DUONG"] },
  { name: "Học thử", statuses: ["DA_HEN_HOC_THU", "DANG_HOC_THU", "DA_HOC_THU"] },
  { name: "Chờ quyết định", statuses: ["CHO_QUYET_DINH"] },
  { name: "Đã chốt", statuses: ["DA_DANG_KY"] },
];

/**
 * Status CỐ Ý nằm ngoài phễu: lead rớt không phải một bậc chuyển đổi.
 * GĐ5 — chỉ còn DA_MAT (DUPLICATE đã bị gỡ khỏi enum).
 */
export const LEAD_FUNNEL_EXCLUDED: LeadStatus[] = ["DA_MAT"];

/**
 * Status coi là ĐÃ CHỐT cho báo cáo phễu.
 * Kiểu ReadonlySet<string> có chủ đích: call-site nhận `status: string` từ record
 * phẳng đã select sẵn, không phải LeadStatus đã narrow.
 */
export const CONVERTED_STATUSES: ReadonlySet<string> = new Set<string>([
  "DA_DANG_KY",
] satisfies LeadStatus[]);

export function leadStatusLabel(status: LeadStatus | string): string {
  return LEAD_STATUS_LABEL[status as LeadStatus] ?? String(status);
}

// =============================================================================
// Transition guard
// =============================================================================

/**
 * Kiểm tra chuyển trạng thái lead có hợp lệ không.
 *
 * PERMISSIVE có chủ đích: đặc tả cho phép rơi vào "nuôi dưỡng"/"đã mất" từ BẤT KỲ
 * bậc nào, nên chặn theo sơ đồ cứng sẽ cản đúng thao tác thường ngày của Sale.
 *
 * ⚠️ GĐ5 — nhánh chặn `REGISTERED` CŨ ĐÃ GỠ. Nó từng đòi "chỉ vào Đã đăng ký từ Chờ
 * quyết định khi đã có khoản ghi nhận". Sau khi gộp ENROLLED vào DA_DANG_KY, nhánh đó
 * chặn luôn cả đường convert hợp lệ, mà cổng tiền thật nằm ở `evaluatePaymentGuard`
 * trong convert chứ không phải ở đây. Để lại là chặn ngầm không ai hiểu.
 */
export function canTransitionLeadStatus(
  from: LeadStatus,
  to: LeadStatus,
  _opts?: { hasRecordedPayment?: boolean },
): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true };
  return { ok: true };
}
