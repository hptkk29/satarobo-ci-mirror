import { db } from "@/lib/db";
import { cauTrangThai, trangThaiHienThi, type TrangThaiHienThi } from "@/lib/elearning/certificate";

/**
 * EL-16 — ĐỌC chứng nhận cho TRANG CÔNG KHAI.
 *
 * ⚠️ Tệp này cố ý KHÔNG đi qua `scopedDb`, và đó không phải sơ suất: người tra cứu
 * không có tài khoản, nên không có actor để scope. Cách ly cơ sở ở đây được thay
 * bằng hai thứ khác, và cả hai phải giữ nguyên:
 *
 *  1. Khoá tra là `verifyToken` — chuỗi ngẫu nhiên 32 ký tự, không đoán, không liệt
 *     kê được. Đổi sang `id` là mở một trang tra hồ sơ nhân sự cho cả internet.
 *  2. Trả về ĐÚNG 5 TRƯỜNG. Không phòng ban, không điểm số, không lịch sử học,
 *     không danh sách khoá khác của người đó.
 *
 * Thêm một trường "cho tiện" ở đây là nới quyền cho toàn bộ internet, không phải cho
 * một vai nào cả. Nếu cần thêm, hỏi trước: người quét QR có QUYỀN biết thứ đó không.
 */

export type KetQuaXacThuc = {
  hoTen: string;
  maNhanVien: string;
  tenKhoa: string;
  ngayCap: Date;
  trangThai: TrangThaiHienThi;
  /** Câu tiếng Việt mô tả trạng thái — dựng ở server để mọi nơi nói giống nhau. */
  cauTrangThai: string;
  maChungNhan: string;
};

export async function traChungNhan(
  verifyToken: string,
  now: Date = new Date(),
): Promise<KetQuaXacThuc | null> {
  // Token quá ngắn/dài thì không cần chạm DB. Đây cũng là chặn dò: mỗi lượt tra hụt
  // rẻ đi một truy vấn.
  if (!/^[A-Za-z0-9_-]{32}$/.test(verifyToken)) return null;

  const cn = await db.trnCertificate.findUnique({
    where: { verifyToken },
    select: {
      certCode: true,
      snapFullName: true,
      snapEmployeeCode: true,
      issuedAt: true,
      validUntil: true,
      revokedAt: true,
      status: true,
      courseId: true,
    },
  });
  if (!cn) return null;

  // Tên khoá đọc SỐNG, khác với tên người.
  //
  // ⚠️ Có chủ đích, và ngược chiều với `snapFullName`: khoá đổi tên là cùng một nội
  // dung được gọi tên khác, nên hiện tên mới là đúng — người tra cứu tìm thấy khoá
  // ấy trong danh mục hôm nay. Còn tên NGƯỜI đổi là một sự kiện của đời họ, và bản
  // PDF đã in tên cũ; hiện tên mới sẽ khiến tờ giấy trong tay và trang web nói hai
  // cái tên khác nhau.
  const khoa = await db.trnCourse.findUnique({
    where: { id: cn.courseId },
    select: { title: true },
  });

  const tt = trangThaiHienThi(cn, now);

  return {
    hoTen: cn.snapFullName,
    maNhanVien: cn.snapEmployeeCode,
    tenKhoa: khoa?.title ?? "(khoá đã bị gỡ khỏi danh mục)",
    ngayCap: cn.issuedAt,
    trangThai: tt,
    cauTrangThai: cauTrangThai(tt, cn),
    maChungNhan: cn.certCode,
  };
}
