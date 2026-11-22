import "server-only";
// lib/integrations/zalocrm/doi-soat.ts — GĐ3, LƯỚI AN TOÀN cho đường webhook.
//
// ── Vì sao cần, khi fork đã có hàng đợi gửi lại ─────────────────────────────
// Hàng đợi của fork thử lại 1 giây / 30 giây / 5 phút rồi BỎ CUỘC. Sata nằm ngoài tầm
// ~5 phút rưỡi đó — triển khai lâu, Vercel lỗi kéo dài, DNS trục trặc — là tin rơi
// VĨNH VIỄN, và rơi IM LẶNG: khách đã nhắn, hộp thư không có gì, đồng hồ chăm sóc
// của phiếu vẫn chạy như chưa ai nhắn. Bộ này quét lại cửa sổ gần đây và nạp bù.
//
// ── 🔴 ĐI QUA ĐÚNG ĐƯỜNG NẠP CỦA WEBHOOK, KHÔNG VIẾT ĐƯỜNG THỨ HAI ─────────
// Nó DỰNG LẠI một payload hình dạng webhook rồi thả vào `dichPayloadZalocrm` +
// `napSuKienZalocrm` y như tin thật. Viết một đường ghi riêng cho cron là hai bộ luật
// cho cùng một việc, và bộ chạy 5 phút một lần là bộ không ai soi — luật nối phiếu,
// luật khách-là-ai theo chiều tin, luật mốc dòng thời gian sẽ trôi khỏi nhau.
//
// ── Chống trùng ────────────────────────────────────────────────────────────
// Không cần cơ chế mới: `channelMessageId = "<org>:<messageId>"` là UNIQUE, nên tin
// đã nạp thì `napSuKienZalocrm` trả `trung: true` và không ghi gì. Chạy bao nhiêu lượt
// cũng cho cùng một trạng thái — đó cũng là điều kiện để dám chạy nó mỗi 5 phút.
// Nhưng để khoá UNIQUE tự chặn thì mỗi tin trùng là một `create` ăn P2002: ~5/6 tin
// mỗi lượt, thành hàng trăm dòng `prisma:error` + ERROR Postgres mỗi giờ che mất lỗi
// thật. Nên trước khi nạp, tra theo lô tin nào đã có (`traTinDaCo`) và bỏ qua chúng;
// khoá UNIQUE vẫn là lưới cuối cho ca webhook và cron đua nhau.
//
// ── Cửa sổ quét, và giới hạn phải nói thẳng ────────────────────────────────
// Mỗi lượt nhìn lại `lookbackPhut` (mặc định 30). KHÔNG lưu mốc chạy lần trước, có chủ
// đích: một cột mốc hỏng là bộ này im lặng ngừng bù, và không ai phát hiện ra. Đổi lại,
// sự cố dài hơn cửa sổ thì phần rơi ngoài cửa sổ KHÔNG được bù tự động — lúc đó phải
// gọi tay với `lookbackPhut` rộng hơn. Ghi ra đây để không ai tưởng nó bù được mọi thứ.
import { getSetting } from "@/lib/settings/service";
import { traCauHinhOrg } from "@/lib/integrations/zalocrm/config";
import {
  docKhoaApi,
  layHoiThoaiZalocrm,
  layTinZalocrm,
  type HoiThoaiZalocrm,
  type TinZalocrm,
} from "@/lib/integrations/zalocrm/client";
import { dichPayloadZalocrm } from "@/lib/integrations/zalocrm/dich-payload";
import { napSuKienZalocrm } from "@/lib/integrations/zalocrm/nap-su-kien";
import { traTinDaCo } from "@/lib/integrations/zalocrm/tin-da-co";
import type { ViecTuWebhook } from "@/lib/integrations/zalocrm/types";
import { ghiNhatKyZalocrm } from "@/lib/integrations/zalocrm/log";

/** Cửa sổ nhìn lại mặc định — rộng gấp ~5 lần quãng thử lại của fork (5 phút rưỡi). */
export const LOOKBACK_PHUT_MAC_DINH = 30;
/** Trần hội thoại mỗi org một lượt. Cron 5 phút không được phép chạy quá lâu. */
export const TRAN_HOI_THOAI = 50;
/** Trần tin mỗi hội thoại một lượt. */
export const TRAN_TIN = 50;

export type KetQuaDoiSoatOrg = {
  orgCode: string;
  /** `false` = lượt này không quét được org đó (thiếu cấu hình / gọi hỏng). */
  ok: boolean;
  ma?: string;
  soHoiThoai: number;
  soTinXet: number;
  /** Tin đã có sẵn — trạng thái BÌNH THƯỜNG, và là phần lớn ở mọi lượt. */
  daCo: number;
  /** 🔴 Tin webhook ĐÃ LÀM RƠI. Khác 0 kéo dài = đường webhook đang có vấn đề. */
  napBu: number;
  loi: number;
};

