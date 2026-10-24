"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import {
  CLASS_STATUS_LABEL,
  CLASS_STATUS_VALUES,
  countActiveFilters,
  toClassListQuery,
  type ClassListFilters,
  type ClassSort,
  type FillFilter,
} from "@/lib/classes/list-filter";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Khoá sessionStorage giữ bộ lọc gần nhất của màn lớp (theo TAB).
 *
 * 24/09/2026 — "lọc xong bấm vào một lớp rồi quay lại là mất hết lọc": các đường quay
 * lại (mục "Lớp học" ở sidebar, nút "Danh sách lớp" ở trang chi tiết, sau khi lưu/huỷ
 * lớp) đều trỏ `/classes` TRẦN. Nên nhớ ở đây, và vào `/classes` không kèm tham số thì
 * khôi phục. Bấm "Xoá lọc" ghi chuỗi rỗng ⇒ lần sau vào là danh sách đầy đủ, đúng ý.
 */
export const CLASS_FILTER_STORAGE_KEY = "satarobo:classes:loc";

const DAY_CHIPS = [
  { v: 1, label: "T2" },
  { v: 2, label: "T3" },
  { v: 3, label: "T4" },
  { v: 4, label: "T5" },
  { v: 5, label: "T6" },
  { v: 6, label: "T7" },
  { v: 0, label: "CN" },
];

const FILL_OPTIONS: { v: FillFilter | ""; label: string }[] = [
  { v: "", label: "Mọi sĩ số" },
  { v: "empty", label: "Chưa có học viên" },
  { v: "available", label: "Còn chỗ" },
  { v: "full", label: "Đã đủ / vượt" },
];

const SORT_OPTIONS: { v: ClassSort; label: string }[] = [
  { v: "status", label: "Theo trạng thái" },
  { v: "start_desc", label: "Khai giảng mới nhất" },
  { v: "start_asc", label: "Khai giảng sớm nhất" },
  { v: "name", label: "Tên lớp A→Z" },
];

const fieldCls =
  "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Ô chọn ở hàng 1: co giãn nhưng không bé hơn mức đọc được nhãn. */
const selWrap = "min-w-[170px] flex-[1_1_180px]";

function chipCls(on: boolean) {
  return cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors",
    on
      ? "border-primary bg-primary text-white"
      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
  );
}

/**
 * Bộ lọc lớp học — mọi thay đổi TỰ ÁP DỤNG (router.replace trong transition), ô tìm
 * kiếm chờ 400ms sau lần gõ cuối. Trạng thái nằm trên URL nên F5 / gửi link giữ nguyên.
 */
