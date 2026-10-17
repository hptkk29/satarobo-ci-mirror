/**
 * lib/nguon/ghi-nguon-affiliate-duyet.ts — DUYỆT TAY MỘT REFERRAL AFFILIATE ⇒ GHI NGUỒN CỦA LEAD (AFF-L3b).
 *
 * Hoa hồng KHÔNG đọc `AffiliateReferral`; nó đọc `LeadAttribution` (`referrerKind = AFFILIATE` ∧ `referrerAffiliateId` ∧ `signals.affiliate`). Duyệt một referral mà không ghi attribution
 * là một cái nút không làm gì (luật 12); ghi attribution bằng đường tắt là cướp công của người đã ghi nhận trước. Tệp này là cổng DUY NHẤT giữa hai điều đó, và nằm trong `lib/nguon/**`
 * vì `LeadAttribution` chỉ được đọc/ghi thẳng ở đây (lưới `[QN-W11]`); phép GHI vẫn đi qua `ghi-nguon.ts` (`taoNguonBanDau` · `doiNguon`).
 *
 * ── Quyết định theo hiện trạng nguồn của lead (hàm thuần `quyetDinhGhiNguonAffiliate`) ───────────────────────────────────────────────
 *  | hiện trạng                                                                 | kết quả
 *  | lead CHƯA có dòng quy nguồn                                                | TAO_MOI — first-claim, `taoNguonBanDau`
 *  | đang ở nhóm CHỜ («Không xác định») · không người giới thiệu · không khoá  | DE_NHOM_CHO — `doiNguon` (khoá lạc quan theo `updatedAt`); nếu lead ĐÃ CÓ KHOẢN THU ⇒ TỪ CHỐI
 *  | đã là CHÍNH đối tác này, CÙNG campaign                                      | DA_DUNG_NGUOI — không ghi lại (idempotent), referral thành VALID
 *  | đã là đối tác này nhưng campaign KHÁC                                       | TỪ CHỐI — engine sẽ đọc campaign cũ; đổi campaign là đổi tiền ⇒ qua Đổi nguồn
 *  | mọi nguồn thật khác (kể cả đối tác khác, kế thừa SĐT, nhân sự, phụ huynh)    | TỪ CHỐI «đã có người ghi nhận trước» — KHÔNG ghi đè
 *
 * «Từ chối» ở đây là trả `{ ok: false }` TRƯỚC phép ghi đầu tiên của hàm này (luật rollback); nơi gọi không được ghi gì trước khi gọi hàm này.
 * Muốn chuyển công thật sự: dùng «Đổi nguồn» trên phiếu khách — quy trình có quyền riêng, lý do bắt buộc, và đề xuất điều chỉnh có duyệt khi đã thu tiền. Tệp này KHÔNG dựng quy trình thứ hai.
 */
