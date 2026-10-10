// lib/hoa-hong/chinh-sach-dau-vao.ts — KIỂU + KIỂM ĐẦU VÀO khi soạn chính sách (thuần).
//
// Kiểm ở đây là lớp THÂN THIỆN (câu lỗi nói được vì sao) đứng TRƯỚC các CHECK của DB (`CommissionRule_cach_tinh_chk`,
// `CommissionPolicyVersion_pham_vi_chk`): DB chặn được nhưng chỉ nói "violates check constraint". Hai lớp phải
// cùng một luật — ca `[NHH-POL-DB-*]` chạy cả hai và so.
import type { KieuTinh, PhamVi, ThanhPhanQuyTac } from "./chon-quy-tac";
import { tiLeSangMicro } from "./tien";

export type PhamViInput =
  | { loai: "GLOBAL" }
  | { loai: "PERSON"; userId: string }
  | { loai: "AFFILIATE"; affiliateId: string }
  | { loai: "SOURCE_GROUP"; sourceGroupId: string }
  | { loai: "ORG_UNIT"; orgUnitId: string }
  | { loai: "ROLE"; roleDefId: string };

export type RuleInput = {
  transactionTypeCode: string;
  roleCode: string;
  revenueComponent: ThanhPhanQuyTac;
  calcKind: KieuTinh;
  /** PERCENT: 0 < rate ≤ 1. Nhận số hoặc chuỗi Decimal. */
  rate: number | string | null;
  fixedAmount: number | null;
  tierTable: unknown | null;
  note: string | null;
};

/** `scopeKey` chuẩn hoá: "GLOBAL" | "<LOAI>:<id>". Dùng cho chống chồng lấn + chỉ mục. */
export function scopeKeyCua(p: PhamViInput): string {
  switch (p.loai) {
    case "GLOBAL":
      return "GLOBAL";
    case "PERSON":
      return `PERSON:${p.userId}`;
    case "AFFILIATE":
      return `AFFILIATE:${p.affiliateId}`;
    case "SOURCE_GROUP":
      return `SOURCE_GROUP:${p.sourceGroupId}`;
    case "ORG_UNIT":
      return `ORG_UNIT:${p.orgUnitId}`;
    case "ROLE":
      return `ROLE:${p.roleDefId}`;
  }
}

/** Đúng MỘT cột `scope*` theo loại (khớp CHECK `pham_vi`). */
export function cotPhamVi(p: PhamViInput): {
  scopeType: PhamVi;
  scopeKey: string;
  scopeUserId: string | null;
  scopeAffiliateId: string | null;
  scopeSourceGroupId: string | null;
  scopeOrgUnitId: string | null;
  scopeRoleDefId: string | null;
} {
  return {
    scopeType: p.loai,
    scopeKey: scopeKeyCua(p),
    scopeUserId: p.loai === "PERSON" ? p.userId : null,
    scopeAffiliateId: p.loai === "AFFILIATE" ? p.affiliateId : null,
    scopeSourceGroupId: p.loai === "SOURCE_GROUP" ? p.sourceGroupId : null,
    scopeOrgUnitId: p.loai === "ORG_UNIT" ? p.orgUnitId : null,
    scopeRoleDefId: p.loai === "ROLE" ? p.roleDefId : null,
  };
}

/** Lỗi đầu vào của một bộ rule (rỗng = hợp lệ). Một ô (loại × vai × thành phần) chỉ có MỘT rule. */
export function kiemRuleDauVao(rules: readonly RuleInput[]): string[] {
  const loi: string[] = [];
  const thay = new Set<string>();
  for (const [i, r] of rules.entries()) {
    const dong = `Rule #${i + 1} (${r.roleCode} · ${r.transactionTypeCode})`;
    const khoa = `${r.transactionTypeCode}|${r.roleCode}|${r.revenueComponent}`;
    if (thay.has(khoa)) loi.push(`${dong}: trùng ô (loại × vai × thành phần) — mỗi ô chỉ một rule.`);
    thay.add(khoa);

    switch (r.calcKind) {
      case "PERCENT": {
        if (r.rate === null || r.rate === undefined) {
          loi.push(`${dong}: kiểu PERCENT cần tỉ lệ.`);
          break;
        }
        try {
          const m = tiLeSangMicro(r.rate);
          if (m <= BigInt(0) || m > BigInt(1000000)) loi.push(`${dong}: tỉ lệ phải trong (0, 1].`);
        } catch (e) {
          loi.push(`${dong}: ${(e as Error).message}`);
        }
        if (r.fixedAmount !== null || r.tierTable !== null) loi.push(`${dong}: PERCENT không mang số tiền cố định / bảng bậc.`);
        break;
      }
      case "FIXED_PER_PURCHASE":
        if (r.fixedAmount === null || !Number.isInteger(r.fixedAmount) || r.fixedAmount <= 0) loi.push(`${dong}: số tiền cố định phải là số nguyên dương.`);
        if (r.rate !== null || r.tierTable !== null) loi.push(`${dong}: FIXED không mang tỉ lệ / bảng bậc.`);
        break;
      case "TIER_PERIOD_BONUS":
        if (r.tierTable === null || r.tierTable === undefined) loi.push(`${dong}: TIER cần bảng bậc.`);
        if (r.rate !== null || r.fixedAmount !== null) loi.push(`${dong}: TIER không mang tỉ lệ / số tiền cố định.`);
        break;
      case "EXCLUDE":
        if (r.rate !== null || r.fixedAmount !== null || r.tierTable !== null) loi.push(`${dong}: EXCLUDE không mang giá trị nào.`);
        break;
    }
  }
  return loi;
}
