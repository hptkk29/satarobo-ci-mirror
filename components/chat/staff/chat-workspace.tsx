// components/chat/staff/chat-workspace.tsx — MÀN CHAT DÙNG CHUNG cho site admin
// (`/tin-nhan`) và site giáo viên (`/teacher/tin-nhan`).
//
// Server Component: đọc dữ liệu qua `lib/chat/*` rồi giao cho các component client.
// Hai trang chỉ khác nhau ở cổng quyền vào trang + khung layout của site — mọi thứ còn
// lại (danh sách, luồng, thông báo, thành viên, gỡ tin) là MỘT bản dùng chung, để hai bề mặt
// không bao giờ trôi lệch tính năng như hệ cũ.
//
// ⚠️ ĐỌC QUA `lib/chat/queries.ts` (dùng `db` trần) — CÓ CHỦ ĐÍCH, không đổi sang
// `scopedDb`: phạm vi đọc chat là PARTICIPANT-BASED, chặt hơn cách ly theo cơ sở
// (luật E-bis #5 + khối chú thích đầu `queries.ts`). GV dạy chéo cơ sở và học viên
// chuyển cơ sở đi qua scopedDb sẽ bị hiểu nhầm là "không phải thành viên".
//
// ⚠️ QUYỀN GỬI/THÔNG BÁO/GỠ TIN/QUẢN LÝ THÀNH VIÊN TÍNH Ở ĐÂY = Ở SERVER (US-10 AC1 "assert cả
// UI lẫn server"). Kết quả chỉ dùng để ẩn/hiện nút; mỗi Server Action tương ứng vẫn tự kiểm
// `can()` với target đọc từ DB, nên gọi thẳng action mà không qua nút vẫn bị chặn.
//
// ⚠️ Màn này DÙNG CHUNG với site giáo viên — nơi không có khung `.admin-scope` — nên chỉ dùng
// token `:root` (`primary`, `muted`, `border`, `card`, thang `state-*`). Xem `chat-ui.tsx`.
import Link from "next/link";
import { ArrowLeft, Megaphone, MessageSquare } from "lucide-react";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  getConversationMembers,
  getMessagesPage,
  listConversationsForUser,
} from "@/lib/chat/queries";
import { getAnnouncementReadStats, listAnnouncements } from "@/lib/chat/announcements";
import {
  dmWitnessClassId,
  isTeacherOfClass,
  listAssignableParentsForSale,
} from "@/lib/chat/dm";
import { listChatAttachments } from "@/lib/chat/messages";
import { listManualMemberIds } from "@/lib/chat/members-admin";
import { ChatListRefresher } from "../chat-list-refresher";
import { OpenDmButton } from "../open-dm-button";
import { AddMemberButton, BulkAddButton } from "./add-members-sheet";
import { AnnouncementReadStats } from "./announcement-read-stats";
import { ChatThread } from "./chat-thread";
import { Chip, PersonAvatar } from "./chat-ui";
import { ConversationSearch } from "./conversation-search";
import { MemberRemoveButton } from "./member-remove-button";
import type {
  StaffAnnouncementStats,
  StaffChatMember,
  StaffChatMessage,
  StaffConversationItem,
} from "./types";

/** Số thông báo mỗi trang ở tab "Xem tất cả thông báo". */
const ANNOUNCEMENT_PAGE_SIZE = 20;
/** Trần số thông báo được dựng sẵn thống kê đã-đọc ở server (mỗi bản = vài truy vấn). */
const STATS_PREFETCH_LIMIT = 10;

const timeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Lý do vô hiệu ô nhập KHÔNG-PHẢI-KHOÁ. Trạng thái LOCKED cố ý KHÔNG nằm ở đây: nó đổi
 * được giữa phiên (Admin bấm khoá — US-15 AC3) nên đi đường riêng `initialLocked` +
 * broadcast `conversation.locked`, còn câu hiển thị nằm ở `CONVERSATION_LOCKED_NOTICE`.
 */
function disabledReasonOf(status: string): string | null {
  if (status === "ARCHIVED") return "Lớp đã kết thúc — hội thoại đã lưu trữ, chỉ xem lại.";
  return null;
}

