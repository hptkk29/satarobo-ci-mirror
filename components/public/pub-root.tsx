import type { CSSProperties, ReactNode } from "react";
import { PUB_FONT_CLASSES, PUB_FONT_VARS } from "@/components/public/pub-fonts";
import { PUB_THEME_SCRIPT } from "@/components/public/pub-theme";
import { PubFx } from "@/components/public/pub-design/pub-fx";
import { PubAnhGhiDeProvider } from "@/components/public/pub-design/pub-anh-ghi-de";
import { docAnhGhiDe } from "@/lib/pub-anh/doc-ghi-de";
import "@/app/(public)/pub-design/chung.css";
import "@/components/public/pub-design/phan-bo-sung.css";

/**
 * Phần tử gốc `.page` của giao diện public (đúng như artifact: `<div id="top" class="page theme-…">`).
 * MỌI selector của `app/(public)/pub-design/*.css` nằm dưới `.page` (không đụng `:root`/`body`, không ảnh hưởng
 * admin / portal / giáo viên). `sr-pub` là lớp đánh dấu để mã JS tìm gốc.
 *
 * Dùng ở `app/(public)/layout.tsx` và `app/(auth)/layout.tsx`. Là server component có chủ ý: class chủ đề do
 * script đặt (không do React quản lý) nên không bị ghi đè khi điều hướng. CSS riêng từng trang (`trang-chu.css`,
 * `disc.css`…) do chính trang import.
 */
export async function PubRoot({ children, id = "top" }: { children: ReactNode; id?: string }) {
  // Ảnh admin đã thay (một câu SELECT nhỏ; lỗi DB ⇒ rỗng ⇒ ảnh mặc định). Các trang ISR chỉ đọc lúc dựng lại.
  const anhGhiDe = await docAnhGhiDe();
  const style = {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    // KHÔNG dùng `100vh` trần: `.page` có zoom (1.18 → 2.3 ở màn rộng) nhân cả chiều cao này, trang tràn (đo 2400×1350: cao 2062px). --pz là đúng hệ số zoom (phan-bo-sung.css).
    minHeight: "calc(100vh / var(--pz, 1))",
    // Bitter 800 đã nạp ở app/layout.tsx dưới tên `--font-display`.
    "--font-bitter-800": "var(--font-display)",
    ...PUB_FONT_VARS,
  } as CSSProperties;
  return (
    <div id={id} className={`sr-pub page theme-light ${PUB_FONT_CLASSES}`} style={style} suppressHydrationWarning>
      <script>{PUB_THEME_SCRIPT}</script>
      <div className="progress iri" aria-hidden="true" />
      <PubAnhGhiDeProvider ghiDe={anhGhiDe}>{children}</PubAnhGhiDeProvider>
      <PubFx />
    </div>
  );
}
