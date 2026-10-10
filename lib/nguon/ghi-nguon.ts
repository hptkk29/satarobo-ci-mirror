/**
 * lib/nguon/ghi-nguon.ts — TẦNG GHI DUY NHẤT của nguồn lead (`LeadAttribution`, `LeadTouchpoint`).
 *
 * Đặc tả: `docs/source-commission/07 §2.6.5`; mô hình `02 §2.2`, `03 §6`.
 *
 * ⚠️ NƠI DUY NHẤT được `create/update/delete` hai bảng đó. Lưới `[QN-W11]` (`doc-thang-wiring.test.ts`)
 * đỏ nếu chỗ khác gọi `.leadAttribution.*`/`.leadTouchpoint.*` hay chèn `attribution: { create … }`.
 *
 * ── Ba bảng này KHÔNG có `centerId`/`orgUnitId` (ngoại lệ CÓ CHỦ ĐÍCH luật Nền #3 — chủ dự án chấp nhận 07/10/2026) ──
 * Cách ly cơ sở đi qua `Lead` đã scope. Hệ quả cho người VIẾT TIẾP: đừng thêm câu đọc thẳng hai bảng này
 * ngoài `lib/nguon/**`, và đừng ghi mà không có lead tương ứng.
 *
 * ── Quy ước giao dịch ───────────────────────────────────────────────────────────────────────────────────
 * Mọi hàm nhận `tx` BẮT BUỘC (luật 7): nguồn luôn được ghi CÙNG transaction với việc sinh ra nó (tạo lead,
 * đổi nguồn, gộp lead). Từ chối = `throw` (không `return`) khi đã ghi — luật rollback ở CLAUDE.md.
 * Ngoại lệ DUY NHẤT là `ghiDoiNguon` (mà `doiNguon` và gộp lead dùng chung) trả `{ ok: false }` khi `updateMany`
 * có điều kiện đổi 0 dòng (FIX-H9).
 *
 * ── NGUỒN GỐC BẤT BIẾN [chủ dự án chốt 07/10/2026] ──────────────────────────────────────────────────────
 * `originalGroupId` · `inheritedFromLeadId` · `attributedAt` được đặt MỘT LẦN lúc TẠO (`taoNguonBanDau`) và chỉ
 * đổi theo hai đường có chủ đích: GỘP LEAD (`gopQuyNguon` — bản thắng mang cả nguồn gốc của nó) và di trú.
 * `doiNguon` (đổi nguồn HIỆN HÀNH: nhóm + người giới thiệu + dấu vết) KHÔNG nhận ba cột đó: kiểu `DuLieuDoiNguon`
 * không có chúng và `cotDoi` không ghi chúng — truyền thừa vào cũng bị bỏ qua.
 */
import { Prisma } from "@prisma/client";
import type { LeadTouchpointKind, ReferrerKind, SourceIdentificationMethod } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { chonKhiGopLead } from "./quy-nguon";
import { BAN_CHUP_HOP_LE, dieuKienTheoChu } from "./chup-lai-chu-nguon-sql";

type Tx = Prisma.TransactionClient;

/** Mọi trường BẮT BUỘC (luật 7) — thêm cột là tsc liệt kê chỗ gọi. */
export type DuLieuNguon = {
  groupId: string;
  otherSourceNote: string | null;
  referrerKind: ReferrerKind | null;
  referrerEmployeeId: string | null;
  referrerParentUserId: string | null;
  referrerStudentId: string | null;
  referrerAffiliateId: string | null;
  referrerMissing: boolean;
  /** ẢNH CHỤP vai ngữ nghĩa của nhân sự giới thiệu LÚC ghi nhận (`MaVaiNguon`); null khi người giới thiệu không phải nhân sự. */
  referrerRoleCode: string | null;
  /** ẢNH CHỤP Sale phụ trách phụ huynh giới thiệu LÚC ghi nhận (`User.id`); null khi không phải PH giới thiệu hoặc không tìm được. */
  referrerSaleUserId: string | null;
  identificationMethod: SourceIdentificationMethod;
  matchedRule: string;
  reasonText: string;
  canhBao: string[];
  originalGroupId: string;
  inheritedFromLeadId: string | null;
  conversionEntry: string | null;
  signals: Prisma.InputJsonValue | null; // null ⇒ Prisma.DbNull
  attributedAt: Date | null; // null ⇒ giờ DB (default now()) khi tạo; giữ nguyên giá trị cũ khi đổi
};

