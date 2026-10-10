// lib/reports/revenue-by-child.ts — N-2 · doanh thu quy về TỪNG CON.
//
// Nền của C-02/C-03/C-05 và mẫu số D-04/D-05. Nối hai quyết định 24/08/2026:
//   • B3 — "doanh thu" là THỰC THU (`WHERE_THUC_THU`), không phải `Order.totalAmount`;
//   • B4 — đơn vị sinh doanh thu là ĐỨA TRẺ, nối qua `Order.leadChildId` (một đơn – một con).
//
// ⚠️ LUẬT KHÔNG ĐƯỢC PHÁ: khoản chưa quy được về con KHÔNG BAO GIỜ bị bỏ khỏi báo cáo.
// Nó ra một dòng riêng ("chưa quy được về con"). Lý do: đơn tạo trước N-2 đều `NULL`, và
// một báo cáo âm thầm bỏ chúng sẽ hiện tổng doanh thu THẤP HƠN tab Tài chính trên cùng
// màn hình mà không ai giải thích được vì sao — đúng loại hỏng câm mà B-02 vừa dọn.
//
// Cách chia ba con số: `total` và `unassigned` luôn lấy bằng `aggregate` (SQL cộng, không
// phụ thuộc số dòng đọc về), nên chúng ĐÚNG kể cả khi danh sách từng con bị cắt ở trần
// quét. Chỉ `rows` mới có thể thiếu, và lúc đó `truncated = true` để màn hình nói ra.
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import {
  WHERE_THUC_THU,
  butToanThucThu,
  type ThucThuButToan,
} from "@/lib/finance/thuc-thu";
import type { ScopeFilters } from "@/lib/reports/scope-filters";

/**
 * Trần số bút toán đọc về cho phần "từng con". Vượt trần thì `rows` bị cắt nhưng ba con
 * số tổng vẫn đúng (chúng đi đường `aggregate`).
 */
export const REVENUE_BY_CHILD_SCAN_MAX = 20_000;

/** Bút toán đã phẳng hoá kèm con + cơ sở — đủ để bổ dọc mà không cần đọc lại DB. */
export type ChildRevenueScanRow = ThucThuButToan & {
  centerId: string | null;
  /** `null` = đơn chưa quy được về con (đơn cũ, đơn vãng lai, phiếu nhiều con). */
  leadChildId: string | null;
  leadId: string | null;
};

/** Một dòng "doanh thu theo con" đã kèm tên để hiển thị. */
export type ChildRevenueRow = {
  leadChildId: string;
  childName: string;
  leadId: string | null;
  parentName: string | null;
  centerId: string | null;
  revenue: number;
};

/** Ba con số của một cơ sở khi bật công tắc "Tách theo cơ sở". */
export type ChildRevenueCenterRow = {
  centerId: string;
  total: number;
  assigned: number;
  unassigned: number;
};

export type ChildRevenueReport = {
  /** Tổng thực thu trong phạm vi + khoảng ngày (CẢ phần chưa quy được về con). */
  total: number;
  /** Phần đã quy được về con = `total - unassigned`. */
  assigned: number;
  /** Phần CHƯA quy được về con — luôn hiện, không bao giờ nuốt. */
  unassigned: number;
  /** Từng con, giảm dần theo doanh thu. Có thể bị cắt khi `truncated`. */
  rows: ChildRevenueRow[];
  /** `null` khi công tắc "Tách theo cơ sở" tắt. */
  byCenter: ChildRevenueCenterRow[] | null;
  /** true = vượt `REVENUE_BY_CHILD_SCAN_MAX`; `rows` thiếu, ba con số tổng vẫn đúng. */
  truncated: boolean;
};

/**
 * THUẦN — bổ dọc thực thu theo con.
 *
 * Chạy `butToanThucThu` TRƯỚC khi cộng: nó loại bản gốc đã bị một bút toán ADJUSTED thay
 * thế. Bỏ bước này là cộng đôi đúng khoản vừa được sửa, và sửa tiền là lúc con số dễ bị
 * soi nhất.
 */
