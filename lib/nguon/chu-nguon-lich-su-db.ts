/**
 * lib/nguon/chu-nguon-lich-su-db.ts — ĐỌC / GHI lịch sử chủ nguồn (`LeadSourceOwnerPeriod`). Hàm quyết định: `chu-nguon-lich-su.ts` (thuần).
 *
 * Ghi CHỈ qua hai hàm ở đây, và hai hàm này CHỈ được gọi từ `danh-muc-ghi.ts` (đường ghi `LeadSourceGroup.ownerEmployeeId` duy nhất, cùng transaction với việc đổi cột):
 *   · `ghiKhoiTaoChuNguon` — tạo nguồn CÓ chủ ⇒ khoảng KHỞI TẠO mở từ lúc tạo.
 *   · `ghiDoiChuNguon`     — đổi chủ (kể cả gỡ chủ) ⇒ ĐÓNG khoảng đang mở tại mốc hiệu lực, MỞ khoảng mới. Mốc KHÔNG lùi — và việc chống lùi nằm ở ĐÂY, ở ứng dụng: `kiemMocHieuLuc` (với `now` do SERVER cấp) +
 *     lưới `[OWN-W1..W3]` (một nơi ghi, hai hàm chỉ gọi từ `danh-muc-ghi.ts`). CHECK `…_khong_lui_chk` của DB (`effectiveFrom >= createdAt`) CHỈ là kiểm tra nhất quán nội tại, KHÔNG chống lùi ngày:
 *     `createdAt` do chính ứng dụng đặt (`ghiDoiChuNguon`: `createdAt = i.now`; `ghiKhoiTao`: `createdAt = i.tu`) nên ai đặt `createdAt` lùi thì CHECK qua theo — đừng dựa vào nó (08 §17.x mục 4).
 * Lịch sử BẤT BIẾN (trigger): không sửa, không xoá; chỉ đóng khoảng mở. Đổi chủ là THÊM dòng, không viết lại dòng nào — nên không có cách nào làm đổi tiền đã tính trong quá khứ.
 *
 * Gọi TRONG transaction đang giữ `FOR UPDATE` hàng nguồn (`khoaHangNguon`): hai lượt đổi chủ song song không đóng/mở chồng nhau.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { CAU_LOI_MOC_HIEU_LUC, kiemMocHieuLuc, type KhoangChu, type LoiMocHieuLuc } from "./chu-nguon-lich-su";

type Khach = PrismaClient | Prisma.TransactionClient;

/** Lỗi kiểm mốc hiệu lực — `danh-muc-ghi.ts` đổi thành `LoiGhiNguon` gắn vào ô «ngày hiệu lực». */
export class LoiMocChuNguon extends Error {
  constructor(readonly ma: LoiMocHieuLuc) {
    super(CAU_LOI_MOC_HIEU_LUC[ma]);
    this.name = "LoiMocChuNguon";
  }
}

export async function docLichSuChuNguon(client: Khach, groupId: string): Promise<KhoangChu[]> {
  const rows = await client.leadSourceOwnerPeriod.findMany({
    where: { groupId },
    orderBy: { effectiveFrom: "asc" },
    select: { id: true, ownerEmployeeId: true, kind: true, effectiveFrom: true, effectiveTo: true },
  });
  return rows.map((r) => ({ id: r.id, ownerEmployeeId: r.ownerEmployeeId, kind: r.kind, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
}

/** Nguồn MỚI TẠO có chủ: khoảng KHỞI TẠO mở từ `tu` (= `createdAt` của dòng nguồn — không có "quá khứ" nào để hồi tố). */
export async function ghiKhoiTaoChuNguon(tx: Prisma.TransactionClient, i: { groupId: string; ownerEmployeeId: string; tu: Date; setById: string }): Promise<void> {
  await tx.leadSourceOwnerPeriod.create({
    data: {
      groupId: i.groupId,
      ownerEmployeeId: i.ownerEmployeeId,
      kind: "KHOI_TAO",
      effectiveFrom: i.tu,
      createdAt: i.tu,
      setById: i.setById,
      reason: "Khởi tạo chủ nguồn lúc tạo nguồn.",
    },
  });
}

export async function ghiDoiChuNguon(
  tx: Prisma.TransactionClient,
  i: {
    groupId: string;
    /** `null` = gỡ chủ từ mốc này. */
    ownerMoi: string | null;
    /** BẮT BUỘC (luật 7): mốc hiệu lực. Chủ mới CHỈ áp cho giao dịch có NGÀY SỰ KIỆN (ngày thu đầu của lần mua) từ mốc này. */
    hieuLucTu: Date;
    setById: string;
    reason: string;
    now: Date;
  },
): Promise<{ khoangMoiId: string }> {
  const lichSu = await docLichSuChuNguon(tx, i.groupId);
  const loi = kiemMocHieuLuc({ lichSu, hieuLucTu: i.hieuLucTu, now: i.now });
  if (loi) throw new LoiMocChuNguon(loi);
  // ĐÓNG trước, MỞ sau: trigger chống chồng khoảng và chỉ mục "một khoảng mở mỗi nguồn" đòi đúng thứ tự này.
  const mo = lichSu.find((k) => k.effectiveTo === null);
  if (mo) await tx.leadSourceOwnerPeriod.update({ where: { id: mo.id }, data: { effectiveTo: i.hieuLucTu } });
  const r = await tx.leadSourceOwnerPeriod.create({
    data: {
      groupId: i.groupId,
      ownerEmployeeId: i.ownerMoi,
      kind: "DOI_CHU",
      effectiveFrom: i.hieuLucTu,
      createdAt: i.now,
      setById: i.setById,
      reason: i.reason,
    },
    select: { id: true },
  });
  return { khoangMoiId: r.id };
}
