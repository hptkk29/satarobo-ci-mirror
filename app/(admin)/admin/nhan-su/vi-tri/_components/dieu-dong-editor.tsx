"use client";

// P2 · US-10 (AC4) — MÀN ĐIỀU ĐỘNG: chọn người đang giữ vị trí → thêm nơi tác nghiệp,
// lý do, thời hạn.
//
// ⚠️ Điều động treo trên PHÂN CÔNG, không treo trên người: cùng một người có thể vừa
// giữ vị trí chính vừa kiêm nhiệm, và điều động thuộc về đúng một trong hai. Nên ô chọn
// ở đây là "người — vị trí", không phải "người".
//
// ⚠️ KHÔNG có nút xoá — kết thúc điều động là đóng hiệu lực, để còn tra được ai từng
// tác nghiệp ở cơ sở nào.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ketThucDieuDong, luuDieuDong } from "../_actions";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";

type LyDo = "TEACHING" | "MAKEUP" | "TRIAL" | "SUPPORT";

const NHAN_LY_DO: Record<string, string> = {
  TEACHING: "Dạy học",
  MAKEUP: "Dạy bù",
  TRIAL: "Lớp trải nghiệm",
  SUPPORT: "Hỗ trợ",
};

type PhanCongChon = { id: string; nhan: string };
type DonVi = { id: string; code: string; name: string; type: string };

export type DieuDong = {
  id: string;
  assignmentId: string;
  nhanPhanCong: string;
  orgUnitId: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  tuNgay: string;
  denNgay: string | null;
  note: string | null;
};

function homNay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ngayVN(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("vi-VN") : "—";
}

/** Cùng phép lọc resolver dùng: đang nằm trong khoảng hiệu lực (không có cột status). */
function conHieuLuc(d: DieuDong, bayGio = Date.now()): boolean {
  if (new Date(d.effectiveFrom).getTime() > bayGio) return false;
  return d.effectiveTo === null || new Date(d.effectiveTo).getTime() >= bayGio;
}

const FORM_RONG = {
  id: undefined as string | undefined,
  assignmentId: "",
  orgUnitId: "",
  reason: "TEACHING" as LyDo,
  effectiveFrom: homNay(),
  effectiveTo: "",
  note: "",
};

export function DieuDongEditor({
  phanCongs,
  donVis,
  dieuDongs,
}: {
  phanCongs: PhanCongChon[];
  donVis: DonVi[];
  dieuDongs: DieuDong[];
}) {
  const [form, setForm] = useState(FORM_RONG);
  const [hienLichSu, setHienLichSu] = useState(false);
  const [pending, start] = useTransition();

  const tenDonVi = useMemo(
    () => new Map(donVis.map((o) => [o.id, `${o.code} · ${o.name}`])),
    [donVis],
  );
  const hienThi = useMemo(
    () => (hienLichSu ? dieuDongs : dieuDongs.filter((d) => conHieuLuc(d))),
    [dieuDongs, hienLichSu],
  );

  function luu() {
    start(async () => {
      const res = await luuDieuDong({
        ...form,
        effectiveTo: form.effectiveTo || null,
        note: form.note || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Đã cập nhật điều động" : "Đã điều động");
      setForm(FORM_RONG);
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Điều động tác nghiệp</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Nơi <strong>tác nghiệp</strong> tách khỏi nơi <strong>trực thuộc</strong>: giáo viên
          biên chế Hội sở được điều xuống cơ sở dạy mà không đổi biên chế, không đổi vai
          trò. Điều động chỉ mở <em>phạm vi dữ liệu</em> của cơ sở đó, trong đúng khoảng
          thời gian ghi ở đây — hết hạn là mất truy cập ngay, không ai phải đi gỡ.
        </p>
      </div>

      {phanCongs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Chưa có phân công nào đang hiệu lực để điều động. Phân công người vào vị trí ở
          khối phía trên trước.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Người — vị trí *
            </span>
            <select
              value={form.assignmentId}
              onChange={(e) => setForm({ ...form, assignmentId: e.target.value })}
              disabled={Boolean(form.id)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60"
            >
              <option value="">— Chọn phân công —</option>
              {phanCongs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nhan}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Nơi tác nghiệp *
            </span>
            <select
              value={form.orgUnitId}
              onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">— Chọn đơn vị —</option>
              {donVis.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Lý do *</span>
            <select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value as LyDo })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {Object.entries(NHAN_LY_DO).map(([v, nhan]) => (
                <option key={v} value={v}>
                  {nhan}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Hiệu lực từ *
            </span>
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Đến ngày (để trống = chưa định ngày về)
            </span>
            <input
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Ghi chú (số quyết định…)
            </span>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>
      )}

      {phanCongs.length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={luu}
            disabled={pending || !form.assignmentId || !form.orgUnitId || !form.effectiveFrom}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Điều động"}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm(FORM_RONG)}
              disabled={pending}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold text-foreground"
            >
              Huỷ
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {hienLichSu ? "Toàn bộ điều động (kể cả đã kết thúc)" : "Đang hiệu lực"}
        </h3>
        <button
          type="button"
          onClick={() => setHienLichSu((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
        >
          {hienLichSu ? "Chỉ xem đang hiệu lực" : "Xem cả lịch sử"}
        </button>
      </div>

      <BangPhanTrang
        tenDonVi="điều động"
        khoaGhiNho="dieu-dong"
        colSpan={6}
        trong={hienLichSu ? "Chưa có điều động nào." : "Không có điều động nào đang hiệu lực."}
        theadClassName="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground"
        tbodyClassName="divide-y divide-border"
        head={
          <tr>
            <th className="px-3 py-2">Người — vị trí</th>
            <th className="px-3 py-2">Nơi tác nghiệp</th>
            <th className="px-3 py-2">Lý do</th>
            <th className="px-3 py-2">Hiệu lực</th>
            <th className="px-3 py-2">Ghi chú</th>
            <th className="px-3 py-2 text-right">Thao tác</th>
          </tr>
        }
        rows={hienThi.map((d) => {
              const song = conHieuLuc(d);
              return (
                <tr key={d.id} className={song ? "" : "opacity-55"}>
                  <td className="px-3 py-2 font-medium text-foreground">{d.nhanPhanCong}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {tenDonVi.get(d.orgUnitId) ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {NHAN_LY_DO[d.reason] ?? d.reason}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ngayVN(d.effectiveFrom)} → {d.effectiveTo ? ngayVN(d.effectiveTo) : "chưa định"}
                    {!song && <span className="ml-1.5 text-[11px]">(đã kết thúc)</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{d.note ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            id: d.id,
                            assignmentId: d.assignmentId,
                            orgUnitId: d.orgUnitId,
                            reason: (d.reason as LyDo) ?? "TEACHING",
                            effectiveFrom: d.tuNgay,
                            effectiveTo: d.denNgay ?? "",
                            note: d.note ?? "",
                          })
                        }
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
                      >
                        Sửa
                      </button>
                      {song && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const res = await ketThucDieuDong(d.id);
                              if (!res.ok) toast.error(res.error);
                              else toast.success("Đã kết thúc điều động — lịch sử vẫn giữ");
                            })
                          }
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-destructive"
                        >
                          Kết thúc
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
        })}
      />
    </section>
  );
}
