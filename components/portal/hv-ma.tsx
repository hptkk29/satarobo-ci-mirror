"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HvBanPhim } from "@/components/portal/hv-ban-phim";
import { HvDauTrang, HvLuoi, NUT_CAM } from "@/components/portal/hv-ui";
import { Ic, IC } from "@/components/portal/hv-icon";
import { datMaMoiAction, kiemMaHienTaiAction, taoMaThoatAction, xacMinhMatKhauAction } from "@/app/(portal)/portal/hoc-sinh/actions";
import { CAU_LOI_MA, laMaDeDoan } from "@/lib/portal/hv-ma-thuan";
import { nhanThoiGian } from "@/lib/portal/hv-thong-bao-thuan";

// Màn "Mã thoát Cổng học sinh" — artifact HV-Ma / M-HV-Ma (CHẾ ĐỘ BA MẸ): tạo · đổi · quên mã + nhật ký vào/thoát.
// KHÔNG vẽ nút "Face ID / vân tay": hệ thống chưa có đăng nhập sinh trắc để xác minh.

export type DongNhatKy = { id: string; ky: string; ten: string; luc: string; sac: "xanh" | "do" | "tim" | "nen" };
type Luong = "tao" | "doi" | "quen";
type Buoc = "cu" | "xm" | "moi" | "lai";

const BUOC: Record<Luong, Buoc[]> = { tao: ["moi", "lai"], doi: ["cu", "moi", "lai"], quen: ["xm", "moi", "lai"] };
const TEN_LUONG: Record<Luong, string> = { tao: "TẠO MÃ", doi: "ĐỔI MÃ", quen: "QUÊN MÃ" };
const HOI: Record<Buoc, [string, string]> = {
  cu: ["Nhập mã hiện tại", "Để chắc là ba mẹ đang đổi mã."],
  moi: ["Đặt mã mới · 4 số", "Chọn số ba mẹ nhớ được nhưng con không đoán ra."],
  lai: ["Nhập lại mã mới", "Nhập đúng 4 số vừa chọn một lần nữa."],
  xm: ["Ba mẹ xác minh lại", "Nhập mật khẩu đăng nhập của ba mẹ. Con không biết mật khẩu này nên không tự đổi mã được."],
};
const XONG: Record<Luong, [string, string]> = {
  tao: ["Đã tạo mã", "Từ giờ, con cần ba mẹ nhập mã này mới về được chế độ ba mẹ. Mã dùng chung cho cả nhà."],
  doi: ["Đã đổi mã", "Mã cũ hết hiệu lực ngay trên mọi máy. Lần đổi này được ghi vào nhật ký bên cạnh."],
  quen: ["Đã đặt mã mới", "Đã xác minh ba mẹ và thay mã. Mã cũ không dùng được nữa trên mọi máy."],
};
const SAC: Record<DongNhatKy["sac"], string> = {
  xanh: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  do: "bg-[var(--sr-bad-bg)] text-[var(--sr-bad-ink)]",
  tim: "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
  nen: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
};
const GHI = [
  "Không dùng mã dễ đoán như 1234, 0000, 1111 hay năm sinh của con.",
  "Nhập sai 5 lần, màn thoát dừng 5 phút và báo vào chuông thông báo của ba mẹ.",
  "Quên mã: ba mẹ tự xác minh bằng mật khẩu đăng nhập, rồi đặt mã mới — không cần chờ tin nhắn.",
  "Một mã dùng chung cho cả nhà, trên mọi máy ba mẹ đăng nhập.",
];

