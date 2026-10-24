import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { CAU_HINH_HOA_DON_MAC_DINH } from "@/lib/finance/hoa-don/phap-nhan";
import { assertLegalEntityUsable, requireLegalName, validateTaxCode } from "./legal-entity";
import { OrgRuleError } from "./types";
import { ghiAuditGanPhapNhan } from "./audit-gan-phap-nhan";

// lib/org/legal-entity-admin.ts — QUẢN TRỊ pháp nhân (Cây tổ chức): thêm · sửa · ngừng/mở lại · xoá mềm · gắn đơn vị.
// Luật nền (MST hợp lệ, pháp nhân gốc duy nhất, chặn gán pháp nhân đã xoá/ngừng) ở `legal-entity.ts` — file này thêm lớp
// QUẢN TRỊ: MỌI thao tác chạy trong MỘT transaction cùng bản ghi audit, lý do bắt buộc cho việc đổi/ngừng/xoá/gắn.
//
// ⚠️ KHÔNG BAO GIỜ ghi vào hoá đơn: `HoaDonDienTu` CHỤP riêng `phapNhanMa/Ten/Mst` lúc lưu, và cấu hình hoá đơn tham chiếu danh sách
// pháp nhân PHÁT HÀNH trong mã — không tham chiếu `LegalEntity`. Đổi quan hệ cơ sở–pháp nhân chỉ đổi GỢI Ý điền sẵn ở màn Cấu hình
// ký hiệu. Test `[PNQ-DB-05]` đọc lại hoá đơn sau mỗi thao tác và đòi KHÔNG đổi một byte.
// Từ chối = `throw` (transaction rollback) và đứng TRƯỚC phép ghi đầu tiên.

export const TOI_THIEU_LY_DO_PHAP_NHAN = 10;
const MODULE = "org";

export type NguoiThaoTac = { id: string; name: string };

function lyDoHopLe(lyDo: string | null | undefined): string {
  const l = (lyDo ?? "").trim();
  if (l.length < TOI_THIEU_LY_DO_PHAP_NHAN) {
    throw new OrgRuleError("LEGAL_REASON_REQUIRED", `Ghi rõ lý do (ít nhất ${TOI_THIEU_LY_DO_PHAP_NHAN} ký tự).`, "lyDo");
  }
  return l;
}

const chonPn = { id: true, taxCode: true, legalName: true, address: true, isPrimary: true, isActive: true, deletedAt: true } as const;
type PnRow = Prisma.LegalEntityGetPayload<{ select: typeof chonPn }>;
const anh = (p: PnRow) => ({ taxCode: p.taxCode, legalName: p.legalName, address: p.address, isActive: p.isActive, isPrimary: p.isPrimary, daXoa: p.deletedAt != null });

export type TacDongPhapNhan = { donVi: number; hoaDon: number; cauHinhHoaDon: number };

/** Mã pháp nhân PHÁT HÀNH (trong mã) có MST này — để biết dòng cấu hình hoá đơn nào tham chiếu. */
function maPhatHanhTheoMst(taxCode: string): string[] {
  return CAU_HINH_HOA_DON_MAC_DINH.phapNhan.filter((p) => p.maSoThue.replace(/[\s-]/g, "") === taxCode.replace(/[\s-]/g, "")).map((p) => p.ma);
}

async function demTacDong(tx: Prisma.TransactionClient | typeof db, id: string, taxCode: string): Promise<TacDongPhapNhan> {
  const ma = maPhatHanhTheoMst(taxCode);
  const [donVi, hoaDon, cauHinhHoaDon] = await Promise.all([
    tx.orgUnit.count({ where: { legalEntityId: id, deletedAt: null, status: { not: "CLOSED" } } }),
    tx.hoaDonDienTu.count({ where: { phapNhanMst: taxCode } }),
    ma.length > 0 ? tx.cauHinhHoaDonCoSo.count({ where: { phapNhanMa: { in: ma } } }) : Promise.resolve(0),
  ]);
  return { donVi, hoaDon, cauHinhHoaDon };
}

export type DongPhapNhan = PnRow & { tacDong: TacDongPhapNhan };

