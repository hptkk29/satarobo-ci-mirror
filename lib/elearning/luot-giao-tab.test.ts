// @vitest-environment node
/** [LGT-*] "Lượt giao đã đóng" suy từ trạng thái ghi danh — hàm thuần. */
import { describe, expect, it } from "vitest";
import { cauLyDoDong, tongHopLuotGiao } from "./luot-giao-tab";

describe("[LGT-01] tongHopLuotGiao", () => {
  it("còn người đang học/chưa bắt đầu/quá hạn ⇒ ĐANG MỞ (kể cả hạn chung đã qua — đó là việc cần xử lý, không phải đã đóng)", () => {
    expect(tongHopLuotGiao("ACTIVE", { COMPLETED: 3, IN_PROGRESS: 1 }).daDong).toBe(false);
    expect(tongHopLuotGiao("ACTIVE", { COMPLETED: 3, OVERDUE: 1 }).daDong).toBe(false);
    expect(tongHopLuotGiao("ACTIVE", { NOT_STARTED: 2 }).daDong).toBe(false);
  });
  it("mọi người đã hoàn thành/thu hồi ⇒ ĐÃ ĐÓNG (XONG_HET) kèm số đạt/trễ", () => {
    const l = tongHopLuotGiao("ACTIVE", { COMPLETED: 41, COMPLETED_LATE: 3, REVOKED: 2 });
    expect(l).toMatchObject({ daDong: true, lyDoDong: "XONG_HET", soDat: 41, soTre: 3, soNguoi: 46, soConHoatDong: 0 });
    expect(cauLyDoDong(l)).toBe("Mọi người đã xong: 41 đạt · 3 trễ");
  });
  it("lượt giao KHÔNG có người nhận nào ⇒ chưa phải 'đã đóng' (không bao giờ đóng một lượt giao trống)", () => {
    expect(tongHopLuotGiao("ACTIVE", {}).daDong).toBe(false);
  });
  it("status ≠ ACTIVE ⇒ ĐÃ ĐÓNG (THU_HOI) dù còn người đang học", () => {
    const l = tongHopLuotGiao("REVOKED", { IN_PROGRESS: 2 });
    expect(l).toMatchObject({ daDong: true, lyDoDong: "THU_HOI" });
    expect(cauLyDoDong(l)).toBe("Đã thu hồi cả lượt giao");
  });
  it("lượt giao đang mở không có câu lý do đóng; số quá hạn lấy đúng OVERDUE", () => {
    const l = tongHopLuotGiao("ACTIVE", { OVERDUE: 4, IN_PROGRESS: 1 });
    expect(cauLyDoDong(l)).toBeNull();
    expect(l.soQuaHan).toBe(4);
  });
});
