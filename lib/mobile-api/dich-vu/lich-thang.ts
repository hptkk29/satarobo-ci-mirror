import { getHanhTrinh } from "@/lib/portal/hanh-trinh";
import { getStudentFeedback } from "@/lib/portal/feedback";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { getStudentSessionsView, type SessionAttendance } from "@/lib/portal/student-sessions";

import type { MaHocVienDaKiem } from "../so-huu";

/**
 * NHÓM 2 (B4) — lịch THÁNG và chi tiết MỘT buổi.
 *   `GET /students/:id/schedule?month=YYYY-MM`  ⇒ lưới tháng (`getHanhTrinh().lich`, cùng nguồn màn Hành trình web) + danh sách buổi rơi vào tháng đó.
 *   `GET /students/:id/sessions/:sessionId`     ⇒ chi tiết buổi. `sessionId` chỉ được tra TRONG các buổi của học viên đã kiểm (`getStudentSessionsView`): buổi của lớp khác / không tồn tại ⇒ null ⇒ 404 đồng nhất.
 *
 * ⚠️ `ClassSession.date` MANG GIỜ THẬT (Timestamptz): nhóm theo ngày/tháng phải đổi sang GIỜ VIỆT NAM trước (buổi 23:30 ngày cuối tháng không được rơi sang tháng sau) — `ngayVn` ở đây.
 * Không bịa: trường nào nguồn không có (giờ/phòng/giáo viên của buổi đã qua) trả `null`; không có trạng thái "đổi lịch" (nguồn chỉ có dự kiến / huỷ).
 */
const FMT_NGAY_VN = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" });
/** `YYYY-MM-DD` theo giờ Việt Nam. */
export const ngayVn = (iso: string | Date): string => FMT_NGAY_VN.format(typeof iso === "string" ? new Date(iso) : iso);

export type OLichDto = { key: string; ngay: number; trongThang: boolean; homNay: boolean; kieu: "xong" | "tiep" | "sap" | "khong" };
export type BuoiTrongThangDto = { id: string; n: number; ten: string; ngayKey: string; nhanNgay: string; trangThai: TrangThaiBuoi };
export type LichThangDto = {
  nhanThang: string;
  y: number;
  m0: number;
  truoc: { y: number; m0: number };
  sau: { y: number; m0: number };
  o: OLichDto[];
  conLaiTrongKhoa: number;
  buoi: BuoiTrongThangDto[];
};

/** Trạng thái hiển thị của buổi (từ điểm danh của nguồn): không suy thêm. */
export type TrangThaiBuoi = "co-mat" | "hoc-bu" | "vang-co-phep" | "vang-khong-phep" | "chua-cham" | "chua-hoc" | "huy";
const TRANG_THAI: Record<SessionAttendance, TrangThaiBuoi> = {
  PRESENT: "co-mat",
  MAKEUP: "hoc-bu",
  EXCUSED: "vang-co-phep",
  ABSENT: "vang-khong-phep",
  UNMARKED: "chua-cham",
  FUTURE: "chua-hoc",
  CANCELLED: "huy",
};

export function docThang(chuoi: string | null): { y: number; m0: number } | null {
  const m = chuoi !== null ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(chuoi) : null;
  if (!m) return null;
  const y = Number(m[1]);
  return y < 2000 || y > 2100 ? null : { y, m0: Number(m[2]) - 1 };
}

export async function layLichThang(hs: MaHocVienDaKiem, y: number, m0: number, now: Date = new Date()): Promise<LichThangDto> {
  const [ht, view] = await Promise.all([getHanhTrinh(hs, { y, m0 }, now), getStudentSessionsView(hs, now)]);
  const tienTo = `${y}-${String(m0 + 1).padStart(2, "0")}-`;
  const buoi = view.sessions
    .map((s) => ({ s, key: ngayVn(s.date) }))
    .filter((x) => x.key.startsWith(tienTo))
    .sort((a, b) => a.key.localeCompare(b.key) || a.s.order - b.s.order)
    .map(({ s, key }) => ({ id: s.id, n: s.order, ten: s.title === "Buổi học" ? "" : s.title, ngayKey: key, nhanNgay: s.nhanNgay, trangThai: TRANG_THAI[s.attendance] }));
  return {
    nhanThang: ht.lich.nhanThang,
    y: ht.lich.y,
    m0: ht.lich.m0,
    truoc: { y: ht.lich.truoc.y, m0: ht.lich.truoc.m0 },
    sau: { y: ht.lich.sau.y, m0: ht.lich.sau.m0 },
    o: ht.lich.o.map((o) => ({ key: o.key, ngay: o.ngay, trongThang: o.trongThang, homNay: o.homNay, kieu: o.kieu })),
    conLaiTrongKhoa: ht.lich.conLaiTrongKhoa,
    buoi,
  };
}

export type ChiTietBuoiDto = {
  id: string;
  n: number;
  tieuDe: string;
  nhan: string;
  tenLop: string | null;
  nhanNgay: string;
  daQua: boolean;
  homNay: boolean;
  trangThai: TrangThaiBuoi;
  /** Giờ / phòng / giáo viên: CHỈ có với buổi sắp tới (nguồn lịch chỉ trả cho buổi tương lai); buổi đã qua ⇒ null. */
  gio: string | null;
  phong: string | null;
  giaoVien: string | null;
  mucTieu: string[];
  coNhanXet: boolean;
};

export async function layChiTietBuoi(hs: MaHocVienDaKiem, sessionId: string, now: Date = new Date()): Promise<ChiTietBuoiDto | null> {
  const [view, sched, phieu] = await Promise.all([getStudentSessionsView(hs, now), getStudentSchedule(hs, now), getStudentFeedback(hs, 100)]);
  const s = view.sessions.find((x) => x.id === sessionId);
  if (!s) return null; // không thuộc học viên này (hoặc không tồn tại) ⇒ 404 đồng nhất
  const sap = sched ? [...(sched.next ? [sched.next] : []), ...sched.thisWeek, ...sched.upcoming].find((b) => b.id === sessionId) : undefined;
  return {
    id: s.id,
    n: s.order,
    tieuDe: s.title === "Buổi học" ? "" : s.title,
    nhan: s.nhan,
    tenLop: s.className,
    nhanNgay: s.nhanNgay,
    daQua: s.past,
    homNay: s.today,
    trangThai: TRANG_THAI[s.attendance],
    gio: sap?.time ?? null,
    phong: sap?.room ?? null,
    giaoVien: sap?.teacher ?? null,
    mucTieu: [...s.objectives],
    coNhanXet: phieu.some((p) => p.classSessionId === sessionId),
  };
}
