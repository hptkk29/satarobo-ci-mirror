// lib/bao-luu/tran-bao-luu-db.ts — đọc trần `enrollment.suspendMaxMonths` THEO CƠ SỞ. PHIÊN 1.
//
// Một chỗ cho mọi đường bảo lưu (màn quản trị + duyệt yêu cầu phụ huynh), thay cho đoạn
// "tìm OrgUnit của cơ sở rồi `getSetting`" từng chép tay trong `reserve-service.ts`.
//
// `db` trần là đúng: đây là tra CẤU HÌNH (không có dữ liệu người dùng để cách ly), và OrgUnit nằm
// ngoài tầm `scopedDb`. Tên khoá tái dùng làm `pause.maxMonths` (chốt 07/10/2026 — không đẻ khoá trùng).
import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";

export async function layTranBaoLuuThang(centerId: string | null | undefined): Promise<number> {
  const orgUnitId = centerId
    ? (await db.orgUnit.findFirst({ where: { centerId }, select: { id: true } }))?.id ?? null
    : null;
  return getSetting("enrollment.suspendMaxMonths", { orgUnitId });
}
