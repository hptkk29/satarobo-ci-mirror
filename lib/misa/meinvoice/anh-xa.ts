// lib/misa/meinvoice/anh-xa.ts — dịch `PhieuPhatHanh` ⇄ JSON của MISA meInvoice. THUẦN (không
// mạng, không đồng hồ, không env).
//
// Nguồn (đọc 30/09/2026):
//   [HSM]   https://doc.meinvoice.vn/api/Document/InvoicePublishHSM.html   — body + phản hồi publishHSM
//   [PUB]   https://doc.meinvoice.vn/api/Document/InvoicePublishing.html   — mã lỗi phát hành,
//           "Success: true … phải xét ErrorCode TRONG Data"
//   [ERR]   https://doc.meinvoice.vn/api/Document/ErrorCode.html           — bảng mã lỗi thường gặp
//   [INFO]  https://doc.meinvoice.vn/api/Document/InvoiceInfo.html         — VATRateName, InvoiceName, ItemType
//   [VAL]   https://doc.meinvoice.vn/api/Document/ValidateData.html        — luật kiểm dữ liệu
//   [RCP]   https://doc.meinvoice.vn/api/Document/Invoice_recipe.html      — công thức tiền
//   [REF]   https://doc.meinvoice.vn/api/Document/GetInvoiceInRefid.html   — tra cứu theo RefID
//   [DL]    https://doc.meinvoice.vn/api/Document/DownloadInvoice.html     — tải hoá đơn
//   [DL2]   https://doc.meinvoice.vn/itg/Doc/DowloadInvoice.html           — PDF là base64, XML là chuỗi thô
//
// ⚠️ LUẬT FAIL-SAFE: chỉ ra `TU_CHOI` khi CHẮC CHẮN chưa có hoá đơn nào (lỗi dữ liệu MISA liệt kê,
// hoặc ta tự chặn TRƯỚC khi gửi). Mọi thứ khác — mã lạ, không có mã, phản hồi không đọc được —
// là `KHONG_RO`. Kết luận nhầm "chưa phát hành" ⇒ nơi gọi phát hành lại ⇒ hai hoá đơn thuế.

import type {
  DaPhatHanh,
  KetQuaPhatHanh,
  KetQuaTraCuu,
  PhieuPhatHanh,
  ThueSuatHoaDon,
} from "./cong";

// ─── Kiểu JSON phía MISA ────────────────────────────────────────────────────────────────────────

export type MisaDongChiTiet = {
  ItemType: 1;
  LineNumber: number;
  SortOrder: number;
  ItemName: string;
  UnitName: string;
  Quantity: number;
  UnitPrice: number;
  DiscountRate: number;
  DiscountAmountOC: number;
  DiscountAmount: number;
  AmountOC: number;
  Amount: number;
  AmountWithoutVATOC: number;
  AmountWithoutVAT: number;
  VATRateName: string;
  VATAmountOC: number;
  VATAmount: number;
};

export type MisaNhomThue = {
  VATRateName: string;
  AmountWithoutVATOC: number;
  VATAmountOC: number;
};

export type MisaHoaDonGoc = {
  RefID: string;
  InvSeries: string;
  InvoiceName: string;
  InvDate: string;
  CurrencyCode: "VND";
  ExchangeRate: 1;
  PaymentMethodName: string;
  IsInvoiceSummary: false;
  BuyerLegalName?: string;
  BuyerTaxCode?: string;
  BuyerAddress?: string;
  BuyerEmail?: string;
  BuyerFullName?: string;
  TotalSaleAmountOC: number;
  TotalSaleAmount: number;
  TotalAmountWithoutVATOC: number;
  TotalAmountWithoutVAT: number;
  TotalVATAmountOC: number;
  TotalVATAmount: number;
  TotalDiscountAmountOC: number;
  TotalDiscountAmount: number;
  TotalAmountOC: number;
  TotalAmount: number;
  TotalAmountInWords: string;
  /** [VAL]: "Add IsTaxReduction43: true when 8% tax rate applies". */
  IsTaxReduction43?: true;
  OriginalInvoiceDetail: MisaDongChiTiet[];
  TaxRateInfo: MisaNhomThue[];
  OptionUserDefined: {
    MainCurrency: "VND";
    AmountDecimalDigits: string;
    AmountOCDecimalDigits: string;
    UnitPriceOCDecimalDigits: string;
    UnitPriceDecimalDigits: string;
    QuantityDecimalDigits: string;
    CoefficientDecimalDigits: string;
    ExchangRateDecimalDigits: string;
  };
};

