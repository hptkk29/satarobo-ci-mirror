// lib/nguon-hoa-hong/scope.ts — LÕI THUẦN của `loadNguonHoaHongScope` (05 §1.5, 06 §4.3).
//
// Tách khỏi `module-scope.ts` (nạp session + DB) để test không kéo theo next-auth/Prisma.
//
// ⚠️ KHÁC KHUÔN `lib/cham-cong/module-scope.ts`: chấm công hỏi `can(action, { centerId })` từng khối và
// chỉ có nghĩa vì quyền chấm công seed `CENTER`. Key của module này seed `GLOBAL` ⇒ `can()` trả `true` cho
// MỌI `centerId` (can.ts: scope GLOBAL luôn khớp). Chép khuôn đó là bày chip CS2 cho QLCS CS1 — lỗi "bày mọi
// cơ sở" của màn Cấu hình vận hành 24/09. Nên ở đây hai câu hỏi TÁCH RA:
//   · "CÓ quyền action này không" ⇒ `has(action)` (quyền, từ can()/grant — không theo cơ sở);
//   · "THẤY cơ sở nào"            ⇒ `coSoCua(model)` (tầm nhìn scope: `getModelVisibleCenterIds`).
// Tab nào / nút nào / chip nào hiện đều suy từ MỘT trong hai, và khớp action mà server action kiểm (luật 12).
import {
  tabMoDuoc as tabMoDuocThuan,
  tabUngVien as tabUngVienThuan,
  type CoModule,
  type TabKey,
} from "./tab";

/** Mọi key quyền của module — `loadNguonHoaHongScope` hỏi từng key MỘT lần cho cả request. */
export const MODULE_KEYS = [
  "sources:view",
  "sources:manage",
  "sources:override-after-payment",
  "commission_policies:view",
  "commission_policies:manage",
  "commission_policies:activate",
  "commission:view-self",
  "commission:view-center",
  "commission_periods:manage",
  "commission_disputes:review",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Model quyết định "thấy cơ sở nào" của từng tab (06 §4.3): tab Nguồn đọc Lead; Sổ/Khiếu nại đọc dòng sổ;
 * Kỳ đọc kỳ. ⚠️ `CommissionPeriod`/`CommissionTransaction` CHƯA có prefix trong `getModelPrefixes` (PR5a thêm
 * cùng model) — tới lúc đó `getModelVisibleCenterIds` rơi về `isHoLevel ? ALL : visibleCenterIds`, vẫn đúng
 * cho khung này; PR5a phải khai prefix để tầm nhìn đi theo key quyền (CLAUDE.md luật Nền #3).
 */
export type ScopeModel = "Lead" | "CommissionPeriod" | "CommissionTransaction";

export type CoSoThoXem = { id: string; code: string | null; name: string };
export type CoSoXem = { id: string; code: string; label: string };

/**
 * "Cơ sở" để lọc/hiện chip = cơ sở VẬN HÀNH. `Center("hoi-so")` (code "HO") là bản ghi MỒ CÔI đã biết (CLAUDE.md):
 * không OrgUnit nào trỏ tới, không lead/đơn/dòng sổ nào mang nó — chip "HO · Hội sở" chỉ là một nút lọc ra rỗng
 * (luật 12: lời hứa suông). Chấm công thêm khối Hội sở có chủ đích vì NHÂN SỰ thuộc Hội sở; lead/hoa hồng thì không.
 */
export function laCoSoVanHanh(c: Pick<CoSoThoXem, "id" | "code">): boolean {
  return c.code !== "HO" && c.id !== "hoi-so";
}

export type CenterIdsTheoModel = Record<ScopeModel, "ALL" | readonly string[]>;

export type NguonHoaHongScope = {
  has(action: ModuleKey): boolean;
  any(actions: readonly string[]): boolean;
  co: CoModule;
  tabMoDuoc(tab: TabKey): boolean;
  tabUngVien(): TabKey[];
  /** Cơ sở người xem được THẤY theo model — dựng chip ScopeBar từ đây, không từ can(). */
  coSoCua(model: ScopeModel): CoSoXem[];
  /** `?coSo=` đúng một cơ sở NGƯỜI XEM THẤY thì trả nó; ngoài tầm nhìn ⇒ null (KHÔNG rơi về cơ sở khác). Cho tab có chế độ "Tất cả cơ sở". */
  timCoSo(coSoId: string | null | undefined, model: ScopeModel): CoSoXem | null;
  /** `?coSo=` còn hợp lệ thì dùng, không thì cơ sở đầu tiên được thấy; không thấy cơ sở nào ⇒ null. */
  chonCoSo(coSoId: string | null | undefined, model: ScopeModel): CoSoXem | null;
};

export function dungNguonHoaHongScope(p: {
  quyen: ReadonlySet<ModuleKey>;
  co: CoModule;
  centerIds: CenterIdsTheoModel;
  cacCoSo: readonly CoSoThoXem[];
}): NguonHoaHongScope {
  const has = (a: ModuleKey) => p.quyen.has(a);
  const any = (as: readonly string[]) => as.some((a) => p.quyen.has(a as ModuleKey));
  const dauVao = { coQuyen: any, co: p.co };

  const coSoCua = (model: ScopeModel): CoSoXem[] => {
    const ids = p.centerIds[model];
    return p.cacCoSo
      .filter(laCoSoVanHanh)
      .filter((c) => ids === "ALL" || ids.includes(c.id))
      .map((c) => ({ id: c.id, code: c.code ?? c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
  };

  return {
    has,
    any,
    co: p.co,
    tabMoDuoc: (tab) => tabMoDuocThuan(tab, dauVao),
    tabUngVien: () => tabUngVienThuan(dauVao),
    coSoCua,
    timCoSo(coSoId, model) {
      return coSoCua(model).find((c) => c.id === coSoId) ?? null;
    },
    chonCoSo(coSoId, model) {
      const duoc = coSoCua(model);
      return duoc.find((c) => c.id === coSoId) ?? duoc[0] ?? null;
    },
  };
}
