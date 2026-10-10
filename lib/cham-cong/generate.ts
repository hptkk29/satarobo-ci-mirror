// lib/cham-cong/generate.ts — Sinh lưới tháng từ KHUNG CA TUẦN (kế hoạch §4.1). Phần THUẦN:
// quyết định từng ô (mã nào, có đè không) không chạm DB; phần DB ở generate-db.ts.
//
// Luật:
//  - Mỗi (người, ngày): lấy pattern của thứ đó ở TỪNG khối (Mr Phúc có 2 khối) → gộp con trỏ
//    D1/D2 như import (mergePointerCells) → mã + khối chịu công.
//  - KHÔNG đè ô có nguồn SWAP / LEAVE / MANUAL / IMPORT (đơn đã duyệt, sửa tay, file) — chỉ
//    ô trống hoặc ô PATTERN cũ. Lễ không đổi ô: engine xử lý (dayType HOLIDAY, hệ số).
//  - Pattern hết hiệu lực (effectiveTo < ngày) hoặc chưa hiệu lực thì bỏ qua.
//  - 🔴 KHÔNG CHẠM NGÀY ĐÃ QUA VÀ NGÀY HÔM NAY (13/09/2026). Sửa khung ca rồi bấm sinh lưới
//    chỉ được áp KỂ TỪ NGÀY MAI. Xem khối chú thích ở `homNay` bên dưới.
import { mergePointerCells } from "./place";

export type PatternRow = {
  userId: string;
  unit: string; // "CS1" | "CS2" | "HO" (khối)
  weekday: number; // 0..6
  templateCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type ExistingCell = {
  userId: string;
  workDate: Date; // UTC date-only
  templateCode: string;
  centerUnit: string | null;
  source: "PATTERN" | "IMPORT" | "MANUAL" | "SWAP" | "LEAVE" | "HOLIDAY";
};

export type PlannedCell = {
  userId: string;
  workDate: Date;
  code: string;
  unit: string;
  sourceCells: Record<string, string>;
  action: "CREATE" | "REPLACE" | "KEEP" | "SKIP_PROTECTED" | "SKIP_QUA_KHU" | "CLEAR";
  existingSource?: ExistingCell["source"];
};

const PROTECTED: ReadonlySet<ExistingCell["source"]> = new Set(["SWAP", "LEAVE", "MANUAL", "IMPORT"]);

export function daysOfMonth(year: number, month1: number): Date[] {
  const n = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(year, month1 - 1, i + 1)));
}

/** Thứ (0=CN…6=T7) của một ngày UTC date-only — ngày công theo lịch VN có cùng thứ với ngày UTC-midnight này. */
export function weekdayOf(dateOnly: Date): number {
  return dateOnly.getUTCDay();
}

