// lib/finance/hoa-don/tep-mo-coi.ts — chọn TỆP MỒ CÔI của kho hoá đơn để dọn. THUẦN (không DB, không R2).
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §6. Trình duyệt PUT tệp lên kho TRƯỚC khi có hoá đơn nào trỏ
// tới (ký URL theo orderId). Kế toán đổi dòng / đóng tab / tải lại tệp khác ⇒ tệp cũ nằm lại vĩnh viễn,
// mang MST, địa chỉ, email khách. Cron hằng tuần `hoa-don-tep-mo-coi` dọn chúng; hàm này quyết định
// khoá NÀO được xoá — người chạy (`don-tep-mo-coi.ts`) chỉ liệt kê, tra tham chiếu và xoá đúng danh sách.
//
// Bốn luật, mỗi luật một ca `[TMC-*]`:
//   1. chỉ khoá đúng hình dạng `khoaTepHoaDon` (tiền tố `hoa-don/`) — thứ gì khác trong bucket không
//      phải của luồng tải lên này, không ai biết nó là gì thì không xoá;
//   2. chỉ tệp CŨ HƠN 7 ngày theo LastModified — tệp đang tải dở / vừa xác minh chưa kịp lưu nháp không
//      bị đụng; thiếu LastModified thì giữ (không biết tuổi thì không đoán);
//   3. không xoá khoá nằm trong tập tham chiếu (tepPdfKey / tepXmlKey của MỌI hoá đơn, mọi trạng thái —
//      người chạy tra tập đó, hàm này chỉ so NGUYÊN khoá);
//   4. trần số tệp mỗi lượt, CŨ NHẤT trước — lượt sau dọn tiếp phần còn lại.

/** Tiền tố khoá của luồng tải lên hoá đơn (`khoaTepHoaDon` trong `kho-tep.ts`). */
export const TIEN_TO_TEP_HOA_DON = "hoa-don/" as const;

/** Tuổi tối thiểu (theo LastModified) để một tệp mồ côi được xoá. */
export const TUOI_TOI_THIEU_MS = 7 * 24 * 3600_000;

/** Trần số tệp xoá mỗi lượt cron. Còn dư thì lượt tuần sau dọn tiếp. */
export const TRAN_XOA_MOI_LUOT = 200;

// CÙNG hình dạng với `khoaTepHoaDon`: `hoa-don/<mã cơ sở>/<năm>/<orderId>/<uuid>.<pdf|xml>`, mỗi đoạn chỉ
// chữ-số-gạch (không có `.` ⇒ không có `..`). Chép lại chứ không import: `kho-tep.ts` kéo theo
// `server-only` + SDK S3, còn tệp này phải thuần. Ca `[DTM-01]` so hai bên để chúng không trôi lệch.
const HINH_DANG_KHOA = /^hoa-don\/[A-Za-z0-9_-]+\/\d{4}\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(pdf|xml)$/;

/** Khoá này có đúng là tệp của luồng tải lên hoá đơn không. */
export function laKhoaTepHoaDon(khoa: string): boolean {
  return HINH_DANG_KHOA.test(khoa);
}

export type TepTrongKho = { khoa: string; lastModified: Date | null };

export function chonTepMoCoi(input: {
  tep: readonly TepTrongKho[];
  /** tepPdfKey ∪ tepXmlKey của MỌI HoaDonDienTu — người gọi tra bằng MỘT câu, không lọc trạng thái. */
  thamChieu: ReadonlySet<string>;
  /** BẮT BUỘC (luật 7) — không rơi về đồng hồ thật. */
  now: Date;
  /** BẮT BUỘC — không có mặc định "không trần". ≤ 0 ⇒ không xoá gì. */
  tran: number;
}): { xoa: string[]; moCoi: number } {
  const moc = input.now.getTime() - TUOI_TOI_THIEU_MS;
  const daThay = new Set<string>();
  const ungVien: { khoa: string; t: number }[] = [];
  for (const f of input.tep) {
    if (daThay.has(f.khoa)) continue;
    daThay.add(f.khoa);
    if (!laKhoaTepHoaDon(f.khoa)) continue;
    if (!f.lastModified) continue;
    const t = f.lastModified.getTime();
    if (!Number.isFinite(t) || t >= moc) continue;
    if (input.thamChieu.has(f.khoa)) continue;
    ungVien.push({ khoa: f.khoa, t });
  }
  ungVien.sort((a, b) => a.t - b.t || a.khoa.localeCompare(b.khoa));
  const tran = Math.max(0, Math.trunc(input.tran));
  return { xoa: ungVien.slice(0, tran).map((u) => u.khoa), moCoi: ungVien.length };
}
