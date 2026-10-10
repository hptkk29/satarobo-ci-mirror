"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { ChuThich } from "@/components/admin/ui/chu-thich";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  CHINH_SACH_MAC_DINH,
  KHI_NAO_CHI,
  KIEU_TINH,
  kiemChinhSach,
  LOAI_DON,
  NHAN_KIEU_TINH,
  NHAN_LOAI_DON,
  NHAN_SU_KIEN,
  SU_KIEN,
  tongCuaChinhSach,
  tongTiLeTheoSuKien,
  type ChinhSachHoaHong,
  type KieuTinhHoaHong,
  type LoaiDonHoaHong,
  type SuKienHoaHong,
} from "@/lib/crm/chinh-sach-hoa-hong";
import type { VaiNhanHoaHong } from "@/lib/crm/vai-nhan-hoa-hong";

import { luuChinhSachHoaHongAction } from "../actions";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const pct = (n: number) => `${Number((n * 100).toFixed(4))}%`;

const O =
  "min-h-11 w-full rounded-lg border border-border bg-background px-2.5 text-sm transition-colors duration-150 focus:border-primary focus:outline-none";


type Nhap = { cs: ChinhSachHoaHong; moi: boolean };

/**
 * CHÍNH SÁCH HOA HỒNG — mỗi thẻ là MỘT quyết định, không phải một khoản lẻ.
 *
 * ⚠️ Bản đầu (14/09 sáng) để mỗi dòng là một cặp (vai × tỉ lệ), nên riêng "học viên mới"
 * thành NĂM dòng trông như năm chính sách khác nhau. Chủ dự án: "có thể gom thành 1 hàng
 * tên chính sách khi có học viên mới: trần chính sách bao nhiêu %, loại đơn, các vai nhận,
 * cách tính, nguồn, nút sửa". Nay danh sách chỉ ĐỌC; mọi thao tác khai nằm trong hộp thoại.
 *
 * ⚠️ Vai hiện bằng TÊN TIẾNG VIỆT. Mã (`HO_SALE_ADMIN`) chỉ là khoá lưu trữ — in nó lên
 * màn là bắt người vận hành đọc tên biến.
 *
 * ⚠️ KHÔNG dùng `<table>`: tám cột thì ở 320px phải cuộn ngang, còn ở 8K thì một dòng kéo
 * dài 3000px và mắt phải quét cả màn hình cho MỘT chính sách. Lưới thẻ đọc được ở mọi bề
 * ngang và nở thêm CỘT khi màn rộng ra, đúng hướng mà `7b7f65b8` đã chốt cho trang này.
 */
