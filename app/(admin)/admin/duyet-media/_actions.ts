"use server";

// Server Actions của cổng duyệt media (BA §7.7 · MEDIA-REVIEW 26/08/2026).
//
// LUẬT CHUNG cho mọi action ở đây:
//   1. `auth()` + quyền `media:approve` NGAY ĐẦU hàm — layout gate là chưa đủ, Server
//      Action là một endpoint riêng ai cũng gọi thẳng được.
//   2. Cách ly cơ sở kiểm ở SERVER, không phải bằng cách ẩn nút: mọi id nhận từ client
//      đều phải soi lại qua `scopedDb` trước khi ghi (chống IDOR — BA §7.5).
//   3. `scopedDb` KHÔNG che WRITE. Mọi `create` tự set `centerId`; mọi `update`/`delete`
//      phải tự chứng minh bản ghi thuộc phạm vi actor.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { deadlineFor } from "@/lib/media-review/deadline";
import { getReviewDeadlineHour } from "@/lib/media-review/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Số ngày giữ file sau khi bị loại, trước khi cron dọn khỏi R2 (BA §7.3a). */
const PURGE_AFTER_DAYS = 7;

const PATHS = ["/duyet-media"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Cổng chung: đăng nhập + quyền duyệt + buổi thuộc phạm vi cơ sở của actor.
 *
 * Trả về buổi đã soi qua `scopedDb` — dùng CHÍNH bản ghi đó để lấy `centerId`, đừng tin
 * `centerId` client gửi lên.
 */
type GateOk = {
  ok: true;
  userId: string;
  actorName: string;
  sdb: ReturnType<typeof scopedDb>;
  ses: { id: string; classId: string; centerId: string; orgUnitId: string | null; date: Date };
};
type GateResult = GateOk | { ok: false; error: string };

async function gate(classSessionId: string): Promise<GateResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!session?.user || !userId) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("media:approve"))) {
    return { ok: false, error: "Không có quyền duyệt ảnh" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const ses = await sdb.classSession.findUnique({
    where: { id: classSessionId },
    select: { id: true, classId: true, centerId: true, orgUnitId: true, date: true, status: true },
  });
  if (!ses) {
    return { ok: false, error: "Buổi học không tồn tại hoặc không thuộc cơ sở của bạn" };
  }
  if (!ses.centerId) return { ok: false, error: "Buổi học chưa gắn cơ sở — báo kỹ thuật" };
  if (ses.status === "CANCELLED") {
    return { ok: false, error: "Buổi đã huỷ — không cần duyệt media" };
  }
  return {
    ok: true,
    userId,
    sdb,
    ses: { id: ses.id, classId: ses.classId, centerId: ses.centerId, orgUnitId: ses.orgUnitId, date: ses.date },
    actorName: session.user.name ?? session.user.email ?? "—",
  };
}

/**
 * Đẩy kết luận sang bản ghi GIAO cũ (`ClassSessionMedia`) — cầu 2-phase.
 *
 * MediaAsset thay phần KHO + DUYỆT, nhưng đường gửi phụ huynh (consent, tag học viên,
 * portal, đính vào nhận xét buổi) vẫn đọc `ClassSessionMedia`. Không đẩy sang thì QLCS
 * duyệt ở màn mới mà giáo viên vẫn không chọn được ảnh — đúng lỗi đang phải sửa.
 *
 * Ánh xạ trạng thái:
 *   APPROVED → APPROVED (nút "Chọn ảnh" ở phiếu nhận xét chỉ bày ảnh APPROVED —
 *                        `getSessionPhotoPicker`. Để DRAFT là giáo viên không thấy gì,
 *                        đúng lỗi đang phải sửa.)
 *   REJECTED → REJECTED (ẩn khỏi mọi đường chọn)
 *
 * APPROVED ở hệ cũ KHÔNG có nghĩa "phụ huynh xem được ngay": ảnh tải lên mang
 * `isClassWide: false` và chưa có `MediaStudentTag` nào, mà cổng phụ huynh
 * (lib/portal/photos.ts) lọc theo thẻ/cờ class-wide. Ảnh chỉ tới phụ huynh khi giáo
 * viên gắn nó cho một em ở phiếu nhận xét — nơi luật consent C6.3 vẫn chặn như cũ.
 *
 * Cố ý KHÔNG dùng `mediaAsset.update(...{ legacy: ... })` lồng nhau: hai bảng không có
 * quan hệ Prisma, chỉ có `legacyMediaId`.
 */
async function propagateToLegacy(
  sdb: ReturnType<typeof scopedDb>,
  assetIds: string[],
  target: "APPROVED" | "REJECTED",
) {
  if (assetIds.length === 0) return;
  const assets = await sdb.mediaAsset.findMany({
    where: { id: { in: assetIds }, legacyMediaId: { not: null } },
    select: { legacyMediaId: true },
  });
  const legacyIds = assets
    .map((a) => a.legacyMediaId)
    .filter((x): x is string => Boolean(x));
  if (legacyIds.length === 0) return;

  await sdb.classSessionMedia.updateMany({
    where: { id: { in: legacyIds } },
    data: { status: target },
  });
}

/** Dựng (hoặc lấy) dòng kết luận của buổi. Một buổi ↔ đúng một dòng (`@unique`). */
async function ensureReview(
  sdb: ReturnType<typeof scopedDb>,
  ses: { id: string; centerId: string; orgUnitId: string | null; date: Date },
) {
  const gio = await getReviewDeadlineHour();
  return sdb.sessionMediaReview.upsert({
    where: { classSessionId: ses.id },
    update: {},
    create: {
      classSessionId: ses.id,
      centerId: ses.centerId,
      orgUnitId: ses.orgUnitId,
      sessionDate: ses.date,
      status: "OPEN",
      deadlineAt: deadlineFor(ses.date, gio),
    },
    select: { id: true, status: true, decidedByName: true },
  });
}

// ─── US-03 · Duyệt cả lô ────────────────────────────────────────────────────

export async function approveAllMediaAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ classSessionId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thiếu buổi học" };

  const g = await gate(parsed.data.classSessionId);
  if (!g.ok) return g;
  const { sdb, ses, userId, actorName } = g;

  const pending = await sdb.mediaAsset.findMany({
    where: { classSessionId: ses.id, status: "PENDING" },
    select: { id: true, type: true, watchedRatio: true },
  });
  if (pending.length === 0) {
    return { ok: false, error: "Buổi này không còn ảnh nào chờ duyệt" };
  }

  // BA §7.3b — "Duyệt tất cả" KHÔNG áp cho video: đã chốt QLCS phải xem hết video chứ
  // không chỉ nhìn ảnh đại diện. Còn video chưa xem đủ thì chặn, nói rõ còn bao nhiêu.
  const videoChuaXem = pending.filter((m) => m.type === "VIDEO" && (m.watchedRatio ?? 0) < 0.9);
  if (videoChuaXem.length > 0) {
    return {
      ok: false,
      error: `Còn ${videoChuaXem.length} video chưa xem đủ — mở từng video và xem hết trước khi duyệt cả lô.`,
    };
  }

  const review = await ensureReview(sdb, ses);
  // BA US-03.6 — hai QLCS bấm cùng lúc: người sau không được ghi đè kết luận người trước.
  if (review.status !== "OPEN") {
    return {
      ok: false,
      error: `Lớp này vừa được ${review.decidedByName ?? "người khác"} kết luận — tải lại trang.`,
    };
  }

  const now = new Date();
  const ids = pending.map((m) => m.id);
  await sdb.mediaAsset.updateMany({
    // Lặp lại `classSessionId` + `status` chứ không chỉ `id IN`: giữ nguyên ranh giới đã
    // kiểm ở `gate`, và không nâng nhầm tấm vừa bị người khác loại giữa hai câu lệnh.
    where: { id: { in: ids }, classSessionId: ses.id, status: "PENDING" },
    data: {
      status: "APPROVED",
      reviewedById: userId,
      reviewedByName: actorName,
      reviewedAt: now,
      approvedInBulk: true,
    },
  });
  await propagateToLegacy(sdb, ids, "APPROVED");
  await sdb.sessionMediaReview.update({
    where: { classSessionId: ses.id },
    data: {
      status: "APPROVED",
      decidedById: userId,
      decidedByName: actorName,
      decidedAt: now,
    },
  });

  await writeAudit({
    actor: { id: userId, name: actorName },
    module: "media",
    entityType: "SessionMediaReview",
    entityId: ses.id,
    action: "MEDIA_APPROVE_ALL",
    newValues: { count: ids.length, classId: ses.classId },
    orgUnitId: ses.centerId,
  });

  refresh();
  return { ok: true };
}

