import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LƯỚI NGĂN TÁI DIỄN (B3.5, mã ca: MKT): MỌI nơi băm mật khẩu tài khoản trong `app/**` và `lib/**` phải KHAI CƠ CHẾ khiến phiên DI ĐỘNG cũ chết khi mật khẩu đổi.
 *
 * Sự cố sinh ra lưới này (đo 16/11/2026): hai đường web đổi mật khẩu mà KHÔNG tăng `tokenVersion` nên phiên di động đánh cắp sống tiếp — `doi-mat-khau` và `admin/settings`.
 * Cơ chế hợp lệ:
 *   BUMP        — `tokenVersion: { increment: 1 }` ⇒ MỌI phiên (web + di động) chết (`[MA-08]`);
 *   THU_HOI     — gọi `thuHoiMoiPhienDiDong(` trong CÙNG giao dịch ⇒ chỉ phiên di động chết, phiên web giữ (chính sách đã duyệt);
 *   TAO_MOI     — tạo tài khoản mới: chưa có phiên nào;
 *   KICH_HOAT   — kích hoạt lần đầu, chỉ khi `PENDING_ACTIVATION`: chưa có phiên nào;
 *   KHONG_PHAI  — băm thứ khác, KHÔNG phải mật khẩu tài khoản.
 * Thêm một nơi băm mới mà không đăng ký ở đây ⇒ ĐỎ: người thêm phải chọn cơ chế có chủ đích (và viết ca Postgres tương ứng, xem `tests/mobile-api/doi-mat-khau.spec.ts`).
 */
type CoChe = "BUMP" | "THU_HOI" | "TAO_MOI" | "KICH_HOAT" | "KHONG_PHAI";

export const DANG_KY: Record<string, CoChe[]> = {
  "app/(admin)/admin/settings/actions.ts": ["THU_HOI"],
  "app/(admin)/admin/users/_actions.ts": ["TAO_MOI", "BUMP"],
  "app/(auth)/doi-mat-khau/_actions.ts": ["THU_HOI"],
  "app/(auth)/kich-hoat/_actions.ts": ["KICH_HOAT"],
  "app/(auth)/quen-mat-khau/_actions.ts": ["BUMP"],
  "app/(portal)/portal/ho-so/actions.ts": ["BUMP"],
  "lib/mobile-api/dich-vu/otp-tai-khoan.ts": ["KICH_HOAT", "BUMP"], // V8.45: kích hoạt (chỉ PENDING_ACTIVATION) + đặt lại qua OTP (tokenVersion + 1 và thu hồi MỌI phiên di động trong cùng giao dịch)
  "lib/mobile-api/xac-thuc/dich-vu.ts": ["BUMP"], // POST /parent/password: tăng tokenVersion + cấp cặp token mới cho đúng thiết bị đang gọi
  "lib/disc/nhan-prisma.ts": ["TAO_MOI", "KICH_HOAT"],
  "lib/portal/hv-ma.ts": ["KHONG_PHAI"], // băm MÃ học viên của cổng, không phải User.password
};

const GOC = process.cwd();

function quet(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next") continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.tsx?$/.test(ten)) ra.push(p);
  }
  return ra;
}
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // bỏ chú thích: lời giải thích chứa đúng chuỗi đang tìm (bài học luật 11)

const nguon = [...quet(join(GOC, "app")), ...quet(join(GOC, "lib"))].map((p) => ({ tep: relative(GOC, p).replace(/\\/g, "/"), ma: bo(readFileSync(p, "utf8")) }));
const coBam = nguon.filter((f) => /\bbcrypt(js)?\.hash\(|\bbcrypt\.hash\(/.test(f.ma) || /import\s+bcrypt\s+from\s+["']bcryptjs["'][\s\S]*\.hash\(/.test(f.ma));

describe("mọi nơi băm mật khẩu phải khai cơ chế thu hồi phiên di động", () => {
  it("[MKT-01] quét được các nơi băm đã biết (đối chứng: lưới không rỗng)", () => {
    const tep = coBam.map((f) => f.tep);
    for (const k of Object.keys(DANG_KY)) expect(tep).toContain(k);
  });

  it("[MKT-02] không có nơi băm MỚI nào ngoài đăng ký", () => {
    const la = coBam.filter((f) => !(f.tep in DANG_KY)).map((f) => f.tep);
    expect(la, `Nơi băm mật khẩu CHƯA đăng ký cơ chế thu hồi phiên di động: ${la.join(", ")} — thêm vào DANG_KY với cơ chế đúng và viết ca Postgres (tests/mobile-api/doi-mat-khau.spec.ts)`).toEqual([]);
  });

  it("[MKT-03] mỗi nơi đã đăng ký THỰC SỰ có cơ chế nó khai (không khai suông)", () => {
    const sai: string[] = [];
    for (const [tep, coChe] of Object.entries(DANG_KY)) {
      const f = nguon.find((x) => x.tep === tep);
      if (!f) { sai.push(`${tep}: không còn tệp (xoá khỏi DANG_KY)`); continue; }
      if (coChe.includes("BUMP") && !/tokenVersion:\s*\{\s*increment/.test(f.ma)) sai.push(`${tep}: khai BUMP nhưng không có \`tokenVersion: { increment }\``);
      if (coChe.includes("THU_HOI") && !/\bthuHoiMoiPhienDiDong\(/.test(f.ma)) sai.push(`${tep}: khai THU_HOI nhưng không gọi \`thuHoiMoiPhienDiDong(\``);
      if (coChe.includes("THU_HOI") && !/\$transaction\(/.test(f.ma)) sai.push(`${tep}: khai THU_HOI nhưng không có giao dịch \`$transaction(\` (thu hồi và đổi mật khẩu phải CÙNG giao dịch)`);
      if (coChe.includes("KICH_HOAT") && !/PENDING_ACTIVATION|accountStatus/.test(f.ma)) sai.push(`${tep}: khai KICH_HOAT nhưng không thấy điều kiện trạng thái chờ kích hoạt`);
    }
    expect(sai).toEqual([]);
  });

  it("[MKT-04] thu hồi nằm TRONG giao dịch của phép ghi mật khẩu: lời gọi đứng sau `$transaction(` và trước khi giao dịch đóng, không phải sau `await` rời", () => {
    for (const tep of Object.entries(DANG_KY).filter(([, c]) => c.includes("THU_HOI")).map(([t]) => t)) {
      const m = nguon.find((x) => x.tep === tep)!.ma;
      const iGd = m.indexOf("$transaction(");
      const iHoi = m.indexOf("thuHoiMoiPhienDiDong(");
      const iMk = m.search(/password:\s*hashed/);
      expect(iGd, tep).toBeGreaterThan(-1);
      expect(iMk, `${tep}: không thấy phép ghi password`).toBeGreaterThan(iGd); // ghi mật khẩu nằm trong giao dịch
      expect(iHoi, tep).toBeGreaterThan(iMk); // thu hồi đi sau phép ghi, cùng khối giao dịch
      const khoi = m.slice(iGd, iHoi);
      // giữa `$transaction(` và lời gọi thu hồi không được đóng giao dịch (`});` ở cấp giao dịch)
      expect(/\}\)\s*;?\s*\n\s*(return|try|catch|\})/.test(khoi.split("\n").slice(0, -1).join("\n")), `${tep}: giao dịch đã đóng trước khi thu hồi`).toBe(false);
    }
  });
});
