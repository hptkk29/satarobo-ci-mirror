import "server-only";
// lib/integrations/zalocrm/nap-su-kien.ts — CHUỖI XỬ LÝ sau khi đã hiểu payload.
//
// Vai của file này giống hệt `lib/calls/nap-cdr.ts` với trục gọi (OmiCall — đã gỡ 06/10/2026): `webhook.ts` chỉ
// giữ 7 bước (và một test bất biến canh thứ tự của chúng), còn toàn bộ phần "làm gì
// với dữ liệu" nằm ở đây để đọc được và test được riêng.
//
// ── CHUỖI ĐẦY ĐỦ CHO MỘT TIN, VÀ VÌ SAO KHÔNG BƯỚC NÀO BỎ ĐƯỢC ───────────────
//  1. NICK      — `ZaloCrmNick` cho biết nick thuộc cơ sở nào. Đây là nguồn đơn vị
//                 MẠNH THỨ HAI (sau `Lead`), và là thứ duy nhất biết được ngay từ
//                 tin đầu tiên.
//  2. INGEST    — `ingestInboundMessage` / `ingestOutboundEcho`. Chống trùng nằm ở
//                 tầng DB (`@@unique([channel, channelMessageId])`), không tra trước.
//  3. GẮN CƠ SỞ — `ganDonViTheoNick`. **Bỏ bước này là hội thoại ở lại nhóm mồ côi,
//                 mà nhóm mồ côi thì MỌI cơ sở đọc được** (`lib/inbox/scope.ts`).
//  4. NỐI PHIẾU — `ZaloCrmThread` (vế "đặt trước" do nút "Nhắn Zalo" ghi) trước, rồi
//                 mới `thuNoiTheoSdt` theo SĐT. KHÔNG tự tạo lead (chốt 9.3/9.5).
//  5. DÒNG THỜI GIAN — chỉ TIN ĐI, và chỉ khi phiếu đã biết (`ghiMocNhanTinLead`).
//
// ── LỖI NÀO NÉM, LỖI NÀO KHÔNG ───────────────────────────────────────────────
// Lỗi HẠ TẦNG (Prisma ngã) ĐỂ NÉM RA — `webhook.ts` bắt và trả 5xx cho outbox của
// fork retry. Lỗi NGHIỆP VỤ (thiếu dữ liệu, không nối được phiếu) trả `{ok:false}`
// hoặc chỉ ghi chú: bắt bên gửi retry một payload không bao giờ xử lý được là vô ích.
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { SYSTEM_ACTOR } from "@/lib/auth/system-actor";
import { ganDonViTheoNick } from "@/lib/inbox/don-vi";
import { noiIdentityVaoLead, thuNoiTheoSdt } from "@/lib/inbox/identity";
import { ingestInboundMessage, ingestOutboundEcho } from "@/lib/inbox/ingest";
import { layHoiThoaiDeThaoTac, NgoaiTamNhinError } from "@/lib/inbox/thao-tac";
import { ghiMocNhanTinLead } from "./lead-timeline";
import type { CauHinhOrg } from "./config";
import type { TrangThaiNick, ViecTinNhan, ViecTuWebhook } from "./types";

export type KetQuaNapSuKien =
  | {
      ok: true;
      /** `true` = tin đã có rồi. Ánh xạ thẳng sang `markWebhookDelivery("DUPLICATE")`. */
      trung: boolean;
      conversationId?: string;
      /** Mã ngắn cho nhật ký khi không có gì để làm (sự kiện bỏ qua). */
      ghiChu?: string;
    }
  | { ok: false; ma: string; thongDiep: string };

/** Nhãn hiện trên dòng thời gian khi không quy được tin về một tài khoản Sata nào. */
const TEN_NGUOI_GUI_KHONG_RO = "Nick Zalo (chưa nối tài khoản)";

