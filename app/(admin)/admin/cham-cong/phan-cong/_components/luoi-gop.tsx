"use client";
// Màn Phân công GỘP (GĐ3, docs/phan-cong-gop/KHAO-SAT.md): lưới người × ngày × buổi Sáng/Chiều/Tối. Chế độ TUẦN sửa được; chế độ THÁNG
// chỉ xem (bấm ô ⇒ nhảy về tuần đó và mở panel). KHÔNG có tiền, KHÔNG có ô số liệu đầu trang.
//
// Bố cục theo mockup chủ dự án 26/10/2026: panel là CỘT cạnh lưới (không phải modal, không phủ mờ lưới) — bấm ô khác thì panel đổi nội
// dung; ≤ 768px panel xuống dưới lưới (flex-wrap). Ba loại panel:
//   · GV × buổi — MỌI việc của cơ sở trong buổi đó (không chỉ việc của GV đang mở): lớp chính thức giao / thay / gỡ được ngay tại đây,
//     học bù / Trial chỉ xem + mở module gốc; thẻ ca trực.
//   · cả buổi ("Lớp & trực trong buổi", hàng đầu lưới) — chọn đứng chính / trợ giảng từng lớp, bật / tắt trực từng GV.
//   · cả ngày (bấm tên ngày).
// Mọi phép ghi đi qua `_actions-gop.ts`. Câu chữ / phép đếm ở `lib/phan-cong/panel-gop.ts`. Màu không bao giờ là kênh duy nhất.
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BuoiGop, DongGop, LuoiGop, OGop } from "@/lib/phan-cong/luoi-gop";
import { hetThang, ngayTheoPhamVi, type PhamVi } from "@/lib/phan-cong/giao-go";
import { giaiThichMaO, lopCungGio, tenCa, tomTatCa, vaiCua } from "@/lib/phan-cong/panel-gop";
import { datNguoiAction, datTrucAction } from "../_actions-gop";

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const THU_DAI = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const NHAN_LOAI: Record<BuoiGop["loai"], string> = { LOP: "Lớp", BU: "Học bù", TRIAL: "Trial" };
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const thu = (ymd: string) => THU[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;
const thuDai = (ymd: string) => THU_DAI[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;
const BTN = "min-h-10 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const BTN_CHINH = "min-h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

/** Liên kết module GỐC của buổi — học bù / Trial đổi người ở đó. */
function hrefGoc(b: Pick<BuoiGop, "sourceType" | "sourceId">, lopTrial: Record<string, string>): string | null {
  if (b.sourceType === "CLASS_SESSION") return `/attendance?sessionId=${encodeURIComponent(b.sourceId)}`;
  if (b.sourceType === "MAKEUP_CASE") return `/hoc-bu/case/${encodeURIComponent(b.sourceId)}`;
  const lop = lopTrial[b.sourceId];
  return lop ? `/lop-trial/${encodeURIComponent(lop)}` : null;
}

function MaO({ o, coTheGiao = false }: { o: OGop | undefined; coTheGiao?: boolean }) {
  if (!o) return <span className="text-muted-foreground/50">—</span>;
  const trong = o.ma === "X" && !o.coTrial;
  if (trong) return coTheGiao ? <span className="text-xs font-medium text-primary/70" data-ma="X">+ Giao</span> : <span className="text-muted-foreground/60" data-ma="X">·</span>;
  return (
    <span className="inline-flex items-center gap-0.5" data-ma={o.ma}>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
          o.coTrungGio
            ? "bg-state-danger-soft text-state-danger-ink"
            : o.coChuaPhong
              ? "bg-state-warning-soft text-state-warning-ink"
              : "bg-state-success-soft text-state-success-ink",
        )}
      >
        {o.ma}
        {o.coTrungGio && <span aria-label="trùng giờ"> !</span>}
        {!o.coTrungGio && o.coChuaPhong && <span aria-label="chưa có phòng"> ?</span>}
      </span>
      {o.coTrial && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">+TR</span>}
    </span>
  );
}

type Chon = { kind: "o"; userId: string; ngay: string; ca: string } | { kind: "buoi"; ngay: string; ca: string } | { kind: "ngay"; ngay: string } | null;

export function LuoiGopTuan({
  luoi,
  lopTrial,
  giaoVien,
  coSo,
  duocGhi,
  lyDoChiXem,
  tuXepBat,
  moSan,
}: {
  luoi: LuoiGop;
  lopTrial: Record<string, string>;
  giaoVien: { id: string; ten: string }[];
  coSo: string;
  /** Công tắc phân công BẬT + có quyền giao ở cơ sở này. BẮT BUỘC (luật 7) — sai là nút ghi hiện cho người không ghi được. */
  duocGhi: boolean;
  /** Câu giải thích khi chỉ xem (cơ sở chưa bật / không có quyền). null khi được ghi. */
  lyDoChiXem: string | null;
  /** Tự xếp học bù / Trial cho người trực có hiệu lực ở cơ sở (`tuXepDangBat`). BẮT BUỘC — câu "sẽ tự xếp cho GV này" chỉ đúng khi bật. */
  tuXepBat: boolean;
  /** Ô mở sẵn khi đến từ chế độ tháng (`?o=userId.ngay.ca`). */
  moSan: { userId: string; ngay: string; ca: string } | null;
}) {
  const router = useRouter();
  const [chon, datChon] = useState<Chon>(moSan ? { kind: "o", ...moSan } : null);
  const [phamVi, setPhamVi] = useState<PhamVi>("CHI_BUOI_NAY");
  const [dangGhi, batDau] = useTransition();
  const panelRef = useRef<HTMLElement>(null);
  const buoiTheoKey = useMemo(() => new Map(luoi.buoi.map((b) => [b.key, b])), [luoi.buoi]);
  const tenCua = useMemo(() => new Map([...giaoVien.map((g) => [g.id, g.ten] as const), ...luoi.dong.map((d) => [d.userId, d.ten] as const)]), [giaoVien, luoi.dong]);
  const caMau = luoi.ngays.map((n) => luoi.caTheoNgay[n]).find((x) => x) ?? ["S", "C", "T"];
  const chuaTruc = luoi.buoi.filter((b) => b.khongAiTruc);

  // Đổi ô ⇒ phạm vi về "Chỉ buổi này" (không mang "các tuần sau" của ô trước sang ô sau). Màn hẹp: panel nằm DƯỚI lưới ⇒ cuộn tới nó,
  // không thì bấm ô trông như không có gì xảy ra.
  const setChon = (c: Chon) => {
    datChon(c);
    setPhamVi("CHI_BUOI_NAY");
    if (c && typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const chay = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    batDau(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });
  const datNguoi = (b: BuoiGop, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT", userId: string | null, boUserId: string | null) =>
    chay(() => datNguoiAction({ sourceType: b.sourceType, sourceId: b.sourceId, role, userId, boUserId, phamVi: b.loai === "LOP" ? phamVi : "CHI_BUOI_NAY" }));
  const datTruc = (userId: string, ngay: string, shiftCode: string, giao: boolean) =>
    chay(() => datTrucAction({ centerId: coSo, userId, ngay, shiftCode, giao, phamVi }));

  const p: ChungPanel = { lopTrial, duocGhi, lyDoChiXem, dangGhi, tenCua, giaoVien, datNguoi, datTruc, phamVi, setPhamVi, tuXepBat, dong: luoi.dong, tatCaBuoi: luoi.buoi, dongPanel: () => setChon(null) };
  const dongChon = chon?.kind === "o" ? luoi.dong.find((d) => d.userId === chon.userId) : undefined;

  return (
    <>
      {chuaTruc.length > 0 && (
        <div role="status" className="mb-3 rounded-lg border border-state-danger bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink" data-canh-bao="khong-ai-truc">
          <b>{chuaTruc.length} buổi học bù / Trial chưa có ai trực</b> trong ca của buổi:{" "}
          {chuaTruc.slice(0, 6).map((b, i) => (
            <span key={b.key}>
              {i > 0 && " · "}
              <button type="button" className="underline underline-offset-2" onClick={() => setChon(b.ca ? { kind: "buoi", ngay: b.ngay, ca: b.ca } : { kind: "ngay", ngay: b.ngay })}>
                {NHAN_LOAI[b.loai]} {thu(b.ngay)} {dm(b.ngay)} {b.gioBatDau}
              </button>
            </span>
          ))}
          {chuaTruc.length > 6 && <> · và {chuaTruc.length - 6} buổi khác</>}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-[999_1_720px] overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[680px] border-collapse text-sm" data-luoi="phan-cong-gop">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="sticky left-0 z-10 w-28 bg-muted/40 px-2 py-2 text-left font-medium sm:w-36 sm:px-3">Giáo viên</th>
                <th className="w-14 px-1 py-2 text-left font-medium">Buổi</th>
                {luoi.ngays.map((n) => (
                  <th key={n} className="px-1 py-1 text-center font-medium">
                    <button
                      type="button"
                      onClick={() => setChon({ kind: "ngay", ngay: n })}
                      aria-pressed={chon?.kind === "ngay" && chon.ngay === n}
                      className={cn("min-h-9 w-full rounded px-1 hover:bg-muted", chon?.kind === "ngay" && chon.ngay === n && "bg-muted text-foreground")}
                      aria-label={`Buổi trong ngày ${thu(n)} ${dm(n)}`}
                    >
                      {thu(n)} <span className="tabular-nums">{dm(n)}</span>
                      {luoi.buoi.some((b) => b.ngay === n && b.khongAiTruc) && <span className="ml-1 text-state-danger-ink" aria-label="có buổi chưa ai trực">●</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-hang="lop-truc">
              {/* Mockup 26/10: MỘT hàng — mỗi ngày xếp chồng chip của những buổi CÓ việc (lớp / học bù / Trial / người trực). Buổi trống
                  không vẽ chip: giao trực cho buổi chưa có lớp thì bấm ô của giáo viên. */}
              <tr className="border-b-2 border-border bg-muted/20">
                <th colSpan={2} scope="row" className="sticky left-0 z-10 bg-muted/40 px-2 py-2 text-left align-top sm:px-3">
                  <span className="block text-xs font-semibold text-foreground">Lớp &amp; trực trong buổi</span>
                  {duocGhi && <span className="block text-[11px] font-normal text-muted-foreground">Bấm để giao cả buổi</span>}
                </th>
                {luoi.ngays.map((ngay) => {
                  const chip = (luoi.caTheoNgay[ngay] ?? [])
                    .map((ca) => ({ ca, t: tomTatCa({ buoi: luoi.buoi, ngay, ca, truc: luoi.trucTheoCa[ngay]?.[ca] ?? [] }) }))
                    .filter(({ ca, t }) => t.soLop > 0 || t.soTruc > 0 || luoi.buoi.some((b) => b.ngay === ngay && b.ca === ca));
                  return (
                    <td key={ngay} className="px-0.5 py-1 align-top">
                      {chip.length ? (
                        <div className="flex flex-col gap-1">
                          {chip.map(({ ca, t }) => {
                            const dangMo = chon?.kind === "buoi" && chon.ngay === ngay && chon.ca === ca;
                            const canh = t.thieu > 0 || t.soTruc === 0;
                            return (
                              <button
                                key={ca}
                                type="button"
                                onClick={() => setChon({ kind: "buoi", ngay, ca })}
                                aria-pressed={dangMo}
                                data-chip-buoi={`${ngay}.${ca}`}
                                aria-label={`Lớp và trực ${thu(ngay)} ${dm(ngay)} buổi ${tenCa(ca)}: ${t.soLop} lớp${t.thieu ? `, thiếu ${t.thieu}` : ""}, ${t.soTruc ? `${t.soTruc} GV trực` : "chưa ai trực"}`}
                                className={cn(
                                  "w-full rounded-md border px-1 py-1 text-center text-[11px] leading-tight hover:bg-muted",
                                  dangMo ? "border-primary bg-card ring-1 ring-primary" : canh ? "border-state-warning bg-state-warning-soft" : "border-border bg-card",
                                )}
                              >
                                <span className="block font-medium text-foreground">
                                  {tenCa(ca)} · {t.soLop} lớp
                                  {t.thieu > 0 && <span className="text-state-warning-ink"> · thiếu {t.thieu}</span>}
                                </span>
                                <span className={cn("block", t.soTruc ? "text-muted-foreground" : "text-state-warning-ink")}>{t.soTruc ? `${t.soTruc} GV trực` : "chưa ai trực"}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="block text-center text-muted-foreground/40">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
            <tbody>
              {luoi.dong.map((d) =>
                caMau.map((ca, k) => (
                  <tr key={`${d.userId}-${ca}`} className={cn(k === 0 && "border-t border-border")}>
                    {k === 0 && (
                      <td rowSpan={caMau.length} className="sticky left-0 z-10 w-28 bg-card px-2 py-2 align-top break-words sm:w-36 sm:px-3">
                        <div className="font-medium text-foreground">{d.ten}</div>
                        {d.laMuon && <div className="mt-0.5 inline-block rounded bg-state-info-soft px-1.5 text-[11px] font-medium text-state-info-ink">cơ sở khác</div>}
                      </td>
                    )}
                    <td className="px-1 py-1 text-xs font-semibold text-muted-foreground">{tenCa(ca)}</td>
                    {luoi.ngays.map((ngay) => {
                      const o = d.o[ngay]?.[ca];
                      const dangMo = chon?.kind === "o" && chon.userId === d.userId && chon.ngay === ngay && chon.ca === ca;
                      return (
                        <td key={ngay} className="px-0.5 py-0.5 text-center">
                          {o ? (
                            <button
                              type="button"
                              onClick={() => setChon({ kind: "o", userId: d.userId, ngay, ca })}
                              aria-pressed={dangMo}
                              className={cn("min-h-9 w-full rounded hover:bg-muted", dangMo && "bg-muted ring-1 ring-primary")}
                              aria-label={`${d.ten} · ${thu(ngay)} ${dm(ngay)} · ${tenCa(ca)}: ${o.ma}${o.coTrungGio ? " · trùng giờ" : ""}${o.coChuaPhong ? " · chưa có phòng" : ""}`}
                              data-o={`${d.userId}.${ngay}.${ca}`}
                            >
                              <MaO o={o} coTheGiao={duocGhi} />
                            </button>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>

        <aside
          ref={panelRef}
          aria-label="Chi tiết phân công"
          data-panel-phan-cong={chon?.kind ?? "trong"}
          className="min-w-0 flex-[1_1_360px] scroll-mt-4 rounded-xl border border-border bg-card md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto"
        >
          {chon?.kind === "o" && dongChon ? (
            <PanelGiaoVien
              key={`${chon.userId}.${chon.ngay}.${chon.ca}`}
              d={dongChon}
              ngay={chon.ngay}
              ca={chon.ca}
              khung={luoi.khungCa[chon.ngay]?.find((k) => k.ma === chon.ca) ?? null}
              o={dongChon.o[chon.ngay]?.[chon.ca]}
              buoiTheoKey={buoiTheoKey}
              buoiCuaCa={luoi.buoi.filter((b) => b.ngay === chon.ngay && b.ca === chon.ca)}
              truc={luoi.trucTheoCa[chon.ngay]?.[chon.ca] ?? []}
              {...p}
            />
          ) : chon?.kind === "buoi" ? (
            <PanelBuoi
              key={`${chon.ngay}.${chon.ca}`}
              ngay={chon.ngay}
              ca={chon.ca}
              khung={luoi.khungCa[chon.ngay]?.find((k) => k.ma === chon.ca) ?? null}
              buoi={luoi.buoi.filter((b) => b.ngay === chon.ngay && b.ca === chon.ca)}
              truc={luoi.trucTheoCa[chon.ngay]?.[chon.ca] ?? []}
              {...p}
            />
          ) : chon?.kind === "ngay" ? (
            <PanelNgay
              key={chon.ngay}
              ngay={chon.ngay}
              ca={luoi.caTheoNgay[chon.ngay] ?? caMau}
              buoi={luoi.buoi.filter((b) => b.ngay === chon.ngay)}
              truc={luoi.trucTheoCa[chon.ngay] ?? {}}
              {...p}
            />
          ) : (
            <div className="p-5 text-sm text-muted-foreground" data-panel-trong>
              <p className="font-medium text-foreground">Chọn một ô để xem và giao việc</p>
              <p className="mt-1">Bấm ô giáo viên × buổi để giao lớp, trợ giảng, ca trực. Bấm một ô ở hàng “Lớp &amp; trực trong buổi” để xếp cả buổi.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

type ChungPanel = {
  lopTrial: Record<string, string>;
  duocGhi: boolean;
  lyDoChiXem: string | null;
  dangGhi: boolean;
  tenCua: Map<string, string>;
  giaoVien: { id: string; ten: string }[];
  datNguoi: (b: BuoiGop, role: "MAIN_TEACHER" | "TEACHING_ASSISTANT", userId: string | null, boUserId: string | null) => void;
  datTruc: (userId: string, ngay: string, shiftCode: string, giao: boolean) => void;
  phamVi: PhamVi;
  setPhamVi: (p: PhamVi) => void;
  tuXepBat: boolean;
  /** Người trên lưới — chip bật / tắt trực của panel cả buổi. */
  dong: DongGop[];
  tatCaBuoi: BuoiGop[];
  /** Nút "Xong": đóng panel. */
  dongPanel: () => void;
};

function ChiXem({ lyDo }: { lyDo: string | null }) {
  return lyDo ? <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-chi-xem>{lyDo}</p> : null;
}

/** Đầu panel: kicker "Thứ Năm 29/10 · Buổi Sáng", tiêu đề, dòng phụ. */
function DauPanel({ kicker, tieuDe, phu, onDong }: { kicker: string; tieuDe: string; phu: ReactNode; onDong: () => void }) {
  return (
    <header className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground" data-kicker>
          {kicker}
        </p>
        <h2 className="mt-0.5 text-lg font-semibold text-foreground">{tieuDe}</h2>
        <p className="text-sm text-muted-foreground">{phu}</p>
      </div>
      <button type="button" onClick={onDong} aria-label="Đóng" className="grid size-10 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted">
        <X className="size-4" aria-hidden />
      </button>
    </header>
  );
}

/** Chân panel: phạm vi áp ("Chỉ buổi này" / "Buổi này + các tuần sau" tới hết THÁNG ĐANG XEM) + "Xong". */
function ChanPanel({ ngay, p }: { ngay: string; p: ChungPanel }) {
  const den = hetThang(ngay);
  // Tuần cuối tháng: "các tuần sau" không có tuần nào thêm — khoá nút thay vì để hai nút làm cùng một việc (luật 12).
  const conTuan = ngayTheoPhamVi({ ngay, phamVi: "CAC_TUAN_SAU" }).length > 1;
  return (
    // Dính đáy chỉ khi panel là cột cạnh lưới (md+); màn hẹp panel nằm dưới lưới, chân dính sẽ che 1/4 màn hình.
    <footer className="space-y-2 border-t border-border bg-card px-4 py-3 md:sticky md:bottom-0">
      {p.duocGhi && (
        <>
          <p className="text-sm font-medium text-foreground">Mỗi lần giao / gỡ áp cho</p>
          <div role="group" aria-label="Áp cho" className="grid grid-cols-2 gap-2 text-sm">
            {(
              [
                ["CHI_BUOI_NAY", "Chỉ buổi này"],
                ["CAC_TUAN_SAU", conTuan ? `Buổi này + các tuần sau (tới ${dm(den)})` : "Buổi này + các tuần sau (hết tháng)"],
              ] as const
            ).map(([v, nhan]) => (
              <button
                key={v}
                type="button"
                aria-pressed={p.phamVi === v}
                disabled={v === "CAC_TUAN_SAU" && !conTuan}
                title={v === "CAC_TUAN_SAU" && !conTuan ? `Không còn tuần nào sau ${dm(ngay)} trong tháng ${ngay.slice(5, 7)}` : undefined}
                onClick={() => p.setPhamVi(v)}
                className={cn(
                  "min-h-11 rounded-md border px-2 py-1 font-medium leading-tight disabled:cursor-not-allowed disabled:opacity-50",
                  p.phamVi === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                {nhan}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {p.phamVi === "CAC_TUAN_SAU"
              ? `Cùng thứ mỗi tuần tới ${dm(den)} (hết tháng ${ngay.slice(5, 7)}). Học bù / Trial không lặp — chỉ áp buổi này.`
              : "Chỉ đổi đúng buổi đang mở."}
          </p>
        </>
      )}
      <button type="button" onClick={p.dongPanel} className={cn(BTN_CHINH, "w-full")}>
        Xong
      </button>
    </footer>
  );
}

/** Ô chọn người cho MỘT vai của buổi lớp (panel cả buổi / cả ngày). Đổi = giao / thay; chọn "— Gỡ —" = gỡ người đang giữ. */
function ChonNguoi({ b, role, hienTai, p }: { b: BuoiGop; role: "MAIN_TEACHER" | "TEACHING_ASSISTANT"; hienTai: string | null; p: ChungPanel }) {
  const nhan = role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng";
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-muted-foreground">{nhan}</span>
      <select
        aria-label={`${nhan} — ${b.ten} ${b.gioBatDau}`}
        className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2"
        value={hienTai ?? ""}
        disabled={!p.duocGhi || !b.mo || p.dangGhi}
        onChange={(e) => {
          const moi = e.target.value || null;
          if (moi === hienTai) return;
          p.datNguoi(b, role, moi, hienTai);
        }}
      >
        <option value="">{hienTai ? "— Gỡ —" : "— Chưa có —"}</option>
        {p.giaoVien.map((g) => (
          <option key={g.id} value={g.id}>
            {g.ten}
          </option>
        ))}
        {hienTai && !p.giaoVien.some((g) => g.id === hienTai) && <option value={hienTai}>{p.tenCua.get(hienTai) ?? hienTai}</option>}
      </select>
    </label>
  );
}

function DongBuoi({ b, p, children }: { b: BuoiGop; p: ChungPanel; children: ReactNode }) {
  const href = hrefGoc(b, p.lopTrial);
  return (
    <li className="rounded-lg border border-border p-3" data-buoi={b.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-1 rounded bg-muted px-1.5 text-[11px] font-semibold">{NHAN_LOAI[b.loai]}</span>
          <span className="font-medium">{b.ten}</span>
          <span className="ml-1 tabular-nums text-muted-foreground">
            {b.gioBatDau}–{b.gioKetThuc}
            {b.phong ? ` · ${b.phong}` : " · chưa có phòng"}
          </span>
        </div>
        {href && (
          <Link href={href} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
            Mở {b.loai === "LOP" ? "buổi" : "module gốc"}
          </Link>
        )}
      </div>
      {b.khongAiTruc && (
        <p className="mt-1 text-xs font-medium text-state-danger-ink" data-khong-ai-truc>
          Không ai trực ca của buổi này — giao trực ở thẻ “Ca trực”.
        </p>
      )}
      {!b.mo && <p className="mt-1 text-xs text-muted-foreground">Buổi đã kết thúc / đã đóng — chỉ xem.</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </li>
  );
}

/** Học bù / Trial: chỉ xem — đổi người ở module gốc (ghi cả cột GV của nguồn, chốt lượt 2 điểm 2). */
function NguoiDayChiXem({ b, p }: { b: BuoiGop; p: ChungPanel }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Người dạy: </span>
      {b.main ? (p.tenCua.get(b.main.userId) ?? b.main.userId) : <span className="text-state-warning-ink">chưa có</span>}
      <span className="block text-xs text-muted-foreground">Học bù / Trial đổi người ở module gốc.</span>
    </p>
  );
}

/** Thẻ lớp chính thức trong panel GV: người đang giữ hai vai + nút giao / thay / gỡ CHO GV ĐANG MỞ. */
function TheLopChoGv({ b, userId, tenGv, p }: { b: BuoiGop; userId: string; tenGv: string; p: ChungPanel }) {
  const vai = vaiCua(userId, b);
  const ta = b.ta[0] ?? null;
  const ten = (u: string) => p.tenCua.get(u) ?? u;
  const ban = vai ? null : lopCungGio(userId, b, p.tatCaBuoi);
  const ghiDuoc = p.duocGhi && b.mo && !p.dangGhi;
  return (
    <DongBuoi b={b} p={p}>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Đứng chính</dt>
        <dd data-dung-chinh>{b.main ? ten(b.main.userId) : <span className="text-state-warning-ink">chưa có</span>}</dd>
        <dt className="text-muted-foreground">Trợ giảng</dt>
        <dd data-tro-giang>{b.ta.length ? b.ta.map((t) => ten(t.userId)).join(", ") : <span className="text-muted-foreground">—</span>}</dd>
      </dl>
      {ban && (
        <p className="text-xs font-medium text-state-warning-ink" data-ban-cung-gio>
          {tenGv} đã có {ban.ten} cùng giờ ({ban.gioBatDau}–{ban.gioKetThuc}).
        </p>
      )}
      {p.duocGhi && b.mo && (
        <div className="flex flex-wrap gap-2">
          {vai === "MAIN" ? (
            <button type="button" className={BTN} disabled={!ghiDuoc} onClick={() => p.datNguoi(b, "MAIN_TEACHER", null, userId)}>
              Gỡ đứng chính
            </button>
          ) : vai === "TA" ? (
            <button type="button" className={BTN} disabled={!ghiDuoc} onClick={() => p.datNguoi(b, "TEACHING_ASSISTANT", null, userId)}>
              Gỡ trợ giảng
            </button>
          ) : (
            <>
              {/* Bận lớp khác cùng giờ ⇒ đứng chính bị máy chủ chặn (kiểm trùng lịch GV khi ghi người dạy thay) — khoá nút, không hứa suông. */}
              <button
                type="button"
                className={BTN_CHINH}
                disabled={!ghiDuoc || !!ban}
                onClick={() => p.datNguoi(b, "MAIN_TEACHER", userId, b.main?.userId ?? null)}
              >
                {b.main ? `Đứng chính (thay ${ten(b.main.userId)})` : "Giao đứng chính"}
              </button>
              <button type="button" className={BTN} disabled={!ghiDuoc} onClick={() => p.datNguoi(b, "TEACHING_ASSISTANT", userId, ta?.userId ?? null)}>
                {ta ? `Trợ giảng (thay ${ten(ta.userId)})` : "Giao trợ giảng"}
              </button>
            </>
          )}
        </div>
      )}
    </DongBuoi>
  );
}

/** Thẻ ca trực: "Ca trực · Sáng 07:45–11:30" + giao / gỡ cho GV đang mở. */
function TheTruc({ d, ngay, ca, khung, o, truc, p }: { d: DongGop; ngay: string; ca: string; khung: { tu: string; den: string } | null; o: OGop; truc: string[]; p: ChungPanel }) {
  const dangTruc = !!o.trucId;
  const khac = truc.filter((u) => u !== d.userId).length;
  return (
    <section className="mt-4 rounded-lg border border-border p-3" data-the-truc>
      <h3 className="text-sm font-semibold">
        Ca trực · {tenCa(ca)}
        {khung && <span className="ml-1 font-normal tabular-nums text-muted-foreground">{khung.tu}–{khung.den}</span>}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span data-truc={dangTruc ? "co" : "khong"}>{dangTruc ? `${d.ten} đang trực ca này.` : `${d.ten} không trực ca này.`}</span>
        {p.duocGhi && (
          <button type="button" disabled={p.dangGhi} onClick={() => p.datTruc(d.userId, ngay, ca, !dangTruc)} className={dangTruc ? BTN : BTN_CHINH}>
            {dangTruc ? "Gỡ ca trực" : "Giao ca trực"}
          </button>
        )}
      </div>
      {/* Luật 12: câu "sẽ tự xếp" chỉ đúng khi công tắc tự xếp BẬT ở cơ sở; nhiều người trực thì máy chọn MỘT người trong số đó. */}
      {dangTruc &&
        (p.tuXepBat ? (
          <p className="mt-2 text-xs text-muted-foreground" data-tu-xep="bat">
            Đang trực → học bù / Trial book vào buổi này sẽ tự xếp cho {khac === 0 ? "GV này" : `GV này hoặc ${khac} người trực khác (máy chọn một người)`}.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground" data-tu-xep="tat">
            Tự xếp học bù / Trial đang tắt ở cơ sở này — người book vẫn chọn giáo viên tay.
          </p>
        ))}
    </section>
  );
}

function PanelGiaoVien({
  d,
  ngay,
  ca,
  khung,
  o,
  buoiTheoKey,
  buoiCuaCa,
  truc,
  ...p
}: ChungPanel & {
  d: DongGop;
  ngay: string;
  ca: string;
  khung: { tu: string; den: string } | null;
  o: OGop | undefined;
  buoiTheoKey: Map<string, BuoiGop>;
  buoiCuaCa: BuoiGop[];
  truc: string[];
}) {
  const cap = d.cap[ngay] ?? [];
  // Việc của GV trong ô mà buổi KHÔNG nằm ở buổi này của cơ sở (vd. xếp ca theo người khác chốt 11) — vẫn phải hiện, không được mất.
  const ngoai = (o?.viec ?? []).map((v) => buoiTheoKey.get(v.buoiKey)).filter((b): b is BuoiGop => !!b && !buoiCuaCa.some((x) => x.key === b.key));
  const ds = [...buoiCuaCa, ...ngoai];
  const soLop = ds.filter((b) => b.loai === "LOP").length;
  const trong = !o || (o.ma === "X" && !o.coTrial);
  return (
    <div data-panel-o>
      <DauPanel kicker={`${thuDai(ngay)} ${dm(ngay)} · Buổi ${tenCa(ca)}`} tieuDe={d.ten} phu={`${soLop} lớp trong buổi`} onDong={p.dongPanel} />
      <div className="px-4 pb-4">
        <ChiXem lyDo={p.lyDoChiXem} />
        {o ? (
          <div className="mt-3 flex items-center gap-2 text-sm" data-ma-o>
            {trong ? <span className="rounded border border-border px-2 py-0.5 text-xs font-bold text-muted-foreground">—</span> : <MaO o={o} />}
            <span>{giaiThichMaO(o)}</span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Ngày này ngoài SR.QD.238 — không có mã ô.</p>
        )}
        {o?.coTrungGio && (
          <p className="mt-2 rounded bg-state-danger-soft px-2 py-1 text-sm text-state-danger-ink" data-trung-gio>
            Trùng giờ: người này có hai việc chồng giờ (khác phòng / khác cơ sở / hai lớp chính thức).
          </p>
        )}
        {o?.coChuaPhong && (
          <p className="mt-2 rounded bg-state-warning-soft px-2 py-1 text-sm text-state-warning-ink" data-chua-phong>
            Chưa có phòng: ô có học bù / Trial chưa xếp phòng nên chưa xét được trùng giờ — xếp phòng ở màn Học bù / Lớp trải nghiệm.
          </p>
        )}

        <h3 className="mt-4 text-sm font-semibold">Phải quét trong ngày</h3>
        {cap.length ? (
          <ul className="mt-1 space-y-1 text-sm" data-cap-quet>
            {cap.map((c) => (
              <li key={c.ma} className="tabular-nums">
                <b>{c.loai === "TRUC" ? "Trực" : "Dạy"}</b> {c.tu}–{c.den} <span className="text-muted-foreground">(phủ {c.phuCa.map(tenCa).join(", ")})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground" data-cap-quet>
            Không có việc trong ngày.
          </p>
        )}

        {o && <TheTruc d={d} ngay={ngay} ca={ca} khung={khung} o={o} truc={truc} p={p} />}

        <h3 className="mt-4 text-sm font-semibold">Việc của cơ sở trong buổi</h3>
        {ds.length ? (
          <ul className="mt-2 space-y-2">
            {ds.map((b) =>
              b.loai === "LOP" ? (
                <TheLopChoGv key={b.key} b={b} userId={d.userId} tenGv={d.ten} p={p} />
              ) : (
                <DongBuoi key={b.key} b={b} p={p}>
                  <NguoiDayChiXem b={b} p={p} />
                </DongBuoi>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Cơ sở không có lớp, học bù hay Trial nào trong buổi này.</p>
        )}

      </div>
      <ChanPanel ngay={ngay} p={p} />
    </div>
  );
}

/** Panel CẢ BUỔI (hàng "Lớp & trực trong buổi"): đứng chính / trợ giảng từng lớp + chip bật / tắt trực cho từng GV. */
function PanelBuoi({ ngay, ca, khung, buoi, truc, ...p }: ChungPanel & { ngay: string; ca: string; khung: { tu: string; den: string } | null; buoi: BuoiGop[]; truc: string[] }) {
  const t = tomTatCa({ buoi, ngay, ca, truc });
  return (
    <div data-panel-buoi>
      <DauPanel
        kicker="Lớp & trực trong buổi"
        tieuDe={`${thuDai(ngay)} ${dm(ngay)} · Buổi ${tenCa(ca)}`}
        phu={`${t.soLop} lớp · ${t.thieu} thiếu đứng chính · ${t.soTruc ? `${t.soTruc} GV trực` : "chưa ai trực"}`}
        onDong={p.dongPanel}
      />
      <div className="px-4 pb-4">
        <ChiXem lyDo={p.lyDoChiXem} />
        <section className="mt-3 rounded-lg border border-border p-3" data-the-truc>
          <h3 className="text-sm font-semibold">
            Ca trực · {tenCa(ca)}
            {khung && <span className="ml-1 font-normal tabular-nums text-muted-foreground">{khung.tu}–{khung.den}</span>}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.dong.map((g) => {
              const dang = truc.includes(g.userId);
              return (
                <button
                  key={g.userId}
                  type="button"
                  aria-pressed={dang}
                  data-chip-truc={g.userId}
                  disabled={!p.duocGhi || p.dangGhi}
                  onClick={() => p.datTruc(g.userId, ngay, ca, !dang)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs font-medium disabled:cursor-not-allowed",
                    dang ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {dang ? "✓ " : ""}
                  {g.ten}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Học bù / Trial Sale book vào buổi này {p.tuXepBat ? "được hệ thống tự xếp cho người trực" : "do người book chọn giáo viên tay (tự xếp đang tắt ở cơ sở này)"}. Không ai trực = buổi đó không có người nhận.
            {p.duocGhi && " Bấm tên để bật / tắt trực."}
          </p>
        </section>
        {buoi.length ? (
          <ul className="mt-4 space-y-2">
            {buoi.map((b) => (
              <DongBuoi key={b.key} b={b} p={p}>
                {b.loai === "LOP" ? (
                  <>
                    <ChonNguoi b={b} role="MAIN_TEACHER" hienTai={b.main?.userId ?? null} p={p} />
                    <ChonNguoi b={b} role="TEACHING_ASSISTANT" hienTai={b.ta[0]?.userId ?? null} p={p} />
                  </>
                ) : (
                  <NguoiDayChiXem b={b} p={p} />
                )}
              </DongBuoi>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Cơ sở không có lớp, học bù hay Trial nào trong buổi này.</p>
        )}
      </div>
      <ChanPanel ngay={ngay} p={p} />
    </div>
  );
}

function PanelNgay({ ngay, ca, buoi, truc, ...p }: ChungPanel & { ngay: string; ca: string[]; buoi: BuoiGop[]; truc: Record<string, string[]> }) {
  const [them, setThem] = useState<Record<string, string>>({});
  return (
    <div data-panel-ngay>
      <DauPanel kicker={`${thuDai(ngay)} ${dm(ngay)}`} tieuDe="Buổi trong ngày" phu="Đổi người đứng chính / trợ giảng của buổi lớp, giao trực theo buổi. Học bù / Trial chỉ xem." onDong={p.dongPanel} />
      <div className="px-4 pb-4">
        <ChiXem lyDo={p.lyDoChiXem} />
        {ca.map((c) => {
          const ds = buoi.filter((b) => b.ca === c);
          const nguoiTruc = truc[c] ?? [];
          return (
            <section key={c} className="mt-4" data-ca={c}>
              <h3 className="text-sm font-semibold">Buổi {tenCa(c)}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Trực:</span>
                {nguoiTruc.length === 0 && <span className="text-muted-foreground">chưa ai</span>}
                {nguoiTruc.map((u) => (
                  <span key={u} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" data-chip-truc={u}>
                    {p.tenCua.get(u) ?? u}
                    {p.duocGhi && (
                      <button type="button" aria-label={`Gỡ trực ${p.tenCua.get(u) ?? u}`} disabled={p.dangGhi} onClick={() => p.datTruc(u, ngay, c, false)} className="px-0.5 font-bold">
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {p.duocGhi && (
                  <>
                    <select
                      aria-label={`Thêm người trực buổi ${tenCa(c)}`}
                      className="min-h-9 rounded-md border border-border bg-background px-2 text-xs"
                      value={them[c] ?? ""}
                      onChange={(e) => setThem((x) => ({ ...x, [c]: e.target.value }))}
                    >
                      <option value="">+ người trực…</option>
                      {p.giaoVien
                        .filter((g) => !nguoiTruc.includes(g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.ten}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!them[c] || p.dangGhi}
                      onClick={() => them[c] && p.datTruc(them[c]!, ngay, c, true)}
                      className="min-h-9 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Giao trực
                    </button>
                  </>
                )}
              </div>
              {ds.length ? (
                <ul className="mt-2 space-y-2">
                  {ds.map((b) => (
                    <DongBuoi key={b.key} b={b} p={p}>
                      {b.loai === "LOP" ? (
                        <>
                          <ChonNguoi b={b} role="MAIN_TEACHER" hienTai={b.main?.userId ?? null} p={p} />
                          <ChonNguoi b={b} role="TEACHING_ASSISTANT" hienTai={b.ta[0]?.userId ?? null} p={p} />
                        </>
                      ) : (
                        <NguoiDayChiXem b={b} p={p} />
                      )}
                    </DongBuoi>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Không có buổi.</p>
              )}
            </section>
          );
        })}
        {buoi.some((b) => b.ca == null) && (
          <section className="mt-4">
            <h3 className="text-sm font-semibold">Ngoài khung buổi</h3>
            <ul className="mt-2 space-y-2">
              {buoi
                .filter((b) => b.ca == null)
                .map((b) => (
                  <DongBuoi key={b.key} b={b} p={p}>
                    {b.loai === "LOP" ? (
                      <>
                        <ChonNguoi b={b} role="MAIN_TEACHER" hienTai={b.main?.userId ?? null} p={p} />
                        <ChonNguoi b={b} role="TEACHING_ASSISTANT" hienTai={b.ta[0]?.userId ?? null} p={p} />
                      </>
                    ) : (
                      <NguoiDayChiXem b={b} p={p} />
                    )}
                  </DongBuoi>
                ))}
            </ul>
          </section>
        )}
      </div>
      <ChanPanel ngay={ngay} p={p} />
    </div>
  );
}

/** Chế độ THÁNG — CHỈ XEM. Bấm ô ⇒ về tuần chứa ngày đó và mở panel ô (chốt GĐ3). */
export function LuoiGopThang({ luoi, hrefO }: { luoi: LuoiGop; hrefO: Record<string, string> }) {
  const caMau = luoi.ngays.map((n) => luoi.caTheoNgay[n]).find((x) => x) ?? ["S", "C", "T"];
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[960px] border-collapse text-xs" data-luoi="phan-cong-gop-thang">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="sticky left-0 z-10 w-28 bg-muted/40 px-2 py-2 text-left font-medium sm:w-40">Giáo viên</th>
            {luoi.ngays.map((n) => (
              <th key={n} className="px-0.5 py-1 text-center font-medium">
                <div>{thu(n)}</div>
                <div className="tabular-nums">{n.slice(8, 10)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {luoi.dong.map((d) => (
            <tr key={d.userId} className="border-t border-border">
              <td className="sticky left-0 z-10 bg-card px-2 py-1 font-medium">{d.ten}</td>
              {luoi.ngays.map((n) => (
                <td key={n} className="px-0.5 py-0.5 text-center align-top">
                  {d.o[n] ? (
                    <div className="flex flex-col gap-0.5">
                      {caMau.map((ca) => {
                        const o = d.o[n]?.[ca];
                        const href = hrefO[`${d.userId}.${n}.${ca}`];
                        return o && href ? (
                          <Link key={ca} href={href} className="rounded hover:bg-muted" aria-label={`${d.ten} ${dm(n)} ${tenCa(ca)}: ${o.ma}`}>
                            <MaO o={o} />
                          </Link>
                        ) : (
                          <span key={ca} className="text-muted-foreground/40">
                            —
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
