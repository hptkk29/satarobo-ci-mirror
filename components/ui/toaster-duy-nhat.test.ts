// [TOAST-01] Cả app chỉ được gắn ĐÚNG MỘT <Toaster>, ở layout gốc (26/09/2026).
//
// Sonner vẽ MỌI toast không mang `toasterId` ở MỌI <Toaster> đang gắn trên trang. Layout gốc
// (`app/layout.tsx`) có một bản cho cả 4 site; khung admin (`app/(admin)/admin/layout.tsx`) và
// khung site GV (`app/(teacher)/teacher/_components/app-shell.tsx`) từng gắn THÊM bản riêng ⇒
// mỗi toast ở admin và site GV hiện ĐÔI — lỗi câm: không ném, không làm test nào đỏ, console
// sạch; chỉ người dùng nhìn mới thấy (đo lại được: danh sách `[data-sonner-toast]` ra 2 bản).
//
// Lưới quét CẢ CÂY (app/ + components/) vì bản thứ hai có thể mọc ở một layout/khung MỚI —
// soi riêng hai tệp cũ là bỏ lọt đúng ca đó. Bỏ chú thích trước khi đếm: chú thích giải thích
// bản vá chứa đúng chuỗi "<Toaster".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

function tepTsx(thuMuc: string): string[] {
  const out: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) out.push(...tepTsx(p));
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

function boChuThich(s: string): string {
  return s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("[TOAST-01] đúng MỘT <Toaster> cho cả app", () => {
  it("chỉ app/layout.tsx gắn <Toaster>, và gắn đúng một lần", () => {
    const noiGan: string[] = [];
    for (const f of [...tepTsx(resolve(GOC, "app")), ...tepTsx(resolve(GOC, "components"))]) {
      const n = (boChuThich(readFileSync(f, "utf8")).match(/<Toaster\b/g) ?? []).length;
      for (let i = 0; i < n; i++) noiGan.push(relative(GOC, f).replace(/\\/g, "/"));
    }
    expect(noiGan).toEqual(["app/layout.tsx"]);
  });
});
