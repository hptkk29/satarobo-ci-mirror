// lib/hoa-hong/chon-quy-tac.ts — CHỌN QUY TẮC hoa hồng: "cụ thể thắng chung", đa đơn vị, UNKNOWN = mức thấp nhất.
//
// Nguồn: docs/source-commission/04 §6 (policy engine), 05 AC-POL (POL-01 · 01b · 02 · 03). THUẦN — không DB,
// không đọc đồng hồ (`rateDate` là tham số bắt buộc, luật 7 + 19).
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT (chủ dự án + PRD)
//
//   1. Mỗi (vai hưởng × loại giao dịch × thành phần) có ĐÚNG MỘT rule thắng. Không cộng dồn, không lấy cao nhất.
//   2. "Cụ thể thắng chung" theo thứ tự phạm vi ĐỌC TỪ CẤU HÌNH — hàm này KHÔNG chép cứng thứ tự: nhận
//      `thuTuPhamVi` (hoán vị đủ 9 mã) làm tham số bắt buộc. `THU_TU_PHAM_VI_MAC_DINH` chỉ là giá trị khởi đầu
//      của cấu hình (04 §6.2), không phải mặc định của hàm.
//   3. Đa đơn vị: rule chỉ ÁP khi `orgUnitPath` của rule là TIỀN TỐ của `orgUnitPath` giao dịch (rule của HO
//      áp mọi nơi; rule của CS2 chỉ áp giao dịch CS2). Hạng = (rank(scopeType), độ sâu đơn vị sở hữu) so TỪ ĐIỂN.
//   4. Hoà hạng ⇒ `CHONG_LAN` (hàng chờ `POLICY_OVERLAP`) — KHÔNG đoán, KHÔNG dùng `priority` làm tie-break
//      (PRD cấm "highest/lowest").
//   5. Không có rule ⇒ `KHONG_CO` (KHÔNG sinh dòng; không dùng 0%). Muốn chặn kế thừa từ rule chung thì khai
//      rule `EXCLUDE` ở phạm vi cụ thể hơn: nó thắng như mọi rule và ra 0 đ.
//   6. Nguồn KHÔNG RÕ (UNKNOWN) ⇒ mức THẤP NHẤT (theo SỐ TIỀN trên chính khoản đó) trong các nhóm nguồn đang
//      hoạt động, TÍNH ĐỘNG mỗi lần (D7). Một hàm duy nhất — `quyTacChoNguonKhongRo`.
//
// ⚠️ Hiệu lực biên MỞ: `effectiveFrom ≤ rateDate < effectiveTo` (khuôn `CommissionRateConfig`, D2). Version
// `DRAFT`/`CANCELLED` không tham gia; `ACTIVE`/`SUPERSEDED`/`EXPIRED` tham gia theo NGÀY HIỆU LỰC — khoản
// thu ngày 15/10 vẫn dùng version đã bị thay từ 01/11.
import { tienPhanTram } from "./tien";
import { dinhDangSo } from "./vi-sao";

export const PHAM_VI = [
  "PERSON",
  "AFFILIATE",
  "SOURCE",
  "CAMPAIGN",
  "EVENT",
  "SOURCE_GROUP",
  "ORG_UNIT",
  "ROLE",
  "GLOBAL",
] as const;
export type PhamVi = (typeof PHAM_VI)[number];

/** Giá trị KHỞI ĐẦU của cấu hình `hoaHong.thuTuPhamVi` (04 §6.2): cụ thể → chung. */
export const THU_TU_PHAM_VI_MAC_DINH: readonly PhamVi[] = [
  "PERSON",
  "AFFILIATE",
  "SOURCE",
  "CAMPAIGN",
  "EVENT",
  "SOURCE_GROUP",
  "ORG_UNIT",
  "ROLE",
  "GLOBAL",
];

