// lib/hoa-hong/chinh-sach-doc.ts — ĐỌC dữ liệu cho tab Chính sách (06 §5.2): hàng chờ, bảng, chi tiết, ma trận, dữ liệu soạn.
// CHỈ ĐỌC. Đường ghi là `chinh-sach-service.ts` (gác ở Server Action).
//
// ⚠️ Cách ly cơ sở: MỌI truy vấn chính sách/văn bản đi qua `scopedDb(actor)` (bốn model đã vào `SCOPED_MODELS` +
// `NULL_IS_GLOBAL_MODELS` + prefix `commission_policies:`): chính sách của Hội sở (centerId NULL) hiện ra ở mọi cơ sở, chính
// sách của CS1 không hiện ra ở CS2. Bảng master (BeneficiaryRole, LeadSourceGroup, OrgUnit) là danh mục chung.
// ⚠️ Mọi hàm nhận `now` BẮT BUỘC (luật 19) — không đọc đồng hồ.
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { depthOfPath } from "@/lib/org/path";

import type { QuyTac, TrangThaiPhienBan } from "./chon-quy-tac";
import { coSoTrongPhamVi, docNghi, docTranHoaHong, quyTacTuVersion } from "./chinh-sach-service";
import type { PhienBanChoForm } from "./chinh-sach-form";
import { chonPhienBanHienHanh, tomTatTiLe, type TomTatTiLe } from "./chinh-sach-tom-tat";
import type { TamNhinChinhSach } from "./chinh-sach-quyen";
import { phanLoaiHangChoChinhSach, type PhienBanHangCho, type ViecHangCho } from "./hang-cho-chinh-sach";
import { maLoaiDangBat } from "./loai-giao-dich";
import { khoaTrangThaiNguon, type NguonSoan } from "./nguon-cho-soan";
import { ngayCuaCotDate, SO_NGAY_LAM_VIEC_SAU_CONG_BO } from "./ngay-lam-viec";
import { trangThaiPhienBanHienThi } from "./trang-thai-phien-ban";

/** Tầm nhìn của người xem trên chính sách: "ALL" (Hội sở/quản trị) hoặc danh sách `centerId`. */
export function tamNhinChinhSach(actor: Actor): TamNhinChinhSach {
  return getModelVisibleCenterIds("CommissionPolicy", actor);
}

const INCLUDE_RULE_VAI = { rules: { include: { beneficiaryRole: { select: { code: true } } } }, policy: { select: { policyCode: true } }, document: { select: { documentCode: true } } } as const;

// ── Hàng chờ ────────────────────────────────────────────────────────────────

export async function docHangChoChinhSach(actor: Actor, now: Date): Promise<ViecHangCho[]> {
  const sdb = scopedDb(actor);
  const [versions, vai, orgUnits] = await Promise.all([
    sdb.commissionPolicyVersion.findMany({
      where: { status: { in: ["DRAFT", "ACTIVE"] } },
      select: {
        id: true,
        policyId: true,
        versionNo: true,
        status: true,
        effectiveFrom: true,
        scopeOrgUnitId: true,
        orgUnitId: true,
        policy: { select: { policyCode: true, name: true } },
        document: { select: { documentCode: true, publishedOn: true, fileKey: true, fileUrl: true, revokedAt: true } },
        rules: { select: { beneficiaryRole: { select: { code: true } } } },
      },
    }),
    sdb.beneficiaryRole.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, isActive: true } }),
    sdb.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, path: true } }),
  ]);

  const pathCua = new Map(orgUnits.flatMap((o) => (o.path ? [[o.id, o.path] as const] : [])));
  const pathPhamVi = (v: { scopeOrgUnitId: string | null; orgUnitId: string | null }): string =>
    (v.scopeOrgUnitId ? pathCua.get(v.scopeOrgUnitId) : undefined) ?? (v.orgUnitId ? pathCua.get(v.orgUnitId) : undefined) ?? "/";

  // Mỗi đường dẫn phạm vi hỏi MỘT lần (số đường dẫn khác nhau rất ít: "/" và vài cơ sở).
  const cacPath = [...new Set(versions.map(pathPhamVi))];
  const coSoTheoPath = new Map(await Promise.all(cacPath.map(async (p) => [p, await coSoTrongPhamVi(db, p)] as const)));

  const congBoSom = versions.flatMap((v) => (v.document ? [v.document.publishedOn.getTime()] : []));
  const nghi = congBoSom.length > 0 ? await docNghi(db, new Date(Math.min(...congBoSom))) : [];

  const phienBan: PhienBanHangCho[] = versions.map((v) => ({
    versionId: v.id,
    policyId: v.policyId,
    policyCode: v.policy.policyCode,
    tenChinhSach: v.policy.name,
    versionNo: v.versionNo,
    status: v.status as "DRAFT" | "ACTIVE",
    effectiveFrom: v.effectiveFrom,
    vanBan: v.document
      ? { documentCode: v.document.documentCode, publishedOn: ngayCuaCotDate(v.document.publishedOn), coTep: !!(v.document.fileKey || v.document.fileUrl), daThuHoi: v.document.revokedAt !== null }
      : null,
    coSoTrongPhamVi: new Set(coSoTheoPath.get(pathPhamVi(v)) ?? []),
    codeVaiCoRule: [...new Set(v.rules.map((r) => r.beneficiaryRole.code))],
  }));

  return phanLoaiHangChoChinhSach({ phienBan, vai, nghi, now, soNgayLamViec: SO_NGAY_LAM_VIEC_SAU_CONG_BO });
}

