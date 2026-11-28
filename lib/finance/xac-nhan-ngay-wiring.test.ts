// @vitest-environment node
//
// [XNN-*] PHIẾU THU XUẤT LIỀN (15/11/2026) — dây nối: hai chỗ vừa gắn khoản vào ghi danh phải cho bộ quét tự xác nhận chạy NGAY trên đơn đó.
// Lưới đọc mã nguồn (chú thích bị gỡ trước khi đếm — chú thích giải thích bản vá hay chứa đúng chuỗi đang canh).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[XNN-01] hai đường gắn khoản vào ghi danh đều đá bộ quét tự xác nhận ngay", () => {
  it("[XNN-01a] chuyển đổi đơn: đúng MỘT lời gọi, đứng SAU `ghiChuyenDoi` (commit xong mới đá)", () => {
    const s = doc("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts");
    expect(s.match(/xacNhanNganHangNgayChoDon\(/g) ?? []).toHaveLength(1);
    expect(s.indexOf("xacNhanNganHangNgayChoDon(")).toBeGreaterThan(s.indexOf("ghiChuyenDoi({"));
  });

  it("[XNN-01b] màn hoá đơn «Gắn ghi danh»: đúng MỘT lời gọi, đứng SAU `ganGhiDanhTuManHoaDon`", () => {
    const s = doc("app/(admin)/admin/payments/hoa-don/_actions.ts");
    expect(s.match(/xacNhanNganHangNgayChoDon\(/g) ?? []).toHaveLength(1);
    expect(s.indexOf("xacNhanNganHangNgayChoDon(")).toBeGreaterThan(s.indexOf("ganGhiDanhTuManHoaDon({"));
  });

  it("[XNN-01c] lõi: lượt «ngay» đi qua CHÍNH bộ quét (không viết lõi xác nhận thứ hai) và nuốt lỗi", () => {
    const s = doc("lib/finance/tu-xac-nhan-ngan-hang.ts");
    const ham = s.slice(s.indexOf("export async function xacNhanNganHangNgayChoDon"));
    expect(ham).toMatch(/chayTuXacNhanKhoanNganHang\(\{ now, donIds: \[orderId\] \}\)/);
    expect(ham).toMatch(/catch\s*\{\s*return null;/);
    expect(ham).not.toMatch(/xacNhanKhoanTrongTx|issueReceipt/);
  });
});
