"use client";

// components/portal/nut-tham-gia-gioi-thieu.tsx — nút «Tôi đã đọc và đồng ý» ở trang «Giới thiệu bạn bè» của cổng phụ huynh. Bấm là vào luôn — KHÔNG có bước duyệt (chủ dự án chốt 25/11/2026).
// Máy chủ quyết toàn bộ (`thamGiaGioiThieuPhuHuynh`); nút chỉ gọi và nói lại kết quả. Hàm gọi máy chủ TIÊM được (`dongY`) cho test.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { thamGiaGioiThieuAction } from "@/app/(portal)/portal/gioi-thieu/_actions";
import type { KetQuaThamGiaPhuHuynh } from "@/lib/affiliate/doi-tac-phu-huynh";

type DongY = () => Promise<KetQuaThamGiaPhuHuynh>;
const DONG_Y_MAC_DINH: DongY = () => thamGiaGioiThieuAction();

export function NutThamGiaGioiThieu({ dongY = DONG_Y_MAC_DINH }: { dongY?: DongY }) {
  const router = useRouter();
  const [dangGui, batDau] = useTransition();
  const [loi, setLoi] = useState<string | null>(null);

  function bam() {
    setLoi(null);
    batDau(async () => {
      let kq: KetQuaThamGiaPhuHuynh;
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
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:w-auto"
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
