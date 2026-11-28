import { z } from "zod";

import { isThuNhapThemEnabled } from "@/lib/flags";
import { docThuNhapThem, NHAN_TRANG_THAI_LEAD_PH } from "@/lib/nguon/thu-nhap-them";

import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * OD-10 (phần ĐỌC) — «Thu nhập thêm» của phụ huynh trên app: số khách mang về, số chốt, tỉ lệ chốt và danh sách khách (SĐT CHE). Dùng lại ĐÚNG loader của cổng phụ huynh web (`docThuNhapThem`) —
 * không có luật thứ hai: quyền = chính phụ huynh đăng nhập (đối tác của tài khoản này), SĐT đầy đủ không bao giờ ra khỏi máy chủ, không trả id lead / id lượt giới thiệu.
 * Cờ `THU_NHAP_THEM_ENABLED` TẮT (mặc định) ⇒ 404 như web. KHÔNG có số tiền hoa hồng, thuế hay ngưỡng nào ở đây: chữ thuế/ngưỡng của thiết kế chưa được xác minh (OD-10 / C-10) nên không thành công thức.
 * Phần GHI (tạo link/QR, chiến dịch, đối soát → duyệt → chi) chưa làm: cần quyết định riêng về chính sách hoa hồng đã chụp.
 */
export const thuNhapQuery = z.object({
  q: z.string().trim().max(60).optional(),
  tt: z.string().max(30).optional(),
});
export type ThuNhapQuery = z.infer<typeof thuNhapQuery>;

export type ThuNhapDto = {
  tongKhach: number;
  daChot: number;
  tyLeChot: number | null;
  biCat: boolean;
  khach: Array<{ khoa: string; tenPhuHuynh: string; tenCon: string | null; soDienThoaiChe: string; nhanTrangThai: string; ngayNhan: string }>;
};

export async function layThuNhap(parentUserId: string, q: ThuNhapQuery): Promise<ThuNhapDto> {
  if (!isThuNhapThemEnabled()) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  // Bộ lọc trạng thái chỉ nhận mã có thật (mã lạ ⇒ bỏ lọc, không ném lỗi — giống trang web).
  const tt = q.tt && q.tt in NHAN_TRANG_THAI_LEAD_PH ? (q.tt as keyof typeof NHAN_TRANG_THAI_LEAD_PH) : null;
  const d = await docThuNhapThem({ userId: parentUserId, q: q.q ?? "", trangThai: tt });
  if (!d) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  return {
    tongKhach: d.tongLead,
    daChot: d.daChot,
    tyLeChot: d.tyLeChot,
    biCat: d.biCat,
    // Chỉ các trường hiển thị — `trangThai` thô (mã nội bộ) KHÔNG đi ra, chỉ nhãn tiếng Việt.
    khach: d.khach.map((k) => ({ khoa: k.khoa, tenPhuHuynh: k.tenPhuHuynh, tenCon: k.tenCon, soDienThoaiChe: k.soDienThoaiChe, nhanTrangThai: k.nhanTrangThai, ngayNhan: k.ngayNhan })),
  };
}
