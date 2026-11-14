// @vitest-environment node
/**
 * US-12 — thu hồi & gỡ tin (F-DEL). PHẦN THUẦN.
 *
 * File này chỉ kiểm những quyết định KHÔNG chạm DB — đúng phần dễ sai nhất và
 * cũng là phần chốt chặn thật của server:
 *  • cửa sổ 15 phút tính bằng mốc UTC thuần (`Date.now()`), KHÔNG dính múi giờ —
 *    Vercel chạy UTC còn máy dev +07, đây là chỗ "chạy máy tôi thì được" kinh điển;
 *  • AI được gỡ tin AI: tác giả tự thu hồi ≠ kiểm duyệt viên gỡ tin người khác,
 *    và thứ tự các guard quyết định mã lỗi nào lộ ra (không lộ hộ ai điều gì);
 *  • lý do gỡ là BẮT BUỘC và thiếu nó là **VALIDATION 400 field=reason**, KHÔNG
 *    phải 403 (TS-03.6b) — nhầm chỗ này là phụ huynh/GV thấy "không có quyền"
 *    trong khi thật ra chỉ chưa gõ lý do.
 *
 * Nghiệm thu chạm DB thật (soft delete giữ nguyên `body`, tin SYSTEM, AuditLog,
 * ảnh của tin đã gỡ) nằm ở scripts/_zztest-chat-us12.ts.
 */
import { describe, expect, it, vi } from "vitest";

// Hạ tầng chỉ cần "import được" — mọi hàm dưới đây thuần, không gọi tới chúng.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: vi.fn(async () => true),
  conversationBroadcast: vi.fn(() => ({})),
  userBumpBroadcasts: vi.fn(() => []),
}));
// Không kéo next-auth vào test node (lõi nhận Actor seed, không cần phiên thật).
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import {
  CHAT_MODERATION_ERROR_STATUS,
  MODERATION_REASON_MIN_LENGTH,
  MODERATION_SYSTEM_MESSAGE,
  RECALL_WINDOW_MINUTES,
  RECALL_WINDOW_MS,
  checkModeratable,
  checkRecallable,
  deleteMessageAsModeratorSchema,
  isWithinRecallWindow,
  needsSystemNotice,
  recallOwnMessageSchema,
  type ModerationContext,
} from "@/lib/chat/moderation";

const PH1 = "user-ph1";
const PH2 = "user-ph2";
const GV1 = "user-gv1";
const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

function ctxOf(over: Partial<ModerationContext> = {}): ModerationContext {
  return {
    messageId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    senderId: PH1,
    kind: "CHAT",
    createdAt: minutesAgo(10),
    deletedAt: null,
    status: "ACTIVE",
    centerId: "center-1",
    orgUnitId: "org-1",
    subjectType: "CLASS",
    subjectId: "class-1",
    participantId: "part-1",
    participantLeftAt: null,
    ...over,
  };
}

// ─── Cửa sổ 15 phút ─────────────────────────────────────────────────────────

describe("cửa sổ thu hồi 15 phút (AC1)", () => {
  it("hằng số đúng 15 phút — đổi số này là đổi hợp đồng với UI, phải cố ý", () => {
    expect(RECALL_WINDOW_MINUTES).toBe(15);
    expect(RECALL_WINDOW_MS).toBe(900_000);
  });

  it("vừa gửi / 14'59\" → còn thu hồi được", () => {
    expect(isWithinRecallWindow(new Date(NOW), NOW)).toBe(true);
    expect(isWithinRecallWindow(new Date(NOW - 899_000), NOW)).toBe(true);
  });

  it("ĐÚNG 15'00\"000 → VẪN được (AC1 ghi '≤ 15 phút'), 15'00\"001 → hết hạn", () => {
    expect(isWithinRecallWindow(new Date(NOW - RECALL_WINDOW_MS), NOW)).toBe(true);
    expect(isWithinRecallWindow(new Date(NOW - RECALL_WINDOW_MS - 1), NOW)).toBe(false);
  });

  it("đồng hồ lệch về quá khứ (createdAt ở TƯƠNG LAI) vẫn coi là trong hạn, không âm thầm chặn", () => {
    expect(isWithinRecallWindow(new Date(NOW + 5_000), NOW)).toBe(true);
  });

  it("KHÔNG dính múi giờ: cùng một MỐC THỜI GIAN viết ở +07 hay Z đều cho cùng kết quả", () => {
    // 10:00Z === 17:00+07 — cùng instant. Nếu ai đó lỡ dùng new Date(y,m,d,h,mi)
    // hoặc getHours() thì hai dòng này sẽ cho hai kết quả khác nhau.
    const utc = new Date("2026-08-09T09:50:00.000Z"); // 10' trước
    const vn = new Date("2026-08-09T16:50:00.000+07:00"); // CÙNG instant
    expect(vn.getTime()).toBe(utc.getTime());
    expect(isWithinRecallWindow(utc, NOW)).toBe(isWithinRecallWindow(vn, NOW));
    expect(isWithinRecallWindow(vn, NOW)).toBe(true);

    const utcOld = new Date("2026-08-09T09:35:00.000Z"); // 25' trước
    const vnOld = new Date("2026-08-09T16:35:00.000+07:00");
    expect(isWithinRecallWindow(utcOld, NOW)).toBe(false);
    expect(isWithinRecallWindow(vnOld, NOW)).toBe(false);
  });
});

