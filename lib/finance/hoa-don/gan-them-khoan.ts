// lib/finance/hoa-don/gan-them-khoan.ts — GẮN THÊM MỘT KHOẢN THU vào hoá đơn ĐÃ XÁC NHẬN (07/11/2026). THUẦN: không Prisma, không DB, không đồng hồ.
//
// ── CA SINH RA NÓ ────────────────────────────────────────────────────────────────────────────────────────
// Đơn ORD-261011-000001 thu hai lần (đợt 1 = 1.000.000đ, đợt 2 = 7.976.000đ). Kế toán xuất MỘT hoá đơn ở MISA (1C26MAI-16) cho CẢ HAI,
// nhưng hệ thống mới nhận tờ đó cho đợt 1: màn hiện số 16 = 1.000.000đ, còn đợt 2 nằm "Chờ xuất" và gợi ý số 17 ⇒ xuất trùng.
// Màn không có thao tác "gắn thêm lần thu vào hoá đơn đã xuất" (tick «Gộp» chỉ có khi CẢ HAI lần thu còn chưa có hoá đơn), và huỷ rồi nhập
// lại không được vì `TRUNG_SO` chặn dùng lại số của hoá đơn đã huỷ. Lệnh này vá đúng ca đó, MỘT lần, có chữ ký owner.
//
// ── NÓ GHI GÌ — VÀ KHÔNG GHI GÌ ──────────────────────────────────────────────────────────────────────────
// GHI : thêm đúng MỘT dòng `HoaDonKhoan` (hoaDon, khoản, `soTien` = tiền RÒNG của khoản) + nâng `HoaDonDienTu.tongTien` đúng bằng số đó + audit.
// KHÔNG: `Payment` (kể cả xác nhận / cấp RCP — khoản vẫn đi đường xác nhận thường của kế toán, đúng như khi chốt hoá đơn mà khoản còn CHỜ),
//        Receipt, PaymentRequest, tệp PDF/XML, số / ký hiệu / ngày phát hành, người mua, email (không tạo lượt gửi mới: tờ đã ở tay khách),
//        `tienThaLamTron`, `HoaDonNghiaVu` (scanner chiếu `hoaDonId` từ `HoaDonKhoan` ở lượt quét sau).
//
// ── CỔNG (mọi từ chối ⇒ `loi` không rỗng ⇒ lõi ghi NÉM, TRƯỚC phép ghi đầu tiên) ────────────────────────────
// Đơn còn sống · đúng MỘT hoá đơn khớp (ký hiệu + số) trong đơn · hoá đơn `DA_XAC_NHAN` + `TAI_LEN` (tờ do kế toán tải lên; bản MISA_API mang số do
// MISA cấp ⇒ nguồn sự thật là MISA, không vá ở đây) · hoá đơn KHÔNG có `HoaDonDong` (dòng Hub: tổng dòng ≠ tổng khoản sẽ lệch) · `tongTien` hiện tại
// == Σ khoản đang hiệu lực (đang lệch sẵn thì KHÔNG cộng dồn lên cái lệch) · đúng MỘT khoản khớp mã giao dịch · khoản thuộc đơn, còn sống, là dòng
// thu gốc, tiền ròng > 0 · khoản CHƯA nằm trong hoá đơn còn sống nào (kể cả NHÁP / KHÔNG XUẤT) · không có yêu cầu hoàn chạm khoản · tổng SAU == số
// trên tờ giấy mà người chạy khai (bắt buộc khi GHI).
//
// Đã gắn sẵn (khoản nằm đúng hoá đơn này, tổng đã đủ) ⇒ `daXong` = true, không còn gì để ghi (chạy lại idempotent, không qua cổng, không claim).

import { createHash } from "node:crypto";

export const HANH_DONG_GAN_THEM_KHOAN = "GAN_THEM_KHOAN_HOA_DON";
export const ENTITY_LUOT_GAN_THEM_KHOAN = "GanThemKhoanHoaDonLuot";
export const HANH_DONG_GAN_THEM_KHOAN_LUOT = "GAN_THEM_KHOAN_HOA_DON_LUOT";
export const LY_DO_GAN_THEM_KHOAN =
  "Kế toán đã xuất MỘT hoá đơn ở MISA cho cả hai lần thu nhưng hệ thống mới nhận tờ đó cho một lần: gắn thêm khoản vào đúng hoá đơn đã xuất để tổng khớp tờ giấy (không xuất thêm hoá đơn).";

