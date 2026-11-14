// lib/reports/converted-leads.ts — C-03 · bảng "Lead đã chuyển đổi" (9 cột).
//
// MỘT DÒNG = MỘT HỌC SINH (G-07 + CHUNG-2), không phải một phiếu phụ huynh: một phụ
// huynh cho hai con vào học là HAI dòng. Đây là chỗ dễ đọc nhầm nhất của bảng, nên màn
// hình phải nói ra bằng chữ chứ không để người xem tự suy.
//
// Nối lại thứ ĐÃ CÓ, không dựng lại cái nào:
//   • `lib/lead/close-mark.ts` — `CLOSED_CHILD_STATUS` là định nghĩa DUY NHẤT của "đã
//     chốt" (quyết định B2 24/08/2026: đã ghi danh thành học viên, KHÔNG tính "đã trả
//     tiền nhưng chưa ghi danh"). Đổi hằng đó là đổi nghĩa của cả C-02 lẫn bảng này.
//   • `lib/reports/revenue-by-child.ts` — `getRevenueByLeadChild()` là công thức thực
//     thu DUY NHẤT (B3: trừ hoàn tiền, loại bản gốc đã bị điều chỉnh). Cột "giá trị" ở
//     đây CHỈ tra kết quả của nó. Cộng `LeadChild.contractValue` vào là làm tổng phồng
//     đúng bằng phần khách chưa đóng, và vẫn ra một con số trông hợp lý nên không ai
//     phát hiện.
//   • `lib/lead/pii.ts` — `maskLeadPiiFields`. "Báo cáo nội bộ" KHÔNG phải lý do đọc
//     cột thô: che ở JSX thì dữ liệu thật vẫn xuống trình duyệt qua RSC payload.
//
// ┌─ HAI TRỤC NGÀY KHÁC NHAU — đọc kỹ, đây là nguồn của mọi hiểu nhầm về bảng này ─────┐
// │ • DÒNG lọc theo `LeadChild.closedAt` (thương vụ CHỐT trong kỳ) — khớp SQL tham     │
// │   chiếu của PRD §C.6.7 và cùng trục với "thời gian chốt trung bình" (C4).          │
// │ • TIỀN lọc theo `Payment.paidDate` (tiền VỀ trong kỳ) — trục của tab Tài chính.    │
// │ Hai trục lệch nhau là CỐ Ý và có hệ quả thật: con chốt ngày 30 mà tiền về ngày 02  │
// │ tháng sau sẽ có dòng với giá trị 0; còn tiền trả góp của con chốt từ tháng trước   │
// │ thì nằm trong tổng kỳ này nhưng KHÔNG có dòng nào mang nó.                         │
// │ ⇒ Vì vậy bảng bắt buộc có khối ĐỐI SOÁT ba mảnh (xem `reconcileConvertedRevenue`). │
// │ Bỏ khối đó đi là tổng của bảng này thấp hơn tab Tài chính trên CÙNG một màn hình   │
// │ mà không ai giải thích được — đúng loại hỏng câm mà B-02/N-2 vừa dọn.              │
// └───────────────────────────────────────────────────────────────────────────────────┘
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { CLOSED_CHILD_STATUS } from "@/lib/lead/close-mark";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { getRevenueByLeadChild } from "@/lib/reports/revenue-by-child";
import type { ScopeFilters } from "@/lib/reports/scope-filters";

/**
 * Trần số HỌC SINH đọc về. Vượt trần thì bảng bị cắt và `truncated` bật để màn hình nói
 * ra — im lặng cắt một bảng doanh số là để người ta cộng nhẩm rồi kết luận sai.
 */
export const CONVERTED_LEAD_SCAN_MAX = 500;

const MS_MOT_NGAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Phần THUẦN — dựng dòng từ dữ liệu đã đọc sẵn (Vitest không cần DB)
// ─────────────────────────────────────────────────────────────────────────────

