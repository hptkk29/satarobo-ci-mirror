"use client";

// components/admin/nguon-hoa-hong/affiliate/doi-tac-sheet.tsx — Sheet «Tạo đối tác» / «Sửa đối tác» (tab Affiliate, AFF-P0b).
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// Component này KHÔNG tự quyết có vẽ hay không: trang chỉ dựng nó khi `scope.has("affiliates:manage")` ∧ module bật — đúng hai điều kiện mà `taoDoiTacAction` / `suaDoiTacAction` kiểm ở đầu hàm.
// Các ô khoá cũng là thứ máy chủ sẽ từ chối: mã `?ref=` KHOÁ khi đối tác đã có lead (`dong.maDaKhoa` — cùng hàm `timDoiTacDaCoLead` với cổng ghi). Loại/nhãn đã ngừng không chọn MỚI được (chỉ giữ).
//
// ── Hai chỗ người dùng hay vấp ─────────────────────────────────────────────────────────────────────────────────
//  · Mã `?ref=` tự gợi ý từ tên cho tới khi người dùng tự gõ vào ô mã; dòng dưới ô cho thấy mã SẼ LƯU (đã chuẩn hoá) — người gõ `an-nguyen` biết nó thành `ANNGUYEN` trước khi lưu.
//  · «Tỉ lệ tham chiếu» chỉ để đối soát tay, KHÔNG dùng tính tiền — nhãn ô nói thẳng điều đó (chưa có quy chế hoa hồng cho affiliate).
//
// Cá nhân/tổ chức: tổ chức không có «Thuộc tổ chức» và không có «Nhân viên liên kết» (ô ẩn VÀ giá trị bị xoá khi đổi kiểu — không gửi ngầm giá trị cũ).
// Hàm gọi máy chủ được TIÊM (`tao`, `sua`, `tim`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { suaDoiTacAction, taoDoiTacAction, timNhanVienAction } from "@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { DongDoiTac, TuyChonDoiTac } from "@/lib/affiliate/doc-doi-tac";
import type { KetQuaSuaDoiTac, KetQuaTaoDoiTac } from "@/lib/affiliate/ghi-doi-tac";
import {
  KIEU_DOI_TAC,
  LY_DO_TOI_THIEU_DOI_TAC,
  NHAN_KIEU_DOI_TAC,
  chuanHoaMaDoiTac,
  goiYMaTuTen,
  suaDoiTacSchema,
  taoDoiTacSchema,
  trangThaiKhiTao,
  type KieuDoiTac,
} from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import type { NguoiDaChon } from "@/lib/nguon/chon-nguon";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, O_NHAP, TEXTAREA } from "../classes";
import { ReferrerPicker, type HamTim } from "../referrer-picker";

/** Mã `?ref=` KHÔNG còn quảng bá như một link mẫu: link giới thiệu thật trỏ về website + trang đích do Admin khai và tạo ở tab Link / QR / Mã. */
export const HUONG_DAN_MA_TAO_LINK = "Mã này dùng để tạo link giới thiệu trên các website và trang đích Admin cho phép — tạo ở tab Link / QR / Mã.";

