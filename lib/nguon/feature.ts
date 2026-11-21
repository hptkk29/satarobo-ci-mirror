// lib/nguon/feature.ts — NƠI DUY NHẤT ĐỌC CÁC CỜ + THAM SỐ của module "Nguồn lead".
//
// Chép khuôn `lib/finance/hoa-don/feature.ts`: cờ nằm trong DB (`SystemSetting`), người vận hành
// bật được, thấy được, `AuditLog` ghi ai bật lúc nào. Lưới `[NHH-FLG-05]` đếm số chỗ nhắc chuỗi
// khoá `nguon.*` ngoài tệp này = 0 — rải `getSetting("nguon.…")` khắp nơi là mỗi chỗ tự quyết nghĩa
// của "bật", và tắt cờ sẽ tắt được 9 chỗ trong 10 (đúng hình dạng cờ chết `PAYMENT_LEDGER_V2`).
//
// Đặc tả: docs/source-commission/05 §2.1–§2.3. Tên master là `nguon.enabled` (chốt 08/10/2026),
// THAY `nguon.quanLyNguonBat` của bản đặc tả đầu.
//
// ── HAI TẦNG CỜ ───────────────────────────────────────────────────────────────────────────────
//   · TOÀN HỆ: `nguon.enabled` + bốn cờ con. Dữ liệu attribution phải đủ 100% nên KHÔNG cho cơ sở
//     lệch (một cơ sở tắt riêng ⇒ lead của nó rơi khỏi mọi báo cáo nguồn).
//   · THEO CƠ SỞ: CHỈ `nguon.epChonNguon` (ô nhập ép chọn) — để pilot từng cơ sở.
// Cờ con chỉ CÓ NGHĨA khi master bật: `hopCoNguon` là phép giải duy nhất (hàm thuần, test không cần DB).
//
// ⚠️ Cờ chỉ gác ĐƯỜNG GHI MỚI + màn hình. Dữ liệu attribution đã ghi KHÔNG bị xoá khi tắt cờ.
// ⚠️ `orgUnitId`, KHÔNG phải `centerId` (lý do: `lib/finance/feature.ts` — `CenterSetting` khoá theo
// `OrgUnit.id`; truyền `Center.id` là tra không ra dòng nào và lặng lẽ rơi về giá trị toàn hệ).

import { getSetting } from "@/lib/settings/service";
import { KHOA_NGUON } from "./khoa-setting";

// Khoá nằm ở LÁ `khoa-setting.ts` (gỡ vòng feature → service → kiem-theo-db → feature); xuất lại để nơi gọi cũ không đổi.
export { KHOA_NGUON };

/** Giá trị THÔ của năm cờ bật/tắt toàn hệ, đúng như đang lưu trong DB. */
export type CoNguonTho = {
  enabled: boolean;
  autoAttribution: boolean;
  pageMapping: boolean;
  referral: boolean;
  manualReview: boolean;
};

type TenCoCon = Exclude<keyof CoNguonTho, "enabled">;
const CO_CON: readonly TenCoCon[] = ["autoAttribution", "pageMapping", "referral", "manualReview"];

/**
 * Giải tổ hợp cờ: cờ con chỉ có hiệu lực khi master bật. Hàm THUẦN.
 *
 * Master tắt ⇒ mọi cờ con = false dù DB để true. Đó là chủ ý: người vận hành bật cờ con trước rồi mới
 * bật master (hoặc master bị tắt khi sự cố) không được làm cờ con "rò" ra đường ghi.
 */
export function hopCoNguon(tho: CoNguonTho): CoNguonTho {
  return {
    enabled: tho.enabled,
    autoAttribution: tho.enabled && tho.autoAttribution,
    pageMapping: tho.enabled && tho.pageMapping,
    referral: tho.enabled && tho.referral,
    manualReview: tho.enabled && tho.manualReview,
  };
}

/**
 * Cờ con ĐANG BẬT trong DB mà master TẮT ⇒ chúng vô hiệu. Dùng để cảnh báo người vận hành (không để
 * lặng lẽ vô hiệu — họ tưởng đã bật). Master bật ⇒ không có cờ nào mồ côi.
 */
export function coConMoCoi(tho: CoNguonTho): TenCoCon[] {
  if (tho.enabled) return [];
  return CO_CON.filter((k) => tho[k]);
}

export type CachXuLyNhanLa = "KHONG_GHI_NGUON" | "UNKNOWN_XEM_TAY" | "CHAN_NHAP";

