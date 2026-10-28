// lib/chat/migrate-legacy.ts — Sóng 3 Đợt 1: chuyển tin nhắn hệ CŨ sang hệ MỚI.
//
// Hệ CŨ  : `ConversationMessage` (LMS-15) — luồng PH ↔ nhân viên gắn theo `enrollmentId`,
//          `authorSide` PARENT/STAFF, đánh dấu đã đọc theo PHÍA (readByParentAt/StaffAt).
// Hệ MỚI : `Conversation` / `ConversationParticipant` / `Message` (Chat Realtime).
//
// Quyết định Q3 (docs/chat-realtime/00-dieu-chinh-cho-repo.md): hệ mới THAY THẾ hệ cũ ở
// Đợt 1, nhưng theo 2-phase — **file này CHỈ ĐỌC bảng cũ, không sửa/xoá một dòng nào**.
// Rollback = xoá `Message` có `clientMsgId LIKE 'legacy:%'` (xem 04-migrate-chat-cu.md).
//
// ⚠️⚠️ HAI ĐIỀU PHẢI BIẾT TRƯỚC KHI BẤM `--apply` ⚠️⚠️
//
// 1. **Riêng tư đổi bản chất.** Hệ cũ: mỗi `enrollmentId` là một luồng RIÊNG giữa PH của
//    ĐÚNG học viên đó và nhân viên. Hệ mới KHÔNG có hội thoại-theo-enrollment: tin phải
//    về nhóm lớp `CLASS_GROUP` của `enrollment.classId`, mà nhóm lớp có MỌI PH của lớp
//    + GV + QLCS. ⇒ Sau khi migrate, **tin cũ vốn riêng tư sẽ hiện với toàn bộ nhóm lớp**.
//    Đây là hệ quả của chính việc "thay hệ cũ bằng hệ mới", không phải lỗi script — nhưng
//    là quyết định của chủ dự án, KHÔNG phải của người chạy script. Plan trả về
//    `classesWithMultipleStudents` để đo trước độ lớn của việc phơi này.
// 2. **Nhóm lớp chỉ tồn tại với lớp ACTIVE** (BR-01, `syncConversationMembership`). Lớp đã
//    COMPLETED/CANCELLED/xoá mềm mà CHƯA từng có nhóm thì migrate KHÔNG có chỗ đổ tin →
//    những tin đó bị đánh `NO_CONVERSATION`, KHÔNG bịa nhóm mới (bịa = tạo nhóm cho lớp
//    đã đóng, trái BR-01 và làm PH thấy nhóm "sống lại"). Muốn giữ lịch sử của lớp đã
//    đóng thì đó là một quyết định riêng, ghi trong doc.
//
// Thiết kế: phần THUẦN (`planLegacyMigration`) tách hẳn khỏi phần DB (`migrateLegacyChat`)
// để unit-test được toàn bộ luật ánh xạ mà không cần Postgres.
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

// ─── PHẦN THUẦN (không DB — unit test được) ─────────────────────────────────

/** Tiền tố `clientMsgId` của tin đã migrate — vừa là khoá idempotent vừa là dấu truy vết. */
export const LEGACY_CLIENT_MSG_PREFIX = "legacy:";

/** `clientMsgId` của một tin cũ. Duy nhất toàn hệ vì `ConversationMessage.id` là cuid. */
export function legacyClientMsgId(legacyMessageId: string): string {
  return `${LEGACY_CLIENT_MSG_PREFIX}${legacyMessageId}`;
}

/** Dòng `ConversationMessage` + quan hệ cần cho việc ánh xạ (khớp 1-1 với include Prisma). */
export type LegacyMessageRow = {
  id: string;
  enrollmentId: string;
  authorUserId: string;
  authorSide: "PARENT" | "STAFF";
  body: string;
  createdAt: Date;
  readByParentAt: Date | null;
  readByStaffAt: Date | null;
  enrollment: {
    id: string;
    studentId: string;
    deletedAt: Date | null;
    student: { id: string; parentUserId: string | null } | null;
    class: {
      id: string;
      name: string | null;
      status: string;
      deletedAt: Date | null;
      teacherId: string | null;
      assistantId: string | null;
    } | null;
  } | null;
};

