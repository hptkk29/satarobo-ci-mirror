// lib/chat/migrate-legacy.test.ts — Đợt 1 sóng 3, unit (thuần, không DB):
// planLegacyMigration — luật ánh xạ ConversationMessage (cũ) → Message (mới).
//
// Đây là bộ luật quyết định "tin nào của ai đi về đâu" trên DỮ LIỆU THẬT, nên mỗi case
// dưới đây tương ứng đúng một dòng trong bảng ánh xạ của docs/chat-realtime/04-migrate-chat-cu.md.
import { describe, expect, it } from "vitest";
import {
  legacyClientMsgId,
  planLegacyMigration,
  resolveSender,
  type LegacyMessageRow,
  type LegacyMigrationContext,
} from "./migrate-legacy";

const T0 = new Date("2026-06-01T03:00:00.000Z");
const T1 = new Date("2026-06-01T04:00:00.000Z");
const T2 = new Date("2026-06-02T02:30:00.000Z");

type RowOverrides = Partial<Omit<LegacyMessageRow, "enrollment">> & {
  enrollment?: LegacyMessageRow["enrollment"];
};

/** Dòng tin cũ "bình thường": lớp ACTIVE, enrollment sống, HV có tài khoản PH. */
function row(id: string, o: RowOverrides = {}): LegacyMessageRow {
  return {
    id,
    enrollmentId: "enr1",
    authorUserId: "ph1",
    authorSide: "PARENT",
    body: "Chào cô, hôm nay con học thế nào ạ?",
    createdAt: T0,
    readByParentAt: null,
    readByStaffAt: null,
    enrollment: {
      id: "enr1",
      studentId: "hs1",
      deletedAt: null,
      student: { id: "hs1", parentUserId: "ph1" },
      class: {
        id: "lop1",
        name: "Sata 1 — CS1",
        status: "ACTIVE",
        deletedAt: null,
        teacherId: "gv1",
        assistantId: "tg1",
      },
    },
    ...o,
  };
}

function ctx(o: Partial<LegacyMigrationContext> = {}): LegacyMigrationContext {
  let n = 0;
  return {
    aliveUserIds: new Set(["ph1", "ph2", "gv1", "tg1", "nv1"]),
    conversationByClassId: new Map(),
    newId: () => `newmsg${++n}`, // tất định để assert được
    ...o,
  };
}

