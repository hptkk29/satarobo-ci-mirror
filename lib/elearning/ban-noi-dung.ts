import { createHash } from "node:crypto";
import type { ScopedDb } from "@/lib/actions/factory";

/**
 * ẢNH CHỤP NỘI DUNG của một phiên bản khoá (P5a · D5) — để màn duyệt so được "bản này khác bản trước ở đâu".
 *
 * ⚠️ `TrnLesson` KHÔNG được phiên bản hoá: bài là dòng dùng chung, sửa tại chỗ là đổi cho cả mọi bản. Cái duy nhất giữ lại dấu vết
 * là `TrnCourseVersionLesson.contentHash` — vân tay nội dung bài LÚC chụp. Trước P5a cột này luôn là "" (= KHÔNG BIẾT, không phải
 * "đã đổi"); `soSanhBan` coi "" là "không so được".
 *
 * ⚠️ Vân tay chỉ phủ các trường NẰM TRÊN `TrnLesson` (tên, loại, chữ, nguồn video, phụ đề, thời lượng, đề, khung). Nội dung CÂU HỎI của
 * đề / tiêu chí của khung (bảng khác) đổi mà id không đổi thì vân tay KHÔNG đổi — giới hạn đã biết, ghi ở DECISIONS D-14.
 */

/** Danh sách trường vào vân tay — thêm/bớt một trường là đổi vân tay của MỌI bài (ca `[BND-02]` ghim danh sách). */
export const TRUONG_BAM_BAI = [
  "title",
  "kind",
  "contentMd",
  "minReadSeconds",
  "videoKey",
  "youtubeId",
  "youtubePhuDe",
  "captionKey",
  "durationSec",
  "examId",
  "rubricId",
  "sessionDate",
] as const;

export type BaiDeBam = {
  title: string;
  kind: string;
  contentMd: string | null;
  minReadSeconds: number | null;
  videoKey: string | null;
  youtubeId: string | null;
  youtubePhuDe: boolean | null;
  captionKey: string | null;
  durationSec: number | null;
  examId: string | null;
  rubricId: string | null;
  sessionDate: Date | null;
};

export function bamNoiDungBai(b: BaiDeBam): string {
  const ra = TRUONG_BAM_BAI.map((k) => {
    const v = b[k];
    return v instanceof Date ? v.toISOString() : (v ?? null);
  });
  return createHash("sha256").update(JSON.stringify(ra)).digest("hex");
}

/**
 * MỘT quy tắc "bài này bắt buộc không" cho phiên bản chưa có dòng của bài: dòng của CHÍNH bản này → dòng của bản đã xuất bản trước →
 * mặc định BẮT BUỘC (phía chặt). Dùng ở TRÌNH SOẠN/CỔNG xuất bản (`docDanBai`), BẢN CHỤP (`chupBan`) và MÀN DUYỆT — ba nơi mà lệch nhau là
 * màn nói "còn 5 bài bắt buộc" còn bản xuất bản ghi 0.
 */
export function batBuocKeThua(lessonId: string, nay: ReadonlyMap<string, boolean>, truoc: ReadonlyMap<string, boolean>): boolean {
  return nay.get(lessonId) ?? truoc.get(lessonId) ?? true;
}

export type BaiTrongBan = { lessonId: string; title: string; orderIndex: number; required: boolean; contentHash: string };

export type KetQuaSoSanh = {
  them: BaiTrongBan[];
  bot: BaiTrongBan[];
  /** Cùng bài, cờ bắt buộc đổi. */
  doiBatBuoc: { lessonId: string; title: string; tu: boolean; den: boolean }[];
  /** Cùng bài, vân tay đổi (cả hai phía đều có vân tay). */
  doiNoiDung: { lessonId: string; title: string }[];
  /** Cùng bài, thứ tự đổi. */
  doiThuTu: { lessonId: string; title: string; tu: number; den: number }[];
  /** Bài có ở cả hai bản nhưng một phía chưa có vân tay — KHÔNG kết luận được "đổi" hay "giữ". */
  chuaSoDuoc: number;
  /** `true` = không có gì khác (và `chuaSoDuoc` = 0 mới đáng tin "giống hệt"). */
  khongDoi: boolean;
};