/**
 * Quét bù tin cho mọi cơ sở đã ánh xạ orgCode.
 *
 * KHÔNG BAO GIỜ NÉM: một org hỏng không được kéo theo org khác, và cron phải kết thúc
 * để lượt sau còn chạy. Mọi hỏng hóc thành một dòng trong kết quả + nhật ký tích hợp.
 */
export async function doiSoatZalocrm(input?: {
  now?: Date;
  lookbackPhut?: number;
  tranHoiThoai?: number;
  tranTin?: number;
}): Promise<{ tong: { napBu: number; daCo: number; loi: number }; theoOrg: KetQuaDoiSoatOrg[] }> {
  const luc = input?.now ?? new Date();
  const phut = input?.lookbackPhut ?? LOOKBACK_PHUT_MAC_DINH;
  const moc = new Date(luc.getTime() - phut * 60_000);

  const anhXa = await getSetting("zalocrm.orgCodes");
  // Giá trị là orgCode; khoá là `Center.code` và không dùng ở đây. `Set` vì hai cơ sở
  // khai trùng orgCode (lỗi gõ) không được làm bộ này quét hai lượt cùng một tổ chức.
  const dsOrg = [...new Set(Object.values(anhXa ?? {}).filter((v): v is string => Boolean(v)))];

  const theoOrg: KetQuaDoiSoatOrg[] = [];
  for (const orgCode of dsOrg) {
    theoOrg.push(
      await doiSoatMotOrg({
        orgCode,
        moc,
        tranHoiThoai: input?.tranHoiThoai ?? TRAN_HOI_THOAI,
        tranTin: input?.tranTin ?? TRAN_TIN,
      }),
    );
  }

  const tong = theoOrg.reduce(
    (a, o) => ({ napBu: a.napBu + o.napBu, daCo: a.daCo + o.daCo, loi: a.loi + o.loi }),
    { napBu: 0, daCo: 0, loi: 0 },
  );
  return { tong, theoOrg };
}

