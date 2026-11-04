// @vitest-environment node
/**
 * US-05 — Bộ test ma trận quyền chat, TẦNG ĐỘNG (DB thật, khung dựng TRƯỚC hiện thực).
 *
 * Quy ước Nền Hệ thống (CLAUDE.md, luật 5): test AUTO-CI viết TRƯỚC — các Server
 * Action chat (sendMessage, sendAnnouncement, deleteMessage, recallMessage,
 * listConversations, getMessages, openDm, adminLookup) CHƯA TỒN TẠI, nên từng ô
 * ma trận nằm ở `it.todo(...)` với tên chứa mã ô + mã lỗi kỳ vọng + story sẽ mở.
 * Story sau (US-06/US-08/US-10/US-12/US-13/US-15) đổi todo → test thật chạy qua
 * `runAction` (lib/actions/factory.ts) với actor seed — KHÔNG cần HTTP.
 *
 * TS-02 (cách ly realtime channel) KHÔNG lặp lại ở đây — từ 28/09/2026 (gỡ Supabase
 * Realtime) cổng quyền nằm ở lib/chat/realtime-authz.ts (+ test), route SSE ở
 * app/api/chat/stream/route.test.ts và tests/chat/realtime-sse.spec.ts.
 *
 * DB guard: chỉ chạy khi có Postgres LOCAL (.env.test / TEST_DATABASE_URL trỏ
 * localhost — xem .claude/rules/prisma-db.md). Máy không có DB → skip có thông
 * điệp, `pnpm test:unit -- --run` vẫn xanh.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Hai mock BẮT BUỘC để import được `lib/chat/messages.ts` + `lib/chat/admin.ts` trong
// vitest node (đã đo, không phải phòng xa):
//   • `@/lib/auth` kéo theo `next-auth` → "Cannot find module .../next/server" lúc import.
//     Không sao cả: mọi test ở đây gọi bản `*AsActor` (Actor resolve thẳng từ DB), đường
//     `auth()` chỉ tồn tại ở biên HTTP.
//   • `@/lib/chat/broadcast` có `import "server-only"` → ném ngay khi import ngoài Next.
//     Mock luôn ghi lại event để khẳng định AC3 có phát `conversation.locked` thật.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
const broadcastLog: { topic: string; event: string; payload: Record<string, unknown> }[] = [];
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: async (
    msgs: { topic: string; event: string; payload: Record<string, unknown> }[],
  ) => {
    broadcastLog.push(...msgs);
    return true;
  },
  conversationBroadcast: (
    conversationId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => ({ topic: `conv:${conversationId}`, event, payload, private: true }),
  userBumpBroadcasts: () => [],
}));

import { db } from "../../lib/db";
import { disconnectDb } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { getMessagesPage } from "../../lib/chat/queries";
import { dmKeyOf, openDmAsActor, reconcileDmConversations } from "../../lib/chat/dm";
import { sendChatMessageAsActor } from "../../lib/chat/messages";
import {
  adminLookupConversationAsActor,
  setConversationLockAsActor,
} from "../../lib/chat/admin";
import { seedChatFixture, type ChatFixture } from "./_helpers/seed-chat";

import { RUN_DB_TESTS as RUN_DB_TESTS_CHUNG } from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db`.
const HAS_LOCAL_DB = RUN_DB_TESTS_CHUNG;

// ─────────────────────────────────────────────────────────────────────────────
// Seed chuẩn TestScenarios — phần CHẠY THẬT ngay từ US-05 (khi có DB local).
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_LOCAL_DB)(
  "US-05 tầng động — seed chuẩn TestScenarios (DB local)",
  () => {
    let fx: ChatFixture;

    beforeAll(async () => {
      fx = await seedChatFixture();
    });

    afterAll(async () => {
      await disconnectDb();
    });

    it("seed dựng đủ: 3 nhóm lớp (LopC ARCHIVED) + 1 DM centerId=null", async () => {
      const [convA, convC, dm] = await Promise.all([
        db.conversation.findUniqueOrThrow({ where: { id: fx.conversations.lopA } }),
        db.conversation.findUniqueOrThrow({ where: { id: fx.conversations.lopC } }),
        db.conversation.findUniqueOrThrow({ where: { id: fx.conversations.dmGv1Ph1 } }),
      ]);
      expect(convA.status).toBe("ACTIVE");
      expect(convA.centerId).toBe(fx.centers.cs1);
      expect(convC.status).toBe("ARCHIVED");
      expect(dm.type).toBe("DM_TEACHER_PARENT");
      expect(dm.centerId).toBeNull(); // delta E.3 — DM không thuộc cơ sở nào
    });

    it("participant đúng vai: gv MODERATOR, ql1 MEMBER/CENTER_MANAGER, ph4 leftAt ĐÃ SET", async () => {
      const parts = await db.conversationParticipant.findMany({
        where: { conversationId: fx.conversations.lopA },
      });
      const byUser = new Map(parts.map((p) => [p.userId, p]));
      expect(byUser.get(fx.users.gv1)?.role).toBe("MODERATOR");
      expect(byUser.get(fx.users.gv3)?.role).toBe("MODERATOR"); // dạy chéo — vẫn là GV nhóm LopA
      expect(byUser.get(fx.users.ql1)?.role).toBe("MEMBER"); // chốt 07/08: QLCS = MEMBER
      expect(byUser.get(fx.users.ql1)?.derivedFrom).toBe("CENTER_MANAGER");
      expect(byUser.get(fx.users.ph1)?.leftAt).toBeNull();
      expect(byUser.get(fx.users.ph4)?.leftAt).not.toBeNull(); // TS-01.7 tiền đề
      // sale1 KHÔNG bao giờ là participant (P0 — F5 đã dời).
      expect(byUser.has(fx.users.sale1)).toBe(false);
    });

    it("seed idempotent — chạy lần 2 không nhân đôi participant (US-03 AC6 tiền đề)", async () => {
      const before = await db.conversationParticipant.count({
        where: { conversationId: fx.conversations.lopA },
      });
      await seedChatFixture();
      const after = await db.conversationParticipant.count({
        where: { conversationId: fx.conversations.lopA },
      });
      expect(after).toBe(before);
    });
  },
);

if (!HAS_LOCAL_DB) {
  describe("US-05 tầng động — SKIP", () => {
    it.skip("cần Postgres LOCAL: nạp .env.test (DATABASE_URL=localhost/satarobo_test) hoặc TEST_DATABASE_URL — xem .claude/rules/prisma-db.md; CI e2e là nơi chạy đủ", () => {
      /* skip có chủ đích — máy này không có DB test local */
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// QUY ƯỚC MÃ LỖI (chốt 09/08 khi ghép US-06 + US-08 — ĐỌC TRƯỚC KHI MỞ TODO):
//   • PERMISSION_DENIED = VAI không có action, hoặc SCOPE không khớp.
//     Vd: Sale gửi tin (không có chat:send); PH gửi ANNOUNCEMENT (không có
//     chat:announce); GV gửi vào lớp KHÔNG dạy (ASSIGNED trượt); QLCS gửi sang
//     cơ sở khác (CENTER trượt); PH/QLCS gỡ tin người khác (không có chat:moderate).
//   • NOT_PARTICIPANT = vai/scope ĐỀU ổn nhưng người này không phải thành viên
//     CÒN HIỆU LỰC của CHÍNH hội thoại đó. Vd: PH đọc lớp khác; PH đã rời nhóm;
//     Admin (bypass can()) gửi vào hội thoại mình không thuộc về (US-15 AC4).
//   Tầng đọc (lib/chat/queries.ts) KHÔNG gọi can() — cổng của nó là participant,
//   nên mọi deny ở đó là NOT_PARTICIPANT.
//   Lý do tách: UI cần phân biệt "bạn không có quyền này" với "bạn không còn ở
//   trong nhóm" — hai câu nói khác nhau với phụ huynh.
// ─────────────────────────────────────────────────────────────────────────────
// TS-01 · Cách ly đọc theo lớp và cơ sở — mở ở US-06 (getMessages) + US-08
// (listConversations). Mã lỗi kỳ vọng ghi trong tên test.
// ─────────────────────────────────────────────────────────────────────────────
describe("TS-01 · Cách ly đọc theo lớp và cơ sở [todo — mở dần theo story]", () => {
  it.todo("TS-01.1 ph1 listConversations → chỉ nhóm LopA (+DM của mình), KHÔNG LopB/LopC [US-08]");
  it.todo("TS-01.2 ph1 getMessages(LopB) trực tiếp bằng ID → 403 NOT_PARTICIPANT [US-08]");
  it.todo("TS-01.3 ph2 (con ở cả 2 lớp) listConversations → đúng 2 nhóm LopA + LopB [US-08]");
  it.todo("TS-01.4a ql1 listConversations → LopA + LopC (cùng CS1), KHÔNG LopB [US-08]");
  it.todo("TS-01.4b ql1 getMessages(LopB) bằng ID → 403 NOT_PARTICIPANT [US-08]");
  it.todo("TS-01.5 gv3 (dạy chéo) listConversations → CẢ LopA + LopB dù khác cơ sở — theo phân công, không theo centerId [US-08]");
  it.todo("TS-01.6 sale1 gọi MỌI endpoint chat → 403 toàn bộ: đường GHI (sendMessage/sendAnnouncement/deleteMessage/openDm/adminLookup) = PERMISSION_DENIED (vai không có action); đường ĐỌC (listConversations rỗng / getMessages) = NOT_PARTICIPANT [US-06→US-15]");
  it.todo("TS-01.7 ph4 (leftAt đã set) getMessages(LopA) → 403 NOT_PARTICIPANT ngay, KHÔNG grace period ở API [US-08]");
});

