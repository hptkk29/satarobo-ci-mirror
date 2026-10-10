import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { guiTinRaMeta, messengerSendDaCauHinh } from "@/lib/crm/meta-messenger-provider";

/**
 * S-2b — DÀN XẾP GỬI TIN MESSENGER: cửa sổ 24h → giành chỗ PENDING → gửi → chốt sổ.
 *
 * ── Luật sống-còn của file này ───────────────────────────────────────────────
 * `MessengerConversation.respondedAt` CHỈ được set khi tin đi **THẬT**.
 * `lib/crm/sla.ts:71` đọc đúng cột đó để bật cảnh báo SLA-0 "có tin đến mà chưa phản
 * hồi". Set nó cho một tin mô phỏng hay một tin gửi hỏng là tự tay tắt cảnh báo của
 * một khách chưa ai trả lời — báo cáo SLA đẹp lên bằng số liệu bịa. Đây chính là nửa
 * nguy hiểm hơn của lỗi cũ, nửa mà vá cái toast không chạm tới.
 *
 * ── Vì sao GIÀNH CHỖ trước rồi mới gửi (spec MS-2, mẫu `ChatZnsNotification`) ──
 * Ghi dòng `PENDING` trước, gọi Meta sau, rồi mới chốt trạng thái. Tiến trình chết
 * giữa chừng thì dòng đó **nằm lại ở PENDING** — đọc ra là "không rõ đã tới chưa",
 * đúng sự thật — và vì `respondedAt` chưa được set nên SLA vẫn kêu. Nghiêng có chủ
 * đích về "thiếu một tin" thay vì "gửi khách hai lần".
 * Ghi chú trong `actions.ts` bản S-2a có dặn "gửi trước rồi mới ghi"; điều nó thật sự
 * chống là **`respondedAt` của một tin chưa đi** — luật đó được giữ nguyên ở đây,
 * chỉ khác là dòng nhật ký được đặt trước để không mất dấu lượt gửi nào.
 *
 * ── Chịu được nhà cung cấp hỏng ──────────────────────────────────────────────
 * Không có `$transaction` nào bao quanh lời gọi mạng: Meta treo 10 giây không được
 * phép giữ một transaction Postgres suốt 10 giây đó. Provider ném cũng được bắt lại
 * và chốt sổ `FAILED`.
 */

/** Cửa sổ trả lời của Meta: 24 giờ kể từ tin nhắn CUỐI của khách. */
export const CUA_SO_META_MS = 24 * 60 * 60 * 1000;

/** Trạng thái gửi ghi vào `MessengerMessage.sendStatus`. NULL = tin ĐẾN, hoặc tin cũ trước S-2b. */
export type TrangThaiGuiTin = "PENDING" | "SENT" | "SIMULATED" | "FAILED";

export type MaLoiTraLoi =
  | "KHONG_CO_HOI_THOAI"
  | "NOI_DUNG_TRONG"
  | "CHUA_CO_TIN_DEN"
  | "NGOAI_CUA_SO_24H"
  | "GUI_THAT_BAI";

export type KetQuaGuiTraLoi =
  /** Đã gửi thật, Meta xác nhận bằng `mid`. */
  | { ok: true; daGuiThat: true; messageId: string; providerMessageId: string }
  /** Đã ghi sổ nhưng KHÔNG gọi Meta (thiếu khoá hoặc công tắc live đang tắt). */
  | { ok: true; daGuiThat: false; messageId: string; canhBao: string }
  /** Không gửi được. `loi` là câu tiếng Việt để hiện thẳng cho người dùng. */
  | { ok: false; ma: MaLoiTraLoi; loi: string };

const CAU_MO_PHONG =
  "Đang ở chế độ mô phỏng: tin đã lưu vào hệ thống nhưng KHÔNG gửi tới khách. " +
  "Cần điền khoá Meta và bật công tắc “Gửi tin Messenger THẬT” ở Cấu hình vận hành.";

const CAU_NGOAI_CUA_SO =
  "Facebook chỉ cho trả lời trong 24 giờ kể từ tin nhắn cuối của khách. " +
  "Hội thoại này đã quá hạn — hãy gọi điện hoặc nhắn Zalo cho khách.";

