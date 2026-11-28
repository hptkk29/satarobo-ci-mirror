import type { PrismaClient } from "@prisma/client";
import type { ScopedDb } from "@/lib/actions/factory";

/**
 * B-11 — PHIÊN BẢN KHOÁ MÀ MỘT LƯỢT HỌC ĐỌC.
 *
 * Nguyên tắc: người đang học KHÔNG BAO GIỜ tự chuyển sang phiên bản mới. Lượt học ghim phiên bản lúc được tạo
 * (`TrnEnrollment.courseVersionId` = bản ĐANG PHÁT HÀNH gần nhất), và mọi chỗ trả nội dung bài cho người học đọc tập bài + thứ tự + cờ
 * bắt buộc từ chính bản đó — không từ "cây bài sống" (nơi bản nháp đang được sửa).
 *
 * Chưa ghim (`null`: lượt cũ, hoặc khoá chưa phát hành lúc tạo lượt) ⇒ đọc theo bản đang phát hành gần nhất (đúng hành vi trước B-11).
 *
 * ⚠️ "ĐÃ KHOÁ" (`daKhoa`) = bản có dòng và KHÔNG dòng nào còn vân tay rỗng. Bản cũ (trước P5a) chưa từng được chụp, tập dòng của nó không
 * đầy đủ ⇒ đọc theo cây sống như trước (KHÔNG thu hẹp) cho tới khi cổng ghi duy nhất (`sao-chep-khi-ghi.ts`) đóng băng nó ở lần sửa đầu tiên.
 */

type Doc = Pick<ScopedDb, "trnCourseVersion" | "trnCourseVersionLesson" | "trnLesson">;
/**
 * `scopedDb` (đường có actor) HOẶC client trần (cron, trình xử lý sự kiện — không có actor). Hai kiểu có cùng delegate nhưng không gán được cho
 * nhau; ép kiểu ở ĐÚNG MỘT chỗ (`dung`) thay vì ở từng nơi gọi.
 */
export type Nguon = Doc | PrismaClient;
const dung = (d: Nguon): Doc => d as unknown as Doc;

export type BanCuaLuot = {
  /** `null` = khoá chưa có bản phát hành nào ⇒ không có gì để thu hẹp. */
  versionId: string | null;
  /** Tập bài của bản này đã được chụp đầy đủ — chỉ khi đó mới đọc theo dòng phiên bản. */
  daKhoa: boolean;
};

/** Bản ĐANG PHÁT HÀNH gần nhất của từng khoá (một truy vấn, số lần gọi không theo số khoá). */
export async function banDangPhatHanhTheoKhoa(dbN: Nguon, courseIds: readonly string[]): Promise<Record<string, string | null>> {
  const db = dung(dbN);
  const ra: Record<string, string | null> = Object.fromEntries(courseIds.map((c) => [c, null]));
  if (courseIds.length === 0) return ra;
  const ban = await db.trnCourseVersion.findMany({
    where: { courseId: { in: [...new Set(courseIds)] }, status: "PUBLISHED" },
    orderBy: [{ major: "desc" }, { minor: "desc" }],
    select: { id: true, courseId: true },
  });
  for (const v of ban) if (ra[v.courseId] === null) ra[v.courseId] = v.id;
  return ra;
}

export async function banDangPhatHanh(db: Nguon, courseId: string): Promise<string | null> {
  return (await banDangPhatHanhTheoKhoa(db, [courseId]))[courseId] ?? null;
}

/** Bản đã chụp đủ chưa: có dòng, và không dòng nào còn vân tay rỗng ("không biết"). */
export async function banDaKhoa(dbN: Nguon, versionId: string): Promise<boolean> {
  const db = dung(dbN);
  const [tong, chuaChup] = await Promise.all([
    db.trnCourseVersionLesson.count({ where: { versionId } }),
    db.trnCourseVersionLesson.count({ where: { versionId, contentHash: "" } }),
  ]);
  return tong > 0 && chuaChup === 0;
}

/** Phiên bản mà lượt học này đọc: bản đã ghim, không có thì bản đang phát hành gần nhất. */
export async function banCuaLuot(db: Nguon, e: { courseId: string; courseVersionId: string | null }): Promise<BanCuaLuot> {
  const versionId = e.courseVersionId ?? (await banDangPhatHanh(db, e.courseId));
  if (!versionId) return { versionId: null, daKhoa: false };
  return { versionId, daKhoa: await banDaKhoa(db, versionId) };
}

