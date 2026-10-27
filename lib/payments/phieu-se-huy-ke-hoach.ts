// lib/payments/phieu-se-huy-ke-hoach.ts — ÁP KẾ HOẠCH TRẢ GÓP THÌ PHIẾU THU NÀO BỊ VOID. THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA — rà đối kháng vòng 4 (30/09/2026, luật 12)
//
// Lưu kế hoạch trả góp VOID phiếu "thu toàn đơn" và các đợt dư. Đợt bị VOID mà nằm trong phiếu
// gộp đang mở thì CẢ PHIẾU của gia đình bị huỷ/đóng (`soatPhieuGopMoTrongTx`). Màn sửa kế hoạch
// phải NÓI TRƯỚC điều đó — mà muốn nói trước thì phải biết đợt nào sẽ bị VOID.
//
// Luật ấy trước đây chỉ sống TRONG `materializeInstallmentRequests`. Chép nó ra client là hai bản
// của cùng một luật tiền, lệch nhau ở lần sửa đầu tiên mà không ca nào đỏ (màn nói "sẽ huỷ mã",
// máy không huỷ — hoặc ngược lại, im lặng huỷ). Nên luật dời HẲN về đây, và CẢ đường ghi lẫn màn
// hình cùng gọi — `[PSH-W1]` ghim đường ghi.
//
// Rà vòng 5 (30/09/2026) thêm ba luật cùng chỗ: chỉ phiếu CẤP ĐƠN thuộc kế hoạch (đợt theo con
// không), đợt ĐỔI SỐ cũng là chạm phiếu gộp, và lời báo "chắc chắn bị từ chối" trước khi bấm.
// ─────────────────────────────────────────────────────────────────────────────
import { keHoachLamMatTien } from "./plan-money-guard";

/** Một phiếu thu của đơn, đúng phần luật VOID cần. */
export type PhieuThuDeXet = {
  id: string;
  /**
   * `null` = phiếu CẤP ĐƠN (thu toàn đơn / đợt của kế hoạch); khác `null` = đợt THEO CON.
   * BẮT BUỘC (luật 7) — rà vòng 5 (30/09/2026): thiếu cột này, luật VOID lẫn đợt theo con vào kế
   * hoạch mức đơn (đợt A#1 và B#1 cùng số 1 ⇒ "đã có trong kế hoạch"), `materialize` sửa số đợt của
   * MỘT bé thành đợt đơn và tạo thêm đợt đơn — Σ đợt sống vượt học phí (ca `[V5-40]`).
   */
  orderItemId: string | null;
  /** 0 = phiếu "thu toàn đơn"; 1,2,… = số đợt. */
  installmentNo: number;
  /** Số phải thu hiện tại — để biết đợt nào sẽ ĐỔI SỐ khi áp kế hoạch (`dotSeDoiSoKhiApKeHoach`). */
  amountDue: number;
  status: string;
  /** Σ tiền THẬT đã rót (`PaymentAllocation.amount`) — KHÔNG cộng phần tha làm tròn. */
  allocated: number;
};

/** Đơn đang thu THEO CON (có đợt theo con còn sống) ⇒ không lập kế hoạch mức đơn được. */
export function donDangThuTheoCon(phieu: readonly Pick<PhieuThuDeXet, "orderItemId" | "status">[]): boolean {
  return phieu.some((r) => r.orderItemId !== null && r.status !== "VOID");
}

/**
 * Câu từ chối DUY NHẤT cho "đơn thu theo con mà lập kế hoạch mức đơn" — đường ghi
 * (`recordInstallmentPlan`) ném đúng câu này, màn sửa kế hoạch in đúng câu này thay cho cái nút
 * (luật 12: nút chắc chắn bị từ chối là lời hứa suông).
 */
export const LY_DO_DON_THU_THEO_CON =
  "Đơn này đang thu THEO TỪNG BÉ (đợt theo con) — không lập kế hoạch mức đơn được: hai loại đợt lẫn " +
  "nhau là đòi tiền hai lần. Tạo / sửa đợt ở khối “Công nợ theo con”.";

