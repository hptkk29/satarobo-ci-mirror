// lib/chat/dm.ts — US-13: nhắn riêng 1-1 giữa GIÁO VIÊN và PHỤ HUYNH
// (`ConversationType.DM_TEACHER_PARENT`).
//
// Một chỗ duy nhất sở hữu 3 thứ của DM:
//   1. Công thức `dmKey` (BR-06) — hàm THUẦN, xem {@link dmKeyOf}.
//   2. Định nghĩa "quan hệ dạy học còn hiệu lực" — xem {@link findTeachingClassIds}.
//   3. findOrCreate + mở lại hội thoại cũ (AC2) + chống đua (AC5).
//
// ⚠️ KHÔNG `"use server"` ở đầu file (luật E-bis #1): file này còn export schema, hằng
// và hàm thuần cho test. Cửa cho Client Component là `lib/chat/_actions.ts`.
//
// ⚠️ KHÔNG `import "server-only"` — cùng lý do đã ghi ở `lib/chat/queries.ts`: module
// này phải chạy được dưới `tsx` (script vận hành) và trong cron. Chốt chặn "không lọt
// xuống client" là `@/lib/db`.
//
// ⚠️ ĐỌC/GHI BẰNG `db` TRẦN, KHÔNG `scopedDb` (luật E-bis #5): quan hệ dạy học là dữ
// kiện MỨC HỆ THỐNG. `Class`/`Student`/`Enrollment` ∈ SCOPED_MODELS ⇒ đi qua scopedDb
// thì GV dạy chéo cơ sở, hoặc học viên đã chuyển cơ sở mà còn học lớp cũ, sẽ BIẾN MẤT
// khỏi kết quả ⇒ cặp GV–PH hợp lệ bị chặn im lặng. Mọi truy vấn chạm SCOPED_MODELS đi
// bằng `$queryRaw` tagged template (extension của scopedDb/soft-delete KHÔNG áp lên raw
// — nên `deletedAt IS NULL` phải viết tay).
//
// ⚠️ `Conversation.centerId` của DM LUÔN null (delta E.3) — đó chính là cơ chế chặn
// QLCS/Giáo vụ: họ giữ `chat:read/send` scope CENTER, mà `scopeMatches` (lib/auth/can.ts)
// đòi `target.centerId` ⇒ null là deny. ĐỪNG "gán centerId cho tiện truy vấn admin":
// làm thế là mở cửa cho QLCS đọc 1-1 (test pin: lib/auth/chat-permissions.test.ts).
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Actor, Target } from "@/lib/auth/actor";
import {
  runAction,
  actionFail,
  ActionError,
  type ActionConfig,
  type ActionResult,
} from "@/lib/actions/factory";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { rateLimit } from "@/lib/rate-limit";

/** Tên hiển thị dự phòng của hội thoại 1-1 (tên thật dựng động từ người còn lại). */
export const DM_TITLE = "Nhắn riêng";

/**
 * Trần mở 1-1: 20 lượt/phút/người (delta E.5 — mọi điểm vào chat phải có rate limit).
 *
 * Vì sao con số này và vì sao chặn TRƯỚC khi đọc DB: mỗi lượt `openDm` chạy
 * `loadOpenDmContext` = 1 `user.findFirst` + 2 truy vấn join `Class × Enrollment ×
 * Student` (`resolveTeacherParentRelation`) + 1 `conversation.findUnique`. Nút bấm trên
 * UI có cờ `pending` nhưng nút KHÔNG phải chốt chặn — Server Action gọi thẳng được, nên
 * không có gì cản một vòng lặp bắn `peerUserId` bất kỳ. 20/phút rộng hơn mọi thao tác
 * thật (mở 1-1 là việc hiếm) nhưng đủ để việc quét id trở nên vô nghĩa.
 */
export const OPEN_DM_RATE_MAX = 20;
const OPEN_DM_RATE_WINDOW_MS = 60_000;

/** Dấu nối trong `dmKey`. Đổi giá trị này = phải migrate dữ liệu `Conversation.dmKey`. */
export const DM_KEY_SEPARATOR = ":";

// ─── PHẦN THUẦN (không DB — unit test ở dm.test.ts) ─────────────────────────

/**
 * Loại hội thoại 1-1 mà `dmKeyOf` biết đặt khoá. Trùng tên với `ConversationType`
 * nhưng khai riêng để `dmKeyOf` giữ được tính THUẦN (không import Prisma enum).
 */
export type DmKind = "TEACHER_PARENT" | "SALE_PARENT";

/** Tiền tố loại trong `dmKey`. Đổi giá trị = phải migrate `Conversation.dmKey`. */
export const DM_KIND_PREFIX: Record<DmKind, string> = {
  TEACHER_PARENT: "TP",
  SALE_PARENT: "SP",
};

/**
 * **BR-06** — khoá duy nhất của hội thoại 1-1: **loại + sort 2 `User.id` rồi nối**.
 *
 * Đây là ĐỊNH NGHĨA DUY NHẤT của công thức trong toàn repo — fixture test
 * (`tests/chat/_helpers/seed-chat.ts`) import lại hàm này chứ không chép công thức.
 * Hai bản chép tay lệch nhau = test DM xanh giả (fixture tra một key, code sản phẩm
 * ghi một key khác, không ai thấy).
 *
 * Sắp xếp làm cho khoá ĐỐI XỨNG: `dmKeyOf(a,b) === dmKeyOf(b,a)` ⇒ hai người bấm
 * "Nhắn riêng" cùng lúc va vào CÙNG một unique index (AC5), không sinh 2 hội thoại.
 *
 * ⚠️ VÌ SAO CÓ TIỀN TỐ LOẠI (F5, Đợt 3 — 10/08/2026). Bản P0 cố ý bỏ tiền tố vì chỉ có
 * một loại DM, kèm chỉ dẫn "khi mở DM_SALE_PARENT, nếu CÙNG một cặp user có thể có hai
 * DM khác loại thì thêm phần loại vào khoá Ở ĐÂY + migrate dữ liệu cũ". Điều kiện đó ĐÃ
 * XẢY RA và không phải giả định: repo cho phép đa vai (`User.roles[]`), nên một nhân sự
 * kiêm TEACHER + SALES_CSM với cùng một phụ huynh sẽ đụng đúng một khoá. Hậu quả nếu để
 * nguyên: hai kênh chung một `Conversation`, và `reconcileDmConversations` archive nó khi
 * **hết quan hệ dạy học** — cắt luôn kênh tư vấn còn đang hiệu lực, im lặng.
 *
 * Khoá cũ (`a:b`, không tiền tố) được migration `20260810..._dm_key_kind_prefix` đổi
 * thành `TP:a:b`. Migration idempotent, chỉ chạm dòng `type = 'DM_TEACHER_PARENT'`.
 */
