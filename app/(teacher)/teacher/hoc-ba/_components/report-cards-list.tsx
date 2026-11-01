"use client";

// app/(teacher)/teacher/hoc-ba/_components/report-cards-list.tsx — #06 (L6):
// 2 tab LIST học bạ site GV (client toggle, KHÔNG searchParams):
//   • "Học bạ"  — bảng tổng quan mỗi HV (chuyên cần, điểm TB bài tập, trạng thái học
//                 bạ, mốc buổi 5/12, thao tác mở/nhập/xuất). Lọc Khoá học + Trạng thái.
//   • "Năng lực" — BẢNG so sánh chéo mọi HV: cột = tiêu chí năng lực (thang 1–4, gộp
//                 theo TÊN để so sánh chéo khoá) + cột "TB" + cột "Xếp loại". Lọc
//                 Khoá học + Xếp loại (Xuất sắc/Giỏi/Khá/Cần cố gắng).
//
// Nhận `rows` PLAIN từ server (page.tsx đã scopedDb + gác IDOR + precompute mốc buổi,
// cột tổng quan VÀ dữ liệu năng lực + xếp loại) → chỉ lọc/hiển thị. KHÔNG đọc DB,
// KHÔNG contact PH (câu 46: chỉ tên + mã HV). Câu 55: KHÔNG nút "Duyệt (Quản lý)".
// Màu đi qua token (xem teacher.css), shadcn/base-ui. Dùng ListToolbar chung.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, FileDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ListToolbar } from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export type ReportCardStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "RECALLED";

export type MilestoneChip = {
  milestone: number;
  state: "pending" | "missing" | "done";
  text: string;
  label: string;
};

/** Xếp loại năng lực suy từ điểm TB các tiêu chí (thang 1–4) — xem deriveCompetencyRank trong page.tsx. */
export type CompetencyRank = "Xuất sắc" | "Giỏi" | "Khá" | "Cần cố gắng";

/** 1 tiêu chí năng lực của khoá + mức đã chấm (level 0 = chưa chấm). */
export interface CompetencyCell {
  name: string;
  order: number;
  level: number;
}

export interface CompetencyData {
  cells: CompetencyCell[];
  /** Điểm TB tiêu chí đã chấm (thang 1–4, làm tròn 1 số lẻ); null nếu chưa chấm tiêu chí nào. */
  avgLevel: number | null;
  rank: CompetencyRank | null;
}

export interface ReportCardRow {
  enrollmentId: string;
  studentName: string;
  studentCode: string | null;
  className: string;
  courseName: string;
  status: ReportCardStatus | null;
  statusLabel: string | null;
  editableByTeacher: boolean;
  attendedSessions: number;
  totalSessions: number;
  /** Điểm TB bài tập đã chấm (thang 10) — null nếu chưa có bài chấm. */
  avgScore: number | null;
  updatedAtLabel: string | null;
  hasCard: boolean;
  milestones: MilestoneChip[];
  competency: CompetencyData;
}

// Màu pill trạng thái — đồng bộ ngữ nghĩa trang admin /admin/report-cards, có biến thể
// Tối để không chìm trên nền tối của site GV.
const STATUS_CLASS: Record<ReportCardStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_REVIEW: "bg-state-warning-soft text-state-warning-ink",
  PUBLISHED: "bg-state-success-soft text-state-success-ink",
  RECALLED: "bg-state-danger-soft text-state-danger-ink",
};

const MILESTONE_CLASS: Record<MilestoneChip["state"], string> = {
  pending: "border border-border text-muted-foreground",
  missing: "bg-state-warning-soft text-state-warning-ink",
  done: "bg-state-success-soft text-state-success-ink",
};

// Pill xếp loại — bậc cao nhất dùng màu THƯƠNG HIỆU, các bậc dưới lùi về trung tính /
// hổ phách. KHÔNG thêm sắc trang trí mới: xếp loại là thang bậc, không phải danh mục.
const RANK_CLASS: Record<CompetencyRank, string> = {
  "Xuất sắc": "bg-primary text-white",
  Giỏi: "bg-primary-soft text-primary-ink",
  Khá: "bg-muted text-muted-foreground",
  "Cần cố gắng": "bg-state-warning-soft text-state-warning-ink",
};

/** Nhãn mức năng lực (thang 1–4) — hiện ở tooltip ô điểm tiêu chí. */
const LEVEL_LABEL: Record<number, string> = {
  1: "Cần cố gắng",
  2: "Đạt",
  3: "Khá",
  4: "Tốt",
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Mọi trạng thái" },
  { value: "none", label: "Chưa có học bạ" },
  { value: "DRAFT", label: "Nháp" },
  { value: "PENDING_REVIEW", label: "Chờ duyệt" },
  { value: "PUBLISHED", label: "Đã phát hành" },
  { value: "RECALLED", label: "Đã thu hồi" },
];

