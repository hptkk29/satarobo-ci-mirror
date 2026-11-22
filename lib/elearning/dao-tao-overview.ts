import type { ScopedDb } from "@/lib/actions/factory";

/**
 * TỔNG QUAN ĐÀO TẠO — việc vận hành cần xử lý, đếm từ dữ liệu thật qua `scopedDb`.
 *
 * ⚠️ MỖI KHỐI CHỈ CHẠY KHI NGƯỜI XEM CÓ ĐÚNG QUYỀN của khối đó (cờ truyền vào do trang tính bằng `can()`); khối không có quyền
 * KHÔNG phát truy vấn nào và KHÔNG xuất hiện trong kết quả. Đó là ranh giới chống lộ số liệu: ví dụ số lượt quá hạn của cả hệ
 * thống chỉ có khi `progress:view-all`, không phải khi chỉ có quyền soạn.
 *
 * ⚠️ Chỉ `count` — số truy vấn cố định (tối đa 8, song song), không phụ thuộc quy mô dữ liệu. Cách ly cơ sở do `scopedDb`
 * (count bị scope), không tự so `centerId` ở đây.
 */
export type QuyenTongQuan = {
  /** `elearning:exam:grade` */
  cham: boolean;
  /** `elearning:assignment:create` */
  giao: boolean;
  /** `elearning:content:author` */
  soan: boolean;
  /** `elearning:progress:view-all` */
  baoCao: boolean;
};

export type TongQuanDaoTao = {
  cham?: { taoChoCham: number; taoQuaHanCham: number; thiChoCham: number };
  giao?: { luotGiaoDangMo: number };
  soan?: { khoaNhap: number; khoaDaXuatBan: number };
  tienDo?: { luotQuaHan: number; luotDangHoc: number };
};

export async function napTongQuanDaoTao(
  db: ScopedDb,
  q: QuyenTongQuan,
  now: Date,
): Promise<TongQuanDaoTao> {
  const [cham, giao, soan, tienDo] = await Promise.all([
    q.cham
      ? Promise.all([
          db.trnSubmission.count({ where: { status: "SUBMITTED" } }),
          db.trnSubmission.count({ where: { status: "SUBMITTED", dueGradeAt: { lt: now } } }),
          db.trnExamAttempt.count({ where: { status: "PENDING_GRADE" } }),
        ])
      : null,
    q.giao ? db.trnAssignment.count({ where: { status: "ACTIVE" } }) : null,
    q.soan
      ? Promise.all([
          db.trnCourse.count({ where: { deletedAt: null, status: "DRAFT" } }),
          db.trnCourse.count({ where: { deletedAt: null, status: "PUBLISHED" } }),
        ])
      : null,
    q.baoCao
      ? Promise.all([
          db.trnEnrollment.count({ where: { status: "OVERDUE" } }),
          db.trnEnrollment.count({ where: { status: "IN_PROGRESS" } }),
        ])
      : null,
  ]);

  const kq: TongQuanDaoTao = {};
  if (cham) kq.cham = { taoChoCham: cham[0], taoQuaHanCham: cham[1], thiChoCham: cham[2] };
  if (giao !== null) kq.giao = { luotGiaoDangMo: giao };
  if (soan) kq.soan = { khoaNhap: soan[0], khoaDaXuatBan: soan[1] };
  if (tienDo) kq.tienDo = { luotQuaHan: tienDo[0], luotDangHoc: tienDo[1] };
  return kq;
}
