// @vitest-environment node
/**
 * US-13 — Nhắn riêng 1-1 GV↔PH: TẦNG DB THẬT (`lib/chat/dm.ts` chạy trên Postgres).
 *
 * Vì sao file này tồn tại bên cạnh `lib/chat/dm.test.ts`: bản mock ở cạnh source chứng
 * minh được PIPELINE (thứ tự guard, mã lỗi, hình dạng dữ liệu ghi ra) nhưng KHÔNG chứng
 * minh được thứ quyết định US-13 là gì — câu SQL định nghĩa "quan hệ dạy học còn hiệu
 * lực" (`findTeachingClassIds`), UNIQUE `Conversation.dmKey`, và `can()` v2 với Actor
 * resolve từ DB (bản đang enforce trên prod, KHÁC v1 tĩnh của máy dev). Mọi mệnh đề
 * trong mệnh đề `WHERE` của câu SQL đó ở đây có đúng MỘT case đối chứng.
 *
 * ⚠️ FIXTURE RIÊNG, tiền tố `CI_DM_` — KHÔNG dùng `seedChatFixture`: file này bật/tắt
 * từng điều kiện quan hệ (huỷ ghi danh, xoá mềm học viên, đóng lớp…) nên phải sở hữu
 * trọn vẹn dữ liệu của mình; đụng vào fixture dùng chung là làm đỏ file khác.
 * Mỗi ca "deny" có một CẶP (GV, PH) RIÊNG: hội thoại 1-1 là trạng thái dính theo cặp
 * (mở rồi thì tồn tại mãi), dùng chung một cặp cho nhiều ca là để ca trước quyết định
 * kết quả ca sau.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. Chỉ xoá đúng bản ghi tiền tố
 * `CI_DM_` ở `beforeAll` + `afterAll`. `assertTestDb()` chặn chạy ngoài Postgres local.
 *
 * ⚠️ CỔNG CHẠY: chỉ chạy khi DATABASE_URL trỏ Postgres LOCAL (localhost / 127.0.0.1 /
 * satarobo_test / ci_test) — máy dev không dựng DB thì SKIP, `pnpm test:unit` vẫn xanh.
 * CI chạy qua job `chat-db-tests` (`pnpm test:chat-db`, --no-file-parallelism).
 *
 * ⚠️ Chạy TAY trên máy có DB local: dùng `pnpm test:chat-db` (đã có --no-file-parallelism)
 * chứ đừng `vitest run tests/chat` trần. Dữ liệu nghiệp vụ của file này tách hẳn khỏi
 * `seedChatFixture`, nhưng `seedOrg`/`seedRoles` (OrgUnit + RoleDef) là hạ tầng DÙNG
 * CHUNG — hai file cùng upsert một hàng trong cùng khoảnh khắc có thể va unique.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { EnrollmentStatus } from "@prisma/client";

// Hai mock BẮT BUỘC để import được `lib/chat/messages.ts` trong vitest node (đã đo ở
// permission-matrix.spec.ts, không phải phòng xa):
//   • `@/lib/auth` kéo theo `next-auth` → "Cannot find module .../next/server" khi import.
//     Không ảnh hưởng: mọi test ở đây gọi bản `*AsActor` (Actor resolve thẳng từ DB).
//   • `@/lib/chat/broadcast` có `import "server-only"` → ném ngay lúc import ngoài Next.
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
import {
  assertTestDb,
  disconnectDb,
  seedOrg,
  seedRoles,
  seedUser,
} from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import {
  OPEN_DM_RATE_MAX,
  dmKeyOf,
  findTeachingClassIds,
  openDmAsActor,
  reconcileDmConversations,
  resolveTeacherParentRelation,
} from "../../lib/chat/dm";
import { sendChatMessageAsActor } from "../../lib/chat/messages";
import { recallOwnMessageAsActor } from "../../lib/chat/moderation";
import { getMessagesPage } from "../../lib/chat/queries";

import {
  DB_URL_CHE,
  LY_DO_BO_QUA,
  RUN_DB_TESTS as RUN_DB_TESTS_CHUNG,
} from "../_helpers/db-gate";
// CỔNG CHẠY dùng chung — xem `tests/_helpers/db-gate.ts`. Từ 04/09/2026 cổng này
// ĐÒI THÊM `ALLOW_DB_RESET=1`: `pnpm test:unit` trần gọi tới đây sẽ SKIP thay vì
// TRUNCATE sạch DB đang làm việc. Chạy thật bằng `pnpm test:chat-db`.
const HAS_LOCAL_DB = RUN_DB_TESTS_CHUNG;

/** Trần thời gian mỗi case — hook seed dựng ~30 bản ghi nên rộng tay hơn 5s mặc định. */
const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 180_000;

const P = "CI_DM_";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────────────

/** Vai của user trong thế giới test — key dùng luôn làm hậu tố email/mã. */
type UserKey =
  | "gv" // GV chính của lopHoatDong (teacherId)
  | "tg" // trợ giảng lopHoatDong (assistantId) — cũng là "GV của lớp"
  | "gvKhac" // GV lớp khác, không dạy con của PH nào bên dưới (trừ phNgoai)
  | "ql" // QLCS cơ sở — không có cửa 1-1 ở P0
  | "sale" // Sale — P0 không có action chat nào
  | "phOk"
  | "phTam" // ghi danh PAUSED (bảo lưu)
  | "phHuy" // ghi danh CANCELLED
  | "phGhiDanhXoa" // ghi danh xoá mềm
  | "phHvXoa" // học viên xoá mềm
  | "phLopXong" // con học lớp đã COMPLETED
  | "phLopXoa" // con học lớp đã xoá mềm
  | "phNgoai" // con học lớp của gvKhac
  | "phDua" // dành riêng cho ca đua (AC5)
  | "phAc2" // dành riêng cho ca mở lại (AC2)
  | "phAc3" // dành riêng cho ca hết quan hệ (AC3)
  | "phGui" // dành riêng cho ca gửi tin trong 1-1
  | "phRate"; // dành riêng cho ca rate limit — KHÔNG có quan hệ dạy học với ai

