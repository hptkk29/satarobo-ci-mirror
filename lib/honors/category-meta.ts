import { Zap, Sprout, Rocket, Crown, type LucideIcon } from "lucide-react";
import { HonorCategory } from "@prisma/client";

export interface CategoryMeta {
  slug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  bgColor: string;
  textColor: string;
  accentColor: string;
}

export const CATEGORY_META: Record<HonorCategory, CategoryMeta> = {
  SPARK: {
    slug: "spark",
    title: "Spark",
    description:
      "Tia sáng đột phá đầu tiên — những ý tưởng mới làm thay đổi cách Sata Robo vận hành.",
    icon: Zap,
    bgColor: "#FEF3C7",
    textColor: "#92400E",
    accentColor: "#F59E0B",
  },
  GROWTH: {
    slug: "growth",
    title: "Growth",
    description:
      "Phát triển vượt bậc — những nhân sự bứt phá vượt qua kỳ vọng và mở rộng quy mô.",
    icon: Sprout,
    bgColor: "#D1FAE5",
    textColor: "#065F46",
    accentColor: "#10B981",
  },
  IMPACT: {
    slug: "impact",
    title: "Impact",
    description:
      "Tạo dấu ấn cộng đồng — những đóng góp lớn ảnh hưởng đến hàng nghìn học viên và phụ huynh.",
    icon: Rocket,
    bgColor: "#FEE2E2",
    textColor: "#991B1B",
    accentColor: "#EF4444",
  },
  GRAND_CHAMPION: {
    slug: "grand-champion",
    title: "Grand Champion",
    description:
      "Đỉnh cao toàn diện — danh hiệu cao quý nhất, vinh danh những người làm nên huyền thoại Sata Robo.",
    icon: Crown,
    bgColor: "#EDE9FE",
    textColor: "#5B21B6",
    accentColor: "#7C3AED",
  },
};

export const CATEGORY_SLUG_MAP: Record<string, HonorCategory> = {
  spark: "SPARK",
  growth: "GROWTH",
  impact: "IMPACT",
  "grand-champion": "GRAND_CHAMPION",
};

// categoryToSlug đã xóa (dead export, 0 usage — LIB-15).