/** Phần của `DuLieuNguon` mà ĐỔI NGUỒN được phép đổi — KHÔNG có ba cột nguồn gốc (xem đầu tệp). */
export type DuLieuDoiNguon = Omit<DuLieuNguon, "originalGroupId" | "inheritedFromLeadId" | "attributedAt">;

export class NguonError extends Error {
  constructor(
    readonly ma: "NGUOI_GT_SAI" | "GIAI_TRINH_NGAN" | "LY_DO_NGAN",
    msg: string,
  ) {
    super(msg);
    this.name = "NguonError";
  }
}

/**
 * THUẦN, export để test — cùng luật với CHECK `LeadAttribution_nguoi_gioi_thieu_chk`, trả lỗi trên field
 * TRƯỚC khi chạm DB (CHECK chỉ là lưới cuối; Prisma 5 không đọc CHECK).
 */
export function kiemNguoiGioiThieu(
  d: Pick<
    DuLieuNguon,
    "referrerKind" | "referrerEmployeeId" | "referrerParentUserId" | "referrerStudentId" | "referrerAffiliateId"
  >,
): string | null {
  const emp = d.referrerEmployeeId !== null;
  const par = d.referrerParentUserId !== null;
  const stu = d.referrerStudentId !== null;
  const aff = d.referrerAffiliateId !== null;
  switch (d.referrerKind) {
    case null:
      return emp || par || stu || aff ? "Có cột người giới thiệu nhưng chưa khai loại người giới thiệu." : null;
    case "EMPLOYEE":
      return emp && !par && !stu && !aff ? null : "Người giới thiệu là nhân viên: chỉ khai đúng cột nhân viên.";
    case "PARENT":
      return (par || stu) && !emp && !aff
        ? null
        : "Người giới thiệu là phụ huynh: khai tài khoản phụ huynh hoặc học viên, không kèm nhân viên/đối tác.";
    case "AFFILIATE":
      return aff && !emp && !par && !stu ? null : "Người giới thiệu là đối tác: chỉ khai đúng cột đối tác.";
    default:
      return "Loại người giới thiệu không hợp lệ.";
  }
}

/** Cổng TRƯỚC phép ghi đầu tiên (luật rollback): người giới thiệu + giải trình ngắn. */
function kiemDuLieu(d: DuLieuDoiNguon): void {
  const loi = kiemNguoiGioiThieu(d);
  if (loi) throw new NguonError("NGUOI_GT_SAI", loi);
  // Luật "nhóm requiresNote ⇒ bắt giải trình" cần tra nhóm — là `kiemGiaiTrinh` của PR2.
  if (d.otherSourceNote !== null && d.otherSourceNote.trim().length < 10) {
    throw new NguonError("GIAI_TRINH_NGAN", "Giải trình nguồn phải từ 10 ký tự.");
  }
}

/**
 * Cột của ĐỔI NGUỒN — 16 cột HIỆN HÀNH (14 cũ + 2 cột ảnh chụp). Ghi TỪNG CỘT MỘT (không spread `d`) nên cột lạ truyền thừa vào bị bỏ qua;
 * KHÔNG được có `originalGroupId`/`inheritedFromLeadId`/`attributedAt` (lưới `[NHH-SRC-23x]` canh).
 * `signals` null ⇒ SQL NULL.
 */
function cotDoi(d: DuLieuDoiNguon) {
  return {
    groupId: d.groupId,
    otherSourceNote: d.otherSourceNote,
    referrerKind: d.referrerKind,
    referrerEmployeeId: d.referrerEmployeeId,
    referrerParentUserId: d.referrerParentUserId,
    referrerStudentId: d.referrerStudentId,
    referrerAffiliateId: d.referrerAffiliateId,
    referrerMissing: d.referrerMissing,
    // Hai cột ảnh chụp đi CÙNG người giới thiệu: đổi nguồn từ PH sang Ads mà để lại Sale cũ là REFERRER_PARENT_SALE vẫn trả tiền cho nguồn đã bỏ.
    referrerRoleCode: d.referrerRoleCode,
    referrerSaleUserId: d.referrerSaleUserId,
    identificationMethod: d.identificationMethod,
    matchedRule: d.matchedRule,
    reasonText: d.reasonText,
    canhBao: d.canhBao,
    conversionEntry: d.conversionEntry,
    signals: d.signals ?? Prisma.DbNull,
  };
}

/**
 * Cột ghi của `create` (tạo ban đầu) và của GỘP LEAD — đủ 17 cột: 14 cột hiện hành + BA cột nguồn gốc.
 * Bỏ `attributedAt` khi null (⇒ giờ DB). KHÔNG dùng cho `doiNguon`.
 */
