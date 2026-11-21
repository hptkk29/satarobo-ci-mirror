/**
 * Đẩy đồng hồ hệ thống lên `DAY_OFFSET` ngày để lộ **bom hẹn giờ ngày cứng** trong test.
 *
 * ══ Họ lỗi này là gì ══
 *
 * Test dựng ngày CỨNG (`utc(2026, 9, 11)`) rồi gọi một hàm sản phẩm có cổng so ngày đó với
 * "hôm nay" (`input.now ?? new Date()`). Ngày cứng ở tương lai thì ca xanh; tới lúc ngày
 * thật vượt qua nó, ca **đỏ mãi mãi**.
 *
 * Đã xảy ra 13/09/2026 với `tests/cham-cong/requests.spec.ts > LEAVE 2 ngày duyệt`. Đo trên
 * CÙNG một commit (`main` 507ff13b): CI ngày 10/09 XANH, rerun ngày 13/09 ĐỎ.
 *
 * Khác bug múi giờ ở một điểm quyết định: bom ngày cứng nổ **một chiều**. Bug TZ có cửa sổ
 * giờ nên tự xanh lại lúc khác trong ngày; cái này thì không, và vì thế người ta học cách
 * bỏ qua bộ test đỏ — rồi bỏ qua luôn lần nó đỏ THẬT.
 *
 * ══ Vì sao chỉ fake `Date` ══
 *
 * `toFake: ["Date"]` + `shouldAdvanceTime: true`: fake cả `setTimeout` sẽ treo mọi ca có
 * chờ đợi, và ta sẽ không phân biệt được "treo vì fake timer" với "đỏ vì bom" — đúng loại
 * nhiễu làm cổng mất giá trị.
 *
 * ══ Giới hạn ══
 *
 * Chỉ phủ bộ **Vitest**. Playwright chạy tiến trình riêng nên `vi.useFakeTimers` không tới.
 * Khoảng hở đó KHÔNG bỏ ngỏ: rule ESLint `thoigian/require-now-in-tests` chặn theo HÌNH DẠNG
 * lời gọi nên phủ cả `.spec.ts` của Playwright mà không cần chạy chúng.
 */
import { vi, beforeAll, afterAll } from "vitest";

const NGAY = Number(process.env.DAY_OFFSET ?? "90");

beforeAll(() => {
  if (!Number.isFinite(NGAY) || NGAY === 0) return;
  vi.useFakeTimers({
    toFake: ["Date"],
    shouldAdvanceTime: true,
    now: Date.now() + NGAY * 86_400_000,
  });
});

afterAll(() => {
  vi.useRealTimers();
});
