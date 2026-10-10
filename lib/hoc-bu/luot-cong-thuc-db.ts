// lib/hoc-bu/luot-cong-thuc-db.ts — "công thức cho bé này bao nhiêu lượt bù" ĐỌC TỪ DB, ở MỘT chỗ (T06, 07/10/2026).
//
// Trước T06 phép này sống bên trong `boSungDong` (màn danh sách). Sổ lượt (`so-luot.ts`) cần ĐÚNG con số đó để cấp lượt lúc khởi
// tạo tài khoản; viết lại một bản thứ hai là "hai bản đếm cho cùng một bé" — đúng điều `luot-bu.ts` dặn đừng làm. Nên tách ra, và
// cả màn danh sách lẫn sổ lượt cùng gọi.
//
// Đây CHỈ là công thức (cấp bao nhiêu). Đã dùng / đang giữ bao nhiêu là việc của SỔ, không phải của hàm này.
import type { Prisma } from "@prisma/client";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import { locDonNhanTien } from "@/lib/payments/don-nhan-tien";
import { tongLuotBu } from "@/lib/hoc-bu/luot-bu";
import {
  hocPhanCuaKhoa,
  soBuoiMuaCuaBe,
  viTriHocPhanBatDau,
  type DongDonCuaBe,
} from "@/lib/hoc-bu/dong-can-bu";

/** Các bảng công thức cần đọc. `scopedDb` hay `db` trần đều đưa vào được (nơi gọi tự chọn phạm vi nhìn). */
export type NguonCongThuc = Pick<
  Prisma.TransactionClient,
  "lesson" | "courseModuleMakeupQuota" | "enrollment" | "attendance"
>;
export type NguonDon = Pick<Prisma.TransactionClient, "orderItem">;

export type CapTinhLuot = {
  studentId: string;
  classId: string;
  leadChildId: string | null;
  course: { id: string; totalSessions: number | null; choPhepHocBu: boolean };
};

/** Khoá của kết quả: một (học viên, lớp). */
export const khoaCap = (studentId: string, classId: string): string => `${studentId}|${classId}`;

/**
 * Tổng lượt CÔNG THỨC cho từng cặp (học viên, lớp). Công thức giữ nguyên chốt 29/09/2026 (xem `luot-bu.ts`); khác trước T06 đúng
 * một điểm — HB-18: bé chỉ còn dòng đơn của khoá này ở đơn ĐÃ HUỶ / HOÀN / XOÁ thì được 0 buổi mua, không rơi về cả khoá.
 */
