"use client";

// components/admin/nguon-hoa-hong/affiliate/loai-nhan-sheet.tsx — Sheet «Tạo / Sửa LOẠI đối tác» và «Tạo / Sửa NHÃN» (tab Affiliate, mục Loại · Nhãn).
//
// Danh mục do admin tạo ở ĐÂY — không có loại/nhãn nào nằm trong mã nguồn; thêm loại mới không sửa code.
// ── Nút nói thật (luật 12) ─────────────────────────────────────────────────────────────────────────────────
//  · Trang chỉ dựng Sheet khi `scope.has("affiliates:manage")` ∧ module bật — đúng hai điều kiện mà các action `tao*/sua*` kiểm ở đầu hàm.
//  · MÃ chỉ nhập lúc TẠO; lúc sửa hiện ở dạng chỉ đọc kèm câu «mã không đổi» (schema SỬA từ chối ô `code`, nên không có ô để vẽ).
//  · «Nguồn mặc định» chỉ liệt kê nguồn đang hoạt động ∧ chọn được (`docNguonChoLoai`); nguồn mặc định hiện có mà đã ngừng vẫn hiện (kèm «đã ngừng») để không lặng lẽ mất khi lưu.
//  · «Cần duyệt» ảnh hưởng đối tác MỚI (PENDING hay ACTIVE khi tạo) — câu dưới ô nói thẳng; đối tác cũ không đổi trạng thái.
// Hàm gọi máy chủ được TIÊM (`tao`, `sua`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { suaLoaiAction, suaNhanAction, taoLoaiAction, taoNhanAction } from "@/app/(admin)/admin/nguon-hoa-hong/affiliate/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { DongLoai, DongNhan } from "@/lib/affiliate/doc-doi-tac";
import type { KetQuaSuaDanhMuc, KetQuaTaoDanhMuc } from "@/lib/affiliate/ghi-loai-nhan";
import { chuanHoaMa } from "@/lib/affiliate/chung";
import { kiemMaDanhMuc, suaLoaiSchema, suaNhanSchema, taoLoaiSchema, taoNhanSchema } from "@/lib/affiliate/ghi-loai-nhan-dau-vao";
import { boolTuLuaChon, LUA_CHON_XEM_TIEN, luaChonTuBool, NHAN_LUA_CHON_XEM_TIEN, type LuaChonXemTien } from "@/lib/affiliate/quyen-xem-tien";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, O_NHAP, TEXTAREA } from "../classes";

type Tao = (input: { vao: Record<string, unknown> }) => Promise<KetQuaTaoDanhMuc>;
type Sua = (input: { id: string; updatedAtDaThay: string; vao: Record<string, unknown> }) => Promise<KetQuaSuaDanhMuc>;

type Banner = { text: string; taiLai: boolean };

/** Khung Sheet chung của hai biểu mẫu: tiêu đề, banner lỗi, vùng cuộn, chân Huỷ/Lưu. */
function KhungSheet({
  open,
  doiMo,
  trigger,
  tieuDe,
  moTa,
  banner,
  dongBanner,
  nhanLuu,
  dangLuu,
  luu,
  children,
  formRef,
  tenForm,
}: {
  open: boolean;
  doiMo: (m: boolean) => void;
  trigger: ReactNode;
  tieuDe: string;
  moTa: string;
  banner: Banner | null;
  dongBanner: () => void;
  nhanLuu: string;
  dangLuu: boolean;
  luu: () => void;
  children: ReactNode;
  formRef: React.RefObject<HTMLFormElement | null>;
  tenForm: string;
}) {
  return (
    <Sheet open={open} onOpenChange={doiMo}>
      {trigger}
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">{tieuDe}</SheetTitle>
          <SheetDescription className="truncate">{moTa}</SheetDescription>
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
                  <button type="button" onClick={dongBanner} className={cn(BTN_OUTLINE, NUT_NHO, "shrink-0")}>
                    Tải lại
                  </button>
                )}
              </div>
            )}
            <form
              ref={formRef}
              aria-label={tenForm}
              noValidate
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                luu();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  luu();
                }
              }}
            >
              {children}
              <button type="submit" hidden tabIndex={-1} aria-hidden />
            </form>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border bg-card p-4">
            <button type="button" onClick={() => doiMo(false)} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
              Huỷ
            </button>
            <button type="button" onClick={luu} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangLuu ? "Đang lưu…" : nhanLuu}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── LOẠI ──────────────────────────────────────────────────────────────────────────────────────────

