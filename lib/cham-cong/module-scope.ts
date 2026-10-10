// lib/cham-cong/module-scope.ts — NGUỒN QUYỀN DUY NHẤT của module chấm công (admin).
//
// Vì sao file này tồn tại: 13 màn cũ mỗi màn tự lặp `checkPermission` trên danh sách cơ sở
// + Hội sở rồi `redirect` câm, nên quyền lệch nhau giữa các màn và không màn nào nói được
// "thiếu quyền gì, hỏi ai". Ở đây tính MỘT lần cho cả module: mọi khối × 7 action, để page,
// ModuleNav và ScopeBar đọc chung một bảng thay vì mỗi nơi một vòng lặp.
//
// ⚠️ Action là BIẾN trong vòng lặp — CÓ CHỦ ĐÍCH, không phải mẹo lách test. `lib/auth/
// rbac-scope.test.ts` (R1) chỉ đếm call-site LITERAL TRẦN (`checkPermission("hr_attendance:
// view")` không tham số thứ hai); 7 action của module đều seed scope CENTER ở nhiều RoleDef
// nên literal trần là đỏ VÀ sai nghiệp vụ. Ở đây action đi qua biến, còn `target` thì LUÔN
// THẬT (`{ centerId: b.id }`) — quyền vẫn được hỏi đúng theo từng khối.
// `resolveActor` đã React.cache nên 21 lượt hỏi trong một request chỉ tốn 1 query.
//
// KHÔNG 'use server': đây là module server thường (page gọi trực tiếp). File 'use server'
// thì MỌI export biến thành endpoint POST — helper thuần không được ở đó.
import { resolveActor, type Target } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID, loadCenterMap } from "./home-center";

/** 7 action của module. `hr_attendance:checkin` KHÔNG nằm đây: nó GLOBAL, không theo khối. */
export const MODULE_ACTIONS = [
  "hr_attendance:view",
  "hr_attendance:assign",
  "hr_attendance:config",
  "hr_attendance:approve",
  "hr_attendance:adjust",
  "hr_attendance:close-period",
  "hr_attendance:export",
] as const;

export type ModuleAction = (typeof MODULE_ACTIONS)[number];

/** Một "khối" = cơ sở vận hành (CS1, CS2…) hoặc Hội sở. `id` dùng thẳng làm `?coSo=`. */
export type ScopeBlock = {
  id: string;
  code: string;
  label: string;
  perms: Record<ModuleAction, boolean>;
};

export type ModuleScope = {
  /** MỌI khối người dùng có thể thấy tên, kể cả khối họ không có quyền nào — chip lọc
   *  phải dựng từ `blocksWith(action)` chứ không phải từ mảng này. */
  blocks: ScopeBlock[];
  has(action: ModuleAction, centerId: string | null | undefined): boolean;
  blocksWith(action: ModuleAction): ScopeBlock[];
  any(action: ModuleAction): boolean;
  /** Khối đang chọn: `?coSo=` nếu còn hợp lệ, không thì khối đầu tiên có quyền. */
  pick(coSo: string | null | undefined, action: ModuleAction): ScopeBlock | null;
};

/**
 * Ai cấp được quyền này — in trong `<NoPermission askWho>` để 13 màn không còn
 * `redirect` câm. Nội dung là VAI NGHIỆP VỤ, không phải mã RoleDef (người đọc là QLCS,
 * kế toán, giáo viên — họ không tra bảng vai).
 */
export const ASK_WHO: Record<ModuleAction | "hr_attendance:checkin", string> = {
  "hr_attendance:view": "Quản lý cơ sở hoặc HR Hội sở",
  "hr_attendance:assign": "Quản lý cơ sở hoặc HR Hội sở",
  "hr_attendance:adjust": "Quản lý cơ sở hoặc HR Hội sở",
  "hr_attendance:approve": "Quản lý cơ sở",
  "hr_attendance:close-period": "Kế toán cơ sở hoặc Kế toán Hội sở",
  "hr_attendance:export": "Kế toán cơ sở hoặc Kế toán Hội sở",
  "hr_attendance:config": "HR Hội sở hoặc Quản lý cơ sở",
  "hr_attendance:checkin": "HR",
};

