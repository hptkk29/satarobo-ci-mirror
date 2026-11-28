import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { trangThaiHieuLuc, type TrangThaiHieuLuc } from "./quyen-hoc";
import { kiemTraTruyCapNoiDungDb, type KetQuaTruyCapDb, type MaTruyCapDb } from "./quyen-hoc-db";
import { baiCoMoDuoc, tinhTienDoKhoa, type KetQuaMoBai, type TienDoBai, type TienDoKhoa } from "./tien-do";
import { docBanChayChoTienDo, docTienDoKhoaTheoQuyen, type Cli } from "./tien-do-khoa-db";
// Giữ API cũ: các nơi khác import từ "./hoc-tap". Phần đọc tiến độ dời sang `tien-do-khoa-db.ts` để `quyen-hoc-db.ts` dùng được mà không tạo vòng hoc-tap ↔ quyen-hoc-db.
export { docBanChayChoTienDo, docTienDoKhoaTheoQuyen };
export type { Cli };

/**
 * E-LEARNING ONLINE — NĂNG LỰC HỌC TẬP cho giao diện học viên/phụ huynh (Workstream B gọi; E-learning KHÔNG dựng route học viên).
 *
 * Bất biến:
 * 1. QUYỀN SỞ HỮU nằm TRONG hàm, không phải lời dặn trong tài liệu: mọi hàm nhận `parentUserId` và từ chối nếu học viên không thuộc phụ huynh đó
 *    (`Student.parentUserId`). Hàm không có tham số này thì không công khai cho phía học viên.
 * 2. MỌI đầu ra nội dung / ghi tiến độ đi qua `kiemTraTruyCapNoiDungDb` — một cổng.
 * 3. Server là nguồn duy nhất của tiến độ: client chỉ báo "đã xem tới % nào"; hoàn thành do server quyết theo ngưỡng cài đặt của BẢN ĐANG CHẠY.
 *    Bài đánh giá (bài tập/kiểm tra/thi) KHÔNG hoàn thành qua đường này — chỉ qua chấm điểm.
 * 4. Quyền THU HỒI ⇒ khoá biến khỏi danh sách; quyền HẾT HẠN ⇒ khoá còn trong danh sách với nhãn hết hạn nhưng KHÔNG mở được bài.
 */

type Db = PrismaClient;

export type MaSoHuu = "SAI_PHU_HUYNH";
export type KetQuaCong = KetQuaTruyCapDb | { ok: false; ma: MaSoHuu };

/** `chiDiem:true` ⇒ bài đã khoá xem lại: người gọi CHỈ được trả điểm + đạt/không của các lượt; không đúng/sai từng câu, không bài làm, đáp án, giải thích hay đề. */
export type KetQuaCongLichSu = { ok: true; chiDiem: boolean } | Extract<KetQuaCong, { ok: false }>;

/**
 * Cổng cho các đường CHỈ ĐỌC lịch sử/kết quả (không nội dung, không ghi): như `kiemTraTruyCapChoPhuHuynh`, nới đúng HAI yếu tố.
 * 1. HẠN — D23 (Owner 25/11/2026): hết hạn ⇒ chấm lại cổng ở thời điểm NGAY TRƯỚC lúc hết hạn, nên mọi cổng còn lại (khoá đã xoá, bài ẩn, thứ tự mở…) vẫn chặn
 *    — người hết hạn không bao giờ xem được NHIỀU HƠN người còn hạn. (`kiemTraTruyCapNoiDungDb` trả `HET_HAN` TRƯỚC các cổng đó, nên đổi thẳng `HET_HAN` thành `ok` là bỏ luôn chúng.)
 * 2. KHÔNG XEM LẠI BÀI ĐÃ QUA — Owner 27/11/2026 (quyết định số 1): vẫn xem được điểm và kết quả lịch sử, ở mức `chiDiem`. `DA_HOAN_THANH_KHONG_XEM_LAI` là cổng CUỐI của
 *    `kiemTraTruyCapNoiDungDb` nên tới được mã này là mọi cổng khác đã qua (cài đặt hỏng đã bị chặn từ trước bằng `CAI_DAT_KHONG_HOP_LE`).
 *    Owner chọn phương án A (27/11/2026): LUÔN cho xem điểm — cờ `choXemDiemBaiKhoaXemLai` không còn được đọc.
 * KHÔNG dùng cho đường nào ghi hoặc trả nội dung bài.
 */