function cot(d: DuLieuNguon) {
  return {
    ...cotDoi(d),
    originalGroupId: d.originalGroupId,
    inheritedFromLeadId: d.inheritedFromLeadId,
    ...(d.attributedAt ? { attributedAt: d.attributedAt } : {}),
  };
}

function laDoiTuong(v: Prisma.InputJsonValue | null): v is Prisma.InputJsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Tạo quy nguồn BAN ĐẦU của một lead (đường tạo lead / di trú). MỘT dòng mỗi lead (`leadId @unique`).
 *
 * [E2] Lượt TẠO bị đua: `createMany({ skipDuplicates: true })` ⇒ `INSERT … ON CONFLICT DO NOTHING`. Một
 * câu lệnh LỖI trong transaction tương tác của Postgres huỷ cả transaction (`25P02`) nên KHÔNG bắt P2002
 * rồi ghi tiếp trong cùng `tx`; ON CONFLICT thì đổi 0 dòng và transaction còn sống ⇒ ghi touchpoint ngay.
 * Không ghi AuditLog: đây là bản tự động lúc tạo/di trú (`02 §2.2`).
 */
export async function taoNguonBanDau(
  tx: Tx,
  leadId: string,
  d: DuLieuNguon,
  actorId: string | null,
): Promise<{ taoMoi: true } | { taoMoi: false; touchpointId: string }> {
  kiemDuLieu(d);
  const r = await tx.leadAttribution.createMany({
    data: [{ leadId, ...cot(d) }],
    skipDuplicates: true,
  });
  if (r.count === 1) return { taoMoi: true };

  // Lượt đua thua: tín hiệu của nó KHÔNG mất — thành touchpoint mang nhóm nó SẼ ra nếu thắng.
  const tp = await tx.leadTouchpoint.create({
    data: {
      leadId,
      kind: "TAO_LEAD",
      conversionEntry: d.conversionEntry,
      claimedGroupId: d.groupId,
      signals: {
        thua: true,
        matchedRule: d.matchedRule,
        referrerKind: d.referrerKind,
        ...(laDoiTuong(d.signals) ? d.signals : {}),
      },
      actorId,
    },
    select: { id: true },
  });
  return { taoMoi: false, touchpointId: tp.id };
}

/**
 * Tạo quy nguồn BAN ĐẦU cho NHIỀU lead MỚI cùng lúc (đường nhập Excel — T12: số câu ghi cố định theo lô, không theo số lead).
 *
 * Mọi cổng chạy TRƯỚC `createMany` (luật rollback). Lead ở đây vừa được tạo TRONG CÙNG transaction nên không ai khác
 * biết id của nó ⇒ KHÔNG THỂ đua; nếu `count` lệch số dòng là bất biến vỡ (đã có dòng quy nguồn cho lead mới) ⇒ `throw`
 * để cả lượt lùi lại, KHÔNG nuốt im lặng. Đường MỘT lead dùng `taoNguonBanDau` (có xử lý đua).
 */
export async function taoNguonTheoLo(
  tx: Tx,
  ds: readonly { leadId: string; d: DuLieuNguon }[],
): Promise<void> {
  if (ds.length === 0) return;
  for (const { d } of ds) kiemDuLieu(d);
  const r = await tx.leadAttribution.createMany({
    data: ds.map(({ leadId, d }) => ({ leadId, ...cot(d) })),
    skipDuplicates: true,
  });
  if (r.count !== ds.length) {
    throw new Error(`taoNguonTheoLo: ghi ${r.count}/${ds.length} dòng — có lead mới đã có quy nguồn (bất biến vỡ).`);
  }
}

/** Một dòng touchpoint — mọi trường BẮT BUỘC khai (luật 7). `signals` không PII. */
export type TouchpointMoi = {
  kind: LeadTouchpointKind;
  conversionEntry: string | null;
  claimedGroupId: string | null;
  signals: Prisma.InputJsonValue | null;
};

/**
 * Ghi MỘT touchpoint (tín hiệu đến sau / tín hiệu thua). Sổ GHI THÊM: không bao giờ đổi `LeadAttribution`
 * (03 §2.7) — nên không có điều kiện, không có đua. Lead phải đã có (FK Cascade).
 */
export async function ghiTouchpoint(
  tx: Tx,
  leadId: string,
  tp: TouchpointMoi,
  actorId: string | null,
): Promise<{ id: string }> {
  return tx.leadTouchpoint.create({
    data: {
      leadId,
      kind: tp.kind,
      conversionEntry: tp.conversionEntry,
      claimedGroupId: tp.claimedGroupId,
      signals: tp.signals ?? Prisma.DbNull,
      actorId,
    },
    select: { id: true },
  });
}

