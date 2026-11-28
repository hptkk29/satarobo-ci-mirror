import { db } from "@/lib/db";
import { assignmentWindow, assignmentWindowLabel, realDueAt, type AssignmentWindowState } from "@/lib/lms/assignment-window";
import { getStudentLessons } from "@/lib/portal/learning";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { getSetting } from "@/lib/settings/service";

import { layKhoTepRieng } from "../kho-tep-rieng";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * LMS LỚP cho app (B-LMS1 — đọc): bài tập · bài thi · bài học · kết quả của MỘT học viên. Hợp đồng DTO: `API-HANDOFF.md` §7; bản máy đọc phía app: `src/features/lms/kieu.ts`.
 *
 * LUẬT (đã kiểm bằng test):
 *  · Cờ `PORTAL_BAI_TAP_BAI_THI_ENABLED` (qua `mucBaiTapBaiThiDangHien()`) TẮT ⇒ 404 phong bì TRƯỚC mọi truy vấn.
 *  · Quyền theo GHI DANH thật: lớp của học viên = ghi danh `GHI_DANH_DANG_HOC`, chưa xoá mềm. Bài/đề của lớp khác, của học viên khác ⇒ 404 (không phân biệt «không có» với «của người khác»).
 *  · Chỉ bài `PUBLISHED`/`CLOSED` (nháp tự sinh từ template KHÔNG lộ); đề chỉ `PUBLISHED`.
 *  · KHÔNG bao giờ trả: đáp án (`isCorrect`, `correctAnswer`, `meta`), câu hỏi, giáo án nội bộ, bài nộp/lượt làm của học viên khác, nhận xét chưa chấm.
 *  · Điểm: phụ huynh chỉ thấy khi setting `homework.showScoreToParent` bật; phiên CHẾ ĐỘ HỌC SINH (học sinh tự xem điểm của mình) luôn thấy. Điểm do MÁY CHỦ; app không gửi điểm.
 *  · URL tệp: ký ngắn hạn, FAIL-CLOSED — không ký được ⇒ bỏ tệp khỏi danh sách (KHÔNG trả URL công khai vĩnh viễn như đường web khi cờ ký tắt).
 */

export type NguCanhHocTap = { laHocSinh: boolean; now?: Date };

export function batNeuTat(): void {
  if (!mucBaiTapBaiThiDangHien()) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
}
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export async function lopCuaHocVien(hs: MaHocVienDaKiem): Promise<string[]> {
  const ds = await db.enrollment.findMany({ where: { studentId: hs, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null }, select: { classId: true } });
  return [...new Set(ds.map((e) => e.classId))];
}

export async function duocXemDiem(laHocSinh: boolean): Promise<boolean> {
  if (laHocSinh) return true;
  return (await getSetting("homework.showScoreToParent")) === true;
}

// ── URL tệp (fail-closed) ───────────────────────────────────────────────────

export type KyUrl = (fileUrl: string) => Promise<string | null>;

/** Ký URL GET ngắn hạn (15 phút). Tách khoá từ URL công khai của R2; không tách/ký được ⇒ `null` (tệp bị bỏ). KHÔNG bao giờ rơi về URL công khai. */
/**
 * ẢNH ĐỀ THI NẰM TRONG KHO RIÊNG (V8.4, B-UPLOAD-R2): tham chiếu `private:exam-img/<tên>` ⇒ ký qua CÙNG bộ điều hợp kho riêng của tải lên (R2 private ở môi trường thật; thư mục local khi thử).
 * Chỉ nhận tiền tố `exam-img/` (không cho đề trỏ vào kho tệp nộp bài của học viên), khoá không có `..`/ký tự lạ; không có kho ⇒ null (fail-closed — không bao giờ URL công khai).
 * Mỗi lần dựng/khôi phục lượt thi ký LẠI (TTL 900 giây) — URL hết hạn thì app gọi lại `GET …/attempts/:id` để lấy URL mới.
 */
