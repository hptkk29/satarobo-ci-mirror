import type { ScopedDb } from "@/lib/actions/factory";
import { bamNoiDungBai, batBuocKeThua, soSanhBanTheoDongDoi, type BaiTrongBan, type KetQuaSoSanh } from "@/lib/elearning/ban-noi-dung";
import { banDaKhoa } from "@/lib/elearning/ban-cua-luot";
import { kiemBanXuatBan } from "@/lib/elearning/course-authoring";
import type { TrangThaiBan } from "@/lib/elearning/soan-khoa-tab";

/**
 * DỮ LIỆU cho hai màn Soạn khoá: danh sách có tab, và màn DUYỆT (so bản + kết quả các cổng). Chỉ ĐỌC — không mở bản nháp, không chụp.
 */

export type KhoaTrongDanhSach = {
  id: string;
  code: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  chuongTrinh: string | null;
  soChuong: number;
  /** Số bài (chưa xoá) của cây sống — cột "Chương · bài" của thiết kế. */
  soBai: number;
  banTrangThai: TrangThaiBan[];
  /** Người sở hữu/soạn (tên) — dòng phụ dưới tên khoá; `null` khi chưa gán hoặc người đã xoá. */
  nguoiSoan: string | null;
  /** Số lượt học ĐANG MỞ (chưa xong, chưa thu hồi) — cột "Đang giao"; 0 khi chưa giao ai. */
  dangGiao: number;
  capNhatLuc: Date;
};

/** Trạng thái lượt học còn "đang giao" (chưa xong, chưa thu hồi). */
const LUOT_DANG_GIAO = ["NOT_STARTED", "IN_PROGRESS", "OVERDUE"] as const;

