"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { taoSoGiaDinhAction } from "@/app/(portal)/portal/disc/_actions-so";
import { cn } from "@/lib/utils";

import { NUT_CAM } from "./chung";

/** Màn đầu tiên khi tài khoản CHƯA có sổ gia đình: bạn là chủ sổ, tự điền cho cả nhà (không mời, không xác thực người kia). */

const VAI_CHU_SO = [
  ["me", "Mẹ"],
  ["bo", "Bố"],
  ["ong", "Ông"],
  ["ba", "Bà"],
  ["nguoi-than", "Người thân"],
  ["khac", "Khác"],
] as const;

export function TaoSo({ tenGoiY, soHocVien }: { tenGoiY: string; soHocVien: number }) {
  const router = useRouter();
  const [ten, setTen] = useState(tenGoiY);
  const [vai, setVai] = useState<(typeof VAI_CHU_SO)[number][0]>("me");
  const [namSinh, setNamSinh] = useState("");
  const [tenNha, setTenNha] = useState("");
  const [goiY, setGoiY] = useState(true);
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  return (
    <section aria-labelledby="h-tao-so" className="mx-auto flex w-full max-w-[640px] flex-col gap-4 rounded-[22px] border border-border bg-card p-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">Khám phá DISC</span>
        <h1 id="h-tao-so" className="m-0 font-display text-[28px] font-extrabold leading-9">Lập sổ DISC cho cả nhà</h1>
        <p className="m-0 text-[15px] leading-[22px] text-[var(--sr-ink-muted)]">
          Bạn là chủ sổ: tự thêm từng thành viên, tự chọn ai làm bài và cách làm. Không cần mời hay xác thực người kia. Chỉ bạn xem được sổ này.
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Tên gọi của bạn trong nhà</span>
        <input value={ten} maxLength={30} onChange={(e) => setTen(e.target.value)} className="h-11 rounded-xl border border-border bg-background px-3 text-foreground" />
      </label>
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Bạn là</span>
        <div role="radiogroup" aria-label="Vai của bạn" className="flex flex-wrap gap-2">
          {VAI_CHU_SO.map(([v, t]) => (
            <button key={v} type="button" role="radio" aria-checked={vai === v} onClick={() => setVai(v)} className={cn("min-h-10 rounded-full border px-3.5 text-[13px] font-semibold", vai === v ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card")}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Năm sinh của bạn (tuỳ chọn)</span>
        <input type="number" inputMode="numeric" min={1920} value={namSinh} onChange={(e) => setNamSinh(e.target.value)} className="h-11 w-36 rounded-xl border border-border bg-background px-3 text-foreground" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-semibold">Tên gia đình (tuỳ chọn)</span>
        <input value={tenNha} maxLength={60} onChange={(e) => setTenNha(e.target.value)} placeholder="Ví dụ: Nhà mình" className="h-11 rounded-xl border border-border bg-background px-3 text-foreground" />
      </label>
      {soHocVien > 0 ? (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={goiY} onChange={(e) => setGoiY(e.target.checked)} className="mt-1" />
          <span>Thêm {soHocVien} học viên Sata Robo của tài khoản này làm thành viên vai «con» (tên và lớp lấy từ hồ sơ; bạn sửa được sau).</span>
        </label>
      ) : null}
      {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
      <button
        type="button"
        disabled={dang || ten.trim().length === 0}
        onClick={() =>
          batDau(async () => {
            setLoi(null);
            const ns = namSinh.trim() === "" ? null : Number(namSinh);
            const r = await taoSoGiaDinhAction({
              tenChuSo: ten,
              vaiTroChuSo: vai,
              namSinhChuSo: ns !== null && Number.isInteger(ns) ? ns : null,
              ...(tenNha.trim() ? { tenGiaDinh: tenNha } : {}),
              goiYHocVien: goiY,
            });
            if (!r.ok) setLoi(r.error);
            else router.refresh();
          })
        }
        className={cn(NUT_CAM, "h-12 self-start rounded-xl px-5 text-sm disabled:opacity-50")}
      >
        {dang ? "Đang lập sổ…" : "Lập sổ gia đình"}
      </button>
    </section>
  );
}
