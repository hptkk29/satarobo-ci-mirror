import type { ScopedDb } from "@/lib/actions/factory";
import { baiTheoLuot, banCuaLuot, docCayTheoBan } from "@/lib/elearning/ban-cua-luot";
import { napBaiXongTheoLuot, tienDoCuaLuot } from "@/lib/elearning/tien-do-bat-buoc";
import type { KhoaDong } from "@/lib/elearning/khoa-cua-toi-tab";
import { moTaThoiLuongBai } from "@/lib/elearning/de-cuong-pure";
import {
  coManChoNguoiHoc,
  NHAN_LOAI_BAI,
  vaySaoChuaMo,
  VI_SAO_KHONG_CO_MAN,
} from "@/lib/elearning/lesson-kind";

/**
 * EL-04 — ĐỀ CƯƠNG MỘT KHOÁ cho người học.
 *
 * ⚠️ Màn này là ĐÍCH của ba đường dẫn đã tồn tại từ lâu và đang trả 404:
 * `notify.ts` "được giao khoá", `notify.ts` "quá hạn", và chuông việc-chưa-xong
 * (`pending-tasks.ts`). Cả ba trỏ `/elearning/hoc/{enrollmentId}` — một route chưa
 * bao giờ có tệp.
 *
 * Hệ quả suốt thời gian đó: người học nhận thông báo được giao bài, bấm vào, gặp
 * trang lỗi. Không có đường nào khác để vào bài trừ gõ tay URL hai đoạn — mà họ
 * không biết `lessonId`.
 */

export type BaiTrongDeCuong = {
  lessonId: string;
  title: string;
  kind: string;
  nhanLoai: string;
  batBuoc: boolean;
  /** `true` = loại bài này đã có đường đi thật. */
  moDuoc: boolean;
  /** Câu giải thích khi không dựng link — `null` khi mở được. */
  viSaoKhongMo: string | null;
  trangThai: "CHUA_HOC" | "DANG_HOC" | "XONG";
  /** "Video · 12 phút" / "Bài kiểm tra · 13 câu" — `null` khi không có số đo thật để nói. */
  moTaThoiLuong: string | null;
};

export type ChuongTrongDeCuong = {
  moduleId: string;
  title: string;
  lessons: BaiTrongDeCuong[];
};

export type DeCuongKhoa = {
  enrollmentId: string;
  tenKhoa: string;
  status: string;
  dueAt: Date | null;
  progressPercent: number;
  /** Số ngày làm việc được miễn trừ vì người chấm trễ — hiện để người học yên tâm. */
  slaGraceDays: number;
  /**
   * Chứng nhận của lượt này — `null` khi chưa cấp.
   *
   * ⚠️ Có mặt ở ĐÂY là cố ý. Chứng nhận được cấp tự động qua hàng đợi sự kiện, nên
   * nếu màn hình không hiện nó thì người học không có cách nào biết mình đã có, và
   * đường tải PDF vừa dựng xong thành một cổng không cửa — đúng cái lỗi đã lặp lại
   * tám lần trong module này.
   */
  chungNhan: { id: string; certCode: string; validUntil: Date | null } | null;
  soBaiXong: number;
  soBaiBatBuoc: number;
  chuong: ChuongTrongDeCuong[];
  /** Hạn ban đầu (bất biến) — so với `dueAt` để biết hạn đã được gia hạn. */
  dueAtOriginal: Date | null;
  extensionReason: string | null;
  completedAt: Date | null;
  /** Tên người giao (từ lượt giao) — `null` khi lượt không sinh từ lượt giao hoặc người giao đã bị xoá. */
  nguoiGiao: string | null;
  tenChuongTrinh: string | null;
};

