// lib/hoa-hong/nguoi-huong.ts — RESOLVER NGƯỜI HƯỞNG (thuần).
//
// Nguồn: docs/source-commission/04 §7 (người hưởng), D13 (RESIGNED), 05 AC-TRX-06. THUẦN — dữ liệu đã nạp.
//
//   TRANSACTION_ROLE  Sale/Sale Admin = `Lead.convertedById/adminId` của lead của GIAO DỊCH; GV Trial = GV của buổi trial bé đã học.
//   ORG_UNIT_ROLE     QLCS/Marketing = `CenterCommissionAssignee` của cơ sở của GIAO DỊCH tại `assigneeDate`, biên MỞ.
//   DIRECT_PERSON     người giới thiệu trên attribution (PH · nhân sự · affiliate) + `REFERRER_PARENT_SALE` = ẢNH CHỤP Sale phụ trách PH
//                     lúc ghi nhận (`referrerSaleUserId`) — KHÁC người chốt đơn.
//   SOURCE_OWNER      nhân sự phụ trách NGUỒN (`LeadSourceGroup.ownerEmployeeId` → User) — nguồn động 09/10/2026.
//   SOURCE_MEMBER     chưa có bảng (PR8) ⇒ luôn TREO `RESOLVER_CHUA_HO_TRO`.
//
// "TREO" = rule thắng, có tiền, KHÔNG có người: không sinh dòng, ghi hàng chờ mềm `UNRESOLVED_BENEFICIARY`
// (04 §7.1). Không lùi về `Order.createdById` / `Enrollment.saleId` — chưa có văn bản (04 Q7).
//
// QLCS resolve theo đơn vị của GIAO DỊCH, KHÔNG theo nguồn (chủ dự án): `ctx.centerId` là cơ sở của bút toán.
//
// RESIGNED / TERMINATED không sinh dòng (D13): nguồn VẪN trỏ về họ, chỉ phần tiền của họ không được chi. Khi một
// vai chia cho nhiều người mà một người nghỉ, phần của người đó TREO — KHÔNG chia lại cho người còn lại
// (`chiaTienChoVai` ở tien.ts). `nguoi` là TOÀN BỘ ứng viên (để chia), `biLoai` là người bị loại.
import { nguoiHuongHieuLuc, type PhanCongCoSo } from "@/lib/crm/commission-assignee";

import { KHOA_PHAN_CONG_CO_SO, type KieuResolver } from "./vai-huong";

export type VaiResolver = { code: string; resolverType: KieuResolver; resolverKey: string | null };

export type NguoiHuong = { kind: "USER" | "AFFILIATE"; id: string };

export type LyDoTreo =
  | "KHONG_CO_LEAD"
  | "LEAD_THIEU_NGUOI"
  | "CHUA_KHAI_NGUOI_PHU_TRACH"
  | "KHONG_QUY_VE_CO_SO"
  | "KHONG_CO_GV_TRIAL"
  | "THIEU_NGUOI_GIOI_THIEU"
  /** Giới thiệu bởi PH nhưng không tìm được Sale phụ trách PH lúc ghi nhận — KHÔNG IM LẶNG (hàng chờ nhìn thấy), không gán Sale đang chốt đơn. */
  | "THIEU_SALE_PHU_HUYNH"
  /** Nguồn chưa khai người phụ trách (hoặc người ấy chưa có tài khoản) — KHÔNG IM LẶNG. */
  | "NGUON_CHUA_CO_NGUOI_PHU_TRACH"
  | "NGUOI_HUONG_NGHI"
  | "RESOLVER_CHUA_HO_TRO"
  | "RESOLVER_KHONG_BIET"
  // PR5a — loại TƯ CÁCH sau khi đã có người (tinh-dong-cho-khoan.ts áp, không phải resolver):
  /** Khoản về ngoài cửa sổ ghi công của lead — vai `isAcquisition` không sinh hoa hồng (04 §7.3). */
  | "NGOAI_CUA_SO"
  /** GV Trial đã nhận 1% × finalPrice lúc convert bằng engine cũ — không trả lần hai (04 §3.2). */
  | "LEGACY_DA_TRA";

