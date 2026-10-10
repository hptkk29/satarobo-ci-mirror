// lib/hoa-hong/khieu-nai-dieu-chinh.ts — DỰNG dòng `DISPUTE_ADJUSTMENT` của khiếu nại được duyệt "điều chỉnh tiền". THUẦN (không DB, không đồng hồ).
//
// Nguồn: docs/source-commission/04 §10.3 (khoá), §15, 02 §9.6 luật 7.
//
// Phép GHI dòng này đi qua `ghiDong` của `ghi-so.ts` (đường ghi sổ DUY NHẤT) — hàm này chỉ quyết dòng trông thế nào.
//
// Hai hình dạng, cùng một khuôn:
//   · đích DÒNG của mình  → người + vai + chính sách CHÉP NGUYÊN từ dòng bị khiếu nại ("cùng người, cùng vai, cùng căn cứ — chỉ thêm/bớt tiền");
//   · đích KHOẢN THU      → người = NGƯỜI KHIẾU NẠI, vai = vai HR chọn; chính sách KHÔNG chép (dòng mẫu thuộc người khác, rule của họ không phải căn
//                           cứ của người này) — dòng mẫu chỉ cho NGỮ CẢNH của khoản thu (đơn · học viên · nguồn · kỳ hiệu lực).
//
// Cả hai: `calcKind/rate/fixedAmount = NULL` và `grossAmount/netBase = 0`. Đây không phải một lần tính theo tỉ lệ — nếu để nguyên tỉ lệ + cơ sở của dòng
// mẫu thì ngăn "Vì sao" in "cơ sở × tỉ lệ = …" ra một con số KHÔNG bằng số tiền của dòng (nói dối), và tổng "cơ sở tính" của kỳ bị cộng đôi.
import type { BeneficiaryResolverType, CommissionTransaction, Prisma } from "@prisma/client";

import { MA_KHIEU_NAI_DIEU_CHINH } from "./khieu-nai-ma";
import { khoaDieuChinh } from "./khoa-so";
import { saoTuDongGoc } from "./quet-khoan";
import type { DongGhi } from "./ghi-so";

export type NguoiNhanDieuChinh = { userId: string; employeeId: string | null; ten: string };
export type VaiDieuChinh = { id: string; code: string; resolverType: BeneficiaryResolverType };

export type NenDieuChinhKhieuNai = {
  /** Id dòng — truyền sẵn để gắn `resolutionEntryId` mà không phải đọc lại (createMany không trả id). */
  id: string;
  disputeId: string;
  /** Dòng mẫu: dòng bị khiếu nại (đích DÒNG) hoặc dòng HR chọn để lấy ngữ cảnh khoản thu (đích KHOẢN THU). */
  mau: CommissionTransaction;
  /** `null` = đích DÒNG (giữ người + vai của dòng mẫu); có giá trị = đích KHOẢN THU. */
  nguoiNhan: { nguoi: NguoiNhanDieuChinh; vai: VaiDieuChinh } | null;
  soTien: number;
  lyDoQuyetDinh: string;
  periodId: string;
  lateArrival: boolean;
};

export function dungDongDieuChinhKhieuNai(n: NenDieuChinhKhieuNai): DongGhi {
  const { mau } = n;
  const khoaNguoiNhan = n.nguoiNhan
    ? { roleCode: n.nguoiNhan.vai.code, kind: "USER" as const, beneficiaryId: n.nguoiNhan.nguoi.userId }
    : {
        roleCode: mau.roleCode,
        kind: mau.beneficiaryKind,
        beneficiaryId: (mau.beneficiaryKind === "USER" ? mau.beneficiaryUserId : mau.beneficiaryAffiliateId) ?? "-",
      };

  const goc = saoTuDongGoc(mau, {
    idempotencyKey: khoaDieuChinh({ loai: "DISPUTE_ADJUSTMENT", refEventId: n.disputeId, calcSlotId: mau.calcSlotId, ...khoaNguoiNhan }),
    entryKind: "DISPUTE_ADJUSTMENT",
    calcSlotId: mau.calcSlotId,
    periodId: n.periodId,
    naturalPeriod: mau.naturalPeriod,
    lateArrival: n.lateArrival,
    paymentId: mau.paymentId,
    amount: n.soTien,
    reason: `Điều chỉnh do khiếu nại ${n.disputeId}: ${n.lyDoQuyetDinh}`,
    reasonCode: MA_KHIEU_NAI_DIEU_CHINH,
    grossAmount: 0,
    netBase: 0,
    inputHash: mau.inputHash,
    refEntryId: mau.id,
    refEventType: "DISPUTE",
    refEventId: n.disputeId,
  });

  const chung: DongGhi = {
    ...goc,
    id: n.id,
    calcKind: null,
    rate: null,
    fixedAmount: null,
    resolverBasis: { canCu: "KHIEU_NAI", disputeId: n.disputeId } as Prisma.InputJsonValue,
  };
  if (!n.nguoiNhan) return chung;

  const { nguoi, vai } = n.nguoiNhan;
  return {
    ...chung,
    beneficiaryRoleId: vai.id,
    roleCode: vai.code,
    beneficiaryKind: "USER",
    beneficiaryUserId: nguoi.userId,
    beneficiaryAffiliateId: null,
    beneficiaryEmployeeId: nguoi.employeeId,
    beneficiaryName: nguoi.ten,
    resolverType: vai.resolverType,
    policyId: null,
    policyVersionId: null,
    versionNo: null,
    ruleId: null,
    documentNumber: null,
    // `refEntryId` trỏ dòng mẫu của NGƯỜI KHÁC chỉ để biết ngữ cảnh khoản thu; không phải "dòng gốc" của người này.
    legacyTier: null,
  };
}
