"use client";

// components/admin/nguon-hoa-hong/bo-sung-sale-sheet.tsx — Sheet «Bổ sung Sale phụ trách phụ huynh» (khối Nguồn của lead).
//
// Đường thoát của hold `THIEU_SALE_PHU_HUYNH`: lead do PHỤ HUYNH giới thiệu mà lúc ghi nhận không tìm được Sale đang phụ trách phụ huynh ấy.
// Người có quyền chọn đúng nhân sự và ghi lý do; máy chủ (`boSungSalePhuHuynhAction` → `boSungSalePhuHuynh`) chỉ ĐIỀN CHỖ TRỐNG — Sale đã ghi nhận không bao giờ bị thay.
//
// ── Nút chỉ có khi máy chủ SẼ nhận (luật 12) ────────────────────────────────────────────────────────────────
// Component này KHÔNG tự quyết có vẽ hay không: nơi gọi (`KhoiNguonLead`) chỉ dựng nó khi `du.boSungSale.kieu === "DUOC"` — kết quả của `quyetDinhNutBoSungSale`,
// ghép từ `quyenDoiNguon` (cùng hàm với cổng máy chủ) và `nguonChonDuoc`.
//
// ── Ô tìm là ô tìm NHÂN SỰ có sẵn (`ReferrerPicker`, loại NHAN_SU) ───────────────────────────────────────────
// Chỉ đổi nhãn thành «Sale phụ trách phụ huynh». Danh sách hiện kèm VAI của từng người (Sale · Quản lý · Giáo viên …) để người chọn không nhầm; máy chủ không bắt buộc
// vai Sale (nhân sự nào còn làm việc cũng nhận được), nhưng không nhận chủ lead (TU_CLAIM) hay người đã nghỉ.
//
// Hàm gọi máy chủ được TIÊM (`bo`, `tim`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { boSungSalePhuHuynhAction } from "@/app/(admin)/admin/leads/nguon-actions";
import type { NguoiDaChon } from "@/lib/nguon/chon-nguon";
import { LY_DO_TOI_THIEU } from "@/lib/nguon/doi-nguon";
import type { KetQuaDoiNguonAction } from "@/lib/nguon/ket-qua-action";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, NUT_CHAN, NUT_NHO, TEXTAREA } from "./classes";
import { ReferrerPicker, type HamTim } from "./referrer-picker";

type Bo = (input: { leadId: string; saleEmployeeId: string; lyDo: string; expectedUpdatedAt: string }) => Promise<KetQuaDoiNguonAction>;

const BO_MAC_DINH: Bo = (input) => boSungSalePhuHuynhAction(input);

type Loi = { thamChieu?: string; lyDo?: string };
type Banner = { text: string; taiLai: boolean };

