import "server-only";
// lib/inbox/thao-tac.ts — LÕI của các Server Action hộp thư.
//
// Vì sao tách khỏi file `"use server"`: file `"use server"` chỉ được export hàm
// async (mọi export khác vỡ Server Actions lúc chạy mà `pnpm build` vẫn xanh), và
// nó không nạp được trong vitest. Logic thật ở đây, file kia mỏng.
//
// ⚠️ Không có kiểm QUYỀN ở đây — quyền đi qua `can()` ở lớp có `actor` (luật cứng
// #1). Ở đây chỉ có kiểm TẦM NHÌN (`passesInboxScope`), thứ mà `scopedDb` không
// làm hộ được cho ba bảng này.
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import type { InboxChannel } from "@prisma/client";
import { passesInboxScope } from "@/lib/inbox/scope";
import {
  donViCuaNguoiDung,
  lanDonViTuIdentity,
  quyetDinhGanDonVi,
} from "@/lib/inbox/don-vi";
import { noiIdentityVaoLead } from "@/lib/inbox/identity";
import { sendInboxReply } from "@/lib/inbox/send";
import { LY_DO_MO_PHONG } from "@/lib/integrations/types";
import { tinhChoTraLoi } from "@/lib/inbox/view";

export class NgoaiTamNhinError extends Error {
  readonly code = "NGOAI_TAM_NHIN";
  constructor() {
    super("Hội thoại không thuộc phạm vi của bạn.");
  }
}

export type KetQuaThaoTac = {
  thongBao: string;
  /** Chỉ có nghĩa với lượt gửi tin. `false` = tin CHƯA tới khách. */
  daGui?: boolean;
};

/**
 * Nạp hội thoại + kiểm tầm nhìn. Gọi TRƯỚC mọi thao tác ghi.
 *
 * Ném cùng một lỗi cho "không tồn tại" và "ngoài tầm nhìn" — phân biệt hai ca đó
 * là biến id hội thoại thành công cụ dò.
 */
export async function layHoiThoaiDeThaoTac(
  actor: Actor,
  conversationId: string,
): Promise<{ id: string; identityId: string; channel: InboxChannel; orgUnitId: string | null }> {
  const hoi = await db.inboxConversation.findFirst({
    where: { id: conversationId, deletedAt: null },
    select: { id: true, identityId: true, channel: true, orgUnitId: true },
  });
  if (!passesInboxScope(actor, hoi)) throw new NgoaiTamNhinError();
  return hoi!;
}

/**
 * Gửi tin trả lời và dịch kết quả thành câu nói với người dùng.
 *
 * 🔴 Đây là chỗ quyết định giao diện nói thật hay nói dối. `daGui` chỉ true khi
 * adapter trả `SENT`; mọi nhánh khác đều kèm câu giải thích CHƯA gửi được và vì sao.
 */
export async function guiTraLoi(input: {
  conversationId: string;
  body: string;
  sentByUserId: string;
  outboundKey: string;
}): Promise<KetQuaThaoTac> {
  const kq = await sendInboxReply(input);

  switch (kq.outcome.status) {
    case "SENT":
      return { thongBao: "Đã gửi tới khách.", daGui: true };
    case "SIMULATED":
      return { thongBao: LY_DO_MO_PHONG[kq.outcome.reason], daGui: false };
    case "SKIPPED":
      return {
        thongBao:
          "Kênh này chưa gửi ra được. Tin đã lưu vào hội thoại nhưng CHƯA tới khách " +
          `(mã: ${kq.outcome.errorCode}).`,
        daGui: false,
      };
    case "FAILED":
      return {
        thongBao:
          "Nhà cung cấp từ chối. Tin CHƯA tới khách — thử lại hoặc báo kỹ thuật " +
          `(mã: ${kq.outcome.errorCode}).`,
        daGui: false,
      };
  }
}

/**
 * Gán / trả người phụ trách — VÀ gắn luôn đơn vị của người được gán.
 *
 * 🔴 Vì sao phần đơn vị nằm ở đây (lỗi B2): hội thoại `orgUnitId = null` là hội thoại
 * MỒ CÔI, mà mồ côi thì MỌI cơ sở đọc được (`scope.ts`). Bản cũ chỉ ghi ba cột
 * `assignee*` ⇒ hội thoại đã có người nhận vẫn nằm nhóm ai-cũng-đọc: Sale cơ sở khác
 * mở ra xem được cả nội dung khách nhắn. Không lỗi nào văng ra; nó chỉ lộ khi có
 * người khiếu nại.
 *
 * Ba lựa chọn cố ý, mỗi cái chặn một cách hỏng khác nhau:
 *  • Chỉ ĐIỀN vào chỗ trống, không đè (`quyetDinhGanDonVi`). Hội thoại đã nối `Lead`
 *    thì `Lead` quyết cơ sở; đè theo người nhận là kéo hội thoại sang cơ sở khác sau
 *    lưng người đang xử lý. Điều phối viên (HO) vẫn gán được người ở cơ sở khác —
 *    chỉ là việc gán không đổi cơ sở của hội thoại.
 *  • BỎ gán KHÔNG xoá đơn vị. Xoá là đẩy hội thoại về nhóm mồ côi, tức tự tay mở lại
 *    đúng lỗ vừa bịt. Muốn gỡ đơn vị thì gỡ nối lead (`goNoiIdentity`).
 *  • Người được gán chưa khai đơn vị ⇒ VẪN gán, hội thoại vẫn mồ côi. Điều phối là
 *    việc hằng ngày; chặn nó vì thiếu dữ liệu quản trị là chặn nhầm chỗ.
 */
