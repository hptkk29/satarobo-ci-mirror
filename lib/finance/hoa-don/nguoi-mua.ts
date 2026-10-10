// lib/finance/hoa-don/nguoi-mua.ts — khối "người mua" của hoá đơn GTGT: lấy từ đâu, và
// còn THIẾU gì thì chưa xuất được. THUẦN: không Prisma, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐO TỪ BA TỜ THẬT (E:\websatarobo data\hoadon, 14/09/2026) — ô nào BẮT BUỘC
//
//                        1C26TSR-86        1C26TSR-127        1C26MNV-13
//   Họ tên người mua     Nguyễn Mai Vi     Nguyễn C.H. Khải   Phan Thị Hồng
//   Tên đơn vị           (trống)           (trống)            (trống)
//   MST / CCCD chủ hộ    (trống)           (trống)            (trống)
//   Địa chỉ              211 Lê Nhân Tông… Thành phố Đà Nẵng  60 Đồng Du…
//   CCCD / Hộ chiếu      049189012543      (trống)            048183006790
//   Hình thức thanh toán Chuyển khoản      Chuyển khoản       Tiền mặt/Chuyển khoản
//
// ⇒ **Họ tên** và **Địa chỉ** có mặt trên CẢ BA ⇒ chặn khi thiếu.
// ⇒ **CCCD** trống ở 1/3 tờ ⇒ KHÔNG chặn. Chặn nó là chặn đúng một phần ba đơn thật vì
//    một lý do không tồn tại — và người vận hành sẽ học cách điền bừa cho qua cổng.
// ⇒ **Tên đơn vị / MST** trống ở cả ba (khách là cá nhân). Nhưng chúng ĐI VỚI NHAU: hoá
//    đơn ghi tên công ty mà bỏ trống mã số thuế là tờ hoá đơn không hợp lệ ⇒ chặn theo
//    CẶP, không chặn riêng lẻ.
//
// ⚠️ Địa chỉ trên hoá đơn 1C26TSR-127 chỉ là "Thành phố Đà Nẵng". Đó là địa chỉ THẬT đã
// phát hành, nên cổng ở đây KHÔNG được đòi số nhà / phường — đòi thì tờ hoá đơn đã tồn tại
// ngoài đời lại không qua nổi cổng của chính hệ thống mình.
// ─────────────────────────────────────────────────────────────────────────────

/** Đúng những cột của `Order` mà khối người mua cần. Không nhận cả bản ghi Prisma. */
export type DonChoHoaDon = {
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerWard: string | null;
  customerCity: string | null;
  customerCccd: string | null;
  invoiceBuyerName: string | null;
  invoiceCompanyName: string | null;
  invoiceTaxCode: string | null;
  invoiceEmail: string | null;
};

export type NguoiMuaHoaDon = {
  hoTen: string;
  tenDonVi: string | null;
  maSoThue: string | null;
  diaChi: string | null;
  cccd: string | null;
  email: string | null;
  dienThoai: string | null;
};

const sach = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Khối người mua cho một đơn: cột `invoice*` thắng, thiếu thì rơi về cột `customer*`.
 *
 * ⚠️ RƠI VỀ, KHÔNG SAO CHÉP SẴN. Cột `invoice*` cố ý nullable và không có default (xem
 * migration 20260914120000): để trống nghĩa là "chưa ai khai riêng cho hoá đơn", và câu
 * trả lời đúng lúc đó là dùng thông tin người đặt đơn. Nếu lúc tạo đơn cứ chép
 * `customerName` sang `invoiceBuyerName` thì về sau không ai phân biệt được "đã kiểm tra
 * và đúng là tên đó" với "chưa ai nhìn tới" — trên một tờ giấy pháp lý, hai thứ đó khác
 * nhau hoàn toàn.
 */
export function nguoiMuaChoDon(don: DonChoHoaDon): NguoiMuaHoaDon {
  const diaChiGhep = [
    sach(don.customerAddress),
    sach(don.customerWard),
    sach(don.customerCity),
  ]
    .filter(Boolean)
    .join(", ");

  return {
    hoTen: sach(don.invoiceBuyerName) ?? sach(don.customerName) ?? "",
    tenDonVi: sach(don.invoiceCompanyName),
    maSoThue: sach(don.invoiceTaxCode),
    diaChi: sach(diaChiGhep),
    cccd: sach(don.customerCccd),
    email: sach(don.invoiceEmail) ?? sach(don.customerEmail),
    dienThoai: sach(don.customerPhone),
  };
}

