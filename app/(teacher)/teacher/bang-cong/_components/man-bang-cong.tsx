// Màn "Bảng công" site GV — dựng ĐÚNG khung thiết kế ở artifact "Site giáo viên Sata Robo" (board BangCong; chủ dự án 10/11/2026: "làm giống
// 100%"). Một khung cho MỌI giáo viên: tiêu đề + chọn tháng · dải kỳ có thanh tiến độ · 5 ô số · hai cột (trái: ô cần xem, lưới tháng,
// chi tiết; phải: cách quét, mã ô, phản ánh / đơn, khoản trừ, xem thêm).
// CHỈ VẼ một "mô hình hiển thị" — trang dựng mô hình từ loader admin đang dùng (luật 12b), qua hai bộ chuyển ở cuối tệp:
//   · `tuOCong`   — GV có ô công (phân công, kỳ ≥ mốc luật mới): `docCongOCuaNguoi` + `hienTongPhanCong`;
//   · `tuDongCa`  — GV theo ca: `dungDongBangCong` + `tomTatCongThang` (cùng số Bảng công admin).
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronRight as Mui, FileText, QrCode, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import type { OCong } from "@/lib/phan-cong/cong-o-db";
import { NHAN_LY_DO_O, NHAN_TRANG_THAI_PHAN_ANH } from "@/lib/phan-cong/phan-anh";
import type { TongPhanCongHien } from "@/lib/cham-cong/dong-theo-phan-cong";
import { CO_CAN_XU_LY, type DongBangCong, type TomTatCong } from "@/lib/cham-cong/bang-cong-gv";
import { NHAN_TRANG_THAI } from "@/lib/cham-cong/nhan-ca";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import { fmtMin } from "@/components/cham-cong/ui/tong-hop-cong-thang";
import { FormPhanAnh } from "../../phan-cong/cong-o/_components/form-phan-anh";

// ─── Mô hình hiển thị ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Màu ô lưới (đúng bảng màu thiết kế): xanh = tự động / đã làm · cam = cần xem · xanh dương = đang phản ánh · trắng = sắp tới. */
export type Mau = "XANH" | "XANH_DUYET" | "CAM" | "DUONG" | "TRANG" | "XAM";
export type ONgay = { ma: string[]; mau: Mau; nhan: string } | null;
export type OSoHien = { nhan: string; gt: string; phu?: string; tone?: "cam" | "xanh" };
export type MucCanXem = { key: string; tieuDe: ReactNode; moTa: ReactNode; bangChung: ReactNode; hanhDong: ReactNode };
export type DongChiTiet = { key: string; ngay: string; ma: string; viec: ReactNode; kyVong: ReactNode; daQuet: ReactNode; ketQua: ReactNode; mau: Mau };
export type MoHinh = {
  phuDe: string;
  canhBaoKy: string; // "ô cần xem" / "ngày cần xem"
  oSo: OSoHien[];
  ghiChuOSo?: ReactNode;
  canXem: { tieuDe: string; ghiChu: string; ds: MucCanXem[] };
  luoi: { tieuDe: string; moTa: ReactNode; chuThich: [Mau, string][]; ngay: Record<string, ONgay>; trong: string };
  chiTiet: { cot: [string, string, string, string, string, string]; ds: DongChiTiet[]; rong: string };
  phai: ReactNode;
};

const NEN: Record<Mau, string> = {
  XANH: "border-[#BBF7D0] bg-[#F0FDF4] dark:border-state-success-ink/40 dark:bg-state-success-soft",
  XANH_DUYET: "border-[#86EFAC] bg-[#F0FDF4] dark:border-state-success-ink/60 dark:bg-state-success-soft",
  CAM: "border-[#FDBA74] bg-[#FFF7ED] dark:border-state-warning-ink/50 dark:bg-state-warning-soft",
  DUONG: "border-[#93C5FD] bg-[#EFF6FF] dark:border-state-info-ink/50 dark:bg-state-info-soft",
  TRANG: "border-border bg-card",
  XAM: "border-border bg-muted/40",
};
const CHU: Record<Mau, string> = {
  XANH: "text-state-success-ink",
  XANH_DUYET: "text-state-success-ink",
  CAM: "text-state-warning-ink",
  DUONG: "text-state-info-ink",
  TRANG: "text-muted-foreground",
  XAM: "text-muted-foreground",
};
const KY_HIEU: Record<Mau, string> = { XANH: "✓ ", XANH_DUYET: "✓ ", CAM: "⚠ ", DUONG: "↻ ", TRANG: "", XAM: "" };
const CHIP: Record<Mau, string> = {
  XANH: "bg-state-success-soft text-state-success-ink",
  XANH_DUYET: "bg-state-success-soft text-state-success-ink",
  CAM: "bg-state-warning-soft text-state-warning-ink",
  DUONG: "bg-state-info-soft text-state-info-ink",
  TRANG: "bg-muted text-muted-foreground",
  XAM: "bg-muted text-muted-foreground",
};
const MA_CLS = "rounded-[5px] bg-primary-soft px-1.5 py-px text-[10.5px] font-bold whitespace-nowrap text-primary-ink";
const THE = "rounded-xl border border-border bg-card";