export async function demHangChoChinhSach(actor: Actor, now: Date): Promise<number> {
  return (await docHangChoChinhSach(actor, now)).length;
}

// ── Nhãn phạm vi / chủ sở hữu ───────────────────────────────────────────────

type ScopeCot = {
  scopeType: string;
  scopeSourceGroupId: string | null;
  scopeOrgUnitId: string | null;
  scopeUserId: string | null;
  scopeAffiliateId: string | null;
  scopeRoleDefId: string | null;
};

type TraCuuNhan = { nhom: ReadonlyMap<string, string>; donVi: ReadonlyMap<string, string> };

/** `nhan` ngắn cho ô bảng (tên nhóm/cơ sở trần); `nhanDai` đủ nghĩa cho trang chi tiết ("Nhóm nguồn: …"). */
export function nhanPhamVi(v: ScopeCot, tra: TraCuuNhan): { loai: string; nhan: string; nhanDai: string } {
  const g = tra.nhom.get(v.scopeSourceGroupId ?? "") ?? "?";
  const d = tra.donVi.get(v.scopeOrgUnitId ?? "") ?? "?";
  switch (v.scopeType) {
    case "GLOBAL":
      return { loai: "GLOBAL", nhan: "Toàn hệ thống", nhanDai: "Toàn hệ thống (mọi giao dịch thuộc đơn vị sở hữu)" };
    case "SOURCE_GROUP":
      return { loai: "SOURCE_GROUP", nhan: g, nhanDai: `Nhóm nguồn: ${g}` };
    case "ORG_UNIT":
      return { loai: "ORG_UNIT", nhan: d, nhanDai: `Cơ sở / đơn vị: ${d}` };
    case "PERSON":
      return { loai: "PERSON", nhan: "Một người", nhanDai: "Riêng một người" };
    case "AFFILIATE":
      return { loai: "AFFILIATE", nhan: "Một đối tác", nhanDai: "Riêng một đối tác" };
    case "ROLE":
      return { loai: "ROLE", nhan: "Theo vai hệ thống", nhanDai: "Theo vai hệ thống của người hưởng" };
    default:
      return { loai: v.scopeType, nhan: v.scopeType, nhanDai: v.scopeType };
  }
}

async function docTraCuuNhan(actor: Actor): Promise<TraCuuNhan & { vai: ReadonlyMap<string, string> }> {
  const sdb = scopedDb(actor);
  const [nhom, donVi, vai] = await Promise.all([
    sdb.leadSourceGroup.findMany({ select: { id: true, name: true } }),
    sdb.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    sdb.beneficiaryRole.findMany({ select: { code: true, name: true } }),
  ]);
  return { nhom: new Map(nhom.map((n) => [n.id, n.name])), donVi: new Map(donVi.map((o) => [o.id, o.name])), vai: new Map(vai.map((v) => [v.code, v.name])) };
}

// ── Bảng chính sách ─────────────────────────────────────────────────────────

