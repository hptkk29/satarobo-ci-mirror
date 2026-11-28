// lib/cham-cong/dong-phut-don.ts — các dòng "phút theo đơn" của MỘT ngày công (đợt 4+ đơn từ): OT, …
// THUẦN. Một chỗ dựng chữ cho bảng công ngày (admin) và site GV — hai nơi in khác nhau cho cùng
// một ô là đúng lỗi luật 12b.
export type CotPhutDon = {
  otApprovedMinutes: number;
  otActualMinutes: number;
  otPayableMinutes: number;
  /** Đợt 9 — làm ngày lễ / ngày nghỉ theo đơn đã duyệt (phút làm thật trong khung). */
  holidayWorkMinutes: number;
  restDayWorkMinutes: number;
};

export type DongPhutDon = { nhan: string; giaTri: string };

/** "2h25", "3h", "45′". */
export function nhanPhut(p: number): string {
  if (p < 60) return `${p}′`;
  const g = Math.floor(p / 60);
  const ph = p % 60;
  return ph === 0 ? `${g}h` : `${g}h${String(ph).padStart(2, "0")}`;
}

export function dongPhutDon(d: CotPhutDon): DongPhutDon[] {
  const out: DongPhutDon[] = [];
  if (d.otApprovedMinutes > 0) {
    // "Đã duyệt" luôn đi kèm: OT chỉ có ở đây khi đơn ĐÃ duyệt (engine chỉ đọc đơn đã duyệt).
    out.push({
      nhan: "OT · đã duyệt",
      giaTri:
        d.otActualMinutes === 0
          ? `0 — chưa có chấm công trong khung ${nhanPhut(d.otApprovedMinutes)}`
          : `${nhanPhut(d.otPayableMinutes)} (làm ${nhanPhut(d.otActualMinutes)} / duyệt ${nhanPhut(d.otApprovedMinutes)})`,
    });
  }
  // Đợt 9 — chỉ có số khi có đơn đã duyệt (engine chỉ đọc đơn đã duyệt) VÀ có chấm công trong khung.
  if (d.holidayWorkMinutes > 0) out.push({ nhan: "Làm ngày lễ · đã duyệt", giaTri: nhanPhut(d.holidayWorkMinutes) });
  if (d.restDayWorkMinutes > 0) out.push({ nhan: "Làm ngày nghỉ · đã duyệt", giaTri: nhanPhut(d.restDayWorkMinutes) });
  return out;
}
