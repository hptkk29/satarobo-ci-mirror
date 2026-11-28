"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Info, TriangleAlert } from "lucide-react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { GOI_Y_O, NHAN_O, NUT_CHINH, NUT_PHU, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
import { TD_BANG, TR_BANG } from "../../_components/ui/trang";
import { TieuDeTrang } from "../../_components/ui/tieu-de-trang";
import { chuCaiDau } from "@/lib/elearning/luot-giao-thong-ke";
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
/** Người trong kết quả xem trước (đủ để vẽ dòng chọn: avatar + chức danh · cơ sở · vào làm). `userId`/`centerId` null = không thể nhận bài. */
type NguoiXemTruoc = Nguoi & { userId: string | null; jobTitle: string; centerId: string | null; joinedAt: Date | string | null };
type TapXemTruoc = {
  nhan: NguoiXemTruoc[];
  thieuCoSo: Nguoi[];
  thieuTaiKhoan: Nguoi[];
  biLoaiTru: NguoiXemTruoc[];
  tong: number;
  /** Người (trong nhận ∪ bị loại trừ) đã có lượt học khoá này — lượt giao sẽ BỎ QUA họ. */
  daCoGhiDanh: { userId: string; fullName: string; employeeCode: string }[];
};
type KetQuaGiao = {
  assignmentId: string;
  soGhiDanh: number;
  thieuCoSo: Nguoi[];
  daCoGhiDanh: Nguoi[];
  // Ba nhóm máy chủ cũng trả về — người bị loại khỏi lượt giao vì lý do này phải được nêu đích danh, không để `soGhiDanh` thấp hơn con số trên nút mà không ai giải thích.
  thieuTaiKhoan?: Nguoi[];
  khongTinhDuocHan?: Nguoi[];
  coSoChuaCoDonVi?: string[];
};

const CHUA_KHAI = "CHUA_KHAI";
const TEN_BUOC = ["chọn nội dung", "chọn người học", "thời hạn", "xác nhận"];

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
  khoa: { id: string; title: string; code: string; /** Bản ĐANG PHÁT HÀNH mới nhất (nhãn + số bài) — chỉ để hiện dưới tên khoá; `null` = chưa đọc được. */ banMoi: { nhan: string; soBai: number } | null }[];
  phongBan: { id: string; name: string }[];
  coSo: { id: string; name: string }[];
  chucDanh: string[];
  vai: { value: string; label: string }[];
  nhanSu: { userId: string; employeeCode: string; fullName: string; jobTitle: string }[];
  /** Cờ `ELEARNING_DYNAMIC_ASSIGN_ENABLED` — tắt thì KHÔNG mời chọn kiểu Động (server cũng từ chối). */
  tapDongBat: boolean;
  /** Người đã chọn sẵn (từ màn Người học: `?nguoi=`) — nạp vào ô "thêm tay". Chỉ là điền sẵn; server vẫn kiểm từng người khi giao. */
  themTayBanDau?: string[];
};

