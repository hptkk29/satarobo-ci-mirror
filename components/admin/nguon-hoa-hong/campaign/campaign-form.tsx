"use client";

// components/admin/nguon-hoa-hong/campaign/campaign-form.tsx — BIỂU MẪU Tạo / Sửa campaign Affiliate (AFF-P0b). Trang đầy đủ, không Sheet (khuôn `nguon-form.tsx`).
//
// ── Một luật, hai nơi chạy ──────────────────────────────────────────────────────────────────────────────────────
// KHÔNG có luật nào được viết ở đây. Kiểm tra là `taoCampaignSchema` / `suaCampaignSchema` / `kiemSuaCampaign` (lib/affiliate/ghi-campaign-dau-vao.ts) — CHÍNH các hàm mà `taoCampaign` /
// `suaCampaign` chạy trước phép ghi. Ô bị khoá lấy lý do từ `lyDoKhoaTruong` (cùng tập `TRUONG_SUA_KHI_DANG_CHAY` với cổng ghi). Con số mặc định (30 / 90 ngày) là GIÁ TRỊ ĐIỀN SẴN
// của biểu mẫu — người tạo đổi được; không con số kinh doanh nào nằm ngoài khoảng CHECK của migration.
//
// ── Nói thật (luật 12) ──────────────────────────────────────────────────────────────────────────────────────────
//  · Ô khoá `disabled` KÈM lý do ngay dưới ô (không chỉ tooltip): campaign ĐANG CHẠY chỉ sửa được tên · mô tả · ngày hết hiệu lực;
//  · nút Lưu khoá khi chưa đổi gì; lý do ≥ 10 ký tự chỉ hiện khi cổng đòi (campaign đã từng chạy mà đổi tham số ghi nhận);
//  · lỗi máy chủ đặt CẠNH ô nó nói tới; lỗi cũ tự xoá khi sửa ô; khoá lạc quan: «vừa được người khác đổi» ⇒ banner + «Tải lại».
//
// Hàm lưu được TIÊM (`luuTao`, `luuSua`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { suaCampaignAction, taoCampaignAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import {
  BAO_VE_NGAY,
  COOKIE_NGAY,
  LY_DO_TOI_THIEU_CAMPAIGN,
  MO_HINH_GHI_NHAN,
  MO_TA_MO_HINH,
  NHAN_MO_HINH,
  NHAN_TRUONG_CAMPAIGN,
  kiemSuaCampaign,
  laTruongNhayCamCampaign,
  lyDoKhoaTruong,
  suaCampaignSchema,
  taoCampaignSchema,
  type GiaTriCampaign,
  type KetQuaSuaCampaign,
  type KetQuaTaoCampaign,
  type MoHinhGhiNhan,
  type NguonChonView,
  type TrangThaiCampaign,
  type TruongSuaCampaign,
} from "@/lib/affiliate/ghi-campaign-dau-vao";
import { chuanHoaMa } from "@/lib/affiliate/chung";
import { boolTuLuaChon, LUA_CHON_XEM_TIEN, luaChonTuBool, NHAN_LUA_CHON_XEM_TIEN, type LuaChonXemTien } from "@/lib/affiliate/quyen-xem-tien";
import { isoTuNgayVN, ngayVNTuISO } from "@/lib/nguon/form-nguon";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_NHO, TEXTAREA } from "../classes";

type LuuTao = (vao: Record<string, unknown>) => Promise<KetQuaTaoCampaign>;
type LuuSua = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaCampaign>;
const LUU_TAO_MAC_DINH: LuuTao = (vao) => taoCampaignAction({ vao });
const LUU_SUA_MAC_DINH: LuuSua = (i) => suaCampaignAction(i);

const VE_DANH_SACH = "/nguon-hoa-hong/campaign";

