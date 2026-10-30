// lib/ai-lead/dich-vu/tinh-ho-so.ts — TRẠNG THÁI HỒ SƠ do Gateway tính (design §4.1). HÀM THUẦN: không DB, không đồng hồ (`now` là tham số).
//
// Gateway chỉ tự đặt bốn trạng thái "thu thập": COLLECTING · PENDING_INFO · WAITING_QLCS · READY_FOR_REVIEW. Các trạng thái còn lại do NGƯỜI hoặc lát C đặt
// (IN_PROGRESS · COMPLETED · REJECTED · EXPIRED · SYSTEM_EXCEPTION · ASSIGNMENT_PENDING) — Gateway KHÔNG BAO GIỜ kéo hồ sơ ra khỏi chúng (không "hồi quy" công việc của nhân viên).
//
// Điều kiện đủ (`thieuDieuKien`, dieu-kien.ts của lát C) dùng CHUNG với `taoLeadTuHoSo`/nút «Duyệt»: một luật, không hai bản.
import type { ThieuDieuKien } from "./dieu-kien";
import type { OwnerState } from "../kieu";

export type TrangThaiThuThap = "COLLECTING" | "PENDING_INFO" | "WAITING_QLCS" | "READY_FOR_REVIEW";

const TRANG_THAI_TINH_LAI: readonly string[] = ["COLLECTING", "PENDING_INFO", "WAITING_QLCS", "READY_FOR_REVIEW"];

/** Gateway chỉ được đổi `state` khi hồ sơ đang ở bốn trạng thái thu thập. */
export function coTheTinhLai(state: string): state is TrangThaiThuThap {
  return TRANG_THAI_TINH_LAI.includes(state);
}

/**
 *  · đủ điều kiện ⇒ READY_FOR_REVIEW;
 *  · thiếu thứ KHÁCH cung cấp được (SĐT · cơ sở): AI còn giữ hội thoại ⇒ COLLECTING (Agent còn hỏi); đã giao người ⇒ PENDING_INFO (người phải lấy);
 *  · chỉ thiếu thứ KHÁCH KHÔNG cung cấp được (tên Facebook có nguồn) ⇒ WAITING_QLCS.
 */
export function tinhTrangThaiThuThap(x: { thieu: readonly ThieuDieuKien[]; ownerState: OwnerState }): TrangThaiThuThap {
  if (x.thieu.length === 0) return "READY_FOR_REVIEW";
  if (x.thieu.includes("phone") || x.thieu.includes("campus")) return x.ownerState === "AI_ACTIVE" ? "COLLECTING" : "PENDING_INFO";
  return "WAITING_QLCS";
}

/** Trạng thái cần một NGƯỜI xử lý (⇒ có thông báo + đồng hồ SLA). COLLECTING thì chưa: Agent còn đang hỏi khách. */
export function canNguoiXuLy(state: string): boolean {
  return state === "PENDING_INFO" || state === "WAITING_QLCS" || state === "READY_FOR_REVIEW";
}

export type HanSla = { slaClaimDueAt: Date; slaResolveDueAt: Date };

/** Hạn SLA tính từ `now` theo tham số `ai.*` — chỉ đặt MỘT LẦN khi hồ sơ lần đầu cần người (đặt lại mỗi lượt gộp dữ liệu thì SLA không bao giờ tới hạn). */
export function tinhHanSla(now: Date, c: { slaClaimMinutes: number; slaResolveMinutes: number }): HanSla {
  return {
    slaClaimDueAt: new Date(now.getTime() + c.slaClaimMinutes * 60_000),
    slaResolveDueAt: new Date(now.getTime() + c.slaResolveMinutes * 60_000),
  };
}

/** Nhãn "thiếu gì" lưu ở `missingFields` — thứ tự cố định `phone, campus, fbName`. KHÔNG chứa giá trị. */
export function danhSachThieu(thieu: readonly ThieuDieuKien[]): string[] {
  const thuTu: ThieuDieuKien[] = ["phone", "campus", "fbName"];
  return thuTu.filter((t) => thieu.includes(t));
}

/**
 * Hồ sơ "mở" của Gateway (design §0 mục 6) = chưa ở một trong các trạng thái cuối. Dùng làm điều kiện `where` — KHÔNG chép tay ở chỗ gọi.
 * `ASSIGNMENT_PENDING` là trạng thái cuối của HỒ SƠ (lead đã được tạo, chỉ còn chờ chia chủ — việc của CRM): nếu để nó "mở" thì yêu cầu mới của cùng
 * (hội thoại, ý định) bị nuốt vào một hồ sơ đã ra lead và không ai được báo. Khớp ĐÚNG vế `NOT IN (…)` của chỉ mục `AiLeadDraft_conversationId_intent_open_key`.
 */
export const TRANG_THAI_DONG = ["COMPLETED", "REJECTED", "EXPIRED", "ASSIGNMENT_PENDING"] as const;
