/**
 * GIẢM GIÁ THEO TỪNG DÒNG ĐƠN — phép tính tiền ở ĐÚNG MỘT chỗ.
 *
 * ── Vì sao có file này (15/09/2026) ──
 * Chủ dự án, sáng: "giảm giá tách riêng theo từng đơn luôn chứ không gộp chung giảm tổng
 * đơn." Chiều: "chỗ giảm giá cũng làm flex đi, vì 1 đơn có thể áp nhiều giảm giá khác
 * nhau." Nên một DÒNG nay mang một DANH SÁCH khoản giảm, không phải một ô.
 *
 * Từ khi một đơn chở được nhiều con ([[hoc-vien-dong-don]]), một ô giảm giá cấp đơn
 * không trả lời được "bớt cho đứa nào"; và một ô giảm giá cấp dòng không trả lời được
 * "bớt theo chương trình nào" khi ưu đãi chồng lên nhau — anh chị em học cùng + đóng sớm
 * cả khoá + học bổng riêng của em đó.
 *
 * ⚠️ File THUẦN — KHÔNG `import "server-only"`. Form tạo đơn (client) và
 * `createOrderManualAction` (server) phải tính ra CÙNG một con số; hai bản cài đặt là
 * hai con số, và con số người bán đọc trên màn hình sẽ khác con số vào sổ.
 * `lib/orders/discount.ts` là `server-only` nên `discountFromPercent` ở đây và được tệp
 * đó nhập lại — MỘT cài đặt, không phải hai.
 */

/** Cách người bán gõ một khoản giảm: số tiền tuyệt đối hay phần trăm. */
export const KIEU_GIAM = {
  SO_TIEN: "SO_TIEN",
  PHAN_TRAM: "PHAN_TRAM",
} as const;
export type KieuGiam = (typeof KIEU_GIAM)[keyof typeof KIEU_GIAM];

/**
 * LOẠI ƯU ĐÃI — nhãn CÓ CẤU TRÚC cho một khoản giảm [PHIÊN E · 21/09/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ, VÀ NÓ KHÔNG LÀM GÌ VỚI TIỀN
 *
 * Trước hôm nay, thứ duy nhất nói được "khoản bớt này là chương trình nào" là `lyDo` —
 * một ô text gõ tay. Hỏi *"đơn này có ưu đãi anh chị em không"* thì chỉ trả lời được bằng
 * mắt, không bằng truy vấn. Chủ dự án chốt 21/09: thêm loại có cấu trúc, **chỉ để đánh
 * dấu**.
 *
 * ⚠️ **KHÔNG đường tính tiền nào đọc trường này.** `gopGiamGia` chở nó qua y nguyên như
 * một nhãn; số tiền vẫn hoàn toàn do `kieu` + `giaTri` quyết. Biến nó thành đầu vào của
 * phép tính (vd "ANH_EM thì tự trừ 15%") là mở một đường ghi tiền thứ hai mà không cổng
 * nào đang canh.
 *
 * ⚠️ **TUỲ CHỌN, không bắt buộc.** Hai lý do, cả hai đều có giá:
 *   · dữ liệu CŨ không có trường này và **cố ý không đoán ngược từ `lyDo`** (chốt 21/09:
 *     *"BỎ QUA, không đoán từ chữ, không gán tay hàng loạt"*);
 *   · bắt buộc là chặn sale lưu đơn vì một nhãn thống kê — cái giá lớn hơn cái lợi.
 *   Đổi lại: nhãn này **không đủ tin để đếm**. Chỗ nào cần con số thật phải nói rõ là nó
 *   chỉ đếm được đơn tạo TỪ 21/09/2026 trở đi, và có nhãn.
 *
 * Danh sách bám đúng ba "ưu đãi cộng thêm" của trang khoá học
 * (`components/legacy-laptrinhrobot/_data/promotions.ts`) + học bổng + đóng sớm.
 */
export const LOAI_GIAM = {
  /** Gói Anh/Chị/Em — gia đình có từ 2 con đăng ký. */
  ANH_EM: "ANH_EM",
  /** Referral — người được giới thiệu. */
  GIOI_THIEU: "GIOI_THIEU",
  /** Gói đội thi 2 HV. */
  DOI_THI: "DOI_THI",
  HOC_BONG: "HOC_BONG",
  DONG_SOM: "DONG_SOM",
  KHAC: "KHAC",
} as const;
export type LoaiGiam = (typeof LOAI_GIAM)[keyof typeof LOAI_GIAM];

