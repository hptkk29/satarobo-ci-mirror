// Sata Robo Image Placeholders.
//
// Hardcoded Unsplash fallbacks for every public page hero image. The actual
// override pipeline lives in `getPageImage(pageKey, fallback)` below — it
// reads SitePageContent (pageKey, "hero-image-url") and returns the DB value
// if present, else the fallback. Public pages should call that helper rather
// than reading `pageImages.<key>` directly.

import { db } from "@/lib/db";

export const pageImages = {
  homeSecondary: {
    src: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1600&q=80",
    alt: "Học sinh trẻ với laptop, học lập trình",
  },
  laptrinhrobot: {
    src: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=1600&q=80",
    alt: "Học sinh học lập trình robot tại lớp Sata Robo",
  },
  luyenthirobosim: {
    src: "https://images.unsplash.com/photo-1573164574572-cb89e39749b4?w=1600&q=80",
    alt: "Luyện thi RoboSim — simulation trên trình duyệt",
  },
  aboutHero: {
    src: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1600&q=80",
    alt: "Đội ngũ Sata Robo họp chiến lược",
  },
  blogDefault: {
    src: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1600&q=80",
    alt: "Workspace với notebook và laptop",
  },
  careers: {
    src: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80",
    alt: "Văn phòng hiện đại Sata Robo",
  },
  contact: {
    src: "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1600&q=80",
    alt: "Quầy lễ tân văn phòng",
  },
  hocCu: {
    src: "https://images.unsplash.com/photo-1546776230-bb86256870ce?w=1600&q=80",
    alt: "Phụ kiện và bộ kit robotics",
  },
} as const;

export type PageImageKey = keyof typeof pageImages;

interface PageImage {
  src: string;
  alt: string;
}

// Read the admin-overridden hero image for a given public page, falling back
// to the bundled Unsplash placeholder when no override exists. Keep this
// server-only — it queries Prisma.
export async function getPageImage(
  pageKey: string,
  fallback: PageImage,
): Promise<PageImage> {
  try {
    const row = await db.sitePageContent.findUnique({
      where: { pageKey_contentKey: { pageKey, contentKey: "hero-image-url" } },
      select: { contentValue: true },
    });
    const override = row?.contentValue?.trim();
    if (override) {
      return { src: override, alt: fallback.alt };
    }
  } catch {
    // DB unreachable → silently fall back. Hero images are not load-bearing.
  }
  return fallback;
}
