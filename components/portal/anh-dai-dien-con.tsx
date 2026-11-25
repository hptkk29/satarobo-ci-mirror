"use client";

// Ảnh đại diện của con + nút «Đổi ảnh» cho PHỤ HUYNH (12/11/2026). Dựng theo board M-Ho-so:
// vòng tròn ảnh 52px (chữ viết tắt khi chưa có ảnh) và nút viền 44px bên dưới, tối ưu một tay trên điện thoại.
//
// Tải lên qua POST /api/portal/anh-dai-dien (server kiểm sở hữu + chữ ký ảnh + 4MB). Phía trình duyệt
// thu nhỏ ảnh về tối đa 1024px rồi mã hoá lại JPEG TRƯỚC khi gửi: ảnh chụp từ điện thoại thường 5–12MB, vượt
// trần 4MB của server — người dùng sẽ nhận lỗi dù ảnh hoàn toàn hợp lệ. Thu nhỏ hỏng (trình duyệt cũ) thì gửi
// nguyên bản và để server quyết định.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CAN_TOI_DA = 1024;

async function thuNho(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const tile = Math.min(1, CAN_TOI_DA / Math.max(bmp.width, bmp.height));
    // Ảnh đã nhỏ và nhẹ: giữ nguyên, khỏi nén thêm làm mờ.
    if (tile === 1 && file.size <= 1.5 * 1024 * 1024) {
      bmp.close();
      return file;
    }
    const w = Math.round(bmp.width * tile);
    const h = Math.round(bmp.height * tile);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return file;
    return new File([blob], "anh-dai-dien.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function AnhDaiDienCon({
  studentId,
  name,
  initials,
  avatarUrl,
  noiBat,
}: {
  studentId: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** Con đang được chọn — vòng cam (giữ cách tô cũ của thẻ con). */
  noiBat?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [dang, setDang] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [xem, setXem] = useState<string | null>(null);

  async function chon(f: File | undefined) {
    if (!f) return;
    setLoi(null);
    setDang(true);
    const tam = URL.createObjectURL(f);
    setXem(tam);
    try {
      const nho = await thuNho(f);
      const fd = new FormData();
      fd.set("studentId", studentId);
      fd.set("file", nho);
      const res = await fetch("/api/portal/anh-dai-dien", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Không tải được ảnh — thử lại sau.");
      router.refresh();
    } catch (e) {
      setXem(null);
      setLoi(e instanceof Error ? e.message : "Không tải được ảnh — thử lại sau.");
    } finally {
      setDang(false);
      URL.revokeObjectURL(tam);
      if (input.current) input.current.value = "";
    }
  }

  const anh = xem ?? avatarUrl;
  return (
    <div className="flex flex-none flex-col items-center gap-1.5">
      <span
        className={cn(
          "relative flex size-[52px] items-center justify-center overflow-hidden rounded-full text-[17px] font-bold",
          noiBat ? "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]" : "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
        )}
      >
        {anh ? <img src={anh} alt={`Ảnh của ${name}`} className="size-full object-cover" /> : <span aria-hidden="true">{initials}</span>}
        {dang ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status" aria-label="Đang tải ảnh">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          </span>
        ) : null}
      </span>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => void chon(e.target.files?.[0])} />
      <button
        type="button"
        disabled={dang}
        onClick={() => input.current?.click()}
        aria-label={avatarUrl ? `Đổi ảnh của ${name}` : `Thêm ảnh cho ${name}`}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--sr-purple-text)] hover:underline disabled:opacity-60"
      >
        <Camera className="size-3.5" aria-hidden="true" />
        {avatarUrl ? "Đổi ảnh" : "Thêm ảnh"}
      </button>
      {loi ? (
        <span role="alert" className="max-w-[120px] text-center text-[11px] leading-4 text-[var(--sr-danger,#b42318)]">
          {loi}
        </span>
      ) : null}
    </div>
  );
}
