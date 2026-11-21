// lib/parttime/viec-ngay-db.ts — ĐỌC việc theo phân công (người × ngày) cho Bảng công ngày / Bảng công site GV. CHỈ ĐỌC.
//
// Đọc bằng ĐÚNG hai bộ đọc của màn Phân công, theo cùng cách màn đó gọi (`man-gop.tsx`): `docLuoiGop` một lần cho cơ sở × khoảng ngày,
// rồi `docLuoiTuan` ĂN CHÍNH lưới gộp ấy (một bản đồ ca / ghép). Mã ô và tiền vì thế là của màn Phân công — không có phép tính thứ hai.
// Ô của một ngày chỉ phụ thuộc chính ngày đó (`tinhMaO` / `tinhCaDuKien` theo người × ngày × ca), nên cửa sổ ngày (1 ngày / 1 tháng) không
// đổi số của từng ngày so với màn tuần.
//
// `db` trần (qua hai bộ đọc trên): phạm vi do nơi gọi chốt — trang admin đã kiểm `hr_attendance:view` cho đúng cơ sở; site GV chỉ lấy dòng
// của CHÍNH người đăng nhập. Loại hợp đồng đọc KHÔNG scope: GV mượn từ cơ sở khác bị `scopedDb` che hồ sơ thì `contractType` thành null và
// dòng rơi về công ô ca — đúng lỗi đang sửa.
import "server-only";
import type { ContractType } from "@prisma/client";
import { db } from "@/lib/db";
import { docLuoiGop } from "@/lib/phan-cong/luoi-gop-db";
import { docLuoiTuan } from "./luoi-tuan-db";
import { TRANG_THAI_SONG } from "./phan-cong";
import { viecTheoNgay, type LuoiCoSo, type ViecNgay } from "./viec-ngay";

/** Việc theo phân công (người × ngày) ở `centerIds` trong `tu..den` ("YYYY-MM-DD"). `userIds` BẮT BUỘC (luật 7). */
export async function docViecParttime(p: { centerIds: readonly string[]; tu: string; den: string; now: Date; userIds: readonly string[] | "TAT_CA" }): Promise<ViecNgay[]> {
  if (!p.centerIds.length) return [];
  const luoi: LuoiCoSo[] = await Promise.all(
    p.centerIds.map(async (centerId) => {
      const gop = await docLuoiGop({ centerId, tu: p.tu, den: p.den });
      const tuan = await docLuoiTuan({ centerId, tu: p.tu, den: p.den, now: p.now, luoiGop: gop });
      return { centerId, gop: gop.dong, tuan: tuan.dong };
    }),
  );
  return viecTheoNgay(luoi, p.userIds);
}

/** `Employee.contractType` theo userId (null = không có hồ sơ / chưa khai). Đọc KHÔNG scope — xem đầu tệp. */
export async function docLoaiHopDong(userIds: readonly string[]): Promise<Map<string, ContractType | null>> {
  if (!userIds.length) return new Map();
  const us = await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, employee: { select: { contractType: true } } } });
  return new Map(us.map((u) => [u.id, u.employee?.contractType ?? null]));
}

/** Cơ sở có phân công dạy / trực CÒN SỐNG của một người trong `tu..den` — site GV gộp việc mọi cơ sở. */
export async function docCoSoCoPhanCong(userId: string, tu: string, den: string): Promise<string[]> {
  const khoang = { gte: new Date(`${tu}T00:00:00.000Z`), lte: new Date(`${den}T00:00:00.000Z`) };
  const [pc, truc] = await Promise.all([
    db.sessionStaffAssignment.findMany({ where: { userId, ngay: khoang, status: { in: [...TRANG_THAI_SONG] } }, select: { centerId: true }, distinct: ["centerId"] }),
    db.operationsDutyAssignment.findMany({ where: { userId, workDate: khoang, status: { in: [...TRANG_THAI_SONG] } }, select: { centerId: true }, distinct: ["centerId"] }),
  ]);
  return [...new Set([...pc.map((x) => x.centerId), ...truc.map((x) => x.centerId)])].sort();
}