export type DongChinhSach = {
  policyId: string;
  policyCode: string;
  name: string;
  chuSoHuu: string;
  /** `null` = Hội sở (áp mọi cơ sở). */
  chuSoHuuCenterId: string | null;
  versionId: string;
  versionNo: number;
  status: TrangThaiPhienBan;
  khoa: string;
  nhanTrangThai: string;
  tone: "success" | "warning" | "danger" | "info" | "muted";
  phamVi: { loai: string; nhan: string; nhanDai: string };
  vai: { code: string; name: string }[];
  loaiGd: string[];
  tiLe: TomTatTiLe[];
  vanBan: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  coBanNhap: { versionId: string; versionNo: number } | null;
  soPhienBan: number;
};

export async function docBangChinhSach(actor: Actor, now: Date): Promise<DongChinhSach[]> {
  const sdb = scopedDb(actor);
  const [policies, tra, orgUnits] = await Promise.all([
    sdb.commissionPolicy.findMany({
      orderBy: { policyCode: "asc" },
      select: {
        id: true,
        policyCode: true,
        name: true,
        orgUnitId: true,
        centerId: true,
        versions: { include: { rules: { include: { beneficiaryRole: { select: { code: true } } } }, document: { select: { documentCode: true } } } },
      },
    }),
    docTraCuuNhan(actor),
    sdb.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const tenDonVi = new Map(orgUnits.map((o) => [o.id, o.name]));

  const ra: DongChinhSach[] = [];
  for (const p of policies) {
    const chon = chonPhienBanHienHanh(p.versions.map((v) => ({ ...v, status: v.status as TrangThaiPhienBan })), now);
    if (!chon) continue;
    const nhap = p.versions.filter((v) => v.status === "DRAFT" && v.id !== chon.id).sort((a, b) => b.versionNo - a.versionNo)[0];
    const tt = trangThaiPhienBanHienThi(chon, now);
    const rules = chon.rules.map((r) => ({ transactionTypeCode: r.transactionTypeCode, calcKind: r.calcKind, rate: r.rate === null ? null : r.rate.toString() }));
    const vaiCode = [...new Set(chon.rules.map((r) => r.beneficiaryRole.code))];
    ra.push({
      policyId: p.id,
      policyCode: p.policyCode,
      name: p.name,
      chuSoHuu: p.orgUnitId ? (tenDonVi.get(p.orgUnitId) ?? "Cơ sở") : "Hội sở",
      chuSoHuuCenterId: p.centerId,
      versionId: chon.id,
      versionNo: chon.versionNo,
      status: chon.status as TrangThaiPhienBan,
      khoa: tt.khoa,
      nhanTrangThai: tt.nhan,
      tone: tt.tone,
      phamVi: nhanPhamVi(chon, tra),
      vai: vaiCode.map((code) => ({ code, name: tra.vai.get(code) ?? code })),
      loaiGd: [...new Set(chon.rules.map((r) => r.transactionTypeCode))],
      tiLe: tomTatTiLe(rules),
      vanBan: chon.document?.documentCode ?? null,
      effectiveFrom: chon.effectiveFrom,
      effectiveTo: chon.effectiveTo,
      coBanNhap: nhap ? { versionId: nhap.id, versionNo: nhap.versionNo } : null,
      soPhienBan: p.versions.length,
    });
  }
  return ra;
}

// ── Chi tiết một chính sách ─────────────────────────────────────────────────

export type RuleChiTiet = {
  transactionTypeCode: string;
  roleCode: string;
  roleName: string;
  /** `BeneficiaryRole.isAcquisition` — vai thuộc «hoa hồng nguồn» hay «giao dịch khác» (bảng phiên bản tách hai nhóm). */
  isAcquisition: boolean;
  calcKind: string;
  rate: string | null;
  fixedAmount: number | null;
  note: string | null;
};

export type PhienBanChiTiet = {
  versionId: string;
  versionNo: number;
  status: TrangThaiPhienBan;
  khoa: string;
  nhanTrangThai: string;
  tone: "success" | "warning" | "danger" | "info" | "muted";
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  phamVi: { loai: string; nhan: string; nhanDai: string };
  vanBan: { id: string; documentCode: string; title: string; publishedOn: string; coTep: boolean; fileUrl: string | null; fileName: string | null; daThuHoi: boolean } | null;
  rules: RuleChiTiet[];
  tiLe: TomTatTiLe[];
  tao: { ten: string | null; luc: Date };
  kichHoatLuc: Date | null;
  daDung: boolean;
};

export type ChinhSachChiTiet = {
  policyId: string;
  policyCode: string;
  name: string;
  description: string | null;
  chuSoHuu: string;
  ownerCenterId: string | null;
  phienBan: PhienBanChiTiet[];
};

export async function docChiTietChinhSach(actor: Actor, policyId: string, now: Date): Promise<ChinhSachChiTiet | null> {
  const sdb = scopedDb(actor);
  const p = await sdb.commissionPolicy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      policyCode: true,
      name: true,
      description: true,
      orgUnitId: true,
      centerId: true,
      versions: {
        orderBy: { versionNo: "desc" },
        include: {
          rules: { include: { beneficiaryRole: { select: { code: true, name: true, isAcquisition: true } } }, orderBy: { createdAt: "asc" } },
          document: true,
        },
      },
    },
  });
  if (!p) return null;
  const tra = await docTraCuuNhan(actor);
  const phienBan: PhienBanChiTiet[] = p.versions.map((v) => {
    const tt = trangThaiPhienBanHienThi({ status: v.status as TrangThaiPhienBan, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo }, now);
    const rules: RuleChiTiet[] = v.rules.map((r) => ({
      transactionTypeCode: r.transactionTypeCode,
      roleCode: r.beneficiaryRole.code,
      roleName: r.beneficiaryRole.name,
      isAcquisition: r.beneficiaryRole.isAcquisition,
      calcKind: r.calcKind,
      rate: r.rate === null ? null : r.rate.toString(),
      fixedAmount: r.fixedAmount,
      note: r.note,
    }));
    return {
      versionId: v.id,
      versionNo: v.versionNo,
      status: v.status as TrangThaiPhienBan,
      khoa: tt.khoa,
      nhanTrangThai: tt.nhan,
      tone: tt.tone,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      reason: v.reason,
      phamVi: nhanPhamVi(v, tra),
      vanBan: v.document
        ? {
            id: v.document.id,
            documentCode: v.document.documentCode,
            title: v.document.title,
            publishedOn: ngayCuaCotDate(v.document.publishedOn),
            coTep: !!(v.document.fileKey || v.document.fileUrl),
            fileUrl: v.document.fileUrl,
            fileName: v.document.fileName,
            daThuHoi: v.document.revokedAt !== null,
          }
        : null,
      rules,
      tiLe: tomTatTiLe(rules),
      tao: { ten: v.createdByName, luc: v.createdAt },
      kichHoatLuc: v.activatedAt,
      daDung: v.firstUsedAt !== null,
    };
  });
  const donVi = p.orgUnitId ? (await sdb.orgUnit.findFirst({ where: { id: p.orgUnitId }, select: { name: true } }))?.name : null;
  return { policyId: p.id, policyCode: p.policyCode, name: p.name, description: p.description, chuSoHuu: p.orgUnitId ? (donVi ?? "Cơ sở") : "Hội sở", ownerCenterId: p.centerId, phienBan };
}