export async function kiemTraXemLichSuChoPhuHuynh(db: Db, input: { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date }): Promise<KetQuaCongLichSu> {
  let r = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!r.ok && r.ma === "HET_HAN") {
    const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { expiresAt: true } });
    if (q?.expiresAt) r = await kiemTraTruyCapChoPhuHuynh(db, { ...input, now: new Date(q.expiresAt.getTime() - 1) });
  }
  if (r.ok) return { ok: true, chiDiem: false };
  return r.ma === "DA_HOAN_THANH_KHONG_XEM_LAI" ? { ok: true, chiDiem: true } : r;
}

/** Học viên có thuộc phụ huynh này không. Trả `false` cho học viên không tồn tại (không phân biệt "không có" với "không phải của bạn"). */
export async function laConCuaPhuHuynh(db: Db, parentUserId: string, studentId: string): Promise<boolean> {
  if (!parentUserId || !studentId) return false;
  const hv = await db.student.findFirst({ where: { id: studentId, parentUserId, deletedAt: null }, select: { id: true } });
  return !!hv;
}

export async function kiemTraTruyCapChoPhuHuynh(db: Db, input: { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; now: Date }): Promise<KetQuaCong> {
  if (!(await laConCuaPhuHuynh(db, input.parentUserId, input.studentId))) return { ok: false, ma: "SAI_PHU_HUYNH" };
  return kiemTraTruyCapNoiDungDb(db, { studentId: input.studentId, courseId: input.courseId, lessonStableId: input.lessonStableId, now: input.now });
}

// ───────── Ghi tiến độ ─────────

export const ghiTienDoSchema = z
  .object({
    parentUserId: z.string().min(1),
    studentId: z.string().min(1),
    courseId: z.string().min(1),
    lessonStableId: z.string().min(1),
    /** VIDEO: % đã xem tới (0..100). READ: bỏ trống. */
    percent: z.number().int().min(0).max(100).optional(),
    /** READ: người học bấm "Đã đọc". */
    daDoc: z.boolean().optional(),
  })
  .strict();
export type GhiTienDoInput = z.infer<typeof ghiTienDoSchema> & { now: Date };

export type KetQuaGhiTienDo =
  | { ok: true; trangThai: "IN_PROGRESS" | "COMPLETED"; percent: number; vuaHoanThanhBai: boolean; tienDo: TienDoKhoa; vuaHoanThanhKhoa: boolean }
  | { ok: false; ma: MaTruyCapDb | MaSoHuu | "LOAI_BAI_KHONG_GHI_TRUC_TIEP" | "THIEU_DU_LIEU" };