/** Cách suy ra `senderId` — đi thẳng vào doc vận hành, đừng đổi tên tuỳ tiện. */
export type SenderResolution =
  /** Lấy `authorUserId` mà hệ cũ đã ghi — người gửi THẬT, không suy đoán. */
  | "AUTHOR_RECORDED"
  /** Tin PH nhưng tài khoản tác giả không còn → lấy `student.parentUserId` hiện tại. SUY ĐOÁN. */
  | "PARENT_FALLBACK"
  /** Tin STAFF nhưng tài khoản tác giả không còn → lấy GV chính/trợ giảng của lớp. SUY ĐOÁN. */
  | "CLASS_TEACHER_GUESS";

/** Suy đoán (không phải người gửi thật) — doc phải nêu, UI nên đọc qua `clientMsgId`. */
export const GUESSED_SENDER_RESOLUTIONS: readonly SenderResolution[] = [
  "PARENT_FALLBACK",
  "CLASS_TEACHER_GUESS",
];

export type SkipReason =
  /** Không còn `Enrollment` (FK cascade nên hiếm) → không suy được lớp. */
  | "ENROLLMENT_MISSING"
  /** `Enrollment.deletedAt` khác null: hệ cũ ĐÃ ẩn luồng này (service lọc deletedAt:null).
   *  Migrate = hồi sinh nội dung đã bị ẩn ⇒ cố ý BỎ. */
  | "ENROLLMENT_DELETED"
  /** Không suy được lớp từ enrollment. */
  | "CLASS_MISSING"
  /** Lớp không ACTIVE và chưa từng có nhóm ⇒ `syncConversationMembership` sẽ không dựng. */
  | "NO_CONVERSATION"
  /** Không xác định được người gửi (PH chưa có tài khoản, hoặc user đã xoá) — KHÔNG gán bừa. */
  | "SENDER_UNRESOLVED"
  /** `Message.body` NOT NULL; tin cũ rỗng (dữ liệu ngoài app) không đổ sang được. */
  | "EMPTY_BODY";

export const SKIP_REASONS: readonly SkipReason[] = [
  "ENROLLMENT_MISSING",
  "ENROLLMENT_DELETED",
  "CLASS_MISSING",
  "NO_CONVERSATION",
  "SENDER_UNRESOLVED",
  "EMPTY_BODY",
];

export type PlannedMessage = {
  /** `ConversationMessage.id` gốc. */
  legacyId: string;
  /** Id sinh sẵn cho `Message` — cần để nối `lastReadMessageId` mà không phải đọc lại DB. */
  newMessageId: string;
  classId: string;
  studentId: string;
  senderId: string;
  authorSide: "PARENT" | "STAFF";
  senderResolution: SenderResolution;
  body: string;
  /** GIỮ NGUYÊN mốc gốc — thứ tự lịch sử là thứ quan trọng nhất khi migrate. */
  createdAt: Date;
  clientMsgId: string;
};

/** Mốc "đã đọc" suy được cho MỘT participant. Chỉ suy được cho phía PH (xem doc mục 4). */
export type PlannedRead = {
  classId: string;
  userId: string;
  lastReadAt: Date;
  /**
   * `clientMsgId` (`legacy:<id>`) của tin ĐÃ ĐỌC mới nhất. Cố ý KHÔNG lưu `Message.id`
   * dự kiến: chạy lại lần hai, tin đó đã nằm trong DB với id của lần chạy TRƯỚC, nên
   * `lastReadMessageId` phải tra lại theo `clientMsgId` lúc apply mới trỏ đúng.
   */
  lastReadClientMsgId: string;
};

export type SkippedMessage = {
  legacyId: string;
  classId: string | null;
  reason: SkipReason;
  detail: string;
};

