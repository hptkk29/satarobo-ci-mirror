"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { duyetHocVuotAction, tuChoiHocVuotAction } from "../_actions";

// Duyệt / từ chối MỘT yêu cầu học vượt bù — quyền `makeup:waive` (trang quyết ai thấy nút, Server Action gác lại).
// Vùng bấm ≥ 44px trên điện thoại (`min-h-11`), 36px từ 640px trở lên cho mật độ admin.

const LY_DO_TOI_THIEU = 10;

/**
 * Duyệt = mở hộp xác nhận có ô "số lượt bù duyệt" (mặc định = số Sale xin). QLCS không đồng ý số Sale xin thì sửa 1 ≤ số ≤ số buổi phải học vượt; khác số Sale xin ⇒ phải ghi lý do
 * (vd: "chia 3+2+2 bài"). Một lượt = MỘT buổi bù, và một buổi bù có thể gom nhiều bài — nên giảm số lượt là giảm số buổi bé được xếp bù.
 */
export function NutDuyetHocVuot({ requestId, tenBe, soSaleXin, soPhaiBu }: { requestId: string; tenBe: string; soSaleXin: number; soPhaiBu: number }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <Button className="min-h-11 sm:min-h-9" onClick={() => setMo(true)}>
        Duyệt
      </Button>
      {mo && <HopDuyet requestId={requestId} tenBe={tenBe} soSaleXin={soSaleXin} soPhaiBu={soPhaiBu} onDong={() => setMo(false)} />}
    </>
  );
}

function HopDuyet({ requestId, tenBe, soSaleXin, soPhaiBu, onDong }: { requestId: string; tenBe: string; soSaleXin: number; soPhaiBu: number; onDong: () => void }) {
  const router = useRouter();
  const [soChuoi, setSoChuoi] = useState(String(soSaleXin));
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const so = Number(soChuoi);
  const hopLe = soChuoi.trim() !== "" && Number.isInteger(so) && so >= 1 && so <= soPhaiBu;
  const doi = hopLe && so !== soSaleXin;
  const thieuLyDo = doi && lyDo.trim().length < LY_DO_TOI_THIEU;

  function duyet() {
    setLoi(null);
    start(async () => {
      const kq = await duyetHocVuotAction({ requestId, soBuoiBu: so, ...(doi ? { lyDo: lyDo.trim() } : {}) });
      if (!kq.ok) {
        setLoi(kq.error);
        toast.error(kq.error);
        return;
      }
      toast.success(`Đã duyệt — cộng ${kq.luotCong ?? so} lượt học bù miễn phí, tạo ${kq.soDongBu ?? 0} dòng cần bù`);
      onDong();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(m) => !m && !pending && onDong()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duyệt học vượt bù cho {tenBe}</DialogTitle>
          <DialogDescription>
            Bé phải học vượt {soPhaiBu} buổi; Sale xin bù trong {soSaleXin} buổi. Không đồng ý số Sale xin thì sửa số lượt dưới đây — đó là số buổi bù bé được xếp (một buổi bù có thể gom nhiều bài).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dhv-so">Số lượt bù duyệt (1 – {soPhaiBu})</Label>
            <Input id="dhv-so" type="number" inputMode="numeric" min={1} max={soPhaiBu} step={1} value={soChuoi} onChange={(e) => setSoChuoi(e.target.value)} className="min-h-11 sm:min-h-9" />
            {!hopLe && <p className="text-xs text-[color:var(--state-danger)]">Nhập số nguyên từ 1 đến {soPhaiBu}.</p>}
          </div>
          {doi && (
            <div className="space-y-1.5">
              <Label htmlFor="dhv-lydo">
                Lý do đổi từ {soSaleXin} sang {so} lượt (ít nhất {LY_DO_TOI_THIEU} ký tự)
              </Label>
              <Textarea id="dhv-lydo" rows={3} value={lyDo} onChange={(e) => setLyDo(e.target.value)} maxLength={500} placeholder="Ví dụ: chia 3 buổi bù, mỗi buổi gom 3 + 2 + 2 bài" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Duyệt ⇒ cộng <b className="tabular-nums text-foreground">{hopLe ? so : "—"}</b> lượt học bù miễn phí và tạo {soPhaiBu} dòng cần bù.
          </p>
          {loi && (
            <p role="alert" className="rounded-lg bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
              {loi}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={onDong} disabled={pending}>
              Đóng
            </Button>
            <Button className={cn("min-h-11 sm:min-h-9", (!hopLe || thieuLyDo) && "opacity-60")} onClick={duyet} disabled={pending || !hopLe || thieuLyDo}>
              {pending ? "Đang duyệt…" : doi ? `Duyệt ${so} lượt` : "Duyệt"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
