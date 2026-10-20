// lib/finance/hoa-don/khoi-hoa-don-don.ts — VIEW-MODEL khối "Hoá đơn" trên trang chi tiết đơn (GĐ 7,
// docs/ke-toan-hoa-don/PLAN.md §8). THUẦN — dựng ở SERVER, rồi mới đưa xuống client.
//
// Mỗi LẦN THU một dòng — dựng bằng CHÍNH `dungDongHangCho` của màn kế toán, nên ngày, số và nhãn đợt
// khớp đúng thứ kế toán nhìn (không đẻ định nghĩa "lần thu" thứ hai).
//
// ⚠️ DTO ra client KHÔNG mang: khoá tệp (chỉ href tới route tải), email thật khi thiếu
// `orders:view-pii` (che bằng `maskEmail`), MST / địa chỉ / tên đơn vị người mua, văn bản lỗi của
// nhà cung cấp email, lý do TỰ DO của kế toán khi thiếu PII, `khoanIds`. `DongHangCho` KHÔNG được
// spread — nó mang SĐT, tên tệp, hành động của kế toán.
// ⚠️ Nút tải phải CÙNG LUẬT với route `payments/hoa-don/[hoaDonId]/tai-ve` (luật 12): quyền +
// phạm vi giải ở loader bằng chính hai cổng của route (`HoaDonVaoKhoi.taiDuoc`); chỉ vẽ trên dòng
// ĐÃ XUẤT; kho chưa cấu hình ⇒ route 503 ⇒ không vẽ nút; XML cần KHOÁ tệp XML (route hỏi
// `tepXmlKey`, không hỏi tên). Mọi câu "tải về gửi qua Zalo" cũng chỉ in khi nút ấy CÓ.

import { dungDongHangCho, type DonVaoHangCho, type NganHangCho } from "./dong-hang-cho";
import { trangThaiEmailHoaDon, type EmailKhoi, type HangDoiVao, type ToneDong } from "./trang-thai-email";
import type { GiaoDichVao } from "./lan-thu";
import { phanLoaiKhoan } from "./du-dieu-kien";
import { soTienRong } from "./nguon-khoan";
import { laLyDoCoDinh, LY_DO_DA_XUAT_NGOAI } from "./ly-do-khong-xuat";

// GĐ 8 — kiểu + luật trạng thái email dời sang `trang-thai-email.ts` (tránh vòng import); giữ đường cũ.
export { trangThaiEmailHoaDon, type EmailKhoi, type HangDoiVao, type LuotGuiVao } from "./trang-thai-email";

export type HoaDonVaoKhoi = DonVaoHangCho["hoaDonDienTu"][number] & {
  tongTien: number;
  tepXmlKey: string | null;
  /**
   * Route tải về có trả tệp của bản này cho người đang xem không — loader giải bằng ĐÚNG hai cổng
   * của route: `passesScope("HoaDonDienTu", …)` + `duocTaiBanHoaDon` (lib/finance/hoa-don/quyen.ts).
   */
  taiDuoc: boolean;
};

export type DonVaoKhoi = Omit<DonVaoHangCho, "hoaDonDienTu"> & { hoaDonDienTu: HoaDonVaoKhoi[] };

/**
 * Trạng thái hoá đơn của lần thu, gom cho người KHÔNG làm hoá đơn — dùng để đếm tóm tắt.
 * `DA_XUAT_NGOAI` = kế toán ghi "Đã xuất ngoài hệ thống": khách ĐÃ có hoá đơn (MISA), chỉ là hệ thống
 * không giữ tệp. Gộp nó vào "không xuất" là nói với sale điều ngược lại (review GĐ 7).
 */
export type TrangThaiHoaDonLanThu = "CHO" | "DANG_XU_LY" | "DA_XUAT" | "DA_XUAT_NGOAI" | "KHONG_XUAT";

