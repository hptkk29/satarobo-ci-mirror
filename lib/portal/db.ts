// #03 (mảng cuối) — portalDb: Prisma client ownership-scope cho PORTAL PHỤ HUYNH.
//
// Vì sao không dùng scopedDb: actor PARENT không có UserOrgRole → visibleCenterIds=[]
// → scopedDb inject `centerId IN []` = phụ huynh mất sạch dữ liệu con. Portal cách ly
// theo QUAN HỆ SỞ HỮU (Student.parentUserId), không theo cơ sở.
//
// Đây là BELT-AND-SUSPENDERS trên các guard tay sẵn có (requireActiveStudent /
// assertOwnsStudent — lib/portal/session.ts), KHÔNG thay thế chúng:
// - READ trên model có đường sở hữu → tự AND điều-kiện-sở-hữu vào where. Query hiện
//   trạng vốn đã neo studentId đúng ⇒ kết quả KHÔNG đổi; chỉ chặn thêm khi một query
//   tương lai quên neo.
// - Scope theo TẤT CẢ các con (childIds), không theo activeStudent — tin nhắn xem
//   cross-child là tính năng (tin-nhan/page.tsx dùng getPortalContext).
// - WRITE không hook (ownership của write nằm trong DATA + guard tay, giữ nguyên).
// - Model KHÔNG có đường sở hữu (Exam/Assignment/ExamQuestion/ExamAnswer/Survey/
//   EvaluationRound/ClassSessionMedia/User/Class...) → pass-through, guard tay là
//   lớp bảo vệ như hiện trạng (fetch-by-id rồi hậu kiểm — KHÔNG đổi semantics).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type PortalOwner = {
  parentUserId: string;
  /** id MỌI con của phụ huynh (getChildren) — [] = deny-all cho model sở hữu trực tiếp. */
  childIds: string[];
};

/** Model sở hữu TRỰC TIẾP qua cột studentId. */
const DIRECT_STUDENT = new Set([
  "Enrollment",
  "Attendance",
  "ExamAttempt",
  "AssignmentSubmission",
  "MakeupNeed",
  "StudentCareTask",
  "ParentRequest",
  "StudentConsent",
  "StudentSkillAssessment",
  "MediaStudentTag",
]);

/** Model sở hữu qua studentId HOẶC parentUserId (cột phẳng, nullable từng cái). */
const STUDENT_OR_PARENT = new Set(["SurveyResponse", "EvalResponse"]);

/** Model sở hữu GIÁN TIẾP qua relation enrollment → studentId (FK thật, traversal được). */
const VIA_ENROLLMENT = new Set(["ConversationMessage"]);

/** Điều kiện sở hữu cho model, hoặc null = không có đường sở hữu (pass-through). */
export function portalWhereFor(
  model: string,
  owner: PortalOwner,
): Record<string, unknown> | null {
  if (model === "Student") return { parentUserId: owner.parentUserId };
  if (DIRECT_STUDENT.has(model)) return { studentId: { in: owner.childIds } };
  if (STUDENT_OR_PARENT.has(model)) {
    return {
      OR: [{ studentId: { in: owner.childIds } }, { parentUserId: owner.parentUserId }],
    };
  }
  if (VIA_ENROLLMENT.has(model)) {
    return { enrollment: { studentId: { in: owner.childIds } } };
  }
  return null;
}

/**
 * Record trả về từ findUnique có thuộc phụ huynh không.
 * "unknown" = model không hậu-kiểm được (không có đường sở hữu / cần join) → caller
 * pass-through, guard tay chịu trách nhiệm (đúng hiện trạng).
 */
export function portalPassesOwnership(
  model: string,
  record: { studentId?: string | null; parentUserId?: string | null } | null | undefined,
  owner: PortalOwner,
): boolean | "unknown" {
  if (!record) return false;
  if (model === "Student") {
    // Student record: field parentUserId nằm trên chính record.
    return record.parentUserId === owner.parentUserId;
  }
  if (DIRECT_STUDENT.has(model)) {
    return record.studentId != null && owner.childIds.includes(record.studentId);
  }
  if (STUDENT_OR_PARENT.has(model)) {
    return (
      (record.studentId != null && owner.childIds.includes(record.studentId)) ||
      record.parentUserId === owner.parentUserId
    );
  }
  return "unknown"; // VIA_ENROLLMENT + model không map
}

/** Field cần merge vào select để hậu-kiểm findUnique (null = không hậu-kiểm). */
function ownershipSelectFields(model: string): string[] | null {
  if (model === "Student") return ["parentUserId"];
  if (DIRECT_STUDENT.has(model)) return ["studentId"];
  if (STUDENT_OR_PARENT.has(model)) return ["studentId", "parentUserId"];
  return null;
}

function mergeWhere<A>(model: string, args: A, owner: PortalOwner): A {
  const own = portalWhereFor(model, owner);
  if (!own) return args;
  const a = (args ?? {}) as { where?: unknown };
  return { ...a, where: a.where ? { AND: [a.where, own] } : own } as A;
}

type UniqueArgs = { select?: Record<string, unknown> | null } | undefined;
type UniqueQuery = (args: unknown) => Promise<unknown>;

/** findUnique + hậu-kiểm sở hữu, chịu được select hẹp (cùng pattern findUniqueScoped của scopedDb). */
async function findUniqueOwned(
  model: string,
  args: unknown,
  query: UniqueQuery,
  owner: PortalOwner,
): Promise<unknown> {
  const fields = ownershipSelectFields(model);
  if (!fields) return query(args); // pass-through — guard tay lo (đúng hiện trạng)

  const a = args as UniqueArgs;
  const missing = a?.select ? fields.filter((f) => !(f in a.select!)) : [];
  const r = await query(
    missing.length > 0
      ? { ...a, select: { ...a!.select, ...Object.fromEntries(missing.map((f) => [f, true])) } }
      : args,
  );
  const verdict = portalPassesOwnership(
    model,
    r as { studentId?: string | null; parentUserId?: string | null } | null,
    owner,
  );
  if (verdict === false) return null;
  if (missing.length > 0 && r && typeof r === "object") {
    const rest = { ...(r as Record<string, unknown>) };
    for (const f of missing) delete rest[f];
    return rest;
  }
  return r;
}

/**
 * Client portal: READ tự AND điều-kiện-sở-hữu; findUnique hậu-kiểm chống IDOR;
 * WRITE + model không map → pass-through (guard tay như hiện trạng).
 */
export function portalDb(owner: PortalOwner) {
  return db.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async findFirst({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async findFirstOrThrow({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async count({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async aggregate({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async groupBy({ model, args, query }) {
          return query(mergeWhere(model, args, owner));
        },
        async findUnique({ model, args, query }) {
          return findUniqueOwned(model, args, query as UniqueQuery, owner);
        },
      },
    },
  });
}

/**
 * $transaction cho portal — delegate về client GỐC, tx là Prisma.TransactionClient
 * chuẩn (tx của client $extends là kiểu khác → vỡ helper nhận TransactionClient, vd
 * publishEvent({tx}) trong yeu-cau/actions.ts — đúng lỗi đã gặp ở report-cards).
 * Ownership trong transaction do guard tay + data lo (WRITE vốn không hook).
 */
export function portalTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(fn);
}
