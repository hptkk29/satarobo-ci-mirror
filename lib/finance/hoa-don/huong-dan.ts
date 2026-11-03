// lib/finance/hoa-don/huong-dan.ts — CHỮ HƯỚNG DẪN của khu Hoá đơn điện tử. THUẦN, client dùng được (không import server).
//
// Vì sao tách khỏi JSX. Kế toán / BA phải sửa được chữ mà không đụng component (audit 05 §4.5.4), và chữ pháp lý–thuế
// phải đi qua MỘT cửa để dò duyệt. Trang gọi: `<InfoTip>{huongDan("coc")}</InfoTip>` hoặc
// `<FieldLabel label="Ký hiệu" hint={huongDan("ky-hieu")} />` (HelpHint/InfoTip ở components/admin/ui/help-hint.tsx).
//
// ⚠️ K11 / TD-10 — CHỮ PHÁP LÝ–THUẾ. Nguồn pháp lý của đợt này là thứ cấp, độ chắc chắn TRUNG/THẤP (báo cáo 09).
// Vì vậy mọi mục `loai: "phap-ly-thue"`: (a) chỉ MÔ TẢ hệ thống làm gì, KHÔNG khẳng định quy định/điều khoản/tỉ lệ nào;
// (b) mang cờ `canKeToanDuyet: true` — kế toán duyệt chữ trước khi mục đó lên màn thật; (c) dẫn người đọc về kế toán khi
// cần quyết. Lưới `[HDUI-H3]` chặn viện dẫn cụ thể lọt vào. Đừng "làm cho rõ" bằng cách thêm số hiệu văn bản.
//
// Ngắn có chủ đích: mỗi mục ≤ TOI_DA_KY_TU_HUONG_DAN ký tự. Phần dài thuộc `PageHelp` (cả trang), không thuộc icon.

/** Mọi khoá hướng dẫn. Thêm khoá = thêm vào đây VÀ vào BANG (tsc buộc đủ cả hai). */
export const CAC_KHOA_HUONG_DAN = [
  "coc",
  "ky-hieu",
  "ngoai-le-ky-hieu",
  "ngay-phat-hanh",
  "xuat-theo-so-da-thu",
  "hsm",
  "qr-thong-tin-hoa-don",
  "phap-nhan",
  "nha-cung-cap",
  "phuong-thuc-ky",
  "nghia-vu-hoa-don",
  "lech-so",
  "can-dieu-chinh",
  "thue",
  // Lát S7 (Invoice Hub) — khu Chính sách hoá đơn + khu Nhà cung cấp & ký (chỉ đọc).
  "chinh-sach-hoa-don",
  "mo-phong-chinh-sach",
  "duyet-hai-nguoi",
  "che-do-toi-da",
  "che-do-hub",
  "cau-hinh-chi-doc",
  "moi-truong-nha-cung-cap",
  // Hướng dẫn SOẠN chính sách từng bước cho người không có nghiệp vụ kế toán (chủ dự án yêu cầu 02/11/2026).
  "soan-cs-tong-quan",
  "soan-cs-hieu-luc",
  "soan-cs-thoi-diem",
  "soan-cs-che-do",
  "soan-cs-thue",
  "soan-cs-ap-dung",
] as const;

export type KhoaHuongDan = (typeof CAC_KHOA_HUONG_DAN)[number];

/** "van-hanh" = cách dùng hệ thống · "phap-ly-thue" = chạm pháp lý/thuế ⇒ BẮT BUỘC kế toán duyệt chữ. */
export type LoaiHuongDan = "van-hanh" | "phap-ly-thue";

export type ThongTinHuongDan = {
  loai: LoaiHuongDan;
  /** Chữ này chưa được kế toán duyệt. Mọi mục `phap-ly-thue` PHẢI là true (test ép). */
  canKeToanDuyet: boolean;
};

/** Trần độ dài (sau chuẩn hoá NFC). Quá trần ⇒ chuyển sang PageHelp, đừng nhét thêm vào icon. */
export const TOI_DA_KY_TU_HUONG_DAN = 220;

type MucHuongDan = ThongTinHuongDan & {
  chu: string | ((gioHieuLuc: number) => string);
};

