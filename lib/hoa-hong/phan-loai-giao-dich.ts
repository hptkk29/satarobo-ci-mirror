// lib/hoa-hong/phan-loai-giao-dich.ts — PHÂN LOẠI GIAO DỊCH: NEW | RENEWAL | MANUAL_REVIEW.
//
// Nguồn thiết kế: docs/source-commission/04 §5 (luật), 02 §8.3 (`StudentTransaction`), 05 AC-TRX.
// THUẦN — không DB, không đọc đồng hồ. Phần nạp dữ liệu nằm ở `phan-loai-giao-dich-db.ts`; hai bên nối
// nhau bằng kiểu `DauVaoPhanLoai`.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT v2 (2026-10-16) — PHÂN LOẠI LÀ HÀM CỦA THỨ TỰ MUA, KHÔNG CỦA GIỜ QUÉT. LUẬT v3 (2026-10-17) — VÀ KHÔNG CỦA NGÀY DO NGƯỜI NHẬP KHAI.
//
//   · Thứ tự lần mua = khoá K = (taoLuc, Order.id). `taoLuc` là một dấu thời gian do MÁY CHỦ đặt: `Order.createdAt` với đơn thường; với đơn "giờ tạo chưa kiểm chứng" (ghi bù lead cũ,
//     nhập giao dịch cũ) là giờ máy chủ ghi nhận đơn (bộ nạp lấy từ AuditLog). KHÔNG có ngày nào do người nhập khai (`Payment.paidDate`, ngày trong audit, ngày trong sheet) đi vào K — chủ dự án chốt:
//     "không để Sale/Finance lùi ngày thu rồi làm đổi NEW/RENEWAL". Id đơn chỉ để phá hoà; cùng đơn không là tiền lệ của nhau.
//   · Với đơn chưa kiểm chứng, `taoLuc` chỉ là CẬN TRÊN của lúc mua thật (mua trước, nhập sau). Vì vậy quan hệ trước/sau của một CẶP chỉ CHẮC khi đơn đứng SAU theo K có giờ do máy chủ đặt
//     (xem `quanHeLanMua`); ngược lại KHÔNG BIẾT ⇒ giữ khoản (`BACKFILL_ORDER_TIME_UNVERIFIED`), không đoán. Dấu "chưa kiểm chứng" chỉ làm TĂNG số khoản bị giữ nên giả mạo nó không đem lại lợi gì.
//   · τ (`tau`) = ngày thu ĐẦU của ĐƠN đang xét — một DỮ LIỆU của đơn, nên mọi dòng và mọi khoản thu của đơn dùng
//     chung nó. Hàm KHÔNG nhận ngày thu của khoản vừa được quét, và không biết quét lúc nào.
//   · Tiền lệ E (đơn khác, K nhỏ hơn) rơi vào đúng MỘT trong ba loại — xem `xepLanMuaTruoc`:
//       TINH      — là lần mua thật               ⇒ RENEWAL
//       LOAI_BO   — đã huỷ / hoàn sạch ≤ τ, hoặc huỷ khi chưa từng thu ⇒ coi như chưa từng có
//       CHUA_CHOT — chưa thu đồng nào và đơn còn sống ⇒ KHÔNG ĐOÁN: giữ khoản, chờ E được thu hoặc huỷ
//   · Sự kiện xảy ra SAU τ (huỷ, hoàn) không viết lại lịch sử: hoàn sau khi B đã có tiền không lật B.
//
// LUẬT v4 (2026-10-17) — PHÉP SO HUỶ / HOÀN VỚI τ CŨNG KHÔNG TIN NGÀY DO NGƯỜI GHI KHAI (đóng nốt nửa còn lại của §4).
//
//   · Lỗ còn lại của v3: tiền lệ ĐÃ THU RỒI HUỶ / HOÀN còn là "lần mua thật" tại τ hay không phụ thuộc hai dữ kiện — τ (ngày thu dương đầu của đơn đang xét) và ngày của các khoản thu / hoàn của
//     tiền lệ — mà cả hai đều là ngày thu do NGƯỜI GHI tự khai, trong khi mốc huỷ là giờ máy chủ. Cùng một sự thật (A thu 05/09 rồi huỷ 20/09; B tạo 10/09) ra B = RENEWAL nếu B khai thu 15/09
//     và B = NEW nếu khai 25/09 — người hưởng hoa hồng chọn được. Đúng câu cấm «không để Sale / Finance lùi ngày thu rồi làm đổi NEW / RENEWAL».
//   · Cách đóng — FAIL-CLOSED, KHÔNG đoán: xếp tiền lệ bằng HAI cách đọc ngày thu (`xepLanMuaTruocAnToan`):
//       (1) theo NGÀY KHAI  — `KhoanThuLanMua.paidDate` và `tau`;
//       (2) theo GIỜ MÁY CHỦ ghi khoản thu — `KhoanThuLanMua.ghiLuc` (= `Payment.createdAt`) và `tauMay` (giờ máy chủ của khoản thu dương đầu của đơn đang xét).
//     Hai cách ra CÙNG một loại ⇒ dùng nó (mã của cách đọc (2)). KHÁC nhau ⇒ KHÔNG chọn: loại `PHU_THUOC_NGAY_KHAI`; nếu khi đó không còn tiền lệ CHẮC (TINH) nào khác thì khoản bị GIỮ
//     (`PRECEDENT_STATUS_DATE_DEPENDENT`) — còn có tiền lệ chắc khác thì RENEWAL như cũ vì kết quả không còn phụ thuộc tiền lệ mơ hồ ấy.
//   · Hệ quả (bất biến): người khai ngày KHÔNG BAO GIỜ làm ra NEW / RENEWAL khác với kết quả theo giờ máy chủ — họ chỉ có thể làm khoản bị GIỮ. Dữ liệu trung thực (ngày khai ≈ ngày ghi, không rơi
//     giữa hai mốc huỷ / hoàn) không đổi kết quả. `tau = null` ⇔ `tauMay = null` (cùng tập khoản thu dương) nên đơn chưa có tiền không bao giờ bị giữ vì lý do này.
//   · KHÔNG đổi kết quả của `StudentTransaction` đã CLASSIFIED (dòng cũ giữ phiên bản bộ luật cũ); chỉ khoản chưa phân loại đi qua luật này.
//
// LUẬT v5 (2026-10-17) — DÒNG THÊM MUỘN VÀO ĐƠN CÓ SẴN LÀ LẦN MUA RIÊNG; BẢO LƯU XÉT THEO CẢ HAI CÁCH ĐỌC NGÀY THU.
//
//   · Lỗ (reviewer tài chính vòng 5): khoá K của một dòng lấy `Order.createdAt` của ĐƠN CHỨA dòng. Dòng học phí được thêm vào đơn cũ (`themConVaoDonAction` — người có `orders:manage`) thừa kế
//     K của đơn cũ nên lần mua tái tục bị phân loại NEW 9% thay vì RENEWAL 2%; ngược lại nó còn làm lần mua THẬT đầu tiên (đơn A, K muộn hơn) bị coi là «sau» nó.
//   · Cách đóng — KHÔNG đoán theo khoảng cách giờ (đường nhập cũ cũng có dòng tạo muộn hơn đơn rất nhiều: `[NHH-TRX-D17]`): bộ nạp nhận diện dòng thêm muộn bằng dòng AuditLog `THEM_CON_VAO_DON` do
//     máy chủ ghi CÙNG transaction, đặt `taoLuc` = giờ dòng audit (máy chủ), cờ `themMuon`. Hai dòng cùng đơn mà một bên `themMuon` KHÔNG còn là «cùng một quyết định mua» (`cungLanMua`).
//     τ / τ máy chủ của dòng thêm muộn chỉ tính từ các khoản thu ghi SAU lúc dòng được thêm (khoản của anh/chị em trước đó không phải tiền của lần mua này).
//   · Bảo lưu (nửa cuối của luật v4): `baoLuuHieuLuc` đọc ở `tau` (ngày khai) VÀ `tauMay` (giờ máy chủ), dính một trong hai ⇒ BAO_LUU. Dữ liệu trung thực (ngày khai ≈ giờ ghi) không đổi kết quả.
//   · KHÔNG đổi kết quả của `StudentTransaction` đã CLASSIFIED (dòng cũ giữ phiên bản bộ luật cũ).
//
// Phân loại gắn với dòng đơn (`StudentTransaction.orderItemId @unique`) nên mọi khoản thu của cùng dòng thừa kế
// nó. Dòng sổ cũ sinh từ luật v1 KHÔNG bị sửa; chỉ khoản chưa phân loại mới đi qua luật này.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐƠN VỊ PHÂN LOẠI = MỘT LẦN MUA = MỘT `OrderItem` HỌC PHÍ, THEO HỌC VIÊN (không theo phụ huynh).
//
//   1. dòng không phải Học phí                                       → NGOAI_PHAM_VI
//   2. dính đổi khoá · chuyển cơ sở · bảo lưu · dừng học             → PENDING_REGULATION
//      dính chuyển lớp / không rõ chuyển gì                          → MANUAL_REVIEW_REQUIRED
//   3. không ra được học viên                                        → MANUAL_REVIEW_REQUIRED
//   4. ghi danh có `renewedFromEnrollmentId` (cờ tay)                → RENEWAL
//   5. học viên đã có lần mua KHÁC (đơn khác, K nhỏ hơn) mà TÍNH     → RENEWAL
//   6. lịch sử mua MƠ HỒ · có lần mua trước CHƯA CHỐT · có đơn mà THỨ TỰ
//      mua không kiểm chứng được · có ghi danh không nối đơn tạo trước → MANUAL_REVIEW_REQUIRED
//   7. còn lại                                                       → NEW
//
// Mọi đợt thu của CÙNG một `OrderItem` dùng chung kết quả: HĐ 12tr chia 3 đợt ⇒ NEW ×3. Đó là cách
// đọc "kỳ 1 của hợp đồng = NEW, kỳ 2+ = RENEWAL" / "học phần đầu NEW, học phần sau RENEWAL" của bộ
// tài liệu (04 §5.2): "kỳ"/"học phần" là LẦN MUA kế tiếp của học viên chứ không phải đợt thu. Câu
// hỏi mở Q3 (04) vẫn nằm đó; nếu chủ dự án đọc khác thì chỉ phải đổi bước 5 + nâng `BO_LUAT_PHAN_LOAI`
// — dòng đã phân loại giữ nguyên phiên bản bộ luật cũ (02 §8.3), không bị phân loại lại im lặng.
//
// ⚠️ THIẾU DỮ LIỆU ⇒ KHÔNG ĐOÁN. Mọi nhánh không chắc đi vào MANUAL_REVIEW, kèm `maLuat` + bằng
// chứng để người duyệt thấy vì sao.
//
// ⚠️ Bộ phân loại này KHÔNG có nhánh nào ra mã nâng cấp / bán chéo / quay lại — chúng chỉ là dòng
// master TẮT (`loai-giao-dich.ts`). Lưới `[NHH-TRX-05d]` canh điều đó trên chính mã nguồn.
//
// ⚠️ Đơn không có lead / `Student.leadId` NULL KHÔNG đổi NEW/RENEWAL: phân loại đi theo lịch sử mua
// CỦA HỌC VIÊN (`OrderItem.studentId` — bước 1 của 04 §4.4). Lead chỉ cần để dò "phụ huynh hiện hữu"
// (bằng chứng, Q20) và để tìm NGƯỜI HƯỞNG — vế sau là việc của sổ (PR5): 0 dòng cho vai thiếu người
// + hàng chờ mềm `UNRESOLVED_BENEFICIARY`, không phải xem tay phân loại (05 TRX-06).
import type { ThanhPhanDoanhThu } from "./loai-giao-dich";

