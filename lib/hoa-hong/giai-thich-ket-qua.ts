// lib/hoa-hong/giai-thich-ket-qua.ts — KIỂU kết quả của Server Action mở ngăn «vì sao 0đ» + hàm dựng thuần (Hướng G).
//
// Tách khỏi `so/_actions.ts` vì tệp `"use server"` CHỈ được export hàm async (cùng lý do `vi-sao-ket-qua.ts`). JSON thuần: không Date, không Map.
import type { DongGiaiThichTrang } from "./giai-thich-doc";
import { dungNhanGiaiThich, type NhanGiaiThich } from "./giai-thich-khong-tien";

export type GiaiThichMo = {
  id: string;
  vai: string;
  nguoiHuong: string | null;
  tenHocVien: string | null;
  /** Kỳ tự nhiên (hiệu lực) của khoản thu, "2026-12". */
  ky: string;
  nhan: NhanGiaiThich;
};

export type KetQuaMoGiaiThich = { ok: true; du: GiaiThichMo } | { ok: false; error: string };

export function dungGiaiThichMo(d: DongGiaiThichTrang): GiaiThichMo {
  return { id: d.id, vai: d.tenVai, nguoiHuong: d.nguoiHuong ? d.nguoiHuong.ten : null, tenHocVien: d.tenHocVien, ky: d.naturalPeriod, nhan: dungNhanGiaiThich(d) };
}
