// lib/orders/pham-vi/giam-them.ts — KHOẢN GIẢM THÊM TRÊN DÒNG THEO PHẠM VI HỌC: (a) ĐẾM ưu đãi để biết đơn có phải chờ duyệt không,
// (b) TRẦN TỔNG % giảm của dòng. THUẦN (không DB, không `server-only`) để máy chủ VÀ form tạo đơn gọi CÙNG hàm — form báo trước
// "đơn sẽ chờ duyệt" / "vượt trần" bằng đúng phép tính mà máy chủ dùng để QUYẾT ĐỊNH, không có bản thứ hai.
//
// ── QUYẾT ĐỊNH [chủ dự án, 20/10/2026, trong chat] ───────────────────────────────────────────────────────────────
// Ảnh form tạo đơn: "Giá theo phạm vi học… Đơn giá đang nhập khác số này — máy chủ sẽ từ chối nếu không khớp." Chủ dự án:
//   > "phải để linh hoạt, tuỳ chính được chương trình giảm giá chứ, nếu lỡ đơn hàng 2 anh em đóng full 48 buổi thì anh học viên đầu
//   > giảm 15% học viên 2 giảm 15%+10%(anh em) thì sao? thiết kế lại chỗ này, vẫn mở ra, nhưng sẽ chuyển phần này cho quản lý
//   > duyệt nếu thêm chính sách giảm thứ 2."
//   > "trần mức giảm thì để max 25% mà cho qlcs tự chỉnh cho từng cơ sở được"
//
// Hai cổng KHÁC LOẠI, đừng gộp:
//   · CHÍNH SÁCH THỨ 2 ⇒ cổng DUYỆT: đơn VẪN LƯU, không xuất được QR tới khi quản lý duyệt (`xetDuyetDon` → `phan.giamGia`).
//   · VƯỢT TRẦN       ⇒ cổng TỪ CHỐI: đơn KHÔNG lưu (cùng khuôn `khoanVuotTran`/`loiVuotTran`).
//
// ── "CHÍNH SÁCH THỨ NHẤT" LÀ GIÁ HỆ THỐNG TÍNH ───────────────────────────────────────────────────────────────────
// Bảng A/B + anh/chị/em TRONG ĐƠN + trần 25% của SR.QD.233 đã nằm trong `thanhTien` do planner tính. Hai anh em cùng đơn đóng đủ 48
// buổi: con hạng 1 được 15%, con hạng 2 được 15%+10% = 25% — đó là CHÍNH SÁCH, KHÔNG phải khoản thêm, nên KHÔNG phải duyệt.
// "Chính sách thứ 2" = bất kỳ khoản nào Sale thêm TRÊN dòng (mã khuyến mãi hoặc khoản gõ tay kèm lý do).
//
// ── TỔNG % TÍNH TRÊN NIÊM YẾT, KHÔNG TRÊN GIÁ ĐÃ GIẢM ────────────────────────────────────────────────────────────
// (niêm yết − thành tiền chính sách + khoản thêm) ÷ niêm yết. Tính trên giá đã giảm thì 15% rồi thêm 10% chỉ ra 23,5% — trần 25%
// bị lách đúng bằng cách xếp khoản theo thứ tự; trần phải trả lời "khách được bớt bao nhiêu so với giá gốc".
//
// ── TRẦN THẤP HƠN CHÍNH SÁCH ─────────────────────────────────────────────────────────────────────────────────────
// QLCS hạ trần xuống dưới mức chính sách (vd trần 20% mà con hạng 2 được 25%): CHÍNH SÁCH VẪN ÁP (đó là quy định SR.QD.233, không phải
// khoản Sale thêm) và chỉ CHẶN khoản thêm. Đơn KHÔNG bị từ chối chỉ vì chính sách. Hiện thực: trần chỉ được xét khi dòng CÓ khoản thêm.
// Đây là câu hỏi mở với chủ dự án — xem báo cáo PR.

