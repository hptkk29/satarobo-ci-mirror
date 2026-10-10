// tests/lead-intake/_nguon-fixture.ts — đồ dùng chung cho các ca DB của PR1 "nền nguồn" (07 §3.2).
//
// ⚠️ KHÔNG tin 9 dòng danh mục do migration chèn: `resetDb()` TRUNCATE mọi bảng và job `chat-db-tests`
// chạy TRƯỚC `test:lead-intake` trong cùng DB CI (E3, `ci.yml:256-271`). Ca nào cần danh mục thì TỰ
// dựng bằng `damBaoDanhMucGoc` — upsert theo `code`, ghi MỌI cột ở cả nhánh create lẫn update (PB-2:
// thiếu `isSystem` thì dòng tạo ra mang `@default(false)` và ca `[NHH-SRC-01]` đỏ/xanh tuỳ thứ tự tệp).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DANH_MUC_GOC, type MaNhomGoc } from "../../lib/nguon/danh-muc-goc";
import type { DuLieuNguon } from "../../lib/nguon/ghi-nguon";
import { clearSettingsCache } from "../../lib/settings/service";

type Client = PrismaClient | Prisma.TransactionClient;

/** mã nhóm → id dòng `LeadSourceGroup`. */
export type IdNhom = Record<MaNhomGoc, string>;

export async function damBaoDanhMucGoc(c: Client): Promise<IdNhom> {
  const ra = {} as IdNhom;
  for (const g of DANH_MUC_GOC) {
    const cot = {
      documentNo: g.documentNo,
      name: g.name,
      description: g.description,
      referrerRequirement: g.referrerRequirement,
      requiresNote: g.requiresNote,
      selectable: g.selectable,
      isSystem: g.isSystem,
      sortOrder: g.sortOrder,
      status: g.status,
      // Nguồn động: nếu fixture quên hai cột này thì dòng ra đời mang @default (OTHER / false) và lưới [NHH-SRC-01] đỏ/xanh tuỳ thứ tự tệp.
      sourceType: g.sourceType,
      commissionEnabled: g.commissionEnabled,
      // Cột CẤU HÌNH mà màn Nguồn sửa được (kể cả trên nguồn hệ thống): về mặc định, kẻo ca ghi danh mục để lại cửa sổ riêng / người phụ trách / hiệu lực
      // cho bộ chạy SAU (đo 09/10: cửa sổ 45 ngày của PAID_ADS làm đỏ [DYN-WIN-UI]).
      attributionWindowDays: null,
      ownerOrgUnitId: null,
      ownerEmployeeId: null,
      effectiveFrom: null,
      effectiveTo: null,
    } as const;
    const r = await c.leadSourceGroup.upsert({
      where: { code: g.code },
      create: { code: g.code, ...cot },
      update: cot,
      select: { id: true },
    });
    ra[g.code] = r.id;
  }
  return ra;
}

/**
 * TỔ CHỨC TỐI THIỂU mà ca cần (Center + OrgUnit + vai) — LUẬT 18: một ca KHÔNG được mượn cơ sở/đơn vị/vai do bộ trước để lại.
 *
 * Đo 08/10/2026 (task H-TEST-INDEPENDENCE): ba tệp (`nguon-noi-day`, `nguon-noi-day-duong`, `nguon-thu-thap-tin-hieu`) gọi
 * `findUniqueOrThrow({ code: "CS1" })` mà KHÔNG TỰ DỰNG — chạy MỘT MÌNH trên DB trống (đã migrate + seed vai) thì 33 ca đỏ với
 * `No Center found` / `No OrgUnit found`; chạy cả thư mục thì xanh vì các tệp `nguon-ui-*` (chạy SAU theo bảng chữ cái) …
 * và CI chạy bộ `nen`/`chat` trước đã dựng sẵn. Xanh vì thứ tự, không phải vì ca đúng.
 *
 * Idempotent (upsert theo `code`); `seedOrg` tự chặn DB không phải DB test. Vai chỉ seed khi THIẾU (seed-roles là bước của CI, nhưng ca không được
 * phụ thuộc vào việc ai đó đã chạy nó).
 */
export async function damBaoToChuc(p: { donVi?: readonly string[]; vai?: readonly string[] } = {}): Promise<void> {
  const { db } = await import("../../lib/db");
  const { seedOrg, seedRoles } = await import("../e2e/_helpers/seed");
  await seedOrg([...(p.donVi ?? ["HO", "CS1", "CS2"])]);
  const can = p.vai ?? ["CENTER_SALES_CSM"];
  if ((await db.roleDef.count({ where: { code: { in: [...can] } } })) < can.length) await seedRoles();
}