export function BoSungSaleSheet({
  leadId,
  tenLead,
  tenPhuHuynh,
  soKhoanThu,
  capNhatLuc,
  children,
  triggerClassName,
  triggerAriaLabel,
  bo = BO_MAC_DINH,
  tim,
}: {
  leadId: string;
  tenLead: string;
  /** Tên phụ huynh giới thiệu (đã che PII nếu người xem không được xem). Null nếu không đọc được. */
  tenPhuHuynh: string | null;
  /** Số khoản thu đã có của lead; >0 ⇒ nói rõ hệ quả với hoa hồng. Null/0 ⇒ lead chưa thu. */
  soKhoanThu: number | null;
  /** `ChoGanNguon.nguon.capNhatLuc` — mốc màn hình người dùng đã nhìn (khoá lạc quan). */
  capNhatLuc: string;
  children: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  bo?: Bo;
  tim?: HamTim;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nguoi, setNguoi] = useState<NguoiDaChon | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<Loi>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const soKyTu = lyDo.trim().length;

  function doiMo(moMoi: boolean) {
    setOpen(moMoi);
    // Mỗi lần mở là một lần làm mới: lựa chọn dở của lượt trước (và lỗi của nó) không sống sang lượt sau.
    if (moMoi) {
      setNguoi(null);
      setLyDo("");
      setLoi({});
      setBanner(null);
    }
  }

  function luu() {
    const sai: Loi = {};
    if (nguoi?.loai !== "NHAN_SU") sai.thamChieu = "Chọn nhân sự đang phụ trách phụ huynh này.";
    if (soKyTu < LY_DO_TOI_THIEU) sai.lyDo = `Lý do phải từ ${LY_DO_TOI_THIEU} ký tự.`;
    setLoi(sai);
    setBanner(null);
    if (sai.thamChieu || sai.lyDo || nguoi?.loai !== "NHAN_SU") {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('input[aria-invalid="true"], textarea[aria-invalid="true"]')?.focus());
      return;
    }
    const sale = nguoi;
    batDauLuu(async () => {
      let r: KetQuaDoiNguonAction;
      try {
        r = await bo({ leadId, saleEmployeeId: sale.employeeId, lyDo: lyDo.trim(), expectedUpdatedAt: capNhatLuc });
      } catch {
        setBanner({ text: "Không lưu được lúc này. Thử lại sau ít giây.", taiLai: false });
        return;
      }
      if (r.ok) {
        toast.success(`Đã bổ sung ${sale.ten} làm Sale phụ trách phụ huynh.`);
        if (r.canDieuChinh) toast.info("Lead đã có khoản thu — thay đổi được ghi nhận để điều chỉnh hoa hồng.");
        setOpen(false);
        router.refresh();
        return;
      }
      // Lỗi map về ĐÚNG ô; lỗi không thuộc ô nào (quyền, lead, vừa bị đổi) lên đầu Sheet.
      if (r.field === "thamChieu" || r.field === "lyDo") {
        setLoi({ [r.field]: r.error });
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('input[aria-invalid="true"], textarea[aria-invalid="true"]')?.focus());
      } else {
        // «Vừa được đổi» ⇒ mốc màn hình đã cũ: chỉ «Tải lại» mới cho lưu tiếp.
        setBanner({ text: r.error, taiLai: r.field === "nguonVuaDoi" });
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={doiMo}>
      <SheetTrigger aria-label={triggerAriaLabel} className={triggerClassName}>
        {children}
      </SheetTrigger>
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Bổ sung Sale phụ trách phụ huynh</SheetTitle>
          <SheetDescription className="truncate">{tenLead || "(chưa có tên)"}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {banner && (
              <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <span>{banner.text}</span>
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

            <p className="text-sm text-foreground">
              {tenPhuHuynh ? (
                <>
                  Lead do phụ huynh <b>{tenPhuHuynh}</b> giới thiệu, nhưng hệ thống không tìm được Sale đang phụ trách phụ huynh này.
                </>
              ) : (
                <>Lead do phụ huynh giới thiệu, nhưng hệ thống không tìm được Sale đang phụ trách phụ huynh ấy.</>
              )}{" "}
              Chọn đúng nhân sự đó. Việc này chỉ điền chỗ trống — Sale đã ghi nhận không bị thay, và không chọn được người đang phụ trách lead này.
            </p>

            {soKhoanThu !== null && soKhoanThu > 0 && (
              <div role="status" className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Lead đã có <b className="tabular-nums">{soKhoanThu}</b> khoản thu. Các dòng hoa hồng đã tính <b>không bị sửa</b>; phần chênh do Sale vừa bổ sung (nếu có chính sách) hiện thành mục chờ duyệt, không tự
                  chèn vào sổ cũ.
                </p>
              </div>
            )}

            <form
              ref={formRef}
              aria-label="Bổ sung Sale phụ trách phụ huynh"
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
              <ReferrerPicker
                idPrefix="bs"
                loai="NHAN_SU"
                nhan="Sale phụ trách phụ huynh"
                value={nguoi}
                onChange={(n) => {
                  setNguoi(n);
                  setLoi((l) => ({ lyDo: l.lyDo }));
                }}
                tim={tim}
                disabled={dangLuu}
                invalid={loi.thamChieu}
              />

              <div>
                <label htmlFor="bs-ly-do" className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground">
                  <span>Lý do bổ sung</span>
                  <span className={cn("text-xs font-normal tabular-nums", soKyTu >= LY_DO_TOI_THIEU ? "text-state-success-ink" : "text-muted-foreground")}>
                    {soKyTu}/{LY_DO_TOI_THIEU} ký tự tối thiểu
                  </span>
                </label>
                <textarea
                  id="bs-ly-do"
                  value={lyDo}
                  onChange={(e) => {
                    setLyDo(e.target.value);
                    setLoi((l) => ({ ...l, lyDo: undefined }));
                  }}
                  disabled={dangLuu}
                  aria-invalid={loi.lyDo ? true : undefined}
                  aria-describedby={loi.lyDo ? "bs-ly-do-loi" : undefined}
                  placeholder="Căn cứ nào cho biết đây là Sale phụ trách? Ví dụ: hồ sơ ghi danh của bé anh/chị do chị Lan chốt."
                  className={TEXTAREA}
                />
                {loi.lyDo && (
                  <p id="bs-ly-do-loi" role="alert" className="mt-1 text-xs text-state-danger-ink">
                    {loi.lyDo}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">Lý do được lưu cùng tên bạn và giờ bổ sung trong nhật ký nguồn.</p>
              </div>
              {/* Nút submit ẩn để Enter ở ô lý do không cần chuột; nút thật nằm ở chân Sheet. */}
              <button type="submit" hidden tabIndex={-1} aria-hidden />
            </form>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-card p-4">
            <button type="button" onClick={() => setOpen(false)} className={cn(BTN_OUTLINE, NUT_CHAN)}>
              Huỷ
            </button>
            <button type="button" onClick={luu} disabled={dangLuu} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangLuu ? "Đang lưu…" : "Lưu Sale phụ trách"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
