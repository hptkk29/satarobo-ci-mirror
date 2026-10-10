// Kiểu dùng chung của màn Duyệt đơn từ.
//
// Vì sao tách khỏi `request-queue-table.tsx`: bảng mở `RequestSheet`, còn Sheet cần đúng hình
// dạng một dòng để vẽ chi tiết ⇒ hai file import lẫn nhau và `depcruise` chặn (`no-circular`).
// Kiểu đứng riêng thì cả hai cùng nhìn về một chỗ, không ai phụ thuộc ai.
//
// Mọi trường ở đây đã được FORMAT SẴN Ở SERVER (nhãn ngày, giờ, tuổi đơn): component là client,
// mà `toLocaleString` trên máy người dùng thì lệch múi giờ — xem landmine TZ của repo.
import type { EffectTone } from "@/lib/cham-cong/request-effect";
import type { DongThongTin } from "@/lib/cham-cong/tom-tat-don";
import type { WorkRequestKindV, WorkRequestStatusV } from "@/lib/work-request";

export type QueueRow = {
  id: string;
  status: WorkRequestStatusV;
  statusLabel: string;
  kindLabel: string;
  /** null = loại lạ (dữ liệu cũ) — chỗ vẽ in nhãn trần, không biểu tượng/chữ "i". */
  kind: WorkRequestKindV | null;
  requesterName: string;
  /** "Nguyễn A xin nghỉ phép năm 2 ngày (12–13/10), …" — `tomTatDon`. */
  tomTat: string;
  centerCode: string;
  centerLabel: string;
  /** "09/09" hoặc "09/09 → 12/09". */
  applyLabel: string;
  /** Ngày đầy đủ cho `title` (bảng chỉ đủ chỗ cho dd/MM). */
  applyTitle: string;
  timeLabel: string | null;
  dueLabel: string | null;
  dueTone: "danger" | "warning" | "muted";
  effectText: string;
  /** `warning` = đơn khuyết dữ liệu, bấm Duyệt sẽ báo lỗi — cột và panel đều tô cảnh báo. */
  effectTone: EffectTone;
  effectCode: string | null;
  /** Lý do duyệt sẽ hỏng — có giá trị thì panel bỏ câu hứa và hạ nút Duyệt xuống viền. */
  effectBlocked: string | null;
  /** "Khi duyệt sẽ: …" — `khiDuyetSe`, nói bằng dữ liệu của chính đơn. */
  khiDuyet: string;
  /**
   * "Hiện trạng ngày đó" — ô ca + lượt quét còn tính, đọc lúc dựng trang. `null` = loại đơn
   * không đụng lịch ca/lượt quét (không có gì để so).
   */
  hienTrang: DongThongTin[] | null;
  /** "Đơn đề nghị" — `dongDeNghi`, chỉ các trường loại này dùng. */
  deNghi: DongThongTin[];
  ageLabel: string;
  stale: boolean;
  submittedLate: boolean;
  applyError: string | null;
  applied: boolean;
  /** Đơn OT còn chờ: khung XIN — panel duyệt điền sẵn để quản lý thu hẹp nếu cần (đợt 4). */
  khungXinOt: { tu: string; den: string } | null;
  /** Đơn OT đã duyệt: "18:00–20:00" — khung quản lý đã chốt. */
  khungDuyetOt: string | null;
  /** "Nguyễn A ngày 09/09" — câu xác nhận trước khi duyệt. */
  subject: string;
  reason: string;
  detail: string | null;
  className: string | null;
  reviewedByName: string | null;
  reviewedAtLabel: string | null;
  reviewNote: string | null;
  /**
   * Đợt 11 — yêu cầu HUỶ đơn đã duyệt: lý do xin huỷ, câu "Khi duyệt huỷ sẽ: …" (`khiDuyetHuySe`),
   * và kết quả quyết định huỷ. null = đơn chưa từng xin huỷ.
   */
  huy: {
    lyDo: string | null;
    xinLuc: string | null;
    khiDuyetHuy: string;
    quyetDinhBoi: string | null;
    quyetDinhLuc: string | null;
    ghiChu: string | null;
  } | null;
  createdAtLabel: string;
};
