"use client";

// components/admin/link-gioi-thieu/nut-dong-y.tsx — nút «Tôi đã đọc và đồng ý» ở màn «Link giới thiệu của tôi». Bấm là vào luôn — KHÔNG có bước duyệt (chủ dự án chốt 21/11/2026).
// Máy chủ quyết toàn bộ (tạo / kích hoạt hồ sơ giới thiệu + tham gia chương trình); nút chỉ gọi và nói lại kết quả. Hàm gọi máy chủ TIÊM được (`dongY`) cho test.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { thamGiaLinkGioiThieuAction } from "@/app/(admin)/admin/link-gioi-thieu/_actions";
import type { KetQuaThamGia } from "@/lib/affiliate/doi-tac-nhan-su";

type DongY = () => Promise<KetQuaThamGia>;
const DONG_Y_MAC_DINH: DongY = () => thamGiaLinkGioiThieuAction();

export function NutDongY({ dongY = DONG_Y_MAC_DINH }: { dongY?: DongY }) {
  const router = useRouter();
  const [dangGui, batDau] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);

  function bam() {
    setLoi(null);
    batDau(async () => {
      let kq: KetQuaThamGia;
      try {
        kq = await dongY();
      } catch {
        setLoi("Chưa vào được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (!kq.ok) {
        setLoi(kq.loi);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={bam}
        disabled={dangGui}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 md:h-9"
      >
        {dangGui ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <CheckCircle2 aria-hidden className="size-4" />}
        Tôi đã đọc và đồng ý
      </button>
      {loi && (
        <p role="alert" className="mt-2 text-sm text-state-danger-ink">
          {loi}
        </p>
      )}
    </div>
  );
}