/** Danh sách (kể cả đã xoá mềm — để "Mở lại" thay vì tạo bản trùng MST) + số đơn vị / hoá đơn / dòng cấu hình đang dựa vào. Chỉ ĐỌC. */
export async function docDanhSachPhapNhan(): Promise<DongPhapNhan[]> {
  const ds = await db.legalEntity.findMany({ select: chonPn, orderBy: [{ isPrimary: "desc" }, { legalName: "asc" }] });
  return Promise.all(ds.map(async (p) => ({ ...p, tacDong: await demTacDong(db, p.id, p.taxCode) })));
}

function dichTrungMst(e: unknown, taxCode: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new OrgRuleError("LEGAL_TAXCODE_CONFLICT", `Mã số thuế "${taxCode}" đã tồn tại.`, "taxCode");
  }
  throw e;
}

/** Thêm pháp nhân. MST trùng (kể cả pháp nhân đã xoá/ngừng) ⇒ từ chối và chỉ sang "Mở lại" — không sinh bản trùng. */
export async function taoPhapNhan(input: { taxCode: string; legalName: string; address?: string | null; nguoi: NguoiThaoTac }): Promise<{ id: string }> {
  const taxCode = validateTaxCode(input.taxCode);
  const legalName = requireLegalName(input.legalName);
  try {
    return await db.$transaction(async (tx) => {
      const trung = await tx.legalEntity.findUnique({ where: { taxCode }, select: { id: true, deletedAt: true, isActive: true, legalName: true } });
      if (trung) {
        const tinhTrang = trung.deletedAt ? "đã bị xoá" : trung.isActive ? "đang hoạt động" : "đang ngừng";
        throw new OrgRuleError(
          "LEGAL_TAXCODE_CONFLICT",
          `Mã số thuế "${taxCode}" đã có ở pháp nhân "${trung.legalName}" (${tinhTrang})${trung.deletedAt || !trung.isActive ? " — dùng \"Mở lại\" thay vì tạo mới." : "."}`,
          "taxCode",
        );
      }
      const moi = await tx.legalEntity.create({ data: { taxCode, legalName, address: input.address?.trim() || null }, select: chonPn });
      await writeAudit({ tx, actor: input.nguoi, module: MODULE, entityType: "LegalEntity", entityId: moi.id, action: "TAO_PHAP_NHAN", oldValues: null, newValues: anh(moi) });
      return { id: moi.id };
    });
  } catch (e) {
    return dichTrungMst(e, taxCode);
  }
}

/**
 * Sửa tên / địa chỉ / MST. Lý do bắt buộc. **MST khoá khi đã có hoá đơn hoặc dòng cấu hình hoá đơn dựa vào** — sửa MST là đổi
 * danh tính pháp lý; sai MST thì Ngừng + tạo pháp nhân mới (cùng nguyên tắc `kiemSuaCauHinh`).
 */
export async function suaPhapNhan(input: { id: string; legalName?: string; address?: string | null; taxCode?: string; lyDo: string; nguoi: NguoiThaoTac }): Promise<void> {
  const lyDo = lyDoHopLe(input.lyDo);
  const moiMst = input.taxCode !== undefined ? validateTaxCode(input.taxCode) : undefined;
  const moiTen = input.legalName !== undefined ? requireLegalName(input.legalName) : undefined;
  try {
    await db.$transaction(async (tx) => {
      const cu = await tx.legalEntity.findUnique({ where: { id: input.id }, select: chonPn });
      if (!cu || cu.deletedAt) throw new OrgRuleError("LEGAL_NOT_FOUND", "Không tìm thấy pháp nhân.", "id");
      const doiMst = moiMst !== undefined && moiMst !== cu.taxCode;
      if (doiMst) {
        const td = await demTacDong(tx, cu.id, cu.taxCode);
        if (td.hoaDon > 0 || td.cauHinhHoaDon > 0) {
          throw new OrgRuleError(
            "LEGAL_TAXCODE_LOCKED",
            `Không đổi mã số thuế: đã có ${td.hoaDon} hoá đơn và ${td.cauHinhHoaDon} dòng cấu hình hoá đơn dựa vào MST ${cu.taxCode}. Nếu nhập sai, ngừng pháp nhân này và tạo pháp nhân mới.`,
            "taxCode",
          );
        }
      }
      // Chỉ ghi thứ THẬT SỰ đổi: gửi lại giá trị y nguyên không phải một lần sửa (không sinh audit rỗng).
      const data: Prisma.LegalEntityUpdateInput = {};
      if (moiTen !== undefined && moiTen !== cu.legalName) data.legalName = moiTen;
      if (input.address !== undefined && (input.address?.trim() || null) !== cu.address) data.address = input.address?.trim() || null;
      if (doiMst) data.taxCode = moiMst;
      if (Object.keys(data).length === 0) throw new OrgRuleError("LEGAL_NO_CHANGE", "Không có gì thay đổi.", "id");
      const sau = await tx.legalEntity.update({ where: { id: cu.id }, data, select: chonPn });
      await writeAudit({ tx, actor: input.nguoi, module: MODULE, entityType: "LegalEntity", entityId: cu.id, action: "SUA_PHAP_NHAN", oldValues: anh(cu), newValues: anh(sau), reason: lyDo });
    });
  } catch (e) {
    return dichTrungMst(e, moiMst ?? "");
  }
}