/** Thứ tự phải là hoán vị ĐỦ 9 mã: thiếu / lặp / mã lạ ⇒ ném (thứ tự sai đổi người nhận tiền). */
export function kiemThuTuPhamVi(x: unknown): PhamVi[] {
  if (!Array.isArray(x) || x.length !== PHAM_VI.length) throw new Error("Thứ tự phạm vi phải liệt kê đủ 9 mã");
  const co = new Set<string>(x as string[]);
  if (co.size !== PHAM_VI.length || !PHAM_VI.every((p) => co.has(p))) {
    throw new Error("Thứ tự phạm vi phải là hoán vị của 9 mã phạm vi, không lặp, không mã lạ");
  }
  return [...(x as PhamVi[])];
}

export type KieuTinh = "PERCENT" | "FIXED_PER_PURCHASE" | "TIER_PERIOD_BONUS" | "EXCLUDE";

/**
 * Dòng này có THU HÚT (trả tiền cho ai đó) không — mọi kiểu tính trừ `EXCLUDE`. MỘT vị từ cho engine (`khopPhamVi`: cờ nguồn chỉ tắt dòng thu hút), guardrail kích hoạt (nguồn tắt cờ không nhận dòng thu hút)
 * và cổng ghi nguồn (`chanTatHoaHongNguon`: tắt cờ khi có dòng thu hút là làm tiền biến mất) — tách ra để ba nơi không thể lệch nhau về «cờ tắt thì cái gì ngừng chạy».
 */
export function laDongThuHut(kieuTinh: KieuTinh): boolean {
  return kieuTinh !== "EXCLUDE";
}
export type LoaiGiaoDichQuyTac = "NEW" | "RENEWAL";
export type ThanhPhanQuyTac = "TUITION" | "MATERIAL" | "EQUIPMENT" | "OTHER";
export type TrangThaiPhienBan = "DRAFT" | "ACTIVE" | "EXPIRED" | "SUPERSEDED" | "CANCELLED";

/** Một rule đã nạp kèm ngữ cảnh version/policy của nó. */
export type QuyTac = {
  ruleId: string;
  policyId: string;
  policyCode: string;
  versionId: string;
  version: number;
  documentNumber: string;
  scopeType: PhamVi;
  /** Khoá phạm vi chuẩn hoá: "GLOBAL" | "PERSON:<userId>" | "SOURCE_GROUP:<id>" … */
  scopeKey: string;
  /** Đúng MỘT trường theo `scopeType` (CHECK `pham_vi`). `orgUnitPath` đi kèm `orgUnitId` của phạm vi ORG_UNIT. */
  scope: {
    userId?: string;
    affiliateId?: string;
    sourceId?: string;
    sourceGroupId?: string;
    orgUnitId?: string;
    orgUnitPath?: string;
    roleDefId?: string;
  };
  /** Đơn vị SỞ HỮU policy. `null` + path "/" = Hội sở / toàn hệ. */
  orgUnitId: string | null;
  orgUnitPath: string;
  orgUnitDepth: number;
  transactionType: LoaiGiaoDichQuyTac;
  roleCode: string;
  revenueComponent: ThanhPhanQuyTac;
  kieuTinh: KieuTinh;
  /** PERCENT: tỉ lệ (0.04); FIXED: VND; EXCLUDE/TIER: 0. */
  giaTri: number | string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  trangThai: TrangThaiPhienBan;
};

export type NguCanhChonQuyTac = {
  roleCode: string;
  transactionType: LoaiGiaoDichQuyTac;
  revenueComponent: ThanhPhanQuyTac;
  /** Ngày GỐC của tiền (không phải ngày tính). */
  rateDate: Date;
  /** Đơn vị của GIAO DỊCH (không phải của nguồn, không phải của người hưởng). */
  orgUnitPath: string;
  /** PERSON là chiều của NGƯỜI HƯỞNG; `null` khi vai nhiều người / chưa có người. */
  nguoiHuongUserId: string | null;
  affiliateId: string | null;
  sourceId: string | null;
  campaignId: string | null;
  eventId: string | null;
  sourceGroupId: string | null;
  /**
   * THUỘC TÍNH `commissionEnabled` của nguồn đang xét: `false` ⇒ rule phạm vi SOURCE_GROUP của nguồn này BẤT HOẠT (engine bỏ qua) — TRỪ dòng `EXCLUDE`
   * (miễn theo KIỂU TÍNH của dòng, không theo mã nguồn: «nguồn này không trả vai X» không thu hút ai nên không cần nguồn «tham gia hoa hồng»);
   * chính sách chung (GLOBAL/ORG_UNIT/ROLE/PERSON…) vẫn chạy. BẮT BUỘC khai (luật 7) — quên là nguồn bị đọc nhầm là "có hoa hồng riêng".
   */
  nguonCoHoaHong: boolean;
  /** Vai RBAC (`RoleDef.id`) của người hưởng — cho phạm vi ROLE. */
  roleDefIds: readonly string[];
};

