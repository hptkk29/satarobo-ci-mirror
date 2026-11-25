import "server-only";
import { db } from "@/lib/db";
import { mucBaiTapBaiThiDangHien } from "@/lib/portal/muc-tam-an";
import { reportCardPeriodDisplay } from "@/lib/lms/report-card";
import { getStudentFeedback } from "@/lib/portal/feedback";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentReportCard, type ReportCardV2 } from "@/lib/portal/report-card-v2";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import { ngayGio, thuNgan } from "@/lib/portal/hanh-trinh-thuan";
import { dungPhieu, laPhieuMoi, phanLoaiBuoi, type BuoiNX } from "@/lib/portal/nhan-xet-thuan";
import { tomTatDiHoc, tenDayDu, type DiHocTomTat } from "@/lib/portal/tong-quan-thuan";

// Cổng phụ huynh — dữ liệu màn "Nhận xét & học bạ" (artifact Nhan-xet.dc.html).
// Chỉ lấy phiếu của LỚP ĐANG HỌC (lỗi 4 của bản ánh xạ: phiếu lớp cũ lẫn vào). Số buổi / có mặt lấy từ
// `getStudentSessionsView` (cùng nguồn trang chủ), học bạ từ `getStudentReportCard` (cùng nguồn /portal/hoc-ba).

export type NhanXetData = {
  tenCon: string;
  tenKhoa: string | null;
  tenLop: string | null;
  buoi: BuoiNX[];
  diHoc: DiHocTomTat;
  coMat: number;
  tong: number;
  daQua: number;
  canBuSo: number[];
  baiVe: { nop: number; tong: number; chuaNop: number };
  /** «Bài tập & bài thi» đang hiện không (tạm ẩn 03/11/2026) — ẩn thì màn không vẽ ô «Bài về nhà đã nộp». */
  coBaiTap: boolean;
  hocBa: ReportCardV2 | null;
};

export async function getNhanXet(studentId: string, now: Date = new Date()): Promise<NhanXetData> {
  const [sched, view, makeup, feedback, hocBa] = await Promise.all([
    getStudentSchedule(studentId, now),
    getStudentSessionsView(studentId, now),
    getStudentMakeup(studentId),
    getStudentFeedback(studentId, 100),
    getStudentReportCard(studentId),
  ]);

  // Con học nhiều lớp: bám lớp có buổi kế tiếp (nếu không có thì lớp đầu) — cùng cách chọn với màn Hành trình.
  const lop = sched?.next?.className ?? view.sessions.find((s) => s.className)?.className ?? null;
  const cua = view.sessions.filter((s) => lop === null || s.className === lop);

  const ids = cua.map((s) => s.id);
  const lesson = ids.length
    ? await db.classSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, lesson: { select: { moduleCode: true } } },
      })
    : [];
  const hocPhanCua = new Map(lesson.map((l) => [l.id, l.lesson?.moduleCode ?? null]));

  const phieuCua = new Map(feedback.map((f) => [f.classSessionId, f]));
  const ngayCanBu = new Set(
    makeup.needList.filter((m) => (m.status === "PENDING" || m.status === "SCHEDULED") && m.missedDate).map((m) => m.missedDate as string),
  );

  const buoi: BuoiNX[] = cua.map((s) => {
    const f = phieuCua.get(s.id) ?? null;
    const kieu = phanLoaiBuoi({ attendance: s.attendance, past: s.past, coPhieu: f !== null });
    const canBu = kieu === "vang" && ngayCanBu.has(s.date);
    const ngay = `${thuNgan(s.date)} ${s.nhanNgay.slice(0, 5)}`;
    return {
      id: s.id,
      n: s.order,
      ngay,
      ten: s.title === "Buổi học" ? "" : s.title,
      hocPhan: hocPhanCua.get(s.id) ?? null,
      kieu,
      moi: f ? laPhieuMoi(f.chamLucISO, now) : false,
      vangGhi:
        kieu === "vang"
          ? `${s.attendance === "EXCUSED" ? "Vắng có phép" : "Vắng không phép"} ngày ${s.nhanNgay.slice(0, 5)}.${canBu ? " Buổi này đang chờ chọn giờ học bù." : ""}`
          : null,
      canBu,
      phieu: f
        ? dungPhieu({
            comment: f.comment,
            notes: f.notes,
            rubric: f.rubric,
            giaoVien: f.teacher,
            chamLuc: ngayGio(f.chamLucISO),
          })
        : null,
      muc: f?.rubric ?? null,
    };
  });

  const bai = cua.flatMap((s) => (s.assignment ? [s.assignment] : []));
  const nop = bai.filter((a) => a.done).length;

  return {
    tenCon: tenDayDu(sched?.studentName),
    tenKhoa: view.courseName,
    tenLop: lop ?? view.className,
    buoi,
    diHoc: tomTatDiHoc({
      daHoc: view.done,
      coMat: view.present,
      vang: view.absent,
      chuaCham: view.chuaCham,
      canBu: makeup.needCount,
    }),
    coMat: view.present,
    tong: view.total,
    daQua: view.done,
    canBuSo: buoi.filter((b) => b.canBu).map((b) => b.n),
    baiVe: { nop, tong: bai.length, chuaNop: bai.length - nop },
    coBaiTap: mucBaiTapBaiThiDangHien(),
    hocBa: hocBa
      ? { ...hocBa, periodComments: hocBa.periodComments.map((p) => ({ period: reportCardPeriodDisplay(p.period), comment: p.comment })) }
      : null,
  };
}