/** Nhiều touchpoint, MỘT câu `createMany` (đường Excel). Trả số dòng ghi. */
export async function ghiTouchpointTheoLo(
  tx: Tx,
  ds: readonly { leadId: string; tp: TouchpointMoi }[],
  actorId: string | null,
): Promise<number> {
  if (ds.length === 0) return 0;
  const r = await tx.leadTouchpoint.createMany({
    data: ds.map(({ leadId, tp }) => ({
      leadId,
      kind: tp.kind,
      conversionEntry: tp.conversionEntry,
      claimedGroupId: tp.claimedGroupId,
      signals: tp.signals ?? Prisma.DbNull,
      actorId,
    })),
  });
  return r.count;
}

type TomTatNguon = {
  nhom: string | null;
  referrerKind: string | null;
  referrerEmployeeId: string | null;
  referrerParentUserId: string | null;
  referrerStudentId: string | null;
  referrerAffiliateId: string | null;
  referrerMissing: boolean;
  referrerRoleCode: string | null;
  referrerSaleUserId: string | null;
  matchedRule: string;
};

/** Ảnh chụp cho audit — id, KHÔNG tên/SĐT. */
function tomTat(d: TomTatNguon): Record<string, unknown> {
  return { ...d };
}

/**
 * Đổi nguồn HIỆN HÀNH của một lead (khoá lạc quan theo `updatedAt` — `daDocUpdatedAt` là thứ người gọi ĐÃ ĐỌC).
 * AuditLog cùng transaction, `entityType: "Lead"` để lượt đổi TỰ hiện ở lịch sử lead
 * (`lib/lead/audit-history.ts` lọc `{ entityType: "Lead", entityId }`).
 *
 * Chỉ đổi 14 cột hiện hành (`DuLieuDoiNguon`); NGUỒN GỐC (`originalGroupId`/`inheritedFromLeadId`/`attributedAt`)
 * KHÔNG đổi — xem đầu tệp. Không ghi touchpoint (dấu vết của đổi nguồn là AuditLog).
 */
export async function doiNguon(
  tx: Tx,
  input: {
    leadId: string;
    daDocUpdatedAt: Date;
    moi: DuLieuDoiNguon;
    action: "DOI_NGUON" | "DOI_NGUON_SAU_THU" | "BO_SUNG_NGUOI" | "GOP_LEAD_NGUON" | "KHOA_NGUON";
    lyDo: string;
    actor: AuditActor;
  },
): Promise<{ ok: true } | { ok: false; loi: "NGUON_VUA_DOI" }> {
  const { leadId, daDocUpdatedAt, moi, action, actor } = input;
  const lyDo = input.lyDo.trim();
  // Mọi cổng đứng TRƯỚC phép ghi đầu tiên.
  if (lyDo.length < 10) throw new NguonError("LY_DO_NGAN", "Lý do đổi nguồn phải từ 10 ký tự.");
  kiemDuLieu(moi);
  return ghiDoiNguon(tx, { leadId, daDocUpdatedAt, moi, cotGhi: cotDoi(moi), action, lyDo, actor });
}

/**
 * Đường GỘP LEAD của `doiNguon` (chỉ `gopQuyNguon` gọi, KHÔNG export): bản thắng mang cả BA cột nguồn gốc của nó
 * sang lead chính (first-claim — `attributedAt` đã sớm thì `originalGroupId` phải đi cùng), nên ghi đủ 17 cột.
 */
async function doiNguonKhiGop(
  tx: Tx,
  input: { leadId: string; daDocUpdatedAt: Date; moi: DuLieuNguon; lyDo: string; actor: AuditActor },
): Promise<{ ok: true } | { ok: false; loi: "NGUON_VUA_DOI" }> {
  const { leadId, daDocUpdatedAt, moi, actor } = input;
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 10) throw new NguonError("LY_DO_NGAN", "Lý do đổi nguồn phải từ 10 ký tự.");
  kiemDuLieu(moi);
  return ghiDoiNguon(tx, { leadId, daDocUpdatedAt, moi, cotGhi: cot(moi), action: "GOP_LEAD_NGUON", lyDo, actor });
}

