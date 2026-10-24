/**
 * Ngày nghỉ ⇒ DỜI CẢ DÃY BUỔI LÙI MỘT NHỊP (chủ dự án yêu cầu 27/09/2026).
 *
 * Lỗi cũ: `applyHolidayShift` đẩy RIÊNG buổi trùng ngày nghỉ sang "ngày trống đầu tiên" —
 * mà dãy buổi của lớp đã xếp kín tới cuối khoá, nên ngày trống đầu tiên nằm SAU buổi cuối.
 * Buổi mang theo bài giáo trình (`ClassSession.lessonId`) ⇒ bài bị nghỉ rơi xuống cuối khoá,
 * tuần sau lớp học luôn bài kế — lệch thứ tự giáo trình, phải chỉnh tay từng lớp.
 *
 * Luật mới (`cuonChieuBuoi`): mỗi buổi CHƯA DIỄN RA từ ngày nghỉ trở đi lấy ngày-giờ của buổi
 * kế tiếp hợp lệ; buổi cuối nhận một ngày học mới ở cuối khoá. Buổi ĐÃ CÓ DỮ LIỆU giữ nguyên.
 * Thứ tự buổi (và bài) không đổi.
 */
import { describe, it, expect } from "vitest";
import { cuonChieuBuoi, type BuoiCuon } from "./cuon-chieu";
import { vnDateAt, vnYmd } from "@/lib/time/vn";

/** Buổi lúc 17:30 giờ VN. `thang` tính từ 1. */
const luc = (thang: number, ngay: number, gio = 17, phut = 30) =>
  vnDateAt(2026, thang - 1, ngay, gio, phut); // `vnDateAt` nhận tháng 0-11
const buoi = (id: string, d: Date, khoa = false): BuoiCuon => ({ id, date: d, khoa });
const ngay = (d: Date) => vnYmd(d);

// Lớp học T3 + T5. Tháng 10/2026: 06 (T3) · 08 (T5) · 13 (T3) · 15 (T5) · 20 (T3) · 22 (T5).
const DAY = [luc(10, 6), luc(10, 8), luc(10, 13), luc(10, 15), luc(10, 20)];

describe("cuonChieuBuoi — nghỉ một buổi ⇒ cả dãy lùi một nhịp", () => {
  it("[CC-01] nghỉ 08/10 ⇒ buổi 08 sang 13, 13 sang 15, 15 sang 20, 20 sang buổi MỚI 22/10", () => {
    const moves = cuonChieuBuoi({
      buoi: DAY.map((d, i) => buoi(`b${i + 1}`, d)),
      ngayNghi: new Set(["2026-10-08"]),
      thuHopLe: [2, 4],
      phases: [],
    });
    const theoId = Object.fromEntries(moves.map((m) => [m.id, ngay(m.newDate)]));
    expect(theoId).toEqual({
      b2: "2026-10-13",
      b3: "2026-10-15",
      b4: "2026-10-20",
      b5: "2026-10-22",
    });
    // b1 (06/10) không dính gì — không có trong danh sách dời.
    expect(theoId.b1).toBeUndefined();
  });

  it("[CC-02] THỨ TỰ buổi giữ nguyên — không buổi nào nhảy qua đầu buổi khác (bài không lệch)", () => {
    const vao = DAY.map((d, i) => buoi(`b${i + 1}`, d));
    const moves = cuonChieuBuoi({ buoi: vao, ngayNghi: new Set(["2026-10-08"]), thuHopLe: [2, 4], phases: [] });
    const moi = new Map(moves.map((m) => [m.id, m.newDate.getTime()]));
    const sau = vao.map((b) => moi.get(b.id) ?? b.date.getTime());
    expect([...sau].sort((a, b) => a - b)).toEqual(sau);
  });

  it("[CC-03] buổi ĐÃ CÓ DỮ LIỆU giữ ngày và chiếm chỗ — dãy vòng qua nó", () => {
    const moves = cuonChieuBuoi({
      buoi: [
        buoi("b1", luc(10, 8)),
        buoi("b2", luc(10, 13), true), // đã điểm danh
        buoi("b3", luc(10, 15)),
      ],
      ngayNghi: new Set(["2026-10-08"]),
      thuHopLe: [2, 4],
      phases: [],
    });
    const theoId = Object.fromEntries(moves.map((m) => [m.id, ngay(m.newDate)]));
    expect(theoId.b2).toBeUndefined();
    expect(theoId).toEqual({ b1: "2026-10-15", b3: "2026-10-20" });
  });

  it("[CC-04] nghỉ HAI ngày liền ⇒ hai buổi mới ở cuối, không rơi vào ngày nghỉ khác", () => {
    const moves = cuonChieuBuoi({
      buoi: DAY.map((d, i) => buoi(`b${i + 1}`, d)),
      // 06 + 08 nghỉ; 20/10 là một ngày nghỉ khác đã có từ trước.
      ngayNghi: new Set(["2026-10-06", "2026-10-08", "2026-10-20"]),
      thuHopLe: [2, 4],
      phases: [],
    });
    const theoId = Object.fromEntries(moves.map((m) => [m.id, ngay(m.newDate)]));
    expect(theoId).toEqual({
      b1: "2026-10-13",
      b2: "2026-10-15",
      b3: "2026-10-22",
      b4: "2026-10-27",
      b5: "2026-10-29",
    });
  });

  it("[CC-05] buổi mới ở cuối mang GIỜ của buổi cùng thứ trong lớp", () => {
    // T3 học 17:30, T7 học 09:00.
    const moves = cuonChieuBuoi({
      buoi: [
        buoi("b1", luc(10, 6)), // T3
        buoi("b2", luc(10, 10, 9, 0)), // T7
        buoi("b3", luc(10, 13)), // T3
      ],
      ngayNghi: new Set(["2026-10-06"]),
      thuHopLe: [2, 6],
      phases: [],
    });
    const b3 = moves.find((m) => m.id === "b3")!;
    // b3 lấy chỗ mới đầu tiên sau 13/10 đúng thứ học = T7 17/10 — giờ của buổi T7 (09:00).
    expect(ngay(b3.newDate)).toBe("2026-10-17");
    expect(b3.newDate.getTime()).toBe(luc(10, 17, 9, 0).getTime());
  });

  it("[CC-06] không buổi nào rơi vào ngày nghỉ ⇒ không dời gì", () => {
    expect(
      cuonChieuBuoi({
        buoi: DAY.map((d, i) => buoi(`b${i + 1}`, d)),
        ngayNghi: new Set(["2026-10-07"]),
        thuHopLe: [2, 4],
        phases: [],
      }),
    ).toEqual([]);
  });

  it("[CC-07] buổi ĐÃ KHOÁ nằm ĐÚNG ngày nghỉ ⇒ giữ nguyên, không kéo cả dãy", () => {
    // Buổi đã điểm danh là lịch sử — ngày nghỉ khai sau không viết lại được nó.
    expect(
      cuonChieuBuoi({
        buoi: [buoi("b1", luc(10, 8), true), buoi("b2", luc(10, 13))],
        ngayNghi: new Set(["2026-10-08"]),
        thuHopLe: [2, 4],
        phases: [],
      }),
    ).toEqual([]);
  });
});
