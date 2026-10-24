"use client";

// Menu gọn theo vai (28/09/2026) — chọn mục menu ẨN với mọi người giữ vai này.
// KHÔNG phải quyền: trang vẫn mở được bằng link (`lib/auth/menu-gon.ts`). Muốn CHẶN thật thì
// bỏ quyền ở khối "Quyền của vai" phía trên.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MUC_MENU_CO_THE_AN } from "@/components/admin/sidebar";
import { setRoleAnMenuAction } from "../actions";

export function RoleMenuGonEditor({ roleId, current }: { roleId: string; current: readonly string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chon, setChon] = useState<Set<string>>(() => new Set(current));
  const [reason, setReason] = useState("");

  const theoNhom = useMemo(() => {
    const m = new Map<string, { label: string; href: string }[]>();
    for (const it of MUC_MENU_CO_THE_AN) {
      const ds = m.get(it.nhom) ?? [];
      ds.push({ label: it.label, href: it.href });
      m.set(it.nhom, ds);
    }
    return [...m.entries()];
  }, []);

  // Đường dẫn đang lưu mà menu không còn mục đó (menu đổi sau khi khai) — nói ra, đừng giấu.
  const khongConTrongMenu = useMemo(
    () => current.filter((h) => !MUC_MENU_CO_THE_AN.some((m) => m.href === h)),
    [current],
  );

  const daDoi = useMemo(() => {
    if (chon.size !== current.length) return true;
    return current.some((h) => !chon.has(h));
  }, [chon, current]);

  function bat(href: string, co: boolean) {
    setChon((cu) => {
      const moi = new Set(cu);
      if (co) moi.add(href);
      else moi.delete(href);
      return moi;
    });
  }

  function luu() {
    const lyDo = reason.trim();
    if (lyDo.length < 3) {
      toast.error("Nhập lý do thay đổi (ít nhất 3 ký tự)");
      return;
    }
    startTransition(async () => {
      const res = await setRoleAnMenuAction(roleId, { anMenu: [...chon], reason: lyDo });
      if (res.ok) {
        toast.success("Đã lưu menu gọn của vai");
        setReason("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <section aria-labelledby="menu-gon-tieu-de" className="mt-10 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 id="menu-gon-tieu-de" className="text-lg font-bold text-foreground">
        Mục menu ẩn với vai này
      </h2>
      <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
        Chỉ gọn thanh điều hướng — người giữ vai vẫn mở được trang bằng link. Người kiêm nhiều vai chỉ
        mất mục khi MỌI vai của họ cùng ẩn mục đó. Muốn chặn thật thì bỏ quyền ở khối phía trên.
      </p>

      {khongConTrongMenu.length > 0 ? (
        <p className="mt-3 text-sm text-amber-700">
          Đang lưu {khongConTrongMenu.length} đường dẫn không còn trong menu: {khongConTrongMenu.join(", ")} — lưu lại
          sẽ bỏ chúng.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {theoNhom.map(([nhom, ds]) => (
          <fieldset key={nhom} className="min-w-0">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{nhom}</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {ds.map((m) => {
                const id = `an-menu-${m.href.replace(/[^a-z0-9]/g, "-")}`;
                return (
                  <label key={m.href} htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={chon.has(m.href)}
                      onChange={(e) => bat(m.href, e.target.checked)}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {m.label} <span className="font-mono text-xs text-muted-foreground">{m.href}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Label htmlFor="menu-gon-ly-do">Lý do thay đổi (bắt buộc)</Label>
        <Input
          id="menu-gon-ly-do"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="VD: Kế toán không dùng màn lớp học"
        />
        <p className="text-xs text-muted-foreground">
          Lưu ý: chạy lại seed vai (workflow Seed Production Roles) sẽ ghi đè danh sách này theo prisma/seed-roles.ts.
        </p>
        <div>
          <Button onClick={luu} disabled={pending || !daDoi}>
            {pending ? "Đang lưu..." : `Lưu (${chon.size} mục ẩn)`}
          </Button>
        </div>
      </div>
    </section>
  );
}
