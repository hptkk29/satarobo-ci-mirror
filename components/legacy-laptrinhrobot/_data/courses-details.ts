// =============================================
// CHI TIẾT TỪNG KHÓA HỌC - SATA ROBO
// Used by: /khoa-hoc/[slug] (public route)
// Source: V4 SATA ROBO CTKM tháng 5/2026
// =============================================

export interface CourseDetail {
  slug: string; // URL slug, match Course.id (lowercase)
  metaTitle: string; // SEO title
  metaDescription: string; // SEO meta (150-160 chars)
  heroImage?: string; // Path tới hero image
  audienceTag: string; // VD: "Học sinh Lớp 1-2"
  audienceDescription: string; // VD: "Dành cho phụ huynh muốn con tiếp cận Robotics sớm"
  mission: string; // Sứ mệnh khóa học (1-3 đoạn)
  outcomes: string[]; // Sau khi hoàn thành (3-5 gạch đầu dòng)
  highlights: string[]; // Điểm nổi bật (3-5 bullets)
  noteForParents?: string; // Ghi chú đặc biệt (optional)
}

export const courseDetails: Record<string, CourseDetail> = {
  sata1: {
    slug: "sata1",
    metaTitle:
      "Sata1 — Robosim Master | Khóa luyện thi vòng loại Robotics 2026 | Sata Robo",
    metaDescription:
      "Khóa Robosim Master 16 buổi, chỉ tính học phí 11 buổi, cho lớp 3-8. Làm chủ phần mềm Robosim bắt buộc trong cuộc thi Sáng tạo Robotics 2026. Ưu đãi học phí — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 3-8",
    audienceDescription:
      "Dành cho học sinh chuẩn bị tham gia vòng loại Sáng tạo Robotics 2026 — cần làm quen phần mềm Robosim, đọc sa bàn và tối ưu chiến thuật.",
    mission:
      "Robosim là phần mềm BẮT BUỘC trong cuộc thi Sáng tạo Robotics 2026 do Thành Đoàn Đà Nẵng tổ chức. Sata Robo là đơn vị duy nhất tại Đà Nẵng đào tạo bài bản phần mềm này. Khoá học gồm 16 buổi — 5 buổi luyện đề tặng kèm + 11 buổi tính học phí, con được luyện trực tiếp trên các sa bàn đề thi vòng loại, rèn tư duy thuật toán cùng kỹ năng tối ưu chiến thuật bài thi.",
    outcomes: [
      "Làm chủ phần mềm Robosim — công cụ bắt buộc trong cuộc thi 2026",
      "Đọc và phân tích sa bàn thành thạo",
      "Xây dựng chiến thuật bài thi tối ưu trong thời gian ngắn",
      "Sẵn sàng vượt vòng loại Khu vực Miền Trung tháng 9/2026",
    ],
    highlights: [
      "11 buổi tính phí × 90 phút = 16,5 giờ luyện thi tập trung",
      "16 buổi học, chỉ tính học phí 11 buổi — tặng kèm 5 buổi luyện đề",
      "Học trên đề thi vòng loại thực tế của cuộc thi 2026",
      "Lớp tối đa 12 học sinh — thầy cô theo sát từng em",
    ],
    noteForParents:
      "Khóa này nên kết hợp với Sata2 (Đấu trường Robot) để có lộ trình luyện thi đầy đủ. Xem Combo Sata1+Sata2 tiết kiệm 15%.",
  },

  sata2: {
    slug: "sata2",
    metaTitle:
      "Sata2 — Đấu trường Robot | Luyện robot Beta cấp khu vực | Sata Robo",
    metaDescription:
      "Khóa Đấu trường Robot 16 buổi cho lớp 3-8. Chuyển từ mô phỏng Robosim sang vận hành robot Beta thật. Đang có ưu đãi học phí — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 3-8",
    audienceDescription:
      "Dành cho học sinh đã có nền tảng Robosim, sẵn sàng chuyển từ mô phỏng sang vận hành robot thật cho cấp khu vực và toàn quốc.",
    mission:
      "Bước chuyển quan trọng nhất trong hành trình thi đấu Robotics: từ phần mềm Robosim sang robot Beta vật lý. 16 buổi tập trung vào kỹ năng vận hành thực tế — xử lý sai số, áp lực thời gian, và sự khác biệt giữa mô phỏng và thực địa. Đây là khóa quyết định khả năng thi đấu cấp khu vực và toàn quốc của con.",
    outcomes: [
      "Vận hành thành thạo robot Beta — thiết bị thi đấu chính thức",
      "Xử lý sai số giữa mô phỏng và thực tế",
      "Có khả năng debug và sửa lỗi robot độc lập",
      "Thi đấu cấp khu vực và toàn quốc với tâm thế chủ động",
    ],
    highlights: [
      "16 buổi × 90 phút = 24 giờ thực hành với robot thật",
      "Luyện trên sa bàn chuẩn cuộc thi",
      "Kỹ thuật xử lý áp lực thi đấu thời gian thực",
      "Lớp ≤12 học sinh — mỗi em có thời gian thực hành đủ",
    ],
    noteForParents:
      "Nên kết hợp với Sata1 (Robosim Master) để có lộ trình hoàn chỉnh. Xem Combo Sata1+Sata2 tiết kiệm 15%.",
  },

  "combo-sata1-sata2": {
    slug: "combo-sata1-sata2",
    metaTitle:
      "Combo Sata1+Sata2 — Full Lộ Trình Luyện Thi Robotics 2026 | Sata Robo",
    metaDescription:
      "Trọn bộ 27 buổi tính phí (11 Sata1 + 16 Sata2): Robosim Master + Đấu trường Robot. Lộ trình bài bản từ vòng loại đến chung kết. Ưu đãi học phí trọn lộ trình — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 3-8",
    audienceDescription:
      "Combo đề xuất cho phụ huynh muốn con có lộ trình LUYỆN THI HOÀN CHỈNH — từ phần mềm Robosim đến vận hành robot Beta thật.",
    mission:
      "Combo Sata1+Sata2 là lộ trình tiết kiệm và bài bản nhất cho học viên có mục tiêu thi đấu nghiêm túc. 27 buổi tính phí liên thông (11 buổi Robosim + 16 buổi robot Beta) từ kỹ năng cơ bản đến vận hành robot Beta cấp khu vực.",
    outcomes: [
      "Hoàn thiện cả 2 kỹ năng: Robosim mô phỏng + Robot Beta thực chiến",
      "Sẵn sàng cho vòng loại Đà Nẵng và chung kết Khu vực Miền Trung",
      "Lộ trình liên tục — không bị gián đoạn giữa 2 giai đoạn học",
      "Học trọn lộ trình với chi phí ưu đãi hơn học riêng từng khoá",
    ],
    highlights: [
      "Tổng 27 buổi tính phí × 90 phút = 40,5 giờ luyện thi",
      "Chi phí mỗi buổi tối ưu hơn so với học riêng từng khoá",
      "Combo đề xuất — đa số phụ huynh chọn lộ trình này",
      "Cùng lớp, cùng giáo viên xuyên suốt 27 buổi tính phí",
    ],
    noteForParents:
      "Đây là gói TỐT NHẤT cho học sinh nghiêm túc luyện thi 2026. Nếu muốn cam kết vượt vòng loại 100%, bổ sung thêm Sata8 (Vé Vàng) để được hoàn tiền nếu không đậu.",
  },

  sata3: {
    slug: "sata3",
    metaTitle:
      "Sata3 — Ươm Mầm Tài Năng | Khóa Robotics Lớp 1-2 | Sata Robo",
    metaDescription:
      "Khóa Robotics 48 buổi cho lớp 1-2. Giai đoạn vàng phát triển tư duy. Ưu đãi học phí, hỗ trợ trả góp theo tháng — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 1-2",
    audienceDescription:
      "Giai đoạn vàng trong phát triển tư duy của trẻ. Khóa học giúp con tiếp xúc Robotics đúng cách ngay từ những năm đầu tiểu học.",
    mission:
      "Giai đoạn vàng trong phát triển tư duy của trẻ lớp 1–2. Não bộ tiếp thu nhanh nhất, hứng thú khám phá mạnh nhất. Mỗi buổi con xây dựng một thứ gì đó từ đầu, lập trình cho nó hoạt động và thấy kết quả ngay lập tức.",
    outcomes: [
      "Con yêu thích công nghệ từ nền tảng sâu nhất",
      "Phát triển tư duy logic, quan sát và sáng tạo",
      "Tự tin thuyết trình dự án mini trước phụ huynh sau mỗi học phần",
      "Hình thành thói quen học tập tích cực với công nghệ",
    ],
    highlights: [
      "48 buổi chia 4 học phần × 12 buổi",
      "Thiết bị Alpha A+C với cảm biến siêu âm — an toàn cho trẻ nhỏ",
      "Thuyết trình dự án cuối mỗi học phần — minh bạch với phụ huynh",
      "Hỗ trợ trả góp 0% theo tháng",
    ],
  },

  sata4: {
    slug: "sata4",
    metaTitle:
      "Sata4 — Bứt Phá Giới Hạn | Khóa Robotics Lớp 3-4 | Sata Robo",
    metaDescription:
      "Khóa Robotics 48 buổi cho lớp 3-4 hoặc luyện thi Robotics. Kết hợp Robosim + robot thật. Ưu đãi học phí, hỗ trợ trả góp theo tháng — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 3-4",
    audienceDescription:
      "Giai đoạn hình thành tư duy hệ thống. Kết hợp Robosim và robot thật, con hiểu nguyên lý: mỗi lệnh lập trình đều có hệ quả thực tế có thể quan sát và đo lường.",
    mission:
      "Lớp 3–5 là giai đoạn hình thành tư duy hệ thống. Kết hợp Robosim và robot thật, con hiểu nguyên lý: mỗi lệnh lập trình đều có hệ quả thực tế có thể quan sát và đo lường. Đây là khóa nền tảng cho hành trình thi đấu Robotics lâu dài.",
    outcomes: [
      "Làm chủ cả lập trình Robosim lẫn điều khiển robot thật",
      "Tư duy thuật toán rõ ràng, biết phân tích và sửa lỗi độc lập",
      "Kỹ năng thuyết trình được hình thành rõ nét",
      "Sẵn sàng tham gia cuộc thi cấp thành phố",
    ],
    highlights: [
      "48 buổi chia 4 học phần × 12 buổi",
      "Thiết bị: RoboSim + Beta Set + Saban thi đấu",
      "Phù hợp cho học sinh chuẩn bị thi Robotics",
      "Hỗ trợ trả góp 0% theo tháng",
    ],
  },

  sata5: {
    slug: "sata5",
    metaTitle:
      "Sata5 — Khơi Nguồn Sáng Tạo | Khóa Robotics Lớp 5 | Sata Robo",
    metaDescription:
      "Khóa Robotics 48 buổi cho lớp 5. Thiết bị Storm cao cấp. Con có portfolio dự án cá nhân. Ưu đãi học phí, hỗ trợ trả góp theo tháng — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 5",
    audienceDescription:
      "Giai đoạn sáng tạo thực sự với thiết bị Storm cao cấp. Con thiết kế và xây dựng giải pháp cho bài toán thực tế.",
    mission:
      "Thiết bị Storm cao cấp — cùng nguyên lý với thiết bị kỹ sư thực thụ — đưa con vào giai đoạn sáng tạo thực sự: thiết kế và xây dựng giải pháp cho bài toán thực tế. Mỗi học viên kết thúc với một portfolio dự án cá nhân.",
    outcomes: [
      "Con có portfolio dự án robot cá nhân thực sự",
      "Tư duy thiết kế và đề xuất giải pháp sáng tạo được rèn sâu",
      "Đủ điều kiện dự thi cấp tỉnh và quốc gia",
      "Phát triển tư duy kỹ sư từ sớm",
    ],
    highlights: [
      "48 buổi chia 4 học phần × 12 buổi",
      "Hệ thống chuyên gia Storm — chuẩn kỹ sư thực thụ",
      "Mỗi học viên có portfolio dự án cá nhân",
      "Hỗ trợ trả góp 0% theo tháng",
    ],
  },

  sata6: {
    slug: "sata6",
    metaTitle:
      "Sata6 — Chinh Phục Đấu Trường | Khóa Robotics Lớp 6-7 | Sata Robo",
    metaDescription:
      "Khóa Robotics 48 buổi cho lớp 6-7. Lộ trình hướng tới WRC. Thuật toán nâng cao + chiến lược thi đấu quốc tế. Ưu đãi học phí — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 6-7",
    audienceDescription:
      "Dành cho học sinh nghiêm túc muốn thi đấu thật và đạt thành tích thật. Lộ trình hướng tới World Robot Championship (WRC).",
    mission:
      "Khóa học của những học sinh nghiêm túc muốn thi đấu thật và đạt thành tích thật. Lộ trình hướng đến World Robot Championship (WRC): thuật toán nâng cao, chiến lược thi đấu quốc tế, phân tích đối thủ trong thời gian thực.",
    outcomes: [
      "Kỹ năng thi đấu tại cuộc thi cấp quốc gia",
      "Tư duy chiến lược, phân tích và thích nghi ở mức độ cao",
      "Sẵn sàng bước vào các thử thách lớn hơn (WRC)",
      "Khả năng đọc và phản ứng với đối thủ trong thời gian thực",
    ],
    highlights: [
      "48 buổi chia 4 học phần × 12 buổi",
      "Thiết bị: RoboSim + Beta Set + Saban Competition Standard",
      "Lộ trình hướng đến World Robot Championship",
      "Hỗ trợ trả góp 0% theo tháng",
    ],
  },

  sata7: {
    slug: "sata7",
    metaTitle:
      "Sata7 — Kiến Tạo Tương Lai | Khóa Robotics + AI Lớp 8 | Sata Robo",
    metaDescription:
      "Khóa Robotics 48 buổi cho lớp 8. Thiết bị Storm AI + Computer Vision. Portfolio dự án AI thực chiến. Ưu đãi học phí — liên hệ tư vấn.",
    audienceTag: "Học sinh Lớp 8",
    audienceDescription:
      "Bước cuối cùng trong hành trình Robotics tại Sata Robo. Học AI thực chiến với Computer Vision và robot tự hành.",
    mission:
      "Thiết bị Storm AI kết hợp cảm biến thực chiến — dạy con cách máy móc nhìn thấy, cảm nhận và quyết định. Con không chỉ học để thi — con học để hiểu ngôn ngữ nền tảng của tư duy công nghệ tương lai.",
    outcomes: [
      "Portfolio dự án AI thực chiến",
      "Hiểu nguyên lý AI, Computer Vision và robot tự hành ở mức thực hành",
      "Tư duy công nghệ được định hình vững chắc",
      "Sẵn sàng học chuyên sâu Robotics/AI ở bậc THPT",
    ],
    highlights: [
      "48 buổi chia 4 học phần × 12 buổi",
      "Thiết bị Storm + AI (Computer Vision Modules)",
      "Dự án AI thực chiến — không chỉ học lý thuyết",
      "Hỗ trợ trả góp 0% theo tháng",
    ],
  },

  sata8: {
    slug: "sata8",
    metaTitle:
      "Sata8 — Vé Vàng Chung Kết | Cam kết hoàn 100% nếu không vượt vòng loại | Sata Robo",
    metaDescription:
      "5 buổi chuyên binh luyện thi chung kết Khu vực Miền Trung. Cam kết HOÀN TIỀN 100% nếu không vượt vòng loại. Học phí: liên hệ tư vấn.",
    audienceTag: "Học sinh đã có nền tảng Robosim",
    audienceDescription:
      "Khóa CAM KẾT THÀNH TÍCH — dành cho học viên đã có nền tảng Robosim (Sata1) và muốn có một lớp bảo chứng cho mục tiêu vượt vòng loại.",
    mission:
      "Vé Vàng Chung Kết là khóa CAM KẾT THÀNH TÍCH duy nhất tại Đà Nẵng. 5 buổi chuyên binh luyện thi tập trung vào kỹ năng vượt vòng loại Cuộc thi Sáng tạo Robotics 2026 Khu vực Miền Trung. Nếu học viên hoàn thành đầy đủ cam kết chuyên cần mà KHÔNG VƯỢT VÒNG LOẠI → Sata Robo HOÀN 100% học phí. Có hợp đồng ký tên đóng dấu.",
    outcomes: [
      "Vượt vòng loại Cuộc thi Sáng tạo Robotics 2026 Khu vực Miền Trung",
      "Tham gia chung kết tại Nghệ An tháng 9/2026",
      "Có hợp đồng cam kết hoàn tiền — bảo chứng pháp lý",
      "Tự tin tâm lý trước kỳ thi quan trọng",
    ],
    highlights: [
      "5 buổi × 90 phút = 7,5 giờ luyện chung kết tập trung",
      "Giá cố định trọn gói — liên hệ tư vấn",
      "Cam kết HOÀN 100% nếu không vượt vòng loại",
      "Yêu cầu: đã hoàn thành Sata1 (Robosim Master)",
    ],
    noteForParents:
      "ĐIỀU KIỆN BẮT BUỘC: học viên phải có nền tảng Robosim (đã học Sata1 hoặc test đầu vào đạt yêu cầu) + tuân thủ đầy đủ cam kết chuyên cần trong 5 buổi.",
  },
};

// Helper: get detail by slug
export function getCourseDetail(slug: string): CourseDetail | null {
  return courseDetails[slug] ?? null;
}

// Helper: all valid slugs (cho generateStaticParams)
export const VALID_COURSE_SLUGS = Object.keys(courseDetails);
