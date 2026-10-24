// @vitest-environment node
/**
 * Chat — 6 BẤT BIẾN SỐNG CÒN của TẦNG DB, chạy TRONG CI (job `chat-db-tests`).
 *
 * Vì sao file này tồn tại: trước nó, toàn bộ tầng DB của module chat KHÔNG có test tự
 * động nào chạy trong CI — `sync-membership.test.ts` chỉ chạm hàm THUẦN
 * `computeDerivedMembership`, `reconcile-membership.test.ts` chỉ chạm `diffMembership`,
 * còn `permission-matrix.spec.ts` `describe.skipIf(!HAS_LOCAL_DB)` mà job `unit-tests`
 * không có Postgres ⇒ skip sạch. Hệ quả đo được: đổi bộ lọc `leavers` trong
 * `syncConversationMembership` thành `filter(() => false)` (PH bị gỡ khỏi lớp vẫn đọc
 * được lịch sử nhóm, F-KICK chết) mà CI vẫn XANH 100%.
 *
 * Chỉ port những bất biến mà HỎNG = RÒ RỈ DỮ LIỆU hoặc MẤT TIN (script ZZTEST chạy tay
 * vẫn giữ nguyên, phủ rộng hơn):
 *   BT-1  sync đặt `leftAt` khi học viên rời lớp                (_zztest-chat-us03 TS-06.2)
 *   BT-2  bẫy PH nhiều con: 1 con nghỉ → Ở LẠI; con cuối → rời  (_zztest-chat-us03 TS-06)
 *   BT-3  DomainEvent `chat.participant_removed` + rollback sạch (_zztest-chat-us07-kick)
 *   BT-4  cổng đọc: không/hết là participant → NOT_PARTICIPANT   (_zztest-chat-us08 TS-01.2/01.7)
 *   BT-5  BR-30: payload thành viên cho PH sạch liên hệ          (_zztest-chat-us08 TS-04.4)
 *   BT-6  cron đối soát: REMOVE tự thi hành, ADD chỉ log         (_zztest-chat-us04 TS-07)
 *
 * ⚠️ FIXTURE: participant ở đây được dựng bằng CHÍNH `syncConversationMembership` — KHÔNG
 * dùng `seedChatFixture` (`tests/chat/_helpers/seed-chat.ts` ghi thẳng `leftAt` cho ph4
 * qua `upsertParticipant`, nên assertion về `leftAt` ở đó kiểm SEED chứ không kiểm CODE).
 *
 * ⚠️ AN TOÀN DB: file này KHÔNG gọi `resetDb()`/TRUNCATE — không bao giờ. Mọi bản ghi
 * mang tiền tố `CI_CHAT_` và bị dọn ở `beforeAll` + `afterAll`. Cron đối soát luôn gọi
 * với `onlyClassIds` giới hạn đúng lớp của test.
 *
 * ⚠️ CỔNG CHẠY: mặc định CHỈ chạy khi `DATABASE_URL` trỏ Postgres LOCAL (localhost /
 * 127.0.0.1 / satarobo_test / ci_test) — máy dev không có DB thì SKIP, `pnpm test:unit`
 * vẫn xanh. Cửa hậu `CHAT_DB_TEST_ALLOW_REMOTE=1` chỉ dành cho việc nghiệm thu
 * kiểm-ngược (mutation testing) trên máy không dựng được Postgres local; TUYỆT ĐỐI
 * không đặt biến này trong CI hay trỏ vào DB prod.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";
import { db } from "../../lib/db";
import { syncConversationMembership } from "../../lib/chat/sync-membership";
import { reconcileConversationMembership } from "../../lib/chat/reconcile-membership";
import {
  ChatQueryError,
  getConversationMembers,
  getMessagesPage,
} from "../../lib/chat/queries";
import { CHAT_PARTICIPANT_REMOVED } from "../../lib/chat/events";

import { RUN_DB_TESTS as RUN_DB_TESTS_CHUNG } from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db` / `test:nen-db`.
const RUN_DB_TESTS = RUN_DB_TESTS_CHUNG;

/**
 * Trần thời gian mỗi case. Postgres CI local chạy dưới 1s, nhưng cửa hậu
 * ALLOW_REMOTE trỏ DB từ xa (RTT cao) thì 5s mặc định của vitest đứt giữa chừng
 * và biến "chậm" thành "đỏ giả" — che mất tín hiệu thật của kiểm ngược.
 */
