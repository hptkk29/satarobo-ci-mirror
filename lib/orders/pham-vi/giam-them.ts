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
// ── [ĐẢO 27/10/2026] KHÔNG CÒN "CHÍNH SÁCH THỨ NHẤT" DO HỆ THỐNG TÍNH ───────────────────────────────────────────
// Chủ dự án: *"thẻ chính sách nộp theo học phần này bỏ đi, nó là 1 phần trong các chương trình khuyến mãi sẽ được add"*. Đường tạo đơn
// truyền `CHINH_SACH_KHONG_GIAM` (`lib/pricing/tinh-gia-theo-moc.ts`) cho planner ⇒ `thanhTien = niemYet`, không dòng chính sách dựng sẵn;
// mốc buổi / gói trọn / anh chị em là chương trình khuyến mãi Sale chọn. Hệ quả: câu hỏi "2 chương trình có tính dòng chính sách không" HẾT
// ĐỐI TƯỢNG (không còn dòng đó) và trần % chỉ đo tổng các khoản chọn/gõ. Các hàm bên dưới vẫn tổng quát theo `niemYet − thanhTienChinhSach`
// (= 0 cho dòng mới; > 0 cho dòng CS2 trên test tạo trước 27/10 — đừng tính lại chúng).
//
// ── (LỊCH SỬ, đến 26/10/2026) "CHÍNH SÁCH THỨ NHẤT" LÀ GIÁ HỆ THỐNG TÍNH ─────────────────────────────────────────
// Bảng A/B + anh/chị/em TRONG ĐƠN + trần 25% của SR.QD.233 đã nằm trong `thanhTien` do planner tính. Hai anh em cùng đơn đóng đủ 48
// buổi: con hạng 1 được 15%, con hạng 2 được 15%+10% = 25% — đó là CHÍNH SÁCH, KHÔNG phải khoản thêm, nên KHÔNG phải duyệt.
// "Chính sách thứ 2" = khoản Sale thêm TRÊN dòng. Hai loại khoản, hai cách xử lý [ĐẢO MỘT PHẦN 26/10/2026, chủ dự án: *"nếu chọn theo
// chương trình có sẵn thì không cần quản lý duyệt, nếu thêm dòng tự giảm riêng thì bắt buộc qua quản lý cơ sở duyệt"*]:
//   · khoản CHỌN TỪ CHƯƠNG TRÌNH CÓ SẴN (`voucherId` do máy chủ tra DB) ⇒ KHÔNG duyệt, NHƯNG tối đa `TOI_DA_CHUONG_TRINH_KHONG_DUYET` (2) chương trình
//     trên một dòng — chương trình thứ 3 trở đi phải duyệt (vẫn bị cổng TRẦN % và điều kiện của chương trình);
//   · khoản SALE TỰ GÕ (không `voucherId`) ⇒ BẮT BUỘC duyệt, KHÔNG phụ thuộc `orders.maxDiscountItems` — tham số đó không nới được luật này.
// Cả hai áp cho MỌI dòng KHOÁ HỌC (`laDongKhoaHoc`), kể cả khi cơ sở chưa bật thu theo phạm vi học [chủ dự án 26/10/2026: *"tất cả loại đơn về khoá học đều áp dụng
// luật này"*]. "Chương trình có sẵn" đếm theo KHOẢN CHỌN TỪ DANH SÁCH (từ 27/10 không còn dòng chính sách dựng sẵn nào để đếm hay không đếm).
// Ngoài ra MỘT VĂN BẢN chỉ áp MỘT mã trên một dòng (`khoanTrungVanBan`, `lib/khuyen-mai/ap-vao-don.ts`) — vi phạm là TỪ CHỐI, không phải chờ duyệt.
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
}

/**
 * Một khoản giảm Sale thêm — CHỈ phần cần để đếm. `KhaiGiam` (`lib/orders/giam-gia-dong.ts`) thoả hình này nên máy chủ và form truyền thẳng
 * danh sách khoản của dòng; không bên nào tự đếm rồi truyền SỐ (hai chỗ đếm là hai cách lệch: máy chủ từng đếm cả khoản 0đ, form thì không).
 */