export function MaO({ ma }: { ma: string }) {
  return <span className={MA_CLS}>{ma}</span>;
}
export function ChipKetQua({ mau, children }: { mau: Mau; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", CHIP[mau])}>{children}</span>;
}

// ─── Khung màn ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ManBangCong({
  m,
  thangKey,
  homNay,
  hrefThang,
  ky,
  hrefLoc,
  loc,
  demLoc,
  hanhDongDau,
  phuLuc,
}: {
  m: MoHinh;
  thangKey: string;
  homNay: string;
  hrefThang: (thang: string) => string;
  ky: { khoa: boolean; khoaLuc: string | null; daQua: number; soNgay: number; soCanXem: number };
  hrefLoc: (l: "can-xem" | "phan-anh" | "tat-ca") => string;
  loc: "can-xem" | "phan-anh" | "tat-ca";
  demLoc: { canXem: number; phanAnh: number | null; tatCa: number };
  hanhDongDau: ReactNode;
  /** Khối phụ ở cuối cột trái (đơn từ / xác nhận công) — không nằm trong thiết kế gốc nhưng không được mất chức năng. */
  phuLuc?: ReactNode;
}) {
  const [y, mo] = thangKey.split("-").map(Number) as [number, number];
  const lech = (n: number) => new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
  const ky_ = `${String(mo).padStart(2, "0")}/${y}`;
  const cuoi = `${new Date(Date.UTC(y, mo, 0)).getUTCDate()}/${String(mo).padStart(2, "0")}`;
  const pct = ky.soNgay ? Math.round((ky.daQua / ky.soNgay) * 100) : 0;
  return (
    <div className="mx-auto w-full max-w-[1080px] space-y-[18px]">
      {/* Tiêu đề + chọn tháng */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-[21px] font-bold tracking-tight text-foreground">Bảng công</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{m.phuDe}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hanhDongDau}
          <nav aria-label="Chọn tháng" className="flex items-center gap-1.5">
            <Link href={hrefThang(lech(-1))} scroll={false} aria-label="Tháng trước" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted pointer-coarse:h-11 pointer-coarse:w-11">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <span className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-bold text-foreground pointer-coarse:h-11">
              Tháng {mo}/{y}
            </span>
            <Link href={hrefThang(lech(1))} scroll={false} aria-label="Tháng sau" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted pointer-coarse:h-11 pointer-coarse:w-11">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </nav>
        </div>
      </div>

      {/* Dải kỳ */}
      <div className={cn(THE, "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-[18px]")}>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold", ky.khoa ? "bg-muted text-foreground" : "bg-state-warning-soft text-state-warning-ink")}>
          {ky.khoa ? "ĐÃ CHỐT" : "TẠM TÍNH"}
        </span>
        <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
          <p className="text-xs">
            <b>
              Kỳ {ky_} · {ky.khoa ? "đã chốt" : `đã qua ${ky.daQua}/${ky.soNgay} ngày`}
            </b>{" "}
            <span className="text-muted-foreground">
              {ky.khoa
                ? `· chốt${ky.khoaLuc ? ` ngày ${ky.khoaLuc}` : ""} — không phản ánh được nữa`
                : `· kỳ chốt sau ${cuoi} — sau khi chốt không phản ánh được nữa`}
            </span>
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-muted" aria-hidden>
            <div className="h-1.5 rounded-full bg-[#F97316]" style={{ width: `${ky.khoa ? 100 : pct}%` }} />
          </div>
        </div>
        {ky.soCanXem > 0 && (
          <a href="#can-xem" className="ml-auto shrink-0 rounded-full border border-[#FDBA74] bg-[#FFF7ED] px-2.5 py-0.5 text-[11.5px] font-semibold text-state-warning-ink dark:bg-state-warning-soft">
            {ky.soCanXem} {m.canhBaoKy}
          </a>
        )}
      </div>

      {/* 5 ô số */}
      <div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {m.oSo.map((o) => (
            <div key={o.nhan} className={cn(THE, "min-w-0 px-4 py-3.5")}>
              <dt className="text-xs text-muted-foreground">{o.nhan}</dt>
              <dd className={cn("mt-0.5 text-2xl leading-tight font-bold tabular-nums", o.tone === "cam" ? "text-primary-ink" : o.tone === "xanh" ? "text-state-success-ink" : "text-foreground")}>
                {o.gt}
              </dd>
              {o.phu && <dd className="mt-1 text-[11px] text-muted-foreground/80">{o.phu}</dd>}
            </div>
          ))}
        </dl>
        {m.ghiChuOSo && <div className="mt-2 text-xs text-muted-foreground">{m.ghiChuOSo}</div>}
      </div>

      {/* Hai cột */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {m.canXem.ds.length > 0 && (
            <section id="can-xem" aria-labelledby="can-xem-h" className="scroll-mt-20 overflow-hidden rounded-xl border border-[#FDBA74] bg-[#FFFBF5] dark:bg-state-warning-soft/30">
              <h2 id="can-xem-h" className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[#FED7AA] px-[18px] py-3 text-sm">
                <TriangleAlert className="h-4 w-4 text-state-warning-ink" aria-hidden />
                <b>
                  {m.canXem.tieuDe} ({m.canXem.ds.length})
                </b>
                <span className="text-xs font-normal text-muted-foreground">· {m.canXem.ghiChu}</span>
              </h2>
              <ul className="divide-y divide-[#FED7AA]">
                {m.canXem.ds.map((x) => (
                  <li key={x.key} className="grid gap-3 px-[18px] py-3 md:grid-cols-[1fr_1.2fr_auto] md:items-center">
                    <div className="min-w-0">
                      <b className="text-[13px]">{x.tieuDe}</b>
                      <div className="text-xs text-muted-foreground">{x.moTa}</div>
                    </div>
                    <div className="min-w-0 text-xs">{x.bangChung}</div>
                    <div className="min-w-0">{x.hanhDong}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="luoi-h" className={cn(THE, "p-4 sm:px-[18px]")}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
              <h2 id="luoi-h" className="text-[14.5px] font-bold">
                {m.luoi.tieuDe} {mo}
              </h2>
              <ul className="flex flex-wrap gap-3" aria-label="Chú thích">
                {m.luoi.chuThich.map(([mau, nhan]) => (
                  <li key={nhan} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={cn("h-[11px] w-[11px] rounded-[3px] border", NEN[mau])} aria-hidden />
                    {nhan}
                  </li>
                ))}
              </ul>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">{m.luoi.moTa}</p>
            <Luoi thangKey={thangKey} homNay={homNay} ngay={m.luoi.ngay} trong={m.luoi.trong} />
          </section>

          <section id="chi-tiet" aria-labelledby="chi-tiet-h" className={cn(THE, "scroll-mt-20 overflow-hidden")}>
            <header className="flex flex-wrap items-center justify-between gap-2 px-[18px] pt-4 pb-2">
              <h2 id="chi-tiet-h" className="text-sm">
                <b>{m.chiTiet.cot[1] === "Ô" ? "Chi tiết ô công" : "Chi tiết ngày công"}</b>
                <span className="text-muted-foreground"> · mới nhất trước</span>
              </h2>
              <nav aria-label="Lọc chi tiết" className="flex flex-wrap gap-1.5">
                <Loc href={hrefLoc("can-xem")} on={loc === "can-xem"} cls="bg-[#FFEDD5] text-[#C2410C] dark:bg-state-warning-soft dark:text-state-warning-ink">
                  Cần xem ({demLoc.canXem})
                </Loc>
                {demLoc.phanAnh != null && (
                  <Loc href={hrefLoc("phan-anh")} on={loc === "phan-anh"} cls="bg-[#DBEAFE] text-[#1D4ED8] dark:bg-state-info-soft dark:text-state-info-ink">
                    Phản ánh ({demLoc.phanAnh})
                  </Loc>
                )}
                <Loc href={hrefLoc("tat-ca")} on={loc === "tat-ca"} cls="bg-muted text-muted-foreground">
                  Tất cả
                </Loc>
              </nav>
            </header>
            {m.chiTiet.ds.length === 0 ? (
              <p className="px-[18px] pt-4 pb-8 text-center text-sm text-muted-foreground">{m.chiTiet.rong}</p>
            ) : (
              <PhanTrangBang cuonNgang khoaGhiNho="gv-bang-cong-chi-tiet">
                <table className="w-full min-w-[46rem] border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {m.chiTiet.cot.map((c) => (
                        <th key={c} scope="col" className="px-[18px] py-2.5">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.chiTiet.ds.map((d) => (
                      <tr key={d.key} className="border-b border-border/60 align-middle last:border-0">
                        <td className="px-[18px] py-3 font-semibold whitespace-nowrap tabular-nums">{d.ngay}</td>
                        <td className="px-[18px] py-3">
                          <MaO ma={d.ma} />
                        </td>
                        <td className="px-[18px] py-3">{d.viec}</td>
                        <td className="px-[18px] py-3 text-muted-foreground tabular-nums">{d.kyVong}</td>
                        <td className="px-[18px] py-3 tabular-nums">{d.daQuet}</td>
                        <td className="px-[18px] py-3">{d.ketQua}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PhanTrangBang>
            )}
          </section>
          {phuLuc}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">{m.phai}</aside>
      </div>
    </div>
  );
}

function Loc({ href, on, cls, children }: { href: string; on: boolean; cls: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "page" : undefined}
      className={cn("inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold pointer-coarse:min-h-11", cls, on && "ring-2 ring-primary/40")}
    >
      {children}
    </Link>
  );
}

function Luoi({ thangKey, homNay, ngay, trong }: { thangKey: string; homNay: string; ngay: Record<string, ONgay>; trong: string }) {
  const [y, m] = thangKey.split("-").map(Number) as [number, number];
  const soNgay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dau = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const truoc = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const tong = Math.ceil((dau + soNgay) / 7) * 7;
  const o: { so: number; key: string | null }[] = Array.from({ length: tong }, (_, i) => {
    const n = i - dau + 1;
    if (n < 1) return { so: truoc + n, key: null };
    if (n > soNgay) return { so: n - soNgay, key: null };
    return { so: n, key: `${thangKey}-${String(n).padStart(2, "0")}` };
  });
  return (
    <div>
      <div>
        <div className="mb-1.5 grid grid-cols-7 gap-1 sm:gap-1.5">
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
            <div key={d} className="text-center text-[10.5px] font-bold tracking-wider text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {o.map((x, i) => {
            if (!x.key) return <div key={`n${i}`} aria-hidden className="min-h-16 rounded-lg bg-muted/30 p-1 text-xs font-semibold text-muted-foreground/40 sm:min-h-[88px] sm:rounded-[10px] sm:p-2">{x.so}</div>;
            const v = ngay[x.key] ?? null;
            const homNayO = x.key === homNay;
            if (!v)
              return (
                <div key={x.key} className={cn("min-h-16 rounded-lg border border-dashed border-border bg-card p-1 sm:min-h-[88px] sm:rounded-[10px] sm:p-2", homNayO && "border-2 border-solid border-primary")}>
                  <span className="text-xs font-bold text-muted-foreground/70 sm:text-[13px]">{x.so}</span>
                  <div className="mt-2 hidden text-[10.5px] text-muted-foreground/60 sm:block">{trong}</div>
                </div>
              );
            return (
              <div key={x.key} title={v.nhan} className={cn("min-h-16 min-w-0 rounded-lg border p-1 sm:min-h-[88px] sm:rounded-[10px] sm:p-2", NEN[v.mau], homNayO && "border-2 border-primary")}>
                <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:gap-1">
                  <span className="text-xs font-bold text-foreground sm:text-[13px]">{x.so}</span>
                  <span className="flex flex-wrap justify-end gap-0.5">
                    {v.ma.map((c) => (
                      <MaO key={c} ma={c} />
                    ))}
                  </span>
                </div>
                <div className={cn("mt-2.5 hidden text-[10.5px] leading-tight font-semibold [overflow-wrap:anywhere] sm:block", CHU[v.mau])}>
                  {KY_HIEU[v.mau]}
                  {v.nhan}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Thẻ cột phải ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function TheHuongDan({ tieuDe, muc }: { tieuDe: string; muc: [string, string][] }) {
  return (
    <section aria-label={tieuDe} className={cn(THE, "p-[18px]")}>
      <h2 className="mb-2.5 text-sm font-bold">{tieuDe}</h2>
      <ul className="space-y-2.5">
        {muc.map(([a, b]) => (
          <li key={a} className="flex gap-2 text-[13px]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F97316]" aria-hidden />
            <span>
              <b>{a}</b>
              <span className="block text-muted-foreground">{b}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function TheMa({ tieuDe, ma, ghiChu }: { tieuDe: string; ma: [string, string][]; ghiChu?: string }) {
  if (!ma.length) return null;
  return (
    <section aria-label={tieuDe} className={cn(THE, "p-[18px]")}>
      <h2 className="mb-2.5 text-sm font-bold">{tieuDe}</h2>
      <dl className="space-y-1.5">
        {ma.map(([m, n]) => (
          <div key={m} className="flex items-center gap-3 text-[13px]">
            <dt className="w-12 shrink-0">
              <MaO ma={m} />
            </dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      {ghiChu && <p className="mt-2.5 text-xs text-muted-foreground">{ghiChu}</p>}
    </section>
  );
}
export function TheDanhSach({ tieuDe, dem, ds, rong }: { tieuDe: string; dem: number; ds: { key: string; tren: ReactNode; duoi?: ReactNode; chip: ReactNode }[]; rong?: string }) {
  if (!ds.length && !rong) return null;
  return (
    <section aria-label={tieuDe} className={cn(THE, "overflow-hidden")}>
      <h2 className="flex items-center justify-between border-b border-border px-[18px] py-3 text-sm font-bold">
        {tieuDe}
        <span className="text-xs font-normal text-muted-foreground">{dem}</span>
      </h2>
      {ds.length === 0 ? (
        <p className="px-[18px] py-4 text-xs text-muted-foreground">{rong}</p>
      ) : (
        <ul className="divide-y divide-border">
          {ds.map((x) => (
            <li key={x.key} className="flex items-start justify-between gap-3 px-[18px] py-3">
              <div className="min-w-0 text-[13px]">
                <b>{x.tren}</b>
                {x.duoi && <div className="text-muted-foreground [overflow-wrap:anywhere]">{x.duoi}</div>}
              </div>
              <div className="shrink-0">{x.chip}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
export function TheXemThem() {
  const L: [string, string, string, typeof CalendarDays][] = [
    ["/teacher/lich", "Lịch làm việc", "Buổi được phân · việc cần xử lý", CalendarDays],
    ["/teacher/don-tu", "Đơn từ", "Chỉnh công, nghỉ, đổi ca", FileText],
    ["/teacher/cham-cong", "Chấm công", "Quét mã QR vào / ra", QrCode],
  ];
  return (
    <section aria-label="Xem thêm" className={cn(THE, "space-y-2 p-[18px]")}>
      <h2 className="mb-1 text-sm font-bold">Xem thêm</h2>
      {L.map(([href, ten, mo, Icon]) => (
        <Link key={href} href={href} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13px]">{ten}</b>
            <span className="block text-xs text-muted-foreground">{mo}</span>
          </span>
          <Mui className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </section>
  );
}

// ═══ Bộ chuyển 1: GV có Ô CÔNG (phân công, kỳ ≥ mốc) ═══════════════════════════════════════════════════════════════════════════
const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const THU_DAI = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const thu = (ymd: string) => THU[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const thuDai = (ymd: string) => THU_DAI[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const so = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const NHAN_CA: Record<string, string> = { S: "sáng", C: "chiều", T: "tối" };

type TTO = "SAP_TOI" | "HOM_NAY" | "TU_DONG" | "DA_DUYET_PA" | "DANG_PA" | "CAN_XEM";
export function trangThaiO(o: OCong, homNay: string): TTO {
  if (o.ngay > homNay) return "SAP_TOI";
  if (o.ngay === homNay) return "HOM_NAY";
  if (o.phanAnh?.status === "CHO_DUYET") return "DANG_PA";
  if (o.trangThai === "TU_DONG") return o.phanAnh?.status === "DA_DUYET" ? "DA_DUYET_PA" : "TU_DONG";
  return "CAN_XEM";
}
const MAU_O: Record<TTO, Mau> = { TU_DONG: "XANH", DA_DUYET_PA: "XANH_DUYET", DANG_PA: "DUONG", CAN_XEM: "CAM", SAP_TOI: "TRANG", HOM_NAY: "TRANG" };
const UU: Record<TTO, number> = { CAN_XEM: 5, DANG_PA: 4, DA_DUYET_PA: 3, TU_DONG: 2, HOM_NAY: 1, SAP_TOI: 0 };
const lyDo = (o: OCong) => o.lyDo.map((l) => NHAN_LY_DO_O[l] ?? l).join(", ");
const nhanO = (t: TTO, o: OCong) =>
  t === "TU_DONG" ? "Tự động · đủ lượt" : t === "DA_DUYET_PA" ? "Đã duyệt phản ánh" : t === "DANG_PA" ? "Đang phản ánh" : t === "CAN_XEM" ? lyDo(o) || "Cần xem" : t === "HOM_NAY" ? "Hôm nay" : "Sắp tới";
const maO = (o: OCong) => `${o.ma}${o.coTrial ? "+TR" : ""}`;
function congO(o: OCong) {
  const p: string[] = [];
  if (o.tietD > 0) p.push(`${so(o.tietD)} tiết`);
  if (o.tietTG > 0) p.push(`${so(o.tietTG)} tiết trợ giảng`);
  if (o.trucQuyDoi > 0) p.push(`${so(o.trucQuyDoi)} trực`);
  return p.join(" + ") || "—";
}
const kyVongO = (o: OCong) => (o.kyVong?.length ? o.kyVong.map((c) => `vào ≤${c.tu} · ra ≥${c.den}`).join(" ; ") : "—");
const daQuetO = (o: OCong) => (o.coMat?.length ? o.coMat.map((k) => `vào ${hhmm(k.tu)} · ra ${k.den == null ? "—" : hhmm(k.den)}`).join(" ; ") : "chưa có lượt quét");

export function tuOCong(p: {
  o: OCong[];
  homNay: string;
  tong: { toiHomNay: TongPhanCongHien; caThang: TongPhanCongHien } | null;
  tenCoSo: ReadonlyMap<string, string>;
  loc: "can-xem" | "phan-anh" | "tat-ca";
  phanTruoc: ReactNode;
  khoanTru: ReactNode;
  dieuChinh: ReactNode;
}): { m: MoHinh; soCanXem: number; dem: { canXem: number; phanAnh: number; tatCa: number } } {
  const daQua = p.o.filter((x) => x.ngay < p.homNay);
  const canXem = daQua.filter((x) => trangThaiO(x, p.homNay) === "CAN_XEM");
  const coPA = daQua.filter((x) => x.phanAnh);
  const tuDong = daQua.filter((x) => x.trangThai === "TU_DONG").length;
  const t = p.tong?.toiHomNay;
  const oSo: OSoHien[] = [
    { nhan: "Tiết đứng chính", gt: t?.tietChinh ?? "—", phu: "tới hết hôm nay", tone: "cam" },
    { nhan: "Trợ giảng", gt: t?.tietTroGiang ?? "—", phu: "tiết" },
    { nhan: "Đơn vị trực", gt: t ? so(t.trucDu + t.trucNua * 0.5) : "—", phu: t ? `đủ ca ${t.trucDu} × 1,0 · nửa ca ${t.trucNua} × 0,5` : undefined },
    { nhan: "Buổi Trial", gt: t ? String(t.soBuoiTrial) : "—" },
    { nhan: "Ô công đã qua", gt: String(daQua.length), phu: `tự động ${tuDong} · cần xem ${canXem.length} · phản ánh ${coPA.length}`, tone: "xanh" },
  ];
  const ngay: Record<string, ONgay> = {};
  const theoNgay = new Map<string, OCong[]>();
  for (const x of p.o) theoNgay.set(x.ngay, [...(theoNgay.get(x.ngay) ?? []), x]);
  for (const [n, ds] of theoNgay) {
    const top = [...ds].sort((a, b) => UU[trangThaiO(b, p.homNay)] - UU[trangThaiO(a, p.homNay)])[0]!;
    const tt = trangThaiO(top, p.homNay);
    ngay[n] = { ma: [...new Set(ds.sort((a, b) => a.ca.localeCompare(b.ca)).map(maO))], mau: MAU_O[tt], nhan: nhanO(tt, top) };
  }
  const nguon = p.loc === "can-xem" ? canXem : p.loc === "phan-anh" ? coPA : daQua;
  const chiTiet: DongChiTiet[] = [...nguon]
    .sort((a, b) => b.ngay.localeCompare(a.ngay) || a.ca.localeCompare(b.ca))
    .map((x) => {
      const tt = trangThaiO(x, p.homNay);
      return {
        key: `${x.centerId}-${x.ngay}-${x.ca}`,
        ngay: `${thu(x.ngay)} ${dm(x.ngay)}`,
        ma: maO(x),
        viec: (
          <>
            <div>{congO(x)}</div>
            <div className="text-xs text-muted-foreground">
              Buổi {NHAN_CA[x.ca] ?? x.ca}
              {p.tenCoSo.get(x.centerId) ? ` · ${p.tenCoSo.get(x.centerId)}` : ""}
            </div>
          </>
        ),
        kyVong: kyVongO(x),
        daQuet: daQuetO(x),
        ketQua: (
          <div className="space-y-1">
            <ChipKetQua mau={MAU_O[tt]}>
              {KY_HIEU[MAU_O[tt]]}
              {tt === "CAN_XEM" ? "Cần xem" : nhanO(tt, x)}
            </ChipKetQua>
            <div className="text-xs text-muted-foreground">{congO(x)}</div>
            {tt === "CAN_XEM" && (
              <a href="#can-xem" className="inline-flex rounded-md border border-border bg-card px-2 py-0.5 text-xs font-semibold hover:bg-muted">
                Phản ánh
              </a>
            )}
          </div>
        ),
        mau: MAU_O[tt],
      };
    });
  const pa = [...coPA].sort((a, b) => b.ngay.localeCompare(a.ngay));
  const m: MoHinh = {
    phuDe: "Công giáo viên parttime được tính tự động từ chấm công + lịch phân công — bạn không cần xác nhận. Chỉ phản ánh khi một ô bị tính sai.",
    canhBaoKy: "ô cần xem",
    oSo,
    ghiChuOSo: p.phanTruoc,
    canXem: {
      tieuDe: "Ô cần bạn xem",
      ghiChu: "công vẫn ghi theo phân công; không phản ánh trước khi kỳ chốt thì giữ kết quả đang tính",
      ds: canXem.map((x) => ({
        key: `${x.centerId}-${x.ngay}-${x.ca}`,
        tieuDe: (
          <>
            {thuDai(x.ngay)}, {dm(x.ngay)} · <MaO ma={maO(x)} />
          </>
        ),
        moTa: `${congO(x)} · buổi ${NHAN_CA[x.ca] ?? x.ca}${p.tenCoSo.get(x.centerId) ? ` · ${p.tenCoSo.get(x.centerId)}` : ""}`,
        bangChung: (
          <>
            <div>
              <span className="text-muted-foreground">Kỳ vọng:</span> {kyVongO(x)}
            </div>
            <div>
              <span className="text-muted-foreground">Đã quét:</span> {daQuetO(x)} ·{" "}
              <b className="text-state-warning-ink">{lyDo(x)}</b>
            </div>
          </>
        ),
        hanhDong: <FormPhanAnh centerId={x.centerId} ngay={x.ngay} ca={x.ca} phanAnh={x.phanAnh} />,
      })),
    },
    luoi: {
      tieuDe: "Lưới ô công tháng",
      moTa: (
        <>
          Mỗi ô = việc được phân trong ngày (theo lịch phân công). Ô đủ lượt quét được tính <b>tự động</b>.
        </>
      ),
      chuThich: [
        ["XANH", "Tự động · đủ lượt"],
        ["CAM", "Cần xem"],
        ["DUONG", "Đang phản ánh"],
        ["XANH_DUYET", "Đã duyệt phản ánh"],
        ["TRANG", "Sắp tới"],
      ],
      ngay,
      trong: "Không có việc",
    },
    chiTiet: {
      cot: ["Ngày", "Ô", "Việc được phân", "Kỳ vọng quét", "Đã quét", "Kết quả · công"],
      ds: chiTiet,
      rong: p.loc === "can-xem" ? "Không có ô nào cần xem." : p.loc === "phan-anh" ? "Bạn chưa phản ánh ô nào trong tháng này." : "Chưa có ô công nào đã qua.",
    },
    phai: (
      <>
        <TheHuongDan
          tieuDe="Quét thế nào để ô tự tính?"
          muc={[
            ["Chỉ dạy (D, TG, D2…)", "Quét trước giờ dạy và sau giờ dạy."],
            ["Trực ca", "Ca trực nối nhau tính là một phiên: một lượt vào đầu phiên, một lượt ra cuối phiên."],
            ["Dạy + trực (TD, TTG)", "Dùng lượt quét của phiên trực, không quét riêng giờ dạy."],
            ["Thiếu lượt", "Ô thành “cần xem”. Công vẫn ghi theo phân công; phản ánh để bổ sung giờ có mặt."],
          ]}
        />
        <TheMa
          tieuDe="Mã ô công"
          ma={[
            ["D", "Đứng chính 1 tiết"],
            ["D2", "Đứng chính 2 tiết"],
            ["TG", "Trợ giảng"],
            ["TG2", "Trợ giảng 2 tiết"],
            ["D+TG", "Đứng chính + trợ giảng"],
            ["T", "Trực đủ ca"],
            ["TD", "Đứng chính + nửa ca trực"],
            ["TTG", "Trợ giảng + nửa ca trực"],
            ["+TR", "Có buổi Trial"],
          ]}
          ghiChu="Hai tiết (D2 · D+TG · TG2) không còn tiền trực."
        />
        <TheDanhSach
          tieuDe="Phản ánh của tôi"
          dem={pa.length}
          ds={pa.map((x) => ({
            key: x.phanAnh!.id,
            tren: `${dm(x.ngay)} · ${maO(x)}`,
            duoi: x.phanAnh!.lyDo,
            chip: (
              <ChipKetQua mau={x.phanAnh!.status === "DA_DUYET" ? "XANH" : x.phanAnh!.status === "CHO_DUYET" ? "DUONG" : x.phanAnh!.status === "KHONG_DUYET" ? "CAM" : "XAM"}>
                {NHAN_TRANG_THAI_PHAN_ANH[x.phanAnh!.status] ?? x.phanAnh!.status}
              </ChipKetQua>
            ),
          }))}
          rong="Chưa có phản ánh nào trong tháng."
        />
        {p.khoanTru}
        {p.dieuChinh}
        <TheXemThem />
      </>
    ),
  };
  return { m, soCanXem: canXem.length, dem: { canXem: canXem.length, phanAnh: coPA.length, tatCa: daQua.length } };
}

// ═══ Bộ chuyển 2: GV theo CA (fulltime / tháng trước mốc) ═══════════════════════════════════════════════════════════════════════
export const canXuLy = (r: DongBangCong) => r.flags.some((f) => CO_CAN_XU_LY.has(f));
function maCa(r: DongBangCong): string {
  if (r.loai === "Ca làm" || r.loai === "Nghỉ" || r.loai === "Nghỉ phép") return r.ten.split(" · ")[0] ?? r.ten;
  if (r.loai === "Trải nghiệm") return "TR";
  if (r.loai === "Học bù") return "BÙ";
  if (r.loai === "Phân công") return "PC";
  return "DẠY";
}
function mauDong(r: DongBangCong): Mau {
  if (canXuLy(r)) return "CAM";
  if (r.trangThai === "CHUA_CHAM" || r.trangThai === "CHUA_CHOT") return "CAM";
  if (r.trangThai === "DA_LAM" || r.trangThai === "THEO_PHAN_CONG") return "XANH";
  if (r.trangThai === "NGHI") return "XAM";
  return "TRANG";
}
const UU_MAU: Record<Mau, number> = { CAM: 5, DUONG: 4, XANH_DUYET: 3, XANH: 2, XAM: 1, TRANG: 0 };
const nhanDong = (r: DongBangCong) => (canXuLy(r) ? "Cần xử lý" : NHAN_TRANG_THAI[r.trangThai]);

export function tuDongCa(p: {
  rows: DongBangCong[];
  tomTat: TomTatCong;
  homNay: string;
  loc: "can-xem" | "phan-anh" | "tat-ca";
  hrefDon: string | null;
  buoiQuaHan: number;
  congDay: { name: string; buoi: number; cong: number; tinhVaoKy: boolean }[];
  khoanTru: ReactNode;
  dieuChinh: ReactNode;
  donTu: { key: string; tren: string; duoi: string | null; chip: ReactNode }[];
}): { m: MoHinh; soCanXem: number; dem: { canXem: number; phanAnh: null; tatCa: number } } {
  const t = p.tomTat;
  const canXem = p.rows.filter(canXuLy);
  const daQua = p.rows.filter((r) => r.ngay <= p.homNay);
  const oSo: OSoHien[] = [
    { nhan: "Công tháng", gt: so(t.cong), phu: t.congChuan != null ? `công chuẩn ${so(t.congChuan)} · tới hết hôm nay` : "tới hết hôm nay", tone: "cam" },
    { nhan: "Ngày đã đi làm", gt: `${t.ngayDaCham}/${t.ngayCoCa}`, phu: t.chuaCham > 0 ? `${t.chuaCham} ngày chưa chấm` : "ngày có ca" },
    { nhan: "Đi muộn", gt: String(t.lateCount), phu: t.lateCount ? `${fmtMin(t.latePhut)} trong tháng` : "lần" },
    { nhan: "Về sớm", gt: String(t.earlyCount), phu: t.earlyCount ? `${fmtMin(t.earlyPhut)} trong tháng` : "lần" },
    { nhan: "Ngày nghỉ phép", gt: so(t.nghiPhep), phu: `có lương ${so(t.nghiPhepCoLuong)} · không lương ${so(t.nghiPhepKhongLuong)}`, tone: "xanh" },
  ];
  const ngay: Record<string, ONgay> = {};
  const theoNgay = new Map<string, DongBangCong[]>();
  for (const r of p.rows) theoNgay.set(r.ngay, [...(theoNgay.get(r.ngay) ?? []), r]);
  for (const [n, ds] of theoNgay) {
    const top = [...ds].sort((a, b) => UU_MAU[mauDong(b)] - UU_MAU[mauDong(a)])[0]!;
    ngay[n] = { ma: [...new Set(ds.map(maCa))], mau: mauDong(top), nhan: nhanDong(top) };
  }
  const nguon = p.loc === "can-xem" ? canXem : daQua;
  const chiTiet: DongChiTiet[] = [...nguon]
    .sort((a, b) => b.ngay.localeCompare(a.ngay) || a.gio.localeCompare(b.gio))
    .map((r) => ({
      key: r.key,
      ngay: `${thu(r.ngay)} ${dm(r.ngay)}`,
      ma: maCa(r),
      viec: (
        <>
          <div>{r.ten}</div>
          {r.phu && <div className="text-xs text-muted-foreground">{r.phu}</div>}
        </>
      ),
      kyVong: r.gio,
      daQuet: r.phutLam != null ? `làm ${fmtMin(r.phutLam)}` : r.soGio != null ? `dạy ${so(r.soGio)}h` : "—",
      ketQua: (
        <div className="space-y-1">
          <ChipKetQua mau={mauDong(r)}>
            {KY_HIEU[mauDong(r)]}
            {nhanDong(r)}
          </ChipKetQua>
          {r.cong != null && <div className="text-xs text-muted-foreground">{so(r.cong)} công</div>}
          {r.flags.length > 0 && <FlagList codes={r.flags} />}
        </div>
      ),
      mau: mauDong(r),
    }));
  const maDung = [...new Map(p.rows.filter((r) => r.loai === "Ca làm" || r.loai === "Nghỉ" || r.loai === "Nghỉ phép").map((r) => [maCa(r), r.ten.split(" · ").slice(1).join(" · ")] as const)).entries()];
  const coDay = p.rows.some((r) => r.loai === "Dạy");
  const canXemDs: MucCanXem[] = canXem.map((r) => ({
    key: r.key,
    tieuDe: (
      <>
        {thuDai(r.ngay)}, {dm(r.ngay)} · <MaO ma={maCa(r)} />
      </>
    ),
    moTa: `${r.ten} · ${r.gio}`,
    bangChung: (
      <>
        <div>
          <span className="text-muted-foreground">Giờ làm:</span> {r.phutLam != null ? fmtMin(r.phutLam) : "—"}
          {r.cong != null ? ` · ${so(r.cong)} công` : ""}
        </div>
        <FlagList codes={r.flags} />
      </>
    ),
    hanhDong: p.hrefDon ? (
      <Link href={p.hrefDon} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 pointer-coarse:h-11">
        Đơn chỉnh công
      </Link>
    ) : null,
  }));
  if (p.buoiQuaHan > 0)
    canXemDs.push({
      key: "buoi-qua-han",
      tieuDe: `${p.buoiQuaHan} buổi dạy đã qua mà chưa chốt`,
      moTa: "Buổi chưa điểm danh / chưa hoàn tất thì chưa tính công dạy.",
      bangChung: null,
      hanhDong: (
        <Link href="/teacher/diem-danh" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 pointer-coarse:h-11">
          Mở điểm danh
        </Link>
      ),
    });
  const m: MoHinh = {
    phuDe: "Công của bạn tính tự động từ lịch ca và chấm công — cùng số với bảng công của quản lý. Ngày bị tính sai thì gửi đơn chỉnh công trước khi kỳ chốt.",
    canhBaoKy: "ngày cần xem",
    oSo,
    canXem: { tieuDe: "Ngày cần bạn xem", ghiChu: "đi muộn, về sớm hoặc thiếu lượt quét — gửi đơn chỉnh công nếu bị tính sai", ds: canXemDs },
    luoi: {
      tieuDe: "Lưới công tháng",
      moTa: "Mỗi ô = ca được xếp và buổi dạy trong ngày; trạng thái đọc từ công ngày đã tính.",
      chuThich: [
        ["XANH", NHAN_TRANG_THAI.DA_LAM],
        ["CAM", "Cần xử lý"],
        ["XAM", "Nghỉ"],
        ["TRANG", "Sắp tới"],
      ],
      ngay,
      trong: "Không có ca",
    },
    chiTiet: {
      cot: ["Ngày", "Mã", "Ca / buổi", "Giờ", "Giờ làm", "Kết quả · công"],
      ds: chiTiet,
      rong: p.loc === "can-xem" ? "Không ngày nào cần xử lý." : "Chưa có ca hay buổi dạy nào đã qua trong tháng này.",
    },
    phai: (
      <>
        <TheHuongDan
          tieuDe="Quét thế nào để đủ công?"
          muc={[
            ["Mỗi ca", "Quét vào khi bắt đầu và quét ra khi hết ca."],
            ["Ca hai buổi", "Quét vào / ra cho từng buổi (sáng, chiều)."],
            ["Quên quét / bị tính sai", "Gửi đơn chỉnh công kèm giờ thật, quản lý duyệt."],
          ]}
        />
        <TheMa
          tieuDe="Mã trong lưới"
          ma={[...maDung, ...(coDay ? ([["DẠY", "Buổi dạy lớp"]] as [string, string][]) : [])]}
        />
        {p.congDay.length > 0 && (
          <TheDanhSach
            tieuDe="Công dạy"
            dem={p.congDay.reduce((a, d) => a + d.buoi, 0)}
            ds={p.congDay.map((d) => ({
              key: d.name,
              tren: d.name,
              duoi: d.tinhVaoKy ? `${so(d.cong)} công` : "không cộng vào công",
              chip: <ChipKetQua mau="XAM">{d.buoi} buổi</ChipKetQua>,
            }))}
          />
        )}
        <TheDanhSach tieuDe="Đơn từ trong tháng" dem={p.donTu.length} ds={p.donTu} rong="Chưa có đơn nào cho tháng này." />
        {p.khoanTru}
        {p.dieuChinh}
        <TheXemThem />
      </>
    ),
  };
  return { m, soCanXem: canXemDs.length, dem: { canXem: canXem.length, phanAnh: null, tatCa: daQua.length } };
}