/** Đầu vào của MỘT dòng SCOPE. Tất cả là số nguyên đồng. */
export interface DongGiamThem {
  /** Niêm yết tại mốc, trước mọi giảm (`DongPhamVi.niemYet`). */
  readonly niemYet: number;
  /** Thành tiền theo CHÍNH SÁCH, trước khoản thêm (`DongPhamVi.thanhTien` = đơn giá dòng). */
  readonly thanhTienChinhSach: number;
  /** Tổng khoản giảm Sale thêm trên dòng, đã server tính (`TienDong.giam`). */
  readonly giamThem: number;
  /** Số KHOẢN thêm (mã khuyến mãi + khoản gõ tay). */
  readonly soKhoanThem: number;
}

/** Số ưu đãi đem so với `orders.maxDiscountItems`, và dòng có bị coi là "áp thêm chương trình ngoài chính sách" không. */
export interface UuDaiDongPhamVi {
  /** `soKhoanThem` + 1 (dòng chính sách luôn là ưu đãi thứ nhất, kể cả 0%). */
  readonly soUuDai: number;
  /** Có khoản thêm trên dòng (luôn có dòng chính sách) ⇒ đó là chính sách thứ 2. */
  readonly ngoaiChinhSach: boolean;
}

/**
 * Đếm ưu đãi của một dòng SCOPE.
 *
 * Dòng SCOPE LUÔN có dòng chính sách "nộp theo học phần" là ưu đãi THỨ NHẤT — kể cả khi mức chính sách là 0% (mốc 12 buổi). Nên bất kỳ
 * khoản Sale thêm nào cũng là ưu đãi từ thứ hai ⇒ `soUuDai = soKhoanThem + 1` > `orders.maxDiscountItems` mặc định 1 ⇒ chờ duyệt
 * [chủ dự án chốt 20/10/2026, vòng 2: *"dòng 0% + 1 khoản tay: có"* phải duyệt]. Dòng không có khoản thêm ⇒ KHÔNG đếm chính sách
 * (`soUuDai = 0`): hành vi hôm nay của đơn SCOPE không đổi, và một cấu hình trần thấp bất thường không thể đẩy MỌI đơn SCOPE vào hàng chờ.
 */
export function uuDaiDongPhamVi(d: Pick<DongGiamThem, "soKhoanThem">): UuDaiDongPhamVi {
  if (d.soKhoanThem <= 0) return { soUuDai: 0, ngoaiChinhSach: false };
  return { soUuDai: d.soKhoanThem + 1, ngoaiChinhSach: true };
}

/** Phép tính trần của một dòng. Phần trăm ở dạng "phần trăm × 100" (2 chữ số thập phân) để khỏi so số thực. */
export interface KetQuaTranDong {
  /** Giảm theo chính sách, đồng. */
  readonly giamChinhSach: number;
  readonly tongGiam: number;
  /** Phần trăm CHÍNH SÁCH × 100, làm tròn xuống (15% → 1500). */
  readonly phanTramChinhSachX100: number;
  /** Phần trăm TỔNG × 100, làm tròn LÊN (25,001% → 2501) — làm tròn lên để biên "đúng 25%" qua còn "25,01%" không lọt. */
  readonly phanTramTongX100: number;
  /** `true` ⇔ có khoản thêm VÀ tổng vượt trần. Dòng không có khoản thêm không bao giờ vượt (chính sách luôn áp). */
  readonly vuotTran: boolean;
  /** Trần thấp hơn mức chính sách (dòng có khoản thêm): chính sách vẫn áp, khoản thêm bị chặn hết. */
  readonly tranThapHonChinhSach: boolean;
  /** Số điểm phần trăm còn lại tới trần (≥ 0), 2 chữ số thập phân ×100. Dòng đã vượt/ngang trần ⇒ 0. */
  readonly conLaiX100: number;
}

/**
 * Xét trần tổng % của MỘT dòng SCOPE. `tranPhanTram` là số nguyên % (tham số vận hành `billing.scopeMaxDiscountPercent`).
 *
 * So bằng NHÂN CHÉO số nguyên: `tongGiam × 100 ≤ trần × niêm yết`. Đúng 25% (2.640.000 trên 10.560.000) qua; 25,01% (khoản thêm
 * làm tổng thành 2.640.106) bị từ chối. Không dùng số thực.
 */
