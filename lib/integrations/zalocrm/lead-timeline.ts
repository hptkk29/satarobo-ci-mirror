// lib/integrations/zalocrm/lead-timeline.ts — S5: mốc "Sale nhắn khách qua nick
// Zalo cá nhân" trên DÒNG THỜI GIAN của phiếu lead.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao một việc nghe như "ghi thêm một dòng nhật ký" lại có file riêng, có
// hàm luật thuần, và có chừng này chú thích: vì `recordLeadActivity` không chỉ
// ghi dòng. Nó còn chạm hai cột đồng hồ, và cả hai đều KHÔNG CÓ ĐƯỜNG LÙI theo
// chiều làm hỏng đo lường:
//
//   · `Lead.lastActivityAt` — tắt SLA-4 và cột "số ngày chưa tiếp cận lại" (C-05);
//   · `Lead.firstContactAt` — tắt SLA-3 ("Chưa liên hệ khách > 3 giờ") **vĩnh
//     viễn**, vì mốc chỉ ghi một lần (`updateMany where firstContactAt: null`).
//
// Thêm một hệ quả nữa nằm ngoài SLA: `hasSaleInteraction` (`lib/lead/auto-assign.ts`)
// đếm mọi dòng `MESSAGE` để quyết "phiếu này đã có sale chạm, thôi đừng tự chia
// lại". Ghi `MESSAGE` cho một phiếu CHƯA GIAO là khoá luôn cơ chế tự chia — phiếu
// nằm im, không ai được giao, và không có gì đỏ lên báo.
//
// Nên luật S-9 (chốt 27/08/2026) chia bốn ca, và file này là nơi DUY NHẤT trong
// đường ZaloCRM hiện thực chúng:
//
//   | tin ĐÃ GỬI ĐI được               | ghi gì   | làm mới đồng hồ |
//   |----------------------------------|----------|-----------------|
//   | có chủ, người gửi LÀ chủ phiếu   | MESSAGE  | CÓ              |
//   | có chủ, người gửi là người khác  | MESSAGE  | KHÔNG           |
//   | CHƯA giao cho ai                 | NOTE máy | KHÔNG           |
//   | TIN KHÁCH GỬI ĐẾN                | không ghi gì               |
//
// ⚠️ Ca cuối là ca dễ làm sai nhất vì làm sai nó trông như "ghi đầy đủ hơn":
// ghi mốc cho tin ĐẾN sẽ bump `lastActivityAt` và che mất đúng thứ cần cảnh báo
// — "khách nhắn mà Sale im". Khối Hộp thư đã đọc thẳng `Inbox*` theo `leadId`
// (`InboxConversation.awaitingReply`) nên nó KHÔNG cần `LeadActivity` để biết có
// tin đến; đổ thêm dòng vào đây chỉ phá đồng hồ chứ không thêm thông tin nào.
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ KHÔNG viết `tx.leadActivity.create` ở đây. Cửa ghi hoạt động là DUY NHẤT
// (`lib/lead/activity-write.ts`) và có test `[N-4]` quét đệ quy `lib/` + `app/`
// giữ nó duy nhất. Cùng lý do: KHÔNG bọc `.catch()` quanh `recordLeadActivity` —
// bump hỏng mà dòng vẫn lưu thì đồng hồ đứng im, không ai biết vì sao. Đường
// webhook phải để lỗi ném ra để trả 5xx cho bên gửi retry (chốt Q5 của đặc tả).
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { SYSTEM_ACTIVITY_META } from "@/lib/lead/activity-clock";
import { recordLeadActivity } from "@/lib/lead/activity-write";
import { duocLamMoiDongHoChamSoc } from "@/lib/lead/sla-clock";

/**
 * Nhãn nền tảng ghi vào `metadata.platform`.
 *
 * Phải đúng chữ `"Zalo"`: panel dòng thời gian (`lead-activity-panel.tsx`) in
 * thẳng chuỗi này làm huy hiệu và chỉ có sẵn ba nhãn `SMS | Zalo | Messenger`.
 * Gõ `"ZaloCRM"` hay `"zalo"` không làm gì đỏ — chỉ hiện một huy hiệu lạ giữa
 * các dòng cũ.
 */
