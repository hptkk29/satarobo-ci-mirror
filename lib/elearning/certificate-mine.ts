import type { ScopedDb } from "@/lib/actions/factory";
import { trangThaiHienThi, type TrangThaiHienThi } from "@/lib/elearning/certificate";

/**
 * CHỨNG NHẬN CỦA CHÍNH TÔI — nguồn cho ô KPI "Chứng nhận" ở trang chủ và cho màn `/elearning/chung-nhan-cua-toi`.
 *
 * Hai truy vấn bất kể số chứng nhận (chứng nhận + tên khoá). Khoá theo `userId` tường minh: `scopedDb` chặn chéo
 * cơ sở nhưng KHÔNG chặn đồng nghiệp cùng cơ sở đọc chứng nhận của nhau — đó là lý do phép so `userId` nằm trong `where`,
 * giống đường tải PDF (`app/api/elearning/chung-nhan/route.ts`).
 *
 * Trạng thái hiển thị suy từ `validUntil` (cột `status` là bộ nhớ đệm do cron cập nhật mỗi ngày — tin nó là vẽ
 * "còn hiệu lực" cho chứng nhận đã hết hạn từ sáng nay), trừ `REVOKED` là quyết định của con người nên đọc từ cột.
 */
export type ChungNhanCuaToi = {
  id: string;
  certCode: string;
  tenKhoa: string;
  issuedAt: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  trangThai: TrangThaiHienThi;
};

/** Trần số dòng nạp. Một nhân viên không có hàng trăm chứng nhận; chặn để truy vấn không vô hạn. */
const TRAN = 200;

export async function napChungNhanCuaToi(
  db: ScopedDb,
  userId: string,
  now: Date,
): Promise<ChungNhanCuaToi[]> {
  const ds = await db.trnCertificate.findMany({
    where: { userId },
    select: {
      id: true,
      certCode: true,
      courseId: true,
      issuedAt: true,
      validUntil: true,
      revokedAt: true,
      status: true,
    },
    orderBy: { issuedAt: "desc" },
    take: TRAN,
  });
  if (ds.length === 0) return [];

  const khoa = await db.trnCourse.findMany({
    where: { id: { in: [...new Set(ds.map((c) => c.courseId))] } },
    select: { id: true, title: true },
  });
  const ten = new Map(khoa.map((k) => [k.id, k.title]));

  return ds.map((c) => ({
    id: c.id,
    certCode: c.certCode,
    tenKhoa: ten.get(c.courseId) ?? "(khoá đã xoá)",
    issuedAt: c.issuedAt,
    validUntil: c.validUntil,
    revokedAt: c.revokedAt,
    trangThai: trangThaiHienThi({ status: c.status, validUntil: c.validUntil }, now),
  }));
}

/** Số chứng nhận CÒN HIỆU LỰC (không thu hồi, chưa hết hạn). */
export function demConHieuLuc(ds: readonly Pick<ChungNhanCuaToi, "trangThai">[]): number {
  return ds.filter((c) => c.trangThai === "VALID").length;
}
