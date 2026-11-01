"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { chuyenNhieuLeadAction } from "../_actions";

// Màn CHUYỂN LEAD (01/10/2026) — sale chuyển những lead phụ huynh đổi nhu cầu (đổi cơ sở gần
// nhà, đổi khoá) sang cơ sở/sale khác. Thứ tự đi đúng thứ tự người làm nghĩ: chọn lead → chọn
// nơi nhận → ghi lại đã tư vấn gì. Ghi chú là BẮT BUỘC vì người nhận gọi lại phụ huynh mà không
// biết họ cần gì là mất khách.

export type LeadChuyen = {
  id: string;
  phuHuynh: string;
  con: string | null;
  sdt: string | null;
  trangThai: string;
  coSoId: string | null;
  coSo: string | null;
  khoa: string | null;
  sale: string | null;
};
type CoSo = { id: string; name: string };
type Sale = { id: string; name: string | null; centerId: string | null };

const LY_DO = ["Đổi cơ sở gần nhà hơn", "Đổi khoá học", "Đổi lịch học", "Sale nghỉ / quá tải"];

export function ChuyenLeadForm({
  leads,
  coSo,
  sales,
  xemTatCa,
}: {
  leads: LeadChuyen[];
  coSo: CoSo[];
  sales: Sale[];
  /** Có `leads:view-all` — thấy lead của mọi sale trong tầm nhìn, không chỉ lead của mình. */
  xemTatCa: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [coSoNhan, setCoSoNhan] = useState("");
  const [saleNhan, setSaleNhan] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [dang, start] = useTransition();

  const locQ = q.trim().toLocaleLowerCase("vi");
  const hienThi = useMemo(
    () =>
      locQ
        ? leads.filter((l) =>
            [l.phuHuynh, l.con, l.sdt, l.khoa].some((x) => x?.toLocaleLowerCase("vi").includes(locQ)),
          )
        : leads,
    [leads, locQ],
  );
  const saleCuaCoSo = useMemo(() => sales.filter((s) => s.centerId === coSoNhan), [sales, coSoNhan]);
  const tatCaDangHienDaChon = hienThi.length > 0 && hienThi.every((l) => chon.has(l.id));

  function doi(id: string) {
    setChon((cu) => {
      const moi = new Set(cu);
      if (moi.has(id)) moi.delete(id);
      else moi.add(id);
      return moi;
    });
  }
  function chonHet() {
    setChon((cu) => {
      const moi = new Set(cu);
      if (tatCaDangHienDaChon) hienThi.forEach((l) => moi.delete(l.id));
      else hienThi.forEach((l) => moi.add(l.id));
      return moi;
    });
  }

  const thieu =
    chon.size === 0
      ? "Chọn ít nhất 1 lead"
      : !coSoNhan
        ? "Chọn cơ sở nhận"
        : ghiChu.trim().length < 5
          ? "Ghi phụ huynh cần gì / đã tư vấn gì"
          : null;

  function gui() {
    if (thieu) return;
    start(async () => {
      const kq = await chuyenNhieuLeadAction({
        leadIds: [...chon],
        toCenterId: coSoNhan,
        toSaleId: saleNhan,
        handoverNote: ghiChu,
        reason: lyDo,
      });
      if (!kq.ok) {
        toast.error(kq.error);
        return;
      }
      if (kq.thanhCong > 0) toast.success(`Đã chuyển ${kq.thanhCong} lead`);
      if (kq.loi.length > 0) {
        const ten = new Map(leads.map((l) => [l.id, l.phuHuynh]));
        toast.error(
          `${kq.loi.length} lead không chuyển được: ` +
            kq.loi.map((e) => `${ten.get(e.leadId) ?? "?"} — ${e.error}`).join("; "),
          { duration: 10000 },
        );
      }
      // Giữ lại các lead lỗi trong vùng chọn để người dùng xử lý tiếp.
      setChon(new Set(kq.loi.map((e) => e.leadId)));
      if (kq.loi.length === 0) {
        setGhiChu("");
        setLyDo("");
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      {/* ── Bước 1: chọn lead ── */}
      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label="Chọn lead">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Tìm lead</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm phụ huynh, bé, SĐT, khoá…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <p className="text-sm text-muted-foreground tabular-nums">
            {xemTatCa ? "Lead trong cơ sở bạn quản lý" : "Lead bạn đang chăm"} · {leads.length}
          </p>
        </div>

        {leads.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {xemTatCa ? "Không có lead đang mở nào để chuyển." : "Bạn chưa có lead đang mở nào."}
          </p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả lead đang hiện"
                      checked={tatCaDangHienDaChon}
                      onChange={chonHet}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </th>
                  <th className="px-2 py-2.5">Phụ huynh · Bé</th>
                  <th className="px-2 py-2.5">Khoá quan tâm</th>
                  <th className="px-2 py-2.5">Cơ sở</th>
                  {xemTatCa && <th className="px-2 py-2.5">Sale</th>}
                  <th className="px-2 py-2.5">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {hienThi.map((l) => {
                  const bat = chon.has(l.id);
                  return (
                    <tr
                      key={l.id}
                      onClick={() => doi(l.id)}
                      className={cn(
                        "cursor-pointer border-t border-border transition-colors",
                        bat ? "bg-primary-soft/50" : "hover:bg-muted/50",
                      )}
                    >
                      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${l.phuHuynh}`}
                          checked={bat}
                          onChange={() => doi(l.id)}
                          className="size-4 accent-[var(--primary)]"
                        />
                      </td>
                      <td className="max-w-[240px] px-2 py-2.5">
                        <p className="truncate font-medium text-foreground">
                          <Link
                            href={`/leads/${l.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {l.phuHuynh}
                          </Link>
                        </p>
                        <p className="truncate text-xs text-muted-foreground tabular-nums">
                          {[l.con, l.sdt].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-2.5 text-muted-foreground">{l.khoa ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2.5">{l.coSo ?? "—"}</td>
                      {xemTatCa && <td className="max-w-[140px] truncate px-2 py-2.5">{l.sale ?? "Chưa gán"}</td>}
                      <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">{l.trangThai}</td>
                    </tr>
                  );
                })}
                {hienThi.length === 0 && (
                  <tr>
                    <td colSpan={xemTatCa ? 6 : 5} className="px-6 py-10 text-center text-sm text-muted-foreground">
                      Không lead nào khớp “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Bước 2–3: nơi nhận + ghi chú ── */}
      <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Chuyển tới">
        <div className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Chuyển tới</h2>
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {chon.size > 0 ? `Đã chọn ${chon.size} lead` : "Chưa chọn lead nào"}
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">Cơ sở nhận</legend>
            <div className="flex flex-wrap gap-2">
              {coSo.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={coSoNhan === c.id}
                  onClick={() => {
                    setCoSoNhan(c.id);
                    setSaleNhan("");
                  }}
                  className={cn(
                    "min-h-9 rounded-lg border px-3 text-sm transition-colors",
                    coSoNhan === c.id
                      ? "border-primary bg-primary-soft font-medium text-primary-ink"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Sale nhận</span>
            <select
              value={saleNhan}
              onChange={(e) => setSaleNhan(e.target.value)}
              disabled={!coSoNhan}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
            >
              <option value="">
                {coSoNhan ? "Tự chia theo cơ sở nhận" : "Chọn cơ sở nhận trước"}
              </option>
              {saleCuaCoSo.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? "Sale"}
                </option>
              ))}
            </select>
            {coSoNhan && saleCuaCoSo.length === 0 && (
              <span className="mt-1.5 block text-xs text-state-warning-ink">
                Cơ sở này chưa có sale nào đang làm — lead sẽ vào hàng chờ, quản lý cơ sở được báo.
              </span>
            )}
          </label>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">Lý do</legend>
            <div className="flex flex-wrap gap-1.5">
              {LY_DO.map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={lyDo === x}
                  onClick={() => setLyDo(lyDo === x ? "" : x)}
                  className={cn(
                    "min-h-8 rounded-full border px-2.5 text-xs transition-colors",
                    lyDo === x
                      ? "border-primary bg-primary-soft font-medium text-primary-ink"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {x}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              Phụ huynh cần gì / đã tư vấn gì <span className="text-state-danger-ink">*</span>
            </span>
            <textarea
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="VD: PH chuyển nhà sang Hải Châu, muốn học CS2 tối thứ 3-5; đã báo học phí Sata 2."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Người nhận đọc ghi chú này trước khi gọi lại phụ huynh.
            </span>
          </label>

          <div>
            <Button className="w-full" onClick={gui} disabled={dang || !!thieu}>
              {dang ? "Đang chuyển…" : (
                <>
                  Chuyển {chon.size > 0 ? `${chon.size} lead` : "lead"} <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </Button>
            {thieu && !dang && <p className="mt-2 text-center text-xs text-muted-foreground">{thieu}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