export function dmKeyOf(
  userIdA: string,
  userIdB: string,
  kind: DmKind = "TEACHER_PARENT",
): string {
  const a = typeof userIdA === "string" ? userIdA.trim() : "";
  const b = typeof userIdB === "string" ? userIdB.trim() : "";
  if (!a || !b) throw new Error("dmKeyOf: thiếu userId");
  if (a === b) throw new Error("dmKeyOf: không thể mở hội thoại riêng với chính mình");
  const prefix = DM_KIND_PREFIX[kind];
  if (!prefix) throw new Error(`dmKeyOf: loại DM không hợp lệ (${String(kind)})`);
  return [prefix, ...[a, b].sort()].join(DM_KEY_SEPARATOR);
}

/** Mã lỗi EN + thông điệp VI (quy ước API contract) — client hiện `message` nguyên văn. */
export type DmError = { code: string; message: string };

/** Chiều quan hệ đã xác định: ai là GV, ai là PH, và (các) lớp làm chứng. */
export type TeacherParentRelation = {
  teacherUserId: string;
  parentUserId: string;
  /** Lớp ACTIVE làm chứng cho quan hệ — phần tử đầu dùng làm `target.classId` cho can(). */
  classIds: string[];
};

/**
 * Target cho `can()`. Hàm THUẦN để test được không cần DB.
 *
 * • `createdById = actor.userId` — thủ thuật ĐÃ CÓ TIỀN LỆ ở `sendTargetOf`
 *   (lib/chat/messages.ts): PARENT chỉ giữ `chat:send` scope **OWN**, mà DM có đúng một
 *   `Conversation.createdById` ⇒ nếu lấy giá trị thật thì chỉ NGƯỜI MỞ TRƯỚC qua được
 *   cổng vai, người còn lại nhận PERMISSION_DENIED **trên prod (v2)** trong khi máy local
 *   (v1 tĩnh) vẫn xanh. "Của mình" ở module chat là quan hệ participant, không phải cột
 *   `createdById`. Chốt chặn thật của US-13 là quan hệ dạy học, kiểm trong handler.
 * • `classId` = lớp làm chứng ⇒ TEACHER (scope **ASSIGNED**) khớp vì lớp đó nằm trong
 *   `actor.assignedClassIds`. Không có quan hệ ⇒ null ⇒ GV rụng ngay ở cổng vai.
 * • `centerId` LUÔN null ⇒ QLCS/Giáo vụ (scope CENTER) tự deny (TS-04.6).
 */
export function openDmTargetOf(relation: TeacherParentRelation | null, actor: Actor): Target {
  return {
    createdById: actor.userId,
    classId: relation?.classIds[0] ?? null,
    centerId: null,
  };
}

/** P2002 (unique) — nhận diện theo `code` để không phụ thuộc instanceof (mock được). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

// ─── PHẦN DB ────────────────────────────────────────────────────────────────

type Db = Pick<typeof db, "$queryRaw">;
type Tx = Prisma.TransactionClient;

/**
 * ⭐ ĐỊNH NGHĨA DỨT KHOÁT — "QUAN HỆ DẠY HỌC CÒN HIỆU LỰC" giữa 1 GV và 1 PH:
 *
 *   tồn tại ≥ 1 lớp L thoả ĐỒNG THỜI:
 *     • `L.deletedAt IS NULL` và `L.status = 'ACTIVE'`
 *       (đúng điều kiện sinh nhóm lớp — BR-01: lớp chưa khai giảng / đã kết thúc thì
 *       không có nhóm chat, nên cũng không có cửa nhắn riêng);
 *     • GV là `L.teacherId` **hoặc** `L.assistantId`
 *       (trợ giảng cũng đứng lớp — cùng luật với `computeDerivedMembership`);
 *     • tồn tại học viên S: `S.parentUserId = PH`, `S.deletedAt IS NULL`;
 *     • tồn tại ghi danh E: `E.classId = L.id`, `E.studentId = S.id`,
 *       `E.deletedAt IS NULL`, `E.status ∈ ENROLLMENT_ACTIVE_STATUSES`
 *       (ACTIVE/CONFIRMED/STUDYING/PAUSED — `lib/enrollment-status.ts`).
 *
 * Vì sao dùng CẢ BỘ `ENROLLMENT_ACTIVE_STATUSES` chứ không riêng `CONFIRMED`: đây đúng
 * bộ mà `loadDerivedMembership` dùng để đưa PH vào nhóm lớp. Lấy bộ hẹp hơn sẽ đẻ ra
 * nghịch lý "PH đứng chung nhóm lớp với GV nhưng không được nhắn riêng GV đó" — và
 * PAUSED (bảo lưu) vẫn thuộc lớp theo chốt sẵn có của repo.
 *
 * Trần 20 lớp: chỉ cần BIẾT có quan hệ hay không + một lớp làm chứng cho `target.classId`.
 */
