import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cheBiMat } from "@/lib/security/che-bi-mat";

// lib/finance/hoa-don/nhat-ky-luot-goi.ts — NHẬT KÝ TỪNG LƯỢT GỌI nhà cung cấp hoá đơn (hub/15 §2, điều kiện A3 của ký HSM tự động).
//
// Trả lời được câu «chiều nay HSM của CS1 đã được yêu cầu ký những gì, bao nhiêu lần, kết quả gì» — thứ mà `AuditLog` (chỉ ghi lúc BẮT ĐẦU phát hành)
// và cột `misaSoLanGui` (một con số) không trả lời được. Ghi vào bảng `HoaDonGiaoDichNhaCungCap` (đã có từ migration `hub_nen`; trước đây KHÔNG ai ghi).
//
// ⚠️ Thứ tự bắt buộc: GHI TRƯỚC → GỌI → CẬP NHẬT SAU.
//   · Dòng ghi trước mang `ketQua = KHONG_RO` và `ketThucLuc = NULL`. NULL là «lượt này chưa từng báo xong» — máy chủ chết giữa chừng để lại đúng dấu
//     «đã định gửi», khác với «nhà cung cấp trả KHONG_RO» (có `ketThucLuc`). Đừng đổi sang ghi một lần sau khi gọi: mất chính bằng chứng đó.
//   · Ghi trước THẤT BẠI ⇒ KHÔNG gọi nhà cung cấp (ném `LoiNhatKyLuotGoi`). Dòng đó là bằng chứng «sắp gửi»; không có bằng chứng thì không gửi (fail-closed).
//   · Cập nhật sau THẤT BẠI ⇒ chỉ ghi log máy chủ, kết quả của lượt gọi GIỮ NGUYÊN: lời gọi đã xảy ra, không được vì nhật ký mà đổi trạng thái hoá đơn.
// ⚠️ `luotThu` luôn là max+1 của (hoaDon, loaiLuot), thử lại khi trùng (P2002): «Kiểm tra lại» và cron có thể tra cứu cùng một bản cùng lúc, và `phatHanhLai`
//   đặt `misaSoLanGui` về 0 nên dùng nó làm số lượt sẽ đụng khoá duy nhất. Va chạm khi GHI NHẬT KÝ không bao giờ được làm hỏng lượt tra cứu.
// ⚠️ KHÔNG lưu thân phiếu (PII): chỉ `requestHash` = sha256 của phiếu. Thông điệp qua bộ che bí mật, ≤ 300 ký tự.
// ⚠️ Chưa ghi được: NGUỒN kích hoạt (lô 23h / tự xuất / bấm tay) — bảng không có cột cho nó; thêm cột là một migration nữa (xem hub/15 §2).
//    `nguoiGoiId` NULL = job hệ thống, có giá trị = người bấm.

export type LoaiLuotGoi = "PHAT_HANH" | "TRA_CUU" | "TAI_TEP";
export type KetQuaLuotGoi = "DA_PHAT_HANH" | "TU_CHOI" | "KHONG_RO" | "CHUA_CO" | "LOI_KY_THUAT";

export class LoiNhatKyLuotGoi extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiNhatKyLuotGoi";
  }
}

/** Câu nghiệp vụ khi KHÔNG ghi được dòng «sắp gửi» (nhà cung cấp chưa bị chạm tới). */
export const CAU_KHONG_GHI_DUOC_NHAT_KY = "Chưa ghi được nhật ký lượt gọi nhà cung cấp — hệ thống CHƯA gửi gì và sẽ tự thử lại";

const TRAN_THONG_DIEP = 300;
const SO_LAN_THU_LAI_LUOT_THU = 5;

export function bamPhieuLuotGoi(phieu: unknown): string {
  return createHash("sha256").update(JSON.stringify(phieu)).digest("hex");
}

export function rutThongDiepNhatKy(s: string | null | undefined): string | null {
  if (!s) return null;
  return cheBiMat(s).slice(0, TRAN_THONG_DIEP);
}

/** Phần kết quả của một lượt gọi mà nhật ký cần. Hợp đồng chung của `KetQuaPhatHanh` / `KetQuaTraCuu` (phat-hanh-misa.ts). */
type KqChung = { loai: "DA_PHAT_HANH" } | { loai: "TU_CHOI"; ma: string; thongDiep: string } | { loai: "KHONG_RO"; thongDiep: string } | { loai: "CHUA_CO" };

export function phanLoaiKetQua(kq: KqChung): { ketQua: KetQuaLuotGoi; maNhaCungCap: string | null; thongDiep: string | null } {
  switch (kq.loai) {
    case "DA_PHAT_HANH":
      return { ketQua: "DA_PHAT_HANH", maNhaCungCap: null, thongDiep: null };
    case "TU_CHOI":
      return { ketQua: "TU_CHOI", maNhaCungCap: kq.ma.slice(0, 100), thongDiep: rutThongDiepNhatKy(kq.thongDiep) };
    case "KHONG_RO":
      return { ketQua: "KHONG_RO", maNhaCungCap: null, thongDiep: rutThongDiepNhatKy(kq.thongDiep) };
    case "CHUA_CO":
      return { ketQua: "CHUA_CO", maNhaCungCap: null, thongDiep: null };
  }
}

