"use client";

// components/admin/nguon-hoa-hong/nguon-form.tsx — BIỂU MẪU Tạo / Sửa nguồn (SPEC nguồn động §4). Trang đầy đủ, không Sheet: 14 ô + cảnh báo + lý do là việc cần chỗ rộng và không cần
// giữ ngữ cảnh của một danh sách ở sau lưng (06 §5.1: chi tiết nguồn là trang vì có cấu hình; craft-floor: modal chỉ cho việc cần ngắt).
//
// ── Một luật, hai nơi chạy ─────────────────────────────────────────────────────────────────────────────────────
// KHÔNG có luật nào được viết ở đây. Kiểm tra là `kiemFormTao` / `phanTichSua` (lib/nguon/form-nguon.ts) — chúng chạy CHÍNH `taoNguonSchema` · `suaNguonSchema` · `kiemSuaNguon` · `lamHongDichMacDinh`
// · `canQuyenKichHoat` của cổng ghi. Ô bị khoá lấy lý do từ `truongBiKhoa` (cùng hàm với cổng ghi). Ca `[FUI-DB-04]` ép màn hình và máy chủ cùng nói «được / không được» trên 16 lượt sửa thật.
//
// ── Nói thật (luật 12) ─────────────────────────────────────────────────────────────────────────────────────────
//  · Ô khoá `disabled` KÈM lý do ngay dưới ô (không chỉ tooltip);
//  · nút Lưu khoá khi chưa đổi gì hoặc khi người sửa THIẾU `commission_policies:activate` cho một lượt sửa đụng tiền — và NÓI câu đó (có tên khoá) thay vì để máy chủ từ chối sau;
//  · lỗi máy chủ đặt CẠNH ô nó nói tới; lỗi cũ tự xoá khi sửa ô (RHF revalidate), không đứng đó nói dối;
//  · khoá lạc quan: máy chủ báo «vừa được người khác đổi» ⇒ banner + nút «Tải lại» (nói thẳng là bỏ các chỗ đang sửa).
//
// Hàm lưu được TIÊM (`luuTao`, `luuSua`, `tim`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { ChevronLeft, Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { suaNguonAction, taoNguonAction } from "@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { Switch } from "@/components/ui/switch";
import { LY_DO_TOI_THIEU_NGUON, chuanHoaCode, truongBiKhoa, type TruongSua } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import type { DonViChon } from "@/lib/nguon/doc-form-nguon";
import { DO_DAI_GIAI_TRINH_TOI_THIEU } from "@/lib/nguon/kiem-nguon";
import {
  bienFormSua,
  bienFormTao,
  chanKhiTao,
  formTrong,
  formTuNguon,
  kiemFormTao,
  phanTichSua,
  type BoiCanhSua,
  type BoiCanhTao,
  type GiaTriForm,
  type LoiForm,
  type NguonFormView,
  type TruongForm,
} from "@/lib/nguon/form-nguon";
import type { KetQuaSuaNguonAction, KetQuaTaoNguonAction } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_NHO, TEXTAREA } from "./classes";
import { LOAI_NGUON_O_CHON, MO_TA_LOAI_NGUON, NHAN_LOAI_NGUON, NHAN_YEU_CAU_NGUOI, THU_TU_YEU_CAU_NGUOI } from "./nhan-danh-muc";
import { ReferrerPicker, type HamTim } from "./referrer-picker";
import { StickyActionBar } from "./sticky-action-bar";

type LuuTao = (vao: unknown) => Promise<KetQuaTaoNguonAction>;
type LuuSua = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaNguonAction>;
const LUU_TAO_MAC_DINH: LuuTao = (vao) => taoNguonAction({ vao });
const LUU_SUA_MAC_DINH: LuuSua = (i) => suaNguonAction(i);

const VE_DANH_SACH = "/nguon-hoa-hong/nguon?xem=tat-ca";

