export type ProductCategory = 'co-ban' | 'nang-cao' | 'phu-kien'
export type AgeFilter = '5-7' | '8-10' | '11+' | null

export interface Product {
  id: string
  slug: string
  name: string
  category: ProductCategory
  ageRange: string    // display label: "5-7 tuổi", "8+ tuổi", "Tất cả độ tuổi"...
  ageFilter: AgeFilter // filter bucket: null = "Tất cả"
  price: number       // VND
  image: string       // /images/products/<slug>.jpg
  description: string
  specs: string[]
}

export const PRODUCTS: Product[] = [
  {
    id: 'robot-co-ban-a1',
    slug: 'robot-co-ban-a1',
    name: 'Bộ Robot Cơ bản A1',
    category: 'co-ban',
    ageRange: '5-7 tuổi',
    ageFilter: '5-7',
    price: 1_200_000,
    image: '/images/products/robot-co-ban-a1.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ Robot Cơ bản A1 thiết kế dành riêng cho trẻ 5-7 tuổi — màu sắc bắt mắt, chi tiết lắp ráp lớn, an toàn và dễ sử dụng. Giúp trẻ làm quen với tư duy lắp ráp và lập trình kéo thả đơn giản.',
    specs: [
      '48 chi tiết lắp ráp an toàn, không sắc cạnh',
      'Tương thích mô-đun cảm biến ánh sáng & âm thanh',
      'Điều khiển qua ứng dụng Bluetooth (iOS & Android)',
      'Pin sạc USB, 2–3 giờ hoạt động',
      'Chứng nhận ROHS, không BPA',
    ],
  },
  {
    id: 'robot-trung-cap-b2',
    slug: 'robot-trung-cap-b2',
    name: 'Bộ Robot Trung cấp B2',
    category: 'co-ban',
    ageRange: '8-10 tuổi',
    ageFilter: '8-10',
    price: 2_500_000,
    image: '/images/products/robot-trung-cap-b2.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ Robot Trung cấp B2 dành cho học sinh 8-10 tuổi đã có nền tảng cơ bản. Hỗ trợ lập trình Scratch và block-based, phù hợp cho chương trình Lập trình Robot Sata Robo cấp độ 2-3.',
    specs: [
      '120 chi tiết lắp ráp đa dạng',
      'Vi điều khiển tích hợp sẵn',
      'Lập trình bằng Scratch, Python cơ bản',
      'Cảm biến: ánh sáng, siêu âm, màu sắc',
      'Pin sạc Type-C, 3-4 giờ hoạt động',
    ],
  },
  {
    id: 'robot-nang-cao-c3',
    slug: 'robot-nang-cao-c3',
    name: 'Bộ Robot Nâng cao C3',
    category: 'nang-cao',
    ageRange: '11+ tuổi',
    ageFilter: '11+',
    price: 4_500_000,
    image: '/images/products/robot-nang-cao-c3.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ Robot Nâng cao C3 dành cho học sinh THCS, hỗ trợ lập trình Python, C++ và ROS cơ bản. Đây là bộ học cụ chuẩn cho học viên Lập trình Robot cấp độ 4-5 và chuẩn bị thi đấu cấp tỉnh/quốc gia.',
    specs: [
      '200+ chi tiết lắp ráp chuyên nghiệp',
      'Vi điều khiển ARM Cortex-M4',
      'Lập trình Python, C++, ROS cơ bản',
      'Cảm biến: IMU, encoder, camera tích hợp',
      'Kết nối Wi-Fi & Bluetooth',
      'Pin LiPo 4000mAh, sạc nhanh',
    ],
  },
  {
    id: 'robot-dua-roborace',
    slug: 'robot-dua-roborace',
    name: 'Bộ Robot Đua RoboRace',
    category: 'nang-cao',
    ageRange: '8+ tuổi',
    ageFilter: '8-10',
    price: 3_800_000,
    image: '/images/products/robot-dua-roborace.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ Robot Đua RoboRace chuyên dùng cho thi đấu theo đường line và né vật cản. Thiết kế tối ưu tốc độ và độ chính xác, phù hợp với các vòng loại Robotics trong nước.',
    specs: [
      'Khung nhôm siêu nhẹ, độ bền cao',
      'Bánh xe cao su chống trượt',
      'Cảm biến line IR 8 kênh',
      'Tốc độ tối đa 1.5 m/s',
      'Lập trình C++ / Arduino IDE',
      'Pin 2000mAh, sạc đầy trong 1 giờ',
    ],
  },
  {
    id: 'robot-sumo-pro',
    slug: 'robot-sumo-pro',
    name: 'Bộ Robot Sumo Pro',
    category: 'nang-cao',
    ageRange: '10+ tuổi',
    ageFilter: '11+',
    price: 5_200_000,
    image: '/images/products/robot-sumo-pro.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ Robot Sumo Pro thiết kế cho thi đấu Sumo Robot. Lực đẩy mạnh, cảm biến phát hiện đối thủ nhanh chóng, phù hợp học viên luyện tập thi đấu cấp tỉnh và quốc gia.',
    specs: [
      'Khung thép không gỉ, trọng lượng tối ưu',
      'Động cơ DC 12V mô-men xoắn cao',
      'Cảm biến hồng ngoại phát hiện đối thủ 360°',
      'Lập trình C++ / Python',
      'Thời gian phản hồi < 10ms',
      'Pin 3000mAh, thay thế nhanh',
    ],
  },
  {
    id: 'cam-bien-chuyen-dung',
    slug: 'cam-bien-chuyen-dung',
    name: 'Phụ kiện cảm biến chuyên dụng',
    category: 'phu-kien',
    ageRange: 'Tất cả độ tuổi',
    ageFilter: null,
    price: 350_000,
    image: '/images/products/cam-bien-chuyen-dung.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Bộ phụ kiện cảm biến chuyên dụng tương thích với tất cả bộ học cụ Sata Robo. Bao gồm cảm biến siêu âm, hồng ngoại, màu sắc và gia tốc kế — mở rộng khả năng sáng tạo cho robot.',
    specs: [
      'Tương thích A1, B2, C3, RoboRace, Sumo Pro',
      'Gồm 4 loại: siêu âm, IR, màu sắc, IMU',
      'Giao tiếp I2C / UART / analog',
      'Kèm cable và tài liệu hướng dẫn',
    ],
  },
  {
    id: 'pin-sac-du-phong',
    slug: 'pin-sac-du-phong',
    name: 'Pin sạc dự phòng 5000mAh',
    category: 'phu-kien',
    ageRange: 'Tất cả độ tuổi',
    ageFilter: null,
    price: 250_000,
    image: '/images/products/pin-sac-du-phong.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Pin sạc dự phòng 5000mAh chuyên dụng cho robot học tập Sata Robo. Cổng USB-C và USB-A, sạc nhanh 18W, thiết kế nhỏ gọn phù hợp mang theo buổi thi đấu.',
    specs: [
      'Dung lượng: 5000mAh',
      'Đầu ra: USB-A 12W, USB-C 18W',
      'Trọng lượng: 120g',
      'Chứng nhận an toàn CE / RoHS',
      'Tương thích mọi robot Sata Robo',
    ],
  },
  {
    id: 'sach-huong-dan-lap-trinh',
    slug: 'sach-huong-dan-lap-trinh',
    name: 'Sách hướng dẫn lập trình Robot',
    category: 'phu-kien',
    ageRange: '8+ tuổi',
    ageFilter: '8-10',
    price: 180_000,
    image: '/images/products/sach-huong-dan-lap-trinh.jpg', // ANH CẦN CUNG CẤP ẢNH THẬT
    description:
      'Sách hướng dẫn lập trình Robot song ngữ Việt-Anh, 180 trang, phù hợp học sinh từ 8 tuổi. Bám sát chương trình Lập trình Robot của Sata Robo với bài tập thực hành từng bước.',
    specs: [
      '180 trang, khổ A4, in màu',
      'Song ngữ Việt - Anh',
      'Bám sát chương trình Lập trình Robot Sata Robo',
      '30 bài tập thực hành có đáp án',
      'QR code link video hướng dẫn kèm theo',
    ],
  },
]

export const CATEGORY_LABELS: Record<ProductCategory | 'all', string> = {
  all: 'Tất cả',
  'co-ban': 'Cơ bản',
  'nang-cao': 'Nâng cao',
  'phu-kien': 'Phụ kiện',
}

export const AGE_FILTER_LABELS: Record<string, string> = {
  all: 'Tất cả',
  '5-7': '5-7 tuổi',
  '8-10': '8-10 tuổi',
  '11+': '11+ tuổi',
}
