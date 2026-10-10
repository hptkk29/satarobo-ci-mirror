// lib/orders/uu-dai-anh-em.ts — ĐƠN NÀY CÓ ƯU ĐÃI ANH CHỊ EM KHÔNG. THUẦN, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN E · Chủ dự án chốt 21/09/2026
//
//   *"KHÔNG tự động tăng nợ bé còn lại khi một con nghỉ. Mặc định: bé còn lại GIỮ nguyên
//   ưu đãi đã chốt trên đơn. … Thay bằng CẢNH BÁO trong màn xem trước Dừng học. … Không
//   đổi số tiền nào."*
//
// ⚠️ **TỆP NÀY KHÔNG ĐƯỢC ĐỔI MỘT ĐỒNG NÀO.** Nó trả về một CÂU CHỮ và một danh sách để
// hiển thị. Không hàm nào ở đây nhận hay trả số tiền phải thu / phải trả. Ngày nào có
// người muốn "thu hồi ưu đãi" thì đó là một đường ghi tiền MỚI, có quyền QLCS, có nhật
// ký — không phải một nhánh `if` thêm vào đây.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI CÁCH NHẬN RA, VÀ VÌ SAO CẢ HAI ĐỀU KHÔNG ĐỦ TIN ĐỂ ĐẾM
//
//  1. **`loai === "ANH_EM"`** — nhãn có cấu trúc, thêm ở PHIÊN E. Tin được, nhưng CHỈ CÓ
//     trên khoản giảm tạo từ 21/09/2026 trở đi, và người bán không bị bắt chọn.
//  2. **`lyDo` chứa "anh em" / "con thứ"** — bắt phần dữ liệu cũ. Đây là phép đoán từ
//     văn xuôi, và nó **chỉ được dùng để cảnh báo**.
//
// Chủ dự án chốt rõ: *"chỉ để cảnh báo, không tính tiền"*, và *"đơn cũ: BỎ QUA, không
// đoán từ chữ, không gán tay hàng loạt"* — tức đoán từ chữ được phép **hiện một dòng
// nhắc**, KHÔNG được phép sinh ra một bản ghi hay một con số.
//
// Nên sai số ở đây rẻ một cách bất đối xứng, và tôi cố ý nghiêng về phía BẮT:
//   · dương tính giả ⇒ thừa một dòng nhắc, người đọc bỏ qua;
//   · âm tính giả    ⇒ không ai biết đơn có ưu đãi anh em, và đó đúng là thứ cần biết.

import { LOAI_GIAM, docLoaiGiam } from "@/lib/orders/giam-gia-dong";

/** Một khoản giảm như nó nằm trong `OrderItem.discounts` (JSON, hình dạng không chắc). */
export type KhoanGiamDaLuu = {
  loai?: unknown;
  lyDo?: unknown;
  giam?: unknown;
};

/** Một dòng đơn, chỉ phần cần để soi nhãn ưu đãi. */
export type DongDeSoiUuDai = {
  orderItemId: string;
  ten: string;
  /** `OrderItem.discounts` — mảng JSON, có thể `null` với đơn cũ. */
  khoanGiam: readonly KhoanGiamDaLuu[] | null;
  /** `OrderItem.discountReason` — bản ghép văn xuôi của đường đọc cũ. */
  lyDoGop?: string | null;
};

export type DauVetUuDaiAnhEm = {
  orderItemId: string;
  ten: string;
  /** `true` = nhận ra bằng NHÃN (tin được); `false` = đoán từ văn xuôi. */
  theoNhan: boolean;
};

export type KetQuaSoiUuDai = {
  co: boolean;
  /** Dòng nào mang dấu vết — màn hình liệt kê để người ta tự kiểm. */
  dauVet: DauVetUuDaiAnhEm[];
  /** Câu hiện thẳng lên màn. `null` khi không có gì để nói. */
  canhBao: string | null;
};

