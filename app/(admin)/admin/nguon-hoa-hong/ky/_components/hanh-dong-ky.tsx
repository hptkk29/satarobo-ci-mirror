"use client";

// app/(admin)/admin/nguon-hoa-hong/ky/_components/hanh-dong-ky.tsx — hàng nút theo VÒNG ĐỜI của kỳ (06 §5.4) + bốn hộp thoại xác nhận.
//
// Nút nào vẽ do `hanhDongCuaKy` (lib/hoa-hong/ky-man-hinh) quyết — hàm gọi CHÍNH cổng server `kiemChuyenTrangThaiKy`. Component này KHÔNG tự xét điều kiện:
// nhận `chinh` (nút của bước kế tiếp — duy nhất một), `phu` (nút phụ hợp lệ) và `khongVe` (nút chưa hợp lệ — chỉ in lý do, không vẽ nút xám bấm được).
// Không có nút nào bỏ qua cổng: thiếu dữ liệu thì phải xử lý, không "khoá bất chấp".
//
// Bốn hộp thoại đều NÊU HỆ QUẢ BẰNG SỐ trước khi bấm (khuôn LockDialog của chấm công):
//   · Khoá      — đọc lại ĐÚNG các con số của kỳ + hệ quả "hoàn tiền sau khi khoá sẽ ghi vào kỳ MM/YYYY" (H22). Server so bản chụp số này trước khi khoá.
//   · Xuất      — kỳ nào vào lô, kỳ nào KHÔNG; người có tổng âm xuất 0 và kết chuyển. Tệp chỉ trả về MỘT lần.
//   · Đã chi    — chọn lô, lý do.
//   · Trả lại   — lý do.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleAlert, Download, Info, Loader2, Lock, RotateCcw } from "lucide-react";

import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, TEXTAREA } from "@/components/admin/nguon-hoa-hong/classes";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import type { TrangThaiKy } from "@/lib/hoa-hong/ky-hoa-hong";
import { nhanHanhDong, type HanhDongKy, type KhongVe, type SoLieuKy } from "@/lib/hoa-hong/ky-man-hinh";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { chuyenRaSoatAction, danhDauDaChiAction, khoaKyAction, tinhKyAction, traLaiAction, xuatKyAction } from "../_actions";
import { taiTep, type TepXuat } from "./tai-tep";

export type PhamViXuatClient = { coSo: string; trangThai: TrangThaiKy; soDongNoiBo: number; tienNoiBo: number; soDongNgoai: number; tienNgoai: number };
export type LoChiClient = { id: string; kind: "PAYROLL" | "EXTERNAL_SETTLEMENT"; soDong: number; tongTien: number; taoLuc: string };

export type DuLieuHanhDong = {
  thang: string;
  thangNhan: string;
  centerId: string;
  coSoNhan: string;
  kyId: string | null;
  trangThai: TrangThaiKy | null;
  chinh: HanhDongKy | null;
  phu: HanhDongKy[];
  khongVe: KhongVe[];
  /** Bản chụp số liệu — thứ hộp thoại khoá đọc lại và server so. */
  soLieu: SoLieuKy;
  soChan: number;
  /** "11/2026" — kỳ mà dòng sinh ra SAU khi khoá sẽ rơi vào; null khi chưa biết. */
  kyGhiTiepNhan: string | null;
  phamViXuat: PhamViXuatClient[];
  soKyChuaKhoa: number;
  loChoChi: LoChiClient[];
};

type Hop = "TRA_LAI" | "KHOA" | "XUAT" | "XUAT_NGOAI" | "DA_CHI" | null;
type LoiHienThi = { loi: string; chiTiet?: string[] };

const NHAN_LO: Record<LoChiClient["kind"], string> = { PAYROLL: "Bảng lương (nội bộ)", EXTERNAL_SETTLEMENT: "Quyết toán người ngoài" };

