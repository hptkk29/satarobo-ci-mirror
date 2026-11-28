import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { LOAI_BAI_ZOD } from "@/lib/elearning/lesson-kind";
import { batBuocKeThua, chupBan } from "@/lib/elearning/ban-noi-dung";
import { banDaKhoa, docThuTuChuongLuuSan, thuTuChuongCuaBan } from "@/lib/elearning/ban-cua-luot";
import { moBanNhap } from "@/lib/elearning/sao-chep-khi-ghi";
import {
  chuyenViTri,
  kiemDanBai,
  kiemPhuDe,
  type ChuongTrongDanBai,
} from "@/lib/elearning/course-outline";
import {
  chuyenTrangThai,
  laThayDoiMajor,
  tenBanSao,
  THONG_BAO_PHIEN_BAN,
  type TrangThaiPhienBan,
} from "@/lib/elearning/course-version";

/**
 * EL-08 — SOẠN KHOÁ: tạo khoá → chương → bài, sắp thứ tự, xuất bản có phiên bản.
 *
 * ⚠️ MÔ HÌNH LÀM VIỆC: mỗi khoá luôn giữ ĐÚNG MỘT phiên bản `DRAFT` làm **bản
 * làm việc**. Cờ `required` (bài bắt buộc / tuỳ chọn) sống trên
 * `TrnCourseVersionLesson` của bản nháp đó, KHÔNG trên `TrnLesson`.
 *
 * Vì sao không thêm cột `required` vào `TrnLesson` cho gọn: một bài có thể bắt
 * buộc ở phiên bản này và tuỳ chọn ở phiên bản sau. Đặt cờ trên bài là ép mọi
 * phiên bản dùng chung một câu trả lời, tức xoá luôn lý do tồn tại của phiên bản.
 *
 * ⚠️ Xuất bản KHÔNG sinh bản ghi mới cho tập bài — nó chỉ đổi trạng thái của bản
 * nháp đang có. Tập bài của bản đã phát vì thế ĐỨNG YÊN kể cả khi bản nháp kế
 * tiếp đang được sửa.
 */

// ── Trợ giúp chung ─────────────────────────────────────────────────────────

async function layKhoa(db: ScopedDb, courseId: string) {
  const c = await db.trnCourse.findFirst({
    where: { id: courseId, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      programId: true,
      // (C10) — cổng phụ đề đọc `natureTag` của CHƯƠNG TRÌNH chứa khoá; khoá
      // không mang cờ bắt buộc của riêng nó.
      program: { select: { natureTag: true } },
    },
  });
  if (!c) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá học");
  return c;
}

/**
 * Phiên bản "đang làm việc" của khoá — CHỈ ĐỌC, không bao giờ mở bản nháp: nháp > chờ duyệt/đã duyệt > đã xuất bản gần nhất. `null` = khoá chưa có bản nào.
 */
async function banLamViec(db: ScopedDb, courseId: string): Promise<{ id: string } | null> {
  const chon = (status: TrangThaiPhienBan | TrangThaiPhienBan[]) =>
    db.trnCourseVersion.findFirst({
      where: { courseId, status: Array.isArray(status) ? { in: status } : status },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
      select: { id: true },
    });
  return (await chon("DRAFT")) ?? (await chon(["PENDING_REVIEW", "APPROVED"])) ?? (await chon("PUBLISHED"));
}

/**
 * Thứ tự bài trong từng chương CỦA MỘT PHIÊN BẢN (B-11): bản có tập bài TƯỜNG MINH (nháp do cổng ghi sao chép, hoặc bản đã chụp) đọc theo DÒNG PHIÊN BẢN —
 * tách bản nằm cùng chương với bài gốc nên cây sống KHÔNG còn nói được "bản này có bài nào". Bản kiểu cũ / khoá chưa có bản nào ⇒ cây sống như trước.
 * Trả `null` khi dùng cây sống (người gọi tự đọc).
 */
async function bangDongCuaBan(
  db: ScopedDb,
  versionId: string | null,
): Promise<{ dong: { lessonId: string; orderIndex: number; required: boolean; moduleOrder: number | null }[]; luuSan: Record<string, number> | null } | null> {
  if (!versionId) return null;
  const ver = await db.trnCourseVersion.findUnique({ where: { id: versionId }, select: { clonedFromVersionId: true, moduleOrderJson: true } });
  if (!ver) return null;
  if (ver.clonedFromVersionId == null && !(await banDaKhoa(db, versionId))) return null;
  const dong = await db.trnCourseVersionLesson.findMany({
    where: { versionId, lesson: { deletedAt: null } },
    orderBy: { orderIndex: "asc" },
    select: { lessonId: true, orderIndex: true, required: true, moduleOrder: true },
  });
  // B-11c — thứ tự chương ĐẦY ĐỦ của bản (có cả chương rỗng); đọc an toàn, dạng hỏng ⇒ null.
  return { dong, luuSan: docThuTuChuongLuuSan(ver.moduleOrderJson) };
}