const RANK_FILTER_OPTIONS = [
  { value: "all", label: "Mọi xếp loại" },
  { value: "Xuất sắc", label: "Xuất sắc" },
  { value: "Giỏi", label: "Giỏi" },
  { value: "Khá", label: "Khá" },
  { value: "Cần cố gắng", label: "Cần cố gắng" },
];

type TabKey = "hocba" | "nangluc";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "hocba", label: "Học bạ", icon: FileText },
  { key: "nangluc", label: "Năng lực", icon: ClipboardList },
];

export function ReportCardsList({ rows }: { rows: ReportCardRow[] }) {
  const [tab, setTab] = useState<TabKey>("hocba");
  return (
    <div>
      <div className="mb-6 overflow-x-auto">
        <nav
          className="flex min-w-max gap-1 border-b border-border"
          aria-label="Chế độ xem học bạ"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "border-primary text-primary-ink dark:border-primary dark:text-primary-ink"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === "hocba" ? <HocBaTab rows={rows} /> : <NangLucTab rows={rows} />}
    </div>
  );
}

/* --------------------------------- Tab Học bạ -------------------------------- */

function HocBaTab({ rows }: { rows: ReportCardRow[] }) {
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("all");
  const [status, setStatus] = useState("all");

  const courses = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.courseName))).sort((a, b) =>
        a.localeCompare(b, "vi"),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchQ =
        !q ||
        r.studentName.toLowerCase().includes(q) ||
        (r.studentCode?.toLowerCase().includes(q) ?? false);
      const matchCourse = course === "all" || r.courseName === course;
      const matchStatus =
        status === "all" ||
        (status === "none" ? r.status === null : r.status === status);
      return matchQ && matchCourse && matchStatus;
    });
  }, [rows, query, course, status]);

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên học viên, mã HV..."
        filters={[
          {
            value: course,
            onChange: setCourse,
            options: [
              { value: "all", label: "Tất cả khoá học" },
              ...courses.map((c) => ({ value: c, label: c })),
            ],
          },
          {
            value: status,
            onChange: setStatus,
            options: STATUS_FILTER_OPTIONS,
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Không tìm thấy học viên"
          description="Thử đổi từ khoá tìm kiếm hoặc bộ lọc."
        />
      ) : (
        <section className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang
          khoaGhiNho="gv-hoc-ba">
            <table className="min-w-[880px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3">
                    Học viên
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Khoá học
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Chuyên cần
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Điểm TB
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Trạng thái học bạ
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Mốc buổi
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.enrollmentId}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    {/* Sàn bề rộng cho hai cột TEXT TỰ DO. Không có sàn thì bốn cột
                        nowrap phía sau (Mốc buổi 177px, Thao tác 237px…) giành hết chỗ
                        và cột Khoá học bị bóp còn 84px — mỗi dòng xuống 165px vì tên
                        khoá vỡ mỗi dòng một từ (QA vòng 1, BUG-026). Đặt trên <td>
                        được vì đây là min-width; max-width thì <td> bỏ qua. */}
                    <td className="min-w-[12rem] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                          {initialsOf(r.studentName)}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {r.studentName}
                          </p>
                          {r.studentCode ? (
                            <p className="text-xs text-muted-foreground">
                              {r.studentCode}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="min-w-[11rem] px-4 py-3">
                      <p className="text-foreground">{r.courseName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.className}
                      </p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.totalSessions > 0 ? (
                        <>
                          <span className="font-semibold text-foreground">
                            {r.attendedSessions}/{r.totalSessions}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            buổi
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.avgScore != null ? (
                        <span className="font-bold text-primary-ink">
                          {r.avgScore}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={r.status} label={r.statusLabel} />
                        {r.editableByTeacher ? (
                          <Badge
                            variant="outline"
                            className="border-state-success-soft text-state-success-ink dark:border-state-success"
                          >
                            GV sửa được
                          </Badge>
                        ) : null}
                      </div>
                      {/* 25/08 — "Cập nhật" bỏ cột riêng, xuống dòng phụ ở đây: bảng 8
                          cột rộng 990px không vừa laptop 1280px nên cột "Thao tác" luôn
                          nằm ngoài màn. Mốc thời gian là thông tin tra cứu, không phải
                          thứ cần một cột để so sánh theo chiều dọc. */}
                      {r.updatedAtLabel ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cập nhật {r.updatedAtLabel}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.milestones.map((m) => (
                          <span
                            key={m.milestone}
                            title={m.label}
                            className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${MILESTONE_CLASS[m.state]}`}
                          >
                            {m.text}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {r.status === "PUBLISHED" && (
                          <a
                            href={`/teacher/hoc-ba/pdf/${r.enrollmentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                          >
                            <FileDown className="h-3.5 w-3.5" aria-hidden />{" "}
                            Xuất học bạ
                          </a>
                        )}
                        {/* href CHỈ-query (giữ path hiện tại): chạy đúng cả trên host
                            giaovien (clean URL /hoc-ba) LẪN localhost (/teacher/hoc-ba). */}
                        {/* Nền TINT chứ không tô đặc: bảng này thường 47+ hàng, mỗi
                            hàng một nút tím đặc thì cả cột thành một mảng tím hét lên
                            như nhau — không còn hàng nào nổi hơn hàng nào. Tint vẫn
                            giữ nguyên tính "đây là việc chính của hàng" mà không đè
                            át các dấu hiệu trạng thái bên trái. */}
                        <Link
                          href={`?enrollmentId=${r.enrollmentId}`}
                          className="rounded-md bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary-ink transition-colors hover:bg-primary-soft-hover"
                        >
                          {r.hasCard ? "Mở học bạ" : "Nhập học bạ"}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </section>
      )}
    </div>
  );
}

/* -------------------------------- Tab Năng lực ------------------------------- */

function NangLucTab({ rows }: { rows: ReportCardRow[] }) {
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("all");
  const [rank, setRank] = useState("all");

  const courses = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.courseName))).sort((a, b) =>
        a.localeCompare(b, "vi"),
      ),
    [rows],
  );

  // Lọc theo tìm kiếm + khoá TRƯỚC (chưa theo xếp loại) → cột tiêu chí ổn định khi
  // đổi bộ lọc xếp loại (không nhấp nháy header).
  const scopeRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const matchQ =
        !q ||
        r.studentName.toLowerCase().includes(q) ||
        (r.studentCode?.toLowerCase().includes(q) ?? false);
      const matchCourse = course === "all" || r.courseName === course;
      return matchQ && matchCourse;
    });
  }, [rows, query, course]);

  // Cột tiêu chí = HỢP các tiêu chí xuất hiện trong scopeRows, GỘP theo TÊN để so
  // sánh chéo khoá (khoá khác nhau có bộ tiêu chí khác nhau). Sắp theo order rồi tên.
  const columns = useMemo(() => {
    const orderByName = new Map<string, number>();
    for (const r of scopeRows) {
      for (const c of r.competency.cells) {
        const prev = orderByName.get(c.name);
        if (prev === undefined || c.order < prev)
          orderByName.set(c.name, c.order);
      }
    }
    return [...orderByName.entries()]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "vi"))
      .map(([name]) => name);
  }, [scopeRows]);

  const filtered = useMemo(
    () => scopeRows.filter((r) => rank === "all" || r.competency.rank === rank),
    [scopeRows, rank],
  );

  return (
    <div>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Tìm theo tên học viên, mã HV..."
        filters={[
          {
            value: course,
            onChange: setCourse,
            options: [
              { value: "all", label: "Tất cả khoá học" },
              ...courses.map((c) => ({ value: c, label: c })),
            ],
          },
          {
            value: rank,
            onChange: setRank,
            options: RANK_FILTER_OPTIONS,
          },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Không tìm thấy học viên"
          description="Thử đổi từ khoá tìm kiếm hoặc bộ lọc."
        />
      ) : (
        <section className="t-card overflow-hidden">
          <PhanTrangBang cuonNgang
          khoaGhiNho="gv-hoc-ba-chi-tiet">
            <table className="min-w-[660px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3">
                    Học viên
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Khoá học
                  </th>
                  {columns.map((name) => (
                    <th
                      key={name}
                      scope="col"
                      className="px-4 py-3 text-center whitespace-nowrap"
                    >
                      {name}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 whitespace-nowrap"
                    title="Điểm trung bình các tiêu chí năng lực (thang 1–4)"
                  >
                    TB
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Xếp loại
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const levelByName = new Map(
                    r.competency.cells.map((c) => [c.name, c.level]),
                  );
                  return (
                    <tr
                      key={r.enrollmentId}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                            {initialsOf(r.studentName)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              {r.studentName}
                            </p>
                            {r.studentCode ? (
                              <p className="text-xs text-muted-foreground">
                                {r.studentCode}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-foreground">{r.courseName}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.className}
                        </p>
                      </td>
                      {columns.map((name) => {
                        const lv = levelByName.get(name) ?? 0;
                        return (
                          <td
                            key={name}
                            className="px-4 py-3 text-center whitespace-nowrap"
                          >
                            {lv >= 1 ? (
                              <span
                                title={LEVEL_LABEL[lv] ?? String(lv)}
                                className="font-semibold text-foreground"
                              >
                                {lv}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.competency.avgLevel != null ? (
                          <span className="font-semibold text-foreground">
                            {r.competency.avgLevel.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RankPill rank={r.competency.rank} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </section>
      )}
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: ReportCardStatus | null;
  label: string | null;
}) {
  if (!status || !label)
    return <span className="text-xs text-muted-foreground">Chưa có</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      {label}
    </span>
  );
}

function RankPill({ rank }: { rank: CompetencyRank | null }) {
  if (!rank)
    return <span className="text-xs text-muted-foreground">Chưa chấm</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${RANK_CLASS[rank]}`}
    >
      {rank}
    </span>
  );
}