const CAU_CHUA_CO_TIN_DEN =
  "Chưa có tin nhắn nào từ khách trong hội thoại này. Facebook chỉ cho phép trả lời, " +
  "không cho chủ động nhắn trước.";

/** Lời báo cho người dùng theo mã lỗi provider. Không bao giờ hiện mã máy ra màn hình. */
function cauChoNguoiDung(ma: string): string {
  switch (ma) {
    case "NGOAI_CUA_SO_24H":
      return CAU_NGOAI_CUA_SO;
    case "META_SAI_PAGE":
      return "Trang Facebook của hội thoại này chưa được cấu hình khoá gửi tin. Báo kỹ thuật để bổ sung.";
    case "META_KHONG_TRA_LOI":
      return "Facebook không phản hồi (mạng chậm hoặc quá hạn chờ). Tin CHƯA gửi được — thử lại sau ít phút.";
    default:
      return "Facebook từ chối gửi tin này. Tin CHƯA tới khách — xem chi tiết lỗi trong lịch sử hội thoại hoặc báo kỹ thuật.";
  }
}

/**
 * Có được gọi API thật không? Công tắc `messenger.sendLive` (SystemSetting — tắt gấp
 * không cần deploy) thắng; env `META_MESSENGER_LIVE` là dự phòng cho máy dev.
 * ⚠️ AD-2: ĐỌC công tắc lỗi (DB sập) ⇒ coi như KHÔNG live. Thà không gửi còn hơn gửi
 * nhầm hàng loạt ra khách thật.
 */
async function dangChayThat(): Promise<boolean> {
  const tuDb = await getSetting("messenger.sendLive").catch(() => false);
  return Boolean(tuDb) || process.env.META_MESSENGER_LIVE === "true";
}