/**
 * ⚠️ ĐỌC KHÔNG BAO GIỜ MỞ BẢN NHÁP (chỉ các đường GHI mới gọi `moBanNhap`). `versionId` = đọc dàn bài THEO ĐÚNG phiên bản đó (bước chuyển
 * trạng thái); không truyền (trình soạn) ⇒ bản đang làm việc: nháp > chờ duyệt/đã duyệt > đã xuất bản gần nhất; chưa có bản nào ⇒ không có
 * dòng phiên bản (mọi bài mặc định bắt buộc). Bản cũ của hàm này gọi `banNhap` nên chỉ MỞ TRÌNH SOẠN khi khoá đang chờ duyệt cũng ĐẺ một bản nháp
 * rỗng v(minor+1) — bước DUYỆT/XUẤT BẢN sau đó chọn đúng bản rỗng ấy (mới nhất) và từ chối `SAI_LUONG`.
 */
async function docDanBai(db: ScopedDb, courseId: string, versionId?: string): Promise<ChuongTrongDanBai[]> {
  const nhap: { id: string } | null = versionId ? { id: versionId } : await banLamViec(db, courseId);
  const banTuongMinh = await bangDongCuaBan(db, nhap?.id ?? null);
  const dongBan = banTuongMinh?.dong ?? null;
  const CHON_BAI = {
    id: true,
    title: true,
    kind: true,
    moduleId: true,
    orderIndex: true,
    contentMd: true,
    captionKey: true,
    // Nguồn YouTube — cổng phụ đề (`kiemPhuDe`) đọc hai cột này thay `captionKey`.
    // Thiếu một trong hai ở đây (hoặc ở bước `.map()` bên dưới) thì mọi bài YouTube
    // của khoá bắt buộc bị chặn "thiếu phụ đề" dù người soạn đã xác nhận.
    youtubeId: true,
    youtubePhuDe: true,
    // Cổng `BAI_VIDEO_CHUA_CO_NGUON` đọc `videoKey` + `durationSec` (cùng `youtubeId` ở trên).
    // Thiếu một cột ở đây (hoặc ở bước `.map()` bên dưới) thì cổng đọc `undefined` và nổ OAN
    // trên mọi bài video đã có nguồn — người soạn không có cách nào hiểu vì sao.
    videoKey: true,
    durationSec: true,
    minReadSeconds: true,
    // EL-14d — cổng xuất bản đòi bài `QUIZ` phải có đề. Thiếu trường này ở
    // đây thì cổng đọc `undefined` và KHÔNG BAO GIỜ nổ — một cổng chặn im
    // lặng không chặn gì.
    examId: true,
    // EL-15c — cùng lý do: cổng đòi bài `TASK` phải có khung chấm. Thiếu
    // trường này thì cổng đọc `undefined` và không bao giờ nổ.
    rubricId: true,
  } as const;
  const [chuongSong, bai] = await Promise.all([
    db.trnModule.findMany({ where: { courseId }, orderBy: { orderIndex: "asc" }, select: { id: true, title: true, orderIndex: true } }),
    dongBan
      ? db.trnLesson.findMany({ where: { id: { in: dongBan.map((d) => d.lessonId) }, deletedAt: null }, select: CHON_BAI })
      : db.trnLesson.findMany({ where: { module: { courseId }, deletedAt: null }, orderBy: { orderIndex: "asc" }, select: CHON_BAI }),
  ]);
  const theoId = new Map(bai.map((b) => [b.id, b]));
  // Thứ tự bài: theo dòng phiên bản (bản tường minh) hoặc theo cột của bài (cây sống — `bai` đã sắp sẵn).
  const dsBai = dongBan ? dongBan.flatMap((d) => (theoId.has(d.lessonId) ? [theoId.get(d.lessonId)!] : [])) : bai;
  // CÙNG quy tắc với bản chụp và màn duyệt (`batBuocKeThua`): dòng của bản này → dòng của bản đã xuất bản trước → bắt buộc.
  const links = nhap
    ? dongBan ?? (await db.trnCourseVersionLesson.findMany({ where: { versionId: nhap.id }, select: { lessonId: true, required: true } }))
    : [];
  const banTruocDocBai = nhap
    ? await db.trnCourseVersion.findFirst({
        where: { courseId, status: "PUBLISHED", id: { not: nhap.id } },
        orderBy: [{ major: "desc" }, { minor: "desc" }],
        select: { id: true },
      })
    : null;
  const linksTruoc = banTruocDocBai
    ? await db.trnCourseVersionLesson.findMany({ where: { versionId: banTruocDocBai.id }, select: { lessonId: true, required: true } })
    : [];
  const batBuocNay = new Map(links.map((l) => [l.lessonId, l.required]));
  const batBuocTruoc = new Map(linksTruoc.map((l) => [l.lessonId, l.required]));

  // B-11b — thứ tự CHƯƠNG của bản (bản tường minh đã sắp lại chương); bản kiểu cũ theo thứ tự chương hiện hành.
  const thuTuChuong = dongBan
    ? thuTuChuongCuaBan(
        chuongSong,
        dongBan.flatMap((d) => (theoId.has(d.lessonId) ? [{ moduleId: theoId.get(d.lessonId)!.moduleId, moduleOrder: d.moduleOrder }] : [])),
        banTuongMinh?.luuSan ?? null,
      )
    : null;
  const chuongTheoThuTu = thuTuChuong ? [...chuongSong].sort((a, b) => (thuTuChuong.get(a.id) ?? 0) - (thuTuChuong.get(b.id) ?? 0)) : chuongSong;

  return chuongTheoThuTu.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: dsBai
      .filter((b) => b.moduleId === m.id)
      .map((b) => ({
        id: b.id,
        title: b.title,
        kind: b.kind,
        contentMd: b.contentMd,
        captionKey: b.captionKey,
        youtubeId: b.youtubeId,
        youtubePhuDe: b.youtubePhuDe,
        videoKey: b.videoKey,
        durationSec: b.durationSec,
        minReadSeconds: b.minReadSeconds,
        // ⚠️ CHỖ THỨ TƯ. `select` ở trên có hai cột này, nhưng chép chúng vào đối
        // tượng trả lại là một bước RIÊNG — và bước đó từng bị bỏ quên.
        //
        // Vì `BaiTrongDanBai.examId?`/`rubricId?` khai OPTIONAL nên TypeScript im
        // lặng, `kiemDanBai` đọc `undefined`, và cổng `!b.examId` / `!b.rubricId`
        // NỔ VĨNH VIỄN: không khoá nào chứa bài QUIZ hay TASK rời khỏi nháp được,
        // kể cả khi `TrnLesson.examId`/`rubricId` đã có giá trị đúng trong DB.
        // Người soạn thấy trình soạn báo "đã gắn đề" mà cổng vẫn bảo "chưa gắn".
        //
        // Lỗi này có từ EL-14 với `examId` (bài QUIZ trên `test` đang kẹt), và
        // EL-15c suýt nhân đôi nó sang `rubricId`.
        examId: b.examId,
        rubricId: b.rubricId,
        // Bài chưa có dòng phiên bản ⇒ coi là BẮT BUỘC. Mặc định phía chặt: đoán
        // "tuỳ chọn" sẽ âm thầm bỏ bài đó khỏi điều kiện hoàn thành.
        required: batBuocKeThua(b.id, batBuocNay, batBuocTruoc),
      })),
  }));
}