function emptyPerms(): Record<ModuleAction, boolean> {
  const p = {} as Record<ModuleAction, boolean>;
  for (const a of MODULE_ACTIONS) p[a] = false;
  return p;
}

function makeScope(blocks: ScopeBlock[]): ModuleScope {
  return {
    blocks,
    has(action, centerId) {
      if (!centerId) return false;
      return blocks.find((b) => b.id === centerId)?.perms[action] ?? false;
    },
    blocksWith(action) {
      return blocks.filter((b) => b.perms[action]);
    },
    any(action) {
      return blocks.some((b) => b.perms[action]);
    },
    pick(coSo, action) {
      const allowed = blocks.filter((b) => b.perms[action]);
      return allowed.find((b) => b.id === coSo) ?? allowed[0] ?? null;
    },
  };
}

/**
 * Bảng quyền của cả module cho một người, trong một lượt render.
 *
 * Danh sách khối = cơ sở đang hoạt động có mã vận hành (`loadCenterMap().byCode`) theo
 * `displayOrder`, đọc qua `scopedDb` để người cấp cơ sở không thấy tên cơ sở khác, cộng
 * khối Hội sở cố định (`Center("hoi-so")` là bản ghi mồ côi — CLAUDE.md — nên không lấy
 * được từ truy vấn trên).
 */
export async function loadModuleScope(userId: string): Promise<ModuleScope> {
  const map = await loadCenterMap();
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);
  const centers = await sdb.center.findMany({
    where: { isActive: true, code: { in: Object.keys(map.byCode) } },
    select: { id: true, code: true, name: true },
    orderBy: { displayOrder: "asc" },
  });

  const raw: { id: string; code: string; label: string }[] = [
    ...centers.map((c) => ({ id: c.id, code: c.code ?? c.id, label: `${c.code ?? c.id} · ${c.name}` })),
    { id: HO_CENTER_ID, code: "HO", label: "Hội sở" },
  ];

  const blocks: ScopeBlock[] = [];
  for (const b of raw) {
    const perms = emptyPerms();
    for (const action of MODULE_ACTIONS) {
      const target: Target = { centerId: b.id };
      perms[action] = await checkPermission(action, target);
    }
    blocks.push({ ...b, perms });
  }
  return makeScope(blocks);
}

/** Dựng ModuleScope từ dữ liệu có sẵn — chỉ cho test/story dùng, không chạm quyền. */
export function moduleScopeFrom(blocks: ScopeBlock[]): ModuleScope {
  return makeScope(blocks);
}

/** Gương của `AttendancePeriodStatus` (Prisma). Khai lại ở đây để component vỏ admin
 *  nhập kiểu này mà không kéo `@prisma/client` vào cây import của chúng. */
export type PeriodStatus = "OPEN" | "CLOSING" | "LOCKED" | "REOPENED";

type ScopedClient = ReturnType<typeof scopedDb>;

/**
 * Trạng thái kỳ + công chuẩn để ScopeBar in ở MỌI màn.
 *
 * ⚠️ `findUnique` THUẦN, cố ý KHÔNG gọi `getOrCreatePeriod`: hàm đó `upsert` (ghi). ScopeBar
 * hiện trên 8 màn và người dùng lướt qua nhiều khối/tháng, nên gọi nó ở tầng đọc sẽ MỞ KỲ
 * cho từng cơ sở × từng tháng người ta vô tình bấm vào. Chưa có kỳ ⇒ trả null ⇒ pill in
 * "Chưa mở kỳ" và ẩn công chuẩn; kỳ chỉ được mở ở màn Kỳ công.
 */
export async function periodStatusOf(
  sdb: ScopedClient,
  coSo: string,
  ky: string,
): Promise<{ status: PeriodStatus | null; standardUnits: number | null }> {
  if (!coSo || !ky) return { status: null, standardUnits: null };
  const row = await sdb.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId: coSo, periodKey: ky } },
    select: { status: true, standardUnits: true },
  });
  if (!row) return { status: null, standardUnits: null };
  return { status: row.status, standardUnits: row.standardUnits ?? null };
}