type Tao = (input: { vao: Record<string, unknown> }) => Promise<KetQuaTaoDoiTac>;
type Sua = (input: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaDoiTac>;

const TAO_MAC_DINH: Tao = (i) => taoDoiTacAction(i);
const SUA_MAC_DINH: Sua = (i) => suaDoiTacAction(i);
const TIM_MAC_DINH: HamTim = (_loai, q) => timNhanVienAction({ q });

type Truong = "partyKind" | "name" | "typeId" | "tagIds" | "code" | "phone" | "email" | "note" | "centerId" | "commissionPercent" | "employeeId" | "parentPartyId" | "lyDo";
const TRUONG_FORM: readonly Truong[] = ["partyKind", "name", "typeId", "tagIds", "code", "phone", "email", "note", "centerId", "commissionPercent", "employeeId", "parentPartyId", "lyDo"];
type Loi = Partial<Record<Truong, string>>;
type Banner = { text: string; taiLai: boolean };

type NhanSuDaChon = Extract<NguoiDaChon, { loai: "NHAN_SU" }>;

type Form = {
  kieu: KieuDoiTac;
  ten: string;
  loaiId: string;
  nhanIds: string[];
  ma: string;
  /** Người dùng đã tự gõ vào ô mã ⇒ thôi tự gợi ý từ tên. */
  maTuGo: boolean;
  dienThoai: string;
  email: string;
  ghiChu: string;
  coSoId: string;
  toChucId: string;
  nhanVien: NhanSuDaChon | null;
  tiLe: string;
  lyDo: string;
};

function formBanDau(dong: DongDoiTac | undefined): Form {
  if (!dong) {
    return { kieu: "PERSON", ten: "", loaiId: "", nhanIds: [], ma: "", maTuGo: false, dienThoai: "", email: "", ghiChu: "", coSoId: "", toChucId: "", nhanVien: null, tiLe: "", lyDo: "" };
  }
  return {
    kieu: dong.kieu,
    ten: dong.ten,
    loaiId: dong.loai?.id ?? "",
    nhanIds: dong.nhan.map((n) => n.id),
    ma: dong.ma,
    maTuGo: true,
    dienThoai: dong.dienThoai ?? "",
    email: dong.email ?? "",
    ghiChu: dong.ghiChu ?? "",
    coSoId: dong.coSoId ?? "",
    toChucId: dong.toChuc?.id ?? "",
    nhanVien: dong.nhanVien ? { loai: "NHAN_SU", employeeId: dong.nhanVien.id, ten: dong.nhanVien.ten, ma: dong.nhanVien.ma, vai: "OTHER_EMPLOYEE" } : null,
    tiLe: dong.tiLeThamChieu === null ? "" : String(dong.tiLeThamChieu),
    lyDo: "",
  };
}

function guiDi(f: Form): Record<string, unknown> {
  const laToChuc = f.kieu === "ORGANIZATION";
  return {
    partyKind: f.kieu,
    name: f.ten,
    typeId: f.loaiId,
    tagIds: f.nhanIds,
    code: f.ma,
    phone: f.dienThoai,
    email: f.email,
    note: f.ghiChu,
    centerId: f.coSoId === "" ? null : f.coSoId,
    commissionPercent: f.tiLe.trim() === "" ? null : Number(f.tiLe),
    employeeId: laToChuc ? null : (f.nhanVien?.employeeId ?? null),
    parentPartyId: laToChuc || f.toChucId === "" ? null : f.toChucId,
  };
}

export function DoiTacSheet({
  dong,
  tuyChon,
  coTheTaoLink,
  children,
  triggerClassName,
  triggerAriaLabel,
  tao = TAO_MAC_DINH,
  sua = SUA_MAC_DINH,
  tim = TIM_MAC_DINH,
}: {
  /** Có ⇒ chế độ SỬA; vắng ⇒ TẠO. */
  dong?: DongDoiTac;
  tuyChon: TuyChonDoiTac;
  /** Người xem được phát link không (`affiliate_links:manage`) — chỉ khi đó dòng hướng dẫn mới có đường dẫn sang tab «Link / QR / Mã». Bắt buộc (luật 11). */
  coTheTaoLink: boolean;
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  tao?: Tao;
  sua?: Sua;
  tim?: HamTim;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(() => formBanDau(dong));
  const [loi, setLoi] = useState<Loi>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const laSua = dong !== undefined;
  const id = (ten: string) => `${uid}-${ten}`;

  const loaiChon = tuyChon.loai.find((l) => l.id === f.loaiId) ?? null;
  const loaiChoChon = tuyChon.loai.filter((l) => l.dangDung || l.id === dong?.loai?.id);
  const khongCoLoai = tuyChon.loai.every((l) => !l.dangDung) && !dong?.loai;
  const kqMa = chuanHoaMaDoiTac(f.ma);
  const maDoi = laSua && kqMa.ok && kqMa.ma !== dong.ma;
  const canLyDoMa = laSua && maDoi && dong.trangThai !== "DRAFT";
  const maKhoa = laSua && dong.maDaKhoa;
  const nhanHienCo = new Set(dong?.nhan.map((n) => n.id) ?? []);
  const nhanHienThi = tuyChon.nhan.filter((n) => n.dangDung || nhanHienCo.has(n.id));
  const toChucChon = tuyChon.toChuc.filter((t) => t.id !== dong?.id);
  const coToChucNgoaiDs = dong?.toChuc && !toChucChon.some((t) => t.id === dong.toChuc?.id);
  const coCoSoNgoaiDs = dong?.coSoId && !tuyChon.coSo.some((c) => c.id === dong.coSoId);

  function doiMo(moMoi: boolean) {
    setOpen(moMoi);
    // Mỗi lần mở là một lần làm mới: bản nháp dở của lượt trước (và lỗi của nó) không sống sang lượt sau.
    if (moMoi) {
      setF(formBanDau(dong));
      setLoi({});
      setBanner(null);
    }
  }

  function datF(p: Partial<Form>, xoaLoi: Truong[] = []) {
    setF((cu) => ({ ...cu, ...p }));
    if (xoaLoi.length > 0) setLoi((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !xoaLoi.includes(k as Truong))) as Loi);
  }

  function focusLoi() {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus?.());
  }

  function luu() {
    setBanner(null);
    const vao = guiDi(f);
    const schema = laSua ? suaDoiTacSchema : taoDoiTacSchema;
    const kiem = schema.safeParse(vao);
    const sai: Loi = {};
    if (!kiem.success) {
      for (const it of kiem.error.issues) {
        const k = it.path[0];
        if (typeof k === "string" && (TRUONG_FORM as readonly string[]).includes(k) && !sai[k as Truong]) sai[k as Truong] = it.message;
      }
    }
    if (canLyDoMa && f.lyDo.trim().length < LY_DO_TOI_THIEU_DOI_TAC) sai.lyDo = `Đổi mã giới thiệu cần lý do từ ${LY_DO_TOI_THIEU_DOI_TAC} ký tự.`;
    if (Object.keys(sai).length > 0) {
      setLoi(sai);
      focusLoi();
      return;
    }
    setLoi({});
    batDauLuu(async () => {
      let r: KetQuaTaoDoiTac | KetQuaSuaDoiTac;
      try {
        r = laSua
          ? await sua({ id: dong.id, updatedAtDaThay: dong.capNhatLuc, vao, lyDo: canLyDoMa ? f.lyDo.trim() : null })
          : await tao({ vao });
      } catch {
        setBanner({ text: "Không lưu được lúc này. Thử lại sau ít giây.", taiLai: false });
        return;
      }
      if (r.ok) {
        toast.success(laSua ? ("doi" in r && !r.doi ? "Không có gì thay đổi." : `Đã lưu đối tác «${f.ten.trim()}».`) : `Đã tạo đối tác «${f.ten.trim()}».`);
        setOpen(false);
        router.refresh();
        return;
      }
      // Lỗi map về ĐÚNG ô; lỗi không thuộc ô nào (quyền, cờ, vừa bị đổi) lên đầu Sheet.
      const k = r.truong;
      if (k && (TRUONG_FORM as readonly string[]).includes(k)) {
        setLoi({ [k]: r.loi });
        focusLoi();
      } else {
        setBanner({ text: r.loi, taiLai: k === "vuaDoi" });
      }
    });
  }

  const ghiChuTrangThai = !laSua && loaiChon ? (trangThaiKhiTao(loaiChon.canDuyet) === "ACTIVE" ? "Loại này không cần duyệt: đối tác hoạt động ngay sau khi tạo." : "Loại này cần duyệt: đối tác ở trạng thái «Chờ duyệt» cho tới khi được duyệt.") : null;
  const loiO = (k: Truong) => (loi[k] ? { "aria-invalid": true as const, "aria-describedby": id(`${k}-loi`) } : {});
  const hienLoi = (k: Truong) =>
    loi[k] ? (
      <p id={id(`${k}-loi`)} role="alert" className={LOI_O}>
        {loi[k]}
      </p>
    ) : null;

  return (
    <Sheet open={open} onOpenChange={doiMo}>
      <SheetTrigger aria-label={triggerAriaLabel} className={triggerClassName}>
        {children}
      </SheetTrigger>
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">{laSua ? "Sửa đối tác" : "Tạo đối tác"}</SheetTitle>
          <SheetDescription className="truncate">{laSua ? dong.ten : "Người hoặc tổ chức giới thiệu khách cho Sata Robo."}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {banner && (
              <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <span className="flex min-w-0 items-start gap-2">
                  <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{banner.text}</span>
                </span>
                {banner.taiLai && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.refresh();
                    }}
                    className={cn(BTN_OUTLINE, NUT_NHO, "shrink-0")}
                  >
                    Tải lại
                  </button>
                )}
              </div>
            )}

            {khongCoLoai && (
              <div role="status" className="rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                Chưa có loại đối tác nào đang hoạt động. Tạo loại ở mục{" "}
                <Link href="/nguon-hoa-hong/affiliate?xem=loai" className="font-semibold underline">
                  Loại đối tác
                </Link>{" "}
                trước, rồi quay lại tạo đối tác.
              </div>
            )}

            <form
              ref={formRef}
              aria-label={laSua ? "Sửa đối tác" : "Tạo đối tác"}
              noValidate
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                luu();
              }}
              onKeyDown={(e) => {
                // Ctrl/⌘ + Enter lưu từ bất kỳ ô nào (kể cả ô nhiều dòng, nơi Enter trần là xuống dòng).
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  luu();
                }
              }}
            >
              <fieldset className="min-w-0">
                <legend className={NHAN_O}>Kiểu đối tác</legend>
                <div className="flex gap-4">
                  {KIEU_DOI_TAC.map((k) => (
                    <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                      <input
                        type="radio"
                        name={id("kieu")}
                        value={k}
                        checked={f.kieu === k}
                        disabled={dangLuu}
                        onChange={() =>
                          // Đổi sang tổ chức ⇒ XOÁ nhân viên và tổ chức cha khỏi trạng thái: ô đã ẩn thì giá trị cũ không được đi theo ngầm.
                          datF(k === "ORGANIZATION" ? { kieu: k, nhanVien: null, toChucId: "" } : { kieu: k }, ["partyKind", "employeeId", "parentPartyId"])
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {NHAN_KIEU_DOI_TAC[k]}
                    </label>
                  ))}
                </div>
                {hienLoi("partyKind")}
              </fieldset>

              <div>
                <label htmlFor={id("ten")} className={NHAN_O}>
                  {f.kieu === "ORGANIZATION" ? "Tên tổ chức" : "Họ tên"} <span aria-hidden>*</span>
                </label>
                <input
                  id={id("ten")}
                  value={f.ten}
                  maxLength={120}
                  disabled={dangLuu}
                  onChange={(e) => {
                    const ten = e.target.value;
                    // Tự gợi ý mã cho tới khi người dùng tự gõ; đối tác ĐÃ CÓ mã (sửa) thì không bao giờ tự đổi mã.
                    datF({ ten, ...(f.maTuGo ? {} : { ma: goiYMaTuTen(ten) }) }, ["name", ...(f.maTuGo ? [] : (["code"] as Truong[]))]);
                  }}
                  placeholder={f.kieu === "ORGANIZATION" ? "VD: Trường Tiểu học Lê Quý Đôn" : "VD: Chị An (PH lớp Sata 3)"}
                  className={O_NHAP}
                  {...loiO("name")}
                />
                {hienLoi("name")}
              </div>

              <div>
                <label htmlFor={id("loai")} className={NHAN_O}>
                  Loại đối tác <span aria-hidden>*</span>
                </label>
                <select
                  id={id("loai")}
                  value={f.loaiId}
                  disabled={dangLuu || khongCoLoai}
                  onChange={(e) => datF({ loaiId: e.target.value }, ["typeId"])}
                  className={O_NHAP}
                  {...loiO("typeId")}
                >
                  <option value="">— Chọn loại —</option>
                  {loaiChoChon.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.ten}
                      {l.dangDung ? "" : " (đã ngừng)"}
                    </option>
                  ))}
                </select>
                {ghiChuTrangThai && <p className="mt-1 text-sm text-muted-foreground">{ghiChuTrangThai}</p>}
                {hienLoi("typeId")}
              </div>

              <fieldset className="min-w-0" aria-describedby={loi.tagIds ? id("tagIds-loi") : undefined}>
                <legend className={NHAN_O}>Nhãn</legend>
                {nhanHienThi.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Chưa có nhãn nào. Nhãn là tuỳ chọn; tạo ở mục Nhãn khi cần.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {nhanHienThi.map((n) => {
                      const dangChon = f.nhanIds.includes(n.id);
                      return (
                        <label key={n.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={dangChon}
                            disabled={dangLuu || (!n.dangDung && !dangChon)}
                            onChange={() => datF({ nhanIds: dangChon ? f.nhanIds.filter((x) => x !== n.id) : [...f.nhanIds, n.id] }, ["tagIds"])}
                            className="h-4 w-4 accent-primary"
                          />
                          {n.ten}
                          {n.dangDung ? "" : " (đã ngừng)"}
                        </label>
                      );
                    })}
                  </div>
                )}
                {hienLoi("tagIds")}
              </fieldset>

              <div>
                <label htmlFor={id("ma")} className={NHAN_O}>
                  Mã giới thiệu <span aria-hidden>*</span>
                </label>
                <input
                  id={id("ma")}
                  value={f.ma}
                  maxLength={64}
                  disabled={dangLuu || maKhoa}
                  onChange={(e) => datF({ ma: e.target.value.toUpperCase(), maTuGo: true }, ["code", "lyDo"])}
                  placeholder="VD: ANNGUYEN"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={cn(O_NHAP, "font-mono")}
                  {...loiO("code")}
                />
                {maKhoa ? (
                  <p className="mt-1 text-sm text-muted-foreground">Mã này đã có lead nên không đổi được — đổi mã sẽ làm chết các link và mã đã in. Cần mã khác thì tạo đối tác mới.</p>
                ) : f.ma.trim() === "" ? (
                  <p className="mt-1 text-sm text-muted-foreground">Chữ và số, 3–32 ký tự, không dấu. Gõ tên ở trên, hệ thống sẽ gợi ý.</p>
                ) : kqMa.ok ? (
                  <div className="mt-1 text-sm text-muted-foreground">
                    <p className="break-all">
                      Mã sẽ lưu: <b className="font-mono text-foreground">{kqMa.ma}</b>
                    </p>
                    <p data-huong-dan-link className="mt-0.5">
                      {HUONG_DAN_MA_TAO_LINK}
                      {coTheTaoLink && (
                        <>
                          {" "}
                          <Link href={laSua ? `/nguon-hoa-hong/link?doitac=${encodeURIComponent(dong.ma)}` : "/nguon-hoa-hong/link"} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                            Mở tab Link / QR / Mã
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-state-danger-ink">{kqMa.loi}</p>
                )}
                {hienLoi("code")}
              </div>

              {canLyDoMa && (
                <div>
                  <label htmlFor={id("lyDo")} className={NHAN_O}>
                    Lý do đổi mã (tối thiểu {LY_DO_TOI_THIEU_DOI_TAC} ký tự)
                  </label>
                  <textarea
                    id={id("lyDo")}
                    rows={2}
                    maxLength={500}
                    value={f.lyDo}
                    disabled={dangLuu}
                    onChange={(e) => datF({ lyDo: e.target.value }, ["lyDo"])}
                    className={TEXTAREA}
                    {...loiO("lyDo")}
                  />
                  {hienLoi("lyDo")}
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("sdt")} className={NHAN_O}>
                    Điện thoại
                  </label>
                  <input id={id("sdt")} type="tel" value={f.dienThoai} maxLength={20} disabled={dangLuu} onChange={(e) => datF({ dienThoai: e.target.value }, ["phone"])} className={O_NHAP} {...loiO("phone")} />
                  {hienLoi("phone")}
                </div>
                <div>
                  <label htmlFor={id("email")} className={NHAN_O}>
                    Email
                  </label>
                  <input id={id("email")} type="email" value={f.email} maxLength={120} disabled={dangLuu} onChange={(e) => datF({ email: e.target.value }, ["email"])} className={O_NHAP} {...loiO("email")} />
                  {hienLoi("email")}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor={id("co-so")} className={NHAN_O}>
                    Cơ sở theo dõi
                  </label>
                  <select id={id("co-so")} value={f.coSoId} disabled={dangLuu} onChange={(e) => datF({ coSoId: e.target.value }, ["centerId"])} className={O_NHAP} {...loiO("centerId")}>
                    <option value="">— Toàn hệ thống —</option>
                    {coCoSoNgoaiDs && dong?.coSoId && <option value={dong.coSoId}>Cơ sở hiện tại (ngoài phạm vi bạn xem)</option>}
                    {tuyChon.coSo.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nhan}
                      </option>
                    ))}
                  </select>
                  {hienLoi("centerId")}
                </div>
                <div>
                  <label htmlFor={id("ti-le")} className={NHAN_O}>
                    Tỉ lệ tham chiếu (%)
                  </label>
                  <input
                    id={id("ti-le")}
                    inputMode="decimal"
                    value={f.tiLe}
                    maxLength={6}
                    disabled={dangLuu}
                    onChange={(e) => datF({ tiLe: e.target.value.replace(",", ".") }, ["commissionPercent"])}
                    placeholder="Để trống nếu chưa chốt"
                    className={O_NHAP}
                    aria-describedby={id("ti-le-ghi-chu")}
                    {...loiO("commissionPercent")}
                  />
                  <p id={id("ti-le-ghi-chu")} className="mt-1 text-sm text-muted-foreground">
                    Không dùng để tính tiền — chỉ để đối soát tay. Hoa hồng thật do chính sách quyết định.
                  </p>
                  {hienLoi("commissionPercent")}
                </div>
              </div>

              {f.kieu === "PERSON" && (
                <>
                  <div>
                    <label htmlFor={id("to-chuc")} className={NHAN_O}>
                      Thuộc tổ chức
                    </label>
                    <select id={id("to-chuc")} value={f.toChucId} disabled={dangLuu} onChange={(e) => datF({ toChucId: e.target.value }, ["parentPartyId"])} className={O_NHAP} {...loiO("parentPartyId")}>
                      <option value="">— Không thuộc tổ chức nào —</option>
                      {coToChucNgoaiDs && dong?.toChuc && <option value={dong.toChuc.id}>{dong.toChuc.ten} (đã kết thúc)</option>}
                      {toChucChon.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.ten}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-sm text-muted-foreground">Tiền của cá nhân không tự chảy về tổ chức; đây chỉ là quan hệ để theo dõi.</p>
                    {hienLoi("parentPartyId")}
                  </div>

                  <ReferrerPicker
                    idPrefix={`dt-${uid}`}
                    loai="NHAN_SU"
                    nhan="Nhân viên liên kết"
                    anVai
                    value={f.nhanVien}
                    onChange={(n) => datF({ nhanVien: n?.loai === "NHAN_SU" ? n : null }, ["employeeId"])}
                    tim={tim}
                    disabled={dangLuu}
                    invalid={loi.employeeId}
                  />
                </>
              )}

              <div>
                <label htmlFor={id("ghi-chu")} className={NHAN_O}>
                  Ghi chú
                </label>
                <textarea id={id("ghi-chu")} rows={3} maxLength={1000} value={f.ghiChu} disabled={dangLuu} onChange={(e) => datF({ ghiChu: e.target.value }, ["note"])} className={TEXTAREA} {...loiO("note")} />
                {hienLoi("note")}
              </div>
              {/* Nút submit ẩn để Enter ở ô một dòng không cần chuột; nút thật nằm ở chân Sheet. */}
              <button type="submit" hidden tabIndex={-1} aria-hidden />
            </form>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-card p-4">
            <button type="button" onClick={() => setOpen(false)} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
              Huỷ
            </button>
            <button type="button" onClick={luu} disabled={dangLuu || khongCoLoai} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangLuu ? "Đang lưu…" : laSua ? "Lưu thay đổi" : "Tạo đối tác"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
