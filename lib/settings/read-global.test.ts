/**
 * Nhịp làm mới nhớ đệm của tham số vận hành.
 *
 * ── VÌ SAO CÓ BỘ NÀY ─────────────────────────────────────────────────────────────────────
 * Đây là loại tham số mà sửa sai thì KHÔNG có gì đỏ và không ai biết: đổi `revalidate` từ 30
 * về 300 chỉ làm cửa sổ mất thông báo rộng ra gấp mười, còn mọi ca test hành vi vẫn xanh.
 *
 * Cửa sổ đó có thật: `clearSettingsCache()` ở đường ghi chỉ xoá nhớ đệm của TIẾN TRÌNH đang
 * chạy, nên trên Vercel một nhánh lambda khác còn xét theo danh sách CŨ tới hết `revalidate`
 * giây. Với `push.tienToDuocDay` thì một thông báo rơi vào cửa sổ ấy bị `lib/push/outbox.ts`
 * chốt thẳng `SKIPPED` — trạng thái CUỐI — nên mất vĩnh viễn, im lặng.
 *
 * Bộ này khoá hai thứ: nhịp ngắn áp cho ĐÚNG các khoá push, và hai nhịp phải KHÁC nhau.
 */
import { describe, expect, it } from "vitest";
import { NHIP_MAC_DINH_GIAY, NHIP_PUSH_GIAY, nhipNganChoKhoa } from "./read-global";

describe("[CFG-T20] nhịp làm mới nhớ đệm", () => {
  it("khoá push đi đường nhịp NGẮN", () => {
    expect(nhipNganChoKhoa("push.tienToDuocDay")).toBe(true);
    expect(nhipNganChoKhoa("push.webPushEnabled")).toBe(true);
  });

  it("khoá khác đi đường nhịp mặc định", () => {
    // Nhịp ngắn tốn thêm lượt đọc DB; chỉ đáng cho khoá mà đọc chậm gây MẤT dữ liệu.
    for (const k of [
      "zalo.znsLive",
      "shift.toleranceMinutes",
      "crm.commissionMaxTotalRate",
      "orgScope.cutoverEnabled",
      "student.nearEndThreshold",
    ]) {
      expect(nhipNganChoKhoa(k), k).toBe(false);
    }
  });

  it("⚠️ nhịp push phải NGẮN HƠN HẲN nhịp mặc định", () => {
    // Đặt bằng nhau là xoá sạch tác dụng của bản vá mà không ca nào khác đỏ.
    expect(NHIP_PUSH_GIAY).toBeLessThan(NHIP_MAC_DINH_GIAY);
    expect(NHIP_PUSH_GIAY * 5).toBeLessThanOrEqual(NHIP_MAC_DINH_GIAY);
  });

  it("nhịp push không được bằng 0 — bỏ hẳn nhớ đệm là mỗi lượt ghi thông báo thêm một lượt đọc DB", () => {
    expect(NHIP_PUSH_GIAY).toBeGreaterThan(0);
  });
});