/** So hai danh sách bài của hai phiên bản. `cu = null` (chưa có bản trước) ⇒ mọi bài là "thêm". */
export function soSanhBan(cu: readonly BaiTrongBan[] | null, moi: readonly BaiTrongBan[]): KetQuaSoSanh {
  const mapCu = new Map((cu ?? []).map((b) => [b.lessonId, b]));
  const mapMoi = new Map(moi.map((b) => [b.lessonId, b]));
  const them = moi.filter((b) => !mapCu.has(b.lessonId));
  const bot = (cu ?? []).filter((b) => !mapMoi.has(b.lessonId));
  const doiBatBuoc: KetQuaSoSanh["doiBatBuoc"] = [];
  const doiNoiDung: KetQuaSoSanh["doiNoiDung"] = [];
  const doiThuTu: KetQuaSoSanh["doiThuTu"] = [];
  let chuaSoDuoc = 0;
  for (const b of moi) {
    const a = mapCu.get(b.lessonId);
    if (!a) continue;
    if (a.required !== b.required) doiBatBuoc.push({ lessonId: b.lessonId, title: b.title, tu: a.required, den: b.required });
    if (a.contentHash === "" || b.contentHash === "") {
      // Bản cũ (trước P5a) chưa từng được chụp ⇒ `orderIndex` của dòng đó cũng KHÔNG đáng tin (không ai cập nhật khi sắp thứ tự) — không kết
      // luận "đổi thứ tự" từ nó, y như không kết luận "đổi nội dung". Cờ bắt buộc thì luôn được duy trì nên vẫn so.
      chuaSoDuoc += 1;
    } else {
      if (a.orderIndex !== b.orderIndex) doiThuTu.push({ lessonId: b.lessonId, title: b.title, tu: a.orderIndex, den: b.orderIndex });
      if (a.contentHash !== b.contentHash) doiNoiDung.push({ lessonId: b.lessonId, title: b.title });
    }
  }
  return {
    them,
    bot,
    doiBatBuoc,
    doiNoiDung,
    doiThuTu,
    chuaSoDuoc,
    khongDoi: them.length + bot.length + doiBatBuoc.length + doiNoiDung.length + doiThuTu.length === 0,
  };
}

/** Trạng thái phiên bản mà nội dung bị KHOÁ (B-11): chờ duyệt, đã duyệt, đã xuất bản, đã lưu trữ. Chỉ `DRAFT` còn sửa được. */
export const TRANG_THAI_DA_KHOA = ["PENDING_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"] as const;
const DA_KHOA: readonly string[] = TRANG_THAI_DA_KHOA;

/**
 * So sánh hai bản THEO DÒNG DÕI (B-11): bài được tách bản (`forkedFromLessonId`) là CÙNG MỘT BÀI ở hai phiên bản — không được báo thành "bỏ bài cũ + thêm
 * bài mới". `goc(id)` trả id gốc của dòng dõi (id của chính nó nếu không phải bản tách). Kết quả giữ id THẬT của từng bản: bài thêm / đổi lấy id phía
 * bản mới, bài bớt lấy id phía bản cũ.
 */
export function soSanhBanTheoDongDoi(
  cu: readonly BaiTrongBan[] | null,
  moi: readonly BaiTrongBan[],
  goc: (lessonId: string) => string,
): KetQuaSoSanh {
  const idMoi = new Map(moi.map((b) => [goc(b.lessonId), b.lessonId]));
  const idCu = new Map((cu ?? []).map((b) => [goc(b.lessonId), b.lessonId]));
  const r = soSanhBan(
    cu ? cu.map((b) => ({ ...b, lessonId: goc(b.lessonId) })) : null,
    moi.map((b) => ({ ...b, lessonId: goc(b.lessonId) })),
  );
  const veMoi = <T extends { lessonId: string }>(x: T): T => ({ ...x, lessonId: idMoi.get(x.lessonId) ?? x.lessonId });
  return {
    ...r,
    them: r.them.map(veMoi),
    bot: r.bot.map((x) => ({ ...x, lessonId: idCu.get(x.lessonId) ?? x.lessonId })),
    doiBatBuoc: r.doiBatBuoc.map(veMoi),
    doiNoiDung: r.doiNoiDung.map(veMoi),
    doiThuTu: r.doiThuTu.map(veMoi),
  };
}