export function xetTranDong(d: DongGiamThem, tranPhanTram: number): KetQuaTranDong {
  const niem = Math.max(0, Math.trunc(d.niemYet));
  const giamChinhSach = Math.max(0, Math.trunc(d.niemYet) - Math.trunc(d.thanhTienChinhSach));
  const them = Math.max(0, Math.trunc(d.giamThem));
  const tongGiam = giamChinhSach + them;
  const tran = Number.isFinite(tranPhanTram) ? tranPhanTram : 0;
  // Ceil phép chia số nguyên: (a + b - 1) / b.
  const x100 = (tu: number, lam: "xuong" | "len") =>
    niem === 0 ? 0 : lam === "xuong" ? Math.floor((tu * 10000) / niem) : Math.ceil((tu * 10000) / niem);
  const phanTramChinhSachX100 = x100(giamChinhSach, "xuong");
  const phanTramTongX100 = x100(tongGiam, "len");
  // Dòng KHÔNG có khoản thêm không bao giờ vượt: trần chỉ chặn khoản Sale thêm, không từ chối chính sách hệ thống.
  const vuotTran = them > 0 && (niem === 0 || tongGiam * 100 > tran * niem);
  return {
    giamChinhSach,
    tongGiam,
    phanTramChinhSachX100,
    phanTramTongX100,
    vuotTran,
    tranThapHonChinhSach: them > 0 && giamChinhSach * 100 > tran * niem,
    conLaiX100: Math.max(0, tran * 100 - phanTramTongX100),
  };
}

/** Dòng nào vượt trần (chỉ số 0-based), cùng khuôn trả về với `khoanVuotTran`. */
export function dongVuotTranPhamVi(dong: readonly DongGiamThem[], tranPhanTram: number): number[] {
  return dong.flatMap((d, i) => (xetTranDong(d, tranPhanTram).vuotTran ? [i] : []));
}

/** "25,01" từ 2501. Không dùng `toLocaleString`: kết quả phụ thuộc ICU của máy chạy (cùng lý do `dinhDangDong`). */
export function dinhDangPhanTram(x100: number): string {
  const nguyen = Math.floor(x100 / 100);
  const le = x100 % 100;
  if (le === 0) return String(nguyen);
  return `${nguyen},${String(le).padStart(2, "0").replace(/0$/, "")}`;
}

/** Nơi QLCS chỉnh trần — câu chữ ở MỘT chỗ để màn hình và máy chủ không nói hai đường khác nhau. */
export const NOI_CHINH_TRAN_PHAM_VI = "Cấu hình vận hành → tab Thanh toán → «Cài riêng theo cơ sở» (Quản lý cơ sở chỉnh cho cơ sở mình)";

/**
 * Câu TỪ CHỐI khi có dòng vượt trần. Nói bằng ngôn ngữ của nguyên nhân: dòng nào, tổng bao nhiêu % niêm yết (chính sách bao nhiêu +
 * thêm bao nhiêu), trần là bao nhiêu và chỉnh ở đâu — chứ không chỉ "vượt trần".
 */
export function loiVuotTranPhamVi(
  dong: readonly (DongGiamThem & { readonly nhan: string })[],
  chiSo: readonly number[],
  tranPhanTram: number,
): string {
  const cau = chiSo.map((i) => {
    const d = dong[i]!;
    const k = xetTranDong(d, tranPhanTram);
    const dau = `${d.nhan}: tổng giảm ${dinhDangPhanTram(k.phanTramTongX100)}% giá niêm yết (chính sách ${dinhDangPhanTram(k.phanTramChinhSachX100)}% + thêm ${dinhDangPhanTram(k.phanTramTongX100 - k.phanTramChinhSachX100)}%), vượt trần ${tranPhanTram}% của cơ sở này.`;
    return k.tranThapHonChinhSach
      ? `${dau} Trần thấp hơn mức chính sách phạm vi học: chính sách vẫn áp, nhưng không cộng thêm được khoản giảm nào.`
      : dau;
  });
  return `${cau.join("\n")}\nBỏ bớt khoản giảm thêm, hoặc nhờ Quản lý cơ sở nâng trần ở ${NOI_CHINH_TRAN_PHAM_VI}.`;
}
