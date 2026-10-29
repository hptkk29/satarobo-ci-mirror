"use client";

// Nút NGUY HIỂM có XÁC NHẬN HAI BƯỚC + LÝ DO BẮT BUỘC.
//   Bước 1: bấm nút → mở hộp thoại nói rõ HẬU QUẢ (không thực thi gì).
//   Bước 2: nhập lý do (≥ 10 ký tự sau khi cắt khoảng trắng) → bấm nút xác nhận trong hộp.
// Nút xác nhận KHÔNG bấm được khi lý do chưa đủ — và nói thẳng còn thiếu gì (luật 12: nút phải làm thật, không im lặng vô hiệu).
// Lý do đi cùng yêu cầu lên máy chủ và vào nhật ký; máy chủ KIỂM LẠI (đừng coi chặn ở đây là cổng).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const LY_DO_TOI_THIEU_UI = 10;

export type KetQuaHanhDong = { ok: true } | { ok: false; error: string };

export function NutLyDo({
  nhan,
  tieuDe,
  moTa,
  nhanXacNhan,
  nguyHiem = true,
  disabled = false,
  thongBaoXong,
  truongThem,
  kiemThem,
  chay,
  className,
  bienThe = "outline",
}: {
  nhan: string;
  tieuDe: string;
  moTa: React.ReactNode;
  nhanXacNhan: string;
  nguyHiem?: boolean;
  disabled?: boolean;
  thongBaoXong?: string;
  /** Ô nhập thêm đặt trên ô lý do (vd chọn trạng thái hợp đồng). */
  truongThem?: React.ReactNode;
  /** Kiểm các ô thêm; trả câu lỗi để chặn xác nhận. */
  kiemThem?: () => string | null;
  chay: (lyDo: string) => Promise<KetQuaHanhDong>;
  className?: string;
  bienThe?: "outline" | "default" | "destructive";
}) {
  const router = useRouter();
  const [mo, datMo] = useState(false);
  const [lyDo, datLyDo] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  const du = lyDo.trim().length >= LY_DO_TOI_THIEU_UI;
  const loiThem = kiemThem ? kiemThem() : null;

  function dong() {
    if (dangChay) return;
    datMo(false);
    datLyDo("");
    datLoi(null);
  }

  function xacNhan() {
    if (!du || loiThem) return;
    batDau(async () => {
      const kq = await chay(lyDo.trim());
      if (kq.ok) {
        toast.success(thongBaoXong ?? "Đã thực hiện.");
        datMo(false);
        datLyDo("");
        datLoi(null);
        router.refresh();
      } else {
        datLoi(kq.error);
        // Hành động thất bại vẫn có thể đã đổi dữ liệu (version tăng, hồ sơ rời hàng đợi): làm mới để lần bấm sau không dùng version cũ. Hộp thoại giữ nguyên.
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={bienThe}
        disabled={disabled}
        onClick={() => datMo(true)}
        className={className ?? "h-auto min-h-11 max-w-full whitespace-normal px-3 py-1.5 text-sm"}
        {...(nguyHiem ? { "data-nguy-hiem": "true" } : {})}
      >
        {nhan}
      </Button>
      <Dialog open={mo} onOpenChange={(m) => (m ? datMo(true) : dong())}>
        {/* `admin-scope`: Dialog render qua PORTAL ra ngoài khung admin — thiếu class này nút lấy màu `--primary` của :root. */}
        <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tieuDe}</DialogTitle>
            <DialogDescription render={<div />}>{moTa}</DialogDescription>
          </DialogHeader>
          {truongThem}
          <div className="grid gap-1.5">
            <label htmlFor="ly-do-hanh-dong" className="text-sm font-medium">
              Lý do (bắt buộc, ghi vào nhật ký)
            </label>
            <Textarea
              id="ly-do-hanh-dong"
              value={lyDo}
              onChange={(e) => datLyDo(e.target.value)}
              rows={3}
              maxLength={500}
              aria-invalid={lyDo.length > 0 && !du}
              aria-describedby="ly-do-goi-y"
              disabled={dangChay}
              placeholder="VD: Nghi lộ khoá trong log của đội Agent"
            />
            <p id="ly-do-goi-y" className={lyDo.length > 0 && !du ? "text-xs text-state-danger-ink" : "text-xs text-muted-foreground"}>
              {du ? "Đủ điều kiện xác nhận." : `Cần ít nhất ${LY_DO_TOI_THIEU_UI} ký tự (đang có ${lyDo.trim().length}).`}
            </p>
          </div>
          {loiThem ? (
            <p role="alert" className="text-xs text-state-danger-ink">
              {loiThem}
            </p>
          ) : null}
          {loi ? (
            <p role="alert" className="rounded-md bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={dong} disabled={dangChay}>
              Huỷ
            </Button>
            <Button
              type="button"
              variant={nguyHiem ? "destructive" : "default"}
              // Repo chưa khai `--destructive-foreground` ⇒ chữ trắng tường minh trên nền đỏ (đo 4,7:1) — tiền lệ hop-bi-mat.tsx.
              className={nguyHiem ? "min-h-11 text-white" : "min-h-11"}
              disabled={!du || !!loiThem || dangChay}
              onClick={xacNhan}
            >
              {dangChay ? "Đang thực hiện…" : nhanXacNhan}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
