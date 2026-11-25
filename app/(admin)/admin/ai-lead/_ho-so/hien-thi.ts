// app/(admin)/admin/ai-lead/_ho-so/hien-thi.ts — NHÃN & MÀU HIỂN THỊ của màn «Hồ sơ chờ AI». THUẦN (không DB, không đồng hồ — `now` luôn là tham số).
// Màu theo thang NGỮ NGHĨA của DESIGN.md §1 (success/warning/danger/info/muted) — không mượn màu thương hiệu cho trạng thái. Trạng thái luôn có CHỮ, không chỉ màu.
import type { Tone as PillTone } from "../_components/nhan-trang-thai";
import type { MucSla } from "@/lib/ai-lead/dich-vu/sla";

export const NHAN_TRANG_THAI: Record<string, { nhan: string; tone: PillTone }> = {
  COLLECTING: { nhan: "Agent đang thu thập", tone: "muted" },
  PENDING_INFO: { nhan: "Chờ khách bổ sung", tone: "warning" },
  WAITING_QLCS: { nhan: "Chờ nhân viên", tone: "warning" },
  IN_PROGRESS: { nhan: "Đang xử lý", tone: "info" },
  READY_FOR_REVIEW: { nhan: "Chờ duyệt", tone: "warning" },
  COMPLETED: { nhan: "Đã tạo lead", tone: "success" },
  ASSIGNMENT_PENDING: { nhan: "Lead chưa có người phụ trách", tone: "warning" },
  REJECTED: { nhan: "Đã từ chối", tone: "danger" },
  EXPIRED: { nhan: "Hết hạn", tone: "muted" },
  SYSTEM_EXCEPTION: { nhan: "Lỗi hệ thống", tone: "danger" },
};

export const NHAN_Y_DINH: Record<string, string> = {
  CONSULTATION_REQUEST: "Xin tư vấn",
  ENROLLMENT_REQUEST: "Đăng ký học",
  TRIAL_CLASS_REQUEST: "Học thử",
};

export const TONE_SLA: Record<MucSla, PillTone> = {
  KHONG_AP_DUNG: "muted",
  TRONG_HAN: "success",
  SAP_HAN: "warning",
  QUA_HAN_NHAN: "danger",
  QUA_HAN_XU_LY: "danger",
};

export const NHAN_OWNER: Record<string, string> = {
  AI_ACTIVE: "AI đang giữ hội thoại",
  HANDOFF_REQUESTED: "AI đã xin chuyển cho người",
  TAKEOVER_PENDING: "Chờ xác nhận tiếp quản",
  HUMAN_ACTIVE: "Nhân viên đang giữ hội thoại",
  PAUSED: "Tạm dừng",
};

export const NHAN_HANH_DONG: Record<string, string> = {
  CLAIM: "Nhận xử lý",
  STAFF_UPDATE: "Nhân viên bổ sung/xác minh",
  CREATE_LEAD: "Tạo lead",
  REJECT: "Từ chối",
  TRANSFER: "Chuyển người xử lý",
  RELEASE: "Trả về hàng chờ",
  TAKEOVER_ATTEST: "Báo đã nhận trong Page Inbox",
  RETRY_CREATE_LEAD: "Thử lại tạo lead",
  CLOSE_EXCEPTION: "Đóng ngoại lệ (lead đã có sale)",
};

export const NHAN_NGUON_TEN: Record<"AGENT_XAC_MINH" | "NHAN_VIEN", string> = {
  AGENT_XAC_MINH: "Nguồn do Agent cung cấp (Meta)",
  NHAN_VIEN: "Nhân viên đã xác minh",
};

export const NHAN_NGUON_TEN_KHAI: Record<string, string> = {
  META_PROFILE_API: "Lấy từ hồ sơ Meta (do Agent khai)",
  WEBHOOK_PAYLOAD: "Lấy từ webhook Meta (do Agent khai)",
  CUSTOMER_STATED: "Khách tự gõ — cần nhân viên đối chiếu",
};

const dinhDang = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Giờ Việt Nam, TZ-an toàn (không phụ thuộc múi giờ máy chủ/trình duyệt). */
export function gioVn(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? "—" : dinhDang.format(x);
}

/** «còn 12 phút» / «quá 2 giờ» — `now` là tham số. */
export function conLai(han: Date | string | null | undefined, now: Date): string {
  if (!han) return "—";
  const ms = new Date(han).getTime() - now.getTime();
  const phut = Math.round(Math.abs(ms) / 60_000);
  const chu = phut < 1 ? "dưới 1 phút" : phut < 60 ? `${phut} phút` : phut < 48 * 60 ? `${Math.round(phut / 60)} giờ` : `${Math.round(phut / 1440)} ngày`;
  return ms >= 0 ? `còn ${chu}` : `quá ${chu}`;
}
