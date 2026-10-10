import type { LoaiHoSo, TrangThai } from "@/lib/bao-luu/trang-thai";
import { soNgayLich } from "@/lib/bao-luu/hoso";
import { vnStartOfDay } from "@/lib/time/vn";

// lib/bao-luu/cron-ke-hoach.ts — KẾ HOẠCH của cron `/api/cron/bao-luu` (spec §I, BR-18/19/20/23). THUẦN, không DB. PHIÊN 5.
//
// Cron chỉ THỰC THI kế hoạch này; mọi quyết định "hồ sơ nào cần việc gì hôm nay" nằm ở đây để test được bằng cách TỊNH TIẾN ĐỒNG HỒ
// (+76 / +90 / +91 / +93 / +100 / +108 / +130 ngày) mà không cần Postgres. `hom` là THAM SỐ (luật 19).
//
// Luật rút gọn:
//   · APPROVED có ngày bắt đầu ≤ hôm nay                     → START  (lưới an toàn; hôm nay `duyetHoSo` START ngay trong cùng giao dịch)
//   · ACTIVE, còn 0 < n ≤ remindBeforeDays ngày tới hạn       → NHAC_TRUOC_HAN  (một lần, dù cron chạy nhiều lần / lỡ vài ngày)
//   · ACTIVE, đúng ngày hạn                                   → NHAC_DUNG_HAN
//   · ACTIVE, hạn < hôm nay (PARENT/LEGACY)                   → QUA_HAN (⇒ OVERDUE + nhắc Sale)
//   · OVERDUE ≥ escalateAfterDays ngày, chưa liên hệ          → LEO_THANG (lên QLTT)
//   · NOTICE_SENT, hạn phản hồi < hôm nay (PARENT/LEGACY)     → CHAM_DUT (⇒ TERMINATED)
//   · ACTIVE loại CENTER quá ngày dự kiến mở lại              → CENTER_NHAC (nhắc, KHÔNG đổi trạng thái — BR-23)
//
// ⚠️ KHÔNG có đường nào tới CHAM_DUT mà không qua NOTICE_SENT: chưa ghi gửi thông báo chính thức thì dù quá hạn 30 hay 130 ngày cũng
// KHÔNG tự chấm dứt (BR-19, TC-11). Đồng hồ `noticeResponseDays` chỉ chạy sau khi đã ghi gửi.
//
// "Hạn" = `extendedEndDate ?? standardEndDate`. Hồ sơ không có hạn (dữ liệu cũ) thì bỏ qua các luật theo hạn — không đoán.

export type HoSoCron = {
  id: string;
  type: LoaiHoSo;
  status: TrangThai;
  startedAt: Date;
  expectedEndAt: Date | null;
  standardEndDate: Date | null;
  extendedEndDate: Date | null;
  lastContactAt: Date | null;
  responseDeadline: Date | null;
  /** Đã có sự kiện ESCALATE SAU lần liên hệ cuối (hoặc từ trước tới nay nếu chưa liên hệ) — chống leo thang lặp mỗi sáng. */
  daLeoThang: boolean;
};

export type ChinhSachCron = {
  remindBeforeDays: number;
  escalateAfterDays: number;
};

export type ViecCron =
  | { loai: "START"; id: string }
  | { loai: "NHAC_TRUOC_HAN"; id: string; conNgay: number }
  | { loai: "NHAC_DUNG_HAN"; id: string }
  | { loai: "QUA_HAN"; id: string }
  | { loai: "LEO_THANG"; id: string; quaHanNgay: number }
  | { loai: "CHAM_DUT"; id: string }
  | { loai: "CENTER_NHAC"; id: string; quaNgay: number };

/** Q6 (mặc định): "Đã liên hệ – hẹn ngày" dừng leo thang tối đa 7 ngày. TODO(bao-luu Q6). */
export const SO_NGAY_DUNG_LEO_THANG_SAU_LIEN_HE = 7;

export function hanCuaHoSo(h: Pick<HoSoCron, "extendedEndDate" | "standardEndDate">): Date | null {
  return h.extendedEndDate ?? h.standardEndDate;
}

export function lapKeHoachCron(hoSo: readonly HoSoCron[], cs: ChinhSachCron, hom: Date): ViecCron[] {
  const viec: ViecCron[] = [];
  for (const h of hoSo) {
    const han = hanCuaHoSo(h);
    const conNgay = han ? soNgayLich(hom, han) : null; // > 0: còn; 0: đúng hạn; < 0: quá hạn

    switch (h.status) {
      case "APPROVED":
        if (vnStartOfDay(h.startedAt).getTime() <= vnStartOfDay(hom).getTime()) viec.push({ loai: "START", id: h.id });
        break;

      case "ACTIVE":
        if (h.type === "CENTER") {
          // BR-23: không tự đổi trạng thái; quá ngày dự kiến mở lại thì NHẮC. Mốc là ngày dự kiến (fallback hạn).
          const moc = h.expectedEndAt ?? han;
          if (moc && soNgayLich(moc, hom) > 0) viec.push({ loai: "CENTER_NHAC", id: h.id, quaNgay: soNgayLich(moc, hom) });
          break;
        }
        if (conNgay === null) break;
        if (conNgay < 0) viec.push({ loai: "QUA_HAN", id: h.id });
        else if (conNgay === 0) viec.push({ loai: "NHAC_DUNG_HAN", id: h.id });
        else if (conNgay <= cs.remindBeforeDays) viec.push({ loai: "NHAC_TRUOC_HAN", id: h.id, conNgay });
        break;

      case "OVERDUE": {
        if (h.type === "CENTER" || conNgay === null || h.daLeoThang) break;
        const quaHanNgay = -conNgay;
        if (quaHanNgay < cs.escalateAfterDays) break;
        const dangHoanLeoThang =
          h.lastContactAt !== null && soNgayLich(h.lastContactAt, hom) <= SO_NGAY_DUNG_LEO_THANG_SAU_LIEN_HE;
        if (!dangHoanLeoThang) viec.push({ loai: "LEO_THANG", id: h.id, quaHanNgay });
        break;
      }

      case "NOTICE_SENT":
        // Hết hạn phản hồi = NGÀY SAU hạn phản hồi (hạn là ngày cuối còn được phản hồi).
        if (h.type !== "CENTER" && h.responseDeadline && soNgayLich(h.responseDeadline, hom) > 0) {
          viec.push({ loai: "CHAM_DUT", id: h.id });
        }
        break;

      default:
        break; // PENDING · RESUME_PENDING · ENDED · REJECTED · CANCELLED · TERMINATED: cron không đụng
    }
  }
  return viec;
}
