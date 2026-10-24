// @vitest-environment node
/**
 * [NLD-*] — LƯỚI GHIM DÂY NỐI của nút «Link» / form «Tạo link» (AFF-WEB): thứ test hành vi KHÔNG chạm tới (page là Server Component, action là "use server" kéo next-auth + Prisma).
 * Quên truyền một prop BẮT BUỘC thì `tsc` đỏ; nhưng truyền SAI nguồn (vd. `coTheLink = true`, hay hỏi nhầm khoá) thì không gì đỏ — nên ghim ở đây (CLAUDE.md luật 11/12).
 * Đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM số lần khớp, không cờ `/s`.
 *
 *   [NLD-01] tab Affiliate: `coTheLink` = ĐÚNG khoá `affiliate_links:manage`; tầng đọc nhận đúng cờ đó làm `coTheXemDayDu`; bảng + Sheet nhận cùng một cờ
 *   [NLD-02] màn cũ `/affiliates`: cờ = khoá link ∧ cờ Affiliate; tầng đọc nhận đúng cờ đó; nút «tạo link» chỉ khi đối tác đang hoạt động ∧ tab Link mở được
 *   [NLD-03] cổng đối tác: mỗi action gác (phiên PARENT → đối tác) TRƯỚC khi chạm lõi; userId lấy từ PHIÊN; không có `partyId` nào do client quyết
 *   [NLD-04] câu hướng dẫn mã giới thiệu đúng nguyên văn đặc tả (không còn «Link mẫu»)
 *   [NLD-05] Sheet đối tác: đường dẫn sang tab Link / QR / Mã CHỈ khi `coTheTaoLink`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

/** Bỏ chú thích dòng (chỉ khi `//` đầu dòng hoặc sau khoảng trắng), chú thích JSX trong ngoặc nhọn và khối mở ở ĐẦU DÒNG. */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g, "$1");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const TRANG_AFF = "app/(admin)/admin/nguon-hoa-hong/affiliate/page.tsx";
const BANG_AFF = "app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-doi-tac.tsx";
const TRANG_CU = "app/(admin)/admin/affiliates/page.tsx";
const ACTION_CONG = "app/(portal)/portal/gioi-thieu/_actions.ts";

describe("[NLD-01] tab Affiliate", () => {
  it("`coTheLink` hỏi ĐÚNG `affiliate_links:manage` (một lần); tầng đọc nhận nó làm `coTheXemDayDu`; bảng và Sheet nhận cùng cờ", () => {
    const s = doc(TRANG_AFF);
    expect(dem(s, /const coTheLink = scope\.has\("affiliate_links:manage"\);/g)).toBe(1);
    expect(dem(s, /docLinkDangDungTheoDoiTac\([\s\S]*?coTheXemDayDu:\s*coTheLink\b/g)).toBe(1);
    expect(dem(s, /coTheLink=\{coTheLink\}/g)).toBe(1); // BangDoiTac
    expect(dem(s, /coTheTaoLink=\{coTheLink\}/g)).toBe(1); // DoiTacSheet «Tạo đối tác»
    expect(dem(s, /linkDangDung=\{linkDangDung\}/g)).toBe(1);
  });
  it("bảng: nút «Link» chỉ khi đối tác đang hoạt động ∧ `coTheLink`; Sheet sửa nhận `coTheTaoLink={coTheLink}`; không còn gốc cứng", () => {
    const s = doc(BANG_AFF);
    expect(dem(s, /dangHoatDong && coTheLink && \(/g)).toBe(1);
    expect(dem(s, /coTheTaoLink=\{coTheLink\}/g)).toBe(1);
    expect(dem(s, /linkRefMau|GOC_LINK_CONG_KHAI|satarobo\.vn/g)).toBe(0);
  });
});

describe("[NLD-02] màn cũ /affiliates", () => {
  it("cờ = khoá link ∧ cờ Affiliate; tầng đọc nhận đúng cờ; nút «tạo link» cần đối tác đang hoạt động ∧ tab Link mở được", () => {
    const s = doc(TRANG_CU);
    expect(dem(s, /const coTheLink = scope\.has\("affiliate_links:manage"\) && scope\.co\.affiliate;/g)).toBe(1);
    expect(dem(s, /coTheXemDayDu:\s*coTheLink\b/g)).toBe(1);
    expect(dem(s, /coTheLink && a\.isActive && scope\.tabMoDuoc\("link"\)/g)).toBe(1);
  });
});

describe("[NLD-03] cổng đối tác — action", () => {
  const s = doc(ACTION_CONG);
  const than = (ten: string) => {
    const bat = s.indexOf(`export async function ${ten}(`);
    expect(bat, `không thấy ${ten}`).toBeGreaterThanOrEqual(0);
    const sau = s.indexOf("\nexport async function ", bat + 10);
    return s.slice(bat, sau === -1 ? undefined : sau);
  };
  it.each(["taoLinkCuaToiAction", "taoQrCuaToiAction"])("%s: phiên PARENT → đối tác, rồi mới tới lõi", (ten) => {
    const t = than(ten);
    const iPhien = t.indexOf("await nguoiDung()");
    const iDoiTac = t.indexOf("await coGioiThieuChoNguoiDung(u.id)");
    expect(iPhien).toBeGreaterThanOrEqual(0);
    expect(iDoiTac).toBeGreaterThan(iPhien);
    const iLoi = Math.min(...["tuTaoLink(", "docLinkChoQrCuaToi("].map((x) => t.indexOf(x)).filter((i) => i >= 0));
    expect(iLoi).toBeGreaterThan(iDoiTac);
  });
  it("userId đi vào lõi lấy từ PHIÊN (`u.id`); không có `partyId` / `membershipId` do action tự quyết; quyền = dữ liệu sở hữu, KHÔNG so vai (lint no-inline-authz)", () => {
    expect(dem(s, /nguoi:\s*\{\s*userId:\s*u\.id,/g)).toBe(1);
    expect(dem(s, /docLinkChoQrCuaToi\(u\.id,/g)).toBe(1);
    expect(dem(s, /\bpartyId\b/g)).toBe(0);
    expect(dem(s, /\.role\b/g)).toBe(0);
  });
});

describe("[NLD-04/05] chữ trong Sheet đối tác", () => {
  const sheet = doc("components/admin/nguon-hoa-hong/affiliate/doi-tac-sheet.tsx");
  it("câu hướng dẫn giữ NGUYÊN VĂN đặc tả và không còn «Link mẫu»", () => {
    expect(sheet).toContain('"Mã này dùng để tạo link giới thiệu trên các website và trang đích Admin cho phép — tạo ở tab Link / QR / Mã."');
    expect(dem(sheet, /Link mẫu/g)).toBe(0);
  });
  it("đường dẫn sang tab chỉ khi `coTheTaoLink` (đúng một chỗ dựng href tới /nguon-hoa-hong/link)", () => {
    expect(dem(sheet, /coTheTaoLink && \(/g)).toBe(1);
    expect(dem(sheet, /\/nguon-hoa-hong\/link/g)).toBe(2); // nhánh «sửa» (kèm ?doitac=) và nhánh «tạo»
  });
});