export type StaffChatWorkspaceProps = {
  /** `User.id` người đang xem (đã qua `auth()` ở trang cha). */
  userId: string;
  /** Đường dẫn gốc của màn chat trên site đó: "/tin-nhan" hoặc "/teacher/tin-nhan". */
  basePath: string;
  /** `?c=` — hội thoại đang mở. */
  conversationId?: string;
  /** `?tab=thong-bao` — màn "Xem tất cả thông báo" (US-09 AC2). */
  tab?: string;
  /** `?ac=` — cursor trang thông báo. */
  announcementCursor?: string;
  /** Câu gợi ý khi người dùng chưa có hội thoại nào (khác nhau giữa admin và GV). */
  emptyHint: string;
  /** F5 — phụ huynh mình được gán nhưng CHƯA có kênh (rỗng với vai không mở được kênh). */
  assignableParents?: { parentUserId: string; parentName: string | null; childLabels: string[] }[];
};

export async function StaffChatWorkspace({
  userId,
  basePath,
  conversationId,
  tab,
  announcementCursor,
  emptyHint,
  assignableParents = [],
}: StaffChatWorkspaceProps) {
  const [conversations, canAdminChat] = await Promise.all([
    listConversationsForUser(userId),
    // `chat:admin` là GLOBAL (chỉ SUPER_ADMIN) nên hỏi không target. Chỉ để hiện nút "Thêm đồng loạt".
    checkPermission("chat:admin"),
  ]);

  const items: StaffConversationItem[] = conversations.map((c) => ({
    conversationId: c.conversationId,
    type: c.type,
    displayName: c.displayName,
    isArchived: c.isArchived,
    statusLabel: c.statusLabel,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    preview: c.lastMessage?.text ?? null,
  }));

  // Chỉ mở được hội thoại NẰM TRONG danh sách của chính mình → id lạ gõ tay rơi về
  // "chưa chọn", không lộ hội thoại có tồn tại hay không.
  const selected = conversationId
    ? (conversations.find((c) => c.conversationId === conversationId) ?? null)
    : null;

  return (
    // Màn chat chiếm TRỌN chiều cao khả dụng (yêu cầu chủ dự án 10/08: "bấm vào tin nhắn
    // thì cả màn hình là các cuộc hội thoại"). `h-[calc(100dvh-…)]` chứ không phải `min-h`:
    // hai cột phải TỰ CUỘN bên trong, nếu để trang cuộn thì ô nhập tin trôi khỏi tầm mắt.
    // `dvh` (không phải `vh`): thanh địa chỉ trình duyệt điện thoại co giãn làm `100vh` thừa
    // ra, đẩy ô nhập khỏi màn hình.
    <div className="flex h-[calc(100dvh-8rem)] min-h-[32rem] flex-col gap-3 lg:flex-row lg:gap-4">
      {/* Tin mới ở BẤT KỲ hội thoại nào ⇒ chạy lại RSC này ⇒ danh sách tự sắp lại, đổi
          preview/giờ/badge. Không render gì; giữ `ConversationList` là component thuần. */}
      <ChatListRefresher userId={userId} />

      <aside
        className={`min-h-0 w-full shrink-0 lg:w-80 xl:w-[22rem] ${selected ? "hidden lg:flex" : "flex"} flex-col`}
        aria-label="Danh sách hội thoại"
      >
        <ConversationSearch
          conversations={items.map((i) => ({
            conversationId: i.conversationId,
            displayName: i.displayName,
            type: i.type,
            preview: i.preview,
            unreadCount: i.unreadCount,
            isArchived: i.isArchived,
            lastMessageAt: i.lastMessageAt,
          }))}
          parents={assignableParents}
          basePath={basePath}
          selectedId={selected?.conversationId ?? null}
          headerAction={canAdminChat ? <BulkAddButton /> : undefined}
        />
      </aside>

      <section className={`min-h-0 min-w-0 flex-1 ${selected ? "block" : "hidden lg:block"}`}>
        {selected ? (
          tab === "thanh-vien" ? (
            <MembersPanel
              userId={userId}
              basePath={basePath}
              conversationId={selected.conversationId}
              title={selected.displayName}
              type={selected.type}
              status={selected.status}
              classId={selected.type === "CLASS_GROUP" ? selected.subjectId : null}
              centerId={selected.centerId}
            />
          ) : tab === "thong-bao" ? (
            <AnnouncementsPanel
              userId={userId}
              basePath={basePath}
              conversationId={selected.conversationId}
              title={selected.displayName}
              classId={selected.type === "CLASS_GROUP" ? selected.subjectId : null}
              centerId={selected.centerId}
              cursor={announcementCursor}
            />
          ) : (
            <ThreadPanel
              userId={userId}
              basePath={basePath}
              conversationId={selected.conversationId}
              title={selected.displayName}
              status={selected.status}
              type={selected.type}
              classId={selected.type === "CLASS_GROUP" ? selected.subjectId : null}
              centerId={selected.centerId}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <MessageSquare className="size-6" aria-hidden />
            </span>
            <p className="max-w-sm text-sm text-muted-foreground">
              {items.length > 0 ? "Chọn một hội thoại bên trái để đọc và trả lời." : emptyHint}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

async function ThreadPanel({
  userId,
  basePath,
  conversationId,
  title,
  status,
  type,
  classId,
  centerId,
}: {
  userId: string;
  basePath: string;
  conversationId: string;
  title: string;
  status: string;
  type: string;
  classId: string | null;
  centerId: string | null;
}) {
  // ⚠️ TARGET PHẢI GIỐNG HỆT SERVER, KHÔNG ĐƯỢC "gần đúng":
  // • GỬI/THU HỒI — hội thoại 1-1 có `subjectType = NONE` nên không có `subjectId` làm
  //   `classId`; nguồn đúng là LỚP LÀM CHỨNG (`dmWitnessClassId`), y hệt `sendTargetOf`
  //   ở lib/chat/messages.ts. Thiếu nó thì GV thấy ô nhập XÁM trong mọi hội thoại riêng.
  // • THÔNG BÁO/GỠ TIN NGƯỜI KHÁC — server cố ý KHÔNG dùng lớp làm chứng cho 1-1
  //   (ma trận không có ô đó), nên ở đây cũng dùng `classId` thô để nút hiện đúng bằng
  //   thứ server sẽ cho qua. Hai target khác nhau là CÓ CHỦ ĐÍCH.
  const sendClassId =
    type === "CLASS_GROUP" ? classId : await dmWitnessClassId(conversationId, userId);
  // ⚠️ `createdById: userId` — BẢN SAO PHẢI KHỚP HỆT SERVER, và đây chính là chỗ nó từng
  // lệch. `sendTargetOf` (lib/chat/messages.ts:396-403) gán `createdById = actor.userId`
  // KHI người gửi là thành viên hội thoại; người xem màn này LUÔN là thành viên (danh sách
  // chỉ trả hội thoại của chính họ — `listConversationsForUser`), nên bỏ khoá này là dựng
  // một target NGHÈO HƠN server.
  //
  // Hậu quả đo được khi mở F5: SALES_CSM giữ `chat:send` scope **OWN**, mà `scopeMatches`
  // nhánh OWN đòi `target.createdById === actor.userId` (lib/auth/can.ts:24) ⇒ `canSend`
  // = false ⇒ ô nhập XÁM, trong khi Server Action vẫn CHO gửi. Người dùng thấy "hỏng",
  // log server sạch trơn.
  //
  // ⚠️ Và nó KHÔNG lộ ở máy local: `checkPermission` trả v1 khi `RBAC_V2_ENABLED` OFF
  // (mặc định trong code — lib/flags.ts:8), mà v1 là ma trận TĨNH không có scope nên
  // `chat:send` của Sale luôn true. Chỉ prod (v2 đang bật) mới xám.
  const sendTarget = { classId: sendClassId, centerId, createdById: userId };
  const groupTarget = { classId, centerId };
  const [page, memberViews, pinnedPage, canSend, canAnnounce, canModerate, canAdmin] =
    await Promise.all([
      getMessagesPage(conversationId, userId),
      getConversationMembers(conversationId, userId),
      listAnnouncements(conversationId, userId, { limit: 1 }),
      checkPermission("chat:send", sendTarget),
      checkPermission("chat:announce", groupTarget),
      checkPermission("chat:moderate", groupTarget),
      // Thêm/gỡ thành viên: chỉ nhóm LỚP còn hoạt động (1-1 chỉ có đúng hai người; nhóm đã
      // lưu trữ chỉ để đọc lại). Server kiểm lại cả hai điều kiện — đây chỉ là ẩn/hiện nút.
      type === "CLASS_GROUP" && status !== "ARCHIVED"
        ? checkPermission("chat:admin", groupTarget)
        : Promise.resolve(false),
    ]);

  // KHÔNG kèm `contact`: luồng chat không hiển thị SĐT/email của ai, mà mọi thứ truyền
  // vào ChatThread (Client Component) đều đi xuống trình duyệt trong payload RSC. Dữ
  // liệu không dùng tới mà vẫn gửi đi là rò rỉ không có lý do (BR-30).
  const members: StaffChatMember[] = memberViews.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    roleLabel: m.roleLabel,
  }));

  const pinnedRaw = pinnedPage.announcements.find((a) => !a.deleted) ?? null;

  // US-11 — ảnh của đúng 30 tin vừa tải. Chạy SAU vì cần danh sách id.
  const initialAttachments = await listChatAttachments(
    conversationId,
    userId,
    page.messages.map((m) => m.id),
  );

  return (
    <ChatThread
      // Đổi hội thoại = luồng khác hẳn → remount để state trong hook không dính lại.
      key={conversationId}
      conversationId={conversationId}
      currentUserId={userId}
      title={title}
      // Số thành viên chuyển vào chính LINK sang màn thành viên (US-13 AC1) — trước đây
      // con số hiện ở đây nhưng bấm vào không ra gì.
      subtitle={type === "CLASS_GROUP" ? "Nhóm lớp" : "Hội thoại riêng"}
      initialMessages={page.messages as StaffChatMessage[]}
      initialAttachments={initialAttachments}
      initialHasMore={page.hasMore}
      initialCursor={page.nextCursor}
      members={members}
      capabilities={{ canSend, canAnnounce, canModerate, canManageMembers: canAdmin }}
      pinnedAnnouncement={(pinnedRaw as StaffChatMessage | null) ?? null}
      disabledReason={disabledReasonOf(status)}
      initialLocked={status === "LOCKED"}
      announcementsHref={`${basePath}?c=${conversationId}&tab=thong-bao`}
      membersHref={`${basePath}?c=${conversationId}&tab=thanh-vien`}
      backHref={basePath}
    />
  );
}

/** Khung chung của hai màn phụ (Thành viên, Thông báo): đầu có nút quay lại + tiêu đề + hành động. */
function PanelShell({
  basePath,
  conversationId,
  title,
  subtitle,
  action,
  children,
}: {
  basePath: string;
  conversationId: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
        <Link
          href={`${basePath}?c=${conversationId}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          aria-label="Về luồng hội thoại"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-5 text-foreground sm:text-base">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * US-13 AC1 (chiều GV) — danh sách thành viên cho màn NHÂN VIÊN. Dùng lại đúng
 * `getConversationMembers` nên luật ẩn liên hệ (BR-30) vẫn do tầng query quyết định.
 *
 * ⚠️ Dòng liên hệ bên dưới KHÔNG tự lọc gì cả — nó chỉ in ra `m.contact` nếu tầng query
 * trả về. Sau bản vá 09/08, `contact` VẮNG MẶT với: người xem là PH · mọi hội thoại 1-1 ·
 * thành viên là phụ huynh mà người xem không có quyền xem liên hệ PH (GV/trợ giảng).
 * Đừng "cho chắc" bằng cách lọc thêm ở đây — hai chỗ lọc là hai chỗ trôi lệch; xem
 * `hidesContactOf` (lib/chat/queries.ts).
 *
 * Nhóm theo TƯ CÁCH trong nhóm (`derivedFrom`): Giáo viên · Quản lý & nhân viên · Phụ huynh.
 * "Nhân viên" gồm cả người Admin thêm tay (`derivedFrom = null`) — họ mang chip "Thêm tay" và
 * (chỉ với Admin) nút Gỡ; người do hệ thống dẫn xuất thì KHÔNG có nút Gỡ.
 */
async function MembersPanel({
  userId,
  basePath,
  conversationId,
  title,
  type,
  status,
  classId,
  centerId,
}: {
  userId: string;
  basePath: string;
  conversationId: string;
  title: string;
  type: string;
  status: string;
  classId: string | null;
  centerId: string | null;
}) {
  // Nút "Nhắn riêng" phải mở ĐÚNG LOẠI kênh theo TƯ CÁCH của người đang xem, chứ không
  // phải luôn luôn là kênh dạy học:
  //   • GV/trợ giảng CỦA CHÍNH LỚP NÀY → kênh giáo viên ↔ phụ huynh;
  //   • SALE ĐANG PHỤ TRÁCH phụ huynh đó → kênh tư vấn (F5);
  //   • còn lại (QLCS, giáo vụ, sale không phụ trách) → KHÔNG hiện nút.
  //
  // Trước bản này nút hiện cho MỌI người xem nhóm và luôn gửi `kind` mặc định, nên QLCS/
  // giáo vụ/sale bấm vào là chắc chắn `PERMISSION_DENIED` kèm câu "Chỉ nhắn riêng được
  // giữa giáo viên và phụ huynh của lớp đang học" — sai hẳn hướng, rất tốn thời gian truy.
  // Chủ dự án chốt 10/08: KHÔNG ẩn nút với sale, mà cho sale phụ trách bấm được thật.
  //
  // Các truy vấn phụ đều rẻ và chỉ chạy ở tab Thành viên: một `findFirst` khoá chính, một truy
  // vấn "phụ huynh tôi phụ trách" trả rỗng ngay với người không phải sale, và một truy vấn id
  // các dòng thêm tay (không kéo thêm cột nào vào `ConversationMemberView` dùng chung).
  const isClassGroup = type === "CLASS_GROUP";
  const manageable = isClassGroup && status !== "ARCHIVED";
  const [members, laGvCuaLop, phMinhPhuTrach, manualIds, canAdmin] = await Promise.all([
    getConversationMembers(conversationId, userId),
    isTeacherOfClass(classId, userId),
    listAssignableParentsForSale(userId).then((ds) => new Set(ds.map((p) => p.parentUserId))),
    listManualMemberIds(conversationId),
    manageable ? checkPermission("chat:admin", { classId, centerId }) : Promise.resolve(false),
  ]);
  const manual = new Set(manualIds);

  const sections: { key: string; label: string; rows: typeof members }[] = [
    { key: "teacher", label: "Giáo viên", rows: members.filter((m) => m.derivedFrom === "CLASS_TEACHER") },
    {
      key: "staff",
      label: "Quản lý & nhân viên",
      rows: members.filter((m) => m.derivedFrom === "CENTER_MANAGER" || m.derivedFrom === null),
    },
    {
      key: "parent",
      label: "Phụ huynh",
      rows: members.filter((m) => m.derivedFrom === "CLASS_STUDENT_PARENT"),
    },
  ].filter((s) => s.rows.length > 0);

  return (
    <PanelShell
      basePath={basePath}
      conversationId={conversationId}
      title={`Thành viên · ${title}`}
      subtitle={`${members.length} người đang trong hội thoại`}
      action={
        canAdmin ? (
          <AddMemberButton conversationId={conversationId} conversationTitle={title} compact />
        ) : undefined
      }
    >
      {members.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          Hội thoại chưa có thành viên nào.
        </p>
      ) : (
        sections.map((s) => (
          <section key={s.key}>
            <h3 className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-border bg-muted/80 px-4 py-2 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
              {s.label}
              <span className="font-normal">{s.rows.length}</span>
            </h3>
            <ul className="divide-y divide-border">
              {s.rows.map((m) => {
                const laTay = manual.has(m.userId);
                return (
                  <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                    <PersonAvatar name={m.displayName} id={m.userId} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium text-foreground">
                        <span className="truncate">{m.displayName}</span>
                        {m.userId === userId && (
                          <span className="font-normal text-muted-foreground">(bạn)</span>
                        )}
                        {laTay && <Chip tone="info">Thêm tay</Chip>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.roleLabel}
                        {m.contact && (m.contact.phone || m.contact.email)
                          ? ` · ${[m.contact.phone, m.contact.email].filter(Boolean).join(" · ")}`
                          : ""}
                      </p>
                    </div>
                    {/* Nhắn riêng chỉ mở với PHỤ HUYNH của nhóm lớp (`derivedFrom` = tư cách
                        TRONG nhóm). Quan hệ dạy học vẫn được server kiểm lại — nút chỉ là lối vào. */}
                    {isClassGroup &&
                      m.derivedFrom === "CLASS_STUDENT_PARENT" &&
                      m.userId !== userId &&
                      (laGvCuaLop ? (
                        <OpenDmButton peerUserId={m.userId} hrefTemplate={`${basePath}?c=:id`} />
                      ) : phMinhPhuTrach.has(m.userId) ? (
                        <OpenDmButton
                          peerUserId={m.userId}
                          kind="SALE_PARENT"
                          hrefTemplate={`${basePath}?c=:id`}
                          label="Nhắn riêng"
                        />
                      ) : null)}
                    {canAdmin && laTay && (
                      <MemberRemoveButton
                        conversationId={conversationId}
                        userId={m.userId}
                        name={m.displayName}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </PanelShell>
  );
}

/** US-09 AC2 — "Xem tất cả thông báo": lọc `kind=ANNOUNCEMENT`, mới nhất trước. */
async function AnnouncementsPanel({
  userId,
  basePath,
  conversationId,
  title,
  classId,
  centerId,
  cursor,
}: {
  userId: string;
  basePath: string;
  conversationId: string;
  title: string;
  classId: string | null;
  centerId: string | null;
  cursor?: string;
}) {
  const [page, canAnnounce] = await Promise.all([
    listAnnouncements(conversationId, userId, {
      limit: ANNOUNCEMENT_PAGE_SIZE,
      cursor: cursor ?? null,
    }),
    checkPermission("chat:announce", { classId, centerId }),
  ]);

  // Thống kê đã-đọc chỉ dành cho người có quyền gửi thông báo (permissions.md: PH ❌),
  // và chỉ dựng sẵn cho vài bản đầu — phần còn lại người dùng bấm "Làm mới" khi cần.
  const statsById = new Map<string, StaffAnnouncementStats>();
  if (canAnnounce) {
    const prefetch = page.announcements.slice(0, STATS_PREFETCH_LIMIT).filter((a) => !a.deleted);
    const results = await Promise.all(
      prefetch.map(async (a) => {
        try {
          return await getAnnouncementReadStats(a.id, userId);
        } catch {
          return null; // thống kê hỏng KHÔNG được làm chết cả trang thông báo
        }
      }),
    );
    for (const s of results) if (s) statsById.set(s.messageId, s);
  }

  return (
    <PanelShell
      basePath={basePath}
      conversationId={conversationId}
      title={`Thông báo · ${title}`}
      subtitle="Mới nhất trước"
    >
      {page.announcements.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          Nhóm này chưa có thông báo nào.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {page.announcements.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
              <span
                aria-hidden
                className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-state-warning-soft text-state-warning-ink"
              >
                <Megaphone className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`whitespace-pre-wrap break-words text-sm ${a.deleted ? "italic text-muted-foreground" : "text-foreground"}`}
                >
                  {a.body}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{timeFmt.format(a.createdAt)}</p>
                {canAnnounce && !a.deleted && (
                  <AnnouncementReadStats messageId={a.id} initial={statsById.get(a.id)} className="mt-2" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {page.hasMore && page.nextCursor && (
        <div className="border-t border-border p-3 text-center">
          <Link
            href={`${basePath}?c=${conversationId}&tab=thong-bao&ac=${encodeURIComponent(page.nextCursor)}`}
            className="text-sm font-medium text-primary underline underline-offset-2"
          >
            Xem thông báo cũ hơn
          </Link>
        </div>
      )}
    </PanelShell>
  );
}
