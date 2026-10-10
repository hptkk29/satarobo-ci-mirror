"use client";

// Thu hồi sớm một chính sách — lý do BẮT BUỘC (Sale đọc đúng câu này trong thông báo), bấm xác
// nhận HAI lần vì không hoàn tác được (muốn áp lại thì ban hành văn bản mới).
//
// ⚠️ `router.refresh()` không reset state của component client — tự xoá ô sau khi xong.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { thuHoiAction } from "../_actions";

const LY_DO_TOI_THIEU = 10;

export function NutThuHoi({ id, maVanBan }: { id: string; maVanBan: string }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [lanHai, setLanHai] = useState(false);
  const [pending, startTransition] = useTransition();
  const du = lyDo.trim().length >= LY_DO_TOI_THIEU;

  function dong(v: boolean) {
    setMo(v);
    if (!v) {
      setLyDo("");
      setLanHai(false);
    }
  }

  function xacNhan() {
    if (!du) return;
    if (!lanHai) {
      setLanHai(true);
      return;
    }
    startTransition(async () => {
      const kq = await thuHoiAction({ id, lyDo: lyDo.trim() });
      if (kq.ok) {
        toast.success(
          kq.data.soNguoiDuocBao > 0
            ? `Đã thu hồi ${maVanBan} — đã báo ${kq.data.soNguoiDuocBao} người`
            : `Đã thu hồi ${maVanBan}`,
        );
        dong(false);
        router.refresh();
      } else {
        toast.error(kq.error);
        setLanHai(false);
      }
    });
  }

  return (
    <Dialog open={mo} onOpenChange={dong}>
      <Button type="button" variant="outline" onClick={() => setMo(true)} className="text-state-danger-ink hover:text-state-danger-ink">
        Thu hồi
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thu hồi {maVanBan}?</DialogTitle>
          <DialogDescription>
            Chính sách hết hiệu lực ngay từ hôm nay, mọi mã voucher của nó bị tắt, và người tra cứu trong phạm vi
            áp dụng nhận thông báo kèm lý do. Không hoàn tác được — muốn áp lại thì ban hành văn bản mới.
          </DialogDescription>
        </DialogHeader>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Lý do thu hồi <span className="text-state-danger-ink">*</span>
          </span>
          <Textarea
            value={lyDo}
            onChange={(e) => {
              setLyDo(e.target.value);
              setLanHai(false);
            }}
            rows={3}
            maxLength={500}
            disabled={pending}
            placeholder="VD: Hết ngân sách chương trình, dừng từ hôm nay theo chỉ đạo của Giám đốc."
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Tối thiểu {LY_DO_TOI_THIEU} ký tự — Sale đọc đúng câu này trong thông báo.
          </span>
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => dong(false)} disabled={pending}>
            Để sau
          </Button>
          <Button type="button" variant="destructive" onClick={xacNhan} disabled={!du || pending}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {lanHai ? "Bấm lần nữa để thu hồi" : "Thu hồi chính sách"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