export type UngVienXepHang = {
  ruleId: string;
  policyCode: string;
  version: number;
  scopeType: PhamVi;
  orgUnitDepth: number;
  /** [rank phạm vi, độ sâu đơn vị] — lớn hơn thắng. */
  hang: [number, number];
};

export type KetQuaChonQuyTac =
  | { loai: "THANG"; quyTac: QuyTac; lyDo: string; ungVien: UngVienXepHang[] }
  | { loai: "KHONG_CO"; lyDo: string }
  | { loai: "CHONG_LAN"; lyDo: string; ungVien: UngVienXepHang[] };

function khopPhamVi(q: QuyTac, c: NguCanhChonQuyTac): boolean {
  switch (q.scopeType) {
    case "GLOBAL":
      return true;
    case "PERSON":
      return q.scope.userId !== undefined && q.scope.userId === c.nguoiHuongUserId;
    case "AFFILIATE":
      return q.scope.affiliateId !== undefined && q.scope.affiliateId === c.affiliateId;
    case "SOURCE":
      return q.scope.sourceId !== undefined && q.scope.sourceId === c.sourceId;
    case "CAMPAIGN":
      return q.scope.sourceId !== undefined && q.scope.sourceId === c.campaignId;
    case "EVENT":
      return q.scope.sourceId !== undefined && q.scope.sourceId === c.eventId;
    case "SOURCE_GROUP":
      // Cờ nguồn chỉ tắt các dòng THU HÚT (PERCENT/tiền cố định/thưởng bậc). Dòng EXCLUDE luôn khớp nguồn của nó: chủ dự án chốt 09/10/2026 «Marketing 1% chỉ cho nguồn quảng cáo»
      // — nguồn không phải quảng cáo (cờ tắt) mang một dòng EXCLUDE vai Marketing để chặn mức chung, và dòng ấy phải CHẠY.
      return (c.nguonCoHoaHong || !laDongThuHut(q.kieuTinh)) && q.scope.sourceGroupId !== undefined && q.scope.sourceGroupId === c.sourceGroupId;
    case "ORG_UNIT":
      return q.scope.orgUnitPath !== undefined && c.orgUnitPath.startsWith(q.scope.orgUnitPath);
    case "ROLE":
      return q.scope.roleDefId !== undefined && c.roleDefIds.includes(q.scope.roleDefId);
    default:
      return false;
  }
}

function ungVienCua(q: QuyTac, c: NguCanhChonQuyTac): boolean {
  if (q.trangThai === "DRAFT" || q.trangThai === "CANCELLED") return false;
  if (q.roleCode !== c.roleCode || q.transactionType !== c.transactionType) return false;
  if (q.revenueComponent !== c.revenueComponent) return false;
  const t = c.rateDate.getTime();
  if (q.effectiveFrom.getTime() > t) return false;
  if (q.effectiveTo !== null && t >= q.effectiveTo.getTime()) return false; // biên PHẢI MỞ
  // Đa đơn vị: đơn vị sở hữu rule phải là tổ tiên-hoặc-chính-nó của đơn vị giao dịch. Path có "/" cuối nên
  // so tiền tố khớp theo ĐOẠN ("/ho/danang/cs1/" không là tiền tố của "/ho/danang/cs10/").
  if (!c.orgUnitPath.startsWith(q.orgUnitPath)) return false;
  return khopPhamVi(q, c);
}

