// @vitest-environment node
/** [NCC-W*] LƯỚI DÂY NỐI — `/api/leads` phải NHẢ chỗ giữ click ở hai đường không ghi referral (lead không tạo được · vượt trần dấu vết). Gỡ lời gọi thì không test hành vi nào đỏ: click bị đốt oan và lần gửi lại mất ghi công. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ma = readFileSync(resolve(process.cwd(), "app/api/leads/route.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1");

describe("[NCC-W] /api/leads nhả chỗ giữ click", () => {
  it("[NCC-W1] nhaChoClick được gọi đúng 2 lần (lead không tạo được · vượt trần) và được import", () => {
    expect((ma.match(/nhaChoClick\(/g) ?? []).length).toBe(2);
    expect(ma).toMatch(/import \{ nhaChoClick \} from '@\/lib\/affiliate\/giu-cho-click'/);
  });
  it("[NCC-W2] nhả CHỈ bằng cặp (clickId, idempotencyKey) của chính lượt này — không bao giờ nhả theo clickId trần", () => {
    expect((ma.match(/nhaChoClick\(coAff\.ghi\.clickId, coAff\.ghi\.idempotencyKey\)/g) ?? []).length).toBe(2);
  });
});