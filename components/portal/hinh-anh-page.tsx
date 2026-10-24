import Link from "next/link";
import { Camera, ImageOff } from "lucide-react";
import type { StudentPhotos } from "@/lib/portal/photos";
import { PageHero } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";

// 06/09 — nhãn ngày do SERVER tính theo lịch VN (`g.nhanNgay`). Server Component chạy
// UTC trên Vercel; `getDate()` ở đây lệch một ngày trong khoảng 00:00–07:00 giờ VN.

export function HinhAnhPageV2({
  kids,
  activeId,
  studentName,
  data,
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  studentName: string;
  data: StudentPhotos;
}) {
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={Camera}
        title="Hình ảnh lớp theo buổi học"
        subtitle={`${data.total} ảnh từ ${data.groups.length} buổi học của ${studentName}${data.className ? ` · Lớp ${data.className}` : ""}.`}
      />

      {!data.consentGranted ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <ImageOff className="size-8 text-muted-foreground/60" />
          <p>
            Cần bật{" "}
            <span className="font-semibold text-foreground">
              đồng ý dùng hình ảnh
            </span>{" "}
            cho con thì mới xem được ảnh lớp. Bạn có thể thu hồi bất cứ lúc nào.
          </p>
          <Link
            href="/portal/ho-so-con/chi-tiet"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Bật đồng ý trong Hồ sơ con
          </Link>
        </div>
      ) : data.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Chưa có ảnh lớp nào.
        </div>
      ) : (
        <div className="space-y-8">
          {data.groups.map((g) => (
            <section key={g.sessionId} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {g.order ?? "•"}
                </span>
                <div>
                  <h2 className="text-sm font-bold text-foreground">
                    {g.title}
                  </h2>
                  <p className="text-xs font-medium text-muted-foreground">
                    {g.nhanNgay ? `Ngày chụp: ${g.nhanNgay} · ` : ""}
                    {g.photos.length} ảnh
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {/* Ảnh thật (signed URL khi bật MEDIA_SIGNED_URL) — bấm mở bản đầy đủ ở tab mới.
                    Dùng <img> như bản v1: URL R2 ký động không khai báo được remotePatterns. */}
                {g.photos.map((p) => (
                  <figure
                    key={p.id}
                    className="overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={p.url}
                        alt={p.caption ?? "Ảnh lớp"}
                        loading="lazy"
                        className="h-40 w-full bg-muted object-cover transition-opacity hover:opacity-90"
                      />
                    </a>
                    <figcaption className="truncate p-3 text-sm font-bold text-foreground">
                      {p.caption ?? "Ảnh lớp"}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