export async function napSuKienZalocrm(input: {
  viec: ViecTuWebhook;
  cauHinh: CauHinhOrg;
}): Promise<KetQuaNapSuKien> {
  const { viec, cauHinh } = input;
  switch (viec.loai) {
    case "BO_QUA":
      return { ok: true, trung: false, ghiChu: viec.lyDo };
    case "NICK": {
      await napNick({
        zcrmAccountId: viec.zcrmAccountId,
        cauHinh,
        luc: viec.luc,
        trangThai: viec.trangThai,
      });
      return { ok: true, trung: false, ghiChu: `NICK_${viec.trangThai}` };
    }
    case "LIEN_HE": {
      await napThreadTheoSdt({
        orgCode: viec.orgCode,
        phone: viec.phone,
        zcrmContactId: viec.zcrmContactId,
        cauHinh,
      });
      // ⚠️ NỐI PHIẾU KHÔNG XẢY RA Ở ĐÂY, có lý do: sự kiện này chỉ mang `contactId`,
      // không mang `conversationId` — mà đường tra "hội thoại nào ứng với luồng
      // ZaloCRM nào" nằm trong `lib/inbox/` (module đó cấm file ngoài truy vấn thẳng
      // ba bảng `Inbox*`, có test canh). Số vừa ghi xuống `ZaloCrmThread` sẽ được
      // dùng ở LƯỢT TIN KẾ TIẾP của chính hội thoại đó — trễ đúng một tin.
      return { ok: true, trung: false, ghiChu: "LIEN_HE_DA_GHI_SDT" };
    }
    case "TIN":
      return napTin(viec, cauHinh);
  }
}

// ── Tin nhắn ─────────────────────────────────────────────────────────────────

async function napTin(viec: ViecTinNhan, cauHinh: CauHinhOrg): Promise<KetQuaNapSuKien> {
  // 1 — nick: nguồn `orgUnitId` biết được ngay từ tin đầu tiên.
  const nick = await napNick({
    zcrmAccountId: viec.zcrmAccountId,
    cauHinh,
    luc: viec.sentAt,
  });

  // 2 — ingest. Chống trùng ở tầng DB, không "tra trước rồi ghi".
  const ket =
    viec.huong === "DEN"
      ? await ingestInboundMessage(viec.tin)
      : await ingestOutboundEcho(viec.tin);

  if (ket.duplicate) {
    // Dừng HẲN ở đây: mọi bước sau đều là ghi, và chạy lại chúng cho một tin đã có
    // là ghi đè lần thứ hai lên dòng thời gian lead.
    return { ok: true, trung: true, conversationId: ket.conversationId };
  }

  // 3 — gắn cơ sở. Bỏ bước này là hội thoại ở lại nhóm "ai cũng đọc được".
  await ganDonViTheoNick({ conversationId: ket.conversationId, orgUnitId: nick.orgUnitId });

  // 4 — nối phiếu.
  const thread = await napThreadTheoSdt({
    orgCode: viec.orgCode,
    phone: viec.phone,
    zcrmContactId: viec.zcrmContactId,
    zcrmConversationId: viec.zcrmConversationId,
    // Cơ sở của NICK thắng cơ sở suy từ ánh xạ cấp org: nick có thể đã được người
    // gán tay ở màn Tích hợp, và quyết định của người thì máy không lật lại.
    cauHinh: {
      ...cauHinh,
      centerId: nick.centerId ?? cauHinh.centerId,
      orgUnitId: nick.orgUnitId ?? cauHinh.orgUnitId,
    },
  });

  const leadId = await noiPhieu({
    conversationId: ket.conversationId,
    leadIdDatTruoc: thread.leadId,
    phone: viec.phone,
    orgUnitId: nick.orgUnitId,
  });

  // Nối được bằng SĐT thì ghi ngược vào ánh xạ, để lần sau khỏi tra lại.
  if (leadId && thread.id && !thread.leadId) {
    await db.zaloCrmThread.update({ where: { id: thread.id }, data: { leadId } });
  }

  // 5 — dòng thời gian: CHỈ tin ĐI. Ghi mốc cho tin ĐẾN sẽ bump `lastActivityAt` và
  // che mất đúng thứ cần cảnh báo ("khách nhắn mà Sale im") — xem `lead-timeline.ts`.
  if (viec.huong === "DI" && leadId && ket.messageId) {
    await ghiMocDongThoiGian({ viec, leadId, inboxMessageId: ket.messageId });
  }

  return { ok: true, trung: false, conversationId: ket.conversationId };
}

/**
 * Nối hội thoại với phiếu lead. Trả `leadId` đã nối, hoặc `null`.
 *
 * Hai đường, theo thứ tự MẠNH → YẾU:
 *  1. `ZaloCrmThread.leadId` — vế "đặt trước": Sale đã bấm "Nhắn Zalo" TỪ chính phiếu
 *     đó, nên đây là ý định tường minh của con người, không phải suy đoán.
 *  2. SĐT khớp ĐÚNG MỘT phiếu CÙNG CƠ SỞ (`thuNoiTheoSdt`). Nhiều hơn một ⇒ để mồ
 *     côi: nối nhầm nghĩa là hội thoại của khách A nằm trong hồ sơ khách B, và nó chỉ
 *     lộ ra lúc Sale gọi nhầm người.
 *
 * 🔴 KHÔNG TỰ TẠO LEAD (chốt 9.3/9.5). Một người nhắn "alo" không phải một phiếu
 * khách; tạo tự động là bơm rác vào phễu và vào cả số liệu chuyển đổi.
 */
