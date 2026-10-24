// lib/orders/chinh-sach-uu-dai.ts — ƯU ĐÃI ANH EM: CHÍNH SÁCH + PHÉP TÍNH. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN F3 · US-19 "Thêm con vào gia đình đang học"
//
// Chủ dự án chốt 22/09/2026, khi tôi hỏi "phần giảm muộn trừ vào đợt nào":
//
//   *"làm cho quản lý tự cài đặt cho phần này trên hệ thống"*
//
// Nên tệp này KHÔNG chứa một con số chính sách nào. Nó chứa HÌNH DẠNG của chính sách và
// PHÉP TÍNH đọc chính sách ấy. Số thật nằm ở tham số vận hành (`lib/settings/registry.ts`,
// nhóm `billing.sibling*` + `billing.lateDiscountAbsorb`), quản lý sửa ở màn "Cấu hình vận
// hành" — cùng nếp `crm.commissionMaxTotalRate` và `orders.maxDiscountPercent`.
//
// ⚠️ **Hằng `CHINH_SACH_MAC_DINH` dưới đây KHÔNG phải nguồn sự thật.** Nó chỉ để dùng cho
// nơi KHÔNG chạm DB được (test thuần, bản nháp ở client). Mọi đường chạm DB được PHẢI
// `getSetting` rồi TRUYỀN VÀO — bài học `crm.commissionMaxTotalRate` (CLAUDE.md, 27/08):
// người vận hành đổi chính sách ở màn cấu hình mà đường ghi vẫn tính theo số cũ, và không
// lỗi nào báo. Vì thế `tinhUuDaiAnhEm` nhận `chinhSach` BẮT BUỘC, không có mặc định (luật 7
// — để `tsc` liệt kê hết chỗ gọi).
//
// ─────────────────────────────────────────────────────────────────────────────
// XẾP HẠNG CON: MỘT LUẬT, HAI KHOÁ SẮP
//
// Con thứ 1 không giảm · con thứ 2 nhận bậc thứ nhất · con thứ 3 trở lên nhận bậc thứ hai.
// Chỉ KHOÁ SẮP đổi theo chính sách:
//
//   · `HOC_PHI_THAP_HON` (mặc định BA §10 `LOWEST_LIST_PRICE`) — sắp theo học phí niêm yết
//     GIẢM DẦN, nên "con thứ 2" là con rẻ hơn. Với hai con, đúng ca TS-40: gia đình có Bình
//     12.000.000, thêm An 9.600.000 ⇒ An nhận 10% → 8.640.000, Bình KHÔNG đổi.
//   · `GHI_DANH_SAU` (`LATER_ENROLLED`) — sắp theo thứ tự vào đơn, con vào sau nhận ưu đãi.
//
// ⚠️ Hai chính sách này cho KẾT QUẢ KHÁC NHAU trên cùng một gia đình, và lệch về TIỀN THẬT.
// Thêm một bé học khoá ĐẮT hơn: theo `HOC_PHI_THAP_HON` thì ưu đãi CHUYỂN sang bé cũ (bé cũ
// rẻ hơn) — tức bé cũ bỗng được giảm muộn, và đó chính là ca AC3 của US-19. Theo
// `GHI_DANH_SAU` thì ưu đãi thuộc bé mới và bé cũ không đổi gì.

/** Ưu đãi áp cho con nào. */
export const DOI_TUONG_UU_DAI = {
  /** Con có học phí niêm yết THẤP HƠN. Mặc định theo BA §10. */
  HOC_PHI_THAP_HON: "HOC_PHI_THAP_HON",
  /** Con GHI DANH SAU. */
  GHI_DANH_SAU: "GHI_DANH_SAU",
} as const;
export type DoiTuongUuDai = (typeof DOI_TUONG_UU_DAI)[keyof typeof DOI_TUONG_UU_DAI];

