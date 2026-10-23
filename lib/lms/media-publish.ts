// lib/lms/media-publish.ts — KHO ẢNH buổi học (DRAFT → gửi phụ huynh).
//
// GV upload cả LOẠT ảnh vào kho (status DRAFT — không hiện portal, không vào hàng
// duyệt), sau đó CHỌN ảnh gửi PH theo buổi/từng học viên. Service THUẦN (mẫu
// lib/crm/bulk-convert.ts): KHÔNG check quyền/scope ở đây — caller (Server Action)
// đã canUploadToClass + guard class.centerId trước khi gọi; service chỉ assert dữ
// liệu hợp lệ + giữ bất biến consent:
// • C6.2 — publish bắt buộc isClassWide HOẶC ≥1 studentId (không tạo ảnh "mồ côi"
//   lọt vào luồng hiển thị PH).
// • C6.3 — mọi studentId phải GRANTED CLASS_MEDIA + đang học lớp (check trực tiếp
//   theo id, chống payload tuỳ ý — mirror uploadClassMedia trong media/actions.ts).
// Xoá kho XOÁ LUÔN object trên R2 (F-03 · L-F4) — thứ tự cứng: kho trước, DB sau.
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { purgeMediaFilesThen, MediaFilePurgeError } from "@/lib/lms/media-r2-delete";

/** Trần 1 lô upload vào kho — khớp giới hạn chọn file phía dialog GV. */
export const DRAFT_BATCH_MAX = 40;
/** Trần 1 lượt gửi/xoá theo mediaIds. */
export const PUBLISH_BATCH_MAX = 60;

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

export type DraftFileInput = { fileUrl: string; fileName?: string | null };

export type CreateDraftBatchInput = {
  classId: string;
  classSessionId?: string | null;
  takenAt?: Date | null;
  /** 1..DRAFT_BATCH_MAX file đã PUT lên R2 (presign lo ở client). */
  files: DraftFileInput[];
  uploadedById: string | null;
  uploadedByName: string | null;
};

export type CreateDraftBatchResult = { ok: true; ids: string[] } | Fail;

/**
 * Tạo N record DRAFT (không tag, không class-wide) trong 1 transaction + 1 audit
 * cho cả lô. Buổi (nếu truyền) phải thuộc đúng lớp; takenAt fallback ngày buổi.
 */
