"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, TriangleAlert, Loader2 } from "lucide-react";
import { setMediaConsentAction } from "@/app/(portal)/portal/ho-so-con/chi-tiet/actions";

// #08 (L7) — toggle đồng ý dùng hình ảnh cho 1 con (con đang chọn). Bật = 1 chạm;
// THU HỒI (phá huỷ, ẩn ảnh ngay) = 2 chạm xác nhận. studentId gửi qua Server Action
// body — KHÔNG lộ trên URL (PHƯƠNG ÁN A).
export function MediaConsentToggle({
  studentId,
  studentName,
  consentGranted,
}: {
  studentId: string;
  studentName: string;
  consentGranted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  function submit(grant: boolean) {
    start(async () => {
      const res = await setMediaConsentAction({ studentId, grant });
      if (res.ok) {
        toast.success(
          grant
            ? "Đã bật đồng ý dùng hình ảnh"
            : "Đã thu hồi đồng ý — ảnh của con sẽ được ẩn ngay",
        );
        setConfirmRevoke(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Không cập nhật được đồng ý");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {consentGranted ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-xs font-bold text-success">
            <ShieldCheck className="size-4" /> Đã đồng ý hình ảnh
          </span>
          {confirmRevoke ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />} Xác
                nhận thu hồi
              </button>
              <button
                type="button"
                onClick={() => setConfirmRevoke(false)}
                disabled={pending}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/40"
              >
                Huỷ
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRevoke(true)}
              disabled={pending}
              className="text-xs font-semibold text-destructive hover:underline disabled:opacity-60"
            >
              Thu hồi đồng ý
            </button>
          )}
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-caution/10 px-3 py-2 text-xs font-bold text-caution">
            <TriangleAlert className="size-4" /> Chưa đồng ý hình ảnh
          </span>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-3.5 animate-spin" />} Đồng ý
            dùng hình ảnh
          </button>
        </>
      )}
      <p className="max-w-[16rem] text-right text-[11px] leading-snug text-muted-foreground">
        Cho phép trung tâm dùng ảnh hoạt động của {studentName} tại lớp. Có thể
        thu hồi bất cứ lúc nào — ảnh sẽ được ẩn ngay.
      </p>
    </div>
  );
}
