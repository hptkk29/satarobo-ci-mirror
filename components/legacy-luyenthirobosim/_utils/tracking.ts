"use client";

// gtag/fbq global types are declared by components/public/ga4.tsx +
// components/public/meta-pixel.tsx — reuse them, do not redeclare.

/**
 * Gửi event tracking khi click nút Đăng ký, sau đó mở URL SataWorld kèm UTM.
 */
export function trackAndRedirect(courseLevel: "R1" | "R2", eventName: string): void {
  if (typeof window === "undefined") return;

  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, {
      event_category: "CTA",
      event_label: courseLevel,
    });
  }
  if (typeof window.fbq === "function") {
    window.fbq("track", "Lead", { content_name: courseLevel });
  }

  const slug =
    courseLevel === "R1"
      ? "robotics/khoa-hoc/full-de-luyen-thi-vong-loai-robosim-hau-can-thong-minh-bang-r1-cuoc-thi-sang-tao-robotics-2026"
      : "robotics/khoa-hoc/full-de-luyen-thi-vong-loai-robosim-hau-can-thong-minh-bang-r2-cuoc-thi-sang-tao-robotics-2026";
  const url = `https://sataworld.vn/${slug}?utm_source=luyenthirobosim&utm_medium=${eventName}&utm_campaign=rbt2026`;
  window.open(url, "_blank", "noopener,noreferrer");
}
