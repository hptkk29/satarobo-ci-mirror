// @vitest-environment node
// lib/ai-lead/trang-thai-handoff.test.ts — BẢNG CỐ ĐỊNH của POST /handoffs (handoff-guide.md §4.3). THUẦN.
// Mã ca: [AIL-HO-01..]. Bảng khớp 3 phản hồi hợp lệ của hợp đồng (fixture 20/21/22) VÀ fixture SAI 79 không nằm trong bảng.
import { describe, expect, it } from "vitest";
import { bangHandoff } from "./trang-thai-handoff";
import { handoffResponseSchema } from "./schemas";
import { docFixture } from "./ho-tro-test";
import type { OwnerState } from "./kieu";

const BANG: [OwnerState, string, string, string][] = [
  ["AI_ACTIVE", "QUEUED", "HANDOFF_REQUESTED", "SEND_HOLDING_MESSAGE"],
  ["HANDOFF_REQUESTED", "ALREADY_QUEUED", "HANDOFF_REQUESTED", "STAY_SILENT"],
  ["TAKEOVER_PENDING", "ALREADY_QUEUED", "HANDOFF_REQUESTED", "STAY_SILENT"],
  ["HUMAN_ACTIVE", "ALREADY_HUMAN_OWNED", "HUMAN_ACTIVE", "STAY_SILENT"],
  ["PAUSED", "ALREADY_HUMAN_OWNED", "PAUSED", "STAY_SILENT"],
];

describe("[AIL-HO-01] bảng cố định theo ownerState", () => {
  it.each(BANG)("%s ⇒ %s · %s · %s", (o, st, mode, act) => {
    expect(bangHandoff(o)).toEqual({ handoffStatus: st, ownerMode: mode, nextAction: act });
  });
  it("chỉ MỘT trạng thái cho tin chờ: QUEUED ⇔ SEND_HOLDING_MESSAGE", () => {
    for (const [o] of BANG) {
      const b = bangHandoff(o);
      expect(b.nextAction === "SEND_HOLDING_MESSAGE").toBe(b.handoffStatus === "QUEUED");
    }
  });
  it("mọi tổ hợp đều là phản hồi HỢP LỆ theo schema hợp đồng", () => {
    for (const [o] of BANG) {
      const r = handoffResponseSchema.safeParse({
        ok: true,
        data: { receiptId: "rct_abcdef123456abcdef", ...bangHandoff(o) },
        meta: { requestId: "req_abcdef123456abcdef123456", serverTime: 1 },
      });
      expect(r.success, o).toBe(true);
    }
  });
  it("fixture SAI 79 (QUEUED + STAY_SILENT) KHÔNG nằm trong bảng", () => {
    const f = docFixture("79");
    const d = (f.response.body as { data: { handoffStatus: string; nextAction: string } }).data;
    expect(BANG.some(([, st, , act]) => st === d.handoffStatus && act === d.nextAction)).toBe(false);
  });
});