/** Làm tròn số tiền đợt ĐÚNG như `recordInstallmentPlan` ghi `OrderInstallment.amount`. */
const tienDot = (n: number) => Math.max(0, Math.round(n));

/** Phiếu cấp đơn theo số đợt — ngữ nghĩa `Map` (bản ghi CUỐI thắng), y hệt `byNo` của `materialize`. */
function capDonTheoSo(phieu: readonly PhieuThuDeXet[]): Map<number, PhieuThuDeXet> {
  return new Map(phieu.filter((r) => r.orderItemId === null).map((r) => [r.installmentNo, r]));
}

/**
 * Áp kế hoạch có các đợt `soDot` (> 0) lên đơn thì phiếu nào bị VOID.
 *
 * - `duOra`: đợt KHÔNG còn trong kế hoạch, chưa VOID, chưa dính đồng tiền thật nào. Đợt đã có tiền
 *   được GIỮ (tiền thật là lý do duy nhất để giữ phiếu).
 * - `toanDon`: phiếu "thu toàn đơn" (số 0) còn sống — VOID VÔ ĐIỀU KIỆN (đơn chuyển sang thu theo
 *   đợt). Cổng R-02 ở `recordInstallmentPlan` chặn TRƯỚC khi tới đây nếu nó đang giữ tiền.
 *
 * CHỈ xét phiếu CẤP ĐƠN (`orderItemId === null`) — đợt theo con không thuộc kế hoạch mức đơn.
 * Kế hoạch không có đợt nào ⇒ không VOID gì (`materialize` trả `noop`).
 *
 * ⚠️ `toanDon` lấy theo ngữ nghĩa `Map` (bản ghi CUỐI mang số 0 thắng) — y hệt `byNo.get(0)` cũ của
 * `materialize`. Chỉ mục `PaymentRequest_orderId_installmentNo_key` (từng phần, `orderItemId IS
 * NULL`) giữ đơn có đúng MỘT phiếu số 0 cấp đơn, nên thứ tự chỉ có nghĩa với dữ liệu hỏng.
 */
export function phieuSeHuyKhiApKeHoach(input: {
  phieu: readonly PhieuThuDeXet[];
  soDot: readonly number[];
}): { duOra: string[]; toanDon: string | null } {
  const planned = new Set(input.soDot.filter((n) => n > 0));
  if (planned.size === 0) return { duOra: [], toanDon: null };

  const capDon = input.phieu.filter((r) => r.orderItemId === null);
  const duOra = capDon
    .filter((r) => r.installmentNo > 0 && !planned.has(r.installmentNo))
    .filter((r) => r.status !== "VOID" && !(r.allocated > 0))
    .map((r) => r.id);

  const full = capDonTheoSo(capDon).get(0);
  const toanDon = full && full.status !== "VOID" ? full.id : null;
  return { duOra, toanDon };
}

/**
 * Áp kế hoạch thì phiếu thu CẤP ĐƠN nào bị ĐỔI SỐ TIỀN tại chỗ (`materialize` sửa `amountDue`).
 *
 * Rà vòng 5 (30/09/2026, ca `[V5-41]`): đợt nằm trong phiếu gộp đang mở mà đổi số thì mã của cả nhà
 * đổi số (còn phải thu = min(dòng phiếu, amountDue − đã rót)) nhưng GIỮ NGUYÊN MÃ — phụ huynh quét QR
 * đã nhận, chuyển đúng số in trên đó ⇒ LECH_SO, tiền về hàng chờ. Đường ghi coi "đổi số" là CHẠM
 * phiếu (soát huỷ/đóng như VOID đợt) và màn NÓI TRƯỚC — cả hai gọi hàm này.
 */
export function dotSeDoiSoKhiApKeHoach(input: {
  phieu: readonly PhieuThuDeXet[];
  dots: readonly { soDot: number; amount: number }[];
}): string[] {
  const byNo = capDonTheoSo(input.phieu);
  const ra: string[] = [];
  for (const d of input.dots) {
    if (d.soDot <= 0) continue;
    const cur = byNo.get(d.soDot);
    if (cur && cur.amountDue !== tienDot(d.amount)) ra.push(cur.id);
  }
  return ra;
}