export async function findTeachingClassIds(
  teacherUserId: string,
  parentUserId: string,
  client: Db = db,
): Promise<string[]> {
  if (!teacherUserId || !parentUserId || teacherUserId === parentUserId) return [];
  // RAW có chủ đích — xem khối "BẪY scopedDb" đầu file. `e."deletedAt" IS NULL` và
  // `s."deletedAt" IS NULL` viết tay vì raw không qua extension soft-delete.
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT cl."id"
    FROM "Class" cl
    JOIN "Enrollment" e ON e."classId" = cl."id"
    JOIN "Student" s ON s."id" = e."studentId"
    WHERE cl."deletedAt" IS NULL
      AND cl."status" = 'ACTIVE'::"ClassStatus"
      AND (cl."teacherId" = ${teacherUserId} OR cl."assistantId" = ${teacherUserId})
      AND e."deletedAt" IS NULL
      AND e."status" = ANY(${ENROLLMENT_ACTIVE_STATUS_LIST}::"EnrollmentStatus"[])
      AND s."deletedAt" IS NULL
      AND s."parentUserId" = ${parentUserId}
    ORDER BY cl."id" ASC
    LIMIT 20
  `;
  return rows.map((r) => r.id);
}

/**
 * ⭐ ĐỊNH NGHĨA DỨT KHOÁT — "SALE ĐANG PHỤ TRÁCH PHỤ HUYNH NÀY" (F5, giai đoạn 1):
 *
 *   tồn tại ≥ 1 ghi danh E thoả ĐỒNG THỜI:
 *     • `E.saleId = sale` — cột này gán từ `Lead.assignedToId` lúc convert và sửa được
 *       ở màn học viên của lớp; nó LÀ định nghĩa "tệp của sale" trong repo;
 *     • `E.deletedAt IS NULL`, `E.status ∈ ENROLLMENT_ACTIVE_STATUSES`;
 *     • học viên S: `E.studentId = S.id`, `S.deletedAt IS NULL`, `S.parentUserId = PH`.
 *
 * ⚠️ KHÔNG ràng `Class.status = 'ACTIVE'` như quan hệ dạy học. Có chủ đích: kênh tư vấn
 * sống theo PHÂN CÔNG CHĂM SÓC, không theo việc lớp đã khai giảng hay chưa — ghi danh
 * `PENDING`/`CONFIRMED` (chờ xếp lớp, đã xếp chưa học) chính là lúc phụ huynh cần hỏi
 * sale nhất. Ràng thêm điều kiện lớp sẽ đóng kênh đúng lúc nó có ích nhất.
 *
 * ⚠️ Chốt phạm vi 10/08/2026 (chủ dự án): "tệp mình" = **CHỈ phụ huynh mình được gán**,
 * KHÔNG mở sang lead dùng chung của cơ sở (`Lead.isSharedWithTeam`). Lead dùng chung thì
 * trao đổi trong nhóm lớp, không đẻ thêm kênh riêng. Đừng nới ở đây mà không có quyết
 * định mới — nới ra là nhiều sale cùng nhắn riêng một phụ huynh.
 *
 * ⚠️ Giai đoạn 1 chỉ phục vụ phụ huynh ĐÃ CÓ TÀI KHOẢN. Lead chưa chuyển đổi không có
 * `User` nào (trial gắn vào `LeadChild`, không phải `Student`) — xem đặc tả giai đoạn 2.
 */
export async function findSaleAssignedEnrollmentIds(
  saleUserId: string,
  parentUserId: string,
  client: Db = db,
): Promise<string[]> {
  if (!saleUserId || !parentUserId || saleUserId === parentUserId) return [];
  // RAW có chủ đích — `Enrollment`/`Student` ∈ SCOPED_MODELS, xem khối "BẪY scopedDb"
  // đầu file: sale phụ trách học viên đã chuyển cơ sở vẫn phải giữ được kênh.
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT e."id"
    FROM "Enrollment" e
    JOIN "Student" s ON s."id" = e."studentId"
    WHERE e."saleId" = ${saleUserId}
      AND e."deletedAt" IS NULL
      AND e."status" = ANY(${ENROLLMENT_ACTIVE_STATUS_LIST}::"EnrollmentStatus"[])
      AND s."deletedAt" IS NULL
      AND s."parentUserId" = ${parentUserId}
    ORDER BY e."id" ASC
    LIMIT 20
  `;
  return rows.map((r) => r.id);
}

/** Một tư vấn viên đang phụ trách phụ huynh này (F5, chiều PH → sale). */
export type SaleOfParent = {
  saleUserId: string;
  saleName: string | null;
  /** Tên các con đang được sale này phụ trách — để PH biết ai là ai khi có nhiều sale. */
  childNames: string[];
};

/**
 * ⭐ Chiều NGƯỢC của {@link findSaleAssignedEnrollmentIds}: phụ huynh chưa biết sale nào
 * phụ trách mình, nên lối vào phía portal phải hỏi từ đầu kia.
 *
 * ⚠️ TRẢ VỀ MỘT DANH SÁCH, KHÔNG phải `sale | null`. Một phụ huynh có nhiều con, mỗi con
 * nhiều ghi danh, mỗi ghi danh có `saleId` độc lập ⇒ **hai sale khác nhau là chuyện bình
 * thường**, không phải dữ liệu hỏng. Ép về một người là tự tay giấu mất một kênh.
 *
 * ⚠️ Điều kiện lọc phải TRÙNG KHÍT `findSaleAssignedEnrollmentIds` (cùng
 * `ENROLLMENT_ACTIVE_STATUS_LIST`, cùng `deletedAt IS NULL`, và cố ý KHÔNG ràng
 * `Class.status`). Lệch một điều kiện là nút hiện ra mà server từ chối — hoặc ngược lại.
 *
 * ⚠️ Lọc `u."deletedAt" IS NULL AND u."isActive" = true` vì `loadOpenDmContext` cũng đòi
 * đúng thế: thiếu là hiện nút cho sale đã nghỉ việc rồi bấm vào báo "Không tìm thấy
 * người này".
 *
 * RAW có chủ đích — `Enrollment`/`Student` ∈ SCOPED_MODELS (xem khối "BẪY scopedDb" đầu
 * file): học viên chuyển cơ sở vẫn phải giữ được kênh với sale cũ.
 */
export async function listSalesForParent(
  parentUserId: string,
  client: Db = db,
): Promise<SaleOfParent[]> {
  if (!parentUserId) return [];
  const rows = await client.$queryRaw<
    { saleUserId: string; saleName: string | null; childName: string | null }[]
  >`
    SELECT DISTINCT e."saleId" AS "saleUserId", u."name" AS "saleName", s."name" AS "childName"
    FROM "Enrollment" e
    JOIN "Student" s ON s."id" = e."studentId"
    JOIN "User" u ON u."id" = e."saleId"
    WHERE e."saleId" IS NOT NULL
      AND e."deletedAt" IS NULL
      AND e."status" = ANY(${ENROLLMENT_ACTIVE_STATUS_LIST}::"EnrollmentStatus"[])
      AND s."deletedAt" IS NULL
      AND s."parentUserId" = ${parentUserId}
      AND u."deletedAt" IS NULL
      AND u."isActive" = true
    ORDER BY u."name" ASC NULLS LAST
    LIMIT 20
  `;
  const byId = new Map<string, SaleOfParent>();
  for (const r of rows) {
    const cur = byId.get(r.saleUserId);
    if (cur) {
      if (r.childName && !cur.childNames.includes(r.childName)) cur.childNames.push(r.childName);
      continue;
    }
    byId.set(r.saleUserId, {
      saleUserId: r.saleUserId,
      saleName: r.saleName,
      childNames: r.childName ? [r.childName] : [],
    });
  }
  return [...byId.values()];
}