/** Mục tiêu do người chạy khai (workflow input) — KHÔNG hằng mã đơn trong mã nguồn. */
export type MucTieuGanKhoan = {
  maDon: string;
  kyHieu: string;
  soHoaDon: string;
  /** Mã giao dịch ngân hàng của khoản cần gắn (vd FT26310040803067). */
  maGiaoDich: string;
  /** Tổng ghi trên TỜ GIẤY (đồng). `null` = chưa khai: chạy thử vẫn chạy, nhưng GHI bị chặn. */
  tongTrenToGiay: number | null;
};

export type TrangThaiHoaDonGan = "NHAP" | "DANG_PHAT_HANH" | "DA_XAC_NHAN" | "THAY_THE" | "KHONG_XUAT" | string;

export type KhoanUngVien = {
  paymentId: string;
  /** Tiền RÒNG (`soTienRong`) — đã trừ các dòng đảo. */
  rong: number;
  /** Dòng gốc (không phải bút toán đảo) và còn sống. */
  laDongThuGoc: boolean;
  thuocDon: boolean;
  /** Hoá đơn CÒN SỐNG khác đang giữ khoản (hieuLuc = true). Rỗng = tự do. */
  dangNamTrong: { hoaDonId: string; trangThai: TrangThaiHoaDonGan; kyHieu: string | null; soHoaDon: string | null }[];
};

export type DuLieuGanKhoan = {
  muc: MucTieuGanKhoan;
  don: { id: string; code: string; daHuyHoacXoa: boolean } | null;
  /** Mọi hoá đơn của đơn có đúng (ký hiệu, số) — đúng một mới hợp lệ. */
  hoaDon: {
    id: string;
    trangThai: TrangThaiHoaDonGan;
    nguonPhatHanh: string;
    tongTien: number;
    soDongHub: number;
    khoanSong: { paymentId: string; soTien: number }[];
  }[];
  /** Khoản của đơn khớp mã giao dịch (webhook `[auto:..:<txn>]` hoặc gắn tay → BankTransaction.providerTxnId). */
  khoan: KhoanUngVien[];
  /** `null` = không có yêu cầu hoàn chạm khoản; chuỗi = lý do (từ `lyDoHoanChanXacNhan`). */
  yeuCauHoanChan: string | null;
};

export type MaLoiGanKhoan =
  | "KHONG_THAY_DON"
  | "DON_DA_HUY"
  | "KHONG_THAY_HOA_DON"
  | "NHIEU_HOA_DON_KHOP"
  | "HOA_DON_SAI_TRANG_THAI"
  | "HOA_DON_KHONG_PHAI_TAI_LEN"
  | "HOA_DON_CO_DONG_HUB"
  | "TONG_DANG_LECH_SAN"
  | "KHONG_THAY_KHOAN"
  | "NHIEU_KHOAN_KHOP"
  | "KHOAN_KHONG_THUOC_DON"
  | "KHOAN_KHONG_PHAI_DONG_THU"
  | "KHOAN_KHONG_CON_TIEN"
  | "KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC"
  | "CO_YEU_CAU_HOAN"
  | "TONG_KHONG_KHOP_TO_GIAY";

export type LoiGanKhoan = { ma: MaLoiGanKhoan; chiTiet: string };

export type MucGhiGanKhoan = {
  hoaDonId: string;
  paymentId: string;
  soTien: number;
  tongTruoc: number;
  tongSau: number;
};

export type KeHoachGanKhoan = {
  loi: LoiGanKhoan[];
  /** Khoản đã nằm đúng hoá đơn này và tổng đã đủ — không còn gì để ghi. */
  daXong: boolean;
  /** `null` khi còn lỗi hoặc đã xong. */
  ghi: MucGhiGanKhoan | null;
  /** Dòng để owner KÝ (ghi đúng các dòng này, lõi ghi dựng lại và so lại). */
  dongDauRa: string[];
  sha: string;
  /** Tổng trên tờ giấy đã được khai và khớp `tongSau`. */
  khopToGiay: boolean | null;
};

const dinhDang = (n: number) => String(n);