const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 120_000;

// ─────────────────────────────────────────────────────────────────────────────
// Fixture riêng — tiền tố CI_CHAT_, dựng participant bằng chính service thật.
// ─────────────────────────────────────────────────────────────────────────────
const P = "CI_CHAT_";
const SLUG = "ci-chat-";
/** timeout 30s cho mọi tx có sync (luật E-bis #2) — trần 5s mặc định đứt giữa chừng. */
const TX_OPTS = { timeout: 30_000, maxWait: 10_000 } as const;

/** Run record của cron đối soát do test sinh ra — xoá ở cleanup. */
const reconcileRunIds: string[] = [];

/** SĐT test dạng `09XXXXXXXX` (10 số) — khớp regex SĐT VN của máy dò BR-30. */
function testPhone(): string {
  return `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

type World = {
  tag: string;
  centerId: string;
  courseId: string;
  classId: string;
  users: Record<string, string>;
  students: Record<string, string>;
  enrollments: Record<string, string>;
};

type WorldSpec = {
  /** Học viên trong lớp: key học viên → PH + trạng thái ghi danh. */
  students: { key: string; parent: string; status: EnrollmentStatus }[];
  /** Học viên KHÔNG ghi danh (dùng cho drift ADD của cron). */
  loneStudents?: { key: string; parent: string }[];
  /** User PARENT không dính lớp nào — "người ngoài" của cổng đọc. */
  outsiders?: string[];
};

async function createWorld(tag: string, spec: WorldSpec): Promise<World> {
  const center = await db.center.create({
    data: {
      name: `${P}${tag} Center`,
      slug: `${SLUG}${tag}-center`,
      address: `${P}address`,
      city: "Đà Nẵng",
    },
    select: { id: true },
  });
  const course = await db.course.create({
    data: { name: `${P}${tag} Course`, slug: `${SLUG}${tag}-course` },
    select: { id: true },
  });

  const users: Record<string, string> = {};
  const mkUser = async (key: string, role: "TEACHER" | "PARENT"): Promise<string> => {
    const u = await db.user.create({
      data: {
        email: `${P.toLowerCase()}${tag}_${key}@ci-chat.test.local`,
        name: `${P}${tag} ${key}`,
        role,
        roles: [role],
        phone: testPhone(),
        centerId: role === "TEACHER" ? center.id : null,
        isActive: true,
      },
      select: { id: true },
    });
    users[key] = u.id;
    return u.id;
  };

  const gvId = await mkUser("gv", "TEACHER");
  const parentKeys = new Set<string>([
    ...spec.students.map((s) => s.parent),
    ...(spec.loneStudents ?? []).map((s) => s.parent),
    ...(spec.outsiders ?? []),
  ]);
  for (const key of parentKeys) await mkUser(key, "PARENT");

  const cls = await db.class.create({
    data: {
      name: `${P}${tag} Lop`,
      courseId: course.id,
      centerId: center.id,
      teacherId: gvId,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  const students: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const mkStudent = async (key: string, parent: string): Promise<string> => {
    const s = await db.student.create({
      data: {
        name: `${P}${tag} ${key}`,
        parentUserId: users[parent],
        centerId: center.id,
      },
      select: { id: true },
    });
    students[key] = s.id;
    return s.id;
  };
  for (const s of spec.students) {
    const studentId = await mkStudent(s.key, s.parent);
    // Enrollment ∈ SCOPED_MODELS — BẮT BUỘC set centerId khi create.
    const e = await db.enrollment.create({
      data: {
        studentId,
        classId: cls.id,
        courseId: course.id,
        centerId: center.id,
        status: s.status,
      },
      select: { id: true },
    });
    enrollments[s.key] = e.id;
  }
  for (const s of spec.loneStudents ?? []) await mkStudent(s.key, s.parent);

  return {
    tag,
    centerId: center.id,
    courseId: course.id,
    classId: cls.id,
    users,
    students,
    enrollments,
  };
}

/** Chạy service thật trong 1 transaction — y hệt điểm gọi nghiệp vụ. */
async function runSync(classId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await syncConversationMembership(tx, classId);
  }, TX_OPTS);
}

async function conversationIdOf(classId: string): Promise<string> {
  const conv = await db.conversation.findUnique({
    where: {
      type_subjectType_subjectId: {
        type: "CLASS_GROUP",
        subjectType: "CLASS",
        subjectId: classId,
      },
    },
    select: { id: true },
  });
  if (!conv) throw new Error(`sync chưa tạo Conversation cho lớp ${classId}`);
  return conv.id;
}

async function participantRows(conversationId: string, userId: string) {
  return db.conversationParticipant.findMany({
    where: { conversationId, userId },
    select: { id: true, leftAt: true, joinedAt: true, role: true, derivedFrom: true },
  });
}

async function kickEvents(conversationId: string) {
  return db.domainEvent.findMany({
    where: {
      type: CHAT_PARTICIPANT_REMOVED,
      payloadJson: { path: ["conversationId"], equals: conversationId },
    },
    select: { payloadJson: true, status: true },
  });
}

/** Dọn MỌI bản ghi CI_CHAT_ (kể cả rác lần chạy trước) — idempotent, KHÔNG truncate. */
async function cleanup(): Promise<void> {
  const classes = await db.class.findMany({
    where: { name: { startsWith: P } },
    select: { id: true },
  });
  const classIds = classes.map((c) => c.id);
  const convs = classIds.length
    ? await db.conversation.findMany({
        where: { subjectType: "CLASS", subjectId: { in: classIds } },
        select: { id: true },
      })
    : [];
  const convIds = convs.map((c) => c.id);

  for (const cid of convIds) {
    await db.domainEvent.deleteMany({
      where: {
        type: CHAT_PARTICIPANT_REMOVED,
        payloadJson: { path: ["conversationId"], equals: cid },
      },
    });
  }
  if (classIds.length > 0) {
    await db.conversationMembershipDrift.deleteMany({
      where: { classId: { in: classIds } },
    });
  }
  if (convIds.length > 0) {
    await db.message.deleteMany({ where: { conversationId: { in: convIds } } });
    await db.conversationParticipant.deleteMany({
      where: { conversationId: { in: convIds } },
    });
    await db.conversation.deleteMany({ where: { id: { in: convIds } } });
  }
  if (classIds.length > 0) {
    await db.enrollment.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
  }
  await db.student.deleteMany({ where: { name: { startsWith: P } } });
  await db.user.deleteMany({ where: { email: { startsWith: P.toLowerCase() } } });
  await db.course.deleteMany({ where: { slug: { startsWith: SLUG } } });
  await db.center.deleteMany({ where: { slug: { startsWith: SLUG } } });
  if (reconcileRunIds.length > 0) {
    await db.conversationReconcileRun.deleteMany({
      where: { id: { in: [...reconcileRunIds] } },
    });
    reconcileRunIds.length = 0;
  }
}

/** Máy dò rò rỉ liên hệ — duyệt SÂU mọi khoá/giá trị, KHÔNG kiểm vài field biết trước. */
const CONTACT_KEY_RE = /phone|email|sdt|address|sđt/i;
const VN_PHONE_RE = /(?<![0-9])(?:\+?84|0)(?:3|5|7|8|9)[0-9]{8}(?![0-9])/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function findContactLeaks(value: unknown, path = "$", out: string[] = []): string[] {
  if (value === null || value === undefined) return out;
  if (value instanceof Date) return out;
  if (typeof value === "string") {
    if (VN_PHONE_RE.test(value)) out.push(`${path}="${value}" (SĐT VN)`);
    if (EMAIL_RE.test(value)) out.push(`${path}="${value}" (email)`);
    return out;
  }
  if (typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findContactLeaks(v, `${path}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CONTACT_KEY_RE.test(k)) out.push(`${path}.${k} (khoá nhạy cảm)`);
    findContactLeaks(v, `${path}.${k}`, out);
  }
  return out;
}