/**
 * Phiên bản bộ luật phân loại — chụp lên `StudentTransaction.rulesetVersion` (02 §8.3). Đổi luật ⇒
 * nâng hằng này; dòng cũ GIỮ phiên bản cũ.
 */
export const BO_LUAT_PHAN_LOAI = "2026-10-17.v5";

// ── Đầu vào ─────────────────────────────────────────────────────────────────

export type DongPhanLoai = {
  orderItemId: string;
  orderId: string;
  thanhPhan: ThanhPhanDoanhThu;
  /** `OrderItem.status` — `STOPPED` = đã quyết toán dừng học. */
  trangThai: "ACTIVE" | "STOPPED";
  /** Thời điểm đơn được ghi nhận, do MÁY CHỦ đặt (`Order.createdAt`; đơn chưa kiểm chứng: giờ của dòng AuditLog tạo đơn) — nửa đầu của khoá thứ tự lần mua K = (taoLuc, orderId). Không phải `OrderItem.createdAt` (xem `[NHH-TRX-D17]`). */
  taoLuc: Date;
  /**
   * Đơn mà giờ tạo KHÔNG nói được lúc mua thật (ghi bù lead cũ · nhập giao dịch cũ): `taoLuc` chỉ là cận trên. BẮT BUỘC khai (luật 7 — quên là `tsc` báo, không phải lỗi câm).
   * Đừng suy từ `Payment.note` / `method` (người ghi tự gõ): bộ nạp nhận diện bằng AuditLog do máy chủ ghi.
   */
  gioTaoChuaKiem: boolean;
  /**
   * Luật v5 — dòng được THÊM MUỘN vào đơn có sẵn (`themConVaoDonAction`): nó là MỘT LẦN MUA RIÊNG, `taoLuc` là giờ máy chủ lúc dòng được thêm (không phải giờ của đơn cũ), và nó KHÔNG còn
   * «cùng một quyết định mua» với các dòng gốc của đơn (`cungLanMua`). BẮT BUỘC khai (luật 7). Bộ nạp nhận diện bằng AuditLog `THEM_CON_VAO_DON` do máy chủ ghi — không đoán theo khoảng cách giờ.
   */
  themMuon: boolean;
};

