// @vitest-environment node
/**
 * GHI SỔ MỘT LƯỢT GỬI — luật AD-4 của spec §2.2, và bài học SLA của Messenger.
 *
 * Repo đang có HAI cách xử lý "mô phỏng" khác nhau, và chép nhầm nhánh là biến số
 * liệu nghiệm thu thành số giả:
 *   ĐÚNG  `lib/chat/zns-notify.ts:417-420` — ghi trạng thái SIMULATED vào sổ.
 *   SAI   `lib/notify/attendance.ts:123-125` — log cảnh báo rồi VẪN set `notifiedAt`.
 *
 * Và bài học đắt hơn, đã xảy ra thật: `recordOutgoingMessage` set `respondedAt` mỗi
 * lần bấm "Gửi", mà `lib/crm/sla.ts` đọc đúng cột đó để bật cảnh báo chậm phản hồi
 * ⇒ mỗi lần gửi hụt là TẮT cảnh báo của một khách chưa ai trả lời.
 */
import { describe, it, expect } from "vitest";
import { ketQuaGuiToSoGhi } from "@/lib/inbox/send-rules";

describe("gửi thành công", () => {
  it("SENT ⇒ lưu id nhà cung cấp, và TÍNH là đã trả lời khách", () => {
    expect(ketQuaGuiToSoGhi({ status: "SENT", providerMessageId: "mid_1" })).toEqual({
      deliveryStatus: "SENT",
      providerMessageId: "mid_1",
      errorCode: null,
      daTraLoiKhach: true,
    });
  });
});

describe("🔴 mọi nhánh KHÔNG tới khách đều KHÔNG được tính là đã trả lời", () => {
  const khongToiKhach = [
    { ten: "mô phỏng vì chưa cấu hình", o: { status: "SIMULATED", reason: "NOT_CONFIGURED" } },
    { ten: "mô phỏng vì tắt live", o: { status: "SIMULATED", reason: "LIVE_OFF" } },
    { ten: "mô phỏng vì không đọc nổi công tắc", o: { status: "SIMULATED", reason: "SETTING_UNREADABLE" } },
    { ten: "kênh không gửi ra được", o: { status: "SKIPPED", errorCode: "KENH_KHONG_GUI_DUOC_MANUAL" } },
    { ten: "nhà cung cấp từ chối", o: { status: "FAILED", errorCode: "META_ERR_100" } },
  ] as const;

  for (const c of khongToiKhach) {
    it(`${c.ten} ⇒ daTraLoiKhach = false`, () => {
      const so = ketQuaGuiToSoGhi(c.o);
      expect(so.daTraLoiKhach).toBe(false);
      expect(so.providerMessageId).toBeNull();
    });
  }

  it("lý do mô phỏng được giữ làm mã lỗi, không bị nuốt", () => {
    // Không giữ lý do thì màn hình chỉ nói "chưa gửi" mà không nói vì sao, và
    // người dùng không biết phải gọi quản trị hay chờ.
    expect(
      ketQuaGuiToSoGhi({ status: "SIMULATED", reason: "LIVE_OFF" }).errorCode,
    ).toBe("LIVE_OFF");
  });

  it("trạng thái sổ khớp đúng nhánh, KHÔNG gộp hết vào FAILED", () => {
    // Gộp "chưa bật live" chung rổ với "Meta từ chối" là mất khả năng đọc số liệu:
    // một bên là quyết định vận hành, một bên là sự cố.
    expect(ketQuaGuiToSoGhi({ status: "SIMULATED", reason: "LIVE_OFF" }).deliveryStatus)
      .toBe("SIMULATED");
    expect(
      ketQuaGuiToSoGhi({ status: "SKIPPED", errorCode: "X" }).deliveryStatus,
    ).toBe("SKIPPED");
    expect(
      ketQuaGuiToSoGhi({ status: "FAILED", errorCode: "X" }).deliveryStatus,
    ).toBe("FAILED");
  });
});
