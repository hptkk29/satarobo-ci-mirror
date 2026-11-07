// US-16 AC2 — CỔNG CHÍNH SÁCH của toàn bộ `/portal/tin-nhan/**`.
//
// Vì sao đặt ở layout của segment (file này) chứ không ở `portal/layout.tsx`: cổng chỉ
// được chắn TRƯỚC CỬA CHAT, không chắn cả cổng phụ huynh (học phí, học bạ, lịch học không
// liên quan gì tới chính sách chat). Layout này bọc danh sách hội thoại, luồng tin, danh
// sách thành viên và trang thông báo — không phải nhớ thêm chỗ nào khi có route con mới.
//
// ⚠️ Đây KHÔNG phải "ẩn UI": khi chưa đồng ý, `children` không bao giờ được đưa vào cây
// React ⇒ page RSC bên dưới KHÔNG chạy ⇒ không một truy vấn nội dung nào được thực hiện.
// Dù vậy MỖI page vẫn tự kiểm lại một lần (defense-in-depth): layout là quy ước của
// framework, còn "server không trả nội dung" là bất biến bảo mật — không gửi nó đi nhờ.
//
// Thiết kế lại theo artifact Tin-nhan.dc.html: layout dựng KHUNG 2 CỘT (danh sách bên trái). Danh sách chỉ được đọc SAU khi
// `hasAcceptedChatPolicy` đã đúng — nhánh chưa đồng ý trả cổng chính sách và không chạm truy vấn nội dung nào.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { chanKhiOCheDoHocSinh } from "@/lib/portal/session";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { listConversationsForUser } from "@/lib/chat/queries";
import { listSalesForParent } from "@/lib/chat/dm";
import { OpenDmButton } from "@/components/chat/open-dm-button";
import { ChatListRefresher } from "@/components/chat/chat-list-refresher";
import { formatConversationTime } from "@/components/chat/portal/format";
import { DongHoiThoai, TinNhanKhung } from "@/components/portal/tin-nhan-khung";
import { chuVietTat, vaiTroHoiThoai } from "@/lib/portal/tin-nhan-thuan";
import { ChatPolicyGate } from "./_components/policy-gate";

export const dynamic = "force-dynamic";

export default async function PortalMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Cổng học sinh: tin nhắn của ba mẹ với trung tâm KHÔNG được con xem.
  await chanKhiOCheDoHocSinh();

  if (!(await hasAcceptedChatPolicy(session.user.id))) return <ChatPolicyGate />;

  const [conversations, sales] = await Promise.all([
    listConversationsForUser(session.user.id),
    // F5 — tư vấn viên đang phụ trách phụ huynh này (một PH nhiều con ⇒ có thể nhiều sale).
    listSalesForParent(session.user.id),
  ]);
  // AC4 — ARCHIVED xuống dưới; trong mỗi khối giữ NGUYÊN thứ tự của query.
  const dong = [...conversations.filter((c) => !c.isArchived), ...conversations.filter((c) => c.isArchived)];
  const now = new Date();

  return (
    <TinNhanKhung
      danhSach={
        <>
          {/* Tin mới ở nhóm bất kỳ ⇒ chạy lại RSC này ⇒ nhóm đó lên đầu, đổi preview + giờ + badge. Không render gì. */}
          <ChatListRefresher userId={session.user.id} />
          {dong.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-[var(--sr-ink-muted)]">
              Chưa có hội thoại nào. Nhóm lớp sẽ xuất hiện ở đây khi lớp của con bắt đầu hoạt động.
            </p>
          ) : (
            dong.map((c) => (
              <DongHoiThoai
                key={c.conversationId}
                id={c.conversationId}
                ten={c.displayName}
                vaiTro={c.statusLabel ?? vaiTroHoiThoai(c.type)}
                xemTruoc={c.lastMessage ? c.lastMessage.text : "Chưa có tin nhắn nào"}
                gio={c.lastMessageAt ? formatConversationTime(c.lastMessageAt, now) : null}
                chuaDoc={c.unreadCount}
                daXoa={!!c.lastMessage?.deleted}
                luuTru={c.isArchived}
                nhan={chuVietTat(c.type, c.displayName)}
              />
            ))
          )}
          {sales.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <div className="text-xs font-bold tracking-[0.06em] text-[var(--sr-ink-muted)]">TƯ VẤN VIÊN PHỤ TRÁCH</div>
              {sales.map((s) => (
                <div key={s.saleUserId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--sr-tint-purple)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{s.saleName ?? "Tư vấn viên"}</p>
                    {s.childNames.length > 0 ? (
                      <p className="truncate text-xs text-[var(--sr-ink-muted)]">Phụ trách: {s.childNames.join(" · ")}</p>
                    ) : null}
                  </div>
                  {/* `openDmAction` là Server Action DUY NHẤT không đi qua `chatPolicyBlock` — nằm sau cổng chính sách ở layout này. */}
                  <OpenDmButton peerUserId={s.saleUserId} kind="SALE_PARENT" hrefTemplate="/portal/tin-nhan/:id" label="Nhắn riêng" />
                </div>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      {children}
    </TinNhanKhung>
  );
}
