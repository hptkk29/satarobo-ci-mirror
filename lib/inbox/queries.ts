import "server-only";
// lib/inbox/queries.ts — ĐƯỜNG ĐỌC DUY NHẤT của hộp thư đa kênh.
//
// 🔴 Mọi truy vấn `db.inbox*` phải nằm trong `lib/inbox/`. Test
// `lib/inbox/cong-truy-cap.test.ts` đỏ nếu có file khác chạm vào. Lý do: ba bảng
// này KHÔNG được `scopedDb` che (chúng mang `orgUnitId`, `scopedDb` chỉ lọc
// `centerId`), nên cách ly cơ sở chỉ tồn tại nếu MỌI `where` đều gộp
// `inboxOrgScopeWhere(actor)`. Một chỗ gọi quên là một lỗ, và lỗ đó im lặng.
//
// ── Hai tầng cách ly, cố ý chồng lên nhau ───────────────────────────────────
//   1. Hội thoại/tin: `inboxOrgScopeWhere(actor)` (thủ công, file `scope.ts`).
//   2. Hồ sơ khách kèm theo: đọc `Lead` qua `scopedDb(actor)` — `Lead` ∈
//      SCOPED_MODELS nên vẫn được cách ly tự động. Hội thoại thấy được mà lead
//      không thấy được ⇒ thẻ hiện "Khách chưa rõ tên". Fail-closed, đúng ý.
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import type { InboxChannel, InboxConversationStatus } from "@prisma/client";
import { inboxOrgScopeWhere } from "@/lib/inbox/scope";
import { chieuHoiThoai, chieuTinNhan, type HoiThoaiView, type TinNhanView } from "@/lib/inbox/view";

/**
 * Trần dòng một lượt đọc. Cùng lý do `SO_DONG_TOI_DA` của màn "Khách của tôi": trả
 * cả nghìn hội thoại xuống trình duyệt là màn hình đứng hình, mà người trực chỉ
 * làm việc với vài chục cái trên cùng.
 */
export const SO_HOI_THOAI_TOI_DA = 200;

export type BoLocHopThu = {
  channel?: InboxChannel | null;
  /** `null` = mọi người · `"CHUA_GAN"` = chưa có ai nhận · userId = của người đó. */
  assignee?: string | "CHUA_GAN" | null;
  /** Chỉ hội thoại khách đã nhắn mà chưa có tin nào ĐI ĐƯỢC sau đó. */
  chuaTraLoi?: boolean;
  /** Chỉ hội thoại chưa nối được phiếu khách nào. */
  moCoi?: boolean;
  status?: InboxConversationStatus | null;
};

export type DanhSachHopThu = {
  rows: HoiThoaiView[];
  tong: number;
  /** Câu nói thật khi danh sách bị cắt — im lặng cắt là nói dối bằng con số. */
  canhBaoCat: string | null;
};

// ── BỘ DỰNG `where` — MỌI truy vấn hộp thư phải dùng một trong ba hàm dưới ─────
// Mỗi hàm gộp `inboxOrgScopeWhere(actor)` ngay trong thân nó. Nhờ vậy "có nhớ lọc
// theo đơn vị không" không còn là câu hỏi ở từng chỗ gọi — nó là tính chất của bộ
// dựng. `cong-truy-cap.test.ts` đọc mã và bắt lỗi nếu có truy vấn nào truyền
// `where` bằng object literal viết tay thay vì gọi ba hàm này.

/** `where` chung cho cả `findMany` lẫn `count` — hai chỗ phải KHÔNG BAO GIỜ lệch. */
function dungWhere(actor: Actor, loc: BoLocHopThu) {
  const dieuKien: Record<string, unknown>[] = [
    { deletedAt: null },
    inboxOrgScopeWhere(actor),
  ];
  if (loc.channel) dieuKien.push({ channel: loc.channel });
  if (loc.status) dieuKien.push({ status: loc.status });
  if (loc.assignee === "CHUA_GAN") dieuKien.push({ assigneeId: null });
  else if (loc.assignee) dieuKien.push({ assigneeId: loc.assignee });
  if (loc.moCoi) dieuKien.push({ identity: { leadId: null } });
  // Lọc ở DB bằng CỘT `awaitingReply`, không lọc sau khi lấy về: lọc sau thì trần
  // 200 dòng ăn vào tập CHƯA lọc và người dùng mất đúng những hội thoại cũ đang bị
  // bỏ quên — tức mất đúng thứ bộ lọc này sinh ra để tìm. (Prisma không so được
  // `lastOutboundAt < lastInboundAt` trong `where`; đó là lý do cột tồn tại.)
  if (loc.chuaTraLoi) dieuKien.push({ awaitingReply: true });
  return { AND: dieuKien };
}

/** `where` cho MỘT hội thoại theo id — vẫn phải qua cổng đơn vị. */
function whereMotHoiThoai(actor: Actor, conversationId: string) {
  return {
    AND: [{ id: conversationId, deletedAt: null }, inboxOrgScopeWhere(actor)],
  };
}

/** `where` cho các phép đếm huy hiệu. */
function whereDem(actor: Actor, them: Record<string, unknown>) {
  return {
    AND: [
      { deletedAt: null },
      inboxOrgScopeWhere(actor),
      { status: "OPEN" as const },
      them,
    ],
  };
}