export const MA_LOAI_GIAM = Object.values(LOAI_GIAM) as readonly LoaiGiam[];

/** Nhãn tiếng Việt cho từng loại — dùng chung form nhập và màn đọc. */
export const NHAN_LOAI_GIAM: Record<LoaiGiam, string> = {
  ANH_EM: "Anh/chị/em học cùng",
  GIOI_THIEU: "Giới thiệu (referral)",
  DOI_THI: "Gói đội thi",
  HOC_BONG: "Học bổng",
  DONG_SOM: "Đóng sớm",
  KHAC: "Khác",
};

/** Ép một giá trị bất kỳ về `LoaiGiam`, `null` nếu không thuộc danh sách. */
export function docLoaiGiam(v: unknown): LoaiGiam | null {
  return typeof v === "string" && (MA_LOAI_GIAM as readonly string[]).includes(v)
    ? (v as LoaiGiam)
    : null;
}

/**
 * Trần số khoản giảm trên MỘT dòng.
 *
 * Không phải giới hạn kỹ thuật — là giới hạn để người đọc đơn còn hiểu được. Sáu khoản
 * ưu đãi trên một dòng thì không ai đối chiếu nổi với chính sách, và gần như chắc chắn
 * là người bán đang gõ nhầm chỗ. Validator dùng đúng con số này.
 */
export const TRAN_KHOAN_GIAM_MOI_DONG = 5;

/**
 * TRẦN % của MỘT khoản giảm — MẶC ĐỊNH cho code thuần. 50% (chốt 15/09/2026).
 *
 * ⚠️ ĐÂY KHÔNG PHẢI NGUỒN SỰ THẬT. Trần thật là tham số vận hành
 * `orders.maxDiscountPercent`, quản trị sửa ở màn "Cấu hình vận hành". Hằng này chỉ
 * dùng cho nơi KHÔNG chạm DB được (test thuần, bản nháp).
 *
 * Cùng bài học với `crm.commissionMaxTotalRate` (CLAUDE.md, 27/08/2026): mọi đường
 * chạm DB được PHẢI `getSetting` rồi TRUYỀN VÀO, nếu không thì người vận hành nới trần
 * ở màn cấu hình mà đường ghi vẫn chặn theo số cũ — và không lỗi nào báo.
 *
 * Vì thế `tranPhanTram` của `gopGiamGia`/`tienDong`/`tienDon` cố ý KHÔNG có giá trị
 * mặc định: để `tsc` liệt kê hết chỗ gọi khi con số này đổi nhà (luật 7 — tham số có
 * mặc định NGUY HIỂM thì bỏ mặc định). Mặc định ở đây nguy hiểm theo CHIỀU HẠ: người
 * vận hành hạ trần về 30 mà một chỗ gọi quên truyền thì chỗ đó vẫn cho tới 50 — fail
 * OPEN, tức bớt cho khách nhiều hơn chính sách.
 */
export const TRAN_PHAN_TRAM_MAC_DINH = 50;

/**
 * Số tiền giảm từ % — làm tròn, kẹp trong `[0, goc]`.
 *
 * ⚠️ Dời từ `lib/orders/discount.ts` sang (15/09/2026) vì tệp đó `server-only` mà form
 * cũng cần đúng phép tính này. Tệp cũ nhập lại từ đây; đừng chép lại thân hàm.
 */
export function discountFromPercent(goc: number, percent: number): number {
  if (!(percent > 0)) return 0;
  const pct = Math.min(100, Math.max(0, percent));
  return Math.min(goc, Math.round((goc * pct) / 100));
}

