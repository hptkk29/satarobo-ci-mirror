import { describe, expect, it } from "vitest";
import { laMaXoayDoiCu, makeStaticKioskToken, verifyStaticKioskToken } from "./kiosk-token";

describe("mã TĨNH in ra — họ mã DUY NHẤT từ 07/09/2026", () => {
  const S = "x".repeat(40);

  it("ký và kiểm được, mang đúng điểm chấm công và đời khoá", () => {
    const t = makeStaticKioskToken("wl-1", 3, S);
    const v = verifyStaticKioskToken(t, S);
    expect(v.ok && v.workLocationId).toBe("wl-1");
    expect(v.ok && v.keyVersion).toBe(3);
  });

  it("KHÔNG hết hạn — đó là cả điểm của mã in ra", () => {
    const t = makeStaticKioskToken("wl-1", 1, S);
    // Không có khái niệm thời gian trong chữ ký ⇒ không có gì để hết hạn. Cách duy nhất giết một
    // tờ mã là tăng đời khoá.
    expect(verifyStaticKioskToken(t, S).ok).toBe(true);
  });

  it("đổi ĐỜI KHOÁ là mọi tờ đã in chết — cách duy nhất thu hồi mã", () => {
    const cu = makeStaticKioskToken("wl-1", 1, S);
    const moi = makeStaticKioskToken("wl-1", 2, S);
    expect(cu).not.toBe(moi);
    // Chữ ký của tờ cũ vẫn hợp lệ về mặt crypto — nó mang version 1. Việc từ chối là của
    // `checkin-gate` khi so với `WorkLocation.qrKeyVersion` hiện tại.
    const v = verifyStaticKioskToken(cu, S);
    expect(v.ok && v.keyVersion).toBe(1);
  });

  it("sai khoá ký / sửa chữ ký ⇒ từ chối", () => {
    const t = makeStaticKioskToken("wl-1", 1, S);
    expect(verifyStaticKioskToken(t, "y".repeat(40)).ok).toBe(false);
    expect(verifyStaticKioskToken(t.slice(0, -1) + "Z", S).ok).toBe(false);
  });

  it("đổi điểm chấm công trong mã ⇒ chữ ký hỏng (không mượn được mã của quầy khác)", () => {
    const t = makeStaticKioskToken("wl-1", 1, S);
    const gia = t.replace("wl-1", "wl-2");
    expect(verifyStaticKioskToken(gia, S).ok).toBe(false);
  });

  it("dạng lạ ⇒ FORMAT, không ném lỗi", () => {
    for (const x of ["", "a.b", "a.b.c.d", "wl.vX.sig", "wl.v0.sig", "wl.1.sig"]) {
      expect(verifyStaticKioskToken(x, S).ok).toBe(false);
    }
  });

  it("nhận ra mã ĐỜI CŨ để báo đúng lý do, không lẫn với mã rác", () => {
    // Mã xoay đã gỡ (07/09) nhưng ảnh chụp màn TV cũ vẫn còn trong máy người ta. Cổng vào phân
    // biệt bằng chỗ này để nói "mã đời cũ đã ngừng dùng" thay vì "mã không hợp lệ" — người cầm
    // ảnh cũ cần được bảo đi quét tờ mới, chứ báo chung chung thì họ đứng bấm lại.
    expect(laMaXoayDoiCu("wl-1.29051730.abcdef")).toBe(true);
    expect(laMaXoayDoiCu(makeStaticKioskToken("wl-1", 1, S))).toBe(false);
    for (const x of ["", "a.b", "a.b.c.d", "wl.xyz.sig"]) expect(laMaXoayDoiCu(x)).toBe(false);
  });

  it("mã tĩnh KHÔNG bị nhận nhầm là mã đời cũ dù đời khoá là số", () => {
    // `v12` phải đọc là "đời khoá 12", không phải "cửa sổ thời gian 12".
    expect(laMaXoayDoiCu(makeStaticKioskToken("wl-1", 12, S))).toBe(false);
    expect(verifyStaticKioskToken(makeStaticKioskToken("wl-1", 12, S), S).ok).toBe(true);
  });
});
