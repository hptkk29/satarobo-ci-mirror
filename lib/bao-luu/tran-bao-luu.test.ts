// lib/bao-luu/tran-bao-luu.test.ts — trần thời hạn bảo lưu theo THÁNG LỊCH. PHIÊN 1.
//
// Mọi ngày TUYỆT ĐỐI, `startedAt` luôn được truyền (luật 19). Vitest chạy TZ=UTC, còn các hàm
// dưới đọc ngày theo lịch VN — nên ca dưới cố ý dùng giờ gần nửa đêm VN để lộ lỗi nếu ai đó
// đổi sang `getDate()`/`getMonth()` của máy.
import { describe, it, expect } from "vitest";
import { hanToiDaBaoLuu, kiemTranBaoLuu, ngayQuayLaiVuotTran } from "./tran-bao-luu";

/** 10:00 sáng 22/09/2026 giờ VN. */
const BAT_DAU = new Date("2026-09-22T03:00:00Z");
/** Ô chọn ngày gửi nửa đêm UTC — 07:00 sáng cùng ngày giờ VN. */
const ngay = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("[BL1-TR] hanToiDaBaoLuu", () => {
  it("[BL1-TR-01] ngày bắt đầu + N tháng LỊCH, trả 00:00 giờ VN", () => {
    // 00:00 VN ngày 22/03/2027 = 17:00 UTC ngày 21/03/2027.
    expect(hanToiDaBaoLuu(BAT_DAU, 6).toISOString()).toBe("2027-03-21T17:00:00.000Z");
  });

  it("[BL1-TR-02] ngày không có ở tháng đích thì kẹp về cuối tháng (31/08 + 6 tháng ⇒ 28/02/2027)", () => {
    const han = hanToiDaBaoLuu(new Date("2026-08-31T03:00:00Z"), 6);
    expect(han.toISOString()).toBe("2027-02-27T17:00:00.000Z");
  });

  it("[BL1-TR-03] vắt qua năm (22/11 + 3 tháng ⇒ 22/02 năm sau)", () => {
    expect(hanToiDaBaoLuu(new Date("2026-11-22T03:00:00Z"), 3).toISOString()).toBe(
      "2027-02-21T17:00:00.000Z",
    );
  });

  it("[BL1-TR-04] bắt đầu lúc 00:30 VN ngày 01/10 (= 17:30 UTC ngày 30/09) tính theo ngày VN, không theo ngày UTC", () => {
    // Ngày UTC là 30/09, ngày VN là 01/10 ⇒ + 6 tháng = 01/04/2027 (00:00 VN = 17:00 UTC 31/03).
    // Nếu ai đổi sang `getUTCDate()` thì ra 30/03/2027 và ca này đỏ.
    const p = hanToiDaBaoLuu(new Date("2026-09-30T17:30:00Z"), 6);
    expect(p.toISOString()).toBe("2027-03-31T17:00:00.000Z");
  });
});

describe("[BL1-TR] kiemTranBaoLuu", () => {
  it("[BL1-TR-05] không khai ngày quay lại ⇒ hợp lệ (BR-12)", () => {
    expect(kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: null, maxMonths: 6 })).toEqual({ ok: true });
  });

  it("[BL1-TR-06] đúng ngày chạm trần (22/03/2027) ⇒ hợp lệ — đếm 30 ngày/tháng sẽ từ chối nhầm ca này (181 ngày)", () => {
    expect(kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: ngay("2027-03-22"), maxMonths: 6 }).ok).toBe(true);
  });

  it("[BL1-TR-07] vượt trần một ngày (23/03/2027) ⇒ RESERVE_TOO_LONG, câu lỗi nói rõ mốc", () => {
    const kq = kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: ngay("2027-03-23"), maxMonths: 6 });
    expect(kq.ok).toBe(false);
    if (!kq.ok) {
      expect(kq.code).toBe("RESERVE_TOO_LONG");
      expect(kq.message).toContain("6 tháng");
      expect(kq.message).toContain("22/03/2027");
    }
  });

  it("[BL1-TR-08] ngày quay lại không sau ngày bắt đầu ⇒ VALIDATION (cùng ngày, hoặc trước)", () => {
    for (const ymd of ["2026-09-22", "2026-09-01"]) {
      const kq = kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: ngay(ymd), maxMonths: 6 });
      expect(kq.ok, ymd).toBe(false);
      if (!kq.ok) expect(kq.code).toBe("VALIDATION");
    }
  });

  it("[BL1-TR-09] ngày không hợp lệ (NaN) ⇒ VALIDATION, không ném", () => {
    const kq = kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: new Date("khong-phai-ngay"), maxMonths: 6 });
    expect(kq.ok).toBe(false);
  });

  it("[BL1-TR-10] trần đổi theo cấu hình: maxMonths 2 ⇒ 22/11/2026 hợp lệ, 23/11/2026 thì không", () => {
    expect(kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: ngay("2026-11-22"), maxMonths: 2 }).ok).toBe(true);
    expect(kiemTranBaoLuu({ startedAt: BAT_DAU, expectedEndAt: ngay("2026-11-23"), maxMonths: 2 }).ok).toBe(false);
  });
});

describe("[BL7-VT] ngayQuayLaiVuotTran — ô 'lý do vượt trần' trên form phải bật ĐÚNG lúc server từ chối", () => {
  it("[BL7-VT-01] chạm trần đúng ngày ⇒ KHÔNG vượt; trễ một ngày ⇒ vượt; để trống ⇒ không vượt", () => {
    expect(ngayQuayLaiVuotTran("2027-03-22", "2027-03-22")).toBe(false);
    expect(ngayQuayLaiVuotTran("2027-03-23", "2027-03-22")).toBe(true);
    expect(ngayQuayLaiVuotTran("2027-03-21", "2027-03-22")).toBe(false);
    expect(ngayQuayLaiVuotTran("", "2027-03-22")).toBe(false);
  });

  it("[BL7-VT-02] KHỚP với kiemTranBaoLuu ở mọi ngày quanh trần: form bảo 'vượt' ⇔ server trả RESERVE_TOO_LONG", () => {
    const bd = new Date("2026-09-22T03:00:00Z");
    const han = hanToiDaBaoLuu(bd, 6);
    const hanYmd = "2027-03-22";
    for (let d = -3; d <= 3; d++) {
      const ngay = new Date(han.getTime() + d * 86_400_000 + 3 * 3_600_000);
      const ymd = new Date(ngay.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
      const server = kiemTranBaoLuu({ startedAt: bd, expectedEndAt: ngay, maxMonths: 6 });
      expect(ngayQuayLaiVuotTran(ymd, hanYmd), ymd).toBe(!server.ok);
    }
  });
});