/** Một khoản giảm ĐÚNG NHƯ người bán gõ. */
export type KhaiGiam = {
  kieu: KieuGiam;
  /** Số tiền (VND) khi `SO_TIEN`; phần trăm (0..100) khi `PHAN_TRAM`. */
  giaTri: number;
  /** Giải trình của RIÊNG khoản này. */
  lyDo?: string | null;
  /**
   * Loại ưu đãi — NHÃN, không tham gia phép tính nào. Xem `LOAI_GIAM`.
   *
   * `null`/bỏ trống là HỢP LỆ: mọi khoản tạo trước 21/09/2026 đều không có, và người bán
   * cũng không bị bắt chọn.
   */
  loai?: LoaiGiam | null;
  /**
   * TRẦN TIỀN của RIÊNG khoản này (`Voucher.maxDiscount`) — 28/09/2026.
   *
   * Chỉ có nghĩa với khoản kiểu `PHAN_TRAM`: chương trình "giảm 10%, tối đa 800.000đ"
   * không diễn đạt được bằng `kieu` + `giaTri`. `null`/bỏ trống = KHÔNG trần, đúng với
   * mọi khoản gõ tay và mọi khoản tạo trước hôm nay.
   *
   * ⚠️ Vì sao KHÔNG quy mã về `SO_TIEN` để khỏi cần trường này: quy về số tiền thì cờ
   * `vuotTran` không bao giờ bật, và một chương trình khai 60% sẽ lặng lẽ đi vòng qua
   * tham số vận hành `orders.maxDiscountPercent`. Xem `khaiGiamTuMa`
   * (`lib/khuyen-mai/ap-vao-don.ts`).
   */
  tranTien?: number | null;
  /**
   * `Voucher.id` khi khoản này đến TỪ MỘT CHƯƠNG TRÌNH khuyến mãi; `null` = sale tự gõ.
   *
   * ⚠️ NHÃN/DẤU VẾT, KHÔNG phải đầu vào của phép tính — `gopGiamGia` chở nó qua y nguyên
   * như `loai`. Số tiền vẫn hoàn toàn do `kieu` + `giaTri` + `tranTien` quyết.
   *
   * ⚠️ Và nó KHÔNG được tin từ client. Server đọc `voucherId`, tra DB, rồi TỰ suy lại
   * `kieu`/`giaTri`/`tranTien` bằng `khaiGiamTuMa` — nhận ba con số client gửi kèm là để
   * client cầm cả hai vế của phép trừ, đúng cái bẫy đã ghi ở `lib/orders/hinh-thuc-lop.ts`.
   */
  voucherId?: string | null;
};

/** Một khoản giảm SAU KHI đã tính và đã kẹp — đây là thứ ghi vào `OrderItem.discounts`. */
export type GiamDaAp = {
  kieu: KieuGiam;
  /** Số người bán gõ (Ý ĐỊNH). */
  giaTri: number;
  /** % đã gõ; null khi gõ theo số tiền. */
  phanTram: number | null;
  /** Số THỰC SỰ trừ được sau khi kẹp vào phần còn lại của dòng (SỐ THẬT). */
  giam: number;
  lyDo: string | null;
  /** Loại ưu đãi — chở qua y nguyên từ `KhaiGiam`. KHÔNG tham gia phép tính nào. */
  loai: LoaiGiam | null;
  /**
   * `Voucher.id` nếu khoản đến từ chương trình khuyến mãi — chở qua y nguyên. Đây là thứ
   * đi vào `OrderItem.discounts` JSON, và là cầu nối để ghi `VoucherRedemption`.
   */
  voucherId: string | null;
  /**
   * Khoản này bị TRẦN TIỀN của chương trình cắt bớt (`tranTien` nhỏ hơn số tính theo %).
   *
   * Khác hẳn `vuotTran`: vượt trần là sale gõ SAI chính sách ⇒ TỪ CHỐI cả đơn. Còn chạm
   * trần tiền là chương trình chạy ĐÚNG như BLĐ ban hành ⇒ cho qua, chỉ cần nói ra trên
   * màn để sale không hứa khách "15% của 10 triệu" khi trần chặn ở 800.000đ.
   */
  chamTranTien: boolean;
  /**
   * Khoản này gõ % VƯỢT trần cấu hình.
   *
   * `gopGiamGia` vẫn KẸP xuống trần để không đường nào tính ra số vượt chính sách,
   * nhưng cờ này phải tồn tại: kẹp im lặng là người bán hứa khách 80% rồi hệ thống
   * trừ 50%, và sai lệch đó chỉ lộ ra lúc phụ huynh đọc hoá đơn. Form đọc cờ để báo
   * ngay, action đọc cờ để TỪ CHỐI cả đơn.
   */
  vuotTran: boolean;
};

export type TienDong = {
  /** `unitPrice * quantity` — TRƯỚC giảm. Đây là thứ cộng thành `Order.subtotal`. */
  tamTinh: number;
  /** Σ các khoản đã áp. Luôn `0 ≤ giam ≤ tamTinh`. */
  giam: number;
  /** `tamTinh - giam`. Không bao giờ âm. */
  thanhTien: number;
  /**
   * % của CẢ DÒNG — chỉ có nghĩa khi dòng có ĐÚNG MỘT khoản kiểu `PHAN_TRAM`.
   * Nhiều khoản ⇒ `null`, vì lúc đó "phần trăm của dòng" không tồn tại như một con số.
   */
  phanTram: number | null;
  /** Từng khoản, cùng thứ tự người bán gõ. */
  khoan: GiamDaAp[];
};

