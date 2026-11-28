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
  luuCheckin,
  luuNhap,
  luuThanhVien,
  nopBaiSo,
  phatDeCho,
  taoKeHoach,
  taoSo,
  tickViec,
  xoaBaiLam,
  xoaThanhVien,
  type DeDangLam,
  type KetQua,
  type KetQuaNopBaiSo,
  type Rong,
} from "@/lib/disc/so-gia-dinh/ghi";

import { datHoacDoiPin, docTrangThaiPin, khoaLai, moKhoa, vaoCheDoTreEm, type BoiCanhDisc, type TrangThaiPinDto } from "@/lib/disc/so-gia-dinh/mo-khoa";

import { datCookieMoKhoa, docPhienDisc, xoaCookieMoKhoa, type YeuCauPhienDisc } from "./_lib/phien-disc";

export type KetQuaAction<T = Rong> = ({ ok: true } & T) | { ok: false; error: string; loi?: string };

/**
 * V8.31 — MỌI action đi qua đây và PHẢI khai phạm vi (`yc`). Phiên bị chặn vì chưa mở khoá ⇒ `{ok:false, loi:"DISC_CHUA_MO_KHOA"|…}` để UI đưa người dùng tới màn «Nhập PIN» (không lộ dữ liệu).
 */
async function voiPhien<T>(yc: YeuCauPhienDisc, fn: (userId: string, ctx: BoiCanhDisc) => Promise<KetQuaAction<T>>): Promise<KetQuaAction<T>> {
  const phien = await docPhienDisc(yc);
  if (!phien.ok) {
    if (phien.loai === "CO_TAT") return { ok: false, error: "Tính năng chưa mở." };
    if (phien.loai === "CHUA_DANG_NHAP") return { ok: false, error: "Bạn cần đăng nhập để thực hiện." };
    return { ok: false, error: phien.thongBao ?? "Cần nhập mã PIN để mở sổ DISC.", loi: phien.ma ?? "DISC_CHUA_MO_KHOA" };
  }
  return fn(phien.userId, phien.ctx);
}

/** `thanhVienId` trong đầu vào thô (chỉ để KHAI PHẠM VI «làm bài của MỘT thành viên»; domain vẫn kiểm sổ sở hữu). */
const thanhVienCua = (input: unknown): string | undefined => {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>).thanhVienId : undefined;
  return typeof v === "string" ? v : undefined;
};

/** Chuyển kết quả của lib (`KetQua<T>`: `{ok:true}&T` | `{ok:false, loi, thongBao}`) sang kiểu action (`error` thay cho `thongBao`). */
function dich<T extends object>(r: KetQua<T>): KetQuaAction<T> {
  return r.ok ? r : { ok: false, error: r.thongBao, loi: r.loi };
}

const lamMoi = () => {
  revalidatePath("/portal/disc");
};