// ── Tạo khoá ───────────────────────────────────────────────────────────────

export const taoKhoaSchema = z
  .object({
    programId: z.string().min(1, "Khoá phải thuộc một chương trình"),
    title: z.string().trim().min(1, "Tên khoá không được trống"),
    summary: z.union([z.null(), z.string().trim()]).optional(),
    estimatedMinutes: z.union([z.null(), z.number().int().min(1).max(6000)]).optional(),
  })
  .strict();

export const cauHinhTaoKhoa: ActionConfig<
  z.infer<typeof taoKhoaSchema>,
  { courseId: string; code: string }
> = {
  name: "taoKhoa",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnCourse",
  auditAction: "CREATE",
  schema: taoKhoaSchema,
  handler: async ({ db, actor, input }) => {
    // ⚠️ Khoá BẮT BUỘC thuộc một chương trình, không tạo khoá mồ côi. Chương trình
    // là nơi giữ sáu nhóm thẻ phân loại và mối nối với phiếu nhu cầu (§8.1); khoá
    // đứng ngoài là một đường vòng qua toàn bộ luật đó.
    const ct = await db.trnProgram.findFirst({
      where: { id: input.programId, deletedAt: null },
      select: { id: true, code: true, securityTag: true, centerId: true, orgUnitId: true },
    });
    if (!ct) throw new ActionError("NOT_FOUND", "Không tìm thấy chương trình", "programId");

    const dem = await db.trnCourse.count({ where: { programId: ct.id } });

    let tao: { id: string; code: string } | null = null;
    for (let lan = 1; lan <= 20 && !tao; lan += 1) {
      const code = `${ct.code}.K${String(dem + lan).padStart(2, "0")}`;
      const slug = code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const trung = await db.trnCourse.findFirst({
        where: { OR: [{ code }, { slug }] },
        select: { id: true },
      });
      if (trung) continue;
      tao = await db.trnCourse.create({
        data: {
          programId: ct.id,
          code,
          slug,
          title: input.title,
          summary: input.summary ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          status: "DRAFT",
          // Kế thừa mức bảo mật của chương trình (C7): khoá không được LỎNG HƠN
          // chương trình chứa nó, nếu không thẻ bảo mật ở cấp trên thành trang trí.
          securityLevel: ct.securityTag,
          visibility: "ASSIGNED_ONLY",
          selfEnrollEnabled: false,
          centerId: ct.centerId,
          orgUnitId: ct.orgUnitId,
          ownerUserId: actor.userId,
          createdById: actor.userId,
        },
        select: { id: true, code: true },
      });
    }
    if (!tao) throw new ActionError("CONFLICT", "Không sinh được mã khoá, thử lại giúp tôi");

    // Dựng luôn bản nháp v1.0: khoá không có bản nháp thì mọi thao tác soạn sau
    // đó phải tự tạo, và mỗi chỗ tự tạo là một chỗ có thể tạo khác nhau.
    await db.$transaction((tx) => moBanNhap(tx, tao.id));

    return {
      entityId: tao.id,
      data: { courseId: tao.id, code: tao.code },
      newValues: { code: tao.code, title: input.title, thuocChuongTrinh: ct.code },
    };
  },
};

// ── Tạo chương ─────────────────────────────────────────────────────────────

export const taoChuongSchema = z
  .object({ courseId: z.string().min(1), title: z.string().trim().min(1) })
  .strict();

export const cauHinhTaoChuong: ActionConfig<
  z.infer<typeof taoChuongSchema>,
  { moduleId: string }
