// lib/payments/pos/sai-ma.ts — VIỆC 3: sale nhập SAI MÃ trên máy POS, khách đã quẹt thành công. THUẦN, chạy được ở trình duyệt.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5. Sự thật nền: ghi chú của giao dịch thẻ KHÔNG sửa được (máy, portal, file xuất
// đều là bản ghi của ngân hàng) — mọi việc "sửa" là GẮN giao dịch đó vào đúng phiếu, ở trong satarobo.
//
// Tệp này chỉ QUYẾT, không đọc/ghi gì:
//   · `locUngVien`     — giao dịch nào được làm ứng viên (các vế KHÔNG biểu diễn được trong câu truy vấn);
//   · `phanLoaiSaiMa`  — "sale xác nhận là đủ" hay "chờ kế toán duyệt", liệt kê ĐỦ lý do chứ không first-match;
//   · hiệu lực suy, ma trận chuyển trạng thái, chặn tự duyệt, câu chữ.
// Màn hình gọi `phanLoaiSaiMa` để nhãn nút nói đúng điều SẮP xảy ra; máy chủ tính LẠI dưới khoá và có quyền đổi bậc.
//
// ⚠️ KHÔNG import `@/lib/db` / tiền tố gỡ gắn (`TIEN_TO_GO_GAN` nằm ở `ghi-tien-don.ts`, có `server-only`): các vế cần chúng
// được người gọi đọc sẵn thành cờ boolean (`daGoGan`, `btDaGoGan`).
import { BANG_CHU, DAI_MA, maHopLe } from "@/lib/payments/ma-phieu";
import { laLoaiThanhToan, laTrangThaiThanhCong, tinHieuHoanHuy } from "./phan-loai-pos";
import { laChuThuongGap, tachTokenGhiChu } from "./tach-ma-pos";
import { laCauChuaThay } from "./thong-diep-pos";

// ─────────────────────────────────────────────────────────────────────────────
// KHOẢNG CÁCH MÃ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Khoảng cách giữa hai chuỗi CÙNG ĐỘ DÀI theo nghĩa của đặc tả: `0` giống hệt · `1` thay ĐÚNG MỘT ký tự HOẶC đổi chỗ hai
 * ký tự LIỀN KỀ · `2` = từ hai trở lên hoặc KHÁC độ dài (chèn/xoá ký tự nằm ngoài đặc tả: token 4 hay 6 ký tự là "lệch nhiều").
 */
export function khoangCachMa(a: string, b: string): 0 | 1 | 2 {
  if (a.length !== b.length) return 2;
  const lech: number[] = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      lech.push(i);
      if (lech.length > 2) return 2;
    }
  }
  if (lech.length === 0) return 0;
  if (lech.length === 1) return 1;
  const [i, j] = lech as [number, number];
  return j === i + 1 && a[i] === b[j] && a[j] === b[i] ? 1 : 2;
}

/**
 * Mọi mã HỢP LỆ (qua checksum) cách `token` ≤ 1: thay một ký tự bằng ký tự của bảng chữ, hoặc đổi chỗ hai ký tự kề.
 * Token không hợp lệ có 1–5 mã như thế (đo 09/10/2026, `docs/pos-hai-nut-khai-may.md` §5.1 Đ17); token HỢP LỆ chỉ lân
 * cận chính nó — vét cạn 413.343 mã × 73,9 triệu chuỗi cách ≤ 1: 0 chuỗi qua `maHopLe` (ca `[HN3-01b]` ghim bằng mẫu).
 * Dùng để tìm "phiếu khác mà ghi chú cũng gần giống mã của nó" (`GAN_MA_PHIEU_KHAC`).
 */
export function lanCanMa(token: string): string[] {
  if (token.length !== DAI_MA) return [];
  const ra = new Set<string>();
  if (maHopLe(token)) ra.add(token);
  for (let p = 0; p < DAI_MA; p += 1) {
    for (const c of BANG_CHU) {
      if (c === token[p]) continue;
      const s = token.slice(0, p) + c + token.slice(p + 1);
      if (maHopLe(s)) ra.add(s);
    }
  }
  for (let p = 0; p < DAI_MA - 1; p += 1) {
    if (token[p] === token[p + 1]) continue;
    const s = token.slice(0, p) + token[p + 1] + token[p] + token.slice(p + 2);
    if (maHopLe(s)) ra.add(s);
  }
  return [...ra];
}

