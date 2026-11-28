import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * [AUT-G1-W] LƯỚI GHIM: route di động KHÔNG được đọc/kiểm thân JSON TRƯỚC xác thực.
 * Lý lẽ (V8.17 G1): thân sai + token thu hồi phải ra 401 chứ không 400; con nhà khác + thân sai phải ra 404.
 * Ba route xác thực (`auth/login|logout|refresh`) là NGOẠI LỆ CÓ CHỦ ĐÍCH — chúng chính là cửa xác thực, thân là thông tin đăng nhập/làm mới.
 * V8.45: BỐN route OTP (`auth/activation|password-reset/{request-otp,confirm}`) là cửa xác thực thứ hai — người dùng chưa có/quên mật khẩu nên KHÔNG thể có token;
 * thân là định danh + mã OTP. Bảy ngoại lệ, KHÔNG hơn: route mới đọc thân trước xác thực phải thêm vào đây CÓ CHỦ ĐÍCH (và bị `[AUT-G1-W2]` đếm).
 * Mọi route khác dùng `chay*CoThan` (xác thực → … → đọc thân) hoặc không có thân.
 */
const GOC = join(process.cwd(), "app", "api", "mobile");
const NGOAI_LE = new Set([
  "v1/auth/login/route.ts",
  "v1/auth/logout/route.ts",
  "v1/auth/refresh/route.ts",
  "v1/auth/activation/request-otp/route.ts",
  "v1/auth/activation/confirm/route.ts",
  "v1/auth/password-reset/request-otp/route.ts",
  "v1/auth/password-reset/confirm/route.ts",
]);

function quet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if (ten === "route.ts") ra.push(p);
  }
  return ra;
}
// bỏ chú thích để lời giải thích bản vá không tự khớp (luật 11)
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("[AUT-G1-W] xác thực trước thân (ghim mã nguồn)", () => {
  const tep = quet(GOC).map((p) => ({ rel: relative(GOC, p).split(sep).join("/"), ma: boChuThich(readFileSync(p, "utf8")) }));

  it("[AUT-G1-W1] chỉ các route cửa xác thực (7) được gọi `docThanJson`/`req.json()`; còn lại KHÔNG", () => {
    expect(tep.length).toBeGreaterThan(60);
    const vi = tep.filter((t) => !NGOAI_LE.has(t.rel) && /\bdocThanJson\b|\.json\(\)/.test(t.ma)).map((t) => t.rel);
    expect(vi).toEqual([]);
  });

  it("[AUT-G1-W2] ngoại lệ vẫn còn đúng bảy route (lưới không rỗng, không phình): đổi tên/xoá/thêm thì phải sửa lưới có chủ đích", () => {
    expect(NGOAI_LE.size).toBe(7);
    for (const n of NGOAI_LE) expect(tep.some((t) => t.rel === n), n).toBe(true);
    for (const n of NGOAI_LE) expect(tep.find((t) => t.rel === n)!.ma).toMatch(/docThanJson\(/);
  });

  it("[AUT-G1-W3] route có phương thức ghi dùng đúng một cổng CÓ THÂN (đếm số lần khớp)", () => {
    const ghi = tep.filter((t) => !NGOAI_LE.has(t.rel) && /export async function (POST|PATCH|PUT|DELETE)\b/.test(t.ma));
    const khongCo = ghi.filter((t) => {
      // route ghi KHÔNG thân (vd `cancel`, `read` rỗng) được phép chỉ dùng cổng thường
      const coGate = /chay(DaDangNhap|ChoPhuHuynh|TheoHocVien)(CoThan)?\(/.test(t.ma) || /chayTheoHocVienTrongThan\(/.test(t.ma);
      return !coGate;
    });
    expect(khongCo.map((t) => t.rel)).toEqual([]);
  });
});
