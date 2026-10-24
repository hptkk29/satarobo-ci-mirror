// @vitest-environment node
/**
 * [FIX-F3-*] — `lib/settings/service.ts` KHÔNG được với tới `lib/nguon/feature.ts` bằng đường import nào (kể cả bắc cầu).
 *
 * Vì sao có: `feature.ts` đọc setting qua `service.ts`; `service.ts` gọi phép kiểm giá trị theo DB (`kiem-theo-db.ts`) lúc LƯU; phép kiểm ấy từng lấy khoá `KHOA_NGUON` từ
 * `feature.ts` ⇒ vòng `feature → service → kiem-theo-db → feature`. Hai hậu quả đo được: (1) `pnpm lint:boundaries` (dependency-cruiser, rule `no-circular` mức error — cổng của job Quality)
 * đỏ; (2) trước đây phải dựng bảng kiểm TRONG hàm để né TDZ lúc nạp module. Khoá nay nằm ở lá `lib/nguon/khoa-setting.ts` (không import gì), `feature.ts` xuất lại.
 *
 * Lưới đo ĐỒ THỊ import thật (không đếm chữ): đóng bao truyền đệ quy từ `service.ts` — gồm cả `import type` và `import()` (đúng như dependency-cruiser đếm
 * với `tsPreCompilationDeps: true`) — không chứa `lib/nguon/feature.ts`. Lưới nhỏ, chạy trong vitest thuần, không cần DB.
 *
 * Cấy 1: trả `kiem-theo-db.ts` về `import { KHOA_NGUON } from "@/lib/nguon/feature"` ⇒ [FIX-F3-01] và [FIX-F3-02] đỏ.
 * Cấy 2: cho `khoa-setting.ts` import `./feature` ⇒ [FIX-F3-01] và [FIX-F3-03] đỏ.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Các chỉ định import trong một tệp: `from "x"`, `import "x"`, `import("x")`. */
function chiDinhImport(src: string): string[] {
  const ra: string[] = [];
  for (const m of boChuThich(src).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) ra.push(m[1]!);
  return ra;
}

/** Giải một chỉ định về tệp trong repo; ngoài repo (npm, node:) ⇒ null. */
function giai(tuTep: string, cd: string): string | null {
  let co: string;
  if (cd.startsWith("@/")) co = resolve(GOC, cd.slice(2));
  else if (cd.startsWith(".")) co = resolve(dirname(tuTep), cd);
  else return null;
  for (const hau of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = co + hau;
    if (existsSync(p) && /\.(ts|tsx)$/.test(p)) return p;
  }
  return null;
}

/** Đóng bao import truyền đệ quy từ một tệp (tệp chính nó không nằm trong tập trả về). */
function dongBao(batDau: string): Set<string> {
  const thay = new Set<string>();
  const hang = [batDau];
  while (hang.length > 0) {
    const t = hang.pop()!;
    for (const cd of chiDinhImport(readFileSync(t, "utf8"))) {
      const d = giai(t, cd);
      if (d && !thay.has(d)) {
        thay.add(d);
        hang.push(d);
      }
    }
  }
  return thay;
}

const tu = (p: string) => resolve(GOC, p);

describe("[FIX-F3-04] lib/hoa-hong không có vòng chon-quy-tac → vi-sao → kieu → chon-quy-tac", () => {
  // Vòng này sinh ra ở lượt gom định dạng số về `vi-sao.ts` (`chon-quy-tac.ts` bắt đầu nhập `dinhDangSo`) trong khi `vi-sao.ts` đã nhập hằng từ `kieu.ts`, mà `kieu.ts` nhập kiểu từ
  // `chon-quy-tac.ts`. dependency-cruiser đếm cả `import type` (tsPreCompilationDeps) nên `pnpm lint:boundaries` đỏ dù chạy được. Cấy: trả hằng về `import … from "./kieu"` ở vi-sao.ts ⇒ ca này đỏ.
  it("đóng bao import của chon-quy-tac.ts KHÔNG quay lại chính nó; vi-sao.ts không nhập kieu.ts; khieu-nai-ma.ts là LÁ", () => {
    const chon = tu("lib/hoa-hong/chon-quy-tac.ts");
    const bao = dongBao(chon);
    expect(bao.has(tu("lib/hoa-hong/vi-sao.ts")), "tiền đề: phép đo thấy cạnh chon-quy-tac → vi-sao").toBe(true);
    expect(bao.has(chon), "chon-quy-tac.ts không được tự với tới mình").toBe(false);
    expect(dongBao(tu("lib/hoa-hong/vi-sao.ts")).has(tu("lib/hoa-hong/kieu.ts"))).toBe(false);
    expect(chiDinhImport(readFileSync(tu("lib/hoa-hong/khieu-nai-ma.ts"), "utf8"))).toEqual([]);
    // đối chứng dương: kieu.ts vẫn xuất lại hằng (nơi gọi cũ không phải đổi) và kieu.ts → chon-quy-tac.ts là cạnh có thật
    expect(dongBao(tu("lib/hoa-hong/kieu.ts")).has(chon)).toBe(true);
    expect((boChuThich(readFileSync(tu("lib/hoa-hong/kieu.ts"), "utf8")).match(/export \{ MA_KHOI_PHUC_HOAN_LEGACY \} from "\.\/khieu-nai-ma"/g) ?? []).length).toBe(1);
  });
});

describe("[FIX-F3] settings/service không với tới nguon/feature", () => {
  it("[FIX-F3-01] đóng bao import của lib/settings/service.ts KHÔNG chứa lib/nguon/feature.ts (hết vòng feature → service → … → feature)", () => {
    const bao = dongBao(tu("lib/settings/service.ts"));
    expect(bao.size, "tiền đề: phép đo thật sự đi qua nhiều tệp (db, audit, registry…)").toBeGreaterThan(5);
    expect(bao.has(tu("lib/settings/kiem-theo-db.ts")), "tiền đề: đường kiểm theo DB vẫn nằm trong đồ thị của service").toBe(true);
    expect(bao.has(tu("lib/nguon/feature.ts"))).toBe(false);
  });

  it("[FIX-F3-02] đối chứng dương của phép đo: đồ thị CÓ thấy cạnh thật — feature.ts đi tới service.ts, và khoa-setting.ts được kiem-theo-db.ts nhập", () => {
    expect(dongBao(tu("lib/nguon/feature.ts")).has(tu("lib/settings/service.ts"))).toBe(true);
    expect(dongBao(tu("lib/settings/kiem-theo-db.ts")).has(tu("lib/nguon/khoa-setting.ts"))).toBe(true);
  });

  it("[FIX-F3-03] khoa-setting.ts là LÁ (không import gì) và feature.ts vẫn xuất `KHOA_NGUON` (nơi gọi cũ không phải đổi)", () => {
    expect(chiDinhImport(readFileSync(tu("lib/nguon/khoa-setting.ts"), "utf8"))).toEqual([]);
    const f = boChuThich(readFileSync(tu("lib/nguon/feature.ts"), "utf8"));
    expect((f.match(/export \{ KHOA_NGUON \}/g) ?? []).length).toBe(1);
    expect((f.match(/export const KHOA_NGUON/g) ?? []).length).toBe(0);
  });
});