/** Mối nối chuyển ghi danh (`Enrollment.transferredToId`) nhìn từ một phía. */
export type LienKetChuyen = {
  enrollmentId: string;
  courseId: string;
  centerId: string | null;
};

export type GhiDanhPhanLoai = {
  id: string;
  courseId: string;
  centerId: string | null;
  /** `Enrollment.renewedFromEnrollmentId` — cờ tay "tái tục" (schema:2511). */
  renewedFromEnrollmentId: string | null;
  /** Ghi danh KHÁC đã chuyển SANG ghi danh này. */
  chuyenTu: readonly LienKetChuyen[];
  /** Ghi danh này đã chuyển SANG ghi danh khác. */
  chuyenDen: LienKetChuyen | null;
  /** Các lượt `StudentReserve` của ghi danh này (kể cả đã kết thúc). */
  baoLuu: readonly { batDau: Date; ketThuc: Date | null }[];
};

/**
 * Một khoản thực thu đã quy về một dòng (`WHERE_THUC_THU`: CONFIRMED dương + REFUNDED âm). `paidDate` là NGÀY THU nghiệp vụ do NGƯỜI GHI KHAI (sửa được, lùi / tiến tuỳ ý);
 * `ghiLuc` là giờ MÁY CHỦ ghi khoản (`Payment.createdAt`, người ghi không đặt được). BẮT BUỘC khai cả hai (luật 7): luật v4 xếp tiền lệ bằng cả hai cách đọc.
 */
export type KhoanThuLanMua = { id: string; paidDate: Date; amount: number; ghiLuc: Date };

/** Một lần mua KHÁC của cùng học viên (dòng học phí của đơn khác). */
export type LanMuaTruoc = {
  orderItemId: string;
  orderId: string;
  /** Thời điểm đơn được ghi nhận do máy chủ đặt — nửa đầu của khoá K (cùng nghĩa với `DongPhanLoai.taoLuc`). */
  taoLuc: Date;
  /** Cùng nghĩa với `DongPhanLoai.gioTaoChuaKiem`; hai bên cùng đưa vào `quanHeLanMua`. */
  gioTaoChuaKiem: boolean;
  /** Cùng nghĩa với `DongPhanLoai.themMuon`; hai bên cùng đưa vào `cungLanMua`. */
  themMuon: boolean;
  /** Đơn đã huỷ (`Order.status = CANCELLED`, trạng thái cuối — đơn huỷ không mở lại được). */
  daHuy: boolean;
  /** `Order.status` hiện tại — CHỈ để nói rõ trong lý do giữ khoản (đơn `COMPLETED` / `REFUNDED` không huỷ được). Không tham gia quyết định. */
  trangThaiDon: string;
  /**
   * Mốc huỷ = `OrderStatusHistory(toStatus = CANCELLED).createdAt`. `null` khi `daHuy` mà không có dòng lịch sử (dữ liệu cũ):
   * coi như huỷ TỪ ĐẦU — hành vi của luật v1, và là dữ liệu đã đóng băng (mọi đường huỷ hiện hành đều ghi lịch sử).
   */
  huyLuc: Date | null;
  /** Các khoản thực thu quy được cho dòng này. Thứ tự trong mảng KHÔNG có nghĩa (hàm tự sắp theo (paidDate, id)). */
  khoanThu: readonly KhoanThuLanMua[];
  /**
   * Không có khoản nào quy được cho dòng nhưng ĐƠN có khoản chưa gắn dòng và đơn có ≥2 dòng học phí
   * ⇒ không biết tiền ấy thuộc dòng nào ⇒ mơ hồ, không đoán (04 §4.3 bước 4).
   */
  moHo: boolean;
};

export type KetLanMuaTruoc = "TINH" | "LOAI_BO" | "CHUA_CHOT";
/** Kết quả xếp tiền lệ sau khi xét CẢ HAI cách đọc ngày thu (luật v4): thêm "không chọn được" khi hai cách ra hai loại khác nhau. */
export type KetLanMuaTruocAnToan = KetLanMuaTruoc | "PHU_THUOC_NGAY_KHAI";
export type MaKetLanMuaTruoc =
  | "DA_THU"
  | "HUY_KHONG_MOC"
  | "HUY_CHUA_TUNG_THU"
  | "HUY_TRUOC_MOC"
  | "HOAN_SACH_TRUOC_MOC"
  | "CHUA_THU_CHUA_HUY";

export type PhuHuynhHienHuu = {
  /** `null` = KHÔNG BIẾT (không có lead lẫn SĐT phụ huynh hợp lệ để dò). */
  hienHuu: boolean | null;
  can: "CUNG_LEAD" | "CUNG_SDT" | null;
};