// `tx` của `db.$transaction(...)` trên client đã mở rộng (scopedDb) — cùng kiểu với `ScopedDb` ở các model này.
type Tx = Pick<ScopedDb, "trnLesson" | "trnCourseVersionLesson" | "trnCourseVersion">;

const CHON_BAI_BAM = {
  id: true,
  createdAt: true,
  orderIndex: true,
  title: true,
  kind: true,
  contentMd: true,
  minReadSeconds: true,
  videoKey: true,
  youtubeId: true,
  youtubePhuDe: true,
  captionKey: true,
  durationSec: true,
  examId: true,
  rubricId: true,
  sessionDate: true,
} as const;

type DauVaoChup = { versionId: string; courseId: string; banTruocId: string | null; chiNhanBaiMoCoi?: boolean };
type KetQuaChup = { them: number; go: number; doiVanTay: number };

/**
 * CHỤP LẠI phiên bản (làm mới vân tay, thêm bài mồ côi, gỡ bài đã xoá mềm). Gọi TRONG giao dịch của bước chuyển trạng thái (GUI_DUYET · DUYET · XUAT_BAN) và của
 * bước mở bản nháp (`moBanNhap`).
 *
 * HAI KIỂU, chọn theo dấu vết của bản:
 *  · **Kiểu cũ** — bản nháp sinh TRƯỚC B-11 (`clonedFromVersionId` rỗng) trong khoá đã có bản đã khoá: nó bắt đầu RỖNG (`banNhap` cũ), nên mọi bài sống của khoá
 *    phải được bổ sung vào, cờ `required` kế thừa từ `banTruocId` (mặc định bắt buộc), thứ tự lấy từ bài. Giữ nguyên hành vi P5a.
 *  · **Kiểu tường minh** (mọi bản còn lại: nháp do cổng ghi B-11 sao chép, bản đã khoá, v1.0 của khoá mới) — tập bài LÀ các dòng của bản; chỉ làm mới vân
 *    tay từ chính bài mà dòng trỏ tới, gỡ dòng của bài xoá mềm, và nhận BÀI MỒ CÔI (bài sống không thuộc dòng nào của bất kỳ bản nào — seed/nhập tay).
 *    Thứ tự KHÔNG bị ghi đè từ bài: nó là của dòng phiên bản.
 *
 * `chiNhanBaiMoCoi`: chỉ nhận bài mồ côi, không làm mới vân tay (bước mở bản nháp — bản nháp vừa sao chép nguyên văn).
 */
export async function chupBan(tx: Tx, input: DauVaoChup): Promise<KetQuaChup> {
  const ban = await tx.trnCourseVersion.findUnique({
    where: { id: input.versionId },
    select: { status: true, clonedFromVersionId: true, publishedAt: true },
  });
  const daKhoa = DA_KHOA.includes(ban?.status ?? "");
  const coAnhEmDaKhoa =
    (await tx.trnCourseVersion.count({
      where: { courseId: input.courseId, id: { not: input.versionId }, status: { in: [...TRANG_THAI_DA_KHOA] } },
    })) > 0;
  const kieuCu = !input.chiNhanBaiMoCoi && ban?.clonedFromVersionId == null && coAnhEmDaKhoa && !daKhoa;
  return kieuCu ? chupBanKieuCu(tx, input) : chupBanTuongMinh(tx, input, { daKhoa, publishedAt: ban?.publishedAt ?? null });
}

