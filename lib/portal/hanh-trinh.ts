import "server-only";
import { db } from "@/lib/db";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import {
  dungDongBai,
  dungLuoiThang,
  gomTheoHocPhan,
  laBuoiMoc,
  thuNgan,
  type BuoiHanhTrinh,
  type HocPhanHanhTrinh,
  type OLich,
} from "@/lib/portal/hanh-trinh-thuan";
import { demNgayLich, tomTatDiHoc } from "@/lib/portal/tong-quan-thuan";

// Cổng phụ huynh — dữ liệu màn "Hành trình" (artifact Hanh-trinh.dc.html).
// Không đếm lại: số buổi / có mặt lấy từ `getStudentSessionsView` (cùng nguồn trang chủ và
// học bạ), buổi cần bù lấy từ `getStudentMakeup`.

export type HanhTrinh = {
  tenKhoa: string | null;
  tenLop: string | null;
  dongLich: string | null;
  tieuDe: string;
  tomTat: {
    daHoc: number;
    tong: number;
    coMat: number;
    mauSoCoMat: number;
    canBu: number;
    conLai: number;
  };
  hocPhan: HocPhanHanhTrinh[];
  tuanNay: {
    nhan: string;
    tieuDe: string;
    dong: string;
    mucTieu: string | null;
  } | null;
  moc: { nhan: string; tieuDe: string; ngay: string } | null;
  lich: { nhanThang: string; y: number; m0: number; truoc: { y: number; m0: number }; sau: { y: number; m0: number }; o: OLich[]; conLaiTrongKhoa: number };
};

export async function getHanhTrinh(
  studentId: string,
  opts: { y: number; m0: number },
  now: Date = new Date(),
): Promise<HanhTrinh> {
  const [sched, view, makeup] = await Promise.all([
    getStudentSchedule(studentId, now),
    getStudentSessionsView(studentId, now),
    getStudentMakeup(studentId),
  ]);

  const ids = view.sessions.map((s) => s.id);
  const lesson = ids.length
    ? await db.classSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, lesson: { select: { moduleCode: true, objectives: true } } },
      })
    : [];
  const hocPhanCua = new Map(lesson.map((l) => [l.id, l.lesson?.moduleCode ?? null]));
  const mucTieuCua = new Map(lesson.map((l) => [l.id, l.lesson?.objectives?.[0]?.trim() || null]));

  // Con học nhiều lớp: bám lớp có buổi kế tiếp (nếu không có thì lớp đầu).
  const lop = sched?.next?.className ?? view.sessions.find((s) => s.className)?.className ?? null;
  const cua = view.sessions.filter((s) => lop === null || s.className === lop);
  const tiepTheoId = sched?.next?.id ?? null;

  // Buổi vắng ĐANG CẦN BÙ (MakeupNeed chưa xong): nối theo NGÀY của buổi vắng — `MakeupItem.missedDate`
  // là chính `ngayISO` của buổi (cùng `napBuoiCuaLop`), và một lớp không có hai buổi cùng thời điểm.
  const ngayCanBu = new Set(
    makeup.needList
      .filter((m) => (m.status === "PENDING" || m.status === "SCHEDULED") && m.missedDate)
      .map((m) => m.missedDate as string),
  );
  const idCanBu = new Set(cua.filter((s) => ngayCanBu.has(s.date)).map((s) => s.id));

  const buoi: BuoiHanhTrinh[] = cua.map((s) => ({
    id: s.id,
    order: s.order,
    tieuDe: s.title === "Buổi học" ? "" : s.title,
    dateISO: s.date,
    nhanThu: thuNgan(s.date),
    ngayNgan: s.nhanNgay.slice(0, 5),
    past: s.past,
    today: s.today,
    attendance: s.attendance,
    hocPhan: hocPhanCua.get(s.id) ?? null,
  }));
  const dong = buoi.map((b) => dungDongBai(b, { tiepTheoId, canBuIds: idCanBu, now }));
  const hocPhan = gomTheoHocPhan(dong);

  const diHoc = tomTatDiHoc({
    daHoc: view.done,
    coMat: view.present,
    vang: view.absent,
    chuaCham: view.chuaCham,
    canBu: makeup.needCount,
  });

  const next = sched?.next ?? null;
  const tuanNay = next
    ? {
        nhan: `${demNgayLich(next.dateISO, now) <= 7 ? "TUẦN NÀY" : "BUỔI KẾ TIẾP"} · BUỔI ${next.order ?? ""}`.trim(),
        tieuDe: next.title,
        dong: [`${next.nhanThu}, ${next.nhanNgayNgan}`, next.time, next.room].filter(Boolean).join(" · "),
        mucTieu: mucTieuCua.get(next.id) ? `Mục tiêu: ${mucTieuCua.get(next.id)}` : null,
      }
    : null;

  const moc = dong.find((d) => !d.past && d.trangThai !== "huy" && laBuoiMoc(d.tieuDe));
  const { y, m0 } = opts;
  const truoc = m0 === 0 ? { y: y - 1, m0: 11 } : { y, m0: m0 - 1 };
  const sau = m0 === 11 ? { y: y + 1, m0: 0 } : { y, m0: m0 + 1 };
  const conLai = Math.max(0, view.total - view.done);

  return {
    tenKhoa: view.courseName,
    tenLop: lop ?? view.className,
    dongLich: next ? [`${next.nhanThu} hằng tuần`, next.time, next.room, next.teacher].filter(Boolean).join(" · ") : null,
    tieuDe:
      view.total === 0
        ? "Chưa có lộ trình"
        : `Lộ trình ${view.total} buổi của ${sched?.studentName ?? "con"}`,
    tomTat: {
      daHoc: view.done,
      tong: view.total,
      coMat: view.present,
      mauSoCoMat: diHoc.mauSo,
      canBu: makeup.needCount,
      conLai,
    },
    hocPhan,
    tuanNay,
    moc: moc ? { nhan: `MỐC LỚN · BUỔI ${moc.order}`, tieuDe: moc.tieuDe, ngay: `${moc.nhanThu}, ${moc.ngayNgan}` } : null,
    lich: {
      nhanThang: `Tháng ${m0 + 1}/${y}`,
      y,
      m0,
      truoc,
      sau,
      o: dungLuoiThang(
        y,
        m0,
        buoi.map((b) => ({ id: b.id, dateISO: b.dateISO, past: b.past, huy: b.attendance === "CANCELLED" })),
        tiepTheoId,
        now,
      ),
      conLaiTrongKhoa: conLai,
    },
  };
}
