"use client";

// qr-zoom.tsx — ảnh QR bấm được để PHÓNG TO cho phụ huynh quét.
//
// Lý do có file này: QR in trong bảng phiếu thu chỉ ~208px, phụ huynh đứng ở quầy
// chĩa điện thoại vào màn hình laptop rất khó bắt nét. Bấm vào ảnh → mở hộp thoại
// gần full màn với QR lớn + số tiền + nội dung CK để đọc to cho khách.
//
// Dùng chung cho CẢ HAI chỗ đang in QR trên màn đơn (sổ thu theo đợt và khu
// "Thanh toán & QR" cũ) — đừng nhân bản markup thêm lần nữa.

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function QrZoom({
  src,
  alt,
  title,
  transferContent,
  dimmed = false,
  className = "h-52 w-52",
}: {
  src: string;
  alt: string;
  /** Dòng đọc cho khách: "Đợt 1/2: 4.000.000đ". */
  title: string;
  /**
   * Nội dung chuyển khoản dạng người đọc (`NguyenVanA_84987654321_Sata4`) — sale
   * đọc chuỗi này cho phụ huynh. Từ 20/08 KHÔNG còn là mã `ORD…D1`.
   */
  transferContent?: string | null;
  /** QR đã hết hiệu lực hiển thị → làm mờ như lúc chưa phóng to. */
  dimmed?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Bấm để phóng to QR"
        className="group relative block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <img
          src={src}
          alt={alt}
          className={`${className} rounded-lg border border-border bg-card object-contain transition-opacity ${dimmed ? "opacity-40" : ""} group-hover:opacity-80`}
        />
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-neutral-900/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Maximize2 className="h-3 w-3" />
          Phóng to
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center text-lg">{title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {/* Cạnh ăn theo bề ngang hộp thoại nhưng chặn trần để không tràn màn
                hình thấp — QR vuông nên chỉ cần 1 chiều. */}
            <img
              src={src}
              alt={alt}
              className="h-auto w-full max-w-[min(80vw,26rem)] rounded-lg border border-border bg-card object-contain"
            />
            {transferContent && (
              <p className="break-all text-center text-sm text-muted-foreground">
                Nội dung CK:{" "}
                <span className="font-mono font-semibold text-foreground">{transferContent}</span>
              </p>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Phụ huynh quét bằng app ngân hàng. Giữ nguyên nội dung chuyển khoản để hệ
              thống tự đối khớp đúng đợt.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
