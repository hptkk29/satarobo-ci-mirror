"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { LeadStatus } from "@prisma/client";
import { previewHandoverAction, runHandoverAction } from "../_actions";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";

type SaleOpt = { id: string; label: string };

export function HandoverForm({
  sales,
  statuses,
  campaigns,
}: {
  sales: SaleOpt[];
  // `LeadStatus[]` chứ KHÔNG phải `string[]`: kiểu string làm mảng trạng thái bên page
  // mất hoàn toàn kiểm kiểu (đó là lý do đợt đổi enum GĐ5 đi lọt) và làm tra
  // LEAD_STATUS_LABEL phải ép kiểu.
  statuses: LeadStatus[];
  campaigns: string[];
}) {
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [selStatuses, setSelStatuses] = useState<LeadStatus[]>([]);
  const [campaign, setCampaign] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [reason, setReason] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function toggleStatus(s: LeadStatus) {
    setCount(null);
    setSelStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function preview() {
    if (!fromUserId) {
      toast.error("Chọn sale bàn giao");
      return;
    }
    start(async () => {
      const res = await previewHandoverAction({ fromUserId, statuses: selStatuses, campaign, onlyActive });
      if (res.ok) setCount(res.count ?? 0);
      else toast.error(res.error ?? "Lỗi");
    });
  }

  function run() {
    if (!fromUserId || !toUserId) {
      toast.error("Chọn sale bàn giao và sale nhận");
      return;
    }
    start(async () => {
      const res = await runHandoverAction({ fromUserId, toUserId, statuses: selStatuses, campaign, onlyActive, reason });
      if (res.ok) {
        toast.success(`Đã chuyển ${res.moved} lead, ${res.tasksMoved} task`);
        setCount(null);
        setReason("");
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Sale bàn giao (nguồn)</span>
        <select
          value={fromUserId}
          onChange={(e) => {
            setFromUserId(e.target.value);
            setCount(null);
          }}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">— Chọn —</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Sale nhận (đích)</span>
        <select
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">— Chọn —</option>
          {sales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Lọc trạng thái (để trống = tất cả)</span>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={`rounded-full border px-2.5 py-1 text-xs ${ selStatuses.includes(s) ? "border-primary-dark bg-primary-soft text-primary" : "border-border text-muted-foreground" }`}
            >
              {/* Nhãn tiếng Việt — trước đây in thẳng mã enum ("DA_HEN_HOC_THU") ra
                  cho người dùng. `s` vẫn là giá trị gửi lên server, chỉ đổi phần hiển thị. */}
              {LEAD_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <label className="text-sm">
        <span className="mb-1 block text-muted-foreground">Chiến dịch (utmCampaign)</span>
        <select
          value={campaign}
          onChange={(e) => {
            setCampaign(e.target.value);
            setCount(null);
          }}
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        >
          <option value="">— Mọi chiến dịch —</option>
          {campaigns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyActive}
          onChange={(e) => {
            setOnlyActive(e.target.checked);
            setCount(null);
          }}
        />
        {/* Nhãn phải khớp LEAD_CLOSED_STATUSES ở lib/leads/status.ts — GĐ5 gộp
            LOST/DUPLICATE thành "Đã mất", và DA_DANG_KY CỐ Ý không nằm trong tập đóng. */}
        <span className="text-muted-foreground">Chỉ lead chưa đóng (bỏ &quot;Đã mất&quot;)</span>
      </label>

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-muted-foreground">Lý do bàn giao</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="VD: Sale Nguyễn Văn A nghỉ việc 06/2026"
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          onClick={preview}
          disabled={pending}
          className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Xem trước số lead
        </button>
        {count !== null ? <span className="text-sm text-muted-foreground">→ {count} lead khớp điều kiện</span> : null}
        <button
          onClick={run}
          disabled={pending || count === null || count === 0}
          className="ml-auto rounded-md bg-primary-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Thực hiện bàn giao
        </button>
      </div>
    </div>
  );
}
