import "server-only";
import { notifyStaff } from "@/lib/notifications/notify";
import { timKeToan } from "../nhac-ke-toan-db";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";
import { dungThongBaoHanMuc, type NhomHanMuc } from "./bao-han-muc";

// lib/finance/hoa-don/ky-chinh-sach/bao-han-muc-db.ts — GOM kết quả hạn mức trong MỘT lượt chạy của runner (lô 23h / tự xuất) rồi BÁO một lần cuối lượt.
// Cảnh báo là việc phụ: lỗi gửi thông báo KHÔNG được làm hỏng lượt phát hành (nuốt lỗi, trả 0) — hoá đơn đã được giữ lại an toàn ở «Chờ xuất» dù tin có tới hay không.

type Nhom = { phapNhanMa: string; phapNhanTen: string; soCho: number; tanSuatCao: boolean; coSo: Set<string> };
export type GomHanMuc = Map<string, Nhom>;

export const gomHanMucMoi = (): GomHanMuc => new Map();

function nhom(g: GomHanMuc, phapNhanMa: string, phapNhanTen: string): Nhom {
  const ten = phapNhanTen || cauHinhHoaDonChoMoiTruong().phapNhan.find((p) => p.ma === phapNhanMa)?.ten || "";
  const n = g.get(phapNhanMa) ?? { phapNhanMa, phapNhanTen: ten, soCho: 0, tanSuatCao: false, coSo: new Set<string>() };
  g.set(phapNhanMa, n);
  return n;
}

/** Một lần thu CHƯA tự phát hành vì chạm hạn mức / tạm dừng. */
export function ghiNhanChoHanMuc(g: GomHanMuc, i: { phapNhanMa: string; phapNhanTen?: string; coSoId: string }): void {
  const n = nhom(g, i.phapNhanMa, i.phapNhanTen ?? "");
  n.soCho += 1;
  n.coSo.add(i.coSoId);
}

/** Hoá đơn VỪA tạo mà tần suất đã vượt ngưỡng cảnh báo (không chặn). */
export function ghiNhanTanSuatCao(g: GomHanMuc, i: { phapNhanMa: string; phapNhanTen?: string; coSoId: string }): void {
  const n = nhom(g, i.phapNhanMa, i.phapNhanTen ?? "");
  n.tanSuatCao = true;
  n.coSo.add(i.coSoId);
}

/** Báo cuối lượt. Trả số người đã nhận tin; lỗi ⇒ 0 (không ném). */
export async function baoHanMuc(g: GomHanMuc, now: Date): Promise<number> {
  if (g.size === 0) return 0;
  try {
    const ds: NhomHanMuc[] = [...g.values()].map((n) => ({ phapNhanMa: n.phapNhanMa, phapNhanTen: n.phapNhanTen, soCho: n.soCho, tanSuatCao: n.tanSuatCao, coSoIds: [...n.coSo] }));
    const tb = dungThongBaoHanMuc({ nhom: ds, nguoiNhan: await timKeToan(now), now });
    let nhan = 0;
    for (const t of tb) nhan += await notifyStaff(t);
    return nhan;
  } catch {
    return 0;
  }
}