export async function tongLuotCongThuc(
  nguon: NguonCongThuc,
  nguonDon: NguonDon,
  caps: readonly CapTinhLuot[],
): Promise<Map<string, number>> {
  const ra = new Map<string, number>();
  if (caps.length === 0) return ra;

  const courseIds = [...new Set(caps.map((c) => c.course.id))];
  const studentIds = [...new Set(caps.map((c) => c.studentId))];
  const classIds = [...new Set(caps.map((c) => c.classId))];
  const leadChildIds = [...new Set(caps.map((c) => c.leadChildId).filter((x): x is string => !!x))];

  const [bai, cauHinh, ghiDanh, diemDanh] = await Promise.all([
    nguon.lesson.findMany({
      where: { archivedAt: null, curriculum: { courseId: { in: courseIds }, isActive: true } },
      select: { moduleCode: true, order: true, curriculum: { select: { courseId: true } } },
    }),
    nguon.courseModuleMakeupQuota.findMany({
      where: { courseId: { in: courseIds } },
      select: { courseId: true, moduleCode: true, luotBu: true },
    }),
    nguon.enrollment.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, deletedAt: null },
      select: { id: true, studentId: true, classId: true },
    }),
    nguon.attendance.findMany({
      where: { studentId: { in: studentIds }, session: { classId: { in: classIds } } },
      select: {
        studentId: true,
        session: { select: { classId: true, date: true, lesson: { select: { moduleCode: true } } } },
      },
    }),
  ]);

  const enrollmentIds = ghiDanh.map((e) => e.id);
  const cuaBe: Prisma.OrderItemWhereInput = {
    type: "COURSE_ENROLLMENT",
    OR: [
      { studentId: { in: studentIds } },
      { enrollmentId: { in: enrollmentIds } },
      ...leadChildIds.map((id) => ({ metadata: { path: ["leadChildId"], equals: id } })),
    ],
  };
  const [dongDon, dongBiLoai] = await Promise.all([
    nguonDon.orderItem.findMany({
      where: { ...cuaBe, order: locDonNhanTien() },
      select: { studentId: true, enrollmentId: true, metadata: true },
    }),
    // HB-18: dòng của đơn ĐÃ BỊ LOẠI (huỷ/hoàn/xoá mềm). `DRAFT` cố ý KHÔNG vào đây — đơn nháp chưa phải đơn bị huỷ.
    nguonDon.orderItem.findMany({
      where: {
        ...cuaBe,
        order: { OR: [{ status: { in: ["CANCELLED", "REFUNDED"] } }, { deletedAt: { not: null } }] },
      },
      select: { studentId: true, enrollmentId: true, metadata: true },
    }),
  ]);

  const baiTheoKhoa = new Map<string, { moduleCode: string | null; order: number }[]>();
  for (const b of bai) {
    const k = b.curriculum.courseId;
    (baiTheoKhoa.get(k) ?? baiTheoKhoa.set(k, []).get(k)!).push(b);
  }
  const cauHinhTheoKhoa = new Map<string, Map<string, number>>();
  for (const c of cauHinh) {
    (cauHinhTheoKhoa.get(c.courseId) ?? cauHinhTheoKhoa.set(c.courseId, new Map()).get(c.courseId)!).set(
      c.moduleCode,
      c.luotBu,
    );
  }
  const ghiDanhTheoCap = new Map(ghiDanh.map((e) => [khoaCap(e.studentId, e.classId), e.id]));
  const buoiDau = new Map<string, { t: number; ma: string | null }>();
  for (const a of diemDanh) {
    const k = khoaCap(a.studentId, a.session.classId);
    const t = a.session.date.getTime();
    const cu = buoiDau.get(k);
    if (!cu || t < cu.t) buoiDau.set(k, { t, ma: a.session.lesson?.moduleCode ?? null });
  }

  const dongCuaCap = (
    nguonDong: readonly { studentId: string | null; enrollmentId: string | null; metadata: unknown }[],
    c: CapTinhLuot,
  ): DongDonCuaBe[] => {
    const enrollmentId = ghiDanhTheoCap.get(khoaCap(c.studentId, c.classId));
    return nguonDong
      .filter(
        (d) =>
          d.studentId === c.studentId ||
          (enrollmentId !== undefined && d.enrollmentId === enrollmentId) ||
          (!!c.leadChildId && docConLeadTuMetadata(d.metadata) === c.leadChildId),
      )
      .map((d) => {
        const h = docHinhThucLop(d.metadata);
        return { courseId: h.courseId, soBuoi: h.soBuoi };
      });
  };

  for (const c of caps) {
    const hocPhan = hocPhanCuaKhoa(baiTheoKhoa.get(c.course.id) ?? [], cauHinhTheoKhoa.get(c.course.id) ?? new Map());
    const soBai = hocPhan.reduce((s, h) => s + h.soBuoi, 0);
    const dongSong = dongCuaCap(dongDon, c);
    const coDongSongCuaKhoa = dongSong.some((d) => d.courseId === c.course.id);
    const coDongBiLoaiCuaKhoa = dongCuaCap(dongBiLoai, c).some((d) => d.courseId === c.course.id);
    ra.set(
      khoaCap(c.studentId, c.classId),
      tongLuotBu({
        hocPhan,
        viTriBatDau: viTriHocPhanBatDau(hocPhan, buoiDau.get(khoaCap(c.studentId, c.classId))?.ma),
        soBuoiMua: soBuoiMuaCuaBe(
          dongSong,
          c.course.id,
          c.course.totalSessions ?? soBai,
          !coDongSongCuaKhoa && coDongBiLoaiCuaKhoa,
        ),
        choPhepHocBu: c.course.choPhepHocBu,
      }),
    );
  }
  return ra;
}