export const META_NEN_TANG_ZALO = "Zalo" as const;

/**
 * Dấu "dòng này đến từ ZaloCRM" — để về sau còn lọc/đối soát được nguồn, phân
 * biệt với dòng `MESSAGE` do Sale gõ tay trên màn lead (cùng `platform: "Zalo"`).
 */
export const META_NGUON_ZALOCRM = "zalocrm" as const;

/** Tin không có chữ (ảnh, sticker, file). `LeadActivity.content` là cột NOT NULL. */
export const NOI_DUNG_TRONG = "(tin không có nội dung chữ)";

/**
 * Người gửi KHÔNG map được về một `User` của Sata — nick lạ, hoặc tài khoản
 * ZaloCRM chưa nối tài khoản Sata.
 *
 * Vì sao là một sentinel chứ không phải `if (sentByUserId === null) return false`:
 * câu hỏi "ai được làm mới đồng hồ" chỉ được trả lời ở MỘT chỗ
 * (`duocLamMoiDongHoChamSoc`). Viết thêm một vế `null` tại đây là gieo mầm cho
 * bản luật thứ hai — đúng loại lệch mà S-9 sinh ra để dẹp. Chuỗi cố ý mang dấu
 * `:` để không bao giờ trùng dạng một `User.id` (cuid) và vì thế không bao giờ
 * bằng `assignedToId`.
 */
export const NGUOI_GUI_KHONG_MAP_DUOC = "zalocrm:nguoi-gui-khong-map-duoc";

/** Chiều của tin: Sale gửi đi, hay khách nhắn đến. */
export type HuongTinZalo = "DI" | "DEN";

export type TinNhanZaloDeGhi = {
  leadId: string;
  /** `InboxMessage.id` — giữ trong metadata để đối soát ngược dòng ↔ tin. */
  inboxMessageId: string;
  /** Nội dung chữ của tin (đã là chữ THẬT, không phải bản che PII). */
  noiDung: string;
  huong: HuongTinZalo;
  /**
   * Tin đã thực sự rời khỏi hệ thống chưa (`deliveryStatus` SENT/DELIVERED).
   * Tin còn nằm hàng đợi hoặc gửi lỗi KHÔNG phải một lượt chạm khách — ghi mốc
   * cho nó là báo "đã liên hệ" cho một câu khách chưa từng nhận được.
   */
  daGuiDuoc: boolean;
  /** `User.id` của người gửi; `null` khi không map được (xem sentinel trên). */
  sentByUserId: string | null;
  /** Tên hiển thị trên dòng thời gian (tên nhân sự, hoặc tên nick khi không map được). */
  actorName: string;
  /** `Lead.assignedToId` — `null` nghĩa là phiếu CHƯA GIAO cho ai. */
  assignedToId: string | null;
  /**
   * Kết quả `can(QUYEN_DIEU_PHOI_LEAD)` trên cơ sở của phiếu.
   *
   * ⚠️ Đường webhook KHÔNG có phiên đăng nhập ⇒ không suy được quyền từ session;
   * chỗ gọi truyền `false`. Tham số này có mặt để đường CÓ phiên (Sale bấm gửi
   * từ giao diện Sata) dùng lại được cùng một hàm, không phải chép luật lần hai.
   */
  coQuyenDieuPhoi: boolean;
};

/** Hình dạng `metadata` ghi xuống — khớp khuôn panel đang đọc (`platform` + `content`). */
export type MetaMocNhanTinZalo = {
  platform: typeof META_NEN_TANG_ZALO;
  content: string;
  via: typeof META_NGUON_ZALOCRM;
  inboxMessageId: string;
  /** Chỉ có mặt ở ca "lead chưa giao" — dấu `SYSTEM_ACTIVITY_META`. */
  system?: true;
};

export type LyDoKhongGhi = "TIN_DEN" | "CHUA_GUI_DUOC";

export type QuyetDinhMocNhanTin =
  | { ghi: false; lyDo: LyDoKhongGhi }
  | {
      ghi: true;
      type: "MESSAGE" | "NOTE";
      content: string;
      metadata: MetaMocNhanTinZalo;
      lamMoiDongHo: boolean;
    };

