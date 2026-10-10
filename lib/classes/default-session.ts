// lib/classes/default-session.ts — luật chọn BUỔI MẶC ĐỊNH cho các panel điểm danh /
// đánh giá của trang chi tiết lớp.
//
// Tách thành hàm thuần vì đây là chỗ đã đẻ ra sự cố 19/08/2026: quản lý báo "giáo viên
// điểm danh rồi mà admin không thấy". Nguyên nhân là trang mở sẵn BUỔI SẮP TỚI — buổi
// theo định nghĩa chưa ai điểm danh (site GV còn chặn cứng điểm danh buổi tương lai) —
// nên lưới hiện trắng và mọi người đọc thành "mất dữ liệu". Có hàm riêng + test thì lần
// sau ai đổi luật cũng phải đối diện với ca kiểm thử, không sửa lén một dòng trong page.

export type SessionLike = {
  id: string;
  date: Date;
  status: string;
};

/**
 * Buổi mở sẵn khi vào tab "Buổi & Điểm danh" / "Đánh giá".
 *
 * Luật: buổi GẦN NHẤT ĐÃ DIỄN RA (tính cả hôm nay) và chưa huỷ → nếu lớp chưa khai giảng
 * thì lấy buổi sắp tới đầu tiên → nếu tất cả đều huỷ thì lấy buổi cuối cùng.
 *
 * Điểm danh luôn NHÌN VỀ QUÁ KHỨ; mọi luật thay thế phải giữ tính chất đó.
 *
 * @param sessions xếp TĂNG dần theo ngày (đúng thứ tự truy vấn của trang lớp).
 * @param todayEnd mốc hết ngày hôm nay theo giờ VN (`vnEndOfDay`).
 */
export function pickDefaultSession<T extends SessionLike>(
  sessions: readonly T[],
  todayEnd: Date,
): T | null {
  if (sessions.length === 0) return null;
  const alive = sessions.filter((s) => s.status !== "CANCELLED");
  const endMs = todayEnd.getTime();
  for (let i = alive.length - 1; i >= 0; i--) {
    if (alive[i].date.getTime() <= endMs) return alive[i];
  }
  return alive[0] ?? sessions[sessions.length - 1] ?? null;
}