export function HanhDongKy({ d }: { d: DuLieuHanhDong }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [viec, setViec] = useState<HanhDongKy | null>(null);
  const [hop, setHop] = useState<Hop>(null);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<LoiHienThi | null>(null);
  const [loChon, setLoChon] = useState<string>(d.loChoChi[0]?.id ?? "");
  const [tepDaXuat, setTepDaXuat] = useState<{ tep: TepXuat; tom: string; amKetChuyen: number } | null>(null);

  const dongHop = () => {
    if (dang) return;
    setHop(null);
    setLyDo("");
    setLoi(null);
    setTepDaXuat(null);
  };
  const moHop = (h: Exclude<Hop, null>) => {
    setLoi(null);
    setLyDo("");
    setTepDaXuat(null);
    setLoChon(d.loChoChi[0]?.id ?? "");
    setHop(h);
  };

  /**
   * Chạy một action, báo kết quả. Thành công ⇒ toast + làm mới trang (đóng hộp thoại trừ khi `giuHop`: lượt Xuất còn phải hiện nút tải tệp).
   * Thất bại ⇒ giữ nguyên mọi thứ, hiện lý do NGAY CẠNH nơi bấm: trong hộp thoại nếu bấm từ hộp thoại (`trongHop` — không toast chồng lên), còn không thì ở vùng
   * cảnh báo dưới hàng nút (kèm chi tiết) + toast.
   */
  function chay<T extends { ok: boolean }>(
    a: HanhDongKy,
    goi: () => Promise<T>,
    tuyChon: { trongHop?: boolean; giuHop?: boolean; khiXong?: (r: Extract<T, { ok: true }>) => void } = {},
  ) {
    setViec(a);
    setLoi(null);
    batDau(async () => {
      const r = (await goi()) as T & { thongBao?: string; loi?: string; chiTiet?: string[] };
      setViec(null);
      if (r.ok) {
        tuyChon.khiXong?.(r as Extract<T, { ok: true }>);
        toast.success(r.thongBao ?? "Đã xong");
        if (!tuyChon.giuHop) {
          setHop(null);
          setLyDo("");
        }
        router.refresh();
      } else {
        const l = { loi: r.loi ?? "Không thực hiện được.", chiTiet: r.chiTiet };
        setLoi(l);
        if (!tuyChon.trongHop) toast.error(l.loi);
      }
    });
  }

  const lyDoDu = lyDo.trim().length >= LY_DO_TOI_THIEU;
  const click = (a: HanhDongKy) => {
    switch (a) {
      case "TINH":
      case "TINH_LAI":
        return chay(a, () => tinhKyAction({ thang: d.thang, centerId: d.centerId }));
      case "CHUYEN_RA_SOAT":
        return chay(a, () => chuyenRaSoatAction({ periodId: d.kyId! }));
      case "TRA_LAI":
        return moHop("TRA_LAI");
      case "KHOA":
        return moHop("KHOA");
      case "XUAT_BANG_CHI":
        return moHop("XUAT");
      case "XUAT_QUYET_TOAN":
        return moHop("XUAT_NGOAI");
      case "DANH_DAU_DA_CHI":
        return moHop("DA_CHI");
    }
  };

  const hanhDong = [d.chinh, ...d.phu].filter((a): a is HanhDongKy => a !== null);
  const lyDoCaKy = d.khongVe.filter((k) => k.hanhDong === "TAT_CA");
  const lyDoNut = d.khongVe.filter((k) => k.hanhDong !== "TAT_CA");
  const nhanNut = (a: HanhDongKy) => nhanHanhDong(a, d.trangThai);
  const nutDangChay = (a: HanhDongKy) => dang && viec === a;

  return (
    <section aria-label="Thao tác với kỳ" className="mb-4">
      {hanhDong.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {hanhDong.map((a) => (
            <button
              key={a}
              type="button"
              data-hanh-dong={a}
              disabled={dang}
              onClick={() => click(a)}
              className={a === d.chinh ? BTN_PRIMARY : BTN_OUTLINE}
            >
              {nutDangChay(a) ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : a === "KHOA" ? <Lock aria-hidden className="h-4 w-4" /> : a === "TRA_LAI" ? <RotateCcw aria-hidden className="h-4 w-4" /> : null}
              {nutDangChay(a) && (a === "TINH" || a === "TINH_LAI") ? "Đang tính…" : nhanNut(a)}
            </button>
          ))}
        </div>
      )}

      {(lyDoCaKy.length > 0 || lyDoNut.length > 0) && (
        <ul className={cn("flex flex-col gap-1.5 text-sm text-muted-foreground", hanhDong.length > 0 && "mt-3")}>
          {[...lyDoCaKy, ...lyDoNut].map((k) => (
            <li key={`${k.hanhDong}:${k.lyDo}`} data-khong-ve={k.hanhDong} className="flex items-start gap-2">
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {k.hanhDong !== "TAT_CA" && <b className="font-semibold text-foreground">{nhanNut(k.hanhDong)}: </b>}
                {k.lyDo}
              </span>
            </li>
          ))}
        </ul>
      )}

      {loi && hop === null && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
          <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{loi.loi}</p>
            {loi.chiTiet && (
              <ul className="mt-1 list-disc pl-4">
                {loi.chiTiet.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Trả lại ──────────────────────────────────────────────────────────────── */}
      <Dialog open={hop === "TRA_LAI"} onOpenChange={(o) => !o && dongHop()}>
        <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trả kỳ {d.thangNhan} về “đã tính”?</DialogTitle>
            <DialogDescription>Kỳ rời trạng thái rà soát; Tính lại rồi chuyển rà soát lần nữa. Số đã ghi không mất.</DialogDescription>
          </DialogHeader>
          <TruongLyDo id="ly-do-tra-lai" nhan="Lý do trả lại" lyDo={lyDo} onLyDo={setLyDo} goiY="vd: có khoản thu mới sau lần Tính" loi={loi?.loi ?? null} />
          <DialogFooter>
            <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dongHop}>
              Quay lại
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={dang || !lyDoDu}
              onClick={() => chay("TRA_LAI", () => traLaiAction({ periodId: d.kyId!, lyDo }), { trongHop: true })}
            >
              {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              Trả lại để tính lại
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Khoá: đọc lại ĐÚNG các con số ────────────────────────────────────────── */}
      <Dialog open={hop === "KHOA"} onOpenChange={(o) => !o && dongHop()}>
        <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Khoá kỳ {d.thangNhan} — {d.coSoNhan}
            </DialogTitle>
            <DialogDescription>Khoá xong, số của kỳ này không đổi được từ màn nào nữa. Đọc lại các số dưới đây trước khi khoá.</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border/60 text-sm" data-so-lieu-khoa>
            <DongSo nhan="Tổng cơ sở tính" gia={dinhDangDong(d.soLieu.coSoTinh)} />
            <DongSo nhan="Tổng hoa hồng" gia={dinhDangDong(d.soLieu.hoaHong)} />
            <DongSo nhan="Tổng điều chỉnh" gia={dinhDangDong(d.soLieu.dieuChinh)} am={d.soLieu.dieuChinh < 0} />
            <DongSo nhan="Phải chi ròng" gia={dinhDangDong(d.soLieu.hoaHong + d.soLieu.dieuChinh)} dam />
            <DongSo nhan="Số người hưởng" gia={String(d.soLieu.soNguoi)} />
            <DongSo nhan="Hàng chờ chặn còn lại" gia={String(d.soChan)} />
          </dl>
          <p className="text-sm text-muted-foreground">
            Sau khi khoá, hoàn tiền hoặc điều chỉnh phát sinh cho tháng {d.thangNhan} sẽ ghi vào kỳ <b className="text-foreground">{d.kyGhiTiepNhan ?? "đang mở kế tiếp"}</b>; kỳ này giữ nguyên.
          </p>
          <TruongLyDo id="ly-do-khoa" nhan="Lý do khoá" lyDo={lyDo} onLyDo={setLyDo} goiY="vd: khoá sổ hoa hồng tháng 10 để chi lương" loi={loi?.loi ?? null} />
          <DialogFooter>
            <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dongHop}>
              Quay lại
            </button>
            <button
              type="button"
              data-xac-nhan="KHOA"
              className={BTN_PRIMARY}
              disabled={dang || !lyDoDu}
              onClick={() => chay("KHOA", () => khoaKyAction({ periodId: d.kyId!, lyDo, daThay: d.soLieu }), { trongHop: true })}
            >
              {dang ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Lock aria-hidden className="h-4 w-4" />}
              Khoá kỳ {d.thangNhan}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Xuất bảng chi (nội bộ · người ngoài) ─────────────────────────────────── */}
      {(["XUAT", "XUAT_NGOAI"] as const).map((loai) => {
        const ngoai = loai === "XUAT_NGOAI";
        const kind = ngoai ? "EXTERNAL_SETTLEMENT" : "PAYROLL";
        return (
          <Dialog key={loai} open={hop === loai} onOpenChange={(o) => !o && dongHop()}>
            <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
              {tepDaXuat ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Đã xuất {ngoai ? "bảng quyết toán" : "bảng chi"}</DialogTitle>
                    <DialogDescription>{tepDaXuat.tom}</DialogDescription>
                  </DialogHeader>
                  {tepDaXuat.amKetChuyen > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {tepDaXuat.amKetChuyen} người có tổng tháng âm: xuất 0 và kết chuyển phần âm sang tháng sau (HR xem ở hàng chờ “sổ âm kết chuyển”).
                    </p>
                  )}
                  <p className="flex items-start gap-2 text-sm text-state-warning-ink">
                    <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Tệp chỉ có ở lượt xuất này — hệ thống không xuất lại được những dòng đã vào lô. Tải về và lưu ngay.</span>
                  </p>
                  <DialogFooter>
                    <button type="button" className={BTN_OUTLINE} onClick={dongHop}>
                      Đóng
                    </button>
                    <button type="button" data-tai-tep className={BTN_PRIMARY} onClick={() => taiTep(tepDaXuat.tep)}>
                      <Download aria-hidden className="h-4 w-4" />
                      Tải {tepDaXuat.tep.tenTep}
                    </button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {ngoai ? "Xuất quyết toán người ngoài" : "Xuất bảng chi"} tháng {d.thangNhan}
                    </DialogTitle>
                    <DialogDescription>
                      {ngoai
                        ? "Lô riêng cho người không phải nhân viên (đối tác, phụ huynh giới thiệu); không vào bảng lương. Thuế khấu trừ chưa tính — xuất số gộp."
                        : "Bảng lương cho nhân viên nội bộ, kèm sheet chi tiết dòng sổ."}
                    </DialogDescription>
                  </DialogHeader>
                  <PhamViXuatKy ds={d.phamViXuat} soKyChuaKhoa={d.soKyChuaKhoa} ngoai={ngoai} />
                  <p className="text-sm text-muted-foreground">Người có tổng tháng âm được xuất 0 và kết chuyển phần âm sang tháng sau. Dòng đã vào lô không xuất lại được.</p>
                  <TruongLyDo id={`ly-do-${loai}`} nhan="Lý do xuất" lyDo={lyDo} onLyDo={setLyDo} goiY="vd: xuất bảng lương hoa hồng tháng 10" loi={loi?.loi ?? null} />
                  <DialogFooter>
                    <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dongHop}>
                      Quay lại
                    </button>
                    <button
                      type="button"
                      data-xac-nhan={loai}
                      className={BTN_PRIMARY}
                      disabled={dang || !lyDoDu}
                      onClick={() =>
                        chay(ngoai ? "XUAT_QUYET_TOAN" : "XUAT_BANG_CHI", () => xuatKyAction({ thang: d.thang, kind, lyDo }), {
                          trongHop: true,
                          giuHop: true,
                          khiXong: (r) => {
                            const x = r.xuat;
                            setTepDaXuat({ tep: x.tep, tom: `${x.soDong} dòng · tổng chi ${dinhDangDong(x.tongChi)}.`, amKetChuyen: x.amKetChuyen.length });
                            taiTep(x.tep);
                          },
                        })
                      }
                    >
                      {dang ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Download aria-hidden className="h-4 w-4" />}
                      Xuất {ngoai ? "quyết toán" : "bảng chi"}
                    </button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        );
      })}

      {/* ── Đánh dấu đã chi ──────────────────────────────────────────────────────── */}
      <Dialog open={hop === "DA_CHI"} onOpenChange={(o) => !o && dongHop()}>
        <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Đánh dấu đã chi — tháng {d.thangNhan}</DialogTitle>
            <DialogDescription>Chỉ bấm sau khi tiền đã thật sự chuyển. Đánh dấu rồi không hoàn tác được; kỳ sang “đã chi” khi mọi lô của kỳ đã chi.</DialogDescription>
          </DialogHeader>
          {d.loChoChi.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có lô nào đang chờ đánh dấu đã chi.</p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className={NHAN_O}>Lô đã chi</legend>
              {d.loChoChi.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name="lo-chi" value={l.id} checked={loChon === l.id} onChange={() => setLoChon(l.id)} className="mt-1" />
                  <span>
                    <b className="font-semibold">{NHAN_LO[l.kind]}</b> · {l.soDong} dòng · <span className="tabular-nums">{dinhDangDong(l.tongTien)}</span>
                    <span className="block text-xs text-muted-foreground">Xuất {l.taoLuc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <TruongLyDo id="ly-do-da-chi" nhan="Lý do / căn cứ đã chi" lyDo={lyDo} onLyDo={setLyDo} goiY="vd: đã chuyển khoản bảng lương ngày 25/11" loi={loi?.loi ?? null} />
          <DialogFooter>
            <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={dongHop}>
              Quay lại
            </button>
            <button
              type="button"
              data-xac-nhan="DA_CHI"
              className={BTN_PRIMARY}
              disabled={dang || !lyDoDu || loChon === ""}
              onClick={() => chay("DANH_DAU_DA_CHI", () => danhDauDaChiAction({ batchId: loChon, lyDo }), { trongHop: true })}
            >
              {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              Đánh dấu đã chi
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Mảnh nhỏ ─────────────────────────────────────────────────────────────────────────────────────────

function DongSo({ nhan, gia, am, dam }: { nhan: string; gia: string; am?: boolean; dam?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className={cn("whitespace-nowrap tabular-nums", dam ? "text-lg font-semibold text-foreground" : "font-medium text-foreground", am && "text-state-danger-ink")}>{gia}</dd>
    </div>
  );
}

function PhamViXuatKy({ ds, soKyChuaKhoa, ngoai }: { ds: PhamViXuatClient[]; soKyChuaKhoa: number; ngoai: boolean }) {
  const dong = ds.map((p) => ({ ...p, so: ngoai ? p.soDongNgoai : p.soDongNoiBo, tien: ngoai ? p.tienNgoai : p.tienNoiBo }));
  return (
    <div className="text-sm">
      <p className="mb-1.5 font-semibold text-foreground">Vào lô này: các kỳ đã khoá của tháng mà bạn quản lý</p>
      {dong.length === 0 ? (
        <p className="text-muted-foreground">Chưa có kỳ nào đã khoá.</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {dong.map((p) => (
            <li key={p.coSo} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span>
                <b className="font-semibold">{p.coSo}</b> <span className="text-muted-foreground">· {p.trangThai === "LOCKED" ? "đã khoá" : "đã xuất lô khác"}</span>
              </span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                {p.so} dòng chưa vào lô · {dinhDangDong(p.tien)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {soKyChuaKhoa > 0 && (
        <p className="mt-2 text-state-warning-ink">
          {soKyChuaKhoa} kỳ khác của tháng chưa khoá — KHÔNG vào lô này. Khoá xong rồi xuất tiếp.
        </p>
      )}
    </div>
  );
}

function TruongLyDo({ id, nhan, lyDo, onLyDo, goiY, loi }: { id: string; nhan: string; lyDo: string; onLyDo: (v: string) => void; goiY: string; loi: string | null }) {
  const ngan = lyDo.trim().length < LY_DO_TOI_THIEU;
  return (
    <div>
      <label htmlFor={id} className={NHAN_O}>
        {nhan} <span className="text-state-danger-ink">*</span>
      </label>
      <textarea
        id={id}
        value={lyDo}
        onChange={(e) => onLyDo(e.target.value)}
        rows={2}
        maxLength={1000}
        aria-invalid={loi ? true : undefined}
        aria-describedby={`${id}-ghichu`}
        placeholder={goiY}
        className={TEXTAREA}
      />
      <p id={`${id}-ghichu`} className={cn("mt-1 text-xs", ngan && lyDo.length > 0 ? "text-state-danger-ink" : "text-muted-foreground")}>
        Từ {LY_DO_TOI_THIEU} ký tự — ghi vào nhật ký kiểm toán.
      </p>
      {loi && (
        <p role="alert" className={LOI_O}>
          {loi}
        </p>
      )}
    </div>
  );
}
