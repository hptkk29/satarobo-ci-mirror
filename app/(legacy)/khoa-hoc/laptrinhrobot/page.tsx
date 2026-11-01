import type { Metadata } from "next";
import LapTrinhRobotClient from "./client-page";
import { getPromotions } from "@/lib/promotions";
import { getTestimonials } from "@/lib/testimonials";
import { getInternalAwards, getGifts, getCommitments } from "@/lib/marketing-policy";

const BASE_URL = "https://satarobo.vn";

// ISR: trang marketing tĩnh, regen mỗi 5' để pick up thay đổi ưu đãi từ DB.
export const revalidate = 300; // ISR_DETAIL (convention list=60/detail=300, xem lib/isr.ts)

export const metadata: Metadata = {
  title:
    "Học viện Robotics Đà Nẵng | Sata Robo — Lộ trình 5 năm cho con từ 6-13 tuổi",
  description:
    "Học viện Sata Robo — 2 cơ sở Robotics tại Đà Nẵng. Lộ trình 5 năm bài bản cho con từ lớp 1 đến lớp 8. Tặng buổi học thử 1-1 miễn phí, ưu đãi khai giảng đến 25%, cam kết hoàn phí.",
  keywords:
    "học robotics đà nẵng, sata robo, robotics cho trẻ em, lập trình robot, stem đà nẵng, lớp robotics offline, học viện robotics",
  alternates: { canonical: `${BASE_URL}/khoa-hoc/laptrinhrobot` },
  openGraph: {
    title: "Học viện Robotics Đà Nẵng | Sata Robo",
    description: "2 cơ sở tại Đà Nẵng — Lộ trình 5 năm Robotics cho con lớp 1-8.",
    url: `${BASE_URL}/khoa-hoc/laptrinhrobot`,
    locale: "vi_VN",
    siteName: "Sata Robo",
    type: "website",
  },
};

export default async function LapTrinhRobotPage() {
  // Nội dung đọc từ DB; bảng/Setting chưa có → helper tự fallback dữ liệu tĩnh.
  const [promotions, testimonialRows, internalAwards, gifts, commitments] = await Promise.all([
    getPromotions("laptrinhrobot"),
    getTestimonials("laptrinhrobot"),
    getInternalAwards(),
    getGifts(),
    getCommitments(),
  ]);
  // Map sang shape TestiItem; rỗng → undefined để component dùng fallback inline.
  const testimonials = testimonialRows.length
    ? testimonialRows.map((r, i) => ({
        id: `t${i + 1}`,
        initials: r.avatar,
        name: r.name,
        role: r.role,
        quote: `"${r.content}"`,
        videoId: r.videoId ?? "",
        avatarBg: r.avatarColor,
      }))
    : undefined;
  return (
    <LapTrinhRobotClient
      promotions={promotions}
      testimonials={testimonials}
      internalAwards={internalAwards}
      gifts={gifts}
      commitments={commitments}
    />
  );
}