// ─────────────────────────────────────────────────────────────────────────────
// TS-02 · Cách ly realtime channel — KHÔNG dup ở đây.
// Đã phủ bởi lib/chat/realtime-authz.test.ts (cổng quyền từng phong bì),
// app/api/chat/stream/route.test.ts và tests/chat/realtime-sse.spec.ts (SSE thật trên DB local).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TS-03 · Ma trận hành động ghi — mở ở US-06 (sendMessage), US-10
// (sendAnnouncement), US-12 (recall/deleteMessage). Trạng thái ACTIVE/ARCHIVED/
// LOCKED × participant hiệu lực/đã rời sinh tổ hợp bên dưới.
// ─────────────────────────────────────────────────────────────────────────────
describe("TS-03 · Ma trận hành động ghi [todo — mở dần theo story]", () => {
  it.todo("TS-03.1a ph1 sendMessage CHAT vào LopA → ok:true [US-06]");
  it.todo("TS-03.1b ph1 gửi ANNOUNCEMENT vào LopA → 403 PERMISSION_DENIED [US-10]");
  it.todo("TS-03.2a gv1 sendAnnouncement vào LopA → ok:true [US-10]");
  it.todo("TS-03.2b gv1 sendAnnouncement vào LopB (không dạy) → 403 PERMISSION_DENIED [US-10]");
  it.todo("TS-03.3a ql1 sendMessage + sendAnnouncement vào LopA → ok:true CẢ HAI (chốt QLCS=MEMBER) [US-06/US-10]");
  it.todo("TS-03.3b ql1 sendMessage/sendAnnouncement vào LopB → 403 PERMISSION_DENIED [US-06/US-10]");
  it.todo("TS-03.4a admin1 sendAnnouncement vào LopA → ok:true [US-10]");
  // TS-03.4b + TS-03.7b đã MỞ ở US-15 — xem describe "US-15 · Quản trị hội thoại" cuối file
  // (cần `setConversationLock` để dựng trạng thái LOCKED nên đặt cùng chỗ).
  it.todo("TS-03.5a ph1 recallMessage tin mình gửi 10 phút trước → ok:true [US-12]");
  it.todo("TS-03.5b ph1 recallMessage tin gửi 20 phút trước → 403 RECALL_WINDOW_EXPIRED (quá 15') [US-12]");
  it.todo("TS-03.6a ph1 deleteMessage tin của ph2 → 403 PERMISSION_DENIED [US-12]");
  it.todo("TS-03.6b gv1 deleteMessage tin của ph2 trong LopA KHÔNG lý do → 400 VALIDATION (field reason); CÓ lý do → ok:true [US-12]");
  it.todo("TS-03.6c ql1 deleteMessage tin người khác → 403 PERMISSION_DENIED [US-12]");
  it.todo("TS-03.7a sendMessage vào LopC (ARCHIVED) với MỌI actor (ph1/gv1/ql1/admin1) → 403 CONVERSATION_ARCHIVED — mã lỗi PHÂN BIỆT với 'không phải thành viên' [US-06]");
  it.todo("TS-03.8 ph4 (participant đã rời) sendMessage vào LopA → 403 NOT_PARTICIPANT (vai PH vẫn có chat:send; cái sai là không còn trong nhóm — thông điệp cho PH phải nói đúng điều đó) [US-06]");
});