/** `DuLieuNguon` đầy đủ trường (luật 7) — chỗ gọi ghi đè đúng thứ cần đổi. */
export function duLieuNguon(groupId: string, tuyChon: Partial<DuLieuNguon> = {}): DuLieuNguon {
  return {
    groupId,
    otherSourceNote: null,
    referrerKind: null,
    referrerEmployeeId: null,
    referrerParentUserId: null,
    referrerStudentId: null,
    referrerAffiliateId: null,
    referrerMissing: false,
    referrerRoleCode: null,
    referrerSaleUserId: null,
    identificationMethod: "MANUAL",
    matchedRule: "TEST",
    reasonText: "ca test",
    canhBao: [],
    originalGroupId: groupId,
    inheritedFromLeadId: null,
    conversionEntry: null,
    signals: null,
    attributedAt: null,
    ...tuyChon,
  };
}

/**
 * Khối giữa hai dấu `-- >>> SEED LeadSourceGroup` / `-- <<< SEED LeadSourceGroup` của migration —
 * MỘT câu INSERT (… ON CONFLICT DO NOTHING). Ca `[NHH-SRC-01]` chạy nó hai lần.
 */
export function docKhoiSeedSql(): string {
  const goc = resolve(process.cwd(), "prisma/migrations");
  const thuMuc = readdirSync(goc).filter((d) => d.endsWith("_nguon_lead_attribution"));
  if (thuMuc.length !== 1) throw new Error(`Cần đúng 1 thư mục *_nguon_lead_attribution, thấy ${thuMuc.length}`);
  const sql = readFileSync(resolve(goc, thuMuc[0]!, "migration.sql"), "utf8");
  const dau = "-- >>> SEED LeadSourceGroup";
  const cuoi = "-- <<< SEED LeadSourceGroup";
  const a = sql.indexOf(dau);
  const b = sql.indexOf(cuoi);
  if (a < 0 || b < a) throw new Error("Không thấy hai dấu của khối seed trong migration.sql");
  return sql.slice(a + dau.length, b).trim();
}

// ── PR2 "nối dây intake" ─────────────────────────────────────────────────────────────────────────────────

export type CoNguonTest = {
  enabled?: boolean;
  autoAttribution?: boolean;
  pageMapping?: boolean;
  referral?: boolean;
  manualReview?: boolean;
};

/**
 * Đặt cờ `nguon.*` TOÀN HỆ trong `SystemSetting` rồi xoá cache. Cờ KHÔNG nêu ⇒ XOÁ dòng (về mặc định `false`) —
 * ca nào cũng tự dựng lại cờ của mình (luật 18), không mượn trạng thái ca trước.
 * Dùng chuỗi khoá THÔ có chủ đích: lưới [NHH-FLG-05] cấm chuỗi này ở `lib/` `app/` `components/` `scripts/`, KHÔNG cấm ở tests.
 */
export async function datCoNguon(c: CoNguonTest, extra: Record<string, unknown> = {}): Promise<void> {
  const { db } = await import("../../lib/db");
  const khoa: Record<string, boolean | undefined> = {
    "nguon.enabled": c.enabled,
    "nguon.autoAttribution": c.autoAttribution,
    "nguon.pageMapping": c.pageMapping,
    "nguon.referral": c.referral,
    "nguon.manualReview": c.manualReview,
  };
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  for (const [key, v] of Object.entries(khoa)) {
    if (v !== undefined) await db.systemSetting.create({ data: { key, valueJson: v } });
  }
  for (const [key, v] of Object.entries(extra)) {
    await db.systemSetting.create({ data: { key, valueJson: v as never } });
  }
  clearSettingsCache();
}

/** Bật CẢ master lẫn bốn cờ con — cấu hình "đầy đủ" mà đa số ca dùng. */
export const CO_NGUON_DAY_DU: CoNguonTest = {
  enabled: true,
  autoAttribution: true,
  pageMapping: true,
  referral: true,
  manualReview: true,
};

/** Đặt cờ ép chọn nguồn RIÊNG một cơ sở (`CenterSetting`, khoá theo OrgUnit.id). */
export async function datEpChonNguonCoSo(orgUnitId: string, bat: boolean | null): Promise<void> {
  const { db } = await import("../../lib/db");
  await db.centerSetting.deleteMany({ where: { orgUnitId, key: "nguon.epChonNguon" } });
  if (bat !== null) await db.centerSetting.create({ data: { orgUnitId, key: "nguon.epChonNguon", valueJson: bat } });
  clearSettingsCache();
}
