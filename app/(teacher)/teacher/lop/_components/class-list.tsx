"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ListToolbar,
  type SelectFilter,
} from "../../_components/ui/list-toolbar";
import { EmptyState } from "../../_components/ui/empty-state";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { khopBatKy } from "@/lib/ui/tim-kiem";
import { useLocTrenUrl } from "../../_components/ui/use-loc-tren-url";

/** Một hàng lớp — plain data từ server (đã cách ly cơ sở qua scopedDb). */
export interface ClassRow {
  id: string;
  name: string;
  code: string | null;
  center: string | null;
  course: string;
  schedule: string;
  enrolled: number;
  capacity: number;
  status: string;
  /** Số buổi (đã tới ngày) chưa điểm danh — cột "Cần xử lý". */
  pending: number;
  /**
   * Lớp có việc điểm danh để làm hay không — sĩ số > 0 VÀ có buổi đã tới ngày.
   * Tách khỏi `pending` để phân biệt "đã làm xong" với "không có gì để làm": lớp
   * Dự kiến sĩ số 0/16 chưa khai giảng từng hiện badge xanh "Hoàn tất", trùng nghĩa
   * với badge trạng thái lớp ngay cột bên cạnh (QA vòng 1, BUG-016).
   */
  hasAttendanceWork: boolean;
}

const CLASS_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Dự kiến",
  RECRUITING: "Tuyển sinh",
  PENDING_APPROVAL: "Chờ duyệt",
  ACTIVE: "Đang học",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const CLASS_STATUS_CLASS: Record<string, string> = {
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  COMPLETED: "bg-state-info-soft text-state-info-ink",
  RECRUITING: "bg-state-warning-soft text-state-warning-ink",
  PENDING_APPROVAL: "bg-state-warning-soft text-state-warning-ink",
  PLANNED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-state-danger-soft text-state-danger-ink",
};

