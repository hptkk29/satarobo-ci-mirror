import { cache } from "react";
import { db } from "@/lib/db";
import { PUB_ANH_PAGE_KEY, hostChoPhep, phanTichGhiDe, type GhiDeAnh } from "./ghi-de-thuan";
import { layOAnh } from "./danh-muc";

/**
 * Mọi ảnh public đang bị admin thay: mã ảnh → `{url,w,h}`. Đọc MỘT câu cho cả trang (bọc `cache` của React nên PubRoot lồng
 * nhau không hỏi lại). Lỗi DB / dòng hỏng / mã lạ / host lạ ⇒ bỏ qua dòng đó — ảnh là phần trang trí, KHÔNG được làm sập trang công khai.
 * `SitePageContent` là model toàn cục (∉ SCOPED_MODELS) nên đọc trần bằng `db` giống `lib/page-images.ts`.
 */
export const docAnhGhiDe = cache(async (): Promise<Record<string, GhiDeAnh>> => {
  try {
    const dong = await db.sitePageContent.findMany({
      where: { pageKey: PUB_ANH_PAGE_KEY },
      select: { contentKey: true, contentValue: true },
    });
    const hosts = hostChoPhep(process.env.R2_PUBLIC_URL);
    const kq: Record<string, GhiDeAnh> = {};
    for (const d of dong) {
      if (!layOAnh(d.contentKey)) continue;
      const g = phanTichGhiDe(d.contentValue, hosts);
      if (g) kq[d.contentKey] = g;
    }
    return kq;
  } catch {
    return {};
  }
});
