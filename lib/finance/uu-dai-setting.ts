// lib/finance/uu-dai-setting.ts — NƠI DUY NHẤT ĐỌC CHÍNH SÁCH ƯU ĐÃI ANH EM từ tham số vận hành.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN F3 · 22/09/2026. Chủ dự án chốt: *"làm cho quản lý tự cài đặt cho phần này trên hệ
// thống"* — nên chính sách nằm ở sáu tham số vận hành, không nằm trong mã.
//
// Tệp này chỉ làm một việc: gom sáu tham số đó thành MỘT ảnh chụp `ChinhSachUuDai`.
//
// ⚠️ **Đúng một chỗ đọc**, cùng lý lẽ với `lib/finance/feature.ts` (và có lưới y như
// `[FEAT-03]`): rải `getSetting("billing.sibling…")` khắp nơi là mỗi chỗ tự quyết định nghĩa
// của chính sách, và quản lý đổi một mức % sẽ đổi được 9 chỗ trong 10. Lưới `[UDS-02]` quét
// mã nguồn, đếm số chỗ đọc sáu khoá đó ngoài tệp này = 0.
//
// ⚠️ **Sáu lời gọi, KHÔNG phải một.** `getSetting` có cache theo request nên chi phí là một
// lượt tra DB cho cả sáu; đừng "tối ưu" bằng cách gộp thành một khoá JSON. Một khoá JSON là
// một ô `<textarea>` trên màn cấu hình, và quản lý sẽ phải gõ dấu ngoặc — đúng thứ trang cấu
// hình bản mới sinh ra để bỏ đi.
import "server-only";
import { getSetting } from "@/lib/settings/service";
import {
  type CachHapThu,
  type ChinhSachUuDai,
  type DoiTuongUuDai,
} from "@/lib/orders/chinh-sach-uu-dai";

/**
 * Chính sách ưu đãi anh em đang hiệu lực cho một cơ sở.
 *
 * @param orgUnitId `OrgUnit.id` của cơ sở. Bỏ trống / `null` ⇒ chỉ đọc mức toàn hệ.
 *
 * ⚠️ `orgUnitId`, KHÔNG phải `Center.id`. `CenterSetting` khoá theo `OrgUnit.id`; truyền
 * `Center.id` vào thì tra không ra dòng nào và hàm **âm thầm rơi về mức toàn hệ** — tức
 * chính sách riêng của cơ sở không có tác dụng mà không lỗi nào báo. Ánh xạ ở
 * `lib/org/center-bridge.ts`. Cùng cái bẫy đã ghi ở `lib/finance/feature.ts`.
 *
 * ⚠️ ĐỪNG gọi trong vòng lặp qua từng đơn: cache của `getSetting` khoá theo
 * `(key, orgUnitId)`, nên một danh sách 200 đơn ở 2 cơ sở chỉ cần gọi 2 lần.
 */
export async function docChinhSachUuDai(orgUnitId?: string | null): Promise<ChinhSachUuDai> {
  const o = { orgUnitId: orgUnitId ?? null };
  const [tuDong, phanTramConThu2, phanTramConThu3, doiTuong, congDonDongFull, hapThu] =
    await Promise.all([
      getSetting("billing.siblingAutoEnabled", o),
      getSetting("billing.siblingPercentSecond", o),
      getSetting("billing.siblingPercentThird", o),
      getSetting("billing.siblingTarget", o),
      getSetting("billing.siblingStacksFullPay", o),
      getSetting("billing.lateDiscountAbsorb", o),
    ]);

  return {
    tuDong,
    phanTramConThu2,
    phanTramConThu3,
    // `getSetting` đã trả về kiểu suy từ `z.enum` của registry, nên hai ép kiểu dưới đây
    // không nới lỏng gì — chúng chỉ nối hai khai báo `enum` độc lập (một ở registry, một ở
    // `chinh-sach-uu-dai.ts`) mà lưới `[CFG-T05]` đã buộc phải khớp khít.
    doiTuong: doiTuong as DoiTuongUuDai,
    congDonDongFull,
    hapThu: hapThu as CachHapThu,
  };
}
