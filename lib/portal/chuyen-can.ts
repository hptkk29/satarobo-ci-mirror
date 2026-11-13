import "server-only";
import { db } from "@/lib/db";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";
import { docSoLuot } from "@/lib/hoc-bu/so-luot";
import { getStudentFeedback } from "@/lib/portal/feedback";
import { ngayGio, thuNgan } from "@/lib/portal/hanh-trinh-thuan";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentPhotos } from "@/lib/portal/photos";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { tenDayDu } from "@/lib/portal/tong-quan-thuan";
import { gomHocPhan } from "@/lib/portal/nhan-xet-thuan";
import {
  NHAN_KIEU,
  bacCuaPhieu,
  canhBao,
  demSoBuoi,
  diemTheoNhom,
  ketLuan,
  kieuO,
  luotBu,
  phepCong,
  type KetLuan,
  type KieuO,
  type LuotBu,
  type PhepCong,
  type SoBuoi,
  type XepLoai,
} from "@/lib/portal/chuyen-can-thuan";

// Cổng phụ huynh — dữ liệu màn "Chuyên cần & kết quả" (artifact Chuyen-can.dc.html).
// Mọi số buổi đi qua MỘT hàm đếm (`demSoBuoi`) từ danh sách buổi của LỚP ĐANG HỌC; số đăng ký lấy từ `getStudentSessionsView().total`
// (theo gói khi tính theo phạm vi). Lượt bù miễn phí đọc từ SỔ LƯỢT (`docSoLuot`) — không có sổ thì không vẽ thẻ, không suy ra.

export type OBuoi = { id: string; n: number; kieu: KieuO; ten: string; ngay: string; ghi: string };

export type ChuyenCan = {
  tenCon: string;
  tenKhoa: string | null;
  tenLop: string | null;
  capNhat: string | null;
  dangKy: number;
  ketLuan: KetLuan;
  so: SoBuoi;
  phep: PhepCong;
  hang: { ten: string; tom: string; o: OBuoi[] }[];
  chonMacDinh: string | null;
  luot: LuotBu | null;
  xepLoai: XepLoai[];
  canhBao: ReturnType<typeof canhBao>;
  diem: { ten: string; diem: number; chu: string }[];
  baiVe: { nop: number; tong: number; chuaNop: number };
  /** «Bài tập & bài thi» đang hiện không (tạm ẩn 03/11/2026) — ẩn thì màn không vẽ ô «Bài về nhà đã nộp» và lời cảnh báo không nhắc bài chưa nộp. */
  coBaiTap: boolean;
  sanPham: { so: number; tong: number } | null;
  coPhieu: number;
  /** Nhãn của buổi ngoài gói — lấy nguyên từ server (`nhanPhamVi`), null khi không có buổi nào như vậy. */
  nhanNgoai: string | null;
};

