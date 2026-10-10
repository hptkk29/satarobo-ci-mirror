/**
 * Đọc THẲNG hợp đồng `docs/pos-agent-api.md` (bản 1.1) cho test — một nguồn sự thật cho hai phía: tệp này trùng sha256
 * ở worktree GĐ4 (máy chủ) và GĐ5 (extension). Máy chủ đọc CÙNG cột bằng cùng biểu thức ([POS4-HD-01],
 * `lib/payments/pos/agent/chot-hop-dong.test.ts`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `core.autocrlf=true` trên máy Windows ⇒ tệp .md có thể về CRLF khi checkout: chuẩn hoá trước khi đọc.
export const HOP_DONG = readFileSync(resolve(process.cwd(), "docs/pos-agent-api.md"), "utf8").replace(/\r\n/g, "\n");

export interface OTran {
  tran: number;
  cach: "cắt" | "null";
}

/**
 * Bảng §6.1 ⇒ khoá ↦ ô cột "Trần · vượt (agent)" (`≤ N · cắt|null`), theo ĐÚNG thứ tự dòng của bảng (ô gộp
 * `a` · `b` tách thành hai khoá cùng ô). Dòng có khoá mà không có ô ⇒ null (lưới báo thiếu).
 */
export function bangTranHopDong(): Map<string, OTran | null> {
  const bang = HOP_DONG.slice(HOP_DONG.indexOf("### 6.1"), HOP_DONG.indexOf("### 6.2"));
  const ra = new Map<string, OTran | null>();
  for (const dong of bang.split("\n")) {
    const khoa = /^\| ((?:`[a-z_]+`(?: · )?)+) \|/.exec(dong);
    if (!khoa) continue;
    const o = /\| ≤ (\d+) · (cắt|null) \|/.exec(dong);
    for (const m of khoa[1].matchAll(/`([a-z_]+)`/g)) {
      ra.set(m[1], o ? { tran: Number(o[1]), cach: o[2] === "cắt" ? "cắt" : "null" } : null);
    }
  }
  return ra;
}
