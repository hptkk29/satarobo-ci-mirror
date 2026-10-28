import "server-only";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { cauHinhHoaDonChoMoiTruong } from "./phap-nhan-theo-moi-truong";
import { kiemCauHinhCoSo, kiemSuaCauHinh, type CauHinhCoSo, type DauVaoCauHinh } from "./cau-hinh-co-so";

// lib/finance/hoa-don/cau-hinh-co-so-db.ts — đọc / ghi cấu hình hoá đơn theo cơ sở (PR2). Luật nằm ở
// `cau-hinh-co-so.ts` (thuần, có test); tệp này chỉ nối với DB.
//
// ⚠️ ĐỌC cho màn đi qua `scopedDb` (tiền tố `payments:`); GHI thì `scopedDb` KHÔNG che — người gọi (action) PHẢI đã
// kiểm `coQuyenKeToanTaiCoSo(actor, centerId)` TRƯỚC khi gọi `luuCauHinh`. Hàm này kiểm lại quyền của dòng đang sửa
// (cùng cơ sở) nhưng không biết quyền của người.
// ⚠️ Mọi ghi trong MỘT transaction có khoá tư vấn theo cơ sở: hai kế toán thêm dòng chồng ngày cùng lúc không cùng
// qua được phép kiểm chồng ngày (kiểm rồi mới ghi, trong cùng khoá).
// ⚠️ KHÔNG xoá dòng: "xoá" = tắt (`dangBat=false`). Lịch sử thay đổi = AuditLog (module "hoa-don"), đọc qua
// `docLichSuCauHinh` — không cần nới quyền `audit-logs:view`.

const ENTITY = "CauHinhHoaDonCoSo";

export type DongCauHinh = CauHinhCoSo & {
  ghiChu: string | null;
  taoBoiId: string;
  capNhatBoiId: string;
  capNhatLuc: string;
};

const ngay = (d: Date) => d.toISOString().slice(0, 10);

type Hang = {
  id: string;
  centerId: string;
  phapNhanMa: string;
  kyHieu: string;
  hieuLucTu: Date;
  hieuLucDen: Date;
  dangBat: boolean;
  ghiChu: string | null;
  taoBoiId: string;
  capNhatBoiId: string;
  updatedAt: Date;
};

function sangDong(h: Hang): DongCauHinh {
  return {
    id: h.id,
    centerId: h.centerId,
    phapNhanMa: h.phapNhanMa,
    kyHieu: h.kyHieu,
    hieuLucTu: ngay(h.hieuLucTu),
    hieuLucDen: ngay(h.hieuLucDen),
    dangBat: h.dangBat,
    ghiChu: h.ghiChu,
    taoBoiId: h.taoBoiId,
    capNhatBoiId: h.capNhatBoiId,
    capNhatLuc: h.updatedAt.toISOString(),
  };
}

const CHON = {
  id: true,
  centerId: true,
  phapNhanMa: true,
  kyHieu: true,
  hieuLucTu: true,
  hieuLucDen: true,
  dangBat: true,
  ghiChu: true,
  taoBoiId: true,
  capNhatBoiId: true,
  updatedAt: true,
} as const;

/** Cấu hình của các cơ sở cho MÀN (qua `scopedDb`): mọi dòng, kể cả đã tắt, mới nhất trước. */
export async function docCauHinhCoSo(actor: Actor, centerIds: readonly string[]): Promise<DongCauHinh[]> {
  if (centerIds.length === 0) return [];
  const ds = await scopedDb(actor).cauHinhHoaDonCoSo.findMany({
    where: { centerId: { in: [...centerIds] } },
    orderBy: [{ hieuLucTu: "desc" }, { id: "asc" }],
    select: CHON,
  });
  return ds.map(sangDong);
}

/** Cấu hình ĐANG BẬT của các cơ sở cho HÀNG CHỜ / ghi bản nháp (qua `scopedDb`). */
export async function docCauHinhDangBat(actor: Actor, centerIds: readonly string[]): Promise<CauHinhCoSo[]> {
  if (centerIds.length === 0) return [];
  const ds = await scopedDb(actor).cauHinhHoaDonCoSo.findMany({
    where: { centerId: { in: [...centerIds] }, dangBat: true },
    select: CHON,
  });
  return ds.map(sangDong);
}

export type LichSuCauHinh = {
  id: string;
  cauHinhId: string;
  hanhDong: string;
  nguoiSua: string;
  lyDo: string | null;
  luc: string;
  truoc: unknown;
  sau: unknown;
};

/** Lịch sử thay đổi (AuditLog) của các dòng cấu hình — `ids` PHẢI lấy từ `docCauHinhCoSo` (đã qua phạm vi). */
export async function docLichSuCauHinh(ids: readonly string[], gioiHan = 100): Promise<LichSuCauHinh[]> {
  if (ids.length === 0) return [];
  const ds = await db.auditLog.findMany({
    where: { entityType: ENTITY, entityId: { in: [...ids] } },
    orderBy: { createdAt: "desc" },
    take: gioiHan,
    select: { id: true, entityId: true, action: true, actorName: true, reason: true, createdAt: true, oldValues: true, newValues: true },
  });
  return ds.map((a) => ({
    id: a.id,
    cauHinhId: a.entityId,
    hanhDong: a.action,
    nguoiSua: a.actorName,
    lyDo: a.reason,
    luc: a.createdAt.toISOString(),
    truoc: a.oldValues,
    sau: a.newValues,
  }));
}