/**
 * Chọn rule thắng cho MỘT (vai × loại × thành phần) trong ngữ cảnh `ctx`. `quyTac` là mọi rule đã nạp
 * (hàm tự lọc ứng viên). `thuTuPhamVi` BẮT BUỘC.
 */
export function chonQuyTac(input: {
  ctx: NguCanhChonQuyTac;
  quyTac: readonly QuyTac[];
  thuTuPhamVi: readonly PhamVi[];
}): KetQuaChonQuyTac {
  const thuTu = kiemThuTuPhamVi(input.thuTuPhamVi);
  const rank = (p: PhamVi): number => thuTu.length - thuTu.indexOf(p);

  const ungVien = input.quyTac
    .filter((q) => ungVienCua(q, input.ctx))
    .map((q): { q: QuyTac; hang: [number, number] } => ({ q, hang: [rank(q.scopeType), q.orgUnitDepth] }))
    .sort((a, b) => b.hang[0] - a.hang[0] || b.hang[1] - a.hang[1] || (a.q.ruleId < b.q.ruleId ? -1 : 1));

  if (ungVien.length === 0) {
    return { loai: "KHONG_CO", lyDo: `Không có rule nào cho vai ${input.ctx.roleCode} · ${input.ctx.transactionType} — không sinh hoa hồng.` };
  }

  const ds: UngVienXepHang[] = ungVien.map(({ q, hang }) => ({
    ruleId: q.ruleId,
    policyCode: q.policyCode,
    version: q.version,
    scopeType: q.scopeType,
    orgUnitDepth: q.orgUnitDepth,
    hang,
  }));

  const dau = ungVien[0]!;
  const dongHang = ungVien.filter((u) => u.hang[0] === dau.hang[0] && u.hang[1] === dau.hang[1]);
  if (dongHang.length > 1) {
    return {
      loai: "CHONG_LAN",
      lyDo: `${dongHang.length} rule cùng hạng (${dau.q.scopeType}, độ sâu ${dau.q.orgUnitDepth}) cho vai ${input.ctx.roleCode} · ${input.ctx.transactionType}: ${dongHang
        .map((u) => `${u.q.policyCode} v${u.q.version}`)
        .join(", ")} — chồng lấn chính sách, không đoán.`,
      ungVien: ds,
    };
  }

  const q = dau.q;
  const thua = ungVien.slice(1);
  return {
    loai: "THANG",
    quyTac: q,
    ungVien: ds,
    lyDo:
      `${q.scopeType} · ${q.documentNumber} · ${q.policyCode} v${q.version}` +
      (thua.length > 0
        ? ` thắng ${thua.map((u) => `${u.q.scopeType} ${u.q.policyCode} v${u.q.version}`).join(", ")} vì phạm vi cụ thể hơn`
        : ` (rule duy nhất khớp)`),
  };
}

/** Số tiền của một rule trên `coSo` (VND, làm tròn MỘT lần). `EXCLUDE` và `TIER_PERIOD_BONUS` không theo khoản ⇒ 0. */
export function tienTheoQuyTac(coSo: number, q: Pick<QuyTac, "kieuTinh" | "giaTri">): number {
  switch (q.kieuTinh) {
    case "PERCENT":
      return tienPhanTram(coSo, q.giaTri);
    case "FIXED_PER_PURCHASE": {
      const v = Number(q.giaTri);
      if (!Number.isInteger(v) || v < 0) throw new Error(`Số tiền cố định không hợp lệ: ${q.giaTri}`);
      return v;
    }
    case "EXCLUDE":
    case "TIER_PERIOD_BONUS":
      return 0;
  }
}

// ── UNKNOWN = mức thấp nhất, tính động (D7, 04 §6.5) ────────────────────────

/** `coHoaHong` = `LeadSourceGroup.commissionEnabled` (thuộc tính master, không phải mã). */
export type NhomNguon = { id: string; code: string; coHoaHong: boolean };

export type NguCanhNguonKhongRo = Omit<
  NguCanhChonQuyTac,
  "sourceGroupId" | "nguonCoHoaHong" | "affiliateId" | "sourceId" | "campaignId" | "eventId"
>;

