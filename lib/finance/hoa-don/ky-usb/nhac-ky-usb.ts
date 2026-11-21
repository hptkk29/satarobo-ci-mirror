import { ngayVN } from "@/lib/format/thoi-gian-vn";
import type { NguoiNhanNhac, ThongBaoNhac } from "../nhac-ke-toan";

// lib/finance/hoa-don/ky-usb/nhac-ky-usb.ts — THÔNG BÁO GỘP «có hoá đơn chờ ký USB token» (BGĐ 04/11/2026). THUẦN: chọn ai nhận bản nào, khoá chống trùng, nội dung.
//
// Luật:
//   · MỘT thông báo cho MỘT pháp nhân mỗi nhịp, không phải một thông báo mỗi hoá đơn (tin gộp). Người nhận = kế toán có quyền ký TẠI cơ sở của các lệnh đang chờ
//     (phạm vi ALL — kế toán Hội sở — nhận mọi pháp nhân).
//   · NHẮC LẠI: khoá chứa «nhịp» = số chu kỳ `NHAC_LAI_PHUT` đã trôi qua kể từ lệnh chờ CŨ NHẤT. `notifyStaff` chỉ rung điện thoại cho mục MỚI, nên khoá mới mỗi chu kỳ là
//     cách DUY NHẤT để một việc vẫn chưa ai ký còn rung lại; trong cùng chu kỳ khoá không đổi ⇒ cron 10 phút một lần không rung lại.
//   · Nội dung chỉ mang SỐ LƯỢNG và TÊN PHÁP NHÂN — không số tiền, không tên người mua (panel chuông mở giữa chỗ đông người).
//   · Điện thoại chỉ để NHẬN BÁO. Token USB chỉ ký được trên máy Windows của kế toán; thông báo trỏ về khu «Ký USB token».

export const TIEN_TO_NHAC_KY = "hoa-don.cho-ky:" as const;
export const HREF_NHAC_KY = "/payments/hoa-don/cau-hinh" as const;
/** Chu kỳ nhắc lại khi vẫn còn lệnh chờ ký. */
export const NHAC_LAI_PHUT = 120;

export type NhomChoKy = { phapNhanMa: string; phapNhanTen: string; soLenh: number; cuNhatLuc: Date; coSoIds: readonly string[] };

export function nhipNhac(cuNhatLuc: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - cuNhatLuc.getTime()) / (NHAC_LAI_PHUT * 60_000)));
}

export function dungThongBaoChoKy(i: { nhom: readonly NhomChoKy[]; nguoiNhan: readonly NguoiNhanNhac[]; now: Date }): ThongBaoNhac[] {
  const ngay = ngayVN(i.now);
  const ra: ThongBaoNhac[] = [];
  for (const n of [...i.nhom].sort((a, b) => a.phapNhanMa.localeCompare(b.phapNhanMa))) {
    if (n.soLenh <= 0) continue;
    const nhan = i.nguoiNhan.filter((u) => u.phamVi === "ALL" || u.phamVi.some((c) => n.coSoIds.includes(c)));
    if (nhan.length === 0) continue;
    const nhip = nhipNhac(n.cuNhatLuc, i.now);
    const ten = n.phapNhanTen.trim() || n.phapNhanMa;
    ra.push({
      userIds: [...new Set(nhan.map((u) => u.userId))].sort(),
      dedupeKey: `${TIEN_TO_NHAC_KY}${n.phapNhanMa}:${ngay}:${nhip}`,
      title: nhip > 0 ? "Nhắc: hoá đơn chờ ký USB token" : "Hoá đơn chờ ký USB token",
      body:
        nhip > 0
          ? `${n.soLenh} hoá đơn của ${ten} vẫn chờ ký (đã chờ hơn ${nhip * (NHAC_LAI_PHUT / 60)} giờ). Mở ứng dụng ký trên máy Windows có token.`
          : `${n.soLenh} hoá đơn của ${ten} đang chờ ký. Mở ứng dụng ký trên máy Windows có token.`,
      href: HREF_NHAC_KY,
    });
  }
  return ra;
}
