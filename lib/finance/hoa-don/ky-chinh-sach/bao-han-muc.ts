import { ngayVN } from "@/lib/format/thoi-gian-vn";
import type { NguoiNhanNhac, ThongBaoNhac } from "../nhac-ke-toan";

// lib/finance/hoa-don/ky-chinh-sach/bao-han-muc.ts — CẢNH BÁO «chạm hạn mức ký tự động» (BGĐ 04/11/2026). THUẦN: chọn ai nhận, khoá chống trùng, nội dung.
//
// Hai loại tin, mỗi loại MỘT bản cho MỘT pháp nhân MỖI NGÀY (tin gộp, không phải một tin mỗi hoá đơn):
//   · CHO       — có lần thu CHƯA tự phát hành vì chạm hạn mức: kế toán vào «Chờ xuất» xử lý; muốn nâng hạn mức thì báo Quản trị tối cao (quyết định của Ban Giám đốc).
//   · TAN_SUAT  — tần suất ký tự động vượt ngưỡng cảnh báo (KHÔNG chặn gì): có thể là nhịp bất thường, cần người xem.
// Người nhận = kế toán có quyền tại cơ sở của các lần thu liên quan (kế toán Hội sở — phạm vi ALL — nhận mọi pháp nhân).
// Nội dung chỉ mang SỐ LƯỢNG và TÊN PHÁP NHÂN — không số tiền, không tên người mua (panel chuông mở giữa chỗ đông người).

export const TIEN_TO_HAN_MUC = "hoa-don.han-muc:" as const;
export const HREF_HAN_MUC = "/payments/hoa-don?ngan=cho" as const;

export type NhomHanMuc = {
  phapNhanMa: string;
  phapNhanTen: string;
  /** Số lần thu chưa tự phát hành vì chạm hạn mức (hoặc vì pháp nhân đang tạm dừng) trong lượt chạy. */
  soCho: number;
  /** Có ít nhất một hoá đơn trong lượt vượt ngưỡng tần suất. */
  tanSuatCao: boolean;
  coSoIds: readonly string[];
};

export function dungThongBaoHanMuc(i: { nhom: readonly NhomHanMuc[]; nguoiNhan: readonly NguoiNhanNhac[]; now: Date }): ThongBaoNhac[] {
  const ngay = ngayVN(i.now);
  const ra: ThongBaoNhac[] = [];
  for (const n of [...i.nhom].sort((a, b) => a.phapNhanMa.localeCompare(b.phapNhanMa))) {
    const nhan = i.nguoiNhan.filter((u) => u.phamVi === "ALL" || u.phamVi.some((c) => n.coSoIds.includes(c)));
    if (nhan.length === 0) continue;
    const userIds = [...new Set(nhan.map((u) => u.userId))].sort();
    const ten = n.phapNhanTen.trim() || n.phapNhanMa;
    if (n.soCho > 0) {
      ra.push({
        userIds,
        dedupeKey: `${TIEN_TO_HAN_MUC}${n.phapNhanMa}:${ngay}:CHO`,
        title: "Hoá đơn chờ vì chạm hạn mức ký tự động",
        body: `${n.soCho} lần thu của ${ten} chưa tự phát hành vì chạm hạn mức ký tự động. Xem ở «Chờ xuất»; muốn nâng hạn mức hãy báo Quản trị tối cao.`,
        href: HREF_HAN_MUC,
      });
    }
    if (n.tanSuatCao) {
      ra.push({
        userIds,
        dedupeKey: `${TIEN_TO_HAN_MUC}${n.phapNhanMa}:${ngay}:TAN_SUAT`,
        title: "Tần suất ký tự động cao bất thường",
        body: `Pháp nhân ${ten} đang ký tự động nhiều hoá đơn trong thời gian ngắn, vượt ngưỡng cảnh báo. Kiểm tra xem có đúng nhịp thu thật không.`,
        href: HREF_HAN_MUC,
      });
    }
  }
  return ra;
}
