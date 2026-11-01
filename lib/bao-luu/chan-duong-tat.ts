// lib/bao-luu/chan-duong-tat.ts — CHẶN đặt "Bảo lưu" ngoài hồ sơ bảo lưu. THUẦN. PHIÊN 1.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY (đo ở Phiên 0, 07/10/2026)
//
// `PAUSED` là trạng thái PHẢN CHIẾU của `StudentReserve` còn hiệu lực, nhưng có BỐN đường đặt
// nó mà KHÔNG tạo `StudentReserve`:
//
//   · dialog "Đổi trạng thái" ghi danh        → `changeEnrollmentStatus`
//   · form ghi danh cũ (CRUD legacy)          → `createEnrollment` / `updateEnrollment`
//   · ô "Trạng thái" của form học viên        → `createStudent` / `updateStudent`
//   · cột "Trạng thái" của file Excel         → `/api/admin/import/students`
//
// Học viên đi đường tắt có `PAUSED` mà KHÔNG có `expectedEndAt` (cron `reserve-expiry` không bao
// giờ nhắc), KHÔNG dời hạn đợt thu, và KHÔNG có lý do/người lập. `dangBaoLuu` — nguồn sự thật —
// không nhìn thấy họ, nên họ vẫn bị nhắc nợ trong lúc "bảo lưu" trên màn hình.
//
// Phép chặn chỉ chặn việc ĐẶT (đi VÀO) `PAUSED`. Hồ sơ đã `PAUSED` sẵn mà form gửi lại đúng
// `PAUSED` (sửa ô khác) KHÔNG bị chặn — nếu chặn, mọi lượt sửa hồ sơ học viên đang bảo lưu đều
// hỏng. Cùng khuôn với phép chặn `INACTIVE` ở `updateStudent` (BUG 21/08).
//
// ⚠️ Đây là MỘT hàm cho cả năm chỗ gọi. Đừng chép lại điều kiện ở chỗ gọi: lưới
// `lib/bao-luu/chan-duong-tat.test.ts` đếm đúng số lời gọi, nên thêm một đường ghi `PAUSED`
// mới mà quên gọi hàm này là đỏ.

export type DuongDatBaoLuu =
  | "DOI_TRANG_THAI_GHI_DANH"
  | "FORM_GHI_DANH"
  | "FORM_HOC_VIEN"
  | "IMPORT_EXCEL";

const NUT_DUNG =
  'Dùng nút "Bảo lưu" ở hồ sơ học viên — nút đó mới tạo lượt bảo lưu, dời hạn các đợt thu chưa tới hạn và ghi lý do.';

const THONG_DIEP: Record<DuongDatBaoLuu, string> = {
  DOI_TRANG_THAI_GHI_DANH: `Không đặt "Bảo lưu" từ hộp đổi trạng thái ghi danh. ${NUT_DUNG}`,
  FORM_GHI_DANH: `Không đặt trạng thái "Bảo lưu" cho ghi danh từ biểu mẫu này. ${NUT_DUNG}`,
  FORM_HOC_VIEN: `Không đặt "Bảo lưu" từ ô Trạng thái. ${NUT_DUNG}`,
  IMPORT_EXCEL: `Dòng Excel không đặt được trạng thái "Bảo lưu". Để trống cột status (hoặc ghi ACTIVE) rồi lập bảo lưu bằng nút "Bảo lưu" ở hồ sơ học viên.`,
};

/**
 * Trả thông điệp lỗi (tiếng Việt) nếu thao tác này đang ĐẶT `PAUSED` ngoài hồ sơ bảo lưu;
 * `null` nếu được phép.
 *
 *   · `truoc` — trạng thái hiện có (`null`/`undefined` khi đang TẠO MỚI);
 *   · `sau`   — trạng thái sắp ghi (`undefined` khi thao tác không chạm trạng thái).
 */
export function chanDatBaoLuuNgoaiHoSo(input: {
  duong: DuongDatBaoLuu;
  truoc: string | null | undefined;
  sau: string | null | undefined;
}): string | null {
  if (input.sau !== "PAUSED") return null;
  if (input.truoc === "PAUSED") return null;
  return THONG_DIEP[input.duong];
}

// ─────────────────────────────────────────────────────────────────────────────
// GỠ `PAUSED` ngoài hồ sơ (chốt 08/10/2026, mục C(a)) — nửa còn lại của phép chặn ở trên.
//
// Đặt PAUSED mà không có hồ sơ là sai một chiều; GỠ PAUSED mà hồ sơ còn mở là sai chiều ngược lại: ghi
// danh về STUDYING/ACTIVE (vào roster, điểm danh, nhắc nợ) trong khi `StudentReserve` vẫn `isActive` ⇒
// `dangBaoLuu` nói "đang bảo lưu", còn lớp học nói "đang học". Hai nguồn lệch nhau, và lệch này không
// lỗi nào báo. Đường đúng là nút "Học lại" (`resumeStudentReserveAction`) — nó đóng hồ sơ VÀ gỡ PAUSED
// trong một giao dịch.
//
// ⚠️ ĐƯỜNG THOÁT CHO PAUSED MỒ CÔI: chỉ chặn khi `coHoSoMo = true`. Ghi danh/học viên `PAUSED` mà KHÔNG có
// hồ sơ nào còn hiệu lực (nhóm (b) trong `docs/bao-luu/legacy-3-nhom.sql`, do đường tắt cũ sinh ra) PHẢI gỡ
// được bằng tay — chặn luôn thì họ kẹt vĩnh viễn ở trạng thái mà chính hệ thống không còn giải thích được.
// `coHoSoMo` do người gọi tra DB (`dangBaoLuu` / `coHoSoMoChoHocVien`), hàm này giữ thuần.

const NUT_HOC_LAI =
  'Dùng nút "Học lại" ở hồ sơ học viên — nút đó đóng hồ sơ bảo lưu và gỡ trạng thái trong cùng một giao dịch.';

const THONG_DIEP_GO: Record<DuongDatBaoLuu, string> = {
  DOI_TRANG_THAI_GHI_DANH: `Ghi danh này đang có hồ sơ bảo lưu còn hiệu lực — không đổi trạng thái từ hộp này. ${NUT_HOC_LAI}`,
  FORM_GHI_DANH: `Ghi danh này đang có hồ sơ bảo lưu còn hiệu lực — không đổi trạng thái từ biểu mẫu. ${NUT_HOC_LAI}`,
  FORM_HOC_VIEN: `Học viên đang có hồ sơ bảo lưu còn hiệu lực — không đổi trạng thái từ ô Trạng thái. ${NUT_HOC_LAI}`,
  IMPORT_EXCEL: `Học viên đang có hồ sơ bảo lưu còn hiệu lực — dòng Excel không đổi được trạng thái. Để trống cột status (giữ nguyên) hoặc dùng nút "Học lại" ở hồ sơ học viên.`,
};

/** `null` = được phép; chuỗi = lý do từ chối. Xem khối chú thích ở trên (đường thoát cho PAUSED mồ côi). */
export function chanGoBaoLuuNgoaiHoSo(input: {
  duong: DuongDatBaoLuu;
  truoc: string | null | undefined;
  sau: string | null | undefined;
  /** Có hồ sơ bảo lưu CÒN HIỆU LỰC phủ đối tượng này không (tra DB bởi người gọi). */
  coHoSoMo: boolean;
}): string | null {
  if (input.truoc !== "PAUSED") return null;
  if (input.sau === undefined || input.sau === null || input.sau === "PAUSED") return null;
  if (!input.coHoSoMo) return null;
  return THONG_DIEP_GO[input.duong];
}