/** Campaign đang sửa — đúng những gì biểu mẫu cần. */
export type CampaignDeSua = {
  id: string;
  code: string;
  status: TrangThaiCampaign;
  /** ISO của `updatedAt` — mốc khoá lạc quan. */
  capNhatLuc: string;
  name: string;
  description: string | null;
  attributionModel: MoHinhGhiNhan;
  cookieWindowDays: number;
  protectWindowDays: number;
  allowSelfReferral: boolean;
  /** L3a — null = theo loại đối tác. */
  partnerCanViewAmount: boolean | null;
  defaultSourceGroupId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type Truong = "code" | "name" | "description" | "attributionModel" | "cookieWindowDays" | "protectWindowDays" | "allowSelfReferral" | "partnerCanViewAmount" | "defaultSourceGroupId" | "effectiveFrom" | "effectiveTo" | "lyDo";
type GiaTriForm = {
  code: string;
  name: string;
  description: string;
  attributionModel: MoHinhGhiNhan;
  cookieWindowDays: string;
  protectWindowDays: string;
  allowSelfReferral: boolean;
  /** Ô ba trạng thái (checkbox không diễn đạt được «theo cấp trên»). */
  partnerCanViewAmount: LuaChonXemTien;
  defaultSourceGroupId: string;
  effectiveFrom: string;
  effectiveTo: string;
  lyDo: string;
};
type Loi = Partial<Record<Truong, string>>;

/** Điền sẵn khi TẠO: mô hình an toàn nhất, hai cửa sổ ở mức giữa khoảng, không tự giới thiệu. Người tạo đổi được mọi ô. */
const FORM_TRONG: GiaTriForm = {
  code: "",
  name: "",
  description: "",
  attributionModel: "FIRST_VALID",
  cookieWindowDays: String(COOKIE_NGAY.macDinh),
  protectWindowDays: String(BAO_VE_NGAY.macDinh),
  allowSelfReferral: false,
  partnerCanViewAmount: "THEO_CAP_TREN",
  defaultSourceGroupId: "",
  effectiveFrom: "",
  effectiveTo: "",
  lyDo: "",
};

const formTuCampaign = (c: CampaignDeSua): GiaTriForm => ({
  code: c.code,
  name: c.name,
  description: c.description ?? "",
  attributionModel: c.attributionModel,
  cookieWindowDays: String(c.cookieWindowDays),
  protectWindowDays: String(c.protectWindowDays),
  allowSelfReferral: c.allowSelfReferral,
  partnerCanViewAmount: luaChonTuBool(c.partnerCanViewAmount),
  defaultSourceGroupId: c.defaultSourceGroupId ?? "",
  effectiveFrom: ngayVNTuISO(c.effectiveFrom),
  effectiveTo: ngayVNTuISO(c.effectiveTo),
  lyDo: "",
});

const so = (v: string): number => (v.trim() === "" ? Number.NaN : Number(v));

/** Ô ngày: "" → null; có chữ mà sai dạng → chuỗi hỏng (schema báo «Ngày không hợp lệ»). */
const ngayVao = (v: string): string | null => (v.trim() === "" ? null : (isoTuNgayVN(v) ?? v.trim()));

function vaoTuForm(f: GiaTriForm): Record<string, unknown> {
  return {
    code: f.code,
    name: f.name,
    description: f.description,
    attributionModel: f.attributionModel,
    cookieWindowDays: so(f.cookieWindowDays),
    protectWindowDays: so(f.protectWindowDays),
    allowSelfReferral: f.allowSelfReferral,
    partnerCanViewAmount: boolTuLuaChon(f.partnerCanViewAmount),
    defaultSourceGroupId: f.defaultSourceGroupId,
    effectiveFrom: ngayVao(f.effectiveFrom),
    effectiveTo: ngayVao(f.effectiveTo),
  };
}

const TRUONG_SUA: readonly TruongSuaCampaign[] = ["name", "description", "attributionModel", "cookieWindowDays", "protectWindowDays", "allowSelfReferral", "partnerCanViewAmount", "defaultSourceGroupId", "effectiveFrom", "effectiveTo"];

/** Chỉ các ô ĐÃ ĐỔI so với bản gốc — form gửi lại mọi ô là cách một campaign đang chạy bị chặn oan vì ô không đụng tới. */
function patchTuForm(f: GiaTriForm, goc: GiaTriForm): Record<string, unknown> {
  const vao = vaoTuForm(f);
  const patch: Record<string, unknown> = {};
  for (const k of TRUONG_SUA) {
    const doi = k === "effectiveFrom" || k === "effectiveTo" ? f[k] !== goc[k] : String(f[k]) !== String(goc[k]);
    if (doi) patch[k] = vao[k];
  }
  return patch;
}

function loiTuZod(issues: readonly { path: PropertyKey[]; message: string }[]): Loi {
  const loi: Loi = {};
  for (const i of issues) {
    const k = typeof i.path[0] === "string" ? (i.path[0] as Truong) : null;
    if (k && loi[k] === undefined) loi[k] = i.message;
  }
  return loi;
}

export type CampaignFormProps = {
  cheDo: "tao" | "sua";
  /** Chỉ chế độ sửa. */
  campaign?: CampaignDeSua;
  /** Nguồn chọn được (ACTIVE ∧ selectable ∧ trong hiệu lực) — cùng định nghĩa với ô chọn nguồn của lead mới. */
  nguon: readonly NguonChonView[];
  /** Nguồn mặc định HIỆN TẠI nếu nó không còn chọn được — vẫn hiện ở ô chọn (kèm cảnh báo) để người sửa thấy mình đang giữ gì. */
  nguonMacDinhHong?: { id: string; ten: string; lyDo: string } | null;
  luuTao?: LuuTao;
  luuSua?: LuuSua;
};

export function CampaignForm({ cheDo, campaign, nguon, nguonMacDinhHong = null, luuTao = LUU_TAO_MAC_DINH, luuSua = LUU_SUA_MAC_DINH }: CampaignFormProps) {
  const router = useRouter();
  const uid = useId();
  const sua = cheDo === "sua";
  if (sua && !campaign) throw new Error("CampaignForm chế độ sửa cần `campaign`.");

  const goc = useMemo(() => (sua ? formTuCampaign(campaign!) : FORM_TRONG), [sua, campaign]);
  const [f, setF] = useState<GiaTriForm>(goc);
  const [loi, setLoi] = useState<Loi>({});
  const [banner, setBanner] = useState<{ vuaDoi: boolean; text: string } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  const trangThai: TrangThaiCampaign = campaign?.status ?? "DRAFT";
  const khoa = (k: TruongSuaCampaign): string | null => (sua ? lyDoKhoaTruong(trangThai, k) : null);
  const patch = useMemo(() => (sua ? patchTuForm(f, goc) : {}), [sua, f, goc]);
  const truongDoi = Object.keys(patch) as TruongSuaCampaign[];
  const khongDoi = sua && truongDoi.length === 0;
  const hienLyDo = sua && trangThai !== "DRAFT" && truongDoi.some(laTruongNhayCamCampaign);

  const id = (t: string) => `${uid}-${t}`;
  const dat = <K extends keyof GiaTriForm>(k: K, v: GiaTriForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setLoi((l) => (l[k as Truong] === undefined ? l : { ...l, [k]: undefined }));
    setBanner(null);
  };
  const mo = (k: Truong, them: string[] = []): { "aria-invalid"?: true; "aria-describedby"?: string } => {
    const ids = [...them, ...(loi[k] ? [id(`loi-${k}`)] : [])];
    return { ...(loi[k] ? { "aria-invalid": true as const } : {}), ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}) };
  };

  function kiemTruoc(): Loi {
    if (!sua) {
      const r = taoCampaignSchema.safeParse(vaoTuForm(f));
      return r.success ? {} : loiTuZod(r.error.issues);
    }
    const p = suaCampaignSchema.safeParse(patch);
    if (!p.success) return loiTuZod(p.error.issues);
    const dongGoc: GiaTriCampaign = {
      name: campaign!.name,
      description: campaign!.description,
      attributionModel: campaign!.attributionModel,
      cookieWindowDays: campaign!.cookieWindowDays,
      protectWindowDays: campaign!.protectWindowDays,
      allowSelfReferral: campaign!.allowSelfReferral,
      partnerCanViewAmount: campaign!.partnerCanViewAmount,
      defaultSourceGroupId: campaign!.defaultSourceGroupId,
      effectiveFrom: campaign!.effectiveFrom ? new Date(campaign!.effectiveFrom) : null,
      effectiveTo: campaign!.effectiveTo ? new Date(campaign!.effectiveTo) : null,
    };
    const k = kiemSuaCampaign({ trangThai, hienTai: dongGoc, patch: p.data, lyDo: f.lyDo });
    if (k.ok) return {};
    return { [k.truong === "trangThai" ? "name" : k.truong]: k.loi } as Loi;
  }

  async function nop(e: React.FormEvent) {
    e.preventDefault();
    if (dangLuu) return;
    setBanner(null);
    const l = kiemTruoc();
    setLoi(l);
    if (Object.values(l).some(Boolean)) return;
    setDangLuu(true);
    try {
      if (!sua) {
        let r: KetQuaTaoCampaign;
        try {
          r = await luuTao(vaoTuForm(f));
        } catch {
          r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
        }
        if (!r.ok) return datLoiMayChu(r.loi, r.truong);
        toast.success(`Đã tạo campaign «${f.name.trim()}» ở trạng thái Nháp.`);
        router.push(`${VE_DANH_SACH}/${encodeURIComponent(r.code)}`);
        router.refresh();
        return;
      }
      let r: KetQuaSuaCampaign;
      try {
        r = await luuSua({ id: campaign!.id, updatedAtDaThay: campaign!.capNhatLuc, vao: patch, lyDo: f.lyDo.trim() === "" ? null : f.lyDo.trim() });
      } catch {
        r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
      }
      if (!r.ok) return datLoiMayChu(r.loi, r.truong);
      if (!r.doi) {
        toast.info("Không có gì thay đổi.");
        return;
      }
      toast.success(`Đã lưu campaign «${f.name.trim()}».`);
      router.push(`${VE_DANH_SACH}/${encodeURIComponent(campaign!.code)}`);
      router.refresh();
    } finally {
      setDangLuu(false);
    }
  }

  function datLoiMayChu(text: string, truong?: string) {
    if (truong && truong in FORM_TRONG && !(truong === "code" && sua)) {
      setLoi({ [truong]: text } as Loi);
      return;
    }
    setBanner({ vuaDoi: truong === "vuaDoi", text });
  }

  const maSeLa = !sua && f.code.trim() !== "" ? chuanHoaMa(f.code) : "";

  return (
    <form onSubmit={nop} noValidate aria-label={sua ? `Sửa campaign ${campaign!.name}` : "Tạo campaign mới"} className="max-w-3xl">
      <Link href={sua ? `${VE_DANH_SACH}/${encodeURIComponent(campaign!.code)}` : VE_DANH_SACH} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-primary-ink hover:underline">
        <ChevronLeft aria-hidden className="h-4 w-4" />
        {sua ? "Chi tiết campaign" : "Tất cả campaign"}
      </Link>

      {banner && (
        <div role="alert" className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {banner.text}
            {banner.vuaDoi && " Các chỗ bạn đang sửa sẽ mất khi tải lại."}
          </p>
          {banner.vuaDoi && (
            <button type="button" onClick={() => router.refresh()} className={cn(BTN_OUTLINE, NUT_NHO)}>
              Tải lại dữ liệu mới
            </button>
          )}
        </div>
      )}

      {sua && trangThai === "ACTIVE" && (
        <p role="status" className="mb-4 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          Campaign đang chạy: chỉ sửa được tên, mô tả và ngày hết hiệu lực. Muốn đổi cách ghi nhận thì tạm dừng campaign trước.
        </p>
      )}

      <div className="divide-y divide-border rounded-xl border border-border bg-card px-5">
        <Muc tieuDe="Thông tin chung">
          <O id={id("name")} nhan="Tên campaign" loi={loi.name} idLoi={id("loi-name")} idGhiChu={id("ghichu-name")} khoa={khoa("name")} idKhoa={id("khoa-name")}>
            <input id={id("name")} type="text" autoComplete="off" maxLength={120} value={f.name} onChange={(e) => dat("name", e.target.value)} disabled={khoa("name") !== null} className={FIELD} {...mo("name", khoa("name") ? [id("khoa-name")] : [])} />
          </O>

          <O
            id={id("code")}
            nhan="Mã campaign"
            loi={loi.code}
            idLoi={id("loi-code")} idGhiChu={id("ghichu-code")}
            ghiChu={sua ? "Mã không đổi sau khi tạo." : maSeLa ? `Mã sẽ là: ${maSeLa}. Chữ HOA, số và gạch dưới, 3–40 ký tự; không đổi được sau khi tạo.` : "Chữ HOA, số và gạch dưới, 3–40 ký tự; không đổi được sau khi tạo."}
          >
            <input
              id={id("code")}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              value={f.code}
              onChange={(e) => dat("code", e.target.value)}
              disabled={sua}
              className={cn(FIELD, "font-mono uppercase")}
              {...mo("code")}
            />
          </O>

          <O id={id("description")} nhan="Mô tả" loi={loi.description} idLoi={id("loi-description")} idGhiChu={id("ghichu-description")} ghiChu="Tuỳ chọn. Đối tác không thấy dòng này." khoa={khoa("description")} idKhoa={id("khoa-description")}>
            <textarea id={id("description")} rows={2} maxLength={1000} value={f.description} onChange={(e) => dat("description", e.target.value)} disabled={khoa("description") !== null} className={TEXTAREA} {...mo("description")} />
          </O>
        </Muc>

        <Muc tieuDe="Cách ghi nhận khách giới thiệu">
          <fieldset aria-describedby={khoa("attributionModel") ? id("khoa-attributionModel") : undefined} className="min-w-0">
            <legend className={NHAN_O}>Mô hình ghi nhận</legend>
            <div className="space-y-1">
              {MO_HINH_GHI_NHAN.map((m) => (
                <label key={m} className={cn("flex min-h-11 items-start gap-3 rounded-lg px-2 py-2", khoa("attributionModel") ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-muted")}>
                  <input
                    type="radio"
                    name={id("attributionModel")}
                    value={m}
                    checked={f.attributionModel === m}
                    onChange={() => dat("attributionModel", m)}
                    disabled={khoa("attributionModel") !== null}
                    className="mt-1 h-4 w-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{NHAN_MO_HINH[m]}</span>
                    <span className="block text-sm text-muted-foreground">{MO_TA_MO_HINH[m]}</span>
                  </span>
                </label>
              ))}
            </div>
            <Khoa id={id("khoa-attributionModel")} lyDo={khoa("attributionModel")} />
            {loi.attributionModel && (
              <p id={id("loi-attributionModel")} role="alert" className={LOI_O}>
                {loi.attributionModel}
              </p>
            )}
          </fieldset>

          <O
            id={id("cookieWindowDays")}
            nhan="Cửa sổ cookie (ngày)"
            loi={loi.cookieWindowDays}
            idLoi={id("loi-cookieWindowDays")} idGhiChu={id("ghichu-cookieWindowDays")}
            khoa={khoa("cookieWindowDays")}
            idKhoa={id("khoa-cookieWindowDays")}
            ghiChu={`Từ ${COOKIE_NGAY.toiThieu} đến ${COOKIE_NGAY.toiDa} ngày. Cookie chỉ là tín hiệu: máy chủ vẫn tính lại cửa sổ này khi ghi nhận khách, và một số trình duyệt xoá cookie sớm hơn.`}
          >
            <input
              id={id("cookieWindowDays")}
              type="number"
              inputMode="numeric"
              min={COOKIE_NGAY.toiThieu}
              max={COOKIE_NGAY.toiDa}
              value={f.cookieWindowDays}
              onChange={(e) => dat("cookieWindowDays", e.target.value)}
              disabled={khoa("cookieWindowDays") !== null}
              className={cn(FIELD, "max-w-40 tabular-nums")}
              {...mo("cookieWindowDays", [id("ghichu-cookieWindowDays"), ...(khoa("cookieWindowDays") ? [id("khoa-cookieWindowDays")] : [])])}
            />
          </O>

          <O
            id={id("protectWindowDays")}
            nhan="Thời gian bảo vệ (ngày)"
            loi={loi.protectWindowDays}
            idLoi={id("loi-protectWindowDays")} idGhiChu={id("ghichu-protectWindowDays")}
            khoa={khoa("protectWindowDays")}
            idKhoa={id("khoa-protectWindowDays")}
            ghiChu={`Từ ${BAO_VE_NGAY.toiThieu} đến ${BAO_VE_NGAY.toiDa} ngày. Trong thời gian này, khách đã ghi nhận cho một đối tác không bị người khác giành lại.`}
          >
            <input
              id={id("protectWindowDays")}
              type="number"
              inputMode="numeric"
              min={BAO_VE_NGAY.toiThieu}
              max={BAO_VE_NGAY.toiDa}
              value={f.protectWindowDays}
              onChange={(e) => dat("protectWindowDays", e.target.value)}
              disabled={khoa("protectWindowDays") !== null}
              className={cn(FIELD, "max-w-40 tabular-nums")}
              {...mo("protectWindowDays", [id("ghichu-protectWindowDays"), ...(khoa("protectWindowDays") ? [id("khoa-protectWindowDays")] : [])])}
            />
          </O>

          <div>
            <label className={cn("flex min-h-11 items-start gap-3 rounded-lg px-2 py-2", khoa("allowSelfReferral") ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-muted")}>
              <input
                id={id("allowSelfReferral")}
                type="checkbox"
                checked={f.allowSelfReferral}
                onChange={(e) => dat("allowSelfReferral", e.target.checked)}
                disabled={khoa("allowSelfReferral") !== null}
                aria-describedby={id("ghichu-allowSelfReferral")}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Cho phép đối tác tự giới thiệu cho chính mình</span>
                <span id={id("ghichu-allowSelfReferral")} className="block text-sm text-muted-foreground">
                  {f.allowSelfReferral
                    ? "Bật: khách trùng với chính người giới thiệu (cùng tài khoản, cùng nhân sự hoặc cùng số điện thoại) VẪN được tính công."
                    : "Tắt (nên giữ): khách trùng với chính người giới thiệu — cùng tài khoản, cùng nhân sự hoặc cùng số điện thoại — không được tính công."}
                </span>
              </span>
            </label>
            <Khoa id={id("khoa-allowSelfReferral")} lyDo={khoa("allowSelfReferral")} />
          </div>

          <O
            id={id("partnerCanViewAmount")}
            nhan="Số tiền hoa hồng ở cổng đối tác"
            loi={loi.partnerCanViewAmount}
            idLoi={id("loi-partnerCanViewAmount")}
            idGhiChu={id("ghichu-partnerCanViewAmount")}
            khoa={khoa("partnerCanViewAmount")}
            idKhoa={id("khoa-partnerCanViewAmount")}
            ghiChu={
              f.partnerCanViewAmount === "THEO_CAP_TREN"
                ? "Theo cài đặt của loại đối tác; loại chưa cài thì ẨN. Đối tác vẫn thấy link và trạng thái khách giới thiệu."
                : f.partnerCanViewAmount === "HIEN"
                  ? "Đối tác thấy số tiền hoa hồng của campaign này ở cổng (kể cả khi loại của họ đang ẨN)."
                  : "Đối tác KHÔNG thấy số tiền hoa hồng của campaign này (kể cả khi loại của họ đang HIỆN)."
            }
          >
            <select
              id={id("partnerCanViewAmount")}
              value={f.partnerCanViewAmount}
              onChange={(e) => dat("partnerCanViewAmount", e.target.value as LuaChonXemTien)}
              disabled={khoa("partnerCanViewAmount") !== null}
              className={cn(FIELD, "max-w-xs")}
              {...mo("partnerCanViewAmount", [id("ghichu-partnerCanViewAmount"), ...(khoa("partnerCanViewAmount") ? [id("khoa-partnerCanViewAmount")] : [])])}
            >
              {LUA_CHON_XEM_TIEN.map((v) => (
                <option key={v} value={v}>
                  {NHAN_LUA_CHON_XEM_TIEN[v]}
                </option>
              ))}
            </select>
          </O>
        </Muc>

        <Muc tieuDe="Nguồn khách">
          <O
            id={id("defaultSourceGroupId")}
            nhan="Nguồn mặc định"
            loi={loi.defaultSourceGroupId}
            idLoi={id("loi-defaultSourceGroupId")} idGhiChu={id("ghichu-defaultSourceGroupId")}
            khoa={khoa("defaultSourceGroupId")}
            idKhoa={id("khoa-defaultSourceGroupId")}
            ghiChu="Nguồn gán cho khách của đối tác khi không có quy tắc nào khớp loại / nhãn của họ. Quy tắc theo loại và nhãn thêm ở trang chi tiết sau khi tạo."
          >
            <select
              id={id("defaultSourceGroupId")}
              value={f.defaultSourceGroupId}
              onChange={(e) => dat("defaultSourceGroupId", e.target.value)}
              disabled={khoa("defaultSourceGroupId") !== null}
              className={FIELD}
              {...mo("defaultSourceGroupId", [id("ghichu-defaultSourceGroupId"), ...(khoa("defaultSourceGroupId") ? [id("khoa-defaultSourceGroupId")] : [])])}
            >
              <option value="">— Không đặt (dùng quy tắc, rồi nguồn mặc định của loại đối tác) —</option>
              {nguonMacDinhHong && (
                <option value={nguonMacDinhHong.id}>
                  {nguonMacDinhHong.ten} (hiện không dùng được)
                </option>
              )}
              {nguon.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.ten}
                </option>
              ))}
            </select>
            {nguonMacDinhHong && f.defaultSourceGroupId === nguonMacDinhHong.id && <p className="mt-1 text-sm text-state-warning-ink">{nguonMacDinhHong.lyDo}</p>}
          </O>
        </Muc>

        <Muc tieuDe="Hiệu lực">
          <div className="grid gap-4 sm:grid-cols-2">
            <O id={id("effectiveFrom")} nhan="Hiệu lực từ ngày" loi={loi.effectiveFrom} idLoi={id("loi-effectiveFrom")} idGhiChu={id("ghichu-effectiveFrom")} khoa={khoa("effectiveFrom")} idKhoa={id("khoa-effectiveFrom")} ghiChu="Để trống = có hiệu lực ngay khi kích hoạt. Tính từ 00:00 giờ Việt Nam.">
              <input id={id("effectiveFrom")} type="date" value={f.effectiveFrom} onChange={(e) => dat("effectiveFrom", e.target.value)} disabled={khoa("effectiveFrom") !== null} className={FIELD} {...mo("effectiveFrom", [id("ghichu-effectiveFrom")])} />
            </O>
            <O id={id("effectiveTo")} nhan="Hết hiệu lực vào ngày" loi={loi.effectiveTo} idLoi={id("loi-effectiveTo")} idGhiChu={id("ghichu-effectiveTo")} khoa={khoa("effectiveTo")} idKhoa={id("khoa-effectiveTo")} ghiChu="Để trống = không giới hạn. Từ 00:00 ngày này campaign thôi ghi nhận khách mới.">
              <input id={id("effectiveTo")} type="date" value={f.effectiveTo} onChange={(e) => dat("effectiveTo", e.target.value)} disabled={khoa("effectiveTo") !== null} className={FIELD} {...mo("effectiveTo", [id("ghichu-effectiveTo")])} />
            </O>
          </div>
        </Muc>

        {hienLyDo && (
          <Muc tieuDe="Lý do đổi">
            <O
              id={id("lyDo")}
              nhan={`Lý do (tối thiểu ${LY_DO_TOI_THIEU_CAMPAIGN} ký tự)`}
              loi={loi.lyDo}
              idLoi={id("loi-lyDo")} idGhiChu={id("ghichu-lyDo")}
              ghiChu={`Campaign đã từng chạy: đổi ${truongDoi.filter(laTruongNhayCamCampaign).map((k) => NHAN_TRUONG_CAMPAIGN[k].toLowerCase()).join(", ")} là đổi cách ghi nhận khách MỚI từ giờ. Khách đã ghi nhận giữ nguyên.`}
            >
              <textarea id={id("lyDo")} rows={2} maxLength={500} value={f.lyDo} onChange={(e) => dat("lyDo", e.target.value)} className={TEXTAREA} {...mo("lyDo", [id("ghichu-lyDo")])} />
            </O>
          </Muc>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={dangLuu || khongDoi || (sua && trangThai === "ENDED")} className={BTN_PRIMARY}>
          {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {sua ? "Lưu thay đổi" : "Tạo campaign"}
        </button>
        <Link href={sua ? `${VE_DANH_SACH}/${encodeURIComponent(campaign!.code)}` : VE_DANH_SACH} className={BTN_OUTLINE}>
          Huỷ
        </Link>
        {khongDoi && <span className="text-sm text-muted-foreground">Chưa có thay đổi nào để lưu.</span>}
        {!sua && <span className="text-sm text-muted-foreground">Campaign mới ở trạng thái Nháp — chưa ghi nhận khách cho tới khi kích hoạt.</span>}
      </div>
    </form>
  );
}

function Muc({ tieuDe, children }: { tieuDe: string; children: ReactNode }) {
  return (
    <section className="space-y-4 py-5">
      <h2 className="text-base font-semibold text-foreground">{tieuDe}</h2>
      {children}
    </section>
  );
}

function Khoa({ id, lyDo }: { id: string; lyDo: string | null }) {
  if (!lyDo) return null;
  return (
    <p id={id} className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
      <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{lyDo}</span>
    </p>
  );
}

function O({ id, nhan, loi, idLoi, idGhiChu, ghiChu, khoa, idKhoa, children }: { id: string; nhan: string; loi?: string; idLoi: string; idGhiChu: string; ghiChu?: string; khoa?: string | null; idKhoa?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={NHAN_O}>
        {nhan}
      </label>
      {children}
      {ghiChu && (
        <p id={idGhiChu} className="mt-1 text-sm text-muted-foreground">
          {ghiChu}
        </p>
      )}
      {khoa && idKhoa && <Khoa id={idKhoa} lyDo={khoa} />}
      {loi && (
        <p id={idLoi} role="alert" className={LOI_O}>
          {loi}
        </p>
      )}
    </div>
  );
}
