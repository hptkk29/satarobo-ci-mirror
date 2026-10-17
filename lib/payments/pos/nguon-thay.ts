import "server-only";
// lib/payments/pos/nguon-thay.ts — NGUỒN đã thấy một giao dịch thẻ (`PosTxnSource`, GĐ4 POS — T13). §5.6.
//
// GĐ6 cần "giao dịch chỉ một nguồn thấy / lệch giữa hai nguồn" — ghi đè vào MỘT bản ghi (`PosCardTransaction`)
// là mất đúng thứ cần so. Một dòng / (maGiaoDich × nguồn FILE|AGENT): mốc thấy đầu/cuối, số lần, ẢNH CHỤP những
// gì NGUỒN ĐÓ nói (số tiền/trạng thái/loại/giờ/băm ghi chú), mã từ chối (agent). KHÔNG lưu ghi chú (chỉ băm),
// không số thẻ. Không backfill dữ liệu trước GĐ4.
//
// Chỉ là CHẨN ĐOÁN (không phải sổ tiền): người gọi ghi SAU khi dòng đã đi qua lõi; dòng lõi báo lỗi KHÔNG có
// dấu ở đây ⇒ lượt sau xử lý lại (cấy C22).
import type { PosDataSource } from "@prisma/client";
import { db } from "@/lib/db";
import type { DongPos } from "./kieu";
import { bamDienGiai } from "./agent/bam";

export type AnhNguon = {
  loaiGiaoDich: string | null;
  trangThai: string | null;
  soTien: number | null;
  thoiGianGiaoDich: Date | null;
  bamDienGiai: string | null;
  trangThaiHoanHuy: string | null;
  maHachToan: string | null;
  phiGiaoDich: number | null;
  maKetToan: string | null;
  maThietBi: string | null;
  maQuay: string | null;
};

export type DongNguon = {
  maGiaoDich: string;
  /** sha256 hex của dòng đã chuẩn hoá (T11) — 64 hex thường (CHECK ở DB). */
  bam: string;
  anh: AnhNguon;
  /** AGENT: mã từ chối (API §7.2) — dòng KHÔNG vào sổ. FILE: luôn null. */
  tuChoi: string | null;
  /** Theo MÁY (T25); null = chưa biết cơ sở. */
  centerId: string | null;
};

/** Ảnh chụp từ một dòng `DongPos` (file hoặc agent đã chuẩn hoá). */
export function anhTuDong(d: DongPos, maKetToan: string | null): AnhNguon {
  return {
    loaiGiaoDich: d.loaiGiaoDich,
    trangThai: d.trangThai,
    soTien: d.soTien,
    thoiGianGiaoDich: new Date(d.thoiGian),
    bamDienGiai: d.dienGiai.trim() === "" ? null : bamDienGiai(d.dienGiai),
    trangThaiHoanHuy: d.trangThaiHoanHuy,
    maHachToan: d.maHachToan,
    phiGiaoDich: d.phiGiaoDich,
    maKetToan,
    maThietBi: d.maThietBi,
    maQuay: d.maQuay,
  };
}

/** `centerId` + `orgUnitId` cho một phép ghi: có cơ sở ⇒ để ghi kép điền; không ⇒ null CẢ HAI tường minh. */
function cotCoSo(centerId: string | null): { centerId: string } | { centerId: null; orgUnitId: null } {
  return centerId ? { centerId } : { centerId: null, orgUnitId: null };
}

function laTrungKhoa(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Upsert theo `(maGiaoDich, nguon)` — tạo: lanDauThay = lanCuoiThay = now; cập nhật: lanCuoiThay = now,
 * soLanThay + 1, ảnh chụp mới. P2002 khi hai lượt đua TẠO ⇒ thử lại một lần (lượt sau rơi vào nhánh cập nhật).
 */
export async function ghiNguonThay(x: {
  nguon: PosDataSource;
  posAgentId: string | null;
  importBatchId: string | null;
  dong: readonly DongNguon[];
  now: Date;
}): Promise<void> {
  for (const r of x.dong) {
    const chung = {
      bam: r.bam,
      ...r.anh,
      tuChoi: x.nguon === "AGENT" ? r.tuChoi : null,
      ...cotCoSo(r.centerId),
      ...(x.importBatchId ? { importBatchId: x.importBatchId } : {}),
    };
    const mot = () =>
      db.posTxnSource.upsert({
        where: { maGiaoDich_nguon: { maGiaoDich: r.maGiaoDich, nguon: x.nguon } },
        create: {
          maGiaoDich: r.maGiaoDich,
          nguon: x.nguon,
          posAgentId: x.nguon === "AGENT" ? x.posAgentId : null,
          lanDauThay: x.now,
          lanCuoiThay: x.now,
          soLanThay: 1,
          ...chung,
        },
        update: { lanCuoiThay: x.now, soLanThay: { increment: 1 }, ...chung },
        select: { id: true },
      });
    try {
      await mot();
    } catch (err) {
      if (!laTrungKhoa(err)) throw err;
      await mot();
    }
  }
}