export type PlannedClass = {
  classId: string;
  className: string | null;
  /** Nhóm đã tồn tại → dùng lại (KHÔNG gọi sync để không sinh SYSTEM message/kick event). */
  conversationId: string | null;
  /** Chưa có nhóm nhưng lớp ACTIVE → `syncConversationMembership` sẽ dựng lúc apply. */
  willCreateConversation: boolean;
  messages: PlannedMessage[];
  reads: PlannedRead[];
  /** Số học viên khác nhau có tin trong lớp này — thước đo mức "phơi" riêng tư. */
  distinctStudents: number;
};

export type LegacyMigrationStats = {
  totalRows: number;
  plannedMessages: number;
  /** Đã có `Message` mang đúng `clientMsgId` ⇒ lần chạy trước đã đổ (idempotent). */
  alreadyMigrated: number;
  skipped: number;
  skippedByReason: Record<SkipReason, number>;
  senderResolution: Record<SenderResolution, number>;
  /** Tin có người gửi là SUY ĐOÁN (cần nêu trong báo cáo vận hành). */
  guessedSenders: number;
  classes: number;
  classesReusingConversation: number;
  classesCreatingConversation: number;
  classesWithoutConversation: number;
  /** Lớp có ≥2 học viên từng nhắn → tin của PH này sẽ hiện với PH kia (cảnh báo #1). */
  classesWithMultipleStudents: number;
  plannedReads: number;
};

export type LegacyMigrationPlan = {
  classes: PlannedClass[];
  skipped: SkippedMessage[];
  stats: LegacyMigrationStats;
};

export type LegacyMigrationContext = {
  /** User.id còn tồn tại (deletedAt null). Không có trong tập này = coi như đã xoá. */
  aliveUserIds: ReadonlySet<string>;
  /** Nhóm lớp CLASS_GROUP đã có, tra theo `Class.id`. */
  conversationByClassId: ReadonlyMap<string, { id: string }>;
  /** `clientMsgId` đã nằm trong bảng `Message` — khoá idempotent (xem doc mục 6). */
  migratedClientMsgIds?: ReadonlySet<string>;
  /** Bơm id cho test (mặc định `randomUUID`). */
  newId?: () => string;
};

function emptyCounter<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

const SENDER_RESOLUTIONS: readonly SenderResolution[] = [
  "AUTHOR_RECORDED",
  "PARENT_FALLBACK",
  "CLASS_TEACHER_GUESS",
];

/**
 * Suy `senderId` cho một tin cũ.
 *
 * Hệ cũ ghi `authorUserId` cho CẢ HAI phía (cột NOT NULL) ⇒ đường chính là dùng chính
 * người gửi thật, không phải đoán. Chỉ khi tài khoản đó đã bị xoá mới rơi xuống suy đoán:
 *  • PARENT → `student.parentUserId` (PH hiện tại của em) — nếu cũng không có (PH chưa có
 *    tài khoản) thì trả null ⇒ tin bị đánh `SENDER_UNRESOLVED`, TUYỆT ĐỐI không gán bừa
 *    cho một user nào khác (gán bừa = vu cho người ta câu họ không nói).
 *  • STAFF  → GV chính, rồi trợ giảng của lớp.
 */
export function resolveSender(
  row: LegacyMessageRow,
  aliveUserIds: ReadonlySet<string>,
): { senderId: string; resolution: SenderResolution } | null {
  if (row.authorUserId && aliveUserIds.has(row.authorUserId)) {
    return { senderId: row.authorUserId, resolution: "AUTHOR_RECORDED" };
  }
  if (row.authorSide === "PARENT") {
    const parentUserId = row.enrollment?.student?.parentUserId ?? null;
    if (parentUserId && aliveUserIds.has(parentUserId)) {
      return { senderId: parentUserId, resolution: "PARENT_FALLBACK" };
    }
    return null;
  }
  for (const candidate of [row.enrollment?.class?.teacherId, row.enrollment?.class?.assistantId]) {
    if (candidate && aliveUserIds.has(candidate)) {
      return { senderId: candidate, resolution: "CLASS_TEACHER_GUESS" };
    }
  }
  return null;
}

