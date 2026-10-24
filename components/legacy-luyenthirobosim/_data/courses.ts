export interface Course {
  id: string;
  level: string;
  colorKey: string;
  badge: string;
  title: string;
  subtitle: string;
  tagline: string;
  audience: string;
  examBoard: string;
  duration: string;
  outcomes: string[];
  originalPrice: string;
  salePrice: string;
  discount: string;
  features: string[];
  ctaText: string;
}

const courses: Course[] = [
  {
    id: "r1",
    level: "R1",
    colorKey: "r1",
    badge: "🟦 BẢNG R1",
    title: "KHOÁ LUYỆN THI — BẢNG R1",
    subtitle: "Dành cho TIỂU HỌC",
    tagline: "Cho con bước vào TOP vòng loại RBT2026 Tiểu học",
    audience: "Học sinh lớp 3 — 5",
    examBoard: "R1 (chuẩn vòng loại)",
    duration: "18 buổi (15 phút video + 15 phút thực hành)",
    outcomes: ["Con tự giải tối ưu đề R1", "Đủ điểm vào nhóm TOP"],
    originalPrice: "790.000đ",
    salePrice: "490.000đ",
    discount: "GIẢM 38%",
    features: [
      "Video MẸO TỐI ƯU di chuyển robot",
      "Full hướng dẫn giải đề R1",
    ],
    ctaText: "🟦 ĐĂNG KÝ BẢNG R1 — 490.000đ →",
  },
  {
    id: "r2",
    level: "R2",
    colorKey: "r2",
    badge: "🟪 BẢNG R2",
    title: "KHOÁ LUYỆN THI — BẢNG R2",
    subtitle: "Dành cho THCS",
    tagline: "Cho con bước vào TOP vòng loại RBT2026 THCS",
    audience: "Học sinh lớp 6 — 9",
    examBoard: "R2 (chuẩn vòng loại)",
    duration: "18 buổi (15 phút video + 15 phút thực hành)",
    outcomes: ["Con tự giải tối ưu đề R2", "Đủ điểm vào nhóm TOP"],
    originalPrice: "890.000đ",
    salePrice: "490.000đ",
    discount: "GIẢM 45%",
    features: [
      "Video MẸO TỐI ƯU di chuyển robot",
      "Full hướng dẫn giải đề R2",
    ],
    ctaText: "🟪 ĐĂNG KÝ BẢNG R2 — 490.000đ →",
  },
];

export default courses;
