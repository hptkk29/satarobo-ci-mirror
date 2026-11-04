/**
 * lib/holidays/cuon-chieu.ts — NGÀY NGHỈ ⇒ DỜI CẢ DÃY BUỔI LÙI MỘT NHỊP (hàm THUẦN).
 *
 * Yêu cầu chủ dự án 27/09/2026: trung tâm nghỉ một ngày (tổ chức sự kiện…) thì buổi học
 * hôm đó không dạy, và TOÀN BỘ lịch phía sau lùi một buổi — thay vì phải chỉnh tay.
 *
 * Vì sao phải "cuốn chiếu" chứ không dời riêng buổi trùng: mỗi `ClassSession` mang bài giáo
 * trình của nó (`lessonId`). Bản cũ đẩy riêng buổi trùng ngày nghỉ sang ngày trống đầu tiên
 * — mà dãy buổi đã xếp kín tới cuối khoá ⇒ bài bị nghỉ rơi XUỐNG CUỐI, tuần sau lớp học luôn
 * bài kế. Cuốn chiếu giữ nguyên THỨ TỰ buổi (và bài): chỉ các NGÀY dịch đi một nhịp.
 *
 * Luật:
 *   · Chỉ xét buổi CHƯA KHOÁ (`khoa = false`). Buổi đã có dữ liệu (điểm danh / nhận xét /
 *     bài tập / ảnh / đã hoàn tất / đã huỷ) GIỮ NGUYÊN NGÀY và chiếm chỗ ngày đó.
 *   · "Chỗ" hợp lệ = ngày-giờ của chính các buổi chưa khoá, TRỪ những ngày rơi vào ngày nghỉ.
 *     Thiếu bao nhiêu chỗ thì thêm bấy nhiêu ngày học MỚI ở cuối, đúng thứ học của lớp, né
 *     ngày nghỉ và ngày đã có buổi. Giờ của ngày mới = giờ của buổi cùng thứ trong lớp.
 *   · Buổi thứ i (theo thứ tự cũ) nhận chỗ thứ i ⇒ thứ tự không đổi.
 *   · Không buổi chưa khoá nào rơi vào ngày nghỉ ⇒ không dời gì.
 */
import { slotForDate, type SchedulePhase } from "@/lib/classes/phases";
import { parseHm } from "@/lib/classes/slots";
import { vnAddDays, vnDateAt, vnParts, vnWeekday, vnYmd } from "@/lib/time/vn";

export type BuoiCuon = {
  id: string;
  date: Date;
  /** Đã có dữ liệu ⇒ không được dời. */
  khoa: boolean;
};

export type DoiBuoi = { id: string; oldDate: Date; newDate: Date };

export function cuonChieuBuoi(input: {
  /** Các buổi của MỘT lớp, từ ngày bắt đầu xét trở đi (thứ tự bất kỳ). */
  buoi: readonly BuoiCuon[];
  /** Khoá "YYYY-MM-DD" (lịch VN) của mọi ngày nghỉ áp cho lớp này. */
  ngayNghi: ReadonlySet<string>;
  /** Thứ lớp có học (0=CN…6=T7) — dùng khi lớp không có kế hoạch lịch. */
  thuHopLe: readonly number[];
  /** Kế hoạch lịch nhiều giai đoạn; có thì nó quyết định thứ VÀ giờ của ngày mới. */
  phases: readonly SchedulePhase[];
}): DoiBuoi[] {
  const sapXep = [...input.buoi].sort((a, b) => a.date.getTime() - b.date.getTime());
  const choDoi = sapXep.filter((b) => !b.khoa);
  if (!choDoi.some((b) => input.ngayNghi.has(vnYmd(b.date)))) return [];

  // Chỗ hợp lệ có sẵn = ngày-giờ của buổi chưa khoá không rơi vào ngày nghỉ.
  const cho = choDoi.map((b) => b.date).filter((d) => !input.ngayNghi.has(vnYmd(d)));
  const thieu = choDoi.length - cho.length;

  const moi = ngayHocMoi({
    lichCu: sapXep.map((b) => b.date),
    soNgay: thieu,
    ngayNghi: input.ngayNghi,
    thuHopLe: input.thuHopLe,
    phases: input.phases,
  });
  cho.push(...moi);
  // Không đủ chỗ trong 400 ngày: phần thiếu nằm lại, người vận hành xử tay — không đoán bừa.
  const n = Math.min(choDoi.length, cho.length);

  const out: DoiBuoi[] = [];
  for (let i = 0; i < n; i++) {
    const b = choDoi[i]!;
    const moi = cho[i]!;
    if (moi.getTime() !== b.date.getTime()) out.push({ id: b.id, oldDate: b.date, newDate: moi });
  }
  return out;
}

/**
 * `soNgay` NGÀY HỌC MỚI nối sau buổi muộn nhất của `lichCu` — đúng thứ học của lớp (hoặc
 * kế hoạch lịch nếu có), né ngày nghỉ và ngày đã có buổi. Giờ của ngày mới = giờ của buổi
 * cùng thứ trong `lichCu` (buổi muộn nhất cùng thứ thắng), không có thì giờ buổi cuối.
 * Dùng chung cho `cuonChieuBuoi` và "Nghỉ & lùi lịch" theo lớp (`lib/classes/lui-lich.ts`).
 * Trả ít hơn `soNgay` khi 400 ngày liền không có chỗ — nơi gọi tự xử, không đoán bừa.
 */
export function ngayHocMoi(input: {
  lichCu: readonly Date[];
  soNgay: number;
  ngayNghi: ReadonlySet<string>;
  thuHopLe: readonly number[];
  phases: readonly SchedulePhase[];
}): Date[] {
  if (input.soNgay <= 0 || input.lichCu.length === 0) return [];
  const sapXep = [...input.lichCu].sort((a, b) => a.getTime() - b.getTime());
  const daChiem = new Set(sapXep.map((d) => vnYmd(d)));
  const gioTheoThu = new Map<number, { h: number; m: number }>();
  for (const d of sapXep) {
    const p = vnParts(d);
    gioTheoThu.set(p.weekday, { h: p.hour, m: p.minute });
  }
  const cuoi = sapXep[sapXep.length - 1]!;
  const gioMacDinh = { h: vnParts(cuoi).hour, m: vnParts(cuoi).minute };
  const dungKeHoach = input.phases.some((p) => p.slots.length > 0);

  const ra: Date[] = [];
  let con = cuoi;
  for (let buoc = 0; ra.length < input.soNgay && buoc < 400; buoc++) {
    con = vnAddDays(con, 1);
    const khoa = vnYmd(con);
    if (input.ngayNghi.has(khoa) || daChiem.has(khoa)) continue;
    const p = vnParts(con);
    let gio: { h: number; m: number } | null = null;
    if (dungKeHoach) {
      const slot = slotForDate(input.phases, con);
      if (slot) gio = parseHm(slot.startTime);
    } else if (input.thuHopLe.includes(vnWeekday(con))) {
      gio = gioTheoThu.get(p.weekday) ?? gioMacDinh;
    }
    if (!gio) continue;
    ra.push(vnDateAt(p.year, p.month, p.day, gio.h, gio.m));
    daChiem.add(khoa);
  }
  return ra;
}