/**
 * LUẬT CỘNG DỒN — CHỐT CỦA CHỦ DỰ ÁN 15/09/2026. Đây là chỗ quyết định số tiền.
 *
 * Nguyên văn: *"2 dòng là để 1 dòng giảm theo tiền 1 dòng giảm theo % thôi, còn nếu
 * cả 2 dòng đều giảm % thì = TỔNG % 2 dòng."*
 *
 * ⇒ Mỗi khoản % tính trên TẠM TÍNH GỐC của dòng, KHÔNG lũy tiến trên phần còn lại:
 *     10%  + 500.000đ  trên 2.400.000đ  ⇒  240.000 + 500.000 = 740.000
 *     10%  + 20%       trên 1.000.000đ  ⇒  **30%** = 300.000  (lũy tiến sẽ ra 28%)
 *
 * ⚠️ ĐỪNG ĐỔI SANG LŨY TIẾN. Đây không còn là một lựa chọn kỹ thuật để cân đo — nó là
 * quyết định nghiệp vụ đã ký. Ba lý do đứng sau nó, để người sau hiểu vì sao chứ không
 * phải để mở lại cuộc tranh luận:
 *   · Đó là cách phụ huynh tự nhẩm. "Giảm 10% rồi giảm tiếp 20%" — không ai nhẩm ra
 *     28%, và một con số khách không nhẩm được là một cuộc gọi thắc mắc.
 *   · Đó là cách MỘT khoản giảm vốn đã tính (% trên `tamTinh`) ⇒ không đơn cũ nào đổi
 *     nghĩa khi cột `discounts` ra đời.
 *   · Lũy tiến làm THỨ TỰ GÕ thành yếu tố quyết định số tiền — kéo đổi chỗ hai khoản
 *     trên màn hình là đổi tiền, mà không gì trên màn hình nói ra điều đó.
 *
 * Chủ dự án cũng xác nhận ca "hai khoản cùng kiểu %" là ca BIÊN, không phải ca thường
 * ("sẽ không có trường hợp đó xảy ra đâu") — nhưng luật vẫn phải khai tường minh, vì
 * một ca biên không được khai là một ca biên sẽ tự chọn hành vi vào ngày nó xảy ra.
 * Ghim ở [GGD-07].
 *
 * ⚠️ KẸP THEO PHẦN CÒN LẠI, và `giam` ghi SỐ THẬT. Khi tổng vượt tạm tính, khoản cuối bị
 * cắt bớt chứ không phải cả dòng bị kẹp ở tổng: nhờ vậy bảng hiển thị cộng các khoản LUÔN
 * ra đúng tổng. Kẹp ở tổng thì từng dòng in ra một đằng, tổng một nẻo — và người đọc sẽ
 * tin cái họ cộng được bằng tay.
 */
export function gopGiamGia(
  tamTinh: number,
  khai: readonly KhaiGiam[],
  /** Trần % cho MỘT khoản — `orders.maxDiscountPercent`. KHÔNG có mặc định, xem
   *  chú thích ở `TRAN_PHAN_TRAM_MAC_DINH`. */
  tranPhanTram: number,
): GiamDaAp[] {
  const goc = Math.max(0, tamTinh);
  // Trần rác (0, âm, > 100) ⇒ rơi về mặc định thay vì cho qua: một con số trần sai
  // không được biến thành 'không có trần'.
  const tran =
    Number.isFinite(tranPhanTram) && tranPhanTram >= 1 && tranPhanTram <= 100
      ? Math.floor(tranPhanTram)
      : TRAN_PHAN_TRAM_MAC_DINH;
  let conLai = goc;
  const ra: GiamDaAp[] = [];

  for (const k of khai) {
    if (!k || !(k.giaTri > 0)) continue;
    const laPct = k.kieu === KIEU_GIAM.PHAN_TRAM;
    // Kẹp xuống TRẦN (không phải 100): trần là chính sách, 100 chỉ là giới hạn toán học.
    const pct = laPct ? Math.min(tran, Math.max(0, k.giaTri)) : null;
    const vuotTran = laPct && k.giaTri > tran;
    // Tính trên GỐC (cộng dồn), rồi mới kẹp vào phần còn lại.
    const theoKieu = laPct
      ? discountFromPercent(goc, pct!)
      : Math.max(0, Math.round(k.giaTri));
    // TRẦN TIỀN của chương trình (`Voucher.maxDiscount`) — kẹp TRƯỚC khi kẹp theo phần
    // còn lại của dòng. Trần rác (âm, không hữu hạn) ⇒ BỎ QUA trần thay vì kẹp về 0: một
    // con số trần hỏng không được biến thành "không giảm đồng nào".
    const coTran =
      k.tranTien != null && Number.isFinite(k.tranTien) && k.tranTien >= 0;
    const muon = coTran ? Math.min(theoKieu, Math.round(k.tranTien!)) : theoKieu;
    const chamTranTien = coTran && muon < theoKieu;
    const giam = Math.min(muon, conLai);
    conLai -= giam;
    ra.push({
      kieu: k.kieu,
      giaTri: k.giaTri,
      phanTram: pct,
      giam,
      lyDo: k.lyDo?.trim() || null,
      // Chở qua y nguyên. `gopGiamGia` KHÔNG được phép đọc nhãn này để quyết một đồng nào.
      loai: k.loai ?? null,
      voucherId: k.voucherId ?? null,
      vuotTran,
      chamTranTien,
    });
  }
  return ra;
}

