"use client";

// app/(teacher)/teacher/tai-lieu/_components/lesson-table.tsx — bảng buổi học của
// 1 khoá (parity site GV 18/08, port từ satarobo-ui-giaovien materials/khoa-hoc/[slug]).
//
// Mỗi buổi 1 hàng: Buổi | Chủ đề | Giáo án PDF | Giáo án SCORM | Bài tập về nhà.
// Tài liệu mở TRÌNH XEM ở tab mới (/teacher/tai-lieu/xem?d=…) — không đưa URL R2
// thô ra HTML. SCORM mở trình chiếu watermark có sẵn (/teacher/scorm/play) — mở NGAY
// TẠI TRANG (chốt 24/08), thoát bằng nút "Đóng" của viewer, đích lấy từ `?from=`.
// Tìm theo tên bài hoặc số buổi (thay bộ lọc định dạng cũ — khớp bản mock).
import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  FileText,
  MonitorPlay,
  NotebookPen,
} from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { EmptyState } from "../../_components/ui/empty-state";
import { SearchInput } from "../../_components/ui/search-input";

/** Một tài liệu của buổi — plain data từ server (KHÔNG kèm fileUrl thô). */
export interface LessonDoc {
  id: string;
  title: string;
  typeLabel: string;
}

/** Một buổi học — plain data từ server (page.tsx). */
export interface LessonRow {
  id: string;
  order: number;
  title: string;
  /** Giáo án (Document không phải phiếu bài tập). */
  planDocs: LessonDoc[];
  /** Phiếu bài tập về nhà (Document type WORKSHEET). */
  worksheetDocs: LessonDoc[];
  /** Bài tập về nhà dạng chữ (Lesson.homeworkDefault). */
  homeworkText: string | null;
  scorm: { id: string; name: string; sessionId: string | null } | null;
}

export function LessonTable({
  rows,
  scormOn,
}: {
  rows: LessonRow[];
  scormOn: boolean;
}) {
  const [query, setQuery] = useState("");

  // Chỗ quay về khi GV bấm "Đóng" trong màn trình chiếu: URL đang đứng, KÈM QUERY, để
  // về đúng khoá vừa xem (`?courseId=…`) thay vì rơi về trang chủ. Viewer mở cùng tab
  // nên Back cũng về được — vẫn khai `from` vì nút "Đóng" cần đích XÁC ĐỊNH (vào thẳng
  // bằng URL, bấm F5, hay đi vài nhịp trong viewer thì Back không trỏ về đây nữa).
  const pathname = usePathname();
  const sp = useSearchParams();
  const backParam = useMemo(() => {
    const qs = sp.toString();
    return encodeURIComponent(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, sp]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (l) => l.title.toLowerCase().includes(q) || String(l.order) === q,
    );
  }, [rows, query]);

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tìm theo tên bài hoặc số buổi..."
        containerClassName="sm:max-w-md"
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Không có buổi học phù hợp"
          description="Thử từ khóa khác hoặc xóa bộ lọc."
        />
      ) : (
        <div className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang tenDonVi="buổi"
          khoaGhiNho="gv-tai-lieu-bai">
          <table className="min-w-[880px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-3 text-center">Buổi</th>
                <th scope="col" className="px-4 py-3">Chủ đề</th>
                <th scope="col" className="px-4 py-3">Giáo án PDF</th>
                <th scope="col" className="px-4 py-3">Giáo án SCORM</th>
                <th scope="col" className="px-4 py-3">Bài tập về nhà</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lesson) => (
                <tr
                  key={lesson.id}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                >
                  <td className="px-4 py-3 text-center align-top">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-sm font-extrabold text-primary-ink">
                      {lesson.order}
                    </span>
                  </td>
                  <td className="min-w-[180px] px-4 py-3 align-top">
                    <p className="font-semibold text-foreground">{lesson.title}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {lesson.planDocs.length > 0 ? (
                      <div className="space-y-0.5">
                        {lesson.planDocs.map((d) => (
                          <DocLink key={d.id} doc={d} icon={FileText} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {scormOn && lesson.scorm ? (
                      <Link
                        href={
                          lesson.scorm.sessionId
                            ? `/teacher/scorm/play/${lesson.scorm.id}?sessionId=${lesson.scorm.sessionId}&from=${backParam}`
                            : `/teacher/scorm/play/${lesson.scorm.id}?from=${backParam}`
                        }
                        title={lesson.scorm.name}
                        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <MonitorPlay
                          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary-ink"
                          aria-hidden
                        />
                        <span className="max-w-[190px] truncate font-medium text-foreground group-hover:text-primary-ink">
                          {lesson.scorm.name}
                        </span>
                        <MonitorPlay
                          className="ml-auto h-3.5 w-3.5 shrink-0 text-primary-ink opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {lesson.worksheetDocs.length > 0 || lesson.homeworkText ? (
                      <div className="space-y-1">
                        {lesson.worksheetDocs.map((d) => (
                          <DocLink key={d.id} doc={d} icon={NotebookPen} />
                        ))}
                        {lesson.homeworkText && (
                          <p
                            className="line-clamp-2 max-w-[220px] text-xs whitespace-pre-wrap text-muted-foreground"
                            title={lesson.homeworkText}
                          >
                            {lesson.homeworkText}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}

/** Ô tài liệu trong bảng - mở trình xem ở tab mới. */
function DocLink({ doc, icon: Icon }: { doc: LessonDoc; icon: typeof FileText }) {
  return (
    <a
      href={`/teacher/tai-lieu/xem?d=${encodeURIComponent(doc.id)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={doc.title}
      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon
        className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary-ink"
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block max-w-[190px] truncate font-medium text-foreground group-hover:text-primary-ink">
          {doc.title}
        </span>
        <span className="text-xs text-muted-foreground">{doc.typeLabel}</span>
      </span>
      <ExternalLink
        className="ml-auto h-3.5 w-3.5 shrink-0 text-primary-ink opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </a>
  );
}
