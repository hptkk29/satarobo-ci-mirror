/**
 * Admin THÊM / GỠ thành viên nhóm chat lớp (22/11/2026 — đảo BR-15) — trên Postgres THẬT.
 *
 * Vì sao test này phải chạm DB: thứ cần chứng minh không nằm ở giá trị trả về của một hàm thuần mà
 * ở TƯƠNG TÁC giữa ba tầng — dòng `MANUAL` (nơi này ghi) · `syncConversationMembership` (nơi
 * dẫn xuất, phải bỏ qua MANUAL) · `reconcileConversationMembership` (job đêm, cũng phải bỏ qua).
 * Một dòng MANUAL chưa từng tồn tại trong nhóm lớp trước đợt này, nên mọi bộ đọc keyed theo
 * `derivedFrom` chưa từng được thử với nó.
 *
 * Dùng `seedChatFixture` (seed chuẩn US-05). KHÔNG `resetDb()`; mọi dòng MANUAL / tin hệ thống do
 * test tạo đều được dọn ở `afterEach`/`afterAll`.
 *
 * Chạy: `pnpm test:chat-db` (Postgres local — SKIP KHÔNG phải xanh).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: async () => true,
  conversationBroadcast: (conversationId: string, event: string, payload: Record<string, unknown>) => ({
    topic: `conv:${conversationId}`,
    event,
    payload,
    private: true,
  }),
  userBumpBroadcasts: () => [],
}));

import { db } from "../../lib/db";
import { disconnectDb } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { getConversationMembers } from "../../lib/chat/queries";
import { syncConversationMembership } from "../../lib/chat/sync-membership";
import { reconcileConversationMembership } from "../../lib/chat/reconcile-membership";
import {
  addMembersAsActor,
  listAddableGroupsAsActor,
  listAddableStaffAsActor,
  listManualMemberIds,
  removeManualMemberAsActor,
} from "../../lib/chat/members-admin";
import { seedChatFixture, type ChatFixture } from "./_helpers/seed-chat";
import { DB_URL_CHE, LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;

let fx: ChatFixture;

if (!RUN_DB_TESTS) {
  describe("Chat · admin thêm/gỡ thành viên (DB)", () => {
    it.skip(`SKIP — ${LY_DO_BO_QUA} (DB=${DB_URL_CHE})`, () => {});
  });
}

async function admin() {
  return resolveActorUncached(fx.users.admin1);
}

async function participant(conversationId: string, userId: string) {
  return db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

async function systemMessages(conversationId: string) {
  return db.message.findMany({
    where: { conversationId, kind: "SYSTEM", body: { startsWith: "Quản trị viên đã" } },
    select: { body: true },
  });
}

describe.skipIf(!RUN_DB_TESTS)("Chat · admin thêm/gỡ thành viên (DB)", () => {
  beforeAll(async () => {
    fx = await seedChatFixture();
    await dọn(); // phòng dư lượng của một lượt chạy trước bị ngắt giữa chừng
  }, HOOK_TIMEOUT);

  /**
   * Trả fixture về nguyên trạng. PHẢI dọn rộng hơn những gì mã ĐÚNG ghi ra: một lỗi (hay lượt chạy
   * bị ngắt) có thể để lại dòng DERIVED/leftAt lệch, và nếu dọn chỉ MANUAL thì dư lượng đó đầu độc
   * mọi ca sau — đã gặp thật khi cấy lỗi ghi DERIVED thay MANUAL: 7 ca đỏ lây thay vì 3.
   */
  async function dọn() {
    const convs = Object.values(fx.conversations);
    await db.message.deleteMany({
      where: { conversationId: { in: convs }, kind: "SYSTEM", body: { startsWith: "Quản trị viên đã" } },
    });
    // Sale thuần không có tư cách dẫn xuất nào ⇒ MỌI dòng của họ trong nhóm đều do test tạo.
    await db.conversationParticipant.deleteMany({
      where: { conversationId: { in: convs }, userId: fx.users.sale1 },
    });
    // Mọi dòng MANUAL còn lại (ql2 vào lopA ở MA-10, ph1 vào lopB nếu cổng hở…) cũng do test tạo.
    await db.conversationParticipant.deleteMany({
      where: { conversationId: { in: convs }, source: "MANUAL" },
    });
    // Người dẫn xuất bị test đẩy ra (MA-04 ql1, cổng gỡ hở ⇒ gv1) quay lại nhóm.
    await db.conversationParticipant.updateMany({
      where: {
        conversationId: fx.conversations.lopA,
        userId: { in: [fx.users.ql1, fx.users.gv1] },
        source: "DERIVED",
      },
      data: { leftAt: null },
    });
  }

  afterEach(dọn, HOOK_TIMEOUT);
  afterAll(async () => {
    await dọn();
    await disconnectDb();
  }, HOOK_TIMEOUT);

  it(
    "[MA-01] thêm Sale vào một nhóm: dòng MANUAL · derivedFrom null · MEMBER + tin hệ thống nêu đúng tên",
    async () => {
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA],
        userIds: [fx.users.sale1],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.addedTotal).toBe(1);
      expect(r.data.groups[0]).toMatchObject({ added: 1, alreadyIn: 0, error: null });

      const p = await participant(fx.conversations.lopA, fx.users.sale1);
      expect(p).toMatchObject({ source: "MANUAL", derivedFrom: null, role: "MEMBER", leftAt: null });
      expect(await listManualMemberIds(fx.conversations.lopA)).toContain(fx.users.sale1);
      expect((await systemMessages(fx.conversations.lopA)).length).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-02] đồng bộ + đối soát chạy SAU KHÔNG gỡ dòng MANUAL (BR-15) — đây là cả lý do thêm tay tồn tại",
    async () => {
      await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA],
        userIds: [fx.users.sale1],
      });
      const classId = (await db.conversation.findUniqueOrThrow({
        where: { id: fx.conversations.lopA },
        select: { subjectId: true },
      })).subjectId!;

      await db.$transaction((tx) => syncConversationMembership(tx, classId));
      await reconcileConversationMembership({ onlyClassIds: [classId] });

      const p = await participant(fx.conversations.lopA, fx.users.sale1);
      expect(p).toMatchObject({ source: "MANUAL", leftAt: null });
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-03] đã ở trong nhóm sẵn ⇒ bỏ qua, KHÔNG đổi sang MANUAL và không sinh tin hệ thống",
    async () => {
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA],
        userIds: [fx.users.ql1], // QLCS CS1 — đã là DERIVED/CENTER_MANAGER của nhóm này
      });
      expect(r.ok && r.data.groups[0]).toMatchObject({ added: 0, alreadyIn: 1 });
      const p = await participant(fx.conversations.lopA, fx.users.ql1);
      expect(p).toMatchObject({ source: "DERIVED", derivedFrom: "CENTER_MANAGER" });
      expect(await systemMessages(fx.conversations.lopA)).toHaveLength(0);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-04] hàng DERIVED của QLCS đã rời (vai cấp sau khi nhóm tạo) ⇒ sync đưa về DERIVED, KHÔNG biến thành MANUAL",
    async () => {
      await db.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: fx.conversations.lopA, userId: fx.users.ql1 } },
        data: { leftAt: new Date() },
      });
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA],
        userIds: [fx.users.ql1],
      });
      expect(r.ok).toBe(true);
      const p = await participant(fx.conversations.lopA, fx.users.ql1);
      // Đồng bộ chạy trước nên người có vai thật quay về đúng tư cách DERIVED: khi vai bị thu hồi
      // họ TỰ rời, thay vì một dòng MANUAL dính mãi.
      expect(p).toMatchObject({ source: "DERIVED", derivedFrom: "CENTER_MANAGER", leftAt: null });
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-05] người đã bị gỡ tay rồi thêm lại ⇒ mở lại dòng CŨ (không tạo trùng) và là MANUAL",
    async () => {
      const a = await admin();
      const input = { conversationIds: [fx.conversations.lopA], userIds: [fx.users.sale1] };
      await addMembersAsActor(a, "Admin", input);
      const rm = await removeManualMemberAsActor(a, "Admin", {
        conversationId: fx.conversations.lopA,
        userId: fx.users.sale1,
      });
      expect(rm.ok).toBe(true);
      expect((await participant(fx.conversations.lopA, fx.users.sale1))?.leftAt).not.toBeNull();

      const again = await addMembersAsActor(a, "Admin", input);
      expect(again.ok && again.data.addedTotal).toBe(1);
      const rows = await db.conversationParticipant.count({
        where: { conversationId: fx.conversations.lopA, userId: fx.users.sale1 },
      });
      expect(rows).toBe(1);
      expect(await participant(fx.conversations.lopA, fx.users.sale1)).toMatchObject({
        source: "MANUAL",
        leftAt: null,
      });
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-06] gỡ người do hệ thống dẫn xuất ⇒ NOT_MANUAL_MEMBER và KHÔNG đổi gì (gỡ chỉ sống tới lần sync sau)",
    async () => {
      const r = await removeManualMemberAsActor(await admin(), "Admin", {
        conversationId: fx.conversations.lopA,
        userId: fx.users.gv1,
      });
      expect(r).toMatchObject({ ok: false, error: { code: "NOT_MANUAL_MEMBER" } });
      expect((await participant(fx.conversations.lopA, fx.users.gv1))?.leftAt).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-07] thêm tài khoản PHỤ HUYNH ⇒ USER_NOT_ELIGIBLE, và cổng đứng TRƯỚC phép ghi (không nhóm nào bị đụng)",
    async () => {
      const before = await db.conversationParticipant.count();
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA, fx.conversations.lopB],
        userIds: [fx.users.sale1, fx.users.ph1], // trộn người hợp lệ với một phụ huynh
      });
      expect(r).toMatchObject({ ok: false, error: { code: "USER_NOT_ELIGIBLE" } });
      expect(await db.conversationParticipant.count()).toBe(before);
      expect(await participant(fx.conversations.lopA, fx.users.sale1)).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-08] QUYỀN: QLCS · GV · Sale bị từ chối cả thêm/gỡ/hai loader; Admin được (đối chứng dương)",
    async () => {
      const input = { conversationIds: [fx.conversations.lopA], userIds: [fx.users.sale1] };
      for (const key of ["ql1", "gv1", "sale1", "ql2"] as const) {
        const a = await resolveActorUncached(fx.users[key]);
        expect(await addMembersAsActor(a, key, input), `add ${key}`).toMatchObject({
          ok: false,
          error: { code: "PERMISSION_DENIED" },
        });
        expect(
          await removeManualMemberAsActor(a, key, {
            conversationId: fx.conversations.lopA,
            userId: fx.users.sale1,
          }),
          `remove ${key}`,
        ).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
        expect(await listAddableStaffAsActor(a), `staff ${key}`).toMatchObject({ ok: false });
        expect(await listAddableGroupsAsActor(a), `groups ${key}`).toMatchObject({ ok: false });
      }
      expect(await participant(fx.conversations.lopA, fx.users.sale1)).toBeNull();
      expect((await addMembersAsActor(await admin(), "Admin", input)).ok).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-09] nhóm đã lưu trữ và hội thoại 1-1 bị từ chối RIÊNG TỪNG NHÓM; nhóm hợp lệ trong cùng lượt vẫn vào",
    async () => {
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopC, fx.conversations.dmGv1Ph1, fx.conversations.lopA],
        userIds: [fx.users.sale1],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const by = new Map(r.data.groups.map((g) => [g.conversationId, g]));
      expect(by.get(fx.conversations.lopC)?.error?.code).toBe("CONVERSATION_ARCHIVED");
      expect(by.get(fx.conversations.dmGv1Ph1)?.error?.code).toBe("NOT_CLASS_GROUP");
      expect(by.get(fx.conversations.lopA)).toMatchObject({ added: 1, error: null });
      expect(await participant(fx.conversations.lopC, fx.users.sale1)).toBeNull();
      expect(await participant(fx.conversations.dmGv1Ph1, fx.users.sale1)).toBeNull();
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-10] thêm đồng loạt: nhiều người × nhiều nhóm; id nhóm không tồn tại báo lỗi riêng chứ không nuốt cả lượt",
    async () => {
      const r = await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA, fx.conversations.lopB, "00000000-0000-4000-8000-000000000000"],
        userIds: [fx.users.sale1, fx.users.ql2],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const by = new Map(r.data.groups.map((g) => [g.conversationId, g]));
      expect(by.get("00000000-0000-4000-8000-000000000000")?.error?.code).toBe("CONVERSATION_NOT_FOUND");
      expect(by.get(fx.conversations.lopA)?.error).toBeNull();
      expect(by.get(fx.conversations.lopB)?.error).toBeNull();
      expect(await participant(fx.conversations.lopB, fx.users.sale1)).toMatchObject({ source: "MANUAL" });
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-11] ô chọn người: không có phụ huynh, không SĐT/email, đánh dấu ai đã ở trong nhóm",
    async () => {
      const r = await listAddableStaffAsActor(await admin(), { conversationId: fx.conversations.lopA });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const ids = r.data.staff.map((s) => s.userId);
      expect(ids).toContain(fx.users.sale1);
      expect(ids).toContain(fx.users.gv1);
      for (const ph of [fx.users.ph1, fx.users.ph2, fx.users.ph3, fx.users.ph4]) expect(ids).not.toContain(ph);
      for (const s of r.data.staff) {
        expect(Object.keys(s).sort()).toEqual(
          ["buckets", "centerId", "centerName", "name", "roleLabels", "userId"].sort(),
        );
      }
      expect(r.data.alreadyIn).toContain(fx.users.gv1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[MA-12] nhãn vai của người thêm tay trong danh sách thành viên là vai tài khoản, không phải 'Thành viên' chung chung",
    async () => {
      await addMembersAsActor(await admin(), "Admin", {
        conversationIds: [fx.conversations.lopA],
        userIds: [fx.users.sale1],
      });
      const members = await getConversationMembers(fx.conversations.lopA, fx.users.gv1);
      const sale = members.find((m) => m.userId === fx.users.sale1);
      expect(sale?.roleLabel).toBe("Tư vấn & Chăm sóc");
      expect(sale?.derivedFrom).toBeNull();
    },
    CASE_TIMEOUT,
  );
});
