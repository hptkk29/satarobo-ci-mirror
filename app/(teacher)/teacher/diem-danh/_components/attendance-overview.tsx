"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, ClipboardCheck } from "lucide-react";
import {
  ListToolbar,
  type SelectFilter,
} from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { khopBatKy } from "@/lib/ui/tim-kiem";

/** 1 buổi đã diễn ra (plain — câu 46: chỉ metadata + đếm). */
export interface AttendanceRow {
  id: string;
  classId: string;
  className: string;
  /**
   * "Buổi 7 - HP1 - Bàn Tay Ma Thuật" — server tính (deriveSessionLabel), client chỉ
   * in ra. 25/08: gộp hai cột "Buổi" + "Buổi học" cũ (cột sau in hằng "Buổi học" vì
   * ClassSession.topic gần như luôn null).
   */
  sessionLabel: string;
  date: string; // đã format
  time: string; // "08:00-10:00" | ""
  done: boolean;
  present: number;
  roster: number;
}

const ALL = "ALL";

export function AttendanceOverview({ rows }: { rows: AttendanceRow[] }) {
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState(ALL);
  const [state, setState] = useState(ALL);

  const classOptions = useMemo<SelectFilter["options"]>(() => {
    const names = [...new Set(rows.map((r) => r.className))].sort((a, b) =>
      a.localeCompare(b, "vi"),
    );
    return [
      { value: ALL, label: "Tất cả lớp" },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [rows]);

  const stateOptions: SelectFilter["options"] = [
    { value: ALL, label: "Mọi tình trạng" },
    { value: "pending", label: "Chưa điểm danh" },
    { value: "done", label: "Đã điểm danh" },
  ];

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (cls !== ALL && r.className !== cls) return false;
      if (state === "done" && !r.done) return false;
      if (state === "pending" && r.done) return false;
      // BỎ DẤU khi so (lib/ui/tim-kiem): gõ "vong lap" phải ra "Vòng lặp và điều kiện".
      // So bằng `toLowerCase().includes()` trần thì gõ không dấu — cách gõ mặc định của
      // gần như mọi người dùng Việt — luôn ra 0 kết quả, và trông y như chưa có tìm kiếm.
      return khopBatKy([r.sessionLabel, r.className], query);
    });
  }, [rows, query, cls, state]);

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo lớp, tên buổi, số buổi..."
        filters={[
          { value: cls, onChange: setCls, options: classOptions },
          { value: state, onChange: setState, options: stateOptions },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Không tìm thấy buổi học"
          description="Thử đổi từ khoá hoặc bộ lọc."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang
          khoaGhiNho="gv-diem-danh-tong">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3">
                    Buổi học
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Lớp
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Ngày
                  </th>
                  {/* "Đi học" chứ không phải "Có mặt": ô này cộng CẢ "Đi muộn", nên
                      gọi là "Có mặt" thì con số không khớp nghĩa của chữ — giáo viên
                      đọc ra 9/11 rồi mở buổi lên thấy 8 có mặt + 1 đi muộn (QA vòng 1,
                      BUG-017). Chủ dự án chốt 03/09: đổi cả chữ lẫn số. */}
                  <th scope="col" className="px-5 py-3">
                    Đi học
                  </th>
                  <th scope="col" className="px-5 py-3">
                    Điểm danh
                  </th>
                  <th scope="col" className="px-5 py-3 text-right">
                    <span className="sr-only">Mở</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-foreground">
                        {r.sessionLabel}
                      </p>
                      {r.time && (
                        <p className="text-xs text-muted-foreground">
                          {r.time}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                      {r.className}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                      {r.date}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-foreground">
                      {r.done ? `${r.present}/${r.roster}` : "—"}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {r.done ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-semibold text-state-success-ink">
                          <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Đã
                          xong
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-warning-ink">
                          Chưa điểm danh
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <Link
                        href={`/teacher/lop?classId=${r.classId}&sessionId=${r.id}`}
                        className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {r.done ? "Xem" : "Điểm danh"}
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </>
  );
}
