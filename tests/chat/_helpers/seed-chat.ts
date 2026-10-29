/**
 * US-05 — Seed chuẩn cho bộ test ma trận quyền chat (TestScenarios "Seed chuẩn").
 *
 * Dựng trên SCHEMA THẬT (Conversation/ConversationParticipant/Message của US-01):
 *   - 2 Center: CS1, CS2 (+ OrgUnit ROOT/HO/CS1/CS2 + 14 RoleDef v2).
 *   - 3 Class: LopA (CS1, ACTIVE) · LopB (CS2, ACTIVE) · LopC (CS1, COMPLETED →
 *     conversation ARCHIVED).
 *   - GV: gv1 dạy LopA · gv2 dạy LopB · gv3 dạy CHÉO cả 2 (Class chỉ có 1 teacherId
 *     nên gv3 gán qua assistantId của cả LopA + LopB — vẫn vào assignedClassIds
 *     của resolveActor, đúng nghĩa "phân công", xem lib/auth/actor.ts).
 *   - QLCS: ql1 (CS1) · ql2 (CS2). Sale: sale1 (CS1, P0 không có quyền chat nào).
 *   - PH: ph1 (2 con cùng LopA) · ph2 (con ở cả LopA + LopB) · ph3 (con LopB) ·
 *     ph4 (con đã rời LopA — participant leftAt ĐÃ SET). Admin: admin1 (HO).
 *   - Conversation CLASS_GROUP cho từng lớp + DM gv1↔ph1, participant đúng vai.
 *
 * AN TOÀN: mọi hàm ghi đi qua assertTestDb() (tests/e2e/_helpers/seed.ts) — CHỈ chạy
 * được trên Postgres local/CI (localhost/127.0.0.1/satarobo_test). TUYỆT ĐỐI không
 * chạy được trên DB dev Supabase. Idempotent: upsert theo khoá tự nhiên.
 */
import type { Role } from "@prisma/client";
import { db } from "../../../lib/db";
import { dmKeyOf } from "../../../lib/chat/dm";
import {
  assertTestDb,
  seedOrg,
  seedRoles,
  seedUser,
} from "../../e2e/_helpers/seed";

const EMAIL_DOMAIN = "chat-us05.test.local";

export type ChatFixture = {
  centers: { cs1: string; cs2: string };
  users: Record<
    | "gv1"
    | "gv2"
    | "gv3"
    | "ql1"
    | "ql2"
    | "ph1"
    | "ph2"
    | "ph3"
    | "ph4"
    | "sale1"
    | "admin1",
    string
  >;
  classes: { lopA: string; lopB: string; lopC: string };
  conversations: { lopA: string; lopB: string; lopC: string; dmGv1Ph1: string };
};

async function upsertCenter(code: string, name: string): Promise<string> {
  // Khoá theo `code` (unique) — seedOrgUnits wire OrgUnit.centerId qua Center.code,
  // nên nếu DB test đã có CS1/CS2 (fixture e2e khác) thì TÁI DÙNG thay vì đụng unique.
  const c = await db.center.upsert({
    where: { code },
    update: { isActive: true },
    create: {
      code,
      name,
      slug: `chat-us05-${code.toLowerCase()}`,
      address: `Địa chỉ test ${code}`,
      city: "Đà Nẵng",
    },
    select: { id: true },
  });
  return c.id;
}

async function user(
  key: string,
  role: Role,
  centerId: string | null,
): Promise<string> {
  const u = await seedUser({
    email: `${key}@${EMAIL_DOMAIN}`,
    name: key,
    role,
    centerId,
  });
  return u.id;
}

/** Gán UserOrgRole (v2) — actor thật cho runAction khi các story sau mở test động. */
async function grantOrgRole(
  userId: string,
  orgCode: string,
  roleCode: string,
  grantedById: string,
): Promise<void> {
  const org = await db.orgUnit.findUniqueOrThrow({ where: { code: orgCode }, select: { id: true } });
  const role = await db.roleDef.findUniqueOrThrow({ where: { code: roleCode }, select: { id: true } });
  await db.userOrgRole.upsert({
    where: {
      userId_orgUnitId_roleId: { userId, orgUnitId: org.id, roleId: role.id },
    },
    update: { status: "ACTIVE", effectiveTo: null },
    create: { userId, orgUnitId: org.id, roleId: role.id, grantedById, status: "ACTIVE" },
  });
}