export async function taoSoGiaDinhAction(input: unknown): Promise<KetQuaAction<{ giaDinhId: string; soGoiY: number }>> {
  return voiPhien({ phamVi: "KHONG" }, async (userId) => {
    const r = dich(await taoSo(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function luuThanhVienAction(input: unknown): Promise<KetQuaAction<{ id: string; moi: boolean }>> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await luuThanhVien(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function xoaThanhVienAction(input: unknown): Promise<KetQuaAction<{ daXoaBai: number; daGiuBai: number }>> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await xoaThanhVien(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function phatDeAction(input: unknown): Promise<KetQuaAction<{ de: DeDangLam }>> {
  return voiPhien({ phamVi: "LAM_BAI", thanhVienId: thanhVienCua(input) }, async (userId) => dich(await phatDeCho(userId, input, new Date())));
}

export async function luuNhapAction(input: unknown): Promise<KetQuaAction<{ daLam: number }>> {
  return voiPhien({ phamVi: "LAM_BAI", thanhVienId: thanhVienCua(input) }, async (userId) => dich(await luuNhap(userId, input, new Date())));
}

export async function nopBaiAction(input: unknown): Promise<KetQuaAction<KetQuaNopBaiSo>> {
  return voiPhien({ phamVi: "LAM_BAI", thanhVienId: thanhVienCua(input) }, async (userId) => {
    const r = dich(await nopBaiSo(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function xoaBaiLamAction(baiId: unknown): Promise<KetQuaAction> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await xoaBaiLam(userId, baiId, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function chayPhanTichAction(): Promise<KetQuaAction<{ soBan: number | null; moi: boolean }>> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await chayPhanTich(userId, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function taoKeHoachAction(input: unknown): Promise<KetQuaAction<{ keHoachId: string; soViec: number }>> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await taoKeHoach(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function tickViecAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await tickViec(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function camOnViecAction(input: unknown): Promise<KetQuaAction> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await camOnViec(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

export async function luuCheckinAction(input: unknown): Promise<KetQuaAction<{ lyDo: readonly string[]; soViecTuan: number; doKho: number; them1_1: number }>> {
  return voiPhien({ phamVi: "GHI" }, async (userId) => {
    const r = dich(await luuCheckin(userId, input, new Date()));
    if (r.ok) lamMoi();
    return r;
  });
}

/** Trạng thái PIN tối thiểu (không chứa dữ liệu DISC). */
export async function trangThaiPinAction(): Promise<KetQuaAction<{ trangThai: TrangThaiPinDto }>> {
  return voiPhien({ phamVi: "KHONG" }, async (_userId, ctx) => {
    const r = await docTrangThaiPin(ctx);
    return r.ok ? r : { ok: false, error: r.thongBao, loi: r.loi };
  });
}

/** ĐẶT lần đầu `{pin}` hoặc ĐỔI `{pin, pinCu}` | `{pin, matKhau}` (đổi PIN thu hồi mọi phiên mở khoá ⇒ xoá cookie của chính trình duyệt này). */
export async function datPinAction(input: unknown): Promise<KetQuaAction<{ hanhDong: "DAT" | "DOI"; goKhoa: boolean }>> {
  return voiPhien({ phamVi: "KHONG" }, async (_userId, ctx) => {
    const r = await datHoacDoiPin(ctx, input);
    if (!r.ok) return { ok: false, error: r.thongBao, loi: r.loi };
    if (r.hanhDong === "DOI") await xoaCookieMoKhoa();
    lamMoi();
    return r;
  });
}

/** MỞ KHOÁ bằng `{pin}` | `{matKhau}`: thành công ⇒ cookie HttpOnly (token ngẫu nhiên, máy chủ chỉ giữ băm). Thoát «chế độ trẻ em» = gọi lại hàm này. */
export async function xacNhanPinAction(input: unknown): Promise<KetQuaAction<{ cheDo: "DAY_DU"; hetHanTuyetDoiLuc: string; idleGiay: number }>> {
  return voiPhien({ phamVi: "KHONG" }, async (_userId, ctx): Promise<KetQuaAction<{ cheDo: "DAY_DU"; hetHanTuyetDoiLuc: string; idleGiay: number }>> => {
    const r = await moKhoa(ctx, input);
    if (!r.ok) return { ok: false, error: r.thongBao, loi: r.loi };
    if (r.tokenWebTho) await datCookieMoKhoa(r.tokenWebTho, new Date(r.hetHanTuyetDoiLuc));
    lamMoi();
    return { ok: true, cheDo: r.cheDo, hetHanTuyetDoiLuc: r.hetHanTuyetDoiLuc, idleGiay: r.idleGiay };
  });
}

/** KHOÁ LẠI: thu hồi phiên mở khoá của trình duyệt này và xoá cookie. */
export async function khoaLaiDiscAction(): Promise<KetQuaAction> {
  return voiPhien({ phamVi: "KHONG" }, async (_userId, ctx) => {
    const r = await khoaLai(ctx);
    await xoaCookieMoKhoa();
    lamMoi();
    return r.ok ? { ok: true } : { ok: false, error: r.thongBao, loi: r.loi };
  });
}

/** CHẾ ĐỘ TRẺ EM: hạ phiên xuống «chỉ làm bài của MỘT thành viên» (cờ ép máy chủ TẮT ⇒ không làm gì, trả lỗi `DISC_KHONG_DU_QUYEN`). */
export async function vaoCheDoTreEmAction(input: unknown): Promise<KetQuaAction<{ thanhVienId: string }>> {
  return voiPhien({ phamVi: "GHI" }, async (_userId, ctx) => {
    const tv = input && typeof input === "object" ? (input as Record<string, unknown>).thanhVienId : undefined;
    const r = await vaoCheDoTreEm(ctx, tv);
    return r.ok ? r : { ok: false, error: r.thongBao, loi: r.loi };
  });
}
