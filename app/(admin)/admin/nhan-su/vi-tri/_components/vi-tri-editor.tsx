"use client";

// P2 · US-08 — bảng vị trí + form thêm/sửa.
//
// ⚠️ Danh sách "Báo cáo cho" CỐ Ý loại chính vị trí đang sửa, nhưng KHÔNG tự lọc cả chuỗi
// cấp dưới: người dùng vẫn chọn được một vị trí tạo vòng, và server sẽ từ chối kèm CHUỖI
// VÒNG cụ thể. Lọc sẵn ở client là giấu mất lý do — người dùng chỉ thấy "sao không có
// trong danh sách?" mà không hiểu vì sao.

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { doiTrangThaiViTri, luuViTri } from "../_actions";
import { BangPhanTrang } from "@/components/ui/bang-phan-trang";

type ViTri = {
  id: string;
  title: string;
  orgUnitId: string;
  isManagerial: boolean;
  isActive: boolean;
  reportsToPositionId: string | null;
  roleIds: string[];
  soNguoiGiu: number;
};
type OrgUnit = { id: string; code: string; name: string; type: string };
type Role = { id: string; code: string; name: string };

const RONG: Omit<ViTri, "id" | "soNguoiGiu"> & { id?: string } = {
  title: "",
  orgUnitId: "",
  isManagerial: false,
  isActive: true,
  reportsToPositionId: null,
  roleIds: [],
};

export function ViTriEditor({
  positions,
  orgUnits,
  roles,
}: {
  positions: ViTri[];
  orgUnits: OrgUnit[];
  roles: Role[];
}) {
  const [form, setForm] = useState<typeof RONG>(RONG);
  const [pending, start] = useTransition();

  const tenDonVi = useMemo(
    () => new Map(orgUnits.map((o) => [o.id, `${o.code} · ${o.name}`])),
    [orgUnits],
  );
  const tenViTri = useMemo(() => new Map(positions.map((p) => [p.id, p.title])), [positions]);
  // Hiện TÊN TIẾNG VIỆT của vai, không hiện mã. Mã (`CENTER_MANAGER`) là thứ dành cho
  // code; người xếp tổ chức đọc "Quản lý cơ sở". Mã vẫn giữ ở tooltip cho ai cần đối chiếu.
  const tenVai = useMemo(() => new Map(roles.map((r) => [r.id, r.name || r.code])), [roles]);

  function sua(p: ViTri) {
    setForm({ ...p });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function luu() {
    start(async () => {
      const res = await luuViTri(form);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(form.id ? "Đã cập nhật vị trí" : "Đã tạo vị trí");
      setForm(RONG);
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          {form.id ? "Sửa vị trí" : "Thêm vị trí"}
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Tên vị trí *
            </span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="VD: Quản lý cơ sở 1"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Đơn vị trực thuộc *
            </span>
            <select
              value={form.orgUnitId}
              onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">— Chọn đơn vị —</option>
              {orgUnits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Báo cáo cho
            </span>
            <select
              value={form.reportsToPositionId ?? ""}
              onChange={(e) =>
                setForm({ ...form, reportsToPositionId: e.target.value || null })
              }
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">— Không có —</option>
              {positions
                .filter((p) => p.id !== form.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </label>

          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={form.isManagerial}
              onChange={(e) => setForm({ ...form, isManagerial: e.target.checked })}
              className="size-4"
            />
            <span className="text-sm text-foreground">Là vị trí quản lý</span>
          </label>
        </div>

        <div className="mt-3">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
            Bộ vai trò — người giữ vị trí này hưởng đủ các vai được chọn
          </p>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => {
              const chon = form.roleIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      roleIds: chon
                        ? form.roleIds.filter((x) => x !== r.id)
                        : [...form.roleIds, r.id],
                    })
                  }
                  // Nhãn hiện tên tiếng Việt; mã (`CENTER_MANAGER`) để ở tooltip cho ai
                  // cần đối chiếu với `prisma/seed-roles.ts`.
                  title={r.code}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${ chon ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40" }`}
                >
                  {r.name || r.code}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={luu}
            disabled={pending || !form.title.trim() || !form.orgUnitId}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : form.id ? "Lưu thay đổi" : "Tạo vị trí"}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm(RONG)}
              disabled={pending}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold text-foreground"
            >
              Huỷ
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <BangPhanTrang
          tenDonVi="vị trí"
          khoaGhiNho="vi-tri"
          colSpan={6}
          trong="Chưa có vị trí nào. Tạo vị trí đầu tiên ở khối phía trên."
          theadClassName="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground"
          tbodyClassName="divide-y divide-border"
          head={
            <tr>
              <th className="px-4 py-3">Vị trí</th>
              <th className="px-4 py-3">Đơn vị</th>
              <th className="px-4 py-3">Bộ vai trò</th>
              <th className="px-4 py-3">Báo cáo cho</th>
              <th className="px-4 py-3 text-right">Đang giữ</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          }
          rows={positions.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "opacity-50"}>
                <td className="px-4 py-3">
                  <span className="font-medium text-foreground">{p.title}</span>
                  {p.isManagerial && (
                    <span className="ml-1.5 rounded-full bg-state-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-state-warning-ink">
                      Quản lý
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {tenDonVi.get(p.orgUnitId) ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {p.roleIds.length === 0 ? (
                    <span className="text-muted-foreground">— chưa gán vai —</span>
                  ) : (
                    <span className="text-xs">
                      {p.roleIds.map((id) => tenVai.get(id) ?? id).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.reportsToPositionId ? (tenViTri.get(p.reportsToPositionId) ?? "—") : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{p.soNguoiGiu}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => sua(p)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await doiTrangThaiViTri(p.id, !p.isActive);
                          if (!res.ok) toast.error(res.error);
                          else toast.success(p.isActive ? "Đã tắt vị trí" : "Đã bật lại");
                        })
                      }
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
                    >
                      {p.isActive ? "Tắt" : "Bật"}
                    </button>
                  </div>
                </td>
              </tr>
          ))}
        />
      </section>
    </div>
  );
}
