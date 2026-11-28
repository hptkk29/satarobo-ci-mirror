import type { ScopedDb } from "@/lib/actions/factory";
import { dieuKienPhieuXem } from "@/lib/elearning/training-need";

/**
 * ĐỀ NGHỊ ĐÀO TẠO của CHÍNH TÔI — danh sách + chi tiết một phiếu.
 *
 * ⚠️ CHÍNH CHỦ qua `dieuKienPhieuXem({ quanLy: false })`: cùng hàm với màn quản trị nên "ai thấy phiếu nào" không có bản thứ hai.
 * Người QUẢN LÝ chương trình vào màn này cũng chỉ thấy phiếu CỦA MÌNH (màn này là của người đề nghị; việc duyệt ở /chuong-trinh).
 * Phiếu của người khác ⇒ `null`, cùng kết quả với mã không tồn tại.
 */

export type PhieuTrongDanhSach = {
  id: string;
  code: string;
  title: string;
  proposedQuarter: string;
  status: string;
  createdAt: Date;
};

const TRAN = 100;

export async function napPhieuCuaToi(db: ScopedDb, userId: string): Promise<PhieuTrongDanhSach[]> {
  return db.trnTrainingNeed.findMany({
    where: dieuKienPhieuXem({ quanLy: false, userId }),
    orderBy: { createdAt: "desc" },
    take: TRAN,
    select: { id: true, code: true, title: true, proposedQuarter: true, status: true, createdAt: true },
  });
}

export type PhieuChiTiet = PhieuTrongDanhSach & {
  targetGroupText: string;
  reason: string;
  expectedOutcome: string;
  approvedAt: Date | null;
  nguoiDuyet: string | null;
  tenChuongTrinh: string[];
};

export async function napPhieuChiTiet(
  db: ScopedDb,
  input: { code: string; userId: string },
): Promise<PhieuChiTiet | null> {
  const p = await db.trnTrainingNeed.findFirst({
    where: { ...dieuKienPhieuXem({ quanLy: false, userId: input.userId }), code: input.code },
    select: {
      id: true,
      code: true,
      title: true,
      proposedQuarter: true,
      status: true,
      createdAt: true,
      targetGroupText: true,
      reason: true,
      expectedOutcome: true,
      approvedAt: true,
      approvedByUserId: true,
      programs: { where: { deletedAt: null }, select: { title: true } },
    },
  });
  if (!p) return null;
  const nguoi = p.approvedByUserId
    ? await db.user.findFirst({ where: { id: p.approvedByUserId }, select: { name: true } })
    : null;
  const { approvedByUserId: _bo, programs, ...con } = p;
  void _bo;
  return { ...con, nguoiDuyet: nguoi?.name ?? null, tenChuongTrinh: programs.map((x) => x.title) };
}