async function noiPhieu(input: {
  conversationId: string;
  leadIdDatTruoc: string | null;
  phone: string | null;
  orgUnitId: string | null;
}): Promise<string | null> {
  const identityId = await docDanhTinh(input.conversationId);
  if (!identityId) return null;

  if (input.leadIdDatTruoc) {
    // `EXTERNAL_TAG` chứ KHÔNG phải `WEBHOOK_PROFILE`: giá trị kia là BẰNG CHỨNG
    // ĐỒNG Ý (khách tự bấm "Chia sẻ thông tin"), ghi một phép nối máy-với-máy vào đó
    // là làm hỏng vết đồng ý.
    await noiIdentityVaoLead({
      identityId,
      leadId: input.leadIdDatTruoc,
      source: "EXTERNAL_TAG",
      boiUserId: null,
    });
    return input.leadIdDatTruoc;
  }

  if (!input.phone) return null;
  const qd = await thuNoiTheoSdt({
    identityId,
    sdt: input.phone,
    // BẮT BUỘC truyền: thiếu nó là nối hội thoại CS1 vào phiếu CS2 khi hai bên trùng
    // số — đúng lỗi B3 vừa vá.
    orgUnitId: input.orgUnitId,
  });
  return qd.noi ? qd.leadId : null;
}

/**
 * `identityId` của một hội thoại.
 *
 * Đi qua `layHoiThoaiDeThaoTac` với `SYSTEM_ACTOR` — đó là Actor được dựng riêng cho
 * "cron/webhook, không request/session" (`lib/auth/system-actor.ts`). Không tự query
 * `db.inboxConversation` ở đây: `lib/inbox/cong-truy-cap.test.ts` cấm mọi file ngoài
 * `lib/inbox/` chạm ba bảng đó, và lệnh cấm ấy là thứ giữ cho cách ly cơ sở không bị
 * quên ở một chỗ nào đấy.
 */
async function docDanhTinh(conversationId: string): Promise<string | null> {
  try {
    const hoi = await layHoiThoaiDeThaoTac(SYSTEM_ACTOR, conversationId);
    return hoi.identityId;
  } catch (err) {
    if (err instanceof NgoaiTamNhinError) {
      // Hội thoại vừa được `ingest*` tạo ra nên ca này gần như không xảy ra; nếu xảy
      // ra thì đó là dữ liệu lệch, KHÔNG phải lý do để trả 5xx và bắt retry.
      console.warn(`[zalocrm] không đọc được danh tính của hội thoại ${conversationId}`);
      return null;
    }
    throw err;
  }
}

async function ghiMocDongThoiGian(input: {
  viec: ViecTinNhan;
  leadId: string;
  inboxMessageId: string;
}): Promise<void> {
  const nguoiGui = await mapNguoiGui(input.viec.sentByExternalId);
  const lead = await db.lead.findUnique({
    where: { id: input.leadId },
    select: { assignedToId: true },
  });
  if (!lead) return;

  await ghiMocNhanTinLead({
    leadId: input.leadId,
    inboxMessageId: input.inboxMessageId,
    noiDung: input.viec.noiDung,
    huong: "DI",
    // Tin đã rời khỏi hệ thống thật (ZaloCRM chỉ bắn `message.sent` sau khi gửi).
    daGuiDuoc: true,
    sentByUserId: nguoiGui.id,
    actorName: nguoiGui.name,
    assignedToId: lead.assignedToId,
    // Đường webhook KHÔNG có phiên đăng nhập ⇒ không suy được quyền điều phối.
    // Tham số này dành cho đường CÓ phiên (Sale bấm gửi từ giao diện Sata).
    coQuyenDieuPhoi: false,
  });
}

/**
 * `sentByExternalId` → `User` của Sata.
 *
 * Fork lưu `external_id = User.id` (xem `sso.ts`), nên chuỗi này ĐÁNG LẼ là một
 * `User.id`. Vẫn phải kiểm tồn tại: nó do máy chủ bên kia gửi sang, và một id sai sẽ
 * làm `recordLeadActivity` gắn hoạt động cho một tài khoản không có thật.
 */