export async function createDraftMediaBatch(
  actor: AuditActor,
  input: CreateDraftBatchInput,
): Promise<CreateDraftBatchResult> {
  if (input.files.length < 1) return fail("NO_FILE", "Chưa có ảnh nào để đưa vào kho");
  if (input.files.length > DRAFT_BATCH_MAX) {
    return fail("TOO_MANY_FILES", `Tối đa ${DRAFT_BATCH_MAX} ảnh mỗi lô`);
  }

  const cls = await db.class.findFirst({
    where: { id: input.classId, deletedAt: null },
    select: { id: true, centerId: true, orgUnitId: true },
  });
  if (!cls) return fail("CLASS_NOT_FOUND", "Không tìm thấy lớp");

  let takenAt = input.takenAt ?? null;
  let classSessionId: string | null = null;
  let sessionDate: Date | null = null;
  if (input.classSessionId) {
    const ses = await db.classSession.findFirst({
      where: { id: input.classSessionId, classId: input.classId },
      select: { id: true, date: true },
    });
    if (!ses) return fail("SESSION_WRONG_CLASS", "Buổi học không thuộc lớp này");
    classSessionId = ses.id;
    sessionDate = ses.date;
    if (!takenAt) takenAt = ses.date;
  }

  const ids = await db.$transaction(async (tx) => {
    const created: string[] = [];
    for (const f of input.files) {
      const row = await tx.classSessionMedia.create({
        data: {
          classId: input.classId,
          fileUrl: f.fileUrl,
          fileName: f.fileName || null,
          status: "DRAFT",
          isClassWide: false,
          classSessionId,
          takenAt,
          uploadedById: input.uploadedById,
          uploadedByName: input.uploadedByName,
        },
        select: { id: true },
      });
      created.push(row.id);

      // MEDIA-REVIEW (26/08) — dòng SONG SINH trong hàng chờ duyệt kiểu mới.
      //
      // Chỉ tạo khi ảnh có gắn buổi: hàng duyệt xếp theo NGÀY → LỚP, ảnh không biết
      // thuộc buổi nào thì không có chỗ đứng trong cây và sẽ nằm lại vô thời hạn.
      // Ảnh không gắn buổi vẫn vào kho cũ như trước — không mất gì.
      //
      // ⚠️ centerId lấy từ `cls` đã đọc ở trên, KHÔNG từ input: scopedDb không che
      // write, đặt sai là dòng vô hình với chính QLCS phải duyệt nó.
      // `uploadedById` bắt buộc ở bảng mới: hàng duyệt phải trả lời được "hỏi ai khi
      // ảnh có vấn đề". Lô không rõ người tải (đường cũ cho phép null) ở lại kho cũ.
      const nguoiTai = input.uploadedById ?? actor.id;
      if (classSessionId && sessionDate && cls.centerId && nguoiTai) {
        await tx.mediaAsset.create({
          data: {
            centerId: cls.centerId,
            orgUnitId: cls.orgUnitId,
            classId: input.classId,
            classSessionId,
            sessionDate,
            legacyMediaId: row.id,
            uploadedById: nguoiTai,
            uploadedByName: input.uploadedByName,
            type: "IMAGE",
            r2Key: f.fileUrl,
            status: "PENDING",
          },
        });
      }
    }
    // 1 audit cho cả lô (không spam N record) — ids nằm trong newValues để truy vết.
    await writeAudit({
      actor,
      module: "lms",
      entityType: "ClassSessionMedia",
      entityId: created[0] ?? "*",
      action: "MEDIA_DRAFT_BATCH_CREATE",
      newValues: {
        classId: input.classId,
        classSessionId,
        count: created.length,
        ids: created,
      },
      orgUnitId: cls.centerId,
      tx,
    });
    return created;
  });

  return { ok: true, ids };
}

export type PublishClassMediaInput = {
  /** 1..PUBLISH_BATCH_MAX ảnh, PHẢI cùng lớp + đang DRAFT. */
  mediaIds: string[];
  studentIds?: string[];
  isClassWide?: boolean;
  /** Gán buổi cho cả lô lúc gửi (nếu lô upload chưa gắn). */
  classSessionId?: string | null;
  /** Action quyết theo media:approve — true = APPROVED luôn + approvedBy* từ actor. */
  autoApprove: boolean;
};

export type PublishClassMediaResult =
  | { ok: true; count: number; status: "PENDING" | "APPROVED"; classId: string }
  | Fail;

/**
 * Gửi ảnh kho cho PH: ghi MediaStudentTag (skipDuplicates), set isClassWide +
 * classSessionId (nếu truyền), status DRAFT → PENDING (vào hàng duyệt) hoặc
 * APPROVED khi autoApprove. Tag + đổi status atomic trong 1 transaction.
 */
