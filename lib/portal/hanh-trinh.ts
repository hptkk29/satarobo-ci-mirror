import "server-only";
import { db } from "@/lib/db";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView } from "@/lib/portal/student-sessions";
import {
  dungDongBai,
  dungLuoiThang,
  gomTheoHocPhan,
  idBuoiMoc,
  thuNgan,
  type BuoiHanhTrinh,
  type HocPhanHanhTrinh,
  type OLich,
} from "@/lib/portal/hanh-trinh-thuan";
import { demNgayLich, tomTatDiHoc } from "@/lib/portal/tong-quan-thuan";
import { goiGiaoVien, vietHoaDau } from "@/lib/portal/goi-giao-vien";
import { docGioiTinhGvTheoTen } from "@/lib/portal/goi-giao-vien-db";

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
    /** Buổi vắng CỦA LỚP NÀY đang chờ chọn giờ bù — cùng phạm vi với «Lớp đã học / Con có mặt» đứng cạnh. */
    canBu: number;
    /** Buổi vắng ở lớp KHÁC (thường là lớp trước khi chuyển) vẫn chờ bù — nói riêng, đừng cộng vào số của lớp này. */
    canBuLopKhac: number;
    conLai: number;
  };
  hocPhan: HocPhanHanhTrinh[];
  tuanNay: {
    nhan: string;
    tieuDe: string;
    dong: string;
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
  const [lesson, gioiTinhGv] = await Promise.all([
    ids.length
      ? db.classSession.findMany({
          where: { id: { in: ids } },
          select: { id: true, lesson: { select: { moduleCode: true } } },
        })
      : Promise.resolve([]),
    docGioiTinhGvTheoTen([sched?.next?.teacher]),
  ]);
  const hocPhanCua = new Map(lesson.map((l) => [l.id, l.lesson?.moduleCode ?? null]));
  // «Mục tiêu» buổi (Lesson.objectives[0]) KHÔNG hiện nữa: giáo trình gán cùng một danh sách kỹ năng cho mọi bài của học phần
  // nên buổi nào cũng in «Nhận biết linh kiện» (chủ dự án 13/11/2026).

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
  const mocIds = idBuoiMoc(buoi);
  const dong = buoi.map((b) => dungDongBai(b, { tiepTheoId, canBuIds: idCanBu, mocIds, now }));
  const hocPhan = gomTheoHocPhan(dong);

  // Số «cần học bù» đứng CẠNH «Lớp đã học 8 · Con có mặt 6» nên phải cùng phạm vi LỚP NÀY. `makeup.needCount` là của cả học viên
  // (mọi lớp) — đo prod 13/11/2026: bé chuyển lớp mang theo 2 buổi vắng của lớp cũ ⇒ ô in «3» cạnh «có mặt 6/8», phụ huynh hỏi «sao 3?».
  // `needList` chỉ gồm dòng PENDING (chờ chọn giờ), nên `idCanBu` đúng là buổi của lớp này đang chờ chọn giờ.
  const canBuLop = idCanBu.size;
  const canBuLopKhac = Math.max(0, makeup.needCount - canBuLop);

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
      }
    : null;
  // «Thầy Kiệt» thay cho cả họ tên (chủ dự án 13/11/2026).
  const gv = next?.teacher ? goiGiaoVien(next.teacher, gioiTinhGv.get(next.teacher.trim())) : null;

  const moc = dong.find((d) => !d.past && d.trangThai !== "huy" && d.laMoc);
  const { y, m0 } = opts;
  const truoc = m0 === 0 ? { y: y - 1, m0: 11 } : { y, m0: m0 - 1 };
  const sau = m0 === 11 ? { y: y + 1, m0: 0 } : { y, m0: m0 + 1 };
  const conLai = Math.max(0, view.total - view.done);

  return {
    tenKhoa: view.courseName,
    tenLop: lop ?? view.className,
    dongLich: next ? [`${next.nhanThu} hằng tuần`, next.time, next.room, gv ? vietHoaDau(gv) : null].filter(Boolean).join(" · ") : null,
    tieuDe:
      view.total === 0
        ? "Chưa có lộ trình"
        : `Lộ trình ${view.total} buổi của ${sched?.studentName ?? "con"}`,
    tomTat: {
      daHoc: view.done,
      tong: view.total,
      coMat: view.present,
      mauSoCoMat: diHoc.mauSo,
      canBu: canBuLop,
      canBuLopKhac,
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
