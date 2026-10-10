// lib/chat/sync-membership.ts — US-03: thành viên nhóm lớp DẪN XUẤT (BR-10→BR-15).
//
// Service DUY NHẤT đồng bộ ConversationParticipant của nhóm lớp (CLASS_GROUP) từ
// dữ liệu lớp thật: GV phân công (Class.teacherId/assistantId), PH của học viên
// đang thuộc lớp, QLCS của cơ sở. Gọi từ MỌI điểm thay đổi nghiệp vụ, TRONG CÙNG
// transaction của thao tác gốc (BR-12, F-SYNC) — danh sách điểm gọi:
// docs/chat-realtime/03-sync-callsites.md.
//
// Các quyết định đã chốt (chi tiết + lý do trong 03-sync-callsites.md):
//  • "Học viên đang thuộc lớp" = ENROLLMENT_ACTIVE_STATUSES (lib/enrollment-status.ts
//    — nguồn chân lý sẵn có của roster/điểm danh): ACTIVE/CONFIRMED/STUDYING/PAUSED,
//    kèm deletedAt: null. PAUSED (bảo lưu) vẫn thuộc lớp ⇒ PH KHÔNG rời nhóm.
//  • GV = teacherId VÀ assistantId (trợ giảng cũng đứng lớp) → MODERATOR/CLASS_TEACHER.
//  • QLCS = MEMBER/CENTER_MANAGER (chốt 07/08) — hợp NHẤT 2 nguồn như tiền lệ
//    payment-reconcile: v2 UserOrgRole(role.code ∈ CHAT_CENTER_MANAGER_ROLE_CODES @
//    OrgUnit của cơ sở) ∪ v1 User.roles[] chứa CENTER_MANAGER + User.centerId = cơ sở lớp.
//    Giáo vụ (RoleDef `CENTER_CLASS_MANAGER`) nằm trong tập v2 đó — chốt 09/08, xem
//    CHAT_CENTER_MANAGER_ROLE_CODES.
//  • BẪY BA (mục 5): PH nhiều con cùng lớp → MỘT bản ghi participant; leftAt CHỈ set
//    khi TẬP con đang thuộc lớp của PH đó rỗng. Học viên có 2 PH → 2 participant.
//  • Idempotent tuyệt đối (AC6): chạy lại không tạo trùng, không đổi joinedAt cũ,
//    không sinh thêm SYSTEM message. RE-JOIN = leftAt về null trên bản ghi CŨ.
//  • Chỉ đụng participant source=DERIVED. Bản ghi MANUAL (ngoại lệ Admin, BR-15)
//    không bị gỡ/ghi đè.
//  • SYSTEM message (kind=SYSTEM, senderId=null) khi GV/PH vào-rời nhóm SAU khi nhóm
//    đã tồn tại; lần sync ĐẦU (vừa tạo nhóm) không rải "đã tham gia" hàng loạt.
//    QLCS vào/rời không sinh message (không phải sự kiện lớp học). KHÔNG broadcast
//    realtime ở đây (US-06/07) — chỉ ghi DB.
//  • Ghi kép centerId + orgUnitId trên Conversation (luật Nền Hệ thống #3).
import type { Prisma } from "@prisma/client";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { publishEvent } from "@/lib/events/publish";
// Lấy hằng từ lib/chat/events (module rỗng phụ thuộc) chứ KHÔNG từ file handler —
// handler kéo theo broadcast → `import "server-only"` → file này chết dưới tsx/cron.
import { CHAT_PARTICIPANT_REMOVED } from "@/lib/chat/events";

// ─── PHẦN THUẦN (không DB — unit test được) ─────────────────────────────────

export type ClassMembershipSnapshot = {
  /** User.id của GV chính + trợ giảng (null/undefined tự bỏ). */
  teacherIds: readonly (string | null | undefined)[];
  /** Học viên đang thuộc lớp + danh sách PH (User.id) của từng em. */
  students: readonly { id: string; parentIds: readonly string[] }[];
  /**
   * User.id các QLCS của cơ sở chứa lớp — GỒM CẢ Giáo vụ (`CENTER_CLASS_MANAGER`),
   * dùng chung nhãn `CENTER_MANAGER` trong nhóm (CHAT_CENTER_MANAGER_ROLE_CODES).
   */
  centerManagerIds: readonly string[];
};

