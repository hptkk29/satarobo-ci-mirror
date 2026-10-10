export interface Gift {
  id: number;
  icon: string;
  title: string;
  value: string;
  description: string;
}

export const gifts: Gift[] = [
  { id: 1, icon: "👕", title: "Bộ đồng phục Sata Robo", value: "200.000đ", description: "Đồng phục SataRobo — con tự hào mặc đến lớp." },
  { id: 2, icon: "🎓", title: "Bộ đề luyện thi và giải đề RoboSim 2026", value: "490.000đ", description: "Áp dụng cho mọi học viên đăng ký khoá Offline trong chương trình khai giảng." },
  { id: 3, icon: "📘", title: 'E-book "Phát triển tư duy STEM cho con"', value: "150.000đ", description: "PDF 80 trang — bí quyết giúp con phát triển tư duy khoa học ngay tại nhà." },
  { id: 4, icon: "🎯", title: "Voucher sắm học cụ", value: "1.000.000đ", description: "Voucher mua học cụ STEM trị giá 1 triệu đồng." },
];

export const totalGiftValue = " 1.840.000đ";
