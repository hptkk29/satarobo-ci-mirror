// app/(teacher)/teacher/cham-bai/_components/batch-grade.tsx — "Chấm cả lớp".
//
// Dành cho bài KIỂM TRA offline (HV không nộp online): GV nhập điểm trực tiếp cho
// từng HV trong roster → gradeBatchAction (upsert GRADED). Ô để trống = bỏ qua
// (không đụng bản nộp cũ). Chỉ hiện ở mức (b) khi bài là "Kiểm tra".
//
// Dialog CONTROLLED (open/onOpenChange) + Button onClick — KHÔNG DialogTrigger
// (pattern dialog controlled dùng chung ở site GV). shadcn thuần, màu đi qua token (xem teacher.css).
// Câu 46: props CHỈ tên học viên — KHÔNG SĐT/email/tên PH.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { gradeBatchAction } from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export interface BatchRosterItem {
  studentId: string;
  name: string;
  /** Điểm hiện có (đã chấm) — prefill ô input; null = chưa có điểm. */
  score: number | null;
}

export function BatchGrade({
  assignmentId,
  totalPoints,
  roster,
}: {
  assignmentId: string;
  totalPoints: number;
  roster: BatchRosterItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      roster.map((r) => [r.studentId, r.score != null ? String(r.score) : ""]),
    ),
  );

  function setScore(studentId: string, value: string) {
    setScores((prev) => ({ ...prev, [studentId]: value }));
  }

  function save() {
    const payload: { studentId: string; score: number }[] = [];
    for (const r of roster) {
      const raw = (scores[r.studentId] ?? "").trim();
      if (raw === "") continue; // điểm rỗng = bỏ qua (không đụng bản nộp)
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > totalPoints) {
        toast.error(`Điểm của ${r.name} phải trong khoảng 0–${totalPoints}`);
        return;
      }
      payload.push({ studentId: r.studentId, score: n });
    }
    if (payload.length === 0) {
      toast.error("Chưa nhập điểm cho học viên nào");
      return;
    }
    start(async () => {
      const res = await gradeBatchAction({ assignmentId, scores: payload });
      if (res.ok) {
        toast.success(`Đã lưu điểm cho ${res.graded} học viên`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (roster.length === 0) return null;

  return (
    <>
      {/* Dialog controlled — không DialogTrigger (pattern site GV). */}
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <ClipboardList className="mr-1.5 h-4 w-4" aria-hidden /> Chấm cả lớp
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>Chấm điểm cả lớp</DialogTitle>
            <DialogDescription>
              Nhập điểm (0–{totalPoints}) cho từng học viên. Ô để trống sẽ được
              bỏ qua.
            </DialogDescription>
          </DialogHeader>

          {/* `overflow-y-auto` một mình sẽ CẮT bề ngang khi hộp thoại hẹp hơn bảng;
              phải mở cả trục ngang thì bảng mới cuộn được thay vì bị xén. */}
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-border">
            {/* KHÔNG đặt min-w ở đây: bảng chỉ 2 cột (tên + ô điểm) và hộp thoại
                rộng 512px — ép bề rộng tối thiểu là tự sinh thanh cuộn thừa. */}
            <PhanTrangBang
          khoaGhiNho="gv-cham-hang-loat">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-4 py-2.5">
                      Học viên
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right">
                      Điểm (0–{totalPoints})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr
                      key={r.studentId}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-4 py-2 font-medium text-foreground">
                        {r.name}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={totalPoints}
                          step={0.5}
                          value={scores[r.studentId] ?? ""}
                          disabled={pending}
                          onChange={(e) => setScore(r.studentId, e.target.value)}
                          placeholder="—"
                          aria-label={`Điểm của ${r.name}`}
                          className="ml-auto w-24"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Huỷ
            </Button>
            <Button onClick={save} disabled={pending}>
              <Save className="mr-1.5 h-4 w-4" aria-hidden />
              {pending ? "Đang lưu…" : "Lưu điểm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
