// lib/hoa-hong/hang-cho-dau-vet.ts — ĐỌC DẤU VẾT KIỂM TOÁN của hàng chờ (đề nghị cấp 1 · chuyển xem tay · mở lại · đã dùng) từ `AuditLog` chỉ-thêm. Chỉ ĐỌC, không ghi.
//
// Tách khỏi `hang-cho-xu-ly-service.ts` để `giaiHangCho` (kiểm lại đề nghị TRONG khoá) dùng chung mà không vòng import (service gọi `giaiHangCho`).
// Hiệu lực của đề nghị suy từ SỰ THẬT trong dấu vết — xem `ganDauVoHieu` (`hang-cho-xu-ly.ts`): đã dùng · hàng chờ mở lại sau nó · (hạn 7 ngày chỉ là lưới phụ).
import type { PrismaClient } from "@prisma/client";

import {
  HANH_DONG_DE_NGHI,
  HANH_DONG_DOC_DAU_VET,
  HANH_DONG_DONG_HANG_CHO,
  HANH_DONG_MO_LAI,
  HANH_DONG_XEM_TAY,
  deNghiDaDungCuaDongDong,
  docDeNghi,
  docXemTay,
  ganDauVoHieu,
  type DeNghiDaGhi,
  type XemTayDaGhi,
} from "./hang-cho-xu-ly";

export const MODULE_AUDIT_HANG_CHO = "hoa-hong";
export const ENTITY_HANG_CHO = "CommissionHold";

export type DauVetXuLy = {
  /** Đề nghị MỚI NHẤT (đã gắn `vo` nếu bị vô hiệu). Không phải mọi đề nghị đều dùng được — luôn đi qua `deNghiConHieuLuc`. */
  deNghi: DeNghiDaGhi | null;
  xemTay: XemTayDaGhi | null;
  /** Id dòng `REOPEN` mới nhất của hàng chờ (null = chưa từng mở lại) — mốc ghi vào đề nghị mới. */
  moLaiCuoiId: string | null;
};

/**
 * THẾ HỆ MỞ LẠI của một hàng chờ = id dòng `REOPEN` mới nhất (null = chưa từng mở lại). Cùng thứ tự với `docDauVetXuLy` nên hai nơi luôn nói cùng một mốc. Gọi TRONG khoá khoản (`ghiHangCho` ghi
 * dòng `REOPEN` dưới cùng khoá) để không đọc lệch giữa lúc quét mở lại và lúc giải.
 */
export async function docMocMoLaiCuoi(client: Pick<PrismaClient, "auditLog">, holdId: string): Promise<string | null> {
  const r = await client.auditLog.findFirst({
    where: { entityType: ENTITY_HANG_CHO, entityId: holdId, module: MODULE_AUDIT_HANG_CHO, action: HANH_DONG_MO_LAI },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return r?.id ?? null;
}

/** MỘT câu cho nhiều hàng chờ: dòng đề nghị / xem tay / mở lại MỚI NHẤT + tập đề nghị ĐÃ DÙNG của từng hàng chờ. Chạy được cả trong transaction (`tx`). */
export async function docDauVetXuLy(client: Pick<PrismaClient, "auditLog">, holdIds: readonly string[]): Promise<Map<string, DauVetXuLy>> {
  const kq = new Map<string, DauVetXuLy>();
  if (holdIds.length === 0) return kq;
  const rows = await client.auditLog.findMany({
    where: { entityType: ENTITY_HANG_CHO, entityId: { in: [...holdIds] }, module: MODULE_AUDIT_HANG_CHO, action: { in: [...HANH_DONG_DOC_DAU_VET] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, entityId: true, action: true, actorId: true, actorName: true, createdAt: true, newValues: true, reason: true },
  });
  const daDung = new Map<string, Set<string>>();
  for (const r of rows) {
    const cu = kq.get(r.entityId) ?? { deNghi: null, xemTay: null, moLaiCuoiId: null };
    if (r.action === HANH_DONG_DE_NGHI && cu.deNghi === null) cu.deNghi = docDeNghi(r);
    if (r.action === HANH_DONG_XEM_TAY && cu.xemTay === null) cu.xemTay = docXemTay(r);
    if (r.action === HANH_DONG_MO_LAI && cu.moLaiCuoiId === null) cu.moLaiCuoiId = r.id;
    if ((HANH_DONG_DONG_HANG_CHO as readonly string[]).includes(r.action)) {
      const id = deNghiDaDungCuaDongDong(r.newValues);
      if (id) (daDung.get(r.entityId) ?? daDung.set(r.entityId, new Set()).get(r.entityId)!).add(id);
    }
    kq.set(r.entityId, cu);
  }
  for (const [holdId, cu] of kq) {
    if (cu.deNghi) cu.deNghi = ganDauVoHieu(cu.deNghi, { daDung: daDung.get(holdId) ?? new Set(), moLaiCuoiId: cu.moLaiCuoiId });
  }
  return kq;
}