export type DauVaoPhanLoai = {
  dong: DongPhanLoai;
  /** Học viên đã phân giải (04 §4.4); `null` = không ra được. */
  studentId: string | null;
  /** Ghi danh nối với dòng (`OrderItem.enrollmentId`). */
  ghiDanh: GhiDanhPhanLoai | null;
  /** Mọi dòng học phí KHÁC của cùng học viên (bộ phân loại tự lọc "tạo trước" + "đơn khác"). */
  lanMuaTruoc: readonly LanMuaTruoc[];
  /** Ghi danh của học viên KHÔNG nối `OrderItem` nào (nhập tay / dữ liệu cũ). */
  ghiDanhMoCoi: readonly { enrollmentId: string; taoLuc: Date }[];
  phuHuynh: PhuHuynhHienHuu;
  /** Đơn có `leadId` hoặc học viên có `leadId` — CHỈ là bằng chứng, không đổi kết quả. */
  coLead: boolean;
  /**
   * τ — ngày thu ĐẦU TIÊN (khoản thực thu dương) của ĐƠN chứa dòng này. BẮT BUỘC khai (không mặc định), nhưng được phép `null`:
   * `null` = đơn CHƯA có khoản thực thu nào (dự kiến cho khoản thu sắp tới) ⇒ mọi lần huỷ / hoàn sạch đã biết của tiền lệ tính là "trước",
   * và bảo lưu xét theo lượt còn MỞ. Không có đồng hồ nào ở đây: `null` là một sự thật về dữ liệu.
   * ⚠️ Tuyệt đối KHÔNG truyền ngày thu của khoản vừa quét vào đây — đó chính là lỗi v1 làm kết quả phụ thuộc giờ quét.
   */
  tau: Date | null;
  /**
   * τ theo GIỜ MÁY CHỦ — giờ ghi (`Payment.createdAt`) SỚM NHẤT trong các khoản thực thu dương của cùng ĐƠN. BẮT BUỘC khai (luật 7), được phép `null` với đúng nghĩa của `tau`
   * (đơn chưa có khoản thu dương; `tau` và `tauMay` null cùng lúc). Luật v4: phép so huỷ / hoàn của tiền lệ được tính LẠI theo mốc này; hai cách đọc khác kết quả ⇒ giữ khoản.
   * ⚠️ Cũng KHÔNG được truyền thời điểm của khoản vừa quét vào đây.
   */
  tauMay: Date | null;
};

// ── Đầu ra ──────────────────────────────────────────────────────────────────

export type BangChungPhanLoai = {
  /** Lần mua trước TÍNH (⇒ RENEWAL). */
  lanMuaTruocIds: string[];
  /** Lần mua trước CHƯA CHỐT (chưa thu đồng nào, đơn còn sống) ⇒ khoản bị giữ. */
  lanMuaChuaChotIds: string[];
  /** Đơn khác mà thứ tự mua so với dòng này KHÔNG kiểm chứng được (xem `quanHeLanMua`) và chưa bị loại ⇒ khoản bị giữ (`BACKFILL_ORDER_TIME_UNVERIFIED`). */
  lanMuaThuTuChuaKiemIds: string[];
  /** Lần mua trước BỊ LOẠI kèm lý do — để kiểm toán thấy vì sao một đơn trước KHÔNG làm khoản này thành RENEWAL. */
  lanMuaLoaiBo: { orderItemId: string; ma: MaKetLanMuaTruoc }[];
  /** τ dạng ISO (`null` = đơn chưa có khoản thu). Ghi lại để dựng lại được phân loại từ chính bằng chứng. */
  tau: string | null;
  /** τ theo giờ MÁY CHỦ dạng ISO (luật v4). Cùng `tau`, đủ để dựng lại CẢ HAI cách đọc. */
  tauTheoGioMay: string | null;
  /** Tiền lệ mà «còn là lần mua thật tại τ không» phụ thuộc cách đọc ngày thu (ngày khai ≠ giờ máy chủ) — luật v4. */
  lanMuaPhuThuocNgayKhaiIds: string[];
  lanMuaMoHoIds: string[];
  ghiDanhXungDotIds: string[];
  ghiDanhGocTaiTucId: string | null;
  /** Mọi dấu hiệu dính chuyển/bảo lưu/dừng học (kể cả cái không thắng), để ngăn "Vì sao" đủ. */
  dinh: string[];
  phuHuynhHienHuu: PhuHuynhHienHuu;
  coLead: boolean;
};

export type MaLuatPhanLoai =
  | "NGOAI_PHAM_VI"
  | "DOI_KHOA"
  | "CHUYEN_CO_SO"
  | "BAO_LUU"
  | "DUNG_HOC"
  | "CHUYEN_LOP"
  | "CHUYEN_KHONG_RO"
  | "KHONG_RA_HOC_VIEN"
  | "RENEWED_FROM_FLAG"
  | "PRIOR_PURCHASE"
  | "LICH_SU_MO_HO"
  | "PREVIOUS_PURCHASE_UNRESOLVED"
  | "PRECEDENT_STATUS_DATE_DEPENDENT"
  | "BACKFILL_ORDER_TIME_UNVERIFIED"
  | "GHI_DANH_KHONG_DON"
  | "FIRST_PURCHASE";

export type KetQuaPhanLoai =
  | {
      loai: "NEW" | "RENEWAL";
      trangThai: "CLASSIFIED";
      maLuat: MaLuatPhanLoai;
      lyDo: string;
      bangChung: BangChungPhanLoai;
    }
  | {
      loai: "MANUAL_REVIEW";
      trangThai: "MANUAL_REVIEW_REQUIRED" | "PENDING_REGULATION";
      maLuat: MaLuatPhanLoai;
      lyDo: string;
      bangChung: BangChungPhanLoai;
    }
  | {
      /** Dòng không phải học phí — không phải "phân loại" (04 §5.2 bước 1). */
      loai: "NGOAI_PHAM_VI";
      trangThai: "NGOAI_PHAM_VI";
      maLuat: "NGOAI_PHAM_VI";
      lyDo: string;
      bangChung: BangChungPhanLoai;
    };

// ── Hàm phụ ─────────────────────────────────────────────────────────────────

/**
 * Hai dòng có là CÙNG MỘT lần mua không (cùng đơn ⇒ cùng một quyết định mua, nên không là tiền lệ của nhau). Luật v5: chỉ đúng khi KHÔNG bên nào được thêm muộn — một dòng thêm muộn vào đơn
 * có sẵn là một quyết định mua MỚI, dù id đơn trùng. Chỗ DUY NHẤT trả lời câu này; `phanLoaiGiaoDich` và `tinhPhuHuynhHienHuu` cùng gọi (lưới `[NHH-TRX-W9]`).
 */
export function cungLanMua(a: { orderId: string; themMuon: boolean }, b: { orderId: string; themMuon: boolean }): boolean {
  return a.orderId === b.orderId && !a.themMuon && !b.themMuon;
}

export type QuanHeLanMua = "TRUOC_CHAC" | "SAU_CHAC" | "KHONG_BIET";