type TruongLoai = "code" | "name" | "description" | "defaultSourceGroupId" | "requiresApproval" | "partnerCanViewAmount" | "sortOrder";
const TRUONG_LOAI: readonly TruongLoai[] = ["code", "name", "description", "defaultSourceGroupId", "requiresApproval", "partnerCanViewAmount", "sortOrder"];

type FormLoai = { ma: string; ten: string; moTa: string; nguonId: string; canDuyet: boolean; xemTien: LuaChonXemTien; thuTu: string };

const formLoaiBanDau = (d: DongLoai | undefined): FormLoai =>
  d
    ? { ma: d.ma, ten: d.ten, moTa: d.moTa ?? "", nguonId: d.nguonMacDinh?.id ?? "", canDuyet: d.canDuyet, xemTien: luaChonTuBool(d.xemTien), thuTu: String(d.thuTu) }
    : { ma: "", ten: "", moTa: "", nguonId: "", canDuyet: true, xemTien: "THEO_CAP_TREN", thuTu: "100" };

export function LoaiSheet({
  dong,
  nguon,
  children,
  triggerClassName,
  triggerAriaLabel,
  tao = (i) => taoLoaiAction(i),
  sua = (i) => suaLoaiAction(i),
}: {
  dong?: DongLoai;
  /** Nguồn chọn được làm mặc định (`docNguonChoLoai`). */
  nguon: { id: string; ten: string }[];
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  tao?: Tao;
  sua?: Sua;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FormLoai>(() => formLoaiBanDau(dong));
  const [loi, setLoi] = useState<Partial<Record<TruongLoai, string>>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const laSua = dong !== undefined;
  const id = (t: string) => `${uid}-${t}`;
  const maDaChuanHoa = chuanHoaMa(f.ma);
  const loiMa = f.ma.trim() === "" ? null : kiemMaDanhMuc(maDaChuanHoa);
  const nguonHienThi = [...nguon, ...(dong?.nguonMacDinh && !nguon.some((n) => n.id === dong.nguonMacDinh?.id) ? [{ id: dong.nguonMacDinh.id, ten: `${dong.nguonMacDinh.ten} (đã ngừng)` }] : [])];

  function doiMo(m: boolean) {
    setOpen(m);
    if (m) {
      setF(formLoaiBanDau(dong));
      setLoi({});
      setBanner(null);
    }
  }
  const dat = (p: Partial<FormLoai>, xoa: TruongLoai[]) => {
    setF((cu) => ({ ...cu, ...p }));
    setLoi((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !xoa.includes(k as TruongLoai))));
  };
  const focusLoi = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus?.());

  function luu() {
    setBanner(null);
    const thuTu = f.thuTu.trim() === "" ? Number.NaN : Number(f.thuTu);
    const chung = { name: f.ten, description: f.moTa, defaultSourceGroupId: f.nguonId === "" ? null : f.nguonId, requiresApproval: f.canDuyet, partnerCanViewAmount: boolTuLuaChon(f.xemTien), sortOrder: thuTu };
    const vao = laSua ? chung : { code: f.ma, ...chung };
    const kiem = (laSua ? suaLoaiSchema : taoLoaiSchema).safeParse(vao);
    if (!kiem.success) {
      const sai: Partial<Record<TruongLoai, string>> = {};
      for (const it of kiem.error.issues) {
        const k = it.path[0];
        if (typeof k === "string" && (TRUONG_LOAI as readonly string[]).includes(k) && !sai[k as TruongLoai]) sai[k as TruongLoai] = it.message;
      }
      setLoi(sai);
      focusLoi();
      return;
    }
    setLoi({});
    batDauLuu(async () => {
      let r: KetQuaTaoDanhMuc | KetQuaSuaDanhMuc;
      try {
        r = laSua ? await sua({ id: dong.id, updatedAtDaThay: dong.capNhatLuc, vao }) : await tao({ vao });
      } catch {
        setBanner({ text: "Không lưu được lúc này. Thử lại sau ít giây.", taiLai: false });
        return;
      }
      if (r.ok) {
        toast.success(laSua ? ("doi" in r && !r.doi ? "Không có gì thay đổi." : `Đã lưu loại «${f.ten.trim()}».`) : `Đã tạo loại «${f.ten.trim()}».`);
        setOpen(false);
        router.refresh();
        return;
      }
      const k = r.truong;
      if (k && (TRUONG_LOAI as readonly string[]).includes(k)) {
        setLoi({ [k]: r.loi });
        focusLoi();
      } else setBanner({ text: r.loi, taiLai: k === "vuaDoi" });
    });
  }

  const loiO = (k: TruongLoai) => (loi[k] ? { "aria-invalid": true as const, "aria-describedby": id(`${k}-loi`) } : {});
  const hienLoi = (k: TruongLoai) =>
    loi[k] ? (
      <p id={id(`${k}-loi`)} role="alert" className={LOI_O}>
        {loi[k]}
      </p>
    ) : null;

  return (
    <KhungSheet
      open={open}
      doiMo={doiMo}
      trigger={
        <SheetTrigger aria-label={triggerAriaLabel} className={triggerClassName}>
          {children}
        </SheetTrigger>
      }
      tieuDe={laSua ? "Sửa loại đối tác" : "Tạo loại đối tác"}
      moTa={laSua ? dong.ten : "Loại quyết định đối tác mới cần duyệt hay không, và nguồn mặc định của khách họ giới thiệu."}
      banner={banner}
      dongBanner={() => {
        setOpen(false);
        router.refresh();
      }}
      nhanLuu={laSua ? "Lưu thay đổi" : "Tạo loại"}
      dangLuu={dangLuu}
      luu={luu}
      formRef={formRef}
      tenForm={laSua ? "Sửa loại đối tác" : "Tạo loại đối tác"}
    >
      <div>
        <label htmlFor={id("ma")} className={NHAN_O}>
          Mã {!laSua && <span aria-hidden>*</span>}
        </label>
        {laSua ? (
          <>
            <input id={id("ma")} value={dong.ma} readOnly className={cn(O_NHAP, "bg-muted font-mono")} />
            <p className="mt-1 text-sm text-muted-foreground">Mã không đổi sau khi tạo.</p>
          </>
        ) : (
          <>
            <input
              id={id("ma")}
              value={f.ma}
              maxLength={60}
              disabled={dangLuu}
              onChange={(e) => dat({ ma: e.target.value.toUpperCase() }, ["code"])}
              placeholder="VD: KOL"
              spellCheck={false}
              className={cn(O_NHAP, "font-mono")}
              {...loiO("code")}
            />
            {f.ma.trim() === "" ? (
              <p className="mt-1 text-sm text-muted-foreground">Chữ HOA, số và gạch dưới, 3–40 ký tự. Mã KHÔNG đổi được sau khi tạo.</p>
            ) : loiMa ? (
              <p className="mt-1 text-sm text-state-danger-ink">{loiMa}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Mã sẽ lưu: <b className="font-mono text-foreground">{maDaChuanHoa}</b> · không đổi được sau khi tạo.
              </p>
            )}
            {hienLoi("code")}
          </>
        )}
      </div>

      <div>
        <label htmlFor={id("ten")} className={NHAN_O}>
          Tên loại <span aria-hidden>*</span>
        </label>
        <input id={id("ten")} value={f.ten} maxLength={80} disabled={dangLuu} onChange={(e) => dat({ ten: e.target.value }, ["name"])} placeholder="VD: Người có ảnh hưởng (KOL)" className={O_NHAP} {...loiO("name")} />
        {hienLoi("name")}
      </div>

      <div>
        <label htmlFor={id("mo-ta")} className={NHAN_O}>
          Mô tả
        </label>
        <textarea id={id("mo-ta")} rows={2} maxLength={500} value={f.moTa} disabled={dangLuu} onChange={(e) => dat({ moTa: e.target.value }, ["description"])} className={TEXTAREA} {...loiO("description")} />
        {hienLoi("description")}
      </div>

      <div>
        <label htmlFor={id("nguon")} className={NHAN_O}>
          Nguồn mặc định
        </label>
        <select id={id("nguon")} value={f.nguonId} disabled={dangLuu} onChange={(e) => dat({ nguonId: e.target.value }, ["defaultSourceGroupId"])} className={O_NHAP} {...loiO("defaultSourceGroupId")}>
          <option value="">— Không có —</option>
          {nguonHienThi.map((n) => (
            <option key={n.id} value={n.id}>
              {n.ten}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-muted-foreground">Dùng khi campaign không có quy tắc riêng. Để trống: khách của đối tác loại này sẽ vào hàng chờ xem tay.</p>
        {hienLoi("defaultSourceGroupId")}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <span className={NHAN_O}>Duyệt đối tác mới</span>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-foreground">
            <input type="checkbox" checked={f.canDuyet} disabled={dangLuu} onChange={(e) => dat({ canDuyet: e.target.checked }, ["requiresApproval"])} className="mt-1 h-4 w-4 accent-primary" />
            <span>
              Cần duyệt
              <span className="block text-muted-foreground">{f.canDuyet ? "Đối tác mới của loại này ở «Chờ duyệt» cho tới khi được duyệt." : "Đối tác mới của loại này hoạt động ngay."} Đối tác đã có không đổi.</span>
            </span>
          </label>
          {hienLoi("requiresApproval")}
        </div>
        <div>
          <label htmlFor={id("thu-tu")} className={NHAN_O}>
            Thứ tự hiển thị
          </label>
          <input id={id("thu-tu")} inputMode="numeric" value={f.thuTu} maxLength={4} disabled={dangLuu} onChange={(e) => dat({ thuTu: e.target.value.replace(/[^0-9]/g, "") }, ["sortOrder"])} className={O_NHAP} {...loiO("sortOrder")} />
          <p className="mt-1 text-sm text-muted-foreground">Số nhỏ đứng trước.</p>
          {hienLoi("sortOrder")}
        </div>
      </div>

      <div>
        <label htmlFor={id("xem-tien")} className={NHAN_O}>
          Số tiền hoa hồng ở cổng đối tác
        </label>
        <select id={id("xem-tien")} value={f.xemTien} disabled={dangLuu} onChange={(e) => dat({ xemTien: e.target.value as LuaChonXemTien }, ["partnerCanViewAmount"])} className={O_NHAP} {...loiO("partnerCanViewAmount")}>
          {LUA_CHON_XEM_TIEN.map((v) => (
            <option key={v} value={v}>
              {v === "THEO_CAP_TREN" ? "Mặc định (ẩn)" : NHAN_LUA_CHON_XEM_TIEN[v]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-muted-foreground">
          Đối tác loại này có thấy SỐ TIỀN hoa hồng ở cổng phụ huynh không. Campaign khai riêng thì campaign quyết định. Đối tác luôn thấy link và trạng thái khách giới thiệu.
        </p>
        {hienLoi("partnerCanViewAmount")}
      </div>
    </KhungSheet>
  );
}

// ── NHÃN ──────────────────────────────────────────────────────────────────────────────────────────

type TruongNhan = "code" | "name" | "description";
const TRUONG_NHAN: readonly TruongNhan[] = ["code", "name", "description"];

export function NhanSheet({
  dong,
  children,
  triggerClassName,
  triggerAriaLabel,
  tao = (i) => taoNhanAction(i),
  sua = (i) => suaNhanAction(i),
}: {
  dong?: DongNhan;
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  tao?: Tao;
  sua?: Sua;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ma: dong?.ma ?? "", ten: dong?.ten ?? "", moTa: dong?.moTa ?? "" });
  const [loi, setLoi] = useState<Partial<Record<TruongNhan, string>>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const laSua = dong !== undefined;
  const id = (t: string) => `${uid}-${t}`;
  const maDaChuanHoa = chuanHoaMa(f.ma);
  const loiMa = f.ma.trim() === "" ? null : kiemMaDanhMuc(maDaChuanHoa);

  function doiMo(m: boolean) {
    setOpen(m);
    if (m) {
      setF({ ma: dong?.ma ?? "", ten: dong?.ten ?? "", moTa: dong?.moTa ?? "" });
      setLoi({});
      setBanner(null);
    }
  }
  const dat = (p: Partial<typeof f>, xoa: TruongNhan) => {
    setF((cu) => ({ ...cu, ...p }));
    setLoi((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== xoa)));
  };
  const focusLoi = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus?.());

  function luu() {
    setBanner(null);
    const chung = { name: f.ten, description: f.moTa };
    const vao = laSua ? chung : { code: f.ma, ...chung };
    const kiem = (laSua ? suaNhanSchema : taoNhanSchema).safeParse(vao);
    if (!kiem.success) {
      const sai: Partial<Record<TruongNhan, string>> = {};
      for (const it of kiem.error.issues) {
        const k = it.path[0];
        if (typeof k === "string" && (TRUONG_NHAN as readonly string[]).includes(k) && !sai[k as TruongNhan]) sai[k as TruongNhan] = it.message;
      }
      setLoi(sai);
      focusLoi();
      return;
    }
    setLoi({});
    batDauLuu(async () => {
      let r: KetQuaTaoDanhMuc | KetQuaSuaDanhMuc;
      try {
        r = laSua ? await sua({ id: dong.id, updatedAtDaThay: dong.capNhatLuc, vao }) : await tao({ vao });
      } catch {
        setBanner({ text: "Không lưu được lúc này. Thử lại sau ít giây.", taiLai: false });
        return;
      }
      if (r.ok) {
        toast.success(laSua ? ("doi" in r && !r.doi ? "Không có gì thay đổi." : `Đã lưu nhãn «${f.ten.trim()}».`) : `Đã tạo nhãn «${f.ten.trim()}».`);
        setOpen(false);
        router.refresh();
        return;
      }
      const k = r.truong;
      if (k && (TRUONG_NHAN as readonly string[]).includes(k)) {
        setLoi({ [k]: r.loi });
        focusLoi();
      } else setBanner({ text: r.loi, taiLai: k === "vuaDoi" });
    });
  }

  const loiO = (k: TruongNhan) => (loi[k] ? { "aria-invalid": true as const, "aria-describedby": id(`${k}-loi`) } : {});
  const hienLoi = (k: TruongNhan) =>
    loi[k] ? (
      <p id={id(`${k}-loi`)} role="alert" className={LOI_O}>
        {loi[k]}
      </p>
    ) : null;

  return (
    <KhungSheet
      open={open}
      doiMo={doiMo}
      trigger={
        <SheetTrigger aria-label={triggerAriaLabel} className={triggerClassName}>
          {children}
        </SheetTrigger>
      }
      tieuDe={laSua ? "Sửa nhãn" : "Tạo nhãn"}
      moTa={laSua ? dong.ten : "Nhãn gắn vào đối tác để phân nhóm (một đối tác có nhiều nhãn)."}
      banner={banner}
      dongBanner={() => {
        setOpen(false);
        router.refresh();
      }}
      nhanLuu={laSua ? "Lưu thay đổi" : "Tạo nhãn"}
      dangLuu={dangLuu}
      luu={luu}
      formRef={formRef}
      tenForm={laSua ? "Sửa nhãn" : "Tạo nhãn"}
    >
      <div>
        <label htmlFor={id("ma")} className={NHAN_O}>
          Mã {!laSua && <span aria-hidden>*</span>}
        </label>
        {laSua ? (
          <>
            <input id={id("ma")} value={dong.ma} readOnly className={cn(O_NHAP, "bg-muted font-mono")} />
            <p className="mt-1 text-sm text-muted-foreground">Mã không đổi sau khi tạo.</p>
          </>
        ) : (
          <>
            <input id={id("ma")} value={f.ma} maxLength={60} disabled={dangLuu} onChange={(e) => dat({ ma: e.target.value.toUpperCase() }, "code")} placeholder="VD: GIAO_VIEN" spellCheck={false} className={cn(O_NHAP, "font-mono")} {...loiO("code")} />
            {f.ma.trim() === "" ? (
              <p className="mt-1 text-sm text-muted-foreground">Chữ HOA, số và gạch dưới, 3–40 ký tự. Mã KHÔNG đổi được sau khi tạo.</p>
            ) : loiMa ? (
              <p className="mt-1 text-sm text-state-danger-ink">{loiMa}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Mã sẽ lưu: <b className="font-mono text-foreground">{maDaChuanHoa}</b> · không đổi được sau khi tạo.
              </p>
            )}
            {hienLoi("code")}
          </>
        )}
      </div>
      <div>
        <label htmlFor={id("ten")} className={NHAN_O}>
          Tên nhãn <span aria-hidden>*</span>
        </label>
        <input id={id("ten")} value={f.ten} maxLength={80} disabled={dangLuu} onChange={(e) => dat({ ten: e.target.value }, "name")} placeholder="VD: Giáo viên" className={O_NHAP} {...loiO("name")} />
        {hienLoi("name")}
      </div>
      <div>
        <label htmlFor={id("mo-ta")} className={NHAN_O}>
          Mô tả
        </label>
        <textarea id={id("mo-ta")} rows={2} maxLength={500} value={f.moTa} disabled={dangLuu} onChange={(e) => dat({ moTa: e.target.value }, "description")} className={TEXTAREA} {...loiO("description")} />
        {hienLoi("description")}
      </div>
    </KhungSheet>
  );
}
