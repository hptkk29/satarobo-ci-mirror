import "server-only";

// lib/push/cau-hinh-allowlist.ts — đọc "loại nào được đẩy" từ tham số vận hành.
//
// Tách khỏi `allowlist.ts` để file kia ở lại THUẦN (không DB, không `server-only`) — luật khớp
// tiền tố phải test được mà không dựng gì, và nó cũng là thứ duy nhất cần chạy nhanh trong vòng
// lặp của engine.
//
// ── HỎNG THÌ FAIL-CLOSED, NHƯNG PHẢI NÓI RA ─────────────────────────────────────────────
// Không đọc được cấu hình ⇒ coi như danh sách RỖNG ⇒ không đẩy gì. Đây là cùng một lựa chọn đã
// làm với công tắc tổng (`engine.ts`): "không biết" tuyệt đối không được hiểu thành "cứ gửi".
//
// Nhưng fail-closed mà im lặng thì tệ hơn không có: một cú chập pooler Supabase (P1001) sẽ biểu
// hiện y hệt "người vận hành đã tắt loại này", và người trực không có cách nào phân biệt. Nên
// hàm trả về CẢ lý do, và hai nơi gọi ghi hai câu khác nhau vào `lastError` của dòng outbox —
// đó là chỗ duy nhất trả lời được câu "vì sao tôi không nhận được thông báo X".

import { getGlobalSetting } from "@/lib/settings/read-global";
import { TIEN_TO_MAC_DINH } from "./allowlist";

/** Lý do ghi vào `WebPushOutbox.lastError` khi một dòng bị bỏ. Hai câu KHÁC NHAU, cố ý. */
export const LY_DO_NGOAI_DANH_SACH = "Loại thông báo này không được bật đẩy push";
export const LY_DO_KHONG_DOC_DUOC = "Không đọc được cấu hình loại thông báo — bỏ qua (fail-closed)";

export interface CauHinhAllowlist {
  /** Danh sách tiền tố đang hiệu lực. Rỗng = không đẩy loại nào. */
  tienTo: readonly string[];
  /** false = lần đọc này HỎNG, `tienTo` đang rỗng vì fail-closed chứ không phải vì cấu hình. */
  docDuoc: boolean;
}

/**
 * Đọc danh sách tiền tố được đẩy.
 *
 * KHÔNG BAO GIỜ NÉM — nơi gọi là `notifyStaff` (đường ghi của MỌI thông báo nhân sự) và cron
 * gửi; ném ở đây là làm hỏng điểm danh, giao bài, chuyển lead.
 *
 * ⚠️ `getGlobalSetting` có cache `revalidate: 300` ⇒ đổi cấu hình có hiệu lực trong ≤5 PHÚT,
 * không tức thì. Đường ghi qua `setGlobalSetting` gọi `clearSettingsCache()` nên trong cùng
 * tiến trình là ngay; các instance khác (và cron) phải chờ hết hạn cache. Màn cấu hình nói
 * đúng câu đó với người dùng — đừng bỏ dòng chữ ấy đi.
 */
export async function docTienToDuocDay(): Promise<CauHinhAllowlist> {
  try {
    const v = await getGlobalSetting("push.tienToDuocDay");
    if (!Array.isArray(v)) {
      console.error(
        `[push] push.tienToDuocDay không phải mảng (${typeof v}) — coi như RỖNG, không đẩy gì.`,
      );
      return { tienTo: [], docDuoc: false };
    }
    // Lọc lại ở đây dù registry đã validate lúc GHI: dòng cũ trong DB có thể được ghi trước khi
    // schema siết, và một phần tử rỗng `""` sẽ khớp MỌI khoá (`startsWith("")` luôn true) —
    // tức là biến danh sách trắng thành "đẩy tất". Đúng loại lỗi phải chặn ở tầng đọc.
    const sach = v.filter((x): x is string => typeof x === "string" && x.length > 0);
    return { tienTo: sach, docDuoc: true };
  } catch (err) {
    console.error(
      "[push] không đọc được push.tienToDuocDay — coi như RỖNG (không đẩy gì). " +
        `Mặc định của registry là ${JSON.stringify(TIEN_TO_MAC_DINH)}, nhưng KHÔNG dùng nó ở ` +
        "đây: rơi về mặc định lúc DB chập là gửi thứ người vận hành có thể vừa tắt đi.",
      err,
    );
    return { tienTo: [], docDuoc: false };
  }
}
