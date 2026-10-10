// Ca [TTE-*] — trạng thái email của hoá đơn đã xác nhận (GĐ 8 bước 11, `trang-thai-email.ts`).
//
// Lưới đáng giá nhất là [TTE-02]: `luotDangChay` (cổng "Gửi lại email" — gửi lúc này là gửi đôi) và
// nhãn trạng thái (`trangThaiEmailHoaDon`) phải nói CÙNG một điều cho MỌI tổ hợp lượt × hàng đợi.
// Lệch nhau là nhãn in "Đang gửi" mà nút lại cho gửi lại, hoặc nhãn in "Lỗi" mà nút vẫn tắt vì
// "đang chạy" — một trong hai đang hứa suông (luật 12).
import { describe, expect, it } from "vitest";
import * as khoi from "./khoi-hoa-don-don";
import * as dongHc from "./dong-hang-cho";
import { chuanEmail, luotDangChay, trangThaiEmailHoaDon, type HangDoiVao, type LuotGuiVao } from "./trang-thai-email";

const luot = (trangThai: LuotGuiVao["trangThai"]): LuotGuiVao => ({
  lanGui: 1,
  toi: "ph@example.com",
  trangThai,
  loi: null,
  emailQueueId: "q1",
  updatedAt: new Date("2026-09-27T02:00:00Z"),
});
const hang = (status: string): HangDoiVao => ({ id: "q1", status, sentAt: null, attempts: 0, maxAttempts: 3 });

describe("[TTE-01] luotDangChay — bảng chân trị", () => {
  it.each([
    ["CHO", null, true],
    ["DANG_GUI", "PENDING", true],
    ["DANG_GUI", null, true],
    ["DANG_GUI", "FAILED", false],
    ["DANG_GUI", "SENT", false],
    ["DA_GUI", null, false],
    ["DA_GUI", "SENT", false],
    ["LOI", null, false],
    ["LOI", "FAILED", false],
  ] as const)("lượt %s · hàng đợi %s ⇒ %s", (tt, q, mongDoi) => {
    expect(luotDangChay(luot(tt), q ? hang(q) : null)).toBe(mongDoi);
  });
});

describe("[TTE-02] cổng gửi lại và nhãn trạng thái nói CÙNG một điều", () => {
  const TT = ["CHO", "DANG_GUI", "DA_GUI", "LOI"] as const;
  const Q = [null, "PENDING", "SENT", "FAILED"] as const;
  const hd = { trangThai: "DA_XAC_NHAN", guiEmailKhach: true, emailNhan: "ph@example.com" };
  for (const tt of TT) {
    for (const q of Q) {
      it(`lượt ${tt} · hàng đợi ${q ?? "—"}`, () => {
        const l = luot(tt);
        const h = q ? hang(q) : null;
        const nhan = trangThaiEmailHoaDon(hd, l, h, true, true)!.loai;
        expect(luotDangChay(l, h)).toBe(nhan === "CHO_GUI" || nhan === "DANG_GUI");
      });
    }
  }
});

describe("[TTE-03] đường import cũ vẫn trỏ ĐÚNG một định nghĩa (không bản sao)", () => {
  it("khoi-hoa-don-don re-export chính hàm của trang-thai-email", () => {
    expect(khoi.trangThaiEmailHoaDon).toBe(trangThaiEmailHoaDon);
  });
  it("dong-hang-cho không còn định nghĩa trạng thái email riêng", () => {
    expect(Object.keys(dongHc)).not.toContain("trangThaiEmailHoaDon");
  });
});

describe("[TTE-04] chuanEmail", () => {
  it("bỏ khoảng trắng + không phân biệt hoa/thường; rỗng ⇒ null", () => {
    expect(chuanEmail("  A1@X.vn ")).toBe("a1@x.vn");
    expect(chuanEmail("   ")).toBeNull();
    expect(chuanEmail(null)).toBeNull();
  });
});