async function mapNguoiGui(
  externalId: string | null,
): Promise<{ id: string | null; name: string }> {
  if (!externalId) return { id: null, name: TEN_NGUOI_GUI_KHONG_RO };
  const u = await db.user.findFirst({
    where: { id: externalId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!u) {
    console.warn(`[zalocrm] sentByExternalId không khớp tài khoản Sata nào: ${externalId}`);
    return { id: null, name: TEN_NGUOI_GUI_KHONG_RO };
  }
  return { id: u.id, name: u.name ?? TEN_NGUOI_GUI_KHONG_RO };
}

// ── Nick ─────────────────────────────────────────────────────────────────────

type NickDaNap = { orgUnitId: string | null; centerId: string | null; sataUserId: string | null };

/**
 * Lấy (hoặc tạo) dòng `ZaloCrmNick`, cập nhật `lastEventAt`/`status`.
 *
 * IDEMPOTENT là yêu cầu cứng: `zalo.connected` bắn CẢ KHI reconnect, nên mỗi lần khởi
 * động lại máy chủ ZaloCRM là một loạt sự kiện cho cùng một nick.
 *
 * ⚠️ Nick ĐÃ XOÁ MỀM thì KHÔNG hồi sinh: người vận hành đã gỡ nó có chủ đích (nhân sự
 * nghỉ, nick bị khoá). Vẫn nhận tin, nhưng lấy đơn vị ở cấp org — tin không rơi, mà
 * quyết định của người cũng không bị máy lật lại.
 */
async function napNick(input: {
  zcrmAccountId: string;
  cauHinh: CauHinhOrg;
  luc: Date;
  trangThai?: TrangThaiNick;
}): Promise<NickDaNap> {
  const { zcrmAccountId, cauHinh, luc, trangThai } = input;

  // `findUnique` (không `findFirst`) vì phải thấy CẢ dòng đã xoá mềm — nếu không thì
  // nhánh `create` bên dưới va `@unique` mà không hiểu vì sao.
  const co = await db.zaloCrmNick.findUnique({
    where: { zcrmAccountId },
    select: {
      id: true,
      orgUnitId: true,
      centerId: true,
      sataUserId: true,
      lastEventAt: true,
      deletedAt: true,
    },
  });

  if (co?.deletedAt) {
    console.warn(`[zalocrm] nick ${zcrmAccountId} đã gỡ — không hồi sinh, dùng đơn vị cấp org.`);
    return { orgUnitId: cauHinh.orgUnitId, centerId: cauHinh.centerId, sataUserId: null };
  }

  if (co) {
    await db.zaloCrmNick.update({
      where: { id: co.id },
      data: {
        // Giữ mốc MỚI HƠN: sự kiện tới lệch thứ tự không được kéo lùi đồng hồ, vì
        // cảnh báo "connected mà im > N giờ" đọc chính cột này.
        lastEventAt: !co.lastEventAt || co.lastEventAt < luc ? luc : co.lastEventAt,
        ...(trangThai ? { status: trangThai } : {}),
        // Điền vào chỗ TRỐNG, không đè: cơ sở có thể đã được người gán tay ở màn
        // Tích hợp, và bảng ánh xạ org→cơ sở chỉ là phỏng đoán cấp org.
        ...(co.centerId ? {} : { centerId: cauHinh.centerId }),
        ...(co.orgUnitId ? {} : { orgUnitId: cauHinh.orgUnitId }),
      },
    });
    return {
      orgUnitId: co.orgUnitId ?? cauHinh.orgUnitId,
      centerId: co.centerId ?? cauHinh.centerId,
      sataUserId: co.sataUserId,
    };
  }

  try {
    await db.zaloCrmNick.create({
      data: {
        zcrmAccountId,
        orgCode: cauHinh.orgCode,
        centerId: cauHinh.centerId,
        orgUnitId: cauHinh.orgUnitId,
        status: trangThai ?? "UNKNOWN",
        lastEventAt: luc,
      },
    });
  } catch (err) {
    // Hai webhook song song cùng tạo một nick: `@unique` chặn đúng cái đua đó. Đọc
    // lại là đủ, KHÔNG ném — ném ở đây là tin thật rơi vì một cuộc đua vô hại.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
  }

  return {
    orgUnitId: cauHinh.orgUnitId,
    centerId: cauHinh.centerId,
    sataUserId: null,
  };
}

// ── Ánh xạ hội thoại ↔ phiếu (`ZaloCrmThread`) ───────────────────────────────

type ThreadDaNap = { id: string | null; leadId: string | null };

/**
 * Tìm/ghi dòng ánh xạ `(orgCode, phone)` ↔ hội thoại ↔ phiếu.
 *
 * 🔴 TUYỆT ĐỐI KHÔNG ĐÈ `zcrmConversationId` ĐANG KHÁC NULL (ghi chú ngay trong
 * schema): `@@unique([orgCode, phone])` nghĩa là một số trong một org chỉ giữ được
 * MỘT ánh xạ. Nếu cùng số thật sự có hai hội thoại (khách nhắn hai nick), hội thoại
 * thứ hai phải để MỒ CÔI cho người xử lý — cướp ánh xạ của hội thoại thứ nhất là
 * chuyển lịch sử của khách sang nhầm chỗ, im lặng.
 *
 * Không có SĐT ⇒ không tạo dòng (cột `phone` NOT NULL, và dòng không có số thì cũng
 * không nối được gì).
 */
async function napThreadTheoSdt(input: {
  orgCode: string;
  phone: string | null;
  zcrmContactId: string | null;
  zcrmConversationId?: string;
  cauHinh: CauHinhOrg;
}): Promise<ThreadDaNap> {
  const { orgCode, phone, zcrmContactId, zcrmConversationId, cauHinh } = input;

  // Đường 1 — đã có ánh xạ theo hội thoại.
  if (zcrmConversationId) {
    const theoHoiThoai = await db.zaloCrmThread.findFirst({
      where: { zcrmConversationId, deletedAt: null },
      select: { id: true, leadId: true, zcrmContactId: true, orgUnitId: true },
    });
    if (theoHoiThoai) {
      await boSungThread(theoHoiThoai, { zcrmContactId, phone: null, cauHinh });
      return { id: theoHoiThoai.id, leadId: theoHoiThoai.leadId };
    }
  }

  if (!phone) return { id: null, leadId: null };

  // Đường 2 — dòng "đặt trước" do nút "Nhắn Zalo" ghi lúc chưa có hội thoại.
  const theoSdt = await db.zaloCrmThread.findFirst({
    where: { orgCode, phone, deletedAt: null },
    select: {
      id: true,
      leadId: true,
      zcrmContactId: true,
      zcrmConversationId: true,
      orgUnitId: true,
    },
  });

  if (theoSdt) {
    await db.zaloCrmThread.update({
      where: { id: theoSdt.id },
      data: {
        // CHỈ điền khi đang NULL — xem khối chú thích trên.
        ...(zcrmConversationId && !theoSdt.zcrmConversationId ? { zcrmConversationId } : {}),
        ...(zcrmContactId && !theoSdt.zcrmContactId ? { zcrmContactId } : {}),
        ...(theoSdt.orgUnitId
          ? {}
          : { centerId: cauHinh.centerId, orgUnitId: cauHinh.orgUnitId }),
      },
    });
    return { id: theoSdt.id, leadId: theoSdt.leadId };
  }

  // Đường 3 — chưa có gì, tạo mới.
  try {
    const moi = await db.zaloCrmThread.create({
      data: {
        orgCode,
        phone,
        zcrmConversationId: zcrmConversationId ?? null,
        zcrmContactId,
        centerId: cauHinh.centerId,
        orgUnitId: cauHinh.orgUnitId,
      },
      select: { id: true, leadId: true },
    });
    return moi;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    // Đua với một lượt webhook song song (hoặc với nút "Nhắn Zalo"): đọc lại.
    const lai = await db.zaloCrmThread.findFirst({
      where: { orgCode, phone, deletedAt: null },
      select: { id: true, leadId: true },
    });
    return lai ?? { id: null, leadId: null };
  }
}

/** Điền vào chỗ trống của một dòng ánh xạ đã có. Không bao giờ đè giá trị đang có. */
async function boSungThread(
  row: { id: string; zcrmContactId: string | null; orgUnitId: string | null },
  them: { zcrmContactId: string | null; phone: string | null; cauHinh: CauHinhOrg },
): Promise<void> {
  const data: Prisma.ZaloCrmThreadUpdateInput = {};
  if (them.zcrmContactId && !row.zcrmContactId) data.zcrmContactId = them.zcrmContactId;
  if (!row.orgUnitId) {
    data.centerId = them.cauHinh.centerId;
    data.orgUnitId = them.cauHinh.orgUnitId;
  }
  if (Object.keys(data).length === 0) return;
  await db.zaloCrmThread.update({ where: { id: row.id }, data });
}
