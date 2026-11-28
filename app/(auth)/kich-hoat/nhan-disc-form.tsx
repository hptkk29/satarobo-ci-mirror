"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PubAnh } from "@/components/public/pub-design/pub-anh";
import { useBuoc } from "@/components/public/xac-thuc/buoc-xac-thuc";
import { claimDiscResult, requestDiscClaimOtp } from "./nhan-disc-actions";

// Khoá localStorage do trang lưu kết quả DISC ghi (cùng thiết bị tự điền mã nhận). Hợp đồng tên khoá
// nằm ở lib/disc/nhan-ma-local.ts (không import server code vào client).
import { KHOA_LOCAL_MA_NHAN, docMaNhanLocal } from "@/lib/disc/nhan-ma-local";

// Markup CHÉP từ artifact "Disc-NhanKetQua": `.tag.dtag` + h1 + `<form>` gồm `.fld`/`.inp`/`.hint`/`.dalert`/`.pw`/`.linkbtn` + `.success`.
// Luồng thật GIỮ NGUYÊN (OTP Zalo + mã nhận + năm sinh con; mật khẩu tuỳ chọn); thanh bước 1·2·3 do trang dựng (BuocProvider).

const SVG = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const ICON_DT = (
  <svg {...SVG}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path>
  </svg>
);
const ICON_KHOA = (
  <svg {...SVG}>
    <circle cx="7.5" cy="15.5" r="4.5"></circle>
    <path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"></path>
  </svg>
);
const ICON_LICH = (
  <svg {...SVG}>
    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
    <path d="M16 2v4M8 2v4M3 10h18"></path>
  </svg>
);
const ICON_KHIEN = (
  <svg {...SVG}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
);
const ICON_ON = (
  <svg {...SVG}>
    <rect x="4" y="11" width="16" height="10" rx="2"></rect>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
  </svg>
);
const ICON_CB = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>
    <path d="M12 9v4M12 17h.01"></path>
  </svg>
);

const KHONG_DAU = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