export async function getChuyenCan(studentId: string, now: Date = new Date()): Promise<ChuyenCan> {
  const [sched, view, makeup, feedback, anh, lanCuoi, ghiDanh] = await Promise.all([
    getStudentSchedule(studentId, now),
    getStudentSessionsView(studentId, now),
    getStudentMakeup(studentId),
    getStudentFeedback(studentId, 100),
    getStudentPhotos(studentId).catch(() => null),
    db.attendance.aggregate({ where: { studentId }, _max: { createdAt: true } }),
    db.enrollment.findMany({
      where: { studentId, status: { in: [...GHI_DANH_DANG_HOC] }, deletedAt: null },
      select: { class: { select: { classCode: true, name: true, courseId: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Con học nhiều lớp: bám lớp có buổi kế tiếp — cùng cách chọn với Hành trình / Nhận xét.
  const lop = sched?.next?.className ?? view.sessions.find((s) => s.className)?.className ?? null;
  const cua = view.sessions.filter((s) => lop === null || s.className === lop).sort((a, b) => a.order - b.order);
  const tiepTheoId = sched?.next?.id ?? null;

  const ids = cua.map((s) => s.id);
  const lesson = ids.length
    ? await db.classSession.findMany({ where: { id: { in: ids } }, select: { id: true, lesson: { select: { moduleCode: true } } } })
    : [];
  const hocPhanCua = new Map(lesson.map((l) => [l.id, l.lesson?.moduleCode ?? null]));

  // Buổi vắng ↔ đơn bù, nối theo NGÀY của buổi vắng (cùng cách màn Hành trình).
  const donBu = new Map<string, { trangThai: "PENDING" | "SCHEDULED"; buoiBu: string | null }>();
  for (const m of [...makeup.needList, ...makeup.history]) {
    if ((m.status === "PENDING" || m.status === "SCHEDULED") && m.missedDate)
      donBu.set(m.missedDate, { trangThai: m.status, buoiBu: m.buoiBu ? `${m.buoiBu.nhanNgay}${m.buoiBu.className ? ` · ${m.buoiBu.className}` : ""}` : null });
  }

  const phieuTheoBuoi = new Map(feedback.map((f) => [f.classSessionId, f]));
  const cells: (OBuoi & { hocPhan: string | null })[] = cua.map((s) => {
    const bu = donBu.get(s.date) ?? null;
    const kieu = kieuO({
      attendance: s.attendance,
      past: s.past,
      laKeTiep: s.id === tiepTheoId,
      ngoaiPhamVi: s.ngoaiPhamVi === true,
      bu: bu?.trangThai ?? null,
    });
    const ngay = `${thuNgan(s.date)} ${s.nhanNgay.slice(0, 5)}`;
    const ghi =
      kieu === "co"
        ? phieuTheoBuoi.has(s.id)
          ? "Có mặt, đã có nhận xét của giáo viên."
          : "Có mặt."
        : kieu === "bu"
          ? "Đã học bù."
          : kieu === "xep"
            ? `Đã xếp lịch học bù${bu?.buoiBu ? `: ${bu.buoiBu}` : ""}.`
            : kieu === "cho"
              ? `${s.attendance === "EXCUSED" ? "Vắng có phép" : "Vắng không phép"} — đang chờ chọn giờ học bù.`
              : kieu === "vang"
                ? `${s.attendance === "EXCUSED" ? "Vắng có phép" : "Vắng không phép"}, chưa có đơn học bù.`
                : kieu === "chua-cham"
                  ? "Buổi đã diễn ra nhưng giáo viên chưa chấm điểm danh."
                  : kieu === "ke"
                    ? "Buổi học kế tiếp của lớp."
                    : kieu === "ngoai"
                      ? (s.nhanPhamVi ?? "Buổi này không tính vào gói con đã đăng ký.")
                      : kieu === "huy"
                        ? "Trung tâm huỷ buổi này."
                        : "Chưa diễn ra.";
    return { id: s.id, n: s.order, kieu, ten: s.title === "Buổi học" ? "" : s.title, ngay, ghi, hocPhan: hocPhanCua.get(s.id) ?? null };
  });

  const nhom = gomHocPhan(
    cells.map((c) => ({ id: c.id, hocPhan: c.hocPhan, kieu: "phieu" as const })),
    () => true,
  );
  const hang = nhom.map((g) => {
    const o = g.ids.map((id) => cells.find((c) => c.id === id)).filter((c): c is OBuoi & { hocPhan: string | null } => !!c);
    const da = o.filter((c) => c.kieu === "co" || c.kieu === "bu").length;
    return {
      ten: g.ten === "Tất cả" ? "Cả khoá" : g.ten.replace(/^HP(\d+)$/, "Học phần $1"),
      tom: da > 0 ? `đã học ${da}/${o.length}` : "chưa bắt đầu",
      o: o.map(({ hocPhan: _hp, ...rest }) => rest),
    };
  });

  const so = demSoBuoi(cells.map((c) => c.kieu));
  const dangKy = view.total;

  // Chất lượng: chỉ phiếu của lớp đang học.
  const phieu = cua.map((s) => ({ s, f: phieuTheoBuoi.get(s.id) ?? null })).filter((x) => x.f);
  const xepLoai: XepLoai[] = phieu.flatMap(({ s, f }) => {
    const bac = bacCuaPhieu(f?.rubric ?? null);
    return bac ? [{ n: s.order, bac }] : [];
  });
  const bai = cua.flatMap((s) => (s.assignment ? [s.assignment] : []));
  const nop = bai.filter((a) => a.done).length;
  const baiVe = { nop, tong: bai.length, chuaNop: bai.length - nop };
  const coBaiTap = mucBaiTapBaiThiDangHien();

  // Lượt bù miễn phí — sổ lượt của (học viên, khoá) của lớp đang học.
  const lopGhiDanh = ghiDanh.find((e) => e.class.classCode === lop || e.class.name === lop) ?? ghiDanh[0] ?? null;
  let luot: LuotBu | null = null;
  if (lopGhiDanh) {
    const so_ = await docSoLuot(db, [{ studentId, courseId: lopGhiDanh.class.courseId }]);
    const r = so_.get(`${studentId}|${lopGhiDanh.class.courseId}`);
    if (r) luot = luotBu(r.granted, r.held, r.consumed);
  }

  return {
    tenCon: tenDayDu(sched?.studentName),
    tenKhoa: view.courseName,
    tenLop: lop ?? view.className,
    capNhat: lanCuoi._max.createdAt ? ngayGio(lanCuoi._max.createdAt.toISOString()) : null,
    dangKy,
    ketLuan: ketLuan({ ten: tenDayDu(sched?.studentName), s: so, soBuoiChoBu: cells.filter((c) => c.kieu === "cho").map((c) => c.n) }),
    so,
    phep: phepCong(so, dangKy),
    hang,
    chonMacDinh:
      cells.find((c) => c.kieu === "cho")?.id ?? cells.find((c) => c.kieu === "ke")?.id ?? [...cells].reverse().find((c) => c.kieu === "co")?.id ?? cells[0]?.id ?? null,
    luot,
    xepLoai: xepLoai.slice(-7),
    canhBao: canhBao(xepLoai, coBaiTap ? baiVe.chuaNop : 0),
    diem: diemTheoNhom(phieu.map(({ f }) => f?.rubric ?? null)),
    baiVe,
    coBaiTap,
    sanPham: anh && anh.consentGranted ? { so: anh.groups.length, tong: so.conDaHoc } : null,
    coPhieu: phieu.length,
    nhanNgoai: cua.find((s) => s.ngoaiPhamVi === true && s.nhanPhamVi)?.nhanPhamVi ?? null,
  };
}

export { NHAN_KIEU };
