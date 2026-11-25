"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  Check,
  CirclePause,
  MapPin,
  MessageSquareText,
  Repeat,
  ImageOff,
  Shuffle,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { REQUEST_TYPE_LABEL, nhanTrangThaiYeuCau } from "@/lib/portal/request-labels";
import type { ParentRequestType, ParentRequestStatus } from "@prisma/client";
import { handleParentRequest, resolveAbsence } from "../actions";

// MỘT yêu cầu của phụ huynh (13/11/2026 — thiết kế lại). Mọi chuỗi ngày/giờ do SERVER định dạng theo lịch VN (`lib/portal/yeu-cau-hien-thi.ts`): thẻ này chỉ vẽ.
// Việc của nhân viên nằm ở chân thẻ và CHỈ có hai quyết định rõ nghĩa: Tiếp nhận / Từ chối (riêng học bù: Xếp học bù → sang màn Học bù, hộp xếp mở sẵn).

export type RequestItem = {
  id: string;
  studentId: string;
  /** C12 — hồ sơ bảo lưu đã lập từ yêu cầu này (null = chưa). */
  reserveId: string | null;
  /** C12 — hiện nút "Lập hồ sơ bảo lưu": yêu cầu RESERVE còn chờ + cơ sở của học viên đã BẬT bảo lưu + người xem có `bao-luu:create`. Server tính, component không tự suy quyền. */
  baoLuuLapDuoc: boolean;
  type: ParentRequestType;
  status: ParentRequestStatus;
  content: string;
  response: string | null;
  handledByName: string | null;
  parentName: string | null;
  studentName: string;
  studentCode: string | null;
  className: string | null;
  /** Đã định dạng: `13/11/2026 08:13`. */
  guiLuc: string;
  /** Báo vắng: buổi xin nghỉ (`Thứ Sáu, 14/11/2026 · 18:00`). Học bù: buổi con đã vắng. */
  buoiGoc: string | null;
  /** Học bù: ngày giờ phụ huynh ĐỀ XUẤT. */
  deXuatBu: string | null;
  urgency: "URGENT" | "ON_TIME" | null;
  /** Báo vắng gắn buổi cụ thể ⇒ "Tiếp nhận" tự ghi vắng có phép. Không gắn buổi ⇒ chỉ duyệt/từ chối tay. */
  tiepNhanDuoc: boolean;
  /** Id dòng cần bù còn CHỜ XẾP của yêu cầu này, CHỈ khi người xem có quyền xếp. Có ⇒ hiện liên kết "Xếp học bù". */
  needXep: string | null;
};

const ICON: Record<ParentRequestType, { Icon: LucideIcon; nen: string }> = {
  ABSENCE: { Icon: CalendarX2, nen: "bg-[color:var(--state-info-soft)] text-[color:var(--state-info)]" },
  MAKEUP: { Icon: Repeat, nen: "bg-[color:var(--primary-soft)] text-[color:var(--primary)]" },
  TRANSFER_CLASS: { Icon: Shuffle, nen: "bg-[color:var(--state-success-soft)] text-[color:var(--state-success)]" },
  TRANSFER_CENTER: { Icon: MapPin, nen: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]" },
  RESERVE: { Icon: CirclePause, nen: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]" },
  CONSENT_CHANGE: { Icon: ImageOff, nen: "bg-muted text-muted-foreground" },
  OTHER: { Icon: MessageSquareText, nen: "bg-muted text-muted-foreground" },
};

const TONE: Record<ParentRequestStatus, PillTone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "muted" };

const NUT_NHO = "min-h-11 sm:min-h-9";

