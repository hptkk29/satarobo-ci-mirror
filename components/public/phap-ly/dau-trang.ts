// components/public/phap-ly/dau-trang.ts — chữ ở ĐẦU TRANG (tiêu đề h1 + câu dẫn + linh vật) của khu Chính sách,
// CHÉP nguyên văn từ artifact "ChinhSach-<slug>". Đây là phần trình bày, KHÔNG phải văn bản pháp lý:
// văn bản pháp lý (thân bài) luôn đọc từ `content/legal/<slug>.md` — xem `phap-ly-trang.tsx`.

export type DauTrang = {
  /** Phần đầu của h1 (không tô màu). Rỗng nếu h1 chỉ có phần gradient. */
  dau: string;
  /** Phần cuối của h1 (tô gradient). */
  grad: string;
  /** Câu dẫn dưới h1. */
  lead: string;
  /** Chữ cuối của đường dẫn (breadcrumb) hiển thị — chép nguyên từ artifact; JSON-LD vẫn dùng `breadcrumbLabel` của trang. */
  crumb: string;
  /** Mã ảnh linh vật (`public/pub/<id>.*`). */
  linhVat: string;
};

export const DAU_TRANG: Readonly<Record<string, DauTrang>> = {
  "chinh-sach": {
    crumb: "Chính sách của website",
    dau: "Chính sách của",
    grad: "website",
    lead: "Tổng hợp các chính sách và điều kiện giao dịch áp dụng khi phụ huynh đăng ký khoá học, mua học cụ trên satarobo.vn.",
    linhVat: "87e9462c8a5ae12b7e41aa3b68ced3cc",
  },
  "dieu-khoan-su-dung": {
    crumb: "Điều khoản sử dụng",
    dau: "Điều khoản",
    grad: "sử dụng",
    lead: "Khi truy cập satarobo.vn, ba mẹ đồng ý tuân thủ các điều khoản dưới đây.",
    linhVat: "a8d293a9efc52ad97026bd2d0dc02db2",
  },
  "chinh-sach-bao-mat": {
    crumb: "Chính sách bảo mật",
    dau: "Chính sách",
    grad: "bảo mật",
    lead: "Cách Sata Robo thu thập, sử dụng, lưu trữ và bảo vệ thông tin của phụ huynh và học viên.",
    linhVat: "7e643cba294434d8258e05d15f9c242c",
  },
  "quyen-rieng-tu": {
    crumb: "Trung tâm quyền riêng tư",
    dau: "Trung tâm",
    grad: "quyền riêng tư",
    lead: "Quản lý cách Sata Robo dùng cookie và dữ liệu cá nhân của ba mẹ khi truy cập trang – theo Nghị định 13/2023/NĐ-CP.",
    linhVat: "2e4a9309e1a6bfcb633b68ee102428e9",
  },
  "chinh-sach-gia": {
    crumb: "Chính sách về giá",
    dau: "Chính sách",
    grad: "về giá",
    lead: "Nguyên tắc niêm yết và áp dụng giá cho sản phẩm, dịch vụ trên satarobo.vn.",
    linhVat: "09822f256fe47024e33331af8e3a0ea5",
  },
  "chinh-sach-thanh-toan": {
    crumb: "Chính sách thanh toán",
    dau: "Chính sách",
    grad: "thanh toán",
    lead: "Hình thức thanh toán học phí, sản phẩm và cách Sata Robo bảo vệ giao dịch của ba mẹ.",
    linhVat: "b09f648ab11d0579d24805fe838e0900",
  },
  "chinh-sach-hoan-tra": {
    crumb: "Chính sách đổi trả hàng và hoàn tiền",
    dau: "Đổi trả hàng &",
    grad: "hoàn tiền",
    lead: "Áp dụng cho hàng hoá (học cụ, bộ kit) mua qua satarobo.vn. Khoá học và dịch vụ theo Chính sách chấm dứt dịch vụ.",
    linhVat: "42d4d66e4311582de0d03b3122bb7b04",
  },
  "chinh-sach-giao-hang": {
    crumb: "Chính sách giao hàng",
    dau: "Chính sách",
    grad: "giao hàng",
    lead: "Phạm vi, thời gian, chi phí giao học cụ và trách nhiệm của các bên khi vận chuyển.",
    linhVat: "3d425f2a2c063a1916225676ca19f4f4",
  },
  "phuong-thuc-cung-cap-dich-vu": {
    crumb: "Phương thức cung cấp dịch vụ",
    dau: "Phương thức",
    grad: "cung cấp dịch vụ",
    lead: "Cách Sata Robo cung cấp khoá học, dịch vụ trực tuyến và hỗ trợ ba mẹ trong quá trình sử dụng.",
    linhVat: "bb38a24d4c4cbde40ee43774b5002179",
  },
  "chinh-sach-cham-dut-dich-vu": {
    crumb: "Chính sách chấm dứt dịch vụ và hoàn tiền",
    dau: "Chấm dứt dịch vụ &",
    grad: "hoàn tiền",
    lead: "Áp dụng cho khoá học và dịch vụ mua qua satarobo.vn. Hợp đồng đào tạo có quy định khác thì hợp đồng được ưu tiên.",
    linhVat: "933e29639ed926731a405c5e0289c62d",
  },
  "cac-dieu-kien-va-han-che": {
    crumb: "Các điều kiện và hạn chế trong giao hàng và cung cấp dịch vụ",
    dau: "Điều kiện &",
    grad: "hạn chế",
    lead: "Các giới hạn về thời gian, địa lý, đối tượng và số lượng khi Sata Robo cung cấp hàng hoá, dịch vụ.",
    linhVat: "fe4be01fb9d5892165c884ae5d265246",
  },
  "quyen-va-nghia-vu-cac-ben": {
    crumb: "Quyền và nghĩa vụ của các bên",
    dau: "Quyền & nghĩa vụ",
    grad: "các bên",
    lead: "Quyền và nghĩa vụ của Sata Robo và của khách hàng khi giao dịch trên satarobo.vn.",
    linhVat: "ebf1d6a859c7f4a485c67c864da4ad4c",
  },
  "phuong-thuc-tiep-nhan-phan-anh": {
    crumb: "Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại",
    dau: "Tiếp nhận & giải quyết",
    grad: "phản ánh",
    lead: "Mọi khiếu nại được giải quyết trên cơ sở thương lượng. Lỗi từ Sata Robo sẽ được khắc phục ngay để bảo đảm quyền lợi ba mẹ.",
    linhVat: "21be53cabd4ac017cdbde87433593cfb",
  },
};