> = {
  name: "taoChuong",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnModule",
  auditAction: "CREATE",
  schema: taoChuongSchema,
  handler: async ({ db, input }) => {
    await layKhoa(db, input.courseId);
    const cuoi = await db.trnModule.findFirst({
      where: { courseId: input.courseId },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });
    const m = await db.trnModule.create({
      data: {
        courseId: input.courseId,
        title: input.title,
        orderIndex: (cuoi?.orderIndex ?? -1) + 1,
      },
      select: { id: true },
    });
    return {
      entityId: m.id,
      data: { moduleId: m.id },
      newValues: { title: input.title },
    };
  },
};

// ── Tạo bài ────────────────────────────────────────────────────────────────

export const taoBaiSchema = z
  .object({
    moduleId: z.string().min(1),
    title: z.string().trim().min(1),
    // ⚠️ Chỉ loại ĐÃ MỞ. Nhận cả 6 loại của enum nghĩa là cho tạo bài mà không
    // đường nào tới được người học — xem `lib/elearning/lesson-kind.ts`.
    kind: z.enum(LOAI_BAI_ZOD),
    required: z.boolean().default(true),
  })
  .strict();

export const cauHinhTaoBai: ActionConfig<
  z.infer<typeof taoBaiSchema>,
  { lessonId: string }
> = {
  name: "taoBai",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "CREATE",
  schema: taoBaiSchema,
  handler: async ({ db, input }) => {
    const m = await db.trnModule.findFirst({
      where: { id: input.moduleId },
      select: { id: true, courseId: true },
    });
    if (!m) throw new ActionError("NOT_FOUND", "Không tìm thấy chương");

    // B-11 — một giao dịch, sau khi khoá khoá học: mở bản nháp (tập bài tường minh) rồi mới thêm bài. Bài mới là của BẢN NHÁP; người đang học bản đã
    // phát hành không bao giờ thấy nó (họ đọc theo dòng phiên bản của bản họ đã ghim).
    const b = await db.$transaction(async (tx) => {
      const nhap = await moBanNhap(tx, m.courseId);
      // Ô duy nhất trong chương (kể cả bản tách): số kế tiếp theo CỘT của bài. Vị trí hiển thị là `orderIndex` của DÒNG phiên bản: kế tiếp trong chương CỦA BẢN NHÁP.
      const cuoi = await tx.trnLesson.findFirst({
        where: { moduleId: m.id },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });
      const cuoiBan = await tx.trnCourseVersionLesson.findFirst({
        where: { versionId: nhap.id, lesson: { moduleId: m.id } },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true, moduleOrder: true },
      });
      // B-11c — chương vừa RỖNG (chưa có dòng nào mang số) nhận vị trí đã lưu của nó, không thì nó nhảy xuống cuối ngay lần thêm bài đầu tiên.
      const luuSan = cuoiBan?.moduleOrder == null
        ? docThuTuChuongLuuSan((await tx.trnCourseVersion.findUnique({ where: { id: nhap.id }, select: { moduleOrderJson: true } }))?.moduleOrderJson)
        : null;
      const moi = await tx.trnLesson.create({
        data: {
          moduleId: m.id,
          title: input.title,
          kind: input.kind,
          orderIndex: (cuoi?.orderIndex ?? -1) + 1,
        },
        select: { id: true },
      });
      // Gắn ngay vào bản nháp: bài không có dòng phiên bản là bài vô hình với mọi
      // phép đếm điều kiện hoàn thành.
      await tx.trnCourseVersionLesson.create({
        data: {
          versionId: nhap.id,
          lessonId: moi.id,
          orderIndex: (cuoiBan?.orderIndex ?? -1) + 1,
          required: input.required,
          contentHash: "",
          // Bài mới vào chương nào thì mang thứ tự chương của bản ở chương đó (chương chưa có dòng ⇒ NULL, xếp sau chương đã sắp lại).
          moduleOrder: cuoiBan?.moduleOrder ?? luuSan?.[m.id] ?? null,
        },
      });
      return moi;
    });

    return {
      entityId: b.id,
      data: { lessonId: b.id },
      newValues: { title: input.title, kind: input.kind, required: input.required },
    };
  },
};

// ── Sắp thứ tự (kéo thả) ───────────────────────────────────────────────────

export const sapThuTuSchema = z
  .object({
    loai: z.enum(["CHUONG", "BAI"]),
    /** `courseId` khi sắp chương, `moduleId` khi sắp bài. */
    parentId: z.string().min(1),
    id: z.string().min(1),
    viTriMoi: z.number().int().min(0),
  })
  .strict();

export const cauHinhSapThuTu: ActionConfig<
  z.infer<typeof sapThuTuSchema>,
  { thuTu: string[] }
