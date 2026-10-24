"use client";

// Cấp 1 của màn điểm danh: DANH SÁCH LỚP. Bấm một lớp → mở danh sách buổi của lớp đó.
//
// Ô lọc cơ sở đi qua URL (`?centerId=`) vì server phải truy vấn lại theo cơ sở; ô tìm
// và ô lọc trạng thái lọc tại chỗ. Thứ tự do server quyết (lớp còn nợ nhiều buổi nhất
// lên trước) — ở đây chỉ được BỚT dòng, không xếp lại.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Search, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";

export interface AttendanceClassRow {
  id: string;
  name: string;
  classCode: string;
  status: string;
  centerName: string;
  courseName: string;
  teacherName: string;
  timeLabel: string;
  roster: number;
  /** Tổng số buổi (không tính buổi huỷ). */
  totalSessions: number;
  /** Số buổi đã tới giờ. */
  heldSessions: number;
  /** Số buổi đã bấm "Hoàn tất buổi". */
  doneSessions: number;
  /** Đã tới giờ mà chưa chốt = việc còn nợ. */
  pendingSessions: number;
}

const ALL = "ALL";

const STATUS_META: Record<string, { label: string; tone: PillTone }> = {
  PLANNED: { label: "Đang lên KH", tone: "muted" },
  RECRUITING: { label: "Tuyển sinh", tone: "info" },
  PENDING_APPROVAL: { label: "Chờ duyệt", tone: "warning" },
  ACTIVE: { label: "Đang dạy", tone: "success" },
  COMPLETED: { label: "Hoàn thành", tone: "brand" },
  CANCELLED: { label: "Huỷ", tone: "danger" },
};

function statusMeta(s: string): { label: string; tone: PillTone } {
  return STATUS_META[s] ?? { label: s, tone: "muted" };
}

