// GIÁO VIÊN LUÔN HIỆN khi xếp case dạy bù — THUẦN (không DB). Cùng danh sách `trial.gvMienLocTheoCa` mà ô chọn giáo viên của lớp trial dùng
// (chủ dự án 22/10: "lấy tương tự học trial"): người trong danh sách được chọn dù ngày đó không có ca, hoặc ca gắn Hội sở / cơ sở khác.
// Chỉ MIỄN luật ca. Trùng lịch dạy vẫn bị chặn ở `kiemLichTrongTx` — nó không đọc danh sách này.

export type GvChonDuoc = { id: string; name: string; ma: string };

/**
 * Gộp người được miễn vào danh sách đã lọc theo ca. Chỉ nhận người nằm trong `giaoVien` (danh sách giáo viên hợp lệ) — một mã lạ trong cấu
 * hình không biến người không phải giáo viên thành chọn được. `ma` rỗng = không có ca phủ khung giờ, giao diện in "luôn hiện".
 */
export function themGvMienTru(
  ds: readonly GvChonDuoc[],
  giaoVien: readonly { id: string; name: string | null }[],
  mien: readonly string[],
): GvChonDuoc[] {
  const daCo = new Set(ds.map((g) => g.id));
  const dsMien = new Set(mien);
  const them: GvChonDuoc[] = [];
  for (const g of giaoVien) {
    if (!dsMien.has(g.id) || daCo.has(g.id)) continue;
    them.push({ id: g.id, name: g.name ?? "Giáo viên", ma: "" });
  }
  return [...ds, ...them].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Nhãn ca cạnh tên giáo viên trong ô chọn. */
export function nhanCaGv(g: Pick<GvChonDuoc, "ma">): string {
  return g.ma ? `ca ${g.ma}` : "luôn hiện";
}
