"use client";

// Nút HỌC BỔNG 100% trên trang đơn — CHỈ Quản trị tối cao (27/10/2026). Server kiểm lại quyền ở `capHocBong100Action` / `thuHoiHocBong100Action`: ẩn nút KHÔNG phải là kiểm quyền.
//
// Đơn đánh dấu học bổng qua cổng "đã có tiền" của màn Chuyển đổi mà KHÔNG cần tiền về. Không sinh Payment giả; phiếu thu đã có của đơn không bị đụng.
// Lý do BẮT BUỘC ≥ 10 ký tự (cùng ngưỡng mọi quyết định về quyền lợi học viên) — ghi vào nhật ký đơn.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Award } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { capHocBong100Action, thuHoiHocBong100Action } from "../_hoc-bong-actions";

export function NutHocBong({
  orderId,
  maDon,
  daCoHocBong,
  /** Đơn đã có dòng chuyển đổi ⇒ không thu hồi được. */
  daChuyenDoi,
  duocCap,
}: {
  orderId: string;
  maDon: string;
  daCoHocBong: boolean;
  daChuyenDoi: boolean;
  duocCap: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const router = useRouter();

  if (!duocCap) return null;
  // Đã cấp và đã dùng (có học viên chuyển đổi) ⇒ không còn việc gì để làm ở nút này.
  if (daCoHocBong && daChuyenDoi) return null;
  const thuHoi = daCoHocBong;
  const du = lyDo.trim().length >= 10;

  function gui() {
    batDau(async () => {
      const r = await (thuHoi ? thuHoiHocBong100Action : capHocBong100Action)({ orderId, lyDo: lyDo.trim() });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(thuHoi ? `Đã thu hồi học bổng của đơn ${maDon}` : `Đã cấp học bổng 100% cho đơn ${maDon} — mở được màn Chuyển đổi`);
      setMo(false);
      setLyDo("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setMo(true)}>
        <Award className="mr-1.5 h-4 w-4" aria-hidden />
        {thuHoi ? "Thu hồi học bổng 100%" : "Cấp học bổng 100%"}
      </Button>
      <Dialog open={mo} onOpenChange={(m) => !dang && setMo(m)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{thuHoi ? "Thu hồi học bổng 100%" : "Cấp học bổng 100%"} — đơn {maDon}</DialogTitle>
            <DialogDescription>
              {thuHoi
                ? "Đơn quay lại điều kiện cũ: phải có tiền về tài khoản mới chuyển đổi được."
                : "Đơn được mở màn Chuyển đổi mà không cần tiền về, vì học viên được miễn toàn bộ học phí. Hệ thống không tạo khoản thu nào; phiếu thu đã có của đơn giữ nguyên (kế toán huỷ phiếu nếu cần)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="hb-ly-do">Lý do (ít nhất 10 ký tự)</Label>
            <Textarea id="hb-ly-do" rows={3} value={lyDo} maxLength={500} onChange={(e) => setLyDo(e.target.value)} placeholder="VD: Học bổng toàn phần theo quyết định của BGĐ số …" />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setMo(false)} disabled={dang}>
              Đóng
            </Button>
            <Button className="min-h-11 sm:min-h-9" onClick={gui} disabled={dang || !du}>
              {dang ? "Đang lưu…" : thuHoi ? "Thu hồi học bổng" : "Cấp học bổng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