/** Phép ghi chung của hai đường đổi: gọi SAU khi mọi cổng đã qua. `lyDo` đã trim, `cotGhi` do người gọi chọn. */
async function ghiDoiNguon(
  tx: Tx,
  input: {
    leadId: string;
    daDocUpdatedAt: Date;
    moi: DuLieuDoiNguon;
    cotGhi: Prisma.LeadAttributionUncheckedUpdateManyInput;
    action: "DOI_NGUON" | "DOI_NGUON_SAU_THU" | "BO_SUNG_NGUOI" | "GOP_LEAD_NGUON" | "KHOA_NGUON";
    lyDo: string;
    actor: AuditActor;
  },
): Promise<{ ok: true } | { ok: false; loi: "NGUON_VUA_DOI" }> {
  const { leadId, daDocUpdatedAt, moi, cotGhi, action, lyDo, actor } = input;
  const cu = await tx.leadAttribution.findUnique({
    where: { leadId },
    include: { lead: { select: { orgUnitId: true } }, group: { select: { code: true } } },
  });
  if (!cu) throw new Error("Lead chưa có quy nguồn — dùng taoNguonBanDau.");
  const nhomMoi = await tx.leadSourceGroup.findUnique({ where: { id: moi.groupId }, select: { code: true } });
  if (!nhomMoi) throw new Error(`Không thấy nhóm nguồn ${moi.groupId}.`);

  const r = await tx.leadAttribution.updateMany({
    where: { leadId, updatedAt: daDocUpdatedAt },
    data: { ...cotGhi, changeReason: lyDo, changedById: actor.id },
  });
  // FIX-H9: ghi CÓ ĐIỀU KIỆN đổi 0 dòng ⇒ commit vô hại, không có gì để lùi.
  if (r.count === 0) return { ok: false, loi: "NGUON_VUA_DOI" };

  await writeAudit({
    tx,
    actor,
    module: "nguon-hoa-hong",
    entityType: "Lead",
    entityId: leadId,
    action,
    oldValues: tomTat({
      nhom: cu.group.code,
      referrerKind: cu.referrerKind,
      referrerEmployeeId: cu.referrerEmployeeId,
      referrerParentUserId: cu.referrerParentUserId,
      referrerStudentId: cu.referrerStudentId,
      referrerAffiliateId: cu.referrerAffiliateId,
      referrerMissing: cu.referrerMissing,
      referrerRoleCode: cu.referrerRoleCode,
      referrerSaleUserId: cu.referrerSaleUserId,
      matchedRule: cu.matchedRule,
    }),
    newValues: tomTat({
      nhom: nhomMoi.code,
      referrerKind: moi.referrerKind,
      referrerEmployeeId: moi.referrerEmployeeId,
      referrerParentUserId: moi.referrerParentUserId,
      referrerStudentId: moi.referrerStudentId,
      referrerAffiliateId: moi.referrerAffiliateId,
      referrerMissing: moi.referrerMissing,
      referrerRoleCode: moi.referrerRoleCode,
      referrerSaleUserId: moi.referrerSaleUserId,
      matchedRule: moi.matchedRule,
    }),
    reason: lyDo,
    orgUnitId: cu.lead.orgUnitId,
  });
  return { ok: true };
}

type DongQuyNguon = Prisma.LeadAttributionGetPayload<{ include: { group: { select: { code: true } } } }>;

/** Dòng quy nguồn → `DuLieuNguon` (giữ NGUYÊN `attributedAt` — first-claim không đổi giờ ghi nhận). */
function tuDong(r: DongQuyNguon): DuLieuNguon {
  return {
    groupId: r.groupId,
    otherSourceNote: r.otherSourceNote,
    referrerKind: r.referrerKind,
    referrerEmployeeId: r.referrerEmployeeId,
    referrerParentUserId: r.referrerParentUserId,
    referrerStudentId: r.referrerStudentId,
    referrerAffiliateId: r.referrerAffiliateId,
    referrerMissing: r.referrerMissing,
    referrerRoleCode: r.referrerRoleCode,
    referrerSaleUserId: r.referrerSaleUserId,
    identificationMethod: r.identificationMethod,
    matchedRule: r.matchedRule,
    reasonText: r.reasonText,
    canhBao: r.canhBao,
    originalGroupId: r.originalGroupId,
    inheritedFromLeadId: r.inheritedFromLeadId,
    conversionEntry: r.conversionEntry,
    signals: r.signals as Prisma.InputJsonValue | null,
    attributedAt: r.attributedAt,
  };
}

/** Touchpoint `GOP_LEAD` chụp một dòng quy nguồn — thứ vừa bị thay HOẶC thứ không thắng. */
function chupGopLead(r: DongQuyNguon, tuLeadId: string) {
  return {
    kind: "GOP_LEAD" as const,
    conversionEntry: r.conversionEntry,
    claimedGroupId: r.groupId,
    signals: {
      tuLeadId,
      matchedRule: r.matchedRule,
      referrerKind: r.referrerKind,
      referrerEmployeeId: r.referrerEmployeeId,
      referrerParentUserId: r.referrerParentUserId,
      referrerStudentId: r.referrerStudentId,
      referrerAffiliateId: r.referrerAffiliateId,
      attributedAt: r.attributedAt.toISOString(),
    } satisfies Prisma.InputJsonObject,
  };
}