// ─── US-04 · Khai báo không có ảnh ──────────────────────────────────────────

const noMediaSchema = z.object({
  classSessionId: z.string().min(1),
  // BA US-04.2 — bắt buộc ≥10 ký tự. Đây là dòng giải trình đi vào báo cáo SLA, để
  // trống thì cả cơ chế "vì sao buổi này không có ảnh" thành vô nghĩa.
  reason: z.string().trim().min(10, "Ghi chú giải trình tối thiểu 10 ký tự").max(500),
});

export async function declareNoMediaAction(input: unknown): Promise<ActionResult> {
  const parsed = noMediaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const g = await gate(parsed.data.classSessionId);
  if (!g.ok) return g;
  const { sdb, ses, userId, actorName } = g;

  // BA US-04.4 — còn ảnh chờ duyệt mà khai "không có ảnh" là nói dối sổ sách.
  const conCho = await sdb.mediaAsset.count({
    where: { classSessionId: ses.id, status: "PENDING" },
  });
  if (conCho > 0) {
    return {
      ok: false,
      error: `Buổi này đang có ${conCho} ảnh/video chờ duyệt — xử lý hết rồi mới khai báo được.`,
    };
  }

  const review = await ensureReview(sdb, ses);
  if (review.status !== "OPEN") {
    return {
      ok: false,
      error: `Lớp này vừa được ${review.decidedByName ?? "người khác"} kết luận — tải lại trang.`,
    };
  }

  await sdb.sessionMediaReview.update({
    where: { classSessionId: ses.id },
    data: {
      status: "NO_MEDIA_DECLARED",
      noMediaReason: parsed.data.reason,
      decidedById: userId,
      decidedByName: actorName,
      decidedAt: new Date(),
    },
  });

  await writeAudit({
    actor: { id: userId, name: actorName },
    module: "media",
    entityType: "SessionMediaReview",
    entityId: ses.id,
    action: "MEDIA_NO_MEDIA_DECLARED",
    newValues: { classId: ses.classId },
    reason: parsed.data.reason,
    orgUnitId: ses.centerId,
  });

  refresh();
  return { ok: true };
}

