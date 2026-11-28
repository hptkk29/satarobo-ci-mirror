import { laKhoaVideoOnlineHopLe } from "./video-khoa";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * E-LEARNING ONLINE — SOẠN NỘI DUNG: bản nháp · chương · bài (thiết kế QoChuongBai/QoBai*).
 *
 * Bất biến:
 * 1. CHỈ bản NHÁP sửa được. Bản đang chạy/đã thay thế bất biến — học viên đang học trên đó.
 * 2. `stableId` của chương/bài sinh MỘT LẦN và giữ nguyên qua các bản — tiến độ học viên trỏ vào nó.
 * 3. `contentJson` là THAM CHIẾU (khoá media, id bài đánh giá, thân bài đọc), KHÔNG chứa URL công khai của nội dung trả phí.
 * 4. Mỗi bản có tối đa MỘT bài thi cuối khoá.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type MaLoiNoiDung =
  | "KHOA_KHONG_TON_TAI"
  | "BAN_KHONG_TON_TAI"
  | "BAN_KHONG_PHAI_NHAP"
  | "CHUONG_KHONG_TON_TAI"
  | "BAI_KHONG_TON_TAI"
  | "DA_CO_BAN_NHAP"
  | "CHUA_CO_BAN_NAO_DE_SAO_CHEP"
  | "NHIEU_BAI_THI_CUOI"
  | "THU_TU_KHONG_KHOP"
  | "NOI_DUNG_KHONG_HOP_LE";
export type Fail = { ok: false; ma: MaLoiNoiDung; thongBao: string };
const fail = (ma: MaLoiNoiDung, thongBao: string): Fail => ({ ok: false, ma, thongBao });

