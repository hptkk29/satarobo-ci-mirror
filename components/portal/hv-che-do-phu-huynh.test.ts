// LƯỚI: mọi segment của cổng phụ huynh phải CHẶN con đang ở chế độ học sinh.
//
// Vì sao quét cây: layout gốc của portal không biết đường dẫn và không chạy lại khi điều hướng mềm, nên mỗi segment tự gác.
// Gác bằng MỘT trong hai cách — (1) `requireActiveStudent()` mặc định (fail-closed: chỉ `{ choHocSinh: true }` mới qua được chế độ học sinh),
// (2) `layout.tsx` gọi `chanKhiOCheDoHocSinh()`. Thêm một segment mới mà quên cả hai ⇒ lưới này đỏ, đúng lúc đó chứ không phải khi con
// mở được trang học phí.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(process.cwd(), "app/(portal)/portal");
const doc = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// Bỏ chú thích để dòng giải thích bản vá không "tự khớp" mẫu đang tìm (bài học luật 11).
// Bỏ DÒNG chú thích trước (một dòng // có thể chứa "/**" của đường dẫn và nuốt cả đoạn mã phía sau), rồi mới bỏ khối /* */.
const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((d) => !/^\s*\/\//.test(d))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\s)\/\/.*$/gm, "$1");

function segment(): string[] {
  return readdirSync(GOC).filter((n) => {
    if (n.startsWith("_") || n === "hoc-sinh") return false;
    return statSync(join(GOC, n)).isDirectory();
  });
}

function dsTep(dir: string): string[] {
  const ra: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) ra.push(...dsTep(p));
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) ra.push(p);
  }
  return ra;
}

describe("[HVC-01] mọi segment của phụ huynh chặn chế độ học sinh", () => {
  for (const seg of segment()) {
    it(`segment /portal/${seg}`, () => {
      const layout = boChuThich(doc(join(GOC, seg, "layout.tsx")));
      const page = boChuThich(doc(join(GOC, seg, "page.tsx")));
      const layoutChan = /chanKhiOCheDoHocSinh\(\)/.test(layout);
      // `requireActiveStudent()` KHÔNG tham số = fail-closed. Có `choHocSinh` thì là cổng học sinh, không tính.
      const pageChan = /requireActiveStudent\(\s*\)/.test(page);
      expect(layoutChan || pageChan, `segment /portal/${seg} không gác chế độ học sinh`).toBe(true);
    });
  }
});

describe("[HVC-02] chỉ đúng chỗ mới được mở cổng cho chế độ học sinh", () => {
  // Cổng học sinh (hoc-sinh/**) và ba hành động mà trang học sinh gọi lại (nộp bài, làm bài thi, đánh giá giáo viên).
  const CHO_PHEP = [
    "hoc-sinh/",
    "bai-tap/actions.ts",
    "bai-thi/actions.ts",
    "danh-gia-gv/_actions.ts",
  ];
  it("`choHocSinh: true` chỉ xuất hiện ở tệp được liệt kê", () => {
    const loi: string[] = [];
    for (const f of [...dsTep(GOC), ...dsTep(resolve(process.cwd(), "lib/portal"))]) {
      const rel = f.replace(/\\/g, "/");
      if (!/choHocSinh\s*:\s*true/.test(boChuThich(readFileSync(f, "utf8")))) continue;
      const trongPortal = rel.split("app/(portal)/portal/")[1];
      if (!trongPortal || !CHO_PHEP.some((c) => trongPortal.startsWith(c))) loi.push(rel);
    }
    expect(loi).toEqual([]);
  });
  it("[HVC-03] cả hai nhóm route của Cổng học sinh có layout gác đúng chiều", () => {
    const hs = boChuThich(doc(join(GOC, "hoc-sinh/(hoc-sinh)/layout.tsx")));
    const bm = boChuThich(doc(join(GOC, "hoc-sinh/(ba-me)/layout.tsx")));
    expect(hs).toMatch(/cheDo\s*!==\s*"hoc-sinh"[\s\S]*redirect\("\/portal\/hoc-sinh\/vao"\)/);
    expect(bm).toMatch(/cheDo\s*===\s*"hoc-sinh"[\s\S]*redirect\("\/portal\/hoc-sinh"\)/);
  });
  it("[HVC-04] mọi trang học sinh nằm TRONG nhóm (hoc-sinh), trừ vao/ma nằm trong (ba-me)", () => {
    const goc = readdirSync(join(GOC, "hoc-sinh"));
    // Ngoài hai nhóm route chỉ được có actions.ts — một page.tsx để rơi ngoài nhóm là trang không ai gác.
    expect(goc.filter((n) => n !== "(hoc-sinh)" && n !== "(ba-me)" && n !== "actions.ts")).toEqual([]);
  });
});
