"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HvBanPhim } from "@/components/portal/hv-ban-phim";
import { Avatar } from "@/components/portal/hv-shell";
import { HvDauTrang, NUT_CAM, NUT_TAT } from "@/components/portal/hv-ui";
import { Ic, IC } from "@/components/portal/hv-icon";
import { taoMaThoatAction, vaoCheDoHocSinhAction } from "@/app/(portal)/portal/hoc-sinh/actions";
import { CAU_LOI_MA, laMaDeDoan } from "@/lib/portal/hv-ma-thuan";

// Màn "Cho con vào Cổng học sinh" — artifact HV-Vao / M-HV-Vao (CHẾ ĐỘ BA MẸ). Vào = đặt cookie đã ký (xem hv-token.ts);
// CHỈ nút này vào được, và chỉ khi ba mẹ đã có mã thoát.

export type ConVao = {
  id: string;
  ten: string;
  tat: string;
  mauAv: 0 | 1 | 2;
  khoa: string | null;
  lop: string | null;
  xong: number;
  tong: number;
  viec: string;
};

const CARD = "rounded-[18px] border border-border bg-card";

function tenGoi(t: string): string {
  const w = t.trim().split(/\s+/);
  return w.length <= 2 ? t.trim() : w.slice(-2).join(" ");
}