/**
 * Người này có phải GV/trợ giảng CỦA CHÍNH LỚP NÀY không — dùng để quyết định nút
 * "Nhắn riêng" trong danh sách thành viên nhóm lớp mở loại kênh nào.
 *
 * Cố ý KHÔNG dùng `actor.assignedClassIds`: tập đó nạp theo request và đã lọc `deletedAt`,
 * nhưng ở đây ta chỉ cần một câu trả lời đúng-sai cho MỘT lớp, và đặt cạnh
 * `findTeachingClassIds` để định nghĩa "GV của lớp" chỉ có một chỗ.
 */
export async function isTeacherOfClass(
  classId: string | null,
  userId: string,
  client: Db = db,
): Promise<boolean> {
  if (!classId || !userId) return false;
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT cl."id" FROM "Class" cl
    WHERE cl."id" = ${classId}
      AND cl."deletedAt" IS NULL
      AND (cl."teacherId" = ${userId} OR cl."assistantId" = ${userId})
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Một phụ huynh mà sale được gán — dữ liệu cho ô tìm kiếm ở màn Tin nhắn. */
export type AssignableParent = {
  parentUserId: string;
  parentName: string | null;
  /** "Bé An · Sata3 CS1" — GHI RÕ LỚP để phân biệt hai phụ huynh trùng tên. */
  childLabels: string[];
};

/**
 * Danh sách phụ huynh mà SALE đang được gán, kèm tên con + TÊN LỚP.
 *
 * Vì sao kèm tên lớp: trùng tên phụ huynh là chuyện thường, và sale nhớ học viên theo lớp.
 * Thiếu nó thì ô tìm kiếm trả về hai dòng giống hệt nhau, chọn bừa là nhắn nhầm người.
 *
 * Điều kiện lọc TRÙNG KHÍT `findSaleAssignedEnrollmentIds` (cùng bộ trạng thái, cùng
 * `deletedAt IS NULL`, cố ý KHÔNG ràng `Class.status`) — lệch một điều kiện là danh sách
 * hiện tên mà server từ chối mở.
 */
export async function listAssignableParentsForSale(
  saleUserId: string,
  client: Db = db,
): Promise<AssignableParent[]> {
  if (!saleUserId) return [];
  const rows = await client.$queryRaw<
    { parentUserId: string; parentName: string | null; childName: string | null; className: string | null }[]
  >`
    SELECT DISTINCT s."parentUserId" AS "parentUserId",
           u."name"  AS "parentName",
           s."name"  AS "childName",
           cl."name" AS "className"
    FROM "Enrollment" e
    JOIN "Student" s ON s."id" = e."studentId"
    JOIN "User" u ON u."id" = s."parentUserId"
    LEFT JOIN "Class" cl ON cl."id" = e."classId"
    WHERE e."saleId" = ${saleUserId}
      AND e."deletedAt" IS NULL
      AND e."status" = ANY(${ENROLLMENT_ACTIVE_STATUS_LIST}::"EnrollmentStatus"[])
      AND s."deletedAt" IS NULL
      AND s."parentUserId" IS NOT NULL
      AND u."deletedAt" IS NULL
      AND u."isActive" = true
    ORDER BY u."name" ASC NULLS LAST
    LIMIT 500
  `;
  const byId = new Map<string, AssignableParent>();
  for (const r of rows) {
    const label = [r.childName, r.className].filter(Boolean).join(" · ");
    const cur = byId.get(r.parentUserId);
    if (cur) {
      if (label && !cur.childLabels.includes(label)) cur.childLabels.push(label);
      continue;
    }
    byId.set(r.parentUserId, {
      parentUserId: r.parentUserId,
      parentName: r.parentName,
      childLabels: label ? [label] : [],
    });
  }
  return [...byId.values()];
}

/** Chiều quan hệ đã xác định của F5: ai là sale, ai là PH. */
export type SaleParentRelation = {
  saleUserId: string;
  parentUserId: string;
  /** Ghi danh làm chứng cho phân công — chỉ để ghi audit, KHÔNG dùng làm target scope. */
  enrollmentIds: string[];
};

/**
 * Xác định chiều quan hệ sale–PH giữa 2 user bất kỳ. `null` = không còn phân công nào
 * ⇒ không mở được 1-1; hội thoại cũ chuyển ARCHIVED.
 *
 * Thử CẢ HAI chiều vì hàm phục vụ cả nút bấm phía sale lẫn phía phụ huynh (F5 là kênh
 * HAI CHIỀU theo PRD: "sale mở với PH thuộc tệp mình; PH mở với đúng sale được gán").
 */
export async function resolveSaleParentRelation(
  userA: string,
  userB: string,
  client: Db = db,
): Promise<SaleParentRelation | null> {
  if (!userA || !userB || userA === userB) return null;
  const [aIsSale, bIsSale] = await Promise.all([
    findSaleAssignedEnrollmentIds(userA, userB, client),
    findSaleAssignedEnrollmentIds(userB, userA, client),
  ]);
  if (aIsSale.length > 0) {
    return { saleUserId: userA, parentUserId: userB, enrollmentIds: aIsSale };
  }
  if (bIsSale.length > 0) {
    return { saleUserId: userB, parentUserId: userA, enrollmentIds: bIsSale };
  }
  return null;
}

/**
 * Xác định chiều quan hệ giữa 2 user bất kỳ: ai là GV, ai là PH. `null` = KHÔNG có
 * quan hệ dạy học nào còn hiệu lực (⇒ không mở được 1-1; hội thoại cũ chuyển ARCHIVED).
 *
 * Thử CẢ HAI chiều vì hàm này phục vụ cả nút bấm phía PH lẫn phía GV. Trường hợp cả hai
 * chiều đều có (A dạy con của B, đồng thời B dạy con của A — GV có con học ở trung tâm)
 * thì lấy chiều `userA là GV`: người bấm nút đứng ở vai nào không đổi kết quả cuối
 * (cùng `dmKey`, cùng một hội thoại), chỉ ảnh hưởng lớp làm chứng.
 */
export async function resolveTeacherParentRelation(
  userA: string,
  userB: string,
  client: Db = db,
): Promise<TeacherParentRelation | null> {
  if (!userA || !userB || userA === userB) return null;
  const [aTeaches, bTeaches] = await Promise.all([
    findTeachingClassIds(userA, userB, client),
    findTeachingClassIds(userB, userA, client),
  ]);
  if (aTeaches.length > 0) {
    return { teacherUserId: userA, parentUserId: userB, classIds: aTeaches };
  }
  if (bTeaches.length > 0) {
    return { teacherUserId: userB, parentUserId: userA, classIds: bTeaches };
  }
  return null;
}

/**
 * ⭐ LỚP LÀM CHỨNG của một hội thoại 1-1 — `target.classId` cho `can()` khi thao tác
 * diễn ra TRONG hội thoại (gửi tin, thu hồi tin), không phải lúc mở nó.
 *
 * VÌ SAO PHẢI CÓ (bug đã đo 09/08, US-13 "hộp câm một chiều"): hội thoại 1-1 có
 * `subjectType = NONE` ⇒ mọi hàm suy target theo `subjectId` trả `classId = null`, mà
 * TEACHER/ASSISTANT_TEACHER chỉ giữ `chat:send` scope **ASSIGNED** (`prisma/seed-roles.ts`)
 * và `scopeMatches` (lib/auth/can.ts) đòi `target.classId ∈ assignedClassIds`. Kết quả:
 * PH gửi được (scope OWN khớp), GV nhận `PERMISSION_DENIED` — trái ma trận
 * `docs/chat-realtime/permissions.md` ("1-1 · Gửi · GV = ✅ khi ACTIVE").
 *
 * Trả về lớp mà CHÍNH `actorUserId` đang dạy con của người còn lại. Chỉ hỏi một chiều
 * (không dùng `resolveTeacherParentRelation`) vì `classId` chỉ có tác dụng cho scope
 * ASSIGNED — tức chỉ khi người thao tác là GV; phụ huynh vốn đi cửa OWN.
 *
 * `null` = không có quan hệ dạy học còn hiệu lực ⇒ GV rụng ở cổng vai (FAIL-CLOSED,
 * đúng AC3: quan hệ hết thì 1-1 chỉ còn đọc). PH không bị ảnh hưởng.
 */
export async function dmWitnessClassId(
  conversationId: string,
  actorUserId: string,
  client: Db = db,
): Promise<string | null> {
  if (!conversationId || !actorUserId) return null;
  // Người còn lại của hội thoại. Lấy CẢ bản ghi đã `leftAt` (ưu tiên bản còn hiệu lực):
  // hai người đó vẫn là hai đầu của 1-1, giống `reconcileDmConversations`.
  const peers = await client.$queryRaw<{ userId: string }[]>`
    SELECT p."userId"
    FROM "ConversationParticipant" p
    WHERE p."conversationId" = ${conversationId}
      AND p."userId" <> ${actorUserId}
    ORDER BY p."leftAt" NULLS FIRST, p."joinedAt" ASC
    LIMIT 1
  `;
  const peerUserId = peers[0]?.userId;
  if (!peerUserId) return null;
  const classIds = await findTeachingClassIds(actorUserId, peerUserId, client);
  return classIds[0] ?? null;
}

// ─── findOrCreate (AC2 + AC5) ───────────────────────────────────────────────

export type OpenedDm = {
  conversationId: string;
  /** ACTIVE | ARCHIVED | LOCKED — UI dùng để bật/tắt ô nhập. */
  status: string;
  /** true = vừa tạo mới; false = dùng lại hội thoại đã có (AC2). */
  created: boolean;
  /** true = hội thoại cũ đang ARCHIVED, vừa được mở lại (AC2). */
  reopened: boolean;
  peerUserId: string;
  /** Tên người còn lại — UI hiện ngay khi điều hướng, không phải hỏi lại. */
  peerName: string | null;
};

/**
 * Bảo đảm CẢ HAI người có bản ghi participant còn hiệu lực. Chạy trong tx của caller.
 *
 * `source = MANUAL` có chủ đích: participant của DM KHÔNG do
 * `syncConversationMembership` dẫn xuất (service đó chỉ đụng `CLASS_GROUP`). Nhãn MANUAL
 * còn là lớp bảo hiểm: mọi job đối soát đều bỏ qua MANUAL (BR-15), nên không job nào có
 * thể "dọn" thành viên 1-1.
 */
async function ensureDmParticipants(
  tx: Tx,
  conversationId: string,
  userIds: readonly string[],
): Promise<void> {
  const rows = await tx.conversationParticipant.findMany({
    where: { conversationId, userId: { in: [...userIds] } },
    select: { id: true, userId: true, leftAt: true },
  });
  const byUserId = new Map(rows.map((r) => [r.userId, r]));
  for (const userId of userIds) {
    const cur = byUserId.get(userId);
    if (!cur) {
      await tx.conversationParticipant.create({
        data: {
          conversationId,
          userId,
          role: "MEMBER",
          source: "MANUAL",
          derivedFrom: null,
        },
      });
    } else if (cur.leftAt !== null) {
      // Mở lại bản ghi CŨ (không tạo bản ghi thứ hai — unique(conversationId,userId)),
      // giữ nguyên `joinedAt` để lịch sử đọc được đúng như trước.
      await tx.conversationParticipant.update({
        where: { id: cur.id },
        data: { leftAt: null },
      });
    }
  }
}

/**
 * Dùng lại hội thoại đã có (AC2): ARCHIVED → ACTIVE, `archivedAt` về null, lịch sử tin
 * GIỮ NGUYÊN (không xoá, không tạo hội thoại thứ hai).
 *
 * LOCKED thì KHÔNG tự mở: khoá là quyết định của Admin (US-15) và nó thắng luồng nghiệp
 * vụ — cùng luật đã áp cho nhóm lớp (`syncConversationMembership`). Hội thoại vẫn được
 * trả về để người dùng đọc lịch sử; ô nhập tự vô hiệu theo `status`.
 */
async function reuseDmConversation(
  conversation: { id: string; status: string },
  userIds: readonly string[],
): Promise<{ conversationId: string; status: string; created: false; reopened: boolean }> {
  const reopened = conversation.status === "ARCHIVED";
  await db.$transaction(async (tx) => {
    if (reopened) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: "ACTIVE", archivedAt: null },
      });
    }
    await ensureDmParticipants(tx as Tx, conversation.id, userIds);
  });
  return {
    conversationId: conversation.id,
    status: reopened ? "ACTIVE" : conversation.status,
    created: false,
    reopened,
  };
}

