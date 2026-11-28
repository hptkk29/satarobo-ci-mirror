import { db } from "@/lib/db";

import type { MaHocVienDaKiem } from "../so-huu";
import type { NguoiGoi } from "../xac-thuc/dich-vu";
import { khuOnlineChoHocVien, type KhuOnlineDto } from "./online-hoc";

/**
 * V8 — `GET /students/:id/learning/areas`: học viên đang có KHU HỌC TẬP nào (để app chọn màn vào «Học tập»). CHỈ ĐỌC, hai miền TÁCH BẠCH (không gộp tiến độ/điểm).
 *   · `offline.coLop`: có ghi danh còn hiệu lực tại lớp ở trung tâm (ACTIVE/PENDING/CONFIRMED/STUDYING/PAUSED, chưa xoá mềm).
 *   · `online.trangThai`: LUÔN `CHUA_MO` cho tới khi engine entitlement + danh mục khoá Online (Agent E-learning) tồn tại. Cố ý KHÔNG suy từ bảng nào khác — không có thực thể Online để suy.
 * Không trả tên lớp/khoá (không cần để chọn màn); app không được suy «có khoá online» từ trường vắng mặt.
 */
const TRANG_THAI_CON_HIEU_LUC = ["ACTIVE", "PENDING", "CONFIRMED", "STUDYING", "PAUSED"] as const;

export type KhuHocTapDto = {
  offline: { coLop: boolean; soLop: number };
  /** V8.9: cờ Online TẮT ⇒ `CHUA_MO`. Bật ⇒ suy từ danh sách khoá của LÕI E-learning (không engine thứ hai). */
  online: KhuOnlineDto;
};

export async function layKhuHocTap(hs: MaHocVienDaKiem, nguoi: NguoiGoi): Promise<KhuHocTapDto> {
  const soLop = await db.enrollment.count({ where: { studentId: hs, deletedAt: null, status: { in: [...TRANG_THAI_CON_HIEU_LUC] } } });
  return { offline: { coLop: soLop > 0, soLop }, online: await khuOnlineChoHocVien(hs, nguoi) };
}
