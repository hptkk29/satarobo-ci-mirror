// tests/hoa-hong/_cutover-phu-thuoc.ts — ĐỒ DÙNG cho các spec chạm `datMocCutover`. KHÔNG phải spec.
//
// `datMocCutover` nay là compare-and-set: người dùng phải mang theo `cuDaXem` + `dauVanDaXem` (cái họ ĐÃ XEM ở trang xem trước) và truyền `phuThuoc` (nơi nạp bằng chứng).
// Spec cũ (`cutover.spec.ts`) kiểm các CỔNG nghiệp vụ của mốc (bảng kê, manifest, dòng sổ mới…) chứ không kiểm bằng chứng so bóng, nên dùng bản `PHU_THUOC_SACH`
// (bốn số bằng chứng = đạt) — và đi đúng đường thật: «xem trước» (`napGoiBangChung`) rồi «xác nhận» với CHÍNH dấu vân vừa xem.
import type { PrismaClient } from "@prisma/client";

import { datMocCutover, napGoiBangChung, type GoiBangChung, type KetQuaDatMoc, type NguoiDatMoc, type PhuThuocDatMoc } from "../../lib/hoa-hong/cutover";

export const DAU_VAN_GIA_SACH = "dau-van-gia-bang-chung-sach";

export const BANG_CHUNG_SACH: GoiBangChung = {
  bangChung: { invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta: 0, diTruChuaSanSang: false },
  dauVan: DAU_VAN_GIA_SACH,
  tomTat: {},
};

/** Bằng chứng «đạt cả bốn». Dùng cho ca KHÔNG kiểm precheck. */
export const PHU_THUOC_SACH: PhuThuocDatMoc = { napBangChung: async () => BANG_CHUNG_SACH };

/** Bản tuỳ biến: bốn số + dấu vân do ca quyết. */
export function phuThuocCoBangChung(p: Partial<GoiBangChung["bangChung"]> & { dauVan?: string }): PhuThuocDatMoc {
  const { dauVan, ...so } = p;
  return { napBangChung: async () => ({ bangChung: { ...BANG_CHUNG_SACH.bangChung, ...so }, dauVan: dauVan ?? DAU_VAN_GIA_SACH, tomTat: {} }) };
}

/** «Xem trước rồi xác nhận» với chính dấu vân vừa xem — đường người dùng thật đi. */
export async function datMocDaXem(
  client: PrismaClient,
  nguoi: NguoiDatMoc,
  i: { mocMoi: string | null; lyDo: string; now: Date; phuThuoc?: PhuThuocDatMoc },
): Promise<KetQuaDatMoc> {
  const pt = i.phuThuoc ?? PHU_THUOC_SACH;
  const xem = await napGoiBangChung(client, pt, { moi: i.mocMoi, now: i.now });
  return datMocCutover(client, nguoi, { mocMoi: i.mocMoi, lyDo: i.lyDo, now: i.now, cuDaXem: xem.cu, dauVanDaXem: xem.goi.dauVan, phuThuoc: pt });
}