export function AttendanceClassList({
  rows,
  centers,
  centerId,
}: {
  rows: AttendanceClassRow[];
  /** Rỗng = người dùng chỉ thấy một cơ sở ⇒ không bày ô lọc cho rối. */
  centers: { id: string; name: string }[];
  centerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(ALL);

  const statusOptions = useMemo(() => {
    const present = [...new Set(rows.map((r) => r.status))];
    return [
      { value: ALL, label: "Mọi trạng thái" },
      ...present.map((s) => ({ value: s, label: statusMeta(s).label })),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== ALL && r.status !== status) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.classCode.toLowerCase().includes(q) ||
        r.courseName.toLowerCase().includes(q) ||
        r.teacherName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, status]);

  const totalPending = useMemo(
    () => filtered.reduce((n, r) => n + r.pendingSessions, 0),
    [filtered],
  );

  function pushCenter(next: string) {
    startTransition(() => {
      router.push(next ? `/attendance?centerId=${next}` : "/attendance");
    });
  }

  const centerOptions = [
    { value: "", label: "Tất cả cơ sở" },
    ...centers.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm lớp, mã lớp, khoá, giáo viên..."
            aria-label="Tìm lớp"
            className="h-10 w-full rounded-xl border border-border bg-muted/50 pr-4 pl-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-card focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {centers.length > 0 && (
            <Select
              value={centerId}
              onValueChange={(v) => {
                if (v !== null) pushCenter(v);
              }}
            >
              <SelectTrigger
                aria-label="Lọc theo cơ sở"
                className="h-10 w-auto min-w-[11rem] rounded-xl font-medium"
                disabled={pending}
              >
                <SelectValue>
                  {(v: string | null) =>
                    centerOptions.find((o) => o.value === (v ?? ""))?.label ??
                    "Tất cả cơ sở"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {centerOptions.map((o) => (
                  <SelectItem key={o.value || "all"} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={status}
            onValueChange={(v) => {
              if (v !== null) setStatus(v);
            }}
          >
            <SelectTrigger
              aria-label="Lọc theo trạng thái lớp"
              className="h-10 w-auto min-w-[10rem] rounded-xl font-medium"
            >
              <SelectValue>
                {(v: string | null) =>
                  statusOptions.find((o) => o.value === v)?.label ?? "Mọi trạng thái"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{filtered.length}</span> lớp ·{" "}
        <span className="font-semibold text-foreground">{totalPending}</span> buổi đã dạy
        chưa chốt hoàn tất
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          title="Không có lớp nào khớp bộ lọc"
          description="Thử đổi từ khoá, đổi cơ sở hoặc chọn lại trạng thái."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* `relative` KHÔNG thừa: cột cuối có <span className="sr-only">Mở</span>, mà
              `sr-only` là `position: absolute`. Không có tổ tiên nào được ĐỊNH VỊ thì nó
              neo vào khung chứa gốc của trang — tức thoát khỏi vùng cuộn này và đứng ở
              toạ độ x≈880px (bề rộng `min-w` của bảng) tính theo cả trang. Ở 375px điều đó
              kéo <body> trượt ngang mấy trăm pixel sang một mảng trắng rỗng. Đây đúng là
              lỗi đã ghi ở `app/(teacher)/teacher/teacher.css` và `.t-card` bên đó chặn
              bằng cùng một dòng này; site admin không có class tương đương nên phải đặt
              tại chỗ. `overflow-hidden` ở thẻ ngoài KHÔNG cứu được: phần tử absolute không
              bị cắt bởi tổ tiên không định vị. */}
          <div className="relative overflow-x-auto">
            <PhanTrangBang tenDonVi="lớp">
              <table className="w-full min-w-[880px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className={adminTh}>
                      Lớp
                    </th>
                    <th scope="col" className={adminTh}>
                      Cơ sở
                    </th>
                    <th scope="col" className={adminTh}>
                      Giáo viên
                    </th>
                    <th scope="col" className={adminTh}>
                      Sĩ số
                    </th>
                    <th scope="col" className={adminTh}>
                      Buổi đã dạy
                    </th>
                    <th scope="col" className={adminTh}>
                      Chưa chốt
                    </th>
                    <th scope="col" className={adminTh}>
                      Trạng thái
                    </th>
                    <th scope="col" className={cn(adminTh, "text-right")}>
                      <span className="sr-only">Mở</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const meta = statusMeta(r.status);
                    return (
                      <tr key={r.id} className={adminTr}>
                        <td className={cn(adminTd, "max-w-[24rem]")}>
                          <Link
                            href={`/attendance?classId=${r.id}`}
                            className="block truncate font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {r.name}
                          </Link>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[r.classCode, r.courseName, r.timeLabel]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </td>
                        <td className={adminTd}>{r.centerName || "—"}</td>
                        <td className={cn(adminTd, "max-w-[12rem] truncate")}>
                          {r.teacherName || "—"}
                        </td>
                        <td className={cn(adminTd, "font-semibold tabular-nums")}>
                          <span className="inline-flex items-center gap-1.5">
                            <Users
                              className="h-3.5 w-3.5 text-muted-foreground"
                              aria-hidden
                            />
                            {r.roster}
                          </span>
                        </td>
                        <td className={cn(adminTd, "tabular-nums")}>
                          {r.heldSessions}
                          <span className="text-muted-foreground">/{r.totalSessions}</span>
                        </td>
                        <td className={cn(adminTd, "tabular-nums")}>
                          {r.pendingSessions > 0 ? (
                            <StatusPill tone="warning">{r.pendingSessions}</StatusPill>
                          ) : (
                            <StatusPill tone="success">0</StatusPill>
                          )}
                        </td>
                        <td className={adminTd}>
                          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        </td>
                        <td className={cn(adminTd, "text-right")}>
                          <Link
                            href={`/attendance?classId=${r.id}`}
                            className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Xem buổi
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        </div>
      )}
    </>
  );
}
