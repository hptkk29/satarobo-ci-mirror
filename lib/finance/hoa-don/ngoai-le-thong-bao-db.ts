import "server-only";
import { db } from "@/lib/db";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { notifyStaff } from "@/lib/notifications/notify";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";
import { dungThongBaoTucThoi, type LoaiTucThoi, type MucNgoaiLe } from "./ngoai-le-tuc-thoi";
import { dungThongBaoNgoaiLe, type MoiTheoCoSo } from "./quet-nghia-vu-thong-bao";
import { QUYEN_KE_TOAN_HOA_DON } from "./quyen";

// lib/finance/hoa-don/ngoai-le-thong-bao-db.ts — GỬI CHUÔNG ngoại lệ hoá đơn theo từng cơ sở: bản gom theo ngày cho scanner định kỳ (S8, `quet-nghia-vu-db.ts`) và bản riêng từng ngoại lệ cho đường báo
// TỨC THỜI (`ngoai-le-tuc-thoi-db.ts`). Cả hai: MỘT luật người nhận (người giữ `payments:confirm` TẠI cơ sở đó, kể cả người neo vai ở đơn vị cha), MỘT nội dung (chỉ số đếm, không PII).

/** Cửa sổ chuông: ngoại lệ tạo trong N phút gần nhất. Lượt sau gửi lại cùng khoá + cùng nội dung ⇒ hệ thông báo không rung lại. */
export const CUA_SO_CHUONG_PHUT = 60;

/**
 * Báo kế toán TỪNG cơ sở về ngoại lệ tạo trong `CUA_SO_CHUONG_PHUT` gần nhất. Dựa vào DỮ LIỆU (không phải "mới trong lượt này"): tiến trình chết đúng giữa
 * lúc commit và lúc gửi thì lượt sau gửi bù; gửi lại cùng khoá + cùng nội dung thì hệ thông báo không rung lại. Người nhận = người giữ
 * `payments:confirm` TẠI cơ sở đó (kể cả người neo vai ở đơn vị cha) — dữ liệu quyền, không gõ cứng vai, không chéo cơ sở.
 */
export async function guiThongBaoNgoaiLe(now: Date): Promise<{ thongBao: number; loiThongBao: number }> {
  const tu = new Date(now.getTime() - CUA_SO_CHUONG_PHUT * 60_000);
  const moi = await db.hoaDonNgoaiLe.groupBy({
    by: ["centerId", "muc"],
    where: { createdAt: { gte: tu }, trangThai: "MO" },
    _count: { _all: true },
  });
  if (moi.length === 0) return { thongBao: 0, loiThongBao: 0 };
  const coSoIds = [...new Set(moi.map((m) => m.centerId))];
  const [dangMo, trungTam] = await Promise.all([
    db.hoaDonNgoaiLe.groupBy({ by: ["centerId"], where: { centerId: { in: coSoIds }, trangThai: { in: ["MO", "DANG_XU_LY"] } }, _count: { _all: true } }),
    db.center.findMany({ where: { id: { in: coSoIds } }, select: { id: true, name: true } }),
  ]);
  const tenCoSo = new Map(trungTam.map((c) => [c.id, c.name] as const));
  const demMo = new Map(dangMo.map((m) => [m.centerId, m._count._all] as const));
  const coSo: MoiTheoCoSo[] = coSoIds.map((centerId) => {
    const cua = moi.filter((m) => m.centerId === centerId);
    return {
      centerId,
      ten: tenCoSo.get(centerId) ?? centerId,
      moi: cua.reduce((s, m) => s + m._count._all, 0),
      khan: cua.filter((m) => m.muc === "KHAN").reduce((s, m) => s + m._count._all, 0),
      dangMo: demMo.get(centerId) ?? 0,
    };
  });
  const nguoiNhanTheoCoSo = new Map<string, string[]>();
  for (const id of coSoIds) nguoiNhanTheoCoSo.set(id, await nguoiGiuQuyenTaiCoSo(id, [QUYEN_KE_TOAN_HOA_DON]));
  const tb = dungThongBaoNgoaiLe({ coSo, nguoiNhanTheoCoSo, ngay: ngayVN(now) });
  let thongBao = 0;
  let loiThongBao = 0;
  for (const t of tb) {
    try {
      await notifyStaff(t);
      thongBao += 1;
    } catch {
      loiThongBao += 1;
    }
  }
  return { thongBao, loiThongBao };
}

/**
 * Chuông của MỘT ngoại lệ tức thời (khoá riêng theo ngoại lệ — xem `dungThongBaoTucThoi`). Cùng luật người nhận với scanner: người giữ `payments:confirm` TẠI cơ sở đó.
 * Ném lỗi lên người gọi (`baoNgoaiLeTucThoi` bắt và đếm); không có người nhận ⇒ không gửi gì.
 */
export async function guiThongBaoTucThoi(input: { ngoaiLeId: string; centerId: string; loai: LoaiTucThoi; muc: MucNgoaiLe }): Promise<{ thongBao: number; loiThongBao: number }> {
  const [co, nguoiNhan] = await Promise.all([
    db.center.findUnique({ where: { id: input.centerId }, select: { name: true } }),
    nguoiGiuQuyenTaiCoSo(input.centerId, [QUYEN_KE_TOAN_HOA_DON]),
  ]);
  const tb = dungThongBaoTucThoi({ ngoaiLeId: input.ngoaiLeId, loai: input.loai, muc: input.muc, tenCoSo: co?.name ?? input.centerId, nguoiNhan });
  if (!tb) return { thongBao: 0, loiThongBao: 0 };
  try {
    await notifyStaff(tb);
    return { thongBao: 1, loiThongBao: 0 };
  } catch {
    return { thongBao: 0, loiThongBao: 1 };
  }
}