export const TIEN_TO_ANH_DE_RIENG = "private:exam-img/";
export function khoaAnhDeRieng(fileUrl: string): string | null {
  if (!fileUrl.startsWith(TIEN_TO_ANH_DE_RIENG)) return null;
  const key = fileUrl.slice("private:".length);
  return /^exam-img\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(key) && !key.includes("..") ? key : null;
}
export const kyUrlTepMacDinh: KyUrl = async (fileUrl) => {
  if (fileUrl.startsWith("private:")) {
    const key = khoaAnhDeRieng(fileUrl);
    if (!key) return null;
    try {
      const { layKhoTepRieng } = await import("../kho-tep-rieng");
      const kho = layKhoTepRieng();
      return kho ? await kho.kyGet(key, 900) : null;
    } catch {
      return null;
    }
  }
  try {
    const { keyFromPublicUrl, signedMediaUrl } = await import("@/lib/storage/signed-url");
    const key = keyFromPublicUrl(fileUrl);
    if (!key) return null;
    return await signedMediaUrl(key, 900);
  } catch {
    return null;
  }
};

async function kyDanhSach<T extends { fileUrl: string }>(ds: readonly T[], ky: KyUrl): Promise<Array<Omit<T, "fileUrl"> & { url: string }>> {
  const kq: Array<Omit<T, "fileUrl"> & { url: string }> = [];
  for (const d of ds) {
    const url = await ky(d.fileUrl);
    if (url) {
      const { fileUrl: _bo, ...con } = d;
      void _bo;
      kq.push({ ...con, url });
    }
  }
  return kq;
}

// ── Bài tập ─────────────────────────────────────────────────────────────────

type TrangThaiNop = "CHUA_NOP" | "DA_NOP" | "NOP_TRE" | "DA_CHAM";
const NOP: Record<string, TrangThaiNop> = { NOT_SUBMITTED: "CHUA_NOP", SUBMITTED: "DA_NOP", LATE: "NOP_TRE", GRADED: "DA_CHAM" };
const CUA: Record<AssignmentWindowState, "nhap" | "mo" | "nop_tre" | "dong" | "luu_tru"> = { draft: "nhap", open: "mo", "late-open": "nop_tre", closed: "dong", archived: "luu_tru" };

export type BaiTapTomTatDto = {
  id: string;
  tieuDe: string;
  loai: "TREN_LOP" | "VE_NHA";
  tenLop: string | null;
  buoi: number | null;
  han: string | null;
  cuaNop: { trangThai: "nhap" | "mo" | "nop_tre" | "dong" | "luu_tru"; nhan: string; nhanDuocNop: boolean; han: string | null };
  trangThaiNop: TrangThaiNop;
  tongDiem: number;
  diem: number | null;
  lyDoAnDiem: "CHUA_CHAM" | "THEO_CAU_HINH" | null;
};

type HangBaiTap = {
  id: string;
  title: string;
  kind: "CLASSWORK" | "HOMEWORK";
  status: "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
  dueAt: Date | null;
  lateUntil: Date | null;
  totalPoints: number;
  class: { name: string };
  submissions: Array<{ status: string; score: number | null }>;
};

function tomTatBaiTap(a: HangBaiTap, hienDiem: boolean, now: Date): BaiTapTomTatDto {
  const w = assignmentWindow({ status: a.status, dueAt: a.dueAt, lateUntil: a.lateUntil }, now);
  const sub = a.submissions[0];
  const trangThaiNop = NOP[sub?.status ?? "NOT_SUBMITTED"] ?? "CHUA_NOP";
  const daCham = trangThaiNop === "DA_CHAM" && sub?.score != null;
  return {
    id: a.id,
    tieuDe: a.title,
    loai: a.kind === "HOMEWORK" ? "VE_NHA" : "TREN_LOP",
    tenLop: a.class.name,
    buoi: null, // ClassSession không có số thứ tự; lộ trình buổi chưa là nguồn máy chủ ổn định (B-LMS1: nợ ghi ở API-HANDOFF §7)
    han: realDueAt(a.dueAt)?.toISOString() ?? null,
    cuaNop: { trangThai: CUA[w.state], nhan: assignmentWindowLabel(w), nhanDuocNop: w.acceptsSubmission, han: w.until?.toISOString() ?? null },
    trangThaiNop,
    tongDiem: a.totalPoints,
    diem: daCham && hienDiem ? sub!.score : null,
    lyDoAnDiem: !daCham ? "CHUA_CHAM" : hienDiem ? null : "THEO_CAU_HINH",
  };
}

