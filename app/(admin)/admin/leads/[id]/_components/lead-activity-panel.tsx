"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  MessageSquare,
  StickyNote,
  Mail,
  RefreshCw,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Receipt,
  GraduationCap,
  UserCog,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import type { Prisma, LeadStatus } from "@prisma/client";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import {
  docMaViec,
  laDongHeThong,
  NHAN_VIEC,
  type MaViec,
} from "@/lib/lead/tuong-tac/su-kien";
import {
  selectLeadStatusTrail,
  type LeadStatusTrailRow,
} from "@/lib/lead/status-trail";
import {
  LEAD_AUDIT_ACTION_LABEL,
  LEAD_AUDIT_FIELD_LABEL,
  formatLeadAuditFieldValue,
  type LeadAuditRow,
} from "@/lib/lead/audit-history";
import { addLeadActivity } from "../../actions";

type Activity = {
  id: string;
  type: string;
  content: string;
  // LD4 — metadata JSON structured theo loại (CALL/MESSAGE/EMAIL/NOTE). Có thể null
  // với hoạt động cũ hoặc auto-gen (STATUS_CHANGE/HANDOVER) → fallback render `content`.
  metadata?: unknown;
  actorName: string;
  createdAt: string; // ISO
};

// LD6 — prop `tasks` GIỮ optional để AGENT-LEAD-DETAIL gỡ dần ở page.tsx (Wave 2).
// KHÔNG xoá model/dữ liệu LeadTask — chỉ ẩn UI ở panel này.
type Task = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string; // ISO
  status: string;
  assignedToName: string | null;
  completedAt: string | null;
};

const ACTIVITY_ICON: Record<string, typeof Phone> = {
  CALL: Phone,
  MESSAGE: MessageSquare,
  NOTE: StickyNote,
  EMAIL: Mail,
  STATUS_CHANGE: RefreshCw,
  HANDOVER: ArrowLeftRight,
};

/**
 * Biểu tượng cho dòng HỆ THỐNG ghi, chọn theo NHÓM việc (tiền tố của mã).
 *
 * Chọn theo tiền tố chứ không liệt kê 23 mã: thêm một việc mới vào nhóm cũ thì không phải
 * sửa ở đây. Nhãn thì KHÔNG làm vậy — nhãn phải khai từng mã ở `NHAN_VIEC` để `tsc` bắt
 * được việc quên đặt tên, vì một biểu tượng sai chỉ khó nhìn còn một nhãn sai là nói dối.
 */
function bieuTuongViec(m: MaViec): typeof Phone {
  if (m.startsWith("trial.")) return FlaskConical;
  if (m.startsWith("don.") || m === "chuyen-doi") return Receipt;
  if (m.startsWith("ghi-danh.")) return GraduationCap;
  if (m.startsWith("viec.")) return ListChecks;
  return UserCog; // ho-so.sua · con.*
}

const ACTIVITY_LABEL: Record<string, string> = {
  CALL: "Gọi điện",
  MESSAGE: "Nhắn tin",
  NOTE: "Ghi chú",
  EMAIL: "Email",
  STATUS_CHANGE: "Đổi trạng thái",
  HANDOVER: "Bàn giao",
};

// LD4 — chỉ 4 loại ghi tay. STATUS_CHANGE/HANDOVER là auto-gen (đổi trạng thái /
// bàn giao) nên KHÔNG cho tạo tay ở form; vẫn hiển thị trong lịch sử.
const QUICK_TYPES = ["CALL", "MESSAGE", "NOTE", "EMAIL"] as const;
type QuickType = (typeof QUICK_TYPES)[number];

const MESSAGE_PLATFORMS = ["SMS", "Zalo", "Messenger"] as const;
type MessagePlatform = (typeof MESSAGE_PLATFORMS)[number];

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft";

// LD4 — narrow JSON metadata an toàn (object thuần, không phải array/primitive).
function asMetaObj(m: unknown): Record<string, unknown> | null {
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : null;
}
function metaStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// LD4 — render chi tiết theo metadata structured; null → để caller fallback `content`.
function ActivityBody({ activity }: { activity: Activity }) {
  const meta = asMetaObj(activity.metadata);
  if (meta) {
    if (activity.type === "CALL") {
      const caller = metaStr(meta.caller);
      const dur = meta.durationMin;
      const head = [
        caller && `Người gọi: ${caller}`,
        dur != null && dur !== "" && `Thời lượng: ${metaStr(dur)} phút`,
      ].filter(Boolean);
      return (
        <div className="mt-0.5 text-sm text-foreground">
          {head.length > 0 && <p className="text-xs text-muted-foreground">{head.join(" · ")}</p>}
          <p className="whitespace-pre-line">{metaStr(meta.notes)}</p>
        </div>
      );
    }
    if (activity.type === "MESSAGE") {
      return (
        <p className="mt-0.5 text-sm text-foreground">
          {metaStr(meta.platform) && (
            <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {metaStr(meta.platform)}
            </span>
          )}
          <span className="whitespace-pre-line">{metaStr(meta.content)}</span>
        </p>
      );
    }
    if (activity.type === "EMAIL") {
      const recipient = metaStr(meta.recipient);
      const subject = metaStr(meta.subject);
      return (
        <div className="mt-0.5 text-sm text-foreground">
          {(recipient || subject) && (
            <p className="text-xs text-muted-foreground">
              {recipient && <>Đến: {recipient}</>}
              {recipient && subject && " · "}
              {subject && <>Tiêu đề: {subject}</>}
            </p>
          )}
          <p className="whitespace-pre-line">{metaStr(meta.body)}</p>
        </div>
      );
    }
    if (activity.type === "STATUS_CHANGE") {
      // Dòng CŨ trên PROD đã ghi sẵn chuỗi `MOI → DA_LIEN_HE` vào `content`. Không
      // sửa hồi tố được dữ liệu, nhưng `metadata` có `from`/`to` nên dịch được LÚC
      // ĐỌC — người dùng thấy tiếng Việt kể cả với dòng ghi trước ngày vá.
      const tu = metaStr(meta.from);
      const den = metaStr(meta.to);
      if (tu || den) {
        const nhan = (m: string) => LEAD_STATUS_LABEL[m as LeadStatus] ?? m;
        return (
          <p className="mt-0.5 text-sm text-foreground">
            {tu ? nhan(tu) : "—"} <span className="text-muted-foreground">→</span> {den ? nhan(den) : "—"}
            {meta.auto === true && (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                tự động
              </span>
            )}
          </p>
        );
      }
    }
    if (activity.type === "NOTE" && metaStr(meta.text)) {
      return (
        <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{metaStr(meta.text)}</p>
      );
    }
  }
  // Fallback: hoạt động cũ / auto-gen → render chuỗi content.
  return (
    <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{activity.content}</p>
  );
}

