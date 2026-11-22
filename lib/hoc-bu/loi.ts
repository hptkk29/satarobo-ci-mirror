// lib/hoc-bu/loi.ts — lỗi nghiệp vụ của module Học bù: `message` nói được thẳng với người dùng; ném trong giao dịch ⇒ rollback.
// Tách khỏi `case-db.ts` (T05) để `dong-service.ts` kế thừa được mà không vòng import; `case-db.ts` vẫn re-export tên cũ.
import type { KetQuaXungDot } from "@/lib/lms/lich-xung-dot";

export class LoiHocBu extends Error {}

/**
 * Trùng lịch giáo viên / phòng / học viên khi xếp hoặc sửa case (T09). `message` là câu nói thẳng với người dùng ("GV Nguyễn A đang có lớp
 * Robotics 6A từ 18:00–19:30. …"); `ketQua` mang dữ liệu cấu trúc (nguồn, id, giờ…) cho ai cần dựng giao diện riêng.
 * Kế thừa `LoiHocBu` để mọi action đang bắt `LoiHocBu` hiện đúng câu này mà không phải sửa.
 */
export class LoiTrungLich extends LoiHocBu {
  constructor(
    message: string,
    readonly ketQua: KetQuaXungDot,
  ) {
    super(message);
    this.name = "LoiTrungLich";
  }
}
