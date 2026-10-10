export interface Testimonial {
  id: number;
  name: string;
  role: string;
  location: string;
  rating: number;
  avatar: string;
  avatarColor: string;
  content: string;
}

export const testimonials: Testimonial[] = [
  {
    id: 1, name: "Anh Ngọc Anh", role: "Phụ huynh bạn Duy Tùng", location: "Đà Nẵng",
    rating: 5, avatar: "NA", avatarColor: "from-orange-400 to-orange-600",
    content: "Con học 3 tuần, từ chỗ không biết bắt đầu từ đâu đến khi thi thử đạt 85% điểm. Điều tôi thích nhất là AI chấm bài ngay — tôi biết chắc con hiểu bài trước khi học tiếp, khác hoàn toàn so với xem YouTube.",
  },
  {
    id: 2, name: "Anh Trường Sơn", role: "Phụ huynh bạn Minh Châu", location: "Đà Nẵng",
    rating: 5, avatar: "TS", avatarColor: "from-purple-400 to-purple-600",
    content: "Ban đầu lo con học Robotics sẽ khó theo. Nhưng sau vài buổi con đã hiểu cách robot nhận lệnh, biết sửa lỗi từng bước và hào hứng kể lại sản phẩm sau mỗi buổi học.",
  },
  {
    id: 3, name: "Chị Mỹ Trang", role: "Phụ huynh bạn Gia Hân", location: "Đà Nẵng",
    rating: 5, avatar: "MT", avatarColor: "from-pink-400 to-pink-600",
    content: "Con thi Robotics năm ngoái không vào được vòng chung kết vì không có chiến lược. Năm nay học khóa này, con tự làm được bài tập và hiểu rõ cách sắp xếp thứ tự nhiệm vụ. Tự tin hơn hẳn khi bước vào phòng thi!",
  },
  {
    id: 4, name: "Bé Gia Huy", role: "Học sinh lớp 4", location: "Đà Nẵng",
    rating: 5, avatar: "GH", avatarColor: "from-blue-400 to-blue-600",
    content: "Con tưởng lập trình khó lắm, ai ngờ con làm được thật. Con thích nhất phần robot chạy sa hình — mỗi lần robot vượt qua thử thách là con thấy tự hào lắm.",
  },
  {
    id: 5, name: "Anh Minh Tuấn", role: "Phụ huynh", location: "Đà Nẵng",
    rating: 5, avatar: "MT", avatarColor: "from-teal-400 to-teal-600",
    content: "Điều mình ấn tượng là con tập trung suốt 90 phút. Khi robot chạy được, con tự hào lắm. Mình thấy rõ giá trị của Robotics — con không còn chỉ chơi game mà bắt đầu sáng tạo.",
  },
  {
    id: 6, name: "Chị Lan", role: "Phụ huynh", location: "Đà Nẵng",
    rating: 5, avatar: "CL", avatarColor: "from-rose-400 to-rose-600",
    content: "Con mình trước giờ chỉ thích game. Sau buổi học Trial, con nói muốn tự tạo game và robot. Mình thấy chương trình rất thực tế — không lý thuyết suông như nhiều nơi khác.",
  },
];
