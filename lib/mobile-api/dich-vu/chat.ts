import { z } from "zod";

import { db } from "@/lib/db";

import { resolveActor } from "@/lib/auth/actor";
import { openDmAsActor } from "@/lib/chat/dm";
import { CHAT_ATTACHMENT_LOOKUP_MAX, CHAT_BODY_MAX, listChatAttachments, sendChatMessageAsActor } from "@/lib/chat/messages";
import { docByteDauChat, headChatObject } from "@/lib/storage/chat-storage";
import { kiemNoiDung } from "@/lib/mobile-api/kho-tep-rieng";
import { recallOwnMessageAsActor } from "@/lib/chat/moderation";
import { CHAT_POLICY, CHAT_POLICY_FOOTER, CHAT_POLICY_TITLE, CHAT_POLICY_VERSION } from "@/lib/chat/policy-content";
import { hasAcceptedChatPolicy, recordChatPolicyAcceptance } from "@/lib/chat/policy";
import { ChatQueryError, getConversationMembers, getMessagesPage, isActiveChatParticipant, listConversationsForUser, markConversationRead } from "@/lib/chat/queries";
import { countChatUnreadForUser } from "@/lib/chat/unread";
import { isMobileChatEnabled } from "@/lib/flags";

import { nhanThoiDiem } from "../dinh-dang";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.5 — CHAT PHỤ HUYNH trên app: lớp MỎNG bọc đúng domain chat của web (`lib/chat/*`) — KHÔNG có bảng/luật chat thứ hai.
 *
 *   · Hội thoại & thành viên đến từ `Conversation`/`ConversationParticipant` (do web đồng bộ theo lớp/giáo viên/tư vấn — `syncConversationMembership`): chuyển lớp / đổi giáo viên ⇒ web gỡ thành viên (`leftAt`) ⇒ app MẤT quyền đọc/gửi NGAY (404), không có cache quyền riêng của app.
 *   · userId LUÔN lấy từ PHIÊN. Hội thoại không phải của mình / đã rời / không tồn tại ⇒ cùng 404 (không dò được id người khác).
 *   · Cổng QUY ĐỊNH CHAT (như web): phụ huynh chưa đồng ý bản hiện hành ⇒ 403 `CHAT_POLICY_REQUIRED` ở mọi lượt đọc/ghi (trừ chính nhóm policy).
 *   · Gửi: dùng `sendChatMessageAsActor` (quyền `chat:send`, khoá nhóm lớp đã kết thúc/khoá, giới hạn 20 tin/phút, khử trùng `clientMsgId`, broadcast realtime cho web). Tin CHỈ CÓ ẢNH chưa hỗ trợ ở app (cần R2 private thật — B-CHAT-ATTACH): đường gửi tệp đính kèm bị chặn.
 *   · Thu hồi tin của chính mình ≤ 15 phút (luật web). Báo cáo/chặn: web KHÔNG có khái niệm này (chỉ khoá hội thoại + gỡ tin bởi quản trị) ⇒ KHÔNG dựng nghiệp vụ mới (B-CHAT-REPORT, chờ BA).
 *   · Chế độ học sinh KHÔNG truy cập chat (không có trong allow-list H-S3; kiểm lại ở đây).
 */
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export function batNeuTatChat(): void {
  if (!isMobileChatEnabled()) throw khongThay(); // cờ tắt ⇒ như thể không tồn tại
}

export async function canhCong(nguoi: NguoiGoi): Promise<void> {
  batNeuTatChat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  if (!(await hasAcceptedChatPolicy(nguoi.userId).catch(() => false))) {
    // fail-closed: lỗi đọc DB cũng coi là CHƯA đồng ý
    throw new LoiApiMobile("CHAT_POLICY_REQUIRED", 403, "Vui lòng đồng ý quy định sử dụng tin nhắn trước khi vào chat.");
  }
}