type KetQuaGopQuyNguon = {
  touchpointDoi: number;
  cach: "KHONG_CO" | "DOI_DONG_PHU" | "CHINH_GIU" | "PHU_THANG";
  truoc: string | null;
  sau: string | null;
};

/**
 * [F1] `LeadAttribution.inheritedFromLeadId` là cột trỏ vào `Lead` mà lưới "cột lạ" của gộp lead chỉ thấy khi tên
 * khớp mẫu quét (`lib/lead/gop-lead.ts:cotTroVaoLead` — nay đã thêm tên này). Sau gộp lead phụ chỉ bị XOÁ MỀM
 * nhưng dữ liệu của nó (touchpoint, đơn, hội thoại…) đã dời sang lead chính, nên một dòng quy nguồn của lead KHÁC
 * còn trỏ vào lead phụ là trỏ vào một lead không còn ai đọc được — và hàm kế thừa chạy lại hôm nay cũng sẽ cho ra
 * lead CHÍNH (lead phụ đã bị lọc `deletedAt`), không phải lead phụ.
 *
 *  1. dòng của lead CHÍNH mà sau gộp sẽ tự trỏ vào chính nó (`inheritedFromLeadId` ∈ {phụ, chính}) ⇒ NULL (không có
 *     lead nào để "kế thừa từ" nữa; `matchedRule`/`reasonText` vẫn ghi việc kế thừa đã xảy ra);
 *  2. dòng của lead KHÁC trỏ vào phụ ⇒ trỏ sang chính.
 *
 * Không đổi `attributedAt`/nhóm — chỉ đổi tham chiếu. Trả số dòng đã đổi (cho `bangDoi`).
 */
async function doiThamChieuKeThua(tx: Tx, input: { phuId: string; chinhId: string }): Promise<number> {
  const { phuId, chinhId } = input;
  const tuTro = await tx.leadAttribution.updateMany({
    where: { leadId: chinhId, inheritedFromLeadId: { in: [phuId, chinhId] } },
    data: { inheritedFromLeadId: null },
  });
  const khac = await tx.leadAttribution.updateMany({
    where: { inheritedFromLeadId: phuId, leadId: { not: chinhId } },
    data: { inheritedFromLeadId: chinhId },
  });
  return tuTro.count + khac.count;
}

/** Gộp NGUỒN khi gộp lead: `gopQuyNguon` (quy nguồn + touchpoint, luật 1–5 bên dưới) rồi `doiThamChieuKeThua` ([F1]). */
export async function gopNguonLead(
  tx: Tx,
  input: { phuId: string; chinhId: string; actorName: string },
): Promise<KetQuaGopQuyNguon & { keThuaDoi: number }> {
  const kq = await gopQuyNguon(tx, input);
  const keThuaDoi = await doiThamChieuKeThua(tx, input);
  return { ...kq, keThuaDoi };
}

/**
 * Gộp NGUỒN khi gộp lead (`03 §6`, `02 §11.3`) — gọi TRONG `gopTrongGiaoDich`, cùng transaction.
 *
 *  1. touchpoint của lead phụ DỜI hết sang lead chính;
 *  2. không ai có quy nguồn ⇒ KHONG_CO; chỉ chính có ⇒ CHINH_GIU;
 *  3. chỉ phụ có ⇒ dòng của phụ DỜI sang chính (`leadId @unique` an toàn vì chính chưa có dòng) +
 *     AuditLog `GOP_LEAD_NGUON` ⇒ DOI_DONG_PHU;
 *  4. cả hai có ⇒ first-claim (`chonKhiGopLead`): thắng `chinh` ⇒ touchpoint chụp bản PHỤ ⇒ CHINH_GIU;
 *     thắng `phu` ⇒ touchpoint chụp bản chính cũ rồi `doiNguonKhiGop` (mang cả nguồn gốc của phụ) ⇒ PHU_THANG.
 *  5. dòng của lead phụ (khi cả hai có) Ở LẠI trên lead phụ đã xoá mềm — không xoá, không sửa.
 */
