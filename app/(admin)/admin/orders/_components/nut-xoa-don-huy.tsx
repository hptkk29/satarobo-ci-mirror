"use client";

// Nút XOÁ ĐƠN ĐÃ HUỶ — xoá CỨNG, chỉ khi đơn SẠCH.
//
// Chủ dự án chốt 02/10/2026: *"các đơn bị huỷ thì thêm nút xoá để xoá chứ"*, phương án
// **xoá cứng khi đơn sạch**. Luật "sạch là gì" ở `lib/orders/xoa-don-huy.ts`.
//
// ⚠️ CHỈ HIỆN KHI ĐƠN ĐÃ HUỶ. Khác với `NutChuyenDoi` (luôn hiện, mờ kèm lý do): ở đó
// "chưa đủ điều kiện" là trạng thái TẠM — tiền về là bấm được, nên nút mờ là một lời hứa
// có thật. Ở đây "đơn chưa huỷ" không phải trạng thái chờ: muốn xoá thì phải huỷ trước,
// và huỷ là một quyết định khác hẳn. Bày một nút xoá mờ trên đơn đang sống là mời người
// ta đi tìm cách bật nó.
//
// ⚠️ Lý do BẮT BUỘC ≥10 ký tự, và server kiểm lại. Thao tác này KHÔNG hoàn tác được —
// dòng `AuditLog` ghi trước khi xoá là dấu vết duy nhất còn lại.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { xoaDonDaHuyAction } from "../_actions";

export function NutXoaDonHuy({
  orderId,
  maDon,
  /** `Order.status` — nút chỉ hiện khi `"CANCELLED"`. */
  trangThai,
  /** Chỉ Quản trị tối cao. Server kiểm lại — ẩn nút KHÔNG phải là kiểm quyền. */
  duocXoa,
}: {
  orderId: string;
  maDon: string;
  trangThai: string;
  duocXoa: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dangChay, batDau] = useTransition();
  const router = useRouter();

  if (trangThai !== "CANCELLED" || !duocXoa) return null;

  function xoa() {
    batDau(async () => {
      const r = await xoaDonDaHuyAction({ orderId, lyDo });
      if (!r.ok) {
        // Câu từ chối của server LIỆT KÊ ĐỦ thứ đang chặn (xem `lyDoKhongXoaDuoc`), nên
        // in nguyên văn — đừng rút gọn thành "không xoá được".
        toast.error(r.error);
        return;
      }
      toast.success(`Đã xoá đơn ${r.code}`);
      setMo(false);
      // Đơn không còn tồn tại ⇒ không thể ở lại trang chi tiết của nó.
      router.push("/admin/orders");
    });
  }

  return (
    <>
      <Button
        variant="outline"
        className="min-h-11 border-state-danger-ink/40 text-state-danger-ink hover:bg-state-danger-bg"
        onClick={() => setMo(true)}
      >
        <Trash2 className="h-4 w-4" />
        Xoá đơn
      </Button>

      <Dialog open={mo} onOpenChange={(v) => !dangChay && setMo(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xoá hẳn đơn {maDon}?</DialogTitle>
            <DialogDescription>
              Đơn và các dòng mô tả của nó bị xoá <b>vĩnh viễn</b> khỏi cơ sở dữ liệu —
              không hoàn tác được. Chỉ còn lại một dòng nhật ký kiểm toán ghi ai xoá, lúc
              nào, vì sao.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Nếu đơn còn bất kỳ khoản thu, lượt tiền đã rót, mã QR đã phát, hoá đơn, lượt
            xuất kho hay dòng số dư nào thì hệ thống sẽ <b>từ chối</b> và nói rõ vướng gì.
          </p>

          <div className="space-y-1.5">
            <label htmlFor="ly-do-xoa-don" className="text-sm font-medium">
              Lý do xoá <span className="text-state-danger-ink">*</span>
            </label>
            <Textarea
              id="ly-do-xoa-don"
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              placeholder="Ví dụ: tạo nhầm 3 đơn trùng cho cùng một khách, giữ lại đơn ORD-…"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Tối thiểu 10 ký tự · đang có {lyDo.trim().length}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMo(false)} disabled={dangChay}>
              Thôi
            </Button>
            <Button
              variant="destructive"
              onClick={xoa}
              // Tắt nút khi lý do chưa đủ: server cũng chặn, nhưng để người dùng bấm rồi
              // ăn từ chối vì một điều kiện họ NHÌN THẤY được là phí một vòng.
              disabled={dangChay || lyDo.trim().length < 10}
            >
              {dangChay ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Xoá hẳn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