/** Dịch lỗi domain chat sang lỗi chuẩn của API di động. */
function dich(e: unknown): never {
  if (e instanceof LoiApiMobile) throw e;
  if (e instanceof ChatQueryError) throw khongThay();
  throw e;
}
function dichKetQua(code: string, message: string, field?: string): never {
  switch (code) {
    case "NOT_PARTICIPANT":
    case "NOT_FOUND":
      throw khongThay();
    case "MESSAGE_NOT_FOUND":
      throw khongThay();
    case "CONVERSATION_ARCHIVED":
    case "CONVERSATION_LOCKED":
    case "RECALL_WINDOW_EXPIRED":
    case "MESSAGE_ALREADY_DELETED":
      throw new LoiApiMobile("CHAT_KHONG_GUI_DUOC", 409, message);
    case "RATE_LIMITED":
      throw new LoiApiMobile("RATE_LIMITED", 429, message, 30);
    case "PERMISSION_DENIED":
    case "FORBIDDEN":
      throw new LoiApiMobile("FORBIDDEN", 403, "Bạn không có quyền thực hiện thao tác này.");
    case "VALIDATION":
    case "ATTACHMENT_PATH_MISMATCH":
    case "ATTACHMENT_UNSUPPORTED_TYPE":
    case "REPLY_NOT_IN_CONVERSATION":
      void field;
      throw new LoiApiMobile("VALIDATION", 400, message);
    // SEC-06: lõi gửi tin nay kiểm CHÍNH đối tượng đã tải lên; đường app đã kiểm trước ở `kiemTepTruocKhiGui` (cùng thông điệp) nên đây chỉ là hàng rào thứ hai (đua / đối tượng đổi giữa hai lần đọc).
    case "ATTACHMENT_NOT_UPLOADED":
    case "ATTACHMENT_SIZE_MISMATCH":
    case "ATTACHMENT_TYPE_MISMATCH":
    case "ATTACHMENT_CONTENT_INVALID":
      throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, message);
    case "ATTACHMENT_STORAGE_UNAVAILABLE":
      throw new LoiApiMobile("MEDIA_CHUA_SAN_SANG", 503, "Kho ảnh chat chưa sẵn sàng — thử lại sau.", 30);
    default:
      throw new LoiApiMobile("SERVER", 500, "Có lỗi xảy ra. Vui lòng thử lại.");
  }
}

// ───────────────────────── Quy định chat ─────────────────────────
export type QuyDinhChatDto = { phienBan: string; tieuDe: string; noiDung: Array<{ tieuDe: string; noiDung: string }>; chanChan: string; daDongY: boolean };
export async function layQuyDinhChat(nguoi: NguoiGoi): Promise<QuyDinhChatDto> {
  batNeuTatChat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  return { phienBan: CHAT_POLICY_VERSION, tieuDe: CHAT_POLICY_TITLE, noiDung: CHAT_POLICY.map((p) => ({ tieuDe: p.heading, noiDung: p.body })), chanChan: CHAT_POLICY_FOOTER, daDongY: await hasAcceptedChatPolicy(nguoi.userId).catch(() => false) };
}
export async function dongYQuyDinhChat(nguoi: NguoiGoi): Promise<{ daDongY: true; phienBan: string }> {
  batNeuTatChat();
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh.");
  await recordChatPolicyAcceptance(nguoi.userId); // idempotent, giữ mốc đầu tiên
  return { daDongY: true, phienBan: CHAT_POLICY_VERSION };
}

// ───────────────────────── Danh sách hội thoại ─────────────────────────
const LOAI: Record<string, "NHOM_LOP" | "RIENG_GIAO_VIEN" | "RIENG_TU_VAN" | "KHAC"> = { CLASS_GROUP: "NHOM_LOP", DM_TEACHER_PARENT: "RIENG_GIAO_VIEN", DM_SALE_PARENT: "RIENG_TU_VAN" };
export type HoiThoaiDto = {
  id: string;
  loai: "NHOM_LOP" | "RIENG_GIAO_VIEN" | "RIENG_TU_VAN" | "KHAC";
  trangThai: "DANG_MO" | "LUU_TRU" | "KHOA";
  nhanTrangThai: string | null;
  ten: string;
  chuaDoc: number;
  tatTieng: boolean;
  tinCuoi: { noiDung: string; nhanLuc: string; laCuaToi: boolean; daGo: boolean } | null;
  hoatDongLuc: string | null;
};

