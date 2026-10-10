// @vitest-environment node
/**
 * Hai đường ĐỌC của module chat mà trước 09/08 KHÔNG có lấy một test nào chạm Postgres:
 *
 *  1. `listConversationsForUser` — truy vấn con dựng `peerName` cho hội thoại 1-1 và
 *     luật che liên hệ BR-30 đi kèm (US-13). Đây là đường nóng nhất của module: nó chạy
 *     ở CẢ BA site mỗi lần dựng danh sách hội thoại VÀ mỗi lần dựng badge chưa đọc.
 *     Nó fail-closed (`hidePeerContacts = true` khi không nhận ra người xem), nên một
 *     lỗi ở đây hỏng ÂM THẦM — tên hiện "•••" chứ không ném lỗi.
 *  2. `listAdminConversations` — AC1 của US-15 ("tìm theo lớp/cơ sở/người"). `where` của
 *     nó tra `Class`/`User` ra id TRƯỚC rồi mới lọc `Conversation`, tức phần quyết định
 *     nằm ở chỗ Prisma mock KHÔNG chứng minh được: `lib/chat/admin.test.ts` cho
 *     `conversation.findMany` trả sẵn một mảng cố định, nên ô tìm kiếm có ra kết quả hay
 *     không thì test vẫn xanh y hệt.
 *
 * Cả hai dùng `seedChatFixture` (seed chuẩn US-05) — KHÔNG tự dựng thế giới riêng: mọi
 * mệnh đề ở đây nói về dữ liệu CÓ SẴN (LopA/LopB/LopC + DM gv1↔ph1), không bật/tắt điều
 * kiện nghiệp vụ nào nên không có gì để sở hữu riêng.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. Ca nào đổi dữ liệu (đổi tên user để
 * thử BR-30) đều trả lại nguyên trạng trong `finally`.
 * ⚠️ CỔNG CHẠY: chỉ chạy khi DATABASE_URL trỏ Postgres LOCAL — máy không có DB thì SKIP.
 * Chạy tay: `pnpm test:chat-db` (đã có --no-file-parallelism; `seedOrg`/`seedRoles` là
 * hạ tầng dùng chung với các spec khác).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Hai mock BẮT BUỘC để import được `lib/chat/admin.ts` trong vitest node (đã đo ở
// permission-matrix.spec.ts): `@/lib/auth` kéo next-auth, `@/lib/chat/broadcast` có
// `import "server-only"`.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: async () => true,
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
import {
  getConversationMembers,
  listConversationsForUser,
} from "../../lib/chat/queries";
import { listAdminConversations } from "../../lib/chat/admin";
import { seedChatFixture, type ChatFixture } from "./_helpers/seed-chat";

import {
  DB_URL_CHE,
  LY_DO_BO_QUA,
  RUN_DB_TESTS as RUN_DB_TESTS_CHUNG,
} from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db`.
const HAS_LOCAL_DB = RUN_DB_TESTS_CHUNG;

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;

let fx: ChatFixture;

/** Đổi tên một user rồi TRẢ LẠI — fixture chỉ set `name` lúc create nên không tự phục hồi. */
async function withName<T>(userId: string, name: string, fn: () => Promise<T>): Promise<T> {
  const cu = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  await db.user.update({ where: { id: userId }, data: { name } });
  try {
    return await fn();
  } finally {
    await db.user.update({ where: { id: userId }, data: { name: cu.name } });
  }
}

if (!HAS_LOCAL_DB) {
  describe("Chat · danh sách + tra cứu admin (DB)", () => {
    it.skip(`SKIP — ${LY_DO_BO_QUA} (DB=${DB_URL_CHE})`, () => {});
  });
}