export function BangChinhSachHoaHong({
  banDau,
  tranTongTiLe,
  vai,
  suaDuoc,
}: {
  banDau: ChinhSachHoaHong[];
  /** `crm.commissionMaxTotalRate` — trần áp cho TỪNG rổ (sự kiện × loại đơn). */
  tranTongTiLe: number;
  /** Toàn bộ vai trong hệ thống, kèm tên tiếng Việt. */
  vai: VaiNhanHoaHong[];
  suaDuoc: boolean;
}) {
  const [ds, setDs] = useState<ChinhSachHoaHong[]>(banDau);
  const [lyDo, setLyDo] = useState("");
  const [nhap, setNhap] = useState<Nhap | null>(null);
  const [xoaMa, setXoaMa] = useState<string | null>(null);
  const [dangChay, start] = useTransition();

  const tenVai = useMemo(() => new Map(vai.map((v) => [v.ma, v.ten])), [vai]);
  const nhanVai = (ma: string) => tenVai.get(ma) ?? ma;

  const loi = useMemo(() => kiemChinhSach(ds, { tranTongTiLe }), [ds, tranTongTiLe]);
  const doiKhac = useMemo(() => JSON.stringify(ds) !== JSON.stringify(banDau), [ds, banDau]);

  /**
   * Tổng theo TỪNG RỔ, và mỗi ô nói đúng về CHÍNH NÓ.
   *
   * ⚠️ Bản đầu in cả bốn ô đều ghi "đơn khoá học · trần 9%" — kể cả rổ Bán thiết bị vốn
   * không có chính sách phần trăm nào, nên con số 0% + "trần 9%" là một câu vô nghĩa.
   * Chủ dự án bắt được: "đang lỗi là tất cả đều để đơn khoá học trần 9%".
   */
  const ro = useMemo(
    () =>
      Object.values(SU_KIEN).map((sk) => {
        const cs = ds.filter((c) => c.bat && c.suKien === sk);
        const loaiCo = [...new Set(cs.map((c) => c.loaiDon))];
        const loaiChinh: LoaiDonHoaHong =
          loaiCo.length === 1 ? loaiCo[0]! : loaiCo.includes("COURSE") ? "COURSE" : "TAT_CA";
        return {
          suKien: sk,
          soChinhSach: cs.length,
          loaiDon: loaiChinh,
          tiLe: tongTiLeTheoSuKien(ds, sk, loaiChinh),
          coPhanTram: cs.some((c) => c.kieuTinh === KIEU_TINH.PHAN_TRAM),
          coSoTien: cs.some((c) => c.kieuTinh === KIEU_TINH.SO_TIEN_CO_DINH),
        };
      }),
    [ds],
  );

  /** Tên → mã. Trùng thì thêm hậu tố số. Người vận hành không phải nghĩ về mã. */
  function sinhMa(ten: string, daCo: Set<string>): string {
    const goc =
      ten
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/gi, "d")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "CHINH_SACH";
    if (!daCo.has(goc)) return goc;
    for (let i = 2; i < 999; i++) if (!daCo.has(`${goc}_${i}`)) return `${goc}_${i}`;
    return `${goc}_X`;
  }

  function moThem() {
    setNhap({
      moi: true,
      cs: {
        ma: "",
        ten: "",
        suKien: "HOC_VIEN_MOI",
        loaiDon: "COURSE",
        kieuTinh: "PHAN_TRAM",
        khoan: [],
        nguon: "",
        ghiChu: "",
        bat: false,
      },
    });
  }

  function luuHopThoai() {
    if (!nhap) return;
    const khac = new Set(ds.filter((c) => c.ma !== nhap.cs.ma).map((c) => c.ma));
    const ma = nhap.cs.ma?.trim() || sinhMa(nhap.cs.ten, khac);
    const moi = { ...nhap.cs, ma };
    setDs((c) => (nhap.moi ? [...c, moi] : c.map((x) => (x.ma === nhap.cs.ma ? moi : x))));
    setNhap(null);
  }

  function luu() {
    start(async () => {
      const r = await luuChinhSachHoaHongAction({ chinhSach: ds, lyDo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã lưu ${ds.length} chính sách hoa hồng`);
      setLyDo("");
    });
  }

  return (
    <section className="space-y-4">
      {/* Ở 320px là MỘT cột: ép hai cột rồi bóp số tiền 9 chữ số xuống nửa ô là mất số. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ro.map((r) => {
          const vuot = r.tiLe > tranTongTiLe + 1e-9;
          return (
            <div
              key={r.suKien}
              className={`min-w-0 rounded-xl border px-4 py-3 ${
                vuot ? "border-state-danger bg-state-danger-soft" : "border-border bg-card"
              }`}
            >
              <p className="flex min-w-0 items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="truncate">{NHAN_SU_KIEN[r.suKien]}</span>
                <ChuThich
                  nhan={`Khoản ${NHAN_SU_KIEN[r.suKien]} chi khi nào`}
                  noiDung={KHI_NAO_CHI[r.suKien]}
                />
              </p>
              {r.soChinhSach === 0 ? (
                <>
                  <p className="mt-1 truncate text-lg font-bold text-muted-foreground">—</p>
                  <p className="truncate text-xs text-muted-foreground">Chưa có chính sách nào</p>
                </>
              ) : (
                <>
                  <p
                    className={`mt-1 truncate text-xl font-bold tabular-nums ${
                      vuot ? "text-state-danger-ink" : "text-foreground"
                    }`}
                  >
                    {r.coPhanTram ? pct(r.tiLe) : r.coSoTien ? "Số tiền cố định" : "Thưởng bậc"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.soChinhSach} chính sách · {NHAN_LOAI_DON[r.loaiDon].toLowerCase()}
                    {r.coPhanTram ? ` · trần ${pct(tranTongTiLe)}` : ""}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      {loi.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3"
        >
          <p className="flex items-start gap-2 text-xs font-semibold text-state-danger-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Chưa lưu được — {loi.length} lỗi:
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-xs leading-relaxed text-state-danger-ink">
            {loi.map((l) => (
              <li key={l} className="list-disc">
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ds.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
          <p className="text-sm font-medium text-foreground">Chưa có chính sách hoa hồng nào</p>
          <p className="mx-auto mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Không chính sách nào nghĩa là{" "}
            <b className="font-semibold">hệ thống không chi hoa hồng cho ai</b>. Đó là một lựa
            chọn hợp lệ — nhưng nếu không cố ý thì nạp lại bộ theo công văn SR.QD.208.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2 min-[2200px]:grid-cols-3">
          {ds.map((c) => {
            const tong = tongCuaChinhSach(c);
            return (
              <li
                key={c.ma}
                className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 ${
                  c.bat ? "border-border" : "border-dashed border-border opacity-70"
                }`}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground">
                      <span className="truncate">{c.ten || "(chưa đặt tên)"}</span>
                      {c.ghiChu && <ChuThich nhan={`Giải thích: ${c.ten}`} noiDung={c.ghiChu} />}
                    </h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{NHAN_SU_KIEN[c.suKien]}</span>
                      <span aria-hidden>·</span>
                      <span>{NHAN_LOAI_DON[c.loaiDon]}</span>
                      {!c.bat && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-semibold text-state-warning-ink">Đang tắt</span>
                        </>
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="block whitespace-nowrap text-lg font-bold tabular-nums text-foreground">
                      {c.kieuTinh === KIEU_TINH.PHAN_TRAM
                        ? pct(tong)
                        : c.kieuTinh === KIEU_TINH.SO_TIEN_CO_DINH
                          ? vnd(tong)
                          : `${(c.bac ?? []).length} bậc`}
                    </span>
                    <span className="block whitespace-nowrap text-xs text-muted-foreground">
                      {NHAN_KIEU_TINH[c.kieuTinh]}
                    </span>
                  </p>
                </div>

                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {(c.khoan ?? []).length === 0 ? (
                    <span className="text-xs text-state-danger-ink">Chưa chọn vai nhận</span>
                  ) : (
                    (c.khoan ?? []).map((k) => (
                      <span
                        key={k.vaiNhan}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                      >
                        <span className="truncate">{nhanVai(k.vaiNhan)}</span>
                        {c.kieuTinh !== KIEU_TINH.THUONG_THEO_BAC && (
                          <b className="shrink-0 font-semibold tabular-nums text-foreground">
                            {c.kieuTinh === KIEU_TINH.PHAN_TRAM ? pct(k.giaTri) : vnd(k.giaTri)}
                          </b>
                        )}
                      </span>
                    ))
                  )}
                </div>

                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {c.nguon || "Chưa ghi nguồn"}
                  </p>
                  {suaDuoc && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setNhap({ cs: structuredClone(c), moi: false })}
                        className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors duration-150 hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => setXoaMa(c.ma)}
                        aria-label={`Xoá chính sách ${c.ten}`}
                        className="inline-flex min-h-9 items-center rounded-md border border-border bg-background px-2.5 text-state-danger-ink transition-colors duration-150 hover:bg-state-danger-soft"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {suaDuoc && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={moThem} className="min-h-11">
            <Plus className="h-4 w-4" aria-hidden />
            Thêm chính sách
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDs(structuredClone(CHINH_SACH_MAC_DINH))}
            className="min-h-11"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Nạp lại bộ theo công văn
          </Button>
          <Input
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            placeholder="Lý do thay đổi (bắt buộc)"
            aria-label="Lý do thay đổi"
            className="min-w-0 flex-1 sm:max-w-sm"
          />
          <Button
            type="button"
            onClick={luu}
            disabled={dangChay || loi.length > 0 || lyDo.trim().length < 5 || !doiKhac}
            className="min-h-11"
          >
            {dangChay ? "Đang lưu…" : "Lưu chính sách"}
          </Button>
          {!doiKhac && <span className="text-xs text-muted-foreground">Chưa có thay đổi nào.</span>}
        </div>
      )}

      <HopThoaiSua
        nhap={nhap}
        vai={vai}
        onDong={() => setNhap(null)}
        onDoi={(cs) => setNhap((n) => (n ? { ...n, cs } : n))}
        onLuu={luuHopThoai}
      />

      <Dialog open={xoaMa != null} onOpenChange={(o) => !o && setXoaMa(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xoá chính sách này?</DialogTitle>
            <DialogDescription>{ds.find((c) => c.ma === xoaMa)?.ten}</DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Xoá xong vẫn phải bấm <b className="font-semibold text-foreground">Lưu chính sách</b>{" "}
            thì mới có hiệu lực. Dòng hoa hồng đã sinh trước đó{" "}
            <b className="font-semibold text-foreground">không bị ảnh hưởng</b> — xoá chính sách
            chỉ dừng việc chi từ đây về sau.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setXoaMa(null)}>
              Huỷ
            </Button>
            <Button
              type="button"
              onClick={() => {
                setDs((c) => c.filter((x) => x.ma !== xoaMa));
                setXoaMa(null);
              }}
            >
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Hộp thoại khai chi tiết một chính sách. Tách hàm để phần danh sách ở trên chỉ còn việc ĐỌC. */
function HopThoaiSua({
  nhap,
  vai,
  onDong,
  onDoi,
  onLuu,
}: {
  nhap: Nhap | null;
  vai: VaiNhanHoaHong[];
  onDong: () => void;
  onDoi: (cs: ChinhSachHoaHong) => void;
  onLuu: () => void;
}) {
  const cs = nhap?.cs;
  const daChon = new Set((cs?.khoan ?? []).map((k) => k.vaiNhan));
  const conLai = vai.filter((v) => !daChon.has(v.ma));
  const tenVai = new Map(vai.map((v) => [v.ma, v.ten]));

  function doi(va: Partial<ChinhSachHoaHong>) {
    if (cs) onDoi({ ...cs, ...va });
  }
  function doiKhoan(vaiNhan: string, giaTri: number) {
    if (cs) doi({ khoan: cs.khoan.map((k) => (k.vaiNhan === vaiNhan ? { ...k, giaTri } : k)) });
  }

  const hopLe =
    !!cs?.ten?.trim() && (cs.kieuTinh === KIEU_TINH.THUONG_THEO_BAC || cs.khoan.length > 0);

  return (
    <Dialog open={nhap != null} onOpenChange={(o) => !o && onDong()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{nhap?.moi ? "Thêm chính sách hoa hồng" : "Sửa chính sách"}</DialogTitle>
          <DialogDescription>
            Khai theo bốn trục: chi khi nào · cho loại đơn nào · tính thế nào · ai nhận bao nhiêu.
          </DialogDescription>
        </DialogHeader>

        {cs && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cs-ten">Tên chính sách</Label>
              <Input
                id="cs-ten"
                value={cs.ten}
                onChange={(e) => doi({ ten: e.target.value })}
                placeholder="Ví dụ: Hoa hồng học viên mới"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="cs-su-kien">Chi khi nào</Label>
                <select
                  id="cs-su-kien"
                  className={O}
                  value={cs.suKien}
                  onChange={(e) => doi({ suKien: e.target.value as SuKienHoaHong })}
                >
                  {Object.values(SU_KIEN).map((k) => (
                    <option key={k} value={k}>
                      {NHAN_SU_KIEN[k]}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {KHI_NAO_CHI[cs.suKien]}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-loai-don">Loại đơn</Label>
                <select
                  id="cs-loai-don"
                  className={O}
                  value={cs.loaiDon}
                  onChange={(e) => doi({ loaiDon: e.target.value as LoaiDonHoaHong })}
                >
                  {Object.values(LOAI_DON).map((k) => (
                    <option key={k} value={k}>
                      {NHAN_LOAI_DON[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-kieu">Cách tính</Label>
                <select
                  id="cs-kieu"
                  className={O}
                  value={cs.kieuTinh}
                  onChange={(e) => doi({ kieuTinh: e.target.value as KieuTinhHoaHong })}
                >
                  {Object.values(KIEU_TINH).map((k) => (
                    <option key={k} value={k}>
                      {NHAN_KIEU_TINH[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <Label>Ai nhận, nhận bao nhiêu</Label>
              {cs.khoan.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Chưa chọn vai nào. Một chính sách không có người nhận thì không chi cho ai.
                </p>
              )}
              <ul className="space-y-2">
                {cs.khoan.map((k) => (
                  <li key={k.vaiNhan} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {tenVai.get(k.vaiNhan) ?? k.vaiNhan}
                    </span>
                    {cs.kieuTinh === KIEU_TINH.PHAN_TRAM ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          max={100}
                          // Người khai gõ theo PHẦN TRĂM (4), lưu theo tỉ lệ (0,04). Bắt gõ
                          // 0,04 là mời nhầm — và nhầm ở đây chi gấp 100 lần.
                          value={Number((k.giaTri * 100).toFixed(4))}
                          onChange={(e) => doiKhoan(k.vaiNhan, (Number(e.target.value) || 0) / 100)}
                          aria-label={`Tỉ lệ cho ${tenVai.get(k.vaiNhan) ?? k.vaiNhan}`}
                          className="w-24 text-right tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </span>
                    ) : cs.kieuTinh === KIEU_TINH.SO_TIEN_CO_DINH ? (
                      <span className="w-40 shrink-0">
                        <MoneyInput
                          name={`khoan-${k.vaiNhan}`}
                          value={k.giaTri}
                          min={0}
                          onValueChange={(v) => doiKhoan(k.vaiNhan, v ?? 0)}
                        />
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        theo bảng bậc bên dưới
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        doi({ khoan: cs.khoan.filter((x) => x.vaiNhan !== k.vaiNhan) })
                      }
                      aria-label={`Bỏ ${tenVai.get(k.vaiNhan) ?? k.vaiNhan}`}
                      className="inline-flex min-h-9 shrink-0 items-center rounded-md border border-border bg-background px-2 text-state-danger-ink transition-colors duration-150 hover:bg-state-danger-soft"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>

              {conLai.length > 0 && (
                <select
                  className={O}
                  value=""
                  aria-label="Thêm vai nhận"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    doi({ khoan: [...cs.khoan, { vaiNhan: e.target.value, giaTri: 0 }] });
                  }}
                >
                  <option value="">+ Thêm vai nhận…</option>
                  {conLai.map((v) => (
                    <option key={v.ma} value={v.ma}>
                      {v.ten}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {cs.kieuTinh === KIEU_TINH.THUONG_THEO_BAC && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                <Label>Bậc thưởng theo doanh thu kỳ</Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Nhận mức <b className="font-semibold text-foreground">cao nhất đạt được</b>,
                  không cộng dồn nhiều bậc.
                </p>
                <ul className="space-y-2">
                  {(cs.bac ?? []).map((b, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground">Từ</span>
                      <span className="w-40 shrink-0">
                        <MoneyInput
                          name={`bac-nguong-${i}`}
                          value={b.nguong}
                          min={0}
                          onValueChange={(v) =>
                            doi({
                              bac: (cs.bac ?? []).map((x, j) =>
                                j === i ? { ...x, nguong: v ?? 0 } : x,
                              ),
                            })
                          }
                        />
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">thưởng</span>
                      <span className="w-36 shrink-0">
                        <MoneyInput
                          name={`bac-thuong-${i}`}
                          value={b.thuong}
                          min={0}
                          onValueChange={(v) =>
                            doi({
                              bac: (cs.bac ?? []).map((x, j) =>
                                j === i ? { ...x, thuong: v ?? 0 } : x,
                              ),
                            })
                          }
                        />
                      </span>
                      <Input
                        value={b.danhHieu ?? ""}
                        onChange={(e) =>
                          doi({
                            bac: (cs.bac ?? []).map((x, j) =>
                              j === i ? { ...x, danhHieu: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="Danh hiệu"
                        aria-label="Danh hiệu"
                        className="min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => doi({ bac: (cs.bac ?? []).filter((_, j) => j !== i) })}
                        aria-label="Bỏ bậc này"
                        className="inline-flex min-h-9 shrink-0 items-center rounded-md border border-border bg-background px-2 text-state-danger-ink transition-colors duration-150 hover:bg-state-danger-soft"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-9"
                  onClick={() => doi({ bac: [...(cs.bac ?? []), { nguong: 0, thuong: 0 }] })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Thêm bậc
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cs-nguon">Nguồn văn bản</Label>
                <Input
                  id="cs-nguon"
                  value={cs.nguon ?? ""}
                  onChange={(e) => doi({ nguon: e.target.value })}
                  placeholder="SR.QD.208 · PL04 Điều 1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-bat">Trạng thái</Label>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm">
                  <input
                    id="cs-bat"
                    type="checkbox"
                    checked={cs.bat}
                    onChange={(e) => doi({ bat: e.target.checked })}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Đang áp dụng
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cs-ghi-chu">Ghi chú cho người vận hành</Label>
              <textarea
                id="cs-ghi-chu"
                rows={3}
                value={cs.ghiChu ?? ""}
                onChange={(e) => doi({ ghiChu: e.target.value })}
                placeholder="Điều kiện áp dụng, ngoại lệ, điều cấm… — hiện trong dấu ⓘ cạnh tên."
                className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm leading-relaxed transition-colors duration-150 focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDong}>
            Huỷ
          </Button>
          <Button type="button" onClick={onLuu} disabled={!hopLe}>
            Xong
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