export type DesiredRole = "MODERATOR" | "MEMBER";
export type DesiredDerivedFrom =
  | "CLASS_TEACHER"
  | "CLASS_STUDENT_PARENT"
  | "CENTER_MANAGER";

export type DesiredParticipant = {
  userId: string;
  role: DesiredRole;
  derivedFrom: DesiredDerivedFrom;
};

/**
 * Tính danh sách thành viên MONG MUỐN của nhóm lớp từ snapshot lớp. Hàm THUẦN.
 *
 * Luật:
 *  • Mỗi userId đúng 1 entry — ưu tiên khi 1 người mang nhiều tư cách:
 *    CLASS_TEACHER > CLASS_STUDENT_PARENT > CENTER_MANAGER (GV kiêm PH vẫn là
 *    MODERATOR; PH kiêm QLCS giữ tư cách PH — sát quan hệ lớp học nhất).
 *  • PH có ≥2 con cùng lớp → 1 entry (bẫy BA mục 5).
 *  • Học viên có 2 PH → 2 entry riêng biệt (BR-14).
 *  • Lớp không học viên → chỉ GV + QLCS.
 */
export function computeDerivedMembership(
  snap: ClassMembershipSnapshot,
): DesiredParticipant[] {
  const out = new Map<string, DesiredParticipant>();

  // Thứ tự ghi: QLCS trước, PH đè, GV đè cuối — Map giữ entry ưu tiên cao nhất.
  for (const userId of snap.centerManagerIds) {
    if (!userId) continue;
    out.set(userId, { userId, role: "MEMBER", derivedFrom: "CENTER_MANAGER" });
  }
  for (const student of snap.students) {
    for (const parentId of student.parentIds) {
      if (!parentId) continue;
      out.set(parentId, {
        userId: parentId,
        role: "MEMBER",
        derivedFrom: "CLASS_STUDENT_PARENT",
      });
    }
  }
  for (const teacherId of snap.teacherIds) {
    if (!teacherId) continue;
    out.set(teacherId, {
      userId: teacherId,
      role: "MODERATOR",
      derivedFrom: "CLASS_TEACHER",
    });
  }
  return [...out.values()];
}

// ─── PHẦN DB (chạy TRONG transaction của caller) ────────────────────────────
//
// ⚠️⚠️ BẪY scopedDb — ĐỌC TRƯỚC KHI ĐỔI BẤT KỲ TRUY VẤN NÀO DƯỚI ĐÂY ⚠️⚠️
// Gần như MỌI điểm gọi mở transaction bằng `scopedDb(actor).$transaction(...)` rồi
// truyền chính `tx` đó xuống service này ⇒ extension cách ly cơ sở của scopedDb VẪN
// áp lên mọi READ chạm model ∈ SCOPED_MODELS (lib/db-scope.ts) đi qua `tx`.
// Nhưng việc DẪN XUẤT THÀNH VIÊN là thao tác MỨC HỆ THỐNG (đúng như job đối soát đêm
// US-04): nó phải thấy trạng thái THẬT của lớp, bất kể AI kích hoạt. Đọc qua scope thì:
//   • `Student` (SCOPED): học viên đã chuyển cơ sở (`Student.centerId` = CS2) nhưng vẫn
//     còn học lớp ở CS1 sẽ bị LỌC MẤT khỏi kết quả ⇒ service hiểu nhầm "em này không
//     còn thuộc lớp" ⇒ set `leftAt` cho PH của em + ghi SYSTEM message "đã rời nhóm"
//     SAI, chỉ vì người bấm nút là QLCS cơ sở kia.
//   • `Class` (SCOPED): `findUnique` bị lọc HẬU KỲ trả `null` khi lớp ngoài tầm nhìn
//     actor — và cả khi `Class.centerId` NULL (passesScope chặn) ⇒ sync IM LẶNG no-op.
// ⇒ LUẬT: mọi truy vấn chạm SCOPED_MODELS trong file này đi bằng `tx.$queryRaw`
// (tagged template — Prisma client extension KHÔNG áp lên raw query; TUYỆT ĐỐI không
// dùng `$queryRawUnsafe`, CLAUDE.md cấm). Vẫn dùng `tx` của caller nên tính atomic
// giữ nguyên. Raw cũng bỏ qua extension soft-delete của base `db` → phải TỰ viết
// `"deletedAt" IS NULL` cho model soft-delete (Enrollment).
// Model KHÔNG scoped thì dùng Prisma API bình thường, an toàn: `User`/`OrgUnit` ∈
// SCOPE_EXEMPT, `Conversation` ∈ SCOPE_EXEMPT, `UserOrgRole`/`ConversationParticipant`/
// `Message` không nằm trong SCOPED_MODELS.
// Schema KHÔNG dùng `@@map`/`@map` ⇒ tên bảng/cột trong SQL = tên model/field PascalCase.