async function gopQuyNguon(
  tx: Tx,
  input: { phuId: string; chinhId: string; actorName: string },
): Promise<KetQuaGopQuyNguon> {
  const { phuId, chinhId, actorName } = input;
  const touchpointDoi = (await tx.leadTouchpoint.updateMany({ where: { leadId: phuId }, data: { leadId: chinhId } })).count;

  const incl = { group: { select: { code: true } } } as const;
  const [phu, chinh] = await Promise.all([
    tx.leadAttribution.findUnique({ where: { leadId: phuId }, include: incl }),
    tx.leadAttribution.findUnique({ where: { leadId: chinhId }, include: incl }),
  ]);

  if (!phu && !chinh) return { touchpointDoi, cach: "KHONG_CO", truoc: null, sau: null };
  if (!phu && chinh) return { touchpointDoi, cach: "CHINH_GIU", truoc: chinh.group.code, sau: chinh.group.code };

  if (phu && !chinh) {
    await tx.leadAttribution.updateMany({ where: { leadId: phuId }, data: { leadId: chinhId } });
    await writeAudit({
      tx,
      actor: { id: null, name: actorName },
      module: "nguon-hoa-hong",
      entityType: "Lead",
      entityId: chinhId,
      action: "GOP_LEAD_NGUON",
      oldValues: null,
      newValues: tomTat({
        nhom: phu.group.code,
        referrerKind: phu.referrerKind,
        referrerEmployeeId: phu.referrerEmployeeId,
        referrerParentUserId: phu.referrerParentUserId,
        referrerStudentId: phu.referrerStudentId,
        referrerAffiliateId: phu.referrerAffiliateId,
        referrerMissing: phu.referrerMissing,
        referrerRoleCode: phu.referrerRoleCode,
        referrerSaleUserId: phu.referrerSaleUserId,
        matchedRule: phu.matchedRule,
      }),
      reason: `Gộp lead ${phuId} vào ${chinhId}: dời quy nguồn của lead phụ`,
    });
    return { touchpointDoi, cach: "DOI_DONG_PHU", truoc: null, sau: phu.group.code };
  }

  // Cả hai có — TypeScript chưa thu hẹp qua các nhánh trên.
  if (!phu || !chinh) throw new Error("gopNguonLead: trạng thái không thể xảy ra");
  const { thang } = chonKhiGopLead({ attributedAt: chinh.attributedAt }, { attributedAt: phu.attributedAt });

  if (thang === "chinh") {
    await tx.leadTouchpoint.create({ data: { leadId: chinhId, ...chupGopLead(phu, phuId), actorId: null } });
    return { touchpointDoi, cach: "CHINH_GIU", truoc: chinh.group.code, sau: chinh.group.code };
  }

  await tx.leadTouchpoint.create({ data: { leadId: chinhId, ...chupGopLead(chinh, chinhId), actorId: null } });
  const kq = await doiNguonKhiGop(tx, {
    leadId: chinhId,
    daDocUpdatedAt: chinh.updatedAt,
    moi: tuDong(phu),
    lyDo: `Gộp lead ${phuId} vào ${chinhId}`,
    actor: { id: null, name: actorName },
  });
  // Cùng transaction nên KHÔNG thể xảy ra; nếu xảy ra thì cả lượt gộp lùi (throw, không return).
  if (!kq.ok) throw new Error("Gộp nguồn lead: quy nguồn của lead chính vừa bị đổi trong cùng giao dịch.");
  return { touchpointDoi, cach: "PHU_THANG", truoc: chinh.group.code, sau: phu.group.code };
}

/**
 * DỌN DỮ LIỆU THỬ — xoá dòng quy nguồn mà người giới thiệu thuộc tập sắp bị XOÁ CỨNG (07 §2.8).
 *
 * Chỉ dành cho script dọn dữ liệu test/demo: FK `referrer*Id` là `Restrict` nên xoá cứng người đang được dòng quy nguồn trỏ tới
 * sẽ ném lỗi RESTRICT (SQLSTATE 23001 — Prisma KHÔNG dịch thành `P2003`). Lead KHÔNG bị xoá — chỉ dòng quy nguồn (vì CHECK `LeadAttribution_nguoi_gioi_thieu_chk` không cho gỡ riêng cột
 * người mà giữ nguyên `referrerKind`). KHÔNG dùng ở đường nghiệp vụ: xoá nhân viên thật phải được CHẶN (`nguoiDangGioiThieuLead`).
 *
 * Mọi danh sách rỗng ⇒ 0 dòng (không bao giờ thành `deleteMany` không điều kiện).
 */
