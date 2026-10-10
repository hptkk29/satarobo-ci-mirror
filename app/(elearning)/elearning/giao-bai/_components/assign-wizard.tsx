"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
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
  const [email, setEmail] = useState(true);

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
            ...(email ? ["EMAIL"] : []),
          ],
          luat: luat(),
          themTayUserId: themTay,
          loaiTruUserId: loaiTru,
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
    <div className="mt-5 space-y-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {["Nội dung", "Người học", "Thời hạn", "Xác nhận"].map((n, i) => (
          <li
            key={n}
            className={`rounded-full border px-3 py-1 ${
              buoc === i + 1
                ? "border-primary bg-primary/10 font-medium"
                : "border-border text-muted-foreground"
            }`}
          >
            {i + 1}. {n}
          </li>
        ))}
      </ol>

      {buoc === 1 && (
        <Khoi tieuDe="Bước 1 — chọn nội dung">
          <label className="block text-sm">
            Khoá học
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                const k = props.khoa.find((x) => x.id === e.target.value);
                if (k && !title.trim()) setTitle(k.title);
              }}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2"
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
            <p className="text-xs text-state-warning">
              Chưa có khoá nào ở trạng thái xuất bản — soạn và xuất bản khoá trước.
            </p>
          )}
          <label className="block text-sm">
            Tên lượt giao
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2"
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
              Thâm niên tối thiểu (ngày)
              <input
                value={thamNienMin}
                onChange={(e) => setThamNienMin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
                placeholder="để trống nếu không lọc"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Người chưa khai ngày vào làm sẽ không khớp điều kiện này.
              </span>
            </label>
            <label className="block text-sm">
              Kiểu tập người học
              <select
                value={audienceMode}
                onChange={(e) => setAudienceMode(e.target.value as "STATIC" | "DYNAMIC")}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
              >
                <option value="STATIC">Tĩnh — chốt danh sách ngay bây giờ</option>
                <option value="DYNAMIC">Động — ai khớp luật thì tự vào, rời thì bị thu hồi</option>
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

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {tap ? `Sẽ giao cho ${tap.tong} người` : "Chưa xem trước"}
              </p>
              <button
                type="button"
                onClick={xemTruoc}
                disabled={dangChay}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
            />
            Bài bắt buộc
          </label>

          <label className="block text-sm">
            Hạn chót
            <select
              value={kieuHan}
              onChange={(e) => setKieuHan(e.target.value as typeof kieuHan)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2"
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
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          )}

          {kieuHan === "SO_NGAY" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={dueRelativeDays}
                onChange={(e) => setDueRelativeDays(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className="rounded-lg border border-border px-3 py-2 text-sm"
              />
              <select
                value={dueAnchor}
                onChange={(e) => setDueAnchor(e.target.value as typeof dueAnchor)}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                <option value="ASSIGNED_AT">ngày kể từ khi được giao</option>
                <option value="JOINED_AT">ngày kể từ ngày vào làm</option>
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowLate}
              onChange={(e) => setAllowLate(e.target.checked)}
            />
            Cho phép nộp trễ
          </label>

          {isMandatory && allowLate && (
            <label className="block text-sm">
              Lý do cho ngoại lệ <span className="text-state-danger">*</span>
              <input
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2"
                placeholder="Bài bắt buộc mà cho nộp trễ là ngoại lệ — ghi lý do"
              />
            </label>
          )}
        </Khoi>
      )}

      {buoc === 4 && (
        <Khoi tieuDe="Bước 4 — thông báo & xác nhận">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
              Trong ứng dụng
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} />
              Email
            </label>
          </div>

          <dl className="grid gap-1 rounded-lg border border-border p-3 text-sm">
            <Dong nhan="Khoá" giaTri={props.khoa.find((k) => k.id === courseId)?.title ?? "—"} />
            <Dong nhan="Tên lượt giao" giaTri={title || "—"} />
            <Dong nhan="Tập người học" giaTri={audienceMode === "STATIC" ? "Tĩnh" : "Động"} />
            <Dong nhan="Số người sẽ nhận" giaTri={tap ? String(tap.tong) : "chưa xem trước"} />
            <Dong nhan="Tính chất" giaTri={isMandatory ? "Bắt buộc" : "Tự chọn"} />
          </dl>

          {!tap && (
            <p className="text-xs text-state-warning">
              Nên quay lại bước 2 và xem trước danh sách tên trước khi giao.
            </p>
          )}
        </Khoi>
      )}

      {buoc === 5 && (
        <Khoi tieuDe="Đã giao xong">
          <p className="text-sm">Lượt giao đã được tạo.</p>
        </Khoi>
      )}

      {buoc < 5 && (
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => setBuoc((b) => Math.max(1, b - 1))}
            disabled={buoc === 1 || dangChay}
            className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            Quay lại
          </button>
          {buoc < 4 ? (
            <button
              type="button"
              onClick={() => setBuoc((b) => b + 1)}
              disabled={(buoc === 1 && !hopLe1) || (buoc === 3 && !hopLe3) || dangChay}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Tiếp
            </button>
          ) : (
            <button
              type="button"
              onClick={giao}
              disabled={dangChay || !hopLe1}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
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
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">{props.tieuDe}</h2>
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
    <fieldset className="rounded-lg border border-border p-2">
      <legend className="px-1 text-xs font-medium">{props.nhan}</legend>
      <div className="max-h-32 space-y-1 overflow-auto">
        {props.ds.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
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
      {props.ghiChu && (
        <p className="mt-1 text-xs text-muted-foreground">{props.ghiChu}</p>
      )}
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
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{props.nhan}</p>
      <input
        value={tim}
        onChange={(e) => setTim(e.target.value)}
        placeholder="Tìm theo tên hoặc mã nhân viên…"
        className="mt-2 w-full rounded-lg border border-border px-3 py-1.5 text-sm"
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
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
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
                  className="rounded-full border border-border px-2 py-0.5 text-xs"
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
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {props.tieuDe} ({props.ds.length})
      </p>
      {/* Bọc phân trang: luật nhóm rộng có thể khớp cả trăm người, và một hộp
          cuộn dài vô tận thì không soát được — mà soát chính là việc của khung
          xem trước. Vẫn liệt kê ĐỦ TÊN (luật 5), chỉ chia trang. */}
      <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={20}>
        <table className="w-full text-sm">
          <tbody>
            {props.ds.map((n) => (
              <tr key={n.employeeCode} className="border-b border-border last:border-0">
                <td className="px-2 py-1">{n.fullName}</td>
                <td className="px-2 py-1 text-muted-foreground">{n.employeeCode}</td>
                <td className="px-2 py-1 text-muted-foreground">{n.jobTitle ?? ""}</td>
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
    <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft/30 p-3">
      <p className="text-sm font-medium">{props.tieuDe}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{props.moTa}</p>
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