export type MisaPhanTuPhatHanh = {
  RefID: string;
  OriginalInvoiceData: MisaHoaDonGoc;
  /** LUÔN false — hệ thống TỰ gửi email (hợp đồng `cong.ts`). */
  IsSendEmail: false;
};

// ─── Kiểm phiếu TRƯỚC khi gửi (tự chặn ⇒ chắc chắn chưa có hoá đơn) ────────────────────────────

/** Ký hiệu TT78: [1|2][C|K][yy][chữ][2 ký tự]. Chỉ hỗ trợ 1 (GTGT) và 2 (bán hàng). */
const HINH_DANG_KY_HIEU = /^([12])([CK])(\d{2})([A-Z])([A-Z0-9]{2})$/;
/** [VAL]: "MST bắt buộc có 2 định dạng: 10 ký tự (xxxxxxxxxx) hoặc 14 ký tự (xxxxxxxxxx-xxx)". */
const HINH_DANG_MST = /^\d{10}(-\d{3})?$/;
/** [VAL]: regex email nguyên văn tài liệu. */
const HINH_DANG_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,6}$/;

export const MA_TU_CHAN = "DU_LIEU_PHIEU_KHONG_HOP_LE";

/**
 * Tên loại hoá đơn theo chữ số đầu của ký hiệu. [INFO]: "Hóa đơn giá trị gia tăng, Hóa đơn bán
 * hàng, Phiếu xuất kho". ⚠️ CHƯA XÁC MINH chữ HOA/thường: ví dụ trong [HSM] viết "HÓA ĐƠN GIÁ TRỊ
 * GIA TĂNG", danh sách trong [INFO] viết thường — chọn bản [INFO] (bản liệt kê giá trị hợp lệ).
 */
export function tenLoaiHoaDon(kyHieu: string): string | null {
  const m = HINH_DANG_KY_HIEU.exec(kyHieu.trim().toUpperCase());
  if (!m) return null;
  return m[1] === "1" ? "Hóa đơn giá trị gia tăng" : "Hóa đơn bán hàng";
}

/** "C" = có mã của CQT, "K" = không mã. null = ký hiệu sai hình dạng. */
export function coMaTheoKyHieu(kyHieu: string): boolean | null {
  const m = HINH_DANG_KY_HIEU.exec(kyHieu.trim().toUpperCase());
  if (!m) return null;
  return m[2] === "C";
}

function laSoNguyen(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n);
}

/**
 * Khối NGƯỜI MUA theo luật MISA [VAL]. null = hợp lệ; ngược lại câu lỗi cho kế toán, nói ô nào + luật gì — KHÔNG
 * in lại giá trị (email/MST là PII; màn che chúng khi thiếu `orders:view-pii`).
 *
 * ⚠️ MỘT CHỖ cho luật này (smoke 30/09): nút "Phát hành qua MISA" (`nut-phat-hanh-misa.ts`) gọi thẳng hàm này để
 * tắt nút, `kiemPhieu` gọi nó cho máy trạng thái + cổng. Nút tự viết regex thứ hai ⇒ nút sáng với "a@b.c", MISA
 * từ chối lúc gửi (lời hứa suông — luật 12). Cổng người mua chung `thieuChoHoaDon` KHÁC luật này có chủ đích
 * (nhận MST 12/13 số cho luồng tải tay) — đừng gộp.
 */
