// lib/payments/pos/huy-phieu-the-cau.ts — CHỮ + HẰNG của nút "Huỷ phiếu thẻ" (Việc 4 · 09/10/2026). THUẦN, TỆP LÁ.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §6. MỘT tệp văn bản cho CẢ máy chủ lẫn giao diện: câu máy chủ ném và câu màn
// in là CÙNG chuỗi (luật 12 — hai nơi tự gõ hai câu là hai nơi có ngày cãi nhau). Tệp này KHÔNG import gì (kể cả
// `phieu-pos-luat.ts`, `thong-diep-pos.ts`): chúng import NÓ, nên import ngược là vòng.
//
// ⚠️ ĐÂY LÀ HỢP ĐỒNG giữa phía máy chủ (S) và phía giao diện (U) — ĐÓNG BĂNG sau commit hợp đồng. Đổi một chữ ở đây
// phải qua người điều phối: các ca `[HN4-*]` so NGUYÊN VĂN, và chữ của chủ dự án (đánh dấu "NGUYÊN VĂN") không được sửa.
// VIỆC 6 · a2 (10/10/2026, chủ dự án chốt "kế toán từ chối thì sale HUỶ ĐƯỢC phiếu thẻ"): mã `SAI_MA_BI_TU_CHOI` + cặp câu của nó ĐÃ GỠ (còn 16 mã); câu `CO_YEU_CAU_SAI_MA` viết lại cho đúng hai kết cục.

// ─────────────────────────────────────────────────────────────────────────────
// 1 · LÝ DO HUỶ (chọn nhanh) — hằng + nhãn. `z.enum` (lib/validators/huy-phieu-the.ts) đọc đúng tuple này.
// ─────────────────────────────────────────────────────────────────────────────

export const MA_LY_DO_HUY_PHIEU_THE = ["KHACH_DOI_CACH_TRA", "MO_NHAM", "KHAC"] as const;
export type MaLyDoHuyPhieuThe = (typeof MA_LY_DO_HUY_PHIEU_THE)[number];

/** `Record` ⇒ thêm một mã mà quên nhãn là `tsc` đỏ. */
export const NHAN_LY_DO_HUY_PHIEU_THE: Record<MaLyDoHuyPhieuThe, string> = {
  KHACH_DOI_CACH_TRA: "Khách đổi cách trả",
  MO_NHAM: "Mở nhầm / nhập nhầm số tiền",
  KHAC: "Khác",
};

/** Ghi chú tự do tối đa (đặc tả: ≤ 200 ký tự). */
export const GHI_CHU_HUY_TOI_DA = 200;
/** Chọn "Khác" thì ghi chú là BẮT BUỘC — "Khác" trơn không nói được gì cho người đọc nhật ký. */
export const GHI_CHU_KHAC_TOI_THIEU = 3;

// ─────────────────────────────────────────────────────────────────────────────
// 2 · XÁC NHẬN MẠNH — khi hệ thống KHÔNG chứng minh được "khách chưa quẹt"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NGUYÊN VĂN chủ dự án chốt 09/10/2026. In trong hộp xác nhận khi `canXacNhanManh` — hôm nay là MỌI ca cho huỷ
 * (TỰ QUYẾT V4.3: chưa kiểm lần nào · "Chưa thấy giao dịch" · lần quẹt gần nhất thất bại — ca nào cũng không loại trừ được
 * một lần quẹt thành công mà dữ liệu chưa về, nhất là chế độ file).
 */
export const CAU_XAC_NHAN_MANH_HUY_PHIEU_THE =
  "Chỉ huỷ khi chắc khách CHƯA quẹt (hoặc đã huỷ giao dịch trên máy). Nếu khách đã quẹt thành công, khoản tiền về sau sẽ vào hàng chờ gắn tay của kế toán.";

/** Nhãn ô tick bắt buộc trong hộp xác nhận mạnh — tick ⇒ gửi `xacNhanKhachChuaQuet: true`. */
export const NHAN_TICK_XAC_NHAN_MANH = "Tôi chắc khách chưa quẹt thẻ (hoặc đã huỷ giao dịch trên máy)";

