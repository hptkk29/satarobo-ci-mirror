import "server-only";
// lib/inbox/don-vi.ts — GẮN ĐƠN VỊ (`orgUnitId`) cho hộp thư. MỘT phép lan, dùng chung.
//
// 🔴 VÌ SAO FILE NÀY TỒN TẠI: `orgUnitId` là thứ DUY NHẤT tạo ra cách ly cơ sở cho ba
// bảng `Inbox*` (`scopedDb` không che chúng — xem `scope.ts`). Trước file này, phép
// lan "identity → hội thoại → tin" chỉ nằm trong `noiIdentityVaoLead`, nên mọi đường
// khác biết được cơ sở (gán người phụ trách, nick ZaloCRM) đều KHÔNG lan gì cả —
// hội thoại ở lại nhóm mồ côi, mà nhóm mồ côi thì MỌI cơ sở đọc được.
//
// Nên luật là: chỉ có ĐÚNG MỘT phép lan, ở đây. Ai biết được đơn vị thì gọi vào,
// không ai chép lại ba câu `update` đó lần thứ hai.
//
// ── `orgUnitId` đến từ đâu, theo thứ tự MẠNH → YẾU ──────────────────────────
//   1. `Lead` đã nối  — mạnh nhất, là hồ sơ khách thật (`identity.ts`).
//   2. Nick/kênh      — nick ZaloCRM thuộc đúng một cơ sở (`ganDonViTheoNick`).
//   3. Người phụ trách — ai nhận thì hội thoại về cơ sở người đó (`thao-tac.ts`).
// Nguồn yếu KHÔNG được đè nguồn đã ghi: xem `quyetDinhGanDonVi`.
import type { InboxIdentityLinkSource, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

type Tx = Prisma.TransactionClient;

export type QuyetDinhGanDonVi =
  /** `donVi` = giá trị ĐÃ CHUẨN HOÁ phải ghi. Chỗ gọi dùng nó, đừng dùng lại đầu vào
   *  — hai giá trị lệch nhau (khoảng trắng thừa) là cách âm thầm đẻ ra hai "cơ sở". */
  | { gan: true; donVi: string }
  | {
      gan: false;
      lyDo:
        /** Chưa biết cơ sở (nick chưa khai, tài khoản chưa gán). KHÔNG ghi `null` đè. */
        | "KHONG_BIET_DON_VI"
        /** Đã thuộc cơ sở KHÁC — nguồn mạnh hơn đã quyết, không đè. */
        | "DA_CO_DON_VI_KHAC";
    };

/**
 * Có được ghi đơn vị mới lên dòng này không. THUẦN — test không cần DB.
 *
 * Ba điều nó bảo vệ, mỗi điều là một lỗi im lặng đã lường trước:
 *  • đơn vị mới rỗng ⇒ KHÔNG ghi. Ghi `null` đè lên hội thoại đã có cơ sở là đẩy nó
 *    về nhóm "ai cũng đọc được" — tức tự tay mở lại lỗ rò B2.
 *  • đơn vị mới KHÁC đơn vị đang có ⇒ KHÔNG đè. Hội thoại có cơ sở gần như luôn vì
 *    đã nối `Lead`; đè là chuyển nó sang cơ sở khác sau lưng người đang xử lý.
 *  • đơn vị mới TRÙNG ⇒ VẪN lan. Lan lại là idempotent và là đường tự chữa duy nhất
 *    cho dòng đã nằm sẵn trong DB từ trước lúc gắn (tin cũ, hội thoại thứ hai).
 */
export function quyetDinhGanDonVi(input: {
  donViHienTai: string | null | undefined;
  donViMoi: string | null | undefined;
}): QuyetDinhGanDonVi {
  const moi = input.donViMoi?.trim();
  if (!moi) return { gan: false, lyDo: "KHONG_BIET_DON_VI" };
  const hienTai = input.donViHienTai?.trim();
  if (hienTai && hienTai !== moi) return { gan: false, lyDo: "DA_CO_DON_VI_KHAC" };
  return { gan: true, donVi: moi };
}

/** Phần ghi kèm lên `InboxIdentity` khi lan (chỉ đường nối `Lead` mới dùng tới). */
export type ThemVaoDanhTinh = {
  leadId?: string | null;
  linkedAt?: Date | null;
  linkedById?: string | null;
  linkSource?: InboxIdentityLinkSource | null;
};

/**
 * LAN `orgUnitId` từ một danh tính xuống hội thoại và tin của nó.
 *
 * 🔴 Đây là phép lan DUY NHẤT của module — `noiIdentityVaoLead`, `goNoiIdentity`,
 * `ganNguoiPhuTrach`, `ganDonViTheoNick` đều đi qua đây. Bản thứ hai của phép lan là
 * cách chắc chắn nhất để một trong bốn đường quên mất một bảng.
 *
 * Bắt buộc chạy TRONG một transaction (`tx` do chỗ gọi mở): ba bảng phải cùng đổi
 * hoặc cùng không. Đổi được identity mà hỏng ở tin là hội thoại "đã có cơ sở" trong
 * khi tin của nó vẫn mồ côi — lệch kiểu đó không ai nhìn thấy.
 */
export async function lanDonViTuIdentity(
  tx: Tx,
  input: { identityId: string; orgUnitId: string | null; themVaoDanhTinh?: ThemVaoDanhTinh },
): Promise<void> {
  await tx.inboxIdentity.update({
    where: { id: input.identityId },
    data: { ...input.themVaoDanhTinh, orgUnitId: input.orgUnitId },
  });
  const hoi = await tx.inboxConversation.findMany({
    where: { identityId: input.identityId },
    select: { id: true },
  });
  if (hoi.length === 0) return;
  const ids = hoi.map((h) => h.id);
  await tx.inboxConversation.updateMany({
    where: { id: { in: ids } },
    data: { orgUnitId: input.orgUnitId },
  });
  await tx.inboxMessage.updateMany({
    where: { conversationId: { in: ids } },
    data: { orgUnitId: input.orgUnitId },
  });
}

export type KetQuaGanDonVi = {
  daGan: boolean;
  /** `null` khi đã gắn. Ba mã còn lại là ba lý do KHÔNG gắn — không mã nào là lỗi. */
  lyDo:
    | "KHONG_BIET_DON_VI"
    | "DA_CO_DON_VI_KHAC"
    /** Hội thoại/danh tính không tồn tại (hoặc đã xoá mềm). */
    | "KHONG_TIM_THAY"
    | null;
};

/**
 * Gắn cơ sở cho một hội thoại NGAY lúc biết nó thuộc nick nào.
 *
 * Vì sao cần: nick ZaloCRM (và mọi tài khoản kênh) thuộc đúng MỘT cơ sở — biết từ
 * trước cả khi khách nhắn câu đầu tiên. Không gắn thì hội thoại nằm nhóm mồ côi cho
 * tới khi có người nối `Lead` bằng tay, mà nhóm mồ côi hiện với MỌI cơ sở. Gắn sớm
 * làm nhóm mồ côi chỉ còn đúng MỘT nghĩa: "chưa nối được phiếu khách" — không còn
 * lẫn nghĩa "chưa biết cơ sở".
 *
 * ⚠️ KHÔNG ném với id lạ: đường gọi là WEBHOOK. Ném ở đây là nhà cung cấp thấy 5xx
 * rồi retry mãi một payload không bao giờ xử lý được.
 */
export async function ganDonViTheoNick(input: {
  /** Một trong hai. Webhook cầm `conversationId` từ `ingest*`; đồng bộ nick cầm `identityId`. */
  conversationId?: string;
  identityId?: string;
  /** Đơn vị của nick. `null`/rỗng ⇒ không làm gì (xem `quyetDinhGanDonVi`). */
  orgUnitId: string | null;
}): Promise<KetQuaGanDonVi> {
  const danhTinh = await napDanhTinh(input);
  if (!danhTinh) return { daGan: false, lyDo: "KHONG_TIM_THAY" };

  const qd = quyetDinhGanDonVi({
    donViHienTai: danhTinh.orgUnitId,
    donViMoi: input.orgUnitId,
  });
  if (!qd.gan) return { daGan: false, lyDo: qd.lyDo };

  await db.$transaction((tx) =>
    lanDonViTuIdentity(tx, { identityId: danhTinh.id, orgUnitId: qd.donVi }),
  );
  return { daGan: true, lyDo: null };
}

/**
 * Đơn vị của một tài khoản người dùng.
 *
 * Theo đúng khuôn đã ghi ở `lib/org/orgunit-rules.ts`: `User.orgUnitId` (cột ghi kép
 * PR-A) trước, chưa có thì suy từ `centerId`. Tài khoản chưa khai cả hai ⇒ `null`, và
 * đó KHÔNG phải lỗi — chỗ gọi phải chịu được ca này (xem `ganNguoiPhuTrach`).
 */
export async function donViCuaNguoiDung(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { orgUnitId: true, centerId: true },
  });
  if (!u) return null;
  return u.orgUnitId ?? (await orgUnitIdForCenter(u.centerId));
}

// ── Bên trong ────────────────────────────────────────────────────────────────

/** Danh tính là gốc của phép lan — hội thoại chỉ để tìm ra nó. */
async function napDanhTinh(input: {
  conversationId?: string;
  identityId?: string;
}): Promise<{ id: string; orgUnitId: string | null } | null> {
  if (input.identityId) {
    return db.inboxIdentity.findFirst({
      where: { id: input.identityId, deletedAt: null },
      select: { id: true, orgUnitId: true },
    });
  }
  if (!input.conversationId) return null;
  const hoi = await db.inboxConversation.findFirst({
    where: { id: input.conversationId, deletedAt: null },
    select: { identity: { select: { id: true, orgUnitId: true } } },
  });
  return hoi?.identity ?? null;
}