export function RequestCard({ item }: { item: RequestItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ghiChu, setGhiChu] = useState("");
  const [moGhiChu, setMoGhiChu] = useState(false);

  const { Icon, nen } = ICON[item.type];
  const choXuLy = item.status === "PENDING";
  const ghiChuGui = ghiChu.trim() || null;

  function xong(thongBao: string) {
    toast.success(thongBao);
    setMoGhiChu(false);
    setGhiChu("");
    router.refresh();
  }

  function quyetDinh(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      const r = await handleParentRequest({ id: item.id, decision, response: ghiChuGui });
      if (r.ok) xong(decision === "APPROVED" ? "Đã duyệt yêu cầu" : "Đã từ chối yêu cầu");
      else toast.error(r.error ?? "Chưa xử lý được");
    });
  }

  function tiepNhanNghi() {
    startTransition(async () => {
      const r = await resolveAbsence({ requestId: item.id, action: "TIEP_NHAN", response: ghiChuGui });
      if (r.ok) xong("Đã tiếp nhận — buổi học được ghi vắng có phép");
      else toast.error(r.error ?? "Chưa xử lý được");
    });
  }

  const nutDuyet = item.type === "ABSENCE" && item.tiepNhanDuoc ? tiepNhanNghi : () => quyetDinh("APPROVED");
  const nhanDuyet = item.type === "ABSENCE" && item.tiepNhanDuoc ? "Tiếp nhận" : item.type === "RESERVE" ? "Đánh dấu đã xử lý" : "Duyệt";

  return (
    <article className="rounded-xl border border-border bg-card" aria-label={`${REQUEST_TYPE_LABEL[item.type]} — ${item.studentName}`}>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <header className="flex items-start gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${nen}`} aria-hidden="true">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-semibold text-foreground">{REQUEST_TYPE_LABEL[item.type]}</h3>
              {item.type === "ABSENCE" && item.urgency === "URGENT" && <StatusPill tone="danger">Gấp</StatusPill>}
            </div>
            <p className="mt-0.5 break-words text-sm text-foreground">
              <span className="font-medium">{item.studentName}</span>
              {item.studentCode ? <span className="whitespace-nowrap text-muted-foreground"> · {item.studentCode}</span> : null}
            </p>
            {item.className ? <p className="break-words text-sm text-muted-foreground">Lớp {item.className}</p> : null}
          </div>
          <StatusPill tone={TONE[item.status]}>{nhanTrangThaiYeuCau(item)}</StatusPill>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          <dl className="grid content-start gap-2 text-sm">
            {item.buoiGoc ? (
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{item.type === "MAKEUP" ? "Buổi con đã vắng" : "Buổi xin nghỉ"}</dt>
                  <dd className="break-words font-medium text-foreground">{item.buoiGoc}</dd>
                </div>
              </div>
            ) : null}
            {item.deXuatBu ? (
              <div className="flex items-start gap-2">
                <Repeat className="mt-0.5 size-4 shrink-0 text-[color:var(--primary)]" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Phụ huynh đề xuất bù</dt>
                  <dd className="break-words font-semibold text-foreground">{item.deXuatBu}</dd>
                </div>
              </div>
            ) : null}
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Phụ huynh</dt>
              <dd className="break-words text-foreground">
                {item.parentName ?? "—"} <span className="text-muted-foreground">· gửi {item.guiLuc}</span>
              </dd>
            </div>
          </dl>

          <div className="min-w-0 rounded-lg bg-muted px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Phụ huynh viết</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{item.content}</p>
          </div>
        </div>

        {item.response ? (
          <p className="break-words rounded-lg bg-[color:var(--state-success-soft)] px-3 py-2 text-sm text-foreground">
            <span className="font-medium">Trung tâm đã ghi:</span> {item.response}
            {item.handledByName ? <span className="text-muted-foreground"> — {item.handledByName}</span> : null}
          </p>
        ) : null}

        {item.reserveId ? (
          <Link href={`/bao-luu/${item.reserveId}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline sm:min-h-9">
            <CirclePause className="size-4" aria-hidden="true" /> Xem hồ sơ bảo lưu đã lập
          </Link>
        ) : null}

        {item.baoLuuLapDuoc ? (
          <div className="rounded-lg bg-[color:var(--state-warning-soft)] px-3 py-2.5 text-sm text-foreground">
            <p>Phụ huynh xin bảo lưu — cần lập hồ sơ (đơn đã ký, lý do) để Quản lý cơ sở duyệt. &quot;Đánh dấu đã xử lý&quot; KHÔNG tạo hồ sơ bảo lưu.</p>
            <Link
              href={`/bao-luu/moi?studentId=${item.studentId}&parentRequestId=${item.id}`}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-9"
            >
              <CirclePause className="size-4" aria-hidden="true" /> Lập hồ sơ bảo lưu
            </Link>
          </div>
        ) : null}
      </div>

      {choXuLy || item.needXep ? (
        <footer className="flex flex-col gap-3 border-t border-border p-4 sm:px-5">
          {choXuLy && moGhiChu ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
              Ghi chú gửi phụ huynh (không bắt buộc)
              <Textarea value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={2} maxLength={2000} placeholder="Ví dụ: Trung tâm đã ghi nhận, con nghỉ có phép." />
            </label>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {item.needXep ? (
              <Button asChild className={NUT_NHO} variant={choXuLy && item.type === "MAKEUP" ? "default" : "outline"}>
                <Link href={`/hoc-bu?xep=${encodeURIComponent(item.needXep)}`}>
                  <Repeat aria-hidden="true" /> Xếp học bù <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}

            {choXuLy && !(item.type === "MAKEUP" && item.needXep) ? (
              <Button type="button" className={NUT_NHO} disabled={pending} onClick={nutDuyet}>
                <Check aria-hidden="true" /> {pending ? "Đang xử lý…" : nhanDuyet}
              </Button>
            ) : null}

            {choXuLy ? (
              <Button type="button" variant="outline" className={`${NUT_NHO} text-[color:var(--state-danger-ink)]`} disabled={pending} onClick={() => quyetDinh("REJECTED")}>
                <X aria-hidden="true" /> Từ chối
              </Button>
            ) : null}

            {choXuLy ? (
              <Button type="button" variant="ghost" className={`${NUT_NHO} sm:ml-auto`} onClick={() => setMoGhiChu((v) => !v)} aria-expanded={moGhiChu}>
                {moGhiChu ? "Ẩn ghi chú" : "Thêm ghi chú"}
              </Button>
            ) : null}
          </div>

          {choXuLy && item.type === "ABSENCE" && !item.tiepNhanDuoc ? (
            <p className="rounded-lg bg-[color:var(--state-warning-soft)] px-3 py-2 text-xs text-foreground">
              Báo vắng này không gắn buổi cụ thể — duyệt hoặc từ chối tay, rồi ghi vắng ở màn điểm danh.
            </p>
          ) : null}
          {choXuLy && item.type === "ABSENCE" && item.tiepNhanDuoc ? (
            <p className="text-xs text-muted-foreground">Tiếp nhận sẽ tự ghi buổi này vắng có phép, lý do là lời phụ huynh để giáo viên biết. Phụ huynh rút đơn thì hệ thống tự gỡ.</p>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