export type DongHoaDonDon = {
  /** Duy nhất trong khối: `hd:<id>` cho dòng có hoá đơn, `<ngăn>:<khoá lần thu>` cho dòng chưa có. */
  key: string;
  trangThai: TrangThaiHoaDonLanThu;
  ngayThuLabel: string;
  soTien: number;
  nguonLabel: string;
  nhanDot: string | null;
  nhan: string;
  tone: ToneDong;
  /** "1C26TSR · số 123" trên tờ hoá đơn (chỉ khi đã xuất trên hệ thống). */
  soHoaDon: string | null;
  ngayPhatHanhLabel: string | null;
  /** href route tải — `null` ⇒ KHÔNG vẽ nút (route sẽ từ chối). */
  taiPdf: string | null;
  taiXml: string | null;
  /** Vì sao dòng ĐÃ CÓ hoá đơn lại không có nút tải (luật 12: nói lý do, đừng để trống). */
  lyDoKhongTai: string | null;
  email: EmailKhoi | null;
  lyDoKhongXuat: string | null;
  /**
   * GĐ 8 — hoá đơn ĐÃ HUỶ đứng trước lần thu này. Dòng có hoá đơn mới ⇒ "Thay cho hoá đơn X đã huỷ";
   * dòng chưa có ⇒ dặn sale ĐỪNG gửi bản cũ. KHÔNG BAO GIỜ mang lý do huỷ (kế toán gõ tay).
   */
  huyTruoc: string | null;
};

export type KhoiHoaDonDon = {
  dong: DongHoaDonDon[];
  /** Số khoản thu nằm trên đơn chưa gán cơ sở — không lên hoá đơn được, khối phải nói ra. */
  thieuCoSo: number;
  /**
   * Số khoản tiền THẬT thu trước khi lên hệ thống (`[backfill-import]` / `[sheet:…]`). Chúng không
   * bao giờ vào hàng chờ hoá đơn (kế toán đã xuất ngoài hệ thống nếu có) — thiếu con số này thì đơn
   * chỉ có tiền cũ hiện "Chưa có khoản thu nào", trong khi sổ tiền cùng trang ghi đã thu.
   */
  lichSu: number;
};

const ddmmyyyy = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/**
 * Nhãn nói bằng ngôn ngữ của SALE (họ không làm hoá đơn — họ cần biết "khách đã có hoá đơn chưa").
 * Nhãn của màn kế toán ("Chờ xuất", "Đã tải tệp") là việc nội bộ của kế toán; ở đây dịch sang trạng
 * thái hoá đơn. Ngăn `lech` giữ phần "thiếu bao nhiêu" vì đó là lý do THẬT hoá đơn chưa ra.
 */
function nhanChoSale(r: { ngan: NganHangCho; nhan: string }, lyDoKhongXuat: string | null): {
  trangThai: TrangThaiHoaDonLanThu;
  nhan: string;
  tone: ToneDong;
} {
  switch (r.ngan) {
    case "cho":
      return { trangThai: "CHO", nhan: "Chờ kế toán xuất hoá đơn", tone: "warning" };
    case "lech":
      return { trangThai: "CHO", nhan: `Chờ kế toán xuất hoá đơn · ${r.nhan.toLowerCase()}`, tone: "warning" };
    case "nhap":
      return { trangThai: "DANG_XU_LY", nhan: "Kế toán đang xử lý hoá đơn", tone: "info" };
    case "phat-hanh":
      // Bước 1 MISA — sale chỉ cần biết hoá đơn đang ra. Mã lỗi / thông điệp MISA / số lượt gửi là việc
      // của kế toán: KHÔNG đi xuống khối này (dòng không mang `misa`).
      return { trangThai: "DANG_XU_LY", nhan: "Đang xuất hoá đơn", tone: "info" };
    case "da-xuat":
      return { trangThai: "DA_XUAT", nhan: "Đã xuất hoá đơn", tone: "success" };
    case "can-dieu-chinh":
      // 29/09 (Q3) — bản "Đã xuất ngoài hệ thống" cũng vào ngăn này: khách có hoá đơn ở MISA, hệ thống
      // không giữ tệp ⇒ giữ đúng trạng thái "đã xuất ngoài", chỉ thêm việc đang xem lại.
      if (lyDoKhongXuat === LY_DO_DA_XUAT_NGOAI) {
        return {
          trangThai: "DA_XUAT_NGOAI",
          nhan: "Đã xuất hoá đơn ngoài hệ thống · tiền đã đổi sau khi xuất — kế toán đang xem lại",
          tone: "warning",
        };
      }
      // GĐ 8 — tờ hoá đơn VẪN hợp lệ tới lúc kế toán huỷ; sale cần biết nó đang được xem lại.
      return {
        trangThai: "DA_XUAT",
        nhan: "Đã xuất hoá đơn · tiền đã đổi sau khi xuất — kế toán đang xem lại",
        tone: "warning",
      };
    case "khong-xuat":
      // Lý do mặc định của kế toán — khách ĐÃ có hoá đơn (MISA). Nói "không xuất" là nói ngược.
      return lyDoKhongXuat === LY_DO_DA_XUAT_NGOAI
        ? { trangThai: "DA_XUAT_NGOAI", nhan: "Đã xuất hoá đơn ngoài hệ thống", tone: "success" }
        : { trangThai: "KHONG_XUAT", nhan: "Không xuất hoá đơn", tone: "muted" };
    case "don-huy":
      // `r.nhan` là "Đơn đã huỷ" hoặc "Đợt đã huỷ" — giữ đúng cái nào.
      return { trangThai: "KHONG_XUAT", nhan: `${r.nhan} — không xuất hoá đơn`, tone: "muted" };
  }
}

