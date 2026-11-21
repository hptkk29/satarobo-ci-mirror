// Ca [KNW-*] — lưới ghim mã nguồn của khu «Ngoại lệ hoá đơn» (S12). Hành vi đã đo ở `khu-ngoai-le.test.tsx` / `ngoai-le-hanh-dong.test.tsx` / DB; lưới này khoá thứ test hành vi
// không chứng minh được: khu chỉ ĐỌC qua dịch vụ (không chạm DB trực tiếp), cờ hỏi TRƯỚC khi đọc, trang gắn khu ĐÚNG chỗ, hành động chỉ qua một action.
// Neo vào lời gọi / biểu thức, đếm SỐ LẦN, bỏ chú thích; đã cấy lỗi để thấy ĐỎ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const BASE = "app/(admin)/admin/payments/hoa-don";
const KHU = `${BASE}/_components/khu-ngoai-le.tsx`;
const NUT = `${BASE}/_components/ngoai-le-hanh-dong.tsx`;
const TRANG = `${BASE}/canh-bao/page.tsx`;
const ACTION = `${BASE}/canh-bao/_ngoai-le-actions.ts`;

describe("[KNW-00] lưới không rỗng", () => {
  it("đọc được cả bốn tệp", () => {
    for (const f of [KHU, NUT, TRANG, ACTION]) expect(doc(f).length, f).toBeGreaterThan(300);
  });
});

describe("[KNW-01] khu danh sách: chỉ đọc qua dịch vụ, cờ hỏi trước", () => {
  const k = doc(KHU);
  it("không chạm DB / Prisma / scopedDb trực tiếp; không HTML thô; không đọc env; không gọi mạng", () => {
    expect(dem(k, /@\/lib\/db\b|\bscopedDb\b|\bPrismaClient\b|@prisma\/client/)).toBe(0);
    expect(dem(k, /dangerouslySetInnerHTML|\bprocess\.env\b|\bfetch\s*\(/)).toBe(0);
  });
  it("`laHubQuetBat()` đúng MỘT lần và đứng TRƯỚC lúc nạp actor + đọc danh sách; cờ tắt ⇒ trả null", () => {
    expect(dem(k, /\blaHubQuetBat\(\)/)).toBe(1);
    expect(k).toMatch(/if \(!\(await laHubQuetBat\(\)\)\) return null;/);
    expect(k.search(/laHubQuetBat\(\)/)).toBeLessThan(k.search(/resolveActor\(/));
    expect(k.search(/resolveActor\(/)).toBeLessThan(k.search(/docDanhSachNgoaiLe\(/));
    expect(dem(k, /\bdocDanhSachNgoaiLe\(/)).toBe(1);
  });
  it("cơ sở lọc đi qua `coSoHopLe` (ngoài phạm vi ⇒ không lọc), bộ lọc đi qua `locDanhSachNgoaiLe` (giá trị lạ bị bỏ)", () => {
    expect(dem(k, /\bcoSoHopLe\(actor, sp\.coSo\)/)).toBe(1);
    expect(dem(k, /\blocDanhSachNgoaiLe\(sp\)/)).toBe(1);
  });
  it("phân trang bằng bản Link (máy chủ) và liên kết mọi bộ lọc qua MỘT hàm `hrefNgoaiLe`; không tự ghép query", () => {
    expect(dem(k, /<DieuHuongTrangLink\b/)).toBe(1);
    expect(dem(k, /\bhrefNgoaiLe\(/)).toBe(1); // định nghĩa `hrefDoi` bọc nó — mọi liên kết còn lại gọi hrefDoi
    expect(dem(k, /href=\{`\/payments\/hoa-don\/canh-bao\?/)).toBe(0);
    expect(dem(k, /new URLSearchParams|\.searchParams\./)).toBe(0);
  });
  it("không màu rời trong khu (token thôi) và không animation/transition thêm", () => {
    expect(dem(k, /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-\[#/)).toBe(0);
    expect(dem(k, /\banimate-|\btransition-|framer-motion|@\/components\/magic/)).toBe(0);
  });
});

describe("[KNW-02] hành động: một đường duy nhất, không nút tự quyết quyền", () => {
  const n = doc(NUT);
  it("client chỉ gọi MỘT action, không chạm DB, không so vai/cơ sở tại chỗ (quyền do server tính `hanhDong`)", () => {
    expect(n.trimStart().startsWith('"use client"')).toBe(true);
    expect(dem(n, /\bxuLyNgoaiLeAction\(/)).toBe(1);
    expect(dem(n, /@\/lib\/db\b|\bscopedDb\b|\bcheckPermission\b/)).toBe(0);
    expect(dem(n, /\.role\b|roles\.includes|\.centerId\s*===/)).toBe(0);
  });
  it("nút «Nhận xử lý» / «Đã xử lý» / «Bỏ qua» vẽ theo ĐÚNG ba cờ của `hanhDong`; mỗi nút có aria-label; không icon-only", () => {
    expect(dem(n, /hanhDong\.nhan \?/)).toBe(1);
    expect(dem(n, /hanhDong\.daXuLy \?/)).toBe(1);
    expect(dem(n, /hanhDong\.boQua \?/)).toBe(1);
    expect(dem(n, /aria-label=\{`(?:Nhận xử lý|Đã xử lý|Bỏ qua): \$\{viec\}`\}/)).toBe(3);
  });
  it("khoá nút xác nhận theo lý do ≥ ngưỡng DÙNG CHUNG với máy chủ (hằng của phần thuần, không số gõ tay)", () => {
    expect(dem(n, /TOI_THIEU_LY_DO_XU_LY/)).toBeGreaterThanOrEqual(2);
    expect(dem(n, /\b10\b/)).toBe(0);
    expect(dem(n, /disabled=\{dangChay \|\| thieu > 0\}/)).toBe(1);
  });
});

describe("[KNW-03] trang: khu nằm TRƯỚC các ngăn, tải riêng, không đụng cổng quyền của tab", () => {
  const t = doc(TRANG);
  it("`<KhuNgoaiLe>` bọc Suspense, đứng TRƯỚC `<TrangBanChungTu>`; cổng cờ màn + đăng nhập + quyền vẫn đứng trước", () => {
    expect(dem(t, /<KhuNgoaiLe\b/)).toBe(1);
    expect(dem(t, /<Suspense fallback=\{<KhuNgoaiLeKhung \/>\}>/)).toBe(1);
    expect(t.search(/<KhuNgoaiLe\b/)).toBeLessThan(t.search(/<TrangBanChungTu\b/));
    expect(t.search(/laHoaDonBat\(\)/)).toBeLessThan(t.search(/auth\(\)/));
    expect(t.search(/auth\(\)/)).toBeLessThan(t.search(/checkAnyPermission\(/));
    expect(t.search(/checkAnyPermission\(/)).toBeLessThan(t.search(/<KhuNgoaiLe\b/));
  });
  it("trang KHÔNG nhắc cờ scanner (cờ chỉ đọc ở feature.ts qua `laHubQuetBat`) và không đọc bảng", () => {
    expect(dem(t, /hubQuet|laHubQuetBat|HoaDonNgoaiLe|hoaDonNgoaiLe/)).toBe(0);
  });
});