export async function layDanhSachHoiThoai(nguoi: NguoiGoi, now: Date = new Date()): Promise<{ muc: HoiThoaiDto[]; tongChuaDoc: number }> {
  await canhCong(nguoi);
  const ds = await listConversationsForUser(nguoi.userId, { limit: 100, now, withPreview: true });
  const muc = ds.map((c) => ({
    id: c.conversationId,
    loai: LOAI[c.type] ?? "KHAC",
    trangThai: c.status === "ARCHIVED" ? ("LUU_TRU" as const) : c.status === "LOCKED" ? ("KHOA" as const) : ("DANG_MO" as const),
    nhanTrangThai: c.statusLabel,
    ten: c.displayName,
    chuaDoc: c.unreadCount,
    tatTieng: c.muted,
    tinCuoi: c.lastMessage ? { noiDung: c.lastMessage.text, nhanLuc: nhanThoiDiem(c.lastMessage.createdAt.toISOString(), now), laCuaToi: c.lastMessage.senderId === nguoi.userId, daGo: c.lastMessage.deleted } : null,
    hoatDongLuc: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
  }));
  return { muc, tongChuaDoc: muc.reduce((n, m) => n + m.chuaDoc, 0) };
}

export async function demChuaDoc(nguoi: NguoiGoi): Promise<{ chuaDoc: number }> {
  await canhCong(nguoi);
  return { chuaDoc: await countChatUnreadForUser(nguoi.userId) };
}

// ───────────────────────── Tin nhắn ─────────────────────────
export const locTinSchema = z.object({ truoc: z.string().max(200).optional(), soLuong: z.coerce.number().int().min(1).max(50).default(30) }).strict();
export type LocTin = z.infer<typeof locTinSchema>;
/** Đính kèm của một tin (chỉ ẢNH jpg/png/webp). `id` đổi lấy URL ký ngắn hạn qua `GET /chat/attachments/:id/url` — KHÔNG có đường dẫn kho/URL công khai ở đây. Tin đã gỡ ⇒ không có đính kèm. */
export type TepDinhKemDto = { id: string; tenTep: string; loaiMime: string; kichThuoc: number };
export type TinNhanDto = { id: string; loai: "CHAT" | "THONG_BAO" | "HE_THONG"; nguoiGui: { id: string; ten: string; vaiTro: string } | null; laCuaToi: boolean; noiDung: string; daGo: boolean; traLoiId: string | null; khoaGuiLai: string | null; luc: string; tepDinhKem: TepDinhKemDto[] };
export type TrangTinDto = { tin: TinNhanDto[]; coTrangTruoc: boolean; conTro: string | null };