/** Một dòng ký — MỘT nguồn cho workflow, script và lõi ghi. Không chứa tên khách / SĐT / email. */
export function dongKyGanKhoan(maDon: string, kyHieu: string, soHoaDon: string, g: MucGhiGanKhoan): string {
  return ["gan-khoan-hoa-don/v1", maDon, `${kyHieu}-${soHoaDon}`, g.hoaDonId, g.paymentId, dinhDang(g.soTien), dinhDang(g.tongTruoc), dinhDang(g.tongSau)].join("|");
}

export function shaDongKy(dong: readonly string[]): string {
  return createHash("sha256").update(dong.join("\n"), "utf8").digest("hex");
}

export function lapKeHoachGanKhoan(du: DuLieuGanKhoan): KeHoachGanKhoan {
  const loi: LoiGanKhoan[] = [];
  const them = (ma: MaLoiGanKhoan, chiTiet: string) => loi.push({ ma, chiTiet });
  const rong = (): KeHoachGanKhoan => ({ loi, daXong: false, ghi: null, dongDauRa: [], sha: shaDongKy([]), khopToGiay: null });

  if (!du.don) {
    them("KHONG_THAY_DON", `không có đơn mã ${du.muc.maDon}`);
    return rong();
  }
  if (du.don.daHuyHoacXoa) {
    them("DON_DA_HUY", `đơn ${du.don.code} đã huỷ / đã xoá — không vá hoá đơn của đơn đó`);
    return rong();
  }
  if (du.hoaDon.length === 0) {
    them("KHONG_THAY_HOA_DON", `đơn ${du.don.code} không có hoá đơn ${du.muc.kyHieu}-${du.muc.soHoaDon}`);
    return rong();
  }
  if (du.hoaDon.length > 1) {
    them("NHIEU_HOA_DON_KHOP", `đơn ${du.don.code} có ${du.hoaDon.length} hoá đơn cùng ${du.muc.kyHieu}-${du.muc.soHoaDon} — không biết gắn vào bản nào`);
    return rong();
  }
  const hd = du.hoaDon[0]!;
  if (hd.trangThai !== "DA_XAC_NHAN") {
    them("HOA_DON_SAI_TRANG_THAI", `hoá đơn ở trạng thái ${hd.trangThai}, chỉ gắn thêm vào hoá đơn ĐÃ XÁC NHẬN`);
  }
  if (hd.nguonPhatHanh !== "TAI_LEN") {
    them("HOA_DON_KHONG_PHAI_TAI_LEN", `hoá đơn nguồn ${hd.nguonPhatHanh}: số do nhà phát hành cấp, nguồn sự thật nằm ở đó — không vá ở đây`);
  }
  if (hd.soDongHub > 0) {
    them("HOA_DON_CO_DONG_HUB", `hoá đơn có ${hd.soDongHub} dòng Hub (HoaDonDong): đổi tổng khoản mà không đổi dòng là tạo lệch mới`);
  }
  const tongKhoan = hd.khoanSong.reduce((s, k) => s + k.soTien, 0);
  if (tongKhoan !== hd.tongTien) {
    them("TONG_DANG_LECH_SAN", `tongTien ${hd.tongTien} ≠ Σ khoản hiệu lực ${tongKhoan} — đang lệch sẵn, không cộng dồn lên cái lệch`);
  }

  if (du.khoan.length === 0) {
    them("KHONG_THAY_KHOAN", `đơn ${du.don.code} không có khoản nào mang mã giao dịch ${du.muc.maGiaoDich}`);
    return { ...rong(), loi };
  }
  if (du.khoan.length > 1) {
    them("NHIEU_KHOAN_KHOP", `${du.khoan.length} khoản cùng khớp mã giao dịch ${du.muc.maGiaoDich} — không biết gắn khoản nào`);
    return { ...rong(), loi };
  }
  const k = du.khoan[0]!;
  if (!k.thuocDon) them("KHOAN_KHONG_THUOC_DON", "khoản không thuộc đơn này");
  if (!k.laDongThuGoc) them("KHOAN_KHONG_PHAI_DONG_THU", "khoản là bút toán đảo hoặc đã xoá, không phải dòng thu gốc còn sống");
  if (k.rong <= 0) them("KHOAN_KHONG_CON_TIEN", `tiền ròng của khoản = ${k.rong} (đã hoàn / đảo hết)`);

  const trongHoaDonNay = k.dangNamTrong.filter((x) => x.hoaDonId === hd.id);
  const trongHoaDonKhac = k.dangNamTrong.filter((x) => x.hoaDonId !== hd.id);
  if (trongHoaDonKhac.length > 0) {
    them(
      "KHOAN_DANG_NAM_TRONG_HOA_DON_KHAC",
      `khoản đang nằm trong ${trongHoaDonKhac.map((x) => `${x.kyHieu ?? "—"}-${x.soHoaDon ?? "—"} (${x.trangThai})`).join(", ")} — gỡ bản đó trước (bản NHÁP / KHÔNG XUẤT gỡ được trên màn), rồi chạy lại`,
    );
  }
  if (du.yeuCauHoanChan) them("CO_YEU_CAU_HOAN", du.yeuCauHoanChan);

  // Đã gắn sẵn đúng hoá đơn này + tổng đã đủ ⇒ xong, KHÔNG phải lỗi.
  if (trongHoaDonNay.length > 0) {
    const daDu = loi.length === 0 && tongKhoan === hd.tongTien;
    return { loi, daXong: daDu, ghi: null, dongDauRa: [], sha: shaDongKy([]), khopToGiay: null };
  }
  if (loi.length > 0) return { loi, daXong: false, ghi: null, dongDauRa: [], sha: shaDongKy([]), khopToGiay: null };

  const tongSau = hd.tongTien + k.rong;
  let khopToGiay: boolean | null = null;
  if (du.muc.tongTrenToGiay !== null) {
    khopToGiay = du.muc.tongTrenToGiay === tongSau;
    if (!khopToGiay) {
      them("TONG_KHONG_KHOP_TO_GIAY", `tổng sau khi gắn = ${tongSau}đ nhưng tờ giấy khai ${du.muc.tongTrenToGiay}đ — sai khoản hoặc sai tờ, KHÔNG ghi`);
      return { loi, daXong: false, ghi: null, dongDauRa: [], sha: shaDongKy([]), khopToGiay };
    }
  }
  const ghi: MucGhiGanKhoan = { hoaDonId: hd.id, paymentId: k.paymentId, soTien: k.rong, tongTruoc: hd.tongTien, tongSau };
  const dongDauRa = [dongKyGanKhoan(du.don.code, du.muc.kyHieu, du.muc.soHoaDon, ghi)];
  return { loi, daXong: false, ghi, dongDauRa, sha: shaDongKy(dongDauRa), khopToGiay };
}