export interface KhoanDeDem {
  readonly giaTri: number;
  /**
   * `Voucher.id` khi khoản đến TỪ MỘT CHƯƠNG TRÌNH có sẵn; trống = Sale tự gõ.
   * ⚠️ Phía máy chủ phải truyền khoản ĐÃ QUA bước tra DB (`khaiGiamTuMa`), nơi `voucherId` chỉ còn khi mã tồn tại và dùng được — đừng truyền
   * `discounts` thô của client, nếu không "chương trình" chỉ là một cờ client tự bật.
   */
  readonly voucherId?: string | null;
}

/**
 * Số CHƯƠNG TRÌNH có sẵn tối đa một dòng khoá học được chọn mà KHÔNG phải duyệt [chủ dự án chốt 26/10/2026, trong chat]:
 * *"cũng chỉ đc 2 chương trình có sẵn, nếu sang chương trình km thứ 3 cũng phải chờ duyệt"*.
 *
 * ⚠️ CỐ Ý là hằng số, KHÔNG phải `orders.maxDiscountItems`: tham số đó mặc định 1, QLCS chỉnh được cho cơ sở mình, và đếm cả dòng chính sách —
 * dùng nó làm trần chương trình là để mỗi cơ sở có một con số "2" khác nhau cho một quy định BLĐ đã chốt. Muốn chỉnh được thì đó là một khoá cấu hình
 * MỚI cần chủ dự án chốt (QLCS có sửa được không), đừng đổi nghĩa khoá cũ.
 */
export const TOI_DA_CHUONG_TRINH_KHONG_DUYET = 2;

/** Dòng này có phải dòng KHOÁ HỌC không (luật duyệt khoản giảm áp cho dòng khoá học, không áp cho sản phẩm/lệ phí). Nhận `OrderItem.type`. */
export function laDongKhoaHoc(type: string | null | undefined): boolean {
  return type === "COURSE_ENROLLMENT" || type === "COURSE_PACKAGE";
}

/** Vì sao khoản giảm của một dòng khoá học phải qua Quản lý cơ sở duyệt. Thêm lý do = thêm MỘT dòng vào `DIEU_KIEN_DUYET` và MỘT câu ở `cauLyDoDuyetKhoa`. */
export type LyDoDuyetKhoa = "GO_RIENG" | "NHIEU_CHUONG_TRINH";

/** Kết quả đếm khoản giảm thêm của một dòng khoá học. */
export interface UuDaiDongKhoaHoc {
  /** Số khoản CHỌN TỪ CHƯƠNG TRÌNH có sẵn (giá trị > 0). */
  readonly soChuongTrinh: number;
  /** Số khoản Sale TỰ GÕ (giá trị > 0). */
  readonly soGoRieng: number;
  /** Các lý do phải duyệt, theo thứ tự `DIEU_KIEN_DUYET`. RỖNG = dòng này không phải duyệt vì khoản giảm. */
  readonly lyDo: readonly LyDoDuyetKhoa[];
}

/**
 * Điều kiện nào kéo dòng vào hàng chờ duyệt — LIỆT KÊ, không if/else: bản hai-cờ-ghép-nhánh của luật duyệt thứ ba từng gắn nhãn SAI cho đơn chỉ vướng một
 * lý do (CLAUDE.md, "NHÃN VÀ CÂU CHẶN DỰNG TỪ DANH SÁCH"); thêm điều kiện thứ ba bằng nhánh tay là mời đúng con bug đó quay lại.
 */
const DIEU_KIEN_DUYET: readonly {
  readonly lyDo: LyDoDuyetKhoa;
  readonly viPham: (d: { soChuongTrinh: number; soGoRieng: number }) => boolean;
}[] = [
  { lyDo: "GO_RIENG", viPham: (d) => d.soGoRieng > 0 },
  { lyDo: "NHIEU_CHUONG_TRINH", viPham: (d) => d.soChuongTrinh > TOI_DA_CHUONG_TRINH_KHONG_DUYET },
];

