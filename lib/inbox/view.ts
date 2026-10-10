// lib/inbox/view.ts — CHIẾU dữ liệu hộp thư ra ngoài server. THUẦN, không DB.
//
// 🔴 Đây là lớp chống rò liên hệ. Nó phải chạy Ở SERVER, TRƯỚC khi serialize —
// che ở JSX thì giá trị thật vẫn nằm trong payload RSC.
//
// Hai bề mặt rò, phải bịt cả hai:
//   1. Cột — SĐT/tên của `Lead` được nối. Đi qua `maskPersonName`/`maskPhone`.
//   2. NỘI DUNG TIN — khách gõ số ngay trong câu ("sdt em 0905123456"). Đi qua
//      `redactContactsInText`. Bịt (1) mà quên (2) là bịt cửa trước mở cửa sau.
//
// Cổng quyết định là `leads:view-pii` (qua `canViewLeadPii()` ở chỗ gọi) — CÙNG
// một cổng đang che SĐT lead ở khắp site Sale, không đẻ cổng thứ hai.
//
// ⚠️ `redactContactsInText` là rào chống TIỆN TAY, không phải bảo đảm: ai đọc được
// toàn bộ hội thoại thì gần như luôn moi được cách liên lạc (khách gõ số tách cụm,
// gửi ảnh, hẹn gặp). Đừng bán nó như một bảo đảm.
import type {
  InboxChannel,
  InboxConversationStatus,
  InboxDeliveryStatus,
  InboxDirection,
  InboxIdentityLinkSource,
} from "@prisma/client";
import { maskPersonName, maskPhone, redactContactsInText } from "@/lib/lead/pii";

export const TEN_KHACH_CHUA_RO = "Khách chưa rõ tên";

export type TinNhanView = {
  id: string;
  direction: InboxDirection;
  body: string | null;
  /** ISO — `Date` không qua được ranh giới server→client. */
  sentAt: string;
  sentByUserId: string | null;
  sentOutsideSystem: boolean;
  deliveryStatus: InboxDeliveryStatus | null;
  errorCode: string | null;
};

type TinNhanNguon = {
  id: string;
  direction: InboxDirection;
  body: string | null;
  sentAt: Date;
  sentByUserId: string | null;
  sentOutsideSystem: boolean;
  deliveryStatus: InboxDeliveryStatus | null;
  errorCode: string | null;
};

export function chieuTinNhan(tin: TinNhanNguon, xemDuocLienHe: boolean): TinNhanView {
  return {
    id: tin.id,
    direction: tin.direction,
    body: xemDuocLienHe ? tin.body : redactContactsInText(tin.body),
    sentAt: tin.sentAt.toISOString(),
    sentByUserId: tin.sentByUserId,
    sentOutsideSystem: tin.sentOutsideSystem,
    deliveryStatus: tin.deliveryStatus,
    errorCode: tin.errorCode,
  };
}

export type HoiThoaiView = {
  id: string;
  channel: InboxChannel;
  status: InboxConversationStatus;
  assigneeId: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  orgUnitId: string | null;
  /** Tên để người trực nhận ra ai — đã mờ hoá nếu không có quyền xem liên hệ. */
  tenHienThi: string;
  leadId: string | null;
  sdtKhach: string | null;
  /** Chưa nối được `Lead` nào. Trạng thái BÌNH THƯỜNG, không phải lỗi. */
  moCoi: boolean;
  /** Chưa ai trả lời kể từ tin đến gần nhất — đầu vào bộ lọc "chưa trả lời". */
  chuaTraLoi: boolean;
};

type HoiThoaiNguon = {
  id: string;
  channel: InboxChannel;
  status: InboxConversationStatus;
  assigneeId: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  awaitingReply: boolean;
  orgUnitId: string | null;
  identity: {
    id: string;
    displayName: string | null;
    leadId: string | null;
    linkSource: InboxIdentityLinkSource | null;
  };
  lead: { id: string; parentName: string | null; phone: string | null } | null;
};

export function chieuHoiThoai(
  hoi: HoiThoaiNguon,
  xemDuocLienHe: boolean,
): HoiThoaiView {
  // Tên ưu tiên hồ sơ khách (đã xác minh) rồi mới tới tên nhà cung cấp trả về.
  const tenGoc = hoi.lead?.parentName ?? hoi.identity.displayName ?? null;
  const tenHienThi = tenGoc
    ? xemDuocLienHe
      ? tenGoc
      : maskPersonName(tenGoc)
    : TEN_KHACH_CHUA_RO;

  // Không có quyền ⇒ SĐT KHÔNG được có mặt dưới bất kỳ dạng nào; `maskPhone` giữ
  // đủ để đối chiếu bằng mắt mà không đọc ra số.
  const sdt = hoi.lead?.phone ?? null;

  return {
    id: hoi.id,
    channel: hoi.channel,
    status: hoi.status,
    assigneeId: hoi.assigneeId,
    unreadCount: hoi.unreadCount,
    lastMessageAt: hoi.lastMessageAt?.toISOString() ?? null,
    lastInboundAt: hoi.lastInboundAt?.toISOString() ?? null,
    lastOutboundAt: hoi.lastOutboundAt?.toISOString() ?? null,
    orgUnitId: hoi.orgUnitId,
    tenHienThi,
    leadId: hoi.identity.leadId,
    sdtKhach: sdt ? (xemDuocLienHe ? sdt : maskPhone(sdt)) : null,
    moCoi: hoi.identity.leadId === null,
    chuaTraLoi: hoi.awaitingReply,
  };
}

/**
 * "Chưa trả lời" = có tin khách đến, và chưa có tin nào ĐI ĐƯỢC sau đó.
 *
 * ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT của khái niệm đó. Cột
 * `InboxConversation.awaitingReply` chỉ là kết quả đã lưu của hàm này, ghi lại ở
 * mọi đường ghi trong `lib/inbox/` — cột tồn tại vì Prisma không so được hai cột
 * trong `where`, không phải vì có hai định nghĩa.
 *
 * ⚠️ `lastOutboundAt` CHỈ được set khi tin thật sự tới khách (`deliveryStatus =
 * SENT`). Nhờ vậy một lượt gửi mô phỏng KHÔNG tắt được cờ này — đúng chỗ mà module
 * Messenger cũ đã sai (`lib/crm/messenger-send-gate.ts`).
 */
export function tinhChoTraLoi(hoi: {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}): boolean {
  if (!hoi.lastInboundAt) return false;
  if (!hoi.lastOutboundAt) return true;
  return hoi.lastOutboundAt < hoi.lastInboundAt;
}