export type NguCanhNguoiHuong = {
  /** Cơ sở của GIAO DỊCH (cơ sở bút toán), không phải của nguồn / người hưởng. */
  centerId: string | null;
  /** Ngày dùng để tra "ai phụ trách" (`confirmedAt` của GỐC với khoản hoàn). */
  assigneeDate: Date;
  /** Lead của giao dịch (`Order.leadId`); `null` = đơn không có lead. */
  lead: { convertedById: string | null; adminId: string | null } | null;
  phanCongCoSo: readonly PhanCongCoSo[];
  gvTrialUserId: string | null;
  attribution: {
    /** Loại người giới thiệu của attribution — phân biệt "không phải giới thiệu PH" (bình thường) với "giới thiệu PH mà thiếu Sale" (thiếu dữ liệu). */
    referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
    referrerParentUserId: string | null;
    /** ẢNH CHỤP `User.id` Sale phụ trách PH lúc ghi nhận (`LeadAttribution.referrerSaleUserId`). */
    referrerSaleUserId: string | null;
    /** `Employee.id` người phụ trách NGUỒN (master); null = nguồn chưa khai. */
    nguonChuEmployeeId: string | null;
    /** `User.id` của người phụ trách nguồn; null = chưa khai hoặc nhân sự chưa có tài khoản. */
    nguonChuUserId: string | null;
    /** `User.id` của nhân sự giới thiệu (đã đổi từ `Employee.id`). */
    referrerEmployeeUserId: string | null;
    referrerAffiliateId: string | null;
  } | null;
  /** `User.id` → `Employee.status`; vắng / `null` = không phải nhân sự (vd phụ huynh) ⇒ luôn hưởng. */
  trangThaiNhanSu: ReadonlyMap<string, string | null>;
  /** `Affiliate.id` → còn hoạt động không; vắng = coi như còn. */
  affiliateConHoatDong: ReadonlyMap<string, boolean>;
};

export type KetQuaNguoiHuong =
  | {
      loai: "CO_NGUOI";
      /** TOÀN BỘ ứng viên, sắp theo id — dùng để chia đều. */
      nguoi: NguoiHuong[];
      /** Trong `nguoi` nhưng không được chi (nghỉ việc…): phần của họ TREO. */
      biLoai: { nguoi: NguoiHuong; lyDo: "NGUOI_HUONG_NGHI" }[];
      canCu: string;
    }
  | { loai: "TREO"; lyDo: LyDoTreo; canCu: string };

/** Trạng thái nhân sự mà engine coi là ĐÃ NGHỈ (D13). Export để «chụp lại chủ nguồn» dùng CHÍNH tập này — không gõ lại một bản thứ hai. */
export const TRANG_THAI_NGHI: ReadonlySet<string> = new Set(["RESIGNED", "TERMINATED"]);

function loc(ctx: NguCanhNguoiHuong, nguoi: NguoiHuong[], canCu: string): KetQuaNguoiHuong {
  const sorted = [...nguoi].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const biLoai = sorted
    .filter((n) =>
      n.kind === "USER"
        ? TRANG_THAI_NGHI.has(ctx.trangThaiNhanSu.get(n.id) ?? "")
        : ctx.affiliateConHoatDong.get(n.id) === false,
    )
    .map((n) => ({ nguoi: n, lyDo: "NGUOI_HUONG_NGHI" as const }));
  if (biLoai.length === sorted.length) return { loai: "TREO", lyDo: "NGUOI_HUONG_NGHI", canCu };
  return { loai: "CO_NGUOI", nguoi: sorted, biLoai, canCu };
}

const treo = (lyDo: LyDoTreo, canCu: string): KetQuaNguoiHuong => ({ loai: "TREO", lyDo, canCu });