/**
 * Cổng quyết định GHI (mỏng, THUẦN): từ chối bằng CHUỖI (null = được ghi). Lõi DB `throw` chuỗi này TRƯỚC phép ghi đầu tiên.
 * `tongTrenToGiay` bắt buộc khi GHI: không có số trên tờ giấy thì không có gì để đối chiếu.
 */
export function quyetDinhGhiGanKhoan(i: { kh: KeHoachGanKhoan; tongTrenToGiay: number | null; soDuyet: number | null; ghiDuoc: boolean | null }): string | null {
  if (i.ghiDuoc === false) return "User kết nối không có quyền ghi HoaDonKhoan / HoaDonDienTu — KHÔNG ghi gì.";
  if (i.ghiDuoc === null) return "Không kiểm được quyền ghi của kết nối — KHÔNG ghi gì.";
  if (i.kh.loi.length > 0) return `Kế hoạch có lỗi (${i.kh.loi.map((l) => l.ma).join(", ")}) — KHÔNG ghi gì.`;
  if (i.kh.daXong) return null;
  if (i.kh.ghi === null) return "Kế hoạch không có dòng nào để ghi.";
  if (i.tongTrenToGiay === null) return "Thiếu tổng trên tờ hoá đơn giấy (--tong-to-giay): GHI phải đối chiếu được với tờ thật — KHÔNG ghi gì.";
  if (i.soDuyet === null) return "Thiếu --expect (số dòng đã duyệt) — KHÔNG ghi gì.";
  if (i.soDuyet !== i.kh.dongDauRa.length) return `--expect=${i.soDuyet} ≠ ${i.kh.dongDauRa.length} dòng kế hoạch hiện tại — dữ liệu đã đổi so với lượt chạy thử, KHÔNG ghi gì.`;
  return null;
}