export function HvMaTrang({
  coMa: coMaDau,
  coMatKhau,
  namSinhCon,
  namNay,
  nhatKy,
  batDauQuen = false,
}: {
  coMa: boolean;
  coMatKhau: boolean;
  namSinhCon: number[];
  namNay: number;
  nhatKy: DongNhatKy[];
  /** Mở thẳng luồng "Quên mã" (đến từ nút "Ba mẹ quên mã?" ở màn thoát). */
  batDauQuen?: boolean;
}) {
  const [coMa, setCoMa] = useState(coMaDau);
  const [luong, setLuong] = useState<Luong | null>(batDauQuen && coMaDau ? "quen" : null);
  const [b, setB] = useState(0);
  const [ve, setVe] = useState("");
  const [moi, setMoi] = useState("");
  const [loi, setLoi] = useState("");
  const [xong, setXong] = useState<Luong | null>(null);
  const [dang, bat] = useTransition();
  const [mk, setMk] = useState("");
  const bay = new Date();

  const batDau = (l: Luong) => {
    setLuong(l);
    setB(0);
    setVe("");
    setMoi("");
    setLoi("");
    setMk("");
    setXong(null);
  };
  const huy = () => {
    setLuong(null);
    setB(0);
    setMoi("");
    setVe("");
    setLoi("");
  };
  const dsBuoc = luong ? BUOC[luong] : [];
  const buocHT = dsBuoc[b];

  const xuLySo = async (ma: string) => {
    if (!luong || !buocHT) return;
    if (buocHT === "cu") {
      const r = await kiemMaHienTaiAction(ma);
      if (!r.ok) return setLoi(r.error);
      setVe(r.ve);
      setLoi("");
      setB(b + 1);
      return;
    }
    if (buocHT === "moi") {
      const l = laMaDeDoan(ma, namSinhCon, namNay);
      if (l) return setLoi(CAU_LOI_MA[l]);
      setMoi(ma);
      setLoi("");
      setB(b + 1);
      return;
    }
    if (buocHT === "lai") {
      if (ma !== moi) {
        setMoi("");
        setB(b - 1);
        return setLoi("Hai lần nhập chưa khớp. Ba mẹ đặt lại mã mới nhé.");
      }
      const r = luong === "tao" ? await taoMaThoatAction({ ma: moi, xacNhan: ma }) : await datMaMoiAction({ ve, luong, ma: moi, xacNhan: ma });
      setMoi("");
      if (!r.ok) {
        setB(luong === "tao" ? 0 : 1);
        return setLoi(r.error);
      }
      setCoMa(true);
      setXong(luong);
      setLuong(null);
      setB(0);
      setVe("");
      setLoi("");
      toast.success("Đã lưu mã thoát.");
    }
  };

  const xacMinh = () =>
    bat(async () => {
      const r = await xacMinhMatKhauAction(mk);
      setMk("");
      if (!r.ok) return setLoi(r.error);
      setVe(r.ve);
      setLoi("");
      setB(b + 1);
    });

  const dangLuong = luong !== null && buocHT !== undefined;
  const sinhMau = !luong && !xong;

  return (
    // Vỏ PHỤ HUYNH không tự xếp dọc / giới hạn bề rộng — bọc cùng khuôn với «Học phí» và «Cho con vào» (cột 1160px, gap 24px).
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <HvDauTrang
        nhan="DÀNH CHO BA MẸ · BẢO MẬT"
        tieuDe="Mã thoát Cổng học sinh"
        phu="Mã 4 số để về lại chế độ ba mẹ sau khi cho con dùng máy. Ba mẹ tạo mã một lần khi cho con vào lần đầu; mã được lưu lại cho những lần sau."
      />
      <HvLuoi min={380} className="gap-5">
        {dangLuong && luong && buocHT && (
          <section aria-labelledby="buoc" className="flex flex-col items-center gap-3.5 rounded-[22px] border-2 border-[var(--sr-purple)] bg-card p-6 text-center">
            <div className="flex items-center justify-between gap-2.5 self-stretch">
              <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-purple-text)]">
                {TEN_LUONG[luong]} · BƯỚC {b + 1}/{dsBuoc.length}
              </span>
              <button type="button" onClick={huy} className="h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground">
                Huỷ
              </button>
            </div>
            <div aria-hidden="true" className="grid gap-1.5 self-stretch" style={{ gridTemplateColumns: `repeat(${dsBuoc.length}, minmax(0, 1fr))` }}>
              {dsBuoc.map((_, j) => (
                <span key={j} className={cn("h-1.5 rounded-full", j <= b ? "bg-[var(--sr-purple)]" : "bg-[var(--sr-tint-purple)]")} />
              ))}
            </div>
            <h2 id="buoc" className="m-0 mt-1.5 text-[22px] font-bold leading-[29px]">
              {HOI[buocHT][0]}
            </h2>
            <div className="max-w-[360px] text-sm leading-[21px] text-muted-foreground">{HOI[buocHT][1]}</div>
            {loi && (
              <div role="alert" className="text-sm font-semibold text-[var(--sr-bad-ink)]">
                {loi}
              </div>
            )}
            {buocHT === "xm" ? (
              coMatKhau ? (
                <div className="flex flex-col gap-3 self-stretch text-left">
                  <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Mật khẩu đăng nhập của ba mẹ
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={mk}
                      onChange={(e) => setMk(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && mk && xacMinh()}
                      placeholder="Mật khẩu dùng để vào cổng phụ huynh"
                      className="h-12 rounded-xl border border-[var(--sr-dash)] bg-card px-3.5 text-base font-normal text-foreground"
                    />
                  </label>
                  <button type="button" disabled={dang || !mk} onClick={xacMinh} className="h-12 rounded-xl bg-[var(--sr-purple)] text-[15px] font-bold text-white disabled:opacity-60">
                    {dang ? "Đang kiểm tra…" : "Xác minh"}
                  </button>
                  <div className="text-[13px] leading-[19px] text-muted-foreground">
                    Quên cả mật khẩu đăng nhập: dùng “Quên mật khẩu” ở màn đăng nhập, hoặc gọi 0837.312.860.
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-[var(--sr-tint-orange)] p-3.5 text-sm leading-[21px]">
                  Tài khoản này chưa có mật khẩu đăng nhập nên chưa tự đặt lại mã được. Gọi <a href="tel:0837312860" className="font-bold text-[var(--sr-purple-text)]">0837.312.860</a> để trung tâm hỗ trợ.
                </div>
              )
            ) : (
              <HvBanPhim key={`${luong}-${b}`} kich="ma" onXong={xuLySo} thayDoi={() => setLoi("")} />
            )}
          </section>
        )}

        {xong && !luong && (
          <section className="flex flex-col items-center gap-3 rounded-[22px] bg-[var(--sr-success-bg)] p-7 text-center">
            <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[var(--sr-success)] text-[30px] font-extrabold text-white">✓</span>
            <h2 className="m-0 font-display text-[26px] font-extrabold leading-8 text-[var(--sr-success)]">{XONG[xong][0]}</h2>
            <div className="max-w-[420px] text-[15px] leading-[23px]">{XONG[xong][1]}</div>
            <div className="mt-1 flex flex-wrap justify-center gap-2.5">
              <Link href="/portal/hoc-sinh/vao" className={cn(NUT_CAM, "h-[46px] text-[15px]")}>
                Cho con vào Cổng học sinh
              </Link>
              <button type="button" onClick={() => setXong(null)} className="h-[46px] rounded-xl border border-border bg-card px-[18px] text-[15px] font-bold text-foreground">
                Xong
              </button>
            </div>
          </section>
        )}

        {sinhMau && (
          <section className="flex flex-col gap-4 rounded-[22px] border border-border bg-card p-6">
            <div className="flex items-center gap-3.5">
              <span
                aria-hidden="true"
                className={cn("grid size-[52px] shrink-0 place-items-center rounded-2xl", coMa ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]" : "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]")}
              >
                <Ic d={IC.khoa} size={26} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <b className="text-lg">{coMa ? "Đã đặt mã" : "Chưa có mã"}</b>
                <span className="text-sm text-muted-foreground">
                  {coMa ? "Đã lưu · dùng chung cho cả nhà" : "Ba mẹ tạo mã ở đây, hoặc ngay khi cho con vào lần đầu"}
                </span>
              </div>
            </div>
            {!coMa ? (
              <button type="button" onClick={() => batDau("tao")} className={cn(NUT_CAM, "h-[50px] rounded-[14px] text-base")}>
                Tạo mã 4 số
              </button>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2.5">
                <button type="button" onClick={() => batDau("doi")} className="h-[46px] rounded-xl bg-[var(--sr-purple)] text-[15px] font-bold text-white">
                  Đổi mã
                </button>
                <button type="button" onClick={() => batDau("quen")} className="h-[46px] rounded-xl border border-border bg-card text-[15px] font-bold text-foreground">
                  Quên mã
                </button>
              </div>
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-[21px] text-[var(--sr-ink-body)]">
              {GHI.map((g) => (
                <li key={g} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-[var(--sr-purple)]" />
                  {g}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="ls" className="flex flex-col gap-3 rounded-[22px] border border-border bg-card p-6">
          <h2 id="ls" className="m-0 text-lg font-bold">
            Lần vào và thoát gần đây
          </h2>
          {nhatKy.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Chưa có lần nào. Mỗi lần cho con vào hay con thoát, ba mẹ thấy ở đây.</p>
          ) : (
            nhatKy.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-border px-1 py-2.5">
                <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-[15px] font-extrabold", SAC[l.sac])}>
                  {l.ky}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-sm font-semibold">{l.ten}</span>
                  <span className="text-xs text-muted-foreground">{nhanThoiGian(l.luc, bay)}</span>
                </span>
              </div>
            ))
          )}
          <div className="text-[13px] leading-[19px] text-muted-foreground">Lần nhập sai mã cũng được ghi lại để ba mẹ biết.</div>
        </section>
      </HvLuoi>
    </div>
  );
}