type Tx = Prisma.TransactionClient;

/** Trạng thái enrollment "đang thuộc lớp" cho membership chat (alias có tên riêng). */
export const CHAT_MEMBER_ENROLLMENT_STATUSES = ENROLLMENT_ACTIVE_STATUS_LIST;

/**
 * RoleDef (v2) được đối xử như "quản lý cơ sở" khi dẫn xuất thành viên nhóm lớp.
 *
 * `CENTER_CLASS_MANAGER` (Giáo vụ — "Quản lý lớp học", vai #16) thêm vào 09/08/2026 theo
 * chốt của chủ dự án: Giáo vụ vào nhóm lớp Y HỆT Quản lý cơ sở. Trước đó vai này giữ đủ
 * 3 quyền `chat:read/send/announce` (prisma/seed-roles.ts, cùng bộ CENTER với
 * CENTER_MANAGER) nhưng KHÔNG bao giờ được dẫn xuất thành participant ⇒ 3 quyền đó là
 * QUYỀN CHẾT: phạm vi đọc của chat là participant-based, vai không phải thành viên thì
 * mở màn chat ra chỉ thấy danh sách rỗng.
 *
 * ⚠️ CỐ Ý dùng chung nhãn `derivedFrom = CENTER_MANAGER` + `role = MEMBER` cho cả hai:
 * `DerivedFrom` là enum trong DB (prisma/schema.prisma), thêm giá trị mới là phải
 * migration + đụng mọi chỗ đọc enum, trong khi hai vai có CÙNG tư cách trong nhóm
 * (MEMBER, không sinh SYSTEM message vào/rời — xem `systemLabel`). Nhãn ở đây trả lời
 * "vì sao người này ở trong nhóm" (vì quản lý cơ sở này), không phải "tên vai của họ".
 *
 * ⚠️ CHỈ áp cho nhánh v2. Enum `Role` (v1) KHÔNG có `CENTER_CLASS_MANAGER` — vai này
 * chỉ tồn tại dưới dạng RoleDef gán tay ở /admin/users/[id]/org-roles
 * (lib/auth/legacy-role-map.ts: nằm ngoài MANAGED_ROLE_CODES) — nên nhánh v1 giữ
 * nguyên `CENTER_MANAGER`, đừng bịa role legacy mới.
 */
export const CHAT_CENTER_MANAGER_ROLE_CODES = [
  "CENTER_MANAGER",
  "CENTER_CLASS_MANAGER",
] as const;

/**
 * QLCS của một cơ sở — hợp nhất v2 (UserOrgRole, prod đang enforce) ∪ v1
 * (User.roles[], local/dev/CI) theo tiền lệ getReconcileRecipients
 * (app/api/cron/payment-reconcile/route.ts). Chỉ trả tài khoản còn sống.
 * "QLCS" ở đây gồm cả Giáo vụ ở nhánh v2 — xem CHAT_CENTER_MANAGER_ROLE_CODES.
 */
