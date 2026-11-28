import { portalDb } from "@/lib/portal/db";
import { lienHeChoHocSinh, type LienHeHocSinhDto } from "../lien-he";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * `GET /students/:id/contact` — liên hệ trung tâm của CƠ SỞ CỦA CHÍNH EM, mở cho Student Mode (màn «Hướng dẫn sử dụng» của học sinh). Chỉ ba trường chữ (xem `LienHeHocSinhDto`).
 * Cơ sở đọc qua `portalDb` (chỉ trả học viên của chính phụ huynh) — cùng đường với `layTongQuan`; em khác (anh/chị/em, nhà khác) bị cổng sở hữu chặn TRƯỚC khi tới đây.
 */
export async function layLienHeHocSinh(hs: MaHocVienDaKiem, parentUserId: string): Promise<LienHeHocSinhDto> {
  const hv = await portalDb({ parentUserId, childIds: [hs] }).student.findUnique({ where: { id: hs }, select: { center: { select: { code: true } } } });
  return lienHeChoHocSinh(hv?.center?.code ?? null);
}
