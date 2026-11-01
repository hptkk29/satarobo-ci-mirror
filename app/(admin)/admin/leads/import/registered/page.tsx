import { loadNguonChoFormNhap } from "@/lib/nguon/nguon-cho-form-nhap";
import { ManNhapDaDangKy } from "./_components/man-nhap-da-dang-ky";

// Đọc cờ nguồn + danh mục nguồn lúc yêu cầu: không có dòng này, một lần ai đó bỏ `auth()` khỏi layout là trang bị dựng TĨNH lúc build và cờ `nguon.enabled` bị đóng băng (cùng cách `nhap-khach-hang/page.tsx`).
export const dynamic = "force-dynamic";

/**
 * Vỏ SERVER của màn «Import danh sách ĐÃ ĐĂNG KÝ» — chỉ tồn tại để đọc danh mục nguồn rồi truyền xuống thân client (`_components/man-nhap-da-dang-ky.tsx`,
 * trước 28/10/2026 là chính tệp này).
 *
 * «Nguồn của cả file» (chủ dự án chốt 28/10/2026): `nguon` = danh mục nguồn chọn được khi module Nguồn BẬT, `null` khi TẮT ⇒ màn không vẽ ô chọn và đường nhập chạy như cũ.
 * Đây là cổng BÀY RA; cổng chặn thật nằm ở `POST /api/admin/import/leads/registered` (`docVaEpNguonCaFile`).
 */
export default async function ImportRegisteredLeadsPage() {
  return <ManNhapDaDangKy nguon={await loadNguonChoFormNhap([], new Date())} />;
}
