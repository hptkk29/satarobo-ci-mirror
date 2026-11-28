import { db } from "@/lib/db";
import { notifyElearning } from "@/lib/elearning/notify-gate";

/**
 * THÔNG BÁO CHO NGƯỜI HỌC khi có kết quả đổi trạng thái: bài tập được chấm / trả về · được cấp chứng nhận · hạn được nới.
 *
 * ⚠️ CHỈ in-app (chuông), qua `notifyElearning` (cổng người nhận UAT). KHÔNG email, KHÔNG Zalo. Web Push chỉ đi khi tiền tố được bật
 * trong cấu hình `push.tienToDuocDay` (mặc định tắt) — khai catalog không tự bật đẩy.
 *
 * ⚠️ Mọi hàm IDEMPOTENT bằng `dedupeKey` suy từ id bản ghi (không từ thời gian): phát lại sự kiện / chạy lại hàng đợi không đẻ
 * thông báo thứ hai. Và NUỐT LỖI ở nơi gọi: đây là phần phụ SAU khi việc chính đã commit — mất một thông báo không được kéo đổ
 * việc chấm điểm / cấp chứng nhận / gia hạn đã ghi xong.
 */

/** "dd/mm/yyyy" giờ VN. */
const ngayVN = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/** Số điểm hiển thị gọn: 10 → "10", 10.5 → "10,5". */
export const dinhDangDiem = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Nội dung thông báo kết quả chấm bài — THUẦN, để test không cần DB. */
export function noiDungKetQuaCham(o: {
  tenBai: string;
  traVeSua: boolean;
  dat: boolean | null;
  tong: number | null;
  toiDa: number | null;
}): { title: string; body: string } {
  if (o.traVeSua) {
    return {
      title: `Bài tập "${o.tenBai}" được trả về để sửa`,
      body: "Người chấm đã nhận xét. Mở bài để xem nhận xét và nộp lại.",
    };
  }
  const diem =
    o.tong !== null && o.toiDa !== null ? `${dinhDangDiem(o.tong)}/${dinhDangDiem(o.toiDa)}` : o.tong !== null ? dinhDangDiem(o.tong) : null;
  const ketQua = o.dat === true ? "đạt" : o.dat === false ? "chưa đạt" : "đã có kết quả";
  return {
    title: `Bài tập "${o.tenBai}" đã được chấm: ${ketQua}${diem ? ` ${diem}` : ""}`,
    body: o.dat === false ? "Mở bài để xem nhận xét của người chấm." : "Xem nhận xét của người chấm trong bài.",
  };
}

export async function thongBaoDaCham(o: {
  submissionId: string;
  userId: string;
  enrollmentId: string | null;
  lessonId: string;
  tenBai: string;
  traVeSua: boolean;
  dat: boolean | null;
  tong: number | null;
  toiDa: number | null;
}): Promise<number> {
  const nd = noiDungKetQuaCham(o);
  return notifyElearning({
    userIds: [o.userId],
    // Mỗi bài nộp chỉ được chấm MỘT lần (cổng `updateMany … status: SUBMITTED`) nên khoá theo bài nộp là đủ.
    dedupeKey: `el.cham:${o.submissionId}`,
    title: nd.title,
    body: nd.body,
    href: o.enrollmentId ? `/elearning/hoc/${o.enrollmentId}/${o.lessonId}` : "/elearning",
    // Đối tượng đích theo catalog là LƯỢT GHI DANH (không có loại "bài nộp" trong NotiEntityType).
    entityId: o.enrollmentId ?? o.submissionId,
  });
}

export async function thongBaoCapChungNhan(o: {
  certificateId: string;
  certCode: string;
  userId: string;
  tenKhoa: string;
}): Promise<number> {
  return notifyElearning({
    userIds: [o.userId],
    dedupeKey: `el.cap-cn:${o.certificateId}`,
    title: `Bạn được cấp chứng nhận khoá "${o.tenKhoa}"`,
    body: `Số hiệu ${o.certCode}. Xem và tải bản PDF trong mục Chứng nhận.`,
    href: `/elearning/chung-nhan-cua-toi/${encodeURIComponent(o.certCode)}`,
    entityId: o.certificateId,
  });
}

/**
 * Báo hạn được nới cho từng người trong một lô gia hạn. Hai truy vấn bất kể số người (lượt ghi danh + tên khoá).
 * Khoá chống trùng mang HẠN MỚI: nới lần hai ra hạn khác ⇒ thông báo mới; chạy lại cùng lần ⇒ không trùng.
 */
export async function thongBaoGiaHan(capNhat: readonly { id: string; dueAt: Date }[]): Promise<number> {
  if (capNhat.length === 0) return 0;
  const luot = await db.trnEnrollment.findMany({
    where: { id: { in: capNhat.map((c) => c.id) } },
    select: { id: true, userId: true, courseId: true },
  });
  const khoa = await db.trnCourse.findMany({
    where: { id: { in: [...new Set(luot.map((l) => l.courseId))] } },
    select: { id: true, title: true },
  });
  const ten = new Map(khoa.map((k) => [k.id, k.title]));
  const han = new Map(capNhat.map((c) => [c.id, c.dueAt]));
  let tong = 0;
  for (const l of luot) {
    const moi = han.get(l.id);
    if (!moi) continue;
    tong += await notifyElearning({
      userIds: [l.userId],
      dedupeKey: `el.gia-han:${l.id}:${moi.getTime()}`,
      title: `Hạn khoá "${ten.get(l.courseId) ?? "đào tạo nội bộ"}" được nới đến ${ngayVN(moi)}`,
      body: "Bạn học tiếp được trong thời gian mới.",
      href: `/elearning/hoc/${l.id}`,
      entityId: l.id,
    });
  }
  return tong;
}
