import Link from "next/link";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PhotoGroup, StudentPhotos } from "@/lib/portal/photos";
import { NutXemAnhBuoi } from "./slideshow-anh-buoi";

// Cổng phụ huynh — "Góc sản phẩm", dựng theo artifact San-pham.dc.html.
// Artifact còn có: tab lọc (Học phần / Chỉ video / Video thuyết trình), nút "Tải cả tháng",
// "Chia sẻ cho ông bà", "Con đã học được" — mô hình dữ liệu hiện chưa có video, học phần của ảnh
// hay nội dung chia sẻ, nên các phần đó KHÔNG được vẽ (không để nút/tab nói dối).

const CARD = "rounded-[20px] border border-border bg-card";
const NUT_VIEN =
  "inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-[var(--sr-tint-purple)]";

// eslint ghi chú ở hinh-anh-page: URL R2 ký động không khai được remotePatterns ⇒ dùng <img>.
function Anh({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block min-w-0">
      <img src={url} alt={alt} loading="lazy" className={cn("w-full bg-[var(--sr-tint-purple)] object-cover", className)} />
    </a>
  );
}

const nhanSoAnh = (n: number) => `${n} ảnh`;

function TheBuoi({ g }: { g: PhotoGroup }) {
  const dau = g.photos.slice(0, 4);
  const con = g.photos.slice(4);
  return (
    <article className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-3">
      <div className="grid grid-cols-2 gap-1.5">
        {dau.map((p, i) => (
          <Anh
            key={p.id}
            url={p.url}
            alt={p.caption ?? `Ảnh buổi ${g.order ?? ""} (${i + 1})`}
            className={cn("rounded-xl", dau.length === 1 ? "col-span-2 h-[150px]" : "h-[84px]")}
          />
        ))}
      </div>
      {con.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-[var(--sr-purple-text)] hover:underline">
            Xem thêm {con.length} ảnh
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {con.map((p, i) => (
              <Anh key={p.id} url={p.url} alt={p.caption ?? `Ảnh bổ sung ${i + 1}`} className="h-[84px] rounded-xl" />
            ))}
          </div>
        </details>
      ) : null}
      <div className="flex flex-col gap-0.5 px-1">
        <div className="text-xs font-bold uppercase text-[var(--sr-orange-text)]">
          {g.order ? `BUỔI ${g.order}` : "ẢNH LỚP"}
          {g.nhanNgay ? ` · ${g.nhanNgay.slice(0, 5)}` : ""}
        </div>
        <div className="text-[15px] font-bold leading-snug">{g.title}</div>
        <div className="text-xs text-muted-foreground">{nhanSoAnh(g.photos.length)}</div>
      </div>
      <NutXemAnhBuoi
        kieu="phu"
        anh={g.photos}
        tieuDe={g.title}
        phu={`${g.nhanNgay ? `${g.nhanNgay} · ` : ""}${nhanSoAnh(g.photos.length)}`}
      />
    </article>
  );
}

export function SanPhamPage({ data, studentName }: { data: StudentPhotos; studentName: string }) {
  const [moiNhat, ...con] = data.groups;
  const [lon, ...nho] = moiNhat?.photos ?? [];
  const moTa = moiNhat?.photos.find((p) => p.caption?.trim())?.caption?.trim() ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">
          {data.consentGranted ? `${data.groups.length} BUỔI · ${data.total} ẢNH` : "GÓC SẢN PHẨM"}
        </div>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">
          Góc sản phẩm của {studentName}
        </h1>
        <div className="max-w-[640px] text-sm text-muted-foreground">
          Ảnh thầy cô chụp tại lớp, đã được quản lý cơ sở duyệt trước khi gửi đến ba mẹ.
        </div>
      </header>

      {!data.consentGranted ? (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border-2 border-dashed border-border p-10 text-center">
          <ImageOff className="size-9 text-[var(--sr-purple-text)]" aria-hidden="true" />
          <p className="max-w-[420px] text-sm leading-[21px]">
            Cần bật <b>đồng ý dùng hình ảnh</b> cho con thì mới xem được ảnh lớp. Ba mẹ có thể thu hồi bất cứ lúc nào.
          </p>
          <Link href="/portal/ho-so-con/chi-tiet" className={NUT_VIEN}>
            Bật đồng ý trong Hồ sơ con
          </Link>
        </div>
      ) : !moiNhat || !lon ? (
        <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-8 text-center">
          <div className="text-base font-bold">Chưa có ảnh sản phẩm nào</div>
          <div className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground">
            Ảnh giáo viên đăng sau buổi học sẽ hiện ở đây sau khi quản lý duyệt.
          </div>
        </div>
      ) : (
        <>
          <article className={cn(CARD, "flex flex-wrap gap-6 p-5")}>
            <div className="grid min-w-0 flex-[3_1_420px] grid-cols-4 gap-2">
              <a href={lon.url} target="_blank" rel="noopener noreferrer" className="col-span-4 block">
                <img
                  src={lon.url}
                  alt={lon.caption ?? "Ảnh sản phẩm mới nhất"}
                  className="h-[260px] w-full rounded-2xl bg-[var(--sr-tint-purple)] object-cover min-[560px]:h-[320px]"
                />
              </a>
              {nho.slice(0, 3).map((p, i) => (
                <Anh key={p.id} url={p.url} alt={p.caption ?? `Ảnh lớp ${i + 1}`} className="h-[84px] rounded-xl" />
              ))}
            </div>
            <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-3.5">
              <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">
                MỚI NHẤT{moiNhat.nhanNgay ? ` · ${moiNhat.nhanNgay}` : ""}
              </div>
              <h2 className="font-display text-[26px] font-extrabold leading-[32px]">{moiNhat.title}</h2>
              {moTa ? <p className="text-[15px] leading-[23px]">{moTa}</p> : null}
              <div className="mt-auto flex flex-wrap gap-2.5">
                <Link href="/portal/nhan-xet" className="flex h-11 items-center px-2 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
                  Nhận xét buổi này
                </Link>
              </div>
              <NutXemAnhBuoi
                anh={moiNhat.photos}
                tieuDe={moiNhat.title}
                phu={`${moiNhat.nhanNgay ? `${moiNhat.nhanNgay} · ` : ""}${nhanSoAnh(moiNhat.photos.length)}`}
              />
            </div>
          </article>

          {/* Buổi mới nhất đã nằm ở thẻ lớn phía trên — danh sách này CHỈ gồm các buổi trước
              (12/11/2026: trước đó vẽ lặp lại đúng buổi mới nhất). */}
          {con.length > 0 ? (
            <section className="flex flex-col gap-3.5">
              <h2 className="text-xl font-bold">Các buổi trước</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-4">
                {con.map((g) => (
                  <TheBuoi key={g.sessionId} g={g} />
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--sr-tint-purple)] px-5 py-4 text-[13px] leading-5">
            <span>Ba mẹ đã đồng ý cho trung tâm dùng hình ảnh của con.</span>
            <Link href="/portal/ho-so-con/chi-tiet" className="font-semibold text-[var(--sr-purple-text)] hover:underline">
              Đổi quyền dùng hình ảnh
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