/**
 * Câu MÁY CHỦ trả khi `canXacNhanManh` mà `xacNhanKhachChuaQuet` không phải `true`. Máy chủ quyết "có cần xác nhận mạnh
 * không" bằng `choPhepHuyPhieuThe` đọc LẠI dưới khoá — KHÔNG tin cờ màn đã nạp: màn nói "thường" lúc 10:00, lúc 10:02 người
 * khác bấm Kiểm tra làm kết quả đổi ⇒ máy chủ đòi tick. Màn nhận câu này thì làm mới trang (khuôn V24 của Việc 1).
 */
export const CAU_THIEU_XAC_NHAN_MANH =
  "Chưa có kết quả quẹt thẻ rõ ràng — tick xác nhận “khách chưa quẹt thẻ” rồi huỷ lại";

/**
 * Hậu quả của việc huỷ — nói THẬT (đặc tả 5): chỉ phiếu thẻ đóng; mã và phiếu gộp còn nguyên.
 *
 * VIỆC 4 rà đối kháng 09/10/2026 (TỰ QUYẾT V4.15, câu này là của hợp đồng chứ KHÔNG phải chữ nguyên văn của chủ dự án):
 *   · bản cũ hứa vô điều kiện "QR dùng được, bấm Thẻ POS sẽ mở phiếu thẻ mới" — sai đúng ở hai trạng thái mà V4.13 cố ý cho
 *     huỷ (cờ `billing.flexV1Enabled` tắt · đơn chờ duyệt: đường TẠO bị từ chối) ⇒ chỉ nói điều chắc chắn, phần còn lại có điều kiện;
 *   · thêm vế RỦI RO TIỀN đáng sợ nhất, mà `CAU_XAC_NHAN_MANH` (nguyên văn chủ dự án) chỉ nói một nửa (nó nói "vào hàng chờ gắn tay",
 *     không nói khách bị trừ HAI lần nếu sale phát QR/mã mới cho một khoản đã quẹt).
 */