export function HvVaoTrang({
  con,
  macDinhId,
  coMa: coMaDau,
  namSinhCon,
  namNay,
}: {
  con: ConVao[];
  macDinhId: string;
  coMa: boolean;
  namSinhCon: number[];
  namNay: number;
}) {
  const router = useRouter();
  const [chon, setChon] = useState(macDinhId);
  const [coMa, setCoMa] = useState(coMaDau);
  const [vuaTao, setVuaTao] = useState(false);
  const [buoc, setBuoc] = useState<0 | 1>(0);
  const [moi, setMoi] = useState("");
  const [loi, setLoi] = useState("");
  const [dang, bat] = useTransition();
  const c = con.find((x) => x.id === chon) ?? con[0];
  if (!c) return null;
  const ten = tenGoi(c.ten);

  const nhapMa = async (ma: string) => {
    if (buoc === 0) {
      const l = laMaDeDoan(ma, namSinhCon, namNay);
      if (l) {
        setLoi(CAU_LOI_MA[l]);
        return;
      }
      setMoi(ma);
      setLoi("");
      setBuoc(1);
      return;
    }
    if (ma !== moi) {
      setBuoc(0);
      setMoi("");
      setLoi("Hai lần nhập chưa khớp. Ba mẹ đặt lại nhé.");
      return;
    }
    const r = await taoMaThoatAction({ ma: moi, xacNhan: ma });
    setMoi("");
    if (r.ok) {
      setCoMa(true);
      setVuaTao(true);
      setBuoc(0);
      setLoi("");
      toast.success("Đã lưu mã thoát. Lần sau ba mẹ cho con vào thẳng.");
    } else {
      setBuoc(0);
      setLoi(r.error);
    }
  };

  const vao = () => {
    if (!coMa) {
      toast.error("Ba mẹ tạo mã thoát trước nhé.");
      return;
    }
    bat(async () => {
      const r = await vaoCheDoHocSinhAction(chon);
      if (r.ok) {
        router.push("/portal/hoc-sinh");
        router.refresh();
      } else toast.error(r.error);
    });
  };

  return (
    // Vỏ PHỤ HUYNH (components/portal/sr-shell.tsx) không tự xếp dọc có khoảng cách và không giới hạn bề rộng — mỗi trang tự bọc,
    // cùng khuôn với «Học phí»: cột tối đa 1160px, gap 24px. Thẻ bo 18px viền mảnh, tiêu đề mục text-xl, chip trạng thái bo tròn.
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <HvDauTrang
        nhan="DÀNH CHO BA MẸ"
        tieuDe="Cho con vào Cổng học sinh"
        phu="Chọn con, kiểm tra mã thoát rồi vào. Con dùng ngay trên tài khoản của ba mẹ, không cần tài khoản riêng."
      />

      <section aria-labelledby="b1" className="flex flex-col gap-3">
        <h2 id="b1" className="m-0 text-xl font-bold">
          Con nào sẽ học?
        </h2>
        <div role="radiogroup" aria-labelledby="b1" className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
          {con.map((x) => {
            const on = x.id === chon;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChon(x.id)}
                className={cn(
                  CARD,
                  "flex flex-col gap-3 p-5 text-left text-foreground transition-colors",
                  on ? "border-[var(--sr-purple)] bg-[var(--sr-tint-purple)] shadow-[0_0_0_1px_var(--sr-purple)]" : "hover:bg-muted/50",
                )}
              >
                <span className="flex items-center gap-3">
                  <Avatar tat={x.tat} mauAv={x.mauAv} size={48} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <b className="break-words text-[17px]">{x.ten}</b>
                    <span className="text-[13px] text-[var(--sr-ink-muted)]">{x.khoa ?? "Chưa có khoá đang học"}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "ml-auto grid size-[26px] shrink-0 place-items-center rounded-full text-sm font-extrabold text-white",
                      on ? "bg-[var(--sr-purple)]" : "border-2 border-[var(--sr-dash)]",
                    )}
                  >
                    {on ? "✓" : ""}
                  </span>
                </span>
                {(x.lop || x.tong > 0) && (
                  <span className="flex flex-wrap gap-1.5">
                    {x.lop && <span className="rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-1 text-xs font-bold text-[var(--sr-purple-text)]">{x.lop}</span>}
                    {x.tong > 0 && <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold">Buổi {x.xong}/{x.tong}</span>}
                  </span>
                )}
                <span className="text-[13px] leading-[19px] text-[var(--sr-ink-body)]">{x.viec}</span>
              </button>
            );
          })}
        </div>
      </section>

      {!coMa ? (
        <section aria-labelledby="b2" className={cn(CARD, "grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-5 border-[var(--sr-purple)] p-5")}>
          <div className="flex flex-col gap-2.5">
            <div className="text-xs font-bold tracking-[0.08em] text-[var(--sr-purple-text)]">CHỈ LÀM MỘT LẦN · BƯỚC {buoc + 1}/2</div>
            <h2 id="b2" className="m-0 text-xl font-bold leading-[27px]">
              {buoc === 0 ? "Tạo mã thoát 4 số" : "Nhập lại mã vừa tạo"}
            </h2>
            <div className="text-sm leading-[21px] text-[var(--sr-ink-muted)]">
              Mã 4 số này để về lại chế độ ba mẹ khi con học xong. Hệ thống lưu lại — những lần sau ba mẹ cho con vào thẳng, không phải tạo nữa. Mã dùng chung cho cả nhà.
            </div>
            <ul className="m-0 list-disc pl-[18px] text-[13px] leading-5 text-[var(--sr-ink-body)]">
              <li>Không dùng 1234, 0000, số lặp hay năm sinh của con.</li>
              <li>Quên mã: ba mẹ tự đặt lại bằng mật khẩu đăng nhập.</li>
            </ul>
          </div>
          <div className="flex flex-col items-center gap-3">
            {loi && (
              <div role="alert" className="order-last text-center text-sm font-semibold text-[var(--sr-bad-ink)]">
                {loi}
              </div>
            )}
            <HvBanPhim kich="vao" onXong={nhapMa} thayDoi={() => setLoi("")} />
          </div>
        </section>
      ) : null}

      {/* Thẻ hành động: con đang chọn · trạng thái mã thoát · nút vào — một chỗ, đọc từ trái sang phải. */}
      <section aria-labelledby="b3" className={cn(CARD, "flex flex-wrap items-center gap-x-5 gap-y-4 p-5")}>
        <Avatar tat={c.tat} mauAv={c.mauAv} size={52} />
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
          <h2 id="b3" className="m-0 text-xl font-bold">
            Cho {ten} vào học
          </h2>
          {coMa ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="rounded-full bg-[var(--sr-success-bg)] px-2.5 py-1 text-xs font-bold text-[var(--sr-success)]">
                  {vuaTao ? "Đã tạo và lưu mã thoát" : "Đã có mã thoát"}
                </span>
                <Link href="/portal/hoc-sinh/ma" className="text-[13px] font-semibold text-[var(--sr-purple-text)]">
                  Đổi hoặc quên mã
                </Link>
              </div>
              <p className="m-0 text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">
                Khi con học xong, bấm “Về chế độ ba mẹ” ở góc dưới menu rồi nhập mã.
              </p>
            </>
          ) : (
            <p className="m-0 text-[13px] leading-[19px] text-[var(--sr-ink-muted)]">Tạo mã thoát ở trên để mở nút này. Chỉ cần làm lần đầu.</p>
          )}
        </div>
        <button type="button" onClick={vao} disabled={dang} aria-disabled={!coMa} className={cn(coMa ? NUT_CAM : NUT_TAT, "h-[52px] gap-2.5 rounded-[14px] px-6 text-base max-[560px]:w-full")}>
          Vào Cổng học sinh của {ten}
          <Ic d={IC.tiep} size={18} />
        </button>
      </section>
    </div>
  );
}
