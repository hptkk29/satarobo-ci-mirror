import { db } from "@/lib/db";
import { canChanQuyDinh } from "@/lib/legal/quy-dinh-dao-tao";

import { LoiApiMobile } from "./xac-thuc/dich-vu";

/**
 * KIỂM SỞ HỮU phụ huynh ↔ học viên — nơi DUY NHẤT tạo `MaHocVienDaKiem` (docs/mobile/11_BACKEND_MOBILE_API_DESIGN.md mục 4).
 *
 * Quy tắc: client KHÔNG BAO GIỜ được tin `studentId`. Mọi endpoint theo học viên gọi `kiemHocVienCuaPhuHuynh(parentUserId, studentId)`; hàm chỉ nhận
 * `parentUserId` lấy từ PHIÊN đã xác thực. Học viên không thuộc người gọi, đã xoá mềm hoặc không tồn tại ⇒ cùng một `404 NOT_FOUND` (không phân biệt
 * "không phải của bạn" với "không có", để không dò được mã học viên của gia đình khác). Dịch vụ phía dưới (`lib/mobile-api/dich-vu`) chỉ nhận kiểu
 * `MaHocVienDaKiem` — không nhận chuỗi trần, nên "quên kiểm" là lỗi biên dịch.
 *
 * Lưu ý: nhiều hàm đọc của web (`lib/portal/*`) tra thẳng theo `studentId` và KHÔNG lọc phụ huynh (điểm D8 của thiết kế) — chúng chỉ an toàn khi đứng sau cổng này.
 */
declare const daKiem: unique symbol;
export type MaHocVienDaKiem = string & { readonly [daKiem]: true };

export async function kiemHocVienCuaPhuHuynh(parentUserId: string, studentId: unknown): Promise<MaHocVienDaKiem> {
  if (typeof studentId !== "string" || studentId.length === 0 || studentId.length > 64) throw khongThay();
  const hs = await db.student.findFirst({
    where: { id: studentId, parentUserId, deletedAt: null },
    select: { id: true },
  });
  if (!hs) throw khongThay();
  return hs.id as MaHocVienDaKiem;
}

/** Cổng quy định: có con đã đăng ký mà chưa đồng ý bản hiện hành ⇒ `403 POLICY_REQUIRED` (mọi endpoint dữ liệu, trừ `/auth/me` và nhóm quy định). */
export async function chanNeuCanQuyDinh(parentUserId: string): Promise<void> {
  if (await canChanQuyDinh(parentUserId)) {
    throw new LoiApiMobile("POLICY_REQUIRED", 403, "Bạn cần đồng ý Quy định đào tạo trước khi tiếp tục.");
  }
}

function khongThay(): LoiApiMobile {
  return new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
}