async function upsertClass(input: {
  classCode: string;
  name: string;
  courseId: string;
  centerId: string;
  status: "ACTIVE" | "COMPLETED";
  teacherId: string;
  assistantId?: string | null;
}): Promise<string> {
  const c = await db.class.upsert({
    where: { classCode: input.classCode },
    update: {
      centerId: input.centerId,
      status: input.status,
      teacherId: input.teacherId,
      assistantId: input.assistantId ?? null,
      deletedAt: null,
    },
    create: {
      classCode: input.classCode,
      name: input.name,
      courseId: input.courseId,
      centerId: input.centerId,
      status: input.status,
      teacherId: input.teacherId,
      assistantId: input.assistantId ?? null,
    },
    select: { id: true },
  });
  return c.id;
}

async function upsertStudent(input: {
  studentCode: string;
  name: string;
  parentUserId: string;
  centerId: string;
}): Promise<string> {
  const s = await db.student.upsert({
    where: { studentCode: input.studentCode },
    update: {
      parentUserId: input.parentUserId,
      centerId: input.centerId,
      deletedAt: null,
    },
    create: {
      studentCode: input.studentCode,
      name: input.name,
      parentUserId: input.parentUserId,
      centerId: input.centerId,
      parentName: `PH của ${input.name}`,
      parentPhone: "0900000000",
    },
    select: { id: true },
  });
  return s.id;
}

/** Enrollment ∈ SCOPED_MODELS — BẮT BUỘC set centerId khi create. */
async function ensureEnrollment(input: {
  studentId: string;
  classId: string;
  courseId: string;
  centerId: string;
  /** ph4: con đã rời lớp. */
  cancelled?: boolean;
}): Promise<void> {
  const existing = await db.enrollment.findFirst({
    where: { studentId: input.studentId, classId: input.classId },
    select: { id: true },
  });
  const status = input.cancelled ? "CANCELLED" : "ACTIVE";
  if (existing) {
    await db.enrollment.update({
      where: { id: existing.id },
      data: { status, centerId: input.centerId, deletedAt: null },
    });
    return;
  }
  await db.enrollment.create({
    data: {
      studentId: input.studentId,
      classId: input.classId,
      courseId: input.courseId,
      centerId: input.centerId, // SCOPED_MODELS — quên = record vô hình với actor cấp cơ sở
      status,
    },
  });
}

async function upsertClassConversation(input: {
  classId: string;
  centerId: string;
  status: "ACTIVE" | "ARCHIVED";
  title: string;
}): Promise<string> {
  const conv = await db.conversation.upsert({
    where: {
      type_subjectType_subjectId: {
        type: "CLASS_GROUP",
        subjectType: "CLASS",
        subjectId: input.classId,
      },
    },
    update: {
      status: input.status,
      centerId: input.centerId,
      archivedAt: input.status === "ARCHIVED" ? new Date() : null,
    },
    create: {
      type: "CLASS_GROUP",
      subjectType: "CLASS",
      subjectId: input.classId,
      centerId: input.centerId,
      status: input.status,
      title: input.title,
      archivedAt: input.status === "ARCHIVED" ? new Date() : null,
    },
    select: { id: true },
  });
  return conv.id;
}

async function upsertParticipant(input: {
  conversationId: string;
  userId: string;
  role: "MODERATOR" | "MEMBER";
  derivedFrom: "CLASS_TEACHER" | "CLASS_STUDENT_PARENT" | "CENTER_MANAGER" | null;
  /** ph4 / DM: null = đang hiệu lực; Date = đã rời. */
  leftAt?: Date | null;
}): Promise<void> {
  await db.conversationParticipant.upsert({
    where: {
      conversationId_userId: {
        conversationId: input.conversationId,
        userId: input.userId,
      },
    },
    update: { role: input.role, leftAt: input.leftAt ?? null },
    create: {
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      source: input.derivedFrom ? "DERIVED" : "MANUAL",
      derivedFrom: input.derivedFrom,
      leftAt: input.leftAt ?? null,
    },
  });
}