async function resolveCenterManagerUserIds(
  tx: Tx,
  centerId: string | null,
  now = new Date(),
): Promise<string[]> {
  if (!centerId) return [];
  const ids = new Set<string>();

  // An toàn với BẪY scopedDb: `OrgUnit` + `User` ∈ SCOPE_EXEMPT và `UserOrgRole` không
  // nằm trong SCOPED_MODELS ⇒ 3 truy vấn dưới đây KHÔNG bị extension lọc → giữ Prisma API.

  // v2 — UserOrgRole @ OrgUnit (type CENTER) trỏ Center này. Gồm cả Giáo vụ
  // (CENTER_CLASS_MANAGER) — xem CHAT_CENTER_MANAGER_ROLE_CODES.
  const orgUnit = await tx.orgUnit.findFirst({
    where: { centerId, deletedAt: null },
    select: { id: true },
  });
  if (orgUnit) {
    const rows = await tx.userOrgRole.findMany({
      where: {
        orgUnitId: orgUnit.id,
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        role: { code: { in: [...CHAT_CENTER_MANAGER_ROLE_CODES] }, isActive: true },
      },
      select: { userId: true },
    });
    for (const r of rows) ids.add(r.userId);
  }

  // v1 — User.roles[] chứa CENTER_MANAGER (fallback: cột role chính) + đúng cơ sở.
  // KHÔNG có biến thể Giáo vụ ở đây: enum `Role` không có CENTER_CLASS_MANAGER.
  const v1 = await tx.user.findMany({
    where: {
      centerId,
      deletedAt: null,
      isActive: true,
      OR: [{ roles: { has: "CENTER_MANAGER" } }, { role: "CENTER_MANAGER" }],
    },
    select: { id: true },
  });
  for (const u of v1) ids.add(u.id);

  if (ids.size === 0) return [];
  // Lọc tài khoản còn sống (người ở v2 có thể đã bị khoá/xoá).
  const alive = await tx.user.findMany({
    where: { id: { in: [...ids] }, deletedAt: null, isActive: true },
    select: { id: true },
  });
  return alive.map((u) => u.id);
}

/** Nhãn tiếng Việt cho SYSTEM message theo tư cách dẫn xuất. */
function systemLabel(derivedFrom: DesiredDerivedFrom | null): string | null {
  if (derivedFrom === "CLASS_TEACHER") return "Giáo viên";
  if (derivedFrom === "CLASS_STUDENT_PARENT") return "Phụ huynh";
  return null; // QLCS/Giáo vụ vào/rời không sinh SYSTEM message (quyết định US-03)
}

/** Field lớp cần cho việc dẫn xuất thành viên (subset của Class). */
export type ClassForMembership = {
  id: string;
  centerId: string | null;
  teacherId: string | null;
  assistantId: string | null;
};

/**
 * Dòng `Class` đọc bằng raw (BẪY scopedDb). `status` lấy `::text` — so sánh chuỗi với
 * ClassStatus, khỏi phụ thuộc cách driver giải mã enum.
 */
type ClassRowRaw = ClassForMembership & {
  name: string;
  status: string;
  deletedAt: Date | null;
  orgUnitId: string | null;
};

export type LoadedMembership = {
  /** Tập thành viên MONG MUỐN (đã lọc user còn sống trong DB). */
  desired: DesiredParticipant[];
  /** User của desired (name/email/phone) — sync dùng cho SYSTEM message. */
  userById: Map<
    string,
    { id: string; name: string | null; email: string | null; phone: string | null }
  >;
};

/**
 * Loader DUY NHẤT của tập thành viên dẫn xuất từ dữ liệu lớp thật (US-03), tái dùng
 * cho job đối soát đêm (US-04, lib/chat/reconcile-membership.ts) — KHÔNG viết lại
 * logic dẫn xuất lần 2. Chạy trong transaction của caller.
 */