export type NguonFormProps = {
  cheDo: "tao" | "sua";
  /** Chỉ chế độ sửa. */
  nguon?: NguonFormView;
  donVi: DonViChon[];
  thuTuGoiY: number;
  cuaSoMacDinhNgay: number;
  /** Chỉ chế độ sửa. */
  boiCanh?: BoiCanhSua;
  /** Chỉ chế độ tạo: rule chủ-nguồn có chạy không + quyền kích hoạt — để «Kích hoạt ngay» nói thật (`chanKhiTao`). */
  boiCanhTao?: BoiCanhTao;
  luuTao?: LuuTao;
  luuSua?: LuuSua;
  tim?: HamTim;
};

type ChuHienThi = { ten: string; ma: string | null; coTaiKhoan: boolean | null };
type Banner = { loai: "vuaDoi" | "quyen" | "khac"; text: string };

/** Resolver của RHF = hàm kiểm THUẦN của lib. Không luật nào ở đây. */
function lamResolver(chay: (v: GiaTriForm) => LoiForm): Resolver<GiaTriForm> {
  return async (values) => {
    const loi = chay(values);
    const khoa = Object.keys(loi) as TruongForm[];
    if (khoa.length === 0) return { values, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const k of khoa) errors[k] = { type: "validate", message: loi[k] };
    return { values: {}, errors: errors as FieldErrors<GiaTriForm> };
  };
}

const TRUONG_FORM: readonly TruongForm[] = [
  "code",
  "name",
  "description",
  "sourceType",
  "referrerRequirement",
  "requiresNote",
  "selectable",
  "sortOrder",
  "attributionWindowDays",
  "commissionEnabled",
  "ownerEmployeeId",
  "ownerOrgUnitId",
  "effectiveFrom",
  "effectiveTo",
  "trangThai",
  "lyDo",
];