// ⚠️ `dmKeyOf` KHÔNG được chép lại ở đây — nó là công thức SẢN PHẨM (BR-06), sống ở
// `lib/chat/dm.ts`. Fixture chép tay một công thức riêng = test DM xanh giả: seed ghi
// một khoá, `openDm` tra một khoá khác, cả hai đều "chạy đúng" theo cách của mình.
export { dmKeyOf };

export async function seedChatFixture(): Promise<ChatFixture> {
  assertTestDb();

  // 1) Hạ tầng: Center → OrgUnit (cần center trước để wire centerId) → RoleDef v2.
  const cs1 = await upsertCenter("CS1", "Cơ sở 1 (chat test)");
  const cs2 = await upsertCenter("CS2", "Cơ sở 2 (chat test)");
  await seedOrg(["HO", "CS1", "CS2"]);
  await seedRoles();

  // 2) Users (11 actor của seed chuẩn).
  const admin1 = await user("admin1", "SUPER_ADMIN", null);
  const gv1 = await user("gv1", "TEACHER", cs1);
  const gv2 = await user("gv2", "TEACHER", cs2);
  const gv3 = await user("gv3", "TEACHER", null); // biên chế HO — dạy chéo cơ sở
  const ql1 = await user("ql1", "CENTER_MANAGER", cs1);
  const ql2 = await user("ql2", "CENTER_MANAGER", cs2);
  const ph1 = await user("ph1", "PARENT", null);
  const ph2 = await user("ph2", "PARENT", null);
  const ph3 = await user("ph3", "PARENT", null);
  const ph4 = await user("ph4", "PARENT", null);
  const sale1 = await user("sale1", "SALES_CSM", cs1);

  // 3) UserOrgRole (v2) — nguồn quyền thật cho resolveActor/runAction.
  await grantOrgRole(admin1, "HO", "SUPER_ADMIN", admin1);
  await grantOrgRole(gv1, "CS1", "TEACHER", admin1);
  await grantOrgRole(gv2, "CS2", "TEACHER", admin1);
  await grantOrgRole(gv3, "HO", "TEACHER", admin1);
  await grantOrgRole(ql1, "CS1", "CENTER_MANAGER", admin1);
  await grantOrgRole(ql2, "CS2", "CENTER_MANAGER", admin1);
  await grantOrgRole(sale1, "CS1", "CENTER_SALES_CSM", admin1);
  for (const ph of [ph1, ph2, ph3, ph4]) await grantOrgRole(ph, "CS1", "PARENT", admin1);

  // 4) Course + 3 lớp (gv3 dạy chéo qua assistantId cả 2 lớp).
  const course = await db.course.upsert({
    where: { slug: "chat-us05-course" },
    update: {},
    create: { name: "Khoá test chat US-05", slug: "chat-us05-course", isTeachable: true },
    select: { id: true },
  });
  const lopA = await upsertClass({
    classCode: "CHAT-US05-LOPA", name: "LopA", courseId: course.id,
    centerId: cs1, status: "ACTIVE", teacherId: gv1, assistantId: gv3,
  });
  const lopB = await upsertClass({
    classCode: "CHAT-US05-LOPB", name: "LopB", courseId: course.id,
    centerId: cs2, status: "ACTIVE", teacherId: gv2, assistantId: gv3,
  });
  const lopC = await upsertClass({
    classCode: "CHAT-US05-LOPC", name: "LopC", courseId: course.id,
    centerId: cs1, status: "COMPLETED", teacherId: gv1,
  });

  // 5) Học viên + ghi danh (Enrollment set centerId — SCOPED_MODELS).
  const hv = async (code: string, name: string, parent: string, centerId: string) =>
    upsertStudent({ studentCode: code, name, parentUserId: parent, centerId });
  const ph1Con1 = await hv("CHAT-US05-HV01", "Con 1 của ph1", ph1, cs1);
  const ph1Con2 = await hv("CHAT-US05-HV02", "Con 2 của ph1", ph1, cs1);
  const ph2ConA = await hv("CHAT-US05-HV03", "Con A của ph2", ph2, cs1);
  const ph2ConB = await hv("CHAT-US05-HV04", "Con B của ph2", ph2, cs2);
  const ph3Con = await hv("CHAT-US05-HV05", "Con của ph3", ph3, cs2);
  const ph4Con = await hv("CHAT-US05-HV06", "Con của ph4 (đã rời)", ph4, cs1);

  const enr = (studentId: string, classId: string, centerId: string, cancelled = false) =>
    ensureEnrollment({ studentId, classId, courseId: course.id, centerId, cancelled });
  await enr(ph1Con1, lopA, cs1);
  await enr(ph1Con2, lopA, cs1);
  await enr(ph2ConA, lopA, cs1);
  await enr(ph2ConB, lopB, cs2);
  await enr(ph3Con, lopB, cs2);
  await enr(ph4Con, lopA, cs1, true); // con ph4 đã rời LopA

  // 6) Conversation nhóm lớp + participant đúng vai (chốt 07/08: QLCS = MEMBER).
  const convA = await upsertClassConversation({ classId: lopA, centerId: cs1, status: "ACTIVE", title: "Nhóm LopA" });
  const convB = await upsertClassConversation({ classId: lopB, centerId: cs2, status: "ACTIVE", title: "Nhóm LopB" });
  const convC = await upsertClassConversation({ classId: lopC, centerId: cs1, status: "ARCHIVED", title: "Nhóm LopC (đã kết thúc)" });

  const p = upsertParticipant;
  // LopA: gv1 + gv3 (MODERATOR/CLASS_TEACHER) · ql1 (MEMBER/CENTER_MANAGER) ·
  //       ph1, ph2 (MEMBER/CLASS_STUDENT_PARENT) · ph4 leftAt ĐÃ SET.
  await p({ conversationId: convA, userId: gv1, role: "MODERATOR", derivedFrom: "CLASS_TEACHER" });
  await p({ conversationId: convA, userId: gv3, role: "MODERATOR", derivedFrom: "CLASS_TEACHER" });
  await p({ conversationId: convA, userId: ql1, role: "MEMBER", derivedFrom: "CENTER_MANAGER" });
  await p({ conversationId: convA, userId: ph1, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" });
  await p({ conversationId: convA, userId: ph2, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" });
  await p({ conversationId: convA, userId: ph4, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT", leftAt: new Date("2026-08-01T00:00:00Z") });
  // LopB: gv2 + gv3 · ql2 · ph2, ph3.
  await p({ conversationId: convB, userId: gv2, role: "MODERATOR", derivedFrom: "CLASS_TEACHER" });
  await p({ conversationId: convB, userId: gv3, role: "MODERATOR", derivedFrom: "CLASS_TEACHER" });
  await p({ conversationId: convB, userId: ql2, role: "MEMBER", derivedFrom: "CENTER_MANAGER" });
  await p({ conversationId: convB, userId: ph2, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" });
  await p({ conversationId: convB, userId: ph3, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" });
  // LopC (ARCHIVED): lịch sử còn đọc được trong hạn — gv1, ql1, ph1.
  await p({ conversationId: convC, userId: gv1, role: "MODERATOR", derivedFrom: "CLASS_TEACHER" });
  await p({ conversationId: convC, userId: ql1, role: "MEMBER", derivedFrom: "CENTER_MANAGER" });
  await p({ conversationId: convC, userId: ph1, role: "MEMBER", derivedFrom: "CLASS_STUDENT_PARENT" });

  // 7) DM gv1↔ph1 (TS-04) — centerId=null theo delta E.3.
  const dm = await db.conversation.upsert({
    where: { dmKey: dmKeyOf(gv1, ph1) },
    update: { status: "ACTIVE" },
    create: {
      type: "DM_TEACHER_PARENT",
      subjectType: "NONE",
      dmKey: dmKeyOf(gv1, ph1),
      centerId: null,
      status: "ACTIVE",
      title: "DM gv1 ↔ ph1",
    },
    select: { id: true },
  });
  await p({ conversationId: dm.id, userId: gv1, role: "MEMBER", derivedFrom: null });
  await p({ conversationId: dm.id, userId: ph1, role: "MEMBER", derivedFrom: null });

  return {
    centers: { cs1, cs2 },
    users: { gv1, gv2, gv3, ql1, ql2, ph1, ph2, ph3, ph4, sale1, admin1 },
    classes: { lopA, lopB, lopC },
    conversations: { lopA: convA, lopB: convB, lopC: convC, dmGv1Ph1: dm.id },
  };
}