describe("planLegacyMigration — ánh xạ tin cũ sang hệ mới", () => {
  it("tin PH: về nhóm lớp của enrollment.classId, senderId = người gửi thật, giữ nguyên createdAt", () => {
    const plan = planLegacyMigration([row("m1")], ctx());

    expect(plan.classes).toHaveLength(1);
    const cls = plan.classes[0];
    expect(cls.classId).toBe("lop1");
    expect(cls.willCreateConversation).toBe(true); // lớp ACTIVE, chưa có nhóm → sync sẽ dựng
    expect(cls.messages).toHaveLength(1);
    expect(cls.messages[0]).toMatchObject({
      legacyId: "m1",
      senderId: "ph1",
      authorSide: "PARENT",
      senderResolution: "AUTHOR_RECORDED",
      clientMsgId: "legacy:m1",
      createdAt: T0,
    });
    expect(plan.skipped).toHaveLength(0);
    expect(plan.stats.guessedSenders).toBe(0);
  });

  it("tin STAFF: senderId = nhân viên đã gửi thật (hệ cũ CÓ lưu authorUserId), không suy đoán", () => {
    const plan = planLegacyMigration(
      [row("m1", { authorSide: "STAFF", authorUserId: "nv1", body: "Con học tốt ạ." })],
      ctx(),
    );

    expect(plan.classes[0].messages[0]).toMatchObject({
      senderId: "nv1",
      authorSide: "STAFF",
      senderResolution: "AUTHOR_RECORDED",
    });
    expect(plan.stats.guessedSenders).toBe(0);
  });

  it("tin STAFF của tài khoản đã xoá → quy về GV chính của lớp và ĐÁNH DẤU là suy đoán", () => {
    const plan = planLegacyMigration(
      [row("m1", { authorSide: "STAFF", authorUserId: "nv-da-nghi" })],
      ctx(),
    );

    expect(plan.classes[0].messages[0]).toMatchObject({
      senderId: "gv1",
      senderResolution: "CLASS_TEACHER_GUESS",
    });
    expect(plan.stats.guessedSenders).toBe(1);
    // Truy vết được về tin gốc dù người gửi là suy đoán.
    expect(plan.classes[0].messages[0].clientMsgId).toBe(legacyClientMsgId("m1"));
  });

  it("tin của enrollment đã xoá mềm → BỎ (hệ cũ đã ẩn luồng này, không hồi sinh)", () => {
    const enr = row("m1").enrollment;
    const plan = planLegacyMigration(
      [row("m1", { enrollment: enr ? { ...enr, deletedAt: new Date() } : null })],
      ctx(),
    );

    expect(plan.classes).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toBe("ENROLLMENT_DELETED");
    expect(plan.stats.skippedByReason.ENROLLMENT_DELETED).toBe(1);
  });

  it("tin của lớp không còn tồn tại → BỎ với lý do CLASS_MISSING", () => {
    const enr = row("m1").enrollment;
    const plan = planLegacyMigration(
      [row("m1", { enrollment: enr ? { ...enr, class: null } : null })],
      ctx(),
    );

    expect(plan.classes).toHaveLength(0);
    expect(plan.skipped[0]).toMatchObject({ reason: "CLASS_MISSING", classId: null });
  });

  it("lớp đã COMPLETED và chưa từng có nhóm → BỎ (BR-01: sync chỉ dựng nhóm cho lớp ACTIVE)", () => {
    const enr = row("m1").enrollment;
    const ended = enr && enr.class ? { ...enr, class: { ...enr.class, status: "COMPLETED" } } : null;
    const plan = planLegacyMigration([row("m1", { enrollment: ended })], ctx());

    expect(plan.classes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("NO_CONVERSATION");
    expect(plan.stats.classesWithoutConversation).toBe(1);
  });

  it("lớp đã COMPLETED nhưng nhóm ĐÃ tồn tại → vẫn đổ vào nhóm cũ, không gọi sync dựng lại", () => {
    const enr = row("m1").enrollment;
    const ended = enr && enr.class ? { ...enr, class: { ...enr.class, status: "COMPLETED" } } : null;
    const plan = planLegacyMigration(
      [row("m1", { enrollment: ended })],
      ctx({ conversationByClassId: new Map([["lop1", { id: "conv1" }]]) }),
    );

    expect(plan.classes).toHaveLength(1);
    expect(plan.classes[0].conversationId).toBe("conv1");
    expect(plan.classes[0].willCreateConversation).toBe(false);
    expect(plan.stats.classesReusingConversation).toBe(1);
  });

  it("2 tin cùng enrollment khác thời điểm → cùng 1 lớp, giữ đúng thứ tự lịch sử", () => {
    const plan = planLegacyMigration(
      [
        row("m-sau", { createdAt: T2, body: "Tin sau" }),
        row("m-truoc", { createdAt: T0, body: "Tin trước" }),
      ],
      ctx(),
    );

    expect(plan.classes).toHaveLength(1);
    expect(plan.classes[0].messages.map((m) => m.legacyId)).toEqual(["m-truoc", "m-sau"]);
    expect(plan.classes[0].messages.map((m) => m.createdAt)).toEqual([T0, T2]);
    expect(plan.stats.plannedMessages).toBe(2);
  });

  it("chạy lại: tin đã có clientMsgId legacy:<id> trong DB → KHÔNG lên kế hoạch lần hai", () => {
    const rows = [row("m1"), row("m2", { createdAt: T1 })];
    const first = planLegacyMigration(rows, ctx());
    expect(first.stats.plannedMessages).toBe(2);
    expect(first.stats.alreadyMigrated).toBe(0);

    const second = planLegacyMigration(
      rows,
      ctx({ migratedClientMsgIds: new Set(["legacy:m1", "legacy:m2"]) }),
    );
    expect(second.stats.plannedMessages).toBe(0);
    expect(second.stats.alreadyMigrated).toBe(2);
    expect(second.classes).toHaveLength(0); // không lớp nào cần mở transaction
    expect(second.skipped).toHaveLength(0); // "đã migrate" KHÁC "không migrate được"
  });

  it("chạy lại một phần: chỉ tin chưa có mới được lên kế hoạch", () => {
    const plan = planLegacyMigration(
      [row("m1"), row("m2", { createdAt: T1 })],
      ctx({ migratedClientMsgIds: new Set(["legacy:m1"]) }),
    );

    expect(plan.stats.alreadyMigrated).toBe(1);
    expect(plan.classes[0].messages.map((m) => m.legacyId)).toEqual(["m2"]);
  });

  it("PH chưa có tài khoản + tác giả đã xoá → KHÔNG map được, tuyệt đối không gán bừa", () => {
    const enr = row("m1").enrollment;
    const orphan =
      enr ? { ...enr, student: { id: "hs1", parentUserId: null } } : null;
    const plan = planLegacyMigration(
      [row("m1", { authorUserId: "ph-da-xoa", enrollment: orphan })],
      ctx(),
    );

    expect(plan.classes).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("SENDER_UNRESOLVED");
    expect(plan.skipped[0].detail).toContain("chưa có tài khoản");
    expect(plan.stats.plannedMessages).toBe(0);
  });

  it("PH chưa có tài khoản NHƯNG tác giả gốc vẫn còn → vẫn map theo người gửi thật", () => {
    const enr = row("m1").enrollment;
    const orphan = enr ? { ...enr, student: { id: "hs1", parentUserId: null } } : null;
    const plan = planLegacyMigration([row("m1", { enrollment: orphan })], ctx());

    expect(plan.classes[0].messages[0]).toMatchObject({
      senderId: "ph1",
      senderResolution: "AUTHOR_RECORDED",
    });
  });

  it("tin rỗng → BỎ (Message.body không nhận rỗng)", () => {
    const plan = planLegacyMigration([row("m1", { body: "   " })], ctx());
    expect(plan.skipped[0].reason).toBe("EMPTY_BODY");
  });

  it("readByParentAt → mốc đã đọc của ĐÚNG PH đó; readByStaffAt bị bỏ (không suy được ai đọc)", () => {
    const readAt = new Date("2026-06-03T01:00:00.000Z");
    const plan = planLegacyMigration(
      [
        row("m1", {
          authorSide: "STAFF",
          authorUserId: "gv1",
          createdAt: T0,
          readByParentAt: readAt,
        }),
        row("m2", {
          authorSide: "STAFF",
          authorUserId: "gv1",
          createdAt: T1,
          readByParentAt: readAt,
        }),
        // Tin của PH có readByStaffAt — hệ cũ đánh dấu theo PHÍA, không ghi nhân viên nào.
        row("m3", { createdAt: T2, readByStaffAt: readAt }),
      ],
      ctx(),
    );

    expect(plan.classes[0].reads).toEqual([
      {
        classId: "lop1",
        userId: "ph1",
        lastReadAt: readAt,
        lastReadClientMsgId: "legacy:m2", // tin ĐÃ ĐỌC mới nhất, không phải tin đọc sau cùng
      },
    ]);
    expect(plan.stats.plannedReads).toBe(1);
  });

  it("lớp có 2 học viên từng nhắn → đếm vào cảnh báo phơi riêng tư", () => {
    const base = row("m1").enrollment;
    const hs2 =
      base
        ? {
            ...base,
            id: "enr2",
            studentId: "hs2",
            student: { id: "hs2", parentUserId: "ph2" },
          }
        : null;
    const plan = planLegacyMigration(
      [row("m1"), row("m2", { authorUserId: "ph2", enrollment: hs2, createdAt: T1 })],
      ctx(),
    );

    expect(plan.classes).toHaveLength(1);
    expect(plan.classes[0].distinctStudents).toBe(2);
    expect(plan.stats.classesWithMultipleStudents).toBe(1);
  });

  it("thống kê tổng khớp: mỗi tin vào đúng một rổ (planned / alreadyMigrated / skipped)", () => {
    const enr = row("m1").enrollment;
    const plan = planLegacyMigration(
      [
        row("ok1"),
        row("ok2", { createdAt: T1 }),
        row("da-migrate", { createdAt: T2 }),
        row("enr-xoa", { enrollment: enr ? { ...enr, deletedAt: new Date() } : null }),
        row("rong", { body: "" }),
      ],
      ctx({ migratedClientMsgIds: new Set(["legacy:da-migrate"]) }),
    );

    const s = plan.stats;
    expect(s.totalRows).toBe(5);
    expect(s.plannedMessages + s.alreadyMigrated + s.skipped).toBe(5);
    expect(s).toMatchObject({ plannedMessages: 2, alreadyMigrated: 1, skipped: 2 });
  });
});

describe("resolveSender", () => {
  const alive = new Set(["ph1", "gv1", "tg1"]);

  it("ưu tiên authorUserId đã ghi (cả 2 phía) — hệ cũ lưu người gửi thật", () => {
    expect(resolveSender(row("m1"), alive)).toEqual({
      senderId: "ph1",
      resolution: "AUTHOR_RECORDED",
    });
  });

  it("tin PH mà tác giả đã xoá → rơi về parentUserId hiện tại của học viên", () => {
    expect(resolveSender(row("m1", { authorUserId: "mat-tich" }), alive)).toEqual({
      senderId: "ph1",
      resolution: "PARENT_FALLBACK",
    });
  });

  it("tin STAFF mà GV chính cũng đã xoá → rơi tiếp về trợ giảng", () => {
    const enr = row("m1").enrollment;
    const noTeacher =
      enr && enr.class ? { ...enr, class: { ...enr.class, teacherId: "gv-da-nghi" } } : null;
    expect(
      resolveSender(
        row("m1", { authorSide: "STAFF", authorUserId: "mat-tich", enrollment: noTeacher }),
        alive,
      ),
    ).toEqual({ senderId: "tg1", resolution: "CLASS_TEACHER_GUESS" });
  });

  it("không còn ứng viên nào → null (caller đánh SENDER_UNRESOLVED, không gán bừa)", () => {
    const enr = row("m1").enrollment;
    const bare =
      enr && enr.class
        ? { ...enr, class: { ...enr.class, teacherId: null, assistantId: null } }
        : null;
    expect(
      resolveSender(
        row("m1", { authorSide: "STAFF", authorUserId: "mat-tich", enrollment: bare }),
        alive,
      ),
    ).toBeNull();
  });
});