/**
 * HÀM THUẦN — từ danh sách tin cũ tính ra: mỗi lớp dùng/dựng nhóm nào, tin nào đổ được
 * (kèm người gửi + mốc thời gian gốc), tin nào KHÔNG đổ được và vì sao, mốc "đã đọc" nào
 * suy được. Không chạm DB, không sinh side-effect ⇒ chạy bao nhiêu lần cũng cho cùng kết
 * quả (trừ `newMessageId` — bơm `ctx.newId` khi cần tất định trong test).
 */
export function planLegacyMigration(
  rows: readonly LegacyMessageRow[],
  ctx: LegacyMigrationContext,
): LegacyMigrationPlan {
  const newId = ctx.newId ?? randomUUID;
  const migrated = ctx.migratedClientMsgIds ?? new Set<string>();

  const skipped: SkippedMessage[] = [];
  const byClass = new Map<string, PlannedClass>();
  const studentsByClass = new Map<string, Set<string>>();
  /** classId → userId → mốc đọc lớn nhất + tin tương ứng. */
  const readsByClass = new Map<
    string,
    Map<string, { at: Date; createdAt: Date; clientMsgId: string }>
  >();
  const senderResolution = emptyCounter(SENDER_RESOLUTIONS);
  const skippedByReason = emptyCounter(SKIP_REASONS);
  let alreadyMigrated = 0;

  const skip = (row: LegacyMessageRow, reason: SkipReason, detail: string) => {
    skippedByReason[reason] += 1;
    skipped.push({
      legacyId: row.id,
      classId: row.enrollment?.class?.id ?? null,
      reason,
      detail,
    });
  };

  // Thứ tự thời gian tăng dần: `lastReadMessageId` phải là tin ĐÃ ĐỌC mới nhất, và tin
  // trong `PlannedClass.messages` nên giữ đúng thứ tự lịch sử để đọc log dễ đối chiếu.
  const ordered = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  for (const row of ordered) {
    const enr = row.enrollment;
    if (!enr) {
      skip(row, "ENROLLMENT_MISSING", `Tin ${row.id} không còn enrollment ${row.enrollmentId}.`);
      continue;
    }
    if (enr.deletedAt !== null) {
      skip(
        row,
        "ENROLLMENT_DELETED",
        `Enrollment ${enr.id} đã xoá mềm — hệ cũ đã ẩn luồng này, không hồi sinh sang hệ mới.`,
      );
      continue;
    }
    const cls = enr.class;
    if (!cls) {
      skip(row, "CLASS_MISSING", `Enrollment ${enr.id} không suy được lớp.`);
      continue;
    }

    const existingConv = ctx.conversationByClassId.get(cls.id) ?? null;
    const classActive = cls.status === "ACTIVE" && cls.deletedAt === null;
    if (!existingConv && !classActive) {
      skip(
        row,
        "NO_CONVERSATION",
        `Lớp ${cls.id} (status=${cls.status}${cls.deletedAt ? ", đã xoá mềm" : ""}) chưa có nhóm ` +
          `CLASS_GROUP và syncConversationMembership chỉ dựng nhóm cho lớp ACTIVE (BR-01).`,
      );
      continue;
    }

    const body = (row.body ?? "").trim();
    if (body.length === 0) {
      skip(row, "EMPTY_BODY", `Tin ${row.id} có nội dung rỗng — Message.body không nhận rỗng.`);
      continue;
    }

    const sender = resolveSender(row, ctx.aliveUserIds);
    if (!sender) {
      skip(
        row,
        "SENDER_UNRESOLVED",
        row.authorSide === "PARENT"
          ? `Tin PH ${row.id}: tác giả ${row.authorUserId} không còn và học viên ${enr.studentId} ` +
            `chưa có tài khoản PH (parentUserId null) — không gán bừa cho ai.`
          : `Tin STAFF ${row.id}: tác giả ${row.authorUserId} không còn và lớp ${cls.id} không có ` +
            `GV/trợ giảng còn tài khoản để quy về.`,
      );
      continue;
    }

    let planned = byClass.get(cls.id);
    if (!planned) {
      planned = {
        classId: cls.id,
        className: cls.name,
        conversationId: existingConv?.id ?? null,
        willCreateConversation: !existingConv,
        messages: [],
        reads: [],
        distinctStudents: 0,
      };
      byClass.set(cls.id, planned);
    }
    let studentsOfClass = studentsByClass.get(cls.id);
    if (!studentsOfClass) {
      studentsOfClass = new Set<string>();
      studentsByClass.set(cls.id, studentsOfClass);
    }
    studentsOfClass.add(enr.studentId);

    const clientMsgId = legacyClientMsgId(row.id);

    // Mốc "đã đọc" của PH tính TRƯỚC bộ lọc idempotent: `lastReadClientMsgId` tra id thật
    // lúc apply, nên tin đã migrate ở lần chạy trước vẫn dùng làm mốc được. `readByParentAt`
    // nằm trên tin của STAFF mà PH đã đọc; chủ thể là PH của CHÍNH học viên đó, không phải
    // "phía PARENT" chung chung.
    if (row.authorSide === "STAFF" && row.readByParentAt) {
      const parentUserId = enr.student?.parentUserId ?? null;
      if (parentUserId && ctx.aliveUserIds.has(parentUserId)) {
        let perClass = readsByClass.get(cls.id);
        if (!perClass) {
          perClass = new Map();
          readsByClass.set(cls.id, perClass);
        }
        const cur = perClass.get(parentUserId);
        // So theo createdAt của TIN (mốc trên thanh thời gian hội thoại), không theo
        // readByParentAt: hai tin đọc cùng lúc thì tin mới hơn mới là mốc đã đọc.
        if (!cur || cur.createdAt <= row.createdAt) {
          perClass.set(parentUserId, {
            at: row.readByParentAt,
            createdAt: row.createdAt,
            clientMsgId,
          });
        }
      }
    }
    // `readByStaffAt` KHÔNG suy được về participant nào: hệ cũ đánh dấu theo PHÍA STAFF
    // (một mốc dùng chung cho mọi nhân viên), không ghi ai là người đọc. Bỏ qua — doc mục 4.

    if (migrated.has(clientMsgId)) {
      // Idempotent: lần chạy trước đã đổ tin này → không lên kế hoạch lần hai.
      alreadyMigrated += 1;
      continue;
    }

    senderResolution[sender.resolution] += 1;
    planned.messages.push({
      legacyId: row.id,
      newMessageId: newId(),
      classId: cls.id,
      studentId: enr.studentId,
      senderId: sender.senderId,
      authorSide: row.authorSide,
      senderResolution: sender.resolution,
      body,
      createdAt: row.createdAt,
      clientMsgId,
    });
  }

  for (const [classId, planned] of byClass) {
    planned.distinctStudents = studentsByClass.get(classId)?.size ?? 0;
    const perClass = readsByClass.get(classId);
    if (!perClass) continue;
    for (const [userId, r] of perClass) {
      planned.reads.push({
        classId,
        userId,
        lastReadAt: r.at,
        lastReadClientMsgId: r.clientMsgId,
      });
    }
  }

  // Lớp không còn tin nào để đổ (tất cả đã migrate/skip) thì không cần mở transaction.
  const classes = [...byClass.values()].filter(
    (c) => c.messages.length > 0 || c.reads.length > 0,
  );

  const plannedMessages = classes.reduce((n, c) => n + c.messages.length, 0);
  const stats: LegacyMigrationStats = {
    totalRows: rows.length,
    plannedMessages,
    alreadyMigrated,
    skipped: skipped.length,
    skippedByReason,
    senderResolution,
    guessedSenders: GUESSED_SENDER_RESOLUTIONS.reduce((n, r) => n + senderResolution[r], 0),
    classes: classes.length,
    classesReusingConversation: classes.filter((c) => c.conversationId !== null).length,
    classesCreatingConversation: classes.filter((c) => c.willCreateConversation).length,
    classesWithoutConversation: new Set(
      skipped.filter((s) => s.reason === "NO_CONVERSATION").map((s) => s.classId),
    ).size,
    classesWithMultipleStudents: classes.filter((c) => c.distinctStudents > 1).length,
    plannedReads: classes.reduce((n, c) => n + c.reads.length, 0),
  };

  return { classes, skipped, stats };
}

