"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { xacNhanPinAction } from "@/app/(portal)/portal/disc/_actions-so";
import { cn } from "@/lib/utils";

import { H2, KHUNG, NUT_CAM, NUT_VIEN } from "./chung";

/**
 * V8.31 — Màn «Mở sổ DISC»: máy chủ ép PIN ⇒ phải nhập PIN (hoặc mật khẩu tài khoản — cách DUY NHẤT gỡ khoá khi PIN bị khoá). Thành công ⇒ cookie HttpOnly do MÁY CHỦ đặt; trang này
 * không bao giờ nhận/ghi token. Không có đường «bỏ qua»: dữ liệu chỉ hiện khi máy chủ đã mở khoá.
 */
export function ManMoKhoa({ khoaDenLuc, cheDoTreEm }: { khoaDenLuc: string | null; cheDoTreEm: boolean }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [cach, setCach] = useState<"pin" | "mat-khau">(khoaDenLuc ? "mat-khau" : "pin");
  const [pin, setPin] = useState("");
  const [matKhau, setMatKhau] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  const gui = () =>
    batDau(async () => {
      setLoi(null);
      const r = await xacNhanPinAction(cach === "pin" ? { pin } : { matKhau });
      if (!r.ok) {
        setLoi(r.error);
        setPin("");
        setMatKhau("");
        if (r.loi === "PIN_BI_KHOA") setCach("mat-khau");
        return;
      }
      router.replace("/portal/disc");
      router.refresh();
    });

  const sanSang = cach === "pin" ? pin.length === 4 : matKhau.length > 0;
  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
      <section className={cn(KHUNG, "flex flex-col gap-3 p-6")}>
        <h2 className={H2}>{cheDoTreEm ? "Thoát chế độ trẻ em" : "Mở sổ DISC của gia đình"}</h2>
        <p className="m-0 text-sm leading-[22px] text-[var(--sr-ink-muted)]">
          {khoaDenLuc ? "Mã PIN đang bị khoá do nhập sai nhiều lần. Dùng mật khẩu tài khoản để mở khoá." : cheDoTreEm ? "Nhập mã PIN của bạn để thoát chế độ trẻ em." : "Nhập mã PIN để xem sổ DISC. Dữ liệu chỉ hiện sau khi máy chủ xác nhận."}
        </p>
        {cach === "pin" ? (
          <input aria-label="Mã PIN 4 số" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="h-12 w-32 rounded-xl border border-border bg-background px-3 text-center text-lg tracking-[0.4em] text-foreground" />
        ) : (
          <input aria-label="Mật khẩu tài khoản" type="password" autoComplete="current-password" value={matKhau} onChange={(e) => setMatKhau(e.target.value)} className="h-12 w-full rounded-xl border border-border bg-background px-3 text-foreground" />
        )}
        {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!sanSang || dang} onClick={gui} className={cn(NUT_CAM, "h-11 rounded-xl px-5 text-sm disabled:opacity-50")}>{dang ? "Đang kiểm tra…" : "Mở khoá"}</button>
          <button type="button" onClick={() => { setCach(cach === "pin" ? "mat-khau" : "pin"); setLoi(null); }} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm")}>{cach === "pin" ? "Quên mã PIN? Dùng mật khẩu" : "Dùng mã PIN"}</button>
        </div>
      </section>
    </div>
  );
}
