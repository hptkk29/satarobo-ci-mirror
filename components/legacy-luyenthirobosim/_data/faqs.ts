export interface FAQ {
  question: string;
  answer: string;
}

const faqs: FAQ[] = [
  {
    question: "Khoá học có cần con biết lập trình từ trước không?",
    answer: `Không cần. Khoá Luyện Thi RoboSim được thiết kế để con xem video là làm theo được — kể cả con chưa từng học Robotics.

Mỗi buổi đều có hướng dẫn từng bước rõ ràng, và con luôn có thể đặt câu hỏi cho giảng viên nếu vướng mắc.`,
  },
  {
    question: "Con mình học lớp 5 — nên chọn Bảng R1 hay R2?",
    answer: `Bảng R1 dành cho con học cấp Tiểu học (lớp 3–5).
Bảng R2 dành cho con học cấp THCS (lớp 6–9).
Lớp 5 → chọn R1 (theo bảng đề thi vòng loại RBT2026).

Nếu vẫn phân vân, bố mẹ inbox Zalo Sata Robo — gửi tên lớp con đang học, mình tư vấn trong 10 phút.`,
  },
  {
    question: "Lỡ chọn nhầm bảng thì sao?",
    answer: `Sata Robo hỗ trợ ĐỔI bảng MIỄN PHÍ trong vòng 7 ngày sau khi đăng ký.

Bố mẹ chỉ cần inbox Zalo, mình sẽ hỗ trợ xử lý trong ngày.`,
  },
  {
    question: "Học khoá này con có cần mua robot thật không?",
    answer: `Hoàn toàn không cần. Khoá Luyện Thi sử dụng phần mềm RoboSim — sa bàn ảo mô phỏng 100% đề thi vòng loại RBT2026.

Con chỉ cần laptop có cài RoboSim (mình hướng dẫn cài đặt trong buổi 1).

Bố mẹ tiết kiệm 5–10 triệu mua robot thật — mà con vẫn luyện đúng đề thi đến khi quen tay.`,
  },
  {
    question: "Sau khi đăng ký, con học theo lịch nào?",
    answer: `Khoá Luyện Thi 100% là VIDEO — không có lịch cố định. Con học theo lịch của riêng mình:

• Mỗi buổi 30 phút (15 phút video + 15 phút thực hành)
• Học khi nào rảnh, dừng lại xem lại bao nhiêu lần tuỳ ý
• Truy cập RoboSim không giới hạn cho đến khi vòng loại RBT2026 kết thúc

Khuyến nghị: học 2–3 buổi/tuần để hoàn thành 18 buổi trước ngày thi.`,
  },
];

export default faqs;
