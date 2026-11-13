/**
 * 20 EBOOK do Ban Đào tạo Sata Robo biên soạn (dữ liệu từ thiết kế «Sata Robo — Website mới», TuSach.dc.html).
 * Tệp thật: PDF + ảnh từng trang nằm ở R2 theo khoá ở `khoaSach()` (nhập bằng `scripts/tu-sach/`); ảnh bìa nằm trong repo `public/tu-sach/bia/<so>.jpg`.
 * Ebook do AI hỗ trợ soạn, Sata Robo phát hành miễn phí (chủ dự án 07/11/2026).
 */
export type Ebook = {
  so: number;
  tieuDe: string;
  phuDe: string;
  moTa: string;
  doiTuong: string;
  chuDe: string;
  soTrang: number;
};

export const CHU_DE_EBOOK = ["Tư duy", "Kỹ năng sống", "Gia đình", "Học tập", "STEM & Robotics", "Hoạt động ngoài trời"] as const;

export const MAU_CHU_DE: Readonly<Record<string, string>> = {
  "Tư duy": "#6b21a8",
  "Kỹ năng sống": "#0f766e",
  "Gia đình": "#be185d",
  "Học tập": "#1d4ed8",
  "STEM & Robotics": "#c2410c",
  "Hoạt động ngoài trời": "#15803d",
};

