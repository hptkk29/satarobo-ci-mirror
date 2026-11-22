// lib/finance/tach-khoan.ts — TÁCH MỘT KHOẢN ĐÃ THU CHO NHIỀU CON. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// Chủ dự án chốt 20/09/2026
//
//   *"Nút 'Tách khoản' trên khoản chưa gắn bé: nhập số tiền cho từng bé; Σ phải ĐÚNG BẰNG
//   số tiền khoản gốc; mỗi phần ≤ còn nợ của bé đó."*
//
// Ca thật sinh ra nó — `ORD-260918-000001`: MỘT khoản 9.530.000đ (`PENDING`, chưa gắn bé)
// trong khi đơn có hai bé (học phí 8.976.000đ và 10.032.000đ). Phụ huynh chuyển một lần cho
// cả hai con. Đường B (`ganKhoanDaThuChoCon`) gắn được một khoản cho ĐÚNG MỘT bé, nên ca này
// — ca CHÍNH của module — rơi thẳng vào câu "chưa hỗ trợ".
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO Σ PHẢI BẰNG ĐÚNG, KHÔNG PHẢI "≤"
//
// Cùng một lý do với `kiemChiaTheoCon`: chia thiếu là đẻ ra tiền không ai nhìn. Khác một
// điểm — ở đây phần dư KHÔNG biến mất (nó ở lại dưới dạng một khoản `orderItemId = NULL`,
// vẫn hiện trong khối "chưa gắn cho con nào") — nhưng cho phép nó thì lệnh này có HAI kết
// quả hợp lệ cho cùng một đầu vào ("tách hết" và "tách một phần"), và người bấm không có
// cách nào biết mình vừa chọn cái nào. Một lệnh tiền không được phép mơ hồ như thế.
//
// ⚠️ HỆ QUẢ ĐÃ ĐO, PHẢI BIẾT TRƯỚC KHI PILOT — cặp số thật của `ORD-260918-000001`:
//
//     4.488.000 (nửa học phí bé A)  +  5.016.000 (nửa học phí bé B)  =  9.504.000
//     khoản thật                                                     =  9.530.000
//     ────────────────────────────────────────────────────────────────────────
//     lệch                                                                26.000
//
// Hai nửa học phí khít tuyệt đối, nhưng phụ huynh chuyển DƯ 26.000đ. Nên đúng cặp số ấy sẽ
// **BỊ CHẶN** với câu *"Còn THIẾU 26.000đ"*. Đó là hành vi ĐÚNG, không phải lỗi.
//
// ⚠️ VÀ HÀM NÀY KHÔNG TỰ DỒN PHẦN DƯ VÀO BÉ NÀO — chủ dự án chốt 20/09/2026:
//
//   *"26.000đ chênh là tiền thật chưa ai giải thích được — có thể PH làm tròn, có thể số học
//   phí sai, có thể phụ phí. Hệ thống KHÔNG được tự dồn nó vào một bé."*
//
// Đó là lý do cổng chỉ biết TỪ CHỐI và nói rõ còn thiếu bao nhiêu. Việc "26.000đ này của ai"
// là một câu hỏi nghiệp vụ — hỏi phụ huynh / kế toán, đừng để một dòng mã trả lời hộ. Ca
// `[TKP-07]` ghim phép trừ để không ai phải tính lại bằng tay; nó **không** gợi ý cặp số nào.
//
// ─────────────────────────────────────────────────────────────────────────────
// TRẦN CỦA MỘT BÉ: `conCoTheNhan`, KHÔNG PHẢI `conNo`
//
// `conNo` là TRỤC A (`phaiThu − Σ khoản kế toán ĐÃ XÁC NHẬN`). Lấy nó làm trần là bỏ qua
// tiền đã về mà kế toán chưa duyệt — tức **tách hai lần cho cùng một bé thì lần nào cũng
// thấy trần còn nguyên**, và bé ấy nhận quá phần của mình mà không cổng nào cắn.
//
// `conCoTheNhan = max(0, phaiThu − Σ khoanDaVe của bé)` — cùng tập RỘNG mà vế ĐƠN dùng
// (`KhoanDaVe` trong `no-theo-con.ts`). Nó trừ cả khoản `PENDING`, và **không** trừ khoản
// `REJECTED` (kế toán từ chối ⇒ tiền ấy không về ⇒ còn là nợ thật ⇒ trần mở lại).
//
// ⚠️ Khi bé chưa có đồng nào đã về thì `conCoTheNhan === conNo` — tức ở ca pilot hai số
// BẰNG NHAU, và luật vẫn đọc đúng như chủ dự án phát biểu: *"phần ≤ còn nợ của bé đó"*.
// Chúng chỉ tách nhau khi bé đã nhận tiền chờ xác nhận, và đúng lúc đó mới cần cái chặt hơn.
//
// ⚠️ VÀ VÌ TRẦN CHẶT HƠN SỐ TRÊN MÀN, MÀN PHẢI IN NÓ. Màn đơn in ô "Còn nợ" (trục A); nếu
// cổng từ chối bằng một con số nhỏ hơn ô ấy mà không nói vì sao thì người dùng đọc ra "hệ
// thống lỗi" rồi học cách bỏ qua cổng — đúng bài học của cổng tạo đợt (CLAUDE.md). Nên form
// tách in "tối đa …" lấy TỪ CHÍNH `conCoTheNhan`, và câu lỗi nói rõ phần đã về.