type DauVaoLuotGoi = {
  hoaDonId: string;
  loaiLuot: LoaiLuotGoi;
  /** NULL = job hệ thống. BẮT BUỘC khai (luật 7): quên truyền người bấm là nhật ký nói sai «ai đã gọi». */
  nguoiGoiId: string | null;
  now: Date;
  /** Môi trường CỦA CỔNG đang gọi (`cong.moiTruong`) — đúng ba giá trị của cột; không tự suy lại. */
  moiTruong: "sandbox" | "production" | "gia-lap";
  khoaChongTrung: string | null;
  requestHash: string | null;
};

async function themDongTruoc(i: DauVaoLuotGoi): Promise<string> {
  const hd = await db.hoaDonDienTu.findUnique({
    where: { id: i.hoaDonId },
    select: { centerId: true, phapNhanMst: true, nhaCungCapMa: true },
  });
  if (!hd) throw new LoiNhatKyLuotGoi("Không thấy hoá đơn để ghi nhật ký lượt gọi");
  for (let lan = 0; lan < SO_LAN_THU_LAI_LUOT_THU; lan++) {
    const cuoi = await db.hoaDonGiaoDichNhaCungCap.aggregate({
      where: { hoaDonId: i.hoaDonId, loaiLuot: i.loaiLuot },
      _max: { luotThu: true },
    });
    try {
      const dong = await db.hoaDonGiaoDichNhaCungCap.create({
        data: {
          hoaDonId: i.hoaDonId,
          centerId: hd.centerId,
          phapNhanMst: hd.phapNhanMst,
          // Bản cũ chưa có `nhaCungCapMa` đều là MISA (cùng quy ước `doiSoatPhatHanhTreo`).
          nhaCungCapMa: hd.nhaCungCapMa ?? "MISA_MEINVOICE",
          moiTruong: i.moiTruong,
          loaiLuot: i.loaiLuot,
          luotThu: (cuoi._max.luotThu ?? 0) + 1,
          khoaChongTrung: i.khoaChongTrung,
          requestHash: i.requestHash,
          ketQua: "KHONG_RO",
          batDauLuc: i.now,
          nguoiGoiId: i.nguoiGoiId,
        },
        select: { id: true },
      });
      return dong.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new LoiNhatKyLuotGoi("Va chạm số lượt khi ghi nhật ký lượt gọi");
}

async function capNhatSau(
  id: string,
  d: { ketQua: KetQuaLuotGoi; maNhaCungCap: string | null; thongDiep: string | null; doTreMs: number },
): Promise<void> {
  try {
    await db.hoaDonGiaoDichNhaCungCap.update({
      where: { id },
      data: { ketQua: d.ketQua, maNhaCungCap: d.maNhaCungCap, thongDiepDaChe: d.thongDiep, doTreMs: d.doTreMs, ketThucLuc: new Date() },
    });
  } catch (e) {
    // Lời gọi ĐÃ xảy ra — nhật ký hỏng không được đổi kết quả của nó. Dòng «ghi trước» vẫn còn (ketThucLuc NULL) làm dấu.
    console.error(`[hoa-don-nhat-ky] không cập nhật được dòng ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Bao MỘT lời gọi nhà cung cấp bằng nhật ký (xem đầu tệp). `goi` ném ⇒ dòng ghi `LOI_KY_THUAT` rồi ném lại nguyên lỗi (người gọi quyết ý nghĩa — vd `goiAnToan`
 * đọc thành KHONG_RO). `phanLoai` biến kết quả thành dòng nhật ký.
 */
export async function goiCoNhatKy<T>(i: DauVaoLuotGoi & { goi: () => Promise<T>; phanLoai: (kq: T) => ReturnType<typeof phanLoaiKetQua> }): Promise<T> {
  let id: string;
  try {
    id = await themDongTruoc(i);
  } catch (e) {
    if (e instanceof LoiNhatKyLuotGoi) throw e;
    console.error(`[hoa-don-nhat-ky] không ghi được dòng trước · hoaDonId=${i.hoaDonId} · ${e instanceof Error ? e.message : String(e)}`);
    throw new LoiNhatKyLuotGoi(CAU_KHONG_GHI_DUOC_NHAT_KY);
  }
  const t0 = Date.now();
  let kq: T;
  try {
    kq = await i.goi();
  } catch (e) {
    await capNhatSau(id, {
      ketQua: "LOI_KY_THUAT",
      maNhaCungCap: null,
      thongDiep: rutThongDiepNhatKy(e instanceof Error ? `${e.name}: ${e.message}` : String(e)),
      doTreMs: Date.now() - t0,
    });
    throw e;
  }
  let p: ReturnType<typeof phanLoaiKetQua>;
  try {
    p = i.phanLoai(kq);
  } catch {
    p = { ketQua: "LOI_KY_THUAT", maNhaCungCap: null, thongDiep: "Không phân loại được kết quả để ghi nhật ký" };
  }
  await capNhatSau(id, { ...p, doTreMs: Date.now() - t0 });
  return kq;
}
