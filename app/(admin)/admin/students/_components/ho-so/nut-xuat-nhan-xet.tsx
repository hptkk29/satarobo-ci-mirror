"use client";

// Nút "Xuất nhận xét" trên khối nhận xét buổi ở hồ sơ học viên (28/10/2026): mở hộp chọn MỘT HOẶC NHIỀU buổi đang có nhận xét
// của học viên này, rồi mở PDF (mỗi buổi một trang, xếp theo thứ tự buổi) qua /api/admin/reports/nhan-xet-buoi — gác
// `session-feedback:share`. Sale/QLCS dùng để lấy nhận xét về gửi phụ huynh qua Zalo.
//
// Danh sách buổi tới từ server (chính `getStudentFeedback`, cùng nguồn với các thẻ bên dưới) — component này không tự tra gì.
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  dungDuongDanXuat,
  sapXepDanhSachChon,
  TOI_DA_BUOI_MOT_LAN as TOI_DA,
  type BuoiXuatDuoc,
} from "@/lib/students/xuat-nhan-xet";

export function NutXuatNhanXet({
  studentId,
  tenHocVien,
  buoi,
}: {
  studentId: string;
  tenHocVien: string;
  buoi: BuoiXuatDuoc[];
}) {
  const [mo, setMo] = useState(false);
  const [chon, setChon] = useState<ReadonlySet<string>>(new Set());
  const ds = useMemo(() => sapXepDanhSachChon(buoi), [buoi]);
  if (ds.length === 0) return null;

  const daChon = ds.filter((b) => chon.has(b.id));
  const vuot = daChon.length > TOI_DA;
  const doi = (id: string) =>
    setChon((cu) => {
      const moi = new Set(cu);
      if (!moi.delete(id)) moi.add(id);
      return moi;
    });
  const moPdf = () => {
    window.open(dungDuongDanXuat(studentId, daChon.map((b) => b.id)), "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={mo} onOpenChange={setMo}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <FileText aria-hidden className="size-3.5" />
            Xuất nhận xét (PDF)
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Xuất nhận xét — {tenHocVien}</DialogTitle>
          <DialogDescription>
            Chọn một hoặc nhiều buổi. Mỗi buổi là một trang PDF, xếp theo thứ tự buổi.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground" role="status" aria-live="polite">
            Đã chọn {daChon.length}/{ds.length} buổi
          </span>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setChon(new Set(ds.slice(0, TOI_DA).map((b) => b.id)))}>
              Chọn tất cả
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setChon(new Set())} disabled={daChon.length === 0}>
              Bỏ chọn
            </Button>
          </div>
        </div>

        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {ds.map((b) => (
            <li key={b.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/60">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={chon.has(b.id)}
                  onChange={() => doi(b.id)}
                />
                <span className="min-w-0 text-sm">
                  <span className="font-semibold text-foreground">{b.buoi !== null ? `Buổi ${b.buoi}` : "Buổi học"}</span>
                  <span className="tabular-nums text-muted-foreground"> · {b.ngay}</span>
                  {b.lop && <span className="text-muted-foreground"> · {b.lop}</span>}
                  {b.ten && <span className="block truncate text-foreground/80">{b.ten}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>

        {vuot && (
          <p role="alert" className="text-xs text-state-danger-ink">
            Chỉ xuất tối đa {TOI_DA} buổi mỗi lần — bỏ bớt vài buổi.
          </p>
        )}

        <DialogFooter>
          <Button type="button" onClick={moPdf} disabled={daChon.length === 0 || vuot}>
            <FileText aria-hidden className="size-4" />
            Xuất PDF{daChon.length > 0 ? ` (${daChon.length} buổi)` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
