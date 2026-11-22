// lib/portal/yeu-cau-hub.ts — số liệu cho các màn «Gửi yêu cầu đến trung tâm» (12/11/2026).
//
// KHÔNG tính lại lượt bù: dùng ĐÚNG sổ lượt mà trang Chuyên cần đang dùng (`docSoLuot` + `luotBu`), nên hai nơi cho
// cùng một con số (luật 12b). Nhân viên đọc bản có `scopedDb` ở lib/hoc-bu/danh-sach-db.ts — KHÔNG gọi bản đó từ cổng PH.
import { db } from "@/lib/db";
import { docSoLuot } from "@/lib/hoc-bu/so-luot";
import { luotBu, type LuotBu } from "@/lib/portal/chuyen-can-thuan";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";

/** Lượt bù miễn phí còn lại của con (theo khoá của lớp đang học). Không có sổ ⇒ null (không vẽ, không suy ra). */
export async function docLuotBuChoCon(studentId: string): Promise<LuotBu | null> {
  try {
    const ghiDanh = await db.enrollment.findFirst({
      where: { studentId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
      orderBy: { enrolledAt: "desc" },
      select: { class: { select: { courseId: true } } },
    });
    if (!ghiDanh) return null;
    const so = await docSoLuot(db, [{ studentId, courseId: ghiDanh.class.courseId }]);
    const r = so.get(`${studentId}|${ghiDanh.class.courseId}`);
    return r ? luotBu(r.granted, r.held, r.consumed) : null;
  } catch {
    return null;
  }
}

export type CoSoDich = { id: string; ten: string; diaChi: string };

/**
 * Cơ sở con CÓ THỂ xin chuyển tới: cơ sở đang có lớp (không dựng danh sách cứng — mở cơ sở mới là thêm dữ liệu,
 * không sửa mã), trừ cơ sở con đang học. Chỉ trả tên + địa chỉ công khai của cơ sở.
 */
export async function docCoSoCoTheChuyen(coSoHienTai: string | null): Promise<CoSoDich[]> {
  const coLop = await db.class.groupBy({ by: ["centerId"], where: { deletedAt: null } });
  const ids = coLop.map((c) => c.centerId).filter((id): id is string => !!id && id !== coSoHienTai);
  if (ids.length === 0) return [];
  const rows = await db.center.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, address: true },
  });
  return rows.map((c) => ({ id: c.id, ten: c.name, diaChi: c.address }));
}
