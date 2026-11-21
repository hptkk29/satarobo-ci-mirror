"use client";

// Lưới lớp của màn "Hoàn thành khoá" — có tìm kiếm và bộ lọc.
//
// Vì sao (QA site GV vòng 1, BUG-022): trang này đổ thẳng 50 thẻ lớp, không ô tìm, không
// bộ lọc, không sắp xếp, không phân trang — đếm trên DOM ra 50 link và 0 input. Tệ hơn,
// 26/50 thẻ là "0/0 buổi · 0 học viên · 0%": lớp Dự kiến, lớp Chờ duyệt và cả lớp ĐÃ HUỶ.
// Người dùng phải cuộn qua chúng để tìm lớp thật.
//
// Mặc định vì thế là "Đang phụ trách" — bỏ lớp đã huỷ và lớp chưa khai giảng ra khỏi
// tầm mắt, nhưng vẫn tìm lại được bằng ô Trạng thái. Cùng một quy ước với danh sách
// /teacher/lop để hai màn không dạy người dùng hai luật khác nhau.
import { useMemo } from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "../../_components/ui/empty-state";
import { ListToolbar, type SelectFilter } from "../../_components/ui/list-toolbar";
import { useLocTrenUrl } from "../../_components/ui/use-loc-tren-url";
import { khopBatKy } from "@/lib/ui/tim-kiem";

export interface CompletionClassCard {
  id: string;
  name: string;
  courseName: string;
  status: string;
  completedSessions: number;
  totalSessions: number;
  studentCount: number;
}

const ALL = "ALL";
const DANG_PHU_TRACH = "DANG_PHU_TRACH";

/** Lớp không còn là việc đang làm: đã huỷ, hoặc chưa khai giảng nên chưa có gì để chốt. */
const NGOAI_TAM_MAT = new Set(["CANCELLED", "PLANNED", "PENDING_APPROVAL"]);

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Dự kiến",
  RECRUITING: "Tuyển sinh",
  PENDING_APPROVAL: "Chờ duyệt",
  ACTIVE: "Đang học",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã huỷ",
};

export function CompletionClassGrid({
  rows,
  banDauLoc,
}: {
  rows: CompletionClassCard[];
  /** Bộ lọc đọc từ `searchParams` Ở SERVER — thiếu nó là deep-link không chạy. */
  banDauLoc?: { q?: string; trangThai?: string };
}) {
  const loc = useLocTrenUrl({ q: "", trangThai: DANG_PHU_TRACH }, banDauLoc);
  const query = loc.gia_tri.q;
  const status = loc.gia_tri.trangThai;

  const statusOptions = useMemo<SelectFilter["options"]>(() => {
    const present = [...new Set(rows.map((r) => r.status))];
    const ordered = Object.keys(STATUS_LABEL).filter((s) => present.includes(s));
    return [
      { value: DANG_PHU_TRACH, label: "Đang phụ trách" },
      ...ordered.map((s) => ({ value: s, label: STATUS_LABEL[s]! })),
      { value: ALL, label: "Tất cả trạng thái" },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status === DANG_PHU_TRACH) {
        if (NGOAI_TAM_MAT.has(r.status)) return false;
      } else if (status !== ALL && r.status !== status) {
        return false;
      }
      return khopBatKy([r.name, r.courseName], query);
    });
  }, [rows, query, status]);

  const an = rows.length - filtered.length;

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={(v) => loc.dat("q", v)}
        placeholder="Tìm theo tên lớp, khoá học..."
        filters={[
          {
            value: status,
            onChange: (v) => loc.dat("trangThai", v),
            options: statusOptions,
          },
        ]}
        actions={
          loc.dang_loc ? (
            <button
              type="button"
              onClick={loc.xoa_het}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Xoá bộ lọc
            </button>
          ) : undefined
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Không có lớp khớp bộ lọc"
          description={
            status === DANG_PHU_TRACH && an > 0
              ? `${an} lớp đã huỷ hoặc chưa khai giảng nằm ngoài "Đang phụ trách".`
              : "Thử đổi từ khoá tìm kiếm hoặc bộ lọc."
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {filtered.length}
            </span>{" "}
            lớp
            {an > 0 ? ` · ${an} lớp không hiện theo bộ lọc` : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((c) => (
              // href CHỈ-query (giữ path hiện tại): chạy đúng cả trên host giaovien
              // (clean URL /hoan-thanh) LẪN localhost/preview (/teacher/hoan-thanh).
              <Link key={c.id} href={`?classId=${c.id}`} className="block">
                <Card className="t-card-hover h-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {c.courseName}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {c.completedSessions}/{c.totalSessions} buổi ·{" "}
                        {c.studentCount} học viên
                      </span>
                      <span className="font-medium text-foreground">
                        {c.totalSessions > 0
                          ? Math.round(
                              (c.completedSessions / c.totalSessions) * 100,
                            )
                          : 0}
                        %
                      </span>
                    </div>
                    <ProgressBar
                      pct={
                        c.totalSessions > 0
                          ? Math.round(
                              (c.completedSessions / c.totalSessions) * 100,
                            )
                          : 0
                      }
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Thanh tiến độ thuần div (không Recharts — site GV cấm chart lib của admin). */
function ProgressBar({ pct }: { pct: number }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
