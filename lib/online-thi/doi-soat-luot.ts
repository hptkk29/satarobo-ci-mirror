import type { PrismaClient } from "@prisma/client";

import { doiSoatLuotQuaHan } from "@/lib/elearning-online/luot-nhap-db";

/**
 * SCHEDULER TỰ CHỐT LƯỢT THI ONLINE QUÁ HẠN (V8.45, Workstream A) — lớp vận hành quanh `doiSoatLuotQuaHan` của lõi E (E KHÔNG tự lên lịch).
 *
 *  · ĐỒNG HỒ MÁY CHỦ: `now` do người gọi (cron) truyền, không bao giờ từ client.
 *  · CHẠY BÙ: lõi quét MỌI lượt `IN_PROGRESS` có `dueAt + 60 s ≤ now` (không có cận dưới, không chờ sự kiện) ⇒ sau khi máy chủ/cron chết nhiều giờ, lượt tồn đọng được chốt ở tick kế tiếp.
 *  · IDEMPOTENT + AN TOÀN SONG SONG: mỗi lượt một giao dịch `FOR UPDATE SKIP LOCKED`; hai worker không chấm trùng.
 *  · THỬ LẠI: lượt lỗi vẫn `IN_PROGRESS` ⇒ tick sau gặp lại. Lượt lỗi đứng đầu `ORDER BY dueAt` nên trong MỘT tick vòng lặp phải DỪNG khi một vòng không tiến triển
 *    (nếu không sẽ quay tại chỗ — giới hạn của lõi, đã báo E), và có TRẦN số vòng.
 *  · KHÔNG GHI thay đổi quyền (Nền Hệ thống #8): chỉ chốt/chấm lượt.
 */
export type KetQuaDoiSoat = {
  daChot: number;
  hetHanKhongNhap: number;
  boQua: number;
  loi: { attemptId: string; thongBao: string }[];
  /** true ⇒ còn lượt quá hạn chưa xử lý khi dừng (đụng trần vòng, hoặc bị kẹt vì lỗi) — tick sau xử lý tiếp. */
  conLai: boolean;
  soVong: number;
};

export const GIOI_HAN_MOI_VONG = 200;
export const TRAN_SO_VONG = 20;

export async function chayDoiSoatLuotQuaHan(
  db: PrismaClient,
  o: { now: () => Date; gioiHan?: number; tranVong?: number },
): Promise<KetQuaDoiSoat> {
  const gioiHan = o.gioiHan ?? GIOI_HAN_MOI_VONG;
  const tran = o.tranVong ?? TRAN_SO_VONG;
  const kq: KetQuaDoiSoat = { daChot: 0, hetHanKhongNhap: 0, boQua: 0, loi: [], conLai: false, soVong: 0 };
  for (let i = 0; i < tran; i++) {
    const r = await doiSoatLuotQuaHan(db, { now: o.now(), gioiHan });
    kq.soVong++;
    kq.daChot += r.daChot;
    kq.hetHanKhongNhap += r.hetHanKhongNhap;
    kq.boQua += r.boQua;
    kq.loi.push(...r.loi);
    kq.conLai = r.conLai;
    if (!r.conLai) break;
    if (r.daChot + r.hetHanKhongNhap === 0) break; // không tiến triển (lỗi/khoá) ⇒ dừng, để tick sau thử lại
  }
  return kq;
}