// ── Dữ liệu cho builder ─────────────────────────────────────────────────────

export type DuLieuSoan = {
  /** `resolverKey` để phân biệt các vai cùng kiểu (cách tìm người nhận) — mô tả + gợi ý ở bước «Người hưởng». */
  vai: { code: string; name: string; isAcquisition: boolean; resolverType: string; resolverKey: string | null }[];
  /**
   * MỌI nguồn trừ mã hệ thống «UNKNOWN», kể cả Nháp / Ngừng / Lưu trữ: một bản nháp chính sách mang nguồn đã ngừng phải mở ra với ô chọn ĐÚNG nguồn đó (kèm trạng thái),
   * không phải ô trắng. Ô chọn tự lọc cái nào mời chọn mới (`nguonQuaCongHoatDong`).
   */
  nhomNguon: NguonSoan[];
  /** Cơ sở người xem được GHI (chủ sở hữu / phạm vi ORG_UNIT). */
  coSo: { orgUnitId: string; centerId: string; label: string }[];
  coTheSoHuuHoiSo: boolean;
  vanBan: { id: string; documentCode: string; title: string; publishedOn: string; coTep: boolean; daThuHoi: boolean }[];
  loaiGdBat: ("NEW" | "RENEWAL")[];
  tran: number | null;
};

