// lib/integrations/zalocrm/types.ts — HÌNH DẠNG dữ liệu của trục ZaloCRM. THUẦN.
//
// Không `server-only`, không `db`, không `process.env`: mọi thứ chạm mạng hoặc chạm
// DB đều đứng SAU một hàm thuần đã test (kỷ luật chung của đặc tả §5). File này là
// tầng đáy của kỷ luật đó — nó chỉ khai kiểu.
//
// ⚠️ HÌNH DẠNG PAYLOAD CÒN LÀ PHỎNG ĐOÁN. Bản fork (việc F2, repo khác, CHƯA TỒN
// TẠI) sẽ thêm `zaloAccountId`, `threadId`, `threadType`, `contactId`,
// `contact.phone`, `sentByExternalId` vào `data`; bản GỐC của ZaloCRM chưa có mấy
// trường đó (`docs/tich-hop-zalocrm/01-ban-1-ve-tinh-khong-sua-ma.md` §4.2, đọc từ
// `message-handler.ts:612-619`). Khi có payload thật thì sửa BẢNG ÁNH XẠ trong
// `dich-payload.ts` + fixture trong `__fixtures__/` — KHÔNG chỗ nào khác.
import type { TinDenNgoai } from "@/lib/inbox/ingest";

/**
 * Kênh của hộp thư mà trục này đổ vào.
 *
 * Hằng chứ không gõ chuỗi tại chỗ: `ZALO_CA_NHAN` và `ZALO_OA` chỉ khác nhau ba ký
 * tự, mà nhầm một chỗ là tin nick cá nhân trộn vào hộp thư OA chính thức (khác hạn
 * mức, khác người chịu trách nhiệm khi nick bị khoá).
 */
export const KENH_ZALOCRM = "ZALO_CA_NHAN" as const;

/**
 * Tiền tố khoá của trục này trên `IntegrationConfig.provider` và
 * `IntegrationLog.provider` (cả hai đều là chuỗi tự do, `provider` của
 * `IntegrationConfig` còn là `@unique` TOÀN CỤC).
 *
 * Khoá thật luôn có hậu tố org: `ZALOCRM:cs1`. Bảng không có cột cơ sở nào, nên đây
 * là chỗ DUY NHẤT tách được ba org trong báo cáo và trong màn Tích hợp.
 */
export const PROVIDER_ZALOCRM = "ZALOCRM";

/**
 * Khuôn `orgCode` — GIỐNG HỆT ba nơi khác: ô cấu hình `zalocrm.orgCodes`
 * (`lib/settings/registry.ts`), vé SSO (`sso.ts`), và đoạn `[org]` của đường webhook.
 * Bốn nơi nói cùng một câu thì khai sai ở đâu cũng lộ ngay tại chỗ khai.
 */
export const KHUON_ORG_CODE = /^[a-z0-9-]{1,32}$/;

/** Sự kiện webhook có hành động thật (mọi tên khác ⇒ bỏ qua, xem `dich-payload.ts`). */
export type LoaiSuKienZalocrm =
  | "message.received"
  | "message.sent"
  | "contact.updated"
  | "zalo.connected"
  | "zalo.disconnected";

/** Chiều của tin, theo góc nhìn của Sata: khách gửi ĐẾN, hay nick mình gửi ĐI. */
export type HuongTin = "DEN" | "DI";

/** Ánh xạ sang `ZaloCrmNickStatus` của Prisma (giữ rời để file này không kéo Prisma vào). */
export type TrangThaiNick = "CONNECTED" | "DISCONNECTED";

/**
 * VIỆC phải làm sau khi dịch. Đây là ranh giới giữa "hiểu payload" (thuần, test
 * không cần DB) và "làm gì với nó" (`nap-su-kien.ts`, chạm DB).
 */
export type ViecTuWebhook = ViecTinNhan | ViecCapNhatLienHe | ViecTrangThaiNick | ViecBoQua;

