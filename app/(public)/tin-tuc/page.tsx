import type { Metadata } from "next";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { db } from "@/lib/db";
import { breadcrumbJsonLd, jsonLdScript } from "@/lib/seo/jsonld";
import { TinTucDanhSach } from "@/components/blog/tin-tuc-danh-sach";
import { CtaDocXong, TheoDoiSata, TinTucHero } from "@/components/blog/tin-tuc-khung";
import { SELECT_BAI_DANH_SACH, sangTinTucItem } from "@/components/blog/tin-tuc-du-lieu";
import { chuyenMucCoBai, type TinTucItem } from "@/components/blog/tin-tuc-thuan";

const BASE_URL = "https://satarobo.vn";

export const metadata: Metadata = {
  title: "Tin tức & Sự kiện — Sata Robo",
  description:
    "Cập nhật tin tức mới nhất từ Sata Robo — sự kiện, khoá học, ưu đãi và thông tin Cuộc thi Sáng tạo Robotics 2026.",
  alternates: { canonical: `${BASE_URL}/tin-tuc` },
  openGraph: {
    title: "Tin tức & Sự kiện — Sata Robo",
    description: "Cập nhật tin tức từ Sata Robo Đà Nẵng.",
    url: `${BASE_URL}/tin-tuc`,
    siteName: "Sata Robo",
  },
};

export const revalidate = 60;

export default async function NewsListPage() {
  const rows = await db.news
    .findMany({
      where: { isPublished: true },
      orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }, { displayOrder: "asc" }],
      select: SELECT_BAI_DANH_SACH,
    })
    .catch(() => []);

  // `content` chỉ dùng để tính số phút đọc ở SERVER — không truyền xuống client (nặng + không cần).
  const muc = rows.map((r) => ({ luc: r.publishedAt?.getTime() ?? 0, post: sangTinTucItem(r) }));
  const posts: TinTucItem[] = muc.map((m) => m.post);

  // Khối "feed" ở đầu trang: bài MỚI NHẤT theo ngày đăng (không theo "nổi bật") có ảnh bìa.
  const moiNhat = [...muc].sort((a, b) => b.luc - a.luc).map((m) => m.post);

  // Chip chuyên mục ở hero: đúng thứ tự thiết kế cho chuyên mục trùng nhãn, rồi các chuyên mục khác của repo.
  const chips = chuyenMucCoBai(posts)
    .slice(0, 6)
    .map((c) => ({ khoa: c.key, nhan: c.label }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: "Trang chủ", url: "/" },
              { name: "Tin tức", url: "/tin-tuc" },
            ]),
          ),
        }}
      />

      <TinTucHero
        duongDan={[{ ten: "Tin tức" }]}
        nhan="Tin tức & sự kiện"
        tieuDe="Cập nhật từ"
        tieuDeNhan="Sata Robo"
        moTa="Sự kiện, khoá học mới, ưu đãi và thông tin Cuộc thi Robotics – cùng những bài viết giúp ba mẹ đồng hành với con học STEM."
        chips={chips}
        feed={moiNhat}
      />

      <section className="sec" id="bai-viet">
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>[01]</b>{" "}
                Bài viết mới
              </span>
              <h2>
                Tin mới <span className="grad">nhất</span>
              </h2>
            </div>
            <p>{chips.length >= 2 ? "Lọc theo chuyên mục ba mẹ quan tâm." : "Những cập nhật mới nhất từ Sata Robo."}</p>
            <PubAnh id="9befff8c7810fdf04d94f687c7c23e67" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{ right: "0", top: "-124px", width: "112px", height: "auto" }} sizes="112px" />
          </div>
          <TinTucDanhSach posts={posts} />
        </div>
      </section>

      <TheoDoiSata />
      <CtaDocXong tieuDe="Đọc nhiều rồi, cho con thử thật nhé!" />
    </>
  );
}