/** Một học sinh đã chốt, đã phẳng hoá từ `LeadChild` + `Lead` cha. */
export type ConvertedLeadChildInput = {
  leadChildId: string;
  leadId: string;
  childName: string;
  parentName: string;
  /** `LeadChild.interestedCourseId` (tham chiếu MỀM) → tên; rơi về `Lead.courseId`. */
  courseName: string | null;
  /** `Lead.centerId` — `LeadChild` chưa có cột cơ sở riêng (SL-08 chưa làm). */
  centerId: string | null;
  assignedToName: string | null;
  /** Cột 7 — thời điểm HỌC SINH vào hệ thống (`LeadChild.createdAt`). */
  enteredAt: Date;
  /** Cột 8 — thời điểm chốt (`LeadChild.closedAt`), đã lọc NOT NULL ở đường đọc. */
  closedAt: Date;
};

/** Một dòng của bảng C-03 — đúng 9 cột spec đòi, đã che PII. */
export type ConvertedLeadRow = {
  leadChildId: string;
  /** Cột 1 — link `/leads/<leadId>`. */
  leadId: string;
  /** Cột 1 — ĐÃ che theo quyền PII. */
  childName: string;
  /** Cột 1 — ĐÃ che theo quyền PII. */
  parentName: string;
  /** Cột 2. */
  courseName: string | null;
  /** Cột 3. */
  centerId: string | null;
  /** Cột 4 — *ai đang chăm*, không phải *ai mang lead về*. */
  assignedToName: string | null;
  /** Cột 7. */
  enteredAt: Date;
  /** Cột 8. */
  closedAt: Date;
  /**
   * Cột 5 — THỰC THU quy về con này, trong kỳ đang lọc.
   * `null` = người xem không có quyền xem tiền. `0` = có quyền, và thật sự chưa có
   * khoản nào của em rơi vào kỳ — hai thứ khác hẳn nhau nên không được gộp.
   */
  revenue: number | null;
  /** Cột 6 — tỷ lệ 0..1 trên tổng thực thu CÙNG kỳ + CÙNG phạm vi. `null` = không chia được. */
  revenueShare: number | null;
  /** Cột 9 — số ngày thực. `null` = dữ liệu bẩn (chốt TRƯỚC khi vào hệ thống). */
  daysToClose: number | null;
};

/**
 * THUẦN — dựng danh sách dòng C-03, đã che PII và đã sắp xếp.
 *
 * @param revenueByChild bản đồ `leadChildId → thực thu` lấy từ `getRevenueByLeadChild`.
 *   `null` = người xem KHÔNG có quyền xem tiền ⇒ hai cột tiền đều `null`.
 * @param totalRevenue mẫu số cột 6 = tổng thực thu của CÙNG phạm vi + CÙNG kỳ (B1),
 *   không phải doanh thu toàn hệ thống.
 */
export function buildConvertedLeadRows(args: {
  children: readonly ConvertedLeadChildInput[];
  revenueByChild: ReadonlyMap<string, number> | null;
  totalRevenue: number;
  canViewPii: boolean;
}): ConvertedLeadRow[] {
  const coTien = args.revenueByChild !== null;

  const rows = args.children.map((c) => {
    // Che MỘT LƯỢT qua tầng chung — cả hai khoá đều nằm trong `sensitiveFields` của
    // `leads:view-pii`.
    const che = maskLeadPiiFields(
      { parentName: c.parentName, childName: c.childName },
      args.canViewPii,
    );

    const revenue = coTien ? (args.revenueByChild!.get(c.leadChildId) ?? 0) : null;
    const revenueShare =
      revenue !== null && args.totalRevenue > 0 ? revenue / args.totalRevenue : null;

    const chenhMs = c.closedAt.getTime() - c.enteredAt.getTime();

    return {
      leadChildId: c.leadChildId,
      leadId: c.leadId,
      childName: che.childName ?? "",
      parentName: che.parentName ?? "",
      courseName: c.courseName,
      centerId: c.centerId,
      assignedToName: c.assignedToName,
      enteredAt: c.enteredAt,
      closedAt: c.closedAt,
      revenue,
      revenueShare,
      // Chốt TRƯỚC khi vào hệ thống là dữ liệu bẩn (mốc chốt của ca cũ không dựng lại
      // được). Bỏ dòng = giấu một thương vụ có tiền thật; hiện "−3 ngày" = để người đọc
      // tưởng hệ thống tính sai. Giữ dòng, đánh dấu bẩn, và nói ra ở cột 9.
      daysToClose: chenhMs < 0 ? null : chenhMs / MS_MOT_NGAY,
    } satisfies ConvertedLeadRow;
  });

  // Thương vụ mới nhất lên đầu (khớp `ORDER BY closedAt DESC` của SQL tham chiếu). Hoà
  // thì xếp theo tên để bảng không nhảy giữa hai lần tải.
  return rows.sort(
    (a, b) =>
      b.closedAt.getTime() - a.closedAt.getTime() ||
      a.childName.localeCompare(b.childName, "vi"),
  );
}