export async function docDuLieuSoan(actor: Actor, now: Date): Promise<DuLieuSoan> {
  const sdb = scopedDb(actor);
  const tamNhin = tamNhinChinhSach(actor);
  const [vai, nhom, donVi, vanBan, tran] = await Promise.all([
    sdb.beneficiaryRole.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, isAcquisition: true, resolverType: true, resolverKey: true } }),
    sdb.leadSourceGroup.findMany({
      where: { code: { not: "UNKNOWN" } },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, status: true, commissionEnabled: true, effectiveFrom: true, effectiveTo: true, ownerEmployeeId: true, referrerRequirement: true },
    }),
    sdb.orgUnit.findMany({
      where: { type: "CENTER", deletedAt: null, centerId: tamNhin === "ALL" ? { not: null } : { in: [...tamNhin] } },
      orderBy: { code: "asc" },
      select: { id: true, centerId: true, code: true, name: true },
    }),
    sdb.regulationDocument.findMany({
      where: { kind: "COMMISSION_POLICY" },
      orderBy: { publishedOn: "desc" },
      take: 100,
      select: { id: true, documentCode: true, title: true, publishedOn: true, fileKey: true, fileUrl: true, revokedAt: true },
    }),
    docTranHoaHong().catch(() => null),
  ]);
  const bat = new Set<string>(maLoaiDangBat());
  return {
    vai,
    nhomNguon: nhom.map((n) => ({
      id: n.id,
      code: n.code,
      name: n.name,
      coHoaHong: n.commissionEnabled,
      trangThai: khoaTrangThaiNguon(n, now),
      hieuLucTu: n.effectiveFrom?.toISOString() ?? null,
      hieuLucDen: n.effectiveTo?.toISOString() ?? null,
      coNguoiPhuTrach: n.ownerEmployeeId !== null,
      referrerRequirement: n.referrerRequirement,
    })),
    coSo: donVi.flatMap((o) => (o.centerId ? [{ orgUnitId: o.id, centerId: o.centerId, label: `${o.code} · ${o.name}` }] : [])),
    coTheSoHuuHoiSo: tamNhin === "ALL",
    vanBan: vanBan.map((d) => ({
      id: d.id,
      documentCode: d.documentCode,
      title: d.title,
      publishedOn: ngayCuaCotDate(d.publishedOn),
      coTep: !!(d.fileKey || d.fileUrl),
      daThuHoi: d.revokedAt !== null,
    })),
    loaiGdBat: (["NEW", "RENEWAL"] as const).filter((l) => bat.has(l)),
    tran,
  };
}

