import "server-only";
import { db } from "@/lib/db";
import { getTeachingCenterIds } from "@/lib/org/org-service";
import type { Actor } from "@/lib/auth/actor";
import {
  buildScopeFilters,
  visibleCentersForActor,
  type ScopeFilterCore,
  type ScopeFilterSearchParams,
} from "@/lib/reports/scope-filters";

// A-02 — re-export để 4 tab dashboard chỉ có MỘT chỗ import bộ lọc phạm vi.
// (Ràng buộc 8 của PRD §6.2: `ReportFilterSearchParams` bị export mà không trang nào
// import, cả 9 trang tự khai `center?: string` inline ⇒ nới kiểu ở đây KHÔNG lan ra và
// `tsc` vẫn xanh trong khi runtime cầm mảng. Bốn tab mới phải import kiểu dùng chung.)
export {
  buildScopeFilters,
  resolveScopeCenters,
  resolveScopeDayRange,
  parseScopeFilterSearchParams,
  visibleCentersForActor,
  scopeCenterWhere,
  scopeDateWhere,
  scopeFilterCacheKey,
} from "@/lib/reports/scope-filters";
export type {
  ScopeActor,
  ScopeFilterCore,
  ScopeFilters,
  ScopeFilterSearchParams,
} from "@/lib/reports/scope-filters";

// Bộ lọc dùng chung cho /bao-cao/* — cơ sở (IDOR-safe theo tầm nhìn actor) + khoảng
// ngày. Center KHÔNG scoped (Center=db.center) nên tự lọc theo visibleCenterIds.

export type ReportFilters = {
  /** null = toàn bộ cơ sở trong tầm nhìn. */
  centerId: string | null;
  /** null = không giới hạn. */
  dateFrom: Date | null;
  /** null = không giới hạn; đã set cuối ngày. */
  dateTo: Date | null;
};

export type ReportFilterContext = {
  filters: ReportFilters;
  visibleCenters: { id: string; name: string }[];
  /** "ALL" hoặc centerId đã chọn (cho <select> + cache key). */
  selection: string;
  isGlobalAllowed: boolean;
  /** Giá trị cho <input type=date> (YYYY-MM-DD hoặc ""). */
  dateFromStr: string;
  dateToStr: string;
};

export type ReportFilterSearchParams = {
  center?: string;
  dateFrom?: string;
  dateTo?: string;
};