/**
 * findOrCreate hội thoại 1-1 theo `dmKey`.
 *
 * **AC5 — hai người bấm cùng lúc**: KHÔNG dùng "kiểm rồi tạo" (hai request song song đều
 * thấy "chưa có" rồi cùng tạo). Chốt chặn là **UNIQUE `Conversation.dmKey`** + bắt
 * `P2002` rồi ĐỌC LẠI. Việc bắt P2002 nằm NGOÀI transaction có chủ đích: Postgres đánh
 * dấu transaction hỏng ngay khi một câu lệnh lỗi, nên mọi truy vấn sau đó trong CÙNG tx
 * đều chết ("current transaction is aborted") — tiền lệ đã ghi ở `lib/chat/messages.ts`.
 */
async function findOrCreateDm(
  actorUserId: string,
  peerUserId: string,
  dmKey: string,
  kind: DmKind = "TEACHER_PARENT",
): Promise<OpenedDm> {
  const userIds = [actorUserId, peerUserId] as const;
  const conversationType =
    kind === "SALE_PARENT" ? ("DM_SALE_PARENT" as const) : ("DM_TEACHER_PARENT" as const);

  const found = await db.conversation.findUnique({
    where: { dmKey },
    select: { id: true, status: true },
  });
  if (found) {
    return { ...(await reuseDmConversation(found, userIds)), peerUserId, peerName: null };
  }

  try {
    const conv = await db.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          type: conversationType,
          subjectType: "NONE",
          subjectId: null,
          dmKey,
          // centerId/orgUnitId = null: DM không thuộc cơ sở nào (delta E.3) — xem đầu file.
          centerId: null,
          orgUnitId: null,
          status: "ACTIVE",
          title: DM_TITLE,
          createdById: actorUserId,
        },
        select: { id: true, status: true },
      });
      await ensureDmParticipants(tx as Tx, created.id, userIds);
      return created;
    });
    return {
      conversationId: conv.id,
      status: conv.status,
      created: true,
      reopened: false,
      peerUserId,
      peerName: null,
    };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Người kia vừa tạo xong trong lúc ta đang tạo → đọc lại chính hội thoại đó.
    const raced = await db.conversation.findUnique({
      where: { dmKey },
      select: { id: true, status: true },
    });
    if (!raced) throw err;
    return { ...(await reuseDmConversation(raced, userIds)), peerUserId, peerName: null };
  }
}

