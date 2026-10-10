"use client";

// components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx — Sheet "Gán nguồn" (06 §5.1): sửa nguồn của MỘT lead ngay trên hàng chờ,
// không rời trang. Cũng là cửa "Đổi nguồn" của khối Nguồn trên chi tiết lead.
//
// ── Dữ liệu tải KHI MỞ, không nhét sẵn cho 25 dòng ──────────────────────────────────────────────────────────
// Mỗi lần mở gọi `moGanNguonAction(leadId)` (gác `sources:view` ở đầu hàm, lead qua Scope). Lead cũ + `capNhatLuc` của nó là mốc khoá
// lạc quan: người khác đổi nguồn trong lúc Sheet đang mở thì Lưu ⇒ "vừa được thay đổi", chứ không đè lên thứ mình chưa nhìn.
//
// ── Nút Lưu chỉ có khi máy chủ SẼ nhận (luật 12) ────────────────────────────────────────────────────────────
// `quyen` do máy chủ tính bằng `quyenDoiNguon` — cùng hàm với cổng. Không đủ quyền ⇒ KHÔNG vẽ form, nói thẳng thiếu khoá nào
// (tên thật) và hỏi ai. Không có nút xám bấm được.
//
// ── Đã có thực thu ⇒ cảnh báo hệ quả BẰNG SỐ ─────────────────────────────────────────────────────────────────
// Số khoản + tổng tiền lấy từ `WHERE_THUC_THU` (cùng định nghĩa với cổng). Dòng hoa hồng đã tính KHÔNG bị sửa; lượt đổi được
// ghi nhận để điều chỉnh (04).
//
// Hàm gọi máy chủ được TIÊM (`mo`, `doi`, `tim`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Lock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { groupIdSeGui, kiemFormChonNguon, thamChieuTuNguoi, type TruongLoiForm } from "@/lib/nguon/chon-nguon";
import { LY_DO_TOI_THIEU } from "@/lib/nguon/doi-nguon";
import type { ChoGanNguon } from "@/lib/nguon/doc-gan-nguon";
import { formatVndPlain } from "@/lib/format/money";
import { doiNguonLeadAction, moGanNguonAction } from "@/app/(admin)/admin/leads/nguon-actions";
import type { KetQuaDoiNguonAction, KetQuaMoGanNguon } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, NUT_CHAN, NUT_NHO, TEXTAREA } from "./classes";
import { CHUA_CHON_NGUON, ChonNguonFields, type TrangThaiChonNguon } from "./chon-nguon-fields";
import type { HamTim } from "./referrer-picker";
import { ThongTinNguon } from "./thong-tin-nguon";


type Mo = (leadId: string) => Promise<KetQuaMoGanNguon>;
type Doi = (input: {
  leadId: string;
  groupId: string;
  employeeId: string | null;
  parentUserId: string | null;
  studentId: string | null;
  affiliateId: string | null;
  giaiTrinh: string | null;
  lyDo: string;
  expectedUpdatedAt: string;
}) => Promise<KetQuaDoiNguonAction>;

const MO_MAC_DINH: Mo = (leadId) => moGanNguonAction({ leadId });
const DOI_MAC_DINH: Doi = (input) => doiNguonLeadAction(input);

/** Ai cấp từng khoá — câu "hỏi ai" nằm cạnh TÊN khoá (DESIGN.md §5). */
const HOI_AI = "quản lý cơ sở hoặc quản trị viên hệ thống";

type Banner = { text: string; taiLai: boolean };

type Trang = { loai: "dang-tai" } | { loai: "loi"; thongBao: string } | { loai: "san-sang"; du: ChoGanNguon };