export async function layTinNhan(nguoi: NguoiGoi, hoiThoaiId: string, loc: LocTin): Promise<TrangTinDto> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId)) throw khongThay();
  try {
    const [trang, thanhVien] = await Promise.all([getMessagesPage(hoiThoaiId, nguoi.userId, { cursor: loc.truoc ?? null, limit: loc.soLuong }), getConversationMembers(hoiThoaiId, nguoi.userId)]);
    const ten = new Map(thanhVien.map((m) => [m.userId, m]));
    // Đính kèm tra MỘT lượt theo lô tin (web: chỉ participant còn hiệu lực, tin đã gỡ bị loại, không hỏi chéo hội thoại).
    const dinhKem = await listChatAttachments(hoiThoaiId, nguoi.userId, trang.messages.slice(0, CHAT_ATTACHMENT_LOOKUP_MAX).map((m) => m.id));
    const tepTheoTin = new Map<string, TepDinhKemDto[]>();
    for (const a of dinhKem) tepTheoTin.set(a.messageId, [...(tepTheoTin.get(a.messageId) ?? []), { id: a.id, tenTep: a.fileName, loaiMime: a.mimeType, kichThuoc: a.sizeBytes }]);
    return {
      tin: trang.messages.map((m) => {
        const tv = m.senderId ? ten.get(m.senderId) : undefined;
        return {
          id: m.id,
          loai: m.kind === "ANNOUNCEMENT" ? ("THONG_BAO" as const) : m.kind === "SYSTEM" ? ("HE_THONG" as const) : ("CHAT" as const),
          // Người gửi chỉ lộ TÊN HIỂN THỊ + nhãn vai do web đã che theo người xem (PH khác chỉ thấy «PH của …» nếu web quy định); không SĐT/email.
          nguoiGui: m.senderId ? { id: m.senderId, ten: tv?.displayName ?? "Thành viên cũ", vaiTro: tv?.roleLabel ?? "Thành viên" } : null,
          laCuaToi: m.senderId === nguoi.userId,
          noiDung: m.body,
          daGo: m.deleted,
          traLoiId: m.replyToId,
          khoaGuiLai: m.senderId === nguoi.userId ? m.clientMsgId : null,
          luc: m.createdAt.toISOString(),
          tepDinhKem: m.deleted ? [] : (tepTheoTin.get(m.id) ?? []),
        };
      }),
      coTrangTruoc: trang.hasMore,
      conTro: trang.nextCursor,
    };
  } catch (e) {
    return dich(e);
  }
}

/** Đính kèm khi GỬI: `duongDanKho` là khoá do vé của máy chủ cấp (`POST …/attachments/tickets`) — vẫn bị kiểm lại (đúng hội thoại, đúng cỡ/loại, đối tượng CÓ THẬT trong kho riêng, chưa dùng cho tin khác). */
export const tepDinhKemSchema = z.strictObject({ duongDanKho: z.string().min(1).max(512), tenTep: z.string().min(1).max(255), loaiMime: z.string().min(1).max(100), kichThuoc: z.number().int().positive().max(10 * 1024 * 1024) });
export const guiTinSchema = z
  .object({ noiDung: z.string().trim().max(CHAT_BODY_MAX, `Tin nhắn tối đa ${CHAT_BODY_MAX} ký tự.`), khoaGuiLai: z.uuid("khoaGuiLai phải là UUID."), traLoiId: z.uuid().optional(), tepDinhKem: z.array(tepDinhKemSchema).max(5, "Mỗi tin tối đa 5 ảnh.").optional() })
  .strict()
  .refine((v) => v.noiDung.length > 0 || (v.tepDinhKem?.length ?? 0) > 0, { message: "Nội dung tin nhắn không được để trống.", path: ["noiDung"] });
export type GuiTinBody = z.infer<typeof guiTinSchema>;

/**
 * XÁC MINH ĐÍNH KÈM TRƯỚC KHI NHẬN VÀO TIN (V8.18): khoá kho phải thuộc đúng hội thoại này (web `checkAttachmentPaths` còn kiểm lại), chưa gắn cho tin nào khác,
 * và đối tượng CÓ THẬT trong kho RIÊNG với đúng cỡ + loại đã khai (không tin lời khai của app). Kho chưa cấu hình ⇒ 503. Sai ⇒ 422 `TEP_KHONG_HOP_LE`.
 */