export function NhanDiscForm() {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"nhap" | "xacminh" | "xong" | "can-dang-nhap">("nhap");
  const [sdt, setSdt] = useState("");
  const [ma, setMa] = useState("");
  const [namSinhCon, setNamSinhCon] = useState("");
  const [otp, setOtp] = useState("");
  const [matKhau, setMatKhau] = useState("");
  const [matKhau2, setMatKhau2] = useState("");
  const [hien, setHien] = useState(false);
  const [dongYTiepThi, setDongYTiepThi] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  /** Lỗi nằm TẠI CHỖ (toast biến mất sau vài giây, trình đọc màn hình có thể bỏ lỡ). */
  const [loi, setLoi] = useState<string | null>(null);
  const oOtp = useRef<HTMLInputElement>(null);
  const { datBuoc } = useBuoc();

  // Thanh bước của trang (Nhập mã · Xác minh · Nhận bài) theo bước của biểu mẫu.
  useEffect(() => {
    datBuoc(step === "nhap" ? 1 : step === "xong" ? 3 : 2);
  }, [step, datBuoc]);

  useEffect(() => {
    const m = docMaNhanLocal(KHOA_LOCAL_MA_NHAN);
    if (m) setMa(m);
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Sang bước nhập mã ⇒ đưa con trỏ vào ô mã (người dùng bàn phím/trình đọc màn hình không phải tìm).
  useEffect(() => {
    if (step === "xacminh") oOtp.current?.focus();
  }, [step]);

  function guiMa() {
    setLoi(null);
    startTransition(async () => {
      const r = await requestDiscClaimOtp(sdt);
      if (r.ok) {
        toast.success("Nếu số này có bài đang chờ, mã xác minh sẽ được gửi qua Zalo.");
        setStep("xacminh");
        setCooldown(r.cooldownSec ?? 60);
      } else {
        const t = r.error ?? "Không gửi được mã";
        setLoi(t);
        toast.error(t);
      }
    });
  }

  function nhan() {
    setLoi(null);
    // Mật khẩu là TUỲ CHỌN (người đã đăng nhập không cần); nếu có thì phải nhập hai lần giống nhau và đủ dài.
    if (matKhau || matKhau2) {
      const t = matKhau.length < 8 ? "Mật khẩu cần tối thiểu 8 ký tự." : matKhau !== matKhau2 ? "Hai lần nhập mật khẩu chưa giống nhau." : null;
      if (t) {
        setLoi(t);
        return;
      }
    }
    startTransition(async () => {
      const r = await claimDiscResult({ soDienThoai: sdt, otp, maNhan: ma, namSinhCon, matKhau, dongYTiepThi });
      if (r.ok) {
        try {
          window.localStorage.removeItem(KHOA_LOCAL_MA_NHAN);
        } catch {
          /* bỏ qua: trình duyệt chặn lưu trữ */
        }
        setStep("xong");
      } else if (r.canDangNhap) {
        setStep("can-dang-nhap");
      } else {
        const t = r.error ?? "Không nhận được bài";
        setLoi(t);
        toast.error(t);
      }
    });
  }

  /** Quay về bước nhập số (gõ sai số ⇒ không bị kẹt ở ô khoá). Xoá mã/OTP đã gõ để không gửi nhầm cho số khác. */
  function doiSo() {
    setStep("nhap");
    setOtp("");
    setMatKhau("");
    setMatKhau2("");
    setLoi(null);
    setCooldown(0);
  }

  const cuoi = (
    <p style={{ margin: "18px 0 0", textAlign: "center", color: "var(--muted)" }}>
      Đã có mật khẩu?{" "}
      <Link href="/login" style={{ fontWeight: "700" }} title="Đăng nhập">
        Đăng nhập
      </Link>{" "}
      ·{" "}
      <Link href="/disc" style={{ fontWeight: "700" }}>
        Về Khám phá DISC
      </Link>
    </p>
  );

  if (step === "xong") {
    return (
      <>
        <div className="success">
          <div className="burst">
            <PubAnh id="da847c40d631e0b7a535a73c3172ac50" alt="" sizes="170px" />
          </div>
          <h1>
            Đã nhận <span className="grad">kết quả DISC</span>
          </h1>
          <p style={{ margin: "0", color: "var(--muted)" }}>Đã nhận kết quả DISC vào tài khoản của bạn.</p>
          <Link href="/login" className="btn btn-acc" style={{ width: "100%", minHeight: "52px" }}>
            Đăng nhập để xem
          </Link>
        </div>
        {cuoi}
      </>
    );
  }
  if (step === "can-dang-nhap") {
    return (
      <>
        <div className="success">
          <div className="burst">
            <PubAnh id="fe4be01fb9d5892165c884ae5d265246" alt="" sizes="170px" />
          </div>
          <h1>
            Số này <span className="grad">đã có tài khoản</span>
          </h1>
          <p style={{ margin: "0", color: "var(--muted)" }}>Số này đã có tài khoản. Hãy đăng nhập, sau đó quay lại trang này để nhận bài (cần xác minh mã mới).</p>
          <Link href="/login" className="btn btn-acc" style={{ width: "100%", minHeight: "52px" }}>
            Đăng nhập
          </Link>
        </div>
        {cuoi}
      </>
    );
  }

  const nutHien = (
    <button type="button" onClick={() => setHien((v) => !v)} aria-label={hien ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={hien}>
      {hien ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"></path>
          <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"></path>
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )}
    </button>
  );

  return (
    <>
      <span className="tag dtag">Khám phá DISC</span>
      <h1 style={{ marginTop: "12px" }}>
        Nhận kết quả <span className="grad">DISC</span>
      </h1>
      <p style={{ margin: "6px 0 18px", color: "var(--muted)" }}>Nhập số điện thoại và mã nhận bài để xem kết quả của gia đình.</p>
      <form
        style={{ display: "grid", gap: "14px" }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "nhap") guiMa();
          else nhan();
        }}
      >
        <div className="fld">
          <label htmlFor="k-sdt">
            {ICON_DT} Số điện thoại đã dùng khi lưu kết quả
          </label>
          <input id="k-sdt" className="inp" type="tel" inputMode="tel" autoComplete="tel" value={sdt} onChange={(e) => setSdt(e.target.value)} disabled={step !== "nhap"} required {...KHONG_DAU} />
        </div>
        {step === "xacminh" && (
          <button type="button" className="linkbtn" onClick={doiSo} disabled={pending} data-testid="disc-doi-so" style={{ justifySelf: "start", marginTop: "-6px", minHeight: "32px" }}>
            Đổi số điện thoại
          </button>
        )}
        <div className="dalert am">
          {ICON_CB}
          <span>
            Nếu bạn đã có tài khoản Sata Robo, hãy{" "}
            <Link href="/login" style={{ fontWeight: "700" }}>
              đăng nhập
            </Link>{" "}
            trước rồi quay lại trang này để nhận bài.
          </span>
        </div>
        <div className="fld">
          <label htmlFor="k-ma">
            {ICON_KHOA} Mã nhận bài
          </label>
          <input
            id="k-ma"
            className="inp"
            style={{ textTransform: "uppercase", fontFamily: "var(--font-space-mono), 'Space Mono', monospace", letterSpacing: ".08em" }}
            autoComplete="off"
            value={ma}
            onChange={(e) => setMa(e.target.value)}
            required
            {...KHONG_DAU}
          />
          <p className="hint">Hiển thị khi bạn lưu kết quả.</p>
        </div>
        <div className="fld">
          <label htmlFor="k-ns">
            {ICON_LICH} Năm sinh của con (4 chữ số)
          </label>
          <input
            id="k-ns"
            className="inp"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            pattern="[0-9]{4}"
            value={namSinhCon}
            onChange={(e) => setNamSinhCon(e.target.value.replace(/\D/g, ""))}
            required
          />
          <p className="hint">Để bảo vệ hồ sơ của trẻ, chúng tôi cần thêm thông tin này. Nhập sai nhiều lần, bài sẽ bị khoá.</p>
        </div>
        {step === "xacminh" && (
          <>
            {/* Thông điệp TRUNG TÍNH (không nói số này có/không có bài hay tài khoản) nhưng chỉ đường được cho mọi trường hợp. */}
            <div role="status" className="dalert vi" data-testid="disc-xacminh-huong-dan">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>
                Nếu số này có bài đang chờ, mã xác minh sẽ được gửi qua Zalo trong ít phút.
                <br />
                Chưa thấy mã? Hãy kiểm tra lại số điện thoại. Nếu số này đã có tài khoản Sata Robo, bạn{" "}
                <Link href="/login" style={{ fontWeight: "700" }}>
                  đăng nhập tại cổng phụ huynh (hocvien.satarobo.vn)
                </Link>{" "}
                rồi quay lại trang này để nhận bài.
              </span>
            </div>
            <div className="fld">
              <label htmlFor="k-otp">
                {ICON_KHIEN} Mã xác minh 6 chữ số
              </label>
              <input id="k-otp" ref={oOtp} className="inp otp1" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value)} required />
            </div>
            <div className="fld">
              <label htmlFor="k-pw">
                {ICON_ON} Mật khẩu
              </label>
              <div className="pw">
                <input id="k-pw" className="inp" type={hien ? "text" : "password"} autoComplete="new-password" value={matKhau} onChange={(e) => setMatKhau(e.target.value)} {...KHONG_DAU} />
                {nutHien}
              </div>
              <p className="hint">Chỉ cần khi bạn chưa có tài khoản (tối thiểu 8 ký tự). Đã đăng nhập thì bỏ trống.</p>
            </div>
            <div className="fld">
              <label htmlFor="k-pw2">
                {ICON_ON} Nhập lại mật khẩu
              </label>
              <div className="pw">
                <input id="k-pw2" className="inp" type={hien ? "text" : "password"} autoComplete="new-password" value={matKhau2} onChange={(e) => setMatKhau2(e.target.value)} {...KHONG_DAU} />
                {nutHien}
              </div>
            </div>
            <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "14px", lineHeight: "1.5", cursor: "pointer", minHeight: "44px" }}>
              <input type="checkbox" checked={dongYTiepThi} onChange={(e) => setDongYTiepThi(e.target.checked)} style={{ width: "20px", height: "20px", marginTop: "1px", flexShrink: "0", accentColor: "#f97316" }} />
              <span>Tôi đồng ý để Sata Robo liên hệ tư vấn và gửi thông tin khoá học qua điện thoại/Zalo (không bắt buộc, có thể rút lại bất cứ lúc nào).</span>
            </label>
          </>
        )}
        {loi && (
          <div role="alert" className="dalert re" data-testid="disc-nhan-loi">
            {ICON_CB}
            <span>{loi}</span>
          </div>
        )}
        <button type="submit" className="btn btn-acc" disabled={pending} aria-busy={pending} style={{ width: "100%", minHeight: "54px", fontSize: "16px" }}>
          {pending ? (step === "nhap" ? "Đang gửi…" : "Đang kiểm tra…") : step === "nhap" ? "Gửi mã xác minh" : "Nhận kết quả"}
        </button>
        {step === "xacminh" && (
          <button type="button" className="linkbtn" disabled={cooldown > 0 || pending} onClick={guiMa} style={{ justifySelf: "center", minHeight: "40px", opacity: cooldown > 0 || pending ? 0.6 : 1 }}>
            {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại mã"}
          </button>
        )}
      </form>
      {cuoi}
    </>
  );
}
