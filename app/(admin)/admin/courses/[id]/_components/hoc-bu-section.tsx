"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MA_CA_KHOA } from "@/lib/hoc-bu/dong-can-bu";
import type { HocPhanKhoa } from "@/lib/hoc-bu/luot-bu";
import { luuCauHinhHocBuAction } from "../_actions";

// Cấu hình học bù của khoá (docs/hoc-bu/DAC-TA.md §3.1): bật/tắt + lượt từng học phần.
export function HocBuSection({
  courseId,
  choPhepHocBu,
  hocPhan,
  canEdit,
}: {
  courseId: string;
  choPhepHocBu: boolean;
  hocPhan: HocPhanKhoa[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [bat, setBat] = useState(choPhepHocBu);
  const [luot, setLuot] = useState(() => hocPhan.map((h) => String(h.luotBu)));
  const [pending, start] = useTransition();

  const tong = bat ? luot.reduce((s, v) => s + (Number(v) || 0), 0) : 0;

  function luu() {
    start(async () => {
      const kq = await luuCauHinhHocBuAction(courseId, {
        choPhepHocBu: bat,
        luot: hocPhan.map((h, i) => ({ moduleCode: h.moduleCode, luotBu: Math.max(0, Math.floor(Number(luot[i]) || 0)) })),
      });
      if (!kq.ok) {
        toast.error(kq.error ?? "Không lưu được");
        return;
      }
      toast.success("Đã lưu cấu hình học bù");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Học bù</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Số lượt bù miễn phí của từng học phần. Học viên nhận lượt của các học phần đã mua
            (phần lẻ hơn nửa học phần được tính thêm một học phần), dùng chung cho cả khoá.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Switch checked={bat} onCheckedChange={setBat} disabled={!canEdit || pending} />
          {bat ? "Cho học bù" : "Không học bù"}
        </label>
      </div>

      {!bat ? (
        <p className="text-sm text-muted-foreground">
          Khoá này không học bù (học viên phải học đủ) — buổi vắng không vào danh sách cần bù.
        </p>
      ) : hocPhan.length === 0 ? (
        <p className="text-sm text-muted-foreground">Khoá chưa có giáo trình nên chưa chia được học phần.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3">Học phần</th>
                <th className="py-1.5 pr-3">Số buổi</th>
                <th className="py-1.5">Lượt bù</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {hocPhan.map((h, i) => (
                <tr key={h.moduleCode || "ca-khoa"}>
                  <td className="py-2 pr-3 font-medium">{h.moduleCode === MA_CA_KHOA ? "Cả khoá" : h.moduleCode}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{h.soBuoi}</td>
                  <td className="py-2">
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      className="h-8 w-20"
                      value={luot[i]}
                      disabled={!canEdit || pending}
                      onChange={(e) => setLuot((cu) => cu.map((v, j) => (j === i ? e.target.value : v)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Mua đủ khoá: {tong} lượt bù. Học phần lấy thẳng từ giáo trình của khoá —{" "}
            <Link href="/curriculums" className="font-medium text-primary hover:underline">
              chia lại ở màn Giáo trình
            </Link>
            .
          </p>
        </div>
      )}

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={luu} disabled={pending}>
            {pending ? "Đang lưu…" : "Lưu cấu hình học bù"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Bạn chỉ có quyền xem cấu hình này.</p>
      )}
    </div>
  );
}
