"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  deNghiGiaHanAction,
  duyetGiaHanAction,
  khoiPhucBaoLuuAction,
  lienHeBaoLuuAction,
  thongBaoChinhThucAction,
  tuChoiGiaHanAction,
} from "../_actions";

// Thao tác SAU KHI BẮT ĐẦU bảo lưu: ghi liên hệ · ghi thông báo chính thức · đề nghị / duyệt / từ chối gia hạn · khôi phục.
// Trang chi tiết (server) tính SẴN nút nào hiện và truyền xuống bằng cờ — component này KHÔNG tự suy quyền; server action vẫn kiểm lại từng lượt.

type Che = "lien-he" | "thong-bao" | "de-nghi" | "tu-choi-gia-han" | "khoi-phuc" | null;

export type CoThaoTac = {
  lienHe: boolean;
  thongBao: boolean;
  deNghiGiaHan: boolean;
  duyetGiaHan: boolean;
  tuChoiGiaHan: boolean;
  khoiPhuc: boolean;
};

export function ThaoTacVongDoi({
  reserveId,
  co,
  homNay,
  tranGiaHan,
  tranKhoiPhuc,
}: {
  reserveId: string;
  co: CoThaoTac;
  /** `yyyy-MM-dd` giờ VN — cận dưới của ô chọn ngày. */
  homNay: string;
  /** `yyyy-MM-dd` — cận trên gợi ý của ô chọn ngày gia hạn (server vẫn kiểm lại). */
  tranGiaHan: string | null;
  tranKhoiPhuc: string | null;
}) {
  const router = useRouter();
  const [che, setChe] = useState<Che>(null);
  const [text, setText] = useState("");
  const [ngay, setNgay] = useState("");
  const [kenh, setKenh] = useState<"ZNS" | "EMAIL" | "THU_TAY">("ZNS");
  const [dang, bat] = useTransition();

  function dong() {
    if (dang) return;
    setChe(null);
    setText("");
    setNgay("");
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    bat(async () => {
      const r =
        che === "lien-he"
          ? await lienHeBaoLuuAction({ reserveId, ghiChu: text, henNgay: ngay || null })
          : che === "thong-bao"
            ? await thongBaoChinhThucAction({ reserveId, kenh, ghiChu: text || null })
            : che === "de-nghi"
              ? await deNghiGiaHanAction({ reserveId, denNgay: ngay, lyDo: text })
              : che === "tu-choi-gia-han"
                ? await tuChoiGiaHanAction({ reserveId, lyDo: text })
                : await khoiPhucBaoLuuAction({ reserveId, denNgay: ngay, lyDo: text });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã lưu");
      setChe(null);
      setText("");
      setNgay("");
      router.refresh();
    });
  }

  function duyet() {
    bat(async () => {
      const r = await duyetGiaHanAction({ reserveId });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success("Đã duyệt gia hạn");
        router.refresh();
      }
    });
  }

  const tieuDe =
    che === "lien-he" ? "Ghi liên hệ phụ huynh"
    : che === "thong-bao" ? "Ghi đã gửi thông báo chính thức"
    : che === "de-nghi" ? "Đề nghị gia hạn bảo lưu"
    : che === "tu-choi-gia-han" ? "Từ chối / rút đề nghị gia hạn"
    : "Khôi phục hồ sơ đã chấm dứt";
  const canNgay = che === "de-nghi" || che === "khoi-phuc" || che === "lien-he";
  const batBuocNgay = che === "de-nghi" || che === "khoi-phuc";
  const tran = che === "de-nghi" ? tranGiaHan : che === "khoi-phuc" ? tranKhoiPhuc : null;
  const minLyDo = che === "khoi-phuc" ? 10 : che === "thong-bao" ? 0 : 5;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {co.lienHe && <Button type="button" variant="outline" onClick={() => setChe("lien-he")}>Ghi liên hệ</Button>}
      {co.thongBao && <Button type="button" variant="outline" onClick={() => setChe("thong-bao")}>Ghi thông báo chính thức</Button>}
      {co.deNghiGiaHan && <Button type="button" variant="outline" onClick={() => setChe("de-nghi")}>Đề nghị gia hạn</Button>}
      {co.duyetGiaHan && (
        <Button type="button" onClick={duyet} disabled={dang}>
          {dang && <Loader2 className="h-4 w-4 animate-spin" />}
          Duyệt gia hạn
        </Button>
      )}
      {co.tuChoiGiaHan && <Button type="button" variant="outline" onClick={() => setChe("tu-choi-gia-han")}>Từ chối / rút gia hạn</Button>}
      {co.khoiPhuc && <Button type="button" variant="outline" onClick={() => setChe("khoi-phuc")}>Khôi phục hồ sơ</Button>}

      {che && (
        <Dialog open onOpenChange={(o) => !o && dong()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tieuDe}</DialogTitle>
            </DialogHeader>
            <form onSubmit={gui} className="space-y-4 py-2">
              {che === "thong-bao" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Chỉ <strong>ghi nhận</strong> đã gửi — hệ thống không tự gửi. Từ lúc ghi, phụ huynh có <strong>hạn phản hồi</strong>; hết hạn mà chưa phục học
                    hoặc gia hạn thì hồ sơ bị chấm dứt tự động (không sinh yêu cầu hoàn).
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="kenh-tb">Kênh đã dùng</Label>
                    <select id="kenh-tb" value={kenh} onChange={(e) => setKenh(e.target.value as typeof kenh)} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm">
                      <option value="ZNS">Zalo (ZNS)</option>
                      <option value="EMAIL">Email</option>
                      <option value="THU_TAY">Thư / giao tay</option>
                    </select>
                  </div>
                </>
              )}
              {che === "khoi-phuc" && (
                <p className="text-sm text-muted-foreground">
                  Ngoại lệ của Quản trị tối cao: mở lại ghi danh <strong>đã đóng</strong> do chấm dứt (chỉ khi lớp còn hoạt động) và đặt hạn bảo lưu mới.
                </p>
              )}
              {canNgay && (
                <div className="space-y-1.5">
                  <Label htmlFor="ngay-vd">
                    {che === "lien-he" ? "Hẹn trả lời đến ngày (tuỳ chọn)" : che === "de-nghi" ? "Hạn mới *" : "Hạn bảo lưu mới *"}
                  </Label>
                  <Input id="ngay-vd" type="date" min={homNay} max={tran ?? undefined} value={ngay} onChange={(e) => setNgay(e.target.value)} required={batBuocNgay} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="text-vd">{che === "lien-he" ? "Nội dung liên hệ *" : che === "thong-bao" ? "Ghi chú (tuỳ chọn)" : "Lý do *"}</Label>
                <Textarea id="text-vd" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} required={che !== "thong-bao"} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={dong} disabled={dang}>Đóng</Button>
                <Button type="submit" disabled={dang || text.trim().length < minLyDo || (batBuocNgay && !ngay)}>
                  {dang && <Loader2 className="h-4 w-4 animate-spin" />}
                  {dang ? "Đang xử lý..." : "Lưu"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
