// @vitest-environment node
//
// Ca [CGH-W*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của chốt chặn email hoá đơn. Hành vi đã có ở [CGH-Q*]/[CGH-S*]; lưới này canh thứ chúng
// KHÔNG thấy: một đường gửi MỚI mọc ra ở chỗ khác. Mọi khẳng định đọc mã đã BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng chuỗi cần canh —
// luật 11) và neo vào lời gọi, không vào chỗ đặt dòng.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const goc = process.cwd();
const doc = (p: string) => readFileSync(resolve(goc, p), "utf8").replace(/\r\n/g, "\n");
/** Bỏ chú thích khối + chú thích dòng (chỉ khi `//` đứng đầu dòng hoặc sau khoảng trắng — không cắt nhầm `https://` trong chuỗi). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

function tepNguon(thuMuc: string): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(resolve(goc, thuMuc))) {
    const p = join(thuMuc, ten);
    if (statSync(resolve(goc, p)).isDirectory()) kq.push(...tepNguon(p));
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten)) kq.push(p);
  }
  return kq;
}

describe("[CGH-W1] module hoá đơn KHÔNG gọi nhà cung cấp email trực tiếp", () => {
  it("không tệp nào trong lib/finance/hoa-don + màn hoá đơn import sendEmail / resend (chỉ được ENQUEUE; gửi thật là việc của worker)", () => {
    const tep = [...tepNguon("lib/finance/hoa-don"), ...tepNguon("app/(admin)/admin/payments/hoa-don")];
    expect(tep.length).toBeGreaterThan(20); // đừng để lưới rỗng vì sai đường dẫn
    const vi_pham = tep.filter((p) => /from\s+["'](?:@\/lib\/email\/(?:send|resend)|\.\/send|\.\/resend|resend)["']|sendEmail\(|getResendClient\(/.test(boChuThich(doc(p))));
    expect(vi_pham).toEqual([]);
  });
});

describe("[CGH-W2] worker: chặn đứng TRƯỚC khi ký URL tệp và TRƯỚC khi gửi", () => {
  const src = boChuThich(doc("lib/email/queue.ts"));
  it("đúng MỘT lời gọi chanGuiEmailHoaDon(), nằm trước chuanBiGuiHoaDon( và trước sendEmail(", () => {
    expect(src.match(/chanGuiEmailHoaDon\(/g)).toHaveLength(1);
    const iChan = src.indexOf("chanGuiEmailHoaDon(");
    expect(iChan).toBeGreaterThan(0);
    expect(iChan).toBeLessThan(src.indexOf("await chuanBiGuiHoaDon("));
    expect(iChan).toBeLessThan(src.indexOf("await sendEmail("));
  });
  it("nhánh chặn ghi FAILED dứt điểm + ghiKetQuaGuiHoaDon(daGui:false, cuoiCung:true) và `continue` — không có SENT / daGui:true trong nhánh", () => {
    const i = src.indexOf("if (chan.chan) {");
    expect(i).toBeGreaterThan(0);
    const nhanh = src.slice(i, src.indexOf("continue;", i) + "continue;".length);
    expect(nhanh).toMatch(/status:\s*"FAILED"/);
    expect(nhanh).toMatch(/daGui:\s*false/);
    expect(nhanh).toMatch(/cuoiCung:\s*true/);
    expect(nhanh).not.toMatch(/SENT|daGui:\s*true|PENDING/);
  });
});

describe("[CGH-W3] sendEmail: chốt chặn thứ hai nằm TRƯỚC khi dựng client nhà cung cấp", () => {
  const src = boChuThich(doc("lib/email/send.ts"));
  it("laNguCanhEmailHoaDon + chanGuiEmailHoaDon xuất hiện trước getResendClient()", () => {
    const iChan = src.indexOf("chanGuiEmailHoaDon(");
    expect(iChan).toBeGreaterThan(0);
    expect(iChan).toBeLessThan(src.indexOf("getResendClient()"));
    expect(src).toMatch(/laNguCanhEmailHoaDon\(params\.contextType\)/);
  });
  it("nhánh chặn trả ok:false, không bao giờ ok:true", () => {
    const i = src.indexOf("if (chan.chan) {");
    const nhanh = src.slice(i, src.indexOf("return {", i) + 80);
    expect(nhanh).toMatch(/ok:\s*false/);
    expect(nhanh).not.toMatch(/ok:\s*true/);
  });
});

describe("[CGH-W4] không mọc công tắc 'cho gửi thật' trong module chặn", () => {
  it("module chỉ đọc ba biến URL qua env[k]; không có env.<TÊN> nào khác, không nhắc RESEND", () => {
    const src = boChuThich(doc("lib/email/chan-gui-hoa-don.ts"));
    expect(src.match(/env\[/g)).toHaveLength(1);
    expect(src).not.toMatch(/\benv\.[A-Z_]+/);
    expect(src).not.toMatch(/process\.env\.[A-Z_]+/);
    expect(src).not.toMatch(/RESEND/);
    expect(src).toMatch(/BIEN_URL_UNG_DUNG\s*=\s*\["NEXTAUTH_URL",\s*"AUTH_URL",\s*"NEXT_PUBLIC_APP_URL"\]/);
  });
});