export async function publishClassMedia(
  actor: AuditActor,
  input: PublishClassMediaInput,
): Promise<PublishClassMediaResult> {
  const mediaIds = [...new Set(input.mediaIds)];
  if (mediaIds.length < 1) return fail("NO_MEDIA", "Chưa chọn ảnh nào");
  if (mediaIds.length > PUBLISH_BATCH_MAX) {
    return fail("TOO_MANY_MEDIA", `Tối đa ${PUBLISH_BATCH_MAX} ảnh mỗi lượt gửi`);
  }

  const isClassWide = input.isClassWide === true;
  // Class-wide & tag theo HS loại trừ nhau (mirror uploadClassMedia).
  const studentIds = isClassWide ? [] : [...new Set(input.studentIds ?? [])];
  // C6.2 — không tag & không class-wide → ảnh ẩn vĩnh viễn với PH: chặn từ đầu.
  if (!isClassWide && studentIds.length === 0) {
    return fail("NO_TARGET", 'Chọn học viên trong ảnh hoặc đánh dấu "Ảnh chung cả lớp"');
  }

  const rows = await db.classSessionMedia.findMany({
    where: { id: { in: mediaIds } },
    select: { id: true, classId: true, status: true },
  });
  if (rows.length !== mediaIds.length) {
    return fail("MEDIA_NOT_FOUND", "Có ảnh không tồn tại — tải lại trang rồi thử lại");
  }
  const classIds = new Set(rows.map((r) => r.classId));
  if (classIds.size > 1) return fail("MIXED_CLASS", "Các ảnh phải thuộc cùng một lớp");
  const classId = rows[0]!.classId;
  if (rows.some((r) => r.status !== "DRAFT")) {
    return fail("NOT_DRAFT", "Chỉ gửi được ảnh đang ở trong kho (chưa gửi/duyệt)");
  }

  const cls = await db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { centerId: true },
  });
  if (!cls) return fail("CLASS_NOT_FOUND", "Không tìm thấy lớp");

  // C6.3 + thuộc lớp: consent GRANTED CLASS_MEDIA check TRỰC TIẾP theo id, và HS
  // phải đang học lớp này (chống tag chéo lớp bằng payload tuỳ ý).
  if (studentIds.length > 0) {
    const [granted, enrolled] = await Promise.all([
      db.studentConsent.findMany({
        where: { studentId: { in: studentIds }, type: "CLASS_MEDIA", status: "GRANTED" },
        select: { studentId: true },
      }),
      db.enrollment.findMany({
        where: {
          studentId: { in: studentIds },
          classId,
          status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
          deletedAt: null,
        },
        select: { studentId: true },
      }),
    ]);
    const grantedSet = new Set(granted.map((g) => g.studentId));
    const enrolledSet = new Set(enrolled.map((e) => e.studentId));
    const noConsent = studentIds.filter((id) => !grantedSet.has(id));
    if (noConsent.length > 0) {
      const names = await db.student.findMany({
        where: { id: { in: noConsent } },
        select: { name: true },
      });
      return fail(
        "NO_CONSENT",
        `Học viên chưa đồng ý dùng hình ảnh — không thể gắn thẻ: ${names
          .map((n) => n.name)
          .join(", ")}`,
      );
    }
    const notInClass = studentIds.filter((id) => !enrolledSet.has(id));
    if (notInClass.length > 0) {
      return fail("NOT_IN_CLASS", "Có học viên không thuộc lớp này — tải lại trang");
    }
  }

  let sessionUpdate: { id: string; date: Date } | null = null;
  if (input.classSessionId) {
    const ses = await db.classSession.findFirst({
      where: { id: input.classSessionId, classId },
      select: { id: true, date: true },
    });
    if (!ses) return fail("SESSION_WRONG_CLASS", "Buổi học không thuộc lớp này");
    sessionUpdate = ses;
  }

  const status = input.autoApprove ? ("APPROVED" as const) : ("PENDING" as const);
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      if (studentIds.length > 0) {
        await tx.mediaStudentTag.createMany({
          data: mediaIds.flatMap((mediaId) =>
            studentIds.map((studentId) => ({ mediaId, studentId })),
          ),
          skipDuplicates: true,
        });
      }
      // Guard status DRAFT lặp lại TRONG update (chống đua: ai đó vừa publish/xoá
      // song song) — thiếu row nào là rollback cả lô (tag ở trên cũng hoàn tác).
      const upd = await tx.classSessionMedia.updateMany({
        where: { id: { in: mediaIds }, status: "DRAFT" },
        data: {
          status,
          isClassWide,
          ...(sessionUpdate ? { classSessionId: sessionUpdate.id } : {}),
          ...(input.autoApprove
            ? { approvedById: actor.id, approvedByName: actor.name, approvedAt: now }
            : {}),
        },
      });
      if (upd.count !== mediaIds.length) throw new Error("DRAFT_RACE");
      // Ảnh chưa có ngày chụp → fallback ngày buổi (giữ nhóm album đúng buổi).
      if (sessionUpdate) {
        await tx.classSessionMedia.updateMany({
          where: { id: { in: mediaIds }, takenAt: null },
          data: { takenAt: sessionUpdate.date },
        });
      }
      await writeAudit({
        actor,
        module: "lms",
        entityType: "ClassSessionMedia",
        entityId: mediaIds[0] ?? "*",
        action: "MEDIA_DRAFT_PUBLISH",
        newValues: {
          classId,
          count: mediaIds.length,
          ids: mediaIds,
          status,
          isClassWide,
          tagCount: studentIds.length,
          classSessionId: sessionUpdate?.id ?? null,
        },
        orgUnitId: cls.centerId,
        tx,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "DRAFT_RACE") {
      return fail("NOT_DRAFT", "Có ảnh vừa được gửi/xoá bởi lượt khác — tải lại trang");
    }
    throw err;
  }

  return { ok: true, count: mediaIds.length, status, classId };
}

