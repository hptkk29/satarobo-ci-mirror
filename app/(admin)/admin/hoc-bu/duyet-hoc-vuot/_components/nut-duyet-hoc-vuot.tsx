"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { duyetHocVuotAction, tuChoiHocVuotAction } from "../_actions";

// Duyệt / từ chối MỘT yêu cầu học vượt bù — quyền `makeup:waive` (trang quyết ai thấy nút, Server Action gác lại).
// Vùng bấm ≥ 44px trên điện thoại (`min-h-11`), 36px từ 640px trở lên cho mật độ admin.

const LY_DO_TOI_THIEU = 10;

export function NutDuyetHocVuot({ requestId, soLuot }: { requestId: string; soLuot: number }) {
  const router = useRouter();
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function duyet() {
    setLoi(null);
    start(async () => {
      const kq = await duyetHocVuotAction({ requestId });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success(`Đã duyệt — cộng ${kq.luotCong ?? soLuot} lượt học bù miễn phí, tạo ${kq.soDongBu ?? 0} dòng cần bù`);
      router.refresh();
    });
  }

  return (
    <>
      <Button className="min-h-11 sm:min-h-9" disabled={pending} onClick={duyet}>
        {pending ? "Đang duyệt…" : "Duyệt"}
      </Button>
      {loi && (
        <p role="alert" className="basis-full rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
          {loi}
        </p>
      )}
    </>
  );
}

export function NutTuChoiHocVuot({ requestId, tenBe }: { requestId: string; tenBe: string }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setMo(true)}>
        Từ chối
      </Button>
      {mo && <HopTuChoi requestId={requestId} tenBe={tenBe} onDong={() => setMo(false)} />}
    </>
  );
}

function HopTuChoi({ requestId, tenBe, onDong }: { requestId: string; tenBe: string; onDong: () => void }) {
  const router = useRouter();
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;

  function tuChoi() {
    setLoi(null);
    start(async () => {
      const kq = await tuChoiHocVuotAction({ requestId, lyDo: lyDo.trim() });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã từ chối — ghi danh của bé giữ nguyên, chưa cộng lượt");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Từ chối học vượt bù của {tenBe}</DialogTitle>
          <DialogDescription>
            Ghi danh của bé giữ nguyên, không sinh dòng cần bù và không cộng lượt. Người gửi thấy lý do dưới đây; xử lý tiếp bằng cách đổi lớp hoặc đổi buổi bắt đầu ở màn Chuyển đổi.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tchv-lydo">Lý do (ít nhất {LY_DO_TOI_THIEU} ký tự)</Label>
            <Textarea id="tchv-lydo" rows={3} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
          </div>
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button variant="destructive" className={cn("min-h-11 sm:min-h-9", !du && "opacity-60")} onClick={tuChoi} disabled={pending || !du}>
              {pending ? "Đang từ chối…" : "Từ chối yêu cầu"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
