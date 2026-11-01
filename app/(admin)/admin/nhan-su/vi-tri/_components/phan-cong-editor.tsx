"use client";

// P2 · US-09 — phân công người vào vị trí (chính / kiêm nhiệm / uỷ quyền).
//
// ⚠️ "CÒN HIỆU LỰC" TÍNH THEO KHOẢNG THỜI GIAN, không theo cột `status`: cùng một phép
// đúng như resolver (`loadPositionRoleRows`) dùng. Nếu màn này tô màu theo `status` thì
// sẽ có ngày nó nói "đang hiệu lực" trong khi quyền đã tắt — và người ta sẽ tin màn hình.
//
// ⚠️ KHÔNG có nút xoá — cố ý (AC3). Gỡ người = "Kết thúc", tức đóng hiệu lực.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ketThucPhanCong, luuPhanCong } from "../_actions";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";

type Kind = "PRIMARY" | "CONCURRENT" | "DELEGATED";

type PhanCong = {
  id: string;
  positionId: string;
  userId: string;
  hoTen: string;
  kind: Kind | string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Ngày theo GIỜ VN cho ô `<input type="date">` — KHÔNG cắt từ chuỗi ISO (lệch 1 ngày). */
  tuNgay: string;
  denNgay: string | null;
  status: string;
  note: string | null;
};

const NHAN_KIND: Record<string, string> = {
  PRIMARY: "Chính",
  CONCURRENT: "Kiêm nhiệm",
  DELEGATED: "Uỷ quyền",
};

/** Ngày hôm nay dạng `yyyy-mm-dd` theo giờ máy người dùng (input type=date). */
function homNay(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ngayVN(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN");
}

/** Cùng phép lọc resolver dùng: ACTIVE + đang nằm trong khoảng hiệu lực. */
function conHieuLuc(a: PhanCong, bayGio = Date.now()): boolean {
  if (a.status !== "ACTIVE") return false;
  if (new Date(a.effectiveFrom).getTime() > bayGio) return false;
  return a.effectiveTo === null || new Date(a.effectiveTo).getTime() >= bayGio;
}

const FORM_RONG = {
  id: undefined as string | undefined,
  positionId: "",
  userId: "",
  kind: "PRIMARY" as Kind,
  effectiveFrom: homNay(),
  effectiveTo: "",
  note: "",
};

export function PhanCongEditor({
  positions,
  nhanSu,
  assignments,
}: {
  positions: { id: string; title: string; isActive: boolean }[];
  nhanSu: { id: string; ten: string }[];
  assignments: PhanCong[];
}) {
  const [form, setForm] = useState(FORM_RONG);
  const [hienLichSu, setHienLichSu] = useState(false);
  const [pending, start] = useTransition();

  const tenViTri = useMemo(() => new Map(positions.map((p) => [p.id, p.title])), [positions]);

  const hienThi = useMemo(
    () => (hienLichSu ? assignments : assignments.filter((a) => conHieuLuc(a))),
    [assignments, hienLichSu],
  );

  function luu() {
    start(async () => {
      const res = await luuPhanCong({
        ...form,
        effectiveTo: form.effectiveTo || null,
        note: form.note || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Đã cập nhật phân công" : "Đã phân công");
      setForm(FORM_RONG);
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Phân công người vào vị trí</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          Mỗi người có <strong>đúng một phân công Chính</strong> còn hiệu lực; Kiêm nhiệm và
          Uỷ quyền không giới hạn. Hết hạn là quyền tự tắt ở lần truy cập kế tiếp — không
          ai phải đi gỡ tay.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Người *</span>
          <select
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
            disabled={Boolean(form.id)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="">— Chọn người —</option>
            {nhanSu.map((u) => (
              <option key={u.id} value={u.id}>
                {u.ten}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Vị trí *</span>
          <select
            value={form.positionId}
            onChange={(e) => setForm({ ...form, positionId: e.target.value })}
            disabled={Boolean(form.id)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="">— Chọn vị trí —</option>
            {positions
              .filter((p) => p.isActive || p.id === form.positionId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.isActive ? "" : " (đã tắt)"}
                </option>
              ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">Kiểu</span>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          >
            <option value="PRIMARY">Chính</option>
            <option value="CONCURRENT">Kiêm nhiệm</option>
            <option value="DELEGATED">Uỷ quyền</option>
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
            Đến ngày (để trống = vô thời hạn)
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
            Ghi chú (số quyết định, lý do…)
          </span>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={luu}
          disabled={pending || !form.userId || !form.positionId || !form.effectiveFrom}
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Phân công"}
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

      <div className="flex items-center justify-between border-t border-border pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {hienLichSu ? "Toàn bộ phân công (kể cả đã kết thúc)" : "Đang hiệu lực"}
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
        tenDonVi="phân công"
        khoaGhiNho="phan-cong"
        colSpan={6}
        trong={hienLichSu ? "Chưa có phân công nào." : "Không có phân công nào đang hiệu lực."}
        theadClassName="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground"
        tbodyClassName="divide-y divide-border"
        head={
          <tr>
            <th className="px-3 py-2">Người</th>
            <th className="px-3 py-2">Vị trí</th>
            <th className="px-3 py-2">Kiểu</th>
            <th className="px-3 py-2">Hiệu lực</th>
            <th className="px-3 py-2">Ghi chú</th>
            <th className="px-3 py-2 text-right">Thao tác</th>
          </tr>
        }
        rows={hienThi.map((a) => {
              const song = conHieuLuc(a);
              return (
                <tr key={a.id} className={song ? "" : "opacity-55"}>
                  <td className="px-3 py-2 font-medium text-foreground">{a.hoTen}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {tenViTri.get(a.positionId) ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ a.kind === "PRIMARY" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground" }`}
                    >
                      {NHAN_KIND[a.kind] ?? a.kind}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {ngayVN(a.effectiveFrom)} → {a.effectiveTo ? ngayVN(a.effectiveTo) : "không thời hạn"}
                    {!song && <span className="ml-1.5 text-[11px]">(đã kết thúc)</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.note ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setForm({
                            id: a.id,
                            positionId: a.positionId,
                            userId: a.userId,
                            kind: (a.kind as Kind) ?? "PRIMARY",
                            effectiveFrom: a.tuNgay,
                            effectiveTo: a.denNgay ?? "",
                            note: a.note ?? "",
                          });
                          if (typeof window !== "undefined") {
                            window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                          }
                        }}
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
                              const res = await ketThucPhanCong(a.id);
                              if (!res.ok) toast.error(res.error);
                              else toast.success("Đã kết thúc phân công — lịch sử vẫn giữ");
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
