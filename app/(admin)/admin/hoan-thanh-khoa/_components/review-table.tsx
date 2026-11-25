"use client";

// Bảng duyệt ĐỀ XUẤT hoàn thành khoá do giáo viên gửi lên.
//
// Nửa còn thiếu của vòng làm việc (QA site GV vòng 1, BUG-028): trước 03/09 không màn
// nào đọc `CourseCompletionRequest`, nên mỗi lần giáo viên bấm "Đề xuất hoàn thành" là
// một dòng PENDING không ai thấy — không duyệt được, cũng không rút lại được.
//
// Nhận dữ liệu PLAIN từ page (đã scopedDb) — chỉ hiển thị và gọi Server Action.
// Duyệt là hành động KHÔNG lùi được (sinh CourseCompletion + cấp chứng chỉ), nên cả
// Duyệt lẫn Từ chối đều qua xác nhận hai bước — mẫu 2-click của repo.
import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { reviewCourseCompletion } from "../_actions";

export interface RequestRow {
  id: string;
  studentName: string;
  studentCode: string | null;
  courseName: string;
  className: string | null;
  note: string | null;
  createdAtLabel: string;
}

export function ReviewTable({ rows }: { rows: RequestRow[] }) {
  return (
    // Phân trang bọc NGAY TRONG component để bảng tự chứa — bọc ở nơi gọi thì file
    // này lọt lưới bang-coverage, và màn khác dùng lại sẽ quên bọc.
    // ⚠️ PhanTrangBang chỉ nhận ĐÚNG MỘT <table> một <tbody>; chèn thêm div vào giữa
    // là phân trang TẮT IM LẶNG (fail-safe trả bảng nguyên trạng, không báo lỗi).
    <PhanTrangBang cuonNgang tenDonVi="đề xuất" khoaGhiNho="ad-duyet-hoan-thanh">
      <table className="w-full min-w-[720px] text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2">Học viên</th>
          <th className="px-4 py-2">Khoá / Lớp</th>
          <th className="px-4 py-2">Ghi chú của giáo viên</th>
          <th className="px-4 py-2 whitespace-nowrap">Ngày đề xuất</th>
          <th className="px-4 py-2 text-right">Quyết định</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="min-w-[11rem] px-4 py-3">
              <p className="font-medium text-foreground">{r.studentName}</p>
              {r.studentCode && (
                <p className="text-xs text-muted-foreground">{r.studentCode}</p>
              )}
            </td>
            <td className="min-w-[11rem] px-4 py-3">
              <p className="text-foreground">{r.courseName}</p>
              {r.className && (
                <p className="text-xs text-muted-foreground">{r.className}</p>
              )}
            </td>
            <td className="min-w-[12rem] px-4 py-3 text-muted-foreground">
              {r.note || "—"}
            </td>
            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
              {r.createdAtLabel}
            </td>
            <td className="px-4 py-3 text-right">
              <DecisionCell row={r} />
            </td>
          </tr>
        ))}
      </tbody>
      </table>
    </PhanTrangBang>
  );
}

function DecisionCell({ row }: { row: RequestRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "APPROVED" | "REJECTED">("idle");
  const [note, setNote] = useState("");

  function submit(decision: "APPROVED" | "REJECTED") {
    start(async () => {
      const res = await reviewCourseCompletion({
        id: row.id,
        decision,
        note: note.trim() || null,
      });
      if (res.ok) {
        toast.success(
          decision === "APPROVED"
            ? `Đã duyệt hoàn thành khoá cho ${row.studentName}`
            : `Đã từ chối đề xuất của ${row.studentName}`,
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (mode === "idle") {
    return (
      <div className="flex justify-end gap-2">
        <Button size="sm" disabled={pending} onClick={() => setMode("APPROVED")}>
          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
          Duyệt
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setMode("REJECTED")}
        >
          <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
          Từ chối
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="text-xs text-muted-foreground">
        {mode === "APPROVED"
          ? "Duyệt sẽ cấp chứng chỉ hoàn thành — không lùi lại được."
          : "Từ chối đề xuất này?"}
      </p>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={
          mode === "REJECTED" ? "Lý do từ chối (nên có)" : "Ghi chú (tuỳ chọn)"
        }
        className="w-64"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "APPROVED" ? "default" : "destructive"}
          disabled={pending}
          onClick={() => submit(mode)}
        >
          {pending
            ? "Đang gửi…"
            : mode === "APPROVED"
              ? "Xác nhận duyệt"
              : "Xác nhận từ chối"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setMode("idle");
            setNote("");
          }}
        >
          Huỷ
        </Button>
      </div>
    </div>
  );
}
