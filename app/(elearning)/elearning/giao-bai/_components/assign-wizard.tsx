"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, TriangleAlert } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
import { TD_BANG, TR_BANG } from "../../_components/ui/trang";
import { xemTruocTapNguoiHocAction, taoLuotGiaoAction } from "../_actions";

/**
 * EL-05 — TRÌNH GIAO BÀI 4 BƯỚC.
 *
 * ⚠️ Hai luật của §10.2 sống ở ĐÂY, không ở máy chủ:
 *
 * - **Luật 5** — xem trước LIỆT KÊ ĐỦ TÊN. Ở quy mô 15 người, một luật sai chỉ lộ
 *   ra khi nhìn thấy tên; con số "8 người" thì luôn trông đúng. Nên khung xem
 *   trước là một DANH SÁCH, và con số nằm cạnh nó chứ không thay nó.
 * - **Luật 6** — người thiếu cơ sở hiện thành khối cảnh báo có HỌ TÊN + MÃ, đủ để
 *   Nhân sự tra ngay, không phải đi dò từng người.
 *
 * ⚠️ Xem trước chỉ chạy khi BẤM NÚT, không theo từng phím gõ: mỗi lượt xem trước
 * ghi một dòng AuditLog (nó đọc danh sách nhân sự theo luật tuỳ ý).
 */

type Nguoi = { fullName: string; employeeCode: string };
type TapXemTruoc = {
  nhan: (Nguoi & { jobTitle: string })[];
  thieuCoSo: Nguoi[];
  thieuTaiKhoan: Nguoi[];
  biLoaiTru: Nguoi[];
  tong: number;
};

const CHUA_KHAI = "CHUA_KHAI";

const LOAI_HD = [
  ["FULLTIME", "Toàn thời gian"],
  ["PARTTIME", "Bán thời gian"],
  ["INTERN", "Thực tập"],
  ["FREELANCE", "Cộng tác"],
  ["THU_VIEC", "Thử việc"],
  ["CHINH_THUC_XAC_DINH", "Chính thức có thời hạn"],
  ["CHINH_THUC_KHONG_XAC_DINH", "Chính thức không thời hạn"],
  // ⚠️ "Chưa khai" là một GIÁ TRỊ THẬT, không phải mục trang trí: prod có 3 người
  // không khai loại hợp đồng. Thiếu dòng này thì họ vô hình với mọi luật lọc.
  [CHUA_KHAI, "— Chưa khai —"],
] as const;

const TRANG_THAI = [
  ["ACTIVE", "Đang làm"],
  ["ON_LEAVE", "Tạm nghỉ"],
  ["RESIGNED", "Đã nghỉ"],
  ["TERMINATED", "Bị cho nghỉ"],
] as const;

type DanhMuc = {
  khoa: { id: string; title: string; code: string }[];
  phongBan: { id: string; name: string }[];
  coSo: { id: string; name: string }[];
  chucDanh: string[];
  vai: { value: string; label: string }[];
  nhanSu: { userId: string; employeeCode: string; fullName: string; jobTitle: string }[];
  /** Cờ `ELEARNING_DYNAMIC_ASSIGN_ENABLED` — tắt thì KHÔNG mời chọn kiểu Động (server cũng từ chối). */
  tapDongBat: boolean;
};