export function AssignWizard(props: DanhMuc) {
  const [buoc, setBuoc] = useState(1);
  const [dangChay, chuyen] = useTransition();

  // Bước 1
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [timKhoa, setTimKhoa] = useState("");
  const [ketQua, setKetQua] = useState<KetQuaGiao | null>(null);
  // Chặn bấm đúp: `useTransition` chỉ khoá nút SAU lượt render kế tiếp — hai lần bấm sát nhau vẫn lọt cả hai vào hàm giao.
  const daGui = useRef(false);

  // Bước 2
  const [lmsRole, setLmsRole] = useState<string[]>([]);
  const [departmentId, setDepartmentId] = useState<string[]>([]);
  const [centerId, setCenterId] = useState<string[]>([]);
  const [jobTitle, setJobTitle] = useState<string[]>([]);
  const [contractType, setContractType] = useState<string[]>([]);
  const [employmentStatus, setEmploymentStatus] = useState<string[]>([]);
  const [thamNienMin, setThamNienMin] = useState("");
  const [themTay, setThemTay] = useState<string[]>(props.themTayBanDau ?? []);
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

  /** Mọi thay đổi LUẬT/danh sách ở bước 2 làm xem trước cũ hết đúng — bỏ nó đi, kẻo giao với con số của luật cũ (server từ chối PREVIEW_STALE). */
  const doiLuat = <T,>(dat: (v: T) => void) => (v: T) => {
    dat(v);
    setTap(null);
  };

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
        courseId,
      });
      if (r.ok) {
        setTap(r.data as TapXemTruoc);
      } else {
        setTap(null);
        toast.error(r.error.message);
      }
    });

  /** Chọn lại / bỏ chọn người ngay trên danh sách xem trước: bỏ chọn = thêm vào "Loại trừ" (cùng danh sách ô Loại trừ), và xem trước được cập nhật tại chỗ cho khớp con số máy chủ sẽ tính. */
  const dieuChinh = (userIds: string[], chon: boolean) => {
    if (!tap) return;
    const dich = new Set(userIds);
    const theoTen = (a: NguoiXemTruoc, b: NguoiXemTruoc) => a.fullName.localeCompare(b.fullName, "vi-VN") || a.employeeCode.localeCompare(b.employeeCode);
    if (chon) {
      const them = tap.biLoaiTru.filter((x) => x.userId && x.centerId && dich.has(x.userId));
      setLoaiTru((l) => l.filter((id) => !dich.has(id)));
      setTap({ ...tap, nhan: [...tap.nhan, ...them].sort(theoTen), biLoaiTru: tap.biLoaiTru.filter((x) => !them.includes(x)), tong: tap.nhan.length + them.length });
    } else {
      const bot = tap.nhan.filter((x) => x.userId && dich.has(x.userId));
      setLoaiTru((l) => [...new Set([...l, ...bot.map((x) => x.userId as string)])]);
      setTap({ ...tap, nhan: tap.nhan.filter((x) => !bot.includes(x)), biLoaiTru: [...tap.biLoaiTru, ...bot], tong: tap.nhan.length - bot.length });
    }
  };

  const giao = () => {
    if (daGui.current) return;
    daGui.current = true;
    chuyen(async () => {
      try {
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
            notifyChannels: [...(inApp ? ["IN_APP"] : [])],
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
          // Lỗi ⇒ cho bấm lại (chưa có lượt giao nào được tạo).
          daGui.current = false;
          return;
        }
        const d = r.data as KetQuaGiao;
        toast.success(`Đã giao cho ${d.soGhiDanh} người`);
        // Kết quả từng nhóm người được nêu ĐÍCH DANH ngay trên màn kết quả (không chỉ toast thoáng qua).
        setKetQua(d);
        setBuoc(5);
      } catch (e) {
        daGui.current = false;
        throw e;
      }
    });
  };

  const hopLe1 = courseId && title.trim();
  // "Sau N ngày": N phải là số nguyên ≥ 1 (rỗng/0 là hạn vô nghĩa, và máy chủ sẽ từ chối sau khi người dùng đã đi hết bốn bước).
  const soNgayHopLe = Number(dueRelativeDays) >= 1;
  const hopLe3 =
    kieuHan === "SO_NGAY" && !soNgayHopLe
      ? false
      : kieuHan !== "NGAY" || Boolean(dueAt)
      ? !(isMandatory && allowLate && !lyDo.trim())
      : false;

  const khoaChon = props.khoa.find((x) => x.id === courseId);
  const khoaLoc = timKhoa.trim()
    ? props.khoa.filter((k) => `${k.title} ${k.code}`.toLocaleLowerCase("vi-VN").includes(timKhoa.trim().toLocaleLowerCase("vi-VN")))
    : props.khoa;
  // Người đã có lượt học khoá này, chỉ tính những ai ĐANG nằm trong tập nhận (bỏ chọn rồi thì không còn "bị bỏ qua").
  const idNhan = new Set((tap?.nhan ?? []).map((x) => x.userId));
  const daCo = (tap?.daCoGhiDanh ?? []).filter((x) => idNhan.has(x.userId));
  const soSeGiao = tap ? tap.tong - daCo.length : 0;
  const hanTomTat =
    kieuHan === "KHONG"
      ? "Không có hạn"
      : kieuHan === "NGAY"
        ? dueAt
          ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(dueAt))
          : "chọn ở bước 3"
        : `${dueRelativeDays || "?"} ngày sau ${dueAnchor === "JOINED_AT" ? "ngày vào làm" : "ngày giao"}`;

  return (
    <div className="space-y-6">
      <TieuDeTrang
        title="Giao khoá nội bộ"
        subtitle={buoc < 5 ? `Bước ${buoc} — ${TEN_BUOC[buoc - 1]}` : "Đã giao"}
        actions={
          <a href="/elearning/luot-giao" className={NUT_PHU}>
            Lượt giao đã tạo
          </a>
        }
      />
      <ol aria-label="Các bước giao khoá" className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border">
        {["Chọn nội dung", "Chọn người học", "Thời hạn", "Xác nhận"].map((n, i) => {
          const xong = buoc > i + 1;
          const dangO = buoc === i + 1;
          return (
            <li
              key={n}
              aria-current={dangO ? "step" : undefined}
              className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 text-sm ${
                dangO ? "border-primary font-semibold text-foreground" : xong ? "border-transparent text-foreground" : "border-transparent text-muted-foreground"
              }`}
            >
              {xong ? <Check className="h-4 w-4 text-state-success" aria-hidden /> : <span aria-hidden className="text-xs">{i + 1}</span>}
              <span className="min-w-0 truncate">
                <span className="sr-only">{xong ? "Đã xong: " : dangO ? "Đang ở: " : "Chưa tới: "}</span>
                {n}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="min-w-0 space-y-5">

      {buoc === 1 && (
        <Khoi tieuDe="Khoá sẽ giao">
          <fieldset className="space-y-0">
            <legend className="sr-only">Khoá học</legend>
            <input
              value={timKhoa}
              onChange={(e) => setTimKhoa(e.target.value)}
              aria-label="Tìm khoá theo tên hoặc mã"
              placeholder="Tìm khoá theo tên hoặc mã…"
              className={`mb-3 ${O_NHAP}`}
            />
            <div role="radiogroup" aria-label="Khoá học" className="border-t border-border">
              {khoaLoc.map((k) => (
                <label key={k.id} className="flex cursor-pointer items-start gap-3 border-b border-border py-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input
                    type="radio"
                    name="khoa-giao"
                    value={k.id}
                    checked={courseId === k.id}
                    onChange={() => {
                      // Đổi khoá ⇒ xem trước cũ hết đúng ("đã có lượt học khoá này" đo theo khoá).
                      if (k.id !== courseId) setTap(null);
                      setCourseId(k.id);
                      if (!title.trim()) setTitle(k.title);
                    }}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{k.title}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      {k.code}
                      {k.banMoi ? ` · bản ${k.banMoi.nhan} · ${k.banMoi.soBai} bài · đang phát hành` : " · đang phát hành"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {props.khoa.length > 0 && khoaLoc.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">Không có khoá nào khớp “{timKhoa.trim()}”.</p>
          )}
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
          <p role="note" className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            Chỉ khoá nội bộ đang phát hành mới giao được. Khoá online của học viên không có ở đây.
          </p>
        </Khoi>
      )}

      {buoc === 2 && (
        <Khoi tieuDe="Người học">
          <div className="grid gap-3 md:grid-cols-2">
            <NhieuLuaChon nhan="Vai trò" ds={props.vai} chon={lmsRole} doi={doiLuat(setLmsRole)} />
            <NhieuLuaChon
              nhan="Phòng ban"
              ds={props.phongBan.map((p) => ({ value: p.id, label: p.name }))}
              chon={departmentId}
              doi={doiLuat(setDepartmentId)}
            />
            <NhieuLuaChon
              nhan="Cơ sở"
              ds={props.coSo.map((c) => ({ value: c.id, label: c.name }))}
              chon={centerId}
              doi={doiLuat(setCenterId)}
            />
            <NhieuLuaChon
              nhan="Chức danh"
              ds={props.chucDanh.map((t) => ({ value: t, label: t }))}
              chon={jobTitle}
              doi={doiLuat(setJobTitle)}
            />
            <NhieuLuaChon
              nhan="Loại hợp đồng"
              ds={LOAI_HD.map(([value, label]) => ({ value, label }))}
              chon={contractType}
              doi={doiLuat(setContractType)}
            />
            <NhieuLuaChon
              nhan="Trạng thái làm việc"
              ds={TRANG_THAI.map(([value, label]) => ({ value, label }))}
              chon={employmentStatus}
              doi={doiLuat(setEmploymentStatus)}
              ghiChu="Bỏ trống = chỉ người đang làm việc."
            />
            <label className="block text-sm">
              <span className={NHAN_O}>Thâm niên tối thiểu (ngày)</span>
              <input
                value={thamNienMin}
                onChange={(e) => {
                  setThamNienMin(e.target.value.replace(/\D/g, ""));
                  setTap(null);
                }}
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
                onChange={(e) => {
                  setAudienceMode(e.target.value as "STATIC" | "DYNAMIC");
                  setTap(null);
                }}
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
            doi={doiLuat(setThemTay)}
          />
          <ChonNguoi
            nhan="Loại trừ"
            ds={props.nhanSu}
            chon={loaiTru}
            doi={doiLuat(setLoaiTru)}
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
                {/* Luật 5 — DANH SÁCH TÊN, không phải con số. Mỗi dòng chọn/bỏ được; bỏ chọn = loại trừ. */}
                <DanhSachChon
                  tap={tap}
                  tenCoSo={Object.fromEntries(props.coSo.map((c) => [c.id, c.name]))}
                  dieuChinh={dieuChinh}
                />
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
                {/* Người bị loại trừ mà KHÔNG chọn lại được (thiếu tài khoản/cơ sở) vẫn phải hiện — biến mất im lặng là cách chắc chắn nhất để tưởng mình đã giao đủ. */}
                {tap.biLoaiTru.some((x) => !x.userId || !x.centerId) && (
                  <BangNguoi tieuDe="Bị loại trừ (không chọn lại được)" ds={tap.biLoaiTru.filter((x) => !x.userId || !x.centerId)} />
                )}
              </div>
            )}
          </div>
        </Khoi>
      )}

      {buoc === 3 && (
        <Khoi tieuDe="Thời hạn & điều kiện">
          <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
            />
            Bài bắt buộc
            {khoaChon?.banMoi ? <span className="font-normal text-muted-foreground">· tất cả {khoaChon.banMoi.soBai} bài</span> : null}
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

          <fieldset className="space-y-1">
            <legend className={NHAN_O}>Nhắc học qua</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <label className="flex min-h-9 items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />
                Trong ứng dụng
              </label>
              {/* Email / Zalo CHƯA CÓ ĐƯỜNG GỬI (QĐ-CDA-08: bỏ Zalo; không mã nào ghi hàng đợi email của khu này) ⇒ ô bị khoá và luôn tắt,
                  để người giao không tin rằng người học sẽ nhận thư/tin (luật 12: ô chọn là lời hứa). Bật lại khi có đường gửi + đã xác minh người nhận. */}
              <label className="flex min-h-9 items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={false} disabled aria-describedby="ghi-chu-email" />
                <span className="text-muted-foreground">Email</span>
                <span id="ghi-chu-email" className="text-xs text-muted-foreground">(chưa hỗ trợ — hôm nay chỉ có thông báo trong ứng dụng)</span>
              </label>
              <label className="flex min-h-9 items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={false} disabled aria-describedby="ghi-chu-zalo" />
                <span className="text-muted-foreground">Zalo</span>
                <span id="ghi-chu-zalo" className="text-xs text-muted-foreground">(chưa hỗ trợ)</span>
              </label>
            </div>
          </fieldset>
        </Khoi>
      )}

      {buoc === 4 && (
        <Khoi tieuDe="Xác nhận giao">
          <dl className="grid gap-2 rounded-xl border border-border bg-background p-4 text-sm">
            <Dong rong nhan="Khoá" giaTri={khoaChon ? `${khoaChon.title}${khoaChon.banMoi ? ` · bản ${khoaChon.banMoi.nhan} · ${khoaChon.banMoi.soBai} bài${isMandatory ? " bắt buộc" : ""}` : ""}` : "—"} />
            <Dong rong nhan="Tên lượt giao" giaTri={title || "—"} />
            <Dong rong nhan="Người học" giaTri={tap ? `${tap.tong} người · ${audienceMode === "STATIC" ? "tập tĩnh" : "tập động"}` : "chưa xem trước"} />
            <Dong rong nhan="Tính chất" giaTri={isMandatory ? "Bắt buộc" : "Tự chọn"} />
            <Dong rong nhan="Hạn" giaTri={hanTomTat} />
            <Dong rong nhan="Nộp trễ" giaTri={allowLate ? `Cho phép${lyDo.trim() ? ` — ${lyDo.trim()}` : ""}` : "Không cho phép"} />
            <Dong rong nhan="Nhắc học" giaTri={inApp ? "Trong ứng dụng" : "Không nhắc"} />
          </dl>

          {tap && daCo.length > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {daCo.length} người đang có lượt học khoá này — sẽ bỏ qua {daCo.map((x) => x.fullName).join(", ")}
              </span>
            </p>
          )}

          {!tap && (
            <p className="flex items-center gap-2 text-sm font-medium text-state-warning-ink">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Chưa xem trước danh sách người nhận — quay lại bước 2 và bấm “Xem trước danh sách” để giao.
            </p>
          )}
        </Khoi>
      )}

      {buoc === 5 && (
        <Khoi tieuDe="Đã giao xong">
          <p role="status" className="text-sm">
            Đã giao cho <strong>{ketQua?.soGhiDanh ?? 0}</strong> người. Lượt giao nằm ở mục “Lượt giao”.
          </p>
          {ketQua && ketQua.daCoGhiDanh.length > 0 && (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm">
              {ketQua.daCoGhiDanh.length} người đã có lượt học khoá này từ trước (kể cả lượt đã thu hồi) nên không tạo thêm lượt: {ketQua.daCoGhiDanh.map((x) => x.fullName).join(", ")}
            </p>
          )}
          {ketQua && (ketQua.thieuTaiKhoan?.length ?? 0) > 0 && (
            <KhoiCanhBao
              tieuDe={`${ketQua.thieuTaiKhoan!.length} người chưa có tài khoản nên chưa nhận được`}
              moTa="Nhờ Nhân sự cấp tài khoản cho những người này, rồi giao lại."
              ds={ketQua.thieuTaiKhoan!}
            />
          )}
          {ketQua && (ketQua.khongTinhDuocHan?.length ?? 0) > 0 && (
            <KhoiCanhBao
              tieuDe={`${ketQua.khongTinhDuocHan!.length} người không tính được hạn nên chưa nhận được`}
              moTa="Hạn tính từ ngày vào làm nhưng những người này chưa khai ngày vào làm. Nhờ Nhân sự bổ sung, hoặc giao lại với hạn khác."
              ds={ketQua.khongTinhDuocHan!}
            />
          )}
          {ketQua && (ketQua.coSoChuaCoDonVi?.length ?? 0) > 0 && (
            <p role="alert" className="rounded-xl border border-state-warning/40 bg-state-warning-soft px-4 py-3 text-sm">
              Có cơ sở chưa gắn đơn vị tổ chức nên người ở đó chưa nhận được bài — nhờ quản trị hệ thống gắn đơn vị cho cơ sở rồi giao lại.
            </p>
          )}
          {ketQua && ketQua.thieuCoSo.length > 0 && (
            <KhoiCanhBao
              tieuDe={`${ketQua.thieuCoSo.length} người chưa có cơ sở nên chưa nhận được`}
              moTa="Nhờ Nhân sự gán cơ sở làm việc cho những người này, rồi giao lại."
              ds={ketQua.thieuCoSo}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {ketQua ? (
              <a href={`/elearning/giao-bai/${ketQua.assignmentId}`} className={NUT_CHINH}>
                Xem lượt giao vừa tạo
              </a>
            ) : null}
            <a href="/elearning/luot-giao" className={NUT_PHU}>
              Tất cả lượt giao
            </a>
            {/* Tải lại trang: trình hướng dẫn quay về bước 1 với dữ liệu sạch. */}
            <a href="/elearning/giao-bai" className={NUT_PHU}>
              Giao thêm một lượt
            </a>
          </div>
        </Khoi>
      )}

      </div>

      {buoc < 5 && (
        <aside aria-label="Tóm tắt" className="min-w-0 space-y-4 lg:sticky lg:top-20">
          <h2 className="text-lg font-semibold text-foreground">Tóm tắt</h2>
          <dl className="space-y-1.5 text-sm">
            <Dong nhan="Khoá" giaTri={khoaChon?.title ?? "chọn ở bước 1"} />
            <Dong nhan="Tên lượt" giaTri={title.trim() || "—"} />
            <Dong nhan="Người học" giaTri={tap ? `${tap.tong} người · ${audienceMode === "STATIC" ? "tập tĩnh" : "tập động"}` : "chọn ở bước 2"} />
            <Dong nhan="Hạn" giaTri={hanTomTat} />
          </dl>
          <div className="flex flex-wrap gap-2">
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
                disabled={dangChay || !hopLe1 || !tap || soSeGiao <= 0}
                className={NUT_CHINH}
              >
                {dangChay ? "Đang giao…" : tap ? `Giao khoá cho ${soSeGiao} người` : "Xác nhận giao"}
              </button>
            )}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}

function Khoi(props: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{props.tieuDe}</h2>
      {props.children}
    </section>
  );
}

function Dong(props: { nhan: string; giaTri: string; rong?: boolean }) {
  return (
    <div className={`grid gap-3 ${props.rong ? "grid-cols-[7.5rem_minmax(0,1fr)]" : "grid-cols-[5.5rem_minmax(0,1fr)]"}`}>
      <dt className="text-muted-foreground">{props.nhan}</dt>
      <dd className="min-w-0 break-words font-medium">{props.giaTri}</dd>
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

function DanhSachChon(props: {
  tap: TapXemTruoc;
  tenCoSo: Record<string, string>;
  dieuChinh: (userIds: string[], chon: boolean) => void;
}) {
  const { tap } = props;
  // Chỉ người THỰC SỰ nhận bài được mới chọn lại được; người thiếu tài khoản/cơ sở có khối cảnh báo riêng.
  const chonLaiDuoc = tap.biLoaiTru.filter((x) => x.userId && x.centerId);
  const dong = [...tap.nhan.map((x) => ({ n: x, chon: true })), ...chonLaiDuoc.map((x) => ({ n: x, chon: false }))].sort(
    (a, b) => a.n.fullName.localeCompare(b.n.fullName, "vi-VN") || a.n.employeeCode.localeCompare(b.n.employeeCode),
  );
  // dd/mm theo giờ Việt Nam. Ghép từ các phần: `Intl` vi-VN chỉ có ngày + tháng trả "02-10" (ICU khác nhau giữa máy), không phải "02/10" của thiết kế.
  const ngayVao = (d: Date | string | null) => {
    if (!d) return null;
    const ph = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).formatToParts(new Date(d));
    const lay = (t: string) => ph.find((x) => x.type === t)?.value ?? "";
    return `${lay("day")}/${lay("month")}`;
  };
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-foreground">Xem trước · {dong.length} người khớp</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-live="polite">đã chọn {tap.nhan.length}</span>
          <button type="button" className="min-h-9 text-primary underline-offset-2 hover:underline disabled:opacity-50" disabled={chonLaiDuoc.length === 0} onClick={() => props.dieuChinh(chonLaiDuoc.map((x) => x.userId as string), true)}>
            Chọn tất cả {dong.length} người
          </button>
          <button type="button" className="min-h-9 text-primary underline-offset-2 hover:underline disabled:opacity-50" disabled={tap.nhan.length === 0} onClick={() => props.dieuChinh(tap.nhan.map((x) => x.userId as string), false)}>
            Bỏ chọn hết
          </button>
        </div>
      </div>
      {/* Vẫn liệt kê ĐỦ TÊN (luật 5), chia trang để soát được khi luật khớp cả trăm người. */}
      <PhanTrangBang cuonNgang tenDonVi="người" soDongMacDinh={20}>
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Người khớp luật — bỏ chọn một người để loại trừ họ</caption>
          <tbody>
            {dong.map(({ n, chon }) => (
              <tr key={n.employeeCode} className={TR_BANG}>
                <td className={`${TD_BANG} w-10 py-2`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={chon}
                    aria-label={`${chon ? "Bỏ" : "Chọn"} ${n.fullName}`}
                    onChange={(e) => props.dieuChinh([n.userId as string], e.target.checked)}
                  />
                </td>
                <td className={`${TD_BANG} py-2`}>
                  <span className="inline-flex items-center gap-2.5">
                    <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {chuCaiDau(n.fullName)}
                    </span>
                    <span className={chon ? "font-medium" : "font-medium text-muted-foreground line-through"}>{n.fullName}</span>
                  </span>
                </td>
                <td className={`${TD_BANG} py-2 text-muted-foreground`}>
                  {[n.jobTitle, n.centerId ? props.tenCoSo[n.centerId] : null, ngayVao(n.joinedAt) ? `vào làm ${ngayVao(n.joinedAt)}` : null].filter(Boolean).join(" · ")}
                </td>
                <td className={`${TD_BANG} whitespace-nowrap py-2 text-muted-foreground`}>{n.employeeCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
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
