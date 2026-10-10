// lib/hoa-hong/chinh-sach-service.ts — SERVICE CHÍNH SÁCH HOA HỒNG: soạn nháp · version mới · kích hoạt có guardrail.
//
// Nguồn: docs/source-commission/02 §8.4–§8.5, 04 §6, 05 PR4. DB (Prisma), KHÔNG Server Action, KHÔNG UI.
//
// ⚠️ SERVICE NÀY KHÔNG KIỂM QUYỀN. Quyền `commission_policies:view|manage|activate` sinh ở PR6b và được gác ở
// Server Action của PR8 (`assertCan` ngay đầu hàm). Ai gọi service từ chỗ khác PHẢI tự gác — đừng coi file này
// là cổng quyền. (Cũng vì vậy nó nằm ở `lib/`, ngoài tầm ESLint cổng DB của `app/(admin)`.)
//
// ─────────────────────────────────────────────────────────────────────────────
// BẤT BIẾN (luật của chủ dự án + PRD)
//
//   · Chỉ NHÁP (`DRAFT`, chưa `firstUsedAt`) sửa được. Đã kích hoạt / đã dùng ⇒ muốn đổi phải TẠO VERSION MỚI.
//     "Chính sách đã sinh giao dịch tài chính ⇒ locked" — `firstUsedAt` do SỔ (PR5) đánh dấu qua `danhDauDaDung`.
//   · Kích hoạt chạy guardrail (`guardrail-kich-hoat.ts`) và CHẶN nếu có lỗi; có cảnh báo thì phải xác nhận kèm
//     lý do ≥ 10 ký tự. Mọi cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback); từ chối sau khi ghi ⇒ `throw`.
//   · Version mới của cùng (policy, phạm vi) ĐÓNG bản trước tại `effectiveFrom` của nó (khuôn
//     `CommissionRateConfig`, biên MỞ) — bản trước thành `SUPERSEDED`. Khoản thu trước mốc vẫn dùng bản cũ.
//   · Đơn vị SỞ HỮU của policy bất biến; version + rule CHÉP `centerId`/`orgUnitId` từ policy lúc tạo (02 §2.6).
//     `scopedDb` KHÔNG che write ⇒ mọi `create` ở đây tự đặt hai cột.
//   · Trần đọc `getSetting("crm.commissionMaxTotalRate")` rồi TRUYỀN vào guardrail (tham số bắt buộc, `[NHH-W3]`).
//   · Mọi hàm nhận `now` BẮT BUỘC (luật 19) — không đọc đồng hồ.
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { nguoiHuongHieuLuc, type PhanCongCoSo } from "@/lib/crm/commission-assignee";
import { depthOfPath } from "@/lib/org/path";
import { getSetting } from "@/lib/settings/service";

import { cotPhamVi, kiemRuleDauVao, scopeKeyCua, type PhamViInput, type RuleInput } from "./chinh-sach-dau-vao";
import { THU_TU_PHAM_VI_MAC_DINH, type PhamVi, type QuyTac, type TrangThaiPhienBan } from "./chon-quy-tac";
import { kiemKichHoat, type DauVaoKichHoat, type VanDeKichHoat } from "./guardrail-kich-hoat";
import { HoaHongError, type HoaHongContext } from "./kieu";
import type { ChinhSachVuotTranMoi } from "./huong-xu-ly-tran";
import { ngayCuaCotDate, ngayHieuLucSomNhat, ngayHopLe, SO_NGAY_LAM_VIEC_SAU_CONG_BO, type NgayNghiLe } from "./ngay-lam-viec";
import { KHOA_PHAN_CONG_CO_SO } from "./vai-huong";

type Tx = Prisma.TransactionClient;
type Khach = Tx | typeof db;

export type NguoiThaoTac = { userId: string | null; ten: string };

const actorAudit = (a: NguoiThaoTac) => ({ id: a.userId, name: a.ten });

/** Lý do xác nhận cảnh báo phải đủ dài để là một lý do thật. */
export const LY_DO_XAC_NHAN_TOI_THIEU = 10;

const MODULE_AUDIT = "hoa-hong";

/**
 * Khoá advisory (theo giao dịch) tuần tự hoá MỌI thao tác đổi TẬP version ACTIVE: kích hoạt, cho hết hiệu lực. Guardrail đọc tập ACTIVE
 * NGOÀI transaction, nên không có khoá này thì hai người kích hoạt hai policy khác nhau cùng lúc đều thấy "chưa có gì", cùng qua trần
 * 9% / chồng lấn, cùng ghi. Lấy khoá rồi so lại "dấu vân tay" của tập ACTIVE với bản guardrail đã đọc — lệch ⇒ `TAP_HIEU_LUC_DA_DOI`.
 * Export để test giữ khoá sắp xếp cuộc đua (ca `[NHH-POL-DB-24]`).
 */
export const KHOA_ADVISORY_CHINH_SACH = "hoa-hong:chinh-sach";