// ─── PHẦN DB (chạy thật) ────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

export type MigrateLegacyChatOptions = {
  /**
   * Prisma client TRẦN (đừng truyền `scopedDb(actor)`): migrate là thao tác MỨC HỆ THỐNG,
   * phải thấy mọi lớp/học viên bất kể ai chạy — đúng như `reconcileConversationMembership`.
   */
  db: PrismaClient;
  /** false (mặc định) = DRY-RUN: tính kế hoạch, KHÔNG ghi một dòng nào. */
  apply?: boolean;
  /** Chỉ lấy N tin cũ (theo createdAt tăng dần) — chạy thử một phần. */
  limit?: number;
  /** Giới hạn tập lớp (nghiệm thu trên DB dev, không đụng lớp thật ngoài phạm vi). */
  onlyClassIds?: readonly string[];
  log?: (line: string) => void;
};

export type MigrateLegacyChatResult = {
  plan: LegacyMigrationPlan;
  applied: boolean;
  insertedMessages: number;
  updatedReads: number;
  classesDone: number;
  classesFailed: number;
  errors: { classId: string; message: string }[];
  durationMs: number;
};

const LEGACY_INCLUDE = {
  enrollment: {
    select: {
      id: true,
      studentId: true,
      deletedAt: true,
      student: { select: { id: true, parentUserId: true } },
      class: {
        select: {
          id: true,
          name: true,
          status: true,
          deletedAt: true,
          teacherId: true,
          assistantId: true,
        },
      },
    },
  },
} as const;

