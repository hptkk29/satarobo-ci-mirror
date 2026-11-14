"use client";

// Bảng học viên của 1 lớp ở màn "Hoàn thành khoá" — client cho tìm kiếm + đề xuất.
// Server (page.tsx) truyền rows PLAIN (scopedDb + computeAttendanceSummary). Thêm cột
// "Chuyển sang" (lộ trình chuyển cấp) + trạng thái Đã hoàn thành / Chờ duyệt / nút
// "Đề xuất hoàn thành" (proposeCourseCompletion — GV đề xuất, trung tâm duyệt).
// ⚠️ Câu 46: payload chỉ TÊN học viên — KHÔNG SĐT/email/tên phụ huynh.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CANH_BAO_LABEL, canhBaoDeXuat } from "@/lib/completion/de-xuat";
import { CheckCircle2, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "../../_components/ui/list-toolbar";
import { proposeCourseCompletion } from "../_actions";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export type CompletionTableRow = {
  /** enrollment id — key ổn định + tham số đề xuất. */
  id: string;
  name: string;
  attended: number;
  absent: number;
  needMakeup: number;
  /** có CourseCompletion (đã xác nhận hoàn thành). */
  passed: boolean;
  certificateCode: string | null;
  completedAtLabel: string | null;
  /** xếp loại cuối khoá (CourseCompletion.finalGrade). */
  finalGrade: string | null;
  /** khoá kế tiếp (lộ trình chuyển cấp) — tên. */
  nextCourseName: string | null;
  /** đang có đề xuất hoàn thành chờ duyệt. */
  requestPending: boolean;
};

export function CompletionTable({
  rows,
  completedSessions,
  heldSessions,
}: {
  rows: CompletionTableRow[];
  completedSessions: number;
  /** Số buổi ĐÃ DẠY — chỉ dùng để cảnh báo khi đề xuất, không hiển thị. */
  heldSessions: number;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "done" | "open">(
    "all",
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (status === "pending" && !r.requestPending) return false;
      if (status === "done" && !r.passed) return false;
      // "Chưa đề xuất" = chưa hoàn thành và chưa có đề xuất chờ duyệt.
      if (status === "open" && (r.passed || r.requestPending)) return false;
      return true;
    });
  }, [rows, query, status]);

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên học viên..."
        filters={[
          {
            value: status,
            onChange: (v) => setStatus(v as typeof status),
            options: [
              { value: "all", label: "Tất cả trạng thái" },
              { value: "open", label: "Chưa đề xuất" },
              { value: "pending", label: "Chờ duyệt" },
              { value: "done", label: "Đã hoàn thành" },
            ],
          },
        ]}
      />

      <section className="t-card overflow-hidden">
        <PhanTrangBang cuonNgang
          khoaGhiNho="gv-hoan-thanh">
          <table className="min-w-[660px] w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-3">
                  Học viên
                </th>
                <th scope="col" className="px-4 py-3">
                  Chuyên cần
                </th>
                {/* Hai cột "Chuyển sang" và "Kết quả" đã GỠ (quyết định #5, 03/09).
                    `Course.nextCourseId` là cột CHẾT — 0 đường ghi trong toàn repo kể
                    cả scripts và tests, nên cột luôn in "—" ở 7/7 dòng và chỉ làm bảng
                    rộng thêm. Mở lại khi có nguồn dữ liệu thật. */}
                <th scope="col" className="px-4 py-3">
                  Hoàn thành khoá
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Không tìm thấy học viên phù hợp.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                          {initialsOf(r.name)}
                        </span>
                        <span className="font-medium text-foreground">
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {completedSessions === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Chưa có buổi nào
                        </span>
                      ) : (
                        <div>
                          <p className="font-medium text-foreground">
                            {r.attended}/{completedSessions} buổi
                          </p>
                          {r.absent > 0 || r.needMakeup > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Vắng {r.absent}
                              {r.needMakeup > 0
                                ? ` · chờ bù ${r.needMakeup}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CompletionCell
                        row={r}
                        heldSessions={heldSessions}
                        totalSessions={completedSessions}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </section>
    </>
  );
}

function CompletionCell({
  row: r,
  heldSessions,
  totalSessions,
}: {
  row: CompletionTableRow;
  heldSessions: number;
  totalSessions: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (r.passed) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge
          variant="outline"
          className="w-fit border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Đã hoàn thành ·{" "}
          {r.certificateCode}
        </Badge>
        {r.completedAtLabel && (
          <span className="text-xs text-muted-foreground">
            {r.completedAtLabel}
          </span>
        )}
      </div>
    );
  }
  if (r.requestPending) {
    return (
      <Badge
        variant="outline"
        className="w-fit border-state-warning-soft bg-state-warning-soft text-state-warning-ink dark:border-state-warning"
      >
        Chờ duyệt
      </Badge>
    );
  }
  function propose() {
    start(async () => {
      const res = await proposeCourseCompletion({ enrollmentId: r.id });
      if (res.ok) {
        toast.success("Đã gửi đề xuất hoàn thành — chờ trung tâm duyệt");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // Xác nhận HAI BƯỚC (mẫu 2-click của repo) thay vì gửi thẳng: đề xuất là hành động
  // ghi, gửi lên trung tâm, và giáo viên KHÔNG tự rút lại được — trung tâm phải từ
  // chối hộ. Bấm nhầm một cái là một vòng làm việc của người khác (QA vòng 1,
  // BUG-028).
  const canhBao = canhBaoDeXuat({
    attended: r.attended,
    heldSessions,
    totalSessions,
  });

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
        Đề xuất hoàn thành
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {canhBao.length > 0 && (
        <ul className="text-xs text-state-warning-ink">
          {canhBao.map((c) => (
            <li key={c}>• {CANH_BAO_LABEL[c]}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" disabled={pending} onClick={propose}>
          {pending ? "Đang gửi…" : "Xác nhận gửi"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Huỷ
        </Button>
      </div>
    </div>
  );
}