export type KetQuaLuu = { ok: true; id: string } | { ok: false; error: string };

/** Từ chối nghiệp vụ trong transaction ⇒ NÉM (return không rollback — CLAUDE.md "Luật rollback"); bắt ngoài `$transaction`. */
class TuChoiCauHinh extends Error {}

/**
 * Tạo / sửa MỘT dòng cấu hình. `id` vắng = tạo mới. Kiểm hợp lệ + chồng ngày + khoá sửa-khi-đã-có-hoá-đơn, rồi ghi
 * kèm AuditLog TRONG CÙNG transaction. Cổng đứng TRƯỚC phép ghi đầu tiên (return không rollback).
 */
export async function luuCauHinh(input: {
  nguoi: { id: string; name: string };
  id?: string;
  du: DauVaoCauHinh;
  ghiChu: string | null;
  /** Bắt buộc khi sửa / tắt — vào AuditLog. */
  lyDo: string | null;
}): Promise<KetQuaLuu> {
  const du: DauVaoCauHinh = { ...input.du, kyHieu: input.du.kyHieu.trim().toUpperCase() };
  try {
    return await db.$transaction(async (tx): Promise<KetQuaLuu> => {
    // Khoá theo cơ sở: kiểm chồng ngày và ghi nằm trong cùng một lượt, không xen kẽ với người khác.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cau-hinh-hoa-don:" + du.centerId}))`;
    const cu = input.id
      ? await tx.cauHinhHoaDonCoSo.findUnique({ where: { id: input.id }, select: CHON })
      : null;
    if (input.id && (!cu || cu.centerId !== du.centerId)) throw new TuChoiCauHinh("Không tìm thấy cấu hình");
    const daCo = (await tx.cauHinhHoaDonCoSo.findMany({ where: { centerId: du.centerId }, select: CHON })).map(sangDong);
    const khac = daCo.filter((c) => c.id !== input.id);

    if (cu) {
      const dung = await tx.hoaDonDienTu.aggregate({
        where: { centerId: du.centerId, kyHieu: cu.kyHieu, ngayPhatHanh: { gte: cu.hieuLucTu, lte: cu.hieuLucDen } },
        _count: { _all: true },
        _min: { ngayPhatHanh: true },
        _max: { ngayPhatHanh: true },
      });
      const loiSua = kiemSuaCauHinh(
        sangDong(cu),
        du,
        { soHoaDon: dung._count._all, ngayMin: dung._min.ngayPhatHanh ? ngay(dung._min.ngayPhatHanh) : null, ngayMax: dung._max.ngayPhatHanh ? ngay(dung._max.ngayPhatHanh) : null },
      );
      if (loiSua.length > 0) throw new TuChoiCauHinh(loiSua[0]!);
      if (!input.lyDo || input.lyDo.trim().length < 10) throw new TuChoiCauHinh("Ghi lý do thay đổi (ít nhất 10 ký tự)");
    }
    const loi = kiemCauHinhCoSo(du, khac, cauHinhHoaDonChoMoiTruong().phapNhan);
    if (loi.length > 0) throw new TuChoiCauHinh(loi[0]!);

    const data = {
      phapNhanMa: du.phapNhanMa,
      kyHieu: du.kyHieu,
      hieuLucTu: new Date(`${du.hieuLucTu}T00:00:00Z`),
      hieuLucDen: new Date(`${du.hieuLucDen}T00:00:00Z`),
      dangBat: du.dangBat,
      ghiChu: input.ghiChu,
      capNhatBoiId: input.nguoi.id,
    };
    const luu = cu
      ? await tx.cauHinhHoaDonCoSo.update({ where: { id: cu.id }, data, select: CHON })
      : await tx.cauHinhHoaDonCoSo.create({ data: { ...data, centerId: du.centerId, taoBoiId: input.nguoi.id }, select: CHON });

    const truoc = cu ? sangDong(cu) : null;
    const sau = sangDong(luu);
    await writeAudit({
      tx,
      actor: input.nguoi,
      module: "hoa-don",
      entityType: ENTITY,
      entityId: luu.id,
      action: !cu ? "TAO_CAU_HINH_HOA_DON" : cu.dangBat && !luu.dangBat ? "TAT_CAU_HINH_HOA_DON" : "SUA_CAU_HINH_HOA_DON",
      oldValues: truoc ? { ...truoc } : null,
      newValues: { ...sau },
      reason: input.lyDo ?? undefined,
      orgUnitId: du.centerId,
    });
    return { ok: true, id: luu.id };
    });
  } catch (e) {
    if (e instanceof TuChoiCauHinh) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Pháp nhân của cơ sở theo CÂY TỔ CHỨC. Cơ sở ↔ đơn vị khớp theo `Center.code = OrgUnit.code` (cùng quy ước
 * `lib/org/center-bridge.ts`). Chỉ đọc; chỉ trả pháp nhân CỦA CHÍNH cơ sở được hỏi — người gọi đã kiểm quyền cơ sở.
 */
export async function docPhapNhanCuaCayToChuc(centerId: string): Promise<{ taxCode: string; legalName: string } | null> {
  const c = await db.center.findUnique({ where: { id: centerId }, select: { code: true } });
  if (!c?.code) return null;
  const o = await db.orgUnit.findUnique({
    where: { code: c.code },
    select: { legalEntity: { select: { taxCode: true, legalName: true, deletedAt: true } } },
  });
  const le = o?.legalEntity;
  return le && !le.deletedAt ? { taxCode: le.taxCode, legalName: le.legalName } : null;
}
