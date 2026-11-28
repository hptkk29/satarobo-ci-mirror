import type { ScopedDb } from "@/lib/actions/factory";

/**
 * MÀN BUỔI TRỰC TIẾP cho NGƯỜI HỌC — CHỈ ĐỌC: "tôi đã được điểm danh chưa".
 *
 * ⚠️ Màn này KHÔNG GHI gì: không tạo dòng tiến độ, không đặt `startedAt`/`lastActivityAt`. Điểm danh là việc của GIẢNG VIÊN
 * (`lib/elearning/equivalence.ts` — tick "đã dự" ⇒ `DONE`); mở màn không được là một đường tới `DONE` hay làm khoá "đang học".
 * Lưới `buoi-truc-tiep-db.test.ts` đếm dòng tiến độ trước/sau khi đọc.
 *
 * ⚠️ Chỉ nói thứ DỮ LIỆU CÓ: ngày buổi (`TrnLesson.sessionDate`), người tick + lúc tick (`attendanceMarked*`). KHÔNG có "phòng/địa
 * điểm" (không có cột) — không bịa.
 */

export type BuoiTrucTiep = {
  daDiemDanh: boolean;
  /** Ngày diễn ra buổi (`TrnLesson.sessionDate`) — `null` khi người soạn chưa đặt. */
  ngayBuoi: Date | null;
  /** Lúc giảng viên tick — `null` khi chưa điểm danh. */
  luc: Date | null;
  /** Tên người tick — `null` khi chưa điểm danh HOẶC không đọc được tên (khác cơ sở / đã xoá). */
  nguoiGhi: string | null;
};

const ngayVN = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
/** "16/11, 17:05" giờ VN — ghép từ các phần (định dạng mặc định của `vi-VN` đảo thứ tự giờ/ngày tuỳ môi trường). */
const gioVN = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}, ${p.hour}:${p.minute}`;
};

export type MoTaBuoi = {
  tieuDe: string;
  /** Câu trạng thái chính. */
  trangThai: string;
  /** Các dòng chi tiết (không rỗng chuỗi). */
  chiTiet: string[];
  /** Lời hướng dẫn cuối. */
  huongDan: string;
};

/** Nội dung màn — THUẦN. Đã điểm danh: ghi nhận ai/lúc nào; chưa: nói rõ KHÔNG cần bấm gì và hỏi ai. */
export function moTaBuoiTrucTiep(b: BuoiTrucTiep): MoTaBuoi {
  if (b.daDiemDanh) {
    const chiTiet = [
      b.luc ? `${b.nguoiGhi ? `${b.nguoiGhi} ghi` : "Được ghi"} lúc ${gioVN(b.luc)}` : b.nguoiGhi ? `${b.nguoiGhi} đã ghi nhận` : "",
      b.ngayBuoi ? `Buổi học ngày ${ngayVN(b.ngayBuoi)}` : "",
    ].filter(Boolean);
    return {
      tieuDe: "Bạn đã được ghi có mặt",
      trangThai: "Đã điểm danh",
      chiTiet,
      huongDan: "Bài này đã hoàn thành. Bạn không cần làm gì thêm.",
    };
  }
  return {
    tieuDe: "Chưa điểm danh",
    trangThai: "Chưa điểm danh",
    chiTiet: b.ngayBuoi ? [`Buổi học ngày ${ngayVN(b.ngayBuoi)}`] : [],
    huongDan:
      "Bạn không cần bấm gì ở đây: giảng viên điểm danh trong buổi học. Nếu bạn đã dự mà chưa được ghi, hỏi quản lý trực tiếp hoặc phòng Đào tạo.",
  };
}

/**
 * Đọc trạng thái điểm danh của CHÍNH `userId` cho một bài trong một lượt. Hai truy vấn tối đa (tiến độ + tên người tick).
 * Tên đọc qua `scopedDb`: người tick khác cơ sở có thể không đọc được ⇒ `nguoiGhi = null`, màn vẫn đúng.
 */
export async function docBuoiTrucTiep(
  db: ScopedDb,
  input: { enrollmentId: string; lessonId: string; userId: string; ngayBuoi: Date | null },
): Promise<BuoiTrucTiep> {
  const tt = await db.trnLessonProgress.findFirst({
    where: { enrollmentId: input.enrollmentId, lessonId: input.lessonId, userId: input.userId },
    select: { status: true, attendanceMarkedAt: true, attendanceMarkedByUserId: true },
  });
  // "Đã điểm danh" = có DẤU điểm danh của giảng viên. Không dựa riêng `status = DONE`: bài trực tiếp cũng có thể DONE theo đường
  // công nhận tương đương (không có người tick) — khi đó câu "đã được ghi có mặt" sẽ nói sai.
  const daDiemDanh = tt?.attendanceMarkedAt != null;
  let nguoiGhi: string | null = null;
  if (daDiemDanh && tt?.attendanceMarkedByUserId) {
    const u = await db.user.findFirst({ where: { id: tt.attendanceMarkedByUserId }, select: { name: true } });
    nguoiGhi = u?.name ?? null;
  }
  return { daDiemDanh, ngayBuoi: input.ngayBuoi, luc: tt?.attendanceMarkedAt ?? null, nguoiGhi };
}