/** Đọc tin cũ + quan hệ, chuẩn hoá về `LegacyMessageRow` (status enum → string). */
async function loadLegacyRows(
  db: PrismaClient,
  opts: { limit?: number; onlyClassIds?: readonly string[] },
): Promise<LegacyMessageRow[]> {
  const rows = await db.conversationMessage.findMany({
    where: opts.onlyClassIds
      ? { enrollment: { classId: { in: [...opts.onlyClassIds] } } }
      : undefined,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(opts.limit ? { take: opts.limit } : {}),
    select: {
      id: true,
      enrollmentId: true,
      authorUserId: true,
      authorSide: true,
      body: true,
      createdAt: true,
      readByParentAt: true,
      readByStaffAt: true,
      ...LEGACY_INCLUDE,
    },
  });
  return rows.map((r) => ({
    ...r,
    enrollment: r.enrollment
      ? { ...r.enrollment, class: r.enrollment.class ? { ...r.enrollment.class } : null }
      : null,
  }));
}

/** Gom dữ liệu phụ (user còn sống, nhóm đã có, tin đã migrate) rồi gọi hàm thuần. */
async function buildPlan(
  db: PrismaClient,
  rows: readonly LegacyMessageRow[],
): Promise<LegacyMigrationPlan> {
  const candidateUserIds = new Set<string>();
  const classIds = new Set<string>();
  for (const r of rows) {
    if (r.authorUserId) candidateUserIds.add(r.authorUserId);
    const parentUserId = r.enrollment?.student?.parentUserId;
    if (parentUserId) candidateUserIds.add(parentUserId);
    const cls = r.enrollment?.class;
    if (!cls) continue;
    classIds.add(cls.id);
    if (cls.teacherId) candidateUserIds.add(cls.teacherId);
    if (cls.assistantId) candidateUserIds.add(cls.assistantId);
  }

  const users = candidateUserIds.size
    ? await db.user.findMany({
        where: { id: { in: [...candidateUserIds] }, deletedAt: null },
        select: { id: true },
      })
    : [];

  const convs = classIds.size
    ? await db.conversation.findMany({
        where: {
          type: "CLASS_GROUP",
          subjectType: "CLASS",
          subjectId: { in: [...classIds] },
        },
        select: { id: true, subjectId: true },
      })
    : [];

  const migratedRows = rows.length
    ? await db.message.findMany({
        where: { clientMsgId: { in: rows.map((r) => legacyClientMsgId(r.id)) } },
        select: { clientMsgId: true },
      })
    : [];

  return planLegacyMigration(rows, {
    aliveUserIds: new Set(users.map((u) => u.id)),
    conversationByClassId: new Map(
      convs
        .filter((c): c is { id: string; subjectId: string } => c.subjectId !== null)
        .map((c) => [c.subjectId, { id: c.id }]),
    ),
    migratedClientMsgIds: new Set(
      migratedRows
        .map((m) => m.clientMsgId)
        .filter((c): c is string => c !== null),
    ),
  });
}