/** Đầu vào tiền của một dòng. `giam` là DANH SÁCH khoản, kể cả khi chỉ có một. */
export type DongDeTinh = {
  unitPrice: number;
  quantity: number;
  giam?: readonly KhaiGiam[] | null;
};

/**
 * Tiền của MỘT dòng. Nhận đúng những gì dòng có, không cần biết gì về đơn.
 *
 * `quantity`/`unitPrice` âm hoặc rác ⇒ kẹp về 0 thay vì ném: hàm này chạy ở client trên
 * từng phím gõ, ném ở đó là trắng màn hình giữa lúc nhập liệu. Cổng chặn giá trị bậy là
 * validator + action, không phải hàm tính.
 */
export function tienDong(input: DongDeTinh, tranPhanTram: number): TienDong {
  const tamTinh =
    Math.max(0, Math.round(input.unitPrice)) * Math.max(0, Math.round(input.quantity));
  const khoan = gopGiamGia(tamTinh, input.giam ?? [], tranPhanTram);
  const giam = khoan.reduce((s, k) => s + k.giam, 0);
  // Chỉ quy ra "% của dòng" khi dòng có ĐÚNG MỘT khoản và khoản đó là %.
  const phanTram =
    khoan.length === 1 && khoan[0]!.phanTram != null ? khoan[0]!.phanTram : null;
  return { tamTinh, giam, thanhTien: tamTinh - giam, phanTram, khoan };
}

export type TienDon = {
  /** Σ tạm tính từng dòng — đặt vào `Order.subtotal`. */
  tamTinh: number;
  /** Σ giảm từng dòng — đặt vào `Order.discountAmount`. */
  tongGiam: number;
  /** `tamTinh - tongGiam + phiVanChuyen` — đặt vào `Order.totalAmount`. */
  tongDon: number;
  /** Tiền của từng dòng, cùng thứ tự đầu vào. */
  dong: TienDong[];
};

/**
 * Tiền của CẢ ĐƠN, suy từ các dòng. Không có đường nhập giảm giá nào khác.
 *
 * `Order.discountAmount` = ĐÚNG tổng các dòng. Cột đó được hoá đơn · ZNS · báo cáo đọc,
 * nên nó phải là tổng thật chứ không phải một số nhập độc lập — hai đường nhập cho cùng
 * một con tiền là định nghĩa của sổ lệch.
 */
/**
 * Tuỳ chọn của `tienDon`. `tranPhanTram` BẮT BUỘC, `phiVanChuyen` thì không —
 * phí vận chuyển thiếu thì ra 0 (đúng với đơn khoá học), còn trần thiếu thì sai chính sách.
 */
export type TuyChonTienDon = { phiVanChuyen?: number; tranPhanTram: number };

export function tienDon(dong: readonly DongDeTinh[], opts: TuyChonTienDon): TienDon {
  const phiVanChuyen = opts.phiVanChuyen ?? 0;
  const tung = dong.map((d) => tienDong(d, opts.tranPhanTram));
  const tamTinh = tung.reduce((s, d) => s + d.tamTinh, 0);
  const tongGiam = tung.reduce((s, d) => s + d.giam, 0);
  return {
    tamTinh,
    tongGiam,
    tongDon: tamTinh - tongGiam + Math.max(0, Math.round(phiVanChuyen)),
    dong: tung,
  };
}