export async function xoaQuyNguonTheoNguoiGioiThieu(
  client: {
    leadAttribution: {
      deleteMany: (a: { where: Prisma.LeadAttributionWhereInput }) => Promise<{ count: number }>;
      updateMany: (a: { where: Prisma.LeadAttributionWhereInput; data: { referrerSaleUserId: null } }) => Promise<{ count: number }>;
    };
  },
  ids: {
    studentIds: readonly string[];
    userIds: readonly string[];
    employeeIds: readonly string[];
    affiliateIds: readonly string[];
  },
): Promise<number> {
  const or: Prisma.LeadAttributionWhereInput[] = [
    ...(ids.studentIds.length > 0 ? [{ referrerStudentId: { in: [...ids.studentIds] } }] : []),
    ...(ids.userIds.length > 0 ? [{ referrerParentUserId: { in: [...ids.userIds] } }] : []),
    ...(ids.employeeIds.length > 0 ? [{ referrerEmployeeId: { in: [...ids.employeeIds] } }] : []),
    ...(ids.affiliateIds.length > 0 ? [{ referrerAffiliateId: { in: [...ids.affiliateIds] } }] : []),
  ];
  if (or.length === 0) return 0;
  const daXoa = (await client.leadAttribution.deleteMany({ where: { OR: or } })).count;
  // `referrerSaleUserId` (Sale phụ trách PH, FK Restrict sang User): `userIds` còn là Sale của lead KHÔNG thuộc tập test ⇒ XOÁ dòng quy nguồn là xoá nguồn của lead thật. Chỉ GỠ cột ấy:
  // cột nằm ngoài CHECK `LeadAttribution_nguoi_gioi_thieu_chk` nên gỡ riêng được (lead đó quay về hold `THIEU_SALE_PHU_HUYNH` — đúng nghĩa «Sale này không còn»).
  if (ids.userIds.length > 0) await client.leadAttribution.updateMany({ where: { referrerSaleUserId: { in: [...ids.userIds] } }, data: { referrerSaleUserId: null } });
  return daXoa;
}

/**
 * [W3 · gt2 R1-H1] GHI MỘT LÔ «chụp lại chủ nguồn»: đổi ĐÚNG MỘT khoá `signals.nguon.chuNhanVienId` của các dòng quy nguồn đã chọn sang chủ HIỆN TẠI của nguồn. Dịch vụ điều phối
 * (`chup-lai-chu-nguon.ts`) chọn lô + khoá + audit; tệp này giữ PHÉP GHI duy nhất (lưới `[CLC-W2]` đếm đúng một `UPDATE "LeadAttribution"` ngoài các accessor ở trên).
 *
 * MỘT câu lệnh cho cả lô (không vòng `update` từng dòng — 100 vòng đi-về trong transaction 5 giây là mời `P2028`). Cổng kiểm LẠI ngay trong `WHERE` (đúng nhóm · bản chụp đúng hình dạng ·
 * chủ đã chụp vẫn thuộc diện cần chụp lại) nên dòng vừa bị người khác đổi giữa lúc chọn và lúc ghi tự rơi ra, không bị ghi đè. `jsonb_set(..., false)`: khoá phải CÓ SẴN — không tạo khoá mới.
 *
 * KHÔNG đụng `cuaSoNgay` (đổi cửa sổ là hồi tố), `attributedAt`, `groupId`, nguồn gốc, `changeReason`/`changedById` (không phải «đổi nguồn»). `updatedAt` = `now` (tham số, luật 19):
 * nhích mốc đầu vào ⇒ kỳ đã tính thấy `INPUT_DRIFT` (`mocDauVaoNguon`), tập quét Q4 và cổng khoá kỳ thấy dòng này. Trả `id` các dòng THẬT SỰ được ghi.
 */
export async function ghiChuNguonChupLo(
  tx: Tx,
  p: {
    nguonId: string;
    ids: readonly string[];
    /** `Employee.id` chủ hiện tại của nguồn — giá trị được ghi. */
    chuMoi: string;
    thieuChu: boolean;
    chuKhongConHieuLuc: readonly string[];
    now: Date;
  },
): Promise<string[]> {
  if (p.ids.length === 0) return [];
  if (p.chuMoi.length === 0) throw new Error("ghiChuNguonChupLo: chuMoi rỗng.");
  const r = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "LeadAttribution"
    SET "signals" = jsonb_set("signals", '{nguon,chuNhanVienId}', to_jsonb(${p.chuMoi}::text), false), "updatedAt" = ${p.now}
    WHERE "id" = ANY(${[...p.ids]}::text[]) AND "groupId" = ${p.nguonId} AND ${BAN_CHUP_HOP_LE}
      AND ${dieuKienTheoChu({ thieuChu: p.thieuChu, chuKhongConHieuLuc: p.chuKhongConHieuLuc, chuHienTai: p.chuMoi })}
    RETURNING "id"`);
  return r.map((x) => x.id);
}
