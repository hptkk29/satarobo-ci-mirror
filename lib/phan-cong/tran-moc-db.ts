// lib/phan-cong/tran-moc-db.ts — TRẦN SỐ MỐC VÀO/RA được sửa trong MỘT ngày (GĐ6, chốt 9: "trần mốc = số cặp kỳ vọng × 2, không hằng
// 4"). MỘT chỗ đọc cho mọi đường sửa giờ quét (QLCS sửa tay · đơn chỉnh công · duyệt phản ánh) và cho hộp sửa giờ của màn chấm công.
//
//   · kỳ đi luật CŨ (cờ `shift.parttimeLuatCongMoiTuKy`) ⇒ hằng cũ `SO_MOC_TOI_DA` (4) — kỳ 10 không đổi;
//   · kỳ luật MỚI, ngày KHÔNG phải ngày Parttime (không phân công dạy / trực còn sống) ⇒ hằng cũ (luật 1.5 chỉ áp ngày Parttime — chốt 7);
//   · kỳ luật MỚI, ngày Parttime ⇒ số cặp `capQuetKyVong` × 2 (`tranMocNgay`); không cặp nào (vd. chỉ Trial ngoài khung) ⇒ hằng cũ.
// Số cặp tính bằng ĐÚNG hàm của màn Phân công (`capQuetKyVong` trên việc đã xếp ca bằng `xepBuoiVaoCa`) — không dựng lại.
import "server-only";
import { db } from "@/lib/db";
import { SO_MOC_TOI_DA } from "@/lib/cham-cong/sua-gio-quet";
import { capQuetKyVong } from "@/lib/cham-cong/cap-quet-ky-vong";
import { gopDayHoToiDaPhut } from "@/lib/parttime/chinh-sach";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import { thamSoApDung } from "@/lib/parttime/phan-cong-db";
import { luatKy, tranMocNgay } from "./cong-o";
import { docKyLuatMoi } from "./ky-luat-db";
import { xepBuoiVaoCa } from "./ma-o";

/** Trần mốc theo người cho MỘT ngày ("YYYY-MM-DD"). Số câu tra không phụ thuộc số người. */
export async function tranMocChoNguoi(userIds: readonly string[], ngay: string): Promise<Map<string, number>> {
  const kq = new Map<string, number>(userIds.map((u) => [u, SO_MOC_TOI_DA]));
  if (!userIds.length) return kq;
  const periodKey = ngay.slice(0, 7);
  const tuKy = await docKyLuatMoi();
  if (luatKy(periodKey, tuKy) !== "MOI") return kq;
  const ts = await thamSoApDung(db, ngay);
  if (!ts) return kq;
  const ngayDb = new Date(`${ngay}T00:00:00.000Z`);
  const [pc, truc] = await Promise.all([
    db.sessionStaffAssignment.findMany({
      where: { userId: { in: [...userIds] }, ngay: ngayDb, status: { in: [...TRANG_THAI_SONG] }, role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      select: { userId: true, gioBatDau: true, gioKetThuc: true },
    }),
    db.operationsDutyAssignment.findMany({ where: { userId: { in: [...userIds] }, workDate: ngayDb, status: { in: [...TRANG_THAI_SONG] } }, select: { userId: true, shiftCode: true } }),
  ]);
  for (const u of userIds) {
    const caTruc = truc.filter((t) => t.userId === u).map((t) => t.shiftCode);
    const viec = pc.filter((x) => x.userId === u);
    if (!viec.length && !caTruc.length) continue; // không phải ngày Parttime
    const cap = capQuetKyVong({
      ca: ts.ca,
      caTruc,
      viecDay: viec.map((v) => ({ ca: xepBuoiVaoCa({ ca: ts.ca, gioBatDau: v.gioBatDau, gioKetThuc: v.gioKetThuc, caCoTruc: caTruc }), gioBatDau: v.gioBatDau, gioKetThuc: v.gioKetThuc })),
      gopDayHoToiDaPhut: gopDayHoToiDaPhut(ts),
    });
    if (cap.length) kq.set(u, tranMocNgay({ periodKey, tuKy, cap, hangCu: SO_MOC_TOI_DA }));
  }
  return kq;
}

export async function tranMocCuaNgay(userId: string, ngay: string): Promise<number> {
  return (await tranMocChoNguoi([userId], ngay)).get(userId) ?? SO_MOC_TOI_DA;
}
