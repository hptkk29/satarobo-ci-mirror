"use client";

// Form "Hồ sơ học viên" — tạo mới (`/students/new`) và sửa (`/students/<id>/edit`).
// Thiết kế lại 25/09/2026 (chủ dự án chốt D2 + D3):
//
//   · MỘT tờ trắng, các nhóm ngăn bằng đường kẻ mảnh — không phải mỗi nhóm một thẻ.
//   · Ô xếp theo bề ngang CHÍNH TỜ (`@container`): 1 cột → 2 cột (≥512px) → 3 cột (≥896px).
//   · Thông tin CON + PHỤ HUYNH sửa ở đây; thông tin PHỄU (nguồn, sale, AFF…) chỉ đọc ở khung
//     "Lead nguồn" bên cạnh. ĐẢO 26/09: các ô chung với phiếu lead nay ĐỒNG BỘ HAI CHIỀU
//     (lib/students/dong-bo-lead.ts) — lưu ở đây là đổi luôn phiếu lead + anh/chị/em cùng phiếu.
//   · 26/09: "Mã học viên" chỉ Quản trị tối cao sửa (`coTheDoiMa`); "Quan hệ" là ô chọn;
//     địa chỉ chỉ dùng danh mục MỚI (ho-so/dia-chi.ts).
//   · GỠ khỏi form (dữ liệu cũ GIỮ NGUYÊN trong DB): nhóm máu, Quận/Huyện, "Đơn vị mong
//     muốn", "Ngày đăng ký lần đầu", SĐT/Email riêng của học viên.
//
// ⚠️ HỢP ĐỒNG VỚI `docFormHocVien` (`../_lib/doc-form.ts`) — đọc kỹ trước khi thêm/bớt ô:
//   · khoá VẮNG MẶT  ⇒ không đụng cột;   · khoá CÓ MẶT mà RỖNG ⇒ XOÁ cột.
//   Nên: ô nào HIỆN thì gửi, ô nào ĐÃ GỠ thì TUYỆT ĐỐI không để lại `name=` (một ô ẩn
//   `district` rỗng sẽ xoá sạch quận/huyện cũ của mọi hồ sơ được lưu). `avatarUrl` chỉ gửi
//   ở chế độ TẠO (ở hồ sơ, ảnh đổi bằng nút riêng). `allergies` luôn gửi (mảng JSON).
//   Lưới ghim: `ho-so/hop-dong-form.test.ts`.
//
// ⚠️ Gửi bằng `onSubmit` + `startTransition`, KHÔNG bằng `<form action={fn}>`: React 19 tự
// RESET mọi ô không kiểm soát sau khi action của form chạy xong — server trả lỗi validate
// là toàn bộ chữ người dùng vừa gõ quay về giá trị cũ (form tạo mới thì trắng trơn).

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import type { ComboboxOption } from "@/components/ui/combobox";
import { GIOI_TINH_OPTIONS, type GioiTinh } from "@/lib/students/gioi-tinh";
import { QUAN_HE, quanHeTuChuoi } from "@/lib/students/quan-he";
import { cn } from "@/lib/utils";
import { createStudent, updateStudent } from "../_actions";
import { ChonAnhKhiTao } from "./ho-so/anh-dai-dien";
import { anhChupForm, chiGiuODaDoi } from "./ho-so/gui-o-da-doi";
import { DiaChiPicker } from "./ho-so/dia-chi-picker";
import { laLinkMoDuoc, type TrangThaiHocVien } from "./ho-so/nhan-ho-so";
import { NUT_CHINH, NUT_VIEN, O_NHAP, O_VAN_BAN, TieuDeNhom, Truong } from "./ho-so/o-nhap";