type World = {
  centerId: string;
  courseId: string;
  classes: {
    hoatDong: string;
    daXong: string;
    daXoa: string;
    cuaGvKhac: string;
  };
  users: Record<UserKey, string>;
  students: Record<string, string>;
  enrollments: Record<string, string>;
};

let w: World;

const emailOf = (key: string) => `${P.toLowerCase()}${key}@ci-dm.test.local`;

async function upsertClass(input: {
  code: string;
  courseId: string;
  centerId: string;
  status: "ACTIVE" | "COMPLETED";
  teacherId: string;
  assistantId?: string | null;
  deleted?: boolean;
}): Promise<string> {
  const data = {
    name: `${P}${input.code}`,
    courseId: input.courseId,
    centerId: input.centerId,
    status: input.status,
    teacherId: input.teacherId,
    assistantId: input.assistantId ?? null,
    deletedAt: input.deleted ? new Date() : null,
  };
  const cls = await db.class.upsert({
    where: { classCode: `${P}${input.code}` },
    update: data,
    create: { classCode: `${P}${input.code}`, ...data },
    select: { id: true },
  });
  return cls.id;
}

async function upsertStudent(
  key: string,
  parentUserId: string,
  centerId: string,
  deleted = false,
): Promise<string> {
  const s = await db.student.upsert({
    where: { studentCode: `${P}HV_${key}` },
    update: { parentUserId, centerId, deletedAt: deleted ? new Date() : null },
    create: {
      studentCode: `${P}HV_${key}`,
      name: `${P}con của ${key}`,
      parentUserId,
      centerId,
      parentName: `${P}PH ${key}`,
      parentPhone: "0900000000",
      deletedAt: deleted ? new Date() : null,
    },
    select: { id: true },
  });
  return s.id;
}

