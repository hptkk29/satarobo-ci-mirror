// lib/parttime/don-loi-moi-db.ts — ĐỌC lời mời cũ cho lệnh dọn (`don-loi-moi.ts`). Đường GHI `apDungDon` nằm ở cửa ghi duy nhất
// `phan-cong-db.ts` (lưới [PT3-W-DG2]): updateMany có điều kiện còn WAITING_ACCEPTANCE, một audit mỗi dòng, 0 xác nhận, 0 thông báo.
import "server-only";
import { db } from "@/lib/db";
import type { LoiMoiCu } from "./don-loi-moi";

export async function docLoiMoiCu(centerIds: readonly string[]): Promise<(LoiMoiCu & { gio: string; ten: string; centerId: string })[]> {
  const pcs = await db.sessionStaffAssignment.findMany({
    where: { centerId: { in: [...centerIds] }, status: "WAITING_ACCEPTANCE" },
    orderBy: [{ ngay: "asc" }, { gioBatDau: "asc" }],
    select: { id: true, userId: true, role: true, sourceType: true, sourceId: true, ngay: true, gioBatDau: true, centerId: true },
  });
  const ids = (t: string) => pcs.filter((x) => x.sourceType === t).map((x) => x.sourceId);
  const [lop, trial, bu, nguoi] = await Promise.all([
    db.classSession.findMany({ where: { id: { in: ids("CLASS_SESSION") } }, select: { id: true, status: true } }),
    db.trialClassSession.findMany({ where: { id: { in: ids("TRIAL_SESSION") } }, select: { id: true, status: true } }),
    db.makeupCase.findMany({ where: { id: { in: ids("MAKEUP_CASE") } }, select: { id: true, status: true } }),
    db.user.findMany({ where: { id: { in: pcs.map((x) => x.userId) } }, select: { id: true, name: true } }),
  ]);
  const tt = new Map<string, string>([...lop, ...trial, ...bu].map((x) => [x.id, String(x.status)]));
  const ten = new Map(nguoi.map((u) => [u.id, u.name ?? u.id]));
  return pcs.map((x) => ({
    id: x.id,
    userId: x.userId,
    role: x.role,
    sourceType: x.sourceType,
    ngay: x.ngay.toISOString().slice(0, 10), // cột @db.Date ghi ngày VN lúc nửa đêm UTC (phanCongVaoBuoi)
    trangThaiBuoi: tt.get(x.sourceId) ?? null,
    gio: x.gioBatDau,
    ten: ten.get(x.userId) ?? x.userId,
    centerId: x.centerId,
  }));
}

export { apDungDon } from "./phan-cong-db";
