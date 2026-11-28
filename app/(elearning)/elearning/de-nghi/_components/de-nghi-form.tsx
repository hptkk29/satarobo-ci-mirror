"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { guiDeNghiAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_CHINH, O_CHON, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

/**
 * Form gửi đề nghị đào tạo (5 trường). Quý chọn từ danh sách (không gõ tay "2026-Q3"): giá trị chọn được luôn qua schema máy chủ
 * (`de-nghi-pure.test.ts [DNP-01]` ghim). Gửi xong làm mới danh sách và xoá nội dung đã nhập — không để người dùng gửi trùng.
 */
export function DeNghiForm({ quy }: { quy: readonly { gia: string; nhan: string }[] }) {
  const router = useRouter();
  const [dangGui, chuyen] = useTransition();
  const id = useId();
  const [loi, setLoi] = useState<string | null>(null);
  const [f, setF] = useState({
    title: "",
    targetGroupText: "",
    reason: "",
    expectedOutcome: "",
    proposedQuarter: quy[0]?.gia ?? "",
  });

  const gui = (e: React.FormEvent) => {
    e.preventDefault();
    setLoi(null);
    chuyen(async () => {
      const r = await guiDeNghiAction(f);
      if (r.ok) {
        toast.success(`Đã gửi đề nghị ${(r.data as { code: string }).code}`);
        setF({ ...f, title: "", targetGroupText: "", reason: "", expectedOutcome: "" });
        router.refresh();
      } else {
        setLoi(r.error.message);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <form onSubmit={gui} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Gửi đề nghị đào tạo">
      <div>
        <label htmlFor={`${id}-t`} className={NHAN_O}>
          Bạn muốn được đào tạo về gì
        </label>
        <input id={`${id}-t`} className={`${O_NHAP} mt-1`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
      </div>
      <div>
        <label htmlFor={`${id}-g`} className={NHAN_O}>
          Nhóm người cần đào tạo
        </label>
        <input
          id={`${id}-g`}
          className={`${O_NHAP} mt-1`}
          value={f.targetGroupText}
          onChange={(e) => setF({ ...f, targetGroupText: e.target.value })}
          required
        />
        <p className={GOI_Y_O}>Mô tả bằng lời, ví dụ “nhân viên mới của cơ sở 2”.</p>
      </div>
      <div>
        <label htmlFor={`${id}-r`} className={NHAN_O}>
          Lý do
        </label>
        <textarea id={`${id}-r`} className={`${O_NHAP_VAN_BAN} mt-1`} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={10} />
        <p className={GOI_Y_O}>Ít nhất 10 ký tự.</p>
      </div>
      <div>
        <label htmlFor={`${id}-k`} className={NHAN_O}>
          Kết quả mong đợi
        </label>
        <textarea
          id={`${id}-k`}
          className={`${O_NHAP_VAN_BAN} mt-1`}
          value={f.expectedOutcome}
          onChange={(e) => setF({ ...f, expectedOutcome: e.target.value })}
          required
          minLength={10}
        />
        <p className={GOI_Y_O}>Ít nhất 10 ký tự.</p>
      </div>
      <div>
        <label htmlFor={`${id}-q`} className={NHAN_O}>
          Quý dự kiến
        </label>
        <select id={`${id}-q`} className={`${O_CHON} mt-1 sm:max-w-xs`} value={f.proposedQuarter} onChange={(e) => setF({ ...f, proposedQuarter: e.target.value })}>
          {quy.map((q) => (
            <option key={q.gia} value={q.gia}>
              {q.nhan}
            </option>
          ))}
        </select>
      </div>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <button type="submit" disabled={dangGui} className={NUT_CHINH}>
        {dangGui ? "Đang gửi…" : "Gửi đề nghị"}
      </button>
    </form>
  );
}