// ─────────────────────────────────────────────────────────────────────────────
// ỨNG VIÊN
// ─────────────────────────────────────────────────────────────────────────────

/** Trần số ứng viên HIỂN THỊ; đọc 11 để biết còn nữa (≥ 2 ứng viên thì chắc chắn chờ kế toán). */
export const SO_UNG_VIEN_TOI_DA = 10;

/**
 * Một dòng giao dịch thẻ + những sự thật quanh nó mà tầng đọc đã tra sẵn. Mỗi cờ là MỘT luật mà thân dòng chung của đường
 * tiền (hoặc kế toán) SẼ chặn — không loại ở danh sách thì nút "Tôi nhập sai mã" hứa mà đường tiền từ chối (luật 12).
 */
export type DongUngVien = {
  maGiaoDich: string;
  loaiGiaoDich: string;
  trangThai: string;
  soTien: number;
  trangThaiHoanHuy: string | null;
  /** Cảnh báo "hủy sau khi đã ghi nhận" còn mở trên dòng. */
  canhBaoHuy: boolean;
  /** `BankTransaction.unmatchedNote` bắt đầu bằng tiền tố GỠ GẮN — kế toán đã quyết, không ai khớp lại. */
  daGoGan: boolean;
  /** Có dòng KHÔNG-phải-thanh-toán (hủy/hoàn) mà `maGiaoDichGoc` trỏ vào dòng này. */
  coDongHuyTroVao: boolean;
  /** Có dòng KHÔNG-phải-thanh-toán cùng `maGiaoDichThe` (RRN, không rỗng) — cách `agent/goc-void.ts` ghép VOID với gốc. */
  coDongKhacLoaiCungRrn: boolean;
  /**
   * Kế toán đã BÁC giao dịch này cho ĐƠN của phiếu đang xét — qua BẤT KỲ phiếu thẻ / phiếu gộp nào của đơn (Việc 5: bản Việc 3 chỉ nhớ đúng cặp (phiếu THẺ, giao dịch),
   * mà phiếu thẻ thay được trong khi đơn sống tiếp). Đơn khác không tính. Tên cũ `daBiBacChoPhieu` bỏ để không ai đọc lại thành "theo phiếu thẻ".
   */
  daBiBacChoDon: boolean;
};

/** Dòng có được làm ứng viên cho phiếu đang cần thu `conPhaiThu` không — đúng số, thanh toán + thành công, chưa hủy/hoàn. */
export function laUngVienHopLe(d: DongUngVien, conPhaiThu: number): boolean {
  return (
    conPhaiThu > 0 &&
    d.soTien === conPhaiThu &&
    laLoaiThanhToan(d.loaiGiaoDich) &&
    laTrangThaiThanhCong(d.trangThai) &&
    tinHieuHoanHuy(d.trangThaiHoanHuy) === "TRONG" &&
    !d.canhBaoHuy &&
    !d.daGoGan &&
    !d.coDongHuyTroVao &&
    !d.coDongKhacLoaiCungRrn &&
    !d.daBiBacChoDon
  );
}

/** Giữ thứ tự và mọi trường mở rộng của `rows`. */
export function locUngVien<T extends DongUngVien>(rows: readonly T[], conPhaiThu: number): T[] {
  return rows.filter((d) => laUngVienHopLe(d, conPhaiThu));
}

/**
 * Số dòng bị loại CHỈ vì vết bác: đã mang `daBiBacChoDon` VÀ nếu gỡ cờ ấy thì vẫn là ứng viên hợp lệ. Cùng MỘT vị từ (`laUngVienHopLe`) với `locUngVien` —
 * không viết lại điều kiện ở chỗ gọi. Dòng bị loại vì lý do khác (đã hủy, sai số tiền…) KHÔNG tính: câu "kế toán đã từ chối" chỉ đúng khi vết bác là lý do thật.
 */
