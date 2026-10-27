"use client";
// Màn Phân công GỘP (GĐ3, docs/phan-cong-gop/KHAO-SAT.md): lưới người × ngày × buổi S/C/T. Chế độ TUẦN sửa được (panel giáo viên +
// panel buổi trong ngày); chế độ THÁNG chỉ xem (bấm ô ⇒ nhảy về tuần đó và mở panel). KHÔNG có tiền, KHÔNG có ô số liệu đầu trang.
// Mọi phép ghi đi qua `_actions-gop.ts` (giao / gỡ người, giao / gỡ trực, phạm vi CHI_BUOI_NAY | CAC_TUAN_SAU).
// Học bù / Trial chỉ xem ở đây — đổi người ở module gốc (nút "Mở"). Màu không bao giờ là kênh duy nhất: mỗi cờ có chữ đi kèm.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { BuoiGop, DongGop, LuoiGop, OGop } from "@/lib/phan-cong/luoi-gop";
import type { PhamVi } from "@/lib/phan-cong/giao-go";
import { datNguoiAction, datTrucAction } from "../_actions-gop";

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const TEN_CA: Record<string, string> = { S: "Sáng", C: "Chiều", T: "Tối" };
const NHAN_LOAI: Record<BuoiGop["loai"], string> = { LOP: "Lớp", BU: "Học bù", TRIAL: "Trial" };
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const thu = (ymd: string) => THU[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;

/** Liên kết module GỐC của buổi — học bù / Trial đổi người ở đó. */
function hrefGoc(b: Pick<BuoiGop, "sourceType" | "sourceId">, lopTrial: Record<string, string>): string | null {
  if (b.sourceType === "CLASS_SESSION") return `/attendance?sessionId=${encodeURIComponent(b.sourceId)}`;
  if (b.sourceType === "MAKEUP_CASE") return `/hoc-bu/case/${encodeURIComponent(b.sourceId)}`;
  const lop = lopTrial[b.sourceId];
  return lop ? `/lop-trial/${encodeURIComponent(lop)}` : null;
}

function MaO({ o }: { o: OGop | undefined }) {
  if (!o) return <span className="text-muted-foreground/50">—</span>;
  const trong = o.ma === "X" && !o.coTrial;
  return (
    <span className="inline-flex items-center gap-0.5" data-ma={o.ma}>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
          trong
            ? "font-normal text-muted-foreground/60"
            : o.coTrungGio
              ? "bg-state-danger-soft text-state-danger-ink"
              : o.coChuaPhong
                ? "bg-state-warning-soft text-state-warning-ink"
                : "bg-state-success-soft text-state-success-ink",
        )}
      >
        {trong ? "·" : o.ma}
        {o.coTrungGio && <span aria-label="trùng giờ"> !</span>}
        {!o.coTrungGio && o.coChuaPhong && <span aria-label="chưa có phòng"> ?</span>}
      </span>
      {o.coTrial && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">+TR</span>}
    </span>
  );
}

function ChonPhamVi({ phamVi, setPhamVi, coTuanSau }: { phamVi: PhamVi; setPhamVi: (p: PhamVi) => void; coTuanSau: boolean }) {
  return (
    <fieldset className="mt-4 rounded-lg border border-border p-3 text-sm">
      <legend className="px-1 text-xs font-medium text-muted-foreground">Áp cho</legend>
      <label className="mr-4 inline-flex min-h-10 items-center gap-2">
        <input type="radio" name="phamVi" checked={phamVi === "CHI_BUOI_NAY"} onChange={() => setPhamVi("CHI_BUOI_NAY")} />
        Chỉ buổi này
      </label>
      <label className={cn("inline-flex min-h-10 items-center gap-2", !coTuanSau && "opacity-50")}>
        <input type="radio" name="phamVi" disabled={!coTuanSau} checked={phamVi === "CAC_TUAN_SAU"} onChange={() => setPhamVi("CAC_TUAN_SAU")} />
        Các tuần sau (cùng thứ, tới hết tháng sau)
      </label>
      {!coTuanSau && <p className="mt-1 text-xs text-muted-foreground">Học bù / Trial không lặp theo tuần — chỉ áp cho buổi này.</p>}
    </fieldset>
  );
}

type Chon = { kind: "o"; userId: string; ngay: string; ca: string } | { kind: "ngay"; ngay: string } | null;