export async function guiTraLoiMessenger(input: {
  conversationId: string;
  text: string;
  /** Người thật đang bấm gửi — nguồn attribution duy nhất (spec S4). */
  sentByUserId: string;
  now?: Date;
}): Promise<KetQuaGuiTraLoi> {
  const now = input.now ?? new Date();
  const text = input.text?.trim() ?? "";
  if (!text) return { ok: false, ma: "NOI_DUNG_TRONG", loi: "Nội dung trống." };

  // Người gọi đã kiểm quyền + phạm vi cơ sở (scopedDb). Ở đây đọc lại bằng `db` trần
  // vì cần `pageId`/`psid` — hai trường kỹ thuật của kênh, không phải dữ liệu nghiệp vụ.
  const conv = await db.messengerConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, pageId: true, psid: true, respondedAt: true },
  });
  if (!conv) {
    return { ok: false, ma: "KHONG_CO_HOI_THOAI", loi: "Không tìm thấy hội thoại." };
  }

  // ─── Cổng cửa sổ 24h: chặn TRƯỚC khi tốn một lời gọi ────────────────────────
  // Chặn ở đây thay vì để Meta từ chối, vì (a) nhanh hơn và không phụ thuộc mạng,
  // (b) không đẻ một dòng FAILED cho việc lẽ ra biết trước là không gửi được.
  // Meta VẪN có thể từ chối (đua thời gian, chính sách đổi) — nhánh đó bắt ở dưới.
  const tinDenCuoi = await db.messengerMessage.findFirst({
    where: { conversationId: conv.id, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (!tinDenCuoi) {
    return { ok: false, ma: "CHUA_CO_TIN_DEN", loi: CAU_CHUA_CO_TIN_DEN };
  }
  if (now.getTime() - tinDenCuoi.sentAt.getTime() > CUA_SO_META_MS) {
    return { ok: false, ma: "NGOAI_CUA_SO_24H", loi: CAU_NGOAI_CUA_SO };
  }

  // ─── Giành chỗ PENDING ─────────────────────────────────────────────────────
  const dong = await db.messengerMessage.create({
    data: {
      conversationId: conv.id,
      direction: "OUT",
      text,
      sentAt: now,
      sendStatus: "PENDING" satisfies TrangThaiGuiTin,
      sentByUserId: input.sentByUserId,
    },
    select: { id: true },
  });

  const chotSo = async (data: Record<string, unknown>) => {
    try {
      await db.messengerMessage.update({ where: { id: dong.id }, data });
    } catch {
      // Hầu như chỉ xảy ra khi `externalEventId` (= `mid`) đã có trong sổ vì echo của
      // Meta về trước ta kịp chốt. Tin ĐÃ đi thật rồi — thử lại không kèm `mid` để
      // trạng thái không kẹt vĩnh viễn ở PENDING.
      const conLai = { ...data };
      delete conLai.externalEventId;
      await db.messengerMessage
        .update({ where: { id: dong.id }, data: conLai })
        .catch(() => undefined);
    }
  };

  // ─── Mô phỏng: thiếu khoá, hoặc công tắc live đang tắt ──────────────────────
  const daCauHinh = messengerSendDaCauHinh(conv.pageId);
  const chayThat = daCauHinh ? await dangChayThat() : false;
  if (!chayThat) {
    // Tiền lệ ZNS (`lib/chat/zns-notify.ts:417-420`): ghi trạng thái SIMULATED vào sổ
    // và nói thẳng "khách KHÔNG nhận gì" — KHÔNG đi nhánh "vẫn coi như đã gửi" của
    // `lib/notify/attendance.ts:123-125` (chép nhầm nhánh đó = số liệu nghiệm thu giả).
    await chotSo({ sendStatus: "SIMULATED" satisfies TrangThaiGuiTin });
    console.warn(
      `[messenger-send] SIMULATED (message ${dong.id}) — khách KHÔNG nhận tin thật ` +
        `(${daCauHinh ? "công tắc messenger.sendLive đang tắt" : "thiếu khoá Meta"}).`,
    );
    return { ok: true, daGuiThat: false, messageId: dong.id, canhBao: CAU_MO_PHONG };
  }

  // ─── Gọi thật ──────────────────────────────────────────────────────────────
  let kq: Awaited<ReturnType<typeof guiTinRaMeta>>;
  try {
    kq = await guiTinRaMeta({ pageId: conv.pageId, psid: conv.psid, text });
  } catch (err) {
    // Provider hứa không ném, nhưng "hứa" không phải cơ chế: một lỗi lập trình trong
    // đó cũng không được phép thành 500 câm ở màn hộp thư.
    kq = {
      ok: false,
      ma: "META_KHONG_TRA_LOI",
      loiGoc: err instanceof Error ? err.message : "UNKNOWN",
    };
  }

  if (!kq.ok) {
    await chotSo({
      sendStatus: "FAILED" satisfies TrangThaiGuiTin,
      errorCode: kq.maLoiMeta ?? kq.ma,
      errorMessage: (kq.loiGoc ?? kq.ma).slice(0, 1000),
    });
    // ⚠️ KHÔNG set respondedAt — xem "Luật sống-còn" ở đầu file.
    return { ok: false, ma: "GUI_THAT_BAI", loi: cauChoNguoiDung(kq.ma) };
  }

  await chotSo({
    sendStatus: "SENT" satisfies TrangThaiGuiTin,
    providerMessageId: kq.providerMessageId,
    // MS-3 — `mid` vào luôn `externalEventId`: Meta bắn lại echo của chính tin này,
    // và cột đó là @unique nên echo không đẻ được bản ghi thứ hai.
    externalEventId: kq.providerMessageId,
  });

  // Chỉ tới đây mới có bằng chứng tin đã tới khách ⇒ mới được chạm respondedAt.
  // Giữ mốc phản hồi ĐẦU TIÊN, không ghi đè.
  if (!conv.respondedAt) {
    await db.messengerConversation.update({
      where: { id: conv.id },
      data: { respondedAt: now },
    });
  }

  return {
    ok: true,
    daGuiThat: true,
    messageId: dong.id,
    providerMessageId: kq.providerMessageId,
  };
}

/**
 * Hội thoại của Page này đang ở chế độ MÔ PHỎNG? (thiếu khoá Meta, hoặc công tắc
 * `messenger.sendLive` đang tắt). Dùng cho giao diện nói thật TRƯỚC khi người dùng gõ,
 * chứ không để họ bấm rồi mới biết. Fail-closed y như đường gửi: đọc lỗi ⇒ mô phỏng.
 */
export async function messengerDangMoPhong(pageId: string): Promise<boolean> {
  if (!messengerSendDaCauHinh(pageId)) return true;
  return !(await dangChayThat());
}
