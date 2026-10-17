// Đường đọc "loại nào được đẩy" từ tham số vận hành.
//
// Bộ này canh đúng MỘT tính chất, và nó là tính chất đắt nhất của cả module: khi không đọc
// được cấu hình thì hệ thống phải im, và phải NÓI được là mình đang im vì lý do gì.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getGlobalSetting: vi.fn() }));
vi.mock("@/lib/settings/read-global", () => ({ getGlobalSetting: h.getGlobalSetting }));

import { docTienToDuocDay, LY_DO_NGOAI_DANH_SACH } from "./cau-hinh-allowlist";

beforeEach(() => {
  h.getGlobalSetting.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("[PUSH-D7-T21] docTienToDuocDay", () => {
  it("đọc được ⇒ trả đúng danh sách, docDuoc = true", async () => {
    h.getGlobalSetting.mockResolvedValue(["lead.moi:", "sla:"]);
    expect(await docTienToDuocDay()).toEqual({ tienTo: ["lead.moi:", "sla:"], docDuoc: true });
    expect(h.getGlobalSetting).toHaveBeenCalledWith("push.tienToDuocDay");
  });

  it("danh sách rỗng là một câu trả lời HỢP LỆ — docDuoc vẫn true", async () => {
    // Phân biệt "người vận hành tắt hết" với "không đọc được" là toàn bộ lý do tồn tại của cờ
    // `docDuoc`. Gộp hai thứ này thì engine sẽ thoát cả lượt mỗi khi ai đó cố tình tắt hết,
    // và log cron đầy lỗi giả.
    h.getGlobalSetting.mockResolvedValue([]);
    expect(await docTienToDuocDay()).toEqual({ tienTo: [], docDuoc: true });
  });

  it("NÉM ⇒ rỗng + docDuoc = false, KHÔNG ném ra ngoài", async () => {
    // Nơi gọi là `notifyStaff` — đường ghi của MỌI thông báo nhân sự. Ném ở đây là làm hỏng
    // điểm danh, giao bài, chuyển lead.
    h.getGlobalSetting.mockRejectedValue(new Error("P1001"));
    await expect(docTienToDuocDay()).resolves.toEqual({ tienTo: [], docDuoc: false });
  });

  it("KHÔNG rơi về mặc định khi đọc hỏng", async () => {
    // Rơi về `["lead.moi:"]` lúc DB chập nghe rất hợp lý và rất sai: nếu người vận hành vừa
    // TẮT loại đó đi thì một cú chập DB sẽ bật nó lại — hệ thống gửi thứ vừa bị cấm gửi.
    h.getGlobalSetting.mockRejectedValue(new Error("P1001"));
    const kq = await docTienToDuocDay();
    expect(kq.tienTo).toEqual([]);
    expect(kq.tienTo).not.toContain("lead.moi:");
  });

  it("giá trị KHÔNG phải mảng ⇒ rỗng + docDuoc = false", async () => {
    // Dòng cũ trong DB có thể mang hình dạng khác (ghi trước khi schema siết, hoặc sửa tay).
    for (const v of [null, undefined, "lead.moi:", 42, { a: 1 }]) {
      h.getGlobalSetting.mockResolvedValue(v);
      expect(await docTienToDuocDay(), String(v)).toEqual({ tienTo: [], docDuoc: false });
    }
  });

  it("⚠️ lọc bỏ phần tử RỖNG — một chuỗi rỗng lọt vào là mở toang mọi loại", async () => {
    // `"x".startsWith("")` luôn đúng. Registry đã chặn ở đường GHI, nhưng đường ĐỌC phải tự
    // lo: dòng trong DB có thể được ghi trước khi schema siết, hoặc bằng SQL tay.
    h.getGlobalSetting.mockResolvedValue(["", "lead.moi:", ""]);
    expect(await docTienToDuocDay()).toEqual({ tienTo: ["lead.moi:"], docDuoc: true });
  });

  it("lọc bỏ phần tử không phải chuỗi, giữ phần còn lại", async () => {
    h.getGlobalSetting.mockResolvedValue(["lead.moi:", 7, null, "sla:"]);
    expect((await docTienToDuocDay()).tienTo).toEqual(["lead.moi:", "sla:"]);
  });

  it("lý do ghi vào sổ là một câu người đọc hiểu được, không phải mã lỗi", async () => {
    // `lastError` này là thứ DUY NHẤT trả lời câu "vì sao tôi không nhận được thông báo X".
    expect(LY_DO_NGOAI_DANH_SACH.length).toBeGreaterThan(10);
    expect(LY_DO_NGOAI_DANH_SACH).not.toMatch(/undefined|null|\[object/);
  });
});
