// lib/cham-cong/export-xlsx.ts — L5: dựng workbook BẢNG CÔNG KỲ từ PeriodSummary (thuần, test được).
// Sheet 1 "Tong hop": một dòng / người — cột theo file MISA từng xuất (§1.5 kế hoạch) + buổi dạy (K-05).
// Sheet 2 "Luoi": người × ngày = mã ca (S/CG/P/X…) — khớp lưới Sheet 29/08 để đối soát (L6).
// Sheet 3 "_watermark": ai xuất, lúc nào, kỳ nào, đã chốt hay bản tạm.
import * as XLSX from "xlsx";
import type { PeriodSummary } from "./period";

export function buildPeriodWorkbook(input: { summary: PeriodSummary; centerLabel: string; watermark: string; locked: boolean }): XLSX.WorkBook {
  const { summary, centerLabel, watermark, locked } = input;
  const headers = [
    "Mã NV", "Họ tên", "Chức danh", "Công chuẩn", "Công thực tế", "Công kế hoạch", "Nghỉ có lương (công)", "Lễ (công)",
    "Giờ hành chính (công giờ)", "Giờ làm (phút)", "Giờ kế hoạch (phút)", "Số lần đi muộn", "Số lần về sớm", "Ngày không lượt",
    "Ngày ghi đè", "Ngày có cờ", "Buổi dạy ở cơ sở", "Buổi dạy bù", "Phút dạy bù", "OT được trả (phút)", "Làm ngày lễ (phút)", "Làm ngày nghỉ (phút)",
  ];
  const rows = summary.rows.map((r) => [
    r.employeeCode ?? "", r.name, r.jobTitle ?? "", summary.standardUnits ?? "", r.units, r.expectedUnits, r.leaveUnits, r.holidayPaidUnits,
    r.hourCredit, r.workedMinutes, r.expectedMinutes, r.lateCount, r.earlyLeaveCount, r.missingTapDays,
    r.overrideDays, r.flaggedDays, r.teachingSessions, r.makeupSessions ?? 0, r.makeupMinutes ?? 0,
    // Kỳ chốt trước đợt 4 không có trường này trong `summaryJson` ⇒ để trống, không in 0 giả.
    (r as { otMinutes?: number }).otMinutes ?? "",
    // Kỳ chốt trước đợt 9 — cùng lý do.
    (r as { holidayWorkMinutes?: number }).holidayWorkMinutes ?? "",
    (r as { restDayWorkMinutes?: number }).restDayWorkMinutes ?? "",
  ]);
  const title = [`BẢNG CÔNG ${summary.periodKey} — ${centerLabel}${locked ? " (ĐÃ CHỐT)" : " (BẢN TẠM — chưa chốt)"}`];
  const ws1 = XLSX.utils.aoa_to_sheet([title, [], headers, ...rows, [], [`Tổng: ${summary.totals.people} người · ${summary.totals.units} công · ${summary.totals.teachingSessions} buổi dạy ở cơ sở · ${summary.totals.makeupSessions ?? 0} buổi dạy bù`]]);
  for (let i = 0; i < rows.length; i++) {
    const cell = ws1[XLSX.utils.encode_cell({ r: i + 3, c: 0 })];
    if (cell) { cell.t = "s"; cell.z = "@"; }
  }
  ws1["!cols"] = headers.map((h, i) => ({ wch: i === 1 ? 28 : Math.max(10, Math.min(24, h.length + 2)) }));

  const dayHeaders = summary.days.map((d) => d.slice(8, 10));
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["Họ tên", ...dayHeaders, "Σ công"],
    ...summary.rows.map((r) => [r.name, ...summary.days.map((d) => r.grid[d] ?? ""), r.units]),
  ]);
  ws2["!cols"] = [{ wch: 28 }, ...summary.days.map(() => ({ wch: 4.5 })), { wch: 8 }];

  const ws3 = XLSX.utils.aoa_to_sheet([[watermark], [`Dựng lúc ${summary.builtAt}`], [locked ? "Số đã chốt — không đổi dù lưới sửa sau." : "Bản tạm — số có thể đổi tới khi chốt kỳ."]]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Tong hop");
  XLSX.utils.book_append_sheet(wb, ws2, "Luoi");
  XLSX.utils.book_append_sheet(wb, ws3, "_watermark");
  return wb;
}
