import { promises as fs } from "fs";
import path from "path";
import { phanDauDeHienThi, tachVanBan } from "@/lib/legal/tach-van-ban";
import { KhungChinhSach } from "./khung-chinh-sach";
import { PhapLyMarkdown } from "./phap-ly-markdown";

// Trang một văn bản pháp lý: đọc `content/legal/<slug>.md` (NGUỒN DUY NHẤT của chữ), tách thành mục để
// dựng mục lục + đầu mục có số theo artifact `ChinhSach-*`. Chữ pháp lý KHÔNG bị đổi — xem `lib/legal/tach-van-ban.ts`.
// Metadata giữ ở từng `page.tsx` (Next yêu cầu export tại route).
export async function PhapLyTrang({
  slug,
  title,
  subtitle,
  breadcrumbLabel,
}: {
  slug: string;
  title: string;
  subtitle: string;
  breadcrumbLabel: string;
}) {
  const filePath = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  const vanBan = tachVanBan(await fs.readFile(filePath, "utf-8"));
  const danNhap = phanDauDeHienThi(vanBan);

  return (
    <KhungChinhSach
      slug={slug}
      title={title}
      subtitle={subtitle}
      breadcrumbLabel={breadcrumbLabel}
      ngayCapNhat={vanBan.ngayCapNhat}
    >
      {vanBan.muc.length > 1 ? (
        <nav className="toc card" style={{ margin: "0 0 8px" }} aria-label="Mục lục">
          <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
            Nội dung
          </span>
          <ol style={{ columns: "2", columnGap: "24px" }}>
            {vanBan.muc.map((m) => (
              <li key={m.neo}>
                <a href={`#${m.neo}`}>{m.tieu}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      {danNhap ? (
        <section className="pol-sec" style={{ marginTop: "18px" }}>
          <PhapLyMarkdown content={danNhap} />
        </section>
      ) : null}

      {vanBan.muc.map((m) => (
        <section key={m.neo} className="pol-sec">
          <h2 id={m.neo} className="sv a-mask">
            {m.so !== null ? <span className="n">{String(m.so).padStart(2, "0")}</span> : null}
            {m.tieu}
          </h2>
          <PhapLyMarkdown content={m.thanBai} />
        </section>
      ))}
    </KhungChinhSach>
  );
}
