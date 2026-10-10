"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tamDungLopAction } from "../_actions";

export function FormTamDungLop({ lop, homNay }: { lop: { id: string; ten: string; soHocVien: number }[]; homNay: string }) {
  const router = useRouter();
  const [dang, bat] = useTransition();
  const [classId, setClassId] = useState("");
  const [ngayMoLai, setNgayMoLai] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [xacNhan, setXacNhan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const chon = lop.find((l) => l.id === classId);

  function gui(e: React.FormEvent) {
    e.preventDefault();
    setLoi(null);
    bat(async () => {
      const r = await tamDungLopAction({ classId, ngayMoLai: ngayMoLai || null, lyDo });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      if (r.canhBao?.length) toast.warning(r.canhBao.join("\n"));
      toast.success(`Đã tạm dừng lớp — ${r.ids?.length ?? 0} học viên`);
      router.push("/bao-luu?tab=dang");
    });
  }

  return (
    <form onSubmit={gui} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="td-lop">Lớp *</Label>
        <select id="td-lop" value={classId} onChange={(e) => { setClassId(e.target.value); setXacNhan(false); }} required className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm">
          <option value="">Chọn lớp…</option>
          {lop.map((l) => (
            <option key={l.id} value={l.id}>{l.ten} ({l.soHocVien} học viên đang học)</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="td-ngay">Dự kiến mở lại</Label>
        <Input id="td-ngay" type="date" min={homNay} value={ngayMoLai} onChange={(e) => setNgayMoLai(e.target.value)} className="sm:max-w-xs" />
        <p className="text-xs text-muted-foreground">Có ngày mở lại thì các đợt thu chưa tới hạn của từng bé được dời đúng số ngày tạm dừng.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="td-lydo">Lý do *</Label>
        <Textarea id="td-lydo" rows={3} maxLength={500} value={lyDo} onChange={(e) => setLyDo(e.target.value)} required />
      </div>
      {chon && (
        <label className="flex items-start gap-2 rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          <input type="checkbox" className="mt-1" checked={xacNhan} onChange={(e) => setXacNhan(e.target.checked)} />
          <span>
            Tôi hiểu <strong>{chon.soHocVien} học viên</strong> của lớp này sẽ chuyển sang Tạm dừng NGAY, rời danh sách lớp và nhóm chat lớp. Việc huỷ / dời buổi học vẫn làm riêng ở màn lớp.
          </span>
        </label>
      )}
      {loi && (
        <p role="alert" className="whitespace-pre-line rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">{loi}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={dang}>Quay lại</Button>
        <Button type="submit" disabled={dang || !classId || lyDo.trim().length < 5 || !xacNhan}>
          {dang && <Loader2 className="h-4 w-4 animate-spin" />}
          {dang ? "Đang xử lý..." : "Tạm dừng cả lớp"}
        </Button>
      </div>
    </form>
  );
}
