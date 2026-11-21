// @vitest-environment node
//
// Ca [HDH-*] — handler sự kiện `hoa-don.gui` hỏi CỜ trước khi giành lượt (GĐ 8, quyết định (3) 27/09).
// Bản chạm DB của `giuLuotGuiHoaDon(…, { hoaDonBat })` ở `tests/finance/hoa-don-email.test.ts` [HDE-08];
// ở đây đo DÂY NỐI: handler thật (đăng ký qua `registerHoaDonHandlers`) truyền đúng giá trị cờ, và cờ
// TẮT thì không mở transaction nào — lượt nằm nguyên CHO, sự kiện xong, bật lại thì đối soát gửi.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  tx: vi.fn(async () => "bo-qua"),
  handlers: new Map<string, (e: unknown) => Promise<void>>(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: h.tx } }));
vi.mock("./feature", () => ({ laHoaDonBat: h.bat }));
vi.mock("@/lib/events/registry", () => ({
  on: (type: string, fn: (e: unknown) => Promise<void>) => void h.handlers.set(type, fn),
}));
vi.mock("@/lib/email/queue", () => ({ enqueueEmail: vi.fn() }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: vi.fn() }));
vi.mock("./dinh-kem-email", () => ({ NGU_CANH_EMAIL_HOA_DON: "HoaDonGuiEmail" }));

import { registerHoaDonHandlers } from "./gui-email";

registerHoaDonHandlers();
const chay = () => h.handlers.get("hoa-don.gui")!({ payload: { guiId: "g1" } });

beforeEach(() => vi.clearAllMocks());

describe("[HDH-01] handler `hoa-don.gui` hỏi cờ hoá đơn", () => {
  it("cờ TẮT ⇒ KHÔNG mở transaction (không giành CHO→DANG_GUI, không xếp hàng)", async () => {
    h.bat.mockResolvedValue(false);
    await chay();
    expect(h.bat).toHaveBeenCalledTimes(1);
    expect(h.tx).not.toHaveBeenCalled();
  });

  it("đối chứng: cờ BẬT ⇒ giành lượt trong transaction", async () => {
    h.bat.mockResolvedValue(true);
    await chay();
    expect(h.tx).toHaveBeenCalledTimes(1);
  });
});
