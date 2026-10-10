export interface Commitment {
  id: number;
  icon: string;
  title: string;
  description: string;
}

export const commitments: Commitment[] = [
  { id: 1, icon: "ShieldCheck", title: "Hoàn tiền 100% nếu không hài lòng", description: "Buổi học đầu tiên 90 phút, nếu con không thích sẽ hoàn tiền 100% học phí đã đóng, không câu hỏi. Hoàn lại sau 3 ngày làm việc." },
  { id: 2, icon: "Users", title: "Lớp nhỏ tối đa 12 học viên", description: "Giáo viên biết tên và điểm mạnh từng con. Con không bị bỏ lại phía sau. Chất lượng giảng dạy được đảm bảo." },
  { id: 3, icon: "Plane", title: "Giải thưởng du lịch 3-7 triệu", description: "Học viên đạt giải ≥ Giải Ba cấp TP Đà Nẵng được thưởng chuyến du lịch 3-7 triệu, trao tại Lễ Khai trương tháng 8/2026." },
  { id: 4, icon: "Presentation", title: "Thuyết trình cuối mỗi học phần", description: "Cuối mỗi 12 buổi, học viên có 1 buổi thuyết trình trước phụ huynh, ghi hình kỷ niệm. Phụ huynh thấy kết quả thực tế." },
  { id: 5, icon: "BadgeDollarSign", title: "Hỗ trợ lệ phí thi Quốc gia 3 triệu", description: "Học viên hoàn thành khóa học và tham gia cuộc thi cấp Quốc gia được hỗ trợ 3.000.000đ/học viên/năm theo chính sách." },
  { id: 6, icon: "FileText", title: "Cam kết văn bản cho gói Sata8", description: "Quyền lợi hoàn tiền của phụ huynh được ghi rõ bằng văn bản trước khi đăng ký gói Sata8." },
];
