// lib/finance/feature.ts — NƠI DUY NHẤT ĐỌC CÔNG TẮC thu học phí linh hoạt.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI LÀ MỘT CHỖ, VÀ VÌ SAO PHẢI TRONG DB
//
// Tiền lệ đã đo: cờ `PAYMENT_LEDGER_V2` có trong `lib/flags.ts`, **0 đường gọi trong mã chạy
// thật**, và biến env **không tồn tại** trong 40 biến Production. Bật nó KHÔNG đổi hành vi gì —
// nó là một cờ chết trông y như một cờ sống. Pre-mortem T8 xếp việc lặp lại chuyện đó vào nhóm
// CHẶN GO-LIVE.
//
// Hai luật rút ra, và cả hai đều có lưới:
//   1. **Đọc ở đúng một hàm.** Rải `getSetting("billing.flexV1Enabled")` khắp nơi là mỗi chỗ tự
//      quyết định nghĩa của "bật", và tắt cờ sẽ tắt được 9 chỗ trong 10. Lưới: ca `[FEAT-03]`
//      quét mã nguồn, đếm số chỗ đọc khoá đó ngoài file này = 0.
//   2. **Cờ nằm trong DB, không trong env.** Người vận hành bật được, thấy được, và `AuditLog`
//      ghi ai bật lúc nào. Env thì phải qua dev + redeploy, và không ai biết nó đang bật.
//
// ─────────────────────────────────────────────────────────────────────────────
// HÌNH DẠNG CÔNG TẮC — chủ dự án chốt 16/09/2026
//
// *"nên để bật cho toàn hệ thống đồng loạt, nhưng sẽ có công tắc riêng cho từng cs."*
//
// Đúng hình dạng `SystemSetting` + `CenterSetting` đang có:
//   · `SystemSetting billing.flexV1Enabled` — công tắc CHÍNH, mặc định TẮT;
//   · `CenterSetting (orgUnitId, billing.flexV1Enabled)` — một cơ sở lệch khỏi công tắc chính.
//
// Nên override chạy được CẢ HAI chiều, và đó là chủ ý:
//   · toàn hệ TẮT + một cơ sở BẬT  ⇒ pilot đúng một cơ sở;
//   · toàn hệ BẬT + một cơ sở TẮT  ⇒ gỡ một cơ sở ra khi nó gặp sự cố, không phải tắt cả nhà.
//
// ⚠️ `orgUnitId`, KHÔNG phải `centerId`. `CenterSetting` khoá theo `OrgUnit.id`; truyền
// `Center.id` vào thì tra không ra dòng nào và hàm **âm thầm rơi về giá trị toàn hệ** — tức cờ
// riêng của cơ sở không có tác dụng mà không lỗi nào báo. Ánh xạ ở `lib/org/center-bridge.ts`.

import { getSetting } from "@/lib/settings/service";

export const KHOA_CONG_TAC = "billing.flexV1Enabled" as const;

/**
 * Thu học phí linh hoạt có đang bật cho cơ sở này không.
 *
 * @param orgUnitId `OrgUnit.id` của cơ sở. Bỏ trống / `null` ⇒ chỉ đọc công tắc toàn hệ.
 *
 * ⚠️ ĐỪNG gọi hàm này trong vòng lặp qua từng đơn. `getSetting` có cache theo request nhưng
 * cache đó khoá theo `(key, orgUnitId)`; một danh sách 200 đơn ở 2 cơ sở thì gọi 2 lần là đủ.
 */
export async function laThuTienLinhHoatBat(orgUnitId?: string | null): Promise<boolean> {
  return await getSetting(KHOA_CONG_TAC, { orgUnitId: orgUnitId ?? null });
}

/**
 * Có CƠ SỞ NÀO trong tầm nhìn của người này đang bật không.
 *
 * ⚠️ Chỉ dùng cho AFFORDANCE — quyết định có VẼ nút ra hay không ở màn danh sách, nơi chưa
 * biết tiền thuộc đơn nào nên chưa biết cơ sở nào. Cổng TIỀN vẫn phải hỏi
 * `laThuTienLinhHoatBat(orgUnitId của ĐƠN)`; hàm này rộng hơn, và rộng hơn ở đường ghi là lỗ.
 *
 * ⚠️ KHÔNG ngắt sớm bằng công tắc toàn hệ. Ca "toàn hệ BẬT + cơ sở này TẮT" có thật (chốt
 * 16/09: *"gỡ một cơ sở ra khi nó gặp sự cố"*), và ngắt sớm sẽ vẽ nút cho người của đúng cơ sở
 * vừa bị gỡ — affordance nói dối (luật 12). Hỏi từng cơ sở; `getSetting` tự rơi về toàn hệ khi
 * cơ sở không khai gì.
 *
 * Danh sách rỗng (người không neo ở cơ sở nào) ⇒ đọc công tắc toàn hệ.
 */
export async function coNoiNaoBatThuLinhHoat(
  orgUnitIds: readonly string[],
): Promise<boolean> {
  if (orgUnitIds.length === 0) return laThuTienLinhHoatBat(null);
  for (const id of orgUnitIds) {
    if (await laThuTienLinhHoatBat(id)) return true;
  }
  return false;
}

/**
 * Phép giải công tắc, tách riêng để test được KHÔNG CẦN DB.
 *
 * `getSetting` đã làm đúng phép này, nhưng nó chạm DB nên mọi ca kiểm "bật/tắt thế nào" sẽ phải
 * là test tích hợp — và test tích hợp thì không ai viết đủ ca. Hàm thuần dưới đây là chỗ các ca
 * đó sống, và nó phải KHỚP hành vi của `getSetting`: override của cơ sở thắng, không có override
 * thì rơi về toàn hệ.
 *
 * ⚠️ `undefined` và `null` KHÁC NHAU về nghĩa ở đây:
 *   · `undefined` = cơ sở KHÔNG khai gì ⇒ theo toàn hệ;
 *   · `false`     = cơ sở khai TẮT      ⇒ tắt, dù toàn hệ đang bật.
 * Gộp hai thứ đó (vd bằng `??` trên một giá trị đã bị ép sang boolean) là làm mất khả năng gỡ
 * một cơ sở ra khỏi tính năng — đúng ca vận hành mà công tắc riêng sinh ra để phục vụ.
 */
export function giaiCongTac(input: {
  toanHe: boolean;
  /** `undefined` = cơ sở không khai gì. */
  coSo?: boolean | undefined;
}): boolean {
  return input.coSo === undefined ? input.toanHe === true : input.coSo === true;
}
