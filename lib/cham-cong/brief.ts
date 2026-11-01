// lib/cham-cong/brief.ts — Tin nhắc lịch NGÀY MAI (thay tin Zalo 19:00 của Apps Script). THUẦN.
// Một tin cho MỘT người: mã ca + giờ + nơi làm + việc cố định của khối + ghi chú theo ngày.
// Lễ/ghi đè SUPPRESS ⇒ không gửi; REPLACE ⇒ nội dung thay toàn bộ; APPEND ⇒ nối thêm.
import type { ShiftSegment } from "./catalog";

export type BriefAssignment = {
  templateCode: string;
  templateName: string;
  segments: ShiftSegment[];
  placeLabel: string; // "CS1 - 211 Nguyễn Hữu Thọ" | "theo phân công" | "công tác ngoài" | "linh động"
  isOff: boolean;
  isLeave: boolean;
};

export type BriefNote = { mode: "APPEND" | "SUPPRESS" | "REPLACE"; text: string };

export type BriefInput = {
  dateLabel: string; // "Thứ Ba 08/09"
  personName: string;
  assignment: BriefAssignment | null;
  notes: BriefNote[]; // việc cố định theo thứ + ghi đè theo ngày (đã lọc theo khối/người)
  holiday: { name: string; briefMode: "APPEND" | "SUPPRESS" | "REPLACE" | null; briefText: string | null } | null;
  earlyArrivalMinutes: number;
};

export type Brief = { send: boolean; title: string; body: string };

function hours(segs: ShiftSegment[]): string {
  return segs.filter((s) => s.kind === "WORK").map((s) => `${s.start}–${s.end}`).join(" & ");
}

export function buildBrief(input: BriefInput): Brief {
  const replace = [...input.notes.filter((n) => n.mode === "REPLACE").map((n) => n.text)];
  if (input.holiday?.briefMode === "REPLACE" && input.holiday.briefText) replace.unshift(input.holiday.briefText);
  const suppressed = input.notes.some((n) => n.mode === "SUPPRESS") || input.holiday?.briefMode === "SUPPRESS";
  const title = `Lịch ngày mai — ${input.dateLabel}`;
  if (suppressed && replace.length === 0) return { send: false, title, body: "" };
  if (replace.length > 0) return { send: true, title, body: replace.join("\n") };

  const lines: string[] = [];
  const a = input.assignment;
  if (input.holiday) lines.push(`🎌 ${input.holiday.name}${input.holiday.briefText ? ` — ${input.holiday.briefText}` : ""}`);
  if (!a || a.isOff) {
    lines.push(input.holiday ? "Nghỉ lễ." : "Bạn KHÔNG có ca — nghỉ.");
  } else if (a.isLeave) {
    lines.push("Bạn nghỉ phép ngày mai.");
  } else {
    const h = hours(a.segments);
    lines.push(`Ca ${a.templateCode} (${a.templateName})${h ? `: ${h}` : ""} · ${a.placeLabel}`);
    if (h && input.earlyArrivalMinutes > 0) lines.push(`Có mặt trước ca ${input.earlyArrivalMinutes} phút, quét QR khi tới và khi về.`);
  }
  for (const n of input.notes.filter((x) => x.mode === "APPEND")) lines.push(`• ${n.text}`);
  if (input.holiday?.briefMode === "APPEND" && input.holiday.briefText) lines.push(`• ${input.holiday.briefText}`);
  return { send: true, title, body: lines.join("\n") };
}

const WEEKDAY_VI = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** "Thứ Ba 08/09" từ ngày date-only UTC. */
export function dateLabelVi(dateOnly: Date): string {
  const dd = String(dateOnly.getUTCDate()).padStart(2, "0");
  const mm = String(dateOnly.getUTCMonth() + 1).padStart(2, "0");
  return `${WEEKDAY_VI[dateOnly.getUTCDay()]} ${dd}/${mm}`;
}
