import Link from "next/link";
import {
  CalendarPlus,
  TriangleAlert,
  Clock,
  CircleCheck,
  CalendarSearch,
  History,
  ShieldCheck,
  Send,
} from "lucide-react";
import type { ParentRequestType, ParentRequestStatus } from "@prisma/client";
import type { StudentMakeup, MakeupItem, ChiTietBuoiBu } from "@/lib/portal/makeup";
import { PageHero, HeroMetric } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import {
  REQUEST_TYPE_LABEL,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_BADGE,
} from "@/lib/portal/request-labels";
import { RequestForm } from "@/app/(portal)/portal/yeu-cau/_components/request-form";
import { CancelButton } from "@/app/(portal)/portal/yeu-cau/_components/cancel-button";

export type RequestRow = {
  id: string;
  type: ParentRequestType;
  status: ParentRequestStatus;
  content: string;
  preferredDate: string | null;
  response: string | null;
  createdAt: string;
};

// ClassSession.date lưu WALL-CLOCK theo TZ server (lib/classes/generate.ts) →
// missedDate/preferredDate format theo TZ server (KHÔNG ép VN, kẻo buổi tối lệch +1 ngày).
function dmy(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// createdAt là INSTANT thật → phải quy về giờ VN (Vercel = UTC, nếu không yêu cầu
// gửi 00:00–07:00 giờ VN hiển thị lùi 1 ngày — convention VN_TZ như hoc-phi-page).
function dmyVN(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

const STATUS: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: "Đã xếp buổi bù", cls: "bg-info/10 text-info" },
  COMPLETED: { label: "Đã học bù", cls: "bg-success/10 text-success" },
  CANCELLED: { label: "Đã huỷ", cls: "bg-muted text-muted-foreground" },
  PENDING: { label: "Chờ xếp buổi", cls: "bg-caution/10 text-caution" },
};

