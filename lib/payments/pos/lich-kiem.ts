// lib/payments/pos/lich-kiem.ts — LỊCH KIỂM phiếu thu thẻ của poller + quét sạch (GĐ2 POS). THUẦN.
//
// Thiết kế: docs/pos-gd2-thiet-ke.md §3.1 (U10), §3.4 (U13), §5 (U14). Hằng + điều kiện Prisma tách khỏi
// `poller.ts` để test được HÌNH DẠNG `where` với mốc đóng băng (`[POS2-PL-07]`) mà không cần DB.
//
// "Tạo < 24 giờ" của đặc tả = `expiresAt > now`: `expiresAt = createdAt + HAN_PHIEU_POS_MS` do APP đặt
// (`phieu-pos.ts`, T18) ⇒ dùng cột đã lưu thay vì tính lại 24 giờ — một nguồn mốc. Mốc hết hạn khớp
// `phieuPosHetHan` (biên `≤`, `[POS2-HT-04]`).
import type { Prisma } from "@prisma/client";
import { ngayVN, gioVN } from "@/lib/format/thoi-gian-vn";
import { HAN_HIEN_THI_PHIEU_POS_MS, KIND_CHUA_KET_LUAN, TRANG_THAI_MO } from "./phieu-pos-luat";

/** Phiếu CÒN HẠN tối đa mỗi lượt poller. */
export const TRAN_POLLER_CON_HAN = 30;
/** Phiếu QUÁ HẠN 24 giờ chờ ghi HET_HAN tối đa mỗi lượt. */
export const TRAN_POLLER_HET_HAN = 30;
/** Ngân sách một lượt poller — < 60 giây ⇒ hai lượt cron mỗi phút không chồng nhau. */
export const NGAN_SACH_POLLER_MS = 40_000;
/** Phiếu tuổi < thời hạn hiển thị: kiểm mỗi lượt (chừa 10 giây lệch nhịp cron). */
export const NHIP_TRE_MS = 50_000;
/** Phiếu tuổi ≥ thời hạn hiển thị (đã rời màn sale): 10 phút một lần — vẫn đối soát tới hết hạn. */
export const NHIP_GIA_MS = 10 * 60_000;
/**
 * [Rà đối kháng 06/10/2026] Phiếu QUÁ HẠN mà lượt gần nhất CHƯA KẾT LUẬN được (`KIND_CHUA_KET_LUAN`) được
 * poller thử lại theo `NHIP_GIA_MS` tới tối đa chừng này SAU hạn (tức 7 ngày kể từ lúc tạo — trùng cửa sổ
 * đồng bộ sau import). Quá trần: poller thôi hỏi, phiếu GIỮ MỞ (không tự kết luận) — quét sạch cuối ngày
 * vẫn kiểm mọi phiếu mở; kế toán xử lý theo chuông "chưa xác định" / "lỗi kết nối" đã nhận.
 */
export const TRAN_THU_LAI_QUA_HAN_MS = 6 * 24 * 60 * 60_000;
/** Phiếu mở tối đa mỗi lượt quét sạch cuối ngày. */
export const TRAN_QUET_SACH = 300;
/** Ngân sách quét sạch — `deploy/cron-call.sh` cắt lượt gọi ở 300 giây. */
export const NGAN_SACH_QUET_SACH_MS = 240_000;

/**
 * Tập CÒN HẠN đến nhịp: phiếu MỞ, `expiresAt > now`, không tạo "trong tương lai", và đã tới nhịp theo
 * tuổi — trẻ (< 30′) mỗi lượt (đã kiểm ≥ 50 giây trước hoặc chưa kiểm), già 10 phút một lần.
 */
export function dieuKienPollerConHan(now: Date): Prisma.PosPaymentIntentWhereInput {
  const moc30 = new Date(now.getTime() - HAN_HIEN_THI_PHIEU_POS_MS);
  return {
    status: { in: [...TRANG_THAI_MO] },
    expiresAt: { gt: now },
    createdAt: { lte: now },
    OR: [
      {
        createdAt: { gt: moc30 },
        OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: new Date(now.getTime() - NHIP_TRE_MS) } }],
      },
      {
        createdAt: { lte: moc30 },
        OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: new Date(now.getTime() - NHIP_GIA_MS) } }],
      },
    ],
  };
}