/** Ba mảnh tiền của kỳ — cộng lại đúng bằng con số của tab Tài chính. */
export type ConvertedRevenueReconcile = {
  /** Σ giá trị các dòng ĐANG hiện trong bảng. */
  rowsRevenue: number;
  /**
   * Thực thu ĐÃ quy được về con nhưng con đó KHÔNG có dòng trong bảng — chốt ở kỳ khác
   * (trả góp, đóng theo đợt) hoặc chưa được đánh dấu chốt.
   */
  otherChildRevenue: number;
  /** Thực thu CHƯA quy được về con nào (`Order.leadChildId = NULL`). */
  unassignedRevenue: number;
  /** Tổng thực thu của kỳ + phạm vi — phải khớp tab Tài chính. */
  totalRevenue: number;
};

/**
 * THUẦN — chia tổng thực thu của kỳ thành ba mảnh để bảng tự đối soát được.
 *
 * ⚠️ `otherChildRevenue` tính bằng PHÉP TRỪ nên phải kẹp ở 0: khi `getRevenueByLeadChild`
 * cắt ở trần quét thì `rowsRevenue` có thể lớn hơn phần còn lại của tổng, và một con số
 * âm trong bảng tiền là thứ phá niềm tin nhanh nhất.
 */
export function reconcileConvertedRevenue(args: {
  rows: readonly ConvertedLeadRow[];
  totalRevenue: number;
  unassignedRevenue: number;
}): ConvertedRevenueReconcile {
  const rowsRevenue = args.rows.reduce((s, r) => s + (r.revenue ?? 0), 0);
  const conLai = args.totalRevenue - args.unassignedRevenue - rowsRevenue;
  return {
    rowsRevenue,
    otherChildRevenue: Math.max(0, conLai),
    unassignedRevenue: args.unassignedRevenue,
    totalRevenue: args.totalRevenue,
  };
}

/**
 * Cột 9 — quy ước hiển thị của PRD §C.6.4: `< 1 ngày` / `X,Y ngày`.
 *
 * Dưới 1 ngày KHÔNG làm tròn thành "0 ngày": một thương vụ chốt trong buổi chiều không
 * phải là "0 ngày để chốt".
 */
export function formatDaysToClose(days: number | null): string {
  if (days === null) return "— (chốt trước ngày vào hệ thống)";
  if (days < 1) return "< 1 ngày";
  return `${days.toFixed(1).replace(".", ",")} ngày`;
}

/** Cột 6 — `null` (mẫu số 0 hoặc thiếu quyền xem tiền) hiện `—`, KHÔNG hiện `0%`. */
export function formatRevenueShare(share: number | null): string {
  if (share === null) return "—";
  return `${(share * 100).toFixed(1).replace(".", ",")}%`;
}

/** Mệnh đề cơ sở áp lên `Lead` cha — hình dạng `where` của Prisma. */
export type ConvertedLeadCenterWhere =
  | { centerId: { in: string[] } }
  | { OR: [{ centerId: { in: string[] } }, { centerId: null }] };