/** ⚠️ `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock()` trả `void` và Prisma không đọc được kiểu đó (cùng lý do `ghi-tien-don.ts`). */
export const khoaChinhSach = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${KHOA_ADVISORY_CHINH_SACH})::bigint)`;

type DongVanTay = { id: string; effectiveFrom: Date; effectiveTo: Date | null; status: string; firstUsedAt: Date | null };

/** Dấu vân tay của tập version ACTIVE (trừ bản đang kích hoạt): đổi id, mốc hiệu lực, trạng thái hay cờ "đã dùng" ⇒ đổi chuỗi. */
function vanTayTapActive(rows: readonly DongVanTay[]): string {
  return [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `${r.id}|${r.status}|${r.effectiveFrom.getTime()}|${r.effectiveTo?.getTime() ?? "-"}|${r.firstUsedAt?.getTime() ?? "-"}`)
    .join(";");
}

type DongVanTayNguon = { id: string; status: string; commissionEnabled: boolean; ownerEmployeeId: string | null; referrerRequirement: string };

/**
 * Dấu vân tay của các NHÓM NGUỒN mà guardrail ĐỌC (id · trạng thái · cờ hoa hồng · người phụ trách · kiểu người giới thiệu). `vanTayTapActive` chỉ bao PHIÊN BẢN chính sách nên không thấy ca «nguồn mới
 * không chủ vào đúng lúc rule chủ-nguồn chung được kích hoạt»: hai cổng cùng qua dù một trong hai đã thành sai (W2, res3 L8). Lấy khoá advisory rồi so lại — lệch ⇒ `NGUON_DA_DOI`.
 */
function vanTayNhomNguon(rows: readonly DongVanTayNguon[]): string {
  return [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => `${r.id}|${r.status}|${r.commissionEnabled ? 1 : 0}|${r.ownerEmployeeId ?? "-"}|${r.referrerRequirement}`)
    .join(";");
}

/** Nhóm nguồn guardrail đọc (không gồm UNKNOWN) — MỘT select cho cả lúc kiểm lẫn lúc so lại dưới khoá. */
const SELECT_NHOM_GUARDRAIL = { id: true, code: true, status: true, commissionEnabled: true, ownerEmployeeId: true, referrerRequirement: true } as const;

// ── Đọc chung ───────────────────────────────────────────────────────────────

type ChuSoHuu = { orgUnitId: string | null; centerId: string | null; path: string; depth: number };

/**
 * `null` = Hội sở / toàn hệ (path "/", độ sâu −1: rule của Hội sở áp mọi nơi và thua rule của đơn vị cụ thể).
 *
 * Đơn vị khác chỉ nhận khi là CƠ SỞ (`type = CENTER`, có `centerId`). Cách ly cơ sở của `scopedDb` đo bằng `centerId` và đọc
 * `NULL` là "dùng chung mọi cơ sở" (`NULL_IS_GLOBAL_MODELS`, luật Nền #3): chủ sở hữu là vùng/Hội sở-node (`centerId = NULL`) sẽ
 * làm văn bản + chính sách của riêng vùng hiện ra cho actor của MỌI cơ sở. Cho phép vùng sở hữu = đợt riêng chuyển cách ly sang `orgUnitId`.
 */
async function docChuSoHuu(client: Khach, orgUnitId: string | null): Promise<ChuSoHuu> {
  if (orgUnitId === null) return { orgUnitId: null, centerId: null, path: "/", depth: -1 };
  const o = await client.orgUnit.findFirst({ where: { id: orgUnitId, deletedAt: null }, select: { id: true, centerId: true, path: true, type: true } });
  if (!o || !o.path) throw new HoaHongError("DON_VI_KHONG_HOP_LE", `Đơn vị ${orgUnitId} không tồn tại hoặc chưa có path.`);
  if (o.type !== "CENTER" || o.centerId === null) {
    throw new HoaHongError("DON_VI_KHONG_HOP_LE", `Đơn vị sở hữu phải là Hội sở (để trống) hoặc một cơ sở; "${o.type}" không có cơ sở để cách ly dữ liệu.`);
  }
  return { orgUnitId: o.id, centerId: o.centerId, path: o.path, depth: depthOfPath(o.path) };
}

async function kiemPhamVi(client: Khach, p: PhamViInput): Promise<void> {
  const loi = (m: string) => new HoaHongError("DU_LIEU_KHONG_HOP_LE", m);
  switch (p.loai) {
    case "GLOBAL":
      return;
    case "PERSON":
      if (!(await client.user.findUnique({ where: { id: p.userId }, select: { id: true } }))) throw loi(`Người ${p.userId} không tồn tại.`);
      return;
    case "AFFILIATE":
      if (!(await client.affiliate.findUnique({ where: { id: p.affiliateId }, select: { id: true } }))) throw loi(`Affiliate ${p.affiliateId} không tồn tại.`);
      return;
    case "SOURCE_GROUP":
      if (!(await client.leadSourceGroup.findUnique({ where: { id: p.sourceGroupId }, select: { id: true } }))) throw loi(`Nhóm nguồn ${p.sourceGroupId} không tồn tại.`);
      return;
    case "ORG_UNIT":
      if (!(await client.orgUnit.findFirst({ where: { id: p.orgUnitId, deletedAt: null }, select: { id: true } }))) throw loi(`Đơn vị ${p.orgUnitId} không tồn tại.`);
      return;
    case "ROLE":
      if (!(await client.roleDef.findUnique({ where: { id: p.roleDefId }, select: { id: true } }))) throw loi(`Vai ${p.roleDefId} không tồn tại.`);
      return;
  }
}

/** Kiểm rule: hình dạng (thuần) + vai + loại giao dịch có trong master. Trả `roleCode → BeneficiaryRole.id`. */
async function kiemRule(client: Khach, rules: readonly RuleInput[]): Promise<Map<string, string>> {
  const loi = kiemRuleDauVao(rules);
  if (loi.length > 0) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", loi.join(" "), loi);
  const vai = await client.beneficiaryRole.findMany({ select: { id: true, code: true } });
  const idVai = new Map(vai.map((v) => [v.code, v.id]));
  const loai = new Set((await client.commissionTransactionType.findMany({ select: { code: true } })).map((l) => l.code));
  const sai: string[] = [];
  for (const r of rules) {
    if (!idVai.has(r.roleCode)) sai.push(`Vai "${r.roleCode}" không có trong danh mục vai hưởng.`);
    if (!loai.has(r.transactionTypeCode)) sai.push(`Loại giao dịch "${r.transactionTypeCode}" không có trong danh mục.`);
  }
  if (sai.length > 0) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", sai.join(" "), sai);
  return idVai;
}

function dongRule(
  versionId: string,
  r: RuleInput,
  idVai: ReadonlyMap<string, string>,
  sh: ChuSoHuu,
): Prisma.CommissionRuleCreateManyInput {
  return {
    versionId,
    transactionTypeCode: r.transactionTypeCode,
    beneficiaryRoleId: idVai.get(r.roleCode)!,
    revenueComponent: r.revenueComponent,
    calcKind: r.calcKind,
    rate: r.rate === null ? null : new Prisma.Decimal(String(r.rate)),
    fixedAmount: r.fixedAmount,
    tierTable: r.tierTable === null ? Prisma.DbNull : (r.tierTable as Prisma.InputJsonValue),
    note: r.note,
    centerId: sh.centerId,
    orgUnitId: sh.orgUnitId,
  };
}

// ── Soạn ────────────────────────────────────────────────────────────────────

export async function taoVanBan(input: {
  documentCode: string;
  title: string;
  kind: "COMMISSION_POLICY" | "OTHER";
  issuedOn: string;
  publishedOn: string;
  effectiveOn: string;
  approvedByName: string;
  approvedById: string | null;
  fileKey: string | null;
  fileName: string | null;
  fileUrl: string | null;
  /** Đơn vị BAN HÀNH; `null` = Hội sở / toàn hệ. */
  ownerOrgUnitId: string | null;
  actor: NguoiThaoTac;
  now: Date;
}): Promise<{ id: string }> {
  if (!input.documentCode.trim() || !input.title.trim() || !input.approvedByName.trim()) {
    throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Văn bản cần số, tiêu đề và người duyệt.");
  }
  for (const [k, v] of [["issuedOn", input.issuedOn], ["publishedOn", input.publishedOn], ["effectiveOn", input.effectiveOn]] as const) {
    if (!ngayHopLe(v)) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", `Ngày ${k} không hợp lệ: "${v}".`);
  }
  const sh = await docChuSoHuu(db, input.ownerOrgUnitId);
  return db.$transaction(async (tx) => {
    const r = await tx.regulationDocument.create({
      data: {
        documentCode: input.documentCode.trim(),
        title: input.title.trim(),
        kind: input.kind,
        issuedOn: new Date(`${input.issuedOn}T00:00:00.000Z`),
        publishedOn: new Date(`${input.publishedOn}T00:00:00.000Z`),
        effectiveOn: new Date(`${input.effectiveOn}T00:00:00.000Z`),
        approvedByName: input.approvedByName.trim(),
        approvedById: input.approvedById,
        fileKey: input.fileKey,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        centerId: sh.centerId,
        orgUnitId: sh.orgUnitId,
        createdById: input.actor.userId,
      },
      select: { id: true },
    });
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "RegulationDocument",
      entityId: r.id,
      action: "CREATE",
      newValues: { documentCode: input.documentCode, publishedOn: input.publishedOn },
      orgUnitId: sh.orgUnitId,
      tx,
    });
    return r;
  });
}

type DuLieuVersion = {
  phamVi: PhamViInput;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  documentId: string | null;
  rules: readonly RuleInput[];
};

async function kiemVersion(client: Khach, d: DuLieuVersion): Promise<Map<string, string>> {
  if (!d.reason.trim()) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Phải có lý do / căn cứ cho version.");
  if (d.effectiveTo !== null && d.effectiveTo.getTime() <= d.effectiveFrom.getTime()) {
    throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Hiệu lực kết thúc phải sau hiệu lực bắt đầu.");
  }
  if (d.documentId && !(await client.regulationDocument.findUnique({ where: { id: d.documentId }, select: { id: true } }))) {
    throw new HoaHongError("VAN_BAN_KHONG_TON_TAI", `Văn bản ${d.documentId} không tồn tại.`);
  }
  await kiemPhamVi(client, d.phamVi);
  return kiemRule(client, d.rules);
}

export async function taoChinhSach(input: {
  policyCode: string;
  name: string;
  description: string | null;
  /** Đơn vị SỞ HỮU (bất biến); `null` = Hội sở / toàn hệ. */
  ownerOrgUnitId: string | null;
  phamVi: PhamViInput;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  documentId: string | null;
  rules: readonly RuleInput[];
  actor: NguoiThaoTac;
  now: Date;
}): Promise<{ policyId: string; versionId: string; versionNo: number }> {
  if (!input.policyCode.trim() || !input.name.trim()) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Chính sách cần mã và tên.");
  const sh = await docChuSoHuu(db, input.ownerOrgUnitId);
  const idVai = await kiemVersion(db, input);

  return db.$transaction(async (tx) => {
    const p = await tx.commissionPolicy.create({
      data: {
        policyCode: input.policyCode.trim(),
        name: input.name.trim(),
        description: input.description,
        centerId: sh.centerId,
        orgUnitId: sh.orgUnitId,
        createdById: input.actor.userId,
      },
      select: { id: true },
    });
    const v = await taoVersionTrongTx(tx, { policyId: p.id, versionNo: 1, sh, d: input, idVai, actor: input.actor });
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPolicy",
      entityId: p.id,
      action: "CREATE",
      newValues: { policyCode: input.policyCode, versionId: v },
      orgUnitId: sh.orgUnitId,
      tx,
    });
    return { policyId: p.id, versionId: v, versionNo: 1 };
  });
}

async function taoVersionTrongTx(
  tx: Tx,
  a: { policyId: string; versionNo: number; sh: ChuSoHuu; d: DuLieuVersion; idVai: ReadonlyMap<string, string>; actor: NguoiThaoTac },
): Promise<string> {
  const v = await tx.commissionPolicyVersion.create({
    data: {
      policyId: a.policyId,
      versionNo: a.versionNo,
      status: "DRAFT",
      effectiveFrom: a.d.effectiveFrom,
      effectiveTo: a.d.effectiveTo,
      reason: a.d.reason.trim(),
      createdById: a.actor.userId,
      createdByName: a.actor.ten,
      documentId: a.d.documentId,
      ...cotPhamVi(a.d.phamVi),
      centerId: a.sh.centerId,
      orgUnitId: a.sh.orgUnitId,
    },
    select: { id: true },
  });
  if (a.d.rules.length > 0) {
    await tx.commissionRule.createMany({ data: a.d.rules.map((r) => dongRule(v.id, r, a.idVai, a.sh)) });
  }
  await writeAudit({
    actor: actorAudit(a.actor),
    module: MODULE_AUDIT,
    entityType: "CommissionPolicyVersion",
    entityId: v.id,
    action: "CREATE",
    newValues: { policyId: a.policyId, versionNo: a.versionNo, scopeKey: scopeKeyCua(a.d.phamVi), soRule: a.d.rules.length },
    orgUnitId: a.sh.orgUnitId,
    tx,
  });
  return v.id;
}

/** Rule của một version → `RuleInput` (để chép sang version mới). */
async function docRuleInput(client: Khach, versionId: string): Promise<RuleInput[]> {
  const rs = await client.commissionRule.findMany({ where: { versionId }, include: { beneficiaryRole: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
  return rs.map((r) => ({
    transactionTypeCode: r.transactionTypeCode,
    roleCode: r.beneficiaryRole.code,
    revenueComponent: r.revenueComponent,
    calcKind: r.calcKind,
    rate: r.rate === null ? null : r.rate.toString(),
    fixedAmount: r.fixedAmount,
    tierTable: r.tierTable ?? null,
    note: r.note,
  }));
}

function phamViTuVersion(v: {
  scopeType: PhamVi;
  scopeUserId: string | null;
  scopeAffiliateId: string | null;
  scopeSourceGroupId: string | null;
  scopeOrgUnitId: string | null;
  scopeRoleDefId: string | null;
}): PhamViInput {
  switch (v.scopeType) {
    case "GLOBAL":
      return { loai: "GLOBAL" };
    case "PERSON":
      return { loai: "PERSON", userId: v.scopeUserId! };
    case "AFFILIATE":
      return { loai: "AFFILIATE", affiliateId: v.scopeAffiliateId! };
    case "SOURCE_GROUP":
      return { loai: "SOURCE_GROUP", sourceGroupId: v.scopeSourceGroupId! };
    case "ORG_UNIT":
      return { loai: "ORG_UNIT", orgUnitId: v.scopeOrgUnitId! };
    case "ROLE":
      return { loai: "ROLE", roleDefId: v.scopeRoleDefId! };
    default:
      throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", `Phạm vi ${v.scopeType} chưa dùng được.`);
  }
}

export async function taoPhienBanMoi(input: {
  policyId: string;
  /** `null` = giữ phạm vi của bản mới nhất. */
  phamVi: PhamViInput | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  documentId: string | null;
  /** `null` = chép rule từ bản mới nhất. */
  rules: readonly RuleInput[] | null;
  actor: NguoiThaoTac;
  now: Date;
}): Promise<{ versionId: string; versionNo: number }> {
  const policy = await db.commissionPolicy.findUnique({ where: { id: input.policyId }, select: { id: true, orgUnitId: true } });
  if (!policy) throw new HoaHongError("POLICY_KHONG_TON_TAI", `Chính sách ${input.policyId} không tồn tại.`);
  // Bản huỷ KHÔNG làm gốc: nó là bản soạn nhầm bị bỏ, mang phạm vi/rule người soạn đã từ chối.
  const goc = await db.commissionPolicyVersion.findFirst({ where: { policyId: policy.id, status: { not: "CANCELLED" } }, orderBy: { versionNo: "desc" } });
  if (!goc && (input.phamVi === null || input.rules === null)) {
    throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Chính sách chưa có version nào (không bị huỷ) để làm gốc — khai đủ phạm vi và rule.");
  }
  const sh = await docChuSoHuu(db, policy.orgUnitId);
  const phamVi = input.phamVi ?? phamViTuVersion(goc!);
  const rules = input.rules ?? (await docRuleInput(db, goc!.id));
  const d: DuLieuVersion = { ...input, phamVi, rules };
  const idVai = await kiemVersion(db, d);

  return db.$transaction(async (tx) => {
    // versionNo = max + 1 TRONG transaction; khoá duy nhất (policyId, versionNo) chặn hai người cùng tạo.
    const max = await tx.commissionPolicyVersion.aggregate({ where: { policyId: policy.id }, _max: { versionNo: true } });
    const versionNo = (max._max.versionNo ?? 0) + 1;
    const versionId = await taoVersionTrongTx(tx, { policyId: policy.id, versionNo, sh, d, idVai, actor: input.actor });
    return { versionId, versionNo };
  });
}

/** Cổng chung của mọi thao tác sửa: khoá do SỔ đánh dấu → "đã khoá"; không còn nháp → "không phải nháp". */
export function canNhap(v: { status: string; firstUsedAt: Date | null }): void {
  if (v.firstUsedAt !== null) throw new HoaHongError("VERSION_DA_KHOA", "Version đã sinh dòng sổ hoa hồng — chỉ tạo version mới, không sửa.");
  if (v.status !== "DRAFT") throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", `Version đang ${v.status} — chỉ sửa được bản nháp; muốn đổi hãy tạo version mới.`);
}

async function docVersion(client: Khach, versionId: string) {
  const v = await client.commissionPolicyVersion.findUnique({ where: { id: versionId }, include: { policy: true } });
  if (!v) throw new HoaHongError("VERSION_KHONG_TON_TAI", `Version ${versionId} không tồn tại.`);
  return v;
}

export async function suaNhap(
  input: DuLieuVersion & {
    versionId: string;
    actor: NguoiThaoTac;
    now: Date;
    /**
     * `updatedAt` của nháp mà người sửa ĐÃ THẤY. Có ⇒ nằm trong điều kiện của phép ghi đầu tiên: hai người cùng cầm một mốc thì chỉ một
     * người ghi được (người sau nhận `VERSION_DA_DOI`). Không truyền ⇒ không đối chiếu (đường nội bộ: seed, test dịch vụ) — đường có
     * người dùng đứng sau (`luuNhap` ở `chinh-sach-hanh-dong.ts`) LUÔN truyền; lưới `[NHH-FE-WCS-11]` ghim điều đó.
     */
    updatedAtDaThay?: Date;
  },
): Promise<void> {
  const v = await docVersion(db, input.versionId);
  canNhap(v);
  const sh = await docChuSoHuu(db, v.policy.orgUnitId);
  const idVai = await kiemVersion(db, input);

  await db.$transaction(async (tx) => {
    // Phép ghi ĐẦU TIÊN là cập nhật CÓ ĐIỀU KIỆN (còn nháp, chưa dùng): đua với kích hoạt/đánh dấu dùng ⇒ 0 dòng ⇒ throw.
    const upd = await tx.commissionPolicyVersion.updateMany({
      where: { id: v.id, status: "DRAFT", firstUsedAt: null, ...(input.updatedAtDaThay ? { updatedAt: input.updatedAtDaThay } : {}) },
      data: {
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        reason: input.reason.trim(),
        documentId: input.documentId,
        ...cotPhamVi(input.phamVi),
      },
    });
    if (upd.count === 0) {
      // 0 dòng có hai nguyên nhân khác nhau — đọc lại (chỉ đọc, chưa ghi gì) để nói đúng: hết là nháp, hay có người sửa xen giữa.
      const nay = await tx.commissionPolicyVersion.findUnique({ where: { id: v.id }, select: { status: true, firstUsedAt: true } });
      if (nay && nay.status === "DRAFT" && nay.firstUsedAt === null) {
        throw new HoaHongError("VERSION_DA_DOI", "Có người vừa sửa bản nháp này — tải lại để lấy bản mới nhất rồi sửa tiếp.");
      }
      throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", "Version vừa đổi trạng thái — tải lại rồi sửa.");
    }
    await tx.commissionRule.deleteMany({ where: { versionId: v.id } });
    if (input.rules.length > 0) await tx.commissionRule.createMany({ data: input.rules.map((r) => dongRule(v.id, r, idVai, sh)) });
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPolicyVersion",
      entityId: v.id,
      action: "UPDATE",
      newValues: { scopeKey: scopeKeyCua(input.phamVi), soRule: input.rules.length },
      reason: input.reason.trim(),
      orgUnitId: sh.orgUnitId,
      tx,
    });
  });
}

export async function huyNhap(input: { versionId: string; lyDo: string; actor: NguoiThaoTac; now: Date }): Promise<void> {
  const v = await docVersion(db, input.versionId);
  canNhap(v);
  if (!input.lyDo.trim()) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Phải có lý do huỷ nháp.");
  await db.$transaction(async (tx) => {
    const upd = await tx.commissionPolicyVersion.updateMany({ where: { id: v.id, status: "DRAFT", firstUsedAt: null }, data: { status: "CANCELLED" } });
    if (upd.count === 0) throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", "Version vừa đổi trạng thái.");
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPolicyVersion",
      entityId: v.id,
      action: "CANCEL",
      oldValues: { status: "DRAFT" },
      newValues: { status: "CANCELLED" },
      reason: input.lyDo.trim(),
      orgUnitId: v.policy.orgUnitId,
      tx,
    });
  });
}

// ── Nạp quy tắc / ngữ cảnh ──────────────────────────────────────────────────

type VersionDayDu = Prisma.CommissionPolicyVersionGetPayload<{
  include: { rules: { include: { beneficiaryRole: { select: { code: true } } } }; policy: { select: { policyCode: true } }; document: { select: { documentCode: true } } };
}>;

/** Rule của một version → `QuyTac` (thứ `chonQuyTac` ăn). `trangThai` cho phép ép "ACTIVE" khi đang kiểm kích hoạt. */
export function quyTacTuVersion(
  v: VersionDayDu,
  chu: { path: string; depth: number },
  scopeOrgUnitPath: string | null,
  trangThai: TrangThaiPhienBan,
): QuyTac[] {
  return v.rules.map((r) => ({
    ruleId: r.id,
    policyId: v.policyId,
    policyCode: v.policy.policyCode,
    versionId: v.id,
    version: v.versionNo,
    documentNumber: v.document?.documentCode ?? "(chưa gắn văn bản)",
    scopeType: v.scopeType,
    scopeKey: v.scopeKey,
    scope: {
      userId: v.scopeUserId ?? undefined,
      affiliateId: v.scopeAffiliateId ?? undefined,
      sourceGroupId: v.scopeSourceGroupId ?? undefined,
      orgUnitId: v.scopeOrgUnitId ?? undefined,
      orgUnitPath: scopeOrgUnitPath ?? undefined,
      roleDefId: v.scopeRoleDefId ?? undefined,
    },
    orgUnitId: v.orgUnitId,
    orgUnitPath: chu.path,
    orgUnitDepth: chu.depth,
    transactionType: r.transactionTypeCode as "NEW" | "RENEWAL",
    roleCode: r.beneficiaryRole.code,
    revenueComponent: r.revenueComponent,
    kieuTinh: r.calcKind,
    giaTri: r.calcKind === "PERCENT" ? r.rate!.toString() : r.calcKind === "FIXED_PER_PURCHASE" ? r.fixedAmount! : 0,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    trangThai,
  }));
}

const INCLUDE_VERSION = {
  rules: { include: { beneficiaryRole: { select: { code: true } } } },
  policy: { select: { policyCode: true } },
  document: { select: { documentCode: true } },
} as const;

async function duongDanDonVi(client: Khach, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const can = [...new Set(ids.filter((x): x is string => !!x))];
  if (can.length === 0) return new Map();
  const o = await client.orgUnit.findMany({ where: { id: { in: can } }, select: { id: true, path: true } });
  return new Map(o.flatMap((x) => (x.path ? [[x.id, x.path] as const] : [])));
}

function chuTuPath(orgUnitId: string | null, paths: ReadonlyMap<string, string>): { path: string; depth: number } {
  if (orgUnitId === null) return { path: "/", depth: -1 };
  const path = paths.get(orgUnitId);
  if (!path) throw new HoaHongError("DON_VI_KHONG_HOP_LE", `Đơn vị sở hữu ${orgUnitId} không còn path.`);
  return { path, depth: depthOfPath(path) };
}

async function anhXaVersion(client: Khach, versions: readonly VersionDayDu[], ep?: TrangThaiPhienBan): Promise<QuyTac[]> {
  const paths = await duongDanDonVi(client, versions.flatMap((v) => [v.orgUnitId, v.scopeOrgUnitId]));
  return versions.flatMap((v) =>
    quyTacTuVersion(v, chuTuPath(v.orgUnitId, paths), v.scopeOrgUnitId ? (paths.get(v.scopeOrgUnitId) ?? null) : null, ep ?? (v.status as TrangThaiPhienBan)),
  );
}

/** Mọi rule của version đã từng hiệu lực (ACTIVE / EXPIRED / SUPERSEDED) — nhìn lại được lịch sử theo `rateDate`. */
export async function docQuyTac(client: Khach): Promise<QuyTac[]> {
  const versions = await client.commissionPolicyVersion.findMany({
    where: { status: { in: ["ACTIVE", "EXPIRED", "SUPERSEDED"] } },
    include: INCLUDE_VERSION,
    orderBy: [{ policyId: "asc" }, { versionNo: "asc" }],
  });
  return anhXaVersion(client, versions);
}

/**
 * CHỈ ĐỌC: quy tắc của MỘT version dưới dạng `QuyTac` (trạng thái ép "ACTIVE") — đầu vào "bản đề xuất" của thử tính (`mo-phong-db.ts`).
 * Không kiểm quyền / cách ly cơ sở: người gọi tra version qua `scopedDb` TRƯỚC khi đưa id vào đây.
 */
export async function docQuyTacCuaVersion(client: Khach, versionId: string): Promise<QuyTac[]> {
  const v = await client.commissionPolicyVersion.findUnique({ where: { id: versionId }, include: INCLUDE_VERSION });
  if (!v) throw new HoaHongError("VERSION_KHONG_TON_TAI", `Version ${versionId} không tồn tại.`);
  return anhXaVersion(client, [v], "ACTIVE");
}

/**
 * Dựng `HoaHongContext` cho một lượt tính. ĐỌC trần từ cấu hình ở đây (`getSetting`) rồi TRUYỀN xuống hàm
 * tính — hàm tính không có mặc định (luật 7, `[NHH-W3]`).
 *
 * ⚠️ `thuTuPhamVi` lấy GIÁ TRỊ KHỞI ĐẦU (04 §6.2) — chưa có khoá cấu hình `hoaHong.thuTuPhamVi` (PR8 làm cùng người gọi đầu
 * tiên). `vatTheoNgay` đọc từ `hoaHong.vatTheoNgay` (PR5a, D15; rỗng = 0). Chỗ nạp duy nhất: đổi nguồn ở đây, không ở chỗ gọi.
 */
export async function docTranHoaHong(): Promise<number> {
  return getSetting("crm.commissionMaxTotalRate");
}

export async function docHoaHongContext(client: Khach): Promise<HoaHongContext> {
  const [quyTac, nhom, vai, tran, vat] = await Promise.all([
    docQuyTac(client),
    client.leadSourceGroup.findMany({ where: { status: "ACTIVE", code: { not: "UNKNOWN" } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, code: true, commissionEnabled: true } }),
    client.beneficiaryRole.findMany({ orderBy: { sortOrder: "asc" } }),
    getSetting("crm.commissionMaxTotalRate"),
    getSetting("hoaHong.vatTheoNgay"),
  ]);
  return {
    quyTac,
    nhomNguon: nhom.map((n) => ({ id: n.id, code: n.code, coHoaHong: n.commissionEnabled })),
    vaiHuong: vai.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: v.isActive })),
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    phienBanThuTu: "v1",
    tranTongTiLe: tran,
    vatTheoNgay: vat,
  };
}

// ── Kích hoạt ───────────────────────────────────────────────────────────────

/**
 * Cơ sở VẬN HÀNH nằm trong phạm vi: `OrgUnit` loại CENTER (còn sống) dưới `pathPhamVi`; path "/" = mọi cơ sở. Đi theo CÂY
 * ĐƠN VỊ chứ không theo bảng `Center`: Center "hoi-so" là bản ghi MỒ CÔI (CLAUDE.md), không phải nơi có học viên — đòi
 * người phụ trách QC/QL_TT ở đó là chặn kích hoạt vì một dòng không có thật.
 */
export async function coSoTrongPhamVi(client: Khach, pathPhamVi: string): Promise<string[]> {
  const o = await client.orgUnit.findMany({
    where: { type: "CENTER", centerId: { not: null }, deletedAt: null, ...(pathPhamVi === "/" ? {} : { path: { startsWith: pathPhamVi } }) },
    select: { centerId: true },
  });
  return o.map((x) => x.centerId!);
}

export async function docNghi(client: Khach, congBo: Date): Promise<NgayNghiLe[]> {
  const cuoi = new Date(congBo.getTime() + 400 * 86_400_000);
  const rows = await client.holiday.findMany({
    where: {
      type: "HOLIDAY",
      date: { lte: cuoi },
      OR: [{ endDate: { gte: congBo } }, { endDate: null, date: { gte: congBo } }],
    },
    select: { date: true, endDate: true, type: true, centerId: true },
  });
  return rows.map((h) => ({ tuNgay: ngayCuaCotDate(h.date), denNgay: ngayCuaCotDate(h.endDate ?? h.date), loai: h.type, centerId: h.centerId }));
}

async function dauVaoKichHoat(
  client: Khach,
  v: VersionDayDu & { policy: { policyCode: string; orgUnitId: string | null } },
  now: Date,
  /** Giả định cờ `commissionEnabled` của một số nguồn (id → giá trị SAU khi ghi) — để kiểm TRƯỚC khi bật cờ thật. Vắng ⇒ đọc DB như thường. */
  ghiDeCoHoaHong?: ReadonlyMap<string, boolean>,
): Promise<{ dau: DauVaoKichHoat; vanTay: string; vanTayNhom: string }> {
  const sh = await docChuSoHuu(client, v.policy.orgUnitId);
  const paths = await duongDanDonVi(client, [v.scopeOrgUnitId]);
  const scopePath = v.scopeOrgUnitId ? (paths.get(v.scopeOrgUnitId) ?? null) : null;

  const khac = await client.commissionPolicyVersion.findMany({ where: { status: "ACTIVE", id: { not: v.id } }, include: INCLUDE_VERSION });
  const quyTacDangHieuLuc = await anhXaVersion(client, khac, "ACTIVE");
  const quyTacDeXuat = await anhXaVersion(client, [v], "ACTIVE");

  const [vai, loai, nhom, tran, vanBan] = await Promise.all([
    client.beneficiaryRole.findMany(),
    client.commissionTransactionType.findMany({ select: { code: true, isActive: true, hasClassifier: true } }),
    client.leadSourceGroup.findMany({ where: { code: { not: "UNKNOWN" } }, select: SELECT_NHOM_GUARDRAIL }),
    getSetting("crm.commissionMaxTotalRate"),
    v.documentId ? client.regulationDocument.findUnique({ where: { id: v.documentId } }) : Promise.resolve(null),
  ]);
  const vaiHuong = new Map(vai.map((x) => [x.code, { isActive: x.isActive, resolverType: x.resolverType, resolverKey: x.resolverKey }]));

  const pathCoSo = scopePath ?? sh.path;
  const coSo = new Set(await coSoTrongPhamVi(client, pathCoSo));
  const nghi = vanBan ? await docNghi(client, vanBan.publishedOn) : [];

  // Vai ORG_UNIT_ROLE × cơ sở trong phạm vi mà chưa ai phụ trách tại ngày hiệu lực.
  const thieu: { roleCode: string; centerId: string }[] = [];
  const vaiCanNguoi = [...new Set(v.rules.map((r) => r.beneficiaryRole.code))]
    .map((code) => vai.find((x) => x.code === code))
    .filter((x): x is NonNullable<typeof x> => !!x && x.resolverType === "ORG_UNIT_ROLE" && x.resolverKey !== null);
  if (vaiCanNguoi.length > 0 && coSo.size > 0) {
    const rows = await client.centerCommissionAssignee.findMany({ where: { centerId: { in: [...coSo] } } });
    const pc: PhanCongCoSo[] = rows.map((r) => ({ centerId: r.centerId, role: r.role, userId: r.userId, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
    for (const x of vaiCanNguoi) {
      const role = (KHOA_PHAN_CONG_CO_SO as Record<string, "QC" | "QL_TT" | undefined>)[x.resolverKey!];
      if (!role) continue;
      for (const centerId of [...coSo].sort()) {
        if (nguoiHuongHieuLuc(pc, centerId, role, v.effectiveFrom).length === 0) thieu.push({ roleCode: x.code, centerId });
      }
    }
  }

  const dau: DauVaoKichHoat = {
    phienBan: {
      id: v.id,
      policyId: v.policyId,
      scopeType: v.scopeType,
      scopeKey: v.scopeKey,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      orgUnitId: v.orgUnitId,
      orgUnitPath: sh.path,
    },
    vanBan: vanBan
      ? {
          documentCode: vanBan.documentCode,
          title: vanBan.title,
          issuedOn: ngayCuaCotDate(vanBan.issuedOn),
          publishedOn: ngayCuaCotDate(vanBan.publishedOn),
          effectiveOn: ngayCuaCotDate(vanBan.effectiveOn),
          approvedByName: vanBan.approvedByName,
          coTep: !!(vanBan.fileKey || vanBan.fileUrl),
          daThuHoi: vanBan.revokedAt !== null,
        }
      : null,
    quyTacDeXuat,
    quyTacDangHieuLuc,
    phienBanKhac: khac.map((k) => ({
      id: k.id,
      policyId: k.policyId,
      scopeKey: k.scopeKey,
      orgUnitId: k.orgUnitId,
      effectiveFrom: k.effectiveFrom,
      effectiveTo: k.effectiveTo,
      daDung: k.firstUsedAt !== null,
    })),
    loaiGiaoDich: loai,
    vaiHuong,
    coSoThieuNguoiPhuTrach: thieu,
    nhomNguon: nhom.map((n) => ({
      id: n.id,
      code: n.code,
      dangHoatDong: n.status === "ACTIVE",
      coHoaHong: ghiDeCoHoaHong?.get(n.id) ?? n.commissionEnabled,
      ownerEmployeeId: n.ownerEmployeeId,
      referrerRequirement: n.referrerRequirement,
    })),
    nghi,
    coSoTrongPhamVi: coSo,
    soNgayLamViec: SO_NGAY_LAM_VIEC_SAU_CONG_BO,
    tranTongTiLe: tran,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    now,
  };
  return { dau, vanTay: vanTayTapActive(khac), vanTayNhom: vanTayNhomNguon(nhom) };
}

/**
 * CHỈ ĐỌC: chạy guardrail kích hoạt trên một NHÁP, KHÔNG ghi gì — để màn soạn vẽ thanh hàng rào. Cùng `dauVaoKichHoat` +
 * `kiemKichHoat` với `kichHoat` nên hai bên không thể lệch nhau; cổng thật vẫn chạy lại lúc kích hoạt. `somNhat` = ngày hiệu
 * lực sớm nhất hợp lệ theo văn bản đã gắn ("YYYY-MM-DD"), `null` khi chưa gắn văn bản.
 * ⚠️ Không kiểm quyền / cách ly cơ sở — người gọi (Server Action) tự gác trước khi đưa `versionId` vào đây.
 */
export async function kiemTruocKichHoat(input: {
  versionId: string;
  now: Date;
}): Promise<{ loi: VanDeKichHoat[]; canhBao: VanDeKichHoat[]; somNhat: string | null }> {
  const v = await db.commissionPolicyVersion.findUnique({ where: { id: input.versionId }, include: { ...INCLUDE_VERSION, policy: { select: { policyCode: true, orgUnitId: true } } } });
  if (!v) throw new HoaHongError("VERSION_KHONG_TON_TAI", `Version ${input.versionId} không tồn tại.`);
  canNhap(v);
  const { dau } = await dauVaoKichHoat(db, v, input.now);
  const kq = kiemKichHoat(dau);
  const somNhat = dau.vanBan ? ngayHieuLucSomNhat(dau.vanBan.publishedOn, dau.soNgayLamViec, dau.nghi, dau.coSoTrongPhamVi) : null;
  // (gán biến rồi trả: lưới [NHH-W10] quét hình `return { loi:` ở MỌI tệp có `$transaction`, mà hàm này chỉ đọc)
  const ketQua = { loi: kq.loi, canhBao: kq.canhBao, somNhat };
  return ketQua;
}

/**
 * Mã guardrail mà việc BẬT LẠI `commissionEnabled` của một nguồn phải chặn (res3 MEDIUM-4, 09/10/2026): các chính sách phạm vi nguồn ĐANG `ACTIVE` mà bị bỏ qua
 * vì cờ tắt sẽ chạy lại ngay khi cờ bật — tức đúng lúc "kích hoạt" thật sự có hiệu lực, mà lúc kích hoạt thật chúng không bị kiểm trần (rule bị bỏ qua). Chỉ ba mã
 * này: hiệu lực/văn bản (`HIEU_LUC_SOM`, `VAN_BAN_*`) là chuyện của lúc kích hoạt và có thể đã đổi vì lý do chẳng liên quan tới việc bật cờ — chặn theo chúng là
 * khoá oan một thao tác hợp lệ.
 */
export const MA_CHAN_KHI_BAT_HOA_HONG_NGUON: readonly string[] = ["VUOT_TRAN", "CHONG_LAN_RULE", "LUOI_QUA_LON"];

/** Dấu vân tay của TẬP version ACTIVE hiện tại — so trước/sau khi lấy khoá để biết kết quả kiểm có còn đúng. */
export async function vanTayTapChinhSachActive(client: Khach): Promise<string> {
  return vanTayTapActive(await client.commissionPolicyVersion.findMany({ where: { status: "ACTIVE" }, select: { id: true, effectiveFrom: true, effectiveTo: true, status: true, firstUsedAt: true } }));
}

/**
 * CHỈ ĐỌC: chạy lại guardrail (CÙNG `dauVaoKichHoat` + `kiemKichHoat` với lúc kích hoạt) trên mọi chính sách phạm vi MỘT nguồn đang ACTIVE, GIẢ ĐỊNH nguồn ấy đã
 * `commissionEnabled = true`; trả các lỗi trong `MA_CHAN_KHI_BAT_HOA_HONG_NGUON`. Không có chính sách riêng nào ⇒ rỗng. Dấu vân tay tập ACTIVE (`vanTay`) đọc TRƯỚC khi
 * kiểm để người gọi lấy khoá advisory rồi so lại — lệch ⇒ kết quả đã cũ.
 */
export async function kiemChinhSachKhiBatHoaHongNguon(client: Khach, p: { groupId: string; now: Date }): Promise<{ loi: VanDeKichHoat[]; vanTay: string }> {
  const vanTay = await vanTayTapChinhSachActive(client);
  const versions = await client.commissionPolicyVersion.findMany({
    where: { status: "ACTIVE", scopeSourceGroupId: p.groupId },
    include: { ...INCLUDE_VERSION, policy: { select: { policyCode: true, orgUnitId: true } } },
    orderBy: { id: "asc" },
  });
  const loi: VanDeKichHoat[] = [];
  const giaDinh = new Map<string, boolean>([[p.groupId, true]]);
  for (const v of versions) {
    const { dau } = await dauVaoKichHoat(client, v, p.now, giaDinh);
    for (const l of kiemKichHoat(dau).loi) {
      if (MA_CHAN_KHI_BAT_HOA_HONG_NGUON.includes(l.ma)) loi.push({ ma: l.ma, thongBao: `Chính sách ${v.policy.policyCode} (bản ${v.versionNo}): ${l.thongBao}` });
    }
  }
  return { loi, vanTay };
}

/**
 * CHỈ ĐỌC: nếu HẠ trần xuống `tranMoi` thì chính sách ĐANG CHẠY nào vượt (W2, res1 R1-M4)? Chạy CHÍNH `dauVaoKichHoat` + `kiemKichHoat` (cùng lưới trần với lúc kích hoạt, không tự đo lại) trên từng
 * phiên bản ACTIVE chưa hết hiệu lực, thay `tranTongTiLe`, giữ riêng lỗi `VUOT_TRAN` + tổng lớn nhất của nó. Bản đã hết hiệu lực không còn sinh tiền nên không tính. `LUOI_QUA_LON` (lưới vượt trần số ngữ cảnh)
 * là phép đo KHÔNG làm được — bỏ qua, không chặn oan; lúc kích hoạt chính sách ấy guardrail đã dừng vì lý do đó.
 */
export async function kiemTranMoiVoiChinhSachActive(client: Khach, p: { tranMoi: number; now: Date }): Promise<ChinhSachVuotTranMoi[]> {
  const versions = await client.commissionPolicyVersion.findMany({
    where: { status: "ACTIVE", OR: [{ effectiveTo: null }, { effectiveTo: { gt: p.now } }] },
    include: { ...INCLUDE_VERSION, policy: { select: { policyCode: true, orgUnitId: true } } },
    orderBy: { id: "asc" },
  });
  const vuot: ChinhSachVuotTranMoi[] = [];
  for (const v of versions) {
    const { dau } = await dauVaoKichHoat(client, v, p.now);
    const l = kiemKichHoat({ ...dau, tranTongTiLe: p.tranMoi }).loi.find((x) => x.ma === "VUOT_TRAN");
    if (l?.tongToiDa !== undefined) vuot.push({ policyCode: v.policy.policyCode, versionNo: v.versionNo, tongToiDa: l.tongToiDa });
  }
  return vuot;
}

/**
 * Kích hoạt một NHÁP: chạy guardrail; lỗi ⇒ `HoaHongError("KICH_HOAT_BI_CHAN", …, chiTiet = lỗi[])`; có cảnh báo mà
 * chưa xác nhận (lý do ≥ 10 ký tự) ⇒ cũng chặn, mã `CAN_XAC_NHAN_CANH_BAO`.
 *
 * Guardrail đọc NGOÀI transaction (nó nặng: lưới ngữ cảnh), nên cổng ghi phải chứng minh những gì nó đã kiểm VẪN ĐÚNG:
 *   1. khoá advisory `KHOA_ADVISORY_CHINH_SACH` — tuần tự hoá mọi thao tác đổi tập version ACTIVE;
 *   2. khoá hàng version (`FOR UPDATE`) — `suaNhap`/`huyNhap` mở đầu bằng cập nhật hàng này nên phải chờ ta xong, rồi thấy 0 dòng;
 *   3. so lại `updatedAt` của nháp (đã bị sửa ⇒ `VERSION_DA_DOI`) và dấu vân tay tập ACTIVE (đã đổi ⇒ `TAP_HIEU_LUC_DA_DOI`).
 * Cả ba là CỔNG (throw, trước phép ghi đầu tiên). Phép ghi đầu tiên vẫn là cập nhật CÓ ĐIỀU KIỆN (còn nháp) ⇒ hai người kích hoạt
 * cùng một nháp thì một người nhận `VERSION_KHONG_PHAI_NHAP`. Bản trước của cùng (policy, phạm vi) bị ĐÓNG tại `effectiveFrom`
 * và thành `SUPERSEDED`.
 */
export async function kichHoat(input: {
  versionId: string;
  actor: NguoiThaoTac;
  now: Date;
  /** `null` = chưa xác nhận cảnh báo nào. */
  xacNhanCanhBao: { lyDo: string } | null;
  /**
   * `updatedAt` của nháp mà người duyệt ĐÃ THẤY (lúc xem hàng rào / hộp xác nhận). Có ⇒ lệch là `VERSION_DA_DOI` — nếu không, người duyệt
   * xác nhận bản 4% mà máy chủ kích hoạt bản 8% do người khác vừa sửa. Không truyền ⇒ không đối chiếu (seed, test dịch vụ); đường có
   * người dùng (`kichHoatPhienBan`) LUÔN truyền — lưới `[NHH-FE-WCS-11]`.
   */
  updatedAtDaThay?: Date;
}): Promise<{ canhBao: VanDeKichHoat[] }> {
  const v = await db.commissionPolicyVersion.findUnique({ where: { id: input.versionId }, include: { ...INCLUDE_VERSION, policy: { select: { policyCode: true, orgUnitId: true } } } });
  if (!v) throw new HoaHongError("VERSION_KHONG_TON_TAI", `Version ${input.versionId} không tồn tại.`);
  canNhap(v);
  if (input.updatedAtDaThay && v.updatedAt.getTime() !== input.updatedAtDaThay.getTime()) {
    throw new HoaHongError("VERSION_DA_DOI", "Nháp vừa được sửa sau khi bạn xem — tải lại để duyệt đúng nội dung hiện tại.");
  }

  const { dau, vanTay, vanTayNhom } = await dauVaoKichHoat(db, v, input.now);
  const kq = kiemKichHoat(dau);
  if (kq.loi.length > 0) throw new HoaHongError("KICH_HOAT_BI_CHAN", `Không kích hoạt được: ${kq.loi.map((l) => l.ma).join(", ")}`, kq.loi);
  const xacNhan = input.xacNhanCanhBao?.lyDo.trim() ?? "";
  if (kq.canhBao.length > 0 && xacNhan.length < LY_DO_XAC_NHAN_TOI_THIEU) {
    throw new HoaHongError("KICH_HOAT_BI_CHAN", "Có cảnh báo cần xác nhận kèm lý do.", [
      { ma: "CAN_XAC_NHAN_CANH_BAO", thongBao: kq.canhBao.map((c) => c.thongBao).join(" | ") },
    ]);
  }

  await db.$transaction(async (tx) => {
    await khoaChinhSach(tx);
    await tx.$queryRaw`SELECT "id" FROM "CommissionPolicyVersion" WHERE "id" = ${v.id} FOR UPDATE`;
    const hienTai = await tx.commissionPolicyVersion.findUnique({ where: { id: v.id }, select: { status: true, firstUsedAt: true, updatedAt: true } });
    if (!hienTai || hienTai.status !== "DRAFT" || hienTai.firstUsedAt !== null) {
      throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", "Version vừa đổi trạng thái — tải lại.");
    }
    if (hienTai.updatedAt.getTime() !== v.updatedAt.getTime()) {
      throw new HoaHongError("VERSION_DA_DOI", "Nháp vừa được sửa sau khi kiểm — tải lại rồi kích hoạt lại để kiểm trên bản mới.");
    }
    const dangActive = await tx.commissionPolicyVersion.findMany({
      where: { status: "ACTIVE", id: { not: v.id } },
      select: { id: true, effectiveFrom: true, effectiveTo: true, status: true, firstUsedAt: true },
    });
    if (vanTayTapActive(dangActive) !== vanTay) {
      throw new HoaHongError("TAP_HIEU_LUC_DA_DOI", "Có người vừa kích hoạt hoặc kết thúc một version khác — kết quả kiểm trần/chồng lấn đã cũ; kích hoạt lại để kiểm trên tập mới.");
    }
    // Cùng khoá advisory mà `taoNguon` / `suaNguon` / `doiTrangThaiNguon` / `luuNguonCuaPage` giữ: nhóm nguồn không thể đổi giữa chừng khi ta đang giữ khoá, nhưng có thể đã đổi TRƯỚC khi ta lấy được nó
    // (guardrail đọc nhóm ngoài transaction). So lại — lệch ⇒ kết quả kiểm «mọi nguồn đang hoạt động đều có chủ…» đã cũ.
    if (vanTayNhomNguon(await tx.leadSourceGroup.findMany({ where: { code: { not: "UNKNOWN" } }, select: SELECT_NHOM_GUARDRAIL })) !== vanTayNhom) {
      throw new HoaHongError("NGUON_DA_DOI", "Có người vừa tạo hoặc đổi một nguồn (trạng thái · người phụ trách · hoa hồng) — kết quả kiểm đã cũ; kích hoạt lại để kiểm trên danh mục nguồn mới.");
    }

    const upd = await tx.commissionPolicyVersion.updateMany({
      where: { id: v.id, status: "DRAFT", firstUsedAt: null },
      data: { status: "ACTIVE", activatedAt: input.now, activatedById: input.actor.userId },
    });
    if (upd.count === 0) throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", "Version vừa đổi trạng thái — tải lại.");

    // Đóng bản trước của cùng (policy, phạm vi) tại effectiveFrom — chỉ bản bắt đầu TRƯỚC bản này.
    const truoc = await tx.commissionPolicyVersion.findMany({
      where: { policyId: v.policyId, scopeKey: v.scopeKey, status: "ACTIVE", id: { not: v.id }, effectiveFrom: { lt: v.effectiveFrom } },
      select: { id: true, effectiveTo: true },
    });
    for (const t of truoc) {
      if (t.effectiveTo === null || t.effectiveTo.getTime() > v.effectiveFrom.getTime()) {
        await tx.commissionPolicyVersion.updateMany({ where: { id: t.id, status: "ACTIVE" }, data: { effectiveTo: v.effectiveFrom, status: "SUPERSEDED" } });
      }
    }

    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPolicyVersion",
      entityId: v.id,
      action: "ACTIVATE",
      oldValues: { status: "DRAFT" },
      newValues: { status: "ACTIVE", effectiveFrom: v.effectiveFrom.toISOString(), canhBao: kq.canhBao.map((c) => c.ma), dongBanTruoc: truoc.map((t) => t.id) },
      reason: xacNhan.length > 0 ? xacNhan : v.reason,
      orgUnitId: v.policy.orgUnitId,
      tx,
    });
  });
  return { canhBao: kq.canhBao };
}

/**
 * Cho một version ACTIVE hết hiệu lực tại `effectiveTo` (biên MỞ). Đã qua `now` ⇒ `EXPIRED`.
 *
 * CHỈ RÚT NGẮN: kéo `effectiveTo` dài ra có thể chồng lên version kế tiếp mà không qua guardrail chồng lấn — muốn dài hơn thì
 * tạo version mới. Bản ĐÃ DÙNG (`firstUsedAt`) không được hết hiệu lực tại mốc đã qua: giao dịch đã tính có `rateDate` ≥ mốc sẽ mất rule.
 * Đọc trạng thái TRONG transaction sau khi lấy khoá advisory (cùng khoá với `kichHoat`).
 */
export async function choHetHieuLuc(input: { versionId: string; effectiveTo: Date; lyDo: string; actor: NguoiThaoTac; now: Date }): Promise<void> {
  await db.$transaction(async (tx) => {
    await khoaChinhSach(tx);
    const v = await docVersion(tx, input.versionId);
    if (v.status !== "ACTIVE") throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", `Chỉ cho hết hiệu lực bản ACTIVE (đang ${v.status}).`);
    if (!input.lyDo.trim()) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Phải có lý do cho hết hiệu lực.");
    if (input.effectiveTo.getTime() <= v.effectiveFrom.getTime()) {
      throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Hiệu lực kết thúc phải sau hiệu lực bắt đầu.");
    }
    if (v.effectiveTo !== null && input.effectiveTo.getTime() > v.effectiveTo.getTime()) {
      throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Chỉ được rút ngắn hiệu lực; muốn kéo dài hãy tạo version mới.");
    }
    if (v.firstUsedAt !== null && input.effectiveTo.getTime() < input.now.getTime()) {
      throw new HoaHongError("VERSION_DA_KHOA", "Version đã sinh dòng sổ hoa hồng — không cho hết hiệu lực tại mốc đã qua (đổi rule thắng của giao dịch đã tính); đặt mốc từ bây giờ trở đi hoặc tạo version mới.");
    }
    const moi: "ACTIVE" | "EXPIRED" = input.effectiveTo.getTime() <= input.now.getTime() ? "EXPIRED" : "ACTIVE";
    const upd = await tx.commissionPolicyVersion.updateMany({ where: { id: v.id, status: "ACTIVE" }, data: { effectiveTo: input.effectiveTo, status: moi } });
    if (upd.count === 0) throw new HoaHongError("VERSION_KHONG_PHAI_NHAP", "Version vừa đổi trạng thái.");
    await writeAudit({
      actor: actorAudit(input.actor),
      module: MODULE_AUDIT,
      entityType: "CommissionPolicyVersion",
      entityId: v.id,
      action: "END",
      oldValues: { effectiveTo: v.effectiveTo?.toISOString() ?? null, status: v.status },
      newValues: { effectiveTo: input.effectiveTo.toISOString(), status: moi },
      reason: input.lyDo.trim(),
      orgUnitId: v.policy.orgUnitId,
      tx,
    });
  });
}

/**
 * SỔ (PR5) gọi khi ghi dòng ĐẦU TIÊN dùng version: đánh dấu `firstUsedAt` MỘT LẦN (idempotent) — từ đó version
 * + rule bị khoá. `tx` BẮT BUỘC: phải cùng transaction với dòng sổ, để không có dòng sổ nào trỏ vào version
 * chưa bị khoá (hay ngược lại).
 */
export async function danhDauDaDung(tx: Tx, versionId: string, at: Date): Promise<void> {
  await tx.commissionPolicyVersion.updateMany({ where: { id: versionId, firstUsedAt: null }, data: { firstUsedAt: at } });
}
