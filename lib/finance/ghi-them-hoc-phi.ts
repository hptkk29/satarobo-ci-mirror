// lib/finance/ghi-them-hoc-phi.ts — "thiếu thì ghi TIẾP cho đến khi đủ".
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// `createBackfillOrderPaymentInTx` idempotent theo LEAD (lib/crm/backfill-order.ts:58):
// đã có khoản nhập liệu thì lượt sau trả `created: false`. Cái đó ĐÚNG — nó chặn việc
// tạo đơn thứ hai cho cùng một lead. Nhưng nó không phải câu trả lời cho "khách đóng
// tiếp đợt sau": khoản mới phải vào ĐƠN ĐÃ CÓ, không phải một đơn mới.
//
// Trước bản này màn /thieu-hoc-phi khoá luôn dòng đã có khoản, nên một em thiếu
// 7.000.000đ không có đường nào ghi tiếp.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHỌN ĐƠN LÀ VIỆC CÓ RỦI RO, NÊN NÓ NẰM Ở ĐÂY
//
// Một lead có thể có nhiều đơn (nhiều con, nhiều khoá). Ghi tiền vào sai đơn là tiền
// nằm ở khoá khác, và không màn nào hiện ra chỗ lệch — công nợ hai đơn đều sai nhưng
// tổng vẫn đúng. Vì thế luật chọn đơn là hàm THUẦN có test, không phải vài dòng
// `find()` nằm trong action.
//
// Thứ tự ưu tiên: (1) đơn còn thiếu, (2) đơn DO MÀN NÀY tạo — đơn nghiệp vụ đang chạy
// không phải chỗ nhét tiền cũ vào, (3) đơn tạo sớm nhất — để kết quả không phụ thuộc
// thứ tự trả về của câu tra.
// ─────────────────────────────────────────────────────────────────────────────

export type DonCoTheGhiThem = {
  id: string;
  /** `Order.totalAmount` — sau giảm giá. */
  totalAmount: number;
  /** Σ `Payment.amount` với `KHOAN_DA_GHI_NHAN` của đơn này (trục B). */
  daThu: number;
  /** Đơn có khoản mang dấu `[backfill-import]` ⇒ do màn Thiếu học phí tạo. */
  coKhoanNhapLieu: boolean;
  /** `Order.createdAt` dạng số (ms) — chỉ dùng để phá thế ngang bằng. */
  taoLuc: number;
};

export type ChonDonKetQua =
  | { cheDo: "TAO_DON_MOI" }
  | { cheDo: "GHI_THEM"; orderId: string; toiDa: number }
  | { cheDo: "DU_ROI" };

function tien(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

/** Còn thiếu của MỘT đơn — không âm. Đơn 0đ ra 0 ⇒ không mời ghi thêm vào nó. */
function thieuCuaDon(d: DonCoTheGhiThem): number {
  return Math.max(0, tien(d.totalAmount) - tien(d.daThu));
}

export function chonDonDeGhiThem(dons: DonCoTheGhiThem[]): ChonDonKetQua {
  if (dons.length === 0) return { cheDo: "TAO_DON_MOI" };

  const conThieu = dons.filter((d) => thieuCuaDon(d) > 0);
  if (conThieu.length === 0) return { cheDo: "DU_ROI" };

  const chon = [...conThieu].sort((a, b) => {
    // Đơn do màn này tạo lên trước.
    if (a.coKhoanNhapLieu !== b.coKhoanNhapLieu) return a.coKhoanNhapLieu ? -1 : 1;
    const ta = Number.isFinite(a.taoLuc) ? a.taoLuc : 0;
    const tb = Number.isFinite(b.taoLuc) ? b.taoLuc : 0;
    if (ta !== tb) return ta - tb;
    // Chốt hạ bằng id để thứ tự tuyệt đối ổn định.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;

  return { cheDo: "GHI_THEM", orderId: chon.id, toiDa: thieuCuaDon(chon) };
}