export async function ghiTienDoBai(db: Db, input: GhiTienDoInput): Promise<KetQuaGhiTienDo> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return { ok: false, ma: cong.ma };

  const khoa = await db.onlCourse.findUniqueOrThrow({ where: { id: input.courseId }, select: { publishedVersionId: true } });
  const ban = await db.onlCourseVersion.findUniqueOrThrow({
    where: { id: khoa.publishedVersionId! },
    select: { number: true, settingsJson: true },
  });
  const bai = await db.onlLesson.findUniqueOrThrow({ where: { versionId_stableId: { versionId: khoa.publishedVersionId!, stableId: input.lessonStableId } }, select: { kind: true } });
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) return { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };

  if (bai.kind !== "VIDEO" && bai.kind !== "READ") return { ok: false, ma: "LOAI_BAI_KHONG_GHI_TRUC_TIEP" };
  if (bai.kind === "VIDEO" && input.percent === undefined) return { ok: false, ma: "THIEU_DU_LIEU" };
  if (bai.kind === "READ" && !input.daDoc) return { ok: false, ma: "THIEU_DU_LIEU" };

  const quyen = await db.onlEntitlement.findUniqueOrThrow({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  return ghiBai(db, quyen.id, input, bai.kind, cd.caiDat.tinhDaXemPhanTramVideo, ban.number);
}

async function ghiBai(db: Db, entitlementId: string, input: GhiTienDoInput, kind: "VIDEO" | "READ", nguongVideo: number, soBan: number): Promise<KetQuaGhiTienDo> {
  const hien = await db.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId, lessonStableId: input.lessonStableId } }, select: { status: true, percent: true } });
  const daXong = hien?.status === "COMPLETED";
  const tienDoTruoc = await docTienDoKhoaTheoQuyen(db, entitlementId, input.courseId);
  const moi = kind === "READ" ? 100 : Math.max(hien?.percent ?? 0, input.percent ?? 0); // chỉ TĂNG: tua lùi không làm mất tiến độ
  const hoanThanh = daXong || (kind === "READ" ? true : moi >= nguongVideo);
  const percent = kind === "READ" && hoanThanh ? 100 : moi;
  await db.onlLessonProgress.upsert({
    where: { entitlementId_lessonStableId: { entitlementId, lessonStableId: input.lessonStableId } },
    create: {
      entitlementId,
      lessonStableId: input.lessonStableId,
      status: hoanThanh ? "COMPLETED" : "IN_PROGRESS",
      percent,
      completedAt: hoanThanh ? input.now : null,
      completedVersionNumber: hoanThanh ? soBan : null,
    },
    // Đã COMPLETED thì không hạ (không ghi đè completedAt/completedVersionNumber).
    update: daXong ? {} : { status: hoanThanh ? "COMPLETED" : "IN_PROGRESS", percent, ...(hoanThanh ? { completedAt: input.now, completedVersionNumber: soBan } : {}) },
  });
  const tienDo = await docTienDoKhoaTheoQuyen(db, entitlementId, input.courseId);
  return {
    ok: true,
    trangThai: hoanThanh ? "COMPLETED" : "IN_PROGRESS",
    percent: daXong ? (hien?.percent ?? 100) : percent,
    vuaHoanThanhBai: hoanThanh && !daXong,
    tienDo,
    vuaHoanThanhKhoa: tienDo.hoanThanh && !tienDoTruoc.hoanThanh,
  };
}

// ───────── Đọc tiến độ khoá ─────────

export type KhoaCuaHocVien = {
  courseId: string;
  code: string;
  name: string;
  slug: string;
  coverImageKey: string | null;
  trangThai: Exclude<TrangThaiHieuLuc, "THU_HOI">;
  hetHan: Date | null;
  conLaiNgay: number | null;
  tienDo: TienDoKhoa | null;
  /** Có thể gia hạn không (khoá bật gia hạn). Việc mua/gia hạn do Workstream A xử lý. */
  choPhepGiaHan: boolean;
};

/** Danh sách khoá Online của MỘT con. THU HỒI ⇒ không có trong danh sách. Sai phụ huynh ⇒ `null` (không phân biệt "không có" và "không phải của bạn"). */
export async function docKhoaOnlineCuaHocVien(db: Db, input: { parentUserId: string; studentId: string; now: Date }): Promise<KhoaCuaHocVien[] | null> {
  if (!(await laConCuaPhuHuynh(db, input.parentUserId, input.studentId))) return null;
  const quyen = await db.onlEntitlement.findMany({
    where: { studentId: input.studentId, status: "ACTIVE", course: { deletedAt: null } },
    select: { id: true, courseId: true, expiresAt: true, status: true, course: { select: { code: true, name: true, slug: true, coverImageKey: true, renewalEnabled: true, publishedVersionId: true } } },
    orderBy: { createdAt: "desc" },
  });
  const kq: KhoaCuaHocVien[] = [];
  for (const q of quyen) {
    const t = trangThaiHieuLuc({ trangThai: q.status, hetHan: q.expiresAt }, input.now);
    if (t === "THU_HOI") continue;
    kq.push({
      courseId: q.courseId,
      code: q.course.code,
      name: q.course.name,
      slug: q.course.slug,
      coverImageKey: q.course.coverImageKey,
      trangThai: t,
      hetHan: q.expiresAt,
      conLaiNgay: q.expiresAt ? Math.max(0, Math.ceil((q.expiresAt.getTime() - input.now.getTime()) / 86_400_000)) : null,
      tienDo: q.course.publishedVersionId ? await docTienDoKhoaTheoQuyen(db, q.id, q.courseId) : null,
      choPhepGiaHan: q.course.renewalEnabled,
    });
  }
  return kq;
}