export function AssignWizard(props: DanhMuc) {
  const [buoc, setBuoc] = useState(1);
  const [dangChay, chuyen] = useTransition();

  // Bước 1
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");

  // Bước 2
  const [lmsRole, setLmsRole] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState<string[]>([]);
  const [centerId, setCenterId] = useState<string[]>([]);
  const [jobTitle, setJobTitle] = useState<string[]>([]);
  const [contractType, setContractType] = useState<string[]>([]);
  const [employmentStatus, setEmploymentStatus] = useState<string[]>([]);
  const [thamNienMin, setThamNienMin] = useState("");
  const [themTay, setThemTay] = useState<string[]>([]);
  const [loaiTru, setLoaiTru] = useState<string[]>([]);
  const [tap, setTap] = useState<TapXemTruoc | null>(null);
  const [audienceMode, setAudienceMode] = useState<"STATIC" | "DYNAMIC">("STATIC");

  // Bước 3
  const [isMandatory, setIsMandatory] = useState(true);
  const [kieuHan, setKieuHan] = useState<"KHONG" | "NGAY" | "SO_NGAY">("NGAY");
  const [dueAt, setDueAt] = useState("");
  const [dueRelativeDays, setDueRelativeDays] = useState("7");
  const [dueAnchor, setDueAnchor] = useState<"ASSIGNED_AT" | "JOINED_AT">("ASSIGNED_AT");
  const [allowLate, setAllowLate] = useState(false);
  const [lyDo, setLyDo] = useState("");

  // Bước 4
  const [inApp, setInApp] = useState(true);

  const luat = () => {
    const l: Record<string, unknown> = {};
    if (lmsRole.length) l.lmsRole = lmsRole;
    if (departmentId.length) l.departmentId = departmentId;
    if (centerId.length) l.centerId = centerId;
    if (jobTitle.length) l.jobTitle = jobTitle;
    if (contractType.length) l.contractType = contractType;
    if (employmentStatus.length) l.employmentStatus = employmentStatus;
    if (thamNienMin.trim()) l.seniorityDaysMin = Number(thamNienMin);
    // Không điều kiện nào ⇒ KHÔNG gửi luật rỗng: luật rỗng nghĩa là "mọi nhân sự
    // đang làm việc", và đó phải là một lựa chọn CÓ CHỦ Ý, không phải hệ quả của
    // việc quên chọn.
    return Object.keys(l).length ? [l] : [];
  };

  const xemTruoc = () =>
    chuyen(async () => {
      const r = await xemTruocTapNguoiHocAction({
        luat: luat(),
        mode: audienceMode,
        themTayUserId: themTay,
        loaiTruUserId: loaiTru,
      });
      if (r.ok) {
        setTap(r.data as TapXemTruoc);
      } else {
        setTap(null);
        toast.error(r.error.message);
      }
    });

  const giao = () =>
    chuyen(async () => {
      const r = await taoLuotGiaoAction(
        {
          contentType: "COURSE",
          contentId: courseId,
          title: title.trim(),
          isMandatory,
          audienceMode,
          dueAt: kieuHan === "NGAY" && dueAt ? new Date(dueAt).toISOString() : null,
          dueRelativeDays: kieuHan === "SO_NGAY" ? Number(dueRelativeDays) : null,
          dueAnchor,
          allowLate,
          notifyChannels: [
            ...(inApp ? ["IN_APP"] : []),
          ],
          luat: luat(),
          themTayUserId: themTay,
          loaiTruUserId: loaiTru,
          // Server đòi con số này (PREVIEW_REQUIRED / PREVIEW_STALE): chưa xem trước thì gửi null.
          soNguoiDaXemTruoc: tap ? tap.tong : null,
        },
        lyDo.trim() ? { reason: lyDo.trim() } : undefined,
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      const d = r.data as { soGhiDanh: number; thieuCoSo: Nguoi[] };
      toast.success(`Đã giao cho ${d.soGhiDanh} người`);
      if (d.thieuCoSo.length) {
        toast.warning(
          `${d.thieuCoSo.length} người chưa có cơ sở nên chưa nhận được: ` +
            d.thieuCoSo.map((x) => x.fullName).join(", "),
        );
      }
      setBuoc(5);
    });

  const hopLe1 = courseId && title.trim();
  const hopLe3 =
    kieuHan !== "NGAY" || Boolean(dueAt)
      ? !(isMandatory && allowLate && !lyDo.trim())
      : false;

  return (
    <div className="space-y-5">
      <ol aria-label="Các bước giao khoá" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["Nội dung", "Người học", "Thời hạn", "Xác nhận"].map((n, i) => {
          const xong = buoc > i + 1;
          const dangO = buoc === i + 1;
          return (
            <li
              key={n}
              aria-current={dangO ? "step" : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm ${
                dangO
                  ? "border-primary bg-primary-soft font-semibold text-primary-ink"
                  : xong
                    ? "border-border bg-card text-foreground"
                    : "border-border bg-card text-muted-foreground"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  dangO ? "bg-primary text-primary-foreground" : xong ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground"
                }`}
              >
                {xong ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 truncate">
                <span className="sr-only">{xong ? "Đã xong: " : dangO ? "Đang ở: " : "Chưa tới: "}</span>
                {n}
              </span>
            </li>
          );
        })}
      </ol>

      {buoc === 1 && (
        <Khoi tieuDe="Bước 1 — chọn nội dung">
          <label className="block text-sm">
            <span className={NHAN_O}>Khoá học</span>
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                const k = props.khoa.find((x) => x.id === e.target.value);
                if (k && !title.trim()) setTitle(k.title);
              }}
              className={`mt-1 ${O_CHON}`}
            >
              <option value="">— chọn khoá —</option>
              {props.khoa.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title} ({k.code})
                </option>
              ))}
            </select>
          </label>
          {props.khoa.length === 0 && (
            <p className="flex items-center gap-2 text-sm font-medium text-state-warning-ink">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Chưa có khoá nào ở trạng thái xuất bản — soạn và xuất bản khoá trước.
            </p>
          )}
          <label className="block text-sm">
            <span className={NHAN_O}>Tên lượt giao</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`mt-1 ${O_NHAP}`}
              placeholder="Ví dụ: An toàn lao động — đợt tháng 9"
            />
          </label>
        </Khoi>
      )}

      {buoc === 2 && (
        <Khoi tieuDe="Bước 2 — chọn người học">
          <div className="grid gap-3 md:grid-cols-2">
            <NhieuLuaChon nhan="Vai trò" ds={props.vai} chon={lmsRole} doi={setLmsRole} />
            <NhieuLuaChon
              nhan="Phòng ban"
              ds={props.phongBan.map((p) => ({ value: p.id, label: p.name }))}
              chon={departmentId}
              doi={setDepartmentId}
            />
            <NhieuLuaChon
              nhan="Cơ sở"
              ds={props.coSo.map((c) => ({ value: c.id, label: c.name }))}
              chon={centerId}
              doi={setCenterId}
            />
            <NhieuLuaChon
              nhan="Chức danh"
              ds={props.chucDanh.map((t) => ({ value: t, label: t }))}
              chon={jobTitle}
              doi={setJobTitle}
            />
            <NhieuLuaChon
              nhan="Loại hợp đồng"
              ds={LOAI_HD.map(([value, label]) => ({ value, label }))}
              chon={contractType}
              doi={setContractType}
            />
            <NhieuLuaChon
              nhan="Trạng thái làm việc"
              ds={TRANG_THAI.map(([value, label]) => ({ value, label }))}
              chon={employmentStatus}
              doi={setEmploymentStatus}
              ghiChu="Bỏ trống = chỉ người đang làm việc."
            />
            <label className="block text-sm">
              <span className={NHAN_O}>Thâm niên tối thiểu (ngày)</span>
              <input
                value={thamNienMin}
                onChange={(e) => setThamNienMin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={`mt-1 ${O_NHAP}`}
                placeholder="để trống nếu không lọc"
              />
              <span className={`block ${GOI_Y_O}`}>
                Người chưa khai ngày vào làm sẽ không khớp điều kiện này.
              </span>
            </label>
            <label className="block text-sm">
              <span className={NHAN_O}>Kiểu tập người học</span>
              <select
                value={audienceMode}
                onChange={(e) => setAudienceMode(e.target.value as "STATIC" | "DYNAMIC")}
                className={`mt-1 ${O_CHON}`}
              >
                <option value="STATIC">Tĩnh — chốt danh sách ngay bây giờ</option>
                {props.tapDongBat ? (
                  <option value="DYNAMIC">Động — ai khớp luật thì tự vào, rời thì bị thu hồi</option>
                ) : null}
              </select>
            </label>
          </div>

          <ChonNguoi
            nhan="Thêm đích danh"
            ds={props.nhanSu}
            chon={themTay}
            doi={setThemTay}
          />
          <ChonNguoi
            nhan="Loại trừ"
            ds={props.nhanSu}
            chon={loaiTru}
            doi={setLoaiTru}
          />

          <div className="rounded-xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold" aria-live="polite">
                {tap ? `Sẽ giao cho ${tap.tong} người` : "Chưa xem trước"}
              </p>
              <button
                type="button"
                onClick={xemTruoc}
                disabled={dangChay}
                className={NUT_PHU}
              >
                {dangChay ? "Đang tra…" : "Xem trước danh sách"}
              </button>
            </div>

            {tap && (
              <div className="mt-3 space-y-3">
                {/* Luật 5 — DANH SÁCH TÊN, không phải con số. */}
                <BangNguoi tieuDe="Sẽ nhận bài" ds={tap.nhan} />
                {tap.thieuCoSo.length > 0 && (
                  <KhoiCanhBao
                    tieuDe={`${tap.thieuCoSo.length} người CHƯA CÓ CƠ SỞ — sẽ không nhận được bài`}
                    moTa="Nhờ Nhân sự gán cơ sở làm việc cho những người này, rồi giao lại."
                    ds={tap.thieuCoSo}
                  />
                )}
                {tap.thieuTaiKhoan.length > 0 && (
                  <KhoiCanhBao
                    tieuDe={`${tap.thieuTaiKhoan.length} người CHƯA CÓ TÀI KHOẢN`}
                    moTa="Chưa đăng nhập được nên chưa học được. Nhờ Nhân sự cấp tài khoản."
                    ds={tap.thieuTaiKhoan}
                  />
                )}
                {tap.biLoaiTru.length > 0 && (
                  <BangNguoi tieuDe="Bị loại trừ" ds={tap.biLoaiTru} />
                )}
              </div>
            )}
          </div>
        </Khoi>
      )}

      {buoc === 3 && (
        <Khoi tieuDe="Bước 3 — thời hạn & điều kiện">
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
            />
            Bài bắt buộc
          </label>

          <label className="block text-sm">
            <span className={NHAN_O}>Hạn chót</span>
            <select
              value={kieuHan}
              onChange={(e) => setKieuHan(e.target.value as typeof kieuHan)}
              className={`mt-1 ${O_CHON}`}
            >
              <option value="NGAY">Đến một ngày cụ thể</option>
              <option value="SO_NGAY">Sau N ngày</option>
              <option value="KHONG">Không đặt hạn</option>
            </select>
          </label>

          {kieuHan === "NGAY" && (
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-label="Ngày giờ hạn chót"
              className={O_NHAP}
            />
          )}

          {kieuHan === "SO_NGAY" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={dueRelativeDays}
                onChange={(e) => setDueRelativeDays(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                aria-label="Số ngày"
                className={O_NHAP}
              />
              <select
                value={dueAnchor}
                onChange={(e) => setDueAnchor(e.target.value as typeof dueAnchor)}
                aria-label="Tính từ mốc nào"
                className={O_CHON}
              >
                <option value="ASSIGNED_AT">ngày kể từ khi được giao</option>
                <option value="JOINED_AT">ngày kể từ ngày vào làm</option>
              </select>
            </div>
          )}

          <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={allowLate}
              onChange={(e) => setAllowLate(e.target.checked)}
            />
            Cho phép nộp trễ
          </label>

          {isMandatory && allowLate && (
            <label className="block text-sm">
              <span className={NHAN_O}>
                Lý do cho ngoại lệ <span className="text-state-danger-ink">*</span>
              </span>
              <input
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                className={`mt-1 ${O_NHAP}`}
                placeholder="Bài bắt buộc mà cho nộp trễ là ngoại lệ — ghi lý do"
              />
            </label>
          )}
        </Khoi>
      )}

      {buoc === 4 && (
        <Khoi tieuDe="Bước 4 — thông báo & xác nhận">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <label className="flex min-h-9 items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
              Trong ứng dụng
            </label>
            <label className="flex min-h-9 items-center gap-2">
              {/* Kênh EMAIL CHƯA CÓ ĐƯỜNG GỬI (không mã nào ghi hàng đợi email của khu này) ⇒ ô bị khoá và luôn tắt, để người
                  giao không tin rằng người học sẽ nhận thư (luật 12: ô chọn là lời hứa). Bật lại khi có đường gửi + đã xác minh
                  người nhận. */}
              <input type="checkbox" className="h-4 w-4" checked={false} disabled aria-describedby="ghi-chu-email" />
              <span className="text-muted-foreground">Email</span>
              <span id="ghi-chu-email" className="text-xs text-muted-foreground">
                (chưa hỗ trợ — hôm nay chỉ có thông báo trong ứng dụng)
              </span>
            </label>
          </div>

          <dl className="grid gap-2 rounded-xl border border-border bg-background p-4 text-sm">
            <Dong nhan="Khoá" giaTri={props.khoa.find((k) => k.id === courseId)?.title ?? "—"} />
            <Dong nhan="Tên lượt giao" giaTri={title || "—"} />
            <Dong nhan="Tập người học" giaTri={audienceMode === "STATIC" ? "Tĩnh" : "Động"} />
            <Dong nhan="Số người sẽ nhận" giaTri={tap ? String(tap.tong) : "chưa xem trước"} />
            <Dong nhan="Tính chất" giaTri={isMandatory ? "Bắt buộc" : "Tự chọn"} />
          </dl>

          {!tap && (
            <p className="flex items-center gap-2 text-sm font-medium text-state-warning-ink">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Nên quay lại bước 2 và xem trước danh sách tên trước khi giao.
            </p>
          )}
        </Khoi>
      )}

      {buoc === 5 && (
        <Khoi tieuDe="Đã giao xong">
          <p className="text-sm">Lượt giao đã được tạo và nằm ở danh sách “Lượt giao đã tạo” bên dưới.</p>
          <div className="flex flex-wrap gap-2">
            {/* Tải lại trang: cho danh sách bên dưới cập nhật và trình hướng dẫn quay về bước 1. */}
            <a href="/elearning/giao-bai#luot-giao" className={NUT_PHU}>
              Xem lượt giao vừa tạo
            </a>
            <a href="/elearning/giao-bai" className={NUT_CHINH}>
              Giao thêm một lượt
            </a>
          </div>
        </Khoi>
      )}

      {buoc < 5 && (
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setBuoc((b) => Math.max(1, b - 1))}
            disabled={buoc === 1 || dangChay}
            className={NUT_PHU}
          >
            Quay lại
          </button>
          {buoc < 4 ? (
            <button
              type="button"
              onClick={() => setBuoc((b) => b + 1)}
              disabled={(buoc === 1 && !hopLe1) || (buoc === 3 && !hopLe3) || dangChay}
              className={NUT_CHINH}
            >
              Tiếp
            </button>
          ) : (
            <button
              type="button"
              onClick={giao}
              disabled={dangChay || !hopLe1}
              className={NUT_CHINH}
            >
              {dangChay ? "Đang giao…" : "Xác nhận giao"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Khoi(props: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold text-foreground">{props.tieuDe}</h2>
      {props.children}
    </section>
  );
}

function Dong(props: { nhan: string; giaTri: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{props.nhan}</dt>
      <dd className="font-medium">{props.giaTri}</dd>
    </div>
  );
}

function NhieuLuaChon(props: {
  nhan: string;
  ds: { value: string; label: string }[];
  chon: string[];
  doi: (v: string[]) => void;
  ghiChu?: string;
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-background p-3">
      <legend className="px-1 text-sm font-medium">{props.nhan}</legend>
      <div className="max-h-36 space-y-0.5 overflow-auto">
        {props.ds.map((o) => (
          <label key={o.value} className="flex min-h-8 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={props.chon.includes(o.value)}
              onChange={(e) =>
                props.doi(
                  e.target.checked
                    ? [...props.chon, o.value]
                    : props.chon.filter((x) => x !== o.value),
                )
              }
            />
            {o.label}
          </label>
        ))}
      </div>
      {props.ghiChu && <p className={GOI_Y_O}>{props.ghiChu}</p>}
    </fieldset>
  );
}

function ChonNguoi(props: {
  nhan: string;
  ds: { userId: string; employeeCode: string; fullName: string; jobTitle: string }[];
  chon: string[];
  doi: (v: string[]) => void;
}) {
  const [tim, setTim] = useState("");
  const loc = tim.trim()
    ? props.ds.filter(
        (n) =>
          n.fullName.toLocaleLowerCase("vi-VN").includes(tim.toLocaleLowerCase("vi-VN")) ||
          n.employeeCode.toLowerCase().includes(tim.toLowerCase()),
      )
    : [];
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="text-sm font-medium">{props.nhan}</p>
      <input
        value={tim}
        onChange={(e) => setTim(e.target.value)}
        placeholder="Tìm theo tên hoặc mã nhân viên…"
        aria-label={`${props.nhan}: tìm theo tên hoặc mã nhân viên`}
        className={`mt-2 ${O_NHAP}`}
      />
      {loc.length > 0 && (
        <div className="mt-2 max-h-40 space-y-1 overflow-auto">
          {loc.slice(0, 30).map((n) => (
            <button
              key={n.userId}
              type="button"
              onClick={() => {
                if (!props.chon.includes(n.userId)) props.doi([...props.chon, n.userId]);
                setTim("");
              }}
              className="block min-h-9 w-full rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {n.fullName} · {n.employeeCode} · {n.jobTitle}
            </button>
          ))}
        </div>
      )}
      {props.chon.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {props.chon.map((id) => {
            const n = props.ds.find((x) => x.userId === id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => props.doi(props.chon.filter((x) => x !== id))}
                  aria-label={`Bỏ ${n?.fullName ?? id}`}
                  className="inline-flex min-h-7 items-center rounded-full border border-border bg-card px-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {n?.fullName ?? id} ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BangNguoi(props: {
  tieuDe: string;
  ds: { fullName: string; employeeCode: string; jobTitle?: string }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-foreground">
        {props.tieuDe} ({props.ds.length})
      </p>
      {/* Bọc phân trang: luật nhóm rộng có thể khớp cả trăm người, và một hộp
          cuộn dài vô tận thì không soát được — mà soát chính là việc của khung
          xem trước. Vẫn liệt kê ĐỦ TÊN (luật 5), chỉ chia trang. */}
      <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={20}>
        <table className="w-full min-w-[40rem] text-sm">
          <tbody>
            {props.ds.map((n) => (
              <tr key={n.employeeCode} className={TR_BANG}>
                <td className={`${TD_BANG} py-2 font-medium`}>{n.fullName}</td>
                <td className={`${TD_BANG} whitespace-nowrap py-2 text-muted-foreground`}>{n.employeeCode}</td>
                <td className={`${TD_BANG} py-2 text-muted-foreground`}>{n.jobTitle ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}

function KhoiCanhBao(props: { tieuDe: string; moTa: string; ds: Nguoi[] }) {
  return (
    <div role="alert" className="rounded-xl border border-state-warning/40 bg-state-warning-soft p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TriangleAlert className="h-4 w-4 shrink-0 text-state-warning-ink" aria-hidden />
        {props.tieuDe}
      </p>
      <p className="mt-0.5 text-sm text-foreground/80">{props.moTa}</p>
      {/* Luật 6 — nêu ĐÍCH DANH. "Một số nhân sự thiếu cơ sở" buộc người giao bài
          đi dò từng người; ở quy mô 15 người thì nêu tên là làm được. */}
      <ul className="mt-2 space-y-0.5 text-sm">
        {props.ds.map((n) => (
          <li key={n.employeeCode}>
            {n.fullName} · {n.employeeCode}
          </li>
        ))}
      </ul>
    </div>
  );
}