export async function ganNguoiPhuTrach(input: {
  conversationId: string;
  assigneeId: string | null;
  boiUserId: string;
}): Promise<KetQuaThaoTac> {
  // Nạp NGOÀI transaction: đọc `User` + `OrgUnit` là hai truy vấn không liên quan gì
  // tới ba bảng hộp thư, giữ chúng trong transaction chỉ kéo dài thời gian giữ khoá.
  const donVi = input.assigneeId ? await donViCuaNguoiDung(input.assigneeId) : null;

  await db.$transaction(async (tx) => {
    const hoi = await tx.inboxConversation.update({
      where: { id: input.conversationId },
      data: {
        assigneeId: input.assigneeId,
        assignedAt: input.assigneeId ? new Date() : null,
        assignedById: input.assigneeId ? input.boiUserId : null,
      },
      select: { identityId: true, orgUnitId: true },
    });
    // Cùng transaction với lượt gán: gán được mà lan hụt là hội thoại có người nhận
    // nhưng vẫn hiện với mọi cơ sở — đúng trạng thái mà B2 sinh ra để xoá bỏ.
    const qd = quyetDinhGanDonVi({ donViHienTai: hoi.orgUnitId, donViMoi: donVi });
    if (qd.gan) {
      await lanDonViTuIdentity(tx, { identityId: hoi.identityId, orgUnitId: qd.donVi });
    }
  });

  return {
    thongBao: input.assigneeId
      ? "Đã gán người phụ trách."
      : "Đã trả hội thoại về hàng đợi chung.",
  };
}

export async function doiTrangThaiHoiThoai(input: {
  conversationId: string;
  trangThai: "OPEN" | "SNOOZED" | "CLOSED";
}): Promise<KetQuaThaoTac> {
  await db.inboxConversation.update({
    where: { id: input.conversationId },
    data: { status: input.trangThai },
  });
  const nhan = { OPEN: "Đã mở lại", SNOOZED: "Đã tạm ẩn", CLOSED: "Đã đóng" };
  return { thongBao: `${nhan[input.trangThai]} hội thoại.` };
}

/**
 * Nối hội thoại vào một phiếu khách.
 *
 * Lead phải nằm trong TẦM NHÌN của người bấm — đọc qua `scopedDb` (Lead ∈
 * SCOPED_MODELS). Không kiểm thì người ta nối hội thoại vào một lead của cơ sở
 * khác và tự đẩy hội thoại ra khỏi mắt mình, hoặc dùng id lead để dò.
 */
export async function noiHoiThoaiVaoLead(input: {
  actor: Actor;
  identityId: string;
  leadId: string;
  boiUserId: string;
}): Promise<KetQuaThaoTac & { ok: true } | { ok: false; error: string }> {
  const lead = await scopedDb(input.actor).lead.findFirst({
    where: { id: input.leadId, deletedAt: null },
    select: { id: true },
  });
  if (!lead) return { ok: false, error: "Không tìm thấy phiếu khách trong phạm vi của bạn." };

  await noiIdentityVaoLead({
    identityId: input.identityId,
    leadId: lead.id,
    source: "MANUAL",
    boiUserId: input.boiUserId,
  });
  return { ok: true, thongBao: "Đã nối hội thoại vào phiếu khách." };
}

/**
 * Xoá MỀM một tin. Luật cứng module chat #3: mọi xoá là xoá mềm.
 *
 * Sau khi xoá, `awaitingReply` được tính LẠI: xoá tin trả lời cuối mà không tính
 * lại là hội thoại biến mất khỏi danh sách "chưa trả lời" trong khi khách vẫn đang
 * chờ.
 */
export async function xoaMemTin(input: {
  conversationId: string;
  messageId: string;
  boiUserId: string;
  lyDo: string;
}): Promise<KetQuaThaoTac> {
  await db.$transaction(async (tx) => {
    await tx.inboxMessage.updateMany({
      where: { id: input.messageId, conversationId: input.conversationId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        deletedById: input.boiUserId,
        deletedReason: input.lyDo,
      },
    });

    const [vaoCuoi, raCuoi] = await Promise.all([
      tx.inboxMessage.findFirst({
        where: { conversationId: input.conversationId, direction: "IN", deletedAt: null },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      tx.inboxMessage.findFirst({
        where: {
          conversationId: input.conversationId,
          direction: "OUT",
          deliveryStatus: "SENT", // chỉ tin ĐI ĐƯỢC mới tính là đã trả lời
          deletedAt: null,
        },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
    ]);

    await tx.inboxConversation.update({
      where: { id: input.conversationId },
      data: {
        lastInboundAt: vaoCuoi?.sentAt ?? null,
        lastOutboundAt: raCuoi?.sentAt ?? null,
        awaitingReply: tinhChoTraLoi({
          lastInboundAt: vaoCuoi?.sentAt ?? null,
          lastOutboundAt: raCuoi?.sentAt ?? null,
        }),
      },
    });
  });
  return { thongBao: "Đã xoá tin (xoá mềm, vẫn còn vết)." };
}

/** Đánh dấu đã đọc — chỉ đụng bộ đếm, không đụng trạng thái trả lời. */
export async function danhDauDaDoc(conversationId: string): Promise<void> {
  await db.inboxConversation.update({
    where: { id: conversationId },
    data: { unreadCount: 0 },
  });
}
