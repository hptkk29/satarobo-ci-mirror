// @vitest-environment node
/**
 * KHUÔN ADAPTER TẮT-AN-TOÀN — spec §2.2, bốn luật AD-1..AD-4.
 *
 * Đây là chỗ mà một lỗi KHÔNG văng ra ngoài: gửi nhầm hàng loạt tin thật cho phụ
 * huynh không có thông báo lỗi nào, và ngược lại "báo đã gửi trong khi chưa gửi"
 * cũng không có thông báo lỗi nào. Cả hai chỉ lộ ra khi có người khiếu nại.
 *
 * Mỗi ca dưới đây kiểm đúng MỘT thứ: khi thiếu thông tin thì hệ thống phải nghiêng
 * về KHÔNG GỬI, và phải NÓI THẬT là chưa gửi.
 */
import { describe, it, expect } from "vitest";
import { resolveSendMode } from "@/lib/integrations/fail-safe";

const live = () => Promise.resolve(true);

describe("[AD-1] thiếu khoá kết nối ⇒ mô phỏng, KHÔNG ném lỗi", () => {
  it("chưa cấu hình ⇒ NOT_CONFIGURED, và không đọc công tắc nữa", async () => {
    // Đọc công tắc khi chưa có khoá là tốn một vòng DB cho một câu trả lời không
    // dùng được. Quan trọng hơn: nếu công tắc bật mà khoá thiếu thì nhánh "live"
    // sẽ gọi API với credential rỗng — hỏng theo kiểu khó đọc.
    let daDoc = false;
    const mode = await resolveSendMode({
      configured: false,
      readLive: async () => {
        daDoc = true;
        return true;
      },
    });
    expect(mode).toEqual({ live: false, reason: "NOT_CONFIGURED" });
    expect(daDoc).toBe(false);
  });

  it("chưa cấu hình ⇒ resolve chứ KHÔNG reject", async () => {
    await expect(
      resolveSendMode({ configured: false, readLive: live }),
    ).resolves.toBeDefined();
  });
});

describe("[AD-2] đọc công tắc lỗi ⇒ coi như KHÔNG live (fail-closed)", () => {
  it("readLive ném lỗi ⇒ SETTING_UNREADABLE, không phải live", async () => {
    // Thà không gửi còn hơn gửi nhầm hàng loạt. DB sập không được biến thành
    // "mặc định gửi thật".
    const mode = await resolveSendMode({
      configured: true,
      readLive: async () => {
        throw new Error("DB sập");
      },
    });
    expect(mode).toEqual({ live: false, reason: "SETTING_UNREADABLE" });
  });

  it("công tắc trả giá trị KHÔNG phải boolean ⇒ cũng là SETTING_UNREADABLE", async () => {
    // Setting bị ghi sai kiểu (chuỗi "false", null, undefined) từng là cách kinh
    // điển để một cờ tắt bị đọc thành bật: `if (v)` với chuỗi "false" là TRUE.
    for (const v of ["true", "false", 1, 0, null, undefined, {}]) {
      const mode = await resolveSendMode({
        configured: true,
        readLive: async () => v,
      });
      expect(mode, `giá trị ${JSON.stringify(v)}`).toEqual({
        live: false,
        reason: "SETTING_UNREADABLE",
      });
    }
  });
});

describe("[AD-3] chưa live ⇒ mô phỏng, KHÔNG gọi API", () => {
  it("công tắc = false ⇒ LIVE_OFF", async () => {
    const mode = await resolveSendMode({ configured: true, readLive: async () => false });
    expect(mode).toEqual({ live: false, reason: "LIVE_OFF" });
  });

  it("đủ khoá + công tắc = true ⇒ live", async () => {
    const mode = await resolveSendMode({ configured: true, readLive: live });
    expect(mode).toEqual({ live: true });
  });
});

describe("nhãn giải thích cho người dùng", () => {
  it("mọi lý do mô phỏng đều nói rõ CHƯA gửi tới khách", async () => {
    // Câu chữ là một phần của hợp đồng: bài học `messenger-send-gate.ts` là người
    // trực tin mình đã trả lời khách. Nhãn mơ hồ ("đang xử lý") tái tạo đúng lỗi đó.
    const { LY_DO_MO_PHONG } = await import("@/lib/integrations/types");
    for (const [ly, cau] of Object.entries(LY_DO_MO_PHONG)) {
      expect(cau, ly).toMatch(/CHƯA gửi/);
    }
  });
});