export type ViecTinNhan = {
  loai: "TIN";
  huong: HuongTin;
  /** Đã dựng sẵn, đổ thẳng vào `ingestInboundMessage`/`ingestOutboundEcho`. */
  tin: TinDenNgoai;
  orgCode: string;
  /** `ZaloAccount.id` bên ZaloCRM = `ZaloCrmNick.zcrmAccountId` = `tin.accountId`. */
  zcrmAccountId: string;
  /** `Conversation.id` bên ZaloCRM = `ZaloCrmThread.zcrmConversationId` = `tin.externalThreadId`. */
  zcrmConversationId: string;
  /** `Contact.id` bên ZaloCRM. `null` khi bản gốc chưa gửi kèm. */
  zcrmContactId: string | null;
  /**
   * SĐT khách đã chuẩn hoá `84XXXXXXXXX`, hoặc `null`.
   *
   * ⚠️ KHÔNG bao giờ đi vào ba bảng `Inbox*` (chúng CẤM cột liên hệ, có test canh).
   * Nó chỉ dùng để TRA `Lead` và để ghi vào `ZaloCrmThread.phone`.
   */
  phone: string | null;
  /**
   * Định danh NHÂN VIÊN gửi, phía ZaloCRM. Fork lưu `external_id = User.id` của Sata
   * (xem `sso.ts`), nên đây chính là `User.id` — nhưng vẫn phải kiểm tồn tại trước
   * khi tin nó, vì chuỗi này do máy chủ bên kia gửi sang.
   *
   * Chỉ có ở tin ĐI. `null` = không quy được về ai (nick lạ, hoặc tài khoản ZaloCRM
   * chưa nối tài khoản Sata).
   */
  sentByExternalId: string | null;
  /** Nội dung chữ THẬT (chưa che) — để ghi mốc dòng thời gian lead. */
  noiDung: string;
  sentAt: Date;
};

export type ViecCapNhatLienHe = {
  loai: "LIEN_HE";
  orgCode: string;
  zcrmContactId: string;
  /** SĐT vừa biết, canonical `84…`. Không có SĐT thì sự kiện đã thành `BO_QUA`. */
  phone: string;
};

export type ViecTrangThaiNick = {
  loai: "NICK";
  orgCode: string;
  zcrmAccountId: string;
  trangThai: TrangThaiNick;
  luc: Date;
};

export type ViecBoQua = {
  loai: "BO_QUA";
  /** Mã ngắn (EN/không dấu) để ghi vào nhật ký — KHÔNG phải câu cho người dùng. */
  lyDo: string;
};

/**
 * Mã lỗi DỊCH. Tất cả đều là lỗi NGHIỆP VỤ ⇒ webhook trả **200 + FAILED**: bên gửi
 * retry cũng ra đúng kết quả đó, nên bắt họ retry chỉ tốn băng thông của cả hai.
 */
export type MaLoiDich =
  | "PAYLOAD_KHONG_HOP_LE"
  | "THIEU_ORG"
  | "THIEU_SU_KIEN"
  | "THIEU_MESSAGE_ID"
  | "THIEU_ZALO_ACCOUNT_ID"
  | "THIEU_CONVERSATION_ID"
  | "THIEU_NGUOI_GUI"
  | "THIEU_NGUOI_NHAN"
  | "THIEU_THOI_DIEM"
  | "THIEU_ACCOUNT_ID"
  | "THIEU_CONTACT_ID";

export type KetQuaDich =
  | { ok: true; viec: ViecTuWebhook }
  | { ok: false; ma: MaLoiDich; thongDiep: string };

/** Kết quả chuẩn của một lượt webhook — vỏ HTTP chỉ việc trải ra. */
export type ZalocrmWebhookResult = {
  httpStatus: number;
  body: {
    ok: boolean;
    error?: string;
    ma?: string;
    conversationId?: string;
    duplicate?: boolean;
  };
};
