import "server-only";
import { znsProvider } from "@/lib/zalo/provider";
import { getSetting } from "@/lib/settings/service";
import type { OtpProvider } from "@/lib/otp/provider-types";

// =============================================================================
// AUTH-SĐT P4 (QĐ-5) — OtpProvider kênh ZALO (ZNS mẫu Xác thực, Tag 1).
//
// Ràng buộc từ văn bản trả lời ZBS 31/07:
//  - Tin Xác thực gửi 24/7, KHÔNG dính khung cấm 22:00–06:00 (-133 chỉ còn là
//    phòng hờ nếu Zalo đổi chính sách).
//  - Timeout gửi 15 giây: không tới thiết bị trong 15s là fail (và KHÔNG tính
//    phí) → tầng UX chờ ~15–30s là biết kết quả, đừng bắt phụ huynh đợi vô định.
//  - Tin fail (-118/-139…) không bị trừ tiền.
//
// Template đọc từ SystemSetting `zalo.znsTemplateOtp` (đổi mẫu không cần deploy).
// Tên tham số trong mẫu đã duyệt phải là `code` + `minutes` — lệch là ZNS từ
// chối template_data; smoke dev-mode (gửi tới SĐT admin OA) sẽ lộ ngay.
// =============================================================================

/**
 * Mã lỗi ZNS → key ổn định cho tầng trên (P6 sẽ map key → màn UX cụ thể).
 * Nguồn nghĩa: kế hoạch AUTH-SĐT §P4/P6 + bảng tra cứu mã lỗi ZBS (link trong
 * email trả lời 31/07) — cập nhật bảng này nếu ZBS đổi tài liệu.
 */
export const ZNS_ERROR_KEY: Record<number, string> = {
  [-118]: "ZNS_NO_ZALO_ACCOUNT", // SĐT chưa có tài khoản Zalo
  [-119]: "ZNS_USER_UNREACHABLE", // tài khoản không thể nhận ZNS
  [-133]: "ZNS_QUIET_HOURS", // khung giờ cấm (mẫu Xác thực được miễn — ZBS 31/07)
  [-139]: "ZNS_USER_REFUSED", // người dùng tắt nhận tin từ OA
  [-141]: "ZNS_USER_REFUSED", // biến thể từ chối nhận (nhóm với -139 theo kế hoạch)
  [-147]: "ZNS_USER_LIMIT", // chạm giới hạn tin tới người nhận này
};

/** Rút mã lỗi số từ chuỗi `ZNS_ERR_<code>:<message>` của znsProvider. */
export function classifyZnsError(error: string | undefined): {
  code: number | null;
  key: string;
} {
  const m = /^ZNS_ERR_(-?\d+)/.exec(error ?? "");
  const code = m ? Number.parseInt(m[1]!, 10) : null;
  return { code, key: (code !== null && ZNS_ERROR_KEY[code]) || "ZNS_ERROR" };
}

/** Provider ZALO — gửi mã qua ZNS mẫu Xác thực (tin chạm đầu tiên được phép). */
export const zaloOtpProvider: OtpProvider = {
  channel: "ZALO",
  name: "zalo-zns",
  async send({ target, code, minutesValid }) {
    const templateId = await getSetting("zalo.znsTemplateOtp");
    if (!templateId) {
      return { ok: false, provider: "zalo-zns", error: "ZNS_NO_TEMPLATE" };
    }
    const res = await znsProvider.send({
      toPhone: target,
      templateKey: templateId,
      // ⚠️ Tên tham số phải khớp ĐÚNG mẫu đã duyệt, không phải tên ta tự đặt.
      // Đo thật trên prod 31/07 với mẫu 616128: gửi `code` → Zalo trả
      // `-1122 template data is missing a parameter otp` ⇒ mẫu Xác thực của
      // Zalo dùng tên cố định `otp`. Lần đó KHÔNG báo thừa `minutes` nên tham
      // số thứ hai giữ nguyên tên. Đổi mẫu ⇒ phải đối chiếu lại tại đây.
      params: { otp: code, minutes: minutesValid },
    });
    if (res.ok) return { ok: true, provider: "zalo-zns" };
    // Trần chi phí tháng (27/08/2026): "hết ngân sách" KHÔNG phải lỗi ZNS. Bọc nó vào
    // `ZNS_ERROR:` là biến một việc của kế toán/vận hành thành một cuộc truy lỗi mạng
    // ở màn `/admin/otp-logs`. Giữ nguyên mã + câu giải thích.
    if (res.error?.startsWith("OUTBOUND_BUDGET_")) {
      return { ok: false, provider: "zalo-zns", error: res.error };
    }
    const { key } = classifyZnsError(res.error);
    // Giữ cả key ổn định lẫn chuỗi gốc (có mã số + message Zalo) để otp-logs tra được.
    return { ok: false, provider: "zalo-zns", error: `${key}:${res.error ?? "unknown"}` };
  },
};