/**
 * Đơn `y` so với đơn `x` — CHẮC chắn trước, CHẮC chắn sau, hay KHÔNG BIẾT. Thuần, không đồng hồ, không đọc ngày do người nhập khai.
 *
 * `taoLuc` của đơn thường là lúc mua. `taoLuc` của đơn chưa kiểm chứng (`gioTaoChuaKiem`) chỉ là CẬN TRÊN: khách đã đóng tiền trước khi hệ thống ghi nhận, nên lúc mua thật ≤ `taoLuc`
 * và không ai biết sớm hơn bao nhiêu. Hệ quả: nếu đơn đứng SAU theo K là đơn thường thì đơn kia chắc chắn mua trước (mua ≤ nhập ≤ lúc đơn sau được tạo); nếu đơn đứng sau là đơn chưa kiểm chứng
 * thì nó có thể đã mua trước hoặc sau đơn kia ⇒ KHÔNG BIẾT. Hai đơn cùng chưa kiểm chứng ⇒ luôn KHÔNG BIẾT. (Hoà giờ phân xử bằng id đơn như `datTruoc` — vẫn là một dữ kiện máy chủ.)
 *
 * Đây là chỗ DUY NHẤT trả lời "đơn này trước đơn kia" cho phân loại; `phanLoaiGiaoDich` và `tinhPhuHuynhHienHuu` cùng gọi.
 */
export function quanHeLanMua(y: { taoLuc: Date; orderId: string; gioTaoChuaKiem: boolean }, x: { taoLuc: Date; orderId: string; gioTaoChuaKiem: boolean }): QuanHeLanMua {
  const yTruoc = datTruoc(y, x);
  const donDungSau = yTruoc ? x : y;
  if (donDungSau.gioTaoChuaKiem) return "KHONG_BIET";
  return yTruoc ? "TRUOC_CHAC" : "SAU_CHAC";
}

/**
 * `a` nằm TRƯỚC `b` theo khoá K = (Order.createdAt, Order.id) — hoà giờ thì id ĐƠN nhỏ hơn đứng trước, nên hai đơn khác nhau
 * luôn có đúng một bên đứng trước. (Id DÒNG đơn không tham gia: hai dòng cùng đơn không là tiền lệ của nhau, nên không cần.)
 */
function datTruoc(a: { taoLuc: Date; orderId: string }, b: { taoLuc: Date; orderId: string }): boolean {
  const ta = a.taoLuc.getTime();
  const tb = b.taoLuc.getTime();
  if (ta !== tb) return ta < tb;
  return a.orderId < b.orderId;
}

/**
 * Xếp MỘT tiền lệ vào đúng một trong ba loại, chỉ dựa trên dữ kiện CÓ MỐC + τ. Thuần, không phụ thuộc thứ tự mảng đầu vào.
 *
 *   1. đã huỷ mà KHÔNG có mốc huỷ (dữ liệu cũ)                       → LOAI_BO  (huỷ từ đầu — như luật v1)
 *   2. đã huỷ và chưa từng có khoản thu dương                         → LOAI_BO  (không phát sinh mua thật, dù huỷ lúc nào)
 *   3. đã huỷ với mốc ≤ τ                                             → LOAI_BO
 *   4. từng có thu dương ≤ τ và Σ khoản thu có ngày ≤ τ ≤ 0 (hoàn sạch) → LOAI_BO
 *   5. từng có khoản thu dương (bất kể ngày)                          → TINH
 *   6. còn lại: chưa thu đồng nào và đơn còn sống                     → CHUA_CHOT
 *
 * Huỷ / hoàn có mốc > τ KHÔNG làm tiền lệ biến mất: lúc khoản đang xét có tiền, tiền lệ vẫn là lần mua thật; hoàn muộn không
 * viết lại lịch sử (và vì thế kết quả như nhau dù khoản đang xét được quét sớm hay muộn). Tiền lệ chỉ được thu SAU τ (đơn tạo
 * trước nhưng thu muộn) vẫn TÍNH — thứ tự mua là thứ tự đơn.
 * `tau = null` ⇒ mọi mốc đã biết đều tính là "≤ τ" (xem `DauVaoPhanLoai.tau`).
 */
export function xepLanMuaTruoc(
  l: Pick<LanMuaTruoc, "daHuy" | "huyLuc" | "khoanThu">,
  tau: Date | null,
): { ket: KetLanMuaTruoc; ma: MaKetLanMuaTruoc } {
  return xepTheoCachDoc(l, tau, (k) => k.paidDate);
}

/** MỘT cách đọc ngày thu: `ngayCuaKhoan` quyết ngày nào của khoản đem so với `tau`. Mốc huỷ (`huyLuc`) là giờ máy chủ nên cả hai cách đọc dùng chung. */
function xepTheoCachDoc(
  l: Pick<LanMuaTruoc, "daHuy" | "huyLuc" | "khoanThu">,
  tau: Date | null,
  ngayCuaKhoan: (k: KhoanThuLanMua) => Date,
): { ket: KetLanMuaTruoc; ma: MaKetLanMuaTruoc } {
  const truocTau = (d: Date) => tau === null || d.getTime() <= tau.getTime();
  const tungThuDuong = l.khoanThu.some((k) => k.amount > 0);
  if (l.daHuy) {
    if (l.huyLuc === null) return { ket: "LOAI_BO", ma: "HUY_KHONG_MOC" };
    if (!tungThuDuong) return { ket: "LOAI_BO", ma: "HUY_CHUA_TUNG_THU" };
    if (truocTau(l.huyLuc)) return { ket: "LOAI_BO", ma: "HUY_TRUOC_MOC" };
  }
  const daThuTruocTau = l.khoanThu.filter((k) => truocTau(ngayCuaKhoan(k)));
  if (daThuTruocTau.some((k) => k.amount > 0) && daThuTruocTau.reduce((s, k) => s + k.amount, 0) <= 0) {
    return { ket: "LOAI_BO", ma: "HOAN_SACH_TRUOC_MOC" };
  }
  if (tungThuDuong) return { ket: "TINH", ma: "DA_THU" };
  return { ket: "CHUA_CHOT", ma: "CHUA_THU_CHUA_HUY" };
}

export type XepLanMuaAnToan =
  | { ket: KetLanMuaTruoc; ma: MaKetLanMuaTruoc }
  | { ket: "PHU_THUOC_NGAY_KHAI"; ma: "PHU_THUOC_NGAY_KHAI" };