export type DeleteDraftMediaResult = { ok: true; deleted: number } | Fail;

/**
 * Xoá ảnh khỏi kho — CHỈ row status DRAFT (PENDING/APPROVED/REJECTED giữ nguyên,
 * đã/đang trong luồng duyệt phải đi deleteMedia có quyền media:approve). Trả số
 * row đã xoá.
 *
 * F-03 · L-F4 — xoá TỆP trên R2 trước, xoá row DB sau. Trước đây hàm này chỉ xoá row,
 * nên ảnh "đã dọn khỏi kho" vẫn tải được vô danh bằng link cũ trên bucket công khai.
 * Kho lỗi ⇒ trả fail, KHÔNG xoá row nào (mất row mà tệp còn thì không ai lần ra nó).
 *
 * Khe hở còn lại, có chủ đích: giữa lúc đọc danh sách DRAFT và lúc deleteMany, một
 * lượt gửi song song có thể đẩy một ảnh sang PENDING — khi đó tệp đã bị xoá còn row
 * ở lại. Hỏng theo chiều lành (ảnh vỡ, dòng còn để lần ra), và `where status: DRAFT`
 * vẫn giữ nguyên để không xoá nhầm row đã rời kho.
 */
export async function deleteDraftMedia(
  actor: AuditActor,
  input: { mediaIds: string[] },
): Promise<DeleteDraftMediaResult> {
  const mediaIds = [...new Set(input.mediaIds)];
  if (mediaIds.length < 1) return fail("NO_MEDIA", "Chưa chọn ảnh nào");
  if (mediaIds.length > PUBLISH_BATCH_MAX) {
    return fail("TOO_MANY_MEDIA", `Tối đa ${PUBLISH_BATCH_MAX} ảnh mỗi lượt xoá`);
  }

  // Chỉ những row THỰC SỰ sẽ bị xoá mới được đụng tệp (khớp `where` của deleteMany).
  const drafts = await db.classSessionMedia.findMany({
    where: { id: { in: mediaIds }, status: "DRAFT" },
    select: { id: true, fileUrl: true, classId: true },
  });
  if (drafts.length === 0) return { ok: true, deleted: 0 };

  // centerId cho audit — caller đã đảm bảo cùng lớp trong scope trước khi gọi.
  const cls = await db.class.findUnique({
    where: { id: drafts[0]!.classId },
    select: { centerId: true },
  });

  const draftIds = drafts.map((d) => d.id);
  try {
    const deleted = await purgeMediaFilesThen(drafts, () =>
      db.$transaction(async (tx) => {
        const res = await tx.classSessionMedia.deleteMany({
          where: { id: { in: draftIds }, status: "DRAFT" },
        });
        if (res.count > 0) {
          await writeAudit({
            actor,
            module: "lms",
            entityType: "ClassSessionMedia",
            entityId: draftIds[0] ?? "*",
            action: "MEDIA_DRAFT_DELETE",
            newValues: { ids: draftIds, deleted: res.count },
            orgUnitId: cls?.centerId ?? null,
            tx,
          });
        }
        return res.count;
      }),
    );
    return { ok: true, deleted };
  } catch (err) {
    if (err instanceof MediaFilePurgeError) {
      return fail("R2_DELETE_FAILED", "Không xoá được ảnh khỏi kho lưu trữ — chưa xoá, hãy thử lại");
    }
    throw err;
  }
}