export function LuoiGopTuan({
  luoi,
  lopTrial,
  giaoVien,
  coSo,
  duocGhi,
  lyDoChiXem,
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
  /** Ô mở sẵn khi đến từ chế độ tháng (`?o=userId.ngay.ca`). */
  moSan: { userId: string; ngay: string; ca: string } | null;
}) {
  const router = useRouter();
  const [chon, setChon] = useState<Chon>(moSan ? { kind: "o", ...moSan } : null);
  const [phamVi, setPhamVi] = useState<PhamVi>("CHI_BUOI_NAY");
  const [dangGhi, batDau] = useTransition();
  const buoiTheoKey = useMemo(() => new Map(luoi.buoi.map((b) => [b.key, b])), [luoi.buoi]);
  const tenCua = useMemo(() => new Map([...giaoVien.map((g) => [g.id, g.ten] as const), ...luoi.dong.map((d) => [d.userId, d.ten] as const)]), [giaoVien, luoi.dong]);
  const caMau = luoi.ngays.map((n) => luoi.caTheoNgay[n]).find((x) => x) ?? ["S", "C", "T"];
  const chuaTruc = luoi.buoi.filter((b) => b.khongAiTruc);

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

  const dongChon = chon?.kind === "o" ? luoi.dong.find((d) => d.userId === chon.userId) : undefined;
  const oChon = chon?.kind === "o" ? dongChon?.o[chon.ngay]?.[chon.ca] : undefined;

  return (
    <>
      {chuaTruc.length > 0 && (
        <div role="status" className="mb-3 rounded-lg border border-state-danger bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink" data-canh-bao="khong-ai-truc">
          <b>{chuaTruc.length} buổi học bù / Trial chưa có ai trực</b> trong ca của buổi:{" "}
          {chuaTruc.slice(0, 6).map((b, i) => (
            <span key={b.key}>
              {i > 0 && " · "}
              <button type="button" className="underline underline-offset-2" onClick={() => setChon({ kind: "ngay", ngay: b.ngay })}>
                {NHAN_LOAI[b.loai]} {thu(b.ngay)} {dm(b.ngay)} {b.gioBatDau}
              </button>
            </span>
          ))}
          {chuaTruc.length > 6 && <> · và {chuaTruc.length - 6} buổi khác</>}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] border-collapse text-sm" data-luoi="phan-cong-gop">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 w-28 bg-muted/40 px-2 py-2 text-left font-medium sm:w-44 sm:px-3">Giáo viên</th>
              <th className="w-10 px-1 py-2 text-left font-medium">Ca</th>
              {luoi.ngays.map((n) => (
                <th key={n} className="px-1 py-1 text-center font-medium">
                  <button
                    type="button"
                    onClick={() => setChon({ kind: "ngay", ngay: n })}
                    className="min-h-9 w-full rounded px-1 hover:bg-muted"
                    aria-label={`Buổi trong ngày ${thu(n)} ${dm(n)}`}
                  >
                    {thu(n)} <span className="tabular-nums">{dm(n)}</span>
                    {luoi.buoi.some((b) => b.ngay === n && b.khongAiTruc) && <span className="ml-1 text-state-danger-ink" aria-label="có buổi chưa ai trực">●</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {luoi.dong.map((d) =>
              caMau.map((ca, k) => (
                <tr key={`${d.userId}-${ca}`} className={cn(k === 0 && "border-t border-border")}>
                  {k === 0 && (
                    <td rowSpan={caMau.length} className="sticky left-0 z-10 w-28 bg-card px-2 py-2 align-top break-words sm:w-44 sm:px-3">
                      <div className="font-medium text-foreground">{d.ten}</div>
                      {d.laMuon && <div className="mt-0.5 inline-block rounded bg-state-info-soft px-1.5 text-[11px] font-medium text-state-info-ink">cơ sở khác</div>}
                    </td>
                  )}
                  <td className="px-1 py-1 text-xs font-semibold text-muted-foreground" title={TEN_CA[ca] ?? ca}>
                    {ca}
                  </td>
                  {luoi.ngays.map((ngay) => {
                    const o = d.o[ngay]?.[ca];
                    return (
                      <td key={ngay} className="px-0.5 py-0.5 text-center">
                        {o ? (
                          <button
                            type="button"
                            onClick={() => setChon({ kind: "o", userId: d.userId, ngay, ca })}
                            className="min-h-9 w-full rounded hover:bg-muted"
                            aria-label={`${d.ten} · ${thu(ngay)} ${dm(ngay)} · ca ${ca}: ${o.ma}${o.coTrungGio ? " · trùng giờ" : ""}${o.coChuaPhong ? " · chưa có phòng" : ""}`}
                            data-o={`${d.userId}.${ngay}.${ca}`}
                          >
                            <MaO o={o} />
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

      <Sheet open={chon != null} onOpenChange={(m) => !m && setChon(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {chon?.kind === "o" && dongChon && (
            <PanelGiaoVien
              d={dongChon}
              ngay={chon.ngay}
              ca={chon.ca}
              o={oChon}
              buoiTheoKey={buoiTheoKey}
              buoiCuaCa={luoi.buoi.filter((b) => b.ngay === chon.ngay && b.ca === chon.ca)}
              lopTrial={lopTrial}
              duocGhi={duocGhi}
              lyDoChiXem={lyDoChiXem}
              dangGhi={dangGhi}
              tenCua={tenCua}
              giaoVien={giaoVien}
              datNguoi={datNguoi}
              datTruc={datTruc}
              phamVi={phamVi}
              setPhamVi={setPhamVi}
            />
          )}
          {chon?.kind === "ngay" && (
            <PanelNgay
              ngay={chon.ngay}
              ca={luoi.caTheoNgay[chon.ngay] ?? caMau}
              buoi={luoi.buoi.filter((b) => b.ngay === chon.ngay)}
              truc={luoi.trucTheoCa[chon.ngay] ?? {}}
              lopTrial={lopTrial}
              duocGhi={duocGhi}
              lyDoChiXem={lyDoChiXem}
              dangGhi={dangGhi}
              tenCua={tenCua}
              giaoVien={giaoVien}
              datNguoi={datNguoi}
              datTruc={datTruc}
              phamVi={phamVi}
              setPhamVi={setPhamVi}
            />
          )}
        </SheetContent>
      </Sheet>
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
};

function ChiXem({ lyDo }: { lyDo: string | null }) {
  return lyDo ? <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-chi-xem>{lyDo}</p> : null;
}

/** Ô chọn người cho MỘT vai của buổi lớp. Đổi = giao / thay; chọn "— Gỡ —" = gỡ người đang giữ. */
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

function TheBuoi({ b, p }: { b: BuoiGop; p: ChungPanel }) {
  const href = hrefGoc(b, p.lopTrial);
  return (
    <li className="rounded-lg border border-border p-3" data-buoi={b.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
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
          Không ai trực ca của buổi này — giao trực ở mục “Trực” bên dưới.
        </p>
      )}
      {!b.mo && <p className="mt-1 text-xs text-muted-foreground">Buổi đã kết thúc / đã đóng — chỉ xem.</p>}
      <div className="mt-2 space-y-2">
        {b.loai === "LOP" ? (
          <>
            <ChonNguoi b={b} role="MAIN_TEACHER" hienTai={b.main?.userId ?? null} p={p} />
            <ChonNguoi b={b} role="TEACHING_ASSISTANT" hienTai={b.ta[0]?.userId ?? null} p={p} />
          </>
        ) : (
          <p className="text-sm">
            <span className="text-muted-foreground">Người dạy: </span>
            {b.main ? (p.tenCua.get(b.main.userId) ?? b.main.userId) : <span className="text-state-warning-ink">chưa có</span>}
            <span className="block text-xs text-muted-foreground">Học bù / Trial đổi người ở module gốc.</span>
          </p>
        )}
      </div>
    </li>
  );
}

function PanelGiaoVien({
  d,
  ngay,
  ca,
  o,
  buoiTheoKey,
  buoiCuaCa,
  ...p
}: ChungPanel & { d: DongGop; ngay: string; ca: string; o: OGop | undefined; buoiTheoKey: Map<string, BuoiGop>; buoiCuaCa: BuoiGop[] }) {
  const cap = d.cap[ngay] ?? [];
  const buoiCuaO = (o?.viec ?? []).map((v) => buoiTheoKey.get(v.buoiKey)).filter((b): b is BuoiGop => !!b);
  const coTuanSau = buoiCuaO.length === 0 || buoiCuaO.some((b) => b.loai === "LOP");
  const lopTrong = buoiCuaCa.filter((b) => b.loai === "LOP" && b.mo && b.main?.userId !== d.userId && !b.ta.some((t) => t.userId === d.userId));
  const [giaoBuoi, setGiaoBuoi] = useState("");
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {d.ten} · {thu(ngay)} {dm(ngay)} · ca {TEN_CA[ca] ?? ca}
        </SheetTitle>
        <SheetDescription>Mã ô, việc trong ô, cặp quét phải có trong ngày. Không có tiền ở màn này.</SheetDescription>
      </SheetHeader>
      <div className="px-4 pb-6">
        <ChiXem lyDo={p.lyDoChiXem} />
        {o ? (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm" data-panel-o>
            <dt className="text-muted-foreground">Mã ô</dt>
            <dd>
              <MaO o={o} />
            </dd>
            <dt className="text-muted-foreground">Tiết đứng chính / trợ giảng</dt>
            <dd className="tabular-nums">
              {o.tietD} / {o.tietTG}
            </dd>
            <dt className="text-muted-foreground">Trực quy đổi</dt>
            <dd className="tabular-nums">{o.trucId ? `${o.trucQuyDoi.toLocaleString("vi-VN")} ca` : "không trực"}</dd>
          </dl>
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

        <h3 className="mt-5 text-sm font-semibold">Cặp quét phải có trong ngày</h3>
        {cap.length ? (
          <ul className="mt-1 space-y-1 text-sm" data-cap-quet>
            {cap.map((c) => (
              <li key={c.ma} className="tabular-nums">
                <b>{c.loai === "TRUC" ? "Trực" : "Dạy"}</b> {c.tu}–{c.den} <span className="text-muted-foreground">(phủ ca {c.phuCa.join(", ")})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Không có việc trong ngày.</p>
        )}

        <h3 className="mt-5 text-sm font-semibold">Việc trong ô</h3>
        {buoiCuaO.length ? <ul className="mt-2 space-y-2">{buoiCuaO.map((b) => <TheBuoi key={b.key} b={b} p={p} />)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Chưa có việc dạy.</p>}

        {p.duocGhi && lopTrong.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <select aria-label="Chọn buổi lớp để giao" className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-2" value={giaoBuoi} onChange={(e) => setGiaoBuoi(e.target.value)}>
              <option value="">Giao vào buổi lớp trong ca…</option>
              {lopTrong.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.ten} {b.gioBatDau}–{b.gioKetThuc}
                </option>
              ))}
            </select>
            {(["MAIN_TEACHER", "TEACHING_ASSISTANT"] as const).map((role) => (
              <button
                key={role}
                type="button"
                disabled={!giaoBuoi || p.dangGhi}
                onClick={() => {
                  const b = lopTrong.find((x) => x.key === giaoBuoi);
                  if (b) p.datNguoi(b, role, d.userId, role === "MAIN_TEACHER" ? (b.main?.userId ?? null) : null);
                }}
                className="min-h-10 rounded-md border border-border px-3 font-medium hover:bg-muted disabled:opacity-50"
              >
                {role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng"}
              </button>
            ))}
          </div>
        )}

        <h3 className="mt-5 text-sm font-semibold">Trực ca {TEN_CA[ca] ?? ca}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span data-truc={o?.trucId ? "co" : "khong"}>{o?.trucId ? "Đang trực ca này." : "Không trực ca này."}</span>
          {p.duocGhi && o && (
            <button
              type="button"
              disabled={p.dangGhi}
              onClick={() => p.datTruc(d.userId, ngay, ca, !o.trucId)}
              className="min-h-10 rounded-md border border-border px-3 font-medium hover:bg-muted disabled:opacity-50"
            >
              {o.trucId ? "Gỡ trực" : "Giao trực"}
            </button>
          )}
        </div>

        {p.duocGhi && <ChonPhamVi phamVi={p.phamVi} setPhamVi={p.setPhamVi} coTuanSau={coTuanSau} />}
      </div>
    </>
  );
}

function PanelNgay({ ngay, ca, buoi, truc, ...p }: ChungPanel & { ngay: string; ca: string[]; buoi: BuoiGop[]; truc: Record<string, string[]> }) {
  const [them, setThem] = useState<Record<string, string>>({});
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          Buổi trong ngày · {thu(ngay)} {dm(ngay)}
        </SheetTitle>
        <SheetDescription>Đổi người đứng chính / trợ giảng của buổi lớp, giao trực theo ca. Học bù / Trial chỉ xem.</SheetDescription>
      </SheetHeader>
      <div className="px-4 pb-6">
        <ChiXem lyDo={p.lyDoChiXem} />
        {ca.map((c) => {
          const ds = buoi.filter((b) => b.ca === c);
          const nguoiTruc = truc[c] ?? [];
          return (
            <section key={c} className="mt-4" data-ca={c}>
              <h3 className="text-sm font-semibold">Ca {TEN_CA[c] ?? c}</h3>
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
                      aria-label={`Thêm người trực ca ${c}`}
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
              {ds.length ? <ul className="mt-2 space-y-2">{ds.map((b) => <TheBuoi key={b.key} b={b} p={p} />)}</ul> : <p className="mt-1 text-xs text-muted-foreground">Không có buổi.</p>}
            </section>
          );
        })}
        {buoi.some((b) => b.ca == null) && (
          <section className="mt-4">
            <h3 className="text-sm font-semibold">Ngoài khung ca</h3>
            <ul className="mt-2 space-y-2">
              {buoi
                .filter((b) => b.ca == null)
                .map((b) => (
                  <TheBuoi key={b.key} b={b} p={p} />
                ))}
            </ul>
          </section>
        )}
        {p.duocGhi && <ChonPhamVi phamVi={p.phamVi} setPhamVi={p.setPhamVi} coTuanSau />}
      </div>
    </>
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
                          <Link key={ca} href={href} className="rounded hover:bg-muted" aria-label={`${d.ten} ${dm(n)} ca ${ca}: ${o.ma}`}>
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
