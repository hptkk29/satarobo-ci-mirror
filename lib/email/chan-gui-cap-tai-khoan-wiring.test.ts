// @vitest-environment node
//
// Ca [CGA-W*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của chốt chặn email cấp tài khoản. Hành vi đã có ở [CGA-N*]/[CGA-S*]; lưới này canh thứ chúng KHÔNG
// thấy: (1) một đường gửi MỚI mang mật khẩu mọc ra chỗ khác; (2) hai hành động tạo / reset đi vòng qua `notifyStaffAccountGranted`; (3) ai đó đưa
// `input.password` thẳng vào sendEmail. Mọi khẳng định đọc mã đã BỎ CHÚ THÍCH (luật 11) và neo vào lời gọi, không vào chỗ đặt dòng.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const goc = process.cwd();
const doc = (p: string) => readFileSync(resolve(goc, p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

function tepNguon(thuMuc: string): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(resolve(goc, thuMuc))) {
    if (ten === "node_modules" || ten === ".next") continue;
    const p = join(thuMuc, ten);
    if (statSync(resolve(goc, p)).isDirectory()) kq.push(...tepNguon(p));
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten)) kq.push(p);
  }
  return kq;
}

describe("[CGA-W1] staff-account.ts: mật khẩu thật chỉ đi qua MỘT chỗ, và qua cổng chặn", () => {
  const src = boChuThich(doc("lib/email/staff-account.ts"));
  it("đúng MỘT lời gọi chanGuiEmailCapTaiKhoan(), nằm trước await sendEmail(", () => {
    expect(src.match(/chanGuiEmailCapTaiKhoan\(/g)).toHaveLength(1);
    expect(src.indexOf("chanGuiEmailCapTaiKhoan(")).toBeLessThan(src.indexOf("await sendEmail("));
  });
  it("`input.password` chỉ xuất hiện đúng MỘT lần trong thân hàm gửi thư (trong phép chọn matKhauGui) — không đi thẳng vào sendEmail/ZNS/log", () => {
    const dong = src.split("\n").filter((l) => /input\.password/.test(l));
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatch(/matKhauGui\s*=\s*chanGuiEmailCapTaiKhoan\(\)\.chan\s*\?\s*MASK\s*:\s*input\.password/);
    expect(src.match(/matKhauGui/g)!.length).toBeGreaterThanOrEqual(3); // định nghĩa + bodyText + bodyHtml
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*password/i);
  });
  it("ngữ cảnh gửi dùng hằng NGU_CANH_EMAIL_CAP_TAI_KHOAN, không gõ lại chuỗi", () => {
    expect(src).toMatch(/contextType:\s*NGU_CANH_EMAIL_CAP_TAI_KHOAN/);
    expect(src).not.toMatch(/contextType:\s*["']STAFF_ACCOUNT_GRANTED["']/);
  });
});

describe("[CGA-W2] sendEmail: chốt chặn thứ hai nằm TRƯỚC khi dựng client nhà cung cấp", () => {
  const src = boChuThich(doc("lib/email/send.ts"));
  it("laNguCanhEmailCapTaiKhoan + chanGuiEmailCapTaiKhoan xuất hiện trước getResendClient()", () => {
    const iChan = src.indexOf("chanGuiEmailCapTaiKhoan(");
    expect(iChan).toBeGreaterThan(0);
    expect(iChan).toBeLessThan(src.indexOf("getResendClient()"));
    expect(src).toMatch(/laNguCanhEmailCapTaiKhoan\(params\.contextType\)/);
  });
  it("nhánh chặn trả ok:false, không bao giờ ok:true", () => {
    const iKhoi = src.indexOf("laNguCanhEmailCapTaiKhoan(params.contextType)");
    const i = src.indexOf("if (chan.chan) {", iKhoi);
    const nhanh = src.slice(i, src.indexOf("return {", i) + 80);
    expect(nhanh).toMatch(/ok:\s*false/);
    expect(nhanh).toMatch(/status:\s*"FAILED"/);
    expect(nhanh).not.toMatch(/ok:\s*true/);
  });
});

describe("[CGA-W3] hai hành động tạo / reset CHỈ đi qua notifyStaffAccountGranted — không có đường thứ ba", () => {
  const src = boChuThich(doc("app/(admin)/admin/users/_actions.ts"));
  it("đúng HAI lời gọi notifyStaffAccountGranted({ (tạo + reset); không import sendEmail / resend", () => {
    expect(src.match(/notifyStaffAccountGranted\(\{/g)).toHaveLength(2);
    expect(src).not.toMatch(/from\s+["'](?:@\/lib\/email\/(?:send|resend)|resend)["']|sendEmail\(|getResendClient\(/);
  });
  it("không tệp nguồn nào NGOÀI staff-account.ts / module chặn nhắc ngữ cảnh STAFF_ACCOUNT_GRANTED hoặc truyền contextType cấp tài khoản", () => {
    const duocPhep = new Set([
      "lib/email/staff-account.ts",
      "lib/email/chan-gui-cap-tai-khoan.ts",
      "lib/email/template-codes.ts", // định nghĩa mẫu
    ]);
    const tep = [...tepNguon("lib"), ...tepNguon("app")].map((p) => p.replace(/\\/g, "/"));
    expect(tep.length).toBeGreaterThan(500); // đừng để lưới rỗng vì sai đường dẫn
    const vi_pham = tep.filter((p) => !duocPhep.has(p) && /STAFF_ACCOUNT_GRANTED|NGU_CANH_EMAIL_CAP_TAI_KHOAN/.test(boChuThich(doc(p))));
    expect(vi_pham).toEqual([]);
  });
});

describe("[CGA-W4] không mọc công tắc 'cho gửi thật' trong module chặn", () => {
  it("module không đọc biến env nào (chỉ truyền `env` sang chanGuiEmailHoaDon), không nhắc RESEND", () => {
    const src = boChuThich(doc("lib/email/chan-gui-cap-tai-khoan.ts"));
    expect(src).not.toMatch(/process\.env\.[A-Z_]+/);
    expect(src.match(/process\.env/g)).toHaveLength(1); // chỉ là giá trị mặc định của tham số `env`
    expect(src).not.toMatch(/\benv\[/);
    expect(src).not.toMatch(/\benv\.[A-Z_]+/);
    expect(src).not.toMatch(/RESEND/);
    expect(src).toMatch(/chanGuiEmailHoaDon\(env\)/);
  });
});