function fmtDateTime(iso: string): string {
  // timeZone cố định → SSR (server UTC) và client (TZ trình duyệt) ra CÙNG chuỗi,
  // tránh React #418 (text mismatch khi hydrate). BUG-R7-008.
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LeadActivityPanel({
  leadId,
}: {
  leadId: string;
  // LD6 — nhận nhưng KHÔNG dùng (optional). Để page.tsx ngừng truyền ở Wave 2.
  tasks?: Task[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // LD4 — loại hoạt động đang chọn + state riêng từng loại.
  const [actType, setActType] = useState<QuickType>("CALL");

  // CALL: người gọi + thời lượng + ghi chú
  const [callCaller, setCallCaller] = useState("");
  const [callDuration, setCallDuration] = useState("");
  const [callNotes, setCallNotes] = useState("");
  // MESSAGE: nền tảng + nội dung
  const [msgPlatform, setMsgPlatform] = useState<MessagePlatform>("Zalo");
  const [msgContent, setMsgContent] = useState("");
  // EMAIL: người nhận + tiêu đề + nội dung
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  // NOTE: textarea
  const [noteContent, setNoteContent] = useState("");

  // LD5 — lịch sử mặc định đóng (chỉ render khi mở).
  // 30/08 — MỞ SẴN (chủ dự án chốt). Khối này nay đứng ngay cạnh hồ sơ khách, và
  // thứ người trực lead cần thấy đầu tiên là "đã ai gọi chưa, gọi lúc nào" — đóng lại
  // thì phải bấm thêm một lần cho mọi lượt mở lead.

  function resetForm() {
    setCallCaller("");
    setCallDuration("");
    setCallNotes("");
    setMsgContent("");
    setEmailTo("");
    setEmailSubject("");
    setEmailBody("");
    setNoteContent("");
  }

  // LD4 — gộp các trường riêng từng loại thành `content` để lưu.
  // Phối hợp SPINE: addLeadActivity hiện chỉ nhận { leadId, type, content }; khi
  // SPINE mở thêm tham số `metadata` (JSON) thì truyền object structured xuống đây.
  function buildContent(): string | null {
    if (actType === "CALL") {
      const notes = callNotes.trim();
      if (!notes) return null;
      const head: string[] = [];
      if (callCaller.trim()) head.push(`Người gọi: ${callCaller.trim()}`);
      if (callDuration.trim()) head.push(`Thời lượng: ${callDuration.trim()} phút`);
      return head.length ? `${head.join(" · ")}\n${notes}` : notes;
    }
    if (actType === "MESSAGE") {
      const c = msgContent.trim();
      if (!c) return null;
      return `[${msgPlatform}] ${c}`;
    }
    if (actType === "EMAIL") {
      const body = emailBody.trim();
      if (!body) return null;
      const head: string[] = [];
      if (emailTo.trim()) head.push(`Đến: ${emailTo.trim()}`);
      if (emailSubject.trim()) head.push(`Tiêu đề: ${emailSubject.trim()}`);
      return head.length ? `${head.join("\n")}\n${body}` : body;
    }
    // NOTE
    return noteContent.trim() || null;
  }

  // LD4 — metadata structured theo từng loại, lưu vào LeadActivity.metadata (JSON)
  // song song với `content` (chuỗi đọc cho timeline). Trả null khi thiếu nội dung
  // bắt buộc — đồng bộ với buildContent() để không ghi metadata "rỗng".
  function buildMetadata(): Prisma.InputJsonValue | null {
    if (actType === "CALL") {
      const notes = callNotes.trim();
      if (!notes) return null;
      const dur = callDuration.trim();
      const durationMin = dur && Number.isFinite(Number(dur)) ? Number(dur) : null;
      return { caller: callCaller.trim() || null, durationMin, notes };
    }
    if (actType === "MESSAGE") {
      const content = msgContent.trim();
      if (!content) return null;
      return { platform: msgPlatform, content };
    }
    if (actType === "EMAIL") {
      const body = emailBody.trim();
      if (!body) return null;
      return {
        recipient: emailTo.trim() || null,
        subject: emailSubject.trim() || null,
        body,
      };
    }
    // NOTE
    const text = noteContent.trim();
    if (!text) return null;
    return { text };
  }

  function submitActivity() {
    const content = buildContent();
    if (!content) {
      toast.error("Nhập nội dung hoạt động");
      return;
    }
    const metadata = buildMetadata();
    startTransition(async () => {
      const res = await addLeadActivity({ leadId, type: actType, content, metadata });
      if (res.ok) {
        resetForm();
        // S-9 — nói ra khi ghi chú đã lưu mà mốc SLA không đổi. Báo "Đã ghi"
        // trơn thì người ghi tưởng mình vừa xử lý xong phiếu và bỏ đi.
        if (res.dongHoKhongDoi) {
          toast.success("Đã ghi hoạt động", {
            description:
              "Bạn không phụ trách khách này nên đồng hồ nhắc chăm sóc giữ nguyên — người phụ trách vẫn được nhắc.",
          });
        } else {
          toast.success("Đã ghi hoạt động");
        }
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    // LD6 — bỏ cột "Việc cần làm" → bố cục 1 cột (trước đây lg:grid-cols-3).
    //
    // `@container/panel`: khối này được dùng ở HAI bề ngang rất khác nhau — cột phải
    // 3/10 (~310px) trên desktop, và trọn bề ngang trang khi xếp dọc trên máy hẹp.
    // Bên trong phải đo theo BỀ NGANG CỦA CHÍNH NÓ; hỏi bề ngang cửa sổ thì lúc nào
    // cũng sai một trong hai ca.
    <div className="@container/panel space-y-4">
      {/* LD4 — Ghi nhanh hoạt động theo từng loại */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-bold text-foreground">Ghi nhanh hoạt động</h3>
        <div className="flex flex-wrap gap-2">
          {QUICK_TYPES.map((t) => {
            const Icon = ACTIVITY_ICON[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setActType(t)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${ actType === t ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted" }`}
              >
                <Icon size={14} /> {ACTIVITY_LABEL[t]}
              </button>
            );
          })}
        </div>

        {/* Trường nhập khác nhau theo loại */}
        <div className="mt-3 space-y-2">
          {actType === "CALL" && (
            <>
              {/* Đo theo CONTAINER, không theo cửa sổ. Khối này sống ở hai bề ngang
                  rất khác nhau: cột 3/10 (~310–390px) trên desktop, và trọn bề ngang
                  trang khi xếp dọc. Bản cũ dùng `sm:` (cửa sổ 640px) nên ở 1440px nó
                  vẫn ép 2 cột vào 310px — mỗi ô ~150px và placeholder cụt thành
                  "Thời lượng (ph".

                  Ngưỡng `@md` = 448px chứ không phải `@sm` = 384px: container đo cả
                  `p-4` của thẻ (32px), nên 384px chỉ còn 352px lòng thẻ ⇒ mỗi ô 174px
                  và placeholder LẠI cụt. Đã đo đúng ca đó ở màn 1920 (cột phải 389px).
                  Cần mỗi ô ≥200px ⇒ lòng thẻ ≥410px ⇒ container ≥442px. */}
              <div className="grid gap-2 @md/panel:grid-cols-2">
                <input
                  value={callCaller}
                  onChange={(e) => setCallCaller(e.target.value)}
                  placeholder="Người gọi"
                  className={inputCls}
                />
                <input
                  type="number"
                  min={0}
                  value={callDuration}
                  onChange={(e) => setCallDuration(e.target.value)}
                  placeholder="Thời lượng (phút)"
                  className={inputCls}
                />
              </div>
              <textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={2}
                placeholder="Nội dung trao đổi..."
                className={inputCls}
              />
            </>
          )}

          {actType === "MESSAGE" && (
            <>
              <select
                value={msgPlatform}
                onChange={(e) => setMsgPlatform(e.target.value as MessagePlatform)}
                className={inputCls}
                aria-label="Nền tảng nhắn tin"
              >
                {MESSAGE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <textarea
                value={msgContent}
                onChange={(e) => setMsgContent(e.target.value)}
                rows={2}
                placeholder="Nội dung tin nhắn..."
                className={inputCls}
              />
            </>
          )}

          {actType === "EMAIL" && (
            <>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="Người nhận (email)"
                className={inputCls}
              />
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Tiêu đề"
                className={inputCls}
              />
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={3}
                placeholder="Nội dung email..."
                className={inputCls}
              />
            </>
          )}

          {actType === "NOTE" && (
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              rows={2}
              placeholder="Ghi chú..."
              className={inputCls}
            />
          )}
        </div>

        <button
          type="button"
          onClick={submitActivity}
          disabled={isPending}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          Ghi hoạt động
        </button>
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LỊCH SỬ LEAD — MỘT dòng thời gian duy nhất (chủ dự án chốt 22/09/2026)

   Gộp ba mục vốn nằm rời trên trang: "Lịch sử tương tác của Lead", "Mốc trạng
   thái" (C-07) và "Lịch sử thay đổi" (V-6 · G-02). Ba nguồn dữ liệu khác nhau,
   nhưng người mở trang chỉ có MỘT câu hỏi: phiếu này đã xảy ra chuyện gì, theo
   thứ tự nào. Ba hộp rời bắt họ tự trộn ba dòng thời gian trong đầu — và hai
   trong ba hộp nằm tít cuối trang nên thực tế không ai đối chiếu.

   🔴 KHỬ TRÙNG — ĐỪNG GỠ. Mỗi lượt đổi trạng thái ghi vào HAI chỗ: một
   `LeadActivity` kiểu STATUS_CHANGE (xem `status-trail-write.ts`) và một vết
   trong AuditLog. Trộn thẳng là mỗi lượt đổi hiện HAI dòng liền nhau, cùng giờ,
   cùng người — trông như lỗi dữ liệu.
     · Có quyền đọc vết (`showAudit`) → BỎ bản LeadActivity, giữ bản vết: nó
       giàu hơn (từ → đến, nguồn, tên con, lý do).
     · Không có quyền → GIỮ bản LeadActivity, để người xem vẫn thấy đã có lượt
       đổi xảy ra thay vì một khoảng trống không giải thích.

   Che PII làm ở SERVER trước khi tới đây (`page.tsx` truyền bản đã che).
   Component này KHÔNG tự đọc dữ liệu nào và KHÔNG so vai.
   ═══════════════════════════════════════════════════════════════════════════ */

type MucLichSu =
  | { loai: "HOAT_DONG"; id: string; at: string; hd: Activity }
  | { loai: "TRANG_THAI"; id: string; at: string; tt: LeadStatusTrailRow }
  | { loai: "SUA_HO_SO"; id: string; at: string; sh: LeadAuditRow };

const NHAN_LOAI: Record<MucLichSu["loai"], string> = {
  HOAT_DONG: "Tương tác",
  TRANG_THAI: "Trạng thái",
  SUA_HO_SO: "Sửa hồ sơ",
};

function VienLoai({ loai }: { loai: MucLichSu["loai"] }) {
  const mau =
    loai === "TRANG_THAI"
      ? "bg-state-info-soft text-state-info-ink"
      : loai === "SUA_HO_SO"
        ? "bg-state-warning-soft text-state-warning-ink"
        : "bg-muted text-muted-foreground";
  return (
    <span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " + mau}>
      {NHAN_LOAI[loai]}
    </span>
  );
}

/** Một mốc đổi trạng thái: từ → đến, kèm nguồn và lý do nếu có. */
function DongTrangThai({ r }: { r: LeadStatusTrailRow }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{r.fromLabel ?? "Chưa có"}</span>
        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-semibold text-foreground">{r.toLabel}</span>
        {r.isChild && (
          <span className="rounded-full bg-state-info-soft px-2 py-0.5 text-[11px] font-semibold text-state-info-ink">
            Học sinh{r.childName ? ": " + r.childName : ""}
          </span>
        )}
      </div>
      {r.sourceLabel && <p className="mt-0.5 text-xs text-muted-foreground">{r.sourceLabel}</p>}
      {r.reason && <p className="mt-0.5 text-xs text-muted-foreground">Lý do: {r.reason}</p>}
    </>
  );
}

/** Một vết sửa hồ sơ: liệt kê từng ô đổi, cũ gạch ngang → mới in đậm. */
function DongSuaHoSo({ r }: { r: LeadAuditRow }) {
  return (
    <>
      {r.changedFields.length > 0 ? (
        <ul className="space-y-1">
          {r.changedFields.map((f) => (
            <li key={f} className="text-sm text-foreground">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {LEAD_AUDIT_FIELD_LABEL[f] ?? f}
              </span>
              <span className="ml-2 break-words text-muted-foreground line-through">
                {formatLeadAuditFieldValue(f, r.oldValues?.[f])}
              </span>
              <span className="mx-1 text-muted-foreground">→</span>
              <span className="break-words font-medium">
                {formatLeadAuditFieldValue(f, r.newValues?.[f])}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {LEAD_AUDIT_ACTION_LABEL[r.action] ?? r.action}
        </p>
      )}
      {r.reason && <p className="mt-0.5 text-xs text-muted-foreground">Lý do: {r.reason}</p>}
    </>
  );
}

export function LichSuLead({
  activities,
  statusRows,
  auditRows,
  showAudit,
  piiMasked,
}: {
  activities: Activity[];
  /** Vết ĐỔI TRẠNG THÁI — truy vấn riêng, đã che PII ở server. */
  statusRows: LeadAuditRow[];
  /** Vết SỬA HỒ SƠ — đã che PII ở server. */
  auditRows: LeadAuditRow[];
  /** Người xem có quyền đọc vết không (`canViewLeadAuditHistory`). */
  showAudit: boolean;
  piiMasked: boolean;
}) {
  const [moRong, setMoRong] = useState(true);

  const moc = showAudit ? selectLeadStatusTrail(statusRows) : [];

  const muc: MucLichSu[] = [
    ...activities
      // Khử trùng — xem khối chú thích đầu mục.
      .filter((a) => !(showAudit && a.type === "STATUS_CHANGE"))
      .map((a) => ({ loai: "HOAT_DONG" as const, id: "hd:" + a.id, at: a.createdAt, hd: a })),
    ...moc.map((r) => ({ loai: "TRANG_THAI" as const, id: "tt:" + r.id, at: r.createdAt, tt: r })),
    ...(showAudit ? auditRows : []).map((r) => ({
      loai: "SUA_HO_SO" as const,
      id: "sh:" + r.id,
      at: r.createdAt,
      sh: r,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setMoRong((v) => !v)}
        aria-expanded={moRong}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-bold text-foreground"
      >
        <span>
          Lịch sử ({muc.length})
          {!showAudit && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · chỉ tương tác — bạn không có quyền đọc vết sửa hồ sơ
            </span>
          )}
          {piiMasked && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · thông tin cá nhân đã che
            </span>
          )}
        </span>
        {moRong ? (
          <ChevronDown size={16} className="flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {moRong &&
        (muc.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa ghi nhận gì trên hồ sơ này.
          </p>
        ) : (
          <ol className="mt-3 space-y-3">
            {muc.map((m) => {
              // Bản hoạt động của mục này (null nếu mục là trạng thái / sửa hồ sơ).
              // Đặt tên `a` có chủ đích: phần nhận dạng dòng hệ thống bên dưới đọc y
              // hệt bản trước khi gộp, và [GHI-13] ghim đúng hai lời gọi đó.
              const a = m.loai === "HOAT_DONG" ? m.hd : null;
              const maViec = a ? docMaViec(a.metadata) : null;
              const tuDong = a ? laDongHeThong(a.metadata) : false;
              const Icon =
                m.loai === "TRANG_THAI"
                  ? RefreshCw
                  : m.loai === "SUA_HO_SO"
                    ? UserCog
                    : maViec
                      ? bieuTuongViec(maViec)
                      : (ACTIVITY_ICON[m.hd.type] ?? StickyNote);
              const tieuDe =
                m.loai === "TRANG_THAI"
                  ? "Đổi trạng thái"
                  : m.loai === "SUA_HO_SO"
                    ? (LEAD_AUDIT_ACTION_LABEL[m.sh.action] ?? m.sh.action)
                    : maViec
                      ? NHAN_VIEC[maViec]
                      : (ACTIVITY_LABEL[m.hd.type] ?? m.hd.type);
              const nguoi =
                m.loai === "TRANG_THAI"
                  ? m.tt.actorName
                  : m.loai === "SUA_HO_SO"
                    ? m.sh.actorName
                    : m.hd.actorName;

              return (
                <li key={m.id} className="flex gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs font-bold text-foreground">{tieuDe}</span>
                      <VienLoai loai={m.loai} />
                      {m.loai === "SUA_HO_SO" && m.sh.touchesIdentity && (
                        <span className="rounded-full bg-state-warning-soft px-2 py-0.5 text-[11px] font-semibold text-state-warning-ink">
                          Ô định danh
                        </span>
                      )}
                      {tuDong && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          tự động
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {nguoi} · {fmtDateTime(m.at)}
                      </span>
                    </div>
                    <div className="mt-1">
                      {m.loai === "HOAT_DONG" ? (
                        <ActivityBody activity={m.hd} />
                      ) : m.loai === "TRANG_THAI" ? (
                        <DongTrangThai r={m.tt} />
                      ) : (
                        <DongSuaHoSo r={m.sh} />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ))}
    </section>
  );
}
