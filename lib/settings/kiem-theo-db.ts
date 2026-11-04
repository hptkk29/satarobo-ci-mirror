/**
 * lib/settings/kiem-theo-db.ts — PHÉP KIỂM GIÁ TRỊ SETTING cần ĐỌC DB (Zod ở registry là thuần, không với tới DB). Chạy ở NƠI LƯU (`setGlobalSetting`), sau `validateSettingValue`.
 *
 * Hiện có MỘT khoá: `nguon.nhomNhanSuMacDinh` (phải là mã nguồn có thật, chọn được, kiểu nhân sự giới thiệu — `lib/nguon/nhom-nhan-su-mac-dinh.ts`).
 *
 * ── Giữ cho khỏi vòng import ───────────────────────────────────────────────────────────────────────────────
 *  · khoá lấy từ `KHOA_NGUON` ở LÁ `lib/nguon/khoa-setting.ts`, KHÔNG từ `feature.ts` (`feature.ts` import `service.ts`, `service.ts` import tệp này ⇒ nhập `feature.ts` ở đây là vòng; lưới
 *    `[FIX-F3-*]` đo đồ thị). Lưới `[NHH-FLG-05]` cấm gõ chuỗi `nguon.*` ngoài `feature.ts`/`khoa-setting.ts`;
 *  · bảng vẫn dựng TRONG hàm (`boKiem()`): hết lý do TDZ nhưng đổi là việc không ai nhờ, và dựng lúc gọi rẻ.
 */
import { KHOA_NGUON } from "@/lib/nguon/khoa-setting";
import { kiemNhomNhanSuMacDinhTheoDb } from "@/lib/nguon/nhom-nhan-su-mac-dinh";

type BoKiem = (value: unknown, now: Date) => Promise<string | null>;

function boKiem(): Readonly<Record<string, BoKiem>> {
  return {
    [KHOA_NGUON.nhomNhanSuMacDinh]: (value, now) => (typeof value === "string" ? kiemNhomNhanSuMacDinhTheoDb(value, now) : Promise.resolve(null)),
  };
}

/** Câu lỗi nếu giá trị (ĐÃ qua Zod) không hợp lệ theo DB; `null` = hợp lệ hoặc khoá không có phép kiểm riêng. */
export async function kiemGiaTriTheoDb(key: string, value: unknown, now: Date): Promise<string | null> {
  const f = boKiem()[key];
  return f ? f(value, now) : null;
}
