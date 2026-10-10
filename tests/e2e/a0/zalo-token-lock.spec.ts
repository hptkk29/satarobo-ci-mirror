/**
 * AUTH-SĐT P4 — hồi quy khoá advisory của Zalo token trên POSTGRES THẬT.
 *
 * Bug prod 31/07: `lib/zalo/token.ts` lấy khoá bằng
 * `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\`` — hàm này trả kiểu `void`,
 * Prisma $queryRaw cố giải mã cột đó và ném "Failed to deserialize column of
 * type 'void'" ⇒ MỌI lần refresh access_token đều chết ⇒ OA không gửi được ZNS
 * (biểu hiện ra ngoài là `ZALO_NOT_CONFIGURED` dù trạng thái hiện "live").
 *
 * Unit test KHÔNG bắt được vì mock $queryRaw trả mảng rỗng. Chỉ Postgres thật
 * mới lộ ⇒ ca này phải sống ở đây, đừng chuyển xuống unit.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";

/**
 * Khoá RIÊNG của test — KHÔNG dùng `'zalo_oa_token'` như code thật.
 *
 * Vá flake 01/08: hai ca dưới đây từng lấy đúng khoá production, mà app đang
 * chạy song song (webServer + cron/refresh) cũng giành đúng khoá đó ⇒ thỉnh
 * thoảng `40P01 deadlock detected`, đỏ khoảng 1/3 lần chạy. Điều hai ca này
 * chứng minh là **hành vi của Prisma với hàm trả `void`** — hoàn toàn không phụ
 * thuộc giá trị khoá. Đổi sang khoá riêng thì hết tranh chấp mà không mất tí
 * sức mạnh nào của test.
 */
const TEST_LOCK_KEY = "a0_test_advisory_void_probe";

test.describe("[P4] khoá advisory refresh token Zalo", () => {
  test("[P4-LOCK-01] $executeRaw lấy được pg_advisory_xact_lock trong transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TEST_LOCK_KEY}))`;
        return true;
      }),
    ).resolves.toBe(true);
  });

  test("[P4-LOCK-02] $queryRaw cho cùng câu lệnh VẪN ném lỗi 'void' — lý do phải dùng $executeRaw", async () => {
    // Khoá cứng nguyên nhân gốc: nếu Prisma sau này đổi hành vi (hết ném lỗi),
    // ca này đỏ và người sửa sẽ đọc được vì sao code không dùng $queryRaw.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${TEST_LOCK_KEY}))`;
      }),
    ).rejects.toThrow(/deserialize column of type 'void'/i);
  });

  test("[P4-LOCK-03] code thật VẪN dùng $executeRaw cho advisory lock (chống hồi quy #76)", async () => {
    // Hai ca trên chứng minh hành vi Prisma; ca này khoá chính CODE. Không có nó,
    // ai đó đổi lại `$queryRaw` trong lib/zalo/token.ts sẽ không ai bắt được —
    // đúng kịch bản bug prod 31/07 (badge hiện "live" mà không gửi được tin nào).
    const { readFile } = await import("fs/promises");
    const raw = await readFile("lib/zalo/token.ts", "utf8");
    // Bỏ comment TRƯỚC khi soi: chính file này có đoạn giải thích nhắc `$queryRaw`
    // cạnh `pg_advisory_xact_lock` — soi cả comment thì test tự đỏ vì lời văn.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    const lockLines = code
      .split("\n")
      .filter((l) => l.includes("pg_advisory_xact_lock"));
    expect(lockLines.length).toBeGreaterThan(0);
    for (const line of lockLines) {
      expect(line).toContain("$executeRaw");
      expect(line).not.toContain("$queryRaw");
    }
  });
});