export function NguonForm({ cheDo, nguon, donVi, thuTuGoiY, cuaSoMacDinhNgay, boiCanh, boiCanhTao, luuTao = LUU_TAO_MAC_DINH, luuSua = LUU_SUA_MAC_DINH, tim }: NguonFormProps) {
  const router = useRouter();
  const uid = useId();
  const sua = cheDo === "sua";
  if (sua && (!nguon || !boiCanh)) throw new Error("NguonForm chế độ sửa cần `nguon` và `boiCanh`.");
  if (!sua && !boiCanhTao) throw new Error("NguonForm chế độ tạo cần `boiCanhTao`.");

  const goc = useMemo(() => (sua ? formTuNguon(nguon!) : formTrong({ thuTuGoiY })), [sua, nguon, thuTuGoiY]);
  const khoaMap = useMemo(
    () => new Map<TruongSua, string>(sua ? truongBiKhoa({ code: nguon!.code, isSystem: nguon!.isSystem, daDung: nguon!.daDung.daDung }).map((k) => [k.truong, k.lyDo]) : []),
    [sua, nguon],
  );
  const resolver = useMemo(
    // Tạo: lỗi đầu vào (kiemFormTao) thắng; hai cổng «Kích hoạt ngay» (chanKhiTao) chỉ thêm lỗi cho ô chưa có lỗi.
    () => lamResolver((v) => (sua ? phanTichSua({ form: v, goc, nguon: nguon!, boiCanh: boiCanh! }).loi : { ...chanKhiTao(v, boiCanhTao!).loi, ...kiemFormTao(v) })),
    [sua, goc, nguon, boiCanh, boiCanhTao],
  );
  const form = useForm<GiaTriForm>({ defaultValues: goc, resolver, mode: "onTouched", reValidateMode: "onChange" });
  const { register, control, setValue, setError, formState } = form;
  const gia = form.watch();
  const pt = sua ? phanTichSua({ form: gia, goc, nguon: nguon!, boiCanh: boiCanh! }) : null;

  const [chu, setChu] = useState<ChuHienThi | null>(nguon?.ownerEmployee ? { ten: nguon.ownerEmployee.ten, ma: nguon.ownerEmployee.maNv, coTaiKhoan: nguon.ownerEmployee.coTaiKhoan } : null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  const id = (ten: string) => `${uid}-${ten}`;
  const idKh = (ten: string) => `${id(ten)}-khoa`;
  const loi = (k: TruongForm): string | undefined => {
    const e = formState.errors[k];
    return typeof e?.message === "string" ? e.message : undefined;
  };
  const khoa = (k: TruongSua): string | null => khoaMap.get(k) ?? null;
  const mo = (k: TruongForm, extra: string[] = []): { "aria-invalid"?: true; "aria-describedby"?: string } => {
    const ids = [...extra, ...(loi(k) ? [id(`loi-${k}`)] : [])];
    return { ...(loi(k) ? { "aria-invalid": true as const } : {}), ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}) };
  };

  function datLoiMayChu(error: string, field?: string) {
    if (field && (TRUONG_FORM as readonly string[]).includes(field) && !(sua && field === "trangThai")) {
      setError(field as TruongForm, { type: "server", message: error }, { shouldFocus: true });
      return;
    }
    if (field === "vuaDoi") setBanner({ loai: "vuaDoi", text: error });
    else if (field === "quyen") setBanner({ loai: "quyen", text: error });
    else setBanner({ loai: "khac", text: error });
  }

  const nop = form.handleSubmit(async (v) => {
    if (dangLuu) return;
    setBanner(null);
    setDangLuu(true);
    try {
      if (!sua) {
        let r: KetQuaTaoNguonAction;
        try {
          r = await luuTao(bienFormTao(v));
        } catch {
          r = { ok: false, error: "Không lưu được lúc này. Thử lại sau ít giây." };
        }
        if (!r.ok) return datLoiMayChu(r.error, r.field);
        toast.success(`Đã tạo nguồn «${v.name.trim()}».`);
        for (const c of r.canhBao) toast.warning(CANH_BAO_MAY_CHU[c] ?? c);
        router.push(VE_DANH_SACH);
        router.refresh();
        return;
      }
      const { vao, lyDo } = bienFormSua(v, goc);
      let r: KetQuaSuaNguonAction;
      try {
        r = await luuSua({ id: nguon!.id, updatedAtDaThay: nguon!.capNhatLuc, vao, lyDo });
      } catch {
        r = { ok: false, error: "Không lưu được lúc này. Thử lại sau ít giây." };
      }
      if (!r.ok) return datLoiMayChu(r.error, r.field);
      if (!r.doi) {
        toast.info("Không có gì thay đổi.");
        return;
      }
      toast.success(`Đã lưu nguồn «${v.name.trim()}».`);
      for (const c of r.canhBao) toast.warning(CANH_BAO_MAY_CHU[c] ?? c);
      router.push(`/nguon-hoa-hong/nguon/${encodeURIComponent(chuanHoaCode(v.code))}`);
      router.refresh();
    } finally {
      setDangLuu(false);
    }
  });

  const khongDoi = sua && pt !== null && pt.truongDoi.length === 0;
  const chanLuu = sua ? (pt?.chanLuu ?? null) : chanKhiTao(gia, boiCanhTao!).chanLuu;
  const khoaNut = dangLuu || khongDoi || chanLuu !== null;
  const trai = chanLuu ? (
    <span role="status" className="flex items-start gap-2 text-state-warning-ink">
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{chanLuu}</span>
    </span>
  ) : khongDoi ? (
    <span>Chưa có thay đổi nào để lưu.</span>
  ) : null;

  return (
    <form onSubmit={nop} noValidate aria-label={sua ? `Sửa nguồn ${nguon!.name}` : "Tạo nguồn mới"} className="max-w-3xl">
      <Link href={sua ? `/nguon-hoa-hong/nguon/${encodeURIComponent(nguon!.code)}` : VE_DANH_SACH} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        {sua ? "Chi tiết nguồn" : "Tất cả nguồn"}
      </Link>

      {banner && (
        <div role="alert" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {banner.text}
            {banner.loai === "vuaDoi" && " Các chỗ bạn đang sửa sẽ mất khi tải lại."}
          </p>
          {banner.loai === "vuaDoi" && (
            <button type="button" onClick={() => router.refresh()} className={cn(BTN_OUTLINE, NUT_NHO)}>
              Tải lại dữ liệu mới
            </button>
          )}
        </div>
      )}

      <div className="divide-y divide-border rounded-xl border border-border bg-card px-5">
        {/* ── Thông tin chung ─────────────────────────────────────────────────────────────────────────── */}
        <Muc tieuDe="Thông tin chung">
          <Truong id={id("name")} nhan="Tên nguồn" loi={loi("name")} idLoi={id("loi-name")}>
            <input id={id("name")} type="text" autoComplete="off" maxLength={120} className={FIELD} {...mo("name")} {...register("name")} />
          </Truong>

          <Truong
            id={id("code")}
            nhan="Mã nguồn"
            loi={loi("code")}
            idLoi={id("loi-code")}
            khoa={khoa("code")}
            ghiChu={sua ? undefined : "Chữ HOA, số và gạch dưới, 3–40 ký tự. Không đổi được sau khi nguồn có lead, chính sách hoặc dòng sổ."}
          >
            <input
              id={id("code")}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              disabled={khoa("code") !== null}
              className={cn(FIELD, "font-mono uppercase")}
              {...mo("code", khoa("code") ? [idKh("code")] : [])}
              {...register("code")}
            />
          </Truong>

          <Truong id={id("sourceType")} nhan="Nhóm nguồn" loi={loi("sourceType")} idLoi={id("loi-sourceType")} khoa={khoa("sourceType")} ghiChu={gia.sourceType in MO_TA_LOAI_NGUON ? `${MO_TA_LOAI_NGUON[gia.sourceType as keyof typeof MO_TA_LOAI_NGUON]} Nhóm chỉ để lọc và báo cáo, không quyết định hoa hồng.` : "Để lọc và báo cáo. Nhóm không quyết định hoa hồng."}>
            <select id={id("sourceType")} disabled={khoa("sourceType") !== null} className={FIELD} {...mo("sourceType", khoa("sourceType") ? [idKh("sourceType")] : [])} {...register("sourceType")}>
              {gia.sourceType === "" && <option value="">— Chọn nhóm nguồn —</option>}
              {LOAI_NGUON_O_CHON.map((o) => (
                <option key={o.gia} value={o.gia}>
                  {o.nhan}
                </option>
              ))}
              {gia.sourceType === "SYSTEM" && <option value="SYSTEM">{NHAN_LOAI_NGUON.SYSTEM}</option>}
            </select>
          </Truong>

          <Truong id={id("description")} nhan="Mô tả" loi={loi("description")} idLoi={id("loi-description")} ghiChu="Tuỳ chọn. Người nhập thấy dòng này khi chọn nguồn.">
            <textarea id={id("description")} rows={2} maxLength={1000} className={TEXTAREA} {...mo("description")} {...register("description")} />
          </Truong>
        </Muc>

        {/* ── Cách xác định nguồn ─────────────────────────────────────────────────────────────────────── */}
        <Muc tieuDe="Cách xác định nguồn">
          <fieldset aria-describedby={khoa("referrerRequirement") ? idKh("referrerRequirement") : undefined} className="min-w-0">
            <legend className={NHAN_O}>Người nhập phải chọn gì?</legend>
            <div className="space-y-1">
              {THU_TU_YEU_CAU_NGUOI.map((y) => (
                <label key={y} className={cn("flex min-h-11 items-start gap-3 rounded-lg px-2 py-2", khoa("referrerRequirement") ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-muted")}>
                  <input type="radio" value={y} disabled={khoa("referrerRequirement") !== null} className="mt-1 h-4 w-4 accent-primary" {...register("referrerRequirement")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{NHAN_YEU_CAU_NGUOI[y].nhan}</span>
                    <span className="block text-sm text-muted-foreground">{NHAN_YEU_CAU_NGUOI[y].moTa}</span>
                  </span>
                </label>
              ))}
            </div>
            <Khoa id={idKh("referrerRequirement")} lyDo={khoa("referrerRequirement")} />
            {loi("referrerRequirement") && (
              <p id={id("loi-referrerRequirement")} role="alert" className={LOI_O}>
                {loi("referrerRequirement")}
              </p>
            )}
          </fieldset>

          <CongTac
            id={id("requiresNote")}
            nhan="Bắt buộc giải trình"
            moTa={`Người nhập phải ghi lý do/giải trình (tối thiểu ${DO_DAI_GIAI_TRINH_TOI_THIEU} ký tự) khi chọn nguồn này — dùng cho nguồn «Khác».`}
            khoa={khoa("requiresNote")}
            idKhoa={idKh("requiresNote")}
          >
            <Controller control={control} name="requiresNote" render={({ field }) => <Cong id={id("requiresNote")} nhan="Bắt buộc giải trình" bat={field.value} doi={field.onChange} tat={khoa("requiresNote") !== null} idMoTa={khoa("requiresNote") ? idKh("requiresNote") : undefined} />} />
          </CongTac>

          <CongTac
            id={id("selectable")}
            nhan="Chọn được ở ô nhập"
            moTa="Tắt = chỉ hệ thống gán, người nhập không thấy nguồn này."
            khoa={khoa("selectable")}
            idKhoa={idKh("selectable")}
            loi={loi("selectable")}
            idLoi={id("loi-selectable")}
          >
            <Controller control={control} name="selectable" render={({ field }) => <Cong id={id("selectable")} nhan="Chọn được ở ô nhập" bat={field.value} doi={field.onChange} tat={khoa("selectable") !== null} idMoTa={loi("selectable") ? id("loi-selectable") : undefined} />} />
          </CongTac>
        </Muc>

        {/* ── Ai phụ trách ─────────────────────────────────────────────────────────────────────────────── */}
        <Muc tieuDe="Ai phụ trách">
          <div>
            {khoa("ownerEmployeeId") !== null ? (
              // Khoá (UNKNOWN): chỉ ĐỌC — không «Bỏ / Đổi», không ô tìm kiếm — kèm lý do ngay dưới (luật 12: không vẽ ô sửa được rồi bấm Lưu mới bị từ chối).
              <div>
                <p className={NHAN_O}>Người phụ trách</p>
                <p className="text-sm text-foreground">{chu ? [chu.ten, chu.ma].filter(Boolean).join(" · ") : "Chưa có"}</p>
                <Khoa id={idKh("ownerEmployeeId")} lyDo={khoa("ownerEmployeeId")} />
              </div>
            ) : chu ? (
              <div>
                <p className={NHAN_O}>Người phụ trách</p>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={chu.ten}>
                      {chu.ten}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[chu.ma, chu.coTaiKhoan === false ? "Chưa có tài khoản — phần hoa hồng của người này sẽ treo ở hàng chờ" : null].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setChu(null);
                      setValue("ownerEmployeeId", "", { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                    }}
                    className={cn(BTN_OUTLINE, NUT_NHO)}
                    aria-label={`Bỏ người phụ trách ${chu.ten}`}
                  >
                    Bỏ / Đổi
                  </button>
                </div>
              </div>
            ) : (
              <ReferrerPicker
                loai="NHAN_SU"
                nhan="Người phụ trách"
                anVai
                idPrefix={id("owner")}
                value={null}
                tim={tim}
                invalid={loi("ownerEmployeeId")}
                onChange={(n) => {
                  if (n?.loai !== "NHAN_SU") return;
                  setChu({ ten: n.ten, ma: n.ma, coTaiKhoan: null });
                  setValue("ownerEmployeeId", n.employeeId, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                }}
              />
            )}
            {chu && loi("ownerEmployeeId") && (
              <p id={id("loi-ownerEmployeeId")} role="alert" className={LOI_O}>
                {loi("ownerEmployeeId")}
              </p>
            )}
            {khoa("ownerEmployeeId") === null && <p className="mt-1 text-sm text-muted-foreground">Nhận phần hoa hồng của vai «Người phụ trách nguồn» khi có chính sách trả cho vai này. Để trống nếu chưa có.</p>}
          </div>

          <Truong id={id("ownerOrgUnitId")} nhan="Phạm vi đơn vị" loi={loi("ownerOrgUnitId")} idLoi={id("loi-ownerOrgUnitId")} khoa={khoa("ownerOrgUnitId")} ghiChu="Đơn vị sở hữu nguồn, để báo cáo. Không giới hạn ai thấy lead.">
            <select id={id("ownerOrgUnitId")} disabled={khoa("ownerOrgUnitId") !== null} className={FIELD} {...mo("ownerOrgUnitId", khoa("ownerOrgUnitId") ? [idKh("ownerOrgUnitId")] : [])} {...register("ownerOrgUnitId")}>
              <option value="">— Không gắn đơn vị —</option>
              {donVi.map((d) => (
                <option key={d.id} value={d.id}>
                  {"\u00A0\u00A0".repeat(d.doSau)}
                  {d.ten} ({d.ma})
                </option>
              ))}
            </select>
          </Truong>
        </Muc>

        {/* ── Ghi công & hoa hồng ──────────────────────────────────────────────────────────────────────── */}
        <Muc tieuDe="Ghi công và hoa hồng">
          <Truong
            id={id("attributionWindowDays")}
            nhan="Cửa sổ ghi công (ngày)"
            loi={loi("attributionWindowDays")}
            idLoi={id("loi-attributionWindowDays")}
            khoa={khoa("attributionWindowDays")}
            ghiChu={`Để trống = dùng mặc định của hệ thống (${cuaSoMacDinhNgay} ngày kể từ lúc lead vào). Chỉ áp cho khoản thu SAU khi lưu.`}
          >
            <input
              id={id("attributionWindowDays")}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder={`Mặc định ${cuaSoMacDinhNgay}`}
              disabled={khoa("attributionWindowDays") !== null}
              className={cn(FIELD, "w-40 tabular-nums")}
              {...mo("attributionWindowDays", khoa("attributionWindowDays") ? [idKh("attributionWindowDays")] : [])}
              {...register("attributionWindowDays")}
            />
          </Truong>

          <CongTac
            id={id("commissionEnabled")}
            nhan="Có tham gia hoa hồng theo nguồn"
            moTa="Bật thì mới dùng được các dòng thu hút (có tỉ lệ) của chính sách riêng của nguồn này; dòng «loại trừ» và chính sách chung (Sale, Quản lý cơ sở, GV Trial…) vẫn chạy dù tắt."
            khoa={khoa("commissionEnabled")}
            idKhoa={idKh("commissionEnabled")}
            loi={loi("commissionEnabled")}
            idLoi={id("loi-commissionEnabled")}
          >
            <Controller control={control} name="commissionEnabled" render={({ field }) => <Cong id={id("commissionEnabled")} nhan="Có tham gia hoa hồng theo nguồn" bat={field.value} doi={field.onChange} tat={khoa("commissionEnabled") !== null} idMoTa={loi("commissionEnabled") ? id("loi-commissionEnabled") : undefined} />} />
          </CongTac>

          <div className="grid gap-4 sm:grid-cols-2">
            <Truong id={id("effectiveFrom")} nhan="Hiệu lực từ ngày" loi={loi("effectiveFrom")} idLoi={id("loi-effectiveFrom")} khoa={khoa("effectiveFrom")} ghiChu="Để trống = có hiệu lực ngay.">
              <input id={id("effectiveFrom")} type="date" disabled={khoa("effectiveFrom") !== null} className={FIELD} {...mo("effectiveFrom", khoa("effectiveFrom") ? [idKh("effectiveFrom")] : [])} {...register("effectiveFrom")} />
            </Truong>
            <Truong id={id("effectiveTo")} nhan="Hết hiệu lực từ ngày" loi={loi("effectiveTo")} idLoi={id("loi-effectiveTo")} khoa={khoa("effectiveTo")} ghiChu="Từ 00:00 ngày này lead MỚI không chọn được nguồn nữa. Để trống = không hết hạn.">
              <input id={id("effectiveTo")} type="date" disabled={khoa("effectiveTo") !== null} className={FIELD} {...mo("effectiveTo", khoa("effectiveTo") ? [idKh("effectiveTo")] : [])} {...register("effectiveTo")} />
            </Truong>
          </div>

          <Truong id={id("sortOrder")} nhan="Thứ tự hiển thị" loi={loi("sortOrder")} idLoi={id("loi-sortOrder")} ghiChu="Số nhỏ đứng trước ở ô chọn nguồn.">
            <input id={id("sortOrder")} type="text" inputMode="numeric" autoComplete="off" className={cn(FIELD, "w-32 tabular-nums")} {...mo("sortOrder")} {...register("sortOrder")} />
          </Truong>
        </Muc>

        {/* ── Trạng thái khi tạo / Lý do khi sửa ───────────────────────────────────────────────────────── */}
        {!sua ? (
          <Muc tieuDe="Trạng thái khi tạo">
            <fieldset className="min-w-0">
              <legend className="sr-only">Trạng thái khi tạo</legend>
              <div className="space-y-1">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                  <input type="radio" value="DRAFT" className="mt-1 h-4 w-4 accent-primary" {...register("trangThai")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Lưu nháp</span>
                    <span className="block text-sm text-muted-foreground">Chưa chọn được ở ô nhập. Kích hoạt sau ở danh sách nguồn.</span>
                  </span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                  <input type="radio" value="ACTIVE" className="mt-1 h-4 w-4 accent-primary" {...register("trangThai")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">Kích hoạt ngay</span>
                    <span className="block text-sm text-muted-foreground">Lead mới chọn được nguồn này ngay khi tạo xong.</span>
                  </span>
                </label>
              </div>
              {loi("trangThai") && (
                <p role="alert" className={LOI_O}>
                  {loi("trangThai")}
                </p>
              )}
            </fieldset>
          </Muc>
        ) : (
          (pt?.canLyDo || gia.lyDo !== "") && (
            <Muc tieuDe="Lý do thay đổi">
              <Truong id={id("lyDo")} nhan={`Lý do (tối thiểu ${LY_DO_TOI_THIEU_NGUON} ký tự)`} loi={loi("lyDo")} idLoi={id("loi-lyDo")} ghiChu="Ghi vào nhật ký của nguồn. Bắt buộc khi đổi mã, nhóm, cách xác định, cửa sổ, hoa hồng, người phụ trách, hiệu lực hoặc chọn được.">
                <textarea id={id("lyDo")} rows={2} maxLength={500} className={TEXTAREA} {...mo("lyDo")} {...register("lyDo")} />
              </Truong>
            </Muc>
          )
        )}
      </div>

      {pt && pt.canhBao.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Lưu ý trước khi lưu">
          {pt.canhBao.map((c, i) => (
            <li key={i} role="status" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{c.noiDung}</span>
            </li>
          ))}
        </ul>
      )}

      <StickyActionBar trai={trai}>
        <Link href={sua ? `/nguon-hoa-hong/nguon/${encodeURIComponent(nguon!.code)}` : VE_DANH_SACH} className={BTN_OUTLINE}>
          Huỷ
        </Link>
        <button type="submit" disabled={khoaNut} className={BTN_PRIMARY}>
          {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {sua ? "Lưu thay đổi" : "Tạo nguồn"}
        </button>
      </StickyActionBar>
    </form>
  );
}

/** Tên khoá cảnh báo của máy chủ → câu người thường đọc. Khoá lạ thì in nguyên. */
const CANH_BAO_MAY_CHU: Readonly<Record<string, string>> = {
  NGUOI_PHU_TRACH_CHUA_CO_TAI_KHOAN: "Người phụ trách chưa có tài khoản đăng nhập — phần hoa hồng của họ sẽ treo ở hàng chờ cho tới khi có tài khoản.",
};

// ── Khung nhỏ ─────────────────────────────────────────────────────────────────────────────────────

function Muc({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 py-5 first:pt-5">
      <h2 className="text-base font-semibold text-foreground">{tieuDe}</h2>
      {children}
    </section>
  );
}

function Khoa({ id, lyDo }: { id: string; lyDo: string | null }) {
  if (!lyDo) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
      <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{lyDo}</span>
    </p>
  );
}

function Truong({
  id,
  nhan,
  loi,
  idLoi,
  ghiChu,
  khoa = null,
  children,
}: {
  id: string;
  nhan: string;
  loi: string | undefined;
  idLoi: string;
  ghiChu?: string;
  khoa?: string | null;
  children: React.ReactNode;
}) {
  const idKhoa = `${id}-khoa`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={NHAN_O}>
        {nhan}
      </label>
      {children}
      <Khoa id={idKhoa} lyDo={khoa} />
      {loi && (
        <p id={idLoi} role="alert" className={LOI_O}>
          {loi}
        </p>
      )}
      {/* Ô đã KHOÁ thì lý do khoá đã nói (Khoa ở trên); «Để trống = …» dưới một ô không bấm được là lời hướng dẫn cho việc không làm được. */}
      {ghiChu && !loi && khoa === null && <p className="mt-1 text-sm text-muted-foreground">{ghiChu}</p>}
    </div>
  );
}

/** Dòng «nhãn + mô tả ở trái, công tắc ở phải» — khoá thì nói lý do ngay dưới. */
function CongTac({
  id,
  nhan,
  moTa,
  khoa,
  idKhoa,
  loi,
  idLoi,
  children,
}: {
  id: string;
  nhan: string;
  moTa: string;
  khoa: string | null;
  idKhoa: string;
  loi?: string;
  idLoi?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* Hai <label htmlFor> cho CHÍNH công tắc: chạm CHỮ cũng bật được, và vùng bấm của cả dòng ≥ 44px (thanh trượt chỉ cao 20px). Công tắc khoá ⇒ con trỏ «không được», bấm vô hiệu. */}
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={id} className={cn("block min-h-11 min-w-0 flex-1 text-sm font-semibold text-foreground", khoa !== null ? "cursor-not-allowed" : "cursor-pointer")}>
          {nhan}
          <span className="block text-sm font-normal text-muted-foreground">{moTa}</span>
        </label>
        <label htmlFor={id} className={cn("flex h-11 w-11 shrink-0 items-center justify-end", khoa !== null ? "cursor-not-allowed" : "cursor-pointer")}>
          {children}
        </label>
      </div>
      <Khoa id={idKhoa} lyDo={khoa} />
      {loi && (
        <p id={idLoi} role="alert" className={LOI_O}>
          {loi}
        </p>
      )}
    </div>
  );
}

function Cong({ id, nhan, bat, doi, tat, idMoTa }: { id: string; nhan: string; bat: boolean; doi: (b: boolean) => void; tat: boolean; idMoTa?: string }) {
  return (
    <Switch
      id={id}
      aria-label={nhan}
      aria-describedby={idMoTa}
      checked={bat}
      onCheckedChange={doi}
      disabled={tat}
      className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-border"
    />
  );
}