async function kiemTepTruocKhiGui(hoiThoaiId: string, tep: ReadonlyArray<z.infer<typeof tepDinhKemSchema>>): Promise<void> {
  const khoa = tep.map((t) => t.duongDanKho);
  if (new Set(khoa).size !== khoa.length) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Có ảnh bị lặp trong cùng một tin.");
  const tien = `chat-attachments/${hoiThoaiId}/`;
  if (khoa.some((k) => !k.startsWith(tien) || k.includes(".."))) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Ảnh không thuộc hội thoại này.");
  if ((await db.messageAttachment.count({ where: { storagePath: { in: khoa } } })) > 0) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Ảnh này đã được dùng cho một tin khác.");
  for (const t of tep) {
    let dau: Awaited<ReturnType<typeof headChatObject>>;
    try {
      dau = await headChatObject(t.duongDanKho);
    } catch {
      throw new LoiApiMobile("MEDIA_CHUA_SAN_SANG", 503, "Kho ảnh chat chưa sẵn sàng — thử lại sau.", 30);
    }
    if (!dau) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Ảnh chưa được tải lên xong.");
    if (dau.size !== t.kichThuoc) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Kích thước ảnh không khớp lúc tải lên.");
    if ((dau.contentType ?? "").split(";")[0]!.trim().toLowerCase() !== t.loaiMime.trim().toLowerCase()) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Loại ảnh không khớp lúc tải lên.");
    // V8.19 — NỘI DUNG THẬT: đọc byte đầu của chính đối tượng đã tải lên (không tin `Content-Type` khai lúc PUT, cũng không tin 16 byte app gửi lúc xin vé).
    let byte: Uint8Array | null;
    try {
      byte = await docByteDauChat(t.duongDanKho, 32);
    } catch {
      throw new LoiApiMobile("MEDIA_CHUA_SAN_SANG", 503, "Kho ảnh chat chưa sẵn sàng — thử lại sau.", 30);
    }
    if (!byte || !kiemNoiDung(t.loaiMime.trim().toLowerCase(), byte)) throw new LoiApiMobile("TEP_KHONG_HOP_LE", 422, "Nội dung tệp không đúng định dạng ảnh đã khai.");
  }
}

export async function guiTin(nguoi: NguoiGoi, hoiThoaiId: string, body: GuiTinBody): Promise<TinNhanDto & { trungLap: boolean }> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId)) throw khongThay();
  // Không phải thành viên ĐANG CÓ QUYỀN ⇒ 404 TRƯỚC khi chạm cổng quyền của web (cổng đó trả PERMISSION_DENIED cho người ngoài — lộ rằng hội thoại có thật).
  if (!(await isActiveChatParticipant(hoiThoaiId, nguoi.userId))) throw khongThay();
  // Gửi lại cùng khoá ⇒ web trả tin đã có (không tạo thứ hai); ở đây chỉ báo `trungLap` cho app.
  const daCo = await db.message.findFirst({ where: { conversationId: hoiThoaiId, senderId: nguoi.userId, clientMsgId: body.khoaGuiLai }, select: { id: true } });
  const tep = body.tepDinhKem ?? [];
  // Gửi lại cùng khoá ⇒ trả tin đã có, KHÔNG kiểm lại kho/«đã dùng» (đối tượng của chính tin đó đã được dùng).
  if (tep.length > 0 && daCo === null) await kiemTepTruocKhiGui(hoiThoaiId, tep);
  const actor = await resolveActor(nguoi.userId);
  const kq = await sendChatMessageAsActor(actor, nguoi.name || nguoi.email || nguoi.userId, { conversationId: hoiThoaiId, body: body.noiDung, clientMsgId: body.khoaGuiLai, ...(body.traLoiId ? { replyToId: body.traLoiId } : {}), ...(tep.length > 0 ? { attachments: tep.map((t) => ({ storagePath: t.duongDanKho, fileName: t.tenTep, mimeType: t.loaiMime, sizeBytes: t.kichThuoc })) } : {}) });
  if (!kq.ok) return dichKetQua(kq.error.code, kq.error.message, kq.error.field);
  const m = kq.data;
  return { id: m.id, loai: "CHAT", nguoiGui: { id: nguoi.userId, ten: nguoi.name, vaiTro: "Phụ huynh" }, laCuaToi: true, noiDung: body.noiDung, daGo: false, traLoiId: body.traLoiId ?? null, khoaGuiLai: body.khoaGuiLai, luc: new Date(m.createdAt).toISOString(), tepDinhKem: (m.attachments ?? []).map((a) => ({ id: a.id, tenTep: a.fileName, loaiMime: a.mimeType, kichThuoc: a.sizeBytes })), trungLap: daCo !== null };
}

