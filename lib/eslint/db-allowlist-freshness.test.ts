import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DB_IMPORT_ALLOWLIST } from "./db-import-allowlist.mjs";

// Guard cho db-import-allowlist.mjs (whitelist file admin/portal được phép import
// `@/lib/db` trần). Mục tiêu dài hạn: whitelist → 0. Mỗi file migrate sang
// scopedDb(actor) PHẢI xoá entry tương ứng ở đây.
//
// LƯU Ý: KHÔNG khẳng định "mọi entry còn import db trần" — hiện vẫn còn ~29 entry
// tech-debt (page.tsx đã chuyển scopedDb nhưng chưa gỡ, thuộc ticket khác). Test
// này chỉ chốt: (1) các file ĐÃ migrate trong đợt dọn này không quay lại whitelist,
// (2) mọi entry trỏ tới file có thật, (3) không trùng lặp.

// Glob char-class `[[]id[]]` → đường dẫn thật `[id]`.
function unescapeGlob(entry: string): string {
  return entry.replace(/\[\[\]/g, "[").replace(/\[\]\]/g, "]");
}

const BARE_DB_IMPORT = /from\s+["']@\/lib\/db["']/;

// Files đã chuyển hẳn sang scopedDb trong đợt dọn FL (D5/R8) → KHÔNG được nằm
// trong whitelist nữa. Regression guard: thêm lại sẽ fail.
const MIGRATED_OFF_ALLOWLIST = [
  "app/(admin)/admin/dashboard/_components/accountant-dashboard.tsx",
  "app/(admin)/admin/dashboard/_components/manager-dashboard.tsx",
  "app/(admin)/admin/dashboard/_components/marketing-hr-dashboards.tsx",
  "app/(admin)/admin/enrollments/page.tsx",
  "app/(admin)/admin/sessions/page.tsx",
];

describe("db-import-allowlist freshness", () => {
  it("không còn whitelist các file đã migrate sang scopedDb (đợt dọn FL)", () => {
    const offenders = MIGRATED_OFF_ALLOWLIST.filter((f) =>
      DB_IMPORT_ALLOWLIST.includes(f),
    );
    expect(offenders).toEqual([]);
  });

  it("các file đã migrate thực sự KHÔNG còn import @/lib/db trần", () => {
    const stillBare = MIGRATED_OFF_ALLOWLIST.filter((f) => {
      const p = path.resolve(process.cwd(), unescapeGlob(f));
      if (!fs.existsSync(p)) return false;
      return BARE_DB_IMPORT.test(fs.readFileSync(p, "utf8"));
    });
    expect(stillBare).toEqual([]);
  });

  it("mọi entry whitelist trỏ tới file có thật (không trỏ file đã xoá/đổi tên)", () => {
    const missing = DB_IMPORT_ALLOWLIST.filter(
      (entry) => !fs.existsSync(path.resolve(process.cwd(), unescapeGlob(entry))),
    );
    expect(missing).toEqual([]);
  });

  it("whitelist không có entry trùng lặp", () => {
    const dupes = DB_IMPORT_ALLOWLIST.filter(
      (e, i) => DB_IMPORT_ALLOWLIST.indexOf(e) !== i,
    );
    expect(dupes).toEqual([]);
  });
});
