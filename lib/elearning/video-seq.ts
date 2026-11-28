/**
 * SỐ THỨ TỰ NHỊP (`seq`) — hai việc của TRÌNH PHÁT, tách ra để test được mà không cần dựng trình duyệt.
 *
 * Server bỏ nhịp có `seq <= seq đã lưu` (`nhipDenMuon`): đó là cách chống nhịp trùng/đến muộn/đảo thứ tự và
 * KHÔNG được gỡ. Hệ quả là bộ đếm ở trình phát phải đi TIẾP từ số server đã lưu:
 *
 *  - Bản cũ khởi tạo `useRef(0)` mỗi lần tải trang ⇒ sau khi đã lưu `seq = k`, k nhịp đầu (≈ k × 15 giây) của
 *    lượt xem mới bị coi là "đến muộn" và rơi mất. Đo trên Postgres thật: đã xem 3 nhịp rồi tải lại, tiến độ
 *    kẹt ở 45 giây thay vì 60.
 *  - Hai tab của cùng một người cùng xuất phát từ cùng số đã lưu, nên nhịp của tab chậm hơn bị bỏ (vô hại —
 *    còn đúng ý "chỉ một nguồn được tính"), nhưng nếu tab đó không ĐỒNG BỘ LẠI thì nó mất mọi nhịp sau đó cho
 *    tới khi bộ đếm của nó tự vượt số của tab kia.
 */

/** Giá trị khởi đầu của bộ đếm = `seq` đã lưu của tiến độ (trang học đọc từ DB, truyền xuống trình phát). */
export function seqKhoiDau(daLuu: number | null | undefined): number {
  if (typeof daLuu !== "number" || !Number.isFinite(daLuu) || daLuu < 0) return 0;
  return Math.floor(daLuu);
}

/**
 * Bộ đếm sau khi nhận phản hồi: không bao giờ thấp hơn số server đã ghi (`meta.seq`).
 *
 * Gọi sau MỖI phản hồi thành công. Khi nhịp bị coi là đến muộn (`BO_QUA`), server trả đúng số nó đang giữ;
 * lấy `max` để nhịp kế tiếp mang số lớn hơn và được nhận.
 */
export function seqSauPhanHoi(hienTai: number, serverGhi: number | null | undefined): number {
  const s = typeof serverGhi === "number" && Number.isFinite(serverGhi) ? Math.floor(serverGhi) : 0;
  return Math.max(hienTai, s);
}