export const docSchema = z.object({ tinCuoiId: z.uuid().nullable() }).strict();
export type DocBody = z.infer<typeof docSchema>;
export async function danhDauDaDoc(nguoi: NguoiGoi, hoiThoaiId: string, body: DocBody): Promise<{ chuaDoc: 0 }> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId)) throw khongThay();
  try {
    await markConversationRead(hoiThoaiId, nguoi.userId, body.tinCuoiId);
    return { chuaDoc: 0 };
  } catch (e) {
    return dich(e);
  }
}

export async function thuHoiTin(nguoi: NguoiGoi, hoiThoaiId: string, tinId: string): Promise<{ daGo: true }> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId) || !/^[0-9a-f-]{36}$/i.test(tinId)) throw khongThay();
  // KIỂM TRƯỚC KHI GHI: người gọi là thành viên đang có quyền của hội thoại trong đường dẫn VÀ tin thuộc đúng hội thoại đó
  // (bản đầu kiểm SAU khi thu hồi ⇒ tin vẫn bị gỡ dù đáp 404 — bắt được bởi [CHAT-DB-07]).
  if (!(await isActiveChatParticipant(hoiThoaiId, nguoi.userId))) throw khongThay();
  const thuoc = await db.message.findFirst({ where: { id: tinId, conversationId: hoiThoaiId }, select: { id: true } });
  if (!thuoc) throw khongThay();
  const actor = await resolveActor(nguoi.userId);
  const kq = await recallOwnMessageAsActor(actor, nguoi.name || nguoi.email || nguoi.userId, { messageId: tinId });
  if (!kq.ok) {
    return dichKetQua(kq.error.code, kq.error.message, kq.error.field);
  }
  return { daGo: true };
}

export type ThanhVienDto = { id: string; ten: string; vaiTro: string; laToi: boolean; /** true = giáo viên của lớp — có thể «Nhắn cô thầy» (mở hội thoại riêng). */ giaoVien: boolean };
export async function layThanhVien(nguoi: NguoiGoi, hoiThoaiId: string): Promise<{ muc: ThanhVienDto[] }> {
  await canhCong(nguoi);
  if (!/^[0-9a-f-]{36}$/i.test(hoiThoaiId)) throw khongThay();
  try {
    const ds = await getConversationMembers(hoiThoaiId, nguoi.userId);
    // Chỉ id + tên hiển thị + nhãn vai — KHÔNG `contact` (web đã bỏ khoá này khi người xem là phụ huynh; ở đây ép bỏ thêm một lần nữa).
    return { muc: ds.map((m) => ({ id: m.userId, ten: m.displayName, vaiTro: m.roleLabel, laToi: m.userId === nguoi.userId, giaoVien: m.derivedFrom === "CLASS_TEACHER" })) };
  } catch (e) {
    return dich(e);
  }
}

// ───────────────────────── «Nhắn cô thầy» — mở/mở lại hội thoại riêng ─────────────────────────
export const moRiengSchema = z.object({ giaoVienId: z.string().trim().min(1, "Thiếu giáo viên.").max(64, "Giáo viên không hợp lệ.") }).strict();
export type MoRiengBody = z.infer<typeof moRiengSchema>;
export type HoiThoaiRiengDto = { /** V8.19: bí danh của `hoiThoaiId` — app (adapter `moChatRieng`) đọc `{ id }`; giữ CẢ HAI để không phá hợp đồng cũ. */ id: string; hoiThoaiId: string; trangThai: "DANG_MO" | "LUU_TRU" | "KHOA"; taoMoi: boolean; moLai: boolean; ten: string | null };

