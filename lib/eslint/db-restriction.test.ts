// R6-F1-T10 — ESLint chặn import @/lib/db trần trong app/(admin|portal)/**.
// Dùng ESLint Node API lint một đoạn code với filePath giả → khẳng định có lỗi
// no-restricted-imports cho file MỚI (ngoài allowlist), và KHÔNG lỗi cho file public.
import { describe, it, expect, beforeAll } from "vitest";
import { ESLint } from "eslint";
import { DB_IMPORT_ALLOWLIST } from "./db-import-allowlist.mjs";

const eslint = new ESLint();
const CODE = `import { db } from "@/lib/db"\nexport async function x() { return db }\n`;

async function lint(filePath: string) {
  const [res] = await eslint.lintText(CODE, { filePath });
  return res.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

// Lần lintText đầu nạp cả config + typescript-eslint (~30s). Warm-up trước.
beforeAll(async () => {
  await lint("lib/__warmup__.ts");
}, 90_000);

describe("[R6-F1] ESLint chặn @/lib/db trong admin/portal", () => {
  it("[R6-F1-T10-01] file MỚI app/(admin)/** import @/lib/db → lỗi", { timeout: 60_000 }, async () => {
    const msgs = await lint("app/(admin)/admin/__r6f1_new__/x.ts");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].message).toContain("@/lib/db");
  });

  it("[R6-F1-T10-02] file MỚI app/(portal)/** import @/lib/db → lỗi", async () => {
    const msgs = await lint("app/(portal)/portal/__r6f1_new__/x.ts");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("[R6-F1-T10-03] file public (read toàn cục) KHÔNG bị chặn @/lib/db", async () => {
    const msgs = await lint("app/(public)/khoa-hoc/__r6f1_new__/x.ts");
    expect(msgs.length).toBe(0);
  });

  it("[R6-F1-T10-04] file trong allowlist (grandfather) tạm KHÔNG bị chặn", async () => {
    const grandfathered = DB_IMPORT_ALLOWLIST[0];
    expect(typeof grandfathered).toBe("string");
    const msgs = await lint(grandfathered);
    expect(msgs.length).toBe(0);
  });
});