const laP2002 = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const maNgan = (tienTo: string) => `${tienTo}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

// ───────── Nội dung bài theo loại ─────────

const khongUrl = (s: string) => !/^\s*[a-z][a-z0-9+.-]*:\/\//i.test(s) && !s.includes("://");

export const noiDungBaiSchema = {
  VIDEO: z.object({ mediaRef: z.string().trim().min(1).max(300).refine(khongUrl, "Không dùng URL công khai — dùng khoá media nội bộ").refine(laKhoaVideoOnlineHopLe, "Khoá video phải nằm trong vùng online/video/<khoá>/… của kho hiện có").optional() }).strict(),
  READ: z.object({ body: z.string().max(100_000).default("") }).strict(),
  ASSIGNMENT: z.object({ assessmentId: z.string().min(1).max(100).optional() }).strict(),
  QUIZ: z.object({ assessmentId: z.string().min(1).max(100).optional() }).strict(),
  FINAL_EXAM: z.object({ assessmentId: z.string().min(1).max(100).optional() }).strict(),
} as const;

export const loaiBaiSchema = z.enum(["VIDEO", "READ", "ASSIGNMENT", "QUIZ", "FINAL_EXAM"]);
export type LoaiBai = z.infer<typeof loaiBaiSchema>;

export function kiemNoiDungBai(kind: LoaiBai, contentJson: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; thongBao: string } {
  const r = noiDungBaiSchema[kind].safeParse(contentJson ?? {});
  return r.success ? { ok: true, value: r.data as Record<string, unknown> } : { ok: false, thongBao: r.error.issues[0]?.message ?? "Nội dung bài không hợp lệ" };
}

export const chuongSchema = z.object({ versionId: z.string().min(1), title: z.string().trim().min(1, "Chương cần có tên").max(200) }).strict();
export const suaChuongSchema = z.object({ chapterId: z.string().min(1), title: z.string().trim().min(1).max(200).optional(), hidden: z.boolean().optional() }).strict();

export const baiSchema = z
  .object({
    versionId: z.string().min(1),
    chapterId: z.string().min(1),
    kind: loaiBaiSchema,
    title: z.string().trim().min(1, "Bài cần có tên").max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().optional(),
    freePreview: z.boolean().optional(),
    durationSec: z.number().int().min(0).max(86_400).nullable().optional(),
    passPercent: z.number().int().min(0).max(100).nullable().optional(),
    contentJson: z.unknown().optional(),
  })
  .strict();
export type BaiInput = z.infer<typeof baiSchema>;

export const suaBaiSchema = z
  .object({
    lessonId: z.string().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    freePreview: z.boolean().optional(),
    durationSec: z.number().int().min(0).max(86_400).nullable().optional(),
    passPercent: z.number().int().min(0).max(100).nullable().optional(),
    contentJson: z.unknown().optional(),
  })
  .strict();
export type SuaBaiInput = z.infer<typeof suaBaiSchema>;

export const bocucSchema = z
  .object({
    versionId: z.string().min(1),
    /** TOÀN BỘ bố cục: thứ tự chương, và trong mỗi chương thứ tự bài. Phải phủ ĐÚNG tập chương/bài của bản (không thiếu, không thừa). */
    chuong: z.array(z.object({ chapterId: z.string().min(1), lessonIds: z.array(z.string().min(1)) }).strict()).max(500),
  })
  .strict();
export type BoCucInput = z.infer<typeof bocucSchema>;

// ───────── Bản nháp ─────────

export async function layBanNhap(db: Db | Tx, courseId: string) {
  return db.onlCourseVersion.findFirst({ where: { courseId, status: "DRAFT" }, select: { id: true, number: true, courseId: true } });
}

/** Mở bản nháp: đã có thì trả lại; chưa có thì SAO CHÉP từ bản đang chạy (giữ stableId). */
export async function moBanNhap(db: Db, courseId: string, actorUserId: string | null): Promise<{ ok: true; versionId: string; number: number; moiTao: boolean } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true, publishedVersionId: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const co = await layBanNhap(db, courseId);
  if (co) return { ok: true, versionId: co.id, number: co.number, moiTao: false };
  if (!khoa.publishedVersionId) return fail("CHUA_CO_BAN_NAO_DE_SAO_CHEP", "Khoá chưa có bản nào");
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OnlCourse" WHERE "id" = ${courseId} FOR UPDATE`;
      const lai = await layBanNhap(tx, courseId);
      if (lai) return { ok: true as const, versionId: lai.id, number: lai.number, moiTao: false };
      const nguon = await tx.onlCourseVersion.findUniqueOrThrow({
        where: { id: khoa.publishedVersionId! },
        include: { chapters: { orderBy: { orderIndex: "asc" } }, lessons: { orderBy: { orderIndex: "asc" } } },
      });
      const max = await tx.onlCourseVersion.aggregate({ where: { courseId }, _max: { number: true } });
      const ban = await tx.onlCourseVersion.create({
        data: { courseId, number: (max._max.number ?? 0) + 1, status: "DRAFT", settingsJson: nguon.settingsJson as object, createdByUserId: actorUserId },
        select: { id: true, number: true },
      });
      const mapChuong = new Map<string, string>();
      for (const c of nguon.chapters) {
        const moi = await tx.onlChapter.create({ data: { versionId: ban.id, stableId: c.stableId, title: c.title, orderIndex: c.orderIndex, hidden: c.hidden }, select: { id: true } });
        mapChuong.set(c.id, moi.id);
      }
      if (nguon.lessons.length) {
        await tx.onlLesson.createMany({
          data: nguon.lessons.map((b) => ({
            versionId: ban.id, chapterId: mapChuong.get(b.chapterId)!, stableId: b.stableId, kind: b.kind, title: b.title, description: b.description,
            thumbnailKey: b.thumbnailKey, orderIndex: b.orderIndex, required: b.required, hidden: b.hidden, freePreview: b.freePreview, durationSec: b.durationSec,
            contentJson: b.contentJson as object, passPercent: b.passPercent,
          })),
        });
      }
      return { ok: true as const, versionId: ban.id, number: ban.number, moiTao: true };
    });
  } catch (e) {
    if (laP2002(e)) {
      // Hai lượt cùng mở nháp: lượt thua thấy bản của lượt thắng.
      const lai = await layBanNhap(db, courseId);
      if (lai) return { ok: true, versionId: lai.id, number: lai.number, moiTao: false };
    }
    throw e;
  }
}