export function cauHauQuaHuyPhieuThe(code5: string): string {
  return (
    `Phiếu thẻ mã ${code5} sẽ đóng lại; mã và phiếu gộp giữ nguyên. ` +
    "Cần thu thẻ lại thì bấm “Thẻ POS” — phiếu mới dùng lại mã này (khi cơ sở đang bật thu thẻ và đơn đã được duyệt). " +
    "Nếu khách đã quẹt rồi mà vẫn thu thêm bằng QR hoặc mã mới, khách sẽ bị trừ hai lần cho tới khi kế toán hoàn."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · NHÃN NÚT + THÔNG BÁO
// ─────────────────────────────────────────────────────────────────────────────

export const NHAN_NUT_HUY_PHIEU_THE = "Huỷ phiếu thẻ";
export const NHAN_NUT_XAC_NHAN_HUY_PHIEU_THE = "Xác nhận huỷ phiếu thẻ";
/** Câu khi chưa chọn lý do (nút xác nhận khoá, hoặc `title` của nó). */
export const CAU_CHUA_CHON_LY_DO_HUY = "Chọn lý do huỷ phiếu thẻ";

export function cauDaHuyPhieuThe(code5: string): string {
  return `Đã huỷ phiếu thẻ mã ${code5}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · VÌ SAO KHÔNG HUỶ ĐƯỢC — mỗi mã một cặp (lý do · việc nên làm)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mã từ chối của `choPhepHuyPhieuThe` (`huy-phieu-the.ts`). Tuple ở ĐÂY (không ở tệp luật) để tệp văn bản là lá.
 * Nhóm: tiền đã vào/đang chờ kế toán · phiếu đã đóng không vì tiền · dấu hiệu tiền đang bay · kết quả lượt kiểm gần
 * nhất "chưa chốt được" · không còn gì để huỷ.
 */
export const MA_TU_CHOI_HUY_PHIEU_THE = [
  "DA_THU",
  "LECH_TIEN",
  "CAN_XU_LY",
  "DA_HUY",
  "DA_HET_HAN",
  "DA_NHAN_GIAO_DICH",
  "CO_GIAO_DICH_CHO_TAY",
  "CO_YEU_CAU_SAI_MA",
  "DONG_THE_CHUA_NGA_NGU",
  "KET_QUA_PAID_CHUA_GHI",
  "KET_QUA_PAID_SAU_THAT_BAI",
  "HUY_SAU_THU",
  "LOI_KET_NOI",
  "CHUA_NGA_NGU",
  "PHIEU_GOP_DA_DONG",
  "QUA_HAN_CHO_DONG",
] as const;
export type MaTuChoiHuyPhieuThe = (typeof MA_TU_CHOI_HUY_PHIEU_THE)[number];

export type CauTuChoiHuy = { lyDo: string; viecNenLam: string };

/**
 * `Record` ⇒ thêm một mã từ chối mà quên câu là `tsc` đỏ. `lyDo` không kết thúc bằng dấu chấm; `viecNenLam` có.
 *
 * ⚠️ Câu của phiếu còn MỞ đứng cạnh `lastResultMessage` (câu lưu của lượt kiểm) trên cùng một hộp — hai câu KHÔNG được nói
 * ngược nhau. `KET_QUA_PAID_SAU_THAT_BAI` vì thế cố ý không nói "quẹt lại" theo chiều nào (xem V4.4).
 */
export const CAU_TU_CHOI_HUY_PHIEU_THE: Record<MaTuChoiHuyPhieuThe, CauTuChoiHuy> = {
  DA_THU: {
    lyDo: "Phiếu thẻ này đã thu rồi — tiền thẻ đã ghi nhận vào mã, đang chờ kế toán xác nhận",
    viecNenLam: "Không huỷ. Khách cần hoàn tiền thì nhờ kế toán.",
  },
  LECH_TIEN: {
    lyDo: "Máy đã thu số tiền khác số phải thu — giao dịch đang ở hàng chờ kế toán",
    viecNenLam: "Đừng quẹt bù phần chênh; chờ kế toán xử lý.",
  },
  CAN_XU_LY: {
    lyDo: "Giao dịch thẻ không tự ghi nhận được — kế toán đang xử lý",
    viecNenLam: "Chờ kế toán xử lý, đừng cho khách quẹt lại.",
  },
  DA_HUY: {
    lyDo: "Phiếu thẻ này đã được huỷ rồi",
    // VIỆC 6 (chốt): bỏ "(vẫn dùng mã cũ)" — sau dừng học / đổi khoá phiếu thẻ HUY nằm trên phiếu gộp ĐÃ ĐÓNG; mã chết thì "mở phiếu mới" là lời mời mà máy chủ chắc chắn từ chối.
    viecNenLam: "Muốn thu thẻ lại thì bấm “Thẻ POS” để mở phiếu thẻ mới — chỉ khi mã còn dùng được (màn không báo mã đã đóng) và không có giao dịch thẻ đang chờ kế toán.",
  },
  DA_HET_HAN: {
    lyDo: "Phiếu thẻ này đã hết hạn",
    viecNenLam: "Không cần huỷ. Muốn thu thẻ thì tạo phiếu mới.",
  },
  DA_NHAN_GIAO_DICH: {
    lyDo: "Phiếu thẻ này đã nhận một giao dịch thẻ",
    viecNenLam: "Bấm Kiểm tra thanh toán để xem kết quả; không huỷ.",
  },
  CO_GIAO_DICH_CHO_TAY: {
    lyDo: "Có giao dịch thẻ mang mã này đang chờ kế toán xử lý — khách có thể đã bị trừ tiền",
    viecNenLam: "Chờ kế toán xử lý xong, đừng cho khách quẹt lại.",
  },
  CO_YEU_CAU_SAI_MA: {
    lyDo: "Đang có yêu cầu “nhập sai mã” chờ kế toán xác nhận cho phiếu thẻ này",
    // Rà đối kháng bản ghép 10/10/2026: bản cũ hứa "xử lý xong rồi mới huỷ được" — SAI ở cả hai kết cục: duyệt ⇒ phiếu DA_THU (tiền đã vào, không còn gì để huỷ), còn bị bác ⇒ lúc ấy (V4.2) chặn tiếp bằng
    // `SAI_MA_BI_TU_CHOI`. VIỆC 6 · a2 (chủ dự án chốt 10/10/2026): mã `SAI_MA_BI_TU_CHOI` đã GỠ — kế toán từ chối thì phiếu về chờ quẹt và huỷ được theo cổng thường (sau hộp xác nhận mạnh). Câu nói ĐỦ HAI kết cục;
    // vế "huỷ được" là có điều kiện — chính hộp xác nhận mạnh cũng đòi sale tick "chắc khách chưa quẹt" — nên câu nói "huỷ được … nếu khách chưa quẹt" chứ không hứa nút luôn hiện (luật 12).
    // Qua `/impeccable clarify` (10/10/2026): bỏ vế "trừ khi còn dấu hiệu…" (chữ nội bộ, sale không biết "dấu hiệu" nào), gọi đúng việc kế toán làm ("duyệt" / "từ chối" — cùng chữ trên màn kế toán).
    viecNenLam:
      "Chờ kế toán xử lý yêu cầu (hoặc gọi kế toán), đừng cho khách quẹt lại. Duyệt thì giao dịch được ghi vào đơn; từ chối thì huỷ được phiếu thẻ này nếu khách chưa quẹt.",
  },
  // VIỆC 4 (rà đối kháng 09/10/2026) — MÃ MỚI, thêm vào hợp đồng đóng băng: dòng thẻ đã VỀ mà chưa thành giao dịch, lượt kiểm lưu
  // trước đó có thể vẫn nói "Chưa thấy…". Việc nên làm là Kiểm tra lại (làm mới kết quả lưu) — không hứa "quẹt lại" theo chiều nào.
  DONG_THE_CHUA_NGA_NGU: {
    lyDo: "Có giao dịch thẻ mang mã này vừa về mà ngân hàng chưa xác nhận xong — khách có thể đã bị trừ tiền",
    viecNenLam: "ĐỪNG cho khách quẹt lại. Bấm Kiểm tra thanh toán để cập nhật kết quả; vẫn chưa rõ thì báo kế toán.",
  },
  KET_QUA_PAID_CHUA_GHI: {
    lyDo: "Lần kiểm gần nhất thấy khách đã quẹt nhưng hệ thống chưa ghi nhận được tiền — tiền có thể đã trừ thẻ",
    viecNenLam: "ĐỪNG cho khách quẹt lại. Bấm Kiểm tra thanh toán sau ít phút; vẫn chưa rõ thì báo kế toán.",
  },
  KET_QUA_PAID_SAU_THAT_BAI: {
    lyDo: "Lần kiểm gần nhất có giao dịch mang mã này mà hệ thống chưa chốt được thành tiền — có thể khách đã huỷ trên máy, cũng có thể đã quẹt thành công",
    viecNenLam: "Bấm Kiểm tra thanh toán để chốt kết quả; vẫn chưa rõ thì hỏi kế toán trước khi huỷ.",
  },
  HUY_SAU_THU: {
    lyDo: "Giao dịch thẻ đã bị huỷ/hoàn sau khi ghi nhận — kế toán đang xử lý",
    viecNenLam: "Không huỷ phiếu; hỏi kế toán.",
  },
  LOI_KET_NOI: {
    lyDo: "Lần kiểm gần nhất bị lỗi kết nối — chưa biết khách đã quẹt hay chưa",
    viecNenLam: "Bấm Kiểm tra thanh toán để hỏi lại; có kết quả rõ ràng mới huỷ được.",
  },
  CHUA_NGA_NGU: {
    lyDo:
      "Lần kiểm gần nhất chưa kết luận được (có giao dịch thẻ đang xử lý, hoặc máy đồng bộ chưa đọc xong dữ liệu) — khách có thể đã bị trừ tiền",
    viecNenLam: "ĐỪNG cho khách quẹt lại. Bấm Kiểm tra thanh toán lại sau ít phút; vẫn chưa rõ thì báo kế toán.",
  },
  PHIEU_GOP_DA_DONG: {
    lyDo: "Mã của phiếu thẻ này đã đóng — phiếu thẻ không còn chờ quẹt",
    viecNenLam: "Không cần huỷ. Khách đã quẹt rồi thì bấm Kiểm tra thanh toán.",
  },
  QUA_HAN_CHO_DONG: {
    lyDo: "Phiếu thẻ đã quá hạn — hệ thống sẽ tự đóng ở lượt kiểm kế tiếp",
    viecNenLam: "Không cần huỷ. Muốn thu thẻ thì tạo phiếu mới.",
  },
};

/** Ghép thành MỘT câu theo lối của repo ("… — …"): máy chủ ném câu này, màn in cũng câu này. */
export function ghepCauTuChoiHuy(c: CauTuChoiHuy): string {
  return `${c.lyDo} — ${c.viecNenLam}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · CÂU NÓI THẬT Ở CÁC NƠI KHÁC (sửa "nói thật tạm" của Việc 1 — V18)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Câu theo TRẠNG THÁI `HUY` (`thongDiepTrangThai("HUY")`, và `dungPhieuPosView` dùng nó thay câu lưu cho phiếu HUY). Bản cũ
 * "(phiếu gộp đã đổi)" chỉ đúng với một trong hai đường ghi HUY; từ Việc 4 còn có huỷ tay. Cũng không còn nói mã đã chết:
 * huỷ phiếu THẺ không động tới phiếu gộp.
 */
export const CAU_PHIEU_THE_DA_HUY = "Phiếu thu thẻ đã huỷ — không còn chờ quẹt. Thu thẻ lại thì mở phiếu thẻ mới.";

/**
 * VIỆC 4 rà đối kháng 09/10/2026 — phiếu HUY mà còn giao dịch thẻ mang mã đang chờ kế toán (khách quẹt LỆCH SỐ / máy khác cơ sở sau
 * khi sale huỷ). Phiếu gộp vẫn mở nên phiếu HUY vẫn lên màn; câu "thu thẻ lại thì mở phiếu mới" lúc này là lời mời làm việc mà
 * `taoPhieuPosTrongKhoa` chắc chắn từ chối, và mã vẫn gõ được vào máy ⇒ có thể quẹt lần hai.
 */
export const CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN =
  "Phiếu thu thẻ đã huỷ, nhưng có giao dịch thẻ mang mã này đang chờ kế toán xử lý — khách có thể đã bị trừ tiền. ĐỪNG cho khách quẹt lại, chờ kế toán xử lý xong.";

/** MỘT nguồn chọn câu + mức độ cho phiếu HUY (`dungPhieuPosView`). `coGiaoDichChoTay` = `PhieuPosDeXem.coGiaoDichChoTay`. */
export function cauPhieuTheDaHuy(coGiaoDichChoTay: boolean): { cau: string; mucDo: "thong_tin" | "canh_bao" } {
  return coGiaoDichChoTay
    ? { cau: CAU_PHIEU_THE_DA_HUY_CHO_KE_TOAN, mucDo: "canh_bao" }
    : { cau: CAU_PHIEU_THE_DA_HUY, mucDo: "thong_tin" };
}

/**
 * Câu Ở MÀN khi "Huỷ phiếu" (của phiếu gộp) bị chặn vì khách có thể đang quẹt (`theDangMo = DANG_CHO`) — chọn theo việc
 * người xem THẬT SỰ làm được gì (luật 12: không hứa một nút người xem không có, và không hứa một nút hộp sẽ không vẽ):
 *
 *   · không có `payments:pos-check`            ⇒ `…_KHONG_QUYEN`  — chỉ nói nhờ ai;
 *   · có quyền, phiếu thẻ KHÔNG lên màn        ⇒ `…_CHUA_BIET`    — chỉ tới ô "Thẻ · đang chờ" (mở hộp sẽ thấy nút hay lý do);
 *   · có quyền, hộp CHO huỷ                    ⇒ `…_CO_NUT`       — chỉ đúng nút;
 *   · có quyền, hộp KHÔNG cho huỷ              ⇒ `cauChan…VuongPhieuThe` — nói lý do (cùng cặp câu với hộp).
 *
 * Câu MÁY CHỦ `LOI_HUY_KHI_CHO_QUET_THE` (`phieu-pos-luat.ts`, nguyên văn chủ dự án) KHÔNG đổi — nay nó trỏ tới một nút CÓ THẬT.
 * Hai câu `CHO_KE_TOAN` / `CHUA_KET_LUAN` giữ nguyên (chúng không hứa nút huỷ). Chọn ở `nutHuyPhieuGop` (`kenh-thu.ts`).
 */
export const CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CO_NUT =
  "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước (bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”).";
export const CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_KHONG_QUYEN =
  "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã. Nhờ người có quyền thu thẻ POS xử lý phiếu thẻ trước (huỷ nếu khách chưa quẹt, hoặc kiểm tra kết quả).";
export const CAU_CHAN_HUY_PHIEU_GOP_DANG_CHO_CHUA_BIET =
  "Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã. Mở phiếu thẻ ở dòng đợt (“Thẻ · đang chờ”): khách chưa quẹt thì huỷ phiếu thẻ ở đó.";

/** `lyDoVaViec` = `ghepCauTuChoiHuy(huyPhieuThe)` của hộp — CÙNG câu hộp in. */
export function cauChanHuyPhieuGopVuongPhieuThe(lyDoVaViec: string): string {
  return `Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã, và phiếu thẻ cũng chưa huỷ được: ${lyDoVaViec}`;
}