> = {
  name: "sapThuTu",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnCourse",
  auditAction: "UPDATE",
  schema: sapThuTuSchema,
  handler: async ({ db, input }) => {
    // ⚠️ HAI PHA trong CÙNG một transaction. Ghi thẳng số mới sẽ va `@@unique([courseId, orderIndex])` ngay ở bước đầu, vì lúc đó vẫn còn phần tử mang số đích.
    // (Chỉ áp cho CHƯƠNG. Thứ tự BÀI là của DÒNG PHIÊN BẢN — không có ràng buộc duy nhất — nên ghi thẳng.)
    // Thứ tự bài ghi vào dòng của BẢN NHÁP (B-11): sắp lại không bao giờ đổi thứ tự của người đang học bản đã phát hành.
    // ⚠️ Thứ tự CHƯƠNG vẫn là của cây sống (chưa phiên bản hoá — ghi ở B-11, phần còn lại).
    let moi: string[] = [];
    await db.$transaction(async (tx) => {
      if (input.loai === "CHUONG") {
        // B-11b — thứ tự chương là của BẢN NHÁP (cột `moduleOrder` trên dòng phiên bản), không còn đổi `TrnModule.orderIndex` dưới chân người đang học.
        const nhap = await moBanNhap(tx, input.parentId);
        const [chuong, dong, banRow] = await Promise.all([
          tx.trnModule.findMany({ where: { courseId: input.parentId }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true } }),
          tx.trnCourseVersionLesson.findMany({ where: { versionId: nhap.id }, select: { id: true, moduleOrder: true, lesson: { select: { moduleId: true } } } }),
          tx.trnCourseVersion.findUnique({ where: { id: nhap.id }, select: { moduleOrderJson: true } }),
        ]);
        const hienTai = thuTuChuongCuaBan(chuong, dong.map((d) => ({ moduleId: d.lesson.moduleId, moduleOrder: d.moduleOrder })), docThuTuChuongLuuSan(banRow?.moduleOrderJson));
        const theoThuTu = [...chuong].sort((a, b) => (hienTai.get(a.id) ?? 0) - (hienTai.get(b.id) ?? 0)).map((c) => c.id);
        moi = chuyenViTri(theoThuTu, input.id, input.viTriMoi);
        const viTri = new Map(moi.map((id, i) => [id, i]));
        // B-11c — vị trí của MỌI chương (kể cả rỗng) lưu trên bản nháp; chương rỗng không có dòng nào để mang `moduleOrder`.
        await tx.trnCourseVersion.update({ where: { id: nhap.id }, data: { moduleOrderJson: Object.fromEntries(viTri) } });
        for (const d of dong) {
          const v = viTri.get(d.lesson.moduleId);
          if (v !== undefined && v !== d.moduleOrder) await tx.trnCourseVersionLesson.update({ where: { id: d.id }, data: { moduleOrder: v } });
        }
        return;
      }
      const chuong = await tx.trnModule.findFirst({ where: { id: input.parentId }, select: { courseId: true } });
      if (!chuong) throw new ActionError("NOT_FOUND", "Không tìm thấy chương");
      const nhap = await moBanNhap(tx, chuong.courseId);
      const dong = await tx.trnCourseVersionLesson.findMany({
        where: { versionId: nhap.id, lesson: { moduleId: input.parentId, deletedAt: null } },
        orderBy: { orderIndex: "asc" },
        select: { id: true, lessonId: true },
      });
      moi = chuyenViTri(dong.map((d) => d.lessonId), input.id, input.viTriMoi);
      const dongTheoBai = new Map(dong.map((d) => [d.lessonId, d.id]));
      for (const [i, lessonId] of moi.entries()) {
        await tx.trnCourseVersionLesson.update({ where: { id: dongTheoBai.get(lessonId)! }, data: { orderIndex: i } });
      }
    });

    return {
      entityId: input.parentId,
      data: { thuTu: moi },
      newValues: { loai: input.loai, soPhanTu: moi.length },
    };
  },
};

// ── Bắt buộc / tuỳ chọn + học tuần tự ──────────────────────────────────────

export const datBatBuocSchema = z
  .object({
    courseId: z.string().min(1),
    lessonId: z.string().min(1),
    required: z.boolean(),
  })
  .strict();

export const cauHinhDatBatBuoc: ActionConfig<
  z.infer<typeof datBatBuocSchema>,
  { required: boolean }
> = {
  name: "datBaiBatBuoc",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnCourseVersionLesson",
  auditAction: "UPDATE",
  schema: datBatBuocSchema,
  handler: async ({ db, input }) => {
    await layKhoa(db, input.courseId);

    // ⚠️ CHỈ sửa được trên BẢN NHÁP. Sửa cờ trên bản đã xuất bản là đổi điều kiện
    // hoàn thành dưới chân người đang học — đúng thứ mà phiên bản sinh ra để chống.
    // B-11: bài phải nằm trong bản nháp (không còn `upsert` tạo dòng cho bài lạ); id bài cũ của giao diện (đã tách bản) được dẫn sang bản tách.
    const nhap = await db.$transaction(async (tx) => {
      const n = await moBanNhap(tx, input.courseId);
      const dong = await tx.trnCourseVersionLesson.findMany({
        where: { versionId: n.id, OR: [{ lessonId: input.lessonId }, { lesson: { forkedFromLessonId: input.lessonId } }] },
        select: { id: true },
        take: 1,
      });
      if (!dong[0]) throw new ActionError("NOT_FOUND", "Bài này không nằm trong bản nháp của khoá");
      await tx.trnCourseVersionLesson.update({ where: { id: dong[0].id }, data: { required: input.required } });
      return n;
    });

    return {
      entityId: input.lessonId,
      data: { required: input.required },
      newValues: { required: input.required, phienBan: `v${nhap.major}.${nhap.minor}` },
    };
  },
};

export const datTuanTuSchema = z
  .object({ courseId: z.string().min(1), sequential: z.boolean() })
  .strict();