async function doiSoatMotOrg(input: {
  orgCode: string;
  moc: Date;
  tranHoiThoai: number;
  tranTin: number;
}): Promise<KetQuaDoiSoatOrg> {
  const { orgCode, moc } = input;
  const rong: KetQuaDoiSoatOrg = {
    orgCode,
    ok: false,
    soHoiThoai: 0,
    soTinXet: 0,
    daCo: 0,
    napBu: 0,
    loi: 0,
  };

  // Chưa khai khoá API ⇒ BỎ QUA LẶNG LẼ, không ghi nhật ký lỗi. Trước GĐ3 không cơ sở
  // nào có khoá, và một cron kêu sai mỗi 5 phút là cách nhanh nhất khiến người vận hành
  // ngừng đọc nhật ký.
  if (!docKhoaApi(orgCode)) return { ...rong, ma: "CHUA_KHAI_KHOA_API" };

  const cauHinh = await traCauHinhOrg(orgCode);
  if (!cauHinh.ok) {
    await ghiNhatKyZalocrm({
      orgCode,
      action: "DOI_SOAT",
      status: "FAILED",
      errorMessage: `Cấu hình org không dùng được: ${cauHinh.ma}`,
    });
    return { ...rong, ma: cauHinh.ma };
  }

  const dsHoi = await layHoiThoaiZalocrm(orgCode, { since: moc, limit: input.tranHoiThoai });
  if (!dsHoi.ok) {
    await ghiNhatKyZalocrm({
      orgCode,
      action: "DOI_SOAT",
      status: "FAILED",
      errorMessage: `Không đọc được danh sách hội thoại: ${dsHoi.ma}`,
    });
    return { ...rong, ma: dsHoi.ma };
  }

  const hoiThoai = (dsHoi.data?.conversations ?? []).slice(0, input.tranHoiThoai);
  const kq: KetQuaDoiSoatOrg = { ...rong, ok: true, soHoiThoai: hoiThoai.length };

  for (const hoi of hoiThoai) {
    // Chốt 9.6 — hội thoại NHÓM không đồng bộ về Sata. Lọc ở đây để khỏi tốn một lượt
    // gọi lấy tin rồi vứt đi; `dichPayloadZalocrm` vẫn chặn lần nữa ở trong.
    if ((hoi.threadType ?? "").toLowerCase() === "group") continue;
    if (!hoi.zaloAccountId || !hoi.id) continue;

    const dsTin = await layTinZalocrm(orgCode, hoi.id, input.tranTin);
    if (!dsTin.ok) {
      kq.loi += 1;
      continue;
    }

    const dsViec: ViecTuWebhook[] = [];
    for (const tin of dsTin.data?.messages ?? []) {
      const luc = tin.sentAt ? new Date(tin.sentAt) : null;
      // Danh sách tin KHÔNG có bộ lọc `since`, nên tự cắt theo mốc: quét lại cả lịch sử
      // mỗi 5 phút là vô ích và tốn.
      if (!luc || Number.isNaN(luc.getTime()) || luc < moc) continue;

      kq.soTinXet += 1;
      const viec = dichPayloadZalocrm({ payload: dungPayloadTuTin(hoi, tin), orgCode });
      if (!viec.ok) {
        kq.loi += 1;
        continue;
      }
      dsViec.push(viec.viec);
    }

    // Tra một lượt cho cả hội thoại. Mọi tin TIN của cùng org đi chung một kênh
    // (`dichPayloadZalocrm` gán hằng), nên gom theo kênh là đủ.
    const daCoTheoKenh = new Map<string, Set<string>>();
    for (const v of dsViec) {
      if (v.loai !== "TIN" || daCoTheoKenh.has(v.tin.channel)) continue;
      const khoa = dsViec.flatMap((x) =>
        x.loai === "TIN" && x.tin.channel === v.tin.channel ? [x.tin.channelMessageId] : [],
      );
      daCoTheoKenh.set(v.tin.channel, await traTinDaCo(v.tin.channel, khoa));
    }

    for (const viec of dsViec) {
      if (viec.loai === "TIN" && daCoTheoKenh.get(viec.tin.channel)?.has(viec.tin.channelMessageId)) {
        kq.daCo += 1;
        continue;
      }
      const nap = await napSuKienZalocrm({ viec, cauHinh: cauHinh.cauHinh });
      if (!nap.ok) kq.loi += 1;
      else if (nap.trung) kq.daCo += 1;
      else kq.napBu += 1;
    }
  }

  // Chỉ ghi nhật ký khi CÓ CHUYỆN. Lượt sạch (phần lớn) im lặng — nhật ký đầy dòng
  // "không có gì" là nhật ký không ai đọc, và dòng đáng đọc sẽ trôi mất trong đó.
  if (kq.napBu > 0 || kq.loi > 0) {
    await ghiNhatKyZalocrm({
      orgCode,
      action: "DOI_SOAT",
      status: kq.loi > 0 ? "FAILED" : "SUCCESS",
      responsePayload: {
        napBu: kq.napBu,
        daCo: kq.daCo,
        loi: kq.loi,
        soHoiThoai: kq.soHoiThoai,
        soTinXet: kq.soTinXet,
      },
      errorMessage:
        kq.loi > 0 ? `Đối soát gặp ${kq.loi} tin không nạp được.` : null,
    });
  }

  return kq;
}

/**
 * Dựng payload hình dạng webhook từ một tin của Public API.
 *
 * Chiều tin suy từ `senderType`: `self` là tin của nick mình gửi ra. Suy sai chiều là
 * `dichPayloadZalocrm` lấy nhầm "khách là ai" (chiều ĐI khách nằm ở `threadId`, chiều
 * ĐẾN khách là người gửi) ⇒ hội thoại tách đôi và danh tính mang tên nhân viên.
 *
 * `senderUid`/`threadId` đều lấy `externalThreadId` của hội thoại: đây là chat 1-1
 * (nhóm đã lọc ở trên) nên đầu kia của luồng CHÍNH LÀ khách, ở cả hai chiều.
 */
export function dungPayloadTuTin(hoi: HoiThoaiZalocrm, tin: TinZalocrm): Record<string, unknown> {
  const laMinhGui = tin.senderType === "self";
  return {
    event: laMinhGui ? "message.sent" : "message.received",
    data: {
      messageId: tin.id,
      zaloAccountId: hoi.zaloAccountId,
      conversationId: hoi.id,
      threadId: hoi.externalThreadId,
      senderUid: hoi.externalThreadId,
      threadType: hoi.threadType ?? "user",
      sentAt: tin.sentAt,
      content: tin.content,
      contentType: tin.contentType ?? "text",
      contactId: hoi.contact?.id,
      contact: hoi.contact
        ? { id: hoi.contact.id, fullName: hoi.contact.fullName, phone: hoi.contact.phone }
        : undefined,
      // ⚠️ CỐ Ý để trống với tin ĐI: Public API không nói ai bấm Gửi. Đoán bừa một
      // người là ghi sai mốc "đã liên hệ" của phiếu và làm mới nhầm đồng hồ chăm sóc
      // của một Sale không hề nhắn. Thiếu thì chỉ là không quy được tin về ai.
      sentByExternalId: null,
    },
  };
}
