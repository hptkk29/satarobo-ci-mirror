"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  acceptAll,
  rejectAll,
  readConsent,
  writeConsent,
} from "@/lib/cookie-consent";

/**
 * Cookie consent banner — NĐ 13/2023/NĐ-CP compliance.
 *
 * - Hiển thị khi chưa có consent (hoặc CONSENT_VERSION đã đổi).
 * - 3 lựa chọn: Chấp nhận tất cả · Chỉ cần thiết · Tuỳ chỉnh.
 * - Dispatch `consent-change` event để GA4 / MetaPixel listen và load có điều kiện.
 *
 * Giao diện (PUB-1, 02/11/2026): token `.sr-pub` của site public mới (panel / line / btn / ck-sw —
 * cùng bộ với trang Cài đặt cookie). Banner được gắn ở cả 3 nhóm route (public · legacy · auth).
 * Trong nhóm public nó nằm BÊN TRONG `.sr-pub` nên thừa hưởng token + chủ đề sáng/tối; ở nhóm khác
 * (không có `.sr-pub` bao ngoài) nó tự mang class `sr-pub` + chủ đề đang dùng — xem `tuMangToken`.
 *
 * Đặt component này ở layout của nhóm route công khai (không phải admin).
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  // Banner ở ngoài mọi `.sr-pub` (legacy / auth) ⇒ tự mang token: { toi } | null.
  const [tuMangToken, setTuMangToken] = useState<{ toi: boolean } | null>(null);

  useEffect(() => {
    // Defer to avoid hydration mismatch — localStorage only on client.
    const t = setTimeout(() => {
      const existing = readConsent();
      if (!existing) setVisible(true);
    }, 800); // delay to not jar first paint
    return () => clearTimeout(t);
  }, []);

  // Banner `fixed` phủ đáy viewport ⇒ nút ở cuối trang (vd "Gửi mã xác minh" ở
  // /kich-hoat, 320x640) kẹt dưới nó, kéo hết cỡ cũng không bấm được. Đệm đáy
  // <body> đúng bằng chiều cao banner (đo thật, theo dõi khi đổi sang "Tuỳ chỉnh")
  // để cuộn tới được. Gỡ đệm khi banner đóng.
  const bannerRef = useRef<HTMLDivElement>(null);

  // Quyết định MỘT lần, trước khi vẽ: có `.sr-pub` bao ngoài không? Không có thì tự mang class.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = bannerRef.current;
    if (!el || el.parentElement?.closest(".sr-pub")) return;
    let toi = false;
    try {
      toi =
        localStorage.getItem("sata-theme") === "dark" ||
        localStorage.getItem("auth-theme") === "dark" ||
        el.parentElement?.closest(".dark, .theme-dark") != null;
    } catch {
      /* localStorage bị chặn — mặc định sáng */
    }
    setTuMangToken({ toi });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const el = bannerRef.current;
    if (!el) return;
    const prev = document.body.style.paddingBottom;
    const apply = () => {
      document.body.style.paddingBottom = `${el.offsetHeight}px`;
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      document.body.style.paddingBottom = prev;
    };
  }, [visible]);

  if (!visible) return null;

  function handleAcceptAll() {
    acceptAll();
    setVisible(false);
  }

  function handleRejectAll() {
    rejectAll();
    setVisible(false);
  }

  function handleSaveCustom() {
    writeConsent({ necessary: true, analytics, marketing });
    setVisible(false);
  }

  const lop = [
    "pub-ck",
    tuMangToken ? `sr-pub page ${tuMangToken.toi ? "theme-dark" : "theme-light"}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={bannerRef}
      data-testid="cookie-consent"
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className={lop}
    >
      <div className="pub-ck-in">
        {!showCustomize ? (
          <div className="pub-ck-row">
            <div className="pub-ck-text">
              <p id="cookie-consent-title" className="pub-ck-title">
                Sata Robo sử dụng cookie
              </p>
              <p>
                Chúng tôi dùng cookie để vận hành trang, phân tích lưu lượng và cải thiện trải nghiệm.
                Anh/chị có thể chấp nhận tất cả, từ chối, hoặc tuỳ chỉnh.{" "}
                <Link href="/chinh-sach-bao-mat">Chính sách bảo mật</Link>.
              </p>
            </div>
            <div className="ck-act">
              <button type="button" className="btn btn-line" onClick={() => setShowCustomize(true)}>
                Tuỳ chỉnh
              </button>
              <button type="button" className="btn btn-line" onClick={handleRejectAll}>
                Chỉ cần thiết
              </button>
              <button type="button" className="btn btn-acc" onClick={handleAcceptAll}>
                Chấp nhận tất cả
              </button>
            </div>
          </div>
        ) : (
          <div className="pub-ck-custom">
            <div>
              <h2 className="pub-ck-h2">Tuỳ chỉnh cookie</h2>
              <p className="pub-ck-sub">Bật/tắt từng nhóm cookie theo nhu cầu.</p>
            </div>

            <div>
              <ConsentRow
                title="Cookie cần thiết"
                description="Đảm bảo các chức năng cốt lõi (đăng nhập, bảo mật). Không thể tắt."
                enabled
                disabled
              />
              <ConsentRow
                title="Cookie phân tích"
                description="Google Analytics — đo lượng truy cập để cải thiện trang. Không thu thập danh tính cá nhân trực tiếp."
                enabled={analytics}
                onChange={setAnalytics}
              />
              <ConsentRow
                title="Cookie tiếp thị"
                description="Meta Pixel, Facebook conversion API — cá nhân hoá quảng cáo và đo hiệu quả chiến dịch."
                enabled={marketing}
                onChange={setMarketing}
              />
            </div>

            <div className="ck-act pub-ck-end">
              <button type="button" className="btn btn-line" onClick={() => setShowCustomize(false)}>
                Quay lại
              </button>
              <button type="button" className="btn btn-acc" onClick={handleSaveCustom}>
                Lưu lựa chọn
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConsentRow({
  title,
  description,
  enabled,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ck-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Bật/tắt ${title}`}
        disabled={disabled}
        onClick={() => onChange?.(!enabled)}
        className={`ck-sw${enabled ? " on" : ""}${disabled ? " lock" : ""}`}
      >
        <i />
      </button>
    </div>
  );
}
