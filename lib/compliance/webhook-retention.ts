import "server-only";
import { db } from "@/lib/db";
import {
  WEBHOOK_RETENTION_DAYS,
  dieuKienXoaDomainEvent,
  dieuKienXoaWebhookDelivery,
  mocCatLuuTru,
} from "@/lib/compliance/webhook-retention-rules";

// =============================================================================
// S9-B7 (tích hợp ZaloCRM) — DỌN dấu vết webhook + outbox sự kiện.
//
// VẤN ĐỀ: `WebhookDelivery.payload` lưu payload THÔ của mọi webhook (tên + số điện
// thoại phụ huynh nằm nguyên văn — `logWebhookDelivery` trong `lib/lead/webhook.ts`
// không đục gì, không cắt gì) và `DomainEvent.payloadJson` lưu payload sự kiện. Trước
// hôm nay KHÔNG cron nào dọn hai bảng đó: dữ liệu cá nhân nằm vô thời hạn, không chủ
// sở hữu, không cách ly cơ sở, và đi vào MỌI bản `pg_dump` / mọi bản sao DB dev-test.
// Với ZaloCRM (mỗi tin nhắn một dòng, nhiều hơn hẳn webhook lead) đây thành rủi ro
// tính bằng tuần chứ không phải bằng năm.
//
// KHÁC `lib/compliance/retention.ts` (C6/NĐ13, quét học viên hết hạn lưu trữ): bên đó
// chỉ ĐẾM rồi để người quyết định xoá, vì đó là dữ liệu trẻ em và xoá là không hoàn
// tác. Bên này XOÁ THẲNG, vì đây là dấu vết kỹ thuật đã hết vai trò vận hành — không
// có "học bạ webhook" nào để mất.
//
// Luật cứng Nền Hệ thống #8 ("không cron nào GHI thay đổi quyền") KHÔNG bị chạm: hai
// bảng này không tham gia tính quyền.
// =============================================================================

export {
  WEBHOOK_RETENTION_DAYS,
  TRANG_THAI_DOMAIN_EVENT_DA_XONG,
  mocCatLuuTru,
} from "@/lib/compliance/webhook-retention-rules";

/**
 * Số dòng xoá mỗi lượt lệnh, và số lượt tối đa trong MỘT lần chạy cron.
 *
 * Vì sao chia lô: lần chạy ĐẦU TIÊN trên prod phải dọn tồn của cả quãng từ ngày bảng
 * ra đời. Một `DELETE` duy nhất trên hàng trăm nghìn dòng dễ ăn statement timeout của
 * Supabase và giữ khoá lâu ngay giữa giờ chạy — và khi nó đứt thì cả lượt dọn không
 * làm được gì. Chia lô thì phần đã xoá được là đã xong; trần lô giữ cho một lần chạy
 * có điểm dừng, phần còn lại để đêm sau (cron này idempotent nên chạy lại là an toàn).
 */
const KICH_THUOC_LO = 5_000;
const SO_LO_TOI_DA = 20;

export type KetQuaDonWebhook = {
  /** Mốc cắt đã dùng, ISO — đưa thẳng vào log để đối chiếu khi có người hỏi "sao mất". */
  cutoff: string;
  ngayGiuLai: number;
  /** Số dòng `WebhookDelivery` đã xoá. */
  webhookDelivery: number;
  /** Số dòng `DomainEvent` đã xoá (chỉ dòng đã xử lý xong). */
  domainEvent: number;
  /** True khi chạm trần lô ⇒ CÒN tồn đọng, lượt sau dọn tiếp. */
  daChamTran: boolean;
};

/** Xoá theo lô cho tới khi hết hoặc chạm trần. Trả về `{ đã xoá, có còn tồn không }`. */
async function xoaTheoLo(
  timId: (take: number) => Promise<{ id: string }[]>,
  xoaTheoIds: (ids: string[]) => Promise<{ count: number }>,
): Promise<{ daXoa: number; conTon: boolean }> {
  let daXoa = 0;
  for (let lo = 0; lo < SO_LO_TOI_DA; lo++) {
    const rows = await timId(KICH_THUOC_LO);
    if (rows.length === 0) return { daXoa, conTon: false };
    const r = await xoaTheoIds(rows.map((x) => x.id));
    daXoa += r.count;
    if (rows.length < KICH_THUOC_LO) return { daXoa, conTon: false };
  }
  return { daXoa, conTon: true };
}

/**
 * Dọn `WebhookDelivery` + `DomainEvent` quá hạn lưu trữ.
 *
 * Hai bảng đi chung MỘT cron có chủ đích (QĐ Q14 của đợt tích hợp): cùng một chính
 * sách lưu trữ, cùng một lý do tồn tại, và ngân sách cron của gói Vercel là hữu hạn.
 *
 * `DomainEvent` chỉ xoá dòng ĐÃ XỬ LÝ XONG — xem `TRANG_THAI_DOMAIN_EVENT_DA_XONG`.
 * `WebhookDelivery` xoá mọi trạng thái quá hạn (bảng đó toàn bộ là dấu vết).
 *
 * Idempotent: chạy lại ngay sau đó trả về 0/0 và không đổi gì thêm.
 */
export async function donWebhookDelivery(opts?: {
  ngayGiuLai?: number;
  now?: Date;
}): Promise<KetQuaDonWebhook> {
  const ngayGiuLai = opts?.ngayGiuLai ?? WEBHOOK_RETENTION_DAYS;
  const now = opts?.now ?? new Date();
  // Ném NGAY nếu số ngày vô lý — trước khi chạm một dòng nào (xem `mocCatLuuTru`).
  const cutoff = mocCatLuuTru(now, ngayGiuLai);

  const whDelivery = await xoaTheoLo(
    (take) =>
      db.webhookDelivery.findMany({
        where: dieuKienXoaWebhookDelivery(cutoff),
        select: { id: true },
        orderBy: { receivedAt: "asc" },
        take,
      }),
    (ids) => db.webhookDelivery.deleteMany({ where: { id: { in: ids } } }),
  );

  const suKien = await xoaTheoLo(
    (take) =>
      db.domainEvent.findMany({
        where: dieuKienXoaDomainEvent(cutoff),
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    (ids) => db.domainEvent.deleteMany({ where: { id: { in: ids } } }),
  );

  const kq: KetQuaDonWebhook = {
    cutoff: cutoff.toISOString(),
    ngayGiuLai,
    webhookDelivery: whDelivery.daXoa,
    domainEvent: suKien.daXoa,
    daChamTran: whDelivery.conTon || suKien.conTon,
  };

  // Ghi lại số dòng: xoá là không hoàn tác, nên phải còn một dòng log nói "đêm đó
  // dọn bao nhiêu, mốc cắt nào". Chỉ log KHI CÓ xoá — đêm sạch không cần tiếng động.
  if (kq.webhookDelivery > 0 || kq.domainEvent > 0) {
    console.warn(
      `[webhook-retention] đã xoá ${kq.webhookDelivery} WebhookDelivery + ${kq.domainEvent} DomainEvent cũ hơn ${kq.cutoff} (giữ ${ngayGiuLai} ngày)`,
    );
  }
  if (kq.daChamTran) {
    console.warn(
      "[webhook-retention] chạm trần lô — CÒN tồn đọng, lượt chạy sau sẽ dọn tiếp.",
    );
  }

  return kq;
}