/**
 * Tập QUÁ HẠN: phiếu MỞ có `expiresAt ≤ now` (= `phieuPosHetHan`) — kiểm lần cuối rồi ghi HET_HAN. Phiếu mà
 * lượt gần nhất CHƯA KẾT LUẬN được (lỗi kết nối / pha tiền ném) thì `hetHanPhieuPos` không ghi ⇒ nó ở lại
 * tập này: thử lại theo nhịp 10 phút và chỉ tới `TRAN_THU_LAI_QUA_HAN_MS` sau hạn — không hỏi mỗi phút mãi.
 */
export function dieuKienPollerHetHan(now: Date): Prisma.PosPaymentIntentWhereInput {
  return {
    status: { in: [...TRANG_THAI_MO] },
    expiresAt: { lte: now },
    OR: [
      { lastResultKind: null },
      { lastResultKind: { notIn: [...KIND_CHUA_KET_LUAN] } },
      {
        expiresAt: { gt: new Date(now.getTime() - TRAN_THU_LAI_QUA_HAN_MS) },
        OR: [{ lastCheckAt: null }, { lastCheckAt: { lte: new Date(now.getTime() - NHIP_GIA_MS) } }],
      },
    ],
  };
}

/** [U14] Một chuông quét sạch mỗi NGÀY Việt Nam (23:30 VN = 16:30Z cùng ngày). */
export function khoaQuetSach(now: Date): string {
  return `pos.quet-sach:${ngayVN(now)}`;
}

/** [U13] Lỗi kết nối khi MÁY tự kiểm: một chuông TOÀN HỆ THỐNG mỗi giờ Việt Nam. */
export function khoaLoiKetNoiHeThong(now: Date): string {
  return `pos.loi-ket-noi:he-thong:${gioVN(now).slice(0, 13)}`;
}

/**
 * [U13] Nội dung chuông lỗi kết nối TOÀN HỆ THỐNG. `href` mang NGÀY VN phát chuông (`tu` = `den`): màn
 * nhật ký thiếu ngày thì lọc "hôm nay" của người BẤM — chuông 23:40 mở sáng hôm sau ra danh sách rỗng,
 * đọc như "không có lỗi" (rà đối kháng 06/10/2026; cùng khuôn chuông quét sạch). Không mang phút ⇒ ổn
 * định trong giờ, poller mỗi phút không ghi lại chuông vô ích.
 */
export function chuongLoiKetNoiHeThong(
  now: Date,
  maLoi: string | null,
): { dedupeKey: string; title: string; body: string; href: string } {
  const ngay = ngayVN(now);
  const h = Number(gioVN(now).slice(11, 13));
  const hh = (x: number) => String(x % 24).padStart(2, "0");
  return {
    dedupeKey: khoaLoiKetNoiHeThong(now),
    title: `Hệ thống thanh toán thẻ lỗi khi tự kiểm (mã ${maLoi ?? "KHONG_RO"})`,
    body:
      `Lỗi kết nối khi tự kiểm phiếu thu thẻ ngày ${ngay.slice(8, 10)}/${ngay.slice(5, 7)}, trong khung ` +
      `${hh(h)}:00–${hh(h + 1)}:00. Danh sách phiếu ở Nhật ký kiểm thẻ POS.`,
    href: `/bien-dong-so-du/nhat-ky-pos?ketQua=PROVIDER_ERROR&tu=${ngay}&den=${ngay}`,
  };
}

/**
 * "Chưa xác định" (pha tiền ném) khi MÁY tự kiểm: MỘT chuông / phiếu / NGÀY VN. Khoá theo GIỜ như lượt sale
 * bấm thì poller (mỗi phút khi phiếu trẻ, 10 phút khi già, thử lại sau hạn) rung ~24 lần/phiếu/người mỗi
 * ngày — đúng loại chuông người ta học cách tắt (rà đối kháng 06/10/2026).
 */
export function khoaChuaXacDinhMay(intentId: string, now: Date): string {
  return `pos.chua-xac-dinh:${intentId}:${ngayVN(now)}`;
}