/** Ngừng / mở lại. Ngừng không gỡ khỏi đơn vị đang gắn (chỉ chặn GÁN MỚI); mở lại cả pháp nhân đã xoá mềm. Lý do bắt buộc. */
export async function doiTrangThaiPhapNhan(input: { id: string; hanhDong: "NGUNG" | "MO_LAI"; lyDo: string; nguoi: NguoiThaoTac }): Promise<void> {
  const lyDo = lyDoHopLe(input.lyDo);
  await db.$transaction(async (tx) => {
    const cu = await tx.legalEntity.findUnique({ where: { id: input.id }, select: chonPn });
    if (!cu) throw new OrgRuleError("LEGAL_NOT_FOUND", "Không tìm thấy pháp nhân.", "id");
    if (input.hanhDong === "NGUNG") {
      if (cu.deletedAt || !cu.isActive) throw new OrgRuleError("LEGAL_NO_CHANGE", "Pháp nhân đã ngừng hoặc đã xoá.", "id");
      if (cu.isPrimary) throw new OrgRuleError("LEGAL_PRIMARY_PROTECTED", "Không ngừng pháp nhân GỐC của SataRobo.", "id");
    } else if (!cu.deletedAt && cu.isActive) {
      throw new OrgRuleError("LEGAL_NO_CHANGE", "Pháp nhân đang hoạt động.", "id");
    }
    const sau = await tx.legalEntity.update({
      where: { id: cu.id },
      data: input.hanhDong === "NGUNG" ? { isActive: false } : { isActive: true, deletedAt: null },
      select: chonPn,
    });
    await writeAudit({
      tx,
      actor: input.nguoi,
      module: MODULE,
      entityType: "LegalEntity",
      entityId: cu.id,
      action: input.hanhDong === "NGUNG" ? "NGUNG_PHAP_NHAN" : "MO_LAI_PHAP_NHAN",
      oldValues: anh(cu),
      newValues: anh(sau),
      reason: lyDo,
    });
  });
}

/** Xoá mềm. Chặn pháp nhân gốc và pháp nhân còn đơn vị CHƯA ĐÓNG trỏ vào (kèm danh sách — luật AC3 của `softDeleteLegalEntity`). */
export async function xoaPhapNhan(input: { id: string; lyDo: string; nguoi: NguoiThaoTac }): Promise<void> {
  const lyDo = lyDoHopLe(input.lyDo);
  await db.$transaction(async (tx) => {
    const cu = await tx.legalEntity.findUnique({ where: { id: input.id }, select: chonPn });
    if (!cu || cu.deletedAt) throw new OrgRuleError("LEGAL_NOT_FOUND", "Không tìm thấy pháp nhân.", "id");
    if (cu.isPrimary) throw new OrgRuleError("LEGAL_PRIMARY_PROTECTED", "Không xoá pháp nhân GỐC của SataRobo.", "id");
    const chan = await tx.orgUnit.findMany({ where: { legalEntityId: cu.id, deletedAt: null, status: { not: "CLOSED" } }, select: { code: true, name: true } });
    if (chan.length > 0) {
      throw new OrgRuleError(
        "LEGAL_HAS_ACTIVE_ORG_UNITS",
        `Không thể xoá pháp nhân: còn ${chan.length} đơn vị đang hoạt động trỏ vào — ${chan.map((b) => `${b.code} (${b.name})`).join(", ")}`,
        "id",
      );
    }
    const sau = await tx.legalEntity.update({ where: { id: cu.id }, data: { deletedAt: new Date(), isActive: false }, select: chonPn });
    await writeAudit({ tx, actor: input.nguoi, module: MODULE, entityType: "LegalEntity", entityId: cu.id, action: "XOA_PHAP_NHAN", oldValues: anh(cu), newValues: anh(sau), reason: lyDo });
  });
}

