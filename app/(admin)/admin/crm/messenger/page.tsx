import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ExternalLink, MessageCircle, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { maskPhone, redactContactsInText } from "@/lib/lead/pii";
import { messengerDangMoPhong } from "@/lib/crm/messenger-send";
import { cn } from "@/lib/utils";
import { ReplyBox } from "./_components/reply-box";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messenger CRM | Admin" };

// MESSENGER CRM — hộp thư 2 khung (01/10/2026, chủ dự án chọn thiết kế lại). Bản cũ là một cột
// thẻ, 50 hội thoại, không lọc, chỉ thấy MỘT tin cuối nên không đọc được mạch hội thoại.
// Nay: trái = danh sách có lọc (Chưa trả lời mặc định — đó là việc của người trực), phải =
// cả mạch tin + ô trả lời. Trạng thái nằm trên URL (?c=&loc=&q=) nên không cần JS để chọn,
// tải lại vẫn đúng chỗ, và điện thoại hiện một khung một lúc.
//
// Giữ NGUYÊN hai luật đã vá trước: che PII ở SERVER (SĐT + mẩu liên hệ trong nội dung, Đợt E
// 22/08) và nói thật trạng thái gửi (S-2b: SIMULATED ≠ đã tới khách).

type Loc = "chua-tra-loi" | "tat-ca" | "OPEN" | "QUALIFIED" | "CLOSED";
const LOC: [Loc, string][] = [
  ["chua-tra-loi", "Chưa trả lời"],
  ["tat-ca", "Tất cả"],
  ["OPEN", "Đang mở"],
  ["QUALIFIED", "Đủ điều kiện"],
  ["CLOSED", "Đã đóng"],
];
const NHAN_TRANG_THAI: Record<string, { nhan: string; mau: string }> = {
  OPEN: { nhan: "Đang mở", mau: "bg-state-info-soft text-state-info-ink" },
  QUALIFIED: { nhan: "Đủ điều kiện", mau: "bg-state-success-soft text-state-success-ink" },
  CLOSED: { nhan: "Đã đóng", mau: "bg-muted text-muted-foreground" },
};
const NHAN_GUI: Record<string, { nhan: string; mau: string }> = {
  SIMULATED: { nhan: "Mô phỏng — khách không nhận", mau: "text-state-warning-ink" },
  FAILED: { nhan: "Gửi lỗi", mau: "text-state-danger-ink" },
  PENDING: { nhan: "Chưa rõ đã tới khách", mau: "text-state-warning-ink" },
};