function parseDateStart(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseDateEnd(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Giải bộ lọc từ searchParams: danh sách cơ sở CHỌN ĐƯỢC (chỉ cơ sở vận hành trong tầm
 * nhìn actor — loại HO/mồ côi), center đã chọn (chống IDOR qua URL), khoảng ngày.
 */
export async function resolveReportFilters(
  actor: Actor,
  sp: ReportFilterSearchParams,
): Promise<ReportFilterContext> {
  const isGlobalAllowed = actor.isSuperAdmin || actor.isHoLevel;
  const teachingIds = new Set(await getTeachingCenterIds());
  const allCenters = (
    await db.center.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    })
  ).filter((c) => teachingIds.has(c.id));
  const visibleCenters = isGlobalAllowed
    ? allCenters
    : allCenters.filter((c) => actor.visibleCenterIds.includes(c.id));

  const requested = sp.center;
  const defaultSelection = isGlobalAllowed ? "ALL" : (visibleCenters[0]?.id ?? "ALL");
  let selection = defaultSelection;
  if (requested === "ALL" && isGlobalAllowed) selection = "ALL";
  else if (requested && visibleCenters.some((c) => c.id === requested)) selection = requested;

  const centerId = selection === "ALL" ? null : selection;
  const dateFrom = parseDateStart(sp.dateFrom);
  const dateTo = parseDateEnd(sp.dateTo);

  return {
    filters: { centerId, dateFrom, dateTo },
    visibleCenters,
    selection,
    isGlobalAllowed,
    dateFromStr: sp.dateFrom ?? "",
    dateToStr: sp.dateTo ?? "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// A-02 — BỘ LỌC PHẠM VI ĐA CƠ SỞ (dashboard QLCS 4 tab)
//
// Thêm MỚI cạnh `resolveReportFilters`, KHÔNG sửa nó: `ReportFilters.centerId` đơn trị
// đang được 8 trang /bao-cao/* đọc ở 11 chỗ + 8 chỗ `selection={fc.selection}` + MỘT
// đường ghi (form mục tiêu doanh thu). Ràng buộc 6 của PRD §6.2 chốt "để nguyên".
// ═══════════════════════════════════════════════════════════════════════════════════

/** Bộ lọc A-02 đã giải, kèm phần chỉ có DB mới biết (tên cơ sở để dựng dropdown). */
export type ScopeFilterContext = ScopeFilterCore & {
  /** Cơ sở actor được phép CHỌN — đã lọc theo tầm nhìn, dùng thẳng cho multi-select. */
  visibleCenters: { id: string; name: string }[];
  isGlobalAllowed: boolean;
};

/**
 * Cơ sở "đang dạy" đang hoạt động, thứ tự hiển thị.
 *
 * Cố ý là BẢN SAO của truy vấn trong `resolveReportFilters` chứ không gộp chung: ràng
 * buộc 6 yêu cầu để nguyên hàm cũ (8 trang prod đang bám). Gộp lại là việc của lần dọn
 * SAU khi /bao-cao/* chuyển hết sang bộ lọc mới.
 *
 * ⚠️ Đừng đổi sang `scopedDb(actor).center.findMany()`: `Center` nằm trong `SCOPE_EXEMPT`
 * (`lib/db-scope.ts`) nên lời gọi đó là pass-through và trả về MỌI cơ sở.
 */
async function loadSelectableCenters(): Promise<{ id: string; name: string }[]> {
  const teachingIds = new Set(await getTeachingCenterIds());
  const rows = await db.center.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return rows.filter((c) => teachingIds.has(c.id));
}

/**
 * A-02 — giải bộ lọc phạm vi dùng chung của dashboard QLCS 4 tab.
 *
 * Trả về: danh sách cơ sở ĐÃ kiểm quyền (giao của "cơ sở actor được xem" × "cơ sở actor
 * chọn" — cơ sở ngoài phạm vi bị loại IM LẶNG, xem `resolveScopeCenters`), khoảng ngày
 * đã chuẩn hoá theo giờ VN (mặc định "ngày 01 → hôm nay" — OQ-B9), và cờ `groupByCenter`
 * (OQ-4: mặc định gộp, `?split=1` để tách, chỉ có tác dụng khi đang chọn ≥ 2 cơ sở).
 *
 * `now` chỉ để test bơm mốc thời gian — đường chạy thật đừng truyền.
 */
export async function resolveScopeFilters(
  actor: Actor,
  sp: ScopeFilterSearchParams,
  now: Date = new Date(),
): Promise<ScopeFilterContext> {
  const isGlobalAllowed = actor.isSuperAdmin || actor.isHoLevel;
  const visibleCenters = visibleCentersForActor(actor, await loadSelectableCenters());
  const core = buildScopeFilters({
    visibleCenterIds: visibleCenters.map((c) => c.id),
    sp,
    now,
  });
  return { ...core, visibleCenters, isGlobalAllowed };
}

/** Khoá cache theo bộ lọc (kèm sau actorScopeKey). */
export function reportFilterCacheKey(f: ReportFilters): string {
  return `${f.centerId ?? "ALL"}|${f.dateFrom?.toISOString() ?? ""}|${f.dateTo?.toISOString() ?? ""}`;
}

/** Điều kiện Prisma DateTime từ dateFrom/dateTo (undefined nếu không lọc). */
export function reportDateWhere(
  f: ReportFilters,
): { gte?: Date; lte?: Date } | undefined {
  if (!f.dateFrom && !f.dateTo) return undefined;
  return {
    ...(f.dateFrom ? { gte: f.dateFrom } : {}),
    ...(f.dateTo ? { lte: f.dateTo } : {}),
  };
}