const CHON_TOM_TAT = {
  id: true,
  title: true,
  kind: true,
  status: true,
  dueAt: true,
  lateUntil: true,
  totalPoints: true,
  class: { select: { name: true } },
} as const;

export async function layDanhSachBaiTap(hs: MaHocVienDaKiem, ctx: NguCanhHocTap): Promise<{ muc: BaiTapTomTatDto[] }> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) return { muc: [] };
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const ds = await db.assignment.findMany({
    where: { classId: { in: lop }, status: { in: ["PUBLISHED", "CLOSED"] } },
    select: { ...CHON_TOM_TAT, submissions: { where: { studentId: hs }, select: { status: true, score: true }, take: 1 } },
    orderBy: [{ assignedAt: "desc" }, { id: "asc" }],
    take: 500,
  });
  const now = ctx.now ?? new Date();
  return { muc: ds.map((a) => tomTatBaiTap(a as HangBaiTap, hienDiem, now)) };
}

export type TepDto = { id: string; tenTep: string; loaiMime: string | null; /** V8.20: cỡ tệp (byte) khi biết — tệp học viên nộp có; tệp đính kèm của giáo viên/tệp cũ ⇒ null. */ kichThuoc: number | null; url: string };
export type ChiTietBaiTapDto = BaiTapTomTatDto & {
  moTa: string;
  huongDan: string | null;
  choPhepVanBan: boolean;
  choPhepTep: boolean;
  yeuCauVideo: boolean;
  taiLieu: Array<{ id: string; tieuDe: string; url: string }>;
  tepDinhKem: TepDto[];
  baiNop: { vanBan: string | null; tep: TepDto[]; nopLuc: string | null; nhanXet: string | null } | null;
};