/** Phải NÉM ChatQueryError(NOT_PARTICIPANT); trả về dữ liệu = rò rỉ. */
async function expectNotParticipant(p: Promise<unknown>): Promise<void> {
  const outcome = await p.then(
    (v) => v as unknown,
    (e: unknown) => e,
  );
  expect(
    outcome,
    "cổng đọc phải NÉM ChatQueryError, nhưng đã TRẢ VỀ dữ liệu (rò rỉ)",
  ).toBeInstanceOf(ChatQueryError);
  expect((outcome as ChatQueryError).code).toBe("NOT_PARTICIPANT");
}

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN_DB_TESTS)("Chat · 6 bất biến tầng DB (Postgres thật)", () => {
  beforeAll(async () => {
    await cleanup(); // dọn rác lần chạy trước
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  }, HOOK_TIMEOUT);

  // ───────────────────────────────────────────────────────────────────────────
  // BT-1 — sync đặt leftAt khi học viên rời lớp.
  // ĐỘT BIẾN CHỨNG MINH: sync-membership.ts `leavers` → `existing.filter(() => false)`.
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-1 · syncConversationMembership đặt leftAt khi HV rời lớp", () => {
    let w: World;
    let convId: string;

    beforeAll(async () => {
      w = await createWorld("bt1", {
        students: [{ key: "con", parent: "ph", status: "STUDYING" }],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "nền: sync dựng nhóm + PH là thành viên CÒN HIỆU LỰC (leftAt=null)",
      async () => {
        const rows = await participantRows(convId, w.users.ph!);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.leftAt).toBeNull();
        expect(rows[0]!.derivedFrom).toBe("CLASS_STUDENT_PARENT");
      },
      CASE_TIMEOUT,
    );

    it(
      "HV rút ghi danh → sync đặt leftAt cho PH (KHÔNG xoá bản ghi — BR-13)",
      async () => {
        await db.enrollment.update({
          where: { id: w.enrollments.con! },
          data: { status: "WITHDREW" },
        });
        await runSync(w.classId);

        const rows = await participantRows(convId, w.users.ph!);
        expect(rows).toHaveLength(1); // BR-13: set leftAt, không hard delete
        expect(
          rows[0]!.leftAt,
          "PH bị gỡ khỏi lớp mà leftAt vẫn null ⇒ vẫn đọc được lịch sử nhóm + vẫn qua cổng participant",
        ).not.toBeNull();
      },
      CASE_TIMEOUT,
    );

    it(
      "GV không dính dáng vẫn ở lại nhóm (sync không đá nhầm)",
      async () => {
        const rows = await participantRows(convId, w.users.gv!);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.leftAt).toBeNull();
        expect(rows[0]!.role).toBe("MODERATOR");
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BT-2 — bẫy BA: PH nhiều con cùng lớp.
  // ĐỘT BIẾN CHỨNG MINH: thu hẹp bộ trạng thái ghi danh trong loadDerivedMembership
  // (`e."status" = ANY(...)` → `e."status" = 'ACTIVE'`) ⇒ con STUDYING bị coi là đã nghỉ.
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-2 · PH 2 con cùng lớp — 1 bản ghi, chỉ rời khi con CUỐI nghỉ", () => {
    let w: World;
    let convId: string;

    beforeAll(async () => {
      w = await createWorld("bt2", {
        students: [
          { key: "con1", parent: "ph", status: "STUDYING" },
          { key: "con2", parent: "ph", status: "ACTIVE" },
        ],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "2 con cùng lớp → ĐÚNG 1 participant cho PH",
      async () => {
        const rows = await participantRows(convId, w.users.ph!);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.leftAt).toBeNull();
      },
      CASE_TIMEOUT,
    );

    it(
      "con thứ nhất nghỉ → PH Ở LẠI (vẫn còn con thứ hai trong lớp)",
      async () => {
        await db.enrollment.update({
          where: { id: w.enrollments.con2! },
          data: { status: "WITHDREW" },
        });
        await runSync(w.classId);

        const rows = await participantRows(convId, w.users.ph!);
        expect(rows).toHaveLength(1);
        expect(
          rows[0]!.leftAt,
          "PH còn 1 con đang học mà đã bị đá khỏi nhóm ⇒ mất kênh liên lạc với lớp",
        ).toBeNull();
      },
      CASE_TIMEOUT,
    );

    it(
      "con CUỐI nghỉ → mới đặt leftAt, vẫn đúng 1 bản ghi",
      async () => {
        await db.enrollment.update({
          where: { id: w.enrollments.con1! },
          data: { status: "WITHDREW" },
        });
        await runSync(w.classId);

        const rows = await participantRows(convId, w.users.ph!);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.leftAt).not.toBeNull();
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BT-3 — F-KICK: DomainEvent phát TRONG transaction.
  // ĐỘT BIẾN CHỨNG MINH: (a) bỏ lời gọi publishEvent; (b) bỏ `tx` khỏi opts của
  // publishEvent (event bắn ngoài transaction ⇒ rollback vẫn sót event).
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-3 · publishEvent(chat.participant_removed) + rollback không sót event", () => {
    let w: World;
    let convId: string;

    beforeAll(async () => {
      w = await createWorld("bt3", {
        students: [{ key: "con", parent: "ph", status: "STUDYING" }],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "nền: chưa ai rời → chưa có event kick nào",
      async () => {
        expect(await kickEvents(convId)).toHaveLength(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "transaction nghiệp vụ ROLLBACK → KHÔNG sót event, KHÔNG sót leftAt",
      async () => {
        await db
          .$transaction(async (tx) => {
            await tx.enrollment.update({
              where: { id: w.enrollments.con! },
              data: { status: "WITHDREW" },
            });
            await syncConversationMembership(tx, w.classId);
            throw new Error("ép rollback");
          }, TX_OPTS)
          .catch(() => null);

        expect(
          await kickEvents(convId),
          "event phải nằm TRONG tx nghiệp vụ — rollback mà còn event là bắn kick oan",
        ).toHaveLength(0);
        const rows = await participantRows(convId, w.users.ph!);
        expect(rows[0]!.leftAt).toBeNull();
        const enr = await db.enrollment.findUnique({
          where: { id: w.enrollments.con! },
          select: { status: true },
        });
        expect(enr?.status).toBe("STUDYING");
      },
      CASE_TIMEOUT,
    );

    it(
      "gỡ HV thật → leftAt + ĐÚNG 1 event, payload {conversationId,userId} đúng",
      async () => {
        await db.$transaction(async (tx) => {
          await tx.enrollment.update({
            where: { id: w.enrollments.con! },
            data: { status: "WITHDREW" },
          });
          await syncConversationMembership(tx, w.classId);
        }, TX_OPTS);

        const rows = await participantRows(convId, w.users.ph!);
        expect(rows[0]!.leftAt).not.toBeNull();

        const events = await kickEvents(convId);
        expect(
          events,
          "không có event ⇒ dispatcher không bắn participant.removed ⇒ F-KICK chết",
        ).toHaveLength(1);
        const payload = events[0]!.payloadJson as {
          conversationId?: string;
          userId?: string;
        };
        expect(payload.conversationId).toBe(convId);
        expect(payload.userId).toBe(w.users.ph);
      },
      CASE_TIMEOUT,
    );

    it(
      "idempotent: sync lại khi không còn ai phải rời → KHÔNG sinh event mới",
      async () => {
        await runSync(w.classId);
        expect(await kickEvents(convId)).toHaveLength(1);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BT-4 — cổng đọc (lib/chat/queries.ts).
  // ĐỘT BIẾN CHỨNG MINH: assertActiveParticipant `if (!p || p.leftAt !== null)` → `if (!p)`.
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-4 · getMessagesPage — người ngoài / đã rời đều NOT_PARTICIPANT", () => {
    let w: World;
    let convId: string;

    beforeAll(async () => {
      w = await createWorld("bt4", {
        students: [{ key: "con", parent: "ph", status: "STUDYING" }],
        outsiders: ["phNgoai"],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "đối chứng dương: thành viên còn hiệu lực (GV) ĐỌC ĐƯỢC",
      async () => {
        const page = await getMessagesPage(convId, w.users.gv!);
        expect(Array.isArray(page.messages)).toBe(true);
        expect(page.hasMore).toBe(false);
      },
      CASE_TIMEOUT,
    );

    it(
      "người KHÔNG phải thành viên gọi thẳng bằng conversationId → NOT_PARTICIPANT",
      async () => {
        await expectNotParticipant(getMessagesPage(convId, w.users.phNgoai!));
      },
      CASE_TIMEOUT,
    );

    it(
      "PH ĐÃ RỜI nhóm → NOT_PARTICIPANT NGAY, không grace period",
      async () => {
        await db.enrollment.update({
          where: { id: w.enrollments.con! },
          data: { status: "WITHDREW" },
        });
        await runSync(w.classId);
        const rows = await participantRows(convId, w.users.ph!);
        expect(
          rows[0]!.leftAt,
          "tiền đề của case này: PH phải đã bị đặt leftAt",
        ).not.toBeNull();

        await expectNotParticipant(getMessagesPage(convId, w.users.ph!));
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BT-5 — BR-30: PH không thấy liên hệ của bất kỳ ai.
  // ĐỘT BIẾN CHỨNG MINH: toMemberView bỏ nhánh `if (opts.hideContacts) return base;`
  // (hoặc shouldHideContacts luôn trả false).
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-5 · BR-30 — getConversationMembers cho PARENT sạch SĐT/email", () => {
    let w: World;
    let convId: string;

    beforeAll(async () => {
      w = await createWorld("bt5", {
        students: [
          { key: "con1", parent: "ph1", status: "STUDYING" },
          { key: "con2", parent: "ph2", status: "STUDYING" },
        ],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "GV KHÔNG thấy SĐT/email phụ huynh — dù SĐT thật CÓ trong DB (chủ dự án chốt 09/08)",
      async () => {
        const members = await getConversationMembers(convId, w.users.gv!);
        expect(members.length).toBeGreaterThanOrEqual(3); // gv + ph1 + ph2
        const ph1 = members.find((m) => m.userId === w.users.ph1);
        const dbPh1 = await db.user.findUnique({
          where: { id: w.users.ph1! },
          select: { phone: true, email: true },
        });

        // ĐỐI CHỨNG BẮT BUỘC: SĐT phải THẬT SỰ có trong DB. Thiếu dòng này thì test dưới
        // xanh giả — một `getConversationMembers` trả rỗng cũng "pass".
        expect(dbPh1?.phone).toMatch(VN_PHONE_RE);

        // Case này TRƯỚC 09/08 khẳng định điều NGƯỢC LẠI ("GV thấy đầy đủ"). Repo khi đó có
        // hai luật xung khắc cùng sống: luật PII chung (`canViewParentContact`) chặn giáo
        // viên — chú thích ghi rõ "P0-3: chống lộ SĐT toàn lớp ở trang tiến độ lớp" — còn
        // module chat lại pin chiều cho phép. Mâu thuẫn ngủ yên vì chưa màn hình nhân viên
        // nào vẽ liên hệ ra; màn "thành viên nhóm lớp" của US-13 đánh thức nó.
        // Chủ dự án chốt: theo luật PII chung. KHÔNG vá ngược case này.
        expect(ph1?.contact?.phone ?? null).toBeNull();
        expect(ph1?.contact?.email ?? null).toBeNull();

        // Nhưng vẫn phải ĐỦ DÙNG: GV cần nhận ra ai là ai để nhắn riêng.
        expect(ph1?.userId).toBe(w.users.ph1);
      },
      CASE_TIMEOUT,
    );

    // Đối chứng "QLCS VẪN thấy đầy đủ liên hệ" nằm ở tests/chat/list-and-admin-search.spec.ts
    // — `createWorld` của file này chỉ dựng TEACHER + PARENT, không có quản lý cơ sở. Đối
    // chứng đó bắt buộc phải tồn tại ở đâu đó: thiếu nó thì một bản vá "ẩn liên hệ với TẤT CẢ"
    // cũng làm mọi thứ xanh, mà siết vậy là chặn cả người cần gọi phụ huynh về học phí.

    it(
      "PH xem danh sách thành viên → duyệt SÂU payload KHÔNG còn SĐT/email của AI",
      async () => {
        const members = await getConversationMembers(convId, w.users.ph1!);
        expect(members.length).toBeGreaterThanOrEqual(3);
        // vẫn phải đủ dùng: thấy GV + nhãn vai trò
        expect(members.some((m) => m.userId === w.users.gv)).toBe(true);
        expect(members.some((m) => m.roleLabel === "Giáo viên")).toBe(true);

        const leaks = findContactLeaks(members, "members");
        expect(
          leaks,
          `BR-30 vỡ — payload cho PH lộ liên hệ:\n${leaks.join("\n")}`,
        ).toEqual([]);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BT-6 — cron đối soát (US-04).
  // ĐỘT BIẾN CHỨNG MINH: (a) bỏ `conversationParticipant.update({leftAt})` ở nhánh
  // removes; (b) thêm `conversationParticipant.create` ở nhánh adds (job tự thêm người).
  // ───────────────────────────────────────────────────────────────────────────
  describe("BT-6 · reconcileConversationMembership — REMOVE tự thi hành, ADD chỉ log", () => {
    let w: World;
    let convId: string;

    const runReconcile = async () => {
      const r = await reconcileConversationMembership({ onlyClassIds: [w.classId] });
      reconcileRunIds.push(r.runId);
      return r;
    };

    beforeAll(async () => {
      w = await createWorld("bt6", {
        students: [{ key: "con1", parent: "ph1", status: "STUDYING" }],
        loneStudents: [{ key: "con2", parent: "ph2" }],
      });
      await runSync(w.classId);
      convId = await conversationIdOf(w.classId);
    }, HOOK_TIMEOUT);

    it(
      "drift REMOVE (xoá ghi danh bằng SQL trần) → job tự đặt leftAt + log autoEnforced",
      async () => {
        // SQL TRẦN = mô phỏng luồng đổi dữ liệu KHÔNG đi qua sync (SQL Editor/seed/script).
        await db.$executeRaw`DELETE FROM "Enrollment" WHERE "classId" = ${w.classId} AND "studentId" = ${w.students.con1}`;

        const before = await participantRows(convId, w.users.ph1!);
        expect(before[0]!.leftAt).toBeNull();

        const r = await runReconcile();
        expect(r.removeCount).toBe(1);
        expect(r.addCount).toBe(0);

        const after = await participantRows(convId, w.users.ph1!);
        expect(
          after[0]!.leftAt,
          "rò rỉ quyền không được sống qua đêm — job phải tự đặt leftAt",
        ).not.toBeNull();

        const drifts = await db.conversationMembershipDrift.findMany({
          where: { classId: w.classId, driftType: "REMOVE" },
          select: {
            userId: true,
            autoEnforced: true,
            conversationId: true,
            centerId: true,
          },
        });
        expect(drifts).toHaveLength(1);
        expect(drifts[0]!.userId).toBe(w.users.ph1);
        expect(drifts[0]!.autoEnforced).toBe(true);
        expect(drifts[0]!.conversationId).toBe(convId);
        expect(drifts[0]!.centerId).toBe(w.centerId); // ghi kép centerId + orgUnitId
      },
      CASE_TIMEOUT,
    );

    it(
      "idempotent: chạy lại ngay → 0/0, không ghi drift trùng",
      async () => {
        const before = await db.conversationMembershipDrift.count({
          where: { classId: w.classId },
        });
        const r = await runReconcile();
        expect(r.removeCount).toBe(0);
        expect(r.addCount).toBe(0);
        const after = await db.conversationMembershipDrift.count({
          where: { classId: w.classId },
        });
        expect(after).toBe(before);
      },
      CASE_TIMEOUT,
    );

    it(
      "drift ADD (thêm ghi danh bằng SQL trần) → CHỈ log, KHÔNG tự thêm participant",
      async () => {
        const addId = `${SLUG}${w.tag}-enr-add`;
        await db.$executeRaw`
          INSERT INTO "Enrollment" ("id","studentId","classId","courseId","status","centerId","updatedAt")
          VALUES (${addId}, ${w.students.con2}, ${w.classId}, ${w.courseId},
                  'STUDYING'::"EnrollmentStatus", ${w.centerId}, now())`;

        const r = await runReconcile();
        expect(r.addCount).toBe(1);
        expect(r.removeCount).toBe(0);

        const rows = await participantRows(convId, w.users.ph2!);
        expect(
          rows,
          "job KHÔNG được tự thêm người vào nhóm (rủi ro riêng tư — pre-mortem T5)",
        ).toHaveLength(0);

        const drifts = await db.conversationMembershipDrift.findMany({
          where: { classId: w.classId, driftType: "ADD" },
          select: { userId: true, autoEnforced: true },
        });
        expect(drifts).toHaveLength(1);
        expect(drifts[0]!.userId).toBe(w.users.ph2);
        expect(drifts[0]!.autoEnforced).toBe(false);
      },
      CASE_TIMEOUT,
    );
  });
});

if (!RUN_DB_TESTS) {
  describe("Chat · 6 bất biến tầng DB — SKIP", () => {
    it.skip("cần Postgres LOCAL: nạp .env.test (DATABASE_URL=localhost/satarobo_test) hoặc chạy job CI `chat-db-tests` (pnpm test:chat-db) — xem .claude/rules/prisma-db.md", () => {
      /* skip có chủ đích — máy này không có DB test local */
    });
  });
}
