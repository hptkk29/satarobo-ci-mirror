// Đợt 3 đơn từ (08/10/2026) — lưới cho đường duyệt MỘT giao dịch (BA §13–14).
// Hành vi trên Postgres thật: tests/cham-cong/duyet-don-lop.spec.ts ([DT3-01..04]).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WORK_REQUEST_KINDS } from "@/lib/work-request";
import { HANDLER_DON } from "./registry";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// CRLF → LF: tệp mã trên máy Windows mang `\r\n`, regex neo `\n…$` sẽ đỏ oan.
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));

describe("[DT3-W] duyệt đơn — một giao dịch", () => {
  it("[DT3-W1] mọi loại đơn có ĐÚNG một handler", () => {
    expect(Object.keys(HANDLER_DON).sort()).toEqual([...WORK_REQUEST_KINDS].sort());
    for (const k of WORK_REQUEST_KINDS) expect(typeof HANDLER_DON[k], k).toBe("function");
  });

  it("[DT3-W2] cả hai audit của decideRequest (duyệt + từ chối) ghi TRONG giao dịch (truyền `tx`)", () => {
    // Hôm nay không có bước nào chạy SAU audit, nên audit ghi ngoài giao dịch cho ra hành vi y hệt —
    // không ca DB nào đỏ (đã cấy, 08/10/2026). Lưới này giữ chỗ cho ngày có bước thứ tư: audit ngoài
    // tx thì bước đó hỏng là sổ ghi "đã duyệt" cho một đơn đã rollback.
    const src = doc("lib/cham-cong/requests.ts");
    const than = src.slice(src.indexOf("export async function decideRequest"), src.indexOf("export async function approversOfCenter"));
    // Mỗi lời gọi cắt tới `});` đầu tiên — trong thân không có `});` lồng (newValues chỉ có `},`).
    const cacLoi = [...than.matchAll(/writeAudit\(\{/g)].map((m) => than.slice(m.index, than.indexOf("});", m.index)));
    expect(cacLoi).toHaveLength(2);
    for (const l of cacLoi) expect(l).toMatch(/\n\s+tx,\s*$/);
  });

  it("[DT3-W3] handler lớp ghi qua `tx` của lượt duyệt — không mở transaction riêng", () => {
    const src = doc("lib/cham-cong/don/lop-hoc.ts");
    expect(src.match(/cancelSession\(\{[\s\S]*?\n\s+tx,\n\s+\}\)/g)).toHaveLength(1);
    expect(src.match(/adjustSession\(\{[^}]*\btx \}\)/g)).toHaveLength(1);
    expect(src).not.toMatch(/\$transaction/);
  });
});