export type KetQuaNguonKhongRo =
  | {
      loai: "THANG";
      nhomMin: NhomNguon;
      quyTac: QuyTac;
      tien: number;
      lyDo: string;
      theoNhom: { nhom: NhomNguon; tien: number }[];
    }
  | { loai: "KHONG_CO"; lyDo: string; theoNhom: { nhom: NhomNguon; tien: number }[] }
  | { loai: "CHONG_LAN"; lyDo: string; nhom: NhomNguon };

/**
 * Quy tắc cho nguồn KHÔNG RÕ: chạy `chonQuyTac` cho TỪNG nhóm nguồn đang hoạt động (KHÔNG gồm UNKNOWN), với
 * mọi chiều con của nguồn bị xoá (SOURCE/CAMPAIGN/EVENT/AFFILIATE = null) và giữ chiều của người hưởng
 * (PERSON, ROLE); lấy nhóm có SỐ TIỀN thấp nhất trên chính `coSo` của khoản. Không rule / EXCLUDE ⇒ 0.
 *
 * Min = 0 ⇒ `KHONG_CO` (khai thiếu nguồn chỉ có thể bị trả THIẾU — chiều an toàn của D7). Hoà tiền ⇒ nhóm đứng
 * TRƯỚC trong `nhomDangHoatDong` (người gọi sắp theo `sortOrder`). Một nhóm CHỒNG LẤN ⇒ cả khoản `CHONG_LAN`.
 *
 * ĐÂY LÀ NƠI DUY NHẤT tính UNKNOWN — engine, ma trận UI, thử tính và "dự kiến" cùng gọi nó. Gõ số tay ở nơi
 * khác là cách đúng để UNKNOWN âm thầm hoá thành mức CAO nhất.
 */
export function quyTacChoNguonKhongRo(input: {
  ctx: NguCanhNguonKhongRo;
  nhomDangHoatDong: readonly NhomNguon[];
  quyTac: readonly QuyTac[];
  thuTuPhamVi: readonly PhamVi[];
  coSo: number;
}): KetQuaNguonKhongRo {
  const theoNhom: { nhom: NhomNguon; tien: number; quyTac: QuyTac | null }[] = [];
  for (const nhom of input.nhomDangHoatDong) {
    const r = chonQuyTac({
      ctx: {
        ...input.ctx,
        sourceGroupId: nhom.id,
        nguonCoHoaHong: nhom.coHoaHong,
        affiliateId: null,
        sourceId: null,
        campaignId: null,
        eventId: null,
      },
      quyTac: input.quyTac,
      thuTuPhamVi: input.thuTuPhamVi,
    });
    if (r.loai === "CHONG_LAN") {
      return { loai: "CHONG_LAN", nhom, lyDo: `Nhóm ${nhom.code}: ${r.lyDo}` };
    }
    theoNhom.push({ nhom, tien: r.loai === "THANG" ? tienTheoQuyTac(input.coSo, r.quyTac) : 0, quyTac: r.loai === "THANG" ? r.quyTac : null });
  }

  const gon = theoNhom.map(({ nhom, tien }) => ({ nhom, tien }));
  if (theoNhom.length === 0) {
    return { loai: "KHONG_CO", lyDo: "Không có nhóm nguồn nào đang hoạt động để tính mức thấp nhất.", theoNhom: gon };
  }
  let min = theoNhom[0]!;
  for (const t of theoNhom) if (t.tien < min.tien) min = t;

  if (min.tien === 0 || min.quyTac === null) {
    return {
      loai: "KHONG_CO",
      lyDo: `Nguồn không rõ ⇒ mức thấp nhất = 0 đ (nhóm ${min.nhom.code} không có rule hoặc bị loại) — không sinh hoa hồng.`,
      theoNhom: gon,
    };
  }
  return {
    loai: "THANG",
    nhomMin: min.nhom,
    quyTac: min.quyTac,
    tien: min.tien,
    lyDo: `UNKNOWN → mức thấp nhất = nhóm ${min.nhom.code} (${dinhDangSo(min.tien)} đ) trong ${theoNhom.length} nhóm`,
    theoNhom: gon,
  };
}