export async function banNhapHopLe(tx: Db | Tx, versionId: string): Promise<{ ok: true; courseId: string } | Fail> {
  const ban = await tx.onlCourseVersion.findUnique({ where: { id: versionId }, select: { status: true, courseId: true } });
  if (!ban) return fail("BAN_KHONG_TON_TAI", "Phiên bản không tồn tại");
  if (ban.status !== "DRAFT") return fail("BAN_KHONG_PHAI_NHAP", "Chỉ sửa được bản nháp — bản đã phát hành là bất biến");
  return { ok: true, courseId: ban.courseId };
}

// ───────── Chương ─────────

export async function themChuong(db: Db, input: z.infer<typeof chuongSchema>): Promise<{ ok: true; chapterId: string; stableId: string } | Fail> {
  const h = await banNhapHopLe(db, input.versionId);
  if (!h.ok) return h;
  const max = await db.onlChapter.aggregate({ where: { versionId: input.versionId }, _max: { orderIndex: true } });
  const c = await db.onlChapter.create({ data: { versionId: input.versionId, stableId: maNgan("c"), title: input.title, orderIndex: (max._max.orderIndex ?? -1) + 1 }, select: { id: true, stableId: true } });
  return { ok: true, chapterId: c.id, stableId: c.stableId };
}

export async function suaChuong(db: Db, input: z.infer<typeof suaChuongSchema>): Promise<{ ok: true } | Fail> {
  const c = await db.onlChapter.findUnique({ where: { id: input.chapterId }, select: { id: true, versionId: true } });
  if (!c) return fail("CHUONG_KHONG_TON_TAI", "Chương không tồn tại");
  const h = await banNhapHopLe(db, c.versionId);
  if (!h.ok) return h;
  await db.onlChapter.update({ where: { id: c.id }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.hidden !== undefined ? { hidden: input.hidden } : {}) } });
  return { ok: true };
}

/** Xoá chương (kèm bài của nó) khỏi BẢN NHÁP. Học viên đã học bài trong bản đang chạy không bị ảnh hưởng tới khi phát hành (khi đó là "bài biến mất" ở so sánh). */
export async function xoaChuong(db: Db, chapterId: string): Promise<{ ok: true; soBaiXoa: number } | Fail> {
  const c = await db.onlChapter.findUnique({ where: { id: chapterId }, select: { id: true, versionId: true, _count: { select: { lessons: true } } } });
  if (!c) return fail("CHUONG_KHONG_TON_TAI", "Chương không tồn tại");
  const h = await banNhapHopLe(db, c.versionId);
  if (!h.ok) return h;
  await db.onlChapter.delete({ where: { id: chapterId } });
  return { ok: true, soBaiXoa: c._count.lessons };
}

// ───────── Bài ─────────

export async function themBai(db: Db, input: BaiInput): Promise<{ ok: true; lessonId: string; stableId: string } | Fail> {
  const h = await banNhapHopLe(db, input.versionId);
  if (!h.ok) return h;
  const ch = await db.onlChapter.findUnique({ where: { id: input.chapterId }, select: { versionId: true } });
  if (!ch || ch.versionId !== input.versionId) return fail("CHUONG_KHONG_TON_TAI", "Chương không thuộc bản này");
  const nd = kiemNoiDungBai(input.kind, input.contentJson);
  if (!nd.ok) return fail("NOI_DUNG_KHONG_HOP_LE", nd.thongBao);
  if (input.kind === "FINAL_EXAM") {
    const da = await db.onlLesson.count({ where: { versionId: input.versionId, kind: "FINAL_EXAM" } });
    if (da > 0) return fail("NHIEU_BAI_THI_CUOI", "Mỗi bản chỉ có một bài thi cuối khoá");
  }
  const max = await db.onlLesson.aggregate({ where: { chapterId: input.chapterId }, _max: { orderIndex: true } });
  const b = await db.onlLesson.create({
    data: {
      versionId: input.versionId, chapterId: input.chapterId, stableId: maNgan("l"), kind: input.kind, title: input.title, description: input.description ?? null,
      orderIndex: (max._max.orderIndex ?? -1) + 1, required: input.required ?? true, freePreview: input.freePreview ?? false, durationSec: input.durationSec ?? null,
      passPercent: input.passPercent ?? null, contentJson: nd.value as object,
    },
    select: { id: true, stableId: true },
  });
  return { ok: true, lessonId: b.id, stableId: b.stableId };
}