/** Một khoản giảm THIẾU giải trình — chỉ ra ĐÚNG dòng nào, khoản thứ mấy. */
export type ThieuGiaiTrinh = { dong: number; khoan: number };

/**
 * Khoản nào CÓ giảm mà THIẾU giải trình.
 *
 * Cơ chế DUYỆT giảm giá đã gỡ 14/09/2026, nhưng GIẢI TRÌNH thì giữ, và hai thứ đó hay bị
 * gộp làm một. "Duyệt" là một người phải bấm trước khi đơn đi tiếp — đó là thứ đã bỏ.
 * "Giải trình" là một dòng chữ nói vì sao bớt tiền — nó chính là cái THAY THẾ cổng duyệt,
 * nên bỏ nó là bỏ cả hai. Nay nó theo TỪNG KHOẢN: gộp ba ưu đãi vào một ô giải trình là
 * mất đúng thứ vừa cất công tách ra.
 *
 * Trả chỉ số (1-based khi hiển thị) chứ không trả boolean: với đơn bốn dòng mỗi dòng ba
 * khoản thì "thiếu giải trình" không đủ để người bán biết đi sửa ở đâu.
 */
export function dongThieuGiaiTrinh(
  dong: readonly (DongDeTinh & { giam?: readonly KhaiGiam[] | null })[],
  tranPhanTram: number,
): ThieuGiaiTrinh[] {
  const ra: ThieuGiaiTrinh[] = [];
  dong.forEach((d, i) => {
    tienDong(d, tranPhanTram).khoan.forEach((k, j) => {
      if (k.giam > 0 && !k.lyDo) ra.push({ dong: i + 1, khoan: j + 1 });
    });
  });
  return ra;
}

/**
 * Khoản nào gõ % VƯỢT trần — cùng khuôn trả về với `dongThieuGiaiTrinh`.
 *
 * TỪ CHỐI chứ không kẹp im lặng. `gopGiamGia` có kẹp, nhưng kẹp là lưới an toàn cho
 * con SỐ; còn con NGƯỜI thì vừa hứa với phụ huynh một mức bớt khác. Để đơn lưu được
 * với 50% trong khi sale gõ 80% là dựng sẵn một cuộc tranh cãi mà hệ thống có đủ dữ
 * kiện để chặn ngay lúc bấm Lưu.
 */
export function khoanVuotTran(
  dong: readonly (DongDeTinh & { giam?: readonly KhaiGiam[] | null })[],
  tranPhanTram: number,
): ThieuGiaiTrinh[] {
  const ra: ThieuGiaiTrinh[] = [];
  dong.forEach((d, i) => {
    tienDong(d, tranPhanTram).khoan.forEach((k, j) => {
      if (k.vuotTran) ra.push({ dong: i + 1, khoan: j + 1 });
    });
  });
  return ra;
}

/** Câu thông báo cho người bán khi có khoản vượt trần. */
export function loiVuotTran(
  vuot: readonly ThieuGiaiTrinh[],
  tranPhanTram: number,
): string {
  const cho = vuot.map((t) => `dòng ${t.dong} (khoản ${t.khoan})`).join(", ");
  return `Giảm theo % tối đa ${tranPhanTram}% mỗi khoản — vượt trần ở ${cho}`;
}

/** Câu thông báo cho người bán, từ kết quả `dongThieuGiaiTrinh`. */
export function loiThieuGiaiTrinh(thieu: readonly ThieuGiaiTrinh[]): string {
  const cho = thieu.map((t) => `dòng ${t.dong} (khoản ${t.khoan})`).join(", ");
  return `Có giảm giá thì phải nhập giải trình — còn thiếu ở ${cho}`;
}

/**
 * Chuỗi giải trình GỘP cho `Order.discountReason`.
 *
 * Cột đó được hoá đơn và nhật ký đọc, nên nó phải nói được điều gì đó mà không cần biết
 * về cột JSON. Kèm số thứ tự dòng để lần ngược được về đúng đứa trẻ.
 */
export function giaiTrinhGopChoDon(dong: readonly TienDong[]): string | null {
  const phan = dong.flatMap((d, i) =>
    d.khoan
      .filter((k) => k.giam > 0 && k.lyDo)
      .map((k) => `Dòng ${i + 1}: ${k.lyDo}`),
  );
  return phan.length > 0 ? phan.join(" · ") : null;
}