export function YeuCauPageV2({
  kids,
  activeId,
  studentName,
  data,
  prefillNeedId,
  upcomingSessions,
  requests,
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  studentName: string;
  data: StudentMakeup;
  /** ?bu=<makeupNeedId> — CTA "Gửi yêu cầu học bù" → prefill form Xin học bù. */
  prefillNeedId?: string | null;
  upcomingSessions: { id: string; label: string }[];
  requests: RequestRow[];
}) {
  // Chỉ nhận id có trong needList của ĐÚNG con đang chọn (đã ownership-scoped).
  const prefillNeed = prefillNeedId
    ? data.needList.find((m) => m.id === prefillNeedId)
    : undefined;
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={CalendarPlus}
        overline="Cổng phụ huynh"
        title="Yêu cầu học bù"
        subtitle={`${studentName} · Báo trung tâm muốn học bù cho buổi con đã vắng — trung tâm sẽ xếp một buổi dạy bù riêng và báo ngày giờ ngay trên trang này.`}
        metric={
          <HeroMetric label="Cần học bù" value={String(data.needCount)} />
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          icon={TriangleAlert}
          tone="caution"
          value={data.needCount}
          label="Buổi cần học bù"
        />
        {/* pendingCount = MakeupNeed SCHEDULED → nhãn phải khớp badge "Đã xếp buổi bù"
            trong Lịch sử (không phải "Đang chờ duyệt" — SCHEDULED là đã duyệt/đã xếp). */}
        <Stat
          icon={Clock}
          tone="info"
          value={data.pendingCount}
          label="Đã xếp buổi bù"
        />
        <Stat
          icon={CircleCheck}
          tone="success"
          value={data.doneCount}
          label="Đã học bù"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Buổi cần học bù
            </h2>
            {data.needList.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">
                <CircleCheck className="size-5 shrink-0" /> Không có buổi nào
                cần học bù.
              </div>
            ) : (
              data.needList.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-caution/30 bg-caution/5 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-caution/15 text-caution">
                      <TriangleAlert className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {m.lessonTitle}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        Vắng ngày {dmy(m.missedDate)} · {m.reason}
                      </p>
                    </div>
                  </div>
                  {/* Server Component — CTA điều hướng ?bu=<needId>#gui-yeu-cau: page đọc
                      query param → form bên dưới prefill "Xin học bù" + nội dung buổi vắng.
                      T11: đã có đơn mở cho buổi này thì KHÔNG bày nút gửi thêm (server cũng từ chối) — nói rõ trung tâm đang xử lý. */}
                  {m.yeuCauMo ? (
                    <span className="inline-flex items-center gap-2 rounded-xl bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground">
                      <Clock className="size-4" /> Đã gửi yêu cầu — trung tâm đang xử lý
                    </span>
                  ) : (
                    <Link
                      href={`/portal/yeu-cau?bu=${m.id}#gui-yeu-cau`}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      <CalendarSearch className="size-4" /> Gửi yêu cầu học bù
                    </Link>
                  )}
                  {/* Đã từng được xếp nhưng chưa xong (vắng buổi bù / chưa hoàn thành bài) — nói thẳng để phụ huynh hiểu vì sao còn nợ. */}
                  {m.ketQua.lichSu.length > 0 && (
                    <div className="basis-full space-y-1">
                      {m.ketQua.lichSu.map((l, i) => (
                        <LanTruoc key={i} ct={l} />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <History className="size-4 text-primary" /> Lịch sử yêu cầu học bù
            </h2>
            {data.history.length === 0 ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Chưa có lịch sử học bù.
              </p>
            ) : (
              <div className="space-y-3">
                {data.history.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {m.lessonTitle}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        Lớp {m.className.replace(/^Lớp\s+/i, "")}
                        {m.centerName ? ` · ${m.centerName}` : ""} ·{" "}
                        {dmy(m.missedDate)}
                      </p>
                      {/* 06/09 — NGÀY BÙ. Trước đây portal chỉ hiện trạng thái "Đã xếp
                          lịch" mà không nói bù ngày nào, lớp nào, nên phụ huynh vẫn
                          phải gọi điện hỏi trung tâm. `MakeupNeed.makeupSessionId` vốn
                          đã có sẵn dữ liệu, chỉ là chưa ai đọc. */}
                      {m.buoiBu && (
                        <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-success/10 px-2 py-1 text-xs font-semibold text-success">
                          Học bù: {m.buoiBu.nhanNgay}
                          {m.buoiBu.className ? ` · Lớp ${m.buoiBu.className}` : ""}
                        </p>
                      )}
                      {/* T11 — buổi dạy bù theo case (ngày, giờ, cơ sở, phòng, giáo viên, bài, đánh giá). Luồng cũ (`buoiBu`) giữ cho dòng cũ. */}
                      {m.ketQua.hienTai && <ChiTietLan ct={m.ketQua.hienTai} xong={m.ketQua.trangThai === "DA_BU"} />}
                      {m.ketQua.trangThai !== "DA_BU" &&
                        m.ketQua.lichSu
                          .filter((l) => l.loai !== "DA_XEP")
                          .map((l, i) => <LanTruoc key={i} ct={l} />)}
                      {m.ketQua.trangThai === "DA_HUY_KHONG_BU" && (
                        <p className="mt-1 text-xs font-medium text-muted-foreground">Trung tâm đã huỷ — không bù buổi này.</p>
                      )}
                    </div>
                    <Badge status={m.status} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Gửi yêu cầu mới (báo vắng / học bù / chuyển lớp / bảo lưu) — giữ đủ chức năng v1. */}
          <section id="gui-yeu-cau" className="scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <Send className="size-4 text-primary" /> Gửi yêu cầu mới
            </h2>
            {/* key theo needId — client navigation cùng route không remount, không có key
                thì initialType/initialContent (useState initializer) không áp dụng lại. */}
            <RequestForm
              key={prefillNeed?.id ?? "default"}
              upcomingSessions={upcomingSessions}
              initialType={prefillNeed ? "MAKEUP" : undefined}
              makeupNeedId={prefillNeed?.id}
              initialContent={
                prefillNeed
                  ? `Xin học bù buổi "${prefillNeed.lessonTitle}" (vắng ngày ${dmy(prefillNeed.missedDate)})`
                  : undefined
              }
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Yêu cầu đã gửi
            </h2>
            {requests.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Chưa có yêu cầu nào.
              </p>
            ) : (
              <div className="space-y-3">
                {requests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">
                        {REQUEST_TYPE_LABEL[r.type]}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REQUEST_STATUS_BADGE[r.status]}`}
                      >
                        {REQUEST_STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {r.content}
                    </p>
                    {r.preferredDate && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ngày: {dmy(r.preferredDate)}
                      </p>
                    )}
                    {r.response && (
                      <p className="mt-2 rounded-lg bg-muted p-2 text-sm text-muted-foreground">
                        Phản hồi: {r.response}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {dmyVN(r.createdAt)}
                      </span>
                      {r.status === "PENDING" && <CancelButton id={r.id} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="size-4 text-primary" /> Chính sách học bù
          </p>
          <ul className="space-y-2 text-xs font-medium text-muted-foreground">
            <li>• Trung tâm xếp một <b className="text-foreground">buổi dạy bù riêng</b> cho đúng nội dung buổi con đã vắng — một buổi có thể gồm nhiều bài.</li>
            <li>• Buổi bù diễn ra tại <b className="text-foreground">cơ sở của con</b>; ngày, giờ, phòng và giáo viên hiện ngay trên trang này khi được xếp.</li>
            <li>• Gửi yêu cầu chỉ để báo trung tâm là con muốn học bù — <b className="text-foreground">trung tâm là bên xếp lịch</b>, phụ huynh không cần chọn buổi.</li>
            <li>• Sau buổi bù, từng bài được ghi nhận <b className="text-foreground">đã xong hay chưa xong</b> kèm đánh giá của giáo viên.</li>
          </ul>
          {data.centerName && (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Cơ sở của {studentName.split(" ").slice(-1)[0]}:{" "}
              <b className="text-foreground">{data.centerName}</b>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof Clock;
  tone: "caution" | "info" | "success";
  value: number;
  label: string;
}) {
  const box =
    tone === "caution"
      ? "bg-caution/10 text-caution"
      : tone === "info"
        ? "bg-info/10 text-info"
        : "bg-success/10 text-success";
  const val =
    tone === "caution"
      ? "text-caution"
      : tone === "info"
        ? "text-info"
        : "text-success";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${box}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className={`text-2xl font-bold tabular-nums ${val}`}>{value}</p>
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}

function Badge({ status }: { status: MakeupItem["status"] }) {
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span
      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** Chi tiết MỘT buổi dạy bù: ngày · giờ · cơ sở · phòng · giáo viên · bài · đánh giá của giáo viên cho bài đó. */
function ChiTietLan({ ct, xong }: { ct: ChiTietBuoiBu; xong: boolean }) {
  return (
    <div className={`mt-1 space-y-0.5 rounded-lg px-2 py-1.5 text-xs ${xong ? "bg-success/10 text-success" : "bg-info/10 text-info"}`}>
      <p className="font-semibold">
        {xong ? "Đã học bù" : "Lịch học bù"}: {ct.ngay} · {ct.gio}
        {ct.coSo ? ` · ${ct.coSo}` : ""}
        {ct.phong ? ` · ${ct.phong}` : ""}
      </p>
      {(ct.giaoVien || ct.bai) && (
        <p className="font-medium">
          {ct.bai ? `Bài: ${ct.bai}` : ""}
          {ct.bai && ct.giaoVien ? " · " : ""}
          {ct.giaoVien ? `Giáo viên: ${ct.giaoVien}` : ""}
        </p>
      )}
      {ct.danhGia && <p className="font-medium italic">Đánh giá: “{ct.danhGia}”</p>}
    </div>
  );
}

/** Một lần học bù KHÔNG thành công — vắng buổi bù hoặc chưa hoàn thành bài — để phụ huynh hiểu vì sao buổi vắng còn nợ. */
function LanTruoc({ ct }: { ct: ChiTietBuoiBu }) {
  const lyDo =
    ct.loai === "VANG_BUOI_BU"
      ? "con vắng buổi học bù"
      : ct.loai === "CHUA_XONG"
        ? "con có mặt nhưng chưa hoàn thành bài này"
        : ct.loai === "DA_XEP"
          ? "đã xếp lịch"
          : null;
  if (!lyDo) return null;
  return (
    <p className="mt-1 text-xs font-medium text-muted-foreground">
      Lần học bù ngày {ct.ngay} ({ct.gio}): {lyDo}
      {ct.loai === "CHUA_XONG" && ct.danhGia ? ` — “${ct.danhGia}”` : ""}.
    </p>
  );
}