export function kiemNguoiMua(nm: PhieuPhatHanh["nguoiMua"]): string | null {
  if (!nm.hoTen?.trim() && !nm.donVi?.trim()) return "Thiếu tên người mua (họ tên hoặc tên đơn vị).";
  if (nm.mst?.trim()) {
    if (!HINH_DANG_MST.test(nm.mst.trim())) {
      return "MST người mua không hợp lệ với MISA: phải là 10 chữ số, hoặc 10 số-3 số cho đơn vị phụ thuộc (vd 0401234567-001)";
    }
    // [VAL]: "Nếu nhập dữ liệu vào <BuyerTaxCode> Thì phải nhập dữ liệu vào <BuyerLegalName> và <BuyerAddress>"
    if (!nm.donVi?.trim() || !nm.diaChi?.trim()) {
      return "Người mua có MST thì MISA đòi cả tên đơn vị và địa chỉ";
    }
  }
  if (nm.email?.trim() && !HINH_DANG_EMAIL.test(nm.email.trim())) {
    return "Email người mua không hợp lệ với MISA: phải dạng ten@tenmien.duoi, không dấu, không khoảng trắng, phần đuôi 2–6 chữ cái";
  }
  return null;
}

/** null = hợp lệ; ngược lại câu lỗi tiếng Việt cho kế toán. */
export function kiemPhieu(p: PhieuPhatHanh): string | null {
  if (!p.refId || !p.refId.trim()) return "Thiếu RefID.";
  if (!tenLoaiHoaDon(p.kyHieu)) return "Ký hiệu hoá đơn sai dạng (ví dụ đúng: 1C26TSR).";
  if (!HINH_DANG_MST.test(p.mstNguoiBan.trim())) return "MST người bán sai dạng (10 số hoặc 10 số-3 số).";
  if (Number.isNaN(p.ngayHoaDon.getTime())) return "Ngày hoá đơn không hợp lệ.";
  if (!p.soTienBangChu.trim()) return "Thiếu số tiền bằng chữ.";
  if (!p.hinhThucThanhToan.trim()) return "Thiếu hình thức thanh toán.";

  const loiNguoiMua = kiemNguoiMua(p.nguoiMua);
  if (loiNguoiMua) return loiNguoiMua;

  if (p.dong.length === 0) return "Hoá đơn không có dòng hàng.";
  for (let i = 0; i < p.dong.length; i++) {
    const d = p.dong[i]!;
    if (d.stt !== i + 1) return `Số thứ tự dòng phải liên tục từ 1 (dòng ${i + 1} mang ${d.stt}).`;
    if (!d.ten.trim()) return `Dòng ${d.stt} thiếu tên hàng.`;
    if (!(Number.isFinite(d.soLuong) && d.soLuong > 0)) return `Dòng ${d.stt}: số lượng phải > 0.`;
    if (!(Number.isFinite(d.donGia) && d.donGia >= 0)) return `Dòng ${d.stt}: đơn giá không hợp lệ.`;
    if (!laSoNguyen(d.thanhTien) || d.thanhTien < 0) return `Dòng ${d.stt}: thành tiền phải là số nguyên đồng ≥ 0.`;
    if (!laSoNguyen(d.tienThue) || d.tienThue < 0) return `Dòng ${d.stt}: tiền thuế phải là số nguyên đồng ≥ 0.`;
    if (tenThueSuat(d.thueSuat) === null) return `Dòng ${d.stt}: thuế suất không hỗ trợ.`;
    if ((d.thueSuat === "KCT" || d.thueSuat === "KKKNT" || d.thueSuat === 0) && d.tienThue !== 0) {
      return `Dòng ${d.stt}: thuế suất ${tenThueSuat(d.thueSuat)} thì tiền thuế phải bằng 0.`;
    }
  }
  const sumTruoc = p.dong.reduce((s, d) => s + d.thanhTien, 0);
  const sumThue = p.dong.reduce((s, d) => s + d.tienThue, 0);
  if (sumTruoc !== p.tongTruocThue) return "Tổng trước thuế không khớp tổng các dòng.";
  if (sumThue !== p.tongThue) return "Tổng tiền thuế không khớp tổng các dòng.";
  if (p.tongTruocThue + p.tongThue !== p.tongThanhToan) return "Tổng thanh toán ≠ trước thuế + thuế.";
  return null;
}

