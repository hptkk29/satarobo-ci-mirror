// "Soạn khoá" chia thành NĂM tab theo URL (`?tab=`) — hàm THUẦN, không import React/DB.
//
// ⚠️ `TrnCourse.status` chỉ có DRAFT/PUBLISHED/ARCHIVED (vòng đời chỉ ghi nó ở hai mốc Xuất bản/Lưu trữ). "Chờ duyệt" và "Đã duyệt" là
// trạng thái của PHIÊN BẢN (`TrnVersionStatus`) ⇒ tab phải suy từ các phiên bản của khoá, không từ cột của khoá. Bản cũ của trang gắn
// nhãn theo `course.status` nên KHÔNG BAO GIỜ hiện "Chờ duyệt".
//
// Một khoá có thể thuộc NHIỀU tab (đang phát hành VÀ có một bản nháp sửa dở) — đó là sự thật của dữ liệu, không bịa thành một tab.
// Mỗi khoá có đúng MỘT nhãn chính (`nhanChinh`) để vẽ trong bảng, theo thứ tự ưu tiên "việc đang cần làm".

export type TrangThaiBan = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";

export const TAB_SOAN_KHOA = [
  { id: "nhap", nhan: "Nháp" },
  { id: "cho-duyet", nhan: "Chờ duyệt" },
  { id: "da-duyet", nhan: "Đã duyệt" },
  { id: "phat-hanh", nhan: "Đang phát hành" },
  { id: "luu-tru", nhan: "Lưu trữ" },
] as const;
export type TabSoanKhoa = (typeof TAB_SOAN_KHOA)[number]["id"];
export const MA_TAB_SOAN_KHOA: readonly TabSoanKhoa[] = TAB_SOAN_KHOA.map((t) => t.id);
export const TAB_SOAN_KHOA_MAC_DINH: TabSoanKhoa = "nhap";

export type KhoaDeXep = {
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  /** Trạng thái của MỌI phiên bản của khoá (thứ tự không quan trọng). */
  banTrangThai: readonly TrangThaiBan[];
};

/** Các tab mà khoá thuộc về. Khoá chưa có phiên bản nào và còn nháp ⇒ tab Nháp (vừa tạo, chưa soạn). */
export function cacTabCuaKhoa(k: KhoaDeXep): TabSoanKhoa[] {
  const co = (t: TrangThaiBan) => k.banTrangThai.includes(t);
  const ra: TabSoanKhoa[] = [];
  if (co("DRAFT") || (k.banTrangThai.length === 0 && k.status === "DRAFT")) ra.push("nhap");
  if (co("PENDING_REVIEW")) ra.push("cho-duyet");
  if (co("APPROVED")) ra.push("da-duyet");
  if (k.status === "PUBLISHED") ra.push("phat-hanh");
  if (k.status === "ARCHIVED") ra.push("luu-tru");
  return ra;
}

/** Nhãn chính để vẽ: bản ĐANG CẦN LÀM (chờ duyệt > đã duyệt > nháp) thắng, rồi tới trạng thái của khoá. */
export function nhanChinhCuaKhoa(k: KhoaDeXep): { id: TrangThaiBan; nhan: string; sac: "warning" | "info" | "muted" | "success" } {
  const co = (t: TrangThaiBan) => k.banTrangThai.includes(t);
  if (co("PENDING_REVIEW")) return { id: "PENDING_REVIEW", nhan: "Chờ duyệt", sac: "warning" };
  if (co("APPROVED")) return { id: "APPROVED", nhan: "Đã duyệt — chờ xuất bản", sac: "info" };
  if (co("DRAFT")) return { id: "DRAFT", nhan: k.status === "PUBLISHED" ? "Đang phát hành · có bản nháp" : "Nháp", sac: "muted" };
  if (k.status === "PUBLISHED") return { id: "PUBLISHED", nhan: "Đang phát hành", sac: "success" };
  if (k.status === "ARCHIVED") return { id: "ARCHIVED", nhan: "Đã lưu trữ", sac: "muted" };
  return { id: "DRAFT", nhan: "Nháp", sac: "muted" };
}

export function demTheoTab(cacKhoa: readonly KhoaDeXep[]): Record<TabSoanKhoa, number> {
  const dem: Record<TabSoanKhoa, number> = { nhap: 0, "cho-duyet": 0, "da-duyet": 0, "phat-hanh": 0, "luu-tru": 0 };
  for (const k of cacKhoa) for (const t of cacTabCuaKhoa(k)) dem[t] += 1;
  return dem;
}
