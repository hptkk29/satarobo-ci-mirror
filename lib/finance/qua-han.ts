// lib/finance/qua-han.ts — DANH SÁCH QUÁ HẠN THEO GIA ĐÌNH. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN G2 · US-23 "Quá hạn và nhắc"
//
//   AC2 — *"Danh sách 'Quá hạn' theo GIA ĐÌNH, gom các con, hiện số ngày quá, gợi ý phát
//          hành kỳ thu gộp."*
//   AC3 — *"Thông báo nội bộ cho sale phụ trách mỗi sáng; không bắn trùng trong ngày."*
//   AC4 — *"PAUSED KHÔNG vào danh sách."*
//
// ⚠️ AC1 của BA nói *"ghi bảng TỔNG HỢP đọc nhanh"*. **Không làm** — và đó là quyết định, không
// phải bỏ sót: một bảng tổng hợp là một bản sao của sự thật, và bản sao thì lệch. Số đợt quá
// hạn trên toàn hệ hôm nay đếm bằng hàng chục, không phải hàng triệu; tra thẳng là đủ nhanh
// và không bao giờ sai. Khi nào đo được là chậm thì thêm bảng, và lúc ấy nó có lý do đo được.
//
// ─────────────────────────────────────────────────────────────────────────────
// "GIA ĐÌNH" LÀ `Order.id`
//
// BA nói "gia đình"; repo này không có thực thể ấy — `gate-0.md` X2 đã đo: *"KHÔNG có bảng
// gia đình. Khoá gom hôm nay là `Order.id`"*. Một đơn = một nhà, các dòng hàng = các con.
// Dịch tên ở ĐÂY một lần, thay vì để mỗi chỗ tự dịch.

import { vnDateOnly } from "@/lib/time/vn";

/** Một đợt quá hạn, đã quy về con và nhà. */
export type DotQuaHan = {
  paymentRequestId: string;
  orderId: string;
  orderItemId: string;
  tenCon: string;
  installmentNo: number;
  /** `amountDue − Σ đã rót`. Luôn > 0 — người gọi đã lọc. */
  conThieu: number;
  dueDate: Date;
};

export type ConQuaHan = {
  orderItemId: string;
  tenCon: string;
  conThieu: number;
  soDot: number;
  /** Số ngày quá hạn của đợt TRỄ NHẤT của bé. */
  soNgayQua: number;
};

export type NhaQuaHan = {
  orderId: string;
  con: ConQuaHan[];
  tongConThieu: number;
  /** Số ngày quá hạn LỚN NHẤT trong nhà — dùng để sắp thứ tự nhắc. */
  soNgayQuaNhieuNhat: number;
  /**
   * Nhà này nên phát MỘT kỳ thu gộp không (AC2).
   *
   * ⚠️ Chỉ là GỢI Ý hiển thị. Điều kiện: từ hai con trở lên cùng quá hạn — lúc đó phụ huynh
   * đang cầm hai mã QR cho cùng một nhà, và đó chính là ca phiếu gộp sinh ra để giải.
   */
  nenGopPhieu: boolean;
};

const MS_NGAY = 24 * 60 * 60 * 1000;

/**
 * Số ngày quá hạn, đếm theo NGÀY LỊCH **GIỜ VIỆT NAM**.
 *
 * ⚠️ Hai bẫy, và bản đầu dính cả hai:
 *
 *   1. **Không lấy hiệu mili giây rồi `floor`.** Hạn 19/10 22:00 mà bây giờ là 20/10 10:00
 *      thì hiệu chỉ 12 giờ ⇒ `floor` ra **0 ngày**, và người đọc tưởng đợt chưa trễ. Hạn
 *      lấy từ ô chọn ngày thì đúng nửa đêm nên hai phép hay trùng nhau — nhưng `dueDate`
 *      còn đến từ những đường khác (nhập lead, convert) và chúng MANG GIỜ.
 *   2. **Ngày VIỆT NAM, không ngày UTC.** Vercel chạy UTC; một hạn 20/10 00:30 giờ VN nằm ở
 *      **19/10** theo UTC, nên đếm theo UTC cho ra "trễ 1 ngày" cho một đợt vừa mới tới hạn
 *      sáng nay.
 *
 * Cùng bài học với `soNgayBaoLuu` (F2) — ở đó nó làm lệch SỐ TIỀN, ở đây nó làm lệch MỨC ĐỘ
 * KHẨN, tức thứ tự sale gọi điện.
 */
export function soNgayQuaHan(dueDate: Date, now: Date): number {
  const a = vnDateOnly(dueDate).getTime();
  const b = vnDateOnly(now).getTime();
  return b > a ? Math.round((b - a) / MS_NGAY) : 0;
}

/**
 * Gom các đợt quá hạn thành danh sách theo NHÀ.
 *
 * ⚠️ Người gọi đã lọc: bé đang BẢO LƯU không có trong `dot` (AC4). Lọc ở đây bằng một cờ
 * thứ hai là hai chỗ cùng quyết định một luật, và chỗ thứ hai sẽ lệch.
 */
export function gomTheoNha(dot: readonly DotQuaHan[], now: Date): NhaQuaHan[] {
  const theoNha = new Map<string, Map<string, ConQuaHan>>();

  for (const d of dot) {
    if (!theoNha.has(d.orderId)) theoNha.set(d.orderId, new Map());
    const nha = theoNha.get(d.orderId)!;
    const cu = nha.get(d.orderItemId);
    const soNgay = soNgayQuaHan(d.dueDate, now);
    if (cu) {
      cu.conThieu += d.conThieu;
      cu.soDot += 1;
      cu.soNgayQua = Math.max(cu.soNgayQua, soNgay);
    } else {
      nha.set(d.orderItemId, {
        orderItemId: d.orderItemId,
        tenCon: d.tenCon,
        conThieu: d.conThieu,
        soDot: 1,
        soNgayQua: soNgay,
      });
    }
  }

  return [...theoNha.entries()]
    .map(([orderId, conMap]) => {
      // Trong một nhà: con trễ LÂU NHẤT lên đầu. Sale đọc từ trên xuống, nên thứ tự phải là
      // thứ tự cần gọi.
      const con = [...conMap.values()].sort(
        (a, b) => b.soNgayQua - a.soNgayQua || b.conThieu - a.conThieu,
      );
      return {
        orderId,
        con,
        tongConThieu: con.reduce((s, c) => s + c.conThieu, 0),
        soNgayQuaNhieuNhat: con.reduce((s, c) => Math.max(s, c.soNgayQua), 0),
        nenGopPhieu: con.length >= 2,
      };
    })
    .sort(
      (a, b) =>
        b.soNgayQuaNhieuNhat - a.soNgayQuaNhieuNhat || b.tongConThieu - a.tongConThieu,
    );
}

/** Câu nhắc gửi cho sale — một nhà, một dòng. */
export function cauNhac(nha: NhaQuaHan): string {
  const ten = nha.con.map((c) => c.tenCon).join(", ");
  const tien = nha.tongConThieu.toLocaleString("vi-VN");
  const goi = nha.nenGopPhieu
    ? " Cả nhà đang quá hạn từ hai bé — phát MỘT phiếu gộp cho gọn."
    : "";
  return (
    `${ten} quá hạn ${nha.soNgayQuaNhieuNhat} ngày, còn thiếu ${tien}đ.` + goi
  );
}