export async function layChiTietBaiTap(hs: MaHocVienDaKiem, assignmentId: string, ctx: NguCanhHocTap, ky: KyUrl = kyUrlTepMacDinh): Promise<ChiTietBaiTapDto> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) throw khongThay();
  const a = await db.assignment.findFirst({
    where: { id: assignmentId, classId: { in: lop }, status: { in: ["PUBLISHED", "CLOSED"] } },
    select: {
      ...CHON_TOM_TAT,
      description: true,
      instructions: true,
      allowText: true,
      allowFile: true,
      requireVideo: true,
      documents: { select: { document: { select: { id: true, title: true, fileUrl: true } } }, orderBy: { createdAt: "asc" } },
      attachments: { select: { id: true, fileName: true, mimeType: true, fileUrl: true }, orderBy: { createdAt: "asc" } },
      submissions: {
        where: { studentId: hs },
        select: {
          status: true,
          score: true,
          textAnswer: true,
          submittedAt: true,
          feedback: true,
          fileUrl: true,
          fileName: true,
          mimeType: true,
          files: { select: { id: true, fileName: true, mimeType: true, fileUrl: true, storageKey: true, fileSize: true }, orderBy: { createdAt: "asc" } },
        },
        take: 1,
      },
    },
  });
  if (!a) throw khongThay(); // bài của lớp khác / nháp / không có ⇒ cùng một 404
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const now = ctx.now ?? new Date();
  const sub = a.submissions[0];
  // Tệp trong KHO RIÊNG (`storageKey`, nộp từ ứng dụng) ký qua kho riêng; tệp cũ (URL công khai của web) ký như trước. Không ký được ⇒ BỎ tệp (fail-closed).
  const tep = async (ds: Array<{ id: string; fileName: string; mimeType: string | null; fileUrl: string; storageKey?: string | null; fileSize?: number | null }>): Promise<TepDto[]> => {
    const kq: TepDto[] = [];
    for (const d of ds) {
      const url = d.storageKey ? ((await layKhoTepRieng()?.kyGet(d.storageKey, 900, d.fileName)) ?? null) : await ky(d.fileUrl);
      if (url) kq.push({ id: d.id, tenTep: d.fileName, loaiMime: d.mimeType, kichThuoc: d.fileSize ?? null, url });
    }
    return kq;
  };
  const tepNop = sub ? (sub.files.length > 0 ? sub.files : sub.fileUrl ? [{ id: `${assignmentId}:dau`, fileName: sub.fileName ?? "tep", mimeType: sub.mimeType, fileUrl: sub.fileUrl }] : []) : [];
  const taiLieu = (await kyDanhSach(a.documents.map((d) => ({ id: d.document.id, tieuDe: d.document.title, fileUrl: d.document.fileUrl })), ky)) as Array<{ id: string; tieuDe: string; url: string }>;
  return {
    ...tomTatBaiTap(a as unknown as HangBaiTap, hienDiem, now),
    moTa: a.description,
    huongDan: a.instructions,
    choPhepVanBan: a.allowText,
    choPhepTep: a.allowFile,
    yeuCauVideo: a.requireVideo,
    taiLieu,
    tepDinhKem: await tep(a.attachments),
    baiNop: sub
      ? {
          vanBan: sub.textAnswer,
          tep: await tep(tepNop),
          nopLuc: sub.submittedAt?.toISOString() ?? null,
          // Nhận xét chỉ khi ĐÃ CHẤM (không lộ nhận xét nháp).
          nhanXet: sub.status === "GRADED" ? sub.feedback : null,
        }
      : null,
  };
}

// ── Bài thi (đọc: danh sách + chi tiết trước khi bắt đầu) ───────────────────

type TrangThaiLuot = "DANG_LAM" | "CHO_CHAM" | "DA_CHAM";
const LUOT: Record<string, TrangThaiLuot> = { IN_PROGRESS: "DANG_LAM", SUBMITTED: "CHO_CHAM", GRADED: "DA_CHAM", REVIEWED: "DA_CHAM" };

export type BaiThiTomTatDto = {
  id: string;
  tieuDe: string;
  tenLop: string | null;
  thoiLuongPhut: number;
  moLuc: string | null;
  dongLuc: string | null;
  dangMo: boolean;
  soLuotToiDa: number;
  soLuotDaDung: number;
  lanGanNhat: { luotId: string; trangThai: TrangThaiLuot; diem: number | null; tongDiem: number } | null;
};
export type ChiTietBaiThiDto = BaiThiTomTatDto & { moTa: string | null; tongDiem: number; diemDat: number; soCau: number; conLuot: number; choPhepBatDau: boolean };

/** Điều kiện xem đề: đề của lớp học viên đang học, HOẶC đề dùng chung đã giao cho CHÍNH học viên (HomeworkAssignment). Cùng luật `studentCanAccessExam` / `getStudentExams`. */
export async function dieuKienDe(hs: MaHocVienDaKiem, lop: string[]) {
  const chung = (await db.homeworkAssignment.findMany({ where: { studentId: hs }, select: { examId: true }, distinct: ["examId"] })).map((h) => h.examId);
  return { status: "PUBLISHED" as const, OR: [{ classId: { in: lop } }, ...(chung.length ? [{ classId: null, id: { in: chung } }] : [])] };
}

