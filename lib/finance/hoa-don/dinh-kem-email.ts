import "server-only";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { kyUrlTaiVeHoaDon } from "./kho-tep";

// lib/finance/hoa-don/dinh-kem-email.ts — phần WORKER hàng đợi email cần cho dòng HOÁ ĐƠN
// (docs/ke-toan-hoa-don/PLAN.md §7). `processEmailQueue` gọi hai hàm ở đây cho dòng có
// `contextType = NGU_CANH_EMAIL_HOA_DON`; tệp này KHÔNG import hàng đợi (tránh vòng import).
//
//   · ĐỌC LẠI hoá đơn lúc GỬI — chỉ gửi khi còn `DA_XAC_NHAN`. Bản đã bị THAY / gỡ thì KHÔNG gửi:
//     gửi tờ cũ là gửi thông tin người mua có thể đã sai cho khách.
//   · Đính kèm bằng URL KÝ GET 300 giây (Resend tự tải) ⇒ hàm không tải byte, không giữ tệp trong bộ
//     nhớ. Khoá tệp đọc từ HOÁ ĐƠN, không từ payload hàng đợi — worker không tin payload.
//   · `idempotencyKey = hoa-don:<guiId>` ⇒ worker chạy lại / hai cron chồng nhau không gửi hai lần.

/** Giá trị `EmailQueue.contextType` của dòng gửi hoá đơn — `contextId` = `HoaDonGuiEmail.id`. */
export const NGU_CANH_EMAIL_HOA_DON = "HoaDonGuiEmail";

/** URL ký sống 300 giây — đủ để Resend tải tệp ngay lúc gửi, không đủ để link lan đi xa. */
const TTL_DINH_KEM_GIAY = 300;

export type ChuanBiGui =
  | { ok: true; attachments: { filename: string; path: string }[]; idempotencyKey: string }
  /** `chan` = không bao giờ gửi được (hoá đơn không còn hiệu lực) ⇒ FAILED, không thử lại. */
  | { ok: false; chan: boolean; loi: string };

export async function chuanBiGuiHoaDon(guiId: string): Promise<ChuanBiGui> {
  const g = await db.hoaDonGuiEmail.findUnique({
    where: { id: guiId },
    select: {
      hoaDon: {
        select: { trangThai: true, tepPdfKey: true, tepPdfTen: true, tepXmlKey: true, tepXmlTen: true, kyHieu: true, soHoaDon: true },
      },
    },
  });
  if (!g) return { ok: false, chan: true, loi: "Không tìm thấy lượt gửi hoá đơn" };
  const hd = g.hoaDon;
  if (hd.trangThai !== "DA_XAC_NHAN") {
    return { ok: false, chan: true, loi: "Hoá đơn không còn hiệu lực (đã bị thay / gỡ) — không gửi bản cũ" };
  }
  if (!hd.tepPdfKey || !hd.tepPdfKey.startsWith("hoa-don/")) {
    return { ok: false, chan: true, loi: "Hoá đơn không có tệp PDF trong kho hoá đơn" };
  }
  const ten = (goc: string | null, duoi: "pdf" | "xml") =>
    goc?.trim() || `hoa-don-${[hd.kyHieu, hd.soHoaDon].filter(Boolean).join("-") || "sata-robo"}.${duoi}`;
  try {
    const attachments = [{ filename: ten(hd.tepPdfTen, "pdf"), path: await kyUrlTaiVeHoaDon(hd.tepPdfKey, ten(hd.tepPdfTen, "pdf"), TTL_DINH_KEM_GIAY) }];
    if (hd.tepXmlKey?.startsWith("hoa-don/")) {
      attachments.push({ filename: ten(hd.tepXmlTen, "xml"), path: await kyUrlTaiVeHoaDon(hd.tepXmlKey, ten(hd.tepXmlTen, "xml"), TTL_DINH_KEM_GIAY) });
    }
    return { ok: true, attachments, idempotencyKey: `hoa-don:${guiId}` };
  } catch (e) {
    // Kho chưa cấu hình / lỗi ký tạm thời ⇒ THỬ LẠI (không chặn vĩnh viễn một hoá đơn hợp lệ).
    return { ok: false, chan: false, loi: e instanceof Error ? e.message : "Không ký được URL tệp hoá đơn" };
  }
}

/**
 * Ghi kết quả của một lượt gửi lên `HoaDonGuiEmail` — trạng thái hiển thị cho kế toán / sale.
 *
 * GĐ 8 — hỏng HẲN (`cuoiCung`) ⇒ LOI + sự kiện `hoa-don.gui-loi` trong MỘT transaction: không ai được
 * báo thì email hỏng chỉ nằm im trên màn, khách không có hoá đơn mà không người nào biết. Sự kiện phát
 * CHỈ khi chính lượt ghi này đổi trạng thái (`count === 1`): worker gọi lại lần hai thì không phát lần
 * hai — và không đâm vào `dedupeKey` giữa transaction (Postgres huỷ cả transaction sau một câu lỗi).
 */
export async function ghiKetQuaGuiHoaDon(
  guiId: string,
  kq: { daGui: true } | { daGui: false; loi: string; cuoiCung: boolean },
): Promise<void> {
  if (!kq.daGui && kq.cuoiCung) {
    const loi = kq.loi.slice(0, 500);
    await db.$transaction(async (tx) => {
      const upd = await tx.hoaDonGuiEmail.updateMany({
        where: { id: guiId, trangThai: { in: ["DANG_GUI", "CHO"] } },
        data: { trangThai: "LOI", loi },
      });
      // Tên sự kiện viết LITERAL — lưới `lib/events/khop-phat-nghe.test.ts` chỉ đọc được chuỗi literal.
      if (upd.count === 1) await publishEvent("hoa-don.gui-loi", { guiId }, { tx, dedupeKey: `hoa-don.gui-loi:${guiId}` });
    });
    return;
  }
  await db.hoaDonGuiEmail.updateMany({
    where: { id: guiId, trangThai: { in: ["DANG_GUI", "CHO"] } },
    data: kq.daGui
      ? { trangThai: "DA_GUI", loi: null }
      : kq.cuoiCung
        ? { trangThai: "LOI", loi: kq.loi.slice(0, 500) }
        : { loi: kq.loi.slice(0, 500) },
  });
}
