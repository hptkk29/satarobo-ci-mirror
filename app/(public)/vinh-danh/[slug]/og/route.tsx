import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { CATEGORY_SLUG_MAP } from "@/lib/honors/category-meta";

export const runtime = "nodejs";
export const revalidate = 3600;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;

  // Nếu slug là category, không sinh OG riêng (rơi vào fallback)
  if (CATEGORY_SLUG_MAP[slug]) {
    return new Response("Use parent OG", { status: 404 });
  }

  const honor = await db.honor
    .findUnique({
      where: { slug },
      select: {
        fullName: true,
        jobTitle: true,
        jobTitleAtTime: true,
        awardName: true,
        employee: {
          select: { fullName: true, jobTitle: true },
        },
      },
    })
    .catch(() => null);

  if (!honor) {
    return new Response("Not found", { status: 404 });
  }

  const displayName =
    honor.employee?.fullName ?? honor.fullName ?? "Nhân sự";
  const displayJobTitle =
    honor.jobTitleAtTime ?? honor.employee?.jobTitle ?? honor.jobTitle ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          background: "linear-gradient(135deg, #7C3AED 0%, #F97316 100%)",
          width: "100%",
          height: "100%",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            color: "#FED7AA",
            fontSize: "26px",
            marginBottom: "20px",
            fontWeight: 600,
          }}
        >
          {honor.awardName}
        </div>

        <div
          style={{
            color: "white",
            fontSize: displayName.length > 18 ? "64px" : "80px",
            fontWeight: 800,
            textAlign: "center",
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          {displayName}
        </div>

        <div
          style={{
            color: "white",
            fontSize: "32px",
            opacity: 0.9,
            marginTop: "24px",
            textAlign: "center",
          }}
        >
          {displayJobTitle}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "60px",
          }}
        >
          <span style={{ color: "white", fontSize: "28px", fontWeight: 700 }}>
            satarobo.vn
          </span>
          <span style={{ color: "#FED7AA", fontSize: "28px" }}>/vinh-danh</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