describe.skipIf(!HAS_LOCAL_DB)("Chat · tầng đọc trên DB thật", () => {
  beforeAll(async () => {
    fx = await seedChatFixture();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await disconnectDb();
  }, HOOK_TIMEOUT);

  // ───────────────────────────────────────────────────────────────────────────
  // 1) `peerName` — tên hội thoại 1-1 là NGƯỜI CÒN LẠI, tính riêng cho từng người.
  // ───────────────────────────────────────────────────────────────────────────
  describe("US-13 · tên hiển thị của hội thoại 1-1", () => {
    it(
      "mỗi bên thấy TÊN CỦA NGƯỜI KIA (không phải tên mình, không phải Conversation.title)",
      async () => {
        const [ofGv, ofPh] = await Promise.all([
          listConversationsForUser(fx.users.gv1),
          listConversationsForUser(fx.users.ph1),
        ]);
        const dmGv = ofGv.find((c) => c.conversationId === fx.conversations.dmGv1Ph1);
        const dmPh = ofPh.find((c) => c.conversationId === fx.conversations.dmGv1Ph1);
        expect(dmGv).toBeDefined();
        expect(dmPh).toBeDefined();
        // Chốt chặn thật của ca này: HAI tên KHÁC nhau. Ghi cứng vào `title` lúc tạo
        // (cách làm sai đã ghi trong chú thích SQL) sẽ cho hai bên cùng một chuỗi ⇒
        // phụ huynh nhìn thấy tên của chính mình.
        expect(dmGv?.displayName).toBe("ph1");
        expect(dmPh?.displayName).toBe("gv1");
        expect(dmGv?.displayName).not.toBe(dmPh?.displayName);
        expect(dmGv?.displayName).not.toBe("DM gv1 ↔ ph1");
      },
      CASE_TIMEOUT,
    );

    it(
      "nhóm lớp vẫn lấy TÊN LỚP (truy vấn con peerName không được đụng vào)",
      async () => {
        const rows = await listConversationsForUser(fx.users.gv1);
        const nhom = rows.find((c) => c.conversationId === fx.conversations.lopA);
        expect(nhom?.displayName).toBe("LopA");
      },
      CASE_TIMEOUT,
    );

    it(
      "BR-30 — người xem là PH thì SĐT/email lẫn trong tên người kia bị che; nhân viên thấy nguyên văn",
      async () => {
        await withName(fx.users.gv1, "GV 0905123456 - lan@satarobo.vn", async () => {
          const ofPh = await listConversationsForUser(fx.users.ph1);
          const dmPh = ofPh.find((c) => c.conversationId === fx.conversations.dmGv1Ph1);
          expect(dmPh?.displayName).toContain("•••");
          expect(dmPh?.displayName).not.toContain("0905123456");
          expect(dmPh?.displayName).not.toContain("lan@satarobo.vn");
        });

        await withName(fx.users.ph1, "PH 0905999888", async () => {
          const ofGv = await listConversationsForUser(fx.users.gv1);
          const dmGv = ofGv.find((c) => c.conversationId === fx.conversations.dmGv1Ph1);
          // GV là NHÂN VIÊN ⇒ không bôi tên (nếu fail-closed bị kích hoạt nhầm — vd
          // `db.user.findUnique` trả rỗng — ca này đỏ).
          expect(dmGv?.displayName).toBe("PH 0905999888");
        });
      },
      CASE_TIMEOUT,
    );

    it(
      "chỉ hỏi vai người xem khi danh sách CÓ 1-1 — người không có DM vẫn ra tên lớp đúng",
      async () => {
        const rows = await listConversationsForUser(fx.users.ph3); // ph3 chỉ có nhóm LopB
        expect(rows.every((r) => r.type === "CLASS_GROUP")).toBe(true);
        expect(rows.find((c) => c.conversationId === fx.conversations.lopB)?.displayName).toBe(
          "LopB",
        );
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) BR-30 mở rộng — liên hệ PH không đi vào payload của GV / của hội thoại 1-1.
  // ───────────────────────────────────────────────────────────────────────────
  describe("BR-30 · liên hệ trong danh sách thành viên", () => {
    it(
      "NHÓM LỚP: QLCS thấy liên hệ phụ huynh, GIÁO VIÊN thì KHÔNG (chủ dự án chốt 09/08)",
      async () => {
        // Đây là ĐỐI CHỨNG hai chiều, và cả hai chiều đều cần thiết:
        //  • QLCS thấy được ⇒ chứng minh bản vá không siết quá tay thành "ẩn với tất cả"
        //    (quản lý cơ sở cần gọi phụ huynh để xử lý học phí, nghỉ học).
        //  • GV không thấy ⇒ chính là quyết định 09/08, thống nhất chat với luật PII chung
        //    `canViewParentContact` vốn đã chặn giáo viên ở trang tiến độ lớp từ trước.
        const nhinBoiQlcs = await getConversationMembers(fx.conversations.lopA, fx.users.ql1);
        const phQlcs = nhinBoiQlcs.find((m) => m.derivedFrom === "CLASS_STUDENT_PARENT");
        expect(phQlcs && Object.hasOwn(phQlcs, "contact")).toBe(true);

        const nhinBoiGv = await getConversationMembers(fx.conversations.lopA, fx.users.gv1);
        const phGv = nhinBoiGv.find((m) => m.derivedFrom === "CLASS_STUDENT_PARENT");
        // Vẫn phải THẤY người đó (để nhắn riêng), chỉ là không kèm số.
        expect(phGv).toBeDefined();
        expect(Object.hasOwn(phGv!, "contact")).toBe(false);
      },
      CASE_TIMEOUT,
    );

    it(
      "hội thoại 1-1: KHÔNG ai thấy liên hệ của ai (ma trận không có ô 'Xem thành viên' cho DM)",
      async () => {
        for (const uid of [fx.users.gv1, fx.users.ph1]) {
          const members = await getConversationMembers(fx.conversations.dmGv1Ph1, uid);
          expect(members.length).toBe(2);
          for (const m of members) expect(Object.hasOwn(m, "contact")).toBe(false);
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "PH xem nhóm lớp: không thấy liên hệ của BẤT KỲ AI (luật cũ, không bị bản vá nới ra)",
      async () => {
        const members = await getConversationMembers(fx.conversations.lopA, fx.users.ph1);
        for (const m of members) expect(Object.hasOwn(m, "contact")).toBe(false);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) US-15 AC1 — /admin/hoi-thoai tìm theo lớp / cơ sở / người (SQL thật).
  // ───────────────────────────────────────────────────────────────────────────
  describe("US-15 AC1 · tra cứu hội thoại của Admin", () => {
    const idsOf = (rows: { conversationId: string }[]) => rows.map((r) => r.conversationId);

    it(
      "tìm theo TÊN LỚP → ra đúng nhóm lớp đó, kèm tên hiển thị là tên lớp hiện tại",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        const rows = await listAdminConversations(actor, { q: "LopA" });
        expect(idsOf(rows)).toContain(fx.conversations.lopA);
        expect(idsOf(rows)).not.toContain(fx.conversations.lopB);
        const row = rows.find((r) => r.conversationId === fx.conversations.lopA);
        expect(row?.displayName).toBe("LopA");
        expect(row?.participantCount).toBeGreaterThan(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "tìm theo MÃ LỚP (chuỗi KHÔNG có trong Conversation.title) → nhánh `subjectId in classIds` phải chạy",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        // "CHAT-US05-LOPB" chỉ tồn tại ở `Class.classCode`; nếu nhánh tra lớp hỏng thì
        // câu này rơi về `title contains` và trả RỖNG — đúng cái "im lặng không ra gì"
        // mà Admin sẽ hiểu nhầm là "chưa có hội thoại nào".
        const rows = await listAdminConversations(actor, { q: "CHAT-US05-LOPB" });
        expect(idsOf(rows)).toEqual([fx.conversations.lopB]);
      },
      CASE_TIMEOUT,
    );

    it(
      "tìm theo TÊN NGƯỜI → ra mọi hội thoại người đó đang tham gia (nhánh participants)",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        // ph2 có con ở CẢ LopA lẫn LopB ⇒ phải ra hai nhóm. Chuỗi "ph2" không nằm trong
        // tên lớp nào và cũng không nằm trong title nào.
        const rows = await listAdminConversations(actor, { q: "ph2" });
        const ids = idsOf(rows);
        expect(ids).toContain(fx.conversations.lopA);
        expect(ids).toContain(fx.conversations.lopB);
        expect(ids).not.toContain(fx.conversations.lopC); // ph2 không thuộc LopC
      },
      CASE_TIMEOUT,
    );

    it(
      "tìm theo SĐT của một người → vẫn ra hội thoại của họ (ô 'tìm theo người' phải nhận cả số)",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        const ph3 = await db.user.findUniqueOrThrow({
          where: { id: fx.users.ph3 },
          select: { phone: true },
        });
        expect(ph3.phone).toBeTruthy();
        const rows = await listAdminConversations(actor, { q: ph3.phone as string });
        expect(idsOf(rows)).toContain(fx.conversations.lopB);
      },
      CASE_TIMEOUT,
    );

    it(
      "lọc theo CƠ SỞ + theo LOẠI + theo TRẠNG THÁI",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        const [cs1, dm, archived] = await Promise.all([
          listAdminConversations(actor, { centerId: fx.centers.cs1 }),
          listAdminConversations(actor, { type: "DM_TEACHER_PARENT" }),
          listAdminConversations(actor, { status: "ARCHIVED", centerId: fx.centers.cs1 }),
        ]);
        const cs1Ids = idsOf(cs1);
        expect(cs1Ids).toContain(fx.conversations.lopA);
        expect(cs1Ids).not.toContain(fx.conversations.lopB); // LopB ở CS2
        // DM có `centerId = null` (delta E.3) ⇒ KHÔNG bao giờ lọt vào bộ lọc cơ sở.
        expect(cs1Ids).not.toContain(fx.conversations.dmGv1Ph1);
        expect(idsOf(dm)).toContain(fx.conversations.dmGv1Ph1);
        expect(idsOf(archived)).toContain(fx.conversations.lopC);
        expect(idsOf(archived)).not.toContain(fx.conversations.lopA);
      },
      CASE_TIMEOUT,
    );

    it(
      "chuỗi không khớp gì → rỗng; enum lạ trong query string → KHÔNG làm trang nổ 500",
      async () => {
        const actor = await resolveActorUncached(fx.users.admin1);
        expect(
          await listAdminConversations(actor, { q: "chuỗi-không-tồn-tại-ở-đâu-cả-2026" }),
        ).toEqual([]);
        // `type`/`status` lạ bị danh sách trắng nuốt ⇒ coi như không lọc, không ném lỗi enum.
        const rows = await listAdminConversations(actor, { type: "KHONG_CO", status: "XYZ" });
        expect(idsOf(rows)).toContain(fx.conversations.lopA);
      },
      CASE_TIMEOUT,
    );

    it(
      "QLCS gọi thẳng hàm (không qua trang) → PERMISSION_DENIED (US-15 AC5)",
      async () => {
        const ql = await resolveActorUncached(fx.users.ql1);
        await expect(listAdminConversations(ql, { q: "LopA" })).rejects.toMatchObject({
          code: "PERMISSION_DENIED",
        });
      },
      CASE_TIMEOUT,
    );
  });
});