export async function napDeCuongKhoa(
  db: ScopedDb,
  input: { enrollmentId: string; userId: string },
): Promise<DeCuongKhoa | null> {
  const gd = await db.trnEnrollment.findFirst({
    where: { id: input.enrollmentId },
    select: {
      id: true,
      userId: true,
      courseId: true,
      status: true,
      dueAt: true,
      progressPercent: true,
      slaGraceDays: true,
      assignmentId: true,
      courseVersionId: true,
      dueAtOriginal: true,
      extensionReason: true,
      completedAt: true,
    },
  });
  if (!gd) return null;
  // ⚠️ CHÍNH CHỦ. Đề cương khoá cho biết người này đang học gì và còn nợ bài nào —
  // đó là hồ sơ học tập của một người, không phải nội dung công khai.
  if (gd.userId !== input.userId) return null;

  const khoa = await db.trnCourse.findFirst({
    where: { id: gd.courseId, deletedAt: null },
    select: { id: true, title: true, programId: true },
  });
  if (!khoa) return null;

  // B-11 — người học đọc ĐÚNG phiên bản đã ghim cho lượt này (không phải cây bài sống, nơi bản nháp đang được sửa). Bản chưa chụp đủ (lượt/khoá
  // cũ) ⇒ vẫn đọc cây sống như trước.
  const ban = await banCuaLuot(db, { courseId: khoa.id, courseVersionId: gd.courseVersionId });
  const [modules, tienDo, banChot, luotGiao, chuongTrinh] = await Promise.all([
    ban.daKhoa && ban.versionId
      ? docCayTheoBan(db, ban.versionId).then((r) => r.cay)
      : db.trnModule.findMany({
          where: { courseId: khoa.id },
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            title: true,
            lessons: {
              where: { deletedAt: null },
              orderBy: { orderIndex: "asc" },
              select: { id: true, title: true, kind: true, durationSec: true, minReadSeconds: true, examId: true },
            },
          },
        }),
    db.trnLessonProgress.findMany({
      where: { enrollmentId: gd.id },
      select: { lessonId: true, status: true },
    }),
    // Cờ "bài bắt buộc" nằm trên BẢN CHỐT PHIÊN BẢN, không trên chính bài — mỗi
    // phiên bản ghim tập bài của nó (BR-013).
    ban.versionId
      ? db.trnCourseVersion.findFirst({
          where: { id: ban.versionId, courseId: khoa.id },
          select: { lessons: { select: { lessonId: true, required: true } } },
        })
      : Promise.resolve(null),
    gd.assignmentId
      ? db.trnAssignment.findFirst({ where: { id: gd.assignmentId }, select: { createdByUserId: true } })
      : Promise.resolve(null),
    khoa.programId
      ? db.trnProgram.findFirst({ where: { id: khoa.programId }, select: { title: true } })
      : Promise.resolve(null),
  ]);

  // Số câu của bài kiểm tra + tên người giao: hai truy vấn nhỏ, số lượng cố định (không theo số bài).
  const maDe = [...new Set(modules.flatMap((m) => m.lessons.map((b) => b.examId).filter((x): x is string => !!x)))];
  const [cauCuaDe, nguoiGiaoRow] = await Promise.all([
    maDe.length > 0
      ? db.trnExamQuestion.findMany({ where: { examId: { in: maDe } }, select: { examId: true } })
      : Promise.resolve([]),
    luotGiao?.createdByUserId
      ? db.user.findFirst({ where: { id: luotGiao.createdByUserId }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  const soCauCua = new Map<string, number>();
  for (const c of cauCuaDe) soCauCua.set(c.examId, (soCauCua.get(c.examId) ?? 0) + 1);

  const tienDoCua = new Map(tienDo.map((t) => [t.lessonId, t.status]));
  const batBuocCua = new Map(
    (banChot?.lessons ?? []).map((l) => [l.lessonId, l.required]),
  );

  let soBaiXong = 0;
  let soBaiBatBuoc = 0;

  const chuong: ChuongTrongDeCuong[] = modules.map((m) => ({
    moduleId: m.id,
    title: m.title,
    lessons: m.lessons.map((b) => {
      // Bài chưa có dòng phiên bản ⇒ coi là BẮT BUỘC. Mặc định phía chặt: đoán
      // "tuỳ chọn" sẽ âm thầm bỏ bài đó khỏi điều kiện hoàn thành.
      const batBuoc = batBuocCua.get(b.id) ?? true;
      const tt = tienDoCua.get(b.id);
      const trangThai =
        tt === "DONE" ? "XONG" : tt ? "DANG_HOC" : "CHUA_HOC";
      if (batBuoc) {
        soBaiBatBuoc += 1;
        if (trangThai === "XONG") soBaiXong += 1;
      }
      return {
        lessonId: b.id,
        title: b.title,
        kind: b.kind,
        nhanLoai: NHAN_LOAI_BAI[b.kind] ?? b.kind,
        batBuoc,
        // Dựng link theo "NGƯỜI HỌC có gì để mở", KHÔNG theo "module hỗ trợ loại
        // này". Hai thứ khác nhau ở `LIVE_SESSION`: module xử lý đủ, nhưng phần xử
        // lý nằm ở phía giảng viên điểm danh — người học bấm vào chỉ nhận một câu
        // từ chối, đúng cái vòng vô ích dòng này sinh ra để tránh.
        moDuoc: coManChoNguoiHoc(b.kind),
        viSaoKhongMo: coManChoNguoiHoc(b.kind)
          ? null
          : (VI_SAO_KHONG_CO_MAN[b.kind] ?? vaySaoChuaMo(b.kind)),
        trangThai,
        moTaThoiLuong: moTaThoiLuongBai(b.kind, {
          durationSec: b.durationSec,
          minReadSeconds: b.minReadSeconds,
          soCau: b.examId ? (soCauCua.get(b.examId) ?? null) : null,
        }),
      };
    }),
  }));

  const chungNhan = await db.trnCertificate.findFirst({
    where: { enrollmentId: gd.id },
    select: { id: true, certCode: true, validUntil: true },
  });

  return {
    chungNhan,
    enrollmentId: gd.id,
    tenKhoa: khoa.title,
    status: gd.status,
    dueAt: gd.dueAt,
    progressPercent: gd.progressPercent,
    slaGraceDays: gd.slaGraceDays,
    soBaiXong,
    soBaiBatBuoc,
    chuong,
    dueAtOriginal: gd.dueAtOriginal ?? null,
    extensionReason: gd.extensionReason ?? null,
    completedAt: gd.completedAt ?? null,
    nguoiGiao: nguoiGiaoRow?.name ?? null,
    tenChuongTrinh: chuongTrinh?.title ?? null,
  };
}

export type KhoaCuaToi = {
  enrollmentId: string;
  courseId: string;
  /** B-11 — phiên bản khoá mà lượt này ghim (`null` = chưa ghim ⇒ bản đang phát hành). */
  courseVersionId: string | null;
  tenKhoa: string;
  status: string;
  dueAt: Date | null;
  progressPercent: number;
  /** Ngày được giao / ngày xong — thêm cho trang "Khoá của tôi" (không đổi số truy vấn). */
  createdAt: Date | null;
  completedAt: Date | null;
};

/**
 * DANH SÁCH KHOÁ của một người — nội dung của trang chủ khu.
 *
 * ⚠️ Trang chủ khu trước đây là khung tạm 16 dòng, KHÔNG một link nào. Mục menu
 * "Học tập nội bộ" trên thanh trên cùng dẫn thẳng vào đó, nên mọi màn hình đã dựng
 * — kho câu hỏi, đề thi, khung chấm, hàng đợi chấm, báo cáo — đều không ai tới được
 * trừ khi biết sẵn địa chỉ.
 */
export async function napKhoaCuaToi(
  db: ScopedDb,
  userId: string,
): Promise<KhoaCuaToi[]> {
  const ds = await db.trnEnrollment.findMany({
    where: {
      userId,
      // Lượt đã thu hồi KHÔNG hiện: người ta đã bị rút khỏi khoá, và để nó trong
      // danh sách là mời họ mở một thứ không còn của mình.
      status: { not: "REVOKED" },
    },
    select: {
      id: true,
      courseId: true,
      courseVersionId: true,
      status: true,
      dueAt: true,
      progressPercent: true,
      createdAt: true,
      completedAt: true,
    },
    // Chưa xong lên trước, trong đó hạn gần nhất lên đầu — đây là thứ tự việc phải
    // làm, không phải thứ tự tạo.
    orderBy: [{ dueAt: "asc" }],
    take: 100,
  });
  if (ds.length === 0) return [];

  const khoa = await db.trnCourse.findMany({
    where: { id: { in: [...new Set(ds.map((x) => x.courseId))] } },
    select: { id: true, title: true },
  });
  const tenCua = new Map(khoa.map((c) => [c.id, c.title]));

  const xong = (s: string) => s === "COMPLETED" || s === "COMPLETED_LATE";
  return ds
    .map((x) => ({
      enrollmentId: x.id,
      courseId: x.courseId,
      courseVersionId: x.courseVersionId ?? null,
      tenKhoa: tenCua.get(x.courseId) ?? "(khoá đã xoá)",
      status: x.status,
      dueAt: x.dueAt,
      progressPercent: x.progressPercent,
      createdAt: x.createdAt ?? null,
      completedAt: x.completedAt ?? null,
    }))
    .sort((a, b) => Number(xong(a.status)) - Number(xong(b.status)));
}

/**
 * DANH SÁCH cho trang "Khoá của tôi" (3 tab): `napKhoaCuaToi` + MỘT truy vấn gộp đếm bài/loại bài của MỌI khoá trong danh
 * sách. SỐ TRUY VẤN CỐ ĐỊNH (3) bất kể số khoá — `course-view-list.test.ts` đếm với 1 và 100 khoá.
 *
 * Tách khỏi `napKhoaCuaToi` có chủ đích: Tổng quan (`dashboard-view`) dùng hàm đó và test của nó ghim số truy vấn; truy vấn đếm
 * bài chỉ cần ở trang danh sách.
 */
export async function napDanhSachKhoaCuaToi(db: ScopedDb, userId: string): Promise<KhoaDong[]> {
  const khoa = await napKhoaCuaToi(db, userId);
  if (khoa.length === 0) return [];

  // B-11b — đếm bài theo PHIÊN BẢN mà từng lượt đã ghim (không phải cây bài sống, nơi có bản nháp và bản tách).
  const [theoLuot, xongCuaLuot] = await Promise.all([
    baiTheoLuot(db, khoa),
    napBaiXongTheoLuot(db, userId, khoa.map((k) => k.enrollmentId)),
  ]);
  return khoa.map((k) => {
    const ds = theoLuot.get(k.enrollmentId) ?? [];
    return {
      ...k,
      soBai: ds.length > 0 ? ds.length : null,
      coKiemTra: ds.some((b) => b.kind === "QUIZ"),
      tienDoBai: tienDoCuaLuot(ds, xongCuaLuot.get(k.enrollmentId) ?? new Set()),
    };
  });
}