/**
 * Gắn (hoặc gỡ) pháp nhân cho một đơn vị. Chỉ pháp nhân còn dùng được. Lý do bắt buộc; audit ghi pháp nhân CŨ → MỚI. Chỉ đổi
 * `OrgUnit.legalEntityId` — không đụng hoá đơn, phiếu thu hay cấu hình hoá đơn.
 */
export async function ganPhapNhanChoDonVi(input: { orgUnitId: string; legalEntityId: string | null; lyDo: string; nguoi: NguoiThaoTac }): Promise<void> {
  const lyDo = lyDoHopLe(input.lyDo);
  if (input.legalEntityId) await assertLegalEntityUsable(input.legalEntityId);
  await db.$transaction(async (tx) => {
    const don = await tx.orgUnit.findUnique({ where: { id: input.orgUnitId }, select: { id: true, code: true, name: true, deletedAt: true, legalEntityId: true, legalEntity: { select: { taxCode: true, legalName: true } } } });
    if (!don || don.deletedAt) throw new OrgRuleError("ORG_NOT_FOUND", "Không tìm thấy đơn vị.", "orgUnitId");
    if (don.legalEntityId === input.legalEntityId) throw new OrgRuleError("LEGAL_NO_CHANGE", "Đơn vị đã gắn đúng pháp nhân này.", "legalEntityId");
    const moi = input.legalEntityId ? await tx.legalEntity.findUnique({ where: { id: input.legalEntityId }, select: { taxCode: true, legalName: true } }) : null;
    await tx.orgUnit.update({ where: { id: don.id }, data: { legalEntityId: input.legalEntityId } });
    await ghiAuditGanPhapNhan(tx, {
      nguoi: input.nguoi,
      donVi: { id: don.id, code: don.code },
      truoc: don.legalEntity ? { taxCode: don.legalEntity.taxCode, legalName: don.legalEntity.legalName } : null,
      sau: moi,
      lyDo,
    });
  });
}

export type MucLichSuPhapNhan = { id: string; luc: string; nguoi: string; hanhDong: string; doiTuong: string; lyDo: string | null; truoc: unknown; sau: unknown };
const HANH_DONG = ["TAO_PHAP_NHAN", "SUA_PHAP_NHAN", "NGUNG_PHAP_NHAN", "MO_LAI_PHAP_NHAN", "XOA_PHAP_NHAN", "GAN_PHAP_NHAN_CHO_DON_VI"];

/** Lịch sử thay đổi = AuditLog (module "org") — 100 mục gần nhất, mới nhất trước. Chỉ ĐỌC. */
export async function docLichSuPhapNhan(): Promise<MucLichSuPhapNhan[]> {
  const ds = await db.auditLog.findMany({
    where: { module: MODULE, action: { in: HANH_DONG } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, createdAt: true, actorName: true, action: true, entityType: true, entityId: true, reason: true, oldValues: true, newValues: true },
  });
  const tenPn = new Map((await db.legalEntity.findMany({ where: { id: { in: ds.filter((d) => d.entityType === "LegalEntity").map((d) => d.entityId) } }, select: { id: true, legalName: true } })).map((p) => [p.id, p.legalName]));
  const tenDon = new Map((await db.orgUnit.findMany({ where: { id: { in: ds.filter((d) => d.entityType === "OrgUnit").map((d) => d.entityId) } }, select: { id: true, code: true } })).map((u) => [u.id, u.code]));
  return ds.map((d) => ({
    id: d.id,
    luc: d.createdAt.toISOString(),
    nguoi: d.actorName ?? "—",
    hanhDong: d.action,
    doiTuong: (d.entityType === "LegalEntity" ? tenPn.get(d.entityId) : tenDon.get(d.entityId)) ?? d.entityId,
    lyDo: d.reason ?? null,
    truoc: d.oldValues,
    sau: d.newValues,
  }));
}

/** Đơn vị (CENTER/REGION/HO còn sống) + pháp nhân đang gắn — cho khối "Đơn vị đang gắn". Chỉ ĐỌC. */
export async function docDonViVaPhapNhan(): Promise<{ id: string; code: string; name: string; type: string; legalEntityId: string | null }[]> {
  return db.orgUnit.findMany({ where: { deletedAt: null }, orderBy: [{ depth: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, type: true, legalEntityId: true } });
}