export const cauHinhDatTuanTu: ActionConfig<
  z.infer<typeof datTuanTuSchema>,
  { sequential: boolean }
> = {
  name: "datHocTuanTu",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnCourse",
  auditAction: "UPDATE",
  schema: datTuanTuSchema,
  handler: async ({ db, input }) => {
    const c = await layKhoa(db, input.courseId);
    await db.trnCourse.update({
      where: { id: c.id },
      data: { sequential: input.sequential },
    });
    return {
      entityId: c.id,
      data: { sequential: input.sequential },
      newValues: { sequential: input.sequential },
    };
  },
};

// ── Vòng đời xuất bản ──────────────────────────────────────────────────────

/**
 * KẾT QUẢ CÁC CỔNG của một phiên bản (dàn bài hợp lệ + phụ đề) — MỘT nguồn cho cả bước chuyển trạng thái lẫn màn duyệt, để màn duyệt
 * không bao giờ nói "đạt" trong khi bước xuất bản từ chối (hoặc ngược lại). CHỈ ĐỌC, không mở bản nháp.
 */
export async function kiemBanXuatBan(
  db: ScopedDb,
  c: { id: string; program: { natureTag: string | null } | null },
  versionId: string,
): Promise<{ ok: boolean; loi: { code: string; chiTiet: string }[] }> {
  const danBai = await docDanBai(db, c.id, versionId);
  const kiemCauTruc = kiemDanBai(danBai);
  // (C10) — cổng phụ đề đứng NGANG HÀNG với cổng dàn bài, không phải cảnh báo
  // mềm: bổ sung phụ đề hồi tố cho khoá đã xuất bản là việc không ai làm nổi.
  const kiemCaption = kiemPhuDe({ chuong: danBai, natureTag: c.program?.natureTag ?? null });
  return {
    ok: kiemCauTruc.ok && kiemCaption.ok,
    loi: [...kiemCauTruc.loi, ...kiemCaption.loi],
  };
}

export const vongDoiSchema = z
  .object({
    courseId: z.string().min(1),
    hanhDong: z.enum(["GUI_DUYET", "TRA_LAI", "DUYET", "XUAT_BAN", "LUU_TRU"]),
  })
  .strict();

export const cauHinhVongDoiKhoa: ActionConfig<
  z.infer<typeof vongDoiSchema>,
  { trangThai: string; phienBan: string; loi: { code: string; chiTiet: string }[] }
