// lib/payments/khop-giao-dich.ts — KHỚP TIỀN VỀ VỚI PHIẾU, BA BẬC. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// US-10 · Spec chốt 16/09/2026
//
//   Bậc 1 — có mã hợp lệ: khớp phiếu theo MÃ. SĐT là ĐỐI CHỨNG: trùng chủ phiếu → sạch;
//           lệch → VẪN khớp theo mã, kèm cờ "SĐT lệch chủ phiếu".
//           **SĐT không bao giờ phủ quyết mã.**
//   Bậc 2 — không có mã hợp lệ, có SĐT: tìm phiếu ĐANG CHỜ THU của phụ huynh mang SĐT đó;
//           CHỈ tự khớp khi DUY NHẤT — đúng 1 phiếu VÀ số tiền = "còn phải thu" của nó.
//           Không duy nhất → hàng đợi chưa-khớp, kèm sẵn hồ sơ PH.
//   Bậc 3 — không gì dùng được: hàng đợi trần, lưu nguyên văn memo.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO SĐT KHÔNG ĐƯỢC PHỦ QUYẾT MÃ — ĐÂY LÀ ĐIỂM DỄ LÀM NGƯỢC NHẤT
//
// Trực giác nói: mã đúng nhưng SĐT của người khác thì "đáng ngờ", nên giữ lại chờ người xem.
// Trực giác đó SAI, và sai theo hướng đắt tiền.
//
// Ai chuyển tiền hộ là chuyện thường ngày: bà ngoại chuyển, bố chuyển từ tài khoản công ty,
// chị gái chuyển giùm. Trong mọi ca đó SĐT trên giao dịch lệch chủ phiếu, còn MÃ thì đúng —
// vì mã nằm trên tờ QR mà chính nhà đó đưa cho người chuyển. Để SĐT phủ quyết mã nghĩa là mọi
// khoản "chuyển hộ" đều rơi vào hàng đợi, kế toán xử tay từng cái, và phụ huynh bị nhắc nợ một
// khoản họ đã đóng.
//
// Chiều ngược lại — mã sai mà SĐT đúng — thì KHÔNG được tự khớp trừ khi duy nhất tuyệt đối,
// vì SĐT chỉ nói "nhà nào", không nói "phiếu nào". Đó là toàn bộ lý do bậc 2 khắt khe.
//
// ⚠️ Cờ "SĐT lệch chủ phiếu" KHÔNG phải cảnh báo lỗi. Nó là DẤU VẾT để kế toán đọc sao kê hiểu
// vì sao tên người chuyển không phải tên phụ huynh. Đừng biến nó thành thứ chặn việc.

import type { QuyetDinhChia } from "./chia-phieu-gop";

/** Một phiếu gộp ứng viên, đã tra từ DB. */
export type PhieuUngVien = {
  billId: string;
  /** Mã 5 ký tự (đời mới) hoặc `matchKey` đời cũ. */
  ma: string;
  trangThai: "OPEN" | "PAID" | "VOID" | "CLOSED";
  /** Số CÒN phải thu — `conPhaiThuCuaPhieu()`. */
  conPhaiThu: number;
  /** SĐT của phụ huynh đứng tên phiếu, đã chuẩn hoá 10 số. */
  sdtChuPhieu: string | null;
};

export type KetQuaKhop =
  | {
      bac: 1;
      phieu: PhieuUngVien;
      /** Mã đã dùng để tra ra phiếu (đời mới hoặc đời cũ). */
      maDung: string;
      /** SĐT trên giao dịch khác SĐT chủ phiếu — dấu vết, KHÔNG phải lỗi. */
      sdtLechChuPhieu: boolean;
    }
  | {
      bac: 2;
      phieu: PhieuUngVien;
      /** Luôn `true` ở bậc 2 — ghi ra để audit đọc được mà không phải suy. */
      khopTheoSdt: true;
    }
  | {
      bac: 3;
      ly: LyDoHangDoi;
      moTa: string;
    };

export type LyDoHangDoi =
  /** Có mã đọc được nhưng không phiếu nào mang mã đó. */
  | "MA_KHONG_RA_PHIEU"
  /** Có SĐT, nhưng số phiếu chờ thu khớp số tiền ≠ 1. */
  | "SDT_KHONG_DUY_NHAT"
  /** Có SĐT, đúng 1 phiếu chờ thu, nhưng số tiền không bằng còn-phải-thu. */
  | "SDT_LECH_SO_TIEN"
  /** Không mã, không SĐT. */
  | "KHONG_DOC_DUOC";

export type DauVaoKhop = {
  /** Kết quả `docMemo()`. */
  memo: { ungVien: string[]; maDoiCu: string | null; sdt: string | null; sach: string };
  soTienVe: number;
  /**
   * Tra phiếu theo MÃ. Người gọi cung cấp (một câu tra DB); trả `null` khi không có.
   * Nhận cả mã đời mới lẫn đời cũ.
   */
  traTheoMa: (ma: string) => PhieuUngVien | null;
  /** Phiếu ĐANG CHỜ THU (OPEN) của phụ huynh mang SĐT này. Rỗng khi không có. */
  traTheoSdt: (sdt: string) => PhieuUngVien[];
};

