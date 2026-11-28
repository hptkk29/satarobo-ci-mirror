// lib/finance/hoa-don/yeu-cau-nguoi-mua-ghi-don.ts — luật THUẦN của hai việc trên đường QR (Invoice Hub, chủ dự án chốt 03/11/2026). Không DB, không đồng hồ, không `node:crypto`.
//
//  1. ĐIỀN SẴN (`dienSanTuForm`): trang công khai mở ra đã có sẵn thông tin lấy từ đơn → hồ sơ học viên → phiếu lead («PH sửa nếu sai, khỏi phải điền nhiều»). Hai ô CCCD KHÔNG BAO GIỜ điền sẵn
//     (`O_KHONG_DIEN_SAN`). Loại người mua mặc định CÁ NHÂN; chỉ khi đơn đang có CẢ tên đơn vị lẫn MST mới điền sẵn DOANH NGHIỆP (để PH bấm Gửi mà không vô tình đè mất thông tin công ty).
//  2. GHI THẲNG VÀO ĐƠN (`cotDonTuPhuHuynh`): phụ huynh gửi xong thì dữ liệu vào ĐƠN ngay (không còn bước «Áp dụng vào đơn»), «ai ghi sau thì thắng». CHỈ ghi ô PH THẬT SỰ ĐỔI so với bản điền
//     sẵn (`banDau`) — hai lý do:
//       · PH bấm Gửi mà không đụng ô nào thì không được đè lên chỉnh sửa của Sale làm giữa lúc PH đang mở form (PH gửi lại nguyên giá trị điền sẵn cũ không phải là «PH vừa sửa»);
//       · địa chỉ trên đơn có BA cột (phường / tỉnh / chi tiết) còn form công khai chỉ có MỘT ô — chỉ ghi khi PH sửa ô đó, kẻo dồn địa chỉ có cấu trúc thành một chuỗi.
//     Loại người mua đổi so với bản điền sẵn ⇒ ô `ten` đổi NGHĨA (tên ba/mẹ ↔ tên đơn vị) nên luôn ghi lại.
import { nationalPhone } from "@/lib/phone";
import { parseVnYmd, vnDateOnly } from "@/lib/time/vn";
import { sach, type FormNguoiMua } from "./form-nguoi-mua";
import { O_KHONG_DIEN_SAN, O_NGUOI_MUA, chuanHoaO, type DauVaoO, type OKhoa } from "./yeu-cau-nguoi-mua";
import type { CotDonGhi } from "./yeu-cau-nguoi-mua-ap-dung";

/** Giá trị hiệu lực của khối «Người mua trên hoá đơn» (`hieuLuc(...).form`) → các ô của biểu mẫu công khai. Ô trống không có khoá; hai ô CCCD không bao giờ có mặt. */
export function dienSanTuForm(f: FormNguoiMua): DauVaoO {
  const diaChi = [f.diaChi, f.phuong, f.tinh].map(sach).filter((s) => s !== "").join(", ");
  const laDoanhNghiep = sach(f.donViTen) !== "" && sach(f.donViMst) !== "";
  const tho: DauVaoO = laDoanhNghiep
    ? { loai: "DOANH_NGHIEP", ten: f.donViTen, maSoThue: f.donViMst, email: f.phuHuynhEmail, diaChi }
    : { loai: "CA_NHAN", ten: f.phuHuynhTen, sdt: f.phuHuynhSdt, email: f.phuHuynhEmail, diaChi, tenHocVien: f.hocVienTen, ngaySinhHocVien: f.hocVienNgaySinh };
  const ra: DauVaoO = {};
  for (const o of O_NGUOI_MUA) {
    if (O_KHONG_DIEN_SAN.includes(o)) continue;
    const v = chuanHoaO(o, tho[o]);
    if (v !== "") ra[o] = v;
  }
  return ra;
}

/** `banDau` do CLIENT gửi lên (không tin cậy): chỉ giữ ô có tên hợp lệ, giá trị chuỗi, đã chuẩn hoá, không rỗng, có trần độ dài. Hai ô CCCD bị bỏ (không bao giờ điền sẵn). */
export function docBanDauTho(raw: unknown): DauVaoO {
  const ra: DauVaoO = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ra;
  const r = raw as Record<string, unknown>;
  for (const o of O_NGUOI_MUA) {
    if (O_KHONG_DIEN_SAN.includes(o)) continue;
    const v = r[o];
    if (typeof v !== "string") continue;
    const g = chuanHoaO(o, v.slice(0, 500));
    if (g !== "") ra[o] = g;
  }
  return ra;
}

/**
 * Các cột của `Order` cần ghi từ lượt gửi của phụ huynh. `du` = các ô đã qua `kiemBieuMau` (đã chuẩn hoá); `banDau` = bản điền sẵn phụ huynh nhìn thấy lúc mở form.
 * Khoá VẮNG MẶT = không đụng (khác `null` = xoá). Không có `loai` trong `du` ⇒ không ghi gì (không đoán nghĩa của ô `ten`).
 *  · CÁ NHÂN: ghi tên + CCCD + SĐT ba/mẹ, khối học viên, email — mỗi ô nếu ĐỔI. Đổi loại (từ DOANH NGHIỆP) ⇒ XOÁ tên đơn vị + MST (người mua nay là cá nhân).
 *  · DOANH NGHIỆP: ghi tên đơn vị + MST + email nếu đổi; KHÔNG đụng ô của cá nhân (người liên hệ vẫn là người cũ).
 *  · Địa chỉ: đổi ⇒ một ô đầy đủ vào `customerAddress`, xoá phường / tỉnh (xem `anhXaNguoiMuaSangDon`).
 */
export function cotDonTuPhuHuynh(du: DauVaoO, banDau: DauVaoO): CotDonGhi {
  const moi = (o: OKhoa): string => chuanHoaO(o, du[o]);
  const cu = (o: OKhoa): string => chuanHoaO(o, banDau[o]);
  const loai = moi("loai");
  if (loai !== "CA_NHAN" && loai !== "DOANH_NGHIEP") return {};
  const doiLoai = loai !== cu("loai");
  /** Ô có giá trị VÀ khác bản điền sẵn. */
  const doi = (o: OKhoa): boolean => moi(o) !== "" && moi(o) !== cu(o);
  const cot: CotDonGhi = {};
  if (loai === "DOANH_NGHIEP") {
    if ((doiLoai || doi("ten")) && moi("ten") !== "") cot.invoiceCompanyName = moi("ten");
    if (doi("maSoThue")) cot.invoiceTaxCode = moi("maSoThue");
  } else {
    if (doiLoai) {
      cot.invoiceCompanyName = null;
      cot.invoiceTaxCode = null;
    }
    if ((doiLoai || doi("ten")) && moi("ten") !== "") cot.invoiceBuyerName = moi("ten");
    if (doi("cccd")) cot.customerCccd = moi("cccd");
    if (doi("sdt")) cot.invoiceParentPhone = nationalPhone(moi("sdt")) ?? moi("sdt");
    if (doi("tenHocVien")) cot.invoiceStudentName = moi("tenHocVien");
    if (doi("ngaySinhHocVien")) {
      const ngay = parseVnYmd(moi("ngaySinhHocVien"));
      if (ngay) cot.invoiceStudentDob = vnDateOnly(ngay);
    }
    if (doi("cccdHocVien")) cot.invoiceStudentCccd = moi("cccdHocVien");
  }
  if (doi("email")) cot.invoiceEmail = moi("email");
  if (doi("diaChi")) {
    cot.customerAddress = moi("diaChi");
    cot.customerWard = null;
    cot.customerCity = null;
  }
  return cot;
}