/** Enrollment ∈ SCOPED_MODELS — BẮT BUỘC set centerId khi create. */
async function ensureEnrollment(input: {
  key: string;
  studentId: string;
  classId: string;
  courseId: string;
  centerId: string;
  status: EnrollmentStatus;
  deleted?: boolean;
}): Promise<string> {
  const existing = await db.enrollment.findFirst({
    where: { studentId: input.studentId, classId: input.classId },
    select: { id: true },
  });
  const data = {
    status: input.status,
    centerId: input.centerId,
    deletedAt: input.deleted ? new Date() : null,
  };
  if (existing) {
    await db.enrollment.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await db.enrollment.create({
    data: {
      studentId: input.studentId,
      classId: input.classId,
      courseId: input.courseId,
      ...data,
    },
    select: { id: true },
  });
  return created.id;
}

async function grantOrgRole(userId: string, orgCode: string, roleCode: string, by: string) {
  const org = await db.orgUnit.findUniqueOrThrow({
    where: { code: orgCode },
    select: { id: true },
  });
  const role = await db.roleDef.findUniqueOrThrow({
    where: { code: roleCode },
    select: { id: true },
  });
  await db.userOrgRole.upsert({
    where: { userId_orgUnitId_roleId: { userId, orgUnitId: org.id, roleId: role.id } },
    update: { status: "ACTIVE", effectiveTo: null },
    create: { userId, orgUnitId: org.id, roleId: role.id, grantedById: by, status: "ACTIVE" },
  });
}

/**
 * Xoá MỌI hội thoại 1-1 dính user của fixture (kể cả rác lần chạy trước). Idempotent.
 *
 * Lọc theo CẢ `dmKey` chứ không chỉ theo participant: một hội thoại 1-1 hỏng (ghi được
 * hàng trùng khoá vì thiếu UNIQUE, hoặc tx tạo đứt giữa chừng) có thể KHÔNG có bản ghi
 * participant nào — dọn theo participant sẽ để nó nằm lại và làm ca "đếm hội thoại" của
 * lần chạy sau đỏ oan. Đã dính đúng bẫy này khi thử gỡ UNIQUE index (09/08).
 */
async function cleanupDms(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const known = new Set(userIds);
  const convs = await db.conversation.findMany({
    where: { type: "DM_TEACHER_PARENT" },
    select: { id: true, dmKey: true, participants: { select: { userId: true } } },
  });
  const ids = convs
    .filter(
      (c) =>
        c.participants.some((p) => known.has(p.userId)) ||
        (c.dmKey ?? "").split(":").some((part) => known.has(part)),
    )
    .map((c) => c.id);
  if (ids.length === 0) return;
  await db.message.deleteMany({ where: { conversationId: { in: ids } } });
  await db.conversationParticipant.deleteMany({ where: { conversationId: { in: ids } } });
  await db.conversation.deleteMany({ where: { id: { in: ids } } });
}

async function buildWorld(): Promise<World> {
  assertTestDb();
  // OrgUnit + RoleDef v2: nguồn quyền THẬT cho resolveActorUncached (idempotent).
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();

  const center = await db.center.upsert({
    where: { code: `${P}CS` },
    update: { isActive: true },
    create: {
      code: `${P}CS`,
      name: `${P}Cơ sở`,
      slug: "ci-dm-center",
      address: `${P}địa chỉ`,
      city: "Đà Nẵng",
    },
    select: { id: true },
  });
  const course = await db.course.upsert({
    where: { slug: "ci-dm-course" },
    update: {},
    create: { name: `${P}Khoá`, slug: "ci-dm-course", isTeachable: true },
    select: { id: true },
  });

  const mk = async (key: UserKey, role: "TEACHER" | "PARENT" | "CENTER_MANAGER" | "SALES_CSM") => {
    const u = await seedUser({
      email: emailOf(key),
      name: `${P}${key}`,
      role,
      centerId: role === "PARENT" ? null : center.id,
    });
    return u.id;
  };

  const users = {
    gv: await mk("gv", "TEACHER"),
    tg: await mk("tg", "TEACHER"),
    gvKhac: await mk("gvKhac", "TEACHER"),
    ql: await mk("ql", "CENTER_MANAGER"),
    sale: await mk("sale", "SALES_CSM"),
    phOk: await mk("phOk", "PARENT"),
    phTam: await mk("phTam", "PARENT"),
    phHuy: await mk("phHuy", "PARENT"),
    phGhiDanhXoa: await mk("phGhiDanhXoa", "PARENT"),
    phHvXoa: await mk("phHvXoa", "PARENT"),
    phLopXong: await mk("phLopXong", "PARENT"),
    phLopXoa: await mk("phLopXoa", "PARENT"),
    phNgoai: await mk("phNgoai", "PARENT"),
    phDua: await mk("phDua", "PARENT"),
    phAc2: await mk("phAc2", "PARENT"),
    phAc3: await mk("phAc3", "PARENT"),
    phGui: await mk("phGui", "PARENT"),
    phRate: await mk("phRate", "PARENT"),
  } satisfies Record<UserKey, string>;

  // Quyền v2: GV/trợ giảng/QLCS/Sale gắn ở CS1; PH gắn ở CS1 (PARENT scope OWN).
  const by = users.gv;
  await grantOrgRole(users.gv, "CS1", "TEACHER", by);
  await grantOrgRole(users.tg, "CS1", "ASSISTANT_TEACHER", by);
  await grantOrgRole(users.gvKhac, "CS1", "TEACHER", by);
  await grantOrgRole(users.ql, "CS1", "CENTER_MANAGER", by);
  await grantOrgRole(users.sale, "CS1", "CENTER_SALES_CSM", by);
  for (const key of [
    "phOk", "phTam", "phHuy", "phGhiDanhXoa", "phHvXoa", "phLopXong",
    "phLopXoa", "phNgoai", "phDua", "phAc2", "phAc3", "phGui", "phRate",
  ] as const) {
    await grantOrgRole(users[key], "CS1", "PARENT", by);
  }

  const classes = {
    hoatDong: await upsertClass({
      code: "LOP_HOATDONG", courseId: course.id, centerId: center.id,
      status: "ACTIVE", teacherId: users.gv, assistantId: users.tg,
    }),
    daXong: await upsertClass({
      code: "LOP_DAXONG", courseId: course.id, centerId: center.id,
      status: "COMPLETED", teacherId: users.gv,
    }),
    daXoa: await upsertClass({
      code: "LOP_DAXOA", courseId: course.id, centerId: center.id,
      status: "ACTIVE", teacherId: users.gv, deleted: true,
    }),
    cuaGvKhac: await upsertClass({
      code: "LOP_GVKHAC", courseId: course.id, centerId: center.id,
      status: "ACTIVE", teacherId: users.gvKhac,
    }),
  };

  const students: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const add = async (
    key: UserKey,
    classId: string,
    status: EnrollmentStatus,
    opts?: { studentDeleted?: boolean; enrollmentDeleted?: boolean },
  ) => {
    students[key] = await upsertStudent(key, users[key], center.id, opts?.studentDeleted);
    enrollments[key] = await ensureEnrollment({
      key,
      studentId: students[key] as string,
      classId,
      courseId: course.id,
      centerId: center.id,
      status,
      deleted: opts?.enrollmentDeleted,
    });
  };

  await add("phOk", classes.hoatDong, "ACTIVE");
  await add("phTam", classes.hoatDong, "PAUSED");
  await add("phHuy", classes.hoatDong, "CANCELLED");
  await add("phGhiDanhXoa", classes.hoatDong, "ACTIVE", { enrollmentDeleted: true });
  await add("phHvXoa", classes.hoatDong, "ACTIVE", { studentDeleted: true });
  await add("phLopXong", classes.daXong, "ACTIVE");
  await add("phLopXoa", classes.daXoa, "ACTIVE");
  await add("phNgoai", classes.cuaGvKhac, "ACTIVE");
  await add("phDua", classes.hoatDong, "ACTIVE");
  await add("phAc2", classes.hoatDong, "ACTIVE");
  await add("phAc3", classes.hoatDong, "ACTIVE");
  await add("phGui", classes.hoatDong, "ACTIVE");

  return {
    centerId: center.id,
    courseId: course.id,
    classes,
    users,
    students,
    enrollments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper cấp test
// ─────────────────────────────────────────────────────────────────────────────

/** Mở 1-1 với Actor resolve TỪ DB ⇒ đi đúng `can()` v2 (bản enforce trên prod). */
async function openDm(fromUserId: string, peerUserId: string) {
  const actor = await resolveActorUncached(fromUserId);
  return openDmAsActor(actor, `ci-dm:${fromUserId}`, { peerUserId });
}

function convIdOf(res: Awaited<ReturnType<typeof openDm>>): string {
  if (!res.ok) throw new Error(`openDm thất bại: ${res.error.code} ${res.error.message}`);
  return res.data.conversationId;
}

async function countDm(a: string, b: string): Promise<number> {
  return db.conversation.count({ where: { dmKey: dmKeyOf(a, b) } });
}

async function sendAs(userId: string, conversationId: string, body: string) {
  const actor = await resolveActorUncached(userId);
  return sendChatMessageAsActor(actor, `ci-dm:${userId}`, {
    conversationId,
    body,
    clientMsgId: crypto.randomUUID(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

if (!HAS_LOCAL_DB) {
  describe("US-13 · 1-1 GV↔PH (DB)", () => {
    it.skip(`SKIP — ${LY_DO_BO_QUA} (DB=${DB_URL_CHE})`, () => {});
  });
}

describe.skipIf(!HAS_LOCAL_DB)("US-13 · 1-1 GV↔PH — tầng DB thật", () => {
  beforeAll(async () => {
    w = await buildWorld();
    await cleanupDms(Object.values(w.users));
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await cleanupDms(Object.values(w.users));
    await disconnectDb();
  }, HOOK_TIMEOUT);

  // ───────────────────────────────────────────────────────────────────────────
  // 1) "Quan hệ dạy học còn hiệu lực" — mỗi mệnh đề WHERE một ca đối chứng.
  //
  // Người bấm ở các ca này là PHỤ HUYNH có chủ đích: PARENT giữ `chat:send` scope OWN
  // nên LUÔN qua cổng vai (`target.createdById = actor.userId`) ⇒ kết quả deny/allow
  // phản ánh ĐÚNG câu SQL quan hệ, không lẫn với việc cổng vai chặn trước.
  // ───────────────────────────────────────────────────────────────────────────
  describe("quan hệ dạy học quyết định cửa mở", () => {
    it(
      "PH có con đang học lớp GV dạy → tạo 1-1: type DM, centerId NULL, dmKey đối xứng, 2 thành viên MANUAL",
      async () => {
        const res = await openDm(w.users.phOk, w.users.gv);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.created).toBe(true);

        const conv = await db.conversation.findUniqueOrThrow({
          where: { id: res.data.conversationId },
          select: { type: true, centerId: true, orgUnitId: true, dmKey: true, status: true, subjectType: true },
        });
        expect(conv.type).toBe("DM_TEACHER_PARENT");
        expect(conv.status).toBe("ACTIVE");
        expect(conv.subjectType).toBe("NONE");
        // centerId NULL là CƠ CHẾ deny QLCS (scope CENTER đòi target.centerId) — không
        // phải chi tiết trang trí. Gán centerId "cho tiện query admin" = mở cửa QLCS.
        expect(conv.centerId).toBeNull();
        expect(conv.orgUnitId).toBeNull();
        // Khoá phải là bản ĐỐI XỨNG: sinh từ (PH,GV) hay (GV,PH) đều một chuỗi.
        expect(conv.dmKey).toBe(dmKeyOf(w.users.gv, w.users.phOk));
        expect(conv.dmKey).toBe(dmKeyOf(w.users.phOk, w.users.gv));

        const parts = await db.conversationParticipant.findMany({
          where: { conversationId: res.data.conversationId },
          select: { userId: true, source: true, derivedFrom: true, leftAt: true },
        });
        expect(parts.map((p) => p.userId).sort()).toEqual([w.users.gv, w.users.phOk].sort());
        // MANUAL/null: participant 1-1 KHÔNG do sync dẫn xuất ⇒ job đối soát (bỏ qua
        // MANUAL — BR-15) không bao giờ "dọn" hai người này ra khỏi hội thoại.
        for (const p of parts) {
          expect(p.source).toBe("MANUAL");
          expect(p.derivedFrom).toBeNull();
          expect(p.leftAt).toBeNull();
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "trợ giảng (assistantId) cũng là GV của lớp → PH mở được với trợ giảng",
      async () => {
        const res = await openDm(w.users.phOk, w.users.tg);
        expect(res.ok).toBe(true);
        expect(await countDm(w.users.phOk, w.users.tg)).toBe(1);
      },
      CASE_TIMEOUT,
    );

    it(
      "ghi danh PAUSED (bảo lưu) vẫn thuộc lớp → mở được (đúng bộ ENROLLMENT_ACTIVE_STATUSES)",
      async () => {
        const res = await openDm(w.users.phTam, w.users.gv);
        expect(res.ok).toBe(true);
        expect(await countDm(w.users.phTam, w.users.gv)).toBe(1);
      },
      CASE_TIMEOUT,
    );

    it(
      "ghi danh CANCELLED → PERMISSION_DENIED, KHÔNG sinh hội thoại",
      async () => {
        const res = await openDm(w.users.phHuy, w.users.gv);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
        expect(await countDm(w.users.phHuy, w.users.gv)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "ghi danh đã xoá mềm → deny (raw SQL không qua extension soft-delete, phải tự lọc)",
      async () => {
        const res = await openDm(w.users.phGhiDanhXoa, w.users.gv);
        expect(res.ok).toBe(false);
        expect(await countDm(w.users.phGhiDanhXoa, w.users.gv)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "học viên đã xoá mềm → deny",
      async () => {
        const res = await openDm(w.users.phHvXoa, w.users.gv);
        expect(res.ok).toBe(false);
        expect(await countDm(w.users.phHvXoa, w.users.gv)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "lớp đã kết thúc (COMPLETED) → deny (BR-01: lớp hết thì không còn cửa nhắn riêng)",
      async () => {
        const res = await openDm(w.users.phLopXong, w.users.gv);
        expect(res.ok).toBe(false);
        expect(await countDm(w.users.phLopXong, w.users.gv)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "lớp đã xoá mềm → deny",
      async () => {
        const res = await openDm(w.users.phLopXoa, w.users.gv);
        expect(res.ok).toBe(false);
        expect(await countDm(w.users.phLopXoa, w.users.gv)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "PH có con học lớp GV KHÁC → deny với GV không dạy con mình",
      async () => {
        const res = await openDm(w.users.phNgoai, w.users.gv);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
        expect(await countDm(w.users.phNgoai, w.users.gv)).toBe(0);
        // …nhưng ĐÚNG GV lớp con mình thì mở được — nếu không, test trên chỉ đang chứng
        // minh "chẳng ai mở được", tức xanh vô nghĩa.
        const ok = await openDm(w.users.phNgoai, w.users.gvKhac);
        expect(ok.ok).toBe(true);
      },
      CASE_TIMEOUT,
    );

    it(
      "chiều GV bấm: mở được với PH lớp mình (scope ASSIGNED), deny với PH lạ",
      async () => {
        const ok = await openDm(w.users.gv, w.users.phOk);
        expect(ok.ok).toBe(true);
        // Cùng một hội thoại với lúc PH bấm — chiều bấm không đẻ hội thoại thứ hai.
        expect(await countDm(w.users.gv, w.users.phOk)).toBe(1);

        const deny = await openDm(w.users.gv, w.users.phNgoai);
        expect(deny.ok).toBe(false);
        if (!deny.ok) expect(deny.error.code).toBe("PERMISSION_DENIED");
        expect(await countDm(w.users.gv, w.users.phNgoai)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "hàm quan hệ tự nó: đúng chiều GV/PH và trả lớp làm chứng (target.classId của can())",
      async () => {
        const rel = await resolveTeacherParentRelation(w.users.phOk, w.users.gv);
        expect(rel).not.toBeNull();
        expect(rel?.teacherUserId).toBe(w.users.gv);
        expect(rel?.parentUserId).toBe(w.users.phOk);
        expect(rel?.classIds).toContain(w.classes.hoatDong);
        // Không tự nhắn chính mình, và không có quan hệ thì null.
        expect(await resolveTeacherParentRelation(w.users.gv, w.users.gv)).toBeNull();
        expect(await findTeachingClassIds(w.users.gv, w.users.phNgoai)).toEqual([]);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) AC2 — mở lại hội thoại cũ, KHÔNG tạo cái thứ hai, lịch sử nguyên vẹn.
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC2 · mở lại hội thoại đã lưu trữ", () => {
    it(
      "ARCHIVED → mở lại ĐÚNG hội thoại đó: id cũ, archivedAt null, tin cũ còn nguyên, vẫn chỉ 1 hội thoại",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc2, w.users.gv));
        await sendAs(w.users.phAc2, convId, "tin trước khi lưu trữ 1");
        await sendAs(w.users.phAc2, convId, "tin trước khi lưu trữ 2");
        const before = await db.message.count({ where: { conversationId: convId } });
        expect(before).toBeGreaterThanOrEqual(2);
        const partsBefore = await db.conversationParticipant.findMany({
          where: { conversationId: convId },
          select: { id: true, userId: true, joinedAt: true },
          orderBy: { userId: "asc" },
        });

        await db.conversation.update({
          where: { id: convId },
          data: { status: "ARCHIVED", archivedAt: new Date() },
        });

        const again = await openDm(w.users.gv, w.users.phAc2);
        expect(again.ok).toBe(true);
        if (!again.ok) return;
        expect(again.data.conversationId).toBe(convId); // KHÔNG hội thoại thứ hai
        expect(again.data.created).toBe(false);
        expect(again.data.reopened).toBe(true);
        expect(again.data.status).toBe("ACTIVE");

        const conv = await db.conversation.findUniqueOrThrow({
          where: { id: convId },
          select: { status: true, archivedAt: true },
        });
        expect(conv.status).toBe("ACTIVE");
        expect(conv.archivedAt).toBeNull();
        // Lịch sử: không xoá tin, không tạo participant mới, joinedAt giữ nguyên.
        expect(await db.message.count({ where: { conversationId: convId } })).toBe(before);
        const partsAfter = await db.conversationParticipant.findMany({
          where: { conversationId: convId },
          select: { id: true, userId: true, joinedAt: true },
          orderBy: { userId: "asc" },
        });
        expect(partsAfter).toEqual(partsBefore);
        expect(await countDm(w.users.gv, w.users.phAc2)).toBe(1);
      },
      CASE_TIMEOUT,
    );

    it(
      "thành viên đã rời (leftAt) được đưa lại vào CHÍNH bản ghi cũ, không đẻ bản ghi thứ hai",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc2, w.users.gv));
        const before = await db.conversationParticipant.findFirstOrThrow({
          where: { conversationId: convId, userId: w.users.gv },
          select: { id: true, joinedAt: true },
        });
        await db.conversationParticipant.update({
          where: { id: before.id },
          data: { leftAt: new Date() },
        });

        const res = await openDm(w.users.phAc2, w.users.gv);
        expect(res.ok).toBe(true);

        const rows = await db.conversationParticipant.findMany({
          where: { conversationId: convId, userId: w.users.gv },
          select: { id: true, leftAt: true, joinedAt: true },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(before.id);
        expect(rows[0]?.leftAt).toBeNull();
        expect(rows[0]?.joinedAt).toEqual(before.joinedAt);
      },
      CASE_TIMEOUT,
    );

    it(
      "LOCKED → trả hội thoại để đọc nhưng KHÔNG tự mở khoá (quyết định của Admin thắng)",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc2, w.users.gv));
        await db.conversation.update({ where: { id: convId }, data: { status: "LOCKED" } });
        try {
          const res = await openDm(w.users.phAc2, w.users.gv);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          expect(res.data.conversationId).toBe(convId);
          expect(res.data.status).toBe("LOCKED");
          expect(res.data.reopened).toBe(false);
          const conv = await db.conversation.findUniqueOrThrow({
            where: { id: convId },
            select: { status: true },
          });
          expect(conv.status).toBe("LOCKED");
        } finally {
          await db.conversation.update({
            where: { id: convId },
            data: { status: "ACTIVE", archivedAt: null },
          });
        }
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) AC3 — hết quan hệ dạy học: hội thoại cũ CHỈ ĐỌC (không xoá, không câm lặng).
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC3 · hết quan hệ dạy học", () => {
    async function ketThucQuanHe(): Promise<void> {
      await db.enrollment.update({
        where: { id: w.enrollments.phAc3 as string },
        data: { status: "CANCELLED" },
      });
    }
    async function noiLaiQuanHe(): Promise<void> {
      await db.enrollment.update({
        where: { id: w.enrollments.phAc3 as string },
        data: { status: "ACTIVE" },
      });
    }

    it(
      "bấm mở khi quan hệ đã hết → deny NGAY + hội thoại cũ chuyển ARCHIVED; đọc vẫn được, GỬI thì không",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc3, w.users.gv));
        await sendAs(w.users.phAc3, convId, "tin lúc còn học");
        const auditTruoc = await db.auditLog.count({
          where: { module: "chat", entityType: "Conversation", entityId: convId },
        });

        await ketThucQuanHe();
        try {
          const res = await openDm(w.users.phAc3, w.users.gv);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");

          const conv = await db.conversation.findUniqueOrThrow({
            where: { id: convId },
            select: { status: true, archivedAt: true },
          });
          expect(conv.status).toBe("ARCHIVED");
          expect(conv.archivedAt).not.toBeNull();

          // Lối TỨC THỜI phải để lại ĐÚNG hiện trạng như job đêm — trước 09/08 nó chỉ
          // đổi trạng thái rồi ném lỗi: hội thoại "tự dưng câm" và không ai tra được ai
          // đã đóng nó lúc nào.
          const sys = await db.message.findMany({
            where: { conversationId: convId, kind: "SYSTEM" },
            select: { body: true, senderId: true },
          });
          expect(sys).toHaveLength(1);
          expect(sys[0]?.senderId).toBeNull();
          expect(sys[0]?.body).toMatch(/kết thúc/i);

          // …và một dòng AuditLog, dù `runAction` KHÔNG chạy tới bước audit (handler ném
          // ActionError). Ghi tại chỗ là cách duy nhất.
          const auditRows = await db.auditLog.findMany({
            where: { module: "chat", entityType: "Conversation", entityId: convId },
            orderBy: { createdAt: "desc" },
            select: { action: true, actorId: true, newValues: true },
          });
          expect(auditRows.length).toBe(auditTruoc + 1);
          expect(auditRows[0]?.actorId).toBe(w.users.phAc3);
          expect(auditRows[0]?.newValues).toMatchObject({
            status: "ARCHIVED",
            cause: "TEACHING_RELATION_ENDED",
          });

          const soTinSauArchive = await db.message.count({ where: { conversationId: convId } });

          // CHỈ ĐỌC: hai người trong cuộc vẫn đọc được lịch sử…
          for (const uid of [w.users.phAc3, w.users.gv]) {
            const page = await getMessagesPage(convId, uid);
            expect(page.messages.length).toBeGreaterThan(0);
          }
          // …nhưng không gửi thêm được, và mã lỗi phải PHÂN BIỆT được với "hết là thành viên".
          const gui = await sendAs(w.users.phAc3, convId, "còn gửi được không?");
          expect(gui.ok).toBe(false);
          if (!gui.ok) expect(gui.error.code).toBe("CONVERSATION_ARCHIVED");
          expect(await db.message.count({ where: { conversationId: convId } })).toBe(
            soTinSauArchive,
          );
          // Thành viên KHÔNG bị gỡ (BR-03/BR-04: lịch sử vẫn thuộc về họ).
          expect(
            await db.conversationParticipant.count({
              where: { conversationId: convId, leftAt: null },
            }),
          ).toBe(2);
        } finally {
          await noiLaiQuanHe();
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "job đối soát: DM hết quan hệ → ARCHIVED + tin SYSTEM báo lý do + lastMessageAt mới; chạy lại KHÔNG lặp",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc3, w.users.gv));
        await db.conversation.update({
          where: { id: convId },
          data: { status: "ACTIVE", archivedAt: null },
        });
        // Mốc SYSTEM tính TƯƠNG ĐỐI: hội thoại này dùng chung cho cả nhóm ca AC3, và ca
        // "bấm mở khi quan hệ đã hết" ở trên cũng ghi một tin SYSTEM (cùng lý do, đường
        // tức thời). Đếm tuyệt đối ở đây là buộc thứ tự chạy — thứ không nên buộc.
        const sysTruoc = await db.message.count({
          where: { conversationId: convId, kind: "SYSTEM" },
        });
        await ketThucQuanHe();
        try {
          const summary = await reconcileDmConversations({ onlyConversationIds: [convId] });
          expect(summary.dmChecked).toBe(1);
          expect(summary.dmArchived).toBe(1);
          expect(summary.dmSkipped).toBe(0);

          const conv = await db.conversation.findUniqueOrThrow({
            where: { id: convId },
            select: { status: true, lastMessageAt: true },
          });
          expect(conv.status).toBe("ARCHIVED");
          expect(conv.lastMessageAt).not.toBeNull();
          const sys = await db.message.findMany({
            where: { conversationId: convId, kind: "SYSTEM" },
            orderBy: { createdAt: "desc" },
            select: { body: true, senderId: true },
          });
          expect(sys).toHaveLength(sysTruoc + 1);
          expect(sys[0]?.senderId).toBeNull();
          expect(sys[0]?.body).toMatch(/kết thúc/i);

          // Idempotent: lần chạy thứ hai không archive lại, không thêm tin SYSTEM thứ hai.
          const lai = await reconcileDmConversations({ onlyConversationIds: [convId] });
          expect(lai.dmChecked).toBe(0); // đã ARCHIVED → không còn nằm trong diện quét
          expect(lai.dmArchived).toBe(0);
          expect(
            await db.message.count({ where: { conversationId: convId, kind: "SYSTEM" } }),
          ).toBe(sysTruoc + 1);
        } finally {
          await noiLaiQuanHe();
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "job đối soát: quan hệ CÒN → không đụng vào; hội thoại LOCKED → không bị nuốt",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc3, w.users.gv));
        await db.conversation.update({
          where: { id: convId },
          data: { status: "ACTIVE", archivedAt: null },
        });
        // Quan hệ còn hiệu lực → job không được archive (nếu không, mọi 1-1 tự chết sau
        // một đêm).
        const con = await reconcileDmConversations({ onlyConversationIds: [convId] });
        expect(con.dmChecked).toBe(1);
        expect(con.dmArchived).toBe(0);
        expect(
          (await db.conversation.findUniqueOrThrow({ where: { id: convId }, select: { status: true } }))
            .status,
        ).toBe("ACTIVE");

        // LOCKED: khoá của Admin thắng — job không hạ trạng thái xuống ARCHIVED.
        await db.conversation.update({ where: { id: convId }, data: { status: "LOCKED" } });
        await db.enrollment.update({
          where: { id: w.enrollments.phAc3 as string },
          data: { status: "CANCELLED" },
        });
        try {
          const khoa = await reconcileDmConversations({ onlyConversationIds: [convId] });
          expect(khoa.dmArchived).toBe(0);
          expect(
            (await db.conversation.findUniqueOrThrow({ where: { id: convId }, select: { status: true } }))
              .status,
          ).toBe("LOCKED");
        } finally {
          await db.enrollment.update({
            where: { id: w.enrollments.phAc3 as string },
            data: { status: "ACTIVE" },
          });
          await db.conversation.update({
            where: { id: convId },
            data: { status: "ACTIVE", archivedAt: null },
          });
        }
      },
      CASE_TIMEOUT,
    );

    it(
      "job đối soát: DM có số thành viên ≠ 2 (dữ liệu lạ) → ĐẾM RIÊNG, không tự sửa",
      async () => {
        const convId = convIdOf(await openDm(w.users.phAc3, w.users.gv));
        await db.conversation.update({
          where: { id: convId },
          data: { status: "ACTIVE", archivedAt: null },
        });
        // Nhét người thứ ba vào 1-1 (chỉ có thể do lỗi dữ liệu) — job phải BỎ QUA,
        // vì "hết quan hệ" của một cặp không định nghĩa được trên ba người.
        await db.conversationParticipant.create({
          data: { conversationId: convId, userId: w.users.ql, role: "MEMBER", source: "MANUAL" },
        });
        await db.enrollment.update({
          where: { id: w.enrollments.phAc3 as string },
          data: { status: "CANCELLED" },
        });
        try {
          const summary = await reconcileDmConversations({ onlyConversationIds: [convId] });
          expect(summary.dmSkipped).toBe(1);
          expect(summary.dmChecked).toBe(0);
          expect(summary.dmArchived).toBe(0);
          expect(
            (await db.conversation.findUniqueOrThrow({ where: { id: convId }, select: { status: true } }))
              .status,
          ).toBe("ACTIVE");
        } finally {
          await db.conversationParticipant.deleteMany({
            where: { conversationId: convId, userId: w.users.ql },
          });
          await db.enrollment.update({
            where: { id: w.enrollments.phAc3 as string },
            data: { status: "ACTIVE" },
          });
        }
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) Người ngoài cuộc — QLCS / Sale / PH khác.
  // ───────────────────────────────────────────────────────────────────────────
  describe("người ngoài cuộc không mở, không đọc được 1-1", () => {
    it(
      "QLCS mở 1-1 với PH cơ sở mình → PERMISSION_DENIED (scope CENTER trượt trên centerId=null)",
      async () => {
        const res = await openDm(w.users.ql, w.users.phOk);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
        expect(await countDm(w.users.ql, w.users.phOk)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "Sale mở 1-1 → PERMISSION_DENIED (P0 Sale không có action chat nào)",
      async () => {
        const res = await openDm(w.users.sale, w.users.phOk);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
        expect(await countDm(w.users.sale, w.users.phOk)).toBe(0);
      },
      CASE_TIMEOUT,
    );

    it(
      "đọc tin của 1-1 người khác: QLCS / Sale / PH khác / GV khác → NOT_PARTICIPANT; hai người trong cuộc thì đọc được",
      async () => {
        const convId = convIdOf(await openDm(w.users.phOk, w.users.gv));
        await sendAs(w.users.phOk, convId, "tin riêng của phOk");
        for (const outsider of [w.users.ql, w.users.sale, w.users.phNgoai, w.users.gvKhac]) {
          await expect(getMessagesPage(convId, outsider)).rejects.toMatchObject({
            code: "NOT_PARTICIPANT",
          });
        }
        for (const insider of [w.users.phOk, w.users.gv]) {
          await expect(getMessagesPage(convId, insider)).resolves.toBeTruthy();
        }
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) AC5 — hai người bấm cùng lúc.
  // ───────────────────────────────────────────────────────────────────────────
  describe("AC5 · đua tạo hội thoại", () => {
    it(
      "GV và PH bấm CÙNG LÚC (hai chiều ngược nhau) → cả hai thành công, CHỈ MỘT hội thoại",
      async () => {
        expect(await countDm(w.users.gv, w.users.phDua)).toBe(0);
        const [a, b] = await Promise.all([
          openDm(w.users.gv, w.users.phDua),
          openDm(w.users.phDua, w.users.gv),
        ]);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(a.data.conversationId).toBe(b.data.conversationId);
        expect(await countDm(w.users.gv, w.users.phDua)).toBe(1);
        // Và không có bản ghi participant nhân đôi do hai đường cùng ghi.
        const parts = await db.conversationParticipant.findMany({
          where: { conversationId: a.data.conversationId },
          select: { userId: true },
        });
        expect(parts).toHaveLength(2);
      },
      CASE_TIMEOUT,
    );

    it(
      "chốt chặn thật của AC5 là UNIQUE dmKey ở DB: ghi hội thoại thứ hai cùng khoá → P2002",
      async () => {
        // Ca ở trên chạy hai lời gọi song song, nhưng KHÔNG bảo đảm chúng chồng lấn thật
        // (người thứ hai thường đọc thấy bản người thứ nhất vừa ghi rồi đi nhánh "dùng
        // lại"). Vì vậy phải pin thẳng thứ làm cho `findOrCreate` an toàn: ràng buộc
        // UNIQUE. Mất ràng buộc này thì hai lần bấm trùng khắc = hai hội thoại, và cả
        // hai bên mỗi người nói vào một hộp khác nhau.
        const key = dmKeyOf(w.users.gv, w.users.phDua);
        convIdOf(await openDm(w.users.phDua, w.users.gv));
        await expect(
          db.conversation.create({
            data: {
              type: "DM_TEACHER_PARENT",
              subjectType: "NONE",
              dmKey: key,
              centerId: null,
              status: "ACTIVE",
              title: "bản trùng khoá",
            },
          }),
        ).rejects.toMatchObject({ code: "P2002" });
        expect(await countDm(w.users.gv, w.users.phDua)).toBe(1);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) Mở xong thì NHẮN ĐƯỢC — nếu không, US-13 chỉ đẻ ra một cái hộp câm.
  // ───────────────────────────────────────────────────────────────────────────
  describe("mở xong là nhắn được", () => {
    it(
      "PH gửi được tin trong 1-1 vừa mở (scope OWN khớp createdById)",
      async () => {
        const convId = convIdOf(await openDm(w.users.phGui, w.users.gv));
        const tuPh = await sendAs(w.users.phGui, convId, "chào cô, cho hỏi về bài tập");
        expect(tuPh.ok).toBe(true);
        expect(await db.message.count({ where: { conversationId: convId, kind: "CHAT" } })).toBe(1);
      },
      CASE_TIMEOUT,
    );

    /**
     * ⭐ CA GIỮ CỬA CỦA CẢ US-13 (bug đo 09/08, vá cùng ngày bằng `dmWitnessClassId`).
     *
     * 1-1 có `subjectType = NONE` ⇒ nếu `sendTargetOf` (lib/chat/messages.ts) suy
     * `classId` từ `subjectId` thì `classId = null`; TEACHER/ASSISTANT_TEACHER chỉ có
     * `chat:send` **scope ASSIGNED** và `scopeMatches` đòi `target.classId ∈
     * assignedClassIds` ⇒ GV nhận `PERMISSION_DENIED` trong khi PH gửi bình thường
     * (scope OWN) — hội thoại một chiều, tức US-13 chỉ đẻ ra một cái hộp câm.
     *
     * KIỂM NGƯỢC: đổi `sendTargetOf` về `... : null` là ca này ĐỎ ngay
     * (PERMISSION_DENIED). `runAction` gọi thẳng `can()` v2 nên nó đỏ ở MỌI môi trường,
     * không riêng prod.
     */
    it(
      "GV gửi được tin trong 1-1 vừa mở (lớp làm chứng khớp scope ASSIGNED)",
      async () => {
        const convId = convIdOf(await openDm(w.users.gv, w.users.phGui));
        const tuGv = await sendAs(w.users.gv, convId, "chào anh/chị");
        expect(tuGv.ok).toBe(true);
        if (!tuGv.ok) return;
        expect(
          await db.message.count({
            where: { conversationId: convId, kind: "CHAT", senderId: w.users.gv },
          }),
        ).toBe(1);
      },
      CASE_TIMEOUT,
    );

    it(
      "TRỢ GIẢNG cũng gửi được (assistantId cũng là 'lớp mình dạy')",
      async () => {
        const convId = convIdOf(await openDm(w.users.tg, w.users.phGui));
        const res = await sendAs(w.users.tg, convId, "trợ giảng nhắn riêng");
        expect(res.ok).toBe(true);
      },
      CASE_TIMEOUT,
    );

    it(
      "GV thu hồi được CHÍNH tin mình vừa gửi trong 1-1 (cùng cổng vai chat:send)",
      async () => {
        const convId = convIdOf(await openDm(w.users.gv, w.users.phGui));
        const gui = await sendAs(w.users.gv, convId, "tin sẽ thu hồi");
        expect(gui.ok).toBe(true);
        if (!gui.ok) return;
        const actor = await resolveActorUncached(w.users.gv);
        const thuHoi = await recallOwnMessageAsActor(actor, "ci-dm:gv", {
          messageId: gui.data.id,
        });
        expect(thuHoi.ok).toBe(true);
        const row = await db.message.findUniqueOrThrow({
          where: { id: gui.data.id },
          select: { deletedAt: true, deletedById: true, body: true },
        });
        expect(row.deletedAt).not.toBeNull();
        expect(row.deletedById).toBe(w.users.gv);
        expect(row.body).toBe("tin sẽ thu hồi"); // US-12 AC3 — body giữ nguyên trong DB
      },
      CASE_TIMEOUT,
    );

    it(
      "GV KHÔNG gửi được vào 1-1 mà mình không phải một đầu (lớp làm chứng không tự sinh quyền)",
      async () => {
        // Hội thoại của gvKhac ↔ phNgoai; `gv` không dạy con phNgoai và cũng không phải
        // thành viên ⇒ phải rụng. Nếu `dmWitnessClassId` lấy nhầm lớp của người khác thì
        // ca này đỏ.
        const convId = convIdOf(await openDm(w.users.phNgoai, w.users.gvKhac));
        const res = await sendAs(w.users.gv, convId, "tôi chen vào");
        expect(res.ok).toBe(false);
        if (!res.ok) expect(["PERMISSION_DENIED", "NOT_PARTICIPANT"]).toContain(res.error.code);
      },
      CASE_TIMEOUT,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) Rate limit — `openDm` là điểm vào chat, không được là cửa mở toang.
  // ───────────────────────────────────────────────────────────────────────────
  describe("openDm có trần lượt/phút", () => {
    it(
      `lượt thứ ${OPEN_DM_RATE_MAX + 1} trong một phút → RATE_LIMITED (chặn TRƯỚC khi đọc DB)`,
      async () => {
        // `phRate` KHÔNG có quan hệ dạy học với ai ⇒ mọi lượt đều đi nhánh deny, không
        // ghi gì vào DB — ca này chỉ đo cái trần. Dùng user RIÊNG vì bộ đếm rate limit
        // khoá theo `userId` và sống xuyên suốt tiến trình test.
        const codes: string[] = [];
        for (let i = 0; i < OPEN_DM_RATE_MAX + 1; i += 1) {
          const res = await openDm(w.users.phRate, w.users.gvKhac);
          codes.push(res.ok ? "OK" : res.error.code);
        }
        expect(codes.slice(0, OPEN_DM_RATE_MAX).every((c) => c === "PERMISSION_DENIED")).toBe(true);
        expect(codes[OPEN_DM_RATE_MAX]).toBe("RATE_LIMITED");
      },
      CASE_TIMEOUT,
    );
  });
});