/** Một dòng người dùng nhập: bé nào nhận bao nhiêu. */
export type PhanTach = {
  orderItemId: string;
  soTien: number;
};

/** Trần nhận thêm của một bé. */
export type TranNhanCuaCon = {
  orderItemId: string;
  ten: string;
  /** `max(0, phaiThu − Σ khoanDaVe của bé)` — xem khối chú thích đầu tệp. */
  conCoTheNhan: number;
  /** Σ tiền ĐÃ VỀ của bé (tập rộng). Chỉ để dựng câu lỗi người đọc hiểu được. */
  daVe: number;
};

export type KetQuaTach =
  | { ok: true; phan: PhanTach[]; tong: number }
  | { ok: false; loi: string };

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

/**
 * Kiểm một phép tách trước khi ghi. THUẦN.
 *
 * Thứ tự kiểm cố ý giống `kiemChiaTheoCon`: HÌNH DẠNG trước, TRẦN sau, TỔNG cuối. Người gõ
 * nhầm một bé cần nghe "bé này không thuộc đơn", không phải "tổng lệch 26.000đ" — câu sau
 * đúng về số nhưng chỉ người ta đi sai hướng.
 */
export function kiemTachKhoan(input: {
  soTienKhoan: number;
  phan: readonly PhanTach[];
  tranCon: readonly TranNhanCuaCon[];
}): KetQuaTach {
  const soTienKhoan = tron(input.soTienKhoan);
  if (soTienKhoan <= 0) return { ok: false, loi: "Khoản này không có số tiền hợp lệ" };

  const phan = input.phan.filter((p) => tron(p.soTien) !== 0);
  if (phan.length === 0) return { ok: false, loi: "Chưa nhập số tiền cho bé nào" };

  // ⚠️ TỪ HAI BÉ TRỞ LÊN. Một phần duy nhất bằng trọn số tiền chính là phép GẮN, và làm nó
  // qua đường tách là đẻ ra một bút toán đảo + một dòng mới cho việc mà một phép cập nhật
  // MỘT CỘT làm xong. Câu lỗi phải chỉ đúng nút kia, đừng bắt người dùng tự đoán.
  if (phan.length === 1) {
    return {
      ok: false,
      loi: "Tách là chia cho từ HAI bé trở lên — một bé thì dùng nút “Gắn cho bé…”",
    };
  }

  const tranTheoId = new Map(input.tranCon.map((c) => [c.orderItemId, c]));
  const daGap = new Set<string>();
  for (const p of phan) {
    const soTien = tron(p.soTien);
    const tran = tranTheoId.get(p.orderItemId);
    if (!tran) {
      return { ok: false, loi: "Có bé không thuộc đơn này — tải lại trang" };
    }
    if (daGap.has(p.orderItemId)) {
      return { ok: false, loi: `${tran.ten}: nhập hai lần` };
    }
    daGap.add(p.orderItemId);
    if (soTien < 0) {
      return { ok: false, loi: `${tran.ten}: số tiền phải lớn hơn 0` };
    }
    if (soTien > tron(tran.conCoTheNhan)) {
      // Câu lỗi nói bằng NGÔN NGỮ CỦA NGUYÊN NHÂN khi trần đã bị tiền cũ ăn mất một phần —
      // "tối đa X" trần trụi trong khi màn in "còn nợ" lớn hơn đọc như hệ thống hỏng.
      const viDaVe =
        tron(tran.daVe) > 0 ? ` — bé này đã có ${vnd(tran.daVe)}đ vào đơn rồi` : "";
      return {
        ok: false,
        loi: `${tran.ten}: tối đa ${vnd(tran.conCoTheNhan)}đ${viDaVe}`,
      };
    }
  }

  const tong = phan.reduce((s, p) => s + tron(p.soTien), 0);
  if (tong !== soTienKhoan) {
    const lech = tong - soTienKhoan;
    return {
      ok: false,
      loi:
        lech > 0
          ? `Chia THỪA ${vnd(lech)}đ — tổng phải đúng bằng ${vnd(soTienKhoan)}đ`
          : `Còn THIẾU ${vnd(-lech)}đ — tổng phải đúng bằng ${vnd(soTienKhoan)}đ`,
    };
  }

  return { ok: true, phan: phan.map((p) => ({ ...p, soTien: tron(p.soTien) })), tong };
}