// ─── Ánh xạ phiếu → body publishHSM ─────────────────────────────────────────────────────────────

/** [INFO]: "0%, 5%, 10%, KCT: Không chịu thuế GTGT, KKKNT: Không kê khai, tính nộp thuế GTGT, KHAC:AB.CD%". */
export function tenThueSuat(t: ThueSuatHoaDon): string | null {
  switch (t) {
    case 0:
      return "0%";
    case 5:
      return "5%";
    case 8:
      return "8%";
    case 10:
      return "10%";
    case "KCT":
      return "KCT";
    case "KKKNT":
      return "KKKNT";
    default:
      return null;
  }
}

/**
 * Ngày hoá đơn theo lịch VN, dạng ISO có offset như ví dụ [HSM] ("2021-12-16T00:00:00+07:00").
 * Nhận cả `@db.Date` (nửa đêm UTC ⇒ +7h vẫn cùng ngày) lẫn mốc giờ thật (17:30Z ⇒ ngày hôm sau
 * giờ VN) — cộng 7 giờ rồi đọc trường UTC, không phụ thuộc TZ của máy.
 */
export function ngayGioVn(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}T00:00:00+07:00`;
}

function soChuSoThapPhan(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  if (i < 0 || s.includes("e")) return 3;
  return Math.min(s.length - i - 1, 3);
}

function datNeuCo<T extends object, K extends keyof T>(o: T, k: K, v: string | null | undefined): void {
  const t = v?.trim();
  if (t) (o as Record<K, unknown>)[k] = t;
}

/** Một phần tử (mảng một phần tử là việc của nơi gửi). Gọi SAU `kiemPhieu` — không tự kiểm lại. */
export function phieuSangMisa(p: PhieuPhatHanh): MisaPhanTuPhatHanh {
  const dong: MisaDongChiTiet[] = p.dong.map((d) => ({
    ItemType: 1, // [INFO]: "1: HHDV"
    LineNumber: d.stt,
    SortOrder: d.stt,
    ItemName: d.ten,
    UnitName: d.donViTinh,
    Quantity: d.soLuong,
    UnitPrice: d.donGia,
    // [VAL]: các cặp chiết khấu là bắt buộc ở dòng — không chiết khấu ⇒ 0.
    DiscountRate: 0,
    DiscountAmountOC: 0,
    DiscountAmount: 0,
    // [RCP]: AmountOC = UnitPrice × Quantity; AmountWithoutVATOC = AmountOC − DiscountAmountOC.
    AmountOC: d.thanhTien,
    Amount: d.thanhTien,
    AmountWithoutVATOC: d.thanhTien,
    AmountWithoutVAT: d.thanhTien,
    VATRateName: tenThueSuat(d.thueSuat) ?? "",
    VATAmountOC: d.tienThue,
    VATAmount: d.tienThue,
  }));

  // [VAL]: "Số loại thuế suất tương ứng với số loại thuế suất ở phần detail". Giữ thứ tự xuất hiện.
  const nhom = new Map<string, MisaNhomThue>();
  for (const d of dong) {
    const cu = nhom.get(d.VATRateName);
    if (cu) {
      cu.AmountWithoutVATOC += d.AmountWithoutVATOC;
      cu.VATAmountOC += d.VATAmountOC;
    } else {
      nhom.set(d.VATRateName, {
        VATRateName: d.VATRateName,
        AmountWithoutVATOC: d.AmountWithoutVATOC,
        VATAmountOC: d.VATAmountOC,
      });
    }
  }

  const soLe = Math.max(0, ...p.dong.map((d) => soChuSoThapPhan(d.soLuong)));

  const goc: MisaHoaDonGoc = {
    RefID: p.refId,
    InvSeries: p.kyHieu.trim().toUpperCase(),
    InvoiceName: tenLoaiHoaDon(p.kyHieu) ?? "",
    InvDate: ngayGioVn(p.ngayHoaDon),
    CurrencyCode: "VND",
    ExchangeRate: 1,
    PaymentMethodName: p.hinhThucThanhToan,
    IsInvoiceSummary: false,
    TotalSaleAmountOC: p.tongTruocThue,
    TotalSaleAmount: p.tongTruocThue,
    TotalAmountWithoutVATOC: p.tongTruocThue,
    TotalAmountWithoutVAT: p.tongTruocThue,
    TotalVATAmountOC: p.tongThue,
    TotalVATAmount: p.tongThue,
    TotalDiscountAmountOC: 0,
    TotalDiscountAmount: 0,
    TotalAmountOC: p.tongThanhToan,
    TotalAmount: p.tongThanhToan,
    TotalAmountInWords: p.soTienBangChu,
    OriginalInvoiceDetail: dong,
    TaxRateInfo: [...nhom.values()],
    OptionUserDefined: {
      MainCurrency: "VND",
      AmountDecimalDigits: "0",
      AmountOCDecimalDigits: "0",
      // Đơn giá giữ phần lẻ (hợp đồng: MISA in "1.851.851,85").
      UnitPriceOCDecimalDigits: "2",
      UnitPriceDecimalDigits: "2",
      QuantityDecimalDigits: String(soLe),
      CoefficientDecimalDigits: "0",
      ExchangRateDecimalDigits: "0",
    },
  };
  // ⚠️ CHƯA XÁC MINH: [VAL] chỉ nói "IsTaxReduction43: true khi áp 8%", không nói đặt ở cấp nào —
  // đặt ở OriginalInvoiceData (cấp hoá đơn).
  if (p.dong.some((d) => d.thueSuat === 8)) goc.IsTaxReduction43 = true;

  const nm = p.nguoiMua;
  datNeuCo(goc, "BuyerLegalName", nm.donVi);
  datNeuCo(goc, "BuyerTaxCode", nm.mst);
  datNeuCo(goc, "BuyerAddress", nm.diaChi);
  datNeuCo(goc, "BuyerEmail", nm.email); // chỉ để MISA lưu — IsSendEmail=false
  datNeuCo(goc, "BuyerFullName", nm.hoTen);

  return { RefID: p.refId, OriginalInvoiceData: goc, IsSendEmail: false };
}

// ─── Phân loại mã lỗi ───────────────────────────────────────────────────────────────────────────

/**
 * Mã lỗi DỮ LIỆU / cấu hình mà MISA từ chối TRƯỚC khi cấp số ⇒ chắc chắn chưa có hoá đơn.
 * Nguồn [PUB] + [ERR]. Cố ý KHÔNG có trong danh sách (⇒ KHONG_RO, nơi gọi tra cứu):
 *   · Exception, CreateInvoiceDataError ("lỗi không xác định")
 *   · InvoiceNumberNotContinuous / InvoiceNumberNotCotinuous, InvalidInvNo — trạng thái đánh số phía MISA
 *   · SignatureEmpty, InvalidSignature, CertRevocation, X509*, SigningTime…  — khâu KÝ, tài liệu không
 *     nói rõ ký hỏng thì bản ghi đã tạo hay chưa.
 */
const MA_DU_LIEU = new Set<string>([
  "InvalidTaxCode",
  "InvalidXMLData",
  "InvalidVatPercentage",
  "InvoicePublishNotExist",
  "InvoiceTemplateNotExist",
  "InvoiceIssuedDate",
  "InvalidInvoiceDate",
  "ExistsInvoiceNextYear",
  "InvoiceTemplateNotValidInDeclaration",
  "DeclarationNotExist",
  "InvalidDeclaration",
  "ExistDeclarationNotReceive",
  "TaxRateInfo_VATRateName",
  "TaxReductionDateInValid",
  "LicenseInfo_NotBuy",
  "LicenseInfo_OutOfInvoice",
  "LicenseInfo_Expired",
  "InvoiceQuantityTooLarge",
  "XMLTooLong",
]);
/** Mã dạng `Ten_{0}` (tên trường nằm sau dấu `_`). */
const TIEN_TO_DU_LIEU = ["RequireInfo_", "RequireError_", "InvoiceDetail_", "StockInTaxCode_NotInfo_"];

/** [PUB] "Trùng hóa đơn dựa vào refid" + [ERR] "Trùng RefID của hóa đơn". */
const MA_TRUNG = new Set<string>(["InvoiceDuplicated", "DuplicateInvoiceRefID"]);

/** [ERR]: token hết hạn / lỗi ⇒ làm mới token. */
export const MA_TOKEN = new Set<string>(["TokenExpiredCode", "InvalidTokenCode"]);

const MO_TA: Record<string, string> = {
  InvalidTaxCode: "Mã số thuế không hợp lệ",
  InvalidXMLData: "Dữ liệu hoá đơn không hợp lệ",
  InvalidVatPercentage: "Thuế suất không hợp lệ",
  InvoicePublishNotExist: "Không có thông báo phát hành cho mẫu số/ký hiệu tương ứng",
  InvoiceTemplateNotExist: "Mẫu hoá đơn không tồn tại",
  InvoiceIssuedDate: "Ngày hoá đơn không hợp lệ",
  InvalidInvoiceDate: "Ngày hoá đơn không hợp lệ hoặc nhỏ hơn ngày hoá đơn cuối",
  ExistsInvoiceNextYear: "Đã có hoá đơn của năm tiếp theo",
  InvoiceTemplateNotValidInDeclaration: "Tờ khai không chứa loại hoá đơn đang phát hành",
  DeclarationNotExist: "Chưa có Tờ khai/Thay đổi thông tin",
  InvalidDeclaration: "Chưa có Tờ khai được CQT chấp nhận",
  ExistDeclarationNotReceive: "Có tờ khai đang chờ CQT tiếp nhận",
  TaxRateInfo_VATRateName: "Tên thuế suất không hợp lệ",
  TaxReductionDateInValid: "Ngày hoá đơn giảm thuế không hợp lệ",
  LicenseInfo_NotBuy: "Chưa mua tài nguyên hoá đơn",
  LicenseInfo_OutOfInvoice: "Không đủ số lượng hoá đơn còn lại",
  LicenseInfo_Expired: "Tài nguyên chưa thanh toán hoặc đã hết hạn",
  InvoiceQuantityTooLarge: "Số lượng hoá đơn gửi lên quá mức cho phép",
  XMLTooLong: "Tệp XML quá dài",
  InvoiceDuplicated: "Trùng hoá đơn — đã được phát hành",
  DuplicateInvoiceRefID: "Trùng RefID của hoá đơn",
  InvoiceNumberNotContinuous: "Số hoá đơn không liên tục",
  InvoiceNumberNotCotinuous: "Số hoá đơn không liên tục",
  Exception: "MISA gặp lỗi không rõ nguyên nhân",
  TokenExpiredCode: "Token hết hạn",
  InvalidTokenCode: "Token lỗi",
};

export type LoaiMa = "DU_LIEU" | "TRUNG" | "TOKEN" | "KHAC";

export function phanLoaiMa(ma: string): LoaiMa {
  if (MA_TRUNG.has(ma)) return "TRUNG";
  if (MA_TOKEN.has(ma)) return "TOKEN";
  if (MA_DU_LIEU.has(ma)) return "DU_LIEU";
  if (TIEN_TO_DU_LIEU.some((t) => ma.startsWith(t) && ma.length > t.length)) return "DU_LIEU";
  return "KHAC";
}

export function moTaMa(ma: string): string {
  const co = MO_TA[ma];
  if (co) return `${co} (${ma})`;
  for (const t of TIEN_TO_DU_LIEU) {
    if (ma.startsWith(t)) return `Thiếu/sai trường "${ma.slice(t.length)}" (${ma})`;
  }
  return `Mã lỗi MISA ${ma}`;
}

// ─── Đọc phản hồi ───────────────────────────────────────────────────────────────────────────────

/** Kết quả đọc publish: thêm một nhánh NỘI BỘ `TRUNG` — nơi gửi (http.ts) tự `traCuu` rồi mới trả. */
export type KetQuaDocPhatHanh = KetQuaPhatHanh | { loai: "TRUNG"; thongDiep: string } | { loai: "TOKEN"; ma: string };

type Rec = Record<string, unknown>;

function laRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function chuoi(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function catNgan(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function moTaErrors(v: unknown): string {
  if (v == null || v === "") return "";
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s && s !== "[]" ? ` Chi tiết: ${catNgan(s)}` : "";
  } catch {
    return "";
  }
}

/** Data của MISA là CHUỖI JSON (mảng). Trả null nếu không đọc được. */
export function docMangData(data: unknown): Rec[] | null {
  let v: unknown = data;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v)) return null;
  if (!v.every(laRec)) return null;
  return v as Rec[];
}

function cungRefId(a: unknown, b: string): boolean {
  return chuoi(a).toLowerCase() === b.trim().toLowerCase();
}

/** Ngày MISA trả ("2022-09-22T00:00:00+07:00"). null nếu không đọc được. */
function docNgay(v: unknown): Date | null {
  const s = chuoi(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ký hiệu đầy đủ từ bản ghi MISA. Ví dụ phản hồi [HSM] trả `InvTemplateNo: "1"` + `InvSeries: "K21TAA"`
 * (6 ký tự, THIẾU chữ số loại), ví dụ [REF] trả `InvTempl: "1"` + `InvSeries: "C23TYY"` — trong khi
 * body gửi đi dùng `InvSeries: "1C21TYY"` (7 ký tự). ⇒ 6 ký tự bắt đầu C/K thì ghép mẫu số vào trước.
 * ⚠️ CHƯA XÁC MINH trên sandbox thật; rỗng ⇒ nơi gọi dùng ký hiệu dự phòng (của phiếu).
 */
function kyHieuTuMisa(item: Rec): string {
  const series = chuoi(item.InvSeries).toUpperCase();
  const mau = chuoi(item.InvTemplateNo) || chuoi(item.InvTempl);
  if (/^[CK]\d{2}[A-Z][A-Z0-9]{2}$/.test(series) && /^[1-6]$/.test(mau)) return `${mau}${series}`;
  return series;
}

/** Một bản ghi (publish hoặc tra cứu) đủ số + mã tra cứu + ngày ⇒ DaPhatHanh; thiếu ⇒ câu lý do. */
function docDaPhatHanh(item: Rec, refId: string, kyHieuDuPhong: string): DaPhatHanh | string {
  const soHoaDon = chuoi(item.InvNo);
  const maTraCuu = chuoi(item.TransactionID);
  const ngay = docNgay(item.InvDate);
  if (!soHoaDon || !maTraCuu) return "MISA trả bản ghi thiếu số hoá đơn hoặc mã tra cứu.";
  if (!ngay) return `MISA trả số hoá đơn ${soHoaDon} nhưng ngày không đọc được.`;
  return {
    loai: "DA_PHAT_HANH",
    refId,
    kyHieu: kyHieuTuMisa(item) || kyHieuDuPhong,
    soHoaDon,
    ngayPhatHanh: ngay,
    maTraCuu,
  };
}

function tuMa(ma: string, errors: unknown): KetQuaDocPhatHanh {
  const loai = phanLoaiMa(ma);
  if (loai === "TRUNG") return { loai: "TRUNG", thongDiep: `${moTaMa(ma)} — đã tồn tại, cần tra cứu.` };
  if (loai === "TOKEN") return { loai: "TOKEN", ma };
  if (loai === "DU_LIEU") return { loai: "TU_CHOI", ma, thongDiep: `${moTaMa(ma)}.${moTaErrors(errors)}` };
  return {
    loai: "KHONG_RO",
    thongDiep: `${moTaMa(ma)} — chưa rõ đã phát hành hay chưa, cần tra cứu.${moTaErrors(errors)}`,
  };
}

/**
 * Đọc thân phản hồi publishHSM (đã JSON.parse ở tầng HTTP). [PUB]: `Success: true` chỉ nghĩa là
 * yêu cầu tới nơi — phải xét `ErrorCode` TRONG từng phần tử Data.
 */
export function docPhanHoiPhatHanh(body: unknown, phieu: Pick<PhieuPhatHanh, "refId" | "kyHieu">): KetQuaDocPhatHanh {
  if (!laRec(body)) return { loai: "KHONG_RO", thongDiep: "Phản hồi MISA không phải JSON đối tượng." };
  const maNgoai = chuoi(body.ErrorCode);
  if (body.Success !== true) {
    if (maNgoai) return tuMa(maNgoai, body.Errors);
    return { loai: "KHONG_RO", thongDiep: `MISA trả Success=false không kèm mã lỗi.${moTaErrors(body.Errors)}` };
  }
  if (maNgoai) return tuMa(maNgoai, body.Errors);

  const mang = docMangData(body.Data);
  if (!mang) {
    // [PUB] ví dụ trùng: {"Success": true, "Data": "thông tin hóa đơn đã phát hành, errorcode: InvoiceDuplicated"}
    const raw = typeof body.Data === "string" ? body.Data : "";
    for (const ma of MA_TRUNG) {
      if (raw.includes(ma)) return tuMa(ma, null);
    }
    return { loai: "KHONG_RO", thongDiep: "Không đọc được Data trong phản hồi MISA (chuỗi JSON hỏng)." };
  }
  const item = mang.find((x) => cungRefId(x.RefID, phieu.refId));
  if (!item) {
    return { loai: "KHONG_RO", thongDiep: "Phản hồi MISA không có bản ghi mang đúng RefID đã gửi." };
  }
  const maTrong = chuoi(item.ErrorCode);
  if (maTrong) return tuMa(maTrong, body.Errors);
  const kq = docDaPhatHanh(item, phieu.refId, phieu.kyHieu);
  if (typeof kq === "string") return { loai: "KHONG_RO", thongDiep: kq };
  return kq;
}

/**
 * Đọc phản hồi tra cứu theo RefID [REF]. `EInvoiceStatus`: "1: Gốc, 2: Xóa".
 * ⚠️ CHƯA XÁC MINH: tài liệu không nói RefID không tồn tại thì trả gì. Chọn: `Success=true` + Data
 * là MẢNG đọc được + không phần tử nào mang RefID ⇒ `CHUA_CO`. An toàn vì RefID là khoá chống trùng
 * của MISA: nếu tra cứu trễ mà nơi gọi phát hành lại, MISA trả `InvoiceDuplicated` chứ không cấp số mới.
 */
export function docPhanHoiTraCuu(body: unknown, refId: string): KetQuaTraCuu {
  if (!laRec(body)) return { loai: "KHONG_RO", thongDiep: "Phản hồi tra cứu MISA không phải JSON đối tượng." };
  const ma = chuoi(body.ErrorCode);
  if (body.Success !== true || ma) {
    return {
      loai: "KHONG_RO",
      thongDiep: `Tra cứu MISA lỗi${ma ? `: ${moTaMa(ma)}` : ""}.${moTaErrors(body.Errors)}`,
    };
  }
  const mang = docMangData(body.Data);
  if (!mang) return { loai: "KHONG_RO", thongDiep: "Không đọc được Data tra cứu MISA (chuỗi JSON hỏng)." };
  const item = mang.find((x) => cungRefId(x.RefID, refId));
  if (!item) return { loai: "CHUA_CO" };
  if (chuoi(item.EInvoiceStatus) === "2") {
    return { loai: "KHONG_RO", thongDiep: "MISA báo hoá đơn mang RefID này ở trạng thái XOÁ — cần kế toán kiểm tay." };
  }
  const kq = docDaPhatHanh(item, refId, "");
  if (typeof kq === "string") return { loai: "KHONG_RO", thongDiep: kq };
  return kq;
}

/** Nhận mã lỗi token trong thân tra cứu/tải (để tầng HTTP làm mới token). */
export function maTokenTrongThan(body: unknown): boolean {
  return laRec(body) && MA_TOKEN.has(chuoi(body.ErrorCode));
}