export async function loadDerivedMembership(
  tx: Tx,
  cls: ClassForMembership,
): Promise<LoadedMembership> {
  // ⚠️ RAW CÓ CHỦ ĐÍCH — đừng đổi về `tx.student.findMany` (xem "BẪY scopedDb" đầu mục):
  // `Student` VÀ `Enrollment` đều ∈ SCOPED_MODELS, nên qua tx của scopedDb(actor cấp cơ
  // sở) học viên đã chuyển cơ sở mà còn học lớp này sẽ biến mất ⇒ PH của em bị đá khỏi
  // nhóm oan. Điều kiện dưới đây = bản dịch 1-1 của where cũ (HV sống + có PH + có ghi
  // danh SỐNG ở lớp này với status thuộc bộ "đang thuộc lớp"); `e."deletedAt" IS NULL`
  // phải viết tay vì raw không qua extension soft-delete của base `db`.
  const students = await tx.$queryRaw<{ id: string; parentUserId: string }[]>`
    SELECT DISTINCT s."id", s."parentUserId"
    FROM "Student" s
    JOIN "Enrollment" e ON e."studentId" = s."id"
    WHERE s."deletedAt" IS NULL
      AND s."parentUserId" IS NOT NULL
      AND e."classId" = ${cls.id}
      AND e."deletedAt" IS NULL
      AND e."status" = ANY(${CHAT_MEMBER_ENROLLMENT_STATUSES}::"EnrollmentStatus"[])
  `;
  const centerManagerIds = await resolveCenterManagerUserIds(tx, cls.centerId);

  const desiredRaw = computeDerivedMembership({
    teacherIds: [cls.teacherId, cls.assistantId],
    students: students.map((s) => ({
      id: s.id,
      parentIds: s.parentUserId ? [s.parentUserId] : [],
    })),
    centerManagerIds,
  });

  // Chỉ nhận user còn sống trong DB (userId trên participant không có FK — BA cố ý).
  // `User` ∈ SCOPE_EXEMPT → Prisma API an toàn (không bị scopedDb lọc).
  const users = await tx.user.findMany({
    where: { id: { in: desiredRaw.map((d) => d.userId) }, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  return { desired: desiredRaw.filter((d) => userById.has(d.userId)), userById };
}

/**
 * Đồng bộ nhóm lớp cho `classId` — gọi TRONG transaction của thao tác nghiệp vụ.
 *
 * Hành vi theo trạng thái lớp:
 *  • ACTIVE          → tạo Conversation nếu chưa có (BR-01/BR-02, upsert theo unique
 *                      (type,subjectType,subjectId)); nhóm đang ARCHIVED (lớp mở lại)
 *                      → mở lại; LOCKED giữ nguyên (khoá của Admin thắng). Diff members.
 *  • COMPLETED/CANCELLED hoặc lớp xoá mềm → archive nhóm (BR-03), GIỮ NGUYÊN
 *                      participant (đọc lịch sử theo BR-04); không diff.
 *  • PLANNED/RECRUITING/PENDING_APPROVAL → chưa có nhóm thì KHÔNG tạo (BR-01);
 *                      nhóm đã tồn tại (lớp từng ACTIVE) thì vẫn diff members.
 *
 * Idempotent: chạy 2 lần liên tiếp không đổi gì (AC6).
 */
export async function syncConversationMembership(
  tx: Tx,
  classId: string,
): Promise<void> {
  // ⚠️ RAW CÓ CHỦ ĐÍCH (xem "BẪY scopedDb" đầu mục): `Class` ∈ SCOPED_MODELS và
  // `findUnique` của scopedDb lọc HẬU KỲ → trả null cho lớp ngoài tầm nhìn actor, và cả
  // cho lớp `centerId` NULL ⇒ sync im lặng no-op (bug ẩn: không lỗi, không log, chỉ là
  // nhóm chat không bao giờ cập nhật). Dẫn xuất thành viên là thao tác mức hệ thống.
  const clsRows = await tx.$queryRaw<ClassRowRaw[]>`
    SELECT "id", "name", "status"::text AS "status", "deletedAt",
           "centerId", "orgUnitId", "teacherId", "assistantId"
    FROM "Class"
    WHERE "id" = ${classId}
    LIMIT 1
  `;
  const cls = clsRows[0];
  if (!cls) return; // lớp không tồn tại → không có gì để sync

  const convKey = {
    type: "CLASS_GROUP" as const,
    subjectType: "CLASS" as const,
    subjectId: classId,
  };
  // `Conversation` ∈ SCOPE_EXEMPT (quyền chat là participant-based, xem db-scope.ts)
  // → findUnique KHÔNG bị lọc scope. Prisma API an toàn ở đây.
  let conv = await tx.conversation.findUnique({
    where: { type_subjectType_subjectId: convKey },
    select: { id: true, status: true },
  });

  const classEnded =
    cls.deletedAt !== null ||
    cls.status === "COMPLETED" ||
    cls.status === "CANCELLED";
  if (classEnded) {
    await archiveClassConversation(tx, classId);
    return;
  }

  let isNewConversation = false;
  if (!conv) {
    if (cls.status !== "ACTIVE") return; // BR-01: nhóm chỉ sinh khi lớp hoạt động
    // Ghi kép centerId + orgUnitId (luật Nền Hệ thống #3). Lớp cũ chưa backfill
    // orgUnitId → suy từ OrgUnit(type CENTER) trỏ centerId. `OrgUnit` ∈ SCOPE_EXEMPT
    // → Prisma API an toàn (không dính BẪY scopedDb).
    const orgUnitId =
      cls.orgUnitId ??
      (cls.centerId
        ? (
            await tx.orgUnit.findFirst({
              where: { centerId: cls.centerId, deletedAt: null },
              select: { id: true },
            })
          )?.id ?? null
        : null);
    conv = await tx.conversation.upsert({
      where: { type_subjectType_subjectId: convKey },
      update: {}, // đã tồn tại (đua trong 2 tx) → giữ nguyên
      create: {
        ...convKey,
        status: "ACTIVE",
        centerId: cls.centerId,
        orgUnitId,
        title: cls.name,
      },
      select: { id: true, status: true },
    });
    isNewConversation = true;
  } else if (conv.status === "ARCHIVED" && cls.status === "ACTIVE") {
    // Lớp quay lại hoạt động (vd sửa nhầm trạng thái) → mở lại nhóm. LOCKED không đụng.
    await tx.conversation.update({
      where: { id: conv.id },
      data: { status: "ACTIVE", archivedAt: null },
    });
  }

  // ── Snapshot dẫn xuất từ dữ liệu lớp (loader chung với job đối soát US-04) ──
  const { desired, userById } = await loadDerivedMembership(tx, cls);
  const desiredById = new Map(desired.map((d) => [d.userId, d]));

  // `ConversationParticipant` không ∈ SCOPED_MODELS → Prisma API an toàn.
  const existing = await tx.conversationParticipant.findMany({
    where: { conversationId: conv.id },
    select: {
      id: true,
      userId: true,
      role: true,
      source: true,
      derivedFrom: true,
      leftAt: true,
    },
  });
  const existingByUserId = new Map(existing.map((p) => [p.userId, p]));

  const systemMessages: string[] = [];
  const displayName = (userId: string): string => {
    const u = userById.get(userId);
    return u?.name ?? u?.email ?? u?.phone ?? "thành viên";
  };

  // 1) Thêm mới + RE-JOIN + chỉnh role/derivedFrom lệch.
  for (const d of desired) {
    const cur = existingByUserId.get(d.userId);
    if (!cur) {
      await tx.conversationParticipant.create({
        data: {
          conversationId: conv.id,
          userId: d.userId,
          role: d.role,
          source: "DERIVED",
          derivedFrom: d.derivedFrom,
        },
      });
      if (!isNewConversation) {
        const label = systemLabel(d.derivedFrom);
        if (label) systemMessages.push(`${label} ${displayName(d.userId)} đã tham gia nhóm.`);
      }
      continue;
    }
    // BR-15: bản ghi MANUAL (Admin thêm tay) không bị service ghi đè.
    if (cur.source === "MANUAL") continue;
    if (cur.leftAt !== null) {
      // AC6/RE-JOIN: mở lại bản ghi CŨ — leftAt=null, KHÔNG đổi joinedAt, không tạo trùng.
      await tx.conversationParticipant.update({
        where: { id: cur.id },
        data: { leftAt: null, role: d.role, derivedFrom: d.derivedFrom },
      });
      const label = systemLabel(d.derivedFrom);
      if (label) systemMessages.push(`${label} ${displayName(d.userId)} đã tham gia nhóm.`);
    } else if (cur.role !== d.role || cur.derivedFrom !== d.derivedFrom) {
      // Đổi tư cách (vd PH được phân công làm GV) — chỉnh im lặng, không SYSTEM message.
      await tx.conversationParticipant.update({
        where: { id: cur.id },
        data: { role: d.role, derivedFrom: d.derivedFrom },
      });
    }
  }

  // 2) Set leftAt cho người phải rời (chỉ đụng DERIVED — BR-13: không xoá bản ghi).
  const now = new Date();
  const leavers = existing.filter(
    (p) => p.source === "DERIVED" && p.leftAt === null && !desiredById.has(p.userId),
  );
  if (leavers.length > 0) {
    const leaverUsers = await tx.user.findMany({
      where: { id: { in: leavers.map((p) => p.userId) } },
      select: { id: true, name: true, email: true, phone: true },
    });
    for (const u of leaverUsers) userById.set(u.id, u);
    for (const p of leavers) {
      await tx.conversationParticipant.update({
        where: { id: p.id },
        data: { leftAt: now },
      });
      const label = systemLabel(p.derivedFrom as DesiredDerivedFrom | null);
      if (label === "Giáo viên") {
        systemMessages.push(`Giáo viên ${displayName(p.userId)} đã được gỡ khỏi nhóm.`);
      } else if (label) {
        systemMessages.push(`${label} ${displayName(p.userId)} đã rời nhóm.`);
      }

      // F-KICK bước 3 — đá người vừa bị gỡ ra khỏi kênh realtime đang mở. Policy RLS
      // chỉ chạy lúc join nên không tự đuổi được; handler bắn `participant.removed`
      // xuống topic để client tự unsubscribe (lib/chat/_handlers/participant-removed.ts).
      // Publish TRONG tx (rollback nghiệp vụ ⇒ không có event), broadcast chạy SAU
      // commit ở dispatcher — side-effect không-atomic không được nằm trong tx.
      await publishEvent(
        CHAT_PARTICIPANT_REMOVED,
        { conversationId: conv.id, userId: p.userId },
        { tx, dedupeKey: `${CHAT_PARTICIPANT_REMOVED}:${p.id}:${now.toISOString()}` },
      );
    }
  }

  // 3) SYSTEM message (BR-22) — chỉ ghi DB, không broadcast (US-06/07 lo).
  if (systemMessages.length > 0) {
    await tx.message.createMany({
      data: systemMessages.map((body) => ({
        conversationId: conv.id,
        kind: "SYSTEM" as const,
        senderId: null,
        body,
      })),
    });
    await tx.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: now },
    });
  }
}