export function ClassStatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        CLASS_STATUS_CLASS[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {CLASS_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const ALL = "ALL";

// Giá trị mặc định của ô Trạng thái: MỌI LỚP TRỪ đã hoàn thành.
//
// Chủ dự án chốt 03/09 (quyết định #4) theo đề xuất IMP-003 của QA: gộp "Hoàn thành"
// vào chính dropdown và BỎ ô tick rời. Ô tick cũ đẻ ba lỗi cùng lúc — nhãn "Mọi trạng
// thái" chỉ lọc trên 38/50 lớp (BUG-005), bỏ tick tự đá bộ lọc về mặc định mà không
// báo (BUG-006), và danh sách option đổi theo ô tick nên "Hoàn thành" lúc có lúc không
// (BUG-007). Một điều khiển thì cả ba biến mất.
//
// Vẫn GIỮ ý định của chốt 25/08 — lớp đã hoàn thành không nằm trong mặc định — nhưng
// bằng một giá trị có TÊN THẬT thay vì một cái tick ẩn: giáo viên dạy vài khoá thì lớp
// cũ đông hơn lớp đang dạy, để lẫn vào là lớp còn buổi cần điểm danh bị đẩy xuống đáy.
const DANG_PHU_TRACH = "DANG_PHU_TRACH";

export function ClassList({
  rows,
  banDauLoc,
}: {
  rows: ClassRow[];
  /** Bộ lọc đọc từ `searchParams` Ở SERVER — thiếu nó là deep-link không chạy. */
  banDauLoc?: { q?: string; khoa?: string; trangThai?: string };
}) {
  // Bộ lọc sống trên URL: gửi link được, F5 không mất (BUG-019).
  const loc = useLocTrenUrl(
    { q: "", khoa: ALL, trangThai: DANG_PHU_TRACH },
    banDauLoc,
  );
  const query = loc.gia_tri.q;
  const course = loc.gia_tri.khoa;
  const status = loc.gia_tri.trangThai;

  const completedCount = useMemo(
    () => rows.filter((r) => r.status === "COMPLETED").length,
    [rows],
  );

  // Options lọc suy từ chính dữ liệu (khoá học + trạng thái đang có).
  const courseOptions = useMemo<SelectFilter["options"]>(() => {
    const names = [...new Set(rows.map((r) => r.course))].sort((a, b) =>
      a.localeCompare(b, "vi"),
    );
    return [
      { value: ALL, label: "Tất cả khoá học" },
      ...names.map((n) => ({ value: n, label: n })),
    ];
  }, [rows]);

  // Suy từ TOÀN BỘ `rows` — danh sách option KHÔNG được đổi theo lựa chọn hiện tại,
  // nếu không thì giá trị đang chọn có thể biến mất khỏi options và trigger của Base UI
  // Select hiện nhãn RỖNG (nó tra nhãn theo options).
  const statusOptions = useMemo<SelectFilter["options"]>(() => {
    const present = [...new Set(rows.map((r) => r.status))];
    const ordered = Object.keys(CLASS_STATUS_LABEL).filter((s) =>
      present.includes(s),
    );
    return [
      { value: DANG_PHU_TRACH, label: "Đang phụ trách" },
      ...ordered.map((s) => ({ value: s, label: CLASS_STATUS_LABEL[s]! })),
      { value: ALL, label: "Tất cả trạng thái" },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (course !== ALL && r.course !== course) return false;
      if (status === DANG_PHU_TRACH) {
        if (r.status === "COMPLETED") return false;
      } else if (status !== ALL && r.status !== status) {
        return false;
      }
      // BỎ DẤU khi so (lib/ui/tim-kiem) — gõ không dấu là cách gõ mặc định.
      return khopBatKy([r.name, r.code, r.course], query);
    });
  }, [rows, query, course, status]);

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={(v) => loc.dat("q", v)}
        placeholder="Tìm theo tên lớp, mã lớp, khoá học..."
        filters={[
          {
            value: course,
            onChange: (v) => loc.dat("khoa", v),
            options: courseOptions,
          },
          {
            value: status,
            onChange: (v) => loc.dat("trangThai", v),
            options: statusOptions,
          },
        ]}
        // Nút xoá bộ lọc chỉ hiện khi CÓ gì để xoá (BUG-015: người dùng lọc tới bảng
        // trắng rồi không có đường về).
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

      <div className="t-card overflow-hidden">
        <PhanTrangBang cuonNgang
          khoaGhiNho="gv-danh-sach-lop">
          <table className="min-w-[880px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-3">
                  Lớp
                </th>
                <th scope="col" className="px-4 py-3">
                  Khoá học
                </th>
                <th scope="col" className="px-4 py-3">
                  Lịch học
                </th>
                <th scope="col" className="px-4 py-3">
                  Sĩ số
                </th>
                <th scope="col" className="px-4 py-3">
                  Cần xử lý
                </th>
                <th scope="col" className="px-4 py-3">
                  Trạng thái
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Mở lớp</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-sm text-muted-foreground"
                  >
                    {/* Chỉ nhắc phần đang bị ẩn khi nó THẬT SỰ liên quan tới bộ lọc
                        hiện tại. Bản cũ in câu "N lớp đã hoàn thành đang ẩn" kể cả khi
                        người dùng đang lọc "Đã huỷ" — một câu không dính dáng gì tới
                        thứ họ vừa chọn (QA vòng 1, BUG-015). */}
                    {status === DANG_PHU_TRACH && completedCount > 0
                      ? `Không có lớp khớp bộ lọc — ${completedCount} lớp đã hoàn thành nằm ngoài "Đang phụ trách".`
                      : "Không có lớp khớp bộ lọc."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`?classId=${r.id}`}
                        className="rounded-sm font-semibold text-foreground outline-none hover:text-primary-ink-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {r.name}
                      </Link>
                      {(r.code || r.center) && (
                        <p className="text-xs text-muted-foreground">
                          {[r.code, r.center].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </td>
                    {/* KHÔNG whitespace-nowrap: tên khoá dài ("Combo — Full Lộ Trình
                        Luyện Thi") là ô đẩy bảng lên 1108px, vượt khung 958px của
                        laptop 1280 ⇒ phải cuộn ngang mới thấy cột Trạng thái. */}
                    <td className="min-w-[9rem] px-4 py-3.5 text-foreground">
                      {r.course}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground">
                      {r.schedule || "—"}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-foreground">
                      {r.enrolled}/{r.capacity}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {!r.hasAttendanceWork ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : r.pending > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-warning-ink">
                          <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
                          {r.pending} điểm danh
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-semibold text-state-success-ink">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          Hoàn tất
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <ClassStatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <Link
                        href={`?classId=${r.id}`}
                        className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Mở lớp <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </>
  );
}

/** Empty state khi GV chưa được phân công lớp — tách để server tái dùng. */
export function ClassListEmpty() {
  return (
    <EmptyState
      icon={ClipboardCheck}
      title="Bạn chưa được phân công lớp nào."
    />
  );
}