/** Đổ tin của MỘT lớp trong MỘT transaction. Trả số tin/mốc đọc thực sự ghi. */
async function migrateOneClass(
  tx: Tx,
  planned: PlannedClass,
): Promise<{ inserted: number; reads: number }> {
  let conversationId = planned.conversationId;
  if (!conversationId) {
    // Chỉ gọi sync khi CHƯA có nhóm: sync trên nhóm đã tồn tại sẽ diff thành viên →
    // sinh SYSTEM message "đã tham gia/rời nhóm" + event kick. Migrate dữ liệu KHÔNG
    // được đẻ ra thông báo cho phụ huynh.
    await syncConversationMembership(tx, planned.classId);
    const conv = await tx.conversation.findUnique({
      where: {
        type_subjectType_subjectId: {
          type: "CLASS_GROUP",
          subjectType: "CLASS",
          subjectId: planned.classId,
        },
      },
      select: { id: true },
    });
    if (!conv) return { inserted: 0, reads: 0 }; // lớp không đủ điều kiện dựng nhóm (BR-01)
    conversationId = conv.id;
  }

  // Hàng rào idempotent thứ hai (kế hoạch có thể đã cũ vài phút): đọc lại clientMsgId
  // đã có TRONG transaction. Unique (conversationId, senderId, clientMsgId) là hàng rào
  // thứ ba, nhưng nó KHÔNG bắt được trường hợp lần chạy trước suy ra senderId khác
  // (tài khoản GV bị xoá giữa hai lần chạy) — nên kiểm theo clientMsgId mới là chuẩn.
  const already = await tx.message.findMany({
    where: {
      conversationId,
      clientMsgId: { in: planned.messages.map((m) => m.clientMsgId) },
    },
    select: { clientMsgId: true },
  });
  const alreadySet = new Set(already.map((m) => m.clientMsgId));
  const toInsert = planned.messages.filter((m) => !alreadySet.has(m.clientMsgId));

  if (toInsert.length > 0) {
    await tx.message.createMany({
      data: toInsert.map((m) => ({
        id: m.newMessageId,
        conversationId,
        senderId: m.senderId,
        kind: "CHAT" as const,
        body: m.body,
        clientMsgId: m.clientMsgId,
        createdAt: m.createdAt, // GIỮ mốc gốc
      })),
      skipDuplicates: true,
    });

    // `lastMessageAt` chỉ TIẾN, không lùi: lịch sử cũ không được đẩy hội thoại đang
    // sống tụt xuống cuối danh sách.
    let newest = toInsert[0].createdAt;
    for (const m of toInsert) if (m.createdAt > newest) newest = m.createdAt;
    const conv = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { lastMessageAt: true },
    });
    if (!conv.lastMessageAt || conv.lastMessageAt < newest) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: newest },
      });
    }
  }

  // Mốc "đã đọc" — chỉ set khi participant tồn tại và mốc mới TIẾN so với mốc hiện có.
  // `unreadCount` CỐ Ý không đụng (xem doc mục 4): lịch sử migrate coi như đã đọc, không
  // bơm badge "20 tin chưa đọc" vào mặt phụ huynh vì một lần chạy script.
  let reads = 0;
  if (planned.reads.length > 0) {
    // Tra id THẬT theo clientMsgId (tin có thể đã được đổ ở lần chạy trước với id khác).
    const readMsgs = await tx.message.findMany({
      where: {
        conversationId,
        clientMsgId: { in: planned.reads.map((r) => r.lastReadClientMsgId) },
      },
      select: { id: true, clientMsgId: true },
    });
    const messageIdByClientId = new Map(
      readMsgs.flatMap((m) => (m.clientMsgId ? [[m.clientMsgId, m.id] as const] : [])),
    );

    for (const r of planned.reads) {
      const messageId = messageIdByClientId.get(r.lastReadClientMsgId);
      if (!messageId) continue; // tin mốc không đổ được (bị skip) → bỏ mốc, không đoán
      const p = await tx.conversationParticipant.findUnique({
        where: { conversationId_userId: { conversationId, userId: r.userId } },
        select: { id: true, lastReadAt: true },
      });
      if (!p) continue; // PH không (còn) là thành viên nhóm → không dựng mốc đọc
      if (p.lastReadAt && p.lastReadAt >= r.lastReadAt) continue; // đã đọc xa hơn
      await tx.conversationParticipant.update({
        where: { id: p.id },
        data: { lastReadAt: r.lastReadAt, lastReadMessageId: messageId },
      });
      reads += 1;
    }
  }

  return { inserted: toInsert.length, reads };
}

