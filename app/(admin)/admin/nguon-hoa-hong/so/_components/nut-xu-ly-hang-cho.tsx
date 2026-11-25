"use client";

// app/(admin)/admin/nguon-hoa-hong/so/_components/nut-xu-ly-hang-cho.tsx — nút «Xử lý» ở MỘT dòng hàng chờ `INPUT_DRIFT` / `PAYMENT_WITHDRAWN` (tab Sổ, R9 · T1) + hộp thoại xử lý.
//
// Hộp thoại KHÔNG tự xét cái gì được/không được: khi mở nó xin server một bản XEM TRƯỚC (`xemTruocHangChoAction` — chạy đúng các cổng của «Giải phóng» rồi dừng trước phép ghi đầu tiên)
// và vẽ theo đó (luật 12: không vẽ nút chắc chắn bị từ chối). Mọi quyết định thật vẫn kiểm lại ở server; số tiền in ở đây chỉ là TRẦN gửi lên (`tienDaThay`).
//
// Bốn lựa chọn: Xem (chính hộp thoại — chênh lệch từng người) · Giải phóng · Từ chối (giữ nguyên) · Chuyển xem tay. Số tiền từ ngưỡng ⇒ hai người: nút gửi đổi nhãn theo bước
// (lập đề nghị → người KHÁC duyệt), và người đề nghị KHÔNG thấy nút duyệt cho chính đề nghị của mình.
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, TEXTAREA } from "@/components/admin/nguon-hoa-hong/classes";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { BANG_CHUNG_TOI_THIEU } from "@/lib/hoa-hong/hang-cho-xu-ly";
import type { XemTruocView } from "@/lib/hoa-hong/hang-cho-xu-ly-hanh-dong";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { chuyenXemTayHangChoAction, deNghiHangChoAction, quyetHangChoAction, xemTruocHangChoAction } from "../_actions-hang-cho";

const NUT_NHO =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

type Chon = "AP_DUNG" | "GIU_NGUYEN" | "XEM_TAY";

const NHAN_CHON: Record<Chon, { ten: string; mota: string }> = {
  AP_DUNG: { ten: "Giải phóng", mota: "Áp dụng điều chỉnh: ghi dòng điều chỉnh MỚI vào sổ (sổ cũ không bị sửa)." },
  GIU_NGUYEN: { ten: "Từ chối", mota: "Giữ nguyên số đã tính: đóng hàng chờ, không ghi dòng nào." },
  XEM_TAY: { ten: "Chuyển xem tay", mota: "Chưa quyết: đánh dấu cho người có thẩm quyền xem. Hàng chờ vẫn mở và vẫn chặn khoá kỳ." },
};

/** Khoá người hưởng `vai|loại|id` → «vai · …id» đủ để phân biệt, không in cả id nội bộ. */
function nhanNguoi(khoa: string): string {
  const [vai, , id] = khoa.split("|");
  return `${vai ?? "?"}${id && id !== "-" ? ` · …${id.slice(-6)}` : ""}`;
}

