"use client";

import { NoiDungTrong } from "@/components/portal/sticker";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { BookOpenText, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParentProfile, ProfileChild } from "@/lib/portal/parent-profile";
import {
  updateParentProfile,
  changeParentPassword,
  requestParentPhoneChangeOtp,
  confirmParentPhoneChangeAction,
} from "@/app/(portal)/portal/ho-so/actions";
import { ChildDetailLink } from "@/components/portal/child-detail-link";
import { useSetActiveSite } from "@/components/portal/use-set-active-site";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// Cổng phụ huynh — "Hồ sơ gia đình", dựng theo artifact Ho-so.dc.html. Mọi nút gọi ĐÚNG server action có sẵn.
// KHÔNG vẽ (chưa có nơi lưu): khối "Người được đón con", ô "Cho người này đăng nhập xem thông tin của con", công tắc "Cho phép dùng hình ảnh"
// (đồng ý hình ảnh đổi qua YÊU CẦU để trung tâm xử lý — NĐ 13/2023 — nên chỉ hiện trạng thái + lối gửi yêu cầu), danh sách "Thiết bị đang đăng nhập".

const CARD = "rounded-[20px] border border-border bg-card";
const O_NHAP = "h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[15px] font-normal text-[var(--sr-ink)] outline-none focus:border-[var(--sr-purple)] disabled:bg-background disabled:text-[var(--sr-ink-muted)]";
const NHAN_O = "flex flex-col gap-1.5 text-[13px] font-semibold";

function TheCon({ c }: { c: ProfileChild }) {
  const { pending, switchTo } = useSetActiveSite();
  const truong = [c.school, c.grade != null ? `Lớp ${c.grade}` : null].filter(Boolean).join(" · ");
  const dong: [string, string | null][] = [
    ["Khoá", c.courseName],
    ["Lớp", c.classCode ?? c.className],
    ["Cơ sở", c.centerName],
    ["Trường đang học", truong || null],
  ];
  return (
    <article className={cn(CARD, "flex min-w-0 flex-col gap-3.5 p-5", c.active ? "border-[var(--sr-purple)]" : "")}>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className={cn("flex size-[52px] flex-none items-center justify-center rounded-full text-[17px] font-bold", c.active ? "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]" : "bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]")}
        >
          {c.initials}
        </span>
        <div className="flex min-w-0 flex-[1_1_auto] flex-col gap-0.5">
          <div className="break-words text-[17px] font-bold leading-snug">{c.name}</div>
          <div className="text-[13px] text-[var(--sr-ink-muted)]">{c.studentCode ? `Mã học viên ${c.studentCode}` : "Chưa có mã học viên"}</div>
        </div>
        <span className={cn("flex-none rounded-full px-2.5 py-1 text-xs font-bold", c.className ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]" : "bg-[var(--sr-tint-orange)] text-[var(--sr-ink)]")}>
          {c.className ? "Đang học" : "Chưa vào lớp"}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {dong.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--sr-ink-muted)]">{k}</dt>
            <dd className="m-0 break-words">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1 rounded-xl bg-[var(--sr-tint-purple)] px-3.5 py-3 text-sm">
        <span className="font-semibold">Dùng hình ảnh của con trong Góc sản phẩm và tin của trung tâm</span>
        <span className={cn("text-xs font-semibold", c.mediaConsent ? "text-[var(--sr-success)]" : "text-[var(--sr-orange-text)]")}>
          {c.mediaConsent ? "Ba mẹ đã đồng ý" : "Ba mẹ chưa đồng ý"}
        </span>
        <Link href="/portal/hinh-anh" className="text-xs font-semibold text-[var(--sr-purple-text)] hover:underline">
          {c.mediaConsent ? "Đổi quyền dùng hình ảnh" : "Gửi yêu cầu cập nhật đồng ý"}
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChildDetailLink studentId={c.id} className="text-sm font-semibold text-[var(--sr-purple-text)] hover:underline disabled:opacity-60">
          Xem hồ sơ chi tiết
        </ChildDetailLink>
        <button
          type="button"
          disabled={pending}
          onClick={() => switchTo(c.id, { onSuccess: (r) => { r.push("/portal/hoc-sinh/vao"); r.refresh(); } })}
          className="text-sm font-semibold text-[var(--sr-purple-text)] hover:underline disabled:opacity-60"
        >
          Cho {c.name.split(/\s+/).slice(-1)[0]} vào Cổng học sinh
        </button>
      </div>
    </article>
  );
}