/**
 * Đếm khoản giảm thêm của MỘT dòng khoá học và cho biết có phải duyệt không.
 *
 * · Khoản giá trị 0 không tính (không giảm đồng nào, và form lọc `giaTri > 0` khi gửi).
 * · Khoản đến từ chương trình có sẵn (`voucherId`) KHÔNG làm đơn chờ duyệt [chủ dự án chốt 26/10/2026] — tới `TOI_DA_CHUONG_TRINH_KHONG_DUYET`; chương trình
 *   đã được BLĐ ban hành và máy chủ đã kiểm điều kiện của nó; vẫn chịu TRẦN tổng % (`xetTranDong`).
 * · Khoản tự gõ ⇒ BẮT BUỘC duyệt, kể cả chỉ MỘT khoản, kể cả cạnh một chương trình.
 * · Không có khoản nào ⇒ `lyDo` rỗng: hành vi của đơn không khoản thêm không đổi, và một cấu hình bất thường không thể đẩy MỌI đơn vào hàng chờ.
 */
export function uuDaiDongKhoaHoc(giam: readonly KhoanDeDem[]): UuDaiDongKhoaHoc {
  const them = giam.filter((k) => k.giaTri > 0);
  const soGoRieng = them.filter((k) => !k.voucherId).length;
  const d = { soChuongTrinh: them.length - soGoRieng, soGoRieng };
  return { ...d, lyDo: DIEU_KIEN_DUYET.filter((c) => c.viPham(d)).map((c) => c.lyDo) };
}

/**
 * Câu lý do cho SALE đọc — MỘT nơi cho cả `xetDuyetDon` (chữ trong chuông + hàng chờ) lẫn form (dòng nhắc dưới khoản giảm). `ten` là tên dòng ("Bé An",
 * "Dòng 2"). Bản đồ chứ không `switch`: thiếu một lý do là `tsc` báo.
 */
const CAU_LY_DO_DUYET_KHOA: Record<LyDoDuyetKhoa, (ten: string) => string> = {
  GO_RIENG: (ten) => `${ten}: có khoản giảm Sale tự gõ, không thuộc chương trình có sẵn — cần Quản lý cơ sở duyệt.`,
  NHIEU_CHUONG_TRINH: (ten) =>
    `${ten}: chọn quá ${TOI_DA_CHUONG_TRINH_KHONG_DUYET} chương trình khuyến mãi trên một dòng — cần Quản lý cơ sở duyệt.`,
};

export function cauLyDoDuyetKhoa(ten: string, lyDo: LyDoDuyetKhoa): string {
  return CAU_LY_DO_DUYET_KHOA[lyDo](ten);
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
    // Dòng tạo từ 27/10/2026 không còn giảm theo chính sách (`giamChinhSach` = 0): chỉ tách "chính sách + thêm" khi dòng CÓ phần chính sách,
    // để câu từ chối không in "chính sách 0% + thêm …" — thứ người bán không thấy ở đâu trên form.
    const chiTiet =
      k.giamChinhSach > 0
        ? ` (chính sách ${dinhDangPhanTram(k.phanTramChinhSachX100)}% + thêm ${dinhDangPhanTram(k.phanTramTongX100 - k.phanTramChinhSachX100)}%)`
        : "";
    const dau = `${d.nhan}: tổng giảm ${dinhDangPhanTram(k.phanTramTongX100)}% giá niêm yết${chiTiet}, vượt trần ${tranPhanTram}% của cơ sở này.`;
    return k.tranThapHonChinhSach
      ? `${dau} Trần thấp hơn mức chính sách phạm vi học: chính sách vẫn áp, nhưng không cộng thêm được khoản giảm nào.`
      : dau;
  });
  return `${cau.join("\n")}\nBỏ bớt khoản giảm thêm, hoặc nhờ Quản lý cơ sở nâng trần ở ${NOI_CHINH_TRAN_PHAM_VI}.`;
}