export function GanNguonSheet({
  leadId,
  tenLead,
  children,
  triggerClassName,
  triggerAriaLabel,
  title,
  coTheMoLead,
  mo = MO_MAC_DINH,
  doi = DOI_MAC_DINH,
  tim,
  dieuHuongHang = false,
}: {
  leadId: string;
  /** Chữ hiển thị trên tiêu đề khi chưa tải xong. */
  tenLead: string;
  /** Nội dung của nút mở. */
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  /** `title` của nút mở — chữ đầy đủ khi tên bị cắt. */
  title?: string;
  /** Người xem mở được `/leads/[id]` không — có thì Sheet có đường sang hồ sơ lead. */
  coTheMoLead: boolean;
  mo?: Mo;
  doi?: Doi;
  tim?: HamTim;
  /** Nút này là một dòng của hàng chờ ⇒ nhận ↑/↓ của `TbodyDieuHuong`. Khối Nguồn trên lead thì không. */
  dieuHuongHang?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [trang, setTrang] = useState<Trang>({ loai: "dang-tai" });
  const [form, setForm] = useState<TrangThaiChonNguon>(CHUA_CHON_NGUON);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<Partial<Record<TruongLoiForm, string>>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function tai() {
    setTrang({ loai: "dang-tai" });
    setBanner(null);
    let r: KetQuaMoGanNguon;
    try {
      r = await mo(leadId);
    } catch {
      r = { ok: false, error: "Không tải được dữ liệu nguồn. Thử lại sau ít giây." };
    }
    if (!r.ok) {
      setTrang({ loai: "loi", thongBao: r.error });
      return;
    }
    setForm(CHUA_CHON_NGUON);
    setLyDo("");
    setLoi({});
    setTrang({ loai: "san-sang", du: r.du });
  }

  function doiMo(moMoi: boolean) {
    setOpen(moMoi);
    // Mỗi lần mở là MỘT lần tải mới: dữ liệu cũ (và mốc khoá lạc quan của nó) không được sống sang lượt mở sau.
    if (moMoi) void tai();
  }

  function luu(du: ChoGanNguon) {
    const nguon = du.nguon;
    if (!nguon) return;
    const chon = du.danhMuc.find((n) => n.id === form.nhomId) ?? null;
    const sai = kiemFormChonNguon({ nhom: chon, nguoi: form.nguoi, giaiTrinh: form.giaiTrinh, lyDo, canLyDo: true }, du.danhMuc);
    setLoi(sai);
    setBanner(null);
    if (Object.keys(sai).length > 0) {
      // Lỗi hiện CẠNH ô, và focus nhảy tới ô lỗi đầu tiên (PRD §72).
      requestAnimationFrame(() => {
        const f = formRef.current;
        (
          f?.querySelector<HTMLElement>('input[aria-invalid="true"], textarea[aria-invalid="true"]') ??
          f?.querySelector<HTMLElement>('fieldset[aria-invalid="true"] input')
        )?.focus();
      });
      return;
    }
    const groupId = groupIdSeGui(chon);
    if (!groupId) return;
    const tc = thamChieuTuNguoi(form.nguoi);
    const nhomGhi = du.danhMuc.find((n) => n.id === groupId);
    batDauLuu(async () => {
      let r: KetQuaDoiNguonAction;
      try {
        r = await doi({
          leadId: du.leadId,
          groupId,
          employeeId: tc?.employeeId ?? null,
          parentUserId: tc?.parentUserId ?? null,
          studentId: tc?.studentId ?? null,
          affiliateId: tc?.affiliateId ?? null,
          giaiTrinh: nhomGhi?.requiresNote ? form.giaiTrinh.trim() : null,
          lyDo: lyDo.trim(),
          expectedUpdatedAt: nguon.capNhatLuc,
        });
      } catch {
        setBanner({ text: "Không lưu được lúc này. Thử lại sau ít giây.", taiLai: false });
        return;
      }
      if (r.ok) {
        toast.success(`Đã đổi nguồn sang “${nhomGhi?.name ?? "nguồn mới"}”.`);
        if (r.canDieuChinh) toast.info("Lead đã có khoản thu — thay đổi được ghi nhận để điều chỉnh hoa hồng.");
        setOpen(false);
        router.refresh();
        return;
      }
      // Lỗi map về ĐÚNG ô; lỗi không thuộc ô nào (quyền, lead, vừa bị đổi) thì lên đầu Sheet.
      const truong = r.field;
      if (truong === "lyDo" || truong === "giaiTrinh" || truong === "thamChieu" || truong === "nguon") {
        setLoi({ [truong]: r.error });
        requestAnimationFrame(() => {
          formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"] input, input[aria-invalid="true"], textarea[aria-invalid="true"]')?.focus();
        });
      } else {
        // "Vừa được đổi" ⇒ mốc màn hình đã cũ: chỉ có "Tải lại" mới cho Lưu tiếp (không cho gửi lại cùng mốc cũ).
        setBanner({ text: r.error, taiLai: truong === "nguonVuaDoi" });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={doiMo}>
      <SheetTrigger aria-label={triggerAriaLabel} title={title} className={triggerClassName} data-nut-hang={dieuHuongHang ? "" : undefined}>
        {children}
      </SheetTrigger>
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Gán nguồn</SheetTitle>
          <SheetDescription className="truncate">
            {trang.loai === "san-sang" ? trang.du.tenLead || "(chưa có tên)" : tenLead || "(chưa có tên)"}
            {trang.loai === "san-sang" && trang.du.coSo ? ` · ${trang.du.coSo.code ?? trang.du.coSo.name}` : ""}
          </SheetDescription>
        </SheetHeader>

        {trang.loai === "dang-tai" && <KhungCho />}

        {trang.loai === "loi" && (
          <div className="space-y-3 p-5">
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{trang.thongBao}</span>
            </div>
            <button type="button" onClick={() => void tai()} className={cn(BTN_OUTLINE, NUT_NHO)}>
              Thử lại
            </button>
          </div>
        )}

        {trang.loai === "san-sang" && (
          <NoiDung
            du={trang.du}
            form={form}
            setForm={(v) => {
              setForm(v);
              // Sửa lựa chọn là xoá lỗi CŨ của ô nguồn/người/giải trình (lỗi lý do giữ tới khi sửa lý do): lỗi còn nằm đó sau khi đã sửa là nói dối.
              setLoi((l) => ({ lyDo: l.lyDo }));
            }}
            lyDo={lyDo}
            setLyDo={(v) => {
              setLyDo(v);
              setLoi((l) => ({ ...l, lyDo: undefined }));
            }}
            loi={loi}
            banner={banner}
            dangLuu={dangLuu}
            formRef={formRef}
            tim={tim}
            coTheMoLead={coTheMoLead}
            onLuu={() => luu(trang.du)}
            onTaiLai={() => void tai()}
            onDong={() => setOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function KhungCho() {
  // Skeleton đúng hình nội dung thật: khối "Hiện tại" rồi danh sách radio.
  return (
    <div role="status" aria-label="Đang tải nguồn" className="space-y-5 p-5">
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-muted" style={{ width: `${88 - i * 12}%` }} />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

function NoiDung({
  du,
  form,
  setForm,
  lyDo,
  setLyDo,
  loi,
  banner,
  dangLuu,
  formRef,
  tim,
  coTheMoLead,
  onLuu,
  onTaiLai,
  onDong,
}: {
  du: ChoGanNguon;
  form: TrangThaiChonNguon;
  setForm: (v: TrangThaiChonNguon) => void;
  lyDo: string;
  setLyDo: (v: string) => void;
  loi: Partial<Record<TruongLoiForm, string>>;
  banner: Banner | null;
  dangLuu: boolean;
  formRef: React.RefObject<HTMLFormElement | null>;
  tim?: HamTim;
  coTheMoLead: boolean;
  onLuu: () => void;
  onTaiLai: () => void;
  onDong: () => void;
}) {
  const nguon = du.nguon;
  const soKyTuLyDo = lyDo.trim().length;
  const duocDoi = du.quyen.ok && nguon !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {banner && (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
            <span>{banner.text}</span>
            {banner.taiLai && (
              <button type="button" onClick={onTaiLai} className={cn(BTN_OUTLINE, NUT_NHO, "shrink-0")}>
                Tải lại
              </button>
            )}
          </div>
        )}

        {/* HIỆN TẠI */}
        <section aria-labelledby="gn-hien-tai">
          <h3 id="gn-hien-tai" className="mb-2 text-sm font-semibold text-foreground">
            Hiện tại
          </h3>
          {nguon ? (
            <ThongTinNguon nguon={nguon} duongVao={du.duongVao} />
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              Lead này chưa có quy nguồn (tạo trước khi bật quản lý nguồn). Chưa gán được — chờ đợt chuyển dữ liệu nguồn cũ. Đường vào cũ:{" "}
              <b className="text-foreground">{du.duongVao?.trim() || "—"}</b>
            </div>
          )}
        </section>

        {/* KHÔNG ĐƯỢC ĐỔI: nêu TÊN khoá thật + hỏi ai. Không vẽ form, không nút xám. */}
        {nguon && !du.quyen.ok && (
          <section className="rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-labelledby="gn-khong-doi">
            <p id="gn-khong-doi" className="flex items-center gap-2 font-semibold text-foreground">
              <Lock aria-hidden className="h-4 w-4 text-muted-foreground" />
              {du.nguon?.khoa && du.quyen.thieu.includes("sources:manage") ? "Nguồn này đã khoá" : "Bạn chưa đổi được nguồn lead này"}
            </p>
            <p className="mt-1 text-muted-foreground">{du.quyen.loi}</p>
            <p className="mt-2 text-muted-foreground">
              Quyền cần xin:{" "}
              {du.quyen.thieu.map((k, i) => (
                <span key={k}>
                  {i > 0 && " và "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{k}</code>
                </span>
              ))}
              . Hỏi {HOI_AI}.
            </p>
          </section>
        )}

        {duocDoi && nguon && (
          <form
            ref={formRef}
            aria-label="Đổi nguồn"
            onSubmit={(e) => {
              e.preventDefault();
              onLuu();
            }}
            onKeyDown={(e) => {
              // Ctrl/⌘ + Enter lưu từ bất kỳ ô nào (kể cả ô nhiều dòng, nơi Enter trần là xuống dòng).
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onLuu();
              }
            }}
            className="space-y-5"
            noValidate
          >
            {du.thucThu && (
              <div role="status" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Lead này đã có <b className="tabular-nums">{du.thucThu.soKhoan}</b> khoản thu, tổng{" "}
                  <b className="tabular-nums">{formatVndPlain(du.thucThu.tong)}</b>. Đổi nguồn sẽ được ghi nhận để điều chỉnh hoa hồng — các dòng
                  hoa hồng đã tính <b>không bị sửa</b>.
                </p>
              </div>
            )}

            <ChonNguonFields idPrefix="gn" nhom={du.danhMuc} value={form} onChange={setForm} errors={loi} disabled={dangLuu} tim={tim} />

            <div>
              <label htmlFor="gn-ly-do" className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground">
                <span>Lý do đổi nguồn</span>
                <span
                  className={cn(
                    "text-xs font-normal tabular-nums",
                    soKyTuLyDo >= LY_DO_TOI_THIEU ? "text-state-success-ink" : "text-muted-foreground",
                  )}
                >
                  {soKyTuLyDo}/{LY_DO_TOI_THIEU} ký tự tối thiểu
                </span>
              </label>
              <textarea
                id="gn-ly-do"
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                disabled={dangLuu}
                aria-invalid={loi.lyDo ? true : undefined}
                aria-describedby={loi.lyDo ? "gn-ly-do-loi" : undefined}
                placeholder="Vì sao đổi? Ví dụ: phụ huynh xác nhận chị Lan giới thiệu, không phải quảng cáo."
                className={TEXTAREA}
              />
              {loi.lyDo && (
                <p id="gn-ly-do-loi" role="alert" className="mt-1 text-xs text-state-danger-ink">
                  {loi.lyDo}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Lý do được lưu cùng tên bạn và giờ đổi trong nhật ký nguồn.</p>
            </div>
            {/* Nút submit ẩn để Enter ở ô radio kích hoạt biểu mẫu; nút thật nằm ở chân Sheet. */}
            <button type="submit" hidden tabIndex={-1} aria-hidden />
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card p-4">
        {coTheMoLead ? (
          <Link href={`/leads/${du.leadId}`} className="text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Mở hồ sơ lead
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onDong} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            {duocDoi ? "Huỷ" : "Đóng"}
          </button>
          {duocDoi && (
            <button type="button" onClick={onLuu} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangLuu ? "Đang lưu…" : "Lưu nguồn mới"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
