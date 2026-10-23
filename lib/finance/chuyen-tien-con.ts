// lib/finance/chuyen-tien-con.ts — CHUYỂN TIỀN GIỮA HAI CON CÙNG ĐƠN. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN F1 · Chủ dự án chốt:
//
//   *"Chuyển tiền giữa hai con CÙNG ĐƠN (ngoài lúc dừng học): chỉ phần CONFIRMED, con
//   nhận ≤ còn nợ, bút toán −/+ cùng mã nghiệp vụ."*
//
// Phép GHI đã có sẵn từ PHIÊN D: `chuyenTienGiuaConTrongTx` (`lib/finance/ghi-tien-don.ts`
// mục 7) — nó sinh cặp bút toán −/+ mang chung một marker. F1 không phát minh cơ chế mới;
// nó mở đúng cơ chế ấy thành một thao tác đứng riêng, và bổ sung phần CỔNG.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI TRẦN, HAI TRỤC KHÁC NHAU — và đó là chỗ dễ sai nhất
//
//   · trần của bé CHO   = `daThu`  (TRỤC A, `accountantStatus = CONFIRMED`)
//   · trần của bé NHẬN  = `conNo`  (cũng trục A: `phaiThu − daThu`)
//
// ⚠️ Bé CHO dùng `daThu` chứ KHÔNG dùng "phần đóng thừa". Cám dỗ là chỉ cho chuyển phần
// dư (`-conNo` khi âm), nhưng ca dùng CHÍNH lại là ca không có dư: phụ huynh chuyển tiền
// và sale gắn nhầm cho bé A, trong khi cả hai bé đều còn nợ. Lúc đó `conNo` của A vẫn
// DƯƠNG mà tiền vẫn phải chuyển sang B. Chặn theo dư là chặn đúng ca cần làm nhất.
//
// ⚠️ Bé NHẬN dùng `conNo` để KHÔNG đẩy bé nhận thành đóng thừa. Đẩy quá là tạo ra một
// khoản dư mới ở bé B, và khoản dư ấy lại phải đi phân tiếp — tức thao tác sửa một lỗi
// bằng cách đẻ ra lỗi cùng loại ở chỗ khác.
//
// ⚠️ CHỈ phần `CONFIRMED`. Khoản kế toán chưa xác nhận có thể bị TỪ CHỐI; chuyển nó sang
// bé khác là làm bé đó "hết nợ" bằng một khoản tiền chưa chắc về. Cùng lý lẽ với vế CON
// của cổng tạo đợt (`lib/finance/no-theo-con.ts`).

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

/** Một bé của đơn, chỉ phần cần cho phép kiểm. */
export type ConDeChuyen = {
  orderItemId: string;
  ten: string;
  /** TRỤC A — Σ `Payment` đã xác nhận của bé. Trần của bé CHO. */
  daThu: number;
  /** `phaiThu − daThu`. Trần của bé NHẬN. Có thể ÂM (bé đang đóng thừa). */
  conNo: number;
};

export type KiemChuyenTien =
  | { ok: true; soTien: number; tenCho: string; tenNhan: string }
  | { ok: false; loi: string };

/**
 * Chuyển `soTien` từ bé `tuOrderItemId` sang bé `denOrderItemId` được không.
 *
 * Thứ tự cổng: HÌNH DẠNG trước → hai bé có thật → không tự chuyển cho mình → trần bé CHO
 * → trần bé NHẬN. Thứ tự ấy có chủ đích: báo "vượt trần" trong khi thứ sai thật sự là
 * "chọn nhầm chính bé đó" sẽ khiến người vận hành đi sửa nhầm chỗ.
 */
export function kiemChuyenTien(input: {
  tuOrderItemId: string;
  denOrderItemId: string;
  soTien: number;
  /** Mọi bé của ĐƠN. Người gọi nạp từ `docSoTheoCon`. */
  con: readonly ConDeChuyen[];
}): KiemChuyenTien {
  const soTien = tron(input.soTien);
  if (!Number.isFinite(input.soTien) || soTien <= 0) {
    return { ok: false, loi: "Số tiền chuyển phải lớn hơn 0" };
  }

  const cho = input.con.find((c) => c.orderItemId === input.tuOrderItemId);
  const nhan = input.con.find((c) => c.orderItemId === input.denOrderItemId);
  // Gộp hai ca "không có bé ấy" và "bé của đơn khác" — biết một dòng tồn tại ở đơn khác
  // đã là một mẩu thông tin không nên rò (cùng lối với `ganKhoanDaThuChoCon`).
  if (!cho || !nhan) {
    return { ok: false, loi: "Chỉ chuyển được giữa hai bé của CÙNG một đơn" };
  }
  if (cho.orderItemId === nhan.orderItemId) {
    return { ok: false, loi: "Bé nhận phải khác bé cho" };
  }

  const tranCho = Math.max(0, tron(cho.daThu));
  if (tranCho <= 0) {
    return {
      ok: false,
      loi: `${cho.ten} chưa có khoản nào kế toán đã xác nhận — không có gì để chuyển đi.`,
    };
  }
  if (soTien > tranCho) {
    return {
      ok: false,
      loi:
        `${cho.ten} chỉ chuyển đi được tối đa ${vnd(tranCho)}đ — đúng phần kế toán ĐÃ XÁC ` +
        `NHẬN. Khoản còn chờ xác nhận không chuyển được.`,
    };
  }

  const tranNhan = Math.max(0, tron(nhan.conNo));
  if (tranNhan <= 0) {
    return {
      ok: false,
      loi:
        `${nhan.ten} không còn nợ đồng nào — chuyển sang là làm bé đó đóng thừa, và khoản ` +
        `thừa ấy lại phải đi phân tiếp.`,
    };
  }
  if (soTien > tranNhan) {
    return {
      ok: false,
      loi: `${nhan.ten} chỉ nhận thêm được tối đa ${vnd(tranNhan)}đ (đúng phần còn nợ của bé).`,
    };
  }

  return { ok: true, soTien, tenCho: cho.ten, tenNhan: nhan.ten };
}

/**
 * Số tiền GỢI Ý cho ô nhập: nhỏ hơn giữa hai trần.
 *
 * ⚠️ Chỉ là GỢI Ý cho giao diện. Cổng thật vẫn là `kiemChuyenTien` — một con số tính ở
 * client không bao giờ được thay cho phép kiểm ở máy chủ.
 */
export function goiYSoTienChuyen(cho: ConDeChuyen, nhan: ConDeChuyen): number {
  return Math.max(0, Math.min(Math.max(0, tron(cho.daThu)), Math.max(0, tron(nhan.conNo))));
}