const BANG = {
  coc: {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Khoản khách đưa trước khi chốt học phí. Hệ thống ghi số tiền và ngày thu, chưa tự kết luận đây là học phí hay tiền cọc. Có cần xuất hoá đơn cho khoản này không, hãy hỏi kế toán.",
  },
  "ky-hieu": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Nhóm chữ và số đứng đầu số hoá đơn; mỗi dãy số đi theo một ký hiệu. Hệ thống gợi ý ký hiệu đang bật của cơ sở. Muốn dùng ký hiệu khác, hãy hỏi kế toán trước.",
  },
  "ngoai-le-ky-hieu": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Chỉ dùng khi ký hiệu cần khác cấu hình của cơ sở. Phải ghi lý do rõ ràng (ít nhất 10 ký tự); trường hợp này được lưu lại để kế toán rà soát sau.",
  },
  "ngay-phat-hanh": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Ngày ghi trên hoá đơn khi phát hành, không được sau hôm nay. Nếu ngày này khác ngày thu tiền, hãy hỏi kế toán trước khi xác nhận.",
  },
  "xuat-theo-so-da-thu": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Chỉ lập hoá đơn cho số tiền đã thu, chưa tính phần còn nợ. Dùng khi khách mới đóng một phần; chỉ bật khi kế toán đồng ý xuất theo phần đã đóng.",
  },
  hsm: {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "HSM là thiết bị ký số đặt ở phía nhà cung cấp hoá đơn. Khi bấm phát hành, nhà cung cấp tự ký bằng thiết bị này, bạn không cần cắm USB hay mở phần mềm ký.",
  },
  "qr-thong-tin-hoa-don": {
    // OD-11 chưa chốt thời hạn QR ⇒ số giờ là THAM SỐ BẮT BUỘC, không mặc định, không hardcode. Chạm dữ liệu cá nhân nên cũng chờ duyệt.
    loai: "van-hanh",
    canKeToanDuyet: true,
    chu: (gioHieuLuc: number) =>
      `Mã QR mở trang để phụ huynh tự điền thông tin xuất hoá đơn. Mã có hiệu lực ${gioHieuLuc} giờ kể từ lúc tạo; quá hạn thì tạo mã mới và gửi lại.`,
  },
  "phap-nhan": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Pháp nhân là đơn vị đứng tên trên hoá đơn (tên và mã số thuế). Mỗi cơ sở phát hành dưới pháp nhân đã cấu hình. Muốn đổi pháp nhân của cơ sở, hãy hỏi kế toán, đừng tự sửa.",
  },
  "nha-cung-cap": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Nhà cung cấp là phần mềm hoá đơn điện tử cơ sở dùng để phát hành. Hệ thống chỉ bật những thao tác mà nhà cung cấp đã được nối và kiểm tra xong.",
  },
  "phuong-thuc-ky": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Phương thức ký là cách hoá đơn được ký số: trên thiết bị của nhà cung cấp (HSM), bằng USB token hoặc ký từ xa. Cơ sở dùng cách nào do kế toán chốt, không tự đổi.",
  },
  "nghia-vu-hoa-don": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Phần tiền đã thu đang cần xem xét để xuất hoá đơn. Một khoản có thể cần hoá đơn, đã có hoá đơn, hoặc chưa rõ. Khoản chưa rõ để kế toán quyết, hệ thống không tự đoán.",
  },
  "lech-so": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Số tiền đã thu và số trên hoá đơn không khớp, hoặc cùng một khoản dường như đã có hoá đơn. Mở từng dòng để xem chênh bao nhiêu trước khi xuất hay sửa.",
  },
  "can-dieu-chinh": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Hoá đơn đã xuất nhưng sau đó đơn đổi số tiền hoặc bị huỷ, nên số trên hoá đơn không còn đúng. Cách xử lý do kế toán quyết; hệ thống chỉ nhắc và không tự sửa.",
  },
  thue: {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Thuế GTGT của từng khoản lấy theo cấu hình kế toán đặt, hệ thống không tự đặt mức thuế. Học phí, học cụ hay lệ phí có thể khác nhau; không chắc thì hỏi kế toán.",
  },
  // ── Lát S7 ──
  "chinh-sach-hoa-don": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Chính sách là bộ quy tắc lập hoá đơn: mỗi loại khoản dùng mức thuế nào, tính giá ra sao. Mỗi lần đổi là một phiên bản mới, bản cũ không sửa được. Nội dung cần kế toán xác nhận.",
  },
  "mo-phong-chinh-sach": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Bảng so sánh trước và sau khi áp chính sách mới trên vài khoản mẫu. Số tiền chỉ để minh hoạ, không phải hoá đơn thật. Người duyệt phải xem bảng này rồi mới duyệt được.",
  },
  "duyet-hai-nguoi": {
    // Tên khoá giữ nguyên cho khỏi vỡ nơi gọi; NỘI DUNG đã đổi: chủ dự án bỏ luật «người khác duyệt» ngày 02/11/2026.
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Kế toán Hội sở duyệt: xem bảng mô phỏng, ghi lý do rồi bấm duyệt. Người soạn cũng duyệt được bản của mình. Mọi bước đều được ghi vào lịch sử, bản đã có hiệu lực không sửa được.",
  },
  "che-do-toi-da": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Mức tự động cao nhất mà chính sách cho phép: tắt, chạy thử, đề xuất hoặc tự động. Có căn cứ cần kế toán xác nhận mà chưa ai ký thì chỉ được chạy thử.",
  },
  "che-do-hub": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Mức Hub đang bật cho cơ sở này: tắt, chạy thử, đề xuất hoặc tự động. Ở đây chỉ xem; muốn đổi cần quy trình duyệt hai người và không được vượt mức tối đa của chính sách.",
  },
  "cau-hinh-chi-doc": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Các mục này quyết định ai đứng tên hoá đơn, gửi tới đâu và ký bằng gì. Đổi nhầm là hoá đơn sai nơi, nên màn này chỉ hiển thị. Cần đổi thì báo quản trị.",
  },
  "moi-truong-nha-cung-cap": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Môi trường thử nghiệm hoặc thật do quản trị khai. Cột này chỉ để xem: hệ thống CHƯA tự đối chiếu nó với máy chủ. Rào đang chạy nằm ở cấu hình kết nối: chế độ thử chỉ nhận địa chỉ thử, chế độ thật từ chối địa chỉ thử.",
  },
  // ── Hướng dẫn soạn chính sách từng bước (người không rành kế toán). CHỈ nói cách làm; mức thuế do kế toán/hoá đơn cũ quyết, không có số nào ở đây. ──
  "soan-cs-tong-quan": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Chính sách là bảng ghi sẵn: bán loại khoản nào thì lập hoá đơn thế nào. Bạn không cần rành kế toán, chỉ cần làm 5 bước dưới đây và lấy số liệu từ hoá đơn công ty đã xuất trước đây.",
  },
  "soan-cs-hieu-luc": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Bước 1 · Ngày áp dụng: chọn ngày bắt đầu (thường là hôm nay hoặc đầu tháng). Chưa có ngày kết thúc thì để trống «Đến hết ngày». Muốn đổi về sau thì soạn bản mới, bản đã áp dụng không sửa được.",
  },
  "soan-cs-thoi-diem": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Bước 2 · Thời điểm lập hoá đơn: đang làm theo cách nào thì chọn cách đó. Nếu kế toán đang tự chốt ngày lập thì chọn «Ngày do kế toán chốt (như hiện nay)» — không đổi cách làm hiện tại.",
  },
  "soan-cs-che-do": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Bước 3 · Chế độ tối đa: chưa chắc thì chọn «Chạy thử (không phát hành)». Hệ thống chỉ tính thử trên số liệu mẫu, không lập hoá đơn thật. Quen rồi thì soạn bản mới để nâng mức.",
  },
  "soan-cs-thue": {
    loai: "phap-ly-thue",
    canKeToanDuyet: true,
    chu: "Bước 4 · Thuế từng loại khoản: mở một hoá đơn công ty ĐÃ xuất cho loại đó, xem dòng thuế GTGT rồi chép sang. Chưa chắc thì hỏi kế toán trưởng trước khi lưu: ô thuế để trống thì chưa lưu được.",
  },
  "soan-cs-ap-dung": {
    loai: "van-hanh",
    canKeToanDuyet: false,
    chu: "Bước 5 · Lưu bản nháp, xem bảng mô phỏng rồi bấm «Gửi duyệt và áp dụng ngay». Mô phỏng chỉ để xem trước, không tạo hoá đơn thật. Bản đã áp dụng không sửa được; muốn đổi thì soạn bản mới.",
  },
} as const satisfies Record<KhoaHuongDan, MucHuongDan>;