export function ClassFilters({
  initial,
  statusCounts,
  centers,
  courses,
  teachers,
  showTeacher,
}: {
  initial: ClassListFilters;
  /** Số lớp theo từng trạng thái dưới CÁC ĐIỀU KIỆN KHÁC đang bật. */
  statusCounts: Record<string, number>;
  centers: FilterOption[];
  courses: FilterOption[];
  teachers: FilterOption[];
  /** Người chỉ-xem-lớp-mình không có ô lọc GV (server ép về chính họ). */
  showTeacher: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<ClassListFilters>(initial);
  const [q, setQ] = useState(initial.q ?? "");
  const moRong0 =
    initial.weekdays.length > 0 || !!initial.startFrom || !!initial.startTo || !!initial.fill;
  const [moRong, setMoRong] = useState(moRong0);

  // Server là nguồn sự thật: đổi URL từ bên ngoài (Back/Forward, khôi phục) ⇒ đồng bộ lại.
  const initialQs = toClassListQuery(initial);
  useEffect(() => {
    setF(initial);
    setQ(initial.q ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQs]);

  // Khôi phục bộ lọc đã nhớ khi vào `/classes` TRẦN; có tham số thì ghi nhớ bộ đó.
  const daKhoiPhuc = useRef(false);
  useEffect(() => {
    if (daKhoiPhuc.current) return;
    daKhoiPhuc.current = true;
    try {
      if (window.location.search.length > 1) {
        window.sessionStorage.setItem(CLASS_FILTER_STORAGE_KEY, initialQs);
        return;
      }
      const luu = window.sessionStorage.getItem(CLASS_FILTER_STORAGE_KEY);
      if (luu) startTransition(() => router.replace(`${pathname}?${luu}`, { scroll: false }));
    } catch {
      /* sessionStorage có thể ném (chế độ riêng tư) — mất ghi nhớ thôi */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: ClassListFilters) {
    setF(next);
    const qs = toClassListQuery(next);
    try {
      window.sessionStorage.setItem(CLASS_FILTER_STORAGE_KEY, qs);
    } catch {
      /* bỏ qua */
    }
    startTransition(() => {
      // replace: đổi bộ lọc không đẻ thêm mục lịch sử — Back là rời màn, không phải
      // lùi qua từng lần bấm chip.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  // Ô tìm kiếm: tự áp dụng sau 400ms ngừng gõ. Đọc bộ lọc qua ref — bấm chip trong
  // lúc đang chờ thì lần áp dụng này phải mang theo chip đó, không đè bằng bản cũ.
  const fRef = useRef(f);
  useEffect(() => {
    fRef.current = f;
  }, [f]);
  useEffect(() => {
    const t = q.trim() || undefined;
    if (t === fRef.current.q) return;
    const h = setTimeout(() => apply({ ...fRef.current, q: t }), 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const soLoc = countActiveFilters(f);
  const tongTheoTrangThai = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  function toggleStatus(s: (typeof CLASS_STATUS_VALUES)[number]) {
    const has = f.statuses.includes(s);
    apply({ ...f, statuses: has ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] });
  }

  function toggleDay(d: number) {
    const has = f.weekdays.includes(d);
    apply({
      ...f,
      weekdays: (has ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d]).sort((a, b) => a - b),
    });
  }

  function clearAll() {
    setQ("");
    apply({ statuses: [], weekdays: [], sort: f.sort });
  }

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* Hàng 1 — tìm kiếm + ba ô chọn chính + sắp xếp */}
      {/* flex-wrap + min-w từng ô: khung hẹp thì ô XUỐNG DÒNG chứ không bị ép cắt chữ
          (24/09 — "Tất cả cơ sở" từng hiện thành "Tất cả cơ sở" cụt, "Theo trạng th"). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-[2_1_240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply({ ...f, q: q.trim() || undefined });
            }}
            placeholder="Tìm tên / mã lớp…"
            aria-label="Tìm theo tên hoặc mã lớp"
            className={cn(fieldCls, "w-full pl-9 pr-8")}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Xoá ô tìm"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="contents">
          <select
            value={f.centerId ?? ""}
            onChange={(e) => apply({ ...f, centerId: e.target.value || undefined })}
            aria-label="Lọc theo cơ sở"
            className={cn(fieldCls, selWrap)}
          >
            <option value="">Tất cả cơ sở</option>
            {centers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={f.courseId ?? ""}
            onChange={(e) => apply({ ...f, courseId: e.target.value || undefined })}
            aria-label="Lọc theo khoá học"
            className={cn(fieldCls, selWrap)}
          >
            <option value="">Tất cả khoá</option>
            {courses.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {showTeacher ? (
            <select
              value={f.teacherId ?? ""}
              onChange={(e) => apply({ ...f, teacherId: e.target.value || undefined })}
              aria-label="Lọc theo giáo viên"
              className={cn(fieldCls, selWrap)}
            >
              <option value="">Tất cả GV / trợ giảng</option>
              {teachers.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={f.sort}
            onChange={(e) => apply({ ...f, sort: e.target.value as ClassSort })}
            aria-label="Sắp xếp"
            className={cn(fieldCls, selWrap)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Hàng 2 — trạng thái (chọn nhiều) + nút mở rộng + xoá lọc */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => apply({ ...f, statuses: [] })}
          className={chipCls(f.statuses.length === 0)}
          aria-pressed={f.statuses.length === 0}
        >
          Tất cả
          <span className="tabular-nums opacity-80">{tongTheoTrangThai}</span>
        </button>
        {CLASS_STATUS_VALUES.map((s) => {
          const on = f.statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={chipCls(on)}
              aria-pressed={on}
            >
              {CLASS_STATUS_LABEL[s]}
              <span className="tabular-nums opacity-80">{statusCounts[s] ?? 0}</span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Đang lọc" />}
          <button
            type="button"
            onClick={() => setMoRong((v) => !v)}
            aria-expanded={moRong}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
              moRong ? "border-primary text-primary" : "border-border text-foreground hover:bg-muted",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Lọc thêm
          </button>
          {soLoc > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-state-danger-ink hover:bg-state-danger-soft"
            >
              <X className="h-3.5 w-3.5" />
              Xoá lọc ({soLoc})
            </button>
          )}
        </div>
      </div>

      {/* Hàng 3 — lọc mở rộng */}
      {moRong && (
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">Thứ học</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_CHIPS.map((d) => {
                const on = f.weekdays.includes(d.v);
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    aria-pressed={on}
                    className={cn(chipCls(on), "w-10 justify-center px-0")}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {/* Ô date có bề rộng tối thiểu nội tại (~130px) — ép co là nó ĐÈ sang ô bên cạnh. */}
          <fieldset className="min-w-[300px] flex-[1_1_320px] space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">Khai giảng</legend>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={f.startFrom ?? ""}
                max={f.startTo}
                onChange={(e) => apply({ ...f, startFrom: e.target.value || undefined })}
                aria-label="Khai giảng từ ngày"
                className={cn(fieldCls, "min-w-[135px] flex-1 px-2")}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={f.startTo ?? ""}
                min={f.startFrom}
                onChange={(e) => apply({ ...f, startTo: e.target.value || undefined })}
                aria-label="Khai giảng đến ngày"
                className={cn(fieldCls, "min-w-[135px] flex-1 px-2")}
              />
            </div>
          </fieldset>
          <fieldset className="min-w-[200px] flex-[1_1_200px] space-y-1.5">
            <legend className="text-xs font-semibold text-muted-foreground">Sĩ số</legend>
            <select
              value={f.fill ?? ""}
              onChange={(e) =>
                apply({ ...f, fill: (e.target.value || undefined) as FillFilter | undefined })
              }
              aria-label="Lọc theo sĩ số"
              className={cn(fieldCls, "w-full")}
            >
              {FILL_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.label}
                </option>
              ))}
            </select>
          </fieldset>
        </div>
      )}
    </div>
  );
}