/** Phân giải người hưởng của MỘT vai cho MỘT giao dịch. */
export function phanGiaiNguoiHuong(vai: VaiResolver, ctx: NguCanhNguoiHuong): KetQuaNguoiHuong {
  const khoa = vai.resolverKey ?? "";
  switch (vai.resolverType) {
    case "TRANSACTION_ROLE": {
      if (khoa === "LEAD_CONVERTED_BY" || khoa === "LEAD_ADMIN") {
        if (!ctx.lead) return treo("KHONG_CO_LEAD", `${khoa}: đơn không có lead`);
        const id = khoa === "LEAD_CONVERTED_BY" ? ctx.lead.convertedById : ctx.lead.adminId;
        if (!id) return treo("LEAD_THIEU_NGUOI", `${khoa}: lead chưa có người`);
        return loc(ctx, [{ kind: "USER", id }], khoa);
      }
      if (khoa === "TRIAL_TEACHER") {
        if (!ctx.gvTrialUserId) return treo("KHONG_CO_GV_TRIAL", "TRIAL_TEACHER: chưa có buổi trial PRESENT");
        return loc(ctx, [{ kind: "USER", id: ctx.gvTrialUserId }], khoa);
      }
      return treo("RESOLVER_KHONG_BIET", `TRANSACTION_ROLE/${khoa}`);
    }
    case "ORG_UNIT_ROLE": {
      const role = (KHOA_PHAN_CONG_CO_SO as Record<string, "QC" | "QL_TT" | undefined>)[khoa];
      if (!role) return treo("RESOLVER_KHONG_BIET", `ORG_UNIT_ROLE/${khoa}`);
      if (!ctx.centerId) return treo("KHONG_QUY_VE_CO_SO", `${khoa}: giao dịch không quy được cơ sở`);
      const ids = nguoiHuongHieuLuc(ctx.phanCongCoSo, ctx.centerId, role, ctx.assigneeDate);
      if (ids.length === 0) return treo("CHUA_KHAI_NGUOI_PHU_TRACH", `${khoa}: cơ sở ${ctx.centerId} chưa khai người phụ trách`);
      return loc(ctx, ids.map((id) => ({ kind: "USER" as const, id })), `${khoa}@${ctx.centerId}`);
    }
    case "DIRECT_PERSON": {
      const a = ctx.attribution;
      if (khoa === "REFERRER_PARENT_SALE") {
        if (a?.referrerKind !== "PARENT") return treo("THIEU_NGUOI_GIOI_THIEU", `${khoa}: attribution không phải giới thiệu của phụ huynh`);
        if (!a.referrerSaleUserId) return treo("THIEU_SALE_PHU_HUYNH", `${khoa}: phụ huynh giới thiệu nhưng chưa xác định Sale phụ trách lúc ghi nhận nguồn`);
        return loc(ctx, [{ kind: "USER", id: a.referrerSaleUserId }], khoa);
      }
      const id =
        khoa === "REFERRER_PARENT"
          ? a?.referrerParentUserId
          : khoa === "REFERRER_EMPLOYEE"
            ? a?.referrerEmployeeUserId
            : khoa === "AFFILIATE"
              ? a?.referrerAffiliateId
              : undefined;
      if (khoa !== "REFERRER_PARENT" && khoa !== "REFERRER_EMPLOYEE" && khoa !== "AFFILIATE") {
        return treo("RESOLVER_KHONG_BIET", `DIRECT_PERSON/${khoa}`);
      }
      if (!id) return treo("THIEU_NGUOI_GIOI_THIEU", `${khoa}: attribution không có người`);
      return loc(ctx, [{ kind: khoa === "AFFILIATE" ? "AFFILIATE" : "USER", id }], khoa);
    }
    case "SOURCE_OWNER": {
      if (khoa !== "SOURCE_OWNER") return treo("RESOLVER_KHONG_BIET", `SOURCE_OWNER/${khoa}`);
      const a = ctx.attribution;
      if (!a) return treo("NGUON_CHUA_CO_NGUOI_PHU_TRACH", `${khoa}: đơn chưa có nguồn`);
      if (!a.nguonChuEmployeeId) return treo("NGUON_CHUA_CO_NGUOI_PHU_TRACH", `${khoa}: nguồn chưa khai người phụ trách`);
      if (!a.nguonChuUserId) return treo("NGUON_CHUA_CO_NGUOI_PHU_TRACH", `${khoa}: người phụ trách nguồn chưa có tài khoản`);
      return loc(ctx, [{ kind: "USER", id: a.nguonChuUserId }], khoa);
    }
    case "SOURCE_MEMBER":
      return treo("RESOLVER_CHUA_HO_TRO", `${vai.resolverType} chưa có bảng (PR8)`);
  }
}
