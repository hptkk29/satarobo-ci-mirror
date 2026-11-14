"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  acceptAll,
  rejectAll,
  clearConsent,
  readConsent,
  writeConsent,
  type ConsentState,
} from "@/lib/cookie-consent";
import { toast } from "sonner";

/**
 * Privacy Center — phần tương tác client của `/quyen-rieng-tu` (khung trang + đường dẫn + thanh bên
 * do `KhungChinhSach` dựng ở `page.tsx`). Cho phép user xem và sửa consent đã đặt + withdraw consent.
 * Bắt buộc theo NĐ 13/2023/NĐ-CP (right to access, modify, withdraw).
 *
 * Giao diện CHÉP từ artifact "ChinhSach-quyen-rieng-tu" (`.ck`, `.ck-row`, `.ck-sw`, `.ck-act` + hai mục `.pol-sec`).
 * Artifact có 3 nút; repo có 4 hành động THẬT (`lib/cookie-consent`: lưu · đồng ý tất cả · từ chối tất cả · rút lại) nên giữ cả bốn.
 */
export function PrivacyCenter() {
  const [state, setState] = useState<ConsentState | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const current = readConsent();
    setState(current);
    if (current) {
      setAnalytics(current.categories.analytics);
      setMarketing(current.categories.marketing);
    }
  }, []);

  function handleSave() {
    const next = writeConsent({ necessary: true, analytics, marketing });
    setState(next);
    toast.success("Đã lưu lựa chọn quyền riêng tư");
  }

  function handleAcceptAll() {
    const next = acceptAll();
    setState(next);
    setAnalytics(true);
    setMarketing(true);
    toast.success("Đã chấp nhận tất cả cookie");
  }

  function handleRejectAll() {
    const next = rejectAll();
    setState(next);
    setAnalytics(false);
    setMarketing(false);
    toast.success("Đã từ chối cookie phân tích & tiếp thị");
  }

  function handleWithdraw() {
    clearConsent();
    setState(null);
    setAnalytics(false);
    setMarketing(false);
    toast.success(
      "Đã rút lại consent. Cookie banner sẽ hiện lại lần tới anh/chị ghé thăm.",
    );
  }

  return (
    <>
      <nav className="toc card" style={{ margin: "0 0 8px" }} aria-label="Mục lục">
        <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
          Nội dung
        </span>
        <ol style={{ columns: "2", columnGap: "24px" }}>
          <li>
            <a href="#muc-1">Quyền của ba mẹ</a>
          </li>
          <li>
            <a href="#muc-2">Liên hệ thực hiện quyền</a>
          </li>
        </ol>
      </nav>

      <div className="ck sv a-blur">
        <div className="ck-h">
          <b>Tuỳ chọn cookie</b>
          <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }} role="status">
            {state
              ? `Xác nhận gần nhất: ${new Date(state.acceptedAt).toLocaleString("vi-VN")} · phiên bản ${state.version}`
              : "Chưa có lựa chọn"}
          </span>
        </div>
        <ConsentSection title="Cookie cần thiết" description="Đăng nhập, bảo mật phiên, lưu lựa chọn cookie. Không thể tắt." enabled disabled />
        <ConsentSection
          title="Cookie phân tích"
          description="Google Analytics 4 đo lượt truy cập và hành vi để cải thiện trải nghiệm. Ẩn danh IP, không dùng cho quảng cáo."
          enabled={analytics}
          onChange={setAnalytics}
        />
        <ConsentSection
          title="Cookie marketing"
          description="Meta Pixel đo hiệu quả quảng cáo Facebook/Instagram. Dữ liệu mã hoá có thể được chia sẻ với Meta."
          enabled={marketing}
          onChange={setMarketing}
        />
        <div className="ck-act">
          <button type="button" className="btn btn-acc" onClick={handleSave}>
            Lưu lựa chọn
          </button>
          <button type="button" className="btn btn-line" onClick={handleAcceptAll}>
            Đồng ý tất cả
          </button>
          <button type="button" className="btn btn-line" onClick={handleRejectAll}>
            Từ chối tất cả
          </button>
          <button type="button" className="btn btn-line" onClick={handleWithdraw}>
            Rút lại toàn bộ đồng ý
          </button>
        </div>
      </div>

      <section className="pol-sec">
        <h2 id="muc-1" className="sv a-mask">
          <span className="n">01</span>
          Quyền của ba mẹ
        </h2>
        <ul>
          <li>Biết dữ liệu cá nhân nào được thu thập</li>
          <li>Truy cập, chỉnh sửa, xoá dữ liệu cá nhân</li>
          <li>Phản đối hoặc hạn chế xử lý dữ liệu</li>
          <li>Rút lại đồng ý bất cứ lúc nào bằng nút “Rút lại toàn bộ đồng ý”</li>
          <li>Khiếu nại tới cơ quan có thẩm quyền (Bộ Công an – Cục An ninh mạng)</li>
        </ul>
      </section>

      <section className="pol-sec">
        <h2 id="muc-2" className="sv a-mask">
          <span className="n">02</span>
          Liên hệ thực hiện quyền
        </h2>
        <p>
          Gửi yêu cầu tới <a href="mailto:privacy@satarobo.vn">privacy@satarobo.vn</a> hoặc qua <Link href="/lien-he">trang Liên hệ</Link>. Xem thêm{" "}
          <Link href="/chinh-sach-bao-mat">Chính sách bảo mật</Link>.
        </p>
      </section>
    </>
  );
}

function ConsentSection({
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
        <b>{title}</b>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        className={"ck-sw" + (enabled ? " on" : "") + (disabled ? " lock" : "")}
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange?.(!enabled)}
        aria-label={title}
      >
        <i />
      </button>
    </div>
  );
}
