import { Prisma } from "@prisma/client";
import { ActionError } from "@/lib/actions/factory";
import type { ScopedDb } from "@/lib/actions/factory";
import { banDaKhoa } from "@/lib/elearning/ban-cua-luot";
import { chupBan, TRANG_THAI_DA_KHOA } from "@/lib/elearning/ban-noi-dung";
import { phienBanKeTiep } from "@/lib/elearning/course-version";

/**
 * B-11 — SAO CHÉP-KHI-GHI (copy-on-write) THEO PHIÊN BẢN: CỔNG GHI DUY NHẤT cho nội dung một bài của khoá.
 *
 * Luật: một dòng `TrnLesson` đã nằm trong BẤT KỲ phiên bản đã khoá (chờ duyệt · đã duyệt · đã xuất bản · lưu trữ) thì BẤT BIẾN. Muốn sửa nó, người soạn
 * phải đi qua đây: hàm này (1) khoá dòng khoá học, (2) mở/chuẩn hoá BẢN NHÁP (tập bài tường minh = bản sao dòng của bản mới nhất), (3) nếu bài đã khoá thì
 * TÁCH BẢN — tạo một dòng bài mới (kèm các câu hỏi chèn video) mà BẢN NHÁP sở hữu, trỏ dòng phiên bản của nháp sang bài mới — rồi trả về `lessonId` mà
 * người gọi phải GHI vào. Bài gốc, tiến độ và lượt học đang đọc nó không bị đụng.
 *
 * ⚠️ Mọi đường ghi nội dung bài (đọc · video · câu hỏi chèn video · gắn đề · gắn khung chấm) PHẢI gọi `layBaiDeGhi` và ghi vào id nó trả về — lưới
 * `[B11-W5]` (`lib/elearning/b11-noi-day.test.ts`) cấm `trnLesson.update/…` và ghi `trnLessonCue` ở ngoài danh sách cho phép.
 *
 * ⚠️ Thứ tự, cờ bắt buộc và tập bài là của DÒNG PHIÊN BẢN (`TrnCourseVersionLesson`), không phải của dòng bài: bản nháp sắp lại / đổi cờ / thêm bài
 * chỉ ghi dòng phiên bản của nháp. Cột `TrnLesson.orderIndex` chỉ còn là "ô duy nhất trong chương" để hai dòng không va khoá.
 */

type Tx = Pick<
  ScopedDb,
  "trnCourseVersion" | "trnCourseVersionLesson" | "trnLesson" | "trnLessonCue" | "$queryRaw"
>;

export type BanNhap = { id: string; major: number; minor: number };

const DA_KHOA: readonly string[] = TRANG_THAI_DA_KHOA;