export async function suaBai(db: Db, input: SuaBaiInput): Promise<{ ok: true } | Fail> {
  const b = await db.onlLesson.findUnique({ where: { id: input.lessonId }, select: { id: true, versionId: true, kind: true } });
  if (!b) return fail("BAI_KHONG_TON_TAI", "Bài không tồn tại");
  const h = await banNhapHopLe(db, b.versionId);
  if (!h.ok) return h;
  let contentJson: object | undefined;
  if (input.contentJson !== undefined) {
    const nd = kiemNoiDungBai(b.kind, input.contentJson);
    if (!nd.ok) return fail("NOI_DUNG_KHONG_HOP_LE", nd.thongBao);
    contentJson = nd.value as object;
  }
  await db.onlLesson.update({
    where: { id: b.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
      ...(input.freePreview !== undefined ? { freePreview: input.freePreview } : {}),
      ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
      ...(input.passPercent !== undefined ? { passPercent: input.passPercent } : {}),
      ...(contentJson ? { contentJson } : {}),
    },
  });
  return { ok: true };
}

export async function xoaBai(db: Db, lessonId: string): Promise<{ ok: true } | Fail> {
  const b = await db.onlLesson.findUnique({ where: { id: lessonId }, select: { id: true, versionId: true } });
  if (!b) return fail("BAI_KHONG_TON_TAI", "Bài không tồn tại");
  const h = await banNhapHopLe(db, b.versionId);
  if (!h.ok) return h;
  await db.onlLesson.delete({ where: { id: lessonId } });
  return { ok: true };
}

/** Đặt lại TOÀN BỘ bố cục (kéo thả: đổi thứ tự chương/bài và chuyển bài giữa chương). Phải phủ đúng tập hiện có. */
export async function datBoCuc(db: Db, input: BoCucInput): Promise<{ ok: true } | Fail> {
  const h = await banNhapHopLe(db, input.versionId);
  if (!h.ok) return h;
  const [chuong, bai] = await Promise.all([
    db.onlChapter.findMany({ where: { versionId: input.versionId }, select: { id: true } }),
    db.onlLesson.findMany({ where: { versionId: input.versionId }, select: { id: true } }),
  ]);
  const idChuong = input.chuong.map((c) => c.chapterId);
  const idBai = input.chuong.flatMap((c) => c.lessonIds);
  const bang = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => new Set(a).has(x));
  if (!bang(idChuong, chuong.map((c) => c.id)) || !bang(idBai, bai.map((b) => b.id))) {
    return fail("THU_TU_KHONG_KHOP", "Bố cục không khớp tập chương/bài hiện có (có thể ai đó vừa sửa) — tải lại trang");
  }
  await db.$transaction([
    ...input.chuong.map((c, i) => db.onlChapter.update({ where: { id: c.chapterId }, data: { orderIndex: i } })),
    ...input.chuong.flatMap((c) => c.lessonIds.map((id, j) => db.onlLesson.update({ where: { id }, data: { chapterId: c.chapterId, orderIndex: j } }))),
  ]);
  return { ok: true };
}

// ───────── Đọc cây ─────────

export async function docCayNoiDung(db: Db, versionId: string) {
  return db.onlCourseVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true, number: true, status: true, courseId: true, settingsJson: true, publishedAt: true, progressPolicy: true,
      chapters: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true, stableId: true, title: true, orderIndex: true, hidden: true,
          lessons: { orderBy: { orderIndex: "asc" }, select: { id: true, stableId: true, kind: true, title: true, description: true, required: true, hidden: true, freePreview: true, durationSec: true, passPercent: true, orderIndex: true, contentJson: true } },
        },
      },
    },
  });
}
