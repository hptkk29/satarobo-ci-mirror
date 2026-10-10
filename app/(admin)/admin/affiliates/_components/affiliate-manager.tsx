"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Plus } from "lucide-react";
import { createAffiliateAction, updateAffiliateAction } from "../_actions";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export type AffiliateRow = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  centerId: string | null;
  commissionPercent: number | null;
  isActive: boolean;
  note: string | null;
  leadCount: number;
  convertedCount: number;
};

type Draft = {
  code: string;
  name: string;
  phone: string;
  email: string;
  centerId: string;
  commissionPercent: string;
  note: string;
  isActive: boolean;
};

const emptyDraft: Draft = {
  code: "",
  name: "",
  phone: "",
  email: "",
  centerId: "",
  commissionPercent: "",
  note: "",
  isActive: true,
};

const PUBLIC_ORIGIN = "https://satarobo.vn";

// BGĐ 31/07 — CRUD nguồn giới thiệu + copy link ?ref= + số lead/lead chốt.
export function AffiliateManager({
  affiliates,
  centers,
  canManage,
}: {
  affiliates: AffiliateRow[];
  centers: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  function beginCreate() {
    setEditingId(null);
    setDraft(emptyDraft);
    setCreating(true);
  }

  function beginEdit(a: AffiliateRow) {
    setCreating(false);
    setEditingId(a.id);
    setDraft({
      code: a.code,
      name: a.name,
      phone: a.phone ?? "",
      email: a.email ?? "",
      centerId: a.centerId ?? "",
      commissionPercent: a.commissionPercent != null ? String(a.commissionPercent) : "",
      note: a.note ?? "",
      isActive: a.isActive,
    });
  }

  function save() {
    const payload = {
      code: draft.code,
      name: draft.name,
      phone: draft.phone || null,
      email: draft.email || null,
      centerId: draft.centerId || null,
      commissionPercent: draft.commissionPercent ? Number(draft.commissionPercent) : null,
      note: draft.note || null,
      isActive: draft.isActive,
    };
    start(async () => {
      const res = editingId
        ? await updateAffiliateAction(editingId, payload)
        : await createAffiliateAction(payload);
      if (res.ok) {
        toast.success(editingId ? "Đã lưu nguồn giới thiệu" : "Đã thêm nguồn giới thiệu");
        setCreating(false);
        setEditingId(null);
        setDraft(emptyDraft);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  async function copyLink(code: string) {
    const link = `${PUBLIC_ORIGIN}/?ref=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(`Đã copy link: ${link}`);
    } catch {
      toast.error("Không copy được — hãy copy thủ công: " + link);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      {canManage && !creating && !editingId && (
        <button
          type="button"
          onClick={beginCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Thêm nguồn giới thiệu
        </button>
      )}

      {(creating || editingId) && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-bold text-foreground">
            {editingId ? "Sửa nguồn giới thiệu" : "Nguồn giới thiệu mới"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Mã giới thiệu *
              </span>
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                placeholder="VD: ANNGUYEN"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Tên người/đối tác *
              </span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="VD: Chị An (PH lớp Sata 3)"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Điện thoại</span>
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Email</span>
              <input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Cơ sở theo dõi
              </span>
              <select
                value={draft.centerId}
                onChange={(e) => setDraft({ ...draft, centerId: e.target.value })}
                className={inputCls}
              >
                <option value="">— Toàn hệ thống —</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                % hoa hồng tham chiếu
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.commissionPercent}
                onChange={(e) => setDraft({ ...draft, commissionPercent: e.target.value })}
                placeholder="Để trống nếu chưa chốt"
                className={inputCls}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Ghi chú</span>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className={inputCls}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            />
            Đang hoạt động (mã tắt thì link ?ref= không gắn lead nữa)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? "Đang lưu…" : "Lưu"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditingId(null);
              }}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}

      {affiliates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Chưa có nguồn giới thiệu nào.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang cuonNgang>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Mã</th>
                  <th className="px-4 py-2">Người giới thiệu</th>
                  <th className="px-4 py-2 text-center">Lead</th>
                  <th className="px-4 py-2 text-center">Đã chốt</th>
                  <th className="px-4 py-2 text-center">% HH</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {affiliates.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono font-semibold text-foreground">
                      {a.code}
                      {!a.isActive && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          TẮT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-foreground">
                      {a.name}
                      {(a.phone || a.email) && (
                        <span className="block text-xs text-muted-foreground">
                          {[a.phone, a.email].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums">{a.leadCount}</td>
                    <td className="px-4 py-2 text-center tabular-nums font-semibold text-state-success-ink">
                      {a.convertedCount}
                    </td>
                    <td className="px-4 py-2 text-center tabular-nums">
                      {a.commissionPercent != null ? `${a.commissionPercent}%` : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => copyLink(a.code)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary"
                        >
                          <Copy className="h-3.5 w-3.5" /> Link
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => beginEdit(a)}
                            className="text-xs font-semibold text-primary hover:underline"
                          >
                            Sửa
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </div>
  );
}
