import { z } from "zod";

import { db } from "@/lib/db";
import { mucSataCoinDangHien } from "@/lib/portal/muc-tam-an";
import { rateLimit } from "@/lib/rate-limit";
import { danhMucQuaChoHocVien, huyYeuCauDoiQua, LoiDoiQua, soDuVi, taoYeuCauDoiQua } from "@/lib/satacoin/doi-qua";

import { nhanThoiDiem } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * WP8 — đổi quà SataCoin cho phụ huynh (OD-02): danh mục · yêu cầu của bé · gửi (GIỮ coin) · huỷ khi chưa duyệt. TRUNG TÂM duyệt/hoàn tất (không phải ba mẹ) ở màn nhân sự web.
 * Mọi luật (giữ coin, tồn kho, khoá, idempotency) nằm ở `lib/satacoin/doi-qua.ts` — lớp này chỉ kiểm cờ, kiểm đầu vào và dịch lỗi. Cờ `PORTAL_SATACOIN_ENABLED` TẮT ⇒ 404 (cùng cờ với `GET /satacoin`).
 */
export type QuaDto = { id: string; ten: string; moTa: string | null; coin: number; conHang: boolean };
export type DanhMucQuaDto = { qua: QuaDto[]; soDu: number; dangGiu: number; khaDung: number };
export type TrangThaiDoiQua = "CHO_DUYET" | "DA_DUYET" | "DA_TRAO" | "TU_CHOI" | "DA_HUY";
export type YeuCauDoiQuaDto = { id: string; qua: string; coin: number; trangThai: TrangThaiDoiQua; nhan: string; ngayGui: string; huyDuoc: boolean };

const TRANG_THAI: Record<string, { ma: TrangThaiDoiQua; nhan: string }> = {
  REQUESTED: { ma: "CHO_DUYET", nhan: "Chờ trung tâm duyệt" },
  APPROVED: { ma: "DA_DUYET", nhan: "Trung tâm đã duyệt — chờ trao quà" },
  DELIVERED: { ma: "DA_TRAO", nhan: "Đã trao quà" },
  REJECTED: { ma: "TU_CHOI", nhan: "Trung tâm từ chối — đã hoàn coin" },
  CANCELLED: { ma: "DA_HUY", nhan: "Đã huỷ — đã hoàn coin" },
};

function batNeuTat() {
  if (!mucSataCoinDangHien()) throw new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
}

export async function layDanhMucQua(hs: MaHocVienDaKiem): Promise<DanhMucQuaDto> {
  batNeuTat();
  const [qua, vi] = await Promise.all([danhMucQuaChoHocVien(hs), soDuVi(db, hs)]);
  return { qua, ...vi };
}

export async function layYeuCauDoiQua(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<{ yeuCau: YeuCauDoiQuaDto[] }> {
  batNeuTat();
  const ds = await db.sataCoinRedemption.findMany({ where: { studentId: hs }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, coinCost: true, status: true, createdAt: true, gift: { select: { name: true } } } });
  return {
    yeuCau: ds.map((r) => ({ id: r.id, qua: r.gift.name, coin: r.coinCost, trangThai: TRANG_THAI[r.status]!.ma, nhan: TRANG_THAI[r.status]!.nhan, ngayGui: nhanThoiDiem(r.createdAt.toISOString(), now), huyDuoc: r.status === "REQUESTED" })),
  };
}

export const guiDoiQuaSchema = z.object({
  giftId: z.string().min(1).max(64),
  // Khoá gửi lại do app sinh MỘT lần cho mỗi lần bấm «Đổi quà»; mất mạng ⇒ gửi lại CÙNG khoá, không giữ thêm coin.
  idempotencyKey: z.string().min(8, "Thiếu khoá gửi lại.").max(64),
});
export type GuiDoiQuaInput = z.infer<typeof guiDoiQuaSchema>;

function dich(e: unknown): never {
  if (e instanceof LoiDoiQua) {
    const nhom: Record<string, [number, "NOT_FOUND" | "VALIDATION"]> = {
      KHONG_TIM_THAY_HOC_VIEN: [404, "NOT_FOUND"],
      KHONG_TIM_THAY_QUA: [404, "NOT_FOUND"],
      KHONG_TIM_THAY_YEU_CAU: [404, "NOT_FOUND"],
      KHOA_GUI_LAI_KHAC_QUA: [400, "VALIDATION"],
    };
    const [status, code] = nhom[e.ma] ?? [409, "VALIDATION"]; // không đủ coin / hết quà / sai trạng thái / chưa có cơ sở
    throw new LoiApiMobile(code, status, e.message);
  }
  throw e;
}

/** B-RL1: trần riêng cho «gửi yêu cầu đổi quà» — 20 lượt / 10 phút theo PHỤ HUYNH (gồm cả gửi lại cùng khoá). Trước đây chỉ bị chặn bởi số dư / tồn kho / idempotency. Cố ý rộng: người dùng thật chỉ gửi vài lượt. */
export const GIOI_HAN_GUI_DOI_QUA = { max: 20, windowMs: 10 * 60_000 } as const;

export async function guiDoiQua(hs: MaHocVienDaKiem, parentUserId: string, input: GuiDoiQuaInput): Promise<{ id: string; trungLap: boolean; trangThai: TrangThaiDoiQua }> {
  batNeuTat();
  const rl = await rateLimit({ key: `gift-redemption:${parentUserId}`, max: GIOI_HAN_GUI_DOI_QUA.max, windowMs: GIOI_HAN_GUI_DOI_QUA.windowMs });
  if (!rl.success) throw new LoiApiMobile("RATE_LIMITED", 429, "Bạn gửi yêu cầu đổi quà quá nhanh. Vui lòng thử lại sau ít phút.", Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)));
  try {
    const { yeuCau, trungLap } = await taoYeuCauDoiQua({ studentId: hs, giftId: input.giftId, requestedByUserId: parentUserId, idempotencyKey: input.idempotencyKey });
    return { id: yeuCau.id, trungLap, trangThai: TRANG_THAI[yeuCau.status]!.ma };
  } catch (e) {
    return dich(e);
  }
}

export async function huyDoiQua(hs: MaHocVienDaKiem, redemptionId: string): Promise<{ id: string; trangThai: TrangThaiDoiQua }> {
  batNeuTat();
  try {
    const yc = await huyYeuCauDoiQua({ studentId: hs, redemptionId });
    return { id: yc.id, trangThai: TRANG_THAI[yc.status]!.ma };
  } catch (e) {
    return dich(e);
  }
}