export function HoSoPhuHuynh({ profile }: { profile: ParentProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const phone = profile.phone ?? "";
  const [address, setAddress] = useState(profile.address ?? "");
  const [p2Name, setP2Name] = useState(profile.parent2Name ?? "");
  const [p2Phone, setP2Phone] = useState(profile.parent2Phone ?? "");
  const [luu, startLuu] = useTransition();

  // AUTH-SĐT P6 — đổi SĐT đăng nhập: 2 bước, mã gửi tới SỐ MỚI (bằng chứng đang cầm số đó).
  const [moDoiSo, setMoDoiSo] = useState(false);
  const [soMoi, setSoMoi] = useState("");
  const [ma, setMa] = useState("");
  const [buoc, setBuoc] = useState<"nhap" | "xacnhan">("nhap");
  const [doiSo, startDoiSo] = useTransition();

  const [moMk, setMoMk] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [doiMk, startDoiMk] = useTransition();

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">MÃ GIA ĐÌNH {profile.familyCode}</div>
          <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Hồ sơ gia đình</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/portal/huong-dan" className="flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold hover:bg-[var(--sr-tint-purple)]">
            <BookOpenText className="size-4" aria-hidden="true" />
            Hướng dẫn dùng cổng phụ huynh
          </Link>
          <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="flex h-11 items-center gap-2 rounded-xl bg-[var(--sr-orange)] px-4 text-sm font-bold text-[var(--sr-on-orange)]">
            <Phone className="size-4" aria-hidden="true" />
            Gọi hotline {SATA_ROBO_PHONE.hien}
          </a>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Các con</h2>
        {profile.children.length === 0 ? (
          <NoiDungTrong ten="chao" className="rounded-[20px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">Chưa có học viên nào liên kết với tài khoản này.</NoiDungTrong>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
            {profile.children.map((c) => (
              <TheCon key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-4">
        <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
          <h2 className="text-lg font-bold">Ba mẹ</h2>
          <label className={NHAN_O}>
            Họ tên phụ huynh chính
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={O_NHAP} />
          </label>
          <div className={NHAN_O}>
            Số điện thoại đăng nhập
            <div className="flex gap-2">
              <span className="flex h-11 min-w-0 flex-1 items-center rounded-[10px] border border-border bg-background px-3 text-[15px] font-normal">{phone || "— chưa có —"}</span>
              <button
                type="button"
                onClick={() => setMoDoiSo((v) => !v)}
                aria-expanded={moDoiSo}
                className="h-11 rounded-[10px] border border-border bg-card px-3.5 text-[13px] font-semibold"
              >
                Đổi số
              </button>
            </div>
          </div>
          {moDoiSo ? (
            <div className="flex flex-col gap-2.5 rounded-xl bg-[var(--sr-tint-purple)] p-3.5">
              <p className="text-xs leading-[18px]">
                Mã xác thực gửi tới <b>số mới</b> qua Zalo — ba mẹ cần đang giữ số đó. Sau khi đổi, đăng nhập bằng số mới.
              </p>
              <input
                type="text"
                inputMode="tel"
                value={soMoi}
                onChange={(e) => setSoMoi(e.target.value)}
                disabled={buoc === "xacnhan" || doiSo}
                placeholder="Số điện thoại mới"
                className={O_NHAP}
              />
              {buoc === "xacnhan" ? (
                <input
                  inputMode="numeric"
                  value={ma}
                  onChange={(e) => setMa(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Mã 6 số vừa nhận"
                  className={cn(O_NHAP, "tracking-[0.3em]")}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {buoc === "nhap" ? (
                  <button
                    type="button"
                    disabled={doiSo || !soMoi.trim()}
                    onClick={() =>
                      startDoiSo(async () => {
                        const r = await requestParentPhoneChangeOtp(soMoi);
                        if (r.ok) {
                          toast.success("Đã gửi mã tới số mới qua Zalo.");
                          setBuoc("xacnhan");
                        } else toast.error(r.error ?? "Lỗi gửi mã");
                      })
                    }
                    className="h-10 rounded-[10px] bg-[var(--sr-purple)] px-4 text-[13px] font-bold text-white disabled:opacity-60"
                  >
                    {doiSo ? "Đang gửi…" : "Gửi mã tới số mới"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={doiSo || ma.length !== 6}
                      onClick={() =>
                        startDoiSo(async () => {
                          const r = await confirmParentPhoneChangeAction({ newPhone: soMoi, code: ma });
                          if (r.ok) {
                            toast.success("Đã đổi số điện thoại đăng nhập.");
                            setBuoc("nhap");
                            setSoMoi("");
                            setMa("");
                            setMoDoiSo(false);
                            router.refresh();
                          } else toast.error(r.error ?? "Lỗi đổi số điện thoại");
                        })
                      }
                      className="h-10 rounded-[10px] bg-[var(--sr-purple)] px-4 text-[13px] font-bold text-white disabled:opacity-60"
                    >
                      {doiSo ? "Đang đổi…" : "Xác nhận đổi số"}
                    </button>
                    <button type="button" disabled={doiSo} onClick={() => { setBuoc("nhap"); setMa(""); }} className="h-10 rounded-[10px] border border-border bg-card px-4 text-[13px] font-semibold">
                      Huỷ
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}
          <label className={NHAN_O}>
            Email (kênh dự phòng)
            <input type="text" value={profile.email || "— chưa có —"} disabled className={O_NHAP} />
          </label>
          <label className={NHAN_O}>
            Địa chỉ liên hệ
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Địa chỉ liên hệ" className={O_NHAP} />
          </label>
          <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
            <div className="text-sm font-bold">Phụ huynh thứ hai <span className="font-normal text-[var(--sr-ink-muted)]">(không bắt buộc)</span></div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-2">
              <label className={NHAN_O}>Họ tên<input type="text" value={p2Name} onChange={(e) => setP2Name(e.target.value)} className={O_NHAP} /></label>
              <label className={NHAN_O}>Số điện thoại<input type="tel" value={p2Phone} onChange={(e) => setP2Phone(e.target.value)} className={O_NHAP} /></label>
            </div>
          </div>
          <p className="text-xs leading-[18px] text-[var(--sr-ink-muted)]">Thông tin này dùng để đối soát danh tính khi xin học bù hoặc nhận thông báo.</p>
          <button
            type="button"
            disabled={luu}
            onClick={() =>
              startLuu(async () => {
                const r = await updateParentProfile({ name, address, parent2Name: p2Name, parent2Phone: p2Phone });
                if (r.ok) {
                  toast.success("Đã lưu hồ sơ");
                  router.refresh();
                } else toast.error(r.error ?? "Lỗi lưu hồ sơ");
              })
            }
            className="h-11 self-start rounded-xl bg-[var(--sr-purple)] px-[18px] text-sm font-bold text-white disabled:opacity-70"
          >
            {luu ? "Đang lưu…" : "Lưu"}
          </button>
        </article>

        <article className={cn(CARD, "flex flex-col gap-3 p-[22px]")}>
          <h2 className="text-lg font-bold">Đăng nhập &amp; bảo mật</h2>
          <div className="flex items-center justify-between gap-2.5 text-sm">
            <span>Mật khẩu</span>
            <button
              type="button"
              onClick={() => setMoMk((v) => !v)}
              aria-expanded={moMk}
              className="h-9 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold"
            >
              Đổi mật khẩu
            </button>
          </div>
          {moMk ? (
            <form
              className="flex flex-col gap-2.5 rounded-xl bg-[var(--sr-tint-purple)] p-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                startDoiMk(async () => {
                  const r = await changeParentPassword({ currentPassword: cur, newPassword: nw, confirmPassword: cf });
                  if (r.ok) {
                    toast.success("Đã đổi mật khẩu");
                    setCur("");
                    setNw("");
                    setCf("");
                    setMoMk(false);
                  } else toast.error(r.error ?? "Lỗi đổi mật khẩu");
                });
              }}
            >
              <label className={NHAN_O}>Mật khẩu hiện tại<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" className={O_NHAP} /></label>
              <label className={NHAN_O}>Mật khẩu mới<input type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" placeholder="≥ 8 ký tự" className={O_NHAP} /></label>
              <label className={NHAN_O}>Xác nhận mật khẩu<input type="password" value={cf} onChange={(e) => setCf(e.target.value)} autoComplete="new-password" className={O_NHAP} /></label>
              <div>
                <button type="submit" disabled={doiMk} className="h-10 rounded-[10px] bg-[var(--sr-purple)] px-4 text-[13px] font-bold text-white disabled:opacity-60">
                  {doiMk ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
                </button>
              </div>
            </form>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border pt-3 text-sm">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>Mã thoát Cổng học sinh</span>
              <span className="text-xs text-muted-foreground">Mã 4 số để về chế độ ba mẹ sau khi con dùng máy</span>
            </span>
            <Link
              href="/portal/hoc-sinh/ma"
              className="flex h-9 items-center rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground no-underline"
            >
              Tạo / đổi mã
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