export type BaiTrongKhoaHocVien = {
  stableId: string;
  title: string;
  kind: string;
  chapterTitle: string;
  required: boolean;
  durationSec: number | null;
  trangThai: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  percent: number;
  /** D23: khoá HẾT HẠN ⇒ `{ mo:false, lyDo:"HET_HAN" }` cho mọi bài (chỉ xem tiến độ). */
  mo: KetQuaMoBai | { mo: false; lyDo: "HET_HAN" };
};

/** Mục lục khoá của MỘT con: tiến độ từng bài + bài nào mở được. KHÔNG trả nội dung bài (nội dung đi qua cổng riêng theo từng bài). Bài ẩn chỉ hiện nếu người học đã bắt đầu nó. */
export async function docMucLucKhoaCuaHocVien(
  db: Db,
  input: { parentUserId: string; studentId: string; courseId: string; now: Date },
): Promise<{ ok: true; hetHan: boolean; tienDo: TienDoKhoa; bai: BaiTrongKhoaHocVien[] } | { ok: false; ma: MaSoHuu | "KHONG_CO_QUYEN" | "DA_THU_HOI" | "KHOA_CHUA_PHAT_HANH" }> {
  if (!(await laConCuaPhuHuynh(db, input.parentUserId, input.studentId))) return { ok: false, ma: "SAI_PHU_HUYNH" };
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true, status: true, expiresAt: true } });
  if (!q) return { ok: false, ma: "KHONG_CO_QUYEN" };
  const t = trangThaiHieuLuc({ trangThai: q.status, hetHan: q.expiresAt }, input.now);
  if (t === "THU_HOI") return { ok: false, ma: "DA_THU_HOI" };
  // D23: khoá HẾT HẠN vẫn xem được mục lục (CHỈ tiến độ từng bài, không nội dung) với `hetHan: true` và KHÔNG bài nào mở được; thu hồi vẫn chặn.
  const hetHan = t === "HET_HAN";
  const khoa = await db.onlCourse.findUnique({ where: { id: input.courseId }, select: { publishedVersionId: true } });
  if (!khoa?.publishedVersionId) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const [{ cay, caiDat }, dong] = await Promise.all([docBanChayChoTienDo(db, input.courseId), db.onlLessonProgress.findMany({ where: { entitlementId: q.id }, select: { lessonStableId: true, status: true, percent: true } })]);
  const td: TienDoBai = Object.fromEntries(dong.map((d) => [d.lessonStableId, d.status]));
  const pc = new Map(dong.map((d) => [d.lessonStableId, d.percent]));
  const bai = cay
    .filter((b) => !b.hidden || td[b.stableId] === "IN_PROGRESS" || td[b.stableId] === "COMPLETED")
    .map((b) => ({
      stableId: b.stableId,
      title: b.title,
      kind: b.kind,
      chapterTitle: b.chapterTitle,
      required: b.required,
      durationSec: b.durationSec,
      trangThai: (td[b.stableId] ?? "NOT_STARTED") as "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED",
      percent: pc.get(b.stableId) ?? 0,
      mo: hetHan ? ({ mo: false, lyDo: "HET_HAN" } as const) : td[b.stableId] === "COMPLETED" ? ({ mo: true } as KetQuaMoBai) : baiCoMoDuoc(cay, td, caiDat, b.stableId),
    }));
  return { ok: true, hetHan, tienDo: tinhTienDoKhoa(cay, td, caiDat), bai };
}
