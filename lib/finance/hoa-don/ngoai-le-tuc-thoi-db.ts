import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { laHubQuetBatChoCoSo } from "./feature";
import { guiThongBaoTucThoi } from "./ngoai-le-thong-bao-db";
import { khoaNgoaiLeTucThoi, mucTucThoi, type LoaiTucThoi } from "./ngoai-le-tuc-thoi";

// lib/finance/hoa-don/ngoai-le-tuc-thoi-db.ts — BÁO NGOẠI LỆ HOÁ ĐƠN NGAY KHI LỖI XẢY RA (hợp đồng đợt 2 §6). Người chạy DB.
//
// Đường phát hành (`phat-hanh-misa.ts`) gọi hàm này đúng lúc nhà cung cấp từ chối / không trả lời rõ. Kết quả: một dòng `HoaDonNgoaiLe` (cùng bảng + cùng khoá chống trùng với
// scanner) và chuông RIÊNG của ngoại lệ đó tới kế toán ĐÚNG CƠ SỞ của hoá đơn — không chờ chu kỳ 10 phút của cron. Scanner định kỳ chỉ còn là lưới bắt sót.
//
// Luật bất di bất dịch:
//  · KHÔNG BAO GIỜ ném. Đường phát hành đã ghi trạng thái lỗi trước khi gọi; một lỗi ở đây không được làm hỏng nó (và cũng không được nuốt im: lỗi vào log server, không PII).
//  · Cờ TẮT cho CƠ SỞ của hoá đơn (`laHubQuetBatChoCoSo`: công tắc tổng + cơ sở đã được bật thí điểm) ⇒ không ghi bảng nào, không chuông. HO bật từng cơ sở một, không bật cả hệ thống cùng lúc.
//  · Idempotent: cùng một lần lỗi (cùng khoá lượt) gọi bao nhiêu lần cũng ra MỘT dòng và MỘT chuông. Ngoại lệ kế toán đã "Bỏ qua có lý do" KHÔNG được mở lại. Ngoại lệ đã ĐÓNG cùng khoá cũng không mở lại.
//  · Cơ sở lấy từ CHÍNH hoá đơn (`HoaDonDienTu.centerId`); chuông chỉ gửi cho cơ sở đó và chỉ về ngoại lệ vừa tạo (khoá riêng theo ngoại lệ, không dùng khoá theo ngày của scanner vì khoá đó nuốt lỗi thứ hai trong ngày).
//  · Không ghi gì vào hoá đơn / đơn / tiền: chỉ thêm một dòng ngoại lệ.

export type KetQuaTucThoi = {
  ket: "TAO" | "DA_CO" | "BO_QUA_CO_LY_DO" | "CO_TAT" | "KHONG_TIM_THAY" | "LOI";
  thongBao: number;
  loiThongBao: number;
};

const khong = (ket: KetQuaTucThoi["ket"]): KetQuaTucThoi => ({ ket, thongBao: 0, loiThongBao: 0 });

export async function baoNgoaiLeTucThoi(input: { hoaDonId: string; loai: LoaiTucThoi; /** Khoá lượt gửi (refId) — phân biệt các lần lỗi của cùng một hoá đơn. */ khoa: string; now: Date }): Promise<KetQuaTucThoi> {
  try {
    const hd = await db.hoaDonDienTu.findFirst({ where: { id: input.hoaDonId }, select: { centerId: true, orderId: true } });
    if (!hd) return khong("KHONG_TIM_THAY");
    // Cờ theo CƠ SỞ của hoá đơn (công tắc tổng + cơ sở đã được bật thí điểm). Đọc cờ SAU khi biết cơ sở nhưng TRƯỚC mọi phép ghi / chuông.
    if (!(await laHubQuetBatChoCoSo(hd.centerId))) return khong("CO_TAT");

    const dedupeKey = khoaNgoaiLeTucThoi(input.loai, input.hoaDonId, input.khoa);
    // Mọi trạng thái: đã có (mở / đang xử lý / đã xử lý / bỏ qua) ⇒ KHÔNG tạo lại. Riêng "bỏ qua có lý do" báo thành kết quả riêng cho log / test.
    const daCo = await db.hoaDonNgoaiLe.findFirst({ where: { dedupeKey }, select: { trangThai: true } });
    if (daCo) return khong(daCo.trangThai === "BO_QUA_CO_LY_DO" ? "BO_QUA_CO_LY_DO" : "DA_CO");

    const id = randomUUID();
    const muc = mucTucThoi(input.loai);
    await db.hoaDonNgoaiLe.createMany({
      data: [
        {
          id,
          centerId: hd.centerId,
          loai: input.loai,
          muc,
          hoaDonId: input.hoaDonId,
          orderId: hd.orderId,
          trangThai: "MO",
          dedupeKey,
          createdAt: input.now,
        },
      ],
      skipDuplicates: true,
    });
    // Lượt đồng thời cùng khoá: chỉ lượt có id của MÌNH nằm trong bảng mới là người tạo — những lượt còn lại không chuông lại.
    if ((await db.hoaDonNgoaiLe.count({ where: { id } })) !== 1) return khong("DA_CO");

    try {
      const tb = await guiThongBaoTucThoi({ ngoaiLeId: id, centerId: hd.centerId, loai: input.loai, muc });
      return { ket: "TAO", ...tb };
    } catch (e) {
      logLoi("gửi chuông", input.hoaDonId, e);
      return { ket: "TAO", thongBao: 0, loiThongBao: 1 };
    }
  } catch (e) {
    logLoi("ghi ngoại lệ", input.hoaDonId, e);
    return khong("LOI");
  }
}

function logLoi(viec: string, hoaDonId: string, e: unknown): void {
  const chiTiet = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[hoa-don-ngoai-le-tuc-thoi] ${viec} · hoaDonId=${hoaDonId} · ${chiTiet.slice(0, 300)}`);
}
