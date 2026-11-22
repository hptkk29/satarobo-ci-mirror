import "server-only";
import { db } from "@/lib/db";
import { dieuKienHoSoMoChoGhiDanh } from "@/lib/bao-luu/ngu-canh-db";
import { NHAN_LOAI, NHAN_TRANG_THAI } from "@/lib/bao-luu/nhan";
import { TRANG_THAI_DANG_HOC_TAM_DUNG_LOP } from "@/lib/bao-luu/tam-dung-lop";

// lib/bao-luu/tam-dung-lop-xem-truoc.ts — XEM TRƯỚC "tạm dừng cả lớp" (H2, nghiệm thu bảo lưu vòng 2). CHỈ ĐỌC.
//
// Chủ dự án chốt 11/10: giữ BỎ QUA + LIỆT KÊ em đã có hồ sơ mở (không chặn cả lớp) — NHƯNG danh sách em sẽ bị bỏ qua phải hiện TRƯỚC khi bấm, kèm loại và trạng thái
// hồ sơ đang mở. Trước bản này người bấm chỉ biết SAU khi đã tạm dừng (toast "Bỏ qua N học viên…"), trong khi chính màn lại viết "một em lỗi thì cả lớp không được
// tạm dừng" — đọc thành "em nào vướng cũng chặn cả lớp".
//
// ⚠️ Điều kiện "hồ sơ mở" lấy từ `dieuKienHoSoMoChoGhiDanh` — CÙNG nguồn với cổng thật trong `tamDungLop`; test `[H2-DB-03]` đo hai bên cho ra CÙNG tập em bị bỏ qua.
// ⚠️ Gọi bằng `db` trần: người gọi (server action) ĐÃ chứng minh lớp nằm trong tầm nhìn qua `scopedDb` trước khi gọi — như `tamDungLop` (cổng an toàn không được bị lọc).

export type EmBiBoQua = { studentId: string; ten: string; loai: string; trangThai: string };
export type XemTruocTamDungLop = {
  tongDangHoc: number;
  soSeTamDung: number;
  boQua: EmBiBoQua[];
};

export async function xemTruocTamDungLop(classId: string, now: Date): Promise<XemTruocTamDungLop | null> {
  const lop = await db.class.findFirst({ where: { id: classId, deletedAt: null }, select: { id: true } });
  if (!lop) return null;

  const gd = await db.enrollment.findMany({
    where: { classId: lop.id, deletedAt: null, status: { in: [...TRANG_THAI_DANG_HOC_TAM_DUNG_LOP] }, student: { deletedAt: null } },
    select: { id: true, studentId: true, student: { select: { name: true } } },
    orderBy: { student: { name: "asc" } },
  });
  if (gd.length === 0) return { tongDangHoc: 0, soSeTamDung: 0, boQua: [] };

  const ho = await db.studentReserve.findMany({
    where: { OR: gd.flatMap((g) => dieuKienHoSoMoChoGhiDanh({ enrollmentId: g.id, studentId: g.studentId, now })) },
    select: { id: true, type: true, status: true, studentId: true, enrollmentId: true },
    orderBy: { requestedAt: "asc" },
  });

  const boQua: EmBiBoQua[] = [];
  for (const g of gd) {
    const r = ho.find((x) => x.enrollmentId === g.id || (x.enrollmentId === null && x.studentId === g.studentId));
    if (r) boQua.push({ studentId: g.studentId, ten: g.student.name, loai: NHAN_LOAI[r.type], trangThai: NHAN_TRANG_THAI[r.status] });
  }
  return { tongDangHoc: gd.length, soSeTamDung: gd.length - boQua.length, boQua };
}
