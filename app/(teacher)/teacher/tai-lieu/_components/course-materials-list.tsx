"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { SearchInput } from "../../_components/ui/search-input";
import { EmptyState } from "../../_components/ui/empty-state";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

/** Một hàng khoá học trong "Thư viện tài liệu" — plain data từ server. */
export interface CourseMaterialRow {
  id: string;
  name: string;
  description: string | null;
  /** BUỔI HỌC — số buổi chuẩn (totalSessions) hoặc số buổi trong khung CT. */
  sessions: number;
  /** GIÁO ÁN — tài liệu giảng dạy đính kèm các buổi. */
  plans: number;
  /** BÀI TẬP — số buổi có bài tập về nhà mặc định. */
  homeworks: number;
}

// Chấm màu theo thứ tự (khớp phong cách reference — mỗi khoá 1 màu điểm nhấn).
const DOTS = [
  "bg-state-info",
  "bg-primary",
  "bg-state-success",
  "bg-state-info",
  "bg-state-danger",
  "bg-state-warning",
  "bg-state-info",
  "bg-state-success",
];

export function CourseMaterialsList({ rows }: { rows: CourseMaterialRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, query]);

  return (
    <>
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tìm khóa học..."
        containerClassName="mb-5 sm:max-w-md"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Chưa có khoá học nào có khung chương trình."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang
          khoaGhiNho="gv-tai-lieu-khoa">
            <table className="min-w-[660px] w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3">
                    Khóa học
                  </th>
                  <th scope="col" className="px-5 py-3 text-center">
                    Buổi học
                  </th>
                  <th scope="col" className="px-5 py-3 text-center">
                    Giáo án
                  </th>
                  <th scope="col" className="px-5 py-3 text-center">
                    Bài tập
                  </th>
                  <th scope="col" className="px-5 py-3 text-right">
                    <span className="sr-only">Tài liệu</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-10 text-center text-sm text-muted-foreground"
                    >
                      Không có khoá học khớp tìm kiếm.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOTS[i % DOTS.length]}`}
                            aria-hidden
                          />
                          {/* `truncate` (nowrap + overflow hidden + ellipsis) chỉ hoạt
                              động khi phần tử BỊ RÀNG BUỘC bề rộng. `min-w-0` một mình
                              không đủ: ô bảng ở table-layout:auto nở vừa nội dung nên
                              scrollWidth === clientWidth (đo được 1704px) và ellipsis
                              không bao giờ kích hoạt — bảng phình 2119px trong khung
                              883px. Trần phải đặt ở KHỐI BÊN TRONG ô, vì max-width trên
                              <td> là hành vi undefined và Chrome bỏ qua (QA vòng 1,
                              BUG-034). */}
                          <div className="min-w-0 max-w-[28rem]">
                            <Link
                              href={`?courseId=${r.id}`}
                              className="rounded-sm font-semibold text-foreground outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {r.name}
                            </Link>
                            {r.description && (
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={r.description}
                              >
                                {r.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center font-bold text-foreground">
                        {r.sessions}
                      </td>
                      <td className="px-5 py-3.5 text-center text-muted-foreground">
                        {r.plans}
                      </td>
                      <td className="px-5 py-3.5 text-center text-muted-foreground">
                        {r.homeworks}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <Link
                          href={`?courseId=${r.id}`}
                          className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Xem tài liệu{" "}
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </>
  );
}