import type { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/audit-log";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { layCuaSoGhiCongNgay } from "./feature";
import { doiNguon, taoNguonBanDau, type DuLieuDoiNguon, type DuLieuNguon } from "./ghi-nguon";
import { trongKhoangHieuLuc } from "./hieu-luc-nguon";
import { chupNguon } from "./nguon-chup";

type Tx = Prisma.TransactionClient;

/** Mã nhóm «chờ» — ngoại lệ DUY NHẤT được so theo mã (`[DYN-NOHARD]`). */
const MA_NHOM_CHO = "UNKNOWN";

export type HienTrangNguonCuaLead = {
  groupCode: string;
  referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
  referrerAffiliateId: string | null;
  khoaNguon: boolean;
  /** `signals.affiliate.campaignCode` của dòng hiện có (null nếu vắng). */
  campaignCodeChup: string | null;
};

export type MaTuChoiGhiNguon =
  | "DA_CO_NGUOI_KHAC"
  | "CUNG_DOI_TAC_KHAC_CAMPAIGN"
  | "NHOM_CHO_DA_CO_THU"
  | "NGUON_BI_KHOA"
  | "NGUON_KHONG_DUNG_DUOC"
  | "PHIEU_KHONG_CON";

export const NHAN_TU_CHOI_GHI_NGUON: Readonly<Record<MaTuChoiGhiNguon, string>> = {
  DA_CO_NGUOI_KHAC:
    "Khách này đã có người ghi nhận trước — không ghi đè. Cần chuyển công thì dùng «Đổi nguồn» trên phiếu khách (có quyền riêng và lý do bắt buộc), hoặc từ chối lượt này với lý do «đã có người ghi nhận trước».",
  CUNG_DOI_TAC_KHAC_CAMPAIGN:
    "Khách này đã được ghi cho CHÍNH đối tác này nhưng ở campaign khác. Đổi campaign là đổi cách tính tiền — dùng «Đổi nguồn» trên phiếu khách, không duyệt tại đây.",
  NHOM_CHO_DA_CO_THU:
    "Khách này đã có khoản thu trong khi nguồn còn ở nhóm «chờ». Ghi người giới thiệu lúc này làm đổi người được hưởng hoa hồng đã tính — dùng «Đổi nguồn» trên phiếu khách (có đề xuất điều chỉnh, có duyệt).",
  NGUON_BI_KHOA: "Nguồn của khách này đang bị khoá (hệ thống tự xác định). Cần quyền quản lý nguồn để mở khoá trước.",
  NGUON_KHONG_DUNG_DUOC: "Nguồn mà cấu hình campaign giải ra cho đối tác này không còn dùng được (đã ngừng hoặc hết hiệu lực) — sửa cấu hình campaign trước.",
  PHIEU_KHONG_CON: "Phiếu khách đã bị xoá hoặc không còn — không có gì để ghi nguồn.",
};

export type QuyetDinhGhiNguonAffiliate =
  | { loai: "TAO_MOI" }
  | { loai: "DE_NHOM_CHO" }
  | { loai: "DA_DUNG_NGUOI" }
  | { loai: "TU_CHOI"; ma: MaTuChoiGhiNguon; loi: string };

/** THUẦN: có ghi nguồn được không, và bằng đường nào. Xem bảng ở đầu tệp. */
export function quyetDinhGhiNguonAffiliate(p: {
  hienCo: HienTrangNguonCuaLead | null;
  partyId: string;
  campaignCode: string;
  daCoThucThu: boolean;
}): QuyetDinhGhiNguonAffiliate {
  const tuChoi = (ma: MaTuChoiGhiNguon): QuyetDinhGhiNguonAffiliate => ({ loai: "TU_CHOI", ma, loi: NHAN_TU_CHOI_GHI_NGUON[ma] });
  const h = p.hienCo;
  if (h === null) return { loai: "TAO_MOI" };

  if (h.referrerKind === "AFFILIATE" && h.referrerAffiliateId === p.partyId) {
    return h.campaignCodeChup === p.campaignCode ? { loai: "DA_DUNG_NGUOI" } : tuChoi("CUNG_DOI_TAC_KHAC_CAMPAIGN");
  }
  if (h.groupCode === MA_NHOM_CHO && h.referrerKind === null) {
    if (h.khoaNguon) return tuChoi("NGUON_BI_KHOA");
    if (p.daCoThucThu) return tuChoi("NHOM_CHO_DA_CO_THU");
    return { loai: "DE_NHOM_CHO" };
  }
  return tuChoi("DA_CO_NGUOI_KHAC");
}

/** Lượt ghi đua thua (có người ghi nguồn xen giữa) — ném để cả giao dịch lùi lại; nơi gọi dịch ra câu «tải lại rồi thử lại». */
export class NguonDuaGhiError extends Error {
  constructor() {
    super("Nguồn của khách vừa được người khác ghi — hãy tải lại rồi thử lại.");
    this.name = "NguonDuaGhiError";
  }
}

const laDoiTuong = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type KetQuaGhiNguonAffiliate =
  | { ok: true; nhanh: "TAO_MOI" | "DE_NHOM_CHO" | "DA_DUNG_NGUOI" }
  | { ok: false; ma: MaTuChoiGhiNguon; loi: string };

/**
 * Ghi (hoặc xác nhận đã có) nguồn Affiliate của lead khi một referral được DUYỆT. Chạy TRONG transaction của nơi gọi (`tx` bắt buộc).
 * Mọi cổng đứng TRƯỚC phép ghi đầu tiên: trả `{ ok: false }` khi chưa ghi gì; ném khi đã ghi mà bất biến vỡ (đua).
 *
 * @param snapshot  bản chụp `signals.affiliate` — dựng bằng `dungSnapshotReferral` (cùng hàm với đường tự động); `affiliateCode` phải là mã của đối tác đang giữ công.
 */
export async function ghiNguonKhiDuyetReferral(
  tx: Tx,
  p: {
    leadId: string;
    partyId: string;
    campaignCode: string;
    /** Nhóm nguồn ĐÃ GIẢI từ cấu hình campaign lúc duyệt. */
    groupId: string;
    snapshot: Record<string, unknown>;
    referralId: string;
    lyDo: string;
    actor: AuditActor;
    bayGio: Date;
  },
): Promise<KetQuaGhiNguonAffiliate> {
  const lead = await tx.lead.findUnique({ where: { id: p.leadId }, select: { source: true, deletedAt: true } });
  if (!lead || lead.deletedAt !== null) return { ok: false, ma: "PHIEU_KHONG_CON", loi: NHAN_TU_CHOI_GHI_NGUON.PHIEU_KHONG_CON };

  // Khoá dòng quy nguồn (nếu có) cho tới hết giao dịch: hai lượt duyệt đồng thời cho hai đối tác khác nhau xếp hàng, người sau thấy người trước.
  await tx.$queryRaw`SELECT "id" FROM "LeadAttribution" WHERE "leadId" = ${p.leadId} FOR UPDATE`;
  const cu = await tx.leadAttribution.findUnique({ where: { leadId: p.leadId }, include: { group: { select: { code: true } } } });
  const daCoThucThu = (await tx.payment.count({ where: { ...WHERE_THUC_THU, order: { leadId: p.leadId, deletedAt: null } } })) > 0;

  const sigCu = cu && laDoiTuong(cu.signals) ? cu.signals : {};
  const affCu = laDoiTuong(sigCu.affiliate) ? sigCu.affiliate : null;
  const qd = quyetDinhGhiNguonAffiliate({
    hienCo: cu
      ? {
          groupCode: cu.group.code,
          referrerKind: cu.referrerKind,
          referrerAffiliateId: cu.referrerAffiliateId,
          khoaNguon: sigCu.khoaNguon === true,
          campaignCodeChup: typeof affCu?.campaignCode === "string" ? affCu.campaignCode : null,
        }
      : null,
    partyId: p.partyId,
    campaignCode: p.campaignCode,
    daCoThucThu,
  });
  if (qd.loai === "TU_CHOI") return { ok: false, ma: qd.ma, loi: qd.loi };
  if (qd.loai === "DA_DUNG_NGUOI") return { ok: true, nhanh: "DA_DUNG_NGUOI" };

  // Nhóm đích: khoá hàng (FOR SHARE) rồi đọc lại — một lệnh ngừng nhóm giữa hai bước không lọt được; bản chụp thuộc tính nguồn chụp đúng lúc này.
  await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "id" = ${p.groupId} FOR SHARE`;
  const nhom = await tx.leadSourceGroup.findUnique({
    where: { id: p.groupId },
    select: { status: true, selectable: true, effectiveFrom: true, effectiveTo: true, attributionWindowDays: true, ownerEmployeeId: true },
  });
  // «chọn được» (selectable) là cờ của ô CHỌN NGUỒN TAY; nguồn của đối tác có thể là nhóm không cho chọn tay — điều kiện ở đây là nhóm còn ACTIVE và trong hiệu lực.
  if (!nhom || nhom.status !== "ACTIVE" || !trongKhoangHieuLuc(nhom, p.bayGio)) {
    return { ok: false, ma: "NGUON_KHONG_DUNG_DUOC", loi: NHAN_TU_CHOI_GHI_NGUON.NGUON_KHONG_DUNG_DUOC };
  }
  const cuaSoMacDinhNgay = await layCuaSoGhiCongNgay();
  const chup = chupNguon({ cuaSoRiengNgay: nhom.attributionWindowDays, cuaSoMacDinhNgay, chuNhanVienId: nhom.ownerEmployeeId });

  const reasonText = "Referral Affiliate được người có quyền DUYỆT TAY — người giới thiệu là đối tác ghi trên referral, nguồn do cấu hình campaign quyết (lý do ở nhật ký xử lý referral)";
  const nguoi = {
    referrerKind: "AFFILIATE" as const,
    referrerEmployeeId: null,
    referrerParentUserId: null,
    referrerStudentId: null,
    referrerAffiliateId: p.partyId,
    referrerMissing: false,
    referrerRoleCode: null,
    referrerSaleUserId: null,
  };
  const dauVet = { affiliate: { ...p.snapshot }, nguon: { ...chup }, daXemTay: true, duyetReferral: { referralId: p.referralId } };

  if (qd.loai === "TAO_MOI") {
    const d: DuLieuNguon = {
      groupId: p.groupId,
      otherSourceNote: null,
      ...nguoi,
      identificationMethod: "AFFILIATE",
      matchedRule: "AFFILIATE_REFERRAL",
      reasonText,
      canhBao: [],
      originalGroupId: p.groupId,
      inheritedFromLeadId: null,
      conversionEntry: lead.source,
      signals: { ...(lead.source ? { duongVao: lead.source } : {}), ...dauVet } as Prisma.InputJsonValue,
      attributedAt: null,
    };
    const r = await taoNguonBanDau(tx, p.leadId, d, p.actor.id);
    // `taoMoi: false` = có người ghi nguồn xen giữa (hàm đã ghi một touchpoint «thua»). KHÔNG nuốt: ném để cả giao dịch lùi lại.
    if (!r.taoMoi) throw new NguonDuaGhiError();
    return { ok: true, nhanh: "TAO_MOI" };
  }

  // DE_NHOM_CHO — cu chắc chắn có (nhánh TAO_MOI đã trả ở trên).
  if (!cu) throw new NguonDuaGhiError();
  // Người ĐÃ QUYẾT ⇒ gỡ cờ xem tay và dấu vết người giới thiệu cũ; vết gốc (nhanGoc, pageId, quangCao…) GIỮ NGUYÊN.
  const { coXemTay: _a, xemTay: _b, nguoiGioiThieu: _c, ...conLai } = sigCu;
  void _a;
  void _b;
  void _c;
  const moi: DuLieuDoiNguon = {
    groupId: p.groupId,
    otherSourceNote: null,
    ...nguoi,
    identificationMethod: "AFFILIATE",
    matchedRule: "AFFILIATE_REFERRAL",
    reasonText,
    canhBao: cu.canhBao.filter((c) => c === "SDT_NHAN_VIEN"),
    conversionEntry: cu.conversionEntry,
    signals: { ...conLai, ...dauVet } as Prisma.InputJsonValue,
  };
  const r = await doiNguon(tx, { leadId: p.leadId, daDocUpdatedAt: cu.updatedAt, moi, action: "DOI_NGUON", lyDo: p.lyDo, actor: p.actor });
  if (!r.ok) throw new NguonDuaGhiError();
  return { ok: true, nhanh: "DE_NHOM_CHO" };
}
