// lib/finance/chia-tien-theo-con.ts — CHIA MỘT GIAO DỊCH NGÂN HÀNG ĐÍCH DANH THEO ĐỢT. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN B · Chủ dự án chốt 16/09/2026
//
//   *"Σ = đúng số tiền giao dịch; mỗi đợt ≤ còn nợ của đợt; mỗi con ≤ còn nợ con;
//   KHÔNG có ô tiền tự do."*
//
// "Không có ô tiền tự do" là câu quan trọng nhất và nó là luật về HÌNH DẠNG DỮ LIỆU, không
// phải về giao diện: đầu vào của hàm này là *danh sách (đợt, số tiền)*, nên không tồn tại chỗ
// nào để nhập một khoản không thuộc đợt nào. Màn hình không thể vẽ ra ô đó mà vẫn gọi được
// đường ghi.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO Σ PHẢI BẰNG ĐÚNG, KHÔNG PHẢI "≤"
//
// Cho phép chia thiếu là đẻ ra tiền treo: phần dư nằm lại trên `BankTransaction` mà giao dịch
// đã mang nhãn MATCHED, nên nó rơi khỏi hàng chờ đối soát và không ai nhìn nó nữa. Đó đúng là
// bất biến B2 chủ dự án đã chốt — *Σ `PaymentAllocation` của một `BankTransaction` ∈ {0, số
// tiền giao dịch}* — hoặc chia hết, hoặc không chia gì.
//
// Tiền thừa thật (khách chuyển dư) KHÔNG giải bằng cách nới chỗ này: nó đi đường hoàn tiền của
// kế toán. Nới ở đây là mở lại đúng cái lỗ "để tiền dư treo" đã bị loại.

/** Một dòng người dùng nhập: rót bao nhiêu vào đợt nào. */
export type DongChia = {
  paymentRequestId: string;
  soTien: number;
};

/** Một đợt đang mở, kèm phần CÒN THIẾU của chính nó. */
export type DotDeChia = {
  id: string;
  /** Đợt của con nào. `null` = đợt luồng cũ (thu toàn đơn). */
  orderItemId: string | null;
  installmentNo: number;
  /** `amountDue − Σ đã rót`. */
  conLai: number;
  /** Tên con, chỉ để dựng câu lỗi người đọc được. */
  tenCon: string;
};

/** Trần của một con. */
export type TranCuaCon = {
  orderItemId: string;
  ten: string;
  conNo: number;
};

export type KetQuaChia =
  | { ok: true; dong: DongChia[]; tong: number }
  | { ok: false; loi: string };

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

/**
 * Kiểm một phép chia trước khi ghi. THUẦN.
 *
 * Thứ tự kiểm có chủ ý: HÌNH DẠNG trước (dòng rỗng, trùng đợt, đợt lạ, số ≤ 0), TRẦN sau,
 * TỔNG cuối. Người nhập nhầm đợt cần nghe "đợt này không thuộc đơn", không phải "tổng lệch
 * 3.000.000đ" — câu sau đúng về số nhưng chỉ sai hướng đi tìm.
 */
