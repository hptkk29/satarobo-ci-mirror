// lib/bao-luu/khoa-cho-phep.test.ts — [BLK-W1..5] LƯỚI NEO MÃ NGUỒN cho công tắc "khoá nào được bảo lưu". Thuần, không DB.
//
// Hành vi thật (ghi cột, nhật ký, đếm tác động) đo trên Postgres ở `tests/finance/bao-luu-khoa-cho-phep.test.ts` [BLK-01..05].
// Lưới này canh những thứ test hành vi KHÔNG chạm tới: cổng quyền của action, dây nối `canEdit` ở trang (luật 12 — vẽ bằng quyền nào thì action hỏi đúng quyền ấy),
// và việc danh sách khoá tắt không bị ghi cứng trong mã (anh Toại phải tự đặt được, 12/10/2026).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bỏ chú thích TRƯỚC khi neo (chú thích giải thích bản vá hay chứa đúng chuỗi đang canh). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const DEM = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const ACTIONS = boChuThich(doc("app/(admin)/admin/courses/[id]/_actions.ts"));
const PAGE = boChuThich(doc("app/(admin)/admin/courses/[id]/page.tsx"));
const LIB = boChuThich(doc("lib/bao-luu/khoa-cho-phep.ts"));

function thanHam(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("[BLK-W] công tắc khoá cho phép bảo lưu", () => {
  it("[BLK-W1] action: cổng `gate()` đứng TRƯỚC lời gọi ghi, và gate hỏi đúng `courses:edit`", () => {
    const t = thanHam(ACTIONS, "luuChoPhepBaoLuuAction");
    const gate = t.indexOf("gate()");
    const ghi = t.indexOf("datChoPhepBaoLuuCuaKhoa(");
    expect(gate).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(gate);
    expect(t.slice(gate, ghi)).toContain('"error" in g');
    expect(DEM(ACTIONS, /checkPermission\("courses:edit"\)/g)).toBe(1); // gate duy nhất của tệp
    expect(ACTIONS).toMatch(/async function gate\(\)[\s\S]*?checkPermission\("courses:edit"\)/);
  });

  it("[BLK-W2] action kiểm đầu vào bằng zod TRƯỚC khi ghi, và revalidate cả trang khoá lẫn danh sách bảo lưu", () => {
    const t = thanHam(ACTIONS, "luuChoPhepBaoLuuAction");
    expect(t.indexOf("safeParse(")).toBeGreaterThan(-1);
    expect(t.indexOf("safeParse(")).toBeLessThan(t.indexOf("datChoPhepBaoLuuCuaKhoa("));
    expect(t).toContain("revalidatePath(`/courses/${courseId}`)");
    expect(t).toContain('revalidatePath("/bao-luu")');
  });

  it("[BLK-W3] trang: `canEdit` của khối Bảo lưu là CHÍNH cờ `courses:edit` (một biến, một nguồn) — không cờ riêng", () => {
    expect(DEM(PAGE, /checkPermission\("courses:edit"\)/g)).toBe(1);
    expect(PAGE).toMatch(/const canEdit = await checkPermission\("courses:edit"\)/);
    // `[^>]*` (không `[\s\S]*?`): neo trong ĐÚNG thẻ này — bản đầu để lọt `canEdit={true}` vì regex nhảy sang `canEdit={canEdit}` của khối Học bù bên dưới.
    expect(PAGE).toMatch(/<BaoLuuSection[^>]*\bcanEdit=\{canEdit\}[^>]*\/>/);
    expect(PAGE).toMatch(/allowPause: true/); // trang phải select cột, không thì công tắc luôn hiện BẬT
    expect(PAGE).toContain("allowPause={course.allowPause}");
  });

  it("[BLK-W4] lõi: đổi cột chỉ khi giá trị KHÁC, và nhật ký ghi SAU khi cột đã đổi (không nhật ký ma)", () => {
    const so = LIB.indexOf("khoa.allowPause === p.choPhep");
    const ghi = LIB.indexOf("p.sdb.course.update(");
    const nk = LIB.indexOf("writeAudit(");
    expect(so).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(so);
    expect(nk).toBeGreaterThan(ghi);
    expect(DEM(LIB, /course\.update\(/g)).toBe(1);
    expect(LIB).toMatch(/oldValues:[\s\S]*?allowPause: khoa\.allowPause/);
    expect(LIB).toMatch(/newValues:[\s\S]*?allowPause: p\.choPhep/);
  });

  it("[BLK-W5] DANH SÁCH KHOÁ TẮT là dữ liệu, không phải mã: không tệp nào dưới lib/bao-luu ghi cứng slug Sata/Combo", () => {
    const tep: string[] = [];
    const duyet = (d: string) => {
      for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) duyet(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) tep.push(p);
      }
    };
    duyet("lib/bao-luu");
    expect(tep.length).toBeGreaterThan(5);
    const vi_pham = tep.filter((p) => /["'`](sata-?\d+|combo[\w-]*)["'`]/i.test(boChuThich(doc(p))));
    expect(vi_pham).toEqual([]);
    // Và không có đường GHI cột allowPause nào khác ngoài lõi này (migration/seed ghi cứng danh sách là đúng thứ anh Toại không muốn).
    const ghiKhac = tep.filter((p) => !p.endsWith("khoa-cho-phep.ts") && /data:\s*\{[^}]*\ballowPause\b/.test(boChuThich(doc(p))));
    expect(ghiKhac).toEqual([]);
  });
});