/** Phiên bản (kèm chính sách) để đổ vào form soạn; `null` nếu không có / ngoài tầm nhìn. */
export async function docPhienBanDeSoan(
  actor: Actor,
  policyId: string,
  versionId: string | null,
): Promise<{
  dauVao: PhienBanChoForm;
  versionId: string;
  versionNo: number;
  status: TrangThaiPhienBan;
  daDung: boolean;
  updatedAt: Date;
  ownerCenterId: string | null;
} | null> {
  const sdb = scopedDb(actor);
  const p = await sdb.commissionPolicy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      policyCode: true,
      name: true,
      description: true,
      orgUnitId: true,
      centerId: true,
      versions: { orderBy: { versionNo: "desc" }, include: { rules: { include: { beneficiaryRole: { select: { code: true } } }, orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!p) return null;
  // Không chỉ định version ⇒ lấy bản MỚI NHẤT không bị huỷ làm gốc (đúng quy ước `taoPhienBanMoi`).
  const v = versionId ? p.versions.find((x) => x.id === versionId) : p.versions.find((x) => x.status !== "CANCELLED");
  if (!v) return null;
  return {
    dauVao: {
      policyCode: p.policyCode,
      name: p.name,
      description: p.description,
      ownerOrgUnitId: p.orgUnitId,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      reason: v.reason,
      documentId: v.documentId,
      scope: { scopeType: v.scopeType, scopeSourceGroupId: v.scopeSourceGroupId, scopeOrgUnitId: v.scopeOrgUnitId },
      rules: v.rules.map((r) => ({
        transactionTypeCode: r.transactionTypeCode,
        roleCode: r.beneficiaryRole.code,
        calcKind: r.calcKind,
        rate: r.rate === null ? null : r.rate.toString(),
        revenueComponent: r.revenueComponent,
      })),
    },
    versionId: v.id,
    versionNo: v.versionNo,
    status: v.status as TrangThaiPhienBan,
    daDung: v.firstUsedAt !== null,
    updatedAt: v.updatedAt,
    ownerCenterId: p.centerId,
  };
}

// ── Ma trận ─────────────────────────────────────────────────────────────────

export type DuLieuMaTran = {
  quyTac: QuyTac[];
  nhomNguon: { id: string; code: string; name: string; coHoaHong: boolean }[];
  vai: { code: string; name: string; isAcquisition: boolean }[];
  /** Đường dẫn OrgUnit làm "đơn vị của giao dịch giả định": "/" = toàn hệ thống. */
  orgUnitPath: string;
  tran: number | null;
};

/**
 * Mọi rule của phiên bản từng có hiệu lực (ACTIVE/EXPIRED/SUPERSEDED) TRONG TẦM NHÌN của người xem. `coSoId` = id Center
 * người xem chọn (đã kiểm nằm trong tầm nhìn ở page); `null` ⇒ toàn hệ thống.
 */
export async function docDuLieuMaTran(actor: Actor, coSoId: string | null): Promise<DuLieuMaTran> {
  const sdb = scopedDb(actor);
  const [versions, nhom, vai, orgUnits, tran] = await Promise.all([
    sdb.commissionPolicyVersion.findMany({ where: { status: { in: ["ACTIVE", "EXPIRED", "SUPERSEDED"] } }, include: INCLUDE_RULE_VAI, orderBy: [{ policyId: "asc" }, { versionNo: "asc" }] }),
    sdb.leadSourceGroup.findMany({ where: { status: "ACTIVE", code: { not: "UNKNOWN" } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, commissionEnabled: true } }),
    sdb.beneficiaryRole.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true, isAcquisition: true } }),
    sdb.orgUnit.findMany({ where: { deletedAt: null }, select: { id: true, type: true, centerId: true, path: true } }),
    docTranHoaHong().catch(() => null),
  ]);
  const pathCua = new Map(orgUnits.flatMap((o) => (o.path ? [[o.id, o.path] as const] : [])));
  const chu = (orgUnitId: string | null): { path: string; depth: number } => {
    if (orgUnitId === null) return { path: "/", depth: -1 };
    const path = pathCua.get(orgUnitId);
    // Đơn vị sở hữu đã mất path (xoá mềm): không đoán — bỏ rule khỏi ma trận còn hơn gán nhầm "toàn hệ".
    if (!path) return { path: "\u0000", depth: -1 };
    return { path, depth: depthOfPath(path) };
  };
  const quyTac = versions.flatMap((v) => quyTacTuVersion(v, chu(v.orgUnitId), v.scopeOrgUnitId ? (pathCua.get(v.scopeOrgUnitId) ?? null) : null, v.status as TrangThaiPhienBan));
  const donViCoSo = coSoId ? orgUnits.find((o) => o.type === "CENTER" && o.centerId === coSoId) : undefined;
  return { quyTac, nhomNguon: nhom.map((n) => ({ id: n.id, code: n.code, name: n.name, coHoaHong: n.commissionEnabled })), vai, orgUnitPath: donViCoSo?.path ?? "/", tran };
}

// ── Bộ lọc / trạng thái chung của tab ───────────────────────────────────────

export type BoLocChinhSach = {
  /** Cơ sở người xem được THẤY (chip ScopeBar) — `id` = Center.id. */
  coSo: { id: string; label: string }[];
  vai: { code: string; name: string }[];
  tran: number | null;
};

/** Nhẹ hơn `docDuLieuSoan` (không nạp danh sách văn bản): đủ cho chip cơ sở, bộ lọc vai và dòng trần. */
export async function docBoLocChinhSach(actor: Actor): Promise<BoLocChinhSach> {
  const sdb = scopedDb(actor);
  const tamNhin = tamNhinChinhSach(actor);
  const [donVi, vai, tran] = await Promise.all([
    sdb.orgUnit.findMany({
      where: { type: "CENTER", deletedAt: null, centerId: tamNhin === "ALL" ? { not: null } : { in: [...tamNhin] } },
      orderBy: { code: "asc" },
      select: { centerId: true, code: true, name: true },
    }),
    sdb.beneficiaryRole.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    docTranHoaHong().catch(() => null),
  ]);
  return { coSo: donVi.flatMap((o) => (o.centerId ? [{ id: o.centerId, label: `${o.code} · ${o.name}` }] : [])), vai, tran };
}

/** Có ÍT NHẤT một phiên bản ACTIVE đã tới hiệu lực (trong tầm nhìn) không — để nói "chưa cấu hình" cho đúng. */
export async function coChinhSachDangApDung(actor: Actor, now: Date): Promise<boolean> {
  const n = await scopedDb(actor).commissionPolicyVersion.count({
    where: { status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
  });
  return n > 0;
}

