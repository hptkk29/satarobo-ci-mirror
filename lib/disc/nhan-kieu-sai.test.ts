import { describe, expect, it } from "vitest";
import { nhanBaiDisc, type NhanDeps } from "./nhan";

/**
 * [DISC-NKS-*] Server action là điểm vào CÔNG KHAI: kiểu TypeScript của tham số không có hiệu lực lúc chạy. Kẻ gọi gửi
 * `matKhau`/`otp` không phải chuỗi (số, object, mảng) ⇒ `.trim()` ném TypeError ⇒ 500 thay vì lỗi dữ liệu thường.
 * Hợp đồng: kiểu lạ ⇒ KẾT QUẢ `DU_LIEU_KHONG_HOP_LE`, KHÔNG ném, và chưa chạm tới `deps` (chưa đốt OTP/lượt thử).
 * Dữ liệu GIẢ. `deps` là object rỗng: chạm vào bất kỳ cổng nào cũng ném ⇒ test sẽ đỏ.
 */
const depsCamChamVao = new Proxy({} as NhanDeps, {
  get: (_t, k) => {
    throw new Error(`DISC: không được chạm deps.${String(k)} khi dữ liệu sai kiểu`);
  },
});
const hopLe = { soDienThoai: "0905000111", otp: "123456", maNhan: "ABCDE23456", namSinhCon: 2015, matKhau: "matkhau-gia-1", phien: null, deps: depsCamChamVao };
const goi = (o: Record<string, unknown>) => nhanBaiDisc({ ...hopLe, ...o } as unknown as Parameters<typeof nhanBaiDisc>[0]);

describe("[DISC-NKS-01] dữ liệu sai kiểu ⇒ lỗi dữ liệu, không ném, không chạm deps", () => {
  it.each([
    ["matKhau là số", { matKhau: 12345678 }],
    ["matKhau là object", { matKhau: { toString: () => "abcdefgh" } }],
    ["matKhau là mảng", { matKhau: ["abcdefgh"] }],
    ["otp là số", { otp: 123456 }],
    ["otp là null", { otp: null }],
  ])("%s", async (_ten, o) => {
    const r = await goi(o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toBe("DU_LIEU_KHONG_HOP_LE");
  });
});
