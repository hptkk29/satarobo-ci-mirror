"use client";

// bai-nop-media.tsx — phần XEM bài nộp trên màn chấm (12/11/2026, chủ dự án: "cho hiển thị khung video của học viên để bấm vào,
// không phải bấm vào là nhảy qua trang khác — bấm vào thì mở to lên để xem video").
//
//   · VIDEO  → khung 16:9 có khung hình đầu + nút phát; bấm ⇒ mở hộp thoại lớn có trình phát (tự phát, có điều khiển).
//   · ẢNH    → ô vuông thu nhỏ; bấm ⇒ mở to trong cùng hộp thoại.
//   · TỆP khác (pdf, zip…) → chip có tên + dung lượng, mở ở thẻ mới (không có gì để "xem trước" tại chỗ).
// Không tải video về: `preload="metadata"` chỉ lấy khung hình đầu; hộp thoại đóng ⇒ trình phát gỡ ra và dừng phát.
import { useState } from "react";
import { ExternalLink, FileText, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type BaiNopFile = {
  id: string;
  url: string;
  name: string;
  size: number | null;
  mime?: string | null;
};

// Tệp cũ có thể thiếu mimeType ⇒ đoán theo đuôi tên/đường dẫn (chỉ khi KHÔNG có mime; có mime thì tin mime).
const DUOI_VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const DUOI_ANH = /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i;
export const laVideo = (f: { mime?: string | null; url?: string; name?: string }) =>
  f.mime ? f.mime.startsWith("video/") : DUOI_VIDEO.test(f.name ?? "") || DUOI_VIDEO.test(f.url ?? "");
export const laAnh = (f: { mime?: string | null; url?: string; name?: string }) =>
  f.mime ? f.mime.startsWith("image/") : DUOI_ANH.test(f.name ?? "") || DUOI_ANH.test(f.url ?? "");

/** Kích thước tệp dễ đọc. */
export function dungLuong(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 83 ⇒ "1:23". Video chưa đọc được độ dài (hoặc vô hạn — luồng trực tiếp) ⇒ null. */
export function dinhDangGiay(giay: number | null | undefined): string | null {
  if (giay == null || !Number.isFinite(giay) || giay <= 0) return null;
  const t = Math.round(giay);
  const h = Math.floor(t / 3600);
  const p = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(p).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${p}:${String(s).padStart(2, "0")}`;
}

export function BaiNopMedia({ files }: { files: BaiNopFile[] }) {
  const [mo, setMo] = useState<BaiNopFile | null>(null);
  const [giay, setGiay] = useState<Record<string, number>>({});

  const media = files.filter((f) => laVideo(f) || laAnh(f));
  const tepKhac = files.filter((f) => !laVideo(f) && !laAnh(f));
  if (files.length === 0) return null;

  return (
    <div className="space-y-4">
      {media.length > 0 && (
        <ul
          className={
            media.length === 1 && laVideo(media[0]!)
              ? "grid grid-cols-1 gap-3"
              : "grid grid-cols-1 gap-3 sm:grid-cols-2"
          }
        >
          {media.map((f) => {
            const video = laVideo(f);
            const thoiLuong = video ? dinhDangGiay(giay[f.id]) : null;
            const meta = [thoiLuong, dungLuong(f.size)].filter(Boolean).join(" · ");
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setMo(f)}
                  aria-label={`${video ? "Xem video" : "Xem ảnh"} ${f.name}${meta ? ` (${meta})` : ""}`}
                  className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-border bg-black text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {video ? (
                    <video
                      // #t=0.1 để trình duyệt vẽ khung hình đầu làm ảnh bìa (không cần tải cả tệp).
                      src={`${f.url}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      tabIndex={-1}
                      aria-hidden="true"
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d)) setGiay((g) => ({ ...g, [f.id]: d }));
                      }}
                      className="pointer-events-none size-full object-contain"
                    />
                  ) : (
                    <img src={f.url} alt={f.name} className="size-full object-cover" loading="lazy" />
                  )}
                  {video && (
                    <span
                      aria-hidden="true"
                      className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-105"
                    >
                      <Play className="ml-0.5 size-6 fill-current" />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-white">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{f.name}</span>
                    {meta && <span className="shrink-0 text-xs tabular-nums opacity-90">{meta}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {tepKhac.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {tepKhac.map((f) => (
            <li key={f.id}>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted"
              >
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                <span className="max-w-[220px] truncate">{f.name}</span>
                {dungLuong(f.size) && <span className="font-normal text-muted-foreground">{dungLuong(f.size)}</span>}
                <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={mo !== null} onOpenChange={(v) => !v && setMo(null)}>
        <DialogContent className="gap-3 p-3 sm:max-w-4xl sm:p-4">
          {mo && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8 text-base">{mo.name}</DialogTitle>
              </DialogHeader>
              {laVideo(mo) ? (
                <video
                  key={mo.id}
                  src={mo.url}
                  controls
                  autoPlay
                  playsInline
                  aria-label={`Video bài làm: ${mo.name}`}
                  className="max-h-[75vh] w-full rounded-lg bg-black"
                />
              ) : (
                <img src={mo.url} alt={mo.name} className="max-h-[75vh] w-full rounded-lg bg-muted object-contain" />
              )}
              <a
                href={mo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Mở tệp gốc ở thẻ mới
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