/** Phần giảm MUỘN (phát sinh sau khi đã chia đợt) trừ vào đợt nào. */
export const CACH_HAP_THU = {
  /** Trừ dần từ đợt có hạn MUỘN NHẤT về trước. Giữ nguyên số của đợt gần nhất. */
  DOT_XA_NHAT: "DOT_XA_NHAT",
  /** Chia theo tỷ lệ trên mọi đợt mở. */
  CHIA_DEU: "CHIA_DEU",
  /** Trừ dần từ đợt có hạn SỚM NHẤT. Phụ huynh hưởng ngay lần đóng tới. */
  DOT_GAN_NHAT: "DOT_GAN_NHAT",
} as const;
export type CachHapThu = (typeof CACH_HAP_THU)[keyof typeof CACH_HAP_THU];

/** Ảnh chụp chính sách ưu đãi — người gọi nạp từ tham số vận hành. */
export type ChinhSachUuDai = {
  /** `false` = hệ thống KHÔNG tự tính; sale gõ tay như trước F3. */
  tuDong: boolean;
  /** % cho con thứ 2. */
  phanTramConThu2: number;
  /** % cho con thứ 3 trở lên. */
  phanTramConThu3: number;
  doiTuong: DoiTuongUuDai;
  /** Có cộng dồn với ưu đãi đóng full không. BA §5: mặc định KHÔNG. */
  congDonDongFull: boolean;
  hapThu: CachHapThu;
};

/**
 * Bản MẶC ĐỊNH — khớp BA §10. **KHÔNG phải nguồn sự thật**, xem chú thích đầu tệp.
 *
 * Cố ý để `tuDong: false`: bật một máy tính tiền cho mọi cơ sở bằng một lần deploy là
 * chuyện chủ dự án phải quyết, không phải hệ quả của việc merge một PR.
 */
export const CHINH_SACH_MAC_DINH: ChinhSachUuDai = {
  tuDong: false,
  phanTramConThu2: 10,
  phanTramConThu3: 15,
  doiTuong: DOI_TUONG_UU_DAI.HOC_PHI_THAP_HON,
  congDonDongFull: false,
  hapThu: CACH_HAP_THU.DOT_XA_NHAT,
};

/** Một dòng hàng của đơn, chỉ phần cần cho phép tính ưu đãi. */
export type DongDeTinhUuDai = {
  orderItemId: string;
  ten: string;
  /** Học phí NIÊM YẾT của dòng (`unitPrice × quantity`). Khoá sắp của `HOC_PHI_THAP_HON`. */
  tamTinh: number;
  /** Thứ tự vào đơn (0,1,2…). Khoá sắp của `GHI_DANH_SAU`. */
  thuTuVaoDon: number;
  /**
   * Dòng này có còn TÍNH LÀ MỘT CON của gia đình không.
   *
   * ⚠️ Bé BẢO LƯU vẫn tính (BA §5: *"con đang PAUSED vẫn giữ điều kiện ưu đãi anh em cho
   * con khác"*). Bé ĐÃ DỪNG HỌC thì KHÔNG — nhưng việc mất ưu đãi khi một bé dừng học
   * **không tự động xảy ra**: PHIÊN E chốt *"mất ưu đãi: KHÔNG làm, thay bằng CẢNH BÁO"*.
   * Cột này chỉ để phép tính của F3 đếm đúng số con ĐANG học tại lúc thêm con mới.
   */
  conDangHoc: boolean;
  /** Dòng đã có khoản ưu đãi ĐÓNG FULL — dùng cho vế `congDonDongFull`. */
  coUuDaiDongFull?: boolean;
};

