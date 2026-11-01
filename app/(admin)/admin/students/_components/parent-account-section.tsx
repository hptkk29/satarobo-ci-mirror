"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, CheckCircle2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { NUT_CHINH, NUT_VIEN, O_NHAP, O_VAN_BAN } from "./ho-so/o-nhap";
import { toast } from "sonner";
import {
  createParentAccount,
  resendParentActivationOtp,
  issueOfflineActivationCode,
} from "../_actions";

type Props = {
  studentId: string;
  linked: boolean;
  parentEmail: string | null;
  parentName: string | null;
  defaultEmail: string | null;
  /** AUTH-SĐT P5 — SĐT phụ huynh trên hồ sơ HV, dùng làm tài khoản đăng nhập. */
  defaultPhone: string | null;
  pendingActivation?: boolean;
};

export function ParentAccountSection({
  studentId,
  linked,
  parentEmail,
  parentName,
  defaultEmail,
  defaultPhone,
  pendingActivation,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [name, setName] = useState(parentName ?? "");

  function submit() {
    if (!phone.trim()) {
      toast.error("Nhập số điện thoại đăng nhập của phụ huynh");
      return;
    }
    startTransition(async () => {
      const res = await createParentAccount({
        studentId,
        phone: phone.trim(),
        email: email.trim() || undefined,
        name: name || undefined,
      });
      if (res.ok) {
        toast.success(
          `Đã cấp tài khoản phụ huynh · liên kết ${res.linkedCount} con` +
            (res.pendingActivation ? " · đã gửi mã kích hoạt qua Zalo" : ""),
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi cấp tài khoản");
      }
    });
  }

  // AUTH-SĐT P6-C — break-glass khi ZNS chết: mã hiện TRÊN MÀN HÌNH để nhân viên
  // đọc cho phụ huynh. Bắt buộc lý do; mã chỉ nằm trong state, không lưu ở đâu.
  const [offlineReason, setOfflineReason] = useState("");
  const [offlineCode, setOfflineCode] = useState<string | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);

  function issueOffline() {
    startTransition(async () => {
      const res = await issueOfflineActivationCode({ studentId, reason: offlineReason });
      if (res.ok && res.code) {
        setOfflineCode(res.code);
        setOfflineReason("");
        toast.success("Đã cấp mã tay — đọc cho phụ huynh, mã chỉ hiện một lần.");
      } else toast.error(res.error ?? "Không cấp được mã");
    });
  }

  function resend() {
    startTransition(async () => {
      const res = await resendParentActivationOtp(studentId);
      if (res.ok) {
        // warning = OTP đã tạo nhưng email chưa gửi được (vd dev thiếu API key).
        if (res.warning) toast.warning(res.warning);
        else toast.success("Đã gửi lại mã kích hoạt cho phụ huynh (Zalo hoặc email)");
      } else toast.error(res.error ?? "Lỗi gửi lại mã");
    });
  }

  // 25/09/2026 — chỉ ĐỔI VỎ: khung ở cột phải hồ sơ (cùng vỏ với "Lead nguồn"). Ô nhập xếp
  // theo bề ngang KHUNG (`@container`), không theo cửa sổ: ở cột phải 380px mà dùng `sm:`
  // thì hai ô ~160px đứng cạnh nhau. Logic, điều kiện hiện và action giữ nguyên.
  return (
    <section
      aria-labelledby="tk-phu-huynh"
      className="@container rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <KeyRound className="size-4 text-primary" aria-hidden />
        <h2 id="tk-phu-huynh" className="text-sm font-semibold text-foreground">
          Tài khoản phụ huynh
        </h2>
      </div>

      <div className="p-4">
        {linked ? (
          <div
            className={cn(
              "rounded-lg p-3 text-sm",
              pendingActivation
                ? "bg-state-warning-soft text-state-warning-ink"
                : "bg-state-success-soft text-state-success-ink",
            )}
          >
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 break-words leading-relaxed">
                Đã liên kết tài khoản phụ huynh
                {parentEmail && <span className="font-semibold"> ({parentEmail})</span>}.{" "}
                {pendingActivation ? (
                  <>
                    Tài khoản <b>đang chờ kích hoạt</b> — phụ huynh nhập mã nhận qua Zalo (hoặc
                    email) để đặt mật khẩu.
                  </>
                ) : (
                  <>
                    Phụ huynh đăng nhập tại <span className="font-medium">hocvien.satarobo.vn</span>{" "}
                    để xem &quot;site con&quot;.
                  </>
                )}
              </div>
            </div>
            {pendingActivation && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resend}
                    disabled={pending}
                    className={cn(
                      NUT_VIEN,
                      "border-state-warning text-state-warning-ink hover:bg-state-warning-soft",
                    )}
                  >
                    <Send className="size-4" aria-hidden />
                    {pending ? "Đang gửi…" : "Gửi lại mã kích hoạt"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOfflineOpen((v) => !v)}
                    aria-expanded={offlineOpen}
                    className={cn(
                      NUT_VIEN,
                      "border-state-warning text-state-warning-ink hover:bg-state-warning-soft",
                    )}
                  >
                    <KeyRound className="size-4" aria-hidden />
                    Cấp mã tại quầy
                  </button>
                </div>

                {offlineOpen && (
                  <div className="space-y-2 rounded-lg bg-card p-3">
                    <p className="text-xs leading-relaxed text-state-warning-ink">
                      Dùng khi <b>Zalo không gửi được</b> và phụ huynh đang ở quầy. Mã hiện{" "}
                      <b>một lần trên màn hình</b> để đọc trực tiếp — hệ thống không gửi đi đâu và
                      không lưu lại mã. Thao tác này <b>được ghi nhật ký kèm lý do</b>.
                    </p>
                    <label htmlFor="ly-do-ma-tay" className="sr-only">
                      Lý do cấp mã tay
                    </label>
                    <textarea
                      id="ly-do-ma-tay"
                      value={offlineReason}
                      onChange={(e) => setOfflineReason(e.target.value)}
                      rows={2}
                      placeholder="Lý do cấp mã tay (bắt buộc, ≥ 10 ký tự) — vd: phụ huynh không dùng Zalo, đang ở quầy CS1"
                      className={O_VAN_BAN}
                    />
                    <button
                      type="button"
                      onClick={issueOffline}
                      disabled={pending || offlineReason.trim().length < 10}
                      className={cn(NUT_CHINH, "bg-state-warning-ink hover:bg-state-warning-ink-hover")}
                    >
                      {pending ? "Đang cấp…" : "Cấp mã"}
                    </button>

                    {offlineCode && (
                      <div className="rounded-lg bg-state-warning-soft p-3 text-center">
                        <div className="text-xs font-medium text-state-warning-ink">
                          Đọc mã này cho phụ huynh (hết hạn theo cấu hình OTP):
                        </div>
                        <div className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-state-warning-ink">
                          {offlineCode}
                        </div>
                        <button
                          type="button"
                          onClick={() => setOfflineCode(null)}
                          className="mt-2 inline-flex h-8 items-center text-xs font-semibold text-state-warning-ink underline"
                        >
                          Ẩn mã
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Tạo tài khoản đăng nhập portal cho phụ huynh. Tài khoản là <b>số điện thoại</b>; hệ
              thống gửi mã kích hoạt qua <b>Zalo</b> để phụ huynh tự đặt mật khẩu (không đặt mật
              khẩu tạm). Các con cùng số điện thoại phụ huynh sẽ được liên kết tự động.
            </p>
            <div className="grid gap-3 @md:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Số điện thoại đăng nhập (nhận mã kích hoạt) *
                </span>
                <input
                  type="text"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={inputCls}
                  placeholder="0905123456"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Email <span className="font-normal">(không bắt buộc)</span>
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputCls}
                  placeholder="Kênh dự phòng khi Zalo không tới"
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Tên phụ huynh
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  placeholder="Tên hiển thị"
                />
              </label>
            </div>
            <button type="button" onClick={submit} disabled={pending} className={NUT_CHINH}>
              {pending ? "Đang tạo…" : "Cấp tài khoản phụ huynh"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

const inputCls = O_NHAP;