export function dungKhoiHoaDonDon(input: {
  don: DonVaoKhoi;
  /** Giao dịch mà khoản + phân bổ của đơn trỏ tới (loader nạp theo id của chính đơn). */
  giaoDich: readonly GiaoDichVao[];
  /** Dòng hàng đợi email của các lượt gửi mới nhất. */
  hangDoi: readonly HangDoiVao[];
  /** `orders:view-pii` — cổng che email + lý do tự do + lỗi nhà cung cấp. */
  xemPii: boolean;
  /** Kho tệp hoá đơn đã cấu hình — không có thì route trả 503. */
  khoOk: boolean;
  userId: string;
}): KhoiHoaDonDon {
  const { don, xemPii, khoOk } = input;
  const { dong, thieuCoSo } = dungDongHangCho({
    don,
    giaoDich: input.giaoDich,
    // Trang đơn KHÔNG dò giao dịch chưa khớp (câu đó quét cả hệ thống) ⇒ vế nghi trùng "giao dịch chưa
    // khớp cùng số" chỉ có ở màn kế toán. Vế "cùng đơn có khoản chuyển khoản" (GĐ 8) VẪN có ở đây.
    giaoDichChuaKhop: [],
    hangDoi: input.hangDoi,
    userId: input.userId,
    coQuyen: false,
    khoOk,
    canViewPii: xemPii,
    // Trang đơn chỉ ĐỌC — gộp lần thu (Q2) là việc của màn kế toán.
    gop: [],
    // Bước 1 MISA — trang đơn không phát hành gì (và `coQuyen: false` đã tắt mọi nút kế toán).
    misa: null,
  });
  const hdTheoId = new Map(don.hoaDonDienTu.map((h) => [h.id, h]));
  const qTheoId = new Map(input.hangDoi.map((q) => [q.id, q]));

  // Tiền thu trước khi lên hệ thống — CÙNG luật phân loại với hàng chờ (một định nghĩa).
  const rong = soTienRong(don.payments);
  const daKhoa = new Set(don.hoaDonDienTu.flatMap((h) => h.khoan.map((k) => k.paymentId)));
  let lichSu = 0;
  for (const p of don.payments) {
    if (daKhoa.has(p.id)) continue;
    const pl = phanLoaiKhoan(p, don, rong.get(p.id) ?? 0);
    if (pl.vao === "LOAI" && pl.lyDo === "NHAP_LICH_SU") lichSu += 1;
  }

  const ra: DongHoaDonDon[] = dong
    .slice()
    .sort((a, b) => (a.ngayThu === b.ngayThu ? a.key.localeCompare(b.key) : a.ngayThu.localeCompare(b.ngayThu)))
    .map((r) => {
      const hd = r.hoaDon ? (hdTheoId.get(r.hoaDon.id) ?? null) : null;
      // Theo TRẠNG THÁI hoá đơn, không theo ngăn: từ 29/09 ngăn "Cần điều chỉnh" còn giữ cả bản KHONG_XUAT
      // "Đã xuất ngoài hệ thống" — bản đó không có số, không có tệp để in / tải.
      const daXuat = (r.ngan === "da-xuat" || r.ngan === "can-dieu-chinh") && hd !== null && hd.trangThai === "DA_XAC_NHAN";
      const luot = hd?.guiEmail[0] ?? null;
      const q = luot?.emailQueueId ? (qTheoId.get(luot.emailQueueId) ?? null) : null;
      const duocTai = daXuat && khoOk && hd.taiDuoc;
      const taiPdf = duocTai && hd.tepPdfKey ? `/payments/hoa-don/${hd.id}/tai-ve?loai=pdf` : null;
      const lyDoGoc = r.ngan === "khong-xuat" || r.ngan === "can-dieu-chinh" ? r.lyDoKhongXuat : null;
      const goc = nhanChoSale(r, lyDoGoc);
      // Bước 1 MISA — bản MÔ PHỎNG không bao giờ được trông như hoá đơn thật với người gửi Zalo cho khách.
      const moPhong = daXuat && hd.nguonPhatHanh === "MISA_GIA_LAP";
      const { trangThai } = goc;
      const nhan = moPhong ? `${goc.nhan} · MÔ PHỎNG — không có giá trị pháp lý, đừng gửi khách` : goc.nhan;
      const tone = moPhong ? ("warning" as const) : goc.tone;
      return {
        // Khoá LẦN THU không duy nhất: đợt đã xuất hoá đơn theo số đã thu rồi có thêm tiền về cho
        // đúng đợt ấy ⇒ hai dòng cùng `dot:<id>` (review GĐ 7). Dòng có hoá đơn khoá theo hoá đơn.
        key: hd ? `hd:${hd.id}` : `${r.ngan}:${r.key}`,
        trangThai,
        ngayThuLabel: r.ngayThuLabel,
        // Dòng đã xuất in số TRÊN TỜ HOÁ ĐƠN (chụp lúc chốt), không số ròng hiện tại.
        soTien: daXuat ? hd.tongTien : r.soTien,
        nguonLabel: r.nguonLabel,
        nhanDot: r.nhanDot,
        nhan,
        tone,
        soHoaDon: daXuat ? `${hd.kyHieu ?? "—"} · số ${hd.soHoaDon ?? "—"}` : null,
        ngayPhatHanhLabel: daXuat && hd.ngayPhatHanh ? ddmmyyyy(hd.ngayPhatHanh) : null,
        taiPdf,
        taiXml: duocTai && hd.tepXmlKey ? `/payments/hoa-don/${hd.id}/tai-ve?loai=xml` : null,
        lyDoKhongTai:
          trangThai === "DA_XUAT_NGOAI"
            ? "Hoá đơn xuất ở MISA, hệ thống không giữ tệp — cần bản thì nhờ kế toán gửi"
            : !daXuat
              ? null
              : !khoOk
                ? "Kho lưu hoá đơn chưa cấu hình — báo người vận hành"
                : !hd.taiDuoc
                  ? xemPii
                    ? "Hoá đơn thuộc cơ sở ngoài phạm vi của bạn — nhờ kế toán gửi"
                    : "Cần quyền xem thông tin khách để tải hoá đơn — nhờ kế toán gửi"
                  : !hd.tepPdfKey
                    ? "Hoá đơn chưa có tệp PDF — báo kế toán"
                    : null,
        email: hd ? trangThaiEmailHoaDon(hd, luot, q, xemPii, taiPdf !== null) : null,
        // Hai lý do CỐ ĐỊNH không mang gì của khách ⇒ ai xem đơn cũng đọc được; lý do TỰ DO ("Khác: …")
        // kế toán gõ tay nên có thể chứa MST/tên công ty ⇒ chỉ khi có quyền PII. Dòng "đã xuất ngoài
        // hệ thống" đã nói đủ ở nhãn — không lặp lại.
        lyDoKhongXuat:
          trangThai !== "KHONG_XUAT" || r.ngan !== "khong-xuat" || !lyDoGoc
            ? null
            : laLyDoCoDinh(lyDoGoc) || xemPii
              ? lyDoGoc
              : null,
        huyTruoc: (() => {
          const h = r.hoaDonDaHuy[0];
          if (!h) return null;
          const ngay = h.huyLucLabel ? ` ngày ${h.huyLucLabel}` : "";
          return hd
            ? `Thay cho hoá đơn ${h.so} đã huỷ${ngay}`
            : `Hoá đơn ${h.so} đã huỷ${ngay} — đừng gửi bản cũ cho khách, chờ kế toán xuất lại`;
        })(),
      };
    });
  return { dong: ra, thieuCoSo, lichSu };
}