/**
 * Bỏ dấu tiếng Việt + hạ chữ thường. Chỉ dùng cho phép so khớp VĂN XUÔI.
 *
 * ⚠️ `normalize("NFD")` + bỏ dấu phụ là đủ cho tiếng Việt, NHƯNG `đ`/`Đ` **không** phải
 * chữ có dấu phụ — nó là một ký tự riêng và sẽ sống sót qua phép chuẩn hoá. Phải thay tay.
 * Thiếu vế đó thì "con thứ" bỏ dấu ra "con thu" (đúng), còn "đóng" ra "đong" (sai) — và
 * mẫu nào chạm `đ` sẽ im lặng không khớp.
 *
 * ⚠️ `export` vì TEST, và nói thẳng vì sao: **không mẫu nào trong `MAU_VAN_XUOI` hôm nay
 * chứa `đ`**, nên nếu chỉ kiểm qua `soiUuDaiAnhEm` thì gỡ dòng `.replace(/đ/g, "d")` sẽ
 * KHÔNG làm ca nào đỏ — đã cấy thử và đo được đúng điều đó. Một dòng mã không lưới nào
 * canh là một dòng sẽ mục lặng lẽ, nên ca `[UDA-09]` gọi thẳng hàm này.
 */
export function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Mẫu văn xuôi gợi ý ưu đãi anh chị em.
 *
 * ⚠️ Cố ý HẸP. Cám dỗ là bắt luôn "con thu" (đã bỏ dấu) cho gọn — nhưng "con thu" khớp
 * cả "con thu tiền", "con thu nhập", và một cảnh báo hiện sai chỗ thì người ta học cách
 * bỏ qua mọi cảnh báo. Nên "con thứ" phải đi kèm một CHỈ SỐ (2/3/hai/ba…).
 *
 * `anh em` / `anh chi em` / `anh/chi/em` thì không có nghĩa nào khác trong ngữ cảnh một
 * khoản giảm học phí, nên bắt thẳng.
 */
const MAU_VAN_XUOI = [
  /\banh\s*(chi\s*)?em\b/,
  /\banh\s*\/\s*chi\s*\/\s*em\b/,
  /\bem\s*ruot\b/,
  /\bchi\s*ruot\b/,
  /\bcon\s*thu\s*(2|3|4|hai|ba|bon)\b/,
];

/** Một khoản giảm ĐÃ LƯU có mang dấu vết ưu đãi anh em không. */
function khoanCoDauVet(k: KhoanGiamDaLuu): { co: boolean; theoNhan: boolean } {
  if (docLoaiGiam(k.loai) === LOAI_GIAM.ANH_EM) return { co: true, theoNhan: true };
  const lyDo = typeof k.lyDo === "string" ? boDau(k.lyDo) : "";
  return { co: MAU_VAN_XUOI.some((m) => m.test(lyDo)), theoNhan: false };
}

/**
 * Soi CẢ ĐƠN xem có ưu đãi anh chị em không.
 *
 * ⚠️ Soi **mọi dòng**, không chỉ dòng của bé sắp dừng. Ưu đãi anh em theo bản chất nằm
 * trên bé THỨ HAI — nên soi mỗi dòng đang dừng là bỏ sót đúng ca thường gặp nhất.
 */
export function soiUuDaiAnhEm(dong: readonly DongDeSoiUuDai[]): KetQuaSoiUuDai {
  const dauVet: DauVetUuDaiAnhEm[] = [];

  for (const d of dong) {
    let co = false;
    let theoNhan = false;
    for (const k of d.khoanGiam ?? []) {
      const r = khoanCoDauVet(k);
      if (!r.co) continue;
      co = true;
      // Nhãn thắng văn xuôi: một dòng có cả hai thì nó là dòng ĐƯỢC ĐÁNH DẤU.
      if (r.theoNhan) theoNhan = true;
    }
    // Đơn CŨ không có mảng `discounts` — chỉ còn `discountReason` ghép sẵn.
    if (!co && typeof d.lyDoGop === "string") {
      const gop = boDau(d.lyDoGop);
      co = MAU_VAN_XUOI.some((m) => m.test(gop));
    }
    if (co) dauVet.push({ orderItemId: d.orderItemId, ten: d.ten, theoNhan });
  }

  if (dauVet.length === 0) return { co: false, dauVet: [], canhBao: null };

  return {
    co: true,
    dauVet,
    // Câu chữ do chủ dự án chốt 21/09/2026 — sửa lời ở đây thì sửa cả ca test.
    canhBao:
      "Đơn có ưu đãi anh em — bé còn lại vẫn giữ ưu đãi theo chính sách hiện hành. " +
      "Muốn thu hồi, báo QLCS.",
  };
}
