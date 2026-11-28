/**
 * lib/nguon/sale-cua-phu-huynh.ts — "SALE PHỤ TRÁCH CỦA PHỤ HUYNH GIỚI THIỆU" (SPEC nguồn động §2, vai `REFERRER_PARENT_SALE`). THUẦN.
 *
 * Khi attribution là PHỤ HUYNH giới thiệu, hệ thống chụp LẠI Sale phụ trách phụ huynh ấy LÚC ghi nhận (`LeadAttribution.referrerSaleUserId`):
 * sau này phụ huynh chuyển sang Sale khác thì hoa hồng acquisition của lead cũ VẪN về Sale lúc đó. Hàm này chỉ CHỌN trong dữ liệu đã nạp;
 * tầng đọc (`thu-thap-tin-hieu`) nạp bằng client KHÔNG scope.
 *
 * ── Đường dữ liệu đã chọn (ghi vào báo cáo giao việc) ───────────────────────────────────────────────────────
 *  Student → `Student.leadId` (lead GỐC của học viên) → `Lead.convertedById` (người chốt) rồi `Lead.assignedToId` (người chăm).
 *  KHÔNG dùng `Enrollment.saleId`: cột đó sửa tay được ở màn học viên của lớp, không phải sổ "ai phụ trách phụ huynh".
 *
 * ── Thứ tự ưu tiên (tất định) ─────────────────────────────────────────────────────────────────────────────────
 *  1. đúng học viên được chọn (`studentId`) trước; không có Sale ở lead của bé ấy mới xét các bé CÙNG phụ huynh;
 *  2. trong mỗi nhóm: lead GẦN NHẤT (mốc = `convertedAt ?? createdAt`) có Sale thắng — lead SAU `bayGio` bị loại (không đọc tương lai);
 *  3. hoà mốc ⇒ `lead.id` nhỏ hơn (tất định);
 *  4. lead đã xoá mềm bị loại; lead không có Sale nào thì bỏ qua, xét lead cũ hơn.
 *  Không tìm được ⇒ null (người gọi ghi cờ xem tay `THIEU_SALE_PH`, KHÔNG đoán).
 *
 * `bayGio` BẮT BUỘC (luật 19): hàm không đọc đồng hồ.
 */

export type LeadCuaHocVien = {
  id: string;
  convertedById: string | null;
  assignedToId: string | null;
  convertedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type HocVienCuaPhuHuynh = {
  id: string;
  parentUserId: string | null;
  lead: LeadCuaHocVien | null;
};

const coGiaTri = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

function moc(l: LeadCuaHocVien): number {
  return (l.convertedAt ?? l.createdAt).getTime();
}

/** Sale gần nhất trong tập học viên: bỏ lead xoá mềm / sau `bayGio` / không có Sale. */
function saleGanNhat(hocVien: readonly HocVienCuaPhuHuynh[], bayGio: Date): string | null {
  const ung = hocVien
    .flatMap((h) => (h.lead ? [h.lead] : []))
    .filter((l) => l.deletedAt === null && moc(l) <= bayGio.getTime())
    .sort((a, b) => moc(b) - moc(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of ung) {
    // Lùi về người CHĂM (`assignedToId`) CHỈ với lead CHƯA TỪNG chuyển đổi (`convertedAt = NULL`, dữ liệu trước cột `convertedById`). Lead ĐÃ chuyển đổi mà
    // `convertedById = NULL` là «người chốt CHƯA XÁC ĐỊNH» (vd. lệnh sửa người chốt legacy đưa về NULL để chờ đối chiếu) — KHÔNG đoán từ người chăm:
    // lùi ở đây là trả tiền hoa hồng «Sale phụ trách phụ huynh» theo một phỏng đoán. Không có Sale ⇒ xét lead cũ hơn, hết thì null (cờ xem tay THIEU_SALE_PH).
    const sale = coGiaTri(l.convertedById) ? l.convertedById : l.convertedAt === null && coGiaTri(l.assignedToId) ? l.assignedToId : null;
    if (sale !== null) return sale;
  }
  return null;
}

export function chonSaleCuaPhuHuynh(p: {
  studentId: string | null;
  parentUserId: string | null;
  hocVien: readonly HocVienCuaPhuHuynh[];
  bayGio: Date;
}): string | null {
  const dung = coGiaTri(p.studentId) ? p.hocVien.filter((h) => h.id === p.studentId) : [];
  const saleDung = saleGanNhat(dung, p.bayGio);
  if (saleDung !== null) return saleDung;

  // Phụ huynh: ưu tiên `parentUserId` người nhập chọn; không có thì lấy của chính học viên được chọn.
  const phuHuynh = coGiaTri(p.parentUserId) ? p.parentUserId : (dung.find((h) => coGiaTri(h.parentUserId))?.parentUserId ?? null);
  if (phuHuynh === null) return null;
  return saleGanNhat(
    p.hocVien.filter((h) => h.parentUserId === phuHuynh),
    p.bayGio,
  );
}