> = {
  name: "vongDoiKhoa",
  // Xuất bản là quyền RIÊNG, khác quyền soạn: người soạn nội dung không tự quyết
  // được lúc nào nội dung của mình đi ra với cả công ty.
  permission: "elearning:content:publish",
  module: "elearning",
  entityType: "TrnCourseVersion",
  auditAction: "UPDATE",
  requireReason: true,
  schema: vongDoiSchema,
  handler: async ({ db, actor, input, reason }) => {
    const c = await layKhoa(db, input.courseId);

    // ⚠️ Chọn bản theo TRẠNG THÁI NGUỒN của hành động, không theo "bản mới nhất": nếu có thêm một bản nháp (người soạn sửa tiếp trong lúc
    // bản kia chờ duyệt) thì "mới nhất" là bản nháp, và DUYỆT/XUẤT BẢN sẽ bị từ chối oan `SAI_LUONG` dù đã có bản đúng trạng thái.
    // Không có bản nào đúng trạng thái nguồn ⇒ rơi về bản làm việc mới nhất để MÁY TRẠNG THÁI từ chối bằng đúng mã `SAI_LUONG`.
    const NGUON: Record<(typeof input)["hanhDong"], TrangThaiPhienBan[]> = {
      GUI_DUYET: ["DRAFT"],
      TRA_LAI: ["PENDING_REVIEW", "APPROVED"],
      DUYET: ["PENDING_REVIEW"],
      XUAT_BAN: ["APPROVED"],
      LUU_TRU: ["PUBLISHED"],
    };
    const chonBan = (status: TrangThaiPhienBan[]) =>
      db.trnCourseVersion.findFirst({
        where: { courseId: c.id, status: { in: status } },
        orderBy: [{ major: "desc" }, { minor: "desc" }],
        select: { id: true, major: true, minor: true, status: true },
      });
    const ban =
      (await chonBan(NGUON[input.hanhDong])) ??
      (input.hanhDong === "LUU_TRU" ? null : await chonBan(["DRAFT", "PENDING_REVIEW", "APPROVED"]));
    if (!ban) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy phiên bản phù hợp cho thao tác này");
    }

    // B-11 — mỗi khoá chỉ một bản nháp tại một thời điểm: trả bản chờ duyệt về nháp khi đã có nháp khác là đẻ HAI nháp, và `moBanNhap` chỉ chọn được một.
    if (input.hanhDong === "TRA_LAI") {
      const nhapKhac = await db.trnCourseVersion.count({ where: { courseId: c.id, status: "DRAFT", id: { not: ban.id } } });
      if (nhapKhac > 0) {
        throw new ActionError("CONFLICT", "Khoá đã có một bản nháp khác đang soạn — gửi duyệt bản nháp đó trước khi trả bản này về nháp");
      }
    }

    const kiem = await kiemBanXuatBan(db, c, ban.id);

    const ket = chuyenTrangThai({
      tu: ban.status as TrangThaiPhienBan,
      hanhDong: input.hanhDong,
      danBaiHopLe: kiem.ok,
    });
    if (!ket.ok) {
      throw new ActionError(ket.code, THONG_BAO_PHIEN_BAN[ket.code]);
    }

    // Bản PUBLISHED gần nhất KHÁC bản này — nguồn kế thừa cờ `required` cho bài chưa có dòng (xem `chupBan`).
    const banTruoc =
      input.hanhDong === "TRA_LAI" || input.hanhDong === "LUU_TRU"
        ? null
        : await db.trnCourseVersion.findFirst({
            where: { courseId: c.id, status: "PUBLISHED", id: { not: ban.id } },
            orderBy: [{ major: "desc" }, { minor: "desc" }],
            select: { id: true },
          });

    await db.$transaction(async (tx) => {
      // P5a: mọi bước TIẾN (gửi duyệt · duyệt · xuất bản) chụp lại nội dung phiên bản NGAY TRONG giao dịch của bước đó — bản được
      // duyệt/xuất bản là bản có vân tay thật và có đủ mọi bài còn sống. Trả lại/lưu trữ không chụp (không phải bước tiến).
      if (input.hanhDong !== "TRA_LAI" && input.hanhDong !== "LUU_TRU") {
        await chupBan(tx, { versionId: ban.id, courseId: c.id, banTruocId: banTruoc?.id ?? null });
      }
      await tx.trnCourseVersion.update({
        where: { id: ban.id },
        data: {
          status: ket.toi,
          changeNote: reason,
          ...(ket.toi === "PENDING_REVIEW" ? { submittedByUserId: actor.userId, submittedAt: new Date() } : {}),
          ...(ket.toi === "APPROVED" ? { approvedAt: new Date() } : {}),
          ...(ket.toi === "APPROVED" ? { approvedByUserId: actor.userId } : {}),
          ...(ket.toi === "PUBLISHED"
            ? { publishedByUserId: actor.userId, publishedAt: new Date() }
            : {}),
        },
      });

      // Trạng thái KHOÁ đi theo trạng thái bản mới nhất — nhưng chỉ ở hai mốc có
      // nghĩa với người học: đã phát ra, và đã ngừng phát.
      if (ket.toi === "PUBLISHED") {
        await tx.trnCourse.update({
          where: { id: c.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
      } else if (ket.toi === "ARCHIVED") {
        await tx.trnCourse.update({ where: { id: c.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      }
    });

    return {
      entityId: ban.id,
      data: {
        trangThai: ket.toi,
        phienBan: `v${ban.major}.${ban.minor}`,
        loi: kiem.loi,
      },
      oldValues: { status: ban.status },
      newValues: { status: ket.toi, phienBan: `v${ban.major}.${ban.minor}` },
    };
  },
};

// ── Nhân bản khoá ──────────────────────────────────────────────────────────

export const nhanBanSchema = z.object({ courseId: z.string().min(1) }).strict();

export const cauHinhNhanBanKhoa: ActionConfig<
  z.infer<typeof nhanBanSchema>,
  { courseId: string; code: string }
> = {
  name: "nhanBanKhoa",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnCourse",
  auditAction: "CREATE",
  schema: nhanBanSchema,
  handler: async ({ db, actor, input }) => {
    const goc = await db.trnCourse.findFirst({
      where: { id: input.courseId, deletedAt: null },
      select: {
        id: true,
        code: true,
        title: true,
        slug: true,
        summary: true,
        programId: true,
        sequential: true,
        securityLevel: true,
        visibility: true,
        estimatedMinutes: true,
        centerId: true,
        orgUnitId: true,
      },
    });
    if (!goc) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá để nhân bản");

    // Tìm hậu tố còn trống. Nhân bản lần thứ hai của cùng một khoá là chuyện
    // thường — Đào tạo dựng nhiều biến thể từ một khoá gốc.
    let ten: ReturnType<typeof tenBanSao> | null = null;
    for (let lan = 1; lan <= 20; lan += 1) {
      const thu = tenBanSao({ code: goc.code, title: goc.title, lan });
      const trung = await db.trnCourse.findFirst({
        where: { OR: [{ code: thu.code }, { slug: thu.slug }] },
        select: { id: true },
      });
      if (!trung) {
        ten = thu;
        break;
      }
    }
    if (!ten) throw new ActionError("CONFLICT", "Quá nhiều bản sao của khoá này");

    const moi = await db.$transaction(async (tx) => {
      const c = await tx.trnCourse.create({
        data: {
          code: ten.code,
          slug: ten.slug,
          title: ten.title,
          summary: goc.summary,
          programId: goc.programId,
          sequential: goc.sequential,
          securityLevel: goc.securityLevel,
          // ⚠️ Bản sao LUÔN về nháp và LUÔN `ASSIGNED_ONLY`, bất kể bản gốc thế
          // nào: nhân bản một khoá đang phát ra mà giữ nguyên trạng thái là phát
          // ngay một bản chưa ai xem lại.
          status: "DRAFT",
          visibility: "ASSIGNED_ONLY",
          selfEnrollEnabled: false,
          estimatedMinutes: goc.estimatedMinutes,
          centerId: goc.centerId,
          orgUnitId: goc.orgUnitId,
          clonedFromCourseId: goc.id,
          ownerUserId: actor.userId,
          createdById: actor.userId,
        },
        select: { id: true, code: true },
      });

      const modules = await tx.trnModule.findMany({
        where: { courseId: goc.id },
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          orderIndex: true,
          lessons: {
            where: { deletedAt: null },
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              title: true,
              kind: true,
              orderIndex: true,
              contentMd: true,
              minReadSeconds: true,
              // ⚠️ PHẢI chép hai cột nối này, nếu không bản sao có bài `QUIZ`/`TASK`
              // mà KHÔNG có đề / khung — và cổng xuất bản chặn nó với câu "chưa gắn
              // đề thi" trên một khoá người soạn vừa nhân bản từ khoá đã chạy tốt.
              // Họ không có cách nào hiểu vì sao.
              //
              // `examId` vốn đã rớt từ EL-14; `rubricId` sẽ rớt y hệt nếu không thêm
              // ở đây. Cùng một dòng, cùng một lỗi.
              examId: true,
              rubricId: true,
              // ⚠️ Cùng một lỗi, cùng một dòng: bản sao mất phụ đề thì cổng xuất bản
              // chặn với "bài video thiếu phụ đề", và mất `videoKey` thì bài video
              // của bản sao rỗng — người soạn phải tải lại toàn bộ video.
              captionKey: true,
              videoKey: true,
              // Bản sao của bài dùng link YouTube mà thiếu hai cột này là bài video RỖNG
              // (videoKey cũng null) — cùng loại mất mát với `videoKey` ngay trên.
              youtubeId: true,
              youtubePhuDe: true,
              durationSec: true,
              sessionDate: true,
            },
          },
        },
      });

      // B-11 — nhân bản đúng NỘI DUNG CỦA BẢN ĐANG LÀM VIỆC, không phải cả cây sống: bài đã tách bản nằm cùng chương với bài gốc, chép cả hai là bản sao có bài đôi.
      const banNguon = await bangDongCuaBan(db, (await banLamViec(db, goc.id))?.id ?? null);
      const dongBan = banNguon?.dong ?? null;
      const thuTuTrongBan = dongBan ? new Map(dongBan.map((d) => [d.lessonId, d.orderIndex])) : null;
      // B-11c — chương của bản sao theo THỨ TỰ CHƯƠNG CỦA BẢN ĐANG LÀM VIỆC (kể cả chương rỗng qua `moduleOrderJson`), không theo cột của cây sống:
      // người soạn đã kéo chương ở bản nháp thì bản sao phải ra đúng thứ tự đó. Bản kiểu cũ (không dòng phiên bản) giữ nguyên thứ tự cây sống.
      const chuongCuaBai = new Map(modules.flatMap((m) => m.lessons.map((b) => [b.id, m.id] as const)));
      const thuTuChuongBan = banNguon
        ? thuTuChuongCuaBan(
            modules,
            banNguon.dong.flatMap((d) => (chuongCuaBai.has(d.lessonId) ? [{ moduleId: chuongCuaBai.get(d.lessonId)!, moduleOrder: d.moduleOrder }] : [])),
            banNguon.luuSan,
          )
        : null;
      const chuongSapXep = thuTuChuongBan ? [...modules].sort((a, b) => (thuTuChuongBan.get(a.id) ?? 0) - (thuTuChuongBan.get(b.id) ?? 0)) : modules;
      for (const [viTriChuong, m] of chuongSapXep.entries()) {
        const mm = await tx.trnModule.create({
          data: { courseId: c.id, title: m.title, orderIndex: thuTuChuongBan ? viTriChuong : m.orderIndex },
          select: { id: true },
        });
        const baiCuaBan = thuTuTrongBan
          ? m.lessons.filter((b) => thuTuTrongBan.has(b.id)).sort((x, y) => thuTuTrongBan.get(x.id)! - thuTuTrongBan.get(y.id)!)
          : m.lessons;
        for (const [viTri, b] of baiCuaBan.entries()) {
          await tx.trnLesson.create({
            data: {
              moduleId: mm.id,
              title: b.title,
              kind: b.kind,
              orderIndex: viTri,
              contentMd: b.contentMd,
              minReadSeconds: b.minReadSeconds,
              examId: b.examId,
              rubricId: b.rubricId,
              captionKey: b.captionKey,
              videoKey: b.videoKey,
              youtubeId: b.youtubeId,
              youtubePhuDe: b.youtubePhuDe,
              durationSec: b.durationSec,
              sessionDate: b.sessionDate,
            },
          });
        }
      }

      return c;
    });

    return {
      entityId: moi.id,
      data: { courseId: moi.id, code: moi.code },
      newValues: { code: moi.code, nhanBanTu: goc.code },
    };
  },
};

/** Dùng cho màn soạn: trả dàn bài + danh sách lỗi để hiện ngay, không đợi bấm. */
export async function docDanBaiChoMan(db: ScopedDb, courseId: string) {
  const chuong = await docDanBai(db, courseId);
  const c = await layKhoa(db, courseId);
  const cauTruc = kiemDanBai(chuong);
  const caption = kiemPhuDe({ chuong, natureTag: c.program?.natureTag ?? null });
  // Màn soạn phải thấy ĐỦ lỗi, kể cả lỗi phụ đề — biết trước thì sửa một lượt.
  return {
    chuong,
    kiem: { ok: cauTruc.ok && caption.ok, loi: [...cauTruc.loi, ...caption.loi] },
  };
}

export { laThayDoiMajor };