/**
 * Bài có thuộc bản của lượt học không. Bản chưa khoá ⇒ `true` (đường cũ, không thu hẹp).
 * Dùng SAU chuỗi 4 điều kiện (`content-gate`), không thay nó: chuỗi đó trả lời "người này có được vào khoá không", đây trả lời "bài này có
 * nằm trong bản người này đang học không".
 */
export async function baiThuocBan(dbN: Nguon, ban: BanCuaLuot, lessonId: string): Promise<boolean> {
  if (!ban.versionId || !ban.daKhoa) return true;
  const db = dung(dbN);
  const co = await db.trnCourseVersionLesson.findFirst({ where: { versionId: ban.versionId, lessonId }, select: { id: true } });
  return co !== null;
}

export type BaiTrongCay = {
  id: string;
  title: string;
  kind: string;
  durationSec: number | null;
  minReadSeconds: number;
  examId: string | null;
};
export type ChuongTrongCay = { id: string; title: string; lessons: BaiTrongCay[] };

/**
 * Cây chương → bài của MỘT phiên bản, theo DÒNG PHIÊN BẢN (không theo cây sống): tập bài, thứ tự bài và cờ bắt buộc đều là của bản đó, nên bản
 * nháp đang sửa (thêm bài, tách bản, đổi thứ tự) không lọt vào mắt người đang học bản đã phát hành. Chương xếp theo thứ tự chương hiện hành;
 * bài xếp theo `orderIndex` của DÒNG phiên bản (trong chương).
 */
export async function docCayTheoBan(dbN: Nguon, versionId: string): Promise<{ cay: ChuongTrongCay[]; batBuoc: Map<string, boolean> }> {
  const db = dung(dbN);
  const dong = await db.trnCourseVersionLesson.findMany({
    where: { versionId, lesson: { deletedAt: null } },
    orderBy: { orderIndex: "asc" },
    select: {
      orderIndex: true,
      required: true,
      lesson: {
        select: {
          id: true,
          title: true,
          kind: true,
          durationSec: true,
          minReadSeconds: true,
          examId: true,
          module: { select: { id: true, title: true, orderIndex: true } },
        },
      },
      moduleOrder: true,
    },
  });
  const thuTuChuong = thuTuChuongCuaBan(
    [...new Map(dong.map((d) => [d.lesson.module.id, { id: d.lesson.module.id, orderIndex: d.lesson.module.orderIndex }])).values()],
    dong.map((d) => ({ moduleId: d.lesson.module.id, moduleOrder: d.moduleOrder })),
    null,
  );
  const chuong = new Map<string, { thuTu: number; c: ChuongTrongCay }>();
  const batBuoc = new Map<string, boolean>();
  for (const d of dong) {
    const m = d.lesson.module;
    const co = chuong.get(m.id) ?? { thuTu: thuTuChuong.get(m.id) ?? m.orderIndex, c: { id: m.id, title: m.title, lessons: [] } };
    co.c.lessons.push({
      id: d.lesson.id,
      title: d.lesson.title,
      kind: d.lesson.kind,
      durationSec: d.lesson.durationSec,
      minReadSeconds: d.lesson.minReadSeconds,
      examId: d.lesson.examId,
    });
    chuong.set(m.id, co);
    batBuoc.set(d.lesson.id, d.required);
  }
  return { cay: [...chuong.values()].sort((a, b) => a.thuTu - b.thuTu).map((x) => x.c), batBuoc };
}

/**
 * THỨ TỰ CHƯƠNG của một phiên bản (B-11b). Mỗi dòng phiên bản mang `moduleOrder` (cùng chương ⇒ cùng số). Bản chưa từng sắp lại chương (mọi dòng NULL) ⇒ theo `TrnModule.orderIndex`
 * như trước. Bản đã sắp lại: chương có dòng mang số của dòng; chương chỉ có dòng NULL hoặc chưa có dòng nào xếp SAU, theo thứ tự chương hiện hành — để không bao giờ trộn hai thang số.
 */
