"use client";

// Bộ input lấy theo form đăng ký của quatang.edu.vn: chỉ 3 ô bắt buộc (tên con /
// SĐT phụ huynh / cơ sở), 5 ô còn lại nằm trong panel "Thêm thông tin" mở khi cần.
// Chỉ lấy bộ input; phần copy marketing của trang đó KHÔNG lấy sang — lời hứa
// trên trang này là "buổi học thử 1-1 miễn phí" theo lib/uu-dai.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  Mail,
  MapPin,
  Phone,
  School,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { readStoredCourseSelection } from "./_utils/courseSelection";
import { locations } from "./_data/locations";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { VN_PROVINCES, VN_PROVINCE_DEFAULT } from "@/lib/vn-provinces";
import { TRIAL_TEST_MINUTES, TRIAL_SESSION_MINUTES } from "@/lib/uu-dai";
import { OTichChinhSach } from "@/components/public/o-tich-chinh-sach";
import {
  handleLeadSubmission,
  validateVietnamPhone,
  validateEmail,
  trackPixelEvent,
  trackGA4Event,
} from "./_utils/tracking";

const ZALO_GROUP_LINK = "https://zalo.me/g/ovma9qgjuedypjy8mnxc";
const CONTACT_CENTERS = locations.filter((l) => !l.isUpcoming);

// Cơ sở lấy động từ `_data/locations` — mở CS3 chỉ thêm data, không sửa form.
// Value TRÙNG nhãn: Lead không có cột cơ sở nên giá trị đi thẳng vào `note` dạng
// chữ; để cả tên lẫn địa chỉ thì sale đọc note là biết ngay cơ sở nào.
const centerLabel = (name: string, address: string) =>
  `${name.split(" - ")[0] ?? name} - ${address}`;

const CENTER_OPTIONS = CONTACT_CENTERS.map((loc) => centerLabel(loc.name, loc.address));

const DEFAULT_CENTER = (() => {
  const hq = CONTACT_CENTERS.find((l) => l.isHQ);
  return hq ? centerLabel(hq.name, hq.address) : (CENTER_OPTIONS[0] ?? "");
})();

const EXTRA_PANEL_ID = "registration-extra-panel";

