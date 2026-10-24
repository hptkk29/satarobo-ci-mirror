// @vitest-environment node
//
// Ca [HDR-01] — hai sự kiện của hoá đơn điện tử THẬT SỰ có handler sau khi hệ đăng ký chạy.
//
// Vì sao cần ca này bên cạnh lưới `lib/events/khop-phat-nghe.test.ts`: lưới đó đọc CHUỖI `on("…")`
// trong mã nguồn — nó thấy `on("hoa-don.gui", …)` trong `gui-email.ts` kể cả khi KHÔNG ai gọi
// `registerHoaDonHandlers()`. Cấy thử 26/09: xoá lời gọi trong `lib/events/register.ts` ⇒ lưới vẫn
// xanh, trong khi mọi hoá đơn chốt xong nằm CHỜ mãi và không khách nào nhận email. Ca này đo HÀNH VI:
// chạy đúng hàm dispatcher gọi, rồi hỏi registry.
import { describe, expect, it } from "vitest";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { getHandlers } from "@/lib/events/registry";

describe("[HDR-01] handler hoá đơn được đăng ký", () => {
  it("sau ensureHandlersRegistered() ⇒ `hoa-don.gui` và `hoa-don.khong-email` đều có người nghe", () => {
    ensureHandlersRegistered();
    expect(getHandlers("hoa-don.gui").length).toBeGreaterThan(0);
    expect(getHandlers("hoa-don.khong-email").length).toBeGreaterThan(0);
  });
});

describe("[HDR-02] GĐ 8 — email hỏng hẳn có người nghe", () => {
  it("sau ensureHandlersRegistered() ⇒ `hoa-don.gui-loi` có handler", () => {
    ensureHandlersRegistered();
    expect(getHandlers("hoa-don.gui-loi").length).toBeGreaterThan(0);
  });
});