// ─── Ai thu hồi được tin nào ────────────────────────────────────────────────

describe("checkRecallable — tác giả tự thu hồi (AC1)", () => {
  it("tin của chính mình, 10 phút trước, còn trong nhóm → cho qua", () => {
    expect(checkRecallable(ctxOf(), PH1, NOW)).toBeNull();
  });

  it("tin 20 phút trước → RECALL_WINDOW_EXPIRED (TS-03.5b — server chặn kể cả khi UI đã ẩn nút)", () => {
    const err = checkRecallable(ctxOf({ createdAt: minutesAgo(20) }), PH1, NOW);
    expect(err?.code).toBe("RECALL_WINDOW_EXPIRED");
    expect(err?.message).toMatch(/15 phút/);
  });

  it("tin của người khác → PERMISSION_DENIED (không ai tự 'thu hồi' hộ ai)", () => {
    expect(checkRecallable(ctxOf({ senderId: PH2 }), PH1, NOW)?.code).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("tin của người khác VÀ đã quá hạn → vẫn PERMISSION_DENIED, KHÔNG lộ 'tin này quá hạn'", () => {
    // Thứ tự guard có chủ đích: người ngoài không được biết gì về tin của người khác.
    const err = checkRecallable(
      ctxOf({ senderId: PH2, createdAt: minutesAgo(60) }),
      PH1,
      NOW,
    );
    expect(err?.code).toBe("PERMISSION_DENIED");
  });

  it("không tìm thấy tin → MESSAGE_NOT_FOUND", () => {
    expect(checkRecallable(null, PH1, NOW)?.code).toBe("MESSAGE_NOT_FOUND");
  });

  it("đã rời nhóm / chưa từng là thành viên → NOT_PARTICIPANT (mã KHÁC 'không có quyền')", () => {
    expect(
      checkRecallable(ctxOf({ participantLeftAt: minutesAgo(1) }), PH1, NOW)?.code,
    ).toBe("NOT_PARTICIPANT");
    expect(checkRecallable(ctxOf({ participantId: null }), PH1, NOW)?.code).toBe(
      "NOT_PARTICIPANT",
    );
  });

  it("tin đã bị gỡ trước đó → MESSAGE_ALREADY_DELETED (không ghi đè dấu vết cũ)", () => {
    const err = checkRecallable(ctxOf({ deletedAt: minutesAgo(2) }), PH1, NOW);
    expect(err?.code).toBe("MESSAGE_ALREADY_DELETED");
  });

  it("hội thoại ARCHIVED/LOCKED KHÔNG chặn thu hồi — F-DEL chỉ đòi 'tác giả + ≤15 phút'", () => {
    expect(checkRecallable(ctxOf({ status: "ARCHIVED" }), PH1, NOW)).toBeNull();
    expect(checkRecallable(ctxOf({ status: "LOCKED" }), PH1, NOW)).toBeNull();
  });
});

// ─── Kiểm duyệt viên gỡ tin ────────────────────────────────────────────────

describe("checkModeratable — GV/Admin gỡ tin (AC2)", () => {
  it("tin bình thường → cho qua, KHÔNG áp cửa sổ 15 phút (gỡ vi phạm không có hạn)", () => {
    expect(checkModeratable(ctxOf({ senderId: PH2, createdAt: minutesAgo(999) }))).toBeNull();
  });

  it("không tìm thấy tin → MESSAGE_NOT_FOUND", () => {
    expect(checkModeratable(null)?.code).toBe("MESSAGE_NOT_FOUND");
  });

  it("tin đã gỡ → MESSAGE_ALREADY_DELETED (gỡ 2 lần không sinh 2 tin SYSTEM)", () => {
    expect(checkModeratable(ctxOf({ deletedAt: minutesAgo(1) }))?.code).toBe(
      "MESSAGE_ALREADY_DELETED",
    );
  });

  it("KHÔNG đòi người gỡ phải là thành viên — Admin gỡ được mọi nơi (F-DEL)", () => {
    expect(checkModeratable(ctxOf({ participantId: null }))).toBeNull();
  });
});

describe("needsSystemNotice — AC4", () => {
  it("người gỡ ≠ tác giả → có tin SYSTEM", () => {
    expect(needsSystemNotice(ctxOf({ senderId: PH2 }), GV1)).toBe(true);
  });

  it("GV gỡ CHÍNH tin mình → KHÔNG sinh tin SYSTEM (AC4 chỉ nói 'người gỡ ≠ tác giả')", () => {
    expect(needsSystemNotice(ctxOf({ senderId: GV1 }), GV1)).toBe(false);
  });

  it("nội dung tin SYSTEM là chuỗi chốt trong AC4", () => {
    expect(MODERATION_SYSTEM_MESSAGE).toBe("Một tin nhắn đã được quản trị viên gỡ.");
  });
});

// ─── Lý do bắt buộc + schema ───────────────────────────────────────────────

describe("bắt buộc lý do khi gỡ tin người khác (AC2 / TS-03.6b)", () => {
  const MSG = "11111111-1111-4111-8111-111111111111";

  it("thiếu lý do → hỏng ở tầng zod, field = reason (⇒ VALIDATION 400, KHÔNG phải 403)", () => {
    const r = deleteMessageAsModeratorSchema.safeParse({ messageId: MSG });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path.join(".")).toBe("reason");
      expect(r.error.issues[0]?.message).toMatch(/lý do/i);
    }
  });

  it("lý do rỗng / toàn khoảng trắng / quá ngắn → cũng hỏng ở field reason", () => {
    for (const reason of ["", "   ", "abc", "    ab    "]) {
      const r = deleteMessageAsModeratorSchema.safeParse({ messageId: MSG, reason });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path.join(".")).toBe("reason");
    }
  });

  it(`lý do ≥ ${MODERATION_REASON_MIN_LENGTH} ký tự → hợp lệ và được trim`, () => {
    const r = deleteMessageAsModeratorSchema.safeParse({
      messageId: MSG,
      reason: "  Nội dung quảng cáo  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("Nội dung quảng cáo");
  });

  it("messageId sai dạng → hỏng ở field messageId (không phải reason)", () => {
    const r = deleteMessageAsModeratorSchema.safeParse({
      messageId: "khong-phai-uuid",
      reason: "spam quảng cáo",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path.join(".")).toBe("messageId");
  });

  it("thu hồi tin mình KHÔNG đòi lý do — schema chỉ có messageId", () => {
    const r = recallOwnMessageSchema.safeParse({ messageId: MSG });
    expect(r.success).toBe(true);
    // Tham số thừa bị bỏ qua, không biến thành lỗi trước mặt người dùng.
    expect(recallOwnMessageSchema.safeParse({ messageId: MSG, reason: "x" }).success).toBe(
      true,
    );
  });
});

describe("bảng mã lỗi → HTTP status", () => {
  it("thiếu lý do là 400; mọi ca 'không được phép' là 403", () => {
    expect(CHAT_MODERATION_ERROR_STATUS.VALIDATION).toBe(400);
    expect(CHAT_MODERATION_ERROR_STATUS.PERMISSION_DENIED).toBe(403);
    expect(CHAT_MODERATION_ERROR_STATUS.NOT_PARTICIPANT).toBe(403);
    expect(CHAT_MODERATION_ERROR_STATUS.RECALL_WINDOW_EXPIRED).toBe(403);
  });

  it("không tìm thấy = 404, gỡ trùng = 409 (không lẫn vào nhóm 403)", () => {
    expect(CHAT_MODERATION_ERROR_STATUS.MESSAGE_NOT_FOUND).toBe(404);
    expect(CHAT_MODERATION_ERROR_STATUS.MESSAGE_ALREADY_DELETED).toBe(409);
  });
});