interface FormData {
  hoTenCon: string;
  sdt: string;
  coSo: string;
  hoTenPh: string;
  email: string;
  truong: string;
  lop: string;
  tinh: string;
  website: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

/** Field nằm trong panel mở rộng — dùng để tự mở panel khi submit lỗi. */
const PANEL_FIELDS: Array<keyof FormData> = ["hoTenPh", "email", "truong", "lop", "tinh"];

const INITIAL_FORM: FormData = {
  hoTenCon: "",
  sdt: "",
  coSo: DEFAULT_CENTER,
  hoTenPh: "",
  email: "",
  truong: "",
  lop: "",
  tinh: VN_PROVINCE_DEFAULT,
  website: "",
};

export default function RegistrationForm() {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  // Hồ sơ BCT mục 3 — ô tích đồng ý Chính sách bảo mật. Để RIÊNG, không đưa vào
  // `FormData`: mọi trường ở đó là `string` và vòng lặp kiểm trường tuỳ chọn gọi
  // `.trim()` trên `formData[field]`, thêm một boolean vào là vỡ kiểu ở chỗ khác.
  const [dongYCsbm, setDongYCsbm] = useState(false);
  const [loiDongY, setLoiDongY] = useState<string | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState(5);
  const [shouldRedirectToZalo, setShouldRedirectToZalo] = useState(true);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isSuccess || !shouldRedirectToZalo) return;
    if (redirectCountdown <= 0) {
      window.location.href = ZALO_GROUP_LINK;
      return;
    }
    const timer = setTimeout(() => setRedirectCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [isSuccess, shouldRedirectToZalo, redirectCountdown]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const name = e.target.name as keyof FormData;
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = (): boolean => {
    const e: FormErrors = {};

    const hoTenCon = formData.hoTenCon.trim();
    if (hoTenCon.length < 2) e.hoTenCon = "Vui lòng nhập họ và tên con.";
    // Trần 93: khi bỏ trống ô phụ huynh, `parentName` = "PH của <tên con>" (+7 ký
    // tự) mà server chặn `parentName` max 100.
    else if (hoTenCon.length > 93) e.hoTenCon = "Họ tên con quá dài.";

    if (!validateVietnamPhone(formData.sdt)) e.sdt = "Số điện thoại chưa hợp lệ.";
    if (!formData.coSo) e.coSo = "Vui lòng chọn cơ sở.";

    const optional: Array<[keyof FormData, string]> = [
      ["hoTenPh", "Họ tên không hợp lệ."],
      ["truong", "Tên trường không hợp lệ."],
      ["lop", "Lớp không hợp lệ."],
    ];
    for (const [field, message] of optional) {
      const v = formData[field].trim();
      if (v && (v.length < 2 || v.length > 100)) e[field] = message;
    }

    if (formData.email.trim() && !validateEmail(formData.email.trim()))
      e.email = "Email không hợp lệ.";

    const loiCsbm = dongYCsbm ? null : "Vui lòng đọc và đồng ý với Chính sách bảo mật.";
    setLoiDongY(loiCsbm);

    setErrors(e);
    if (Object.keys(e).length === 0 && !loiCsbm) return true;

    // Lỗi nằm trong panel đang đóng thì phải mở ra, không thì khách thấy nút
    // submit không ăn mà chẳng hiểu vì sao.
    const errorInPanel = PANEL_FIELDS.some((f) => e[f]);
    if (errorInPanel) setExtraOpen(true);
    window.setTimeout(
      () => {
        document
          .querySelector(".input-error")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      errorInPanel ? 80 : 0,
    );
    return false;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    trackPixelEvent("FormSubmitClick", { source: "registration-form" });
    trackGA4Event("form_submit_attempt", { source: "registration-form" });

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const hoTenCon = formData.hoTenCon.trim();
      await handleLeadSubmission({
        // Ô phụ huynh không bắt buộc → trống thì suy ra từ tên con (server bắt
        // `parentName` ≥ 2 ký tự).
        name: formData.hoTenPh.trim() || `PH của ${hoTenCon}`,
        childName: hoTenCon,
        phone: formData.sdt.trim(),
        email: formData.email.trim(),
        center: formData.coSo,
        // Không còn dropdown khoá học; nếu khách vừa bấm "Chọn khóa này" ở section
        // Lộ trình thì lựa chọn đó nằm sẵn trong sessionStorage.
        course: readStoredCourseSelection()?.courseValue ?? "",
        school: formData.truong.trim(),
        grade: formData.lop.trim(),
        province: formData.tinh.trim(),
        website: formData.website,
        timeOnPage: Math.floor((Date.now() - startTimeRef.current) / 1000),
        dongYChinhSachBaoMat: dongYCsbm,
      });
      setIsSuccess(true);
    } catch (err) {
      console.error("Submit error:", err);
      alert(
        `Có lỗi xảy ra, bố mẹ thử lại hoặc liên hệ Zalo ${SATA_ROBO_PHONE.hien} nhé!`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <section
        id="registration-form"
        className="section-padding bg-gradient-orange-purple relative overflow-hidden"
      >
        <div className="container-site flex min-h-[34rem] items-center justify-center">
          <div className="mx-auto max-w-xl animate-fade-in rounded-3xl border-4 border-white/40 bg-white p-7 text-center shadow-2xl sm:p-10">
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-success/10 sm:h-24 sm:w-24">
              <CheckCircle2 className="h-12 w-12 text-success sm:h-14 sm:w-14" strokeWidth={2.5} />
            </div>
            <h2 className="mb-4 text-2xl font-black text-text-dark sm:text-4xl">
              Đăng ký thành công!
            </h2>
            <p className="mb-6 text-base leading-relaxed text-text-muted sm:text-lg">
              Học viện <strong>Sata Robo</strong> đã nhận được thông tin của bố mẹ.
              <br />
              Tư vấn viên sẽ gọi trong vòng{" "}
              <strong className="text-primary-orange">24h</strong> để xếp buổi học thử 1-1 miễn phí.
            </p>

            {shouldRedirectToZalo ? (
              <div className="mb-6 inline-flex items-center gap-2 rounded-xl bg-soft-yellow p-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary-orange" />
                <span className="text-sm text-text-dark sm:text-base">
                  Tự động chuyển sang nhóm Zalo trong{" "}
                  <strong className="text-lg text-primary-orange">{redirectCountdown}s</strong>
                </span>
              </div>
            ) : (
              <div className="mb-6 inline-flex items-center gap-2 rounded-xl bg-soft-cream p-4">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <span className="text-sm text-text-dark sm:text-base">
                  Thông tin đã được gửi thành công.
                </span>
              </div>
            )}

            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <a href={ZALO_GROUP_LINK} className="btn-primary">
                Tham gia nhóm Zalo ngay
              </a>
              <a
                href={SATA_ROBO_PHONE.zalo}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline"
              >
                Zalo {SATA_ROBO_PHONE.hien}
              </a>
              {shouldRedirectToZalo && (
                <button
                  type="button"
                  onClick={() => setShouldRedirectToZalo(false)}
                  className="btn-outline"
                >
                  Ở lại trang
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const inputClass = (field: keyof FormData) =>
    `w-full rounded-xl border-2 px-4 py-3 text-sm transition focus:outline-none sm:text-base ${
      errors[field]
        ? "input-error border-urgent animate-shake"
        : "border-gray-200 focus:border-primary-orange"
    }`;

  return (
    <section
      id="registration-form"
      className="section-padding bg-gradient-orange-purple relative overflow-hidden"
    >
      <div className="absolute left-10 top-10 h-32 w-32 rounded-full bg-white/5 blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 h-40 w-40 rounded-full bg-white/5 blur-3xl pointer-events-none" />

      <div className="container-site relative z-10">
        <div className="mb-8 text-center sm:mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm sm:text-sm">
            <ClipboardList className="h-4 w-4" />
            ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ
          </div>
          <h2 className="mb-4 text-3xl font-black leading-tight text-white sm:text-5xl">
            Bắt Đầu <span className="text-soft-yellow">Hành Trình</span>
            <br />
            Của Con Ngay Hôm Nay
          </h2>
          <p className="mx-auto max-w-2xl text-base text-white/90 sm:text-lg">
            Bố mẹ vui lòng điền thông tin dưới đây - Sata Robo gọi tư vấn trong{" "}
            <strong>24h</strong> để xếp buổi học thử 1-1 miễn phí cho con.
          </p>
          <p className="mx-auto mt-3 max-w-2xl rounded-2xl bg-white/15 px-4 py-3 text-sm text-white backdrop-blur-sm sm:text-base">
            {TRIAL_TEST_MINUTES} phút test năng lực đầu vào + {TRIAL_SESSION_MINUTES} phút học thử 1 kèm 1
            trên phần mềm RoboSim cùng giáo viên — 0 đồng, không ràng buộc, áp dụng cả 2 cơ sở.
          </p>
        </div>

        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-10">
          <div className="mb-6 text-center">
            <h3 className="mb-1 flex items-center justify-center gap-2 text-xl font-black text-text-dark sm:text-2xl">
              <Sparkles className="h-6 w-6 text-primary-orange" />
              Thông Tin Đăng Ký
            </h3>
            <p className="text-xs text-text-muted sm:text-sm">
              Điền 3 thông tin - Sata Robo gọi lại xếp lịch học cho con tại 2 cơ sở Đà Nẵng.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Honeypot — người thật không thấy, bot điền vào là server chặn.
                Tên khoá phải đúng `website`, server chỉ soi đúng khoá này. */}
            <input
              type="text"
              name="website"
              value={formData.website}
              onChange={handleChange}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />

            <div>
              <label htmlFor="hoTenCon" className="mb-1.5 block text-sm font-bold text-text-dark">
                <User className="mr-1 inline h-4 w-4 text-primary-orange" />
                Họ và tên con <span className="text-urgent">*</span>
              </label>
              <input
                type="text"
                id="hoTenCon"
                name="hoTenCon"
                value={formData.hoTenCon}
                onChange={handleChange}
                placeholder="VD: Nguyễn Minh Khoa"
                autoComplete="off"
                className={inputClass("hoTenCon")}
              />
              {errors.hoTenCon && <ErrorText>{errors.hoTenCon}</ErrorText>}
            </div>

            <div>
              <label htmlFor="sdt" className="mb-1.5 block text-sm font-bold text-text-dark">
                <Phone className="mr-1 inline h-4 w-4 text-primary-orange" />
                ĐT di động phụ huynh <span className="text-urgent">*</span>
              </label>
              <input
                type="tel"
                id="sdt"
                name="sdt"
                value={formData.sdt}
                onChange={handleChange}
                placeholder="VD: 09xx xxx xxx"
                inputMode="tel"
                autoComplete="tel"
                className={inputClass("sdt")}
              />
              {errors.sdt && <ErrorText>{errors.sdt}</ErrorText>}
            </div>

            <div>
              <label htmlFor="coSo" className="mb-1.5 block text-sm font-bold text-text-dark">
                <MapPin className="mr-1 inline h-4 w-4 text-primary-orange" />
                Chọn cơ sở học <span className="text-urgent">*</span>
              </label>
              <select
                id="coSo"
                name="coSo"
                value={formData.coSo}
                onChange={handleChange}
                className={`bg-white ${inputClass("coSo")}`}
              >
                {CENTER_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              {errors.coSo && <ErrorText>{errors.coSo}</ErrorText>}
            </div>

            {/* Giữ form chính đúng 3 ô cho nhanh; phần còn lại mở khi bố mẹ muốn. */}
            <button
              type="button"
              hidden={extraOpen}
              onClick={() => setExtraOpen(true)}
              aria-expanded={extraOpen}
              aria-controls={EXTRA_PANEL_ID}
              className="text-sm font-bold text-primary-orange transition hover:text-primary-orange-dark"
            >
              <span aria-hidden="true">+ </span>
              Thêm thông tin để xếp lớp nhanh hơn{" "}
              <span className="text-xs font-normal text-text-muted">(không bắt buộc)</span>
            </button>

            {/* Panel LUÔN mount, chỉ ẩn/hiện — đóng lại không mất giá trị đã nhập. */}
            <div
              id={EXTRA_PANEL_ID}
              hidden={!extraOpen}
              className="space-y-4 rounded-2xl border border-primary-orange/20 bg-soft-cream p-4 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-text-dark">
                  Thêm thông tin{" "}
                  <span className="text-xs font-normal text-text-muted">(không bắt buộc)</span>
                </p>
                <button
                  type="button"
                  aria-label="Đóng"
                  onClick={() => setExtraOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-text-muted transition hover:bg-white hover:text-text-dark"
                >
                  ×
                </button>
              </div>

              <div>
                <label htmlFor="hoTenPh" className="mb-1.5 block text-sm font-bold text-text-dark">
                  <Users className="mr-1 inline h-4 w-4 text-primary-orange" />
                  Họ tên phụ huynh
                </label>
                <input
                  type="text"
                  id="hoTenPh"
                  name="hoTenPh"
                  value={formData.hoTenPh}
                  onChange={handleChange}
                  placeholder="VD: Nguyễn Văn A"
                  autoComplete="name"
                  className={inputClass("hoTenPh")}
                />
                {errors.hoTenPh && <ErrorText>{errors.hoTenPh}</ErrorText>}
              </div>

              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-bold text-text-dark">
                  <Mail className="mr-1 inline h-4 w-4 text-primary-orange" />
                  Email phụ huynh
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="(không bắt buộc)"
                  inputMode="email"
                  autoComplete="email"
                  className={inputClass("email")}
                />
                {errors.email && <ErrorText>{errors.email}</ErrorText>}
              </div>

              <div>
                <label htmlFor="truong" className="mb-1.5 block text-sm font-bold text-text-dark">
                  <School className="mr-1 inline h-4 w-4 text-primary-orange" />
                  Trường con đang học
                </label>
                <input
                  type="text"
                  id="truong"
                  name="truong"
                  value={formData.truong}
                  onChange={handleChange}
                  placeholder="VD: Trường Tiểu học Hoàng Văn Thụ"
                  className={inputClass("truong")}
                />
                {errors.truong && <ErrorText>{errors.truong}</ErrorText>}
              </div>

              <div>
                <label htmlFor="lop" className="mb-1.5 block text-sm font-bold text-text-dark">
                  <GraduationCap className="mr-1 inline h-4 w-4 text-primary-orange" />
                  Lớp con đang học
                </label>
                <input
                  type="text"
                  id="lop"
                  name="lop"
                  value={formData.lop}
                  onChange={handleChange}
                  placeholder="VD: Lớp 4"
                  className={inputClass("lop")}
                />
                {errors.lop && <ErrorText>{errors.lop}</ErrorText>}
              </div>

              <div>
                <label htmlFor="tinh" className="mb-1.5 block text-sm font-bold text-text-dark">
                  <Building2 className="mr-1 inline h-4 w-4 text-primary-orange" />
                  Tỉnh/Thành phố
                </label>
                <select
                  id="tinh"
                  name="tinh"
                  value={formData.tinh}
                  onChange={handleChange}
                  className={`bg-white ${inputClass("tinh")}`}
                >
                  {VN_PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {errors.tinh && <ErrorText>{errors.tinh}</ErrorText>}
              </div>

              <button
                type="button"
                onClick={() => setExtraOpen(false)}
                className="btn-outline w-full py-2.5 text-sm"
              >
                Xong
              </button>
            </div>

            {/* Hồ sơ BCT mục 3. Đoạn <p> ngay dưới nút chỉ là DÒNG CHỮ ("Gửi thông tin
                đồng nghĩa bố mẹ đồng ý…"), không phải ô tích — hồ sơ đòi ô tích.
                `input-error` khi có lỗi để dùng lại cơ chế cuộn tới ô sai của validate(). */}
            <OTichChinhSach
              checked={dongYCsbm}
              onChange={(e) => {
                setDongYCsbm(e.target.checked);
                if (e.target.checked) setLoiDongY(null);
              }}
              loi={loiDongY}
              disabled={isSubmitting}
              wrapperClassName={loiDongY ? "input-error text-text-muted" : "text-text-muted"}
            />

            <button
              type="submit"
              disabled={isSubmitting}
              className="cta-pulse cta-shine w-full rounded-xl bg-gradient-orange-purple py-4 text-base font-black text-white transition hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:text-lg"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Đang gửi thông tin...
                </span>
              ) : (
                "ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ →"
              )}
            </button>

            <p className="border-t border-gray-100 pt-2 text-center text-xs text-text-muted">
              Thông tin của bạn được bảo mật tuyệt đối. Gửi thông tin đồng nghĩa bố mẹ
              đồng ý để Sata Robo liên hệ tư vấn theo{" "}
              <a href="/chinh-sach-bao-mat" className="text-primary-purple underline">
                chính sách bảo mật
              </a>
              .
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-urgent">
      <AlertCircle className="h-3.5 w-3.5" />
      {children}
    </p>
  );
}
