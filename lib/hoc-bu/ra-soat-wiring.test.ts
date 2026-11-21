// [RSW-*] — màn "Rà soát dữ liệu Học bù" CHỈ ĐỌC: lưới ghim mã nguồn. Ca hành vi không bắt được "ai đó thêm nút tự sửa" hay "ai đó bỏ cổng quyền" — hai điều
// này là toàn bộ lý do màn tồn tại ở dạng chỉ đọc, nên canh bằng văn bản mã (neo hẹp, đếm số lần, BỎ chú thích trước khi so).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bỏ chú thích — chú thích giải thích bản vá thường chứa đúng chuỗi mà lưới đang cấm. */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const TRANG = boChuThich(doc("app/(admin)/admin/hoc-bu/ra-soat/page.tsx"));
const DB = boChuThich(doc("lib/hoc-bu/ra-soat-db.ts"));
const TRANG_HOC_BU = boChuThich(doc("app/(admin)/admin/hoc-bu/page.tsx"));

describe("[RSW] màn Rà soát dữ liệu Học bù — chỉ đọc", () => {
  it("[RSW-01] cổng quyền `makeup:view-all` đứng TRƯỚC mọi lần đọc dữ liệu; chưa đăng nhập ⇒ /login", () => {
    const iQuyen = TRANG.indexOf('checkPermission("makeup:view-all")');
    const iDoc = TRANG.indexOf("docRaSoat(");
    expect(iQuyen).toBeGreaterThan(0);
    expect(iDoc).toBeGreaterThan(iQuyen);
    expect(dem(TRANG, /checkPermission\("makeup:view-all"\)/g)).toBe(1);
    expect(dem(TRANG, /redirect\("\/login"\)/g)).toBe(1);
    expect(dem(TRANG, /docRaSoat\(/g)).toBe(1);
  });

  it("[RSW-02] checker chỉ chạy khi bấm 'Chạy rà soát' (?chay=1): trước `docRaSoat(` có return sớm theo tham số", () => {
    const iSom = TRANG.indexOf('sp.chay !== "1"');
    expect(iSom).toBeGreaterThan(0);
    expect(TRANG.indexOf("docRaSoat(")).toBeGreaterThan(iSom);
  });

  it("[RSW-03] KHÔNG có đường ghi: không Server Action, không <form>, không import script/kế hoạch sửa, không nút tự sửa", () => {
    expect(TRANG).not.toMatch(/["']use server["']/);
    expect(TRANG).not.toMatch(/<form\b/i);
    expect(TRANG).not.toMatch(/<button\b/i);
    expect(TRANG).not.toMatch(/sua-du-lieu|ke-hoach-sua|apDungSua|lapKeHoachSua|_actions/);
    expect(DB).not.toMatch(/sua-du-lieu|ke-hoach-sua|apDungSua|lapKeHoachSua/);
  });

  it("[RSW-04] đọc trong transaction READ ONLY + REPEATABLE READ và TỰ KIỂM cả hai cờ; không phép ghi Prisma / SQL ghi nào", () => {
    expect(dem(DB, /\$executeRaw`SET TRANSACTION READ ONLY`/g)).toBe(1);
    expect(dem(DB, /\$executeRaw/g)).toBe(1); // chỉ đúng dòng SET TRANSACTION
    expect(DB).toContain('isolationLevel: "RepeatableRead"');
    expect(DB).toContain('t.ro !== "on"');
    expect(DB).toContain('t.iso !== "repeatable read"');
    expect(DB).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(DB).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b\s+(INTO|FROM|")/i);
  });

  it("[RSW-05] lối vào từ /hoc-bu CHỈ khi người xem có `makeup:view-all` (cùng cổng với chính màn)", () => {
    expect(dem(TRANG_HOC_BU, /href="\/hoc-bu\/ra-soat"/g)).toBe(1);
    const i = TRANG_HOC_BU.indexOf('href="/hoc-bu/ra-soat"');
    // Cổng là `xemTatCa` — viết dạng `xemTatCa ? <Link> : …` hay `xemTatCa && <Link>` (20/10/2026: cạnh nó có thêm nút "Duyệt case" cho `makeup:waive`) đều là CÙNG một cổng.
    expect(TRANG_HOC_BU.slice(Math.max(0, i - 400), i)).toMatch(/xemTatCa\s*(\?|&&)/);
  });
});