// ─────────────────────────────────────────────────────────────────────────────
// TS-04 · Riêng tư 1-1 và tra cứu admin — mở ở US-13 (openDm) + US-15 (adminLookup).
// ─────────────────────────────────────────────────────────────────────────────
describe("TS-04 · Riêng tư 1-1 và tra cứu admin [todo — mở dần theo story]", () => {
  // TS-04.2a / 04.2b / 04.3 đã MỞ ở US-15 — xem describe "US-15 · Quản trị hội thoại".
  it.todo("TS-04.4a ph1 listMembers(LopA) → payload KHÔNG chứa SĐT/email PH khác (BR-30 — kiểm JSON, không chỉ UI) [US-08]");
  it.todo("TS-04.4b gv1 listMembers(LopA) → đầy đủ liên hệ [US-08]");
});

// ─────────────────────────────────────────────────────────────────────────────
// US-13 · Nhắn riêng 1-1 GV↔PH — TẦNG ĐỘNG, DB THẬT (mở TS-04.1 / 04.5 / 04.6).
//
// Chạy `openDmAsActor` với Actor resolve từ DB (`resolveActorUncached`) ⇒ đi đúng
// `can()` v2 (bản đang enforce trên prod), không phải v1 tĩnh của máy dev.
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_LOCAL_DB)("US-13 · 1-1 GV↔PH (DB local)", () => {
  let fx: ChatFixture;

  beforeAll(async () => {
    fx = await seedChatFixture();
  });

  afterAll(async () => {
    await disconnectDb();
  });

  const actorOf = (userId: string) => resolveActorUncached(userId);

  it("TS-04.1 DM gv1↔ph1: ql1 / gv2 / ph2 / sale1 getMessages bằng ID → NOT_PARTICIPANT TOÀN BỘ", async () => {
    for (const outsider of [fx.users.ql1, fx.users.gv2, fx.users.ph2, fx.users.sale1]) {
      await expect(
        getMessagesPage(fx.conversations.dmGv1Ph1, outsider),
      ).rejects.toMatchObject({ code: "NOT_PARTICIPANT" });
    }
    // Hai người trong cuộc thì đọc được — nếu không, test trên chỉ đang chứng minh
    // "không ai đọc được", tức là xanh vô nghĩa.
    for (const insider of [fx.users.gv1, fx.users.ph1]) {
      await expect(getMessagesPage(fx.conversations.dmGv1Ph1, insider)).resolves.toBeTruthy();
    }
  });

  it("TS-04.5 ph1 openDm với gv2 (KHÔNG dạy con mình) → PERMISSION_DENIED, không sinh hội thoại", async () => {
    const before = await db.conversation.count({ where: { type: "DM_TEACHER_PARENT" } });
    const res = await openDmAsActor(await actorOf(fx.users.ph1), "ph1", {
      peerUserId: fx.users.gv2,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(await db.conversation.count({ where: { type: "DM_TEACHER_PARENT" } })).toBe(before);
  });

  it("TS-04.6 ql1 openDm với ph1 → PERMISSION_DENIED (QLCS không mở 1-1 ở P0)", async () => {
    const res = await openDmAsActor(await actorOf(fx.users.ql1), "ql1", {
      peerUserId: fx.users.ph1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  it("sale1 openDm với ph1 → PERMISSION_DENIED (P0: Sale không có quyền chat nào) [TS-01.6]", async () => {
    const res = await openDmAsActor(await actorOf(fx.users.sale1), "sale1", {
      peerUserId: fx.users.ph1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  it("AC2/AC5 — gv1 và ph1 cùng mở: chỉ MỘT hội thoại, đúng dmKey, mở lại bản đã lưu trữ", async () => {
    const key = dmKeyOf(fx.users.gv1, fx.users.ph1);
    // Đưa DM của fixture về ARCHIVED để chứng minh "mở lại đúng nó" (AC2).
    await db.conversation.update({
      where: { id: fx.conversations.dmGv1Ph1 },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });

    const fromTeacher = await openDmAsActor(await actorOf(fx.users.gv1), "gv1", {
      peerUserId: fx.users.ph1,
    });
    expect(fromTeacher.ok).toBe(true);
    if (!fromTeacher.ok) return;
    expect(fromTeacher.data.conversationId).toBe(fx.conversations.dmGv1Ph1);
    expect(fromTeacher.data.created).toBe(false);
    expect(fromTeacher.data.reopened).toBe(true);
    expect(fromTeacher.data.status).toBe("ACTIVE");

    // Chiều ngược lại (PH bấm) phải rơi vào ĐÚNG hội thoại đó — đây là ô mà scope OWN
    // của PARENT sẽ đánh trượt nếu ai đó bỏ thủ thuật `createdById = actor` ở target.
    const fromParent = await openDmAsActor(await actorOf(fx.users.ph1), "ph1", {
      peerUserId: fx.users.gv1,
    });
    expect(fromParent.ok).toBe(true);
    if (!fromParent.ok) return;
    expect(fromParent.data.conversationId).toBe(fx.conversations.dmGv1Ph1);

    const all = await db.conversation.findMany({ where: { dmKey: key }, select: { id: true } });
    expect(all).toHaveLength(1);
  });

  it("AC3 — job đối soát: hết quan hệ dạy học → DM chuyển ARCHIVED (đọc được, không gửi được)", async () => {
    // Gỡ gv1 khỏi LopA (và LopC đã COMPLETED) ⇒ không còn lớp ACTIVE nào nối gv1 với ph1.
    const lopA = await db.class.findUniqueOrThrow({
      where: { id: fx.classes.lopA },
      select: { teacherId: true },
    });
    await db.class.update({ where: { id: fx.classes.lopA }, data: { teacherId: fx.users.gv2 } });
    try {
      await db.conversation.update({
        where: { id: fx.conversations.dmGv1Ph1 },
        data: { status: "ACTIVE", archivedAt: null },
      });
      const summary = await reconcileDmConversations({
        onlyConversationIds: [fx.conversations.dmGv1Ph1],
      });
      expect(summary.dmArchived).toBe(1);
      const conv = await db.conversation.findUniqueOrThrow({
        where: { id: fx.conversations.dmGv1Ph1 },
      });
      expect(conv.status).toBe("ARCHIVED");
      // Lịch sử + thành viên GIỮ NGUYÊN (chỉ đọc, không xoá).
      const parts = await db.conversationParticipant.count({
        where: { conversationId: fx.conversations.dmGv1Ph1, leftAt: null },
      });
      expect(parts).toBe(2);
      // Mở lại khi quan hệ đã hết → từ chối, KHÔNG unarchive.
      const res = await openDmAsActor(await actorOf(fx.users.ph1), "ph1", {
        peerUserId: fx.users.gv1,
      });
      expect(res.ok).toBe(false);
    } finally {
      await db.class.update({
        where: { id: fx.classes.lopA },
        data: { teacherId: lopA.teacherId },
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-15 · Quản trị hội thoại — TẦNG ĐỘNG, DB THẬT.
// Mở TS-04.2a / 04.2b / 04.3 (F-AUDIT) + TS-03.4b (Admin chỉ đọc) + TS-03.7b (LOCKED).
//
// Actor resolve từ DB (`resolveActorUncached`) ⇒ đi đúng `can()` v2 — bản đang enforce
// trên prod, không phải v1 tĩnh của máy dev.
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!HAS_LOCAL_DB)("US-15 · Quản trị hội thoại (DB local)", () => {
  let fx: ChatFixture;

  beforeAll(async () => {
    fx = await seedChatFixture();
  });

  afterAll(async () => {
    // Trả LopA về ACTIVE để lần chạy sau không thừa hưởng trạng thái khoá.
    await db.conversation.updateMany({
      where: { id: fx.conversations.lopA, status: "LOCKED" },
      data: { status: "ACTIVE" },
    });
    await disconnectDb();
  });

  const actorOf = (userId: string) => resolveActorUncached(userId);
  const REASON = "Xử lý khiếu nại số 128 của phụ huynh lớp LopA";

  const countLookupAudits = (conversationId: string) =>
    db.auditLog.count({
      where: {
        module: "chat",
        entityType: "Conversation",
        entityId: conversationId,
        action: "READ",
      },
    });

  it("TS-04.2a admin1 tra cứu DM KHÔNG nhập lý do → từ chối, KHÔNG nội dung, KHÔNG dòng audit", async () => {
    const before = await countLookupAudits(fx.conversations.dmGv1Ph1);
    const res = await adminLookupConversationAsActor(await actorOf(fx.users.admin1), "admin1", {
      conversationId: fx.conversations.dmGv1Ph1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION");
      expect(res.error.field).toBe("reason");
      // Không có khoá `data` nào để lỡ tay đọc ra nội dung.
      expect(res).not.toHaveProperty("data");
    }
    expect(await countLookupAudits(fx.conversations.dmGv1Ph1)).toBe(before);
  });

  it("TS-04.3 lý do rỗng / khoảng trắng / quá ngắn (gọi thẳng, bỏ qua modal) → vẫn từ chối", async () => {
    const admin = await actorOf(fx.users.admin1);
    for (const reason of ["", "   ", "ok"]) {
      const res = await adminLookupConversationAsActor(admin, "admin1", {
        conversationId: fx.conversations.dmGv1Ph1,
        reason,
      });
      expect(res.ok, `reason="${reason}" phải bị từ chối`).toBe(false);
    }
  });

  it("TS-04.2b admin1 CÓ lý do → ok + đúng 1 dòng AuditLog (ai/khi nào/hội thoại/lý do nguyên văn)", async () => {
    const before = await countLookupAudits(fx.conversations.dmGv1Ph1);
    const res = await adminLookupConversationAsActor(await actorOf(fx.users.admin1), "Admin HO", {
      conversationId: fx.conversations.dmGv1Ph1,
      reason: REASON,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.conversation.conversationId).toBe(fx.conversations.dmGv1Ph1);
    expect(Array.isArray(res.data.messages)).toBe(true);

    expect(await countLookupAudits(fx.conversations.dmGv1Ph1)).toBe(before + 1);
    const log = await db.auditLog.findFirstOrThrow({ where: { id: res.data.auditLogId } });
    expect(log.actorId).toBe(fx.users.admin1);
    expect(log.actorName).toBe("Admin HO");
    expect(log.module).toBe("chat");
    expect(log.entityId).toBe(fx.conversations.dmGv1Ph1);
    expect(log.action).toBe("READ");
    expect(log.reason).toBe(REASON);
  });

  it("[AC5] ql1 (QLCS) tra cứu DM dù CÓ lý do → PERMISSION_DENIED, không sinh audit", async () => {
    const before = await countLookupAudits(fx.conversations.dmGv1Ph1);
    const res = await adminLookupConversationAsActor(await actorOf(fx.users.ql1), "ql1", {
      conversationId: fx.conversations.dmGv1Ph1,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    expect(await countLookupAudits(fx.conversations.dmGv1Ph1)).toBe(before);
  });

  it("[AC5] gv1 / ph1 / sale1 tra cứu → PERMISSION_DENIED toàn bộ", async () => {
    for (const uid of [fx.users.gv1, fx.users.ph1, fx.users.sale1]) {
      const res = await adminLookupConversationAsActor(await actorOf(uid), "x", {
        conversationId: fx.conversations.lopA,
        reason: REASON,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("[AC5] ql1 khoá hội thoại → PERMISSION_DENIED (trang quản trị đóng với QLCS)", async () => {
    const res = await setConversationLockAsActor(await actorOf(fx.users.ql1), "ql1", {
      conversationId: fx.conversations.lopA,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
    const conv = await db.conversation.findUniqueOrThrow({
      where: { id: fx.conversations.lopA },
    });
    expect(conv.status).toBe("ACTIVE");
  });

  it("TS-03.4b admin1 gửi CHAT vào nhóm KHÔNG phải thành viên → NOT_PARTICIPANT (AC4 chỉ đọc)", async () => {
    // ⚠️ Bằng chứng "không ghi gì" bám theo `clientMsgId` CỦA CHÍNH lượt gọi này, KHÔNG
    // phải "không tồn tại tin nào của admin1 trong LopB". DB test dùng chung một DB local
    // không reset giữa các lần chạy: một dòng sót lại từ lần chạy trước (đo được 09/08 —
    // một lượt kiểm ngược đã để lại đúng một tin như vậy) làm ô này đỏ vĩnh viễn và tố
    // cáo nhầm mã đang lành. Bám theo clientMsgId thì vẫn bắt đúng "action có ghi không".
    const clientMsgId = crypto.randomUUID();
    const res = await sendChatMessageAsActor(await actorOf(fx.users.admin1), "admin1", {
      conversationId: fx.conversations.lopB,
      body: "Admin thử chen vào nhóm không thuộc về",
      clientMsgId,
    });
    expect(res.ok).toBe(false);
    // SUPER_ADMIN bypass can() ⇒ KHÔNG dừng ở PERMISSION_DENIED; chốt chặn là
    // participant-check trong chính action.
    if (!res.ok) expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(await db.message.findFirst({ where: { clientMsgId } })).toBeNull();
  });

  it("TS-03.4b(bis) admin1 gửi vào hội thoại RIÊNG của người khác → NOT_PARTICIPANT, không ghi tin", async () => {
    const clientMsgId = crypto.randomUUID();
    const res = await sendChatMessageAsActor(await actorOf(fx.users.admin1), "admin1", {
      conversationId: fx.conversations.dmGv1Ph1,
      body: "Chen vào hội thoại riêng",
      clientMsgId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_PARTICIPANT");
    expect(await db.message.findFirst({ where: { clientMsgId } })).toBeNull();
  });

  it("[AC3 + TS-03.7b] khoá LopA → phát conversation.locked; MỌI vai kể cả GV gửi tin đều CONVERSATION_LOCKED, đọc vẫn được", async () => {
    broadcastLog.length = 0;
    const locked = await setConversationLockAsActor(await actorOf(fx.users.admin1), "Admin HO", {
      conversationId: fx.conversations.lopA,
      locked: true,
      reason: "Tạm khoá do tranh cãi trong nhóm, chờ ban giám hiệu làm việc",
    });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.data.status).toBe("LOCKED");

    // AC3 — client đang mở phải nhận tín hiệu để vô hiệu ô nhập NGAY.
    const ev = broadcastLog.find((b) => b.event === "conversation.locked");
    expect(ev, "phải phát conversation.locked xuống conv:{id}").toBeTruthy();
    expect(ev?.topic).toBe(`conv:${fx.conversations.lopA}`);
    expect(ev?.payload).toMatchObject({ locked: true, status: "LOCKED" });
    // Lý do là dữ liệu quản trị — không đi xuống nhóm phụ huynh.
    expect(ev?.payload).not.toHaveProperty("reason");

    // Server là chốt chặn: kiểm CẢ người vốn LÀ thành viên (gv1 MODERATOR, ph1, ql1) —
    // và cả admin1, vai duy nhất bypass được `can()`. Nếu chỉ thử người ngoài nhóm thì
    // test này chỉ đang chứng minh lại NOT_PARTICIPANT chứ không chứng minh cái khoá.
    for (const uid of [fx.users.gv1, fx.users.ph1, fx.users.ql1]) {
      const clientMsgId = crypto.randomUUID();
      const res = await sendChatMessageAsActor(await actorOf(uid), "x", {
        conversationId: fx.conversations.lopA,
        body: "Tin gửi khi nhóm đang khoá",
        clientMsgId,
      });
      expect(res.ok, `${uid} không được gửi khi LOCKED`).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("CONVERSATION_LOCKED");
      // Từ chối THẬT: không có tin nào rơi vào DB (mã lỗi đúng mà vẫn ghi thì vô nghĩa).
      expect(await db.message.findFirst({ where: { clientMsgId } })).toBeNull();
    }

    // Đọc thì vẫn được (permissions.md: LOCKED → đọc ✅ thành viên, gửi ❌ mọi vai).
    await expect(getMessagesPage(fx.conversations.lopA, fx.users.ph1)).resolves.toBeTruthy();

    const lockLog = await db.auditLog.findFirst({
      where: {
        module: "chat",
        entityType: "Conversation",
        entityId: fx.conversations.lopA,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(lockLog?.reason).toContain("Tạm khoá");
  });

  it("[AC3] mở khoá LopA → ACTIVE, phát locked=false, gv1 gửi lại được, audit ghi lần hai", async () => {
    // ── ARRANGE của CHÍNH ca này (luật 18) ─────────────────────────────────────
    // 🔴 Trước 10/09/2026 ca này MƯỢN cái khoá do ca "[AC3 + TS-03.7b] khoá LopA" đặt.
    // Chạy riêng nó thì ĐỎ: LopA vốn ACTIVE ⇒ `setConversationLock(false)` là no-op,
    // KHÔNG phát `conversation.locked` nào ⇒ `expected undefined to match object
    // { locked: false, status: "ACTIVE" }`. Cả bộ vẫn xanh vì thứ tự đang cứu nhau.
    // Chạy sau ca kia thì lượt khoá này là no-op, trạng thái y hệt.
    // Ghi THẲNG DB chứ không gọi `setConversationLockAsActor`: arrange không được để lại
    // dòng AuditLog — ca này khẳng định `orderBy createdAt desc` ra đúng dòng "mở lại",
    // mà hai dòng rơi cùng một giây thì thứ tự bấp bênh.
    await db.conversation.update({
      where: { id: fx.conversations.lopA },
      data: { status: "LOCKED" },
    });

    // Xoá SAU khi arrange: sự kiện locked=true của bước trên mà lọt lại thì `.find()`
    // dưới đây vớ đúng nó và ca test xanh vì lý do sai.
    broadcastLog.length = 0;
    const res = await setConversationLockAsActor(await actorOf(fx.users.admin1), "Admin HO", {
      conversationId: fx.conversations.lopA,
      locked: false,
      reason: "Đã xử lý xong khiếu nại, mở lại cho lớp trao đổi",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("ACTIVE");

    const ev = broadcastLog.find((b) => b.event === "conversation.locked");
    expect(ev?.payload).toMatchObject({ locked: false, status: "ACTIVE" });

    const sent = await sendChatMessageAsActor(await actorOf(fx.users.gv1), "gv1", {
      conversationId: fx.conversations.lopA,
      body: "Nhóm đã mở lại, cô chào cả nhà",
      clientMsgId: crypto.randomUUID(),
    });
    expect(sent.ok).toBe(true);

    const unlockLog = await db.auditLog.findFirst({
      where: {
        module: "chat",
        entityType: "Conversation",
        entityId: fx.conversations.lopA,
        action: "UPDATE",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(unlockLog?.reason).toContain("mở lại");
  });

  it("khoá nhóm ĐÃ LƯU TRỮ (LopC) → CONVERSATION_ARCHIVED, trạng thái giữ nguyên", async () => {
    const res = await setConversationLockAsActor(await actorOf(fx.users.admin1), "admin1", {
      conversationId: fx.conversations.lopC,
      locked: true,
      reason: REASON,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONVERSATION_ARCHIVED");
    const conv = await db.conversation.findUniqueOrThrow({
      where: { id: fx.conversations.lopC },
    });
    expect(conv.status).toBe("ARCHIVED");
  });
});