/**
 * THUẦN — dựng mệnh đề cơ sở cho `Lead` cha. 🔒 ĐÂY LÀ CỔNG CÁCH LY DUY NHẤT của C-03.
 *
 * ⚠️ Khác `getLostLeadRows`: bảng lead rớt đọc thẳng `sdb.lead` — `Lead` ∈ `SCOPED_MODELS`
 * nên `injectScope` còn chèn thêm một lớp `centerId IN (tầm nhìn)` ở ngoài. C-03 đọc
 * `sdb.leadChild`, mà `LeadChild` **không** có cột cơ sở nào nên **không** nằm trong
 * `SCOPED_MODELS` ⇒ `scopedDb` là pass-through và **không chèn gì cả**, kể cả vào bộ lọc
 * quan hệ lồng bên trong (`injectScope` chỉ chạm `where` ở tầng ngoài cùng).
 *
 * Hệ quả phải tự lo ở đây: nhánh `centerId: null` (phiếu CHƯA gán cơ sở) chỉ được mở cho
 * người có tầm nhìn TOÀN hệ thống. Chép nguyên nhánh đó từ `lost-leads.ts` sang là quản
 * lý một cơ sở bấm "Tất cả cơ sở" liền thấy học sinh đã chốt của phiếu chưa gán ở khắp
 * nơi — rò chéo cơ sở ở đúng bảng doanh số.
 */
export function buildConvertedLeadCenterWhere(args: {
  centerIds: readonly string[];
  isAllCenters: boolean;
  /** `actor.isSuperAdmin || actor.isHoLevel` — đúng tập mà `scopedDb` cho qua "ALL". */
  canSeeUnassigned: boolean;
}): ConvertedLeadCenterWhere {
  const inList = { centerId: { in: [...args.centerIds] } };
  if (args.isAllCenters && args.canSeeUnassigned) {
    // "Tất cả cơ sở" + tầm nhìn toàn hệ thống ⇒ gộp cả phiếu chưa gán cơ sở. Bỏ chúng đi
    // là khối đối soát cuối bảng lệch mà không có dòng nào nói vì sao.
    return { OR: [inList, { centerId: null }] };
  }
  return inList;
}

// ─────────────────────────────────────────────────────────────────────────────
// Đường đọc DB
// ─────────────────────────────────────────────────────────────────────────────

export type ConvertedLeadReport = {
  rows: ConvertedLeadRow[];
  /** true = vượt `CONVERTED_LEAD_SCAN_MAX`; bảng đang thiếu học sinh, màn hình phải nói ra. */
  truncated: boolean;
  /** Số dòng có `daysToClose = null` (chốt trước ngày vào hệ thống). */
  invalidDurationCount: number;
  /** `null` = người xem không có quyền xem tiền ⇒ không đọc `Payment` lần nào. */
  revenue: (ConvertedRevenueReconcile & { truncated: boolean }) | null;
};

const RONG: ConvertedLeadReport = {
  rows: [],
  truncated: false,
  invalidDurationCount: 0,
  revenue: null,
};

/**
 * C-03 — học sinh đã chốt trong phạm vi + khoảng ngày của bộ lọc A-02.
 *
 * ⚠️ Hàm này KHÔNG tự kiểm quyền — nó nhận `Actor` đã dựng sau `auth()`. Chỗ gọi vẫn
 * phải gác cửa: tab C mở bằng `leads:view-all`, và `includeRevenue` phải là kết quả của
 * `checkPermission("payments:view")` — vào được dashboard KHÔNG đồng nghĩa xem được tiền.
 *
 * 🔒 Cách ly cơ sở nằm TRỌN ở `buildConvertedLeadCenterWhere` — đọc chú thích của hàm đó
 * trước khi sửa mệnh đề `lead:` bên dưới. `LeadChild` không thuộc `SCOPED_MODELS` nên
 * `scopedDb` KHÔNG chèn thêm lớp nào cho truy vấn này; ở đây không có lưới an toàn thứ hai.
 */
