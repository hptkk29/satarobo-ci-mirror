// =============================================
// LỘ TRÌNH ĐÀO TẠO 5 NĂM — SATA ROBO
// 5 năm × 4 học phần/năm × 12 buổi/học phần = 240 buổi
// =============================================

export interface ModuleSession {
  num: number;
  content: string;
  type: string;
}

export interface RoadmapModule {
  id: string;
  name: string;
  sessions: number;
  durationPerSession: string;
  hours: number;
  totalDuration: string;
  description: string;
  skills: string[];
  sessionList: ModuleSession[];
  achievement: string;
}

export interface RoadmapCourse {
  year: number;
  productCode: string;
  productName: string;
  name: string;
  academicName: string;
  grade: string;
  device: string;
  structure: string;
  color: string;
  description: string;
  mission: string;
  note: string;
  yearSkills: string[];
  modules: RoadmapModule[];
  totalSessions: number;
  durationPerSession: string;
  totalHours: number;
  totalDuration: string;
  tags: string[];
}

const durationFields = {
  totalSessions: 48,
  durationPerSession: "90 phút",
  totalHours: 72,
  totalDuration: "72 giờ",
};

const moduleTypes = (isFinalCourse = false): string[] => [
  "Dự án",
  "Dự án",
  "Dự án",
  "Dự án",
  "Ôn tập",
  "Dự án",
  "Dự án",
  "Dự án",
  "Dự án",
  isFinalCourse ? "Dự án cuối khóa" : "Dự án cuối học phần",
  isFinalCourse ? "Demo cuối khóa" : "Demo cuối học phần",
  isFinalCourse ? "Báo cáo cuối khóa" : "Báo cáo cuối học phần",
];

const makeModule = (
  id: string,
  name: string,
  lessons: string[],
  description: string,
  skills: string[],
  achievement: string,
  isFinalCourse = false,
): RoadmapModule => ({
  id,
  name,
  sessions: 12,
  durationPerSession: "90 phút",
  hours: 18,
  totalDuration: "18 giờ",
  description,
  skills,
  sessionList: lessons.map((content, index) => ({
    num: index + 1,
    content,
    type: moduleTypes(isFinalCourse)[index],
  })),
  achievement,
});

type CourseInput = Omit<
  RoadmapCourse,
  "totalSessions" | "durationPerSession" | "totalHours" | "totalDuration" | "tags"
> & { tags?: string[] };

const makeCourse = (course: CourseInput): RoadmapCourse => ({
  ...durationFields,
  ...course,
  tags: [...(course.tags ?? []), "48 buổi", "90 phút/buổi", "Tổng 72 giờ", "4 học phần"],
});