/** Khoá dòng khoá học trong giao dịch: hai người soạn cùng lúc xếp hàng, người sau thấy kết quả của người trước (không hai bản nháp, không hai lần tách). */
async function khoaKhoaHoc(tx: Tx, courseId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "TrnCourse" WHERE "id" = ${courseId} FOR UPDATE`;
}

/**
 * Mở bản nháp đang làm việc của khoá và đảm bảo tập bài của nó TƯỜNG MINH. Gọi trong giao dịch, SAU khi đã khoá khoá học.
 *  ① bản đã khoá mà chưa chụp (dữ liệu cũ, vân tay rỗng) được đóng băng — nếu không, tập bài của nó chỉ là "cây sống", mà cây sống sắp đổi;
 *  ② chưa có nháp ⇒ tạo v(minor+1), sao chép dòng phiên bản của bản MỚI NHẤT (thứ tự, cờ bắt buộc, vân tay);
 *  ③ nháp kiểu cũ (không có `clonedFromVersionId`, trong khi khoá đã có bản khoá) ⇒ bổ sung dòng thiếu từ bản mới nhất khoá;
 *  ④ bài sống không thuộc bản nào ⇒ nhận vào nháp.
 */
export async function moBanNhap(tx: Tx, courseId: string): Promise<BanNhap> {
  await khoaKhoaHoc(tx, courseId);
  const ban = await tx.trnCourseVersion.findMany({
    where: { courseId },
    orderBy: [{ major: "desc" }, { minor: "desc" }],
    select: { id: true, major: true, minor: true, status: true, clonedFromVersionId: true, moduleOrderJson: true },
  });

  // ① đóng băng bản cũ chưa chụp
  for (const v of ban) {
    if (DA_KHOA.includes(v.status) && !(await banDaKhoa(tx, v.id))) {
      await chupBan(tx, { versionId: v.id, courseId, banTruocId: null });
    }
  }

  const moiNhatKhoa = ban.find((v) => DA_KHOA.includes(v.status)) ?? null;
  const moiNhat = ban[0] ?? null;
  let nhap = ban.find((v) => v.status === "DRAFT") ?? null;

  if (!nhap) {
    const k = phienBanKeTiep(moiNhat ? { major: moiNhat.major, minor: moiNhat.minor } : null, "MINOR");
    // Nguồn sao chép = bản MỚI NHẤT theo số (kể cả đang chờ duyệt): người soạn tiếp tục từ nội dung mới nhất đã có.
    const goc = moiNhat;
    const tao = await tx.trnCourseVersion.create({
      // B-11c — thứ tự chương ĐẦY ĐỦ (cả chương rỗng) đi theo bản nguồn; `Prisma.JsonNull` khi nguồn chưa có (cột JSON không nhận `null` trần).
      data: {
        courseId, major: k.major, minor: k.minor, status: "DRAFT", clonedFromVersionId: goc?.id ?? null,
        moduleOrderJson: goc?.moduleOrderJson == null ? Prisma.JsonNull : (goc.moduleOrderJson as Prisma.InputJsonValue),
      },
      select: { id: true, major: true, minor: true, status: true, clonedFromVersionId: true, moduleOrderJson: true },
    });
    if (goc) {
      const dong = await tx.trnCourseVersionLesson.findMany({
        where: { versionId: goc.id },
        select: { lessonId: true, orderIndex: true, required: true, contentHash: true, moduleOrder: true },
      });
      if (dong.length) {
        await tx.trnCourseVersionLesson.createMany({ data: dong.map((d) => ({ ...d, versionId: tao.id })) });
      }
    }
    nhap = tao;
  } else if (nhap.clonedFromVersionId == null && moiNhatKhoa) {
    // ③ nháp sinh trước B-11: tập dòng thưa. Bổ sung từ bản khoá mới nhất (không ghi đè dòng nháp đã có — cờ bắt buộc người soạn đã đặt).
    const [coSan, dong] = await Promise.all([
      tx.trnCourseVersionLesson.findMany({ where: { versionId: nhap.id }, select: { lessonId: true } }),
      tx.trnCourseVersionLesson.findMany({
        where: { versionId: moiNhatKhoa.id },
        select: { lessonId: true, orderIndex: true, required: true, contentHash: true, moduleOrder: true },
      }),
    ]);
    const co = new Set(coSan.map((d) => d.lessonId));
    const them = dong.filter((d) => !co.has(d.lessonId));
    if (them.length) await tx.trnCourseVersionLesson.createMany({ data: them.map((d) => ({ ...d, versionId: nhap!.id })) });
    await tx.trnCourseVersion.update({ where: { id: nhap.id }, data: { clonedFromVersionId: moiNhatKhoa.id } });
  }

  // ④ bài sống chưa thuộc bản nào (seed/nhập tay) nhận vào nháp — dùng đúng bước làm mới của bản chụp.
  await chupBan(tx, { versionId: nhap.id, courseId, banTruocId: null, chiNhanBaiMoCoi: true });
  return { id: nhap.id, major: nhap.major, minor: nhap.minor };
}

export type KetQuaGhiBai = {
  /** Id bài mà người gọi PHẢI ghi vào (bài gốc nếu chưa khoá; bản tách nếu đã khoá). */
  lessonId: string;
  courseId: string;
  versionId: string;
  /** Có vừa tách bản trong lần gọi này. */
  daTachBan: boolean;
  /** Id bài người dùng gửi lên (khác `lessonId` khi đã tách bản — giao diện phải chuyển sang id mới). */
  tuLessonId: string;
};

/**
 * Trả id bài để GHI. Gọi trong giao dịch của đường ghi. `lessonId` có thể là bài gốc (đã khoá), hoặc bản tách đời trước khi giao diện cầm id cũ.
 */
export async function layBaiDeGhi(tx: Tx, lessonId: string): Promise<KetQuaGhiBai> {
  const goc = await tx.trnLesson.findFirst({
    where: { id: lessonId, deletedAt: null },
    select: { id: true, module: { select: { courseId: true } } },
  });
  if (!goc) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
  const courseId = goc.module.courseId;
  const nhap = await moBanNhap(tx, courseId);

  const dongNhap = await tx.trnCourseVersionLesson.findMany({
    where: { versionId: nhap.id },
    select: { id: true, lessonId: true, lesson: { select: { forkedFromLessonId: true } } },
  });
  const truc = dongNhap.find((d) => d.lessonId === goc.id);
  if (truc && !(await daKhoaBai(tx, goc.id))) {
    return { lessonId: goc.id, courseId, versionId: nhap.id, daTachBan: false, tuLessonId: goc.id };
  }
  if (!truc) {
    // Giao diện cầm id CŨ của một bài đã được tách ở bản nháp này (hai người soạn, hoặc tab cũ) ⇒ ghi vào bản tách của nháp, không tách lần hai.
    const daTach = dongNhap.find((d) => d.lesson.forkedFromLessonId === goc.id);
    if (daTach) return { lessonId: daTach.lessonId, courseId, versionId: nhap.id, daTachBan: false, tuLessonId: goc.id };
    throw new ActionError("NOT_FOUND", "Bài này không nằm trong bản nháp của khoá");
  }

  // Bài đã nằm trong bản đã khoá ⇒ TÁCH BẢN.
  const cu = await tx.trnLesson.findUniqueOrThrow({ where: { id: goc.id } });
  const cuoi = await tx.trnLesson.findFirst({ where: { moduleId: cu.moduleId }, orderBy: { orderIndex: "desc" }, select: { orderIndex: true } });
  const json = (v: Prisma.JsonValue | null) => (v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));
  const moi = await tx.trnLesson.create({
    data: {
      moduleId: cu.moduleId,
      title: cu.title,
      // Ô duy nhất trong chương: số kế tiếp, KHÔNG phải vị trí hiển thị (vị trí nằm ở dòng phiên bản).
      orderIndex: (cuoi?.orderIndex ?? -1) + 1,
      kind: cu.kind,
      contentMd: cu.contentMd,
      sourceGuideSlug: cu.sourceGuideSlug,
      minReadSeconds: cu.minReadSeconds,
      videoKey: cu.videoKey,
      videoKey360: cu.videoKey360,
      durationSec: cu.durationSec,
      videoMeta: json(cu.videoMeta),
      captionKey: cu.captionKey,
      transcriptMd: cu.transcriptMd,
      audioKey: cu.audioKey,
      cueCount: cu.cueCount,
      youtubeId: cu.youtubeId,
      youtubePhuDe: cu.youtubePhuDe,
      mediaRevision: cu.mediaRevision,
      scormPackageId: cu.scormPackageId,
      examId: cu.examId,
      rubricId: cu.rubricId,
      sessionDate: cu.sessionDate,
      forkedFromLessonId: cu.id,
    },
    select: { id: true },
  });
  const cues = await tx.trnLessonCue.findMany({ where: { lessonId: cu.id } });
  if (cues.length) {
    await tx.trnLessonCue.createMany({
      data: cues.map((c) => ({
        lessonId: moi.id,
        atSec: c.atSec,
        questionId: c.questionId,
        inlineJson: c.inlineJson === null ? Prisma.JsonNull : (c.inlineJson as Prisma.InputJsonValue),
        blocking: c.blocking,
        orderIndex: c.orderIndex,
      })),
    });
  }
  await tx.trnCourseVersionLesson.update({ where: { id: truc.id }, data: { lessonId: moi.id } });
  return { lessonId: moi.id, courseId, versionId: nhap.id, daTachBan: true, tuLessonId: goc.id };
}

/**
 * Ghi nội dung BÀI ĐỌC (tên + chữ + ngưỡng đọc) vào bài của bản nháp — một giao dịch: mở nháp, tách bản nếu cần, rồi ghi. Tách khỏi action để test chạy đúng
 * đường server chạy (tệp `"use server"` không nạp được trong vitest).
 */
export async function ghiBaiDoc(
  db: Pick<ScopedDb, "$transaction" | "trnLesson" | "trnCourse">,
  lessonId: string,
  data: { title: string; contentMd: string; minReadSeconds: number },
): Promise<KetQuaGhiBai> {
  // Cách ly cơ sở đi qua chuỗi cha: `TrnLesson` không nằm trong `SCOPED_MODELS` và `scopedDb` không che đường ghi, nên đọc KHOÁ qua `scopedDb` là cổng. Cùng một lỗi với
  // "bài không tồn tại" — phân biệt hai thứ là nói cho người dò biết id nào có thật.
  const bai = await db.trnLesson.findFirst({ where: { id: lessonId, deletedAt: null }, select: { module: { select: { courseId: true } } } });
  const khoa = bai ? await db.trnCourse.findFirst({ where: { id: bai.module.courseId, deletedAt: null }, select: { id: true } }) : null;
  if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
  return db.$transaction(async (tx) => {
    const g = await layBaiDeGhi(tx, lessonId);
    await tx.trnLesson.update({ where: { id: g.lessonId }, data });
    return g;
  });
}

/**
 * Bài của BẢN NHÁP thay cho bài này (CHỈ ĐỌC): đi theo dòng dõi tách bản tới bài mà bản nháp đang sở hữu. Trả `null` khi bài này đã là bài của nháp, hoặc nháp
 * không có bản tách nào của nó. Trang soạn dùng để dẫn người soạn tới ĐÚNG bài đang được sửa — mở lại URL cũ mà vẫn thấy chữ cũ thì người soạn tưởng lần lưu không ăn.
 */
export async function baiCuaBanNhap(
  db: Pick<ScopedDb, "trnLesson">,
  lessonId: string,
): Promise<string | null> {
  let cur = lessonId;
  for (let i = 0; i < 20; i += 1) {
    const con = await db.trnLesson.findFirst({
      where: { forkedFromLessonId: cur, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, versionLessons: { select: { version: { select: { status: true } } } } },
    });
    if (!con) return null;
    if (con.versionLessons.some((v) => v.version.status === "DRAFT")) return con.id;
    cur = con.id;
  }
  return null;
}

/** Bài này có nằm trong dòng của một phiên bản ĐÃ KHOÁ không. */
export async function daKhoaBai(tx: Pick<ScopedDb, "trnCourseVersionLesson">, lessonId: string): Promise<boolean> {
  const n = await tx.trnCourseVersionLesson.count({ where: { lessonId, version: { status: { in: [...TRANG_THAI_DA_KHOA] } } } });
  return n > 0;
}