export function planMonthFromPatterns(input: {
  year: number;
  month1: number;
  patterns: PatternRow[];
  existing: ExistingCell[];
  /** Chỉ sinh cho những người này (rỗng = mọi người có pattern). */
  onlyUserIds?: string[];
  /**
   * 🔴 HÔM NAY theo lịch VN, dạng UTC date-only (`vnDateOnly(new Date())`).
   *
   * BẮT BUỘC, không có mặc định — luật 7 (tham số có mặc định nguy hiểm thì bỏ mặc định) và
   * luật 19 (test KHÔNG được đọc đồng hồ thật). Để hàm tự gọi `new Date()` là biến ranh giới
   * này thành thứ không test được, và biến cả bộ test thành bom hẹn giờ.
   *
   * ── VÌ SAO CÓ THAM SỐ NÀY ──────────────────────────────────────────────────────────
   * Trước 13/09/2026 cả `generate.ts` lẫn `generate-db.ts` đọc đồng hồ **0 lần** — không có
   * khái niệm "hôm nay" trong cả đường đi. Nên "sinh lưới không đè ngày đã qua" KHÔNG PHẢI
   * là hành vi bị hỏng; nó CHƯA TỪNG TỒN TẠI.
   *
   * Hệ quả thật: sửa khung ca tuần rồi bấm "Sinh lưới" cho THÁNG HIỆN TẠI thì mọi ngày đã
   * qua và cả hôm nay bị `CANCELLED` rồi tạo lại theo khung mới — trong khi `StaffTimeLog`
   * của những ngày đó đã có thật và `StaffAttendanceDay` đã tính theo ca CŨ.
   *
   * ⚠️ ĐỪNG vá bằng `effectiveFrom`: cả ba đường ghi `ShiftWeeklyPattern` đều đặt nó bằng
   * hằng `01/01/2000`, và `lib/cham-cong/khung-ca.ts` nói rõ bảng ấy "không dựng lịch sử
   * theo phiên bản — đổi mốc là đổi hạt của bảng".
   */
  homNay: Date;
}): PlannedCell[] {
  const days = daysOfMonth(input.year, input.month1);
  const homNayMs = input.homNay.getTime();
  const byUser = new Map<string, PatternRow[]>();
  for (const p of input.patterns) {
    if (input.onlyUserIds && input.onlyUserIds.length && !input.onlyUserIds.includes(p.userId)) continue;
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }
  const existingBy = new Map<string, ExistingCell>();
  for (const e of input.existing) existingBy.set(`${e.userId}|${e.workDate.toISOString().slice(0, 10)}`, e);

  const out: PlannedCell[] = [];
  for (const [userId, rows] of byUser) {
    for (const day of days) {
      const wd = weekdayOf(day);
      const cellsByUnit: Record<string, string | null> = {};
      for (const p of rows) {
        if (p.weekday !== wd) continue;
        if (p.effectiveFrom.getTime() > day.getTime()) continue;
        if (p.effectiveTo && p.effectiveTo.getTime() < day.getTime()) continue;
        cellsByUnit[p.unit] = p.templateCode;
      }
      const merged = mergePointerCells(cellsByUnit);
      const key = `${userId}|${day.toISOString().slice(0, 10)}`;
      const ex = existingBy.get(key);
      // 🔴 NGÀY ĐÃ QUA VÀ HÔM NAY — không CREATE, không REPLACE, không CLEAR.
      //
      // Đặt TRƯỚC mọi nhánh khác, kể cả trước `SKIP_PROTECTED`: cổng phải chặn trước khi có
      // quyết định nào được ghi ra. Đứng sau là lặp lại đúng lỗi "cổng đặt sau chỗ ghi".
      //
      // Vì sao gồm CẢ HÔM NAY: người ta sửa khung ca rồi bấm ngay trong ngày, và hôm nay là
      // ngày ĐANG có người quét. Ranh giới "kể từ NGÀY MAI" là ranh giới duy nhất không cần
      // biết mấy giờ.
      if (day.getTime() <= homNayMs) {
        if (ex) {
          out.push({ userId, workDate: day, code: ex.templateCode, unit: ex.centerUnit ?? "", sourceCells: {}, action: "SKIP_QUA_KHU", existingSource: ex.source });
        }
        continue;
      }
      if (ex && PROTECTED.has(ex.source)) {
        out.push({ userId, workDate: day, code: ex.templateCode, unit: ex.centerUnit ?? merged.unit ?? "", sourceCells: merged.sourceCells, action: "SKIP_PROTECTED", existingSource: ex.source });
        continue;
      }
      if (!merged.code) {
        if (ex) out.push({ userId, workDate: day, code: ex.templateCode, unit: ex.centerUnit ?? "", sourceCells: {}, action: "CLEAR", existingSource: ex.source });
        continue;
      }
      if (ex && ex.templateCode === merged.code && (ex.centerUnit ?? merged.unit) === merged.unit) {
        out.push({ userId, workDate: day, code: merged.code, unit: merged.unit ?? "", sourceCells: merged.sourceCells, action: "KEEP", existingSource: ex.source });
        continue;
      }
      out.push({ userId, workDate: day, code: merged.code, unit: merged.unit ?? "", sourceCells: merged.sourceCells, action: ex ? "REPLACE" : "CREATE", existingSource: ex?.source });
    }
  }
  return out;
}

/** Cảnh báo Điều 111 BLLĐ: 7 ngày liên tiếp không có ngày X/P nào — chỉ cảnh báo, không tự sửa (§1.2). */
export function warnNoWeeklyRest(cells: PlannedCell[]): { userId: string; from: string; to: string }[] {
  const byUser = new Map<string, PlannedCell[]>();
  for (const c of cells) {
    // `SKIP_QUA_KHU` mang `code` của ô ĐANG CÓ chứ không phải mã sắp xếp, và ngày ấy không
    // bị lượt này đụng tới — đếm nó vào chuỗi làm liên tiếp là cảnh báo về một thứ lượt này
    // không tạo ra. Cùng lý do với `CLEAR`/`SKIP_PROTECTED`.
    if (c.action === "CLEAR" || c.action === "SKIP_PROTECTED" || c.action === "SKIP_QUA_KHU") continue;
    const l = byUser.get(c.userId) ?? [];
    l.push(c);
    byUser.set(c.userId, l);
  }
  const out: { userId: string; from: string; to: string }[] = [];
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.workDate.getTime() - b.workDate.getTime());
    let run = 0;
    let start: Date | null = null;
    for (const c of list) {
      const rest = c.code === "X" || c.code === "P";
      if (rest) {
        run = 0;
        start = null;
        continue;
      }
      run += 1;
      start ??= c.workDate;
      if (run === 7 && start) {
        out.push({ userId, from: start.toISOString().slice(0, 10), to: c.workDate.toISOString().slice(0, 10) });
        run = 0;
        start = null;
      }
    }
  }
  return out;
}