export const roadmap5Years: RoadmapCourse[] = [
  makeCourse({
    year: 1,
    productCode: "Sata3",
    productName: "Ươm Mầm Tài Năng",
    name: "Ươm Mầm Tài Năng",
    academicName: "Robotics Ươm Mầm Tài Năng",
    grade: "Lớp 1–2",
    device: "Hệ sinh thái Alpha A + C & Cảm biến siêu âm",
    structure: "4 học phần × 12 buổi",
    color: "primary-orange",
    description:
      "Robotics Ươm Mầm Tài Năng giúp học sinh lớp 1–2 làm quen với cơ khí, bản vẽ, lập trình thẻ screen-free và tư duy hệ thống thông qua các dự án robot trực quan.",
    mission:
      "Giai đoạn nền tảng giúp con phát triển vận động tinh, sự tò mò khoa học, tính kiên định và khả năng phân tích sự cố vật lý trong môi trường học tập an toàn, giàu thực hành.",
    note: "Phương pháp đào tạo: Chu kỳ 5E, Project-Based Learning, hands-on 80% thời lượng, học sinh đóng vai “Kỹ sư nhí”.",
    yearSkills: ["Tư duy hệ thống sơ đồ", "Cơ sở cơ giới hóa", "Logic lập trình thẻ screen-free", "Vận động tinh", "Phân tích bản vẽ", "Xử lý sự cố vật lý", "Tính kiên định", "Sự tò mò khoa học"],
    modules: [
      makeModule("HP1", "Học phần 1", ["Bàn Tay Ma Thuật", "Đấu Trường Con Quay", "Siêu Xe Bứt Phá", "Chiến Xa Tốc Độ", "Ôn tập kiến thức", "Vũ Công Robot", "Trở Về Tuổi Thơ", "Kỹ Sư Làm Mát", "Thủy Thủ Tài Ba", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con làm quen cơ cấu truyền động, lắp ráp theo sơ đồ và điều khiển mô hình Alpha đầu tiên.", ["Nhận biết linh kiện", "Đọc bản vẽ", "Lắp ráp cơ khí", "Trình bày mô hình"], "Con hoàn thành dự án robot cơ bản và trình bày được nguyên lý chuyển động."),
      makeModule("HP2", "Học phần 2", ["Chiến Binh Cua Biển", "Cỗ Máy Xúc Cát", "Họa Sĩ Robot", "Chinh Phục Đại Dương", "Ôn tập kiến thức", "Chiếc Hộp Giai Điệu", "Vận động viên đạp xe", "Công Viên Kỷ Jura", "Sinh Vật Đột Biến", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con mở rộng sang cơ cấu nhiều chân, nâng hạ, vẽ tự động và mô phỏng sinh vật.", ["Cơ cấu phức hợp", "Quan sát chuyển động", "Debug cơ khí", "Làm việc nhóm"], "Con biết phân tích lỗi vật lý và cải tiến mô hình sau thử nghiệm."),
      makeModule("HP3", "Học phần 3", ["Lực Sĩ Robot", "Hoạt Náo Viên Sôi Động", "Kình Ngư Vượt Sóng", "Đầu Bếp Tài Ba", "Ôn tập kiến thức", "Thần Long Trỗi Dậy", "Đấu Sĩ Dũng Mãnh", "Bước Nhảy Kỉ Lục", "Đường Đua Rực Lửa", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con phát triển tư duy kỹ thuật thông qua dự án có lực, nhịp chuyển động và cơ cấu đối kháng.", ["Ròng rọc", "Đòn bẩy", "Cơ cấu nhiều khớp", "Tối ưu chuyển động"], "Con tạo được mô hình có câu chuyện, có cơ chế rõ ràng và biết giải thích giải pháp."),
      makeModule("HP4", "Học phần 4", ["Siêu Xe Chuyên Dụng", "Trực Thăng Lốc Xoáy", "Kỹ Sư Cáp Treo", "Máy Bắn Đá", "Ôn tập kiến thức", "Chinh Phục Bầu Trời", "Xưởng Cơ Khí", "Cỗ Máy Thời Gian", "Chiến binh bọc thép", "Dự án cuối khóa", "Demo cuối khóa", "Báo cáo cuối khoá"], "Con tích hợp cơ khí, cảm biến siêu âm và lập trình thẻ để hoàn thiện dự án cuối năm.", ["Tích hợp cảm biến", "Truyền động góc", "Cáp treo", "Bảo vệ dự án"], "Con tốt nghiệp Năm 1 với một dự án Robotics vật lý hoàn chỉnh.", true),
    ],
  }),
  makeCourse({
    year: 2, productCode: "Sata4", productName: "Bứt Phá Giới Hạn", name: "Bứt Phá Giới Hạn",
    academicName: "Robotics Bứt Phá Giới Hạn", grade: "Lớp 3–4", device: "RoboSim + Beta Set + Saban",
    structure: "4 học phần × 12 buổi", color: "primary-purple",
    description: "Robotics Bứt Phá Giới Hạn giúp học sinh lớp 3–4 làm chủ RoboSim, chuyển đổi từ mô phỏng sang robot Beta thực tế và bắt đầu tư duy thi đấu.",
    mission: "Con học lập trình tự hành, rẽ nhánh, xử lý cảm biến, đồng bộ virtual-to-physical và rèn bản lĩnh qua mini-games tính điểm.",
    note: "Phương pháp đào tạo: Virtual-to-Physical, Competition Coaching, mini-games tính điểm, chuyển đổi từ mô phỏng RoboSim sang robot Beta thực tế.",
    yearSkills: ["Lập trình tự hành", "Cấu trúc rẽ nhánh phức hợp", "Xử lý dữ liệu cảm biến", "Làm chủ RoboSim", "Cấu trúc cơ khí thi đấu", "Kỹ năng đồng bộ V2P", "Tư duy gỡ lỗi", "Bản lĩnh đấu trường"],
    modules: [
      makeModule("HP1", "Học phần 1", ["Bước vào thế giới ảo", "Xe robot di chuyển", "Đèn tín hiệu giao thông", "Dừng tại vạch kẻ đường", "Ôn tập kiến thức", "Tránh chướng ngại vật", "Nhận diện màu sắc", "Cảm biến dò line", "Xe robot tự hành", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con làm quen RoboSim, cảm biến và các thuật toán điều khiển cơ bản.", ["RoboSim", "Cảm biến màu", "Dò line", "Robot tự hành"], "Con hoàn thành xe robot tự hành trong môi trường mô phỏng."),
      makeModule("HP2", "Học phần 2", ["Giới thiệu cuộc thi Robo", "Phân tích thể lệ thi đấu", "Thiết kế lắp ráp robot", "Lập trình nhiệm vụ 1", "Lập trình nhiệm vụ 2", "Lập trình nhiệm vụ 3", "Chạy tổng hợp nhiệm vụ", "Tối ưu chương trình", "Kiểm tra lắp ráp robot", "Kiểm tra lập trình", "Demo thi đấu", "Thi đấu nội bộ"], "Con phân tích thể lệ, thiết kế robot và luyện nhiệm vụ thi đấu.", ["Đọc luật thi", "Thiết kế robot", "Tối ưu chương trình", "Thi đấu nội bộ"], "Con có robot sẵn sàng chạy nhiệm vụ theo sa bàn."),
      makeModule("HP3", "Học phần 3", ["Robot xin chào", "Quạt mát", "Điều khiển từ xa", "Xe tuần tra", "Ôn tập kiến thức", "Đèn thông minh", "Dò line cơ bản", "Dò line nâng cao", "Dò line chuyên sâu", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con chuyển sang robot Beta thực tế, điều khiển từ xa và dò line nhiều cấp độ.", ["Robot Beta", "Điều khiển từ xa", "Dò line nâng cao", "Debug"], "Con vận hành được robot vật lý với nhiệm vụ dò line."),
      makeModule("HP4", "Học phần 4", ["Giới thiệu cuộc thi Robo", "Phân tích thể lệ thi đấu", "Thiết kế lắp ráp robot", "Lập trình nhiệm vụ 1", "Lập trình nhiệm vụ 2", "Lập trình nhiệm vụ 3", "Chạy tổng hợp nhiệm vụ", "Tối ưu chương trình", "Kiểm tra lắp ráp robot", "Kiểm tra lập trình", "Demo thi đấu", "Thi đấu nội bộ"], "Con tổng duyệt chu kỳ thi đấu từ phân tích luật đến demo nội bộ.", ["Chiến thuật", "Tối ưu hành trình", "Kiểm tra robot", "Bản lĩnh sân đấu"], "Con hoàn thành bài thi nội bộ với quy trình kỹ thuật rõ ràng.", true),
    ],
  }),
  makeCourse({
    year: 3, productCode: "Sata5", productName: "Khơi Nguồn Sáng Tạo", name: "Khơi Nguồn Sáng Tạo",
    academicName: "Robotics Khơi Nguồn Sáng Tạo", grade: "Lớp 5", device: "Hệ sinh thái Storm",
    structure: "4 học phần × 12 buổi", color: "primary-orange",
    description: "Robotics Khơi Nguồn Sáng Tạo đưa học sinh lớp 5 vào cơ khí động lực học, truyền động, smart-home và mô hình hóa giải pháp thực tiễn.",
    mission: "Con học theo quy trình thiết kế kỹ thuật, kiểm thử, cải tiến sản phẩm và phát triển tư duy thiết kế bền vững.",
    note: "Phương pháp đào tạo: Engineering Design Process, học tập dựa trên dự án Smart-Logistics, kiểm thử và cải tiến sản phẩm.",
    yearSkills: ["Cơ khí động lực học", "Làm chủ cơ cấu truyền động", "Vật lý kỹ thuật", "Tự động hóa và smart-home", "Tích hợp đa hệ thống", "Giao tiếp tín hiệu", "Mô hình hóa thực tiễn", "Tư duy thiết kế bền vững"],
    modules: [
      makeModule("HP1", "Học phần 1", ["Máy đập bóng cơ", "Xích đu dao động", "Máy chạy bộ cơ", "Cỗ máy chống đẩy", "Ôn tập kiến thức", "Xe đạp quán tính", "Chiếc xe ba bánh", "Cánh tay kẹp vật", "Cỗ máy vung rìu", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con khám phá cơ khí động lực học qua các mô hình chuyển động.", ["Dao động", "Quán tính", "Tay kẹp", "Cơ cấu lực"], "Con thiết kế được mô hình cơ khí có chuyển động ổn định."),
      makeModule("HP2", "Học phần 2", ["Máy ném bóng xa", "Xe đo khoảng cách", "Trạm lưu trữ điện", "Siêu xe đua F1", "Ôn tập kiến thức", "Hệ thống giảm xóc", "Cỗ máy bốn chân", "Cổng quét an ninh", "Máy truyền điện báo", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con làm việc với đo lường, năng lượng, giảm xóc và hệ thống tín hiệu.", ["Đo khoảng cách", "Lưu trữ điện", "Giảm xóc", "Tín hiệu"], "Con biết kiểm thử và cải tiến mô hình theo dữ liệu quan sát."),
      makeModule("HP3", "Học phần 3", ["Bọ cạp phản xạ", "Siêu xe điện đụng", "Xe nhận lệnh âm", "Ốc sên nghe lệnh", "Ôn tập kiến thức", "Cửa nhà thông minh", "Máy phát nhạc số", "Rèm cửa tự động", "Xe bám mục tiêu", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con tích hợp cảm biến, tín hiệu âm thanh và tự động hóa smart-home.", ["Phản xạ cảm biến", "Âm thanh", "Smart-home", "Bám mục tiêu"], "Con hoàn thiện một mô hình tự động hóa thông minh."),
      makeModule("HP4", "Học phần 4", ["Xe tránh chướng ngại", "Trạm radar", "Đấu sĩ bò tót", "Máy đọc thẻ từ", "Ôn tập kiến thức", "Bọ tìm ánh sáng", "Xe bám quỹ đạo", "Hướng dương tìm sáng", "Hệ thống phân loại", "Dự án cuối khóa", "Demo cuối khóa", "Báo cáo cuối khoá"], "Con xây dựng giải pháp tự hành, radar, nhận diện và phân loại.", ["Tránh vật cản", "Radar", "RFID", "Phân loại"], "Con bảo vệ dự án cuối khóa theo tư duy thiết kế kỹ thuật.", true),
    ],
  }),
  makeCourse({
    year: 4, productCode: "Sata6", productName: "Chinh Phục Đấu Trường", name: "Chinh Phục Đấu Trường",
    academicName: "Robotics Chinh Phục Đấu Trường", grade: "Lớp 6–7", device: "RoboSim + Beta Set + Saban Competition Standard",
    structure: "4 học phần × 12 buổi", color: "primary-purple",
    description: "Robotics Chinh Phục Đấu Trường huấn luyện học sinh lớp 6–7 về thuật toán PID, tối ưu hành trình, cơ khí đối kháng và xử lý áp lực thi đấu.",
    mission: "Con học theo mô hình huấn luyện đấu trường, chế tạo nhanh, thử nghiệm sớm, sửa lỗi tức thì và phân tích dữ liệu hiệu suất.",
    note: "Phương pháp đào tạo: Mô hình Huấn luyện Đấu trường, Agile chế tạo nhanh - thử nghiệm sớm - sửa chữa tức thì, phân tích video và dữ liệu hiệu suất.",
    yearSkills: ["Thuật toán PID", "Kiểm soát sai số cảm biến", "Xử lý đa luồng", "Tối ưu hóa hành trình", "Thiết kế cơ khí đối kháng", "Gỡ lỗi áp lực", "Tư duy chuyên gia", "Bản lĩnh thi đấu"],
    modules: [
      makeModule("HP1", "Học phần 1", ["Bước vào thế giới ảo", "Đèn tín hiệu giao thông", "Đèn thông minh", "Lựa chọn ngẫu nhiên", "Ôn tập kiến thức", "Xe robot di chuyển", "Truyền động bánh răng", "Cảm biến dò line", "Xe robot tự hành", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con củng cố nền tảng RoboSim, cảm biến, truyền động và tự hành.", ["RoboSim", "Bánh răng", "Dò line", "Tự hành"], "Con hoàn thành robot tự hành có khả năng phản ứng theo cảm biến."),
      makeModule("HP2", "Học phần 2", ["Giới thiệu cuộc thi Robo", "Phân tích thể lệ thi đấu", "Thiết kế lắp ráp robot", "Lập trình nhiệm vụ 1", "Lập trình nhiệm vụ 2", "Lập trình nhiệm vụ 3", "Chạy tổng hợp nhiệm vụ", "Tối ưu chương trình", "Kiểm tra lắp ráp robot", "Kiểm tra lập trình", "Demo thi đấu", "Thi đấu nội bộ"], "Con luyện chu kỳ thi đấu chuẩn với nhiệm vụ tích hợp và tối ưu chương trình.", ["Phân tích luật", "Lập trình nhiệm vụ", "Tối ưu", "Demo thi đấu"], "Con chạy được bài thi tổng hợp trong điều kiện nội bộ."),
      makeModule("HP3", "Học phần 3", ["Robot xin chào", "Động cơ xích đu", "Còi báo động nguy hiểm", "Đèn thông minh", "Ôn tập kiến thức", "Máy phát nhạc", "Dò line cơ bản", "Dò line nâng cao", "Dò line chuyên sâu (PID)", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con học điều khiển nâng cao, cảnh báo, nhạc và dò line chuyên sâu bằng PID.", ["PID", "Cảnh báo", "Điều khiển nâng cao", "Gỡ lỗi"], "Con hiểu cách giảm sai số và ổn định hành trình robot."),
      makeModule("HP4", "Học phần 4", ["Giới thiệu cuộc thi Robo", "Phân tích thể lệ thi đấu", "Thiết kế lắp ráp robot", "Lập trình nhiệm vụ 1", "Lập trình nhiệm vụ 2", "Lập trình nhiệm vụ 3", "Chạy tổng hợp nhiệm vụ", "Tối ưu chương trình", "Kiểm tra lắp ráp robot", "Kiểm tra lập trình", "Demo thi đấu", "Thi đấu nội bộ"], "Con tổng duyệt thi đấu với áp lực thời gian, lỗi thực chiến và chiến thuật dự phòng.", ["Áp lực thi đấu", "Backup plan", "Video review", "Tối ưu hành trình"], "Con sẵn sàng tham gia các vòng thi Robotics với bản lĩnh kỹ thuật.", true),
    ],
  }),
  makeCourse({
    year: 5, productCode: "Sata7", productName: "Chắp Cánh Tương Lai", name: "Chắp Cánh Tương Lai",
    academicName: "Robotics Chắp Cánh Tương Lai", grade: "Lớp 8", device: "Storm + AI (Computer Vision Modules)",
    structure: "4 học phần × 12 buổi", color: "primary-orange",
    description: "Robotics Chắp Cánh Tương Lai, tập trung vào AI, thị giác máy tính, logistics, AGV và capstone project.",
    mission: "Con đi qua quy trình AI đầy đủ: thu thập dữ liệu, training, triển khai, tinh chỉnh và bảo vệ giải pháp công nghệ trước hội đồng chuyên môn.",
    note: "Phương pháp đào tạo: AI Workflow, Thu thập dữ liệu → Training → Triển khai → Tinh chỉnh, Capstone Project, bảo vệ giải pháp công nghệ trước hội đồng chuyên môn.",
    yearSkills: ["Trí tuệ nhân tạo", "Thị giác máy tính", "Nhận diện thông minh", "Học máy cơ bản", "Object Tracking", "Logistics & AGV", "Giải pháp đô thị 4.0", "Capstone Project"],
    modules: [
      makeModule("HP1", "Học phần 1", ["Đèn giao thông số", "Máy cưa tự động", "Robot hút bụi", "Cối xay gió xoay", "Ôn tập kiến thức", "Hệ thống đỗ xe", "Nhận diện giảm tốc", "Tự hành góc vuông", "Xe cảnh sát tuần", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con làm việc với tự động hóa đô thị, đỗ xe, nhận diện và tự hành cơ bản.", ["Đô thị thông minh", "Tự động hóa", "Nhận diện", "Tự hành"], "Con hoàn thành mô hình đô thị thông minh có robot tự hành."),
      makeModule("HP2", "Học phần 2", ["Máy bay chiến đấu", "Hệ thống đóng gói", "Phân loại sản phẩm", "Xe nâng hàng hóa", "Ôn tập kiến thức", "Tự hành chở hàng", "Tàu chở hàng hóa", "Máy bán hàng số", "Siêu thị thông minh", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con mô phỏng logistics, AGV, phân loại sản phẩm và vận hành hệ thống bán hàng.", ["Logistics", "AGV", "Phân loại", "Siêu thị thông minh"], "Con tạo được chuỗi vận hành logistics tự động ở quy mô mô hình."),
      makeModule("HP3", "Học phần 3", ["Bám line kép chuẩn", "Hiệu chuẩn dữ liệu", "Căn chỉnh góc xoay", "Định vị khoảng cách", "Ôn tập kiến thức", "Kiểm soát gia tốc", "Chống trôi quỹ đạo", "Tự hành đường thẳng", "Chống kẹt động cơ", "Dự án cuối học phần", "Demo cuối học phần", "Báo cáo cuối học phần"], "Con tối ưu thuật toán tự hành qua hiệu chuẩn dữ liệu, định vị và kiểm soát gia tốc.", ["Hiệu chuẩn", "Định vị", "Kiểm soát gia tốc", "Chống trôi"], "Con biết tinh chỉnh robot để chạy ổn định trong điều kiện sai số thực tế."),
      makeModule("HP4", "Học phần 4", ["AI ra lệnh robot", "AI nhận diện màu", "AI robot tự hành", "AI cử chỉ tay", "Ôn tập kiến thức", "AI đọc biển báo", "AI quét mã QR", "AI nhận diện mặt", "AI nhận diện bóng", "Dự án cuối khoá", "Demo cuối khoá", "Báo cáo cuối khoá"], "Con triển khai AI thị giác máy tính vào robot và bảo vệ capstone cuối khóa.", ["Computer Vision", "QR", "Face detection", "Object tracking"], "Con bảo vệ dự án AI Robotics trước hội đồng chuyên môn.", true),
    ],
  }),
];