// ─── US-05 · Loại từng ảnh (xoá mềm) ────────────────────────────────────────

export async function rejectMediaAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ mediaId: z.string().min(1), classSessionId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thiếu ảnh cần loại" };

  const g = await gate(parsed.data.classSessionId);
  if (!g.ok) return g;
  const { sdb, ses, userId, actorName } = g;

  const now = new Date();
  // XOÁ MỀM (BA §7.3a): giữ file 7 ngày rồi cron mới dọn khỏi R2. Chế độ lướt từng ảnh
  // + thao tác nhanh + không có đường lùi = mất ảnh buổi học vì một cú lỡ tay, mà ảnh
  // buổi học là thứ không chụp lại được.
  const res = await sdb.mediaAsset.updateMany({
    where: { id: parsed.data.mediaId, classSessionId: ses.id, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedById: userId,
      reviewedByName: actorName,
      reviewedAt: now,
      purgeAfterAt: new Date(now.getTime() + PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  if (res.count === 0) {
    return { ok: false, error: "Ảnh không còn ở trạng thái chờ duyệt — tải lại trang" };
  }
  await propagateToLegacy(sdb, [parsed.data.mediaId], "REJECTED");

  await writeAudit({
    actor: { id: userId, name: actorName },
    module: "media",
    entityType: "MediaAsset",
    entityId: parsed.data.mediaId,
    action: "MEDIA_REJECT",
    newValues: { classSessionId: ses.id, purgeAfterDays: PURGE_AFTER_DAYS },
    orgUnitId: ses.centerId,
  });

  // BA §7.7 — loại HẾT ảnh KHÔNG tự đóng kết luận: QLCS vẫn phải bấm "Hôm nay không có
  // ảnh" và giải trình. Tự đóng là mất đúng dòng giải trình mà báo cáo SLA cần.
  refresh();
  return { ok: true };
}

// ─── V1.1 · Khôi phục ảnh đã loại (còn trong hạn 7 ngày) ────────────────────

export async function restoreMediaAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ mediaId: z.string().min(1), classSessionId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thiếu ảnh cần khôi phục" };

  const g = await gate(parsed.data.classSessionId);
  if (!g.ok) return g;
  const { sdb, ses, userId, actorName } = g;

  // Chỉ REJECTED mới khôi phục được — PURGED là file đã xoá khỏi R2, dòng còn lại chỉ
  // là dấu vết; "khôi phục" nó sẽ tạo ra một ảnh trỏ vào hư không.
  const res = await sdb.mediaAsset.updateMany({
    where: { id: parsed.data.mediaId, classSessionId: ses.id, status: "REJECTED" },
    data: { status: "PENDING", purgeAfterAt: null, reviewedAt: null, reviewedById: null },
  });
  if (res.count === 0) {
    return { ok: false, error: "Ảnh đã bị dọn khỏi kho hoặc không ở trạng thái đã loại" };
  }
  // Dòng cũ về DRAFT (nằm trong kho, chưa gửi ai) chứ không về PENDING: PENDING ở hệ cũ
  // nghĩa là "đã gửi PH, chờ duyệt nội dung gửi" — ảnh này chưa từng được gửi.
  {
    const a = await sdb.mediaAsset.findUnique({
      where: { id: parsed.data.mediaId },
      select: { legacyMediaId: true },
    });
    if (a?.legacyMediaId) {
      await sdb.classSessionMedia.updateMany({
        where: { id: a.legacyMediaId },
        data: { status: "DRAFT" },
      });
    }
  }

  // Ảnh quay lại hàng chờ ⇒ buổi còn việc. Mở lại kết luận nếu nó đã đóng.
  await sdb.sessionMediaReview.updateMany({
    where: { classSessionId: ses.id, status: { not: "OPEN" } },
    data: { status: "OPEN", decidedAt: null, decidedById: null, decidedByName: null },
  });

  await writeAudit({
    actor: { id: userId, name: actorName },
    module: "media",
    entityType: "MediaAsset",
    entityId: parsed.data.mediaId,
    action: "MEDIA_RESTORE",
    newValues: { classSessionId: ses.id },
    orgUnitId: ses.centerId,
  });

  refresh();
  return { ok: true };
}

// ─── V2 · Ghi tỉ lệ đã xem của video ────────────────────────────────────────

export async function markVideoWatchedAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      mediaId: z.string().min(1),
      classSessionId: z.string().min(1),
      ratio: z.number().min(0).max(1),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };

  const g = await gate(parsed.data.classSessionId);
  if (!g.ok) return g;
  const { sdb, ses } = g;

  // CHỈ TĂNG, không giảm: tua lại từ đầu không được xoá công đã xem. `updateMany` với
  // điều kiện `watchedRatio < ratio` để hai tab mở song song không đạp lên nhau.
  await sdb.mediaAsset.updateMany({
    where: {
      id: parsed.data.mediaId,
      classSessionId: ses.id,
      type: "VIDEO",
      OR: [{ watchedRatio: null }, { watchedRatio: { lt: parsed.data.ratio } }],
    },
    data: { watchedRatio: parsed.data.ratio },
  });
  return { ok: true };
}
