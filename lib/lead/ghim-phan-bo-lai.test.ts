// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chiaTrangCoGhim, conGhim } from "./ghim-phan-bo-lai";

const T = (iso: string) => new Date(`2026-10-${iso}T03:00:00.000Z`);

describe("[GHIM-01] conGhim — còn chờ chăm ⇔ lastActivityAt <= phanBoLaiNguoiAt", () => {
  it("chưa từng bị phân bổ lại ⇒ không ghim", () => {
    expect(conGhim({ phanBoLaiNguoiAt: null, lastActivityAt: T("20") })).toBe(false);
  });

  it("vừa phân bổ: lastActivityAt đúng bằng mốc (dòng ghi chú đặt cả hai) ⇒ ghim", () => {
    expect(conGhim({ phanBoLaiNguoiAt: T("27"), lastActivityAt: T("27") })).toBe(true);
  });

  it("lastActivityAt rỗng ⇒ vẫn ghim (đừng loại đúng lead chưa ai đụng)", () => {
    expect(conGhim({ phanBoLaiNguoiAt: T("27"), lastActivityAt: null })).toBe(true);
  });

  it("⚠️ Sale chăm lại (hoạt động SAU mốc) ⇒ hết ghim, không ai phải gỡ tay", () => {
    expect(conGhim({ phanBoLaiNguoiAt: T("27"), lastActivityAt: T("28") })).toBe(false);
  });

  it("hoạt động CŨ hơn mốc không làm mất ghim", () => {
    expect(conGhim({ phanBoLaiNguoiAt: T("27"), lastActivityAt: T("01") })).toBe(true);
  });
});

describe("[GHIM-02] chiaTrangCoGhim — ghim trước, thường sau, không rơi/lặp dòng", () => {
  const mo = (tongGhim: number, trang: number, soDong = 10) =>
    chiaTrangCoGhim({ tongGhim, trang, soDong });

  it("không có ghim ⇒ cả trang lấy từ danh sách thường, đúng offset cũ", () => {
    expect(mo(0, 1)).toEqual({ ghim: { tu: 0, den: 0 }, thuong: { bo: 0, lay: 10 } });
    expect(mo(0, 3)).toEqual({ ghim: { tu: 0, den: 0 }, thuong: { bo: 20, lay: 10 } });
  });

  it("ít ghim hơn một trang ⇒ ghim đứng đầu trang 1, phần dư lấy từ thường", () => {
    expect(mo(3, 1)).toEqual({ ghim: { tu: 0, den: 3 }, thuong: { bo: 0, lay: 7 } });
  });

  it("⚠️ trang 2 bỏ đúng số dòng thường đã dùng ở trang 1 (không lặp, không rơi)", () => {
    // Trang 1 lấy 3 ghim + 7 thường (thường #0–6) ⇒ trang 2 phải bắt đầu ở thường #7.
    expect(mo(3, 2)).toEqual({ ghim: { tu: 3, den: 3 }, thuong: { bo: 7, lay: 10 } });
  });

  it("nhiều ghim hơn một trang ⇒ trang 1 toàn ghim, trang 2 ghim nốt rồi mới tới thường", () => {
    expect(mo(15, 1)).toEqual({ ghim: { tu: 0, den: 10 }, thuong: { bo: 0, lay: 0 } });
    expect(mo(15, 2)).toEqual({ ghim: { tu: 10, den: 15 }, thuong: { bo: 0, lay: 5 } });
    expect(mo(15, 3)).toEqual({ ghim: { tu: 15, den: 15 }, thuong: { bo: 5, lay: 10 } });
  });

  it("mọi trang cộng lại phủ đúng một lần: ghim rồi thường liền mạch", () => {
    const tongGhim = 13;
    let ghimDaLay = 0;
    let thuongDaLay = 0;
    for (let trang = 1; trang <= 4; trang++) {
      const c = mo(tongGhim, trang);
      expect(c.ghim.tu).toBe(ghimDaLay);
      expect(c.thuong.bo).toBe(thuongDaLay);
      ghimDaLay = c.ghim.den;
      thuongDaLay += c.thuong.lay;
    }
    expect(ghimDaLay).toBe(tongGhim);
    expect(thuongDaLay).toBe(4 * 10 - tongGhim);
  });
});