/**
 * LUẬT v4 — xếp MỘT tiền lệ bằng HAI cách đọc ngày thu và KHÔNG chọn khi chúng khác nhau. Đây là cách DUY NHẤT `phanLoaiGiaoDich` / `tinhPhuHuynhHienHuu` xếp tiền lệ (gọi `xepLanMuaTruoc` trực tiếp
 * là quay lại lỗ cũ: kết quả phụ thuộc ngày người ghi khai — lưới `[NHH-TRX-W10]` canh).
 *
 *   (1) theo NGÀY KHAI  — `paidDate` của từng khoản + `taus.tau`        (`xepLanMuaTruoc`)
 *   (2) theo GIỜ MÁY CHỦ — `ghiLuc` của từng khoản   + `taus.tauMay`
 *
 * Cùng loại ⇒ trả kết quả của cách đọc (2) (mã cũng do giờ máy chủ quyết, nên nhãn lưu vào bằng chứng không phụ thuộc ngày khai). Khác loại ⇒ `PHU_THUOC_NGAY_KHAI`.
 * Thuần, tất định, không phụ thuộc thứ tự mảng khoản thu (các phép lọc / cộng đều giao hoán).
 */
export function xepLanMuaTruocAnToan(
  l: Pick<LanMuaTruoc, "daHuy" | "huyLuc" | "khoanThu">,
  taus: { tau: Date | null; tauMay: Date | null },
): XepLanMuaAnToan {
  const theoNgayKhai = xepLanMuaTruoc(l, taus.tau);
  const theoGioMay = xepTheoCachDoc(l, taus.tauMay, (k) => k.ghiLuc);
  if (theoNgayKhai.ket !== theoGioMay.ket) return { ket: "PHU_THUOC_NGAY_KHAI", ma: "PHU_THUOC_NGAY_KHAI" };
  return theoGioMay;
}

/**
 * Phụ huynh đã là khách HIỆN HỮU chưa (04 §5.2 "Bằng chứng PH hiện hữu"): có học viên KHÁC cùng lead
 * hoặc cùng SĐT phụ huynh chuẩn hoá, đã có lần mua THẬT (cùng vị từ `xepLanMuaTruoc` với phân loại) ở ĐƠN KHÁC, K nhỏ hơn dòng đang xét.
 *
 * Chỉ là BẰNG CHỨNG (ghi vào `StudentTransaction.evidence`) — không đổi NEW/RENEWAL của bé này, và KHÔNG tạo hàng chờ:
 * anh/chị còn lần mua CHƯA CHỐT thì kết quả là `null` (KHÔNG BIẾT), không phải `false`.
 * Hệ quả tiền (loại Marketing cho bé 2) nằm ở 04 Q20, chưa áp.
 */
export function tinhPhuHuynhHienHuu(input: {
  dong: Pick<DongPhanLoai, "orderItemId" | "orderId" | "taoLuc" | "gioTaoChuaKiem" | "themMuon">;
  ungVien: readonly {
    studentId: string;
    cungLead: boolean;
    cungSdt: boolean;
    lanMua: readonly LanMuaTruoc[];
  }[];
  /** Có lead hoặc SĐT phụ huynh hợp lệ để dò không. */
  coDinhDanh: boolean;
  /** τ của dòng đang xét — cùng giá trị đưa vào `phanLoaiGiaoDich`. Không mặc định (luật 7). */
  tau: Date | null;
  /** τ theo giờ máy chủ — cùng giá trị đưa vào `phanLoaiGiaoDich` (luật v4). Không mặc định (luật 7). */
  tauMay: Date | null;
}): PhuHuynhHienHuu {
  const truocDong = (l: LanMuaTruoc) => !cungLanMua(l, input.dong) && quanHeLanMua(l, input.dong) === "TRUOC_CHAC";
  const coKet = (u: { lanMua: readonly LanMuaTruoc[] }, ket: KetLanMuaTruocAnToan) =>
    u.lanMua.some((l) => truocDong(l) && xepLanMuaTruocAnToan(l, { tau: input.tau, tauMay: input.tauMay }).ket === ket);
  const coBangChung = (u: { lanMua: readonly LanMuaTruoc[] }) => coKet(u, "TINH");

  const cungLead = input.ungVien.some((u) => u.cungLead && coBangChung(u));
  if (cungLead) return { hienHuu: true, can: "CUNG_LEAD" };
  const cungSdt = input.ungVien.some((u) => u.cungSdt && coBangChung(u));
  if (cungSdt) return { hienHuu: true, can: "CUNG_SDT" };
  // Anh/chị cùng lead / SĐT còn một lần mua chưa chốt — hoặc một lần mua mà «còn là lần mua thật không» phụ thuộc ngày người ghi khai (luật v4) ⇒ chưa thể nói "không".
  if (input.ungVien.some((u) => (u.cungLead || u.cungSdt) && (coKet(u, "CHUA_CHOT") || coKet(u, "PHU_THUOC_NGAY_KHAI")))) return { hienHuu: null, can: null };
  // Không tìm thấy bằng chứng: chỉ được khẳng định "không" khi CÓ cách dò (lead hoặc SĐT).
  return input.coDinhDanh ? { hienHuu: false, can: null } : { hienHuu: null, can: null };
}

/** Bảo lưu có hiệu lực tại τ không. `tau = null` (đơn chưa có khoản thu) ⇒ xét theo lượt còn MỞ (`ketThuc = null`). */
function baoLuuHieuLuc(baoLuu: GhiDanhPhanLoai["baoLuu"], tau: Date | null): boolean {
  if (tau === null) return baoLuu.some((b) => b.ketThuc === null);
  const m = tau.getTime();
  return baoLuu.some((b) => b.batDau.getTime() <= m && (b.ketThuc === null || b.ketThuc.getTime() > m));
}

/** Nhận diện loại chuyển của một mối nối so với ghi danh hiện tại. */
function loaiChuyen(g: GhiDanhPhanLoai, lk: LienKetChuyen): "DOI_KHOA" | "CHUYEN_CO_SO" | "CHUYEN_KHONG_RO" | "CHUYEN_LOP" {
  if (lk.courseId !== g.courseId) return "DOI_KHOA";
  if (lk.centerId === null || g.centerId === null) return "CHUYEN_KHONG_RO";
  if (lk.centerId !== g.centerId) return "CHUYEN_CO_SO";
  return "CHUYEN_LOP";
}

const sapXep = (xs: readonly string[]): string[] => [...xs].sort();

// ── Hàm chính ───────────────────────────────────────────────────────────────

/**
 * Phân loại MỘT lần mua (một `OrderItem`) theo học viên. Hàm THUẦN, tất định, không sửa đầu vào.
 */