/**
 * Chạy migrate. Mặc định DRY-RUN (`apply` không truyền hoặc false) — chỉ tính kế hoạch.
 *
 * Idempotent tuyệt đối: khoá là `clientMsgId = legacy:<id cũ>` (id cũ là cuid, duy nhất
 * toàn hệ), kiểm ở 3 tầng — lúc lập kế hoạch, lúc vào transaction, và unique
 * `(conversationId, senderId, clientMsgId)` ở schema.
 *
 * Mỗi lớp một transaction `{ timeout: 30_000, maxWait: 10_000 }` (luật E-bis #2: tx có
 * `syncConversationMembership` không sống nổi với trần 5s mặc định). Lớp lỗi → log ERROR
 * và đi tiếp, không kéo theo lớp khác.
 */
export async function migrateLegacyChat(
  opts: MigrateLegacyChatOptions,
): Promise<MigrateLegacyChatResult> {
  const startedAt = Date.now();
  const log = opts.log ?? ((line: string) => console.log(line));
  const apply = opts.apply === true;

  const rows = await loadLegacyRows(opts.db, {
    limit: opts.limit,
    onlyClassIds: opts.onlyClassIds,
  });
  const plan = await buildPlan(opts.db, rows);

  if (!apply) {
    return {
      plan,
      applied: false,
      insertedMessages: 0,
      updatedReads: 0,
      classesDone: 0,
      classesFailed: 0,
      errors: [],
      durationMs: Date.now() - startedAt,
    };
  }

  let insertedMessages = 0;
  let updatedReads = 0;
  let classesDone = 0;
  let classesFailed = 0;
  const errors: { classId: string; message: string }[] = [];

  for (const planned of plan.classes) {
    try {
      const r = await opts.db.$transaction((tx) => migrateOneClass(tx as Tx, planned), {
        timeout: 30_000,
        maxWait: 10_000,
      });
      insertedMessages += r.inserted;
      updatedReads += r.reads;
      classesDone += 1;
      log(
        `[chat-migrate] lớp ${planned.classId} (${planned.className ?? "?"}): ` +
          `+${r.inserted} tin, ${r.reads} mốc đã đọc`,
      );
    } catch (err) {
      classesFailed += 1;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ classId: planned.classId, message });
      console.error(`[chat-migrate] ERROR class=${planned.classId}`, err);
    }
  }

  return {
    plan,
    applied: true,
    insertedMessages,
    updatedReads,
    classesDone,
    classesFailed,
    errors,
    durationMs: Date.now() - startedAt,
  };
}