export type ThieuChoHoaDon = {
  /**
   * Thiếu thứ này thì TỜ HOÁ ĐƠN không dựng được — dựa trên ô có mặt ở cả ba tờ thật.
   *
   * ⚠️ "Chặn" ở đây CHỈ có nghĩa với khâu XUẤT, KHÔNG chặn đơn hàng và KHÔNG chặn lưu.
   * Chủ dự án chốt 14/09: "tuỳ khách hàng — có KH cần hoá đơn, có KH không cần… không
   * bắt buộc nhập người mua trên hoá đơn mà sẽ nhập tuỳ lúc, miễn sao lúc nào cũng có
   * thể sửa mục này và xuất hoá đơn để gửi KH là được." Nên màn phải đọc danh sách này
   * thành "cần bổ sung KHI xuất hoá đơn", đừng đọc thành "đơn này đang sai".
   */
  chan: string[];
  /** Nên có, nhưng không chặn cả khâu xuất. Hiện để kế toán biết mà hỏi khách. */
  nhac: string[];
};

/**
 * Còn thiếu gì để DỰNG ĐƯỢC tờ hoá đơn cho đơn này.
 *
 * TÁCH "CHẶN" KHỎI "NHẮC" CÓ CHỦ ĐÍCH. Gộp tất cả thành lỗi chặn thì cổng sẽ chặn cả
 * những tờ hoá đơn ĐÃ TỒN TẠI ngoài đời (1/3 tờ mẫu không có CCCD), và người vận hành
 * học cách điền bừa cho qua — lúc đó cổng vừa cản trở vừa không còn nghĩa gì.
 *
 * Và cả hai danh sách đều KHÔNG phải điều kiện của đơn hàng: một đơn không ai xin hoá
 * đơn thì để trống vĩnh viễn là đúng, không phải nợ.
 */
export function thieuChoHoaDon(nm: NguoiMuaHoaDon): ThieuChoHoaDon {
  const chan: string[] = [];
  const nhac: string[] = [];

  if (!nm.hoTen) chan.push("Họ tên người mua hàng");
  if (!nm.diaChi) chan.push("Địa chỉ người mua");
  // Cặp: ghi tên công ty thì BẮT BUỘC có mã số thuế, và ngược lại thì không —
  // cá nhân vẫn có thể có MST.
  if (nm.tenDonVi && !nm.maSoThue) {
    chan.push("Mã số thuế (đã ghi tên đơn vị thì bắt buộc có MST)");
  }
  if (nm.maSoThue) {
    const so = nm.maSoThue.replace(/[\s-]/g, "");
    // MST doanh nghiệp 10 số / đơn vị phụ thuộc 13 số; CCCD chủ hộ 12 số cũng điền vào ô
    // này theo mẫu MISA ("MST/CCCD chủ hộ") ⇒ chấp nhận cả ba độ dài.
    if (!/^\d{10}$|^\d{12}$|^\d{13}$/.test(so)) {
      chan.push("Mã số thuế phải là 10, 12 hoặc 13 chữ số");
    }
  }

  if (!nm.cccd) nhac.push("CCCD/Hộ chiếu người mua");
  if (!nm.email) nhac.push("Email nhận hoá đơn điện tử");

  return { chan, nhac };
}

/**
 * Gọn cho màn: bấm "Xuất hoá đơn" bây giờ thì dựng được tờ giấy chưa.
 *
 * KHÔNG dùng hàm này để chặn lưu đơn, chặn thu tiền, hay tô đỏ đơn hàng — nó chỉ trả lời
 * đúng một câu ở đúng một khoảnh khắc: khâu XUẤT.
 */
export function xuatDuocHoaDon(don: DonChoHoaDon): boolean {
  return thieuChoHoaDon(nguoiMuaChoDon(don)).chan.length === 0;
}

/**
 * Khách này có đang YÊU CẦU hoá đơn không — suy từ việc đã có ai khai ô nào chưa.
 *
 * Vì sao cần: phần lớn phụ huynh KHÔNG xin hoá đơn, nên "chưa khai gì" là trạng thái
 * BÌNH THƯỜNG chứ không phải thiếu sót. Màn dùng cờ này để im lặng ở ca đó, thay vì
 * treo một nhãn cảnh báo trên mọi đơn trong hệ thống.
 */
export function daKhaiHoaDon(don: DonChoHoaDon): boolean {
  return Boolean(
    sach(don.invoiceBuyerName) ||
      sach(don.invoiceCompanyName) ||
      sach(don.invoiceTaxCode) ||
      sach(don.invoiceEmail),
  );
}