/**
 * `POST /chat/dm { giaoVienId }` — phụ huynh nhắn riêng với giáo viên ĐANG DẠY con mình. Dùng `openDmAsActor` của web: quan hệ dạy học (giáo viên của lớp con đang học) + quyền + giới hạn tần suất do web kiểm;
 * một cặp (giáo viên, phụ huynh) chỉ có MỘT hội thoại (khoá `dmKey`) — mở lại hội thoại đã lưu trữ khi còn quan hệ. Không có quan hệ dạy học ⇒ 404 (không dò được người lạ).
 * `giaoVienId` lấy từ `members` của nhóm lớp (cờ `giaoVien`), KHÔNG từ danh bạ.
 */
export async function moHoiThoaiRieng(nguoi: NguoiGoi, body: MoRiengBody): Promise<HoiThoaiRiengDto> {
  await canhCong(nguoi);
  const actor = await resolveActor(nguoi.userId);
  const kq = await openDmAsActor(actor, nguoi.name || nguoi.email || nguoi.userId, { peerUserId: body.giaoVienId, kind: "TEACHER_PARENT" });
  if (!kq.ok) {
    // Không phân biệt «không có người đó» với «không có quan hệ dạy học» (không dò được tài khoản).
    if (kq.error.code === "PERMISSION_DENIED" || kq.error.code === "NOT_FOUND" || kq.error.code === "PEER_NOT_FOUND" || kq.error.code === "NO_RELATION") throw khongThay();
    return dichKetQua(kq.error.code, kq.error.message, kq.error.field);
  }
  const d = kq.data;
  return { id: d.conversationId, hoiThoaiId: d.conversationId, trangThai: d.status === "ARCHIVED" ? "LUU_TRU" : d.status === "LOCKED" ? "KHOA" : "DANG_MO", taoMoi: d.created, moLai: d.reopened, ten: d.peerName };
}

// ───────────────────────── Danh sách giáo viên để «Nhắn cô thầy» (gộp MỌI nhóm lớp đang mở) ─────────────────────────
export type GiaoVienNhanDto = { giaoVienId: string; ten: string; lop: string[] };

/**
 * `GET /chat/teachers` — giáo viên của MỌI nhóm lớp ĐANG MỞ mà phụ huynh còn là thành viên (nhiều con / nhiều lớp ⇒ gộp, một giáo viên một dòng kèm tên các lớp). `giaoVienId` dùng cho `POST /chat/dm`; quan hệ dạy học vẫn do web kiểm khi mở.
 * Chỉ tên + id; KHÔNG SĐT/email. Thành viên đã rời (`leftAt`) / nhóm lưu trữ-khoá không tính ⇒ chuyển lớp thì giáo viên cũ biến khỏi danh sách.
 */
export async function giaoVienNhanDuoc(nguoi: NguoiGoi): Promise<{ muc: GiaoVienNhanDto[] }> {
  await canhCong(nguoi);
  const mine = await db.conversationParticipant.findMany({
    where: { userId: nguoi.userId, leftAt: null, conversation: { type: "CLASS_GROUP", status: "ACTIVE" } },
    select: { conversationId: true, conversation: { select: { title: true } } },
    take: 200,
  });
  if (mine.length === 0) return { muc: [] };
  const tenLop = new Map(mine.map((m) => [m.conversationId, m.conversation.title ?? ""]));
  const gv = await db.conversationParticipant.findMany({
    where: { conversationId: { in: [...tenLop.keys()] }, derivedFrom: "CLASS_TEACHER", leftAt: null, userId: { not: nguoi.userId } },
    select: { userId: true, conversationId: true },
  });
  const ten = new Map((await db.user.findMany({ where: { id: { in: [...new Set(gv.map((g) => g.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name ?? ""]));
  const gop = new Map<string, GiaoVienNhanDto>();
  for (const g of gv) {
    const d = gop.get(g.userId) ?? { giaoVienId: g.userId, ten: ten.get(g.userId) ?? "", lop: [] };
    const lop = tenLop.get(g.conversationId) ?? "";
    if (lop && !d.lop.includes(lop)) d.lop.push(lop);
    gop.set(g.userId, d);
  }
  return { muc: [...gop.values()].sort((a, b) => a.ten.localeCompare(b.ten, "vi")) };
}

