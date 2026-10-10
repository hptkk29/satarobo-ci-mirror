const examDuration = { durationPerSession: "90 phút" };

const contestLessons = [
  "Giới thiệu cuộc thi Sáng tạo Robotics năm 2026",
  "Dự án xe robot di chuyển",
  "Tìm hiểu cảm biến dò line",
  "Dự án xe robot tự hành",
  "Phân tích thể lệ thi đấu",
  "Thiết kế lắp ráp robot thi đấu",
  "Giải đề nhiệm vụ thi đấu lần 1",
  "Giải đề nhiệm vụ thi đấu lần 2",
  "Giải đề nhiệm vụ thi đấu lần 3",
  "Giải đề nhiệm vụ thi đấu lần 4",
  "Giải đề nhiệm vụ thi đấu lần 5",
  "Tổng hợp nhiệm vụ thi đấu",
  "Tối ưu chương trình lập trình",
  "Kiểm tra phần lắp ráp robot",
  "Kiểm tra phần lập trình nhiệm vụ",
  "Phổ biến quy chế thi, tổng kết",
];

export interface ExamRoadmapItem {
  id: string;
  displayName: string;
  groupName?: string;
  educationLevel?: string;
  grade: string;
  sessions: number;
  totalDuration: string;
  device: string;
  format?: string;
  description: string;
  goal?: string;
  outcomes?: string[];
  methods?: string[];
  lessons?: string[];
  highlights?: string[];
  durationPerSession: string;
}

export const examRoadmap: ExamRoadmapItem[] = [
  {
    id: "Sata1",
    displayName: "Robosim Master",
    groupName: "Khóa luyện thi",
    educationLevel: "Tiểu học, Trung học cơ sở",
    grade: "Lớp 3-8",
    sessions: 16,
    totalDuration: "24 giờ",
    device: "RoboSim phần mềm",
    format: "Trực tiếp, kết hợp E-learning",
    description:
      "Dành cho học sinh cần luyện thi vòng loại, làm quen phần mềm RoboSim, đọc sa bàn và tối ưu chiến thuật bài thi. Khoá 16 buổi, chỉ tính học phí 11 buổi — 5 buổi luyện đề đầu khoá được tặng kèm.",
    goal:
      "Bồi dưỡng nền tảng lập trình và lắp ráp Robotics, phát triển tư duy thuật toán, năng lực giải quyết vấn đề và sáng tạo.",
    outcomes: [
      "Hiểu cấu tạo và nguyên lý hoạt động cơ bản của robot.",
      "Lập trình robot thực hiện nhiệm vụ di chuyển và xử lý cảm biến.",
      "Phân tích đề thi, lựa chọn giải pháp kỹ thuật và tối ưu chương trình.",
      "Trình bày được quy trình lắp ráp, lập trình và vận hành robot.",
    ],
    methods: ["Blended Learning", "Flipped Classroom", "Luyện tập theo nhiệm vụ bài thi", "Tự học có hướng dẫn và kiểm soát"],
    // Hiển thị trọn 16 buổi của lộ trình (5 buổi luyện đề tặng kèm, 11 buổi tính phí).
    lessons: contestLessons,
    ...examDuration,
  },
  {
    id: "Sata2",
    displayName: "Đấu trường Robot",
    groupName: "Khóa luyện thi",
    educationLevel: "Tiểu học, Trung học cơ sở",
    grade: "Lớp 3-8",
    sessions: 16,
    totalDuration: "24 giờ",
    device: "RoboSim + Robot Beta thật",
    format: "Trực tiếp, kết hợp E-learning",
    description:
      "Dành cho học sinh cần chuyển từ mô phỏng sang robot thật, luyện vận hành, xử lý sa bàn và áp lực thi đấu.",
    goal: "Bồi dưỡng kỹ năng lập trình, lắp ráp Robotics, năng lực phối hợp đội thi và bản lĩnh thi đấu.",
    outcomes: [
      "Hiểu chức năng hệ cơ khí, truyền động, cảm biến và bộ điều khiển robot.",
      "Lập trình robot xử lý nhiệm vụ thi đấu .",
      "Phân tích đề bài, thử nghiệm và tối ưu chương trình.",
      "Làm việc nhóm, phối hợp đội thi và trình bày giải pháp kỹ thuật.",
    ],
    methods: ["Blended Learning", "Flipped Classroom", "Luyện tập theo nhiệm vụ bài thi", "Tự học có hướng dẫn và kiểm soát"],
    lessons: contestLessons,
    ...examDuration,
  },
  {
    id: "Combo",
    displayName: "Full Lộ Trình Luyện Thi",
    grade: "Lớp 3-8",
    sessions: 32,
    totalDuration: "48 giờ",
    device: "RoboSim phần mềm + Robot Beta thật",
    description:
      "Gói Combo bao gồm 16 buổi Robosim Master + 16 buổi Đấu trường Robot. Phụ huynh chọn gói này khi muốn con đi trọn lộ trình luyện thi từ RoboSim đến robot Beta.",
    highlights: [
      "Bao gồm Robosim Master + Đấu trường Robot",
      "32 buổi - 90 phút/buổi - Tổng 48 giờ",
      "Học trọn lộ trình luyện thi với chi phí ưu đãi hơn so với học riêng từng khoá",
    ],
    ...examDuration,
  },
  {
    id: "Sata8",
    displayName: "Vé Vàng Chung Kết",
    grade: "Lớp 3-8",
    sessions: 5,
    totalDuration: "7,5 giờ",
    device: "RoboSim + Sa bàn thực chiến",
    description:
      "Gói Chiến binh cam kết hoàn tiền 100%, tập trung vào chiến thuật, thi thử, sửa lỗi cá nhân và tổng duyệt trước vòng loại. Đây là gói giá cố định, không áp dụng giảm giá.",
    lessons: [
      "Rà soát nền tảng RoboSim và chiến thuật vòng loại",
      "Sửa lỗi cá nhân theo năng lực từng học sinh",
      "Thi thử có phản hồi từ giáo viên",
      "Hoàn thành học liệu E-learning được giao",
      "Tổng duyệt trước vòng loại",
    ],
    ...examDuration,
  },
];