export function tallyRevenueByChild(rows: readonly ChildRevenueScanRow[]): {
  byChild: Map<string, number>;
  unassigned: number;
  total: number;
} {
  const hopLe = butToanThucThu([...rows]);
  const byChild = new Map<string, number>();
  let unassigned = 0;
  for (const r of hopLe) {
    if (r.leadChildId) {
      byChild.set(r.leadChildId, (byChild.get(r.leadChildId) ?? 0) + r.amount);
    } else {
      unassigned += r.amount;
    }
  }
  let total = unassigned;
  for (const v of byChild.values()) total += v;
  return { byChild, unassigned, total };
}

/**
 * THUẦN — ba con số cho TỪNG cơ sở đang chọn.
 *
 * Cơ sở không phát sinh khoản nào vẫn ra một dòng 0: bảng nhảy số dòng theo dữ liệu là
 * cách nhanh nhất để người xem tưởng cơ sở đó "không được tính".
 *
 * Lọc `butToanThucThu` chạy MỘT lần trên toàn mảng, trước khi chia — chuỗi điều chỉnh có
 * thể nằm ở hai bút toán khác nhau, chia trước rồi lọc sau là bản gốc sống sót.
 */
export function splitChildRevenueByCenter(
  rows: readonly ChildRevenueScanRow[],
  centerIds: readonly string[],
): ChildRevenueCenterRow[] {
  const hopLe = butToanThucThu([...rows]);
  const khoi = new Map<string, ChildRevenueCenterRow>();
  for (const id of centerIds) {
    khoi.set(id, { centerId: id, total: 0, assigned: 0, unassigned: 0 });
  }
  for (const r of hopLe) {
    if (!r.centerId) continue;
    const o = khoi.get(r.centerId);
    if (!o) continue;
    o.total += r.amount;
    if (r.leadChildId) o.assigned += r.amount;
    else o.unassigned += r.amount;
  }
  return centerIds.map((id) => khoi.get(id)!);
}

function emptyReport(
  groupByCenter: boolean,
  centerIds: readonly string[],
): ChildRevenueReport {
  return {
    total: 0,
    assigned: 0,
    unassigned: 0,
    rows: [],
    byCenter: groupByCenter
      ? centerIds.map((id) => ({ centerId: id, total: 0, assigned: 0, unassigned: 0 }))
      : null,
    truncated: false,
  };
}

/**
 * C-03 — doanh thu thực thu quy về từng con, trong phạm vi + khoảng ngày của bộ lọc A-02.
 *
 * ⚠️ Hàm này KHÔNG tự kiểm quyền — nó nhận `Actor` đã dựng sau `auth()`. Chỗ gọi (trang /
 * Server Action) vẫn phải gác cửa bằng `checkPermission` như mọi màn khác.
 *
 * Cách ly cơ sở HAI LỚP, cùng lý do với `scanSessionGaps`: đọc qua `scopedDb(actor)`
 * (`Payment` ∈ `SCOPED_MODELS`) VÀ tự lọc `centerId IN filters.centerIds`. Lớp thứ hai lo
 * phần lớp thứ nhất không lo — HO/SUPER_ADMIN bypass scope, nên chỉ dựa `scopedDb` thì họ
 * chọn một cơ sở mà vẫn ra số toàn hệ thống.
 *
 * Mốc thời gian là `Payment.paidDate` (ngày tiền về), khớp `lib/reports/trung-tam.ts` —
 * đổi sang `confirmedAt` là tab này lệch tab Tài chính đúng bằng độ trễ duyệt của kế toán.
 */
