"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { duyetThemBeAction, rutThemBeAction, tuChoiThemBeAction, type XungDotNhom } from "../_actions";
import { XungDotView } from "./hop-xep-case";

// Duyệt / từ chối / rút YÊU CẦU THÊM HỌC VIÊN VÀO CASE CÓ SẴN (24/10/2026) — dùng ở màn "Duyệt case" và ở màn chi tiết case.
// Duyệt và từ chối: người có `makeup:waive` (trang quyết ai thấy nút, Server Action gác lại). Rút: chỉ người đã gửi (máy chủ đòi đúng người).

export function NutDuyetThemBe({ batchId, size = "sm" }: { batchId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [loi, setLoi] = useState<string | null>(null);
  const [xungDot, setXungDot] = useState<XungDotNhom[]>([]);
  const [pending, start] = useTransition();

  function duyet() {
    setLoi(null);
    setXungDot([]);
    start(async () => {
      const kq = await duyetThemBeAction({ batchId });
      if (!kq.ok) {
        setLoi(kq.error);
        setXungDot(kq.xungDot ?? []);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã duyệt — các bé được xếp vào case, phụ huynh và giáo viên được báo");
      router.refresh();
    });
  }

  return (
    <>
      <Button size={size} className="min-h-11" disabled={pending} onClick={duyet}>
        {pending ? "Đang duyệt…" : "Duyệt"}
      </Button>
      {/* Duyệt kiểm lại MỌI luật xếp (lượt, trùng lịch, tối đa 3 bài) ở thời điểm này — lỗi hiện ngay dưới nút để người duyệt biết vì sao, rồi từ chối kèm lý do hoặc xử lý nguyên nhân. */}
      {xungDot.length > 0 ? (
        <div className="basis-full">
          <XungDotView nhom={xungDot} />
        </div>
      ) : (
        loi && (
          <p role="alert" className="basis-full rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
            {loi}
          </p>
        )
      )}
    </>
  );
}

export function NutTuChoiThemBe({ batchId, size = "sm" }: { batchId: string; size?: "sm" | "default" }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <Button size={size} variant="outline" className="min-h-11" onClick={() => setMo(true)}>
        Từ chối
      </Button>
      {mo && <HopTuChoi batchId={batchId} onDong={() => setMo(false)} />}
    </>
  );
}

function HopTuChoi({ batchId, onDong }: { batchId: string; onDong: () => void }) {
  const router = useRouter();
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;

  function tuChoi() {
    setLoi(null);
    start(async () => {
      const kq = await tuChoiThemBeAction({ batchId, lyDo: lyDo.trim() });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success("Đã từ chối — case giữ nguyên, các bé vẫn ở danh sách cần bù");
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Từ chối yêu cầu thêm học viên</DialogTitle>
          <DialogDescription>Case giữ nguyên, các bé vẫn ở danh sách cần bù và người gửi thấy lý do dưới đây.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tctb-lydo">Lý do (ít nhất {LY_DO_TOI_THIEU} ký tự)</Label>
            <Textarea id="tctb-lydo" rows={3} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} />
          </div>
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button variant="destructive" className={cn(!du && "opacity-60")} onClick={tuChoi} disabled={pending || !du}>
              {pending ? "Đang từ chối…" : "Từ chối yêu cầu"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NutRutThemBe({ batchId, size = "sm" }: { batchId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      variant="outline"
      className="min-h-11"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const kq = await rutThemBeAction({ batchId });
          if (!kq.ok) {
            toast.error(kq.error);
            return;
          }
          toast.success("Đã rút yêu cầu — các bé trở lại danh sách cần bù");
          router.refresh();
        })
      }
    >
      {pending ? "Đang rút…" : "Rút yêu cầu"}
    </Button>
  );
}