export function thuTuChuongCuaBan(
  chuong: readonly { id: string; orderIndex: number }[],
  dong: readonly { moduleId: string; moduleOrder: number | null }[],
  /**
   * B-11c — thứ tự ĐẦY ĐỦ đã lưu của bản (`TrnCourseVersion.moduleOrderJson`, qua `docThuTuChuongLuuSan`) hoặc `null`. BẮT BUỘC truyền (luật 7): chương RỖNG không có dòng
   * phiên bản nào mang `moduleOrder`, nên chỉ bản đồ này giữ được vị trí của nó. Đường của NGƯỜI HỌC truyền `null` có chủ đích — họ chỉ thấy chương có bài, mà thứ tự các chương
   * có bài đã nằm trên dòng phiên bản.
   */
  luuSan: Readonly<Record<string, number>> | null,
): Map<string, number> {
  const theoChuong = new Map<string, number>();
  for (const d of dong) {
    if (d.moduleOrder === null) continue;
    const cu = theoChuong.get(d.moduleId);
    if (cu === undefined || d.moduleOrder < cu) theoChuong.set(d.moduleId, d.moduleOrder);
  }
  // Chương chưa có số từ dòng (rỗng, hoặc chỉ có dòng NULL) mượn vị trí đã lưu nếu có.
  if (luuSan) for (const c of chuong) if (!theoChuong.has(c.id) && Number.isInteger(luuSan[c.id])) theoChuong.set(c.id, luuSan[c.id]);
  const daSapLai = theoChuong.size > 0;
  const lonNhat = daSapLai ? Math.max(...theoChuong.values()) : 0;
  return new Map(chuong.map((c) => [c.id, daSapLai ? (theoChuong.get(c.id) ?? lonNhat + 1 + c.orderIndex) : c.orderIndex]));
}

/**
 * B-11 — trong các bài CÙNG GẮN MỘT ĐỀ ở một khoá (bài gốc + bản tách của nó đều mang `examId`), bài nào là bài của PHIÊN BẢN mà lượt học đọc.
 * `ungVien` đã lọc theo khoá + đề. Ưu tiên bài nằm trong `versionId`; bài chưa từng vào bản nào (dữ liệu cũ, chỉ có ở cây sống) vẫn là ứng viên hợp lệ;
 * nếu mọi ứng viên đều đã nằm trong các bản mà KHÔNG có bản của lượt học ⇒ `null` (đề này không nằm trong bản người học đang học — đừng ghi "xong" vào
 * bài của bản nháp người ấy không thấy). Cùng điều kiện ⇒ chọn theo `orderIndex` để kết quả không phụ thuộc thứ tự trả về của DB.
 */
export function chonBaiCuaDeTrongBan<T extends { orderIndex: number; versionLessons: readonly { versionId: string }[] }>(ungVien: readonly T[], versionId: string | null): T | null {
  const theoThuTu = [...ungVien].sort((a, b) => a.orderIndex - b.orderIndex);
  if (versionId) {
    const trongBan = theoThuTu.find((b) => b.versionLessons.some((v) => v.versionId === versionId));
    if (trongBan) return trongBan;
    return theoThuTu.find((b) => b.versionLessons.length === 0) ?? null;
  }
  return theoThuTu[0] ?? null;
}

/** Đọc cột `moduleOrderJson` an toàn: chỉ nhận đối tượng { id: số nguyên >= 0 }; dạng hỏng ⇒ `null` (đọc như bản chưa kéo lại — không bao giờ ném lỗi ở màn đọc). */
export function docThuTuChuongLuuSan(json: unknown): Record<string, number> | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const ra: Record<string, number> = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) ra[k] = v;
  }
  return Object.keys(ra).length > 0 ? ra : null;
}

export type LuotDoc = { enrollmentId: string; courseId: string; courseVersionId: string | null };
/**
 * `thoiLuongGiay` / `minReadSeconds` / `nguonYoutube`: số đo THẬT của bài để màn Tổng quan nói "video 12 phút" và "còn khoảng …" — không có thì để trống,
 * không bịa. `nguonYoutube` chỉ là CỜ (mã video là bí mật của video không công khai nên KHÔNG ra khỏi máy chủ).
 */
export type BaiCuaLuot = {
  id: string;
  title: string;
  kind: string;
  required: boolean;
  thoiLuongGiay?: number | null;
  minReadSeconds?: number | null;
  nguonYoutube?: boolean;
};

type SoDoBai = { durationSec?: number | null; minReadSeconds?: number | null; youtubeId?: string | null };
const soDo = (l: SoDoBai) => ({ thoiLuongGiay: l.durationSec ?? null, minReadSeconds: l.minReadSeconds ?? null, nguonYoutube: Boolean(l.youtubeId) });

/**
 * Bài mà MỖI lượt học thấy, theo phiên bản đã ghim (B-11b) — dùng cho mọi màn của người học liệt kê/ đếm bài của nhiều lượt cùng lúc (tìm kiếm, tiến độ bắt buộc ở
 * tổng quan, danh sách khoá). Số truy vấn CỐ ĐỊNH (không theo số lượt/khoá): bản mới nhất mỗi khoá · dòng của các bản liên quan · cây sống CHỈ khi có khoá mà bản
 * chưa chụp đủ. Bản chưa chụp ⇒ cây sống như trước (không thu hẹp); cờ bắt buộc lấy từ dòng của bản (không có dòng ⇒ bắt buộc).
 */
