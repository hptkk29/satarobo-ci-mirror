"use server";

/**
 * SERVER ACTION của SỔ GIA ĐÌNH DISC (cổng phụ huynh). Thứ tự cố định ở MỌI action (luật 5):
 *   phiên (cờ DISC_ENABLED → đăng nhập → vai PARENT; `userId` CHỈ lấy từ phiên) → zod → quyền sở hữu sổ (trong lib/disc/so-gia-dinh/ghi.ts) → ghi → audit.
 * Không có `assertCan`: quyền ở đây là QUYỀN SỞ HỮU (`DiscGiaDinh.ownerUserId = userId`), như phần đọc ở `lib/disc/so-gia-dinh/doc.ts`
 * và vai quan hệ PARENT (không đẻ permission mới). Nhân viên SataRobo (mọi vai) KHÔNG có đường vào các action này.
 * Id lạ ≡ id của sổ người khác ≡ không tồn tại ⇒ cùng một thông điệp.
 */
import { revalidatePath } from "next/cache";

import {
  camOnViec,
  chayPhanTich,
  datPin,
  luuCheckin,
  luuNhap,
  luuThanhVien,
  nopBaiSo,
  phatDeCho,
  taoKeHoach,
  taoSo,
  tickViec,
  xacNhanPin,
  xoaBaiLam,
  xoaThanhVien,
  type DeDangLam,
  type KetQua,
  type KetQuaNopBaiSo,
  type Rong,
} from "@/lib/disc/so-gia-dinh/ghi";

import { docPhienDisc } from "./_lib/phien-disc";

export type KetQuaAction<T = Rong> = ({ ok: true } & T) | { ok: false; error: string; loi?: string };

async function voiPhien<T>(fn: (userId: string) => Promise<KetQuaAction<T>>): Promise<KetQuaAction<T>> {
  const phien = await docPhienDisc();
  if (!phien.ok) return { ok: false, error: phien.loai === "CO_TAT" ? "Tính năng chưa mở." : "Bạn cần đăng nhập để thực hiện." };
  return fn(phien.userId);
}

/** Chuyển kết quả của lib (`KetQua<T>`: `{ok:true}&T` | `{ok:false, loi, thongBao}`) sang kiểu action (`error` thay cho `thongBao`). */
function dich<T extends object>(r: KetQua<T>): KetQuaAction<T> {
  return r.ok ? r : { ok: false, error: r.thongBao, loi: r.loi };
}

const lamMoi = () => {
  revalidatePath("/portal/disc");
};

export async function taoSoGiaDinhAction(input: unknown): Promise<KetQuaAction<{ giaDinhId: string; soGoiY: number }>> {
  return voiPhien(async (userId) => {
    const r = dich(await taoSo(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function luuThanhVienAction(input: unknown): Promise<KetQuaAction<{ id: string; moi: boolean }>> {
  return voiPhien(async (userId) => {
    const r = dich(await luuThanhVien(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function xoaThanhVienAction(input: unknown): Promise<KetQuaAction<{ daXoaBai: number; daGiuBai: number }>> {
  return voiPhien(async (userId) => {
    const r = dich(await xoaThanhVien(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function phatDeAction(input: unknown): Promise<KetQuaAction<{ de: DeDangLam }>> {
  return voiPhien(async (userId) => dich(await phatDeCho(userId, input, new Date())));
}

export async function luuNhapAction(input: unknown): Promise<KetQuaAction<{ daLam: number }>> {
  return voiPhien(async (userId) => dich(await luuNhap(userId, input, new Date())));
}

export async function nopBaiAction(input: unknown): Promise<KetQuaAction<KetQuaNopBaiSo>> {
  return voiPhien(async (userId) => {
    const r = dich(await nopBaiSo(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function xoaBaiLamAction(baiId: unknown): Promise<KetQuaAction> {
  return voiPhien(async (userId) => {
    const r = dich(await xoaBaiLam(userId, baiId, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function chayPhanTichAction(): Promise<KetQuaAction<{ soBan: number | null; moi: boolean }>> {
  return voiPhien(async (userId) => {
    const r = dich(await chayPhanTich(userId, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function taoKeHoachAction(input: unknown): Promise<KetQuaAction<{ keHoachId: string; soViec: number }>> {
  return voiPhien(async (userId) => {
    const r = dich(await taoKeHoach(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function tickViecAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien(async (userId) => {
    const r = dich(await tickViec(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function camOnViecAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien(async (userId) => {
    const r = dich(await camOnViec(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function luuCheckinAction(input: unknown): Promise<KetQuaAction<{ lyDo: readonly string[]; soViecTuan: number; doKho: number; them1_1: number }>> {
  return voiPhien(async (userId) => {
    const r = dich(await luuCheckin(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function datPinAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien(async (userId) => {
    const r = dich(await datPin(userId, input));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function xacNhanPinAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien(async (userId) => dich(await xacNhanPin(userId, input, new Date())));
}