export function NutXuLyHangCho({
  holdId,
  tenMa,
  lyDoHold,
  tienAnhHuong,
  choPhep,
}: {
  holdId: string;
  tenMa: string;
  lyDoHold: string;
  tienAnhHuong: number | null;
  /** Cổng TĨNH từ `huongXuLy` (cùng hàm server kiểm). BẮT BUỘC, không mặc định (luật 11). */
  choPhep: { giaiPhong: boolean; tuChoi: boolean; chuyenXemTay: boolean };
}) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [xem, setXem] = useState<XemTruocView | null>(null);
  const [loiXem, setLoiXem] = useState<string | null>(null);
  const [chon, setChon] = useState<Chon | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [bangChung, setBangChung] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dang, batDau] = useTransition();
  const id = useId();

  // XIN xem trước ngay trong trình xử lý bấm (không `useEffect` — luật «không fetch bằng effect»); `luot` loại bỏ kết quả của lượt mở CŨ nếu người dùng đóng–mở nhanh.
  const luot = useRef(0);
  const moHop = () => {
    const mine = (luot.current += 1);
    setMo(true);
    setXem(null);
    setLoiXem(null);
    void (async () => {
      const r = await xemTruocHangChoAction({ holdId });
      if (luot.current !== mine) return;
      if (r.ok) setXem(r.xem);
      else setLoiXem(r.loi);
    })();
  };

  const dong = () => {
    if (dang) return;
    luot.current += 1;
    setMo(false);
    setChon(null);
    setLyDo("");
    setBangChung("");
    setLoi(null);
  };

  const duLyDo = lyDo.trim().length >= LY_DO_TOI_THIEU;
  const duBangChung = bangChung.trim().length >= BANG_CHUNG_TOI_THIEU;
  const giaiPhongDuoc = choPhep.giaiPhong && xem?.giaiPhong.ok === true;
  const lyDoKhongGiai = !choPhep.giaiPhong ? "Hàng chờ này không giải phóng được." : xem && !xem.giaiPhong.ok ? xem.giaiPhong.loi : null;

  // Bước nộp: dưới ngưỡng ⇒ quyết thẳng · từ ngưỡng ⇒ (chưa có đề nghị) lập đề nghị | (đề nghị cùng chiều của người KHÁC, còn đủ trần) duyệt | (của chính mình, còn đủ trần) chờ.
  // Đề nghị hiện có KHÁC chiều, hoặc số tiền đã TĂNG vượt trần của nó ⇒ ai cũng LẬP LẠI được (đề nghị mới nhất thắng) — không để hai người kẹt nhìn nhau (reviewer 14/10/2026).
  const quyetDinh = chon === "AP_DUNG" || chon === "GIU_NGUYEN" ? chon : null;
  const buoc: "QUYET" | "DE_NGHI" | "DE_NGHI_LAI" | "DUYET" | "CHO_NGUOI_KHAC" | null = (() => {
    if (!xem || !quyetDinh) return null;
    if (xem.cap === "MOT_CAP") return "QUYET";
    if (!xem.deNghi) return "DE_NGHI";
    if (xem.deNghi.quyetDinh !== quyetDinh) return "DE_NGHI_LAI";
    if (quyetDinh === "AP_DUNG" && xem.giaiPhong.ok && xem.giaiPhong.tongTuyetDoi > xem.deNghi.tien) return "DE_NGHI_LAI";
    return xem.laNguoiDeNghi ? "CHO_NGUOI_KHAC" : "DUYET";
  })();

  const gui = () => {
    if (!chon) return;
    setLoi(null);
    batDau(async () => {
      let r: { ok: true; thongBao: string } | { ok: false; loi: string };
      if (chon === "XEM_TAY") r = await chuyenXemTayHangChoAction({ holdId, lyDo });
      else if (buoc === "DE_NGHI" || buoc === "DE_NGHI_LAI") r = await deNghiHangChoAction({ holdId, quyetDinh: chon, lyDo, bangChung });
      else r = await quyetHangChoAction({ holdId, quyetDinh: chon, lyDo, bangChung, tienDaThay: xem?.giaiPhong.ok ? xem.giaiPhong.tongTuyetDoi : (xem?.tien ?? 0) });
      if (r.ok) {
        toast.success(r.thongBao);
        setMo(false);
        setChon(null);
        setLyDo("");
        setBangChung("");
        router.refresh();
      } else setLoi(r.loi);
    });
  };

  const nhanNutGui =
    chon === "XEM_TAY"
      ? "Chuyển xem tay"
      : buoc === "DE_NGHI"
        ? "Lập đề nghị (chờ người khác duyệt)"
        : buoc === "DE_NGHI_LAI"
          ? "Lập lại đề nghị (chờ người khác duyệt)"
          : buoc === "DUYET"
          ? `Duyệt cấp 2 và ${chon === "AP_DUNG" ? "giải phóng" : "từ chối"}`
          : chon === "AP_DUNG"
            ? "Giải phóng"
            : "Từ chối (giữ nguyên)";
  const khongGui =
    dang ||
    !chon ||
    !duLyDo ||
    (chon !== "XEM_TAY" && !duBangChung) ||
    (chon === "XEM_TAY" ? !choPhep.chuyenXemTay : !xem || buoc === "CHO_NGUOI_KHAC" || (chon === "AP_DUNG" && !giaiPhongDuoc) || (chon === "GIU_NGUYEN" && !choPhep.tuChoi));

  return (
    <>
      <button type="button" data-xu-ly-hang-cho={holdId} className={NUT_NHO} onClick={moHop}>
        <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
        Xử lý
      </button>
      <Dialog open={mo} onOpenChange={(o) => !o && dong()}>
        <DialogContent showCloseButton={false} className="admin-scope max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Xử lý hàng chờ “{tenMa}”</DialogTitle>
            <DialogDescription>
              {lyDoHold}
              {tienAnhHuong !== null && <b className="mt-1 block tabular-nums text-foreground">Tiền bị ảnh hưởng: {dinhDangDong(tienAnhHuong)}</b>}
            </DialogDescription>
          </DialogHeader>

          {!xem && !loiXem && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Đang kiểm các cổng và dựng chênh lệch…
            </p>
          )}
          {loiXem && (
            <p role="alert" className={LOI_O}>
              {loiXem}
            </p>
          )}

          {xem && (
            <div className="space-y-3 text-sm" data-xem-truoc={xem.holdId}>
              {xem.giaiPhong.ok ? (
                <div className="rounded-lg border border-border">
                  <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold">Nếu giải phóng bây giờ</p>
                  {xem.giaiPhong.chenh.length === 0 ? (
                    <p className="px-3 py-2 text-muted-foreground">Không còn chênh lệch — hàng chờ chỉ được đóng, không ghi dòng nào.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {xem.giaiPhong.chenh.map((c) => (
                        <li key={c.khoa} className="flex justify-between gap-3 px-3 py-1.5">
                          <span>{nhanNguoi(c.khoa)}</span>
                          <span className={cn("tabular-nums", c.chenh < 0 && "text-state-danger-ink")}>
                            {c.chenh > 0 ? "+" : ""}
                            {dinhDangDong(c.chenh)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                    Tổng tuyệt đối <b className="tabular-nums text-foreground">{dinhDangDong(xem.giaiPhong.tongTuyetDoi)}</b> · ròng <span className="tabular-nums">{dinhDangDong(xem.giaiPhong.tongRong)}</span> · ghi vào kỳ {xem.giaiPhong.kyDuKien}
                  </p>
                </div>
              ) : (
                <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2" data-khong-giai-phong="">
                  <b>Chưa giải phóng được:</b> {lyDoKhongGiai}
                </p>
              )}

              <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs" data-cap-duyet={xem.cap}>
                {xem.chuCap}
              </p>
              {xem.deNghi && (
                <p className="rounded-lg border border-border px-3 py-2 text-xs" data-co-de-nghi="">
                  <b>Đề nghị cấp 1</b> ({xem.deNghi.quyetDinh === "AP_DUNG" ? "Giải phóng" : "Từ chối"}) bởi {xem.deNghi.tenNguoi}, {ngayGioVN(new Date(xem.deNghi.luc))}: {xem.deNghi.lyDo}
                  {xem.laNguoiDeNghi && <span className="mt-1 block font-semibold">Đây là đề nghị của chính bạn — cần một người KHÁC duyệt.</span>}
                </p>
              )}
              {xem.xemTay && (
                <p className="rounded-lg border border-border px-3 py-2 text-xs">
                  <b>Đã chuyển xem tay</b> bởi {xem.xemTay.tenNguoi}, {ngayGioVN(new Date(xem.xemTay.luc))}: {xem.xemTay.lyDo}
                </p>
              )}

              <fieldset className="space-y-1.5">
                <legend className={NHAN_O}>Cách xử lý</legend>
                {(["AP_DUNG", "GIU_NGUYEN", "XEM_TAY"] as const).map((c) => {
                  const duoc = c === "AP_DUNG" ? giaiPhongDuoc : c === "GIU_NGUYEN" ? choPhep.tuChoi : choPhep.chuyenXemTay;
                  return (
                    <label key={c} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2", !duoc && "cursor-not-allowed opacity-50")}>
                      <input type="radio" name={`${id}-chon`} value={c} disabled={!duoc} checked={chon === c} onChange={() => setChon(c)} className="mt-0.5" data-chon={c} />
                      <span>
                        <b>{NHAN_CHON[c].ten}</b>
                        <span className="block text-xs text-muted-foreground">{NHAN_CHON[c].mota}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {chon && (
                <div className="space-y-2">
                  <div>
                    <label htmlFor={`${id}-ly-do`} className={NHAN_O}>
                      Lý do <span className="text-state-danger-ink">*</span>
                    </label>
                    <textarea id={`${id}-ly-do`} value={lyDo} onChange={(e) => setLyDo(e.target.value)} rows={2} maxLength={1000} className={TEXTAREA} placeholder="vd: kế toán đã xác nhận lại khoản thu, giữ hoa hồng" />
                    <p className={cn("mt-1 text-xs", !duLyDo && lyDo.length > 0 ? "text-state-danger-ink" : "text-muted-foreground")}>Từ {LY_DO_TOI_THIEU} ký tự — ghi vào nhật ký kiểm toán.</p>
                  </div>
                  {chon !== "XEM_TAY" && (
                    <div>
                      <label htmlFor={`${id}-bang-chung`} className={NHAN_O}>
                        Bằng chứng <span className="text-state-danger-ink">*</span>
                      </label>
                      <textarea id={`${id}-bang-chung`} value={bangChung} onChange={(e) => setBangChung(e.target.value)} rows={2} maxLength={500} className={TEXTAREA} placeholder="vd: mã phiếu thu PT-2026-1234, tin nhắn kế toán 14/10, biên bản…" />
                      <p className={cn("mt-1 text-xs", !duBangChung && bangChung.length > 0 ? "text-state-danger-ink" : "text-muted-foreground")}>Từ {BANG_CHUNG_TOI_THIEU} ký tự — để người sau kiểm lại được.</p>
                    </div>
                  )}
                  {buoc === "CHO_NGUOI_KHAC" && <p className="text-xs font-semibold">Bạn đã lập đề nghị — chờ người KHÁC duyệt; không tự duyệt được.</p>}
                  {buoc === "DE_NGHI_LAI" && (
                    <p className="text-xs font-semibold" data-de-nghi-lai="">
                      {xem?.deNghi?.quyetDinh !== quyetDinh ? "Đề nghị hiện có là chiều khác — bạn lập đề nghị theo chiều bạn chọn (đề nghị mới nhất thắng)." : "Số tiền đã TĂNG so với đề nghị cấp 1 — đề nghị cũ không còn đủ trần để duyệt; lập lại đề nghị."}
                    </p>
                  )}
                </div>
              )}
              {loi && (
                <p role="alert" className={LOI_O}>
                  {loi}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dong}>
              Đóng
            </button>
            <button type="button" data-xac-nhan="XU_LY_HANG_CHO" className={BTN_PRIMARY} disabled={khongGui} onClick={gui}>
              {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {chon ? nhanNutGui : "Chọn cách xử lý"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