/**
 * **AC3** — quan hệ dạy học hết hiệu lực ⇒ hội thoại chuyển ARCHIVED (đọc được, KHÔNG
 * gửi được — guard gửi tin đã có sẵn ở `lib/chat/messages.ts`). Idempotent.
 * LOCKED giữ nguyên (khoá của Admin thắng).
 */
async function archiveDmConversation(conversationId: string): Promise<boolean> {
  const res = await db.conversation.updateMany({
    where: { id: conversationId, status: "ACTIVE" },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  return res.count > 0;
}

/** SYSTEM message ghi lại vì sao hội thoại đóng — người dùng thấy lý do, không "tự dưng câm". */
const DM_ARCHIVED_SYSTEM_TEXT: Record<DmKind, string> = {
  TEACHER_PARENT: "Quan hệ dạy học đã kết thúc — hội thoại chuyển sang chế độ chỉ đọc.",
  SALE_PARENT: "Bạn không còn được phụ trách chăm sóc — hội thoại chuyển sang chế độ chỉ đọc.",
};

/**
 * ĐƯỜNG DUY NHẤT đóng một 1-1 vì hết quan hệ dạy học — dùng CHUNG cho cả hai lối:
 * job đêm ({@link reconcileDmConversations}) và lối tức thời trong `openDm`.
 *
 * Trước 09/08 hai lối làm hai kiểu: cron archive + ghi SYSTEM message, còn `openDm`
 * chỉ archive rồi ném lỗi ⇒ hội thoại đột ngột thành chỉ-đọc mà trong luồng không có
 * dòng nào giải thích — đúng cái "tự dưng câm" mà tin SYSTEM được viết ra để tránh.
 * Gộp lại đây để không thể lệch lần nữa. Idempotent: đã ARCHIVED thì trả `false` và
 * KHÔNG ghi thêm tin SYSTEM thứ hai.
 */
async function archiveDmForEndedRelation(
  conversationId: string,
  kind: DmKind = "TEACHER_PARENT",
): Promise<boolean> {
  const archived = await archiveDmConversation(conversationId);
  if (!archived) return false;
  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      kind: "SYSTEM",
      senderId: null,
      body: DM_ARCHIVED_SYSTEM_TEXT[kind],
    },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });
  return true;
}

// ─── ActionConfig ───────────────────────────────────────────────────────────

export const openDmSchema = z.object({
  /** `User.id` (cuid) của người còn lại — GV nếu người bấm là PH và ngược lại. */
  peerUserId: z.string().trim().min(1, "Thiếu người nhận").max(64, "Người nhận không hợp lệ"),
  /**
   * Loại kênh muốn mở. Người gọi phải nói RÕ, không để hệ thống đoán: một nhân sự kiêm
   * TEACHER + SALES_CSM có thể có ĐỒNG THỜI hai quan hệ với cùng một phụ huynh, và từ
   * F5 trở đi đó là HAI hội thoại khác nhau (khoá khác nhau). Đoán hộ là có ngày tin
   * tư vấn rơi vào kênh dạy học. Mặc định giữ hành vi cũ của nút "Nhắn riêng" ở nhóm lớp.
   */
  kind: z.enum(["TEACHER_PARENT", "SALE_PARENT"]).optional().default("TEACHER_PARENT"),
});

export type OpenDmInput = z.infer<typeof openDmSchema>;

/** Ngữ cảnh nạp TRƯỚC `runAction` (target của can() cần đọc DB — xem messages.ts). */
export type OpenDmContext = {
  peerUserId: string;
  peerName: string | null;
  /** null = người này không tồn tại / đã khoá / đã xoá. */
  peerExists: boolean;
  kind: DmKind;
  dmKey: string | null;
  /** Quan hệ dạy học — chỉ nạp khi `kind = TEACHER_PARENT`. */
  relation: TeacherParentRelation | null;
  /** Phân công chăm sóc — chỉ nạp khi `kind = SALE_PARENT` (F5). */
  saleRelation: SaleParentRelation | null;
  existing: { id: string; status: string } | null;
};

/** `User.id` là cuid — chỉ nhận ký tự an toàn, sai dạng thì để zod báo VALIDATION. */
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Loại kênh lấy từ input THÔ (trước zod) — cùng lý do với `extractPeerUserId`: target của
 * `can()` phải dựng TRƯỚC `runAction`, mà lúc đó input chưa qua schema. Giá trị lạ → về
 * mặc định `TEACHER_PARENT`; zod vẫn là chốt chặn thật và sẽ trả VALIDATION.
 */
function extractDmKind(raw: unknown): DmKind {
  if (typeof raw !== "object" || raw === null) return "TEACHER_PARENT";
  const v = (raw as { kind?: unknown }).kind;
  return v === "SALE_PARENT" ? "SALE_PARENT" : "TEACHER_PARENT";
}