export function kiemChiaTheoCon(input: {
  soTienGiaoDich: number;
  dong: readonly DongChia[];
  dot: readonly DotDeChia[];
  tranCon: readonly TranCuaCon[];
}): KetQuaChia {
  const soTienGiaoDich = tron(input.soTienGiaoDich);
  if (soTienGiaoDich <= 0) return { ok: false, loi: "Giao dịch không có số tiền hợp lệ" };

  const dong = input.dong.filter((d) => tron(d.soTien) !== 0);
  if (dong.length === 0) {
    return { ok: false, loi: "Chưa nhập số tiền cho đợt nào" };
  }

  const theoId = new Map(input.dot.map((d) => [d.id, d]));
  const daGap = new Set<string>();
  for (const d of dong) {
    const soTien = tron(d.soTien);
    const dot = theoId.get(d.paymentRequestId);
    if (!dot) {
      return { ok: false, loi: "Có đợt không thuộc đơn này hoặc đã đóng xong — tải lại trang" };
    }
    if (daGap.has(d.paymentRequestId)) {
      return { ok: false, loi: `${dot.tenCon} — đợt ${dot.installmentNo}: nhập hai lần` };
    }
    daGap.add(d.paymentRequestId);
    if (soTien < 0) {
      return { ok: false, loi: `${dot.tenCon} — đợt ${dot.installmentNo}: số tiền phải lớn hơn 0` };
    }
    if (soTien > tron(dot.conLai)) {
      return {
        ok: false,
        loi: `${dot.tenCon} — đợt ${dot.installmentNo}: tối đa ${vnd(dot.conLai)}đ`,
      };
    }
  }

  // ⚠️ Trần theo CON là lớp thứ hai, không phải lớp chính. Lớp chính là trần theo ĐỢT ở trên:
  // cổng tạo đợt đã bảo đảm Σ đợt đang mở ≤ còn nợ con, nên trần con hầu như không bao giờ
  // là vế cắn. Giữ nó vì hai đường (tạo đợt · gắn tiền) có thể xa nhau về thời gian, và vì một
  // lớp phòng thủ chỉ tốn một vòng lặp.
  //
  // `conNo` đo theo TRỤC A (kế toán đã xác nhận). Tiền vừa gắn còn chờ xác nhận nên chưa trừ
  // vào đó — nghĩa là trần này LỎNG chứ không chặt. Đó là lý do nó không được đứng một mình.
  const tranTheoCon = new Map(input.tranCon.map((c) => [c.orderItemId, c]));
  const congTheoCon = new Map<string, number>();
  for (const d of dong) {
    const dot = theoId.get(d.paymentRequestId)!;
    if (dot.orderItemId == null) continue;
    congTheoCon.set(dot.orderItemId, (congTheoCon.get(dot.orderItemId) ?? 0) + tron(d.soTien));
  }
  for (const [orderItemId, tong] of congTheoCon) {
    const tran = tranTheoCon.get(orderItemId);
    if (!tran) return { ok: false, loi: "Dòng hàng không thuộc đơn này — tải lại trang" };
    if (tong > tron(tran.conNo)) {
      return { ok: false, loi: `${tran.ten}: tối đa ${vnd(tran.conNo)}đ (còn nợ của bé)` };
    }
  }

  const tong = dong.reduce((s, d) => s + tron(d.soTien), 0);
  if (tong !== soTienGiaoDich) {
    const lech = tong - soTienGiaoDich;
    return {
      ok: false,
      loi:
        lech > 0
          ? `Chia THỪA ${vnd(lech)}đ — tổng phải đúng bằng ${vnd(soTienGiaoDich)}đ`
          : `Còn THIẾU ${vnd(-lech)}đ — tổng phải đúng bằng ${vnd(soTienGiaoDich)}đ`,
    };
  }

  return { ok: true, dong: dong.map((d) => ({ ...d, soTien: tron(d.soTien) })), tong };
}

/** Nhãn cho đợt của luồng CŨ, khi chưa biết tiền là của bé nào. */
export const NHAN_DOT_CHUNG = "Đợt chung (chưa chia con)";

/**
 * Dựng danh sách đợt để chia từ kết quả `tinhNoTheoCon`.
 *
 * Tách riêng để màn hình và đường ghi dùng CHUNG một phép dựng — hai bản chép tay là hai cơ
 * hội để màn hiện `conLai` một kiểu còn cổng tính một kiểu khác.
 *
 * ⚠️ NHẬN CẢ `dotChuaGanCon`, và nhận cả KẾT QUẢ thay vì chỉ `con[]` — bản đầu của PHIÊN B chỉ
 * nhận `con[]` nên đợt `orderItemId = NULL` (mọi đơn trước 16/09) không bao giờ vào danh sách:
 * màn gắn hiện 0 đợt cho đơn cũ, và cổng từ chối chúng với câu "đợt không thuộc đơn này".
 * Đổi chữ ký thay vì thêm tham số thứ hai có mặc định, để `tsc` liệt kê đủ chỗ gọi (luật 7).
 */
export function dungDotDeChia(input: {
  con: readonly {
    orderItemId: string;
    ten: string;
    dotDangMo: readonly { id: string; installmentNo: number; amountDue: number; daRot: number }[];
  }[];
  dotChuaGanCon: readonly {
    id: string;
    installmentNo: number;
    amountDue: number;
    daRot: number;
  }[];
}): DotDeChia[] {
  const theoCon = input.con.flatMap((c) =>
    c.dotDangMo.map((d) => ({
      id: d.id,
      orderItemId: c.orderItemId as string | null,
      installmentNo: d.installmentNo,
      conLai: Math.max(0, tron(d.amountDue) - tron(d.daRot)),
      tenCon: c.ten,
    })),
  );
  const dotChung = input.dotChuaGanCon.map((d) => ({
    id: d.id,
    orderItemId: null,
    installmentNo: d.installmentNo,
    conLai: Math.max(0, tron(d.amountDue) - tron(d.daRot)),
    tenCon: NHAN_DOT_CHUNG,
  }));
  return [...theoCon, ...dotChung];
}