export async function getRevenueByLeadChild(
  actor: Actor,
  filters: ScopeFilters,
): Promise<ChildRevenueReport> {
  if (filters.centerIds.length === 0) {
    return emptyReport(filters.groupByCenter, filters.centerIds);
  }

  const sdb = scopedDb(actor);
  const where = {
    ...WHERE_THUC_THU,
    centerId: { in: [...filters.centerIds] },
    paidDate: { gte: filters.dateFrom, lte: filters.dateTo },
  };

  const scanned = (await sdb.payment.findMany({
    where,
    select: {
      id: true,
      amount: true,
      accountantStatus: true,
      adjustmentOfId: true,
      centerId: true,
      // `select` lồng KHÔNG được `scopedDb` tự lọc (giới hạn của Prisma client
      // extension) — an toàn ở đây vì cổng scope nằm trên `centerId` của chính bút toán.
      order: { select: { leadChildId: true, leadId: true } },
    },
    orderBy: { paidDate: "asc" },
    take: REVENUE_BY_CHILD_SCAN_MAX + 1,
  })) as Array<{
    id: string;
    amount: number;
    accountantStatus: string;
    adjustmentOfId: string | null;
    centerId: string | null;
    order: { leadChildId: string | null; leadId: string | null } | null;
  }>;

  const truncated = scanned.length > REVENUE_BY_CHILD_SCAN_MAX;
  const rows: ChildRevenueScanRow[] = (
    truncated ? scanned.slice(0, REVENUE_BY_CHILD_SCAN_MAX) : scanned
  ).map((p) => ({
    id: p.id,
    amount: p.amount,
    accountantStatus: p.accountantStatus,
    adjustmentOfId: p.adjustmentOfId,
    centerId: p.centerId,
    leadChildId: p.order?.leadChildId ?? null,
    leadId: p.order?.leadId ?? null,
  }));

  const tally = tallyRevenueByChild(rows);

  // Ba con số đi đường `aggregate` — đúng KỂ CẢ khi danh sách bị cắt ở trần quét. Chấp
  // nhận 2 truy vấn cộng thêm để bảng số không bao giờ nói dối.
  const [tongAgg, chuaQuyAgg] = await Promise.all([
    sdb.payment.aggregate({ where, _sum: { amount: true } }),
    sdb.payment.aggregate({
      // `Payment.orderId` là cột BẮT BUỘC + FK Restrict ⇒ mọi bút toán luôn có đơn;
      // không có ca "khoản không thuộc đơn nào" phải cộng thêm ở đây.
      where: { ...where, order: { leadChildId: null } },
      _sum: { amount: true },
    }),
  ]);
  const total = tongAgg._sum.amount ?? 0;
  const unassigned = chuaQuyAgg._sum.amount ?? 0;

  const childIds = [...tally.byChild.keys()];
  const children = childIds.length
    ? await sdb.leadChild.findMany({
        where: { id: { in: childIds } },
        select: {
          id: true,
          fullName: true,
          leadId: true,
          lead: { select: { parentName: true, centerId: true } },
        },
      })
    : [];
  const byId = new Map(children.map((c) => [c.id, c]));

  const childRows: ChildRevenueRow[] = childIds
    .map((id) => {
      const c = byId.get(id);
      return {
        leadChildId: id,
        // `LeadChild` KHÔNG nằm trong `SCOPED_MODELS` nên chỗ này không mất dòng vì scope;
        // đọc hụt chỉ xảy ra khi con đã bị xoá — vẫn phải hiện, tiền là có thật.
        childName: c?.fullName ?? "(học sinh đã xoá)",
        leadId: c?.leadId ?? null,
        parentName: c?.lead?.parentName ?? null,
        centerId: c?.lead?.centerId ?? null,
        revenue: tally.byChild.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.childName.localeCompare(b.childName, "vi"));

  return {
    total,
    assigned: total - unassigned,
    unassigned,
    rows: childRows,
    byCenter: filters.groupByCenter
      ? splitChildRevenueByCenter(rows, filters.centerIds)
      : null,
    truncated,
  };
}
