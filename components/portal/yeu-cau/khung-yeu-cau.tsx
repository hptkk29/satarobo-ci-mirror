import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Khung chung của các màn con «Gửi yêu cầu đến trung tâm» (board M-Yeu-cau-*): nút quay lại 44px + tiêu đề.
// Server-safe (không state). Chiều rộng tối đa 720px: một cột đọc được trên điện thoại, không kéo dãn trên máy tính.
export function KhungYeuCau({
  tieuDe,
  moTa,
  children,
}: {
  tieuDe: string;
  moTa?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <Link
        href="/portal/yeu-cau"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Gửi yêu cầu đến trung tâm
      </Link>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">
          {tieuDe}
        </h1>
        {moTa ? <p className="text-sm leading-[22px] text-[var(--sr-ink-muted)]">{moTa}</p> : null}
      </header>
      {children}
    </div>
  );
}