export function phanLoaiGiaoDich(d: DauVaoPhanLoai): KetQuaPhanLoai {
  const g = d.ghiDanh;

  // Các lần mua KHÁC (cùng đơn = cùng một quyết định mua, TRỪ dòng thêm muộn — luật v5, `cungLanMua`). Quan hệ thứ tự với dòng này: CHẮC trước → tiền lệ; KHÔNG BIẾT → xét riêng bên dưới; CHẮC sau → bỏ.
  // Mỗi tiền lệ xếp vào MỘT trong ba loại theo τ.
  const khac = d.lanMuaTruoc.filter((l) => !cungLanMua(l, d.dong));
  const truocs = khac.filter((l) => quanHeLanMua(l, d.dong) === "TRUOC_CHAC");
  // Luật v4: xếp bằng CẢ HAI cách đọc ngày thu (ngày khai · giờ máy chủ); khác nhau ⇒ `PHU_THUOC_NGAY_KHAI` (không chọn).
  const haiTau = { tau: d.tau, tauMay: d.tauMay };
  const xep = truocs.map((l) => ({ l, x: xepLanMuaTruocAnToan(l, haiTau) }));
  // Đơn mà thứ tự mua KHÔNG kiểm chứng được. Đơn đã bị LOẠI (huỷ khi chưa từng thu · hoàn sạch ≤ τ — ở CẢ HAI cách đọc) thì trước hay sau cũng không làm đổi kết quả ⇒ không cản.
  const thuTuChuaKiem = khac.filter((l) => quanHeLanMua(l, d.dong) === "KHONG_BIET" && xepLanMuaTruocAnToan(l, haiTau).ket !== "LOAI_BO");
  const chac = xep.filter((e) => e.x.ket === "TINH").map((e) => e.l);
  const loaiBo = xep.flatMap((e) => (e.x.ket === "LOAI_BO" ? [{ orderItemId: e.l.orderItemId, ma: e.x.ma }] : []));
  const phuThuocNgayKhai = xep.filter((e) => e.x.ket === "PHU_THUOC_NGAY_KHAI").map((e) => e.l);
  const moHo = xep.filter((e) => e.l.moHo && !e.l.daHuy && e.x.ket !== "TINH").map((e) => e.l);
  const chuaChot = xep.filter((e) => e.x.ket === "CHUA_CHOT" && !e.l.moHo).map((e) => e.l);
  const xungDot = d.ghiDanhMoCoi.filter((e) => e.taoLuc.getTime() < d.dong.taoLuc.getTime());

  // Mọi dấu hiệu dính chuyển / bảo lưu / dừng học.
  const dinh: string[] = [];
  const loaiChuyenGap = new Set<string>();
  if (g) {
    for (const lk of [...g.chuyenTu, ...(g.chuyenDen ? [g.chuyenDen] : [])]) loaiChuyenGap.add(loaiChuyen(g, lk));
    for (const l of sapXep([...loaiChuyenGap])) dinh.push(l);
    // Luật v5: bảo lưu xét ở CẢ ngày khai (`tau`) LẪN giờ máy chủ (`tauMay`); dính MỘT TRONG HAI ⇒ giữ. Nếu chỉ đọc ngày khai thì người ghi khoản thu chọn được «giữ 0đ» hay «trả đủ tỉ lệ».
    if (baoLuuHieuLuc(g.baoLuu, d.tau) || baoLuuHieuLuc(g.baoLuu, d.tauMay)) dinh.push("BAO_LUU");
  }
  if (d.dong.trangThai === "STOPPED") dinh.push("DUNG_HOC");

  const bangChung: BangChungPhanLoai = {
    lanMuaTruocIds: sapXep(chac.map((l) => l.orderItemId)),
    lanMuaChuaChotIds: sapXep(chuaChot.map((l) => l.orderItemId)),
    lanMuaThuTuChuaKiemIds: sapXep(thuTuChuaKiem.map((l) => l.orderItemId)),
    lanMuaLoaiBo: [...loaiBo].sort((a, b) => (a.orderItemId < b.orderItemId ? -1 : a.orderItemId > b.orderItemId ? 1 : 0)),
    tau: d.tau === null ? null : d.tau.toISOString(),
    tauTheoGioMay: d.tauMay === null ? null : d.tauMay.toISOString(),
    lanMuaPhuThuocNgayKhaiIds: sapXep(phuThuocNgayKhai.map((l) => l.orderItemId)),
    lanMuaMoHoIds: sapXep(moHo.map((l) => l.orderItemId)),
    ghiDanhXungDotIds: sapXep(xungDot.map((e) => e.enrollmentId)),
    ghiDanhGocTaiTucId: g?.renewedFromEnrollmentId ?? null,
    dinh,
    phuHuynhHienHuu: d.phuHuynh,
    coLead: d.coLead,
  };

  // 1 — ngoài phạm vi.
  if (d.dong.thanhPhan !== "TUITION") {
    return {
      loai: "NGOAI_PHAM_VI",
      trangThai: "NGOAI_PHAM_VI",
      maLuat: "NGOAI_PHAM_VI",
      lyDo: `Dòng thành phần ${d.dong.thanhPhan} không phải Học phí — không nằm trong cơ sở tính hoa hồng (D17).`,
      bangChung,
    };
  }

  // 2 — ca dính văn bản chưa có: PENDING_REGULATION trước, xem tay sau.
  const pending = (
    ["DOI_KHOA", "CHUYEN_CO_SO", "BAO_LUU", "DUNG_HOC"] as const
  ).find((m) => dinh.includes(m));
  if (pending) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "PENDING_REGULATION",
      maLuat: pending,
      lyDo: LY_DO_PENDING[pending],
      bangChung,
    };
  }
  const xemTayChuyen = (["CHUYEN_KHONG_RO", "CHUYEN_LOP"] as const).find((m) => dinh.includes(m));
  if (xemTayChuyen) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: xemTayChuyen,
      lyDo: LY_DO_XEM_TAY[xemTayChuyen],
      bangChung,
    };
  }

  // 3 — không ra học viên.
  if (d.studentId === null) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "KHONG_RA_HOC_VIEN",
      lyDo: "Không xác định được học viên của dòng học phí này (OrderItem.studentId, ghi danh, con của lead đều không ra).",
      bangChung,
    };
  }

  // 4 — cờ tái tục (tay) trên ghi danh.
  if (g?.renewedFromEnrollmentId) {
    return {
      loai: "RENEWAL",
      trangThai: "CLASSIFIED",
      maLuat: "RENEWED_FROM_FLAG",
      lyDo: `Ghi danh được đánh dấu tái tục từ ghi danh ${g.renewedFromEnrollmentId}.`,
      bangChung,
    };
  }

  // 5 — học viên đã có lần mua khác.
  if (chac.length > 0) {
    return {
      loai: "RENEWAL",
      trangThai: "CLASSIFIED",
      maLuat: "PRIOR_PURCHASE",
      lyDo: `Học viên đã có ${chac.length} lần mua học phí trước đó (đơn khác, có thực thu): ${bangChung.lanMuaTruocIds.join(", ")}.`,
      bangChung,
    };
  }

  // 6 — bằng chứng mơ hồ / xung đột.
  if (moHo.length > 0) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "LICH_SU_MO_HO",
      lyDo: `Lần mua trước (${bangChung.lanMuaMoHoIds.join(", ")}) có khoản thu chưa gắn dòng nào trong đơn nhiều dòng học phí — không biết tiền thuộc dòng nào, không đoán.`,
      bangChung,
    };
  }
  if (chuaChot.length > 0) {
    const donChuaChot = sapXep(chuaChot.map((l) => `${l.orderId} [${l.trangThaiDon}]`));
    // `COMPLETED` / `REFUNDED` là trạng thái cuối nhưng KHÔNG huỷ được (state machine `lib/orders/status.ts`): đơn như vậy chưa từng thu thì chỉ nhả khi có khoản thu dương.
    const khongHuyDuoc = chuaChot.some((l) => l.trangThaiDon === "COMPLETED" || l.trangThaiDon === "REFUNDED");
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "PREVIOUS_PURCHASE_UNRESOLVED",
      lyDo: `Học viên có lần mua trước (đơn ${donChuaChot.join(", ")}) tạo trước đơn này nhưng CHƯA thu đồng nào và chưa huỷ — chưa biết đó có phải lần mua thật không, nên không đoán NEW hay RENEWAL. Khoản được GIỮ; tự nhả khi đơn ấy được thu (khoản này thành RENEWAL) hoặc huỷ (thành NEW).${khongHuyDuoc ? " Đơn COMPLETED / REFUNDED không huỷ được: chỉ nhả khi có khoản thu — nếu đó là đơn miễn phí / dữ liệu cũ thì cần quyết định nghiệp vụ (04 §5.2)." : " Đơn bỏ quên thì huỷ đơn ấy."}`,
      bangChung,
    };
  }
  if (phuThuocNgayKhai.length > 0) {
    const donPhuThuoc = sapXep(phuThuocNgayKhai.map((l) => `${l.orderId} [${l.trangThaiDon}]`));
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "PRECEDENT_STATUS_DATE_DEPENDENT",
      lyDo: `Học viên có lần mua trước (đơn ${donPhuThuoc.join(", ")}) đã thu tiền rồi bị huỷ / hoàn, và việc nó CÒN là lần mua thật tại lúc đơn này có tiền hay không đổi kết quả tuỳ đọc ngày thu theo NGÀY NGƯỜI GHI KHAI hay theo GIỜ MÁY CHỦ ghi khoản thu. Ngày do người ghi khai không được quyết NEW hay RENEWAL (luật v4), nên khoản được GIỮ — không đoán. Không tự nhả: hết giữ khi hai cách đọc ra cùng một kết quả (người có thẩm quyền đối chiếu chứng từ và sửa ngày thu / ngày hoàn khai sai) — hiện chưa có đường quyết tay trên giao diện: việc vận hành.`,
      bangChung,
    };
  }
  if (thuTuChuaKiem.length > 0) {
    const donChuaKiem = sapXep(thuTuChuaKiem.map((l) => l.orderId));
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED",
      lyDo: `Học viên có đơn (${donChuaKiem.join(", ")}) mà thời điểm mua KHÔNG được kiểm chứng (đơn ghi bù / nhập giao dịch cũ: hệ thống chỉ biết giờ ghi nhận, ngày mua thật do người nhập khai) — đơn ấy có thể đã mua trước hoặc sau đơn này, nên không biết đâu là lần mua đầu và không đoán NEW hay RENEWAL. Khoản được GIỮ; không tự nhả vì không dữ liệu nào trong hệ thống giải được (trừ khi đơn ấy bị huỷ khi chưa từng thu) — cần người có thẩm quyền xác nhận thứ tự mua (hiện chưa có đường quyết tay trên giao diện: việc vận hành).`,
      bangChung,
    };
  }
  if (xungDot.length > 0) {
    return {
      loai: "MANUAL_REVIEW",
      trangThai: "MANUAL_REVIEW_REQUIRED",
      maLuat: "GHI_DANH_KHONG_DON",
      lyDo: `Học viên có ghi danh không nối đơn nào, tạo trước dòng này (${bangChung.ghiDanhXungDotIds.join(", ")}) — xung đột bằng chứng giữa "chưa từng mua" và "đã học".`,
      bangChung,
    };
  }

  // 7 — lần mua đầu.
  return {
    loai: "NEW",
    trangThai: "CLASSIFIED",
    maLuat: "FIRST_PURCHASE",
    lyDo: "Lần mua học phí đầu tiên của học viên (không có lần mua thật nào trước đó, không có cờ tái tục).",
    bangChung,
  };
}

const LY_DO_PENDING = {
  DOI_KHOA: "Dòng/ghi danh dính ĐỔI KHOÁ — chưa có văn bản quy định hoa hồng cho trường hợp này (04 §5.2 bước 2).",
  CHUYEN_CO_SO: "Dòng/ghi danh dính CHUYỂN CƠ SỞ — chưa có văn bản quy định (04 §5.2 bước 2).",
  BAO_LUU: "Ghi danh đang BẢO LƯU tại thời điểm thu — chưa có văn bản quy định (04 §5.2 bước 2).",
  DUNG_HOC: "Dòng đã DỪNG HỌC mà vẫn phát sinh khoản thu mới — chưa có văn bản quy định (04 §5.2 bước 2).",
} as const;

const LY_DO_XEM_TAY = {
  CHUYEN_LOP: "Ghi danh dính CHUYỂN LỚP (cùng khoá, cùng cơ sở) — chưa có văn bản nhận diện, người duyệt quyết (04 Q21).",
  CHUYEN_KHONG_RO: "Ghi danh dính chuyển nhưng thiếu cơ sở của một bên — không phân biệt được chuyển lớp với chuyển cơ sở, không đoán.",
} as const;