/**
 * Tổ hợp cờ × nhãn nguồn LẠ ở đường nhập (05 §2.2b). Hàm THUẦN.
 *
 *   master tắt                 ⇒ KHONG_GHI_NGUON  (như hôm nay: không ghi attribution)
 *   master bật, ép chọn tắt    ⇒ UNKNOWN_XEM_TAY  (ghi UNKNOWN kèm nhãn gốc để xem tay — KHÔNG chặn)
 *   master bật, ép chọn bật    ⇒ CHAN_NHAP        (bắt chọn nguồn có thật; Excel: dòng lỗi ở dry-run)
 *
 * `epChonNguon` truyền vào PHẢI là giá trị đã tính theo cơ sở của dòng (`laEpChonNguon(orgUnitId)`).
 * Master tắt thì ép chọn vô nghĩa — nên hàng 1 thắng bất kể `epChonNguon`.
 */
export function cachXuLyNhanLa(p: { nguonBat: boolean; epChonNguon: boolean }): CachXuLyNhanLa {
  if (!p.nguonBat) return "KHONG_GHI_NGUON";
  return p.epChonNguon ? "CHAN_NHAP" : "UNKNOWN_XEM_TAY";
}

/** Module quản lý nguồn có đang bật không (toàn hệ). */
export async function laQuanLyNguonBat(): Promise<boolean> {
  return await getSetting(KHOA_NGUON.enabled);
}

/** Đọc năm cờ toàn hệ MỘT lượt (song song) rồi giải tổ hợp. */
export async function layCoNguonHieuLuc(): Promise<CoNguonTho> {
  const [enabled, autoAttribution, pageMapping, referral, manualReview] = await Promise.all([
    getSetting(KHOA_NGUON.enabled),
    getSetting(KHOA_NGUON.autoAttribution),
    getSetting(KHOA_NGUON.pageMapping),
    getSetting(KHOA_NGUON.referral),
    getSetting(KHOA_NGUON.manualReview),
  ]);
  return hopCoNguon({ enabled, autoAttribution, pageMapping, referral, manualReview });
}

/** Cờ con hiệu lực = master ∧ con. Chỉ đọc đúng HAI khoá cần, không đọc cả năm. */
async function conCoMaster(khoaCon: (typeof KHOA_NGUON)[TenCoCon]): Promise<boolean> {
  const [master, con] = await Promise.all([getSetting(KHOA_NGUON.enabled), getSetting(khoaCon)]);
  return master && con;
}

export const laTuDongGanNguonBat = () => conCoMaster(KHOA_NGUON.autoAttribution);
export const laPageMappingBat = () => conCoMaster(KHOA_NGUON.pageMapping);
export const laReferralBat = () => conCoMaster(KHOA_NGUON.referral);
export const laManualReviewBat = () => conCoMaster(KHOA_NGUON.manualReview);

/**
 * Ô nhập của cơ sở này có ÉP CHỌN nguồn không.
 *
 * @param orgUnitId `OrgUnit.id` của cơ sở của DÒNG đang nhập. BẮT BUỘC truyền (luật 7 — không mặc định);
 *   `null` ⇒ chỉ đọc giá trị toàn hệ (lead chưa gắn cơ sở).
 *
 * Master tắt ⇒ false dù cơ sở khai ép chọn (ép chọn vô nghĩa khi không ghi nguồn).
 * Override của cơ sở chạy CẢ HAI chiều (toàn hệ tắt + cơ sở bật = pilot; toàn hệ bật + cơ sở tắt = gỡ
 * một cơ sở khi sự cố).
 */
export async function laEpChonNguon(orgUnitId: string | null): Promise<boolean> {
  const [master, ep] = await Promise.all([
    getSetting(KHOA_NGUON.enabled),
    getSetting(KHOA_NGUON.epChonNguon, { orgUnitId }),
  ]);
  return master && ep;
}

/** Cửa sổ ghi công: số ngày kể từ lúc lead vào mà khoản thu còn sinh hoa hồng thu hút. */
export async function layCuaSoGhiCongNgay(): Promise<number> {
  return await getSetting(KHOA_NGUON.cuaSoGhiCongNgay);
}

/**
 * Nhóm nguồn khi CHỈ BIẾT "đây là nhân sự giới thiệu" mà không ai chọn rõ nhóm (luật `NV_GIOI_THIEU`, cột "Mã NV giới thiệu" của Excel, nhãn
 * `sale-form`). Khi người dùng CHỌN RÕ một nhóm — kể cả nhóm admin tạo kiểu nhân sự — nhóm đã chọn được giữ, setting này không đụng tới.
 * Vai của nhân sự KHÔNG chọn nhóm (chỉ là ảnh chụp `referrerRoleCode`).
 */
export async function layNhomNhanSuMacDinh(): Promise<string> {
  return await getSetting(KHOA_NGUON.nhomNhanSuMacDinh);
}

/** Bảng nguồn theo Page (pageId → nhóm nguồn [+ chiến dịch]). Tạm thời, cho tới khi có cột riêng (PR7). */
export async function layBangNguonTheoPage(): Promise<
  Record<string, { groupCode: string; campaignCode?: string }>
> {
  return await getSetting(KHOA_NGUON.bangNguonTheoPage);
}