/** BA truy vấn cố định (khoá + phiên bản · lượt học đang mở gộp theo khoá · tên người soạn gộp) — không tăng theo số khoá. */
export async function napDanhSachSoanKhoa(db: ScopedDb): Promise<KhoaTrongDanhSach[]> {
  const khoa = await db.trnCourse.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      updatedAt: true,
      ownerUserId: true,
      createdById: true,
      program: { select: { code: true, title: true } },
      _count: { select: { modules: true } },
      modules: { select: { _count: { select: { lessons: { where: { deletedAt: null } } } } } },
      versions: { select: { status: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });
  if (khoa.length === 0) return [];
  const maKhoa = khoa.map((k) => k.id);
  const maNguoi = [...new Set(khoa.map((k) => k.ownerUserId ?? k.createdById).filter((x): x is string => Boolean(x)))];
  const [dang, nguoi] = await Promise.all([
    db.trnEnrollment.groupBy({ by: ["courseId"], where: { courseId: { in: maKhoa }, status: { in: [...LUOT_DANG_GIAO] } }, _count: { _all: true } }),
    maNguoi.length > 0 ? db.user.findMany({ where: { id: { in: maNguoi } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const demDang = new Map(dang.map((d) => [d.courseId, d._count._all]));
  const tenNguoi = new Map(nguoi.map((u) => [u.id, u.name]));
  return khoa.map((k) => ({
    id: k.id,
    code: k.code,
    title: k.title,
    status: k.status,
    chuongTrinh: k.program?.title ?? k.program?.code ?? null,
    soChuong: k._count.modules,
    soBai: k.modules.reduce((n, m) => n + m._count.lessons, 0),
    banTrangThai: k.versions.map((v) => v.status as TrangThaiBan),
    nguoiSoan: tenNguoi.get(k.ownerUserId ?? k.createdById ?? "") ?? null,
    dangGiao: demDang.get(k.id) ?? 0,
    capNhatLuc: k.updatedAt,
  }));
}

export type BanTrongDuyet = {
  id: string;
  nhan: string;
  status: TrangThaiBan;
  nguoiGui: string | null;
  guiLuc: Date | null;
  duyetLuc: Date | null;
  ghiChu: string | null;
};

export type DuyetKhoa = {
  khoa: { id: string; code: string; title: string; status: string };
  ban: BanTrongDuyet;
  /** Phiên bản đã xuất bản gần nhất (cái mà bản này sẽ thay) — `null` nếu chưa từng xuất bản. */
  banDaPhat: { nhan: string; phatLuc: Date | null } | null;
  kiem: { ok: boolean; loi: { code: string; chiTiet: string }[] };
  /** So SỐNG (nội dung bài hiện tại) với bản đã xuất bản. `null` khi chưa có bản đã xuất bản để so. */
  soSanh: KetQuaSoSanh | null;
  /** Số thay đổi (thêm/bớt/đổi nội dung) kể từ LÚC GỬI DUYỆT — người duyệt cần biết bản đã đổi sau khi họ được báo. `null` = chưa gửi duyệt. */
  doiSauKhiGui: number | null;
  tongBai: number;
  baiBatBuoc: number;
};

/** Màn duyệt của MỘT khoá, theo phiên bản đang làm việc mới nhất. `null` = khoá không tồn tại / không thấy được / không có bản nào đang làm việc. */
export async function napDuyetKhoa(db: ScopedDb, courseId: string): Promise<DuyetKhoa | null> {
  const khoa = await db.trnCourse.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true, code: true, title: true, status: true, program: { select: { natureTag: true } } },
  });
  if (!khoa) return null;

  const CHON = { id: true, major: true, minor: true, status: true, submittedByUserId: true, submittedAt: true, approvedAt: true, changeNote: true, clonedFromVersionId: true } as const;
  const [banChoDuyet, banDaPhat] = await Promise.all([
    // ⚠️ Màn DUYỆT xét bản đang CHỜ DUYỆT/ĐÃ DUYỆT trước; bản nháp (người soạn sửa tiếp trong lúc đó) chỉ là phương án cuối. Chọn "mới nhất"
    // thì một bản nháp phát sinh sẽ che mất bản đang chờ duyệt và màn nói "bản này còn là nháp".
    db.trnCourseVersion.findFirst({
      where: { courseId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
      select: CHON,
    }),
    db.trnCourseVersion.findFirst({
      where: { courseId, status: "PUBLISHED" },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
      select: { id: true, major: true, minor: true, publishedAt: true },
    }),
  ]);
  const ban =
    banChoDuyet ??
    (await db.trnCourseVersion.findFirst({
      where: { courseId, status: "DRAFT" },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
      select: CHON,
    }));
  if (!ban) return null;

  // B-11 — bản TƯỜNG MINH (nháp do cổng ghi sao chép, hoặc bản đã chụp) được xét theo DÒNG của chính nó: bài tách bản nằm CÙNG chương với bài gốc nên cây sống
  // không còn nói được "bản này có bài nào". Bản kiểu cũ vẫn xét theo cây sống.
  const tuongMinh = ban.clonedFromVersionId != null || (await banDaKhoa(db, ban.id));
  const [baiSong, dongBan, dongPhat, nguoiGui, kiem, dongDoi] = await Promise.all([
    db.trnLesson.findMany({
      where: tuongMinh
        ? { deletedAt: null, versionLessons: { some: { versionId: ban.id } } }
        : { module: { courseId }, deletedAt: null },
      select: {
        id: true, orderIndex: true, title: true, kind: true, contentMd: true, minReadSeconds: true, videoKey: true, youtubeId: true,
        youtubePhuDe: true, captionKey: true, durationSec: true, examId: true, rubricId: true, sessionDate: true,
      },
    }),
    db.trnCourseVersionLesson.findMany({ where: { versionId: ban.id }, select: { lessonId: true, orderIndex: true, required: true, contentHash: true } }),
    banDaPhat
      ? db.trnCourseVersionLesson.findMany({ where: { versionId: banDaPhat.id }, select: { lessonId: true, orderIndex: true, required: true, contentHash: true } })
      : Promise.resolve([] as { lessonId: string; orderIndex: number; required: boolean; contentHash: string }[]),
    ban.submittedByUserId
      ? db.user.findFirst({ where: { id: ban.submittedByUserId }, select: { name: true } })
      : Promise.resolve(null),
    kiemBanXuatBan(db, khoa, ban.id),
    db.trnLesson.findMany({ where: { module: { courseId }, forkedFromLessonId: { not: null } }, select: { id: true, forkedFromLessonId: true } }),
  ]);
  // Id gốc của dòng dõi tách bản: đi ngược `forkedFromLessonId` tới bài không phải bản tách.
  const chaCua = new Map(dongDoi.map((l) => [l.id, l.forkedFromLessonId as string]));
  const goc = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 50 && chaCua.has(cur); i += 1) cur = chaCua.get(cur)!;
    return cur;
  };

  // Bài của bản đã xuất bản có thể đã bị xoá mềm ⇒ lấy tên theo id, KỂ CẢ bài đã xoá.
  const idCan = [...new Set(dongPhat.map((d) => d.lessonId).filter((id) => !baiSong.some((b) => b.id === id)))];
  const baiDaXoa = idCan.length > 0 ? await db.trnLesson.findMany({ where: { id: { in: idCan } }, select: { id: true, title: true } }) : [];
  const ten = new Map<string, string>([...baiSong.map((b) => [b.id, b.title] as const), ...baiDaXoa.map((b) => [b.id, b.title] as const)]);

  const hangBan = new Map(dongBan.map((d) => [d.lessonId, d]));
  const batBuocNay = new Map(dongBan.map((d) => [d.lessonId, d.required]));
  const batBuocTruoc = new Map(dongPhat.map((d) => [d.lessonId, d.required]));
  const song: BaiTrongBan[] = tuongMinh
    ? // Bản tường minh: tập bài + thứ tự + cờ bắt buộc LÀ của dòng; vân tay đo lại từ chính bài mà dòng trỏ tới (bài đã khoá thì bất biến, nên ≠ vân tay lưu là dấu hiệu có đường ghi lách cổng).
      baiSong.flatMap((b) => {
        const d = hangBan.get(b.id);
        return d ? [{ lessonId: b.id, title: b.title, orderIndex: d.orderIndex, required: d.required, contentHash: bamNoiDungBai(b) }] : [];
      })
    : baiSong.map((b) => ({
        lessonId: b.id,
        title: b.title,
        orderIndex: b.orderIndex,
        // Cùng luật kế thừa của `chupBan`: dòng của bản này → dòng của bản đã xuất bản → mặc định bắt buộc.
        required: batBuocKeThua(b.id, batBuocNay, batBuocTruoc),
        contentHash: bamNoiDungBai(b),
      }));
  const cuaBanPhat: BaiTrongBan[] = dongPhat.map((d) => ({ lessonId: d.lessonId, title: ten.get(d.lessonId) ?? d.lessonId, orderIndex: d.orderIndex, required: d.required, contentHash: d.contentHash }));

  const luc = ban.status as TrangThaiBan;
  let doiSauKhiGui: number | null = null;
  if (luc === "PENDING_REVIEW" || luc === "APPROVED") {
    const luuLuc: BaiTrongBan[] = dongBan.map((d) => ({ lessonId: d.lessonId, title: ten.get(d.lessonId) ?? d.lessonId, orderIndex: d.orderIndex, required: d.required, contentHash: d.contentHash }));
    const r = soSanhBanTheoDongDoi(luuLuc, song, goc);
    doiSauKhiGui = r.them.length + r.bot.length + r.doiNoiDung.length + r.doiBatBuoc.length;
  }

  return {
    khoa: { id: khoa.id, code: khoa.code, title: khoa.title, status: khoa.status },
    ban: {
      id: ban.id,
      nhan: `v${ban.major}.${ban.minor}`,
      status: luc,
      nguoiGui: nguoiGui?.name ?? null,
      guiLuc: ban.submittedAt,
      duyetLuc: ban.approvedAt,
      ghiChu: ban.changeNote,
    },
    banDaPhat: banDaPhat ? { nhan: `v${banDaPhat.major}.${banDaPhat.minor}`, phatLuc: banDaPhat.publishedAt } : null,
    kiem,
    soSanh: banDaPhat ? soSanhBanTheoDongDoi(cuaBanPhat, song, goc) : null,
    doiSauKhiGui,
    tongBai: song.length,
    baiBatBuoc: song.filter((b) => b.required).length,
  };
}
