"use client";

import { canonicalPhone, isValidPhoneVN } from "@/lib/phone";
import { readAttribution } from "@/lib/marketing/attribution";

import { useState, useEffect, useRef } from "react";
import { X, Phone, Loader2 } from "lucide-react";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { toast } from "sonner";
import { OTichChinhSach } from "@/components/public/o-tich-chinh-sach";

type ConsultModalProps = {
  open: boolean;
  onClose: () => void;
  courseSlug: string; // VD: "sata1"
  courseName: string; // VD: "Sata1 - Robosim Master"
  courseDisplayName?: string; // VD: "Robosim Master"
};

export function ConsultModal({
  open,
  onClose,
  courseSlug,
  courseName,
  courseDisplayName,
}: ConsultModalProps) {
  const [parentName, setParentName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [childName, setChildName] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  // Hồ sơ BCT mục 3 — ô tích RIÊNG cho Chính sách bảo mật. Phải tách khỏi ô marketing
  // ở trên: hai ô trả lời hai câu hỏi khác nhau, gộp là bắt người dùng đánh đổi.
  const [dongYCsbm, setDongYCsbm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [honeypot, setHoneypot] = useState(""); // bot trap
  const openTimestamp = useRef<number>(0);

  // Reset form khi mở
  useEffect(() => {
    if (open) {
      openTimestamp.current = Date.now();
      setParentName("");
      setPhone("");
      setEmail("");
      setChildName("");
      setPreferredTime("");
      setDongYCsbm(false);
      setHoneypot("");
    }
  }, [open]);

  // ESC để đóng
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!parentName.trim()) {
      toast.error("Vui lòng nhập tên phụ huynh");
      return;
    }
    // AUTH-SĐT P1 — kiểm bằng đúng luật của server (`lib/phone.ts`). Luật client
    // cũ `/^[0-9+\s-]{9,15}$/` lỏng hơn server rất nhiều: `"+++++++++"` qua được
    // ở đây rồi bị server chặn 400 — người dùng chỉ thấy "Lỗi hệ thống".
    if (!isValidPhoneVN(phone)) {
      toast.error("Số điện thoại không hợp lệ (VD: 0912345678)");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Email không hợp lệ");
      return;
    }

    setSubmitting(true);
    const timeOnPage = Math.floor(
      (Date.now() - openTimestamp.current) / 1000,
    );
    const eventId = `consult-${courseSlug}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const noteParts = [
      `[TƯ VẤN TỪ TRANG /khoa-hoc/${courseSlug}]`,
      `Khóa quan tâm: ${courseName}`,
    ];
    if (preferredTime.trim())
      noteParts.push(`Thời gian muốn liên hệ: ${preferredTime.trim()}`);
    const note = noteParts.join("\n");

    const payload = {
      parentName: parentName.trim(),
      phone: canonicalPhone(phone) ?? phone.trim(),
      email: email.trim() || undefined,
      childName: childName.trim() || undefined,
      source: courseSlug,
      note,
      // Một lượt đồng ý: tích ô Chính sách bảo mật là đồng ý cả việc nhận tin tư vấn.
      consentMarketing: dongYCsbm,
      dongYChinhSachBaoMat: dongYCsbm as true,
      eventId,
      landingPage:
        typeof window !== "undefined" ? window.location.href : undefined,
      referrer:
        typeof document !== "undefined" ? document.referrer : undefined,
      // Nguồn khách đã giữ từ lúc vào site (?ref= affiliate + UTM + click-id).
      // Trước đây form không gửi gì nên `Lead.affiliateId` và cả bộ cột UTM luôn rỗng.
      ...readAttribution(),
      timeOnPage,
      website: honeypot,
    };

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Lỗi hệ thống");
      }

      // Meta Pixel client-side track (dedup với CAPI server qua eventId)
      if (typeof window !== "undefined" && typeof window.fbq === "function") {
        window.fbq(
          "track",
          "Lead",
          {
            content_name: courseName,
            content_category: courseSlug,
            value: 0,
            currency: "VND",
          },
          { eventID: eventId },
        );
      }

      // GA4 client-side track
      if (
        typeof window !== "undefined" &&
        typeof window.gtag === "function"
      ) {
        window.gtag("event", "generate_lead", {
          source: "consult-modal",
          course_slug: courseSlug,
          course_name: courseName,
        });
      }

      toast.success("Đã ghi nhận đăng ký tư vấn!", {
        description: "Sata Robo sẽ gọi lại trong vòng 30 phút.",
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Lỗi hệ thống";
      toast.error("Gửi thất bại", { description: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header gradient */}
        <div className="relative bg-gradient-to-r from-orange-500 to-purple-600 p-6 text-white">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white disabled:opacity-50"
            aria-label="Đóng"
          >
            <X size={20} />
          </button>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
            <Phone size={12} /> HỌC THỬ 1-1 MIỄN PHÍ
          </div>
          <h2 className="text-xl font-extrabold">Đăng ký tư vấn</h2>
          <p className="mt-1 text-sm text-orange-50">
            Khóa: <strong>{courseDisplayName ?? courseName}</strong>
          </p>
          <p className="mt-1 text-xs text-orange-50/90">
            Sata Robo sẽ liên hệ trong 30 phút
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3 p-6">
          {/* Honeypot — hidden từ user, bot sẽ fill */}
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Tên phụ huynh <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              required
              placeholder="VD: Nguyễn Văn A"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Số điện thoại <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="0905 123 456"
              inputMode="tel"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Email{" "}
              <span className="font-normal text-gray-400">
                (không bắt buộc)
              </span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="phuhuynh@email.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Tên con{" "}
              <span className="font-normal text-gray-400">
                (không bắt buộc)
              </span>
            </label>
            <input
              type="text"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="VD: Nguyễn Văn B"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">
              Thời gian muốn được liên hệ{" "}
              <span className="font-normal text-gray-400">(tuỳ chọn)</span>
            </label>
            <input
              type="text"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              placeholder="VD: Tối sau 19h, hoặc cuối tuần"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
              disabled={submitting}
            />
          </div>

          {/* Ô tích marketing RIÊNG đã gỡ (BLĐ chốt 22/09/2026): khách đồng ý MỘT LƯỢT.
              Việc nhận tin tư vấn/ưu đãi nay nằm trong nội dung Chính sách bảo mật mà ô
              tích dưới đây trỏ tới — xem mục 3 của `content/legal/chinh-sach-bao-mat.md`.
              Giữ hai ô là bắt khách trả lời hai lần cho một lần đồng ý. */}
          <OTichChinhSach
            checked={dongYCsbm}
            onChange={(e) => setDongYCsbm(e.target.checked)}
            disabled={submitting}
            wrapperClassName="text-gray-600"
          />

          <button
            type="submit"
            disabled={submitting || !dongYCsbm}
            className="cta-pulse cta-shine mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3.5 text-base font-bold text-white transition hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Đang gửi...
              </>
            ) : (
              <>Đặt buổi học thử 1-1 miễn phí</>
            )}
          </button>

          <p className="pt-1 text-center text-xs text-gray-500">
            Hoặc gọi ngay{" "}
            <a
              href={`tel:${SATA_ROBO_PHONE.tho}`}
              className="font-bold text-orange-600 hover:underline"
            >
              {SATA_ROBO_PHONE.hien}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