export type StudentFormValue = {
  id: string;
  name: string;
  studentCode: string | null;
  /** "yyyy-mm-dd" theo lịch VN, hoặc "". */
  dateOfBirth: string;
  gender: GioiTinh | null;
  currentGrade: number | null;
  school: string | null;
  status: TrangThaiHocVien;

  parentName: string | null;
  /** Đã che ở SERVER khi người xem bị DENY cấp trường (xem `parentPhoneMasked`). */
  parentPhone: string | null;
  parentPhoneMasked: boolean;
  parentRelation: string | null;
  parentGender: GioiTinh | null;
  /** "yyyy-mm-dd" hoặc "". */
  parentDob: string;
  parentEmail: string | null;
  parentFacebookUrl: string | null;
  /** `null` khi người xem không có quyền xem CCCD (không gửi bản thô xuống client). */
  parentNationalId: string | null;
  parent2Name: string | null;
  parent2Phone: string | null;
  parent2Relation: string | null;

  city: string | null;
  ward: string | null;
  address: string | null;

  allergies: string[];
  healthNotes: string | null;
  notes: string | null;
  orgUnitId: string | null;
};

/** Các dòng CHỈ ĐỌC trong nhóm "Trung tâm" (chỉ ở trang hồ sơ). */
export type ThongTinTrungTam = {
  lopDangHoc: { id: string; ten: string }[];
  /** Đã định dạng dd/MM/yyyy, hoặc null khi chưa ghi danh lớp nào. */
  ngayNhapHoc: string | null;
};

interface OrgUnitOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Đang học" },
  { value: "PAUSED", label: "Bảo lưu" },
  { value: "GRADUATED", label: "Hoàn thành" },
  { value: "INACTIVE", label: "Nghỉ học" },
] as const;

/**
 * BUG 21/08 — ô này từng cho chọn thẳng "Nghỉ học": `updateStudent` chỉ ghi
 * `Student.status` mà không gỡ ghi danh, nên em đó vẫn nằm nguyên trong lớp ở mọi màn
 * roster. Đường đúng là nút "Nghỉ học hẳn" (bắt lý do + gỡ lớp + hoàn tiền + email).
 * Học viên ĐÃ nghỉ vẫn giữ option để form không tự nhảy sang giá trị khác khi sửa hồ sơ.
 */
function statusOptionsFor(current: string | undefined) {
  if (current === "INACTIVE") return [...STATUS_OPTIONS];
  return STATUS_OPTIONS.filter((o) => o.value !== "INACTIVE");
}

const LOP_TRUONG = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * Ô chọn "Quan hệ với học sinh" (26/09 — chủ dự án: dropdown, không gõ tự do). Giá trị cũ
 * nhận ra được ⇒ chọn đúng mục; không nhận ra (vd "Ba", "mẹ bé") ⇒ giữ thành một mục riêng để
 * lượt lưu không đổi nó lặng lẽ — người dùng tự chọn lại.
 */
function OQuanHe({ id, name, giaTri }: { id: string; name: string; giaTri: string | null }) {
  const cu = (giaTri ?? "").trim();
  const nhanRa = quanHeTuChuoi(cu);
  const giuCu = cu !== "" && nhanRa === null;
  return (
    <select id={id} name={name} defaultValue={nhanRa ?? cu} className={O_NHAP}>
      <option value="">— Chưa chọn —</option>
      {giuCu && <option value={cu}>{cu} (đang lưu — chọn lại)</option>}
      {QUAN_HE.map((q) => (
        <option key={q} value={q}>
          {q}
        </option>
      ))}
    </select>
  );
}

/** Nhóm đầu tờ: không kẻ trên (viền thẻ đã là mép trên). */
const NHOM_DAU = "space-y-4 px-4 py-5 sm:px-6";
const NHOM = "space-y-4 border-t border-border px-4 py-5 sm:px-6";
const LUOI = "grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-3";
const CA_HANG = "@lg:col-span-2 @4xl:col-span-3";