function tomTatBaiThi(
  e: { id: string; title: string; durationMinutes: number; openAt: Date | null; closeAt: Date | null; maxAttempts: number | null; showResultAfterSubmit: boolean; totalPoints: number; class: { name: string } | null; attempts: Array<{ id: string; status: string; totalScore: number | null }> },
  hienDiem: boolean,
  now: Date,
): BaiThiTomTatDto {
  const t = now.getTime();
  const dangMo = (!e.openAt || e.openAt.getTime() <= t) && (!e.closeAt || e.closeAt.getTime() >= t);
  const gan = e.attempts[0];
  const trangThai = gan ? (LUOT[gan.status] ?? "DANG_LAM") : null;
  return {
    id: e.id,
    tieuDe: e.title,
    tenLop: e.class?.name ?? null,
    thoiLuongPhut: Math.min(600, Math.max(1, e.durationMinutes)),
    moLuc: e.openAt?.toISOString() ?? null,
    dongLuc: e.closeAt?.toISOString() ?? null,
    dangMo,
    soLuotToiDa: Math.min(20, Math.max(1, e.maxAttempts ?? 1)),
    soLuotDaDung: e.attempts.length,
    lanGanNhat: gan && trangThai ? { luotId: gan.id, trangThai, diem: trangThai === "DA_CHAM" && hienDiem && e.showResultAfterSubmit ? gan.totalScore : null, tongDiem: e.totalPoints } : null,
  };
}

const CHON_DE = {
  id: true,
  title: true,
  description: true,
  durationMinutes: true,
  openAt: true,
  closeAt: true,
  maxAttempts: true,
  showResultAfterSubmit: true,
  totalPoints: true,
  passingScore: true,
  class: { select: { name: true } },
  _count: { select: { examQuestions: true } },
} as const;

export async function layDanhSachBaiThi(hs: MaHocVienDaKiem, ctx: NguCanhHocTap): Promise<{ muc: BaiThiTomTatDto[] }> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) return { muc: [] };
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const ds = await db.exam.findMany({
    where: await dieuKienDe(hs, lop),
    select: { ...CHON_DE, attempts: { where: { studentId: hs }, select: { id: true, status: true, totalScore: true }, orderBy: { attemptNo: "desc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 500,
  });
  const now = ctx.now ?? new Date();
  return { muc: ds.map((e) => tomTatBaiThi(e, hienDiem, now)) };
}

export async function layChiTietBaiThi(hs: MaHocVienDaKiem, examId: string, ctx: NguCanhHocTap): Promise<ChiTietBaiThiDto> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) throw khongThay();
  const dk = await dieuKienDe(hs, lop);
  const e = await db.exam.findFirst({
    where: { id: examId, status: dk.status, OR: dk.OR },
    select: { ...CHON_DE, attempts: { where: { studentId: hs }, select: { id: true, status: true, totalScore: true }, orderBy: { attemptNo: "desc" } } },
  });
  if (!e) throw khongThay();
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const t = tomTatBaiThi(e, hienDiem, ctx.now ?? new Date());
  const conLuot = Math.max(0, t.soLuotToiDa - t.soLuotDaDung);
  const dangLamDo = e.attempts.some((a) => a.status === "IN_PROGRESS");
  return {
    ...t,
    moTa: e.description,
    tongDiem: e.totalPoints,
    diemDat: e.passingScore,
    soCau: e._count.examQuestions, // CHỈ số lượng — không bao giờ trả câu hỏi/đáp án ở đây
    conLuot,
    choPhepBatDau: t.dangMo && (conLuot > 0 || dangLamDo),
  };
}

// ── Bài học ─────────────────────────────────────────────────────────────────

export type BaiHocDto = { id: string; tieuDe: string; moTa: string | null; noiDung: string | null; mucTieu: string[]; daDayLuc: string | null; taiLieu: Array<{ id: string; tieuDe: string; loai: string | null; url: string }> };

/** Nguồn `getStudentLessons` (luật 02/08/2026: chỉ bài ĐÃ DẠY + tài liệu giáo viên ĐÃ GIAO cho chính lớp). Chỉ khác: URL ký ngắn hạn, fail-closed. */
export async function layDanhSachBaiHoc(hs: MaHocVienDaKiem, ky: KyUrl = kyUrlTepMacDinh): Promise<{ muc: BaiHocDto[] }> {
  batNeuTat();
  const ds = await getStudentLessons(hs);
  const muc: BaiHocDto[] = [];
  for (const l of ds.slice(0, 500)) {
    const taiLieu = (await kyDanhSach(l.documents.map((d) => ({ id: d.id, tieuDe: d.title, loai: d.type, fileUrl: d.fileUrl })), ky)) as BaiHocDto["taiLieu"];
    muc.push({ id: l.id, tieuDe: l.title, moTa: l.description, noiDung: l.content, mucTieu: l.objectives, daDayLuc: l.taughtAt, taiLieu });
  }
  return { muc };
}