function extractPeerUserId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { peerUserId?: unknown }).peerUserId;
  return typeof v === "string" && USER_ID_RE.test(v.trim()) ? v.trim() : null;
}

export async function loadOpenDmContext(
  actorUserId: string,
  peerUserId: string,
  kind: DmKind = "TEACHER_PARENT",
): Promise<OpenDmContext> {
  const empty: OpenDmContext = {
    peerUserId,
    peerName: null,
    peerExists: false,
    kind,
    dmKey: null,
    relation: null,
    saleRelation: null,
    existing: null,
  };
  if (!peerUserId || peerUserId === actorUserId) return empty;

  // `User` ∈ SCOPE_EXEMPT → Prisma API an toàn (không dính BẪY scopedDb).
  const peer = await db.user.findFirst({
    where: { id: peerUserId, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!peer) return empty;

  const dmKey = dmKeyOf(actorUserId, peerUserId, kind);
  // Chỉ hỏi ĐÚNG quan hệ của loại đang mở — hỏi cả hai là tốn 2 truy vấn join cho một
  // câu trả lời không ai dùng.
  const [relation, saleRelation, existing] = await Promise.all([
    kind === "TEACHER_PARENT" ? resolveTeacherParentRelation(actorUserId, peerUserId) : null,
    kind === "SALE_PARENT" ? resolveSaleParentRelation(actorUserId, peerUserId) : null,
    db.conversation.findUnique({ where: { dmKey }, select: { id: true, status: true } }),
  ]);
  return {
    peerUserId,
    peerName: peer.name,
    peerExists: true,
    kind,
    dmKey,
    relation,
    saleRelation,
    existing,
  };
}

function buildOpenDmConfig(
  ctx: OpenDmContext,
  actor: Actor,
  actorName: string,
): ActionConfig<OpenDmInput, OpenedDm> {
  return {
    name: "chat.openDm",
    // Quyền dùng `chat:send` chứ không phải một action mới: mở 1-1 chính là mở đường
    // GỬI tin riêng, và bộ vai của `chat:send` đã đúng ma trận permissions.md cho DM
    // (PH ✅ OWN · GV ✅ ASSIGNED · QLCS/Giáo vụ ❌ vì CENTER trượt trên centerId=null ·
    // Sale ❌ vì không có action nào). Thêm quyền mới sẽ phải seed lại RolePermission
    // trên prod (delta mục G) mà không được lợi gì.
    permission: "chat:send",
    schema: openDmSchema,
    target: () => openDmTargetOf(ctx.relation, actor),
    module: "chat",
    entityType: "Conversation",
    auditAction: ctx.existing ? "UPDATE" : "CREATE",
    handler: async () => {
      if (ctx.peerUserId === actor.userId) {
        throw new ActionError("DM_SELF", "Không thể mở hội thoại riêng với chính mình.");
      }
      if (!ctx.peerExists || !ctx.dmKey) {
        throw new ActionError("PEER_NOT_FOUND", "Không tìm thấy người này.");
      }

      // ── AC3: quan hệ nền của kênh không còn hiệu lực ──
      // F5: kênh tư vấn sống theo PHÂN CÔNG (`Enrollment.saleId`), kênh dạy học sống theo
      // quan hệ dạy học. Hai loại, hai điều kiện — nhưng CÙNG một cách đóng, để lối tức
      // thời và job đêm không bao giờ lệch nhau.
      const relationAlive =
        ctx.kind === "SALE_PARENT" ? ctx.saleRelation !== null : ctx.relation !== null;
      if (!relationAlive) {
        // Hội thoại cũ (nếu có) chuyển ARCHIVED NGAY tại đây, không đợi job đêm:
        // đọc được, không gửi được. Không có rủi ro bên thứ ba — `ctx` được khoá theo
        // đúng cặp (actor, peer), và cổng vai `can()` đã chạy trước handler.
        //
        // ⚠️ AUDIT PHẢI GHI TẠI CHỖ: nhánh này ném `ActionError` ngay dưới, mà
        // `runAction` chỉ `writeAudit` ở BƯỚC 5 (sau handler) — tức đường này đổi
        // trạng thái hội thoại ACTIVE→ARCHIVED mà không để lại một dòng nhật ký nào.
        // Đi cùng `archiveDmForEndedRelation` để lối tức thời và job đêm để lại CÙNG
        // một hiện trạng (tin SYSTEM giải thích lý do).
        if (ctx.existing) {
          const archived = await archiveDmForEndedRelation(ctx.existing.id, ctx.kind);
          if (archived) {
            try {
              await writeAudit({
                actor: { id: actor.userId, name: actorName },
                module: "chat",
                entityType: "Conversation",
                entityId: ctx.existing.id,
                action: "UPDATE",
                oldValues: { status: "ACTIVE" },
                newValues: {
                  status: "ARCHIVED",
                  cause:
                    ctx.kind === "SALE_PARENT"
                      ? "SALE_ASSIGNMENT_ENDED"
                      : "TEACHING_RELATION_ENDED",
                },
                // DM không thuộc đơn vị nào ⇒ chỉ scope "ALL" (SUPER_ADMIN) thấy lại
                // dòng này trong /admin/audit-log. Có chủ đích, như mọi audit của DM.
                orgUnitId: null,
              });
            } catch (err) {
              // Audit hỏng KHÔNG được biến một câu "hết quan hệ dạy học" thành 500:
              // việc archive đã commit, người dùng vẫn phải nhận đúng mã lỗi bên dưới.
              console.error("[chat/openDm] ghi audit archive 1-1 lỗi:", err);
            }
          }
        }
        // Mã PERMISSION_DENIED theo QUY ƯỚC MÃ LỖI chốt 09/08 (tests/chat/
        // permission-matrix.spec.ts, TS-04.5): đây là quyết định về quyền, không phải
        // về tư cách thành viên.
        throw new ActionError(
          "PERMISSION_DENIED",
          ctx.kind === "SALE_PARENT"
            ? "Chỉ nhắn riêng được với phụ huynh do bạn phụ trách."
            : "Chỉ nhắn riêng được giữa giáo viên và phụ huynh của lớp đang học.",
        );
      }

      const opened = await findOrCreateDm(actor.userId, ctx.peerUserId, ctx.dmKey, ctx.kind);
      return {
        entityId: opened.conversationId,
        data: { ...opened, peerName: ctx.peerName },
        // KHÔNG ghi nội dung/liên hệ vào AuditLog. `orgUnitId` để null vì DM không
        // thuộc đơn vị nào — hệ quả CÓ CHỦ ĐÍCH: chỉ SUPER_ADMIN (scope "ALL") thấy
        // dòng audit này trong /admin/audit-log.
        newValues: {
          peerUserId: ctx.peerUserId,
          kind: ctx.kind,
          relationClassId: ctx.relation?.classIds[0] ?? null,
          relationEnrollmentId: ctx.saleRelation?.enrollmentIds[0] ?? null,
          created: opened.created,
          reopened: opened.reopened,
          status: opened.status,
        },
        orgUnitId: null,
      };
    },
  };
}

// ─── Lõi + Server Action ────────────────────────────────────────────────────

/**
 * Lõi THUẦN NGỮ CẢNH — nhận Actor đã resolve (test gọi thẳng, không cần phiên).
 *
 * Cố ý KHÔNG có bản "tự `auth()`" trong file này (khác `lib/chat/messages.ts`): import
 * `@/lib/auth` kéo theo `next-auth` → module chết khi chạy ngoài Next (vitest node, tsx,
 * script vận hành) và cả `tests/chat/permission-matrix.spec.ts` cũng không import nổi.
 * Phần ghép phiên nằm ở `lib/chat/_actions.ts` — đúng chỗ biên HTTP.
 */
export async function openDmAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<OpenedDm>> {
  // ⚠️ RATE LIMIT ĐẶT TRƯỚC `loadOpenDmContext`, KHÔNG đặt trong handler: chính
  // `loadOpenDmContext` mới là phần tốn kém (4 truy vấn, 2 trong đó join 3 bảng lớn),
  // mà `runAction` chạy handler SAU khi ta đã nạp ngữ cảnh. Chặn ở trong handler thì
  // trần vẫn có nhưng DB đã ăn đủ tải của mọi lượt gọi.
  const limit = await rateLimit({
    key: `chat:openDm:${actor.userId}`,
    max: OPEN_DM_RATE_MAX,
    windowMs: OPEN_DM_RATE_WINDOW_MS,
  });
  if (!limit.success) {
    const giay = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return actionFail(
      "RATE_LIMITED",
      `Bạn thao tác quá nhanh (tối đa ${OPEN_DM_RATE_MAX} lượt/phút). Vui lòng thử lại sau ${giay} giây.`,
    );
  }

  const peerUserId = extractPeerUserId(rawInput);
  const kind = extractDmKind(rawInput);
  const ctx: OpenDmContext = peerUserId
    ? await loadOpenDmContext(actor.userId, peerUserId, kind)
    : {
        peerUserId: "",
        peerName: null,
        peerExists: false,
        kind,
        dmKey: null,
        relation: null,
        saleRelation: null,
        existing: null,
      };
  const { res } = await runAction(buildOpenDmConfig(ctx, actor, actorName), actor, rawInput, {
    actorName,
  });
  return res;
}

// ─── Đối soát DM (AC3, chạy trong job đêm US-04) ────────────────────────────

export type DmReconcileSummary = {
  /** Số DM ACTIVE đã kiểm. */
  dmChecked: number;
  /** Số DM vừa chuyển ARCHIVED vì hết quan hệ dạy học. */
  dmArchived: number;
  /** DM có số thành viên khác 2 (dữ liệu lạ) — chỉ đếm + log, KHÔNG tự sửa. */
  dmSkipped: number;
};

/**
 * **AC3 (lưới cuối)** — DM còn ACTIVE nhưng cặp GV–PH đã hết quan hệ dạy học ⇒ ARCHIVED.
 *
 * Vì sao nằm ở job đêm chứ không nhét vào `syncConversationMembership`: service đó đồng bộ
 * theo MỘT lớp, trong transaction của thao tác nghiệp vụ; còn quan hệ GV–PH là hợp của
 * MỌI lớp, muốn kết luận "hết quan hệ" phải quét toàn bộ lớp của cặp đó — kéo việc quét ấy
 * vào mọi tx đổi enrollment/phân công là mua thêm rủi ro timeout cho một câu trả lời không
 * cần tức thời. Đường tức thời vẫn có: `openDm` archive ngay khi ai đó bấm "Nhắn riêng"
 * mà quan hệ đã hết.
 *
 * KHÔNG hard delete, KHÔNG gỡ participant (lịch sử vẫn đọc được — BR-03/BR-04).
 */
export async function reconcileDmConversations(opts?: {
  onlyConversationIds?: string[];
}): Promise<DmReconcileSummary> {
  const conversations = await db.conversation.findMany({
    where: {
      // F5 — quét CẢ HAI loại 1-1. Bỏ sót loại mới ở đây là để kênh tư vấn sống mãi
      // sau khi sale đã bị gỡ phân công: đúng lỗ hổng mà AC3 sinh ra để bịt.
      type: { in: ["DM_TEACHER_PARENT", "DM_SALE_PARENT"] },
      status: "ACTIVE",
      ...(opts?.onlyConversationIds ? { id: { in: opts.onlyConversationIds } } : {}),
    },
    select: {
      id: true,
      type: true,
      participants: { select: { userId: true }, orderBy: { joinedAt: "asc" } },
    },
  });

  let dmChecked = 0;
  let dmArchived = 0;
  let dmSkipped = 0;

  for (const conv of conversations) {
    // Lấy CẢ participant đã `leftAt` — hai người đó vẫn là hai đầu của hội thoại.
    const userIds = [...new Set(conv.participants.map((p) => p.userId))];
    if (userIds.length !== 2) {
      dmSkipped += 1;
      console.warn(
        `[chat-reconcile] DM ${conv.id} có ${userIds.length} thành viên (≠2) — bỏ qua, không tự sửa.`,
      );
      continue;
    }
    dmChecked += 1;
    const kind: DmKind = conv.type === "DM_SALE_PARENT" ? "SALE_PARENT" : "TEACHER_PARENT";
    const relation =
      kind === "SALE_PARENT"
        ? await resolveSaleParentRelation(userIds[0] as string, userIds[1] as string)
        : await resolveTeacherParentRelation(userIds[0] as string, userIds[1] as string);
    if (relation) continue;

    const archived = await archiveDmForEndedRelation(conv.id, kind);
    if (!archived) continue;
    dmArchived += 1;
  }

  if (dmArchived > 0) {
    console.log(
      `[chat-reconcile] DM: ${dmArchived}/${dmChecked} chuyển ARCHIVED (hết quan hệ nền: dạy học hoặc phân công chăm sóc).`,
    );
  }
  return { dmChecked, dmArchived, dmSkipped };
}