export async function getConvertedLeadRows(
  actor: Actor,
  filters: ScopeFilters,
  opts: { canViewPii: boolean; includeRevenue: boolean },
): Promise<ConvertedLeadReport> {
  if (filters.centerIds.length === 0) return RONG;

  const sdb = scopedDb(actor);
  const centerWhere = buildConvertedLeadCenterWhere({
    centerIds: filters.centerIds,
    isAllCenters: filters.isAllCenters,
    canSeeUnassigned: actor.isSuperAdmin || actor.isHoLevel,
  });

  const scanned = await sdb.leadChild.findMany({
    where: {
      status: CLOSED_CHILD_STATUS,
      // `closedAt IS NOT NULL` là điều kiện BẮT BUỘC của định nghĩa "đã chốt" (§C.6.0):
      // nhận `status = ENROLLED` mà `closedAt` rỗng thì cột 8 và cột 9 trống, và bảng
      // đếm một tập khác với C-02. Khoảng `gte/lte` đã tự loại `null`, `not: null` ở đây
      // là để đọc code không phải suy ra điều đó.
      closedAt: { not: null, gte: filters.dateFrom, lte: filters.dateTo },
      lead: { deletedAt: null, ...centerWhere },
    },
    select: {
      id: true,
      fullName: true,
      createdAt: true,
      closedAt: true,
      interestedCourseId: true,
      lead: {
        select: {
          id: true,
          parentName: true,
          centerId: true,
          courseId: true,
          assignedTo: { select: { name: true } },
        },
      },
    },
    orderBy: { closedAt: "desc" },
    take: CONVERTED_LEAD_SCAN_MAX + 1,
  });

  const truncated = scanned.length > CONVERTED_LEAD_SCAN_MAX;
  const daCat = truncated ? scanned.slice(0, CONVERTED_LEAD_SCAN_MAX) : scanned;

  // Khoá học là THAM CHIẾU MỀM (`interestedCourseId` không có FK) ⇒ Prisma không join hộ.
  // Đọc rời rồi tra bản đồ; khoá học đã bị xoá thì hiện `—`, KHÔNG mất dòng.
  const courseIds = [
    ...new Set(
      daCat
        .map((c) => c.interestedCourseId ?? c.lead?.courseId ?? null)
        .filter((id): id is string => !!id),
    ),
  ];
  const courses = courseIds.length
    ? await sdb.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, name: true },
      })
    : [];
  const courseNameById = new Map(courses.map((c) => [c.id, c.name]));

  const children: ConvertedLeadChildInput[] = [];
  for (const c of daCat) {
    if (!c.closedAt || !c.lead) continue;
    const courseId = c.interestedCourseId ?? c.lead.courseId ?? null;
    children.push({
      leadChildId: c.id,
      leadId: c.lead.id,
      childName: c.fullName,
      parentName: c.lead.parentName,
      courseName: courseId ? (courseNameById.get(courseId) ?? null) : null,
      centerId: c.lead.centerId,
      assignedToName: c.lead.assignedTo?.name ?? null,
      enteredAt: c.createdAt,
      closedAt: c.closedAt,
    });
  }

  // Tiền: MỘT đường duy nhất — `getRevenueByLeadChild` (công thức thực thu đã trừ hoàn /
  // điều chỉnh). Không có quyền xem tiền thì KHÔNG đọc `Payment` lần nào, thay vì đọc
  // rồi mới giấu ở tầng hiển thị.
  const bcTien = opts.includeRevenue
    ? await getRevenueByLeadChild(actor, filters)
    : null;

  const rows = buildConvertedLeadRows({
    children,
    revenueByChild: bcTien
      ? new Map(bcTien.rows.map((r) => [r.leadChildId, r.revenue]))
      : null,
    totalRevenue: bcTien?.total ?? 0,
    canViewPii: opts.canViewPii,
  });

  return {
    rows,
    truncated,
    invalidDurationCount: rows.filter((r) => r.daysToClose === null).length,
    revenue: bcTien
      ? {
          ...reconcileConvertedRevenue({
            rows,
            totalRevenue: bcTien.total,
            unassignedRevenue: bcTien.unassigned,
          }),
          truncated: bcTien.truncated,
        }
      : null,
  };
}