export async function layChiTietBaiHoc(hs: MaHocVienDaKiem, lessonId: string, ky: KyUrl = kyUrlTepMacDinh): Promise<BaiHocDto> {
  const { muc } = await layDanhSachBaiHoc(hs, ky);
  const b = muc.find((x) => x.id === lessonId);
  if (!b) throw khongThay();
  return b;
}

// ── Kết quả ─────────────────────────────────────────────────────────────────

export type KetQuaLuotTomTatDto = { luotId: string; tieuDe: string; trangThai: TrangThaiLuot; diem: number | null; tongDiem: number; dat: boolean | null; nhanXet: string | null; nopLuc: string | null };
export type LichSuKetQuaDto = {
  bai_thi: KetQuaLuotTomTatDto[];
  bai_tap: Array<{ baiTapId: string; tieuDe: string; trangThaiNop: TrangThaiNop; diem: number | null; tongDiem: number; nhanXet: string | null }>;
};

/** `GET results`: lượt thi ĐÃ NỘP + bài tập ĐÃ NỘP của chính học viên. Điểm/nhận xét/đạt chỉ khi ĐÃ CHẤM; `showResultAfterSubmit=false` ⇒ ẩn điểm + nhận xét của lượt đó. */
export async function layKetQua(hs: MaHocVienDaKiem, ctx: NguCanhHocTap): Promise<LichSuKetQuaDto> {
  batNeuTat();
  const lop = await lopCuaHocVien(hs);
  if (lop.length === 0) return { bai_thi: [], bai_tap: [] };
  const hienDiem = await duocXemDiem(ctx.laHocSinh);
  const [luot, nop] = await Promise.all([
    db.examAttempt.findMany({
      where: { studentId: hs, status: { in: ["SUBMITTED", "GRADED", "REVIEWED"] }, exam: { OR: (await dieuKienDe(hs, lop)).OR } },
      select: { id: true, status: true, totalScore: true, passed: true, feedback: true, submittedAt: true, exam: { select: { title: true, totalPoints: true, showResultAfterSubmit: true } } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: 500,
    }),
    db.assignmentSubmission.findMany({
      where: { studentId: hs, status: { not: "NOT_SUBMITTED" }, assignment: { classId: { in: lop }, status: { in: ["PUBLISHED", "CLOSED"] } } },
      select: { status: true, score: true, feedback: true, assignment: { select: { id: true, title: true, totalPoints: true } } },
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      take: 500,
    }),
  ]);
  return {
    bai_thi: luot.map((l) => {
      const trangThai = LUOT[l.status] ?? "CHO_CHAM";
      const lo = trangThai === "DA_CHAM" && l.exam.showResultAfterSubmit;
      return {
        luotId: l.id,
        tieuDe: l.exam.title,
        trangThai,
        diem: lo && hienDiem ? l.totalScore : null,
        tongDiem: l.exam.totalPoints,
        dat: lo && hienDiem ? l.passed : null,
        nhanXet: lo ? l.feedback : null,
        nopLuc: l.submittedAt?.toISOString() ?? null,
      };
    }),
    bai_tap: nop.map((s) => {
      const trangThaiNop = NOP[s.status] ?? "DA_NOP";
      const cham = trangThaiNop === "DA_CHAM";
      return { baiTapId: s.assignment.id, tieuDe: s.assignment.title, trangThaiNop, diem: cham && hienDiem ? s.score : null, tongDiem: s.assignment.totalPoints, nhanXet: cham ? s.feedback : null };
    }),
  };
}