export function demBiLoaiVeBac(rows: readonly DongUngVien[], conPhaiThu: number): number {
  return rows.filter((d) => d.daBiBacChoDon && laUngVienHopLe({ ...d, daBiBacChoDon: false }, conPhaiThu)).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHÂN LOẠI: tự ghi nhận hay chờ kế toán
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vì sao một yêu cầu phải chờ kế toán. THỨ TỰ KHAI Ở `THU_TU_LY_DO` LÀ NGUỒN DUY NHẤT của thứ tự hiển thị/lưu.
 * `GHI_TU_DONG_KHONG_DUOC` KHÔNG do `phanLoaiSaiMa` sinh — thêm khi tự ghi nhận đã giữ giao dịch mà thân dòng không ra DA_THU.
 */
export type LyDoChoKeToan =
  | "NHIEU_UNG_VIEN"
  | "GHI_CHU_MANG_MA_KHAC"
  | "GHI_CHU_DA_CO_MA_DUNG"
  | "GHI_CHU_LECH_NHIEU"
  | "GHI_CHU_NHIEU_MA_GAN"
  | "GAN_MA_PHIEU_KHAC"
  | "CO_PHIEU_THE_CANH_TRANH"
  | "DU_LIEU_THIEU"
  | "DA_BI_TU_CHOI_TRUOC"
  | "GHI_TU_DONG_KHONG_DUOC";

export const THU_TU_LY_DO: readonly LyDoChoKeToan[] = [
  "NHIEU_UNG_VIEN",
  "GHI_CHU_MANG_MA_KHAC",
  "GHI_CHU_DA_CO_MA_DUNG",
  "GHI_CHU_LECH_NHIEU",
  "GHI_CHU_NHIEU_MA_GAN",
  "GAN_MA_PHIEU_KHAC",
  "CO_PHIEU_THE_CANH_TRANH",
  "DU_LIEU_THIEU",
  "DA_BI_TU_CHOI_TRUOC",
  "GHI_TU_DONG_KHONG_DUOC",
];

export type DauVaoPhanLoai = {
  /** = `PosPaymentIntent.code5` đọc DƯỚI KHOÁ — không bao giờ chuỗi từ client. */
  maDung: string;
  /** Sau `locUngVien`; 0 ⇒ KHONG_UNG_VIEN. */
  soUngVien: number;
  /** `dienGiai` của ứng viên đang xét. */
  ghiChu: string | null;
  /** Phiếu gộp KHÁC tra được từ {token hợp lệ của ghi chú} ∪ {mã hợp lệ cách ≤ 1 từng token 5 ký tự}. */
  phieuKhac: readonly { ma: string; dangMo: boolean }[];
  /** Phiếu thẻ KHÁC đang mở (chưa nhận giao dịch, chưa hết hạn) cũng nhận được giao dịch này. */
  soPhieuTheCanhTranh: number;
  /** Máy đồng bộ chưa sẵn sàng / có dòng bị từ chối chưa giải / file chưa phủ lúc sau mở phiếu. */
  duLieuThieu: boolean;
  /** Số yêu cầu `TU_CHOI` trước đó trong ĐƠN của phiếu này — mọi phiếu thẻ / phiếu gộp của đơn (Việc 5; bản Việc 3 chỉ đếm CHÍNH phiếu thẻ này). Đơn khác không tính. */
  soLanBiBac: number;
};

export type KetQuaPhanLoai =
  | { quyet: "KHONG_UNG_VIEN" }
  | { quyet: "TU_GHI_NHAN"; ghiChu: "RONG" | "GAN_MA_DUNG" }
  | { quyet: "CHO_KE_TOAN"; lyDo: readonly LyDoChoKeToan[] };

/**
 * Hai bậc xử lý của đặc tả (chủ dự án chốt 09/10/2026):
 *   · TỰ GHI NHẬN khi ĐỦ: đúng 1 ứng viên · ghi chú không mang mã hợp lệ của phiếu khác · ghi chú rỗng HOẶC có đúng một
 *     token 5 ký tự cách mã đúng ≤ 1 (thay/đổi chỗ hai ký tự kề);
 *   · CHỜ KẾ TOÁN trong mọi ca còn lại. Liệt kê ĐỦ lý do (không first-match) để kế toán thấy cả cụm.
 *
 * Năm lý do NGOÀI đặc tả (TỰ QUYẾT V64) — chỉ THÊM ca sang kế toán, không làm rơi ca đặc tả cho tự ghi nhận (một ứng viên,
 * ghi chú rỗng/gần đúng, không cạnh tranh, dữ liệu đủ, chưa từng bị bác):
 *   · vế "ghi chú không chứa mã hợp lệ của phiếu khác ĐANG MỞ" của đặc tả KHÔNG BAO GIỜ bắt chính token gõ sai (token sai ≤ 1
 *     không bao giờ qua checksum — Đ17); sự mơ hồ thật là token cũng cách ≤ 1 mã của một phiếu đang mở khác;
 *   · "mã hợp lệ khác" lấy RỘNG: mọi token qua checksum ≠ mã đúng, dù phiếu đó đã đóng.
 */
export function phanLoaiSaiMa(v: DauVaoPhanLoai): KetQuaPhanLoai {
  if (v.soUngVien <= 0) return { quyet: "KHONG_UNG_VIEN" };

  const token = tachTokenGhiChu(v.ghiChu);
  const nam = [...new Set(token.filter((t) => t.length === DAI_MA))];
  const coMaDung = nam.includes(v.maDung);
  const coMaKhac = nam.some((t) => t !== v.maDung && maHopLe(t) && !laChuThuongGap(t));
  const gan = nam.filter((t) => khoangCachMa(t, v.maDung) === 1);

  const co = new Set<LyDoChoKeToan>();
  if (v.soUngVien >= 2) co.add("NHIEU_UNG_VIEN");
  if (coMaKhac) co.add("GHI_CHU_MANG_MA_KHAC");
  if (coMaDung) co.add("GHI_CHU_DA_CO_MA_DUNG");
  if (token.length > 0 && !coMaDung && gan.length === 0) co.add("GHI_CHU_LECH_NHIEU");
  if (gan.length >= 2) co.add("GHI_CHU_NHIEU_MA_GAN");
  if (gan.some((t) => v.phieuKhac.some((p) => p.dangMo && p.ma !== v.maDung && khoangCachMa(t, p.ma) <= 1))) {
    co.add("GAN_MA_PHIEU_KHAC");
  }
  if (v.soPhieuTheCanhTranh >= 1) co.add("CO_PHIEU_THE_CANH_TRANH");
  if (v.duLieuThieu) co.add("DU_LIEU_THIEU");
  if (v.soLanBiBac >= 1) co.add("DA_BI_TU_CHOI_TRUOC");

  const lyDo = THU_TU_LY_DO.filter((l) => co.has(l));
  if (lyDo.length > 0) return { quyet: "CHO_KE_TOAN", lyDo };
  return { quyet: "TU_GHI_NHAN", ghiChu: token.length === 0 ? "RONG" : "GAN_MA_DUNG" };
}

/** Lý do → chuỗi lưu DB (`PosSaiMaYeuCau.lyDo`, ghép dấu phẩy, đúng thứ tự khai). */
export function ghepLyDo(lyDo: readonly LyDoChoKeToan[]): string {
  return THU_TU_LY_DO.filter((l) => lyDo.includes(l)).join(",");
}

/** Chuỗi lưu DB → lý do; mã lạ bị bỏ (cột có thể do phiên bản sau ghi). */
export function tachLyDo(chuoi: string | null | undefined): LyDoChoKeToan[] {
  const co = new Set((chuoi ?? "").split(",").map((s) => s.trim()));
  return THU_TU_LY_DO.filter((l) => co.has(l));
}

// ─────────────────────────────────────────────────────────────────────────────
// VÒNG ĐỜI CỦA MỘT YÊU CẦU
// ─────────────────────────────────────────────────────────────────────────────

export type TrangThaiSaiMa = "CHO_DUYET" | "DANG_GHI" | "DA_GHI_NHAN" | "TU_CHOI";
export type KieuSaiMa = "TU_GHI_NHAN" | "CHO_KE_TOAN";

/** Ghi tiền (`DANG_GHI`) quá chừng này mà chưa ra kết quả ⇒ coi là KẸT (sập giữa chừng) và cho thử lại. */
export const DANG_GHI_KET_SAU_MS = 2 * 60_000;

const CANH_HOP_LE: Readonly<Record<TrangThaiSaiMa, readonly TrangThaiSaiMa[]>> = {
  CHO_DUYET: ["DANG_GHI", "TU_CHOI"],
  DANG_GHI: ["DA_GHI_NHAN", "CHO_DUYET", "DANG_GHI"],
  DA_GHI_NHAN: [],
  TU_CHOI: [],
};

/**
 * Cạnh nào của vòng đời được phép. Mọi `updateMany … where trangThai = <từ>` ở `sai-ma-ghi.ts` đi qua cặp (từ, đến) này và ca
 * `[HN3-18]` đo cả ma trận: không thể TỪ CHỐI một yêu cầu đang ghi tiền, và hai trạng thái cuối không có cạnh ra.
 */
export function chuyenHopLe(tu: TrangThaiSaiMa, den: TrangThaiSaiMa): boolean {
  return CANH_HOP_LE[tu].includes(den);
}

/** Người quyết ≠ người gửi (DB còn CHECK `PosSaiMaYeuCau_khac_nguoi_check` làm lưới cuối). `null` = được. */
export function chanTuDuyet(nguoiGuiId: string, nguoiQuyetId: string): string | null {
  return nguoiGuiId === nguoiQuyetId ? "Cần người khác duyệt — không tự duyệt yêu cầu do chính mình gửi" : null;
}

export type HieuLucSaiMa = "CHO_DUYET" | "DA_XU_LY_NGOAI" | "DANG_GHI" | "KET" | "DA_GHI_NHAN" | "TU_CHOI";
/** Hiệu lực mà yêu cầu còn ĐANG GIỮ giao dịch (chưa kết) — đúng ba giá trị vẽ chip ở bảng giao dịch và nằm ở hàng chờ. */
export type HieuLucDangGiu = Extract<HieuLucSaiMa, "CHO_DUYET" | "DANG_GHI" | "KET">;

/**
 * Hiệu lực SUY từ sự thật, không lưu (như `dungPhieuPosView.hienThi`): kế toán gắn tay / bỏ qua / gỡ gắn giao dịch đang giữ là
 * quyền của họ (V71 — không thêm cổng lên đường gắn tay) ⇒ dòng `CHO_DUYET` thành "đã xử lý ở nơi khác": rời hàng chờ, vào
 * hậu kiểm, và hộp phiếu in câu đúng thay vì câu lưu.
 */
export function trangThaiHieuLuc(x: {
  trangThai: TrangThaiSaiMa;
  btStatus: "MATCHED" | "UNMATCHED" | "IGNORED";
  btDaGoGan: boolean;
  dangGhiLuc: Date | null;
  now: Date;
}): HieuLucSaiMa {
  switch (x.trangThai) {
    case "DA_GHI_NHAN":
      return "DA_GHI_NHAN";
    case "TU_CHOI":
      return "TU_CHOI";
    case "CHO_DUYET":
      return x.btStatus === "UNMATCHED" && !x.btDaGoGan ? "CHO_DUYET" : "DA_XU_LY_NGOAI";
    case "DANG_GHI":
      return x.dangGhiLuc !== null && x.now.getTime() - x.dangGhiLuc.getTime() < DANG_GHI_KET_SAU_MS ? "DANG_GHI" : "KET";
  }
}

/**
 * Dòng HẬU KIỂM 7 ngày nói gì về người xem xét (rà đối kháng Việc 3, [HN3-RV-08]). `kieu` là bậc LÚC GỬI ([HN3-DB-18] ghim) nên một yêu cầu `TU_GHI_NHAN`
 * vẫn có thể có người quyết — và hai chữ "Sale tự xác nhận" + "Duyệt bởi" không được cùng in cho một dòng (loại trừ nhau). Màn hậu kiểm là bù đắp DUY NHẤT cho bậc
 * không qua kế toán (V69): nhãn sai ở đây làm yếu đúng điều nó phải cho thấy.
 *   · kế toán ĐÃ XEM XÉT nội dung ⇔ yêu cầu từng là `CHO_KE_TOAN`, hoặc tự ghi nhận nhưng rơi về chờ duyệt (`GHI_TU_DONG_KHONG_DUOC`) rồi được duyệt;
 *   · tự ghi nhận bị kẹt, kế toán chỉ bấm "thử lại" ⇒ họ chạy lại VIỆC GHI TIỀN chứ không xem xét gì ⇒ chip còn, dòng người làm nói đúng việc đó.
 */
export function cachXetHauKiem(d: { kieu: KieuSaiMa; hieuLuc: HieuLucSaiMa; lyDo: readonly LyDoChoKeToan[] }): {
  chipSaleTuXacNhan: boolean;
  nhanNguoiQuyet: "Từ chối bởi" | "Duyệt bởi" | "Thử lại ghi nhận bởi";
} {
  const keToanDaXem = d.kieu === "CHO_KE_TOAN" || d.lyDo.includes("GHI_TU_DONG_KHONG_DUOC");
  return {
    chipSaleTuXacNhan: d.kieu === "TU_GHI_NHAN" && d.hieuLuc === "DA_GHI_NHAN" && !keToanDaXem,
    nhanNguoiQuyet: d.hieuLuc === "TU_CHOI" ? "Từ chối bởi" : keToanDaXem ? "Duyệt bởi" : "Thử lại ghi nhận bởi",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NÚT TRÊN HỘP PHIẾU THẺ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nút "Tôi nhập sai mã trên máy" có hiện không — MỘT hàm, component không tự viết điều kiện. Chỉ khi phiếu còn CHỜ QUẸT
 * (không `THAT_BAI`: máy báo lần quẹt gần nhất thất bại — TỰ QUYẾT V62) ∧ câu hiện trên màn là "Chưa thấy giao dịch" (`NOT_FOUND`
 * bao bốn kết luận; chỉ câu chữ phân biệt được). Máy chủ KHÔNG tin nút: kiểm lại bằng sự thật (`sai-ma-doc.ts`).
 */
// `hienThi` là `string`, KHÔNG `HienThiPhieuPos`: `phieu-pos-luat.ts` đã import tệp này (`trangThaiHieuLuc`, câu chữ), nên import ngược lại là VÒNG
// — `pnpm lint:boundaries` (luật `no-circular`, mức error) bắt ở lượt chạy cuối. Người gọi vẫn truyền `HienThiPhieuPos` (con của `string`); đổi tên
// "CHO_QUET" thì `[HN3-17]` và `[HN3-R1]` đỏ vì nút không còn hiện đúng lúc.
export function nutNhapSaiMa(x: { hienThi: string; thongDiep: string | null }): boolean {
  return x.hienThi === "CHO_QUET" && laCauChuaThay(x.thongDiep);
}

// ─────────────────────────────────────────────────────────────────────────────
// CÂU CHỮ — KHÔNG câu nào hướng dẫn huỷ giao dịch trên máy rồi quẹt lại (đặc tả điều 6: khách bị giữ tiền tạm, sinh VOID)
// ─────────────────────────────────────────────────────────────────────────────

/** Nguyên văn đặc tả (09/10/2026). */
export const CAU_KHONG_UNG_VIEN =
  "Không thấy giao dịch nào đúng số tiền trên máy này từ lúc mở phiếu. Kiểm tra biên lai: giao dịch có THÀNH CÔNG không, đúng máy không.";

/**
 * Danh sách ứng viên TRỐNG vì giao dịch đúng số tiền ĐÃ BỊ KẾ TOÁN TỪ CHỐI cho đơn này (Việc 5, rà đối kháng 10/10/2026). Có giao dịch thật — nói "không thấy" là nói sai,
 * và sale đứng trước khách nên phải được CẤM quẹt lại + chỉ lối ra (báo kế toán). Qua `/impeccable clarify`: giữ khung "ĐỪNG cho khách quẹt lại" của `CAU_CHO_KE_TOAN`.
 */
export const CAU_BI_BAC_KHONG_CON_UNG_VIEN =
  "Có giao dịch đúng số tiền, nhưng kế toán đã từ chối nó cho đơn này. Khách có thể đã bị trừ tiền — ĐỪNG cho khách quẹt lại, báo kế toán.";

/**
 * Dòng cảnh báo trên hộp phiếu thẻ MỚI của một đơn từng có giao dịch bị kế toán bác (Việc 5, rà đối kháng): vết bác khoá theo ĐƠN nhưng hộp phiếu mới `saiMa = null` nên
 * không có dòng từ chối riêng. KHÔNG hứa đơn này "đã bị trừ tiền" (phiếu mới có thể là đợt học phí khác) — chỉ nhắc điều đúng và việc cần làm nếu khách ĐÃ quẹt.
 * Không đổi nút nào, không giấu hướng dẫn quẹt (cờ này theo ĐƠN, có thể ứng với phiếu thật sự chưa quẹt).
 */
export const CAU_DON_DA_CO_VET_BAC =
  "Đơn này từng có một giao dịch bị kế toán từ chối. Nếu khách đã quẹt thành công trên máy, ĐỪNG cho khách quẹt lại — báo kế toán.";

/**
 * Câu của danh sách ứng viên TRỐNG. MỘT hàm cho cả bước TÌM (màn) lẫn bước GỬI (máy chủ): hai nơi tự chọn câu là hai nơi có ngày nói hai điều khác nhau.
 * `soBiLoaiVeBac` = số giao dịch bị loại CHỈ vì vết bác (qua đủ mọi vế còn lại của `laUngVienHopLe`).
 */
export function cauKhongUngVien(soBiLoaiVeBac: number): string {
  return soBiLoaiVeBac > 0 ? CAU_BI_BAC_KHONG_CON_UNG_VIEN : CAU_KHONG_UNG_VIEN;
}

/** Sale thấy câu này khi yêu cầu đang chờ kế toán (đặc tả: "Chờ kế toán xác nhận giao dịch nhập sai mã"). */
export const CAU_CHO_KE_TOAN =
  "Chờ kế toán xác nhận giao dịch nhập sai mã. Khách đã quẹt thành công — ĐỪNG cho khách quẹt lại.";

export const CAU_DANG_GHI = "Đang ghi nhận giao dịch nhập sai mã…";
export const CAU_KET =
  "Giao dịch nhập sai mã chưa ghi nhận xong — kế toán sẽ thử lại. ĐỪNG cho khách quẹt lại.";
export const CAU_DA_XU_LY_NGOAI = "Kế toán đã xử lý giao dịch này ở nơi khác — ĐỪNG cho khách quẹt lại, hỏi kế toán.";

/** Dòng RIÊNG sau khi kế toán từ chối: khách có thể đã bị trừ tiền, nên chữ này là lệnh CẤM quẹt lại. */
export function cauTuChoi(lyDo: string | null): string {
  const ly = lyDo?.trim();
  return (
    `Kế toán không xác nhận giao dịch đã chọn${ly ? ` (lý do: ${ly})` : ""}. ` +
    "Khách có thể đã bị trừ tiền — ĐỪNG cho khách quẹt lại, báo kế toán."
  );
}

const CAU_LY_DO: Readonly<Record<LyDoChoKeToan, string>> = {
  NHIEU_UNG_VIEN: "Có nhiều hơn một giao dịch cùng số tiền trên máy — cần kế toán chọn đúng giao dịch của khách.",
  GHI_CHU_MANG_MA_KHAC: "Ghi chú trên máy có mã của một phiếu khác — cần kế toán kiểm tra.",
  GHI_CHU_DA_CO_MA_DUNG: "Ghi chú đã có đúng mã nhưng giao dịch vẫn chưa tự ghi nhận — cần kế toán xem lý do.",
  GHI_CHU_LECH_NHIEU: "Ghi chú trên máy khác mã phiếu nhiều ký tự — cần kế toán xác nhận.",
  GHI_CHU_NHIEU_MA_GAN: "Ghi chú có nhiều chuỗi giống mã phiếu — cần kế toán xác nhận.",
  GAN_MA_PHIEU_KHAC: "Ghi chú cũng gần giống mã của một phiếu khác đang mở — cần kế toán xác nhận.",
  CO_PHIEU_THE_CANH_TRANH: "Có phiếu thẻ khác đang chờ cùng số tiền trên máy này — cần kế toán xác nhận.",
  DU_LIEU_THIEU: "Dữ liệu giao dịch của máy có thể chưa đầy đủ — cần kế toán xác nhận.",
  // Việc 5: vết bác khoá theo ĐƠN nên câu này hiện cả trên phiếu thẻ MỚI chưa từng bị bác — "phiếu này" sẽ nói sai (qua `/impeccable clarify`, 10/10/2026).
  DA_BI_TU_CHOI_TRUOC: "Kế toán đã từ chối một giao dịch cho đơn này — mọi đề nghị sau phải do kế toán xác nhận.",
  GHI_TU_DONG_KHONG_DUOC: "Hệ thống chưa ghi nhận được tự động (số tiền hoặc phiếu đã đổi) — cần kế toán xử lý.",
};

export function cauLyDo(lyDo: LyDoChoKeToan): string {
  return CAU_LY_DO[lyDo];
}

/**
 * Nhãn NGẮN của cùng lý do — cho BẢNG của kế toán (nhiều dòng, cần quét mắt nhanh; câu đầy đủ làm mỗi dòng cao 5–6 dòng chữ, đo ở
 * smoke 375px/1280px 09/10/2026). `cauLyDo` là câu cho SALE đứng quầy, đọc từng thẻ một và cần biết vì sao nút nói "Gửi kế toán";
 * kế toán đã biết việc của mình nên chỉ cần NGUYÊN NHÂN.
 */
const NHAN_LY_DO: Readonly<Record<LyDoChoKeToan, string>> = {
  NHIEU_UNG_VIEN: "Nhiều giao dịch cùng số tiền trên máy",
  GHI_CHU_MANG_MA_KHAC: "Ghi chú có mã của phiếu khác",
  GHI_CHU_DA_CO_MA_DUNG: "Ghi chú đã có đúng mã mà chưa tự ghi nhận",
  GHI_CHU_LECH_NHIEU: "Ghi chú lệch mã nhiều ký tự",
  GHI_CHU_NHIEU_MA_GAN: "Ghi chú có nhiều chuỗi giống mã",
  GAN_MA_PHIEU_KHAC: "Ghi chú cũng gần mã phiếu khác đang mở",
  CO_PHIEU_THE_CANH_TRANH: "Có phiếu thẻ khác chờ cùng số tiền",
  DU_LIEU_THIEU: "Dữ liệu giao dịch của máy có thể thiếu",
  DA_BI_TU_CHOI_TRUOC: "Đơn này từng có một giao dịch bị từ chối",
  GHI_TU_DONG_KHONG_DUOC: "Ghi tự động không được — số tiền/phiếu đã đổi",
};

export function nhanLyDo(lyDo: LyDoChoKeToan): string {
  return NHAN_LY_DO[lyDo];
}

// ─────────────────────────────────────────────────────────────────────────────
// GHI CHÚ HIỂN THỊ — chữ NGƯỜI GÕ trên máy dùng chung, không tin cậy
// ─────────────────────────────────────────────────────────────────────────────

const TRAN_GHI_CHU_HIEN_THI = 120;

const laDieuKhien = (cp: number) => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
/** Zero-width · ký tự điều hướng hai chiều (đổi thứ tự hiển thị của chuỗi cạnh nó) · BOM. */
const laKyTuAn = (cp: number) =>
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x2064) ||
  (cp >= 0x2066 && cp <= 0x2069) ||
  cp === 0xfeff ||
  cp === 0x061c ||
  cp === 0x180e;

/**
 * Bỏ ký tự điều khiển (thành khoảng trắng), zero-width, điều hướng hai chiều; gộp khoảng trắng; cắt 120 ký tự + "…" (không cắt
 * đôi cặp thay thế). Kết quả là CHỮ THƯỜNG — component render bằng text node, không bao giờ HTML (TỰ QUYẾT V73).
 */
export function lamSachGhiChuHienThi(s: string | null | undefined): string {
  if (!s) return "";
  let ra = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (laKyTuAn(cp)) continue;
    ra += laDieuKhien(cp) ? " " : ch;
  }
  const sach = ra.replace(/\s+/g, " ").trim();
  const kyTu = Array.from(sach);
  return kyTu.length > TRAN_GHI_CHU_HIEN_THI ? `${kyTu.slice(0, TRAN_GHI_CHU_HIEN_THI).join("")}…` : sach;
}

// ─────────────────────────────────────────────────────────────────────────────
// KIỂU TRẢ VỀ CHO UI — sống ở tầng thuần để component client import mà không kéo `server-only`
// ─────────────────────────────────────────────────────────────────────────────

/** Một ứng viên cho UI: chỉ thứ sale cần nhận ra giao dịch của khách — không mã giao dịch, không số thẻ đầy đủ. */
export type UngVienHienThi = {
  bankTransactionId: string;
  /** `gioVN` — ISO +07:00. */
  gioQuet: string;
  soTien: number;
  /** 4 số cuối thẻ. */
  soTheCuoi: string | null;
  /** Ghi chú ĐÃ LÀM SẠCH (`lamSachGhiChuHienThi`). */
  ghiChu: string;
  xemTruoc: { quyet: "TU_GHI_NHAN" | "CHO_KE_TOAN"; lyDo: LyDoChoKeToan[] };
};

export type KetQuaTimSaiMa =
  | { ok: false; error: string }
  | {
      ok: true;
      ungVien: UngVienHienThi[];
      conNua: boolean;
      soTien: number;
      may: string;
      /** ISO +07:00 của đầu cửa sổ (mở phiếu − 5′). */
      tuLuc: string;
      /** Câu hiển thị khi KHÔNG có ứng viên (nguyên văn đặc tả); `null` khi có. */
      cau: string | null;
    };