export const EBOOKS: readonly Ebook[] = [
  {"so":1,"tieuDe":"30 Câu Hỏi Khơi Gợi Tư Duy Cho Con Mỗi Tối","phuDe":"Biến giờ đi ngủ thành giờ phát triển tư duy","moTa":"30 câu hỏi chia 5 nhóm (sáng tạo, logic, cảm xúc, xã hội, khoa học) để hỏi con trước giờ ngủ, kèm hướng dẫn cho cha mẹ và lịch hỏi 30 ngày.","doiTuong":"Phụ huynh","chuDe":"Tư duy","soTrang":29},
  {"so":2,"tieuDe":"Bản Đồ Kỹ Năng Lớp 5-9: Con Cần Gì Trước 2030?","phuDe":"Hành trang chuẩn bị tương lai cho con trong giai đoạn lớp 5-9","moTa":"Những kỹ năng con nên có theo từng chặng lớp 5-6, 7-8 và lớp 9, kèm công cụ tự đánh giá và gợi ý hành động.","doiTuong":"Phụ huynh có con lớp 5-9","chuDe":"Kỹ năng sống","soTrang":21},
  {"so":3,"tieuDe":"Cẩm Nang Growth Mindset Cho Phụ Huynh Việt","phuDe":"Giúp con phát triển tư duy đối mặt với thách thức","moTa":"10 phương pháp giúp con hình thành tư duy phát triển: khen nỗ lực, làm gương, khuyến khích thử thách, nhìn nhận lỗi sai.","doiTuong":"Phụ huynh","chuDe":"Tư duy","soTrang":20},
  {"so":4,"tieuDe":"10 Phương Pháp Kỷ Luật Không Hình Phạt","phuDe":"Dạy con trách nhiệm mà không cần hình phạt","moTa":"10 phương pháp kỷ luật tích cực như hậu quả tự nhiên, lắng nghe, đặt ranh giới rõ ràng, kèm phần hỏi đáp và tình huống thực tế.","doiTuong":"Phụ huynh","chuDe":"Gia đình","soTrang":20},
  {"so":5,"tieuDe":"Lịch Học Tuần Cân Bằng Cho Trẻ Lớp 5-9","phuDe":"Thiết kế tuần học sao cho con khỏe mạnh và hạnh phúc","moTa":"Nguyên tắc xếp lịch cân bằng và lịch mẫu cho lớp 5-6, 7-8, 9, kèm mẹo quản lý thời gian theo từng hoạt động.","doiTuong":"Phụ huynh có con lớp 5-9","chuDe":"Học tập","soTrang":20},
  {"so":6,"tieuDe":"Checklist Chọn Hoạt Động Ngoại Khóa Cho Con","phuDe":"Đầu tư đúng - phát triển đúng hướng","moTa":"So sánh các nhóm ngoại khóa (thể thao, nghệ thuật, STEM, ngôn ngữ) và bộ checklist đánh giá giúp chọn hoạt động hợp với con.","doiTuong":"Phụ huynh","chuDe":"Học tập","soTrang":22},
  {"so":7,"tieuDe":"Script Đối Thoại: 50 Cách Bắt Đầu Cuộc Trò Chuyện Với Con Tuổi Teen","phuDe":"Kết nối với con - không còn im lặng","moTa":"50 câu mở lời thực tế để trò chuyện với con 12-17 tuổi, kể cả các chủ đề nhạy cảm, mà không gây xung đột.","doiTuong":"Phụ huynh có con 12-17 tuổi","chuDe":"Gia đình","soTrang":23},
  {"so":8,"tieuDe":"Bộ Đề Tư Duy Sáng Tạo: 30 Câu Đố Cho Trẻ Lớp 5-9","phuDe":"Rèn não - tăng trí - vui mỗi ngày","moTa":"30 câu đố tư duy chia ba mức dễ, trung bình, khó, có đáp án, hướng dẫn cho cha mẹ và lộ trình 30 ngày.","doiTuong":"Học sinh lớp 5-9","chuDe":"Tư duy","soTrang":34},
  {"so":9,"tieuDe":"Robotics Giải Mã: Từ A-Z Cho Phụ Huynh Không Biết Kỹ Thuật","phuDe":"Hiểu Robotics - hỗ trợ con đúng cách","moTa":"Giải thích robotics là gì, các nền tảng phổ biến, lộ trình theo tuổi, 5 dự án làm tại nhà, chi phí và 20 câu hỏi thường gặp.","doiTuong":"Phụ huynh","chuDe":"STEM & Robotics","soTrang":22},
  {"so":10,"tieuDe":"Lộ Trình STEM Cho Trẻ Việt Nam: Nên Bắt Đầu Từ Đâu?","phuDe":"Từ zero đến hero trong thế giới STEM","moTa":"Lộ trình STEM theo từng độ tuổi từ 5 đến 15, kèm 15 thí nghiệm làm tại nhà và tài nguyên tham khảo.","doiTuong":"Phụ huynh có con 5-15 tuổi","chuDe":"STEM & Robotics","soTrang":23},
  {"so":11,"tieuDe":"50 Hoạt Động Ngoài Trời Miễn Phí Cho Con Cuối Tuần","phuDe":"Vui chơi không tốn tiền - trải nghiệm vô giá","moTa":"50 hoạt động không tốn tiền ở công viên, biển, vườn, phố và cả ngày mưa, kèm lịch hoạt động bốn mùa.","doiTuong":"Phụ huynh","chuDe":"Hoạt động ngoài trời","soTrang":20},
  {"so":12,"tieuDe":"Nhật Ký Hành Trình Gia Đình","phuDe":"Lưu giữ kỷ niệm - rèn kỹ năng viết","moTa":"Bộ mẫu để con ghi, vẽ, dán ảnh về các chuyến đi biển, núi, thành phố, làng quê và trải nghiệm ẩm thực cùng gia đình.","doiTuong":"Học sinh và gia đình","chuDe":"Gia đình","soTrang":21},
  {"so":13,"tieuDe":"Cẩm Nang Cắm Trại Lần Đầu","phuDe":"Trải nghiệm tuyệt vời cho cả gia đình","moTa":"Checklist đồ dùng, cách chọn chỗ an toàn, dựng trại, hoạt động tại trại, an toàn và sơ cứu, cùng gợi ý điểm cắm trại gia đình.","doiTuong":"Gia đình","chuDe":"Hoạt động ngoài trời","soTrang":20},
  {"so":14,"tieuDe":"10 Chuyến Đi Gần Đà Nẵng Cuối Tuần","phuDe":"Khám phá miền Trung cùng con","moTa":"Gợi ý các điểm đi cuối tuần quanh Đà Nẵng như Hội An, Cù Lao Chàm, Huế, Bạch Mã, Sơn Trà, kèm lịch trình mẫu và mẹo tiết kiệm.","doiTuong":"Gia đình","chuDe":"Hoạt động ngoài trời","soTrang":21},
  {"so":15,"tieuDe":"Dạy Con Qua Trải Nghiệm","phuDe":"Học từ cuộc sống - nhớ cả đời","moTa":"Giới thiệu học qua trải nghiệm và chu kỳ Kolb, cùng 20 dự án khoa học, xã hội, sáng tạo, tài chính cho cha mẹ tổ chức.","doiTuong":"Phụ huynh","chuDe":"Học tập","soTrang":20},
  {"so":16,"tieuDe":"Kỹ Năng Sống Con Trẻ Cần: Checklist Theo Từng Độ Tuổi","phuDe":"Không chỉ học giỏi - mà còn sống giỏi","moTa":"Checklist kỹ năng sống cho trẻ 3-17 tuổi (tự chăm sóc, giao tiếp, cảm xúc, an toàn, tài chính, công nghệ) kèm cách dạy.","doiTuong":"Phụ huynh có con 3-17 tuổi","chuDe":"Kỹ năng sống","soTrang":24},
  {"so":17,"tieuDe":"Bộ Câu Hỏi Gia Đình: 52 Chủ Đề Bữa Cơm Không Im Lặng","phuDe":"Xây dựng kết nối tâm lý qua mỗi bữa ăn cùng nhau","moTa":"52 chủ đề trò chuyện trong bữa cơm theo 4 nhóm (ước mơ, cảm xúc, sáng tạo, giá trị) và cách tạo không gian an toàn để cả nhà chia sẻ.","doiTuong":"Gia đình","chuDe":"Gia đình","soTrang":32},
  {"so":18,"tieuDe":"Hướng Dẫn Chụp Ảnh Gia Đình Đẹp Bằng Điện Thoại","phuDe":"Tạo ra những khoảnh khắc gia đình đáng nhớ","moTa":"Kỹ năng và cài đặt cơ bản khi chụp bằng điện thoại, hơn 20 ý tưởng chụp ảnh gia đình, cách chỉnh sửa và lưu kỷ niệm.","doiTuong":"Gia đình","chuDe":"Gia đình","soTrang":25},
  {"so":19,"tieuDe":"Bộ Thẻ Cảm Xúc Cho Trẻ: Dạy Con Nhận Diện & Nói Ra","phuDe":"Phát triển trí tuệ cảm xúc từ tuổi thơ","moTa":"20 thẻ cảm xúc chi tiết cùng hoạt động theo độ tuổi và kịch bản để cha mẹ giúp con gọi tên và nói ra cảm xúc.","doiTuong":"Phụ huynh","chuDe":"Kỹ năng sống","soTrang":22},
  {"so":20,"tieuDe":"Bộ Tổng Hợp: Hành Trang Cho Con Mùa Hè","phuDe":"10 tuần mùa hè đầy ý nghĩa","moTa":"Kế hoạch 10 tuần hè gồm dự án STEM thực hành, danh sách đọc, hoạt động ngoài trời và mẹo tổ chức, an toàn.","doiTuong":"Phụ huynh","chuDe":"Hoạt động ngoài trời","soTrang":26},
];

/** Khoá tệp của một ebook trong kho R2. PDF là RIÊNG TƯ (chỉ ký link sau khi để lại thông tin); ảnh trang là CÔNG KHAI (đọc miễn phí). */
export const khoaSach = {
  pdf: (so: number) => `tu-sach/ebook/${so}/sach.pdf`,
  trang: (so: number, trang: number) => `tu-sach/ebook/${so}/p${trang}.webp`,
} as const;

export const timEbook = (so: number): Ebook | undefined => EBOOKS.find((e) => e.so === so);

/**
 * ĐỌC THỬ (08/11/2026, chủ dự án chốt): chưa để lại thông tin thì đọc được 1/4 số trang đầu của mỗi ebook (làm tròn lên, tối thiểu 1 trang);
 * muốn đọc tiếp và tải về thì để lại thông tin. MỘT hàm cho cả trình đọc (nút sang trang) lẫn máy chủ (`/api/tu-sach/trang`) — hai bên lệch là
 * giao diện nói một đằng, ảnh trả một nẻo.
 */
export const TY_LE_DOC_THU = 0.25;
export const soTrangDocThu = (soTrang: number): number => Math.min(soTrang, Math.max(1, Math.ceil(soTrang * TY_LE_DOC_THU)));