function gio(d: Date): string {
  const hn = new Date();
  const cungNgay = d.toDateString() === hn.toDateString();
  return cungNgay
    ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
    : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

export default async function MessengerInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; loc?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // C3.3 — không có quyền lead/CRM → không vào inbox.
  const [xemTatCa, xemCuaMinh, xemPii, sp] = await Promise.all([
    checkPermission("leads:view-all"),
    checkPermission("leads:view-own"),
    canViewLeadPii(),
    searchParams,
  ]);
  if (!xemTatCa && !xemCuaMinh) redirect("/dashboard");
  const loc: Loc = (LOC.find(([k]) => k === sp.loc)?.[0] ?? "chua-tra-loi") as Loc;
  const q = sp.q?.trim() || undefined;

  const sdb = scopedDb(await resolveActor(session.user.id));
  const hoiThoai = await sdb.messengerConversation.findMany({
    where: {
      ...(loc === "OPEN" || loc === "QUALIFIED" || loc === "CLOSED" ? { status: loc } : {}),
      ...(q
        ? {
            OR: [
              { parentName: { contains: q, mode: "insensitive" } },
              ...(xemPii ? [{ phone: { contains: q } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
  });
  // "Chưa trả lời" = tin CUỐI là tin khách gửi đến. Lọc sau khi đọc vì phải biết tin cuối.
  const danhSach = loc === "chua-tra-loi" ? hoiThoai.filter((c) => c.messages[0]?.direction === "IN") : hoiThoai;
  const soChuaTraLoi = hoiThoai.filter((c) => c.messages[0]?.direction === "IN").length;

  // Hội thoại đang mở: đọc QUA scopedDb theo id ⇒ id ngoài phạm vi trả null (chống IDOR).
  const dangMo = sp.c
    ? await sdb.messengerConversation.findUnique({
        where: { id: sp.c },
        include: { messages: { orderBy: { sentAt: "desc" }, take: 100 } },
      })
    : null;
  const moPhong = dangMo ? await messengerDangMoPhong(dangMo.pageId) : true;

  const noiDung = (t: string | null) => (t ? (xemPii ? t : redactContactsInText(t)) : null);
  const sdt = (p: string | null) => (p ? (xemPii ? p : maskPhone(p)) : null);
  const href = (p: { c?: string | null; loc?: Loc }) => {
    const s = new URLSearchParams();
    const l = p.loc ?? loc;
    if (l !== "chua-tra-loi") s.set("loc", l);
    if (q) s.set("q", q);
    if (p.c) s.set("c", p.c);
    const x = s.toString();
    return x ? `/crm/messenger?${x}` : "/crm/messenger";
  };

  return (
    <div>
      <h1 className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        <MessageCircle className="size-6 text-primary" aria-hidden />
        Messenger CRM
      </h1>

      <div className="grid h-[calc(100dvh-10rem)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-[22rem_minmax(0,1fr)] 2xl:grid-cols-[26rem_minmax(0,1fr)]">
        {/* ── Khung trái: danh sách ── */}
        <section
          aria-label="Hội thoại"
          className={cn("flex min-h-0 flex-col border-border lg:border-r", dangMo ? "hidden lg:flex" : "flex")}
        >
          <div className="space-y-2 border-b border-border p-3">
            <form method="GET">
              {loc !== "chua-tra-loi" && <input type="hidden" name="loc" value={loc} />}
              <label className="relative block">
                <span className="sr-only">Tìm hội thoại</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder={xemPii ? "Tìm tên phụ huynh, SĐT…" : "Tìm tên phụ huynh…"}
                  className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            </form>
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Lọc hội thoại">
              {LOC.map(([k, nhan]) => (
                <Link
                  key={k}
                  href={href({ loc: k })}
                  aria-current={loc === k ? "true" : undefined}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    loc === k ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {nhan}
                  {k === "chua-tra-loi" && soChuaTraLoi > 0 && (
                    <span className="tabular-nums opacity-80">{soChuaTraLoi}</span>
                  )}
                </Link>
              ))}
            </nav>
          </div>

          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {danhSach.length === 0 ? (
              <li className="px-5 py-12 text-center text-sm text-muted-foreground">
                {loc === "chua-tra-loi"
                  ? "Không còn tin nào chờ trả lời."
                  : q
                    ? `Không hội thoại nào khớp “${q}”.`
                    : "Chưa có hội thoại nào trong phạm vi của bạn."}
              </li>
            ) : (
              danhSach.map((c) => {
                const cuoi = c.messages[0];
                const cho = cuoi?.direction === "IN";
                const tt = NHAN_TRANG_THAI[c.status] ?? { nhan: c.status, mau: "bg-muted text-muted-foreground" };
                return (
                  <li key={c.id}>
                    <Link
                      href={href({ c: c.id })}
                      aria-current={dangMo?.id === c.id ? "true" : undefined}
                      className={cn(
                        "block px-4 py-3 transition-colors",
                        dangMo?.id === c.id ? "bg-primary-soft/60" : "hover:bg-muted/60",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("truncate text-sm text-foreground", cho ? "font-semibold" : "font-medium")}>
                          {c.parentName ?? `Khách ${c.psid.slice(0, 6)}`}
                        </p>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {gio(cuoi?.sentAt ?? c.updatedAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {cho && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Chờ trả lời" />}
                        <p className={cn("min-w-0 flex-1 truncate text-xs", cho ? "text-foreground" : "text-muted-foreground")}>
                          {cuoi ? (
                            <>
                              {cuoi.direction === "OUT" && <span className="text-muted-foreground">Bạn: </span>}
                              {noiDung(cuoi.text) ?? "(tệp đính kèm)"}
                            </>
                          ) : (
                            <span className="italic">(chưa có tin nhắn)</span>
                          )}
                        </p>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium", tt.mau)}>
                          {tt.nhan}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {/* ── Khung phải: mạch tin ── */}
        <section aria-label="Nội dung hội thoại" className={cn("min-h-0 flex-col", dangMo ? "flex" : "hidden lg:flex")}>
          {!dangMo ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <MessageCircle className="size-8 opacity-40" aria-hidden />
              {sp.c ? "Hội thoại không tồn tại hoặc ngoài phạm vi của bạn." : "Chọn một hội thoại ở bên trái để đọc và trả lời."}
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Link
                  href={href({ c: null })}
                  className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted lg:hidden"
                  aria-label="Quay lại danh sách"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">
                    {dangMo.parentName ?? `Khách ${dangMo.psid.slice(0, 6)}`}
                  </p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">
                    {[sdt(dangMo.phone), (NHAN_TRANG_THAI[dangMo.status] ?? { nhan: dangMo.status }).nhan]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {dangMo.leadId && (
                  <Link
                    href={`/leads/${dangMo.leadId}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted"
                  >
                    Mở lead <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                )}
              </header>

              {/* flex-col-reverse: mở ra là ở tin MỚI NHẤT mà không cần JS cuộn xuống. */}
              <ol className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto bg-muted/30 px-4 py-4">
                {dangMo.messages.map((m) => {
                  const ra = m.direction === "OUT";
                  const gui = ra && m.sendStatus ? NHAN_GUI[m.sendStatus] : undefined;
                  return (
                    <li key={m.id} className={cn("flex", ra ? "justify-end" : "justify-start")}>
                      <div className="max-w-[80%] sm:max-w-[70%]">
                        <p
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
                            ra ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card text-foreground shadow-sm",
                          )}
                        >
                          {noiDung(m.text) ?? <span className="italic opacity-80">(tệp đính kèm)</span>}
                        </p>
                        <p className={cn("mt-0.5 px-1 text-[11px] tabular-nums text-muted-foreground", ra && "text-right")}>
                          {gio(m.sentAt)}
                          {gui && <span className={cn("ml-1.5 font-medium", gui.mau)}>· {gui.nhan}</span>}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {dangMo.messages.length === 0 && (
                  <li className="m-auto text-sm text-muted-foreground">Chưa có tin nhắn.</li>
                )}
              </ol>

              <div className="border-t border-border p-3">
                <ReplyBox conversationId={dangMo.id} moPhong={moPhong} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
