// SEC-M05 — dòng watermark nhúng vào file export PII (truy vết ai xuất / khi nào).
// Dùng chung cho CSV (dòng cuối) + XLSX (sheet _watermark).
export function exportWatermark(
  actorName: string,
  actorId: string | null,
  count: number,
  when: Date,
): string {
  const who = actorId ? `${actorName} (${actorId})` : actorName;
  return `Xuất bởi ${who} lúc ${when.toISOString()} — ${count} dòng · Tài liệu nội bộ Sata Robo, không chia sẻ ra ngoài.`;
}