export async function listInboxConversations(input: {
  actor: Actor;
  canViewPii: boolean;
  loc?: BoLocHopThu;
}): Promise<DanhSachHopThu> {
  const loc = input.loc ?? {};
  // Đặt tên rồi truyền TƯỜNG MINH (`where: whereDs`) thay vì viết tắt `{ where }`:
  // `cong-truy-cap.test.ts` đọc mã để kiểm mọi truy vấn đều lấy `where` từ bộ dựng,
  // và viết tắt làm nó không đọc được — test mục đi trong im lặng là tệ hơn không có.
  const whereDs = dungWhere(input.actor, loc);

  const [raw, tong] = await Promise.all([
    db.inboxConversation.findMany({
      where: whereDs,
      orderBy: { lastMessageAt: "desc" },
      take: SO_HOI_THOAI_TOI_DA,
      include: {
        identity: {
          select: { id: true, displayName: true, leadId: true, linkSource: true },
        },
      },
    }),
    db.inboxConversation.count({ where: whereDs }),
  ]);

  const leadById = await napLead(input.actor, raw.map((r) => r.identity.leadId));

  const rows = raw.map((r) =>
    chieuHoiThoai(
      { ...r, lead: r.identity.leadId ? (leadById.get(r.identity.leadId) ?? null) : null },
      input.canViewPii,
    ),
  );

  return {
    rows,
    tong,
    canhBaoCat:
      tong > SO_HOI_THOAI_TOI_DA
        ? `Đang hiển thị ${SO_HOI_THOAI_TOI_DA} hội thoại mới nhất trên tổng ${tong}. Lọc lại để thu hẹp.`
        : null,
  };
}

export type LuongHoiThoai = { hoiThoai: HoiThoaiView; tinNhan: TinNhanView[] };

/**
 * Một hội thoại + toàn bộ tin. Trả `null` cho CẢ HAI ca "không tồn tại" và "không
 * thuộc tầm nhìn" — phân biệt hai ca đó là biến id thành công cụ dò.
 */
export async function getInboxThread(input: {
  actor: Actor;
  canViewPii: boolean;
  conversationId: string;
  soTinToiDa?: number;
}): Promise<LuongHoiThoai | null> {
  const hoi = await db.inboxConversation.findFirst({
    where: whereMotHoiThoai(input.actor, input.conversationId),
    include: {
      identity: { select: { id: true, displayName: true, leadId: true, linkSource: true } },
    },
  });
  if (!hoi) return null;

  // NGOẠI LỆ DUY NHẤT, có chủ đích: đọc tin CON của một hội thoại đã qua cổng đơn
  // vị ở ngay trên. Gộp scope lần nữa ở đây là thừa — và tệ hơn, nó ẩn mất tin của
  // hội thoại mồ côi vừa được nối vào đơn vị khác trong lúc đang mở.
  // `cong-truy-cap.test.ts` giữ ngoại lệ này bằng tên biến `whereTinCuaHoiThoai`.
  const whereTinCuaHoiThoai = { conversationId: hoi.id, deletedAt: null };
  const tin = await db.inboxMessage.findMany({
    where: whereTinCuaHoiThoai,
    orderBy: { sentAt: "asc" },
    take: input.soTinToiDa ?? 300,
  });

  const leadById = await napLead(input.actor, [hoi.identity.leadId]);

  return {
    hoiThoai: chieuHoiThoai(
      { ...hoi, lead: hoi.identity.leadId ? (leadById.get(hoi.identity.leadId) ?? null) : null },
      input.canViewPii,
    ),
    tinNhan: tin.map((t) => chieuTinNhan(t, input.canViewPii)),
  };
}

/**
 * Nạp hồ sơ khách QUA `scopedDb` — cố ý, không dùng `db` trần.
 *
 * `Lead` ∈ SCOPED_MODELS nên đây là chỗ cách ly cơ sở vẫn còn hiệu lực. Hội thoại
 * mồ côi có thể thấy được ở mọi cơ sở, nhưng khoảnh khắc nó nối vào một lead của
 * CS2 thì Sale CS1 chỉ còn thấy cái vỏ hội thoại, không thấy hồ sơ khách.
 */
async function napLead(
  actor: Actor,
  leadIds: readonly (string | null)[],
): Promise<Map<string, { id: string; parentName: string | null; phone: string | null }>> {
  const ids = [...new Set(leadIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return new Map();
  const rows = await scopedDb(actor).lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, parentName: true, phone: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Đếm nhanh cho huy hiệu trên thanh điều hướng / thẻ tổng quan. */
export async function demHopThu(actor: Actor): Promise<{
  chuaTraLoi: number;
  moCoi: number;
  chuaGanNguoi: number;
}> {
  const [chuaTraLoi, moCoi, chuaGanNguoi] = await Promise.all([
    db.inboxConversation.count({ where: whereDem(actor, { awaitingReply: true }) }),
    db.inboxConversation.count({ where: whereDem(actor, { identity: { leadId: null } }) }),
    db.inboxConversation.count({ where: whereDem(actor, { assigneeId: null }) }),
  ]);
  return { chuaTraLoi, moCoi, chuaGanNguoi };
}