/**
 * Bấm "Lưu kế hoạch" với các đợt `dots` (theo thứ tự, đợt thứ i là số i+1) thì phiếu nào bị VOID
 * (`seHuy`) và phiếu nào bị ĐỔI SỐ (`doiSo`) — cho màn nói-trước.
 *
 * Mọi đợt đều "đã thu" ⇒ `recordInstallmentPlan` KHÔNG áp kế hoạch lên sổ phiếu (nhánh
 * `ensureFullOrderRequest`) ⇒ không chạm gì. Cùng điều kiện `coDotChuaThu` của `kiemKeHoachDot`.
 */
export function phieuSeChamKhiLuuKeHoach(input: {
  phieu: readonly PhieuThuDeXet[];
  dots: readonly { daThu: boolean; amount: number }[];
}): { seHuy: string[]; doiSo: string[] } {
  if (!input.dots.some((d) => !d.daThu)) return { seHuy: [], doiSo: [] };
  return {
    seHuy: phieuSeHuyKhiLuuKeHoach(input),
    doiSo: dotSeDoiSoKhiApKeHoach({
      phieu: input.phieu,
      dots: input.dots.map((d, i) => ({ soDot: i + 1, amount: d.amount })),
    }),
  };
}

/** Danh sách phẳng phiếu bị VOID khi bấm "Lưu kế hoạch" — xem `phieuSeChamKhiLuuKeHoach`. */
export function phieuSeHuyKhiLuuKeHoach(input: {
  phieu: readonly PhieuThuDeXet[];
  dots: readonly { daThu: boolean }[];
}): string[] {
  if (!input.dots.some((d) => !d.daThu)) return [];
  const { duOra, toanDon } = phieuSeHuyKhiApKeHoach({
    phieu: input.phieu,
    soDot: input.dots.map((_, i) => i + 1),
  });
  return toanDon ? [...duOra, toanDon] : duOra;
}

/**
 * Lưu kế hoạch này có CHẮC CHẮN bị đường ghi từ chối không — `null` khi không biết trước là bị chặn.
 *
 * Rà vòng 5 (30/09/2026, luật 12, ca `[PSH-10..12]`): phiếu "thu toàn đơn" đang giữ tiền mà kế hoạch
 * có đợt chưa thu ⇒ R-02 (`keHoachLamMatTien`, vế (a)) từ chối VÔ ĐIỀU KIỆN; trước bản vá màn vẫn hứa
 * "đóng mã …, số đã nhận giữ nguyên" và nhãn nút mang hệ quả đó. Đơn đang thu theo con ⇒ cổng
 * `LY_DO_DON_THU_THEO_CON`. Cả hai câu là CHÍNH câu máy chủ trả.
 *
 * Tiền R-02 đo = Σ phân bổ của MỌI phiếu số 0 chưa VOID — y hệt câu tra của R-02 (không lấy bản ghi
 * cuối của `Map`). Vế (b) của R-02 (sổ `Payment` so với lời khai) không đoán ở đây.
 */
export function chanTruocKhiLuuKeHoach(input: {
  phieu: readonly PhieuThuDeXet[];
  dots: readonly { daThu: boolean }[];
}): string | null {
  if (donDangThuTheoCon(input.phieu)) return LY_DO_DON_THU_THEO_CON;
  if (!input.dots.some((d) => !d.daThu)) return null;
  const rotVaoToanDon = input.phieu
    .filter((r) => r.installmentNo === 0 && r.status !== "VOID")
    .reduce((s, r) => s + (r.allocated > 0 ? r.allocated : 0), 0);
  const r02 = keHoachLamMatTien({
    fullOrderAllocated: rotVaoToanDon,
    recordedPaid: 0,
    allocated: 0,
    tienCacDotDaThu: 0,
  });
  return r02.chan ? (r02.lyDo ?? "Kế hoạch này sẽ bị từ chối") : null;
}