export async function baiTheoLuot(dbN: Nguon, luot: readonly LuotDoc[], tuyChon: { soDo?: boolean } = {}): Promise<Map<string, BaiCuaLuot[]>> {
  const db = dung(dbN);
  // `soDo` (độ dài video, sàn đọc, cờ YouTube) CHỈ khi màn cần — tìm kiếm và danh sách đếm bài chỉ lấy TIÊU ĐỀ (luật cứng #7: không nạp nội dung khi không cần).
  const lay = tuyChon.soDo === true;
  const ra = new Map<string, BaiCuaLuot[]>();
  if (luot.length === 0) return ra;
  const maKhoa = [...new Set(luot.map((l) => l.courseId))];
  const moiNhat = await banDangPhatHanhTheoKhoa(db, maKhoa);
  const banCua = (l: LuotDoc) => l.courseVersionId ?? moiNhat[l.courseId] ?? null;
  const maBan = [...new Set(luot.map(banCua).filter((x): x is string => x !== null))];
  const dong = maBan.length
    ? await db.trnCourseVersionLesson.findMany({
        where: { versionId: { in: maBan }, lesson: { deletedAt: null } },
        orderBy: { orderIndex: "asc" },
        select: {
          versionId: true,
          required: true,
          contentHash: true,
          moduleOrder: true,
          lesson: { select: { id: true, title: true, kind: true, ...(lay ? { durationSec: true, minReadSeconds: true, youtubeId: true } : {}), module: { select: { id: true, orderIndex: true } } } },
        },
      })
    : [];
  const theoBan = new Map<string, typeof dong>();
  for (const d of dong) theoBan.set(d.versionId, [...(theoBan.get(d.versionId) ?? []), d]);
  const daKhoa = (v: string) => {
    const ds = theoBan.get(v) ?? [];
    return ds.length > 0 && ds.every((d) => d.contentHash !== "");
  };
  const khoaCanCaySong = [...new Set(luot.filter((l) => { const v = banCua(l); return v === null || !daKhoa(v); }).map((l) => l.courseId))];
  const caySong = khoaCanCaySong.length
    ? await db.trnLesson.findMany({
        where: { deletedAt: null, module: { courseId: { in: khoaCanCaySong } } },
        select: { id: true, title: true, kind: true, orderIndex: true, ...(lay ? { durationSec: true, minReadSeconds: true, youtubeId: true } : {}), module: { select: { courseId: true, orderIndex: true } } },
      })
    : [];
  for (const l of luot) {
    const v = banCua(l);
    if (v !== null && daKhoa(v)) {
      const rows = theoBan.get(v) ?? [];
      const thuTuChuong = thuTuChuongCuaBan(
        [...new Map(rows.map((d) => [d.lesson.module.id, { id: d.lesson.module.id, orderIndex: d.lesson.module.orderIndex }])).values()],
        rows.map((d) => ({ moduleId: d.lesson.module.id, moduleOrder: d.moduleOrder })),
        null,
      );
      const ds = [...rows].sort((a, b) => (thuTuChuong.get(a.lesson.module.id) ?? 0) - (thuTuChuong.get(b.lesson.module.id) ?? 0));
      ra.set(l.enrollmentId, ds.map((d) => ({ id: d.lesson.id, title: d.lesson.title, kind: d.lesson.kind, required: d.required, ...soDo(d.lesson) })));
    } else {
      const batBuoc = new Map((v ? (theoBan.get(v) ?? []) : []).map((d) => [d.lesson.id, d.required]));
      const ds = caySong
        .filter((b) => b.module.courseId === l.courseId)
        .sort((a, b) => a.module.orderIndex - b.module.orderIndex || a.orderIndex - b.orderIndex);
      ra.set(l.enrollmentId, ds.map((b) => ({ id: b.id, title: b.title, kind: b.kind, required: batBuoc.get(b.id) ?? true, ...soDo(b) })));
    }
  }
  return ra;
}

export const TU_CHOI_BAI_NGOAI_BAN = {
  code: "LESSON_NOT_IN_VERSION",
  message: "Bài này không thuộc phiên bản khoá bạn đang học",
} as const;

/** Trả `null` nếu được mở, hoặc lý do từ chối — cùng hình với `checkContentAccess`. */
export async function kiemBaiTrongBan(
  db: Nguon,
  e: { courseId: string; courseVersionId: string | null },
  lessonId: string,
): Promise<typeof TU_CHOI_BAI_NGOAI_BAN | null> {
  const ban = await banCuaLuot(db, e);
  return (await baiThuocBan(db, ban, lessonId)) ? null : TU_CHOI_BAI_NGOAI_BAN;
}
