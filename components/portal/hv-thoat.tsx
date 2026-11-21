"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HvBanPhim } from "@/components/portal/hv-ban-phim";
import { Ic, IC } from "@/components/portal/hv-icon";
import { thoatBangMatKhauAction, thoatCheDoHocSinhAction } from "@/app/(portal)/portal/hoc-sinh/actions";
import { dongHoKhoa } from "@/lib/portal/hv-ma-thuan";

// Màn "Về chế độ ba mẹ" — artifact HV-Thoat / M-HV-Thoat (CHẾ ĐỘ HỌC SINH, toàn màn nền tím).
// Thoát CHỈ qua `thoatCheDoHocSinhAction` (kiểm mã + đếm sai + khoá phía MÁY CHỦ). Đồng hồ khoá ở đây chỉ là hiển thị — hết giờ
// hiển thị mà máy chủ còn khoá thì lần nhập kế vẫn bị từ chối.

export function HvThoatTrang({ giayKhoaDau, coMatKhau }: { giayKhoaDau: number; coMatKhau: boolean }) {
  const router = useRouter();
  const [khoa, setKhoa] = useState(giayKhoaDau);
  const [loi, setLoi] = useState("");
  const [quen, setQuen] = useState(false);
  const [mk, setMk] = useState("");
  const [dang, bat] = useTransition();

  const dangKhoa = khoa > 0;
  useEffect(() => {
    if (!dangKhoa) return;
    const t = setInterval(() => setKhoa((g) => Math.max(0, g - 1)), 1000);
    return () => clearInterval(t);
  }, [dangKhoa]);

  const xong = async (ma: string) => {
    const r = await thoatCheDoHocSinhAction(ma);
    if (r.ok) {
      router.push("/portal");
      router.refresh();
      return;
    }
    if (r.khoaGiay) setKhoa(r.khoaGiay);
    setLoi(r.khoaGiay ? "" : r.error);
  };

  const thoatMatKhau = () =>
    bat(async () => {
      const r = await thoatBangMatKhauAction(mk);
      setMk("");
      if (r.ok) {
        router.push("/portal/hoc-sinh/ma?quen=1");
        router.refresh();
      } else setLoi(r.error);
    });

  const biKhoa = dangKhoa;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--sr-purple)] p-6 text-foreground">
      <section className="flex w-full max-w-[400px] flex-col items-center gap-4 rounded-[28px] bg-card p-7 text-center">
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-[18px] bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]">
          <Ic d={IC.khoa} size={26} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-2xl font-extrabold leading-[30px]">Về chế độ ba mẹ</h1>
          <div className="text-sm leading-[21px] text-muted-foreground">
            Ba mẹ nhập mã 4 số đã tạo lúc cho con vào lần đầu. Em đưa máy cho ba mẹ nhé!
          </div>
        </div>
        {!quen && !biKhoa && <HvBanPhim kich="thoat" onXong={xong} thayDoi={() => setLoi("")} />}
        {loi && !biKhoa && (
          <div role="alert" className="text-sm font-semibold text-[var(--sr-bad-ink)]">
            {loi}
          </div>
        )}
        {biKhoa && (
          <div className="flex flex-col gap-1 rounded-2xl bg-[var(--sr-bad-bg)] p-4 text-sm leading-[21px]">
            <b className="text-lg text-[var(--sr-bad-ink)]">Tạm khoá {dongHoKhoa(khoa)}</b>
            Nhập sai 5 lần. Đã báo vào chuông thông báo của ba mẹ. Thử lại sau 5 phút, hoặc ba mẹ đặt lại mã bằng mật khẩu đăng nhập.
          </div>
        )}
        {!quen ? (
          <button type="button" onClick={() => setQuen(true)} className="border-0 bg-transparent p-0 text-sm font-semibold text-[var(--sr-purple-text)]">
            Ba mẹ quên mã? Đặt lại bằng mật khẩu đăng nhập
          </button>
        ) : (
          <div className="flex w-full flex-col gap-2.5 text-left">
            {coMatKhau ? (
              <>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Mật khẩu đăng nhập của ba mẹ
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={mk}
                    onChange={(e) => setMk(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && mk && thoatMatKhau()}
                    className="h-12 rounded-xl border border-[var(--sr-dash)] bg-card px-3.5 text-base font-normal text-foreground"
                  />
                </label>
                {loi && (
                  <div role="alert" className="text-sm font-semibold text-[var(--sr-bad-ink)]">
                    {loi}
                  </div>
                )}
                <button type="button" disabled={dang || !mk} onClick={thoatMatKhau} className="h-12 rounded-xl bg-[var(--sr-purple)] text-[15px] font-bold text-white disabled:opacity-60">
                  {dang ? "Đang kiểm tra…" : "Xác minh và đặt lại mã"}
                </button>
              </>
            ) : (
              <div className="rounded-xl bg-[var(--sr-tint-orange)] p-3.5 text-sm leading-[21px]">
                Tài khoản này chưa có mật khẩu đăng nhập. Gọi <a href="tel:0837312860" className="font-bold text-[var(--sr-purple-text)]">0837.312.860</a> để được hỗ trợ.
              </div>
            )}
            <button type="button" onClick={() => setQuen(false)} className="border-0 bg-transparent p-0 text-center text-sm font-semibold text-muted-foreground">
              Quay lại nhập mã
            </button>
          </div>
        )}
        <Link href="/portal/hoc-sinh" className="text-sm font-semibold text-muted-foreground no-underline">
          Quay lại học tiếp
        </Link>
      </section>
    </div>
  );
}
