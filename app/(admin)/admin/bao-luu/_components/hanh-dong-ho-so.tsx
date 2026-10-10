"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { duyetBaoLuuAction, huyBaoLuuAction, tuChoiBaoLuuAction } from "../_actions";

// Nút hành động trên hồ sơ bảo lưu: Duyệt · Từ chối · Huỷ. Mọi quyết định "nút nào hiện" do SERVER tính (trang chi tiết) và
// truyền xuống bằng cờ — component này KHÔNG tự suy quyền. Server action vẫn kiểm lại từng lượt (luật 12: nút hiện thì bấm
// phải làm được; ngược lại, ẩn nút không phải là cổng).

type Che = "duyet" | "tu-choi" | "huy" | null;

export function HanhDongHoSo({
  reserveId,
  duocDuyet,
  duocTuChoi,
  duocHuy,
  ngayNghiDauTien,
}: {
  reserveId: string;
  duocDuyet: boolean;
  duocTuChoi: boolean;
  duocHuy: boolean;
  /** `dd/MM/yyyy` của buổi nghỉ đầu tiên người lập khai; `null` = không khai ⇒ không có tuỳ chọn lùi ngày. */
  ngayNghiDauTien: string | null;
}) {
  const router = useRouter();
  const [che, setChe] = useState<Che>(null);
  const [lyDo, setLyDo] = useState("");
  const [lui, setLui] = useState(false);
  const [dang, bat] = useTransition();

  function dong() {
    if (dang) return;
    setChe(null);
    setLyDo("");
    setLui(false);
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    bat(async () => {
      const r =
        che === "duyet"
          ? await duyetBaoLuuAction({ reserveId, lui, ghiChu: lyDo.trim() || null })
          : che === "tu-choi"
            ? await tuChoiBaoLuuAction({ reserveId, lyDo })
            : await huyBaoLuuAction({ reserveId, lyDo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(che === "duyet" ? "Đã duyệt — học viên bắt đầu bảo lưu" : che === "tu-choi" ? "Đã từ chối hồ sơ" : "Đã huỷ hồ sơ");
      setChe(null);
      setLyDo("");
      setLui(false);
      router.refresh();
    });
  }

  const tieuDe = che === "duyet" ? "Duyệt hồ sơ bảo lưu" : che === "tu-choi" ? "Từ chối hồ sơ bảo lưu" : "Huỷ hồ sơ bảo lưu";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {duocDuyet && (
        <Button type="button" onClick={() => setChe("duyet")}>
          Duyệt
        </Button>
      )}
      {duocTuChoi && (
        <Button type="button" variant="outline" onClick={() => setChe("tu-choi")}>
          Từ chối
        </Button>
      )}
      {duocHuy && (
        <Button type="button" variant="outline" onClick={() => setChe("huy")}>
          Huỷ hồ sơ
        </Button>
      )}

      {che && (
        <Dialog open onOpenChange={(o) => !o && dong()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tieuDe}</DialogTitle>
            </DialogHeader>
            <form onSubmit={gui} className="space-y-4 py-2">
              {che === "duyet" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Duyệt xong, học viên chuyển sang <strong>Tạm dừng</strong> ngay và không còn nằm trong danh sách lớp. Hệ thống kiểm lại công nợ quá hạn ở bước này.
                  </p>
                  {ngayNghiDauTien && (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={lui} onChange={(e) => setLui(e.target.checked)} />
                      <span>
                        Tính bảo lưu từ buổi nghỉ đầu tiên <strong className="tabular-nums">{ngayNghiDauTien}</strong> (lùi ngày — các buổi từ đó không bị tính vắng).
                        Tối đa theo cấu hình; vượt thì hệ thống từ chối.
                      </span>
                    </label>
                  )}
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ly-do-bao-luu">{che === "duyet" ? "Ghi chú (tuỳ chọn)" : "Lý do *"}</Label>
                <Textarea
                  id="ly-do-bao-luu"
                  value={lyDo}
                  onChange={(e) => setLyDo(e.target.value)}
                  rows={3}
                  maxLength={500}
                  required={che !== "duyet"}
                  placeholder={che === "tu-choi" ? "VD: Đơn chưa có chữ ký phụ huynh" : che === "huy" ? "VD: Phụ huynh đổi ý, học tiếp" : ""}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={dong} disabled={dang}>
                  Đóng
                </Button>
                <Button type="submit" disabled={dang || (che !== "duyet" && lyDo.trim().length < 5)}>
                  {dang && <Loader2 className="h-4 w-4 animate-spin" />}
                  {dang ? "Đang xử lý..." : che === "duyet" ? "Duyệt" : che === "tu-choi" ? "Từ chối" : "Huỷ hồ sơ"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