/** Khoá cần một tham số để dựng chữ (số giờ hiệu lực của QR). */
type KhoaCoThamSo = "qr-thong-tin-hoa-don";

/** Siêu dữ liệu của một khoá — dùng cho dò duyệt (`canKeToanDuyet`) và cho test. */
export function thongTinHuongDan(khoa: KhoaHuongDan): ThongTinHuongDan {
  const { loai, canKeToanDuyet } = BANG[khoa];
  return { loai, canKeToanDuyet };
}

/**
 * Chữ hướng dẫn của một khoá. Khoá QR BẮT BUỘC kèm số giờ hiệu lực (luật 7: không mặc định, tsc buộc truyền);
 * giá trị không phải số nguyên dương thì ném — không in "NaN giờ" hay "0 giờ" lên màn.
 */
export function huongDan(khoa: Exclude<KhoaHuongDan, KhoaCoThamSo>): string;
export function huongDan(khoa: KhoaCoThamSo, gioHieuLuc: number): string;
export function huongDan(khoa: KhoaHuongDan, gioHieuLuc?: number): string {
  const muc: MucHuongDan = BANG[khoa];
  if (typeof muc.chu !== "function") return muc.chu;
  if (typeof gioHieuLuc !== "number" || !Number.isInteger(gioHieuLuc) || gioHieuLuc <= 0) {
    throw new Error(`Hướng dẫn "${khoa}" cần số giờ hiệu lực là số nguyên dương (nhận: ${String(gioHieuLuc)}).`);
  }
  return muc.chu(gioHieuLuc);
}