export type UuDaiMotDong = {
  orderItemId: string;
  ten: string;
  /** Hạng của con trong gia đình: 1 = không giảm, 2 = bậc thứ nhất, ≥3 = bậc thứ hai. */
  hang: number;
  phanTram: number;
  /** Số tiền giảm, làm tròn. `0` khi hạng 1 hoặc khi bị vế cộng dồn loại. */
  giam: number;
  /** Vì sao dòng này KHÔNG được giảm dù hạng ≥ 2. `null` = được giảm bình thường. */
  viSaoKhongGiam: "HANG_MOT" | "DA_CO_DONG_FULL" | "CHINH_SACH_TAT" | null;
};

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * Ưu đãi anh em của từng dòng, theo chính sách đang hiệu lực.
 *
 * ⚠️ `chinhSach` BẮT BUỘC (luật 7). Mặc định ở đây nguy hiểm theo CHIỀU MỞ: người vận hành
 * hạ % xuống 5 mà một chỗ gọi quên truyền thì chỗ đó vẫn giảm 10 — bớt cho khách nhiều hơn
 * chính sách, và không lỗi nào báo.
 *
 * ⚠️ Trả về MỌI dòng, kể cả dòng không được giảm, kèm `viSaoKhongGiam`. Lọc sẵn ở đây là
 * màn xem trước không giải thích được vì sao một bé không có ưu đãi — và câu hỏi đó là câu
 * sale bị phụ huynh hỏi.
 */