/**
 * Quyết định khớp — thuần, không chạm DB.
 *
 * Hai hàm tra được TRUYỀN VÀO chứ không gọi trong này, vì ba lý do; lý do thứ ba là lý do thật:
 *   1. thuần thì test được mọi nhánh không cần Postgres;
 *   2. người gọi kiểm soát được số câu tra (bậc 1 tra tối đa vài mã, bậc 2 đúng một câu);
 *   3. **người gọi buộc phải nói rõ "chờ thu" nghĩa là gì.** Một hàm tự tra sẽ tự chọn một
 *      định nghĩa cho `traTheoSdt`, và định nghĩa đó nằm chôn trong hàm — đúng loại quyết định
 *      mà sáu tháng sau không ai tìm ra.
 */
export function khopGiaoDich(input: DauVaoKhop): KetQuaKhop {
  const { memo } = input;

  // ── BẬC 1 · theo MÃ ───────────────────────────────────────────────────────
  // Duyệt MỌI ứng viên đời mới rồi tới đời cũ. Ứng viên là các khối đã qua checksum; khối đầu
  // tiên qua checksum vẫn có thể là rác trong tên khách (checksum lọc 26/27, không lọc hết),
  // nên dừng ở khối đầu mà không tra là tự đầu hàng ở đúng ca hiếm đó.
  const maUngVien = [...memo.ungVien, ...(memo.maDoiCu ? [memo.maDoiCu] : [])];
  for (const ma of maUngVien) {
    const phieu = input.traTheoMa(ma);
    if (phieu == null) continue;
    return {
      bac: 1,
      phieu,
      maDung: ma,
      // Chỉ gọi là "lệch" khi BIẾT cả hai vế. Thiếu một vế thì im — một cờ bật vì thiếu dữ
      // liệu sẽ dạy kế toán bỏ qua cờ đó.
      sdtLechChuPhieu:
        memo.sdt != null && phieu.sdtChuPhieu != null && memo.sdt !== phieu.sdtChuPhieu,
    };
  }

  const coMa = maUngVien.length > 0;

  // ── BẬC 2 · theo SĐT, và CHỈ khi duy nhất tuyệt đối ────────────────────────
  if (memo.sdt != null) {
    const dsPhieu = input.traTheoSdt(memo.sdt).filter((p) => p.trangThai === "OPEN");
    // "Duy nhất" tính TRÊN TẬP ĐÃ LỌC THEO SỐ TIỀN, không phải trên tập phiếu chờ thu. Nhà có
    // hai phiếu chờ mà chỉ một phiếu khớp số thì vẫn là duy nhất — đó là ca có thật và tự khớp
    // được. Ngược lại, hai phiếu cùng khớp số thì KHÔNG có cách nào biết nhà muốn trả phiếu nào.
    const khopSo = dsPhieu.filter((p) => p.conPhaiThu === Math.round(input.soTienVe));
    if (khopSo.length === 1) {
      return { bac: 2, phieu: khopSo[0]!, khopTheoSdt: true };
    }
    return {
      bac: 3,
      ly: coMa
        ? "MA_KHONG_RA_PHIEU"
        : khopSo.length > 1
          ? "SDT_KHONG_DUY_NHAT"
          : dsPhieu.length > 0
            ? "SDT_LECH_SO_TIEN"
            : "SDT_KHONG_DUY_NHAT",
      moTa: moTaHangDoi({
        coMa,
        sdt: memo.sdt,
        soPhieuCho: dsPhieu.length,
        soPhieuKhopSo: khopSo.length,
        soTienVe: input.soTienVe,
      }),
    };
  }

  // ── BẬC 3 ─────────────────────────────────────────────────────────────────
  return {
    bac: 3,
    ly: coMa ? "MA_KHONG_RA_PHIEU" : "KHONG_DOC_DUOC",
    moTa: coMa
      ? `Đọc được mã (${maUngVien.join(", ")}) nhưng không phiếu nào mang mã đó`
      : `Nội dung chuyển khoản không có mã cũng không có số điện thoại 10 số`,
  };
}

function moTaHangDoi(x: {
  coMa: boolean;
  sdt: string;
  soPhieuCho: number;
  soPhieuKhopSo: number;
  soTienVe: number;
}): string {
  const tien = Math.round(x.soTienVe).toLocaleString("vi-VN");
  if (x.coMa) return `Đọc được mã nhưng không phiếu nào mang mã đó; SĐT ${x.sdt}`;
  if (x.soPhieuCho === 0) return `SĐT ${x.sdt} không có phiếu nào đang chờ thu`;
  if (x.soPhieuKhopSo > 1) {
    return `SĐT ${x.sdt} có ${x.soPhieuKhopSo} phiếu chờ thu cùng số tiền ${tien}đ — không biết phiếu nào`;
  }
  return `SĐT ${x.sdt} có ${x.soPhieuCho} phiếu chờ thu nhưng không phiếu nào còn phải thu đúng ${tien}đ`;
}

/**
 * Ghép quyết định khớp với quyết định chia (`chiaTheoPhieuGop`) — chỉ để người đọc thấy ranh
 * giới, không thêm luật nào.
 *
 * ⚠️ Thứ tự vẫn như đã chốt: **TRẠNG THÁI phiếu trước, SỐ TIỀN sau.** Phiếu PAID có "còn phải
 * thu" = 0 nên kiểm số trước sẽ báo lý do "lệch số", và kế toán đi tìm một khoản lệch không tồn
 * tại thay vì thấy ngay "khách quét lại QR cũ". Luật đó nằm trong `chiaTheoPhieuGop`; ở đây chỉ
 * nhắc để không ai cài lại phép kiểm số ở tầng này.
 */
export type KetQuaTron = { khop: KetQuaKhop; chia: QuyetDinhChia | null };