/**
 * LUẬT S-9 cho tin ZaloCRM — hàm THUẦN, không chạm DB, không hỏi quyền.
 *
 * Tách khỏi phần ghi vì đây mới là thứ đáng kiểm: bốn ca ở bảng đầu file kiểm
 * được bằng bốn `expect` không cần Postgres, không cần mock next-auth.
 */
export function quyetDinhMocNhanTin(tin: TinNhanZaloDeGhi): QuyetDinhMocNhanTin {
  // Ca 4 — tin đến: im lặng. Xem chú thích đầu file để biết vì sao "ghi thêm cho
  // đầy đủ" ở đây là phá, không phải bổ sung.
  if (tin.huong === "DEN") return { ghi: false, lyDo: "TIN_DEN" };
  if (!tin.daGuiDuoc) return { ghi: false, lyDo: "CHUA_GUI_DUOC" };

  const noiDung = tin.noiDung.trim() || NOI_DUNG_TRONG;

  // Ca 3 — phiếu chưa giao: `NOTE` mang dấu máy, KHÔNG `MESSAGE`.
  //
  // Dấu máy (`metadata.system === true`) làm hai việc cùng lúc, và cả hai đều
  // cần: `isLeadOutreach` loại dòng này khỏi "đã tiếp cận khách" ⇒ `firstContactAt`
  // không bị đóng và SLA-3 còn kêu; `hasSaleInteraction` cũng loại nó ⇒ phiếu vẫn
  // được tự chia cho một sale thật.
  const chuaGiao = tin.assignedToId === null;

  const metadata: MetaMocNhanTinZalo = {
    platform: META_NEN_TANG_ZALO,
    content: noiDung,
    via: META_NGUON_ZALOCRM,
    inboxMessageId: tin.inboxMessageId,
    ...(chuaGiao ? SYSTEM_ACTIVITY_META : {}),
  };

  return {
    ghi: true,
    type: chuaGiao ? "NOTE" : "MESSAGE",
    metadata,
    // Khuôn chuỗi của panel: `[${platform}] ${content}` — giữ nguyên để dòng từ
    // ZaloCRM đọc giống hệt dòng Sale gõ tay, và để bản fallback (khi người xem
    // không đủ quyền thấy `metadata`) vẫn ra chữ đọc được.
    content: `[${META_NEN_TANG_ZALO}] ${noiDung}`,
    // Đồng hồ: hỏi ĐÚNG MỘT nơi. Không gõ lại `assignedToId === userId` ở đây —
    // đó là cách hai bản luật bắt đầu lệch nhau.
    lamMoiDongHo: duocLamMoiDongHoChamSoc({
      userId: tin.sentByUserId ?? NGUOI_GUI_KHONG_MAP_DUOC,
      assignedToId: tin.assignedToId,
      coQuyenDieuPhoi: tin.coQuyenDieuPhoi,
    }),
  };
}

/**
 * Ghi mốc nhắn tin lên dòng thời gian của phiếu lead (nếu luật cho phép).
 *
 * Không trả gì: chỗ gọi (webhook) không có quyết định nào phụ thuộc kết quả —
 * cần biết vì sao không ghi thì gọi `quyetDinhMocNhanTin` trước, nó thuần.
 *
 * ⚠️ Lỗi DB được để NÉM RA, cố ý. Webhook phải trả 5xx để bên gửi retry; nuốt
 * lỗi ở đây là mất tin vĩnh viễn trong khi nhà cung cấp tưởng đã giao xong.
 */
export async function ghiMocNhanTinLead(tin: TinNhanZaloDeGhi): Promise<void> {
  const qd = quyetDinhMocNhanTin(tin);
  if (!qd.ghi) return;

  await db.$transaction(async (tx) => {
    await recordLeadActivity({
      tx,
      leadId: tin.leadId,
      // `null` = đường máy. Đúng nghĩa khi nick gửi chưa nối được tài khoản Sata.
      actorId: tin.sentByUserId,
      actorName: tin.actorName,
      type: qd.type,
      content: qd.content,
      metadata: qd.metadata satisfies Prisma.InputJsonObject,
      lamMoiDongHo: qd.lamMoiDongHo,
    });
  });
}