export function StudentForm({
  student,
  orgUnits,
  canViewParentCccd = false,
  provinces,
  initialWards,
  homNay,
  thongTinTrungTam,
  coTheDoiMa,
}: {
  student?: StudentFormValue;
  /**
   * Người đang xem có `students:change-code` (chỉ Quản trị tối cao — chốt 26/09). BẮT BUỘC
   * truyền: mặc định `true` là mở lại đúng ô vừa khoá, mặc định `false` là giấu ô khỏi admin.
   * Server vẫn tự gác (`_lib/ma-hoc-vien.ts`) — ô này chỉ là lời hứa phải khớp với server.
   */
  coTheDoiMa: boolean;
  orgUnits: OrgUnitOption[];
  // #15 — CCCD PH là PII (mask + break-glass ở màn thanh toán). Chỉ actor có
  // payments:view-pii mới THẤY + nhập ô này; vai khác (Sale/CM) ẩn hoàn toàn.
  canViewParentCccd?: boolean;
  /** Danh mục tỉnh/thành (mô hình 2 cấp), nạp ở server. */
  provinces: ComboboxOption[];
  /** Phường/xã của tỉnh đang lưu, nạp sẵn ở server. */
  initialWards: ComboboxOption[];
  /** "yyyy-mm-dd" hôm nay theo giờ VN (server tính) — trần cho ô ngày sinh. */
  homNay: string;
  thongTinTrungTam?: ThongTinTrungTam;
}) {
  const isEdit = Boolean(student);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangLuu, startLuu] = useTransition();
  const [allergies, setAllergies] = useState<string[]>(student?.allergies ?? []);
  const [tenNhap, setTenNhap] = useState(student?.name ?? "");
  const [dangTaiAnh, setDangTaiAnh] = useState(false);
  const loiRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Ảnh chụp giá trị lúc MỞ form (chế độ sửa) — lúc lưu chỉ gửi ô đã đổi so với nó
  // (`gui-o-da-doi.ts`): form nạp lại sau "Gắn lead"/nút vòng đời mà vẫn giữ chữ đang gõ
  // thì KHÔNG được ghi ngược các ô người dùng không chạm.
  const banDauRef = useRef<Map<string, string> | null>(null);
  // Địa chỉ ĐANG LƯU lúc mở form (ref: chụp đúng một lần như phần còn lại của ảnh chụp).
  const diaChiDangLuu = useRef({ city: student?.city ?? "", ward: student?.ward ?? "" });
  useEffect(() => {
    if (!isEdit || !formRef.current) return;
    const anh = anhChupForm(new FormData(formRef.current));
    // Địa chỉ so với giá trị ĐANG LƯU, không với giá trị ô hiện (đã dịch sang danh mục mới —
    // `ho-so/dia-chi.ts`). Nhờ vậy "Đà Nẵng" hiện thành "Tp Đà Nẵng" thì lượt lưu ghi đúng
    // thứ màn hình đang cho thấy, DB không giữ lại chữ cũ mà màn hình giấu đi.
    anh.set("city", diaChiDangLuu.current.city.trim());
    anh.set("ward", diaChiDangLuu.current.ward.trim());
    banDauRef.current = anh;
  }, [isEdit]);
  const statusOptions = statusOptionsFor(student?.status);
  const coPh2 = !!(student?.parent2Name || student?.parent2Phone || student?.parent2Relation);
  const coSucKhoe = allergies.length > 0 || !!student?.healthNotes;
  const lopHienTai = student?.currentGrade ?? null;
  const lopNgoaiKhoang = lopHienTai !== null && !LOP_TRUONG.includes(lopHienTai);
  const linkFb = student?.parentFacebookUrl ?? null;

  function baoLoi(msg: string) {
    setLoi(msg);
    // Đợi khung lỗi vẽ ra rồi mới cuộn + chuyển focus (trình đọc màn hình đọc ngay).
    requestAnimationFrame(() => {
      // `?.()` cả ở HÀM: môi trường không có `scrollIntoView` (jsdom của bộ test, vài
      // webview cũ) thì bỏ qua cuộn nhưng VẪN chuyển focus — ném ở đây là mất luôn focus,
      // và trong test nó thành lỗi không bắt làm đỏ cả job (CI 26/09).
      loiRef.current?.scrollIntoView?.({ block: "center" });
      loiRef.current?.focus({ preventScroll: true });
    });
  }

  function guiForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Nút "Tạo" đã khoá khi ảnh đang tải; chặn thêm ở đây vì Enter trong một ô chữ vẫn gửi form.
    if (dangTaiAnh) {
      baoLoi("Ảnh đại diện đang tải lên — đợi xong rồi bấm tạo lại.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    if (isEdit && banDauRef.current) chiGiuODaDoi(fd, banDauRef.current);
    setLoi(null);
    startLuu(async () => {
      try {
        const res = isEdit ? await updateStudent(student!.id, fd) : await createStudent(fd);
        // Thành công ⇒ action `redirect("/students")`, không tới được dòng dưới.
        if (res?.error) baoLoi(res.error);
      } catch (err) {
        unstable_rethrow(err);
        baoLoi("Mất kết nối tới máy chủ — hồ sơ CHƯA được lưu. Kiểm tra mạng rồi bấm lưu lại.");
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={guiForm}
      aria-busy={dangLuu}
      aria-label={isEdit ? "Sửa hồ sơ học viên" : "Tạo học viên mới"}
      className="@container rounded-xl border border-border bg-card shadow-sm"
    >
      {loi && (
        <div
          ref={loiRef}
          role="alert"
          tabIndex={-1}
          className="mx-4 mt-4 rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink focus:outline-none sm:mx-6"
        >
          <p className="font-semibold">Chưa lưu được hồ sơ</p>
          <p className="mt-0.5 break-words">{loi}</p>
        </div>
      )}

      {/* Ô ẩn LUÔN có mặt: dị ứng gửi dạng mảng JSON (có thể `[]` = xoá hết). */}
      <input type="hidden" name="allergies" value={JSON.stringify(allergies)} />

      {/* 1 — HỌC SINH */}
      <section aria-labelledby="nhom-hoc-sinh" className={NHOM_DAU}>
        <TieuDeNhom id="nhom-hoc-sinh">Học sinh</TieuDeNhom>
        {!isEdit && <ChonAnhKhiTao ten={tenNhap} onDangTai={setDangTaiAnh} />}
        <div className={LUOI}>
          <Truong id="hv-name" nhan="Họ và tên học sinh" batBuoc>
            <input
              id="hv-name"
              name="name"
              defaultValue={student?.name ?? ""}
              onChange={(e) => setTenNhap(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
              className={O_NHAP}
            />
          </Truong>
          {coTheDoiMa ? (
            <Truong
              id="hv-code"
              nhan="Mã học viên"
              goiY={
                isEdit
                  ? "Để trống KHÔNG xoá mã hiện có. Nếu đổi, mã mới phải duy nhất toàn hệ thống."
                  : "Để trống thì hệ thống tự sinh theo mã cơ sở. Nếu điền, phải duy nhất toàn hệ thống."
              }
            >
              <input
                id="hv-code"
                name="studentCode"
                defaultValue={student?.studentCode ?? ""}
                placeholder={isEdit ? undefined : "Tự sinh nếu để trống"}
                autoComplete="off"
                className={O_NHAP}
              />
            </Truong>
          ) : (
            // 26/09 — chỉ Quản trị tối cao sửa mã (`students:change-code`). KHÔNG `name=`: ô chỉ
            // đọc không được gửi đi, nên không có đường nào để một lượt lưu chạm vào mã.
            <Truong
              id="hv-code"
              nhan="Mã học viên"
              goiY={
                isEdit
                  ? "Chỉ Quản trị tối cao sửa được mã học viên."
                  : "Hệ thống tự sinh theo mã cơ sở khi lưu."
              }
            >
              <input
                id="hv-code"
                value={student?.studentCode ?? ""}
                placeholder={isEdit ? "Chưa có mã" : "Tự sinh khi lưu"}
                readOnly
                data-chi-doc=""
                aria-readonly="true"
                className={O_NHAP}
              />
            </Truong>
          )}
          {isEdit && (
            <Truong
              id="hv-status"
              nhan="Trạng thái hồ sơ"
              batBuoc
              goiY={
                student?.status === "INACTIVE"
                  ? undefined
                  : 'Cho nghỉ học phải dùng nút "Nghỉ học hẳn" ở đầu trang — nút đó mới gỡ học viên khỏi lớp, tạo yêu cầu hoàn tiền và báo phụ huynh.'
              }
            >
              <select
                id="hv-status"
                name="status"
                defaultValue={student?.status ?? "ACTIVE"}
                required
                className={O_NHAP}
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Truong>
          )}
          <Truong id="hv-gender" nhan="Giới tính">
            <select id="hv-gender" name="gender" defaultValue={student?.gender ?? ""} className={O_NHAP}>
              <option value="">— Chưa chọn —</option>
              {GIOI_TINH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Truong>
          <Truong id="hv-dob" nhan="Ngày sinh">
            <input
              id="hv-dob"
              name="dateOfBirth"
              type="date"
              max={homNay}
              defaultValue={student?.dateOfBirth ?? ""}
              className={O_NHAP}
            />
          </Truong>
          <Truong id="hv-grade" nhan="Lớp đang học ở trường">
            <select
              id="hv-grade"
              name="currentGrade"
              defaultValue={lopHienTai !== null ? String(lopHienTai) : ""}
              className={O_NHAP}
            >
              <option value="">— Chưa rõ —</option>
              {/* Giá trị cũ ngoài 1–12 vẫn hiện để form không lặng lẽ đổi nó thành trống. */}
              {lopNgoaiKhoang && (
                <option value={String(lopHienTai)}>Lớp {lopHienTai} (ngoài 1–12)</option>
              )}
              {LOP_TRUONG.map((n) => (
                <option key={n} value={String(n)}>
                  Lớp {n}
                </option>
              ))}
            </select>
          </Truong>
          <Truong id="hv-school" nhan="Trường đang học" className="@lg:col-span-2 @4xl:col-span-3">
            <input
              id="hv-school"
              name="school"
              defaultValue={student?.school ?? ""}
              placeholder="VD: Tiểu học Trần Văn Ơn"
              className={O_NHAP}
            />
          </Truong>
        </div>
      </section>

      {/* 2 — PHỤ HUYNH */}
      <section aria-labelledby="nhom-phu-huynh" className={NHOM}>
        <TieuDeNhom
          id="nhom-phu-huynh"
          moTa={
            isEdit
              ? "Lưu ở đây là đổi luôn phiếu lead nguồn và hồ sơ anh/chị/em cùng phiếu — và ngược lại."
              : undefined
          }
        >
          Phụ huynh
        </TieuDeNhom>
        <div className={LUOI}>
          <Truong id="ph-name" nhan="Họ tên phụ huynh" batBuoc>
            <input
              id="ph-name"
              name="parentName"
              defaultValue={student?.parentName ?? ""}
              required
              autoComplete="off"
              className={O_NHAP}
            />
          </Truong>
          <Truong
            id="ph-phone"
            nhan="SĐT phụ huynh"
            batBuoc
            phu={
              student?.parentPhoneMasked
                ? "Số đang được che theo quyền của bạn — lưu hồ sơ không đổi số này."
                : undefined
            }
          >
            <input
              id="ph-phone"
              name="parentPhone"
              type="tel"
              inputMode="tel"
              defaultValue={student?.parentPhone ?? ""}
              readOnly={student?.parentPhoneMasked}
              // Nền xám "chỉ đọc" gắn vào thuộc tính này, không vào `read-only:` — `<select>`
              // luôn khớp `:read-only` nên biến thể đó tô xám MỌI ô chọn (xem o-nhap.tsx).
              data-chi-doc={student?.parentPhoneMasked ? "" : undefined}
              required={!student?.parentPhoneMasked}
              placeholder="0901234567"
              autoComplete="off"
              className={O_NHAP}
            />
          </Truong>
          <Truong id="ph-relation" nhan="Quan hệ với học sinh">
            <OQuanHe id="ph-relation" name="parentRelation" giaTri={student?.parentRelation ?? null} />
          </Truong>
          <Truong id="ph-gender" nhan="Giới tính phụ huynh">
            <select
              id="ph-gender"
              name="parentGender"
              defaultValue={student?.parentGender ?? ""}
              className={O_NHAP}
            >
              <option value="">— Chưa chọn —</option>
              {GIOI_TINH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Truong>
          <Truong id="ph-dob" nhan="Ngày sinh phụ huynh">
            <input
              id="ph-dob"
              name="parentDob"
              type="date"
              max={homNay}
              defaultValue={student?.parentDob ?? ""}
              className={O_NHAP}
            />
          </Truong>
          <Truong id="ph-email" nhan="Email phụ huynh">
            <input
              id="ph-email"
              name="parentEmail"
              type="email"
              defaultValue={student?.parentEmail ?? ""}
              autoComplete="off"
              className={O_NHAP}
            />
          </Truong>
          <Truong
            id="ph-fb"
            nhan="Link Facebook"
            goiY="Dán link trang cá nhân hoặc gõ tên tài khoản (vd minh.nguyen.549) — hệ thống tự chuẩn hoá thành link facebook.com."
            className="@lg:col-span-2"
            keBenNhan={
              laLinkMoDuoc(linkFb) && (
                <a
                  href={linkFb}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mb-1 inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Mở <ExternalLink className="size-3" aria-hidden />
                  <span className="sr-only">trang Facebook phụ huynh (tab mới)</span>
                </a>
              )
            }
          >
            {/* `type="text"` + `inputMode="url"`, KHÔNG `type="url"`: trình duyệt chặn gửi form
                với "facebook.com/abc" (thiếu https://) trong khi đó đúng là thứ người ta gõ. */}
            <input
              id="ph-fb"
              name="parentFacebookUrl"
              type="text"
              inputMode="url"
              defaultValue={student?.parentFacebookUrl ?? ""}
              placeholder="facebook.com/…"
              autoComplete="off"
              className={O_NHAP}
            />
          </Truong>
          {/* #15 — chỉ kế toán/admin (payments:view-pii) mới thấy + nhập CCCD PH.
              Vai khác: KHÔNG render ô (không prefill raw); giá trị cũ được server giữ. */}
          {canViewParentCccd && (
            <Truong
              id="ph-cccd"
              nhan="CCCD phụ huynh"
              goiY="Dùng cho phiếu thu/hóa đơn. Thông tin nhạy cảm — che mặc định, chỉ kế toán mở xem đầy đủ."
            >
              <input
                id="ph-cccd"
                name="parentNationalId"
                defaultValue={student?.parentNationalId ?? ""}
                placeholder="Số CCCD/CMND phụ huynh"
                autoComplete="off"
                className={O_NHAP}
              />
            </Truong>
          )}
        </div>

        <details className="group rounded-lg bg-muted/40 px-3 py-2" open={coPh2}>
          <summary className="flex min-h-9 cursor-pointer list-none items-center text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">+ Thêm phụ huynh thứ hai (tuỳ chọn)</span>
            <span className="hidden group-open:inline">Phụ huynh thứ hai</span>
          </summary>
          <div className={cn(LUOI, "pb-2 pt-3")}>
            <Truong id="ph2-name" nhan="Họ tên">
              <input
                id="ph2-name"
                name="parent2Name"
                defaultValue={student?.parent2Name ?? ""}
                autoComplete="off"
                className={O_NHAP}
              />
            </Truong>
            <Truong id="ph2-phone" nhan="SĐT">
              <input
                id="ph2-phone"
                name="parent2Phone"
                type="tel"
                inputMode="tel"
                defaultValue={student?.parent2Phone ?? ""}
                autoComplete="off"
                className={O_NHAP}
              />
            </Truong>
            <Truong id="ph2-relation" nhan="Quan hệ">
              <OQuanHe
                id="ph2-relation"
                name="parent2Relation"
                giaTri={student?.parent2Relation ?? null}
              />
            </Truong>
          </div>
        </details>
      </section>

      {/* 3 — ĐỊA CHỈ (2 cấp, lưu TÊN) */}
      <section aria-labelledby="nhom-dia-chi" className={NHOM}>
        <TieuDeNhom id="nhom-dia-chi">Địa chỉ</TieuDeNhom>
        <DiaChiPicker
          provinces={provinces}
          initialWards={initialWards}
          city={student?.city ?? null}
          ward={student?.ward ?? null}
          address={student?.address ?? null}
        />
      </section>

      {/* 4 — TRUNG TÂM */}
      <section aria-labelledby="nhom-trung-tam" className={NHOM}>
        <TieuDeNhom id="nhom-trung-tam">Tại trung tâm</TieuDeNhom>
        <div className={LUOI}>
          <Truong
            id="hv-orgunit"
            nhan="Cơ sở"
            batBuoc
            goiY="Học viên phải thuộc một cơ sở dạy học — quyết định lớp được xếp vào và ai quản lý hồ sơ này."
          >
            <select
              id="hv-orgunit"
              name="orgUnitId"
              defaultValue={student?.orgUnitId ?? ""}
              required
              className={O_NHAP}
            >
              <option value="">— Chọn cơ sở —</option>
              {orgUnits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Truong>

          {thongTinTrungTam && (
            <>
              <dl className="min-w-0">
                <dt className="mb-1 text-sm font-semibold text-foreground">Ngày nhập học</dt>
                <dd className="flex min-h-10 items-center text-sm tabular-nums text-foreground sm:min-h-9">
                  {thongTinTrungTam.ngayNhapHoc ?? (
                    <span className="text-muted-foreground">Chưa ghi danh lớp nào</span>
                  )}
                </dd>
              </dl>
              <dl className="min-w-0 @lg:col-span-2 @4xl:col-span-1">
                <dt className="mb-1 text-sm font-semibold text-foreground">
                  Lớp đang học tại trung tâm
                </dt>
                <dd className="flex min-h-10 flex-wrap items-center gap-1.5 sm:min-h-9">
                  {thongTinTrungTam.lopDangHoc.length > 0 ? (
                    thongTinTrungTam.lopDangHoc.map((l) => (
                      <Link
                        key={l.id}
                        href={`/classes/${l.id}/progress`}
                        className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary-ink"
                      >
                        {l.ten}
                      </Link>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Không học lớp nào</span>
                  )}
                </dd>
              </dl>
            </>
          )}

          <Truong
            id="hv-notes"
            nhan="Ghi chú nội bộ"
            goiY="Chỉ nhân viên thấy — không hiện cho phụ huynh."
            className={CA_HANG}
          >
            <textarea
              id="hv-notes"
              name="notes"
              rows={3}
              defaultValue={student?.notes ?? ""}
              className={O_VAN_BAN}
            />
          </Truong>
        </div>
      </section>

      {/* 5 — SỨC KHOẺ (gấp sẵn — thông tin nhạy cảm, ít khi sửa) */}
      <section aria-labelledby="nhom-suc-khoe" className="border-t border-border px-4 py-2 sm:px-6">
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span id="nhom-suc-khoe" className="text-sm font-semibold text-foreground">
              Sức khoẻ
              <span className="ml-1 font-normal text-muted-foreground">
                {coSucKhoe
                  ? `· ${allergies.length > 0 ? `${allergies.length} dị ứng` : "có ghi chú"}`
                  : "· tuỳ chọn"}
              </span>
            </span>
            <span className="text-xs text-muted-foreground group-open:hidden">Mở</span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">Thu gọn</span>
          </summary>
          <div className="space-y-4 pb-4 pt-2">
            <div className="min-w-0">
              <p className="mb-1 text-sm font-semibold text-foreground">Dị ứng</p>
              <StringArrayEditor
                value={allergies}
                onChange={setAllergies}
                placeholder="VD: Tôm, sữa, phấn hoa…"
              />
            </div>
            <Truong id="hv-health" nhan="Ghi chú sức khoẻ">
              <textarea
                id="hv-health"
                name="healthNotes"
                rows={3}
                defaultValue={student?.healthNotes ?? ""}
                placeholder="Bệnh nền, lưu ý đặc biệt để giáo viên chăm sóc đúng cách"
                className={O_VAN_BAN}
              />
            </Truong>
          </div>
        </details>
      </section>

      {/* THANH LƯU — dính đáy khung cuộn khi tờ dài hơn màn hình; hết tờ thì nằm đúng chỗ. */}
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-6">
        <p aria-live="polite" className="mr-auto text-xs text-muted-foreground">
          {dangLuu ? "Đang lưu hồ sơ…" : ""}
        </p>
        <Link href="/students" className={cn(NUT_VIEN, "flex-1 sm:flex-none")}>
          Huỷ
        </Link>
        <button
          type="submit"
          disabled={dangLuu || dangTaiAnh}
          className={cn(NUT_CHINH, "flex-1 sm:flex-none")}
        >
          {(dangLuu || dangTaiAnh) && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {dangLuu
            ? "Đang lưu…"
            : dangTaiAnh
              ? "Đang tải ảnh…"
              : isEdit
                ? "Lưu thay đổi"
                : "Tạo học viên"}
        </button>
      </div>
    </form>
  );
}
