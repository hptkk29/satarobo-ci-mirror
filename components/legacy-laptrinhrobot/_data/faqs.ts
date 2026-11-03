// Phase 4.UI.FIX.3 PART E — FAQ #4 UPDATED 4 cơ sở → 2 cơ sở (211 NHT + 114 HD)

export type FAQAnswerItem = string | { type: "list"; items: string[] };

export interface FAQ {
  id: number;
  question: string;
  answer: FAQAnswerItem[];
}

export const faqs: FAQ[] = [
  {
    id: 1,
    question: "Con chưa biết gì về Robotics - bắt đầu được không?",
    answer: [
      "Hoàn toàn được. Lộ trình Sata Robo được thiết kế để con bắt đầu từ nền tảng phù hợp với lớp hiện tại, không yêu cầu phải biết lập trình trước.",
      "Ở các buổi đầu, con làm quen bằng mô hình trực quan, trò chơi nhiệm vụ và hoạt động lắp ráp robot. Giáo viên sẽ hướng dẫn từng bước để con tự tin trước khi đi vào phần khó hơn.",
      {
        type: "list",
        items: [
          "Sata3 phù hợp cho học sinh lớp 1-2 mới bắt đầu.",
          "Sata4-Sata7 đi theo lộ trình chuyên sâu từng năm.",
          "Sata1-Sata2 dành cho học sinh cần luyện thi Robotics 2026.",
        ],
      },
    ],
  },
  {
    id: 2,
    question: "Học phí các khóa hiện tại như thế nào?",
    answer: [
      "Website hiện có 2 nhóm khóa: khóa luyện thi ngắn hạn và khóa chuyên sâu 48 buổi.",
      {
        type: "list",
        // Học phí NIÊM YẾT, đo từ /admin/courses ngày 21/09/2026. Trước đó mọi dòng đều
        // ghi "vui lòng liên hệ" — đúng khối mà hướng dẫn BCT chụp ảnh và yêu cầu xử lý
        // (mục 4: không công khai giá + không đặt hàng được).
        // ⚠️ Số ở đây phải khớp `Course.price` trên DB. Nguồn KHÔNG phải
        // `_data/courses-pricing.ts` — file đó đang lệch DB ở Sata1 và Combo.
        items: [
          "Sata1 Robosim Master: 2.400.000đ.",
          "Sata2 Đấu trường Robot: 3.040.000đ.",
          "Combo Sata1 + Sata2: 5.440.000đ (tiết kiệm so với mua lẻ).",
          "Sata8 Vé Vàng Chung Kết: 2.500.000đ — giá cố định, cam kết hoàn tiền 100%.",
          "Sata3–Sata7 (khóa chuyên sâu 48 buổi): từ 10.560.000đ đến 14.400.000đ tùy khối lớp, hỗ trợ trả góp 0%.",
        ],
      },
      "Giá đã bao gồm thuế GTGT. Phụ huynh để lại thông tin trong form đăng ký hoặc liên hệ Zalo để được tư vấn số buổi, thiết bị, thời lượng và chương trình ưu đãi đang áp dụng.",
    ],
  },
  {
    id: 3,
    question: "Lịch học như thế nào? Lớp học có đông không?",
    answer: [
      "Mỗi buổi học kéo dài 90 phút. Lịch học cụ thể được tư vấn theo cơ sở, lớp của con và khung giờ còn chỗ.",
      {
        type: "list",
        items: [
          "Sata1: 16 buổi/khóa, tổng 24 giờ (chỉ tính học phí 11 buổi, tặng kèm 5 buổi luyện đề).",
          "Sata2: 16 buổi/khóa, tổng 24 giờ.",
          "Combo Sata1 + Sata2: 32 buổi, tổng 48 giờ.",
          "Sata8: 5 buổi chuyên sâu, tổng 7,5 giờ.",
          "Sata3-Sata7: 48 buổi/năm, tổng 72 giờ.",
        ],
      },
      "Lớp học được giữ sĩ số nhỏ để giáo viên theo sát từng con, quan sát tiến độ và hỗ trợ khi con gặp khó.",
    ],
  },
  {
    id: 4,
    question: "Trung tâm có gần nhà mình không?",
    answer: [
      "Sata Robo có 2 cơ sở tại Đà Nẵng — phụ huynh chọn nơi thuận tiện nhất.",
      {
        type: "list",
        items: [
          "Cơ sở Nguyễn Hữu Thọ: 211 Nguyễn Hữu Thọ, Đà Nẵng.",
          "Cơ sở Hoàng Diệu: 114 Hoàng Diệu, Đà Nẵng (Hải Châu).",
        ],
      },
      "Nếu chưa chắc cơ sở nào phù hợp, phụ huynh có thể để lại địa chỉ khu vực trong form, tư vấn viên sẽ gợi ý cơ sở gần và thuận tiện nhất.",
    ],
  },
  {
    id: 5,
    question: "Nếu không hài lòng sau khi học, có hoàn tiền không?",
    answer: [
      "Có. Sata Robo có chính sách hoàn tiền 100% nếu phụ huynh không hài lòng sau buổi học đầu tiên.",
      {
        type: "list",
        items: [
          "Buổi học đầu tiên kéo dài 90 phút.",
          "Nếu con không phù hợp hoặc phụ huynh chưa hài lòng, trung tâm hoàn 100% học phí đã đóng.",
          "Thời gian hoàn tiền dự kiến trong 3 ngày làm việc.",
        ],
      },
      "Ngoài ra, mọi học viên mới đều được tặng 1 buổi học thử 1-1 miễn phí trước khi quyết định đăng ký.",
    ],
  },
  {
    id: 6,
    question: "Phụ huynh nhận được thông tin gì về quá trình học của con?",
    answer: [
      "Phụ huynh không phải chờ đến cuối khóa mới biết con học được gì. Giáo viên sẽ cập nhật quá trình học để bố mẹ nắm được tiến độ của con.",
      {
        type: "list",
        items: [
          "Nội dung con đã học trong từng giai đoạn.",
          "Điểm mạnh, điểm cần hỗ trợ thêm của con.",
          "Sản phẩm hoặc dự án con hoàn thành sau học phần.",
          "Demo Day cuối mỗi học phần để phụ huynh quan sát kết quả thực tế.",
        ],
      },
    ],
  },
  {
    id: 7,
    question: "Sata8 cam kết hoàn tiền như thế nào?",
    answer: [
      "Sata8 là gói Vé Vàng Chung Kết dành cho học sinh đã có nền tảng RoboSim và muốn tăng mức chuẩn bị trước vòng loại Robotics 2026.",
      "Cam kết hoàn tiền không phải lời hứa chung chung. Điều kiện, phạm vi và quyền lợi được tư vấn rõ trước khi phụ huynh đăng ký.",
      {
        type: "list",
        items: [
          "Áp dụng cho học viên đã đăng ký Combo hoặc Robosim Master.",
          "Con tham gia đủ 5/5 buổi chuyên sâu.",
          "Con hoàn thành học liệu E-learning được giao.",
          "Nếu đã đi đủ lộ trình nhưng không vượt vòng loại, Sata Robo hoàn 100% học phí gói Sata8 theo điều kiện cam kết.",
        ],
      },
    ],
  },
  {
    id: 8,
    question: "Muốn tư vấn thêm trước khi quyết định, liên hệ ở đâu?",
    answer: [
      "Phụ huynh có thể liên hệ Zalo hoặc gọi 0837.312.860 — một số duy nhất cho cả hai cơ sở — để được tư vấn nhanh về khóa học, lớp phù hợp, cơ sở gần nhà và lịch học còn chỗ.",
      "Nếu điền form trên website, Sata Robo sẽ gọi lại để xác nhận thông tin. Việc để lại thông tin không bắt buộc phụ huynh phải đăng ký ngay.",
    ],
  },
];