export function tinhUuDaiAnhEm(input: {
  dong: readonly DongDeTinhUuDai[];
  chinhSach: ChinhSachUuDai;
}): UuDaiMotDong[] {
  const cs = input.chinhSach;

  // Chỉ con ĐANG HỌC tham gia xếp hạng. Bé đã dừng học không còn là một "con" của gia đình
  // cho mục đích ưu đãi, nhưng dòng của bé vẫn phải có mặt trong kết quả (hạng 1, giảm 0)
  // để người gọi không phải tự ghép lại hai danh sách.
  const thamGia = input.dong.filter((d) => d.conDangHoc);

  const khoaSap = (d: DongDeTinhUuDai) =>
    cs.doiTuong === DOI_TUONG_UU_DAI.HOC_PHI_THAP_HON ? -tron(d.tamTinh) : d.thuTuVaoDon;

  // Sắp tăng dần theo khoá. `HOC_PHI_THAP_HON` dùng khoá ÂM nên con ĐẮT NHẤT ra đầu ⇒ nó là
  // "con thứ 1", và con rẻ hơn thành con thứ 2 — đúng ca TS-40.
  //
  // ⚠️ Phá thế hoà bằng `thuTuVaoDon`, KHÔNG để nguyên thứ tự đầu vào: hai bé học phí BẰNG
  // NHAU là ca thường (hai con học cùng khoá), và khi đó "ai là con thứ 2" phải là một câu
  // trả lời ỔN ĐỊNH. Không phá thế hoà thì thứ tự phụ thuộc cách sắp của máy, nên cùng một
  // gia đình có thể ra hai kết quả khác nhau ở hai lượt đọc — lệch tiền, không ai hiểu vì sao.
  const xep = [...thamGia].sort(
    (a, b) => khoaSap(a) - khoaSap(b) || a.thuTuVaoDon - b.thuTuVaoDon,
  );

  const hangTheoDong = new Map(xep.map((d, i) => [d.orderItemId, i + 1]));

  return input.dong.map((d) => {
    const hang = hangTheoDong.get(d.orderItemId) ?? 1;
    const nen = (): { phanTram: number; vi: UuDaiMotDong["viSaoKhongGiam"] } => {
      if (!cs.tuDong) return { phanTram: 0, vi: "CHINH_SACH_TAT" };
      if (hang <= 1) return { phanTram: 0, vi: "HANG_MOT" };
      if (d.coUuDaiDongFull && !cs.congDonDongFull) {
        return { phanTram: 0, vi: "DA_CO_DONG_FULL" };
      }
      return {
        phanTram: hang === 2 ? cs.phanTramConThu2 : cs.phanTramConThu3,
        vi: null,
      };
    };
    const { phanTram, vi } = nen();
    const pct = Math.min(100, Math.max(0, phanTram));
    return {
      orderItemId: d.orderItemId,
      ten: d.ten,
      hang,
      phanTram: vi === null ? pct : 0,
      giam: vi === null ? Math.min(tron(d.tamTinh), Math.round((tron(d.tamTinh) * pct) / 100)) : 0,
      viSaoKhongGiam: vi,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HẤP THỤ PHẦN GIẢM MUỘN VÀO CÁC ĐỢT ĐANG MỞ
//
// US-19 AC3: *"đợt CHƯA_THU của con cũ huỷ-tạo mới số thấp hơn; KHÔNG tạo quyết toán âm cho
// đợt đã thu."*
//
// ⚠️ Chỉ đợt **CHƯA NHẬN ĐỒNG NÀO** (`daRot === 0`) được sửa. Đợt đã có tiền thì `kiemHuyDot`
// vốn đã từ chối huỷ, và sửa `amountDue` của nó là đúng con bug đang GHIM ở repo (`[PR-02d]`
// — phiếu hoá "thu vượt", công nợ đơn lệch theo). Nên phép này không bao giờ chạm chúng.
//
// ⚠️ Hấp thụ KHÔNG đủ thì KHÔNG ném và KHÔNG bịa: phần còn lại trả về ở `chuaHapThuDuoc`.
// Nghĩa của nó rất cụ thể — phụ huynh đã đóng NHIỀU HƠN học phí mới, tức bé ĐÓNG THỪA thật,
// và đó là việc của đường chuyển tiền giữa hai con (F1) hoặc đường hoàn tiền. Tự ý nuốt con
// số ấy là làm sổ khớp bằng cách giấu một khoản tiền của phụ huynh.
// ─────────────────────────────────────────────────────────────────────────────

/** Một đợt đang mở của con, chỉ phần cần cho phép hấp thụ. */
export type DotDeHapThu = {
  id: string;
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
  /** Σ đã rót vào đợt. `> 0` ⇒ đợt KHÔNG được sửa. */
  daRot: number;
};

export type HapThuMotDot = { id: string; installmentNo: number; soCu: number; soMoi: number };

export type KeHoachHapThu = {
  /** Đợt phải huỷ & tạo lại với số mới. Chỉ gồm đợt THỰC SỰ đổi số. */
  doi: HapThuMotDot[];
  /** Phần đã hấp thụ được vào các đợt. */
  daHapThu: number;
  /** Phần KHÔNG hấp thụ được ⇒ bé sẽ đóng thừa đúng số này. */
  chuaHapThuDuoc: number;
  /** Đợt bị bỏ qua vì đã nhận tiền — liệt kê để màn hình nói thật. */
  boQuaVeDaCoTien: { id: string; installmentNo: number; daRot: number }[];
};

/**
 * Phân phần giảm `canGiam` vào các đợt đang mở theo `cach`.
 *
 * ⚠️ `dueDate === null` xếp CUỐI ở cả hai chiều sắp. Đợt không có hạn thì không so được với
 * đợt có hạn, và đặt nó lên đầu chiều "xa nhất" sẽ làm nó ăn phần giảm trước mọi đợt khác —
 * tức một đợt chưa hẹn ngày lại là đợt bị sửa đầu tiên.
 */
export function keHoachHapThu(input: {
  dot: readonly DotDeHapThu[];
  canGiam: number;
  cach: CachHapThu;
}): KeHoachHapThu {
  const canGiam = Math.max(0, tron(input.canGiam));
  const boQuaVeDaCoTien = input.dot
    .filter((d) => tron(d.daRot) > 0)
    .map((d) => ({ id: d.id, installmentNo: d.installmentNo, daRot: tron(d.daRot) }));

  const suaDuoc = input.dot.filter((d) => tron(d.daRot) === 0 && tron(d.amountDue) > 0);
  const tongSuaDuoc = suaDuoc.reduce((s, d) => s + tron(d.amountDue), 0);

  if (canGiam === 0 || suaDuoc.length === 0) {
    return { doi: [], daHapThu: 0, chuaHapThuDuoc: canGiam, boQuaVeDaCoTien };
  }

  const canLay = Math.min(canGiam, tongSuaDuoc);
  const soMoi = new Map<string, number>(suaDuoc.map((d) => [d.id, tron(d.amountDue)]));

  if (input.cach === CACH_HAP_THU.CHIA_DEU) {
    // Chia theo TỶ LỆ `amountDue`, phần dư làm tròn dồn vào đợt CUỐI DANH SÁCH (theo số đợt)
    // để tổng khớp KHÍT. Cùng quy ước với `dung-hoc.ts`: phần dư luôn rơi vào một chỗ đã
    // nói trước, không rải ra cho "đều" — rải ra là mỗi đợt lệch một ít và không ai cộng lại
    // được đúng số.
    const theoSoDot = [...suaDuoc].sort((a, b) => a.installmentNo - b.installmentNo);
    let daChia = 0;
    theoSoDot.forEach((d, i) => {
      const laCuoi = i === theoSoDot.length - 1;
      const phan = laCuoi
        ? canLay - daChia
        : Math.floor((canLay * tron(d.amountDue)) / tongSuaDuoc);
      daChia += phan;
      soMoi.set(d.id, tron(d.amountDue) - phan);
    });
  } else {
    // Thứ tự lấy = ba khoá, xét lần lượt:
    //   1. CÓ HẠN trước, KHÔNG HẠN sau — ở CẢ HAI chiều. Đợt chưa hẹn ngày thì không so
    //      được với đợt có hạn, và để nó đi đầu chiều "xa nhất" là một đợt chưa hẹn ngày
    //      lại bị sửa trước mọi đợt khác.
    //   2. ngày hạn, theo chiều của chính sách;
    //   3. số đợt — phá thế hoà, để thứ tự KHÔNG phụ thuộc cách sắp của máy.
    //
    // ⚠️ Viết thành ba khoá RỜI chứ không dùng `Infinity` làm ngày: bản đầu lấy
    // `dueDate ?? Number.POSITIVE_INFINITY` rồi trừ, và hai đợt CÙNG không có hạn cho ra
    // `Infinity - Infinity = NaN`. Một `NaN` trong hàm so sánh là thứ tự KHÔNG XÁC ĐỊNH —
    // tức cùng dữ liệu có thể ra hai kết quả, và đây là hàm quyết định đợt nào bị sửa số.
    // Ca `[UDC-20]` bắt được.
    const xaNhat = input.cach === CACH_HAP_THU.DOT_XA_NHAT;
    const coHan = (d: DotDeHapThu) => (d.dueDate ? 0 : 1);
    const ngay = (d: DotDeHapThu) => d.dueDate?.getTime() ?? 0;
    const thuTu = [...suaDuoc].sort(
      (a, b) =>
        coHan(a) - coHan(b) ||
        (xaNhat ? ngay(b) - ngay(a) : ngay(a) - ngay(b)) ||
        (xaNhat ? b.installmentNo - a.installmentNo : a.installmentNo - b.installmentNo),
    );
    let conLai = canLay;
    for (const d of thuTu) {
      if (conLai <= 0) break;
      const lay = Math.min(conLai, tron(d.amountDue));
      soMoi.set(d.id, tron(d.amountDue) - lay);
      conLai -= lay;
    }
  }

  const doi = suaDuoc
    .map((d) => ({
      id: d.id,
      installmentNo: d.installmentNo,
      soCu: tron(d.amountDue),
      soMoi: soMoi.get(d.id) ?? tron(d.amountDue),
    }))
    .filter((x) => x.soMoi !== x.soCu)
    .sort((a, b) => a.installmentNo - b.installmentNo);

  return {
    doi,
    daHapThu: canLay,
    chuaHapThuDuoc: canGiam - canLay,
    boQuaVeDaCoTien,
  };
}
