"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  UserRound,
  Phone,
  Mail,
  MapPin,
  Save,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  ChevronRight,
  UsersRound,
  BookOpenText,
  type LucideIcon,
} from "lucide-react";
import type { ParentProfile, ProfileChild } from "@/lib/portal/parent-profile";
import {
  updateParentProfile,
  changeParentPassword,
  requestParentPhoneChangeOtp,
  confirmParentPhoneChangeAction,
} from "@/app/(portal)/portal/ho-so/actions";
import { ChildDetailLink } from "@/components/portal/child-detail-link";

const AVATAR = ["bg-accent", "bg-sky-500", "bg-violet-500", "bg-emerald-500"];

function Field({
  icon: Icon,
  label,
  ...props
}: {
  icon: LucideIcon;
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary/60">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <input
          {...props}
          className="w-full bg-transparent py-2.5 text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground disabled:text-muted-foreground"
        />
      </span>
    </label>
  );
}

export function HoSoPageV2({ profile }: { profile: ParentProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  // P6 — chỉ đọc: SĐT đăng nhập đổi qua OTP, không phải bằng ô nhập hồ sơ.
  const phone = profile.phone ?? "";
  const [address, setAddress] = useState(profile.address ?? "");
  const [p2Name, setP2Name] = useState(profile.parent2Name ?? "");
  const [p2Phone, setP2Phone] = useState(profile.parent2Phone ?? "");
  const [savingProfile, startProfile] = useTransition();

  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cf, setCf] = useState("");
  const [savingPw, startPw] = useTransition();

  // AUTH-SĐT P6 — đổi SĐT đăng nhập: 2 bước, mã gửi tới SỐ MỚI (bằng chứng đang
  // cầm số đó). Gửi tới số cũ chỉ chứng minh cái đã biết.
  const [newPhone, setNewPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"idle" | "verify">("idle");
  const [savingPhone, startPhone] = useTransition();

  function sendPhoneOtp() {
    startPhone(async () => {
      const res = await requestParentPhoneChangeOtp(newPhone);
      if (res.ok) {
        toast.success("Đã gửi mã tới số mới qua Zalo.");
        setPhoneStep("verify");
      } else toast.error(res.error ?? "Lỗi gửi mã");
    });
  }

  function confirmPhone() {
    startPhone(async () => {
      const res = await confirmParentPhoneChangeAction({
        newPhone,
        code: phoneCode,
      });
      if (res.ok) {
        toast.success("Đã đổi số điện thoại đăng nhập.");
        setPhoneStep("idle");
        setNewPhone("");
        setPhoneCode("");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi đổi số điện thoại");
    });
  }

  function saveProfile() {
    startProfile(async () => {
      // `phone` KHÔNG gửi lên nữa — server bỏ qua nó (xem updateParentProfile).
      const res = await updateParentProfile({
        name,
        address,
        parent2Name: p2Name,
        parent2Phone: p2Phone,
      });
      if (res.ok) {
        toast.success("Đã lưu hồ sơ");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi lưu hồ sơ");
    });
  }
  function savePw() {
    startPw(async () => {
      const res = await changeParentPassword({
        currentPassword: cur,
        newPassword: nw,
        confirmPassword: cf,
      });
      if (res.ok) {
        toast.success("Đã đổi mật khẩu");
        setCur("");
        setNw("");
        setCf("");
      } else toast.error(res.error ?? "Lỗi đổi mật khẩu");
    });
  }

  const pwCls =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium text-foreground outline-none focus:border-primary/60";

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Hồ sơ gia đình
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quản lý thông tin liên hệ của phụ huynh và hồ sơ các con liên kết.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Cột chính */}
        <div className="space-y-5">
          {/* Phụ huynh đại diện */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-2 bg-neutral-900 px-5 py-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                Phụ huynh đại diện
              </h2>
              <span className="text-xs font-bold tracking-wider text-primary">
                MÃ HỘ: {profile.familyCode}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  icon={UserRound}
                  label="Họ và tên"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Họ và tên phụ huynh"
                />
                {/* AUTH-SĐT P6 — SĐT là ĐỊNH DANH ĐĂNG NHẬP nên chỉ đọc ở đây.
                    Trước P6 ô này gõ tự do rồi ghi đè xuống mọi Student, làm
                    `User.phone` và `Student.parentPhone` trôi lệch (sai gộp anh
                    chị em, sai người nhận ZNS điểm danh). Đổi số đi qua OTP ở
                    khối bên dưới. */}
                <Field
                  icon={Phone}
                  label="Số điện thoại (đăng nhập)"
                  value={phone || "— chưa có —"}
                  disabled
                />
              </div>
              <Field
                icon={Mail}
                label="Email (kênh dự phòng)"
                value={profile.email || "— chưa có —"}
                disabled
              />
              <Field
                icon={MapPin}
                label="Địa chỉ liên hệ"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Địa chỉ liên hệ"
              />
            </div>
          </section>

          {/* AUTH-SĐT P6 — đổi SĐT đăng nhập, có kiểm soát bằng OTP */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
              <Phone className="size-4 text-primary" /> Đổi số điện thoại đăng
              nhập
            </h2>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              Mã xác thực gửi tới{" "}
              <strong className="font-semibold">số mới</strong> — quý phụ huynh
              cần đang giữ số đó. Sau khi đổi, đăng nhập bằng số mới.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input
                type="text"
                inputMode="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                disabled={phoneStep === "verify" || savingPhone}
                placeholder="Số điện thoại mới"
                className={pwCls}
              />
              {phoneStep === "verify" && (
                <input
                  inputMode="numeric"
                  value={phoneCode}
                  onChange={(e) =>
                    setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="Mã 6 số vừa nhận"
                  className={`${pwCls} tracking-[0.3em]`}
                />
              )}
            </div>
            {phoneStep === "idle" ? (
              <button
                onClick={sendPhoneOtp}
                disabled={savingPhone || !newPhone.trim()}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {savingPhone ? "Đang gửi…" : "Gửi mã tới số mới"}
              </button>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={confirmPhone}
                  disabled={savingPhone || phoneCode.length !== 6}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {savingPhone ? "Đang đổi…" : "Xác nhận đổi số"}
                </button>
                <button
                  onClick={() => {
                    setPhoneStep("idle");
                    setPhoneCode("");
                  }}
                  disabled={savingPhone}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  Huỷ
                </button>
              </div>
            )}
          </section>

          {/* Phụ huynh thứ hai */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
              <UsersRound className="size-4 text-primary" /> Phụ huynh thứ hai{" "}
              <span className="font-normal text-muted-foreground">
                (tùy chọn)
              </span>
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                icon={UserRound}
                label="Họ và tên"
                value={p2Name}
                onChange={(e) => setP2Name(e.target.value)}
                placeholder="Chưa cập nhật"
              />
              <Field
                icon={Phone}
                label="Số điện thoại"
                value={p2Phone}
                onChange={(e) => setP2Phone(e.target.value)}
                placeholder="Chưa cập nhật"
              />
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-sm text-muted-foreground">
              Thông tin này dùng để đối soát danh tính khi xin học bù hoặc nhận
              thông báo.
            </p>
            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Save className="size-4" />{" "}
              {savingProfile ? "Đang lưu…" : "Lưu hồ sơ"}
            </button>
          </div>

          {/* Đổi mật khẩu */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
              <KeyRound className="size-4 text-primary" /> Đổi mật khẩu
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-muted-foreground">
                  Mật khẩu hiện tại
                </span>
                <input
                  type="password"
                  value={cur}
                  onChange={(e) => setCur(e.target.value)}
                  className={pwCls}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-muted-foreground">
                  Mật khẩu mới
                </span>
                <input
                  type="password"
                  value={nw}
                  onChange={(e) => setNw(e.target.value)}
                  className={pwCls}
                  placeholder="≥ 8 ký tự"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-muted-foreground">
                  Xác nhận mật khẩu
                </span>
                <input
                  type="password"
                  value={cf}
                  onChange={(e) => setCf(e.target.value)}
                  className={pwCls}
                />
              </label>
            </div>
            <button
              onClick={savePw}
              disabled={savingPw}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              <KeyRound className="size-4" />{" "}
              {savingPw ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
            </button>
          </section>

          {/* Hướng dẫn sử dụng — lối vào bộ tài liệu hướng dẫn từng trang của cổng */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
              <BookOpenText className="size-4 text-primary" /> Hướng dẫn sử dụng
            </h2>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-md text-sm text-muted-foreground">
                Tài liệu hướng dẫn chi tiết từng trang của cổng phụ huynh — chia
                theo nhóm chức năng, kèm các bước thao tác và đường dẫn mở thẳng
                trang.
              </p>
              <Link
                href="/portal/huong-dan"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
              >
                Mở hướng dẫn <ChevronRight className="size-4" />
              </Link>
            </div>
          </section>
        </div>

        {/* Sidebar học sinh liên kết */}
        <aside className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Học sinh liên kết ({profile.children.length})
          </h2>
          {profile.children.map((c, i) => (
            <ChildCard key={c.id} child={c} color={AVATAR[i % AVATAR.length]} />
          ))}
        </aside>
      </div>
    </div>
  );
}

function ChildCard({ child, color }: { child: ProfileChild; color: string }) {
  const sub = [
    child.className,
    child.grade != null ? `Lớp ${child.grade}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={`rounded-2xl border bg-card p-4 ${child.active ? "border-primary/40 ring-1 ring-primary/20" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white ${color}`}
        >
          {child.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-bold text-foreground">{child.name}</p>
            {child.active && (
              <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                Đang chọn
              </span>
            )}
          </div>
          {sub && (
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              {sub}
            </p>
          )}
        </div>
      </div>

      {child.mediaConsent ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-xs font-semibold text-success">
          <ShieldCheck className="size-4 shrink-0" /> Đã đồng ý sử dụng hình ảnh
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 rounded-xl bg-caution/10 px-3 py-2 text-xs font-semibold text-caution">
            <TriangleAlert className="size-4 shrink-0" /> Chưa đồng ý hình ảnh
          </div>
          <Link
            href="/portal/hinh-anh"
            className="block px-1 text-xs font-bold text-primary hover:underline"
          >
            Yêu cầu cập nhật đồng ý
          </Link>
        </div>
      )}

      <ChildDetailLink
        studentId={child.id}
        className="mt-3 flex w-full items-center justify-between border-t border-border pt-3 text-sm font-bold text-foreground hover:text-primary disabled:opacity-60"
      >
        Xem hồ sơ chi tiết <ChevronRight className="size-4" />
      </ChildDetailLink>
    </div>
  );
}