/**
 * Lớp kết thúc/hủy/xoá mềm → nhóm lớp chuyển ARCHIVED (BR-03: đọc được, không gửi
 * được, KHÔNG xoá; participant giữ nguyên để đọc lịch sử theo BR-04). Idempotent.
 * Nhóm đang LOCKED cũng archive — vòng đời lớp đã đóng thì trạng thái cuối là ARCHIVED.
 * (`Conversation` ∈ SCOPE_EXEMPT → không dính BẪY scopedDb, giữ Prisma API.)
 */
export async function archiveClassConversation(
  tx: Tx,
  classId: string,
): Promise<void> {
  const conv = await tx.conversation.findUnique({
    where: {
      type_subjectType_subjectId: {
        type: "CLASS_GROUP",
        subjectType: "CLASS",
        subjectId: classId,
      },
    },
    select: { id: true, status: true },
  });
  if (!conv || conv.status === "ARCHIVED") return;
  await tx.conversation.update({
    where: { id: conv.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

/**
 * Đổi QLCS của cơ sở → đồng bộ MỌI nhóm lớp đang hoạt động của cơ sở đó, trong cùng
 * transaction với thao tác đổi vai (F-SYNC "đổi QLCS"). Số lớp ACTIVE/cơ sở nhỏ
 * (hàng chục) nên chạy tuần tự trong tx an toàn.
 */
export async function syncCenterClassConversations(
  tx: Tx,
  centerId: string | null | undefined,
): Promise<void> {
  if (!centerId) return;
  // ⚠️ RAW CÓ CHỦ ĐÍCH (xem "BẪY scopedDb" đầu mục): `Class` ∈ SCOPED_MODELS. Qua tx của
  // scopedDb, actor cấp cơ sở đổi vai QLCS cho cơ sở KHÁC sẽ nhận [] ⇒ không nhóm nào
  // được đồng bộ mà cũng không có lỗi nào nổi lên.
  const classes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Class"
    WHERE "centerId" = ${centerId}
      AND "deletedAt" IS NULL
      AND "status" = 'ACTIVE'::"ClassStatus"
  `;
  for (const c of classes) {
    await syncConversationMembership(tx, c.id);
  }
}