async function chupBanTuongMinh(tx: Tx, input: DauVaoChup, ban: { daKhoa: boolean; publishedAt: Date | null }): Promise<KetQuaChup> {
  const [dong, baiSong, moiDong, dongTruoc] = await Promise.all([
    tx.trnCourseVersionLesson.findMany({
      where: { versionId: input.versionId },
      select: { id: true, lessonId: true, contentHash: true, lesson: { select: { ...CHON_BAI_BAM, deletedAt: true } } },
    }),
    tx.trnLesson.findMany({ where: { module: { courseId: input.courseId }, deletedAt: null }, select: CHON_BAI_BAM }),
    tx.trnCourseVersionLesson.findMany({
      where: { version: { courseId: input.courseId } },
      select: { lessonId: true, version: { select: { status: true } } },
    }),
    input.banTruocId
      ? tx.trnCourseVersionLesson.findMany({ where: { versionId: input.banTruocId }, select: { lessonId: true, required: true } })
      : Promise.resolve([] as { lessonId: string; required: boolean }[]),
  ]);
  const coDong = new Map(dong.map((d) => [d.lessonId, d]));
  const coDongBatKy = new Set(moiDong.map((d) => d.lessonId));
  const coDongDaKhoa = new Set(moiDong.filter((d) => DA_KHOA.includes(d.version.status)).map((d) => d.lessonId));
  const batBuocTruoc = new Map(dongTruoc.map((d) => [d.lessonId, d.required]));
  let them = 0;
  let go = 0;
  let doiVanTay = 0;

  for (const d of dong) {
    if (d.lesson.deletedAt) {
      await tx.trnCourseVersionLesson.delete({ where: { id: d.id } });
      go += 1;
    } else if (!input.chiNhanBaiMoCoi) {
      const van = bamNoiDungBai(d.lesson);
      if (d.contentHash !== van) {
        await tx.trnCourseVersionLesson.update({ where: { id: d.id }, data: { contentHash: van } });
        doiVanTay += 1;
      }
    }
  }
  for (const b of baiSong) {
    if (coDong.has(b.id)) continue;
    // Bài mồ côi: không thuộc dòng nào. Riêng bản ĐÃ KHOÁ chưa chụp (dữ liệu cũ): bài chỉ có dòng ở bản NHÁP nhưng sinh trước ngày xuất bản của nó cũng thuộc về nó.
    const moCoi = ban.daKhoa
      ? !coDongDaKhoa.has(b.id) && (!coDongBatKy.has(b.id) || ban.publishedAt === null || b.createdAt <= ban.publishedAt)
      : !coDongBatKy.has(b.id);
    if (!moCoi) continue;
    await tx.trnCourseVersionLesson.create({
      data: { versionId: input.versionId, lessonId: b.id, orderIndex: b.orderIndex, required: batBuocKeThua(b.id, new Map(), batBuocTruoc), contentHash: bamNoiDungBai(b) },
    });
    them += 1;
  }
  return { them, go, doiVanTay };
}

async function chupBanKieuCu(tx: Tx, input: DauVaoChup): Promise<KetQuaChup> {
  const [baiSong, dong, dongTruoc] = await Promise.all([
    tx.trnLesson.findMany({ where: { module: { courseId: input.courseId }, deletedAt: null }, select: CHON_BAI_BAM }),
    tx.trnCourseVersionLesson.findMany({
      where: { versionId: input.versionId },
      select: { id: true, lessonId: true, contentHash: true, orderIndex: true },
    }),
    input.banTruocId
      ? tx.trnCourseVersionLesson.findMany({ where: { versionId: input.banTruocId }, select: { lessonId: true, required: true } })
      : Promise.resolve([] as { lessonId: string; required: boolean }[]),
  ]);

  const song = new Map(baiSong.map((b) => [b.id, b]));
  const coDong = new Map(dong.map((d) => [d.lessonId, d]));
  const batBuocTruoc = new Map(dongTruoc.map((d) => [d.lessonId, d.required]));
  let them = 0;
  let go = 0;
  let doiVanTay = 0;

  for (const d of dong) {
    if (!song.has(d.lessonId)) {
      await tx.trnCourseVersionLesson.delete({ where: { id: d.id } });
      go += 1;
    }
  }
  for (const b of baiSong) {
    const van = bamNoiDungBai(b);
    const d = coDong.get(b.id);
    if (!d) {
      await tx.trnCourseVersionLesson.create({
        data: { versionId: input.versionId, lessonId: b.id, orderIndex: b.orderIndex, required: batBuocKeThua(b.id, new Map(), batBuocTruoc), contentHash: van },
      });
      them += 1;
    } else if (d.contentHash !== van || d.orderIndex !== b.orderIndex) {
      // Đồng bộ CẢ thứ tự: ở kiểu cũ `sapThuTu` chỉ sửa `TrnLesson.orderIndex`, nên dòng phiên bản giữ thứ tự cũ.
      await tx.trnCourseVersionLesson.update({ where: { id: d.id }, data: { contentHash: van, orderIndex: b.orderIndex } });
      doiVanTay += 1;
    }
  }
  return { them, go, doiVanTay };
}
