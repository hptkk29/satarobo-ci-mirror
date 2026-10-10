"use client";

// app/(admin)/admin/cham-cong/_components/day-detail-sheet.tsx — chi tiết MỘT người trong MỘT ngày.
//
// Vì sao file này tồn tại: bản cũ (`override-cell.tsx`) nhét ô nhập công + ô lý do + 3 nút vào đúng
// một ô bảng rộng ~90px, nên người rà phải gõ lý do trong một ô 40 ký tự và KHÔNG nhìn thấy thứ
// dùng để quyết định — các lượt quét trong ngày. Ở đây bấm TÊN mở panel: lượt quét, giờ, công máy
// tính, rồi mới đến ô ghi đè.
//
// Điều dễ vỡ:
//  · Mọi thứ hiển thị đã được ĐỊNH DẠNG Ở SERVER (giờ +07, "7h29"). RSC không truyền hàm sang
//    client được, nên đừng chuyển sang nhận `Date` rồi format ở đây — giờ sẽ ra theo múi của máy
//    người xem, không phải giờ VN.
//  · `setDayOverrideAction` tự kiểm quyền `hr_attendance:adjust` tại cơ sở CỦA NGÀY ĐÓ và từ chối
//    khi ngày chưa được tính. `canAdjust`/`locked`/`computed` ở đây chỉ để giấu form cho đỡ vô ích.
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FlagList } from "@/components/cham-cong/ui/flag-chip";
import {
  ShiftCodeChip,
  type ShiftSource,
} from "@/components/cham-cong/ui/shift-code-chip";
import {
  DayTypePill,
  type DayType,
} from "@/components/cham-cong/ui/day-type-pill";
import {
  BTN_DANGER,
  BTN_OUTLINE,
  BTN_PRIMARY,
  FIELD,
} from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import {
  NHAN_DA_BI_THAY,
  NHAN_VI_TRI_MOC,
  SO_MOC_TOI_DA,
  mocDienSan,
  kiemDanhSachMoc,
} from "@/lib/cham-cong/sua-gio-quet";
import {
  setDayAbsenceAction,
  setDayOverrideAction,
  suaGioQuetTayAction,
} from "../_actions";

export type DayTap = {
  /** "08:02" — giờ VN, đã format ở server. */
  time: string;
  dir: "IN" | "OUT";
  flags: string[];
  /**
   * Mốc này TỪ ĐÂU RA. Ba thứ khác nhau về căn cứ nên phải hiện khác nhau:
   *   · QUET    — máy ghi (quét QR / kiosk / dữ liệu cũ);
   *   · QUA_DON — người ghi, căn cứ là ĐƠN đã duyệt của người lao động;
   *   · SUA_TAY — người ghi, căn cứ là LÝ DO quản lý viết (không có đơn).
   */
  nguon: "QUET" | "QUA_DON" | "SUA_TAY";
  /**
   * MÃ CƠ SỞ nơi lượt quét này diễn ra ("CS1", "HO"…). null = không suy được.
   *
   * ⚠️ KHÁC với cơ sở chịu công của NGÀY. Người Hội sở quét ở CS1 thì ngày công vẫn thuộc
   * Hội sở, còn lượt quét mang "CS1". Giữ cả hai, đặt tên khác nhau (D1, 10/09/2026).
   */
  noiQuet: string | null;
  /** Tên ĐIỂM CHẤM cụ thể ("Quầy CS1"). null = lượt không gắn điểm chấm nào. */
  diemCham: string | null;
  /** Ai dựng mốc này (chỉ có với QUA_DON / SUA_TAY). */
  nguoiSua: string | null;
  /** "10:05" — lúc dựng, đã format ở server. */
  suaLuc: string | null;
  ghiChu: string | null;
  /**
   * Lượt đã được THAY bằng chỉnh tay (`reviewStatus = DISMISSED`, 06/10/2026): vẫn hiện để
   * xem lại, gạch ngang + nhãn, nhưng KHÔNG còn tính công.
   */
  daBiThay: boolean;
};

const NHAN_NGUON: Record<DayTap["nguon"], string> = {
  QUET: "máy quét",
  QUA_DON: "qua đơn",
  SUA_TAY: "sửa tay",
};

/** Ca đã xếp hôm đó — để người sửa biết giờ mình đang gõ lệch bao nhiêu so với kế hoạch. */
export type CaTrongNgay = {
  code: string;
  name: string;
  doan: { start: string; end: string; kind: string; place: string | null }[];
  /** "16:30–17:30" hoặc null. */
  nghiGiuaGio: string | null;
  /** "7h30" hoặc null. */
  gioChuan: string | null;
  congChuan: number;
};

/** Đơn đã duyệt và áp lên ĐÚNG ngày này — để không sửa chồng lên một đơn vừa duyệt. */
export type DonDaAp = {
  id: string;
  kind: string;
  nguoiDuyet: string | null;
  luc: string | null;
  ghiChu: string | null;
  /** "08:00 → 17:30" với đơn chỉnh công. */
  gioDeNghi: string | null;
};

export type DayRow = {
  userId: string;
  name: string;
  /** Ca đã xếp hôm đó (mẫu ca dùng chung). null = không xếp ca. */
  ca: CaTrongNgay | null;
  /** Đơn APPROVED có `fromDate` đúng ngày này. */
  donDaAp: DonDaAp[];
  code: string | null;
  source?: ShiftSource;
  dayType: DayType | null;
  taps: DayTap[];
  /**
   * Số ô mốc mặc định của form ghi đè: 4 khi ca khai hai cặp quét (`soCapQuetKyVong = 2`),
   * còn lại 2. Người dùng thêm/bớt cặp được.
   */
  soMocCa: 2 | 4;
  /** "7h29" / "8h00" — đã format ở server. */
  worked: string;
  expected: string;
  /** Dòng "phút theo đơn" đã duyệt (OT…) — `dongPhutDon`, dựng ở server. */
  phutDon: { nhan: string; giaTri: string }[];
  credit: number | null;
  engineCredit: number | null;
  override: boolean;
  overrideNote: string | null;
  computed: boolean;
  flags: string[];
  /** "YYYY-MM-DD" — khoá ghi của Server Action. */
  workDate: string;
  /** "T4 09/09/2026". */
  dateLabel: string;
  /** Tên khối chịu công ngày đó — in trong câu thiếu quyền. */
  blockLabel: string;
  /** Kết luận của quản lý về ngày vắng. null = chưa ai xem tới. */
  absenceStatus: "UNAUTHORISED" | "EXCUSED" | null;
  absenceNote: string | null;
};

export function DayDetailSheet({
  row,
  canAdjust,
  locked,
  kyHref,
}: {
  row: DayRow;
  canAdjust: boolean;
  locked: boolean;
  /** Đường sang màn Kỳ công của đúng kỳ/khối đang xem. */
  kyHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [units, setUnits] = useState(
    row.credit != null ? String(row.credit) : "",
  );
  const [reason, setReason] = useState(row.overrideNote ?? "");
  const [absenceNote, setAbsenceNote] = useState(row.absenceNote ?? "");

  // ── Ghi đè giờ chấm công của ngày (đảo 06/10/2026 — chủ dự án chốt GHI ĐÈ THẬT) ──
  // Nhập lại TOÀN BỘ mốc [vào 1, ra 1, vào 2, ra 2]; lượt hiện có giữ để xem nhưng thôi tính
  // công. Mở form là ĐIỀN SẴN các lượt đang tính theo thứ tự giờ (`mocDienSan`, 07/10/2026) để
  // quản lý chỉ sửa ô sai.
  const tapsConTinh = row.taps.filter((t) => !t.daBiThay);
  const [moSuaGio, setMoSuaGio] = useState(false);
  const [moc, setMoc] = useState<string[]>(() => mocDienSan(tapsConTinh, row.soMocCa).moc);
  const canhBaoDienSan = mocDienSan(tapsConTinh, row.soMocCa).canhBao;
  const [lyDoGio, setLyDoGio] = useState("");
  const [boQuaKhoa, setBoQuaKhoa] = useState(false);

  // Kiểm NGAY trên client bằng đúng hàm server dùng — nút Ghi đè chỉ sáng khi server sẽ nhận
  // (luật 12: nút chắc chắn ăn từ chối là lời hứa suông). Ngày nào cũng được: chỉ so thứ tự.
  const kiemMoc = kiemDanhSachMoc(new Date(0), moc, "GHI_DE");
  const loiMoc = kiemMoc.ok ? null : kiemMoc.error;

  const moFormGhiDe = () => {
    setMoc(mocDienSan(tapsConTinh, row.soMocCa).moc);
    setMoSuaGio(true);
  };

  const suaGio = () =>
    start(async () => {
      const r = await suaGioQuetTayAction({
        userId: row.userId,
        workDate: row.workDate,
        moc: moc.map((x) => x.trim() || null),
        lyDo: lyDoGio,
        boQuaKyDaChot: boQuaKhoa,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        "Đã ghi đè giờ của ngày — lượt cũ giữ để xem, công ngày sẽ được tính lại",
      );
      setLyDoGio("");
      setMoSuaGio(false);
      router.refresh();
    });

  /** Lượt do người dựng — tách ra để hiện thành "lịch sử sửa" riêng. */
  const lichSuSua = row.taps.filter((t) => t.nguon !== "QUET");

  const ketLuan = (status: "UNAUTHORISED" | "EXCUSED" | null) =>
    start(async () => {
      const r = await setDayAbsenceAction({
        userId: row.userId,
        workDate: row.workDate,
        status,
        note: status ? absenceNote.trim() || null : null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        status === "UNAUTHORISED"
          ? "Đã ghi nhận nghỉ không phép"
          : status === "EXCUSED"
            ? "Đã ghi nhận có lý do"
            : "Đã gỡ kết luận",
      );
      router.refresh();
    });

  // Chỉ hỏi khi ĐÁNG hỏi: ngày công thật, không một lượt quét nào — hoặc ngày đã có kết luận
  // (để còn sửa/gỡ). Bày ô này lên mọi ngày là mời người ta bấm nhầm vào ngày bình thường.
  const hoiKetLuan =
    row.dayType === "WORK" &&
    (tapsConTinh.length === 0 || row.absenceStatus !== null);

  const save = (value: number | null) =>
    start(async () => {
      const r = await setDayOverrideAction({
        userId: row.userId,
        workDate: row.workDate,
        units: value,
        note: value == null ? null : reason,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(value == null ? "Đã bỏ ghi đè" : "Đã ghi đè công");
      setOpen(false);
      router.refresh();
    });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* VÙNG BẤM = CẢ DÒNG, không chỉ chữ tên (08/09/2026).
          Trước đó cửa mở sheet chỉ là mấy chữ tên ở cột đầu, trong khi cuối dòng có một
          `ChevronRight` TRƠ — đúng vị trí quy ước "bấm để mở" mà chưa từng được nối. Người
          dùng bấm mũi tên và không có gì xảy ra (luật 12: affordance phải nói thật).

          Cách làm: `after:absolute after:inset-0` kéo vùng bấm của chính nút này phủ kín
          `<tr>` (hàng đã có `relative`). KHÔNG bọc `<tr>` trong `<button>` — HTML không cho,
          và cũng KHÔNG gắn `onClick` lên `<tr>`: hàng không nhận được focus bàn phím, còn
          nút này thì có, kèm `aria-label` rõ tên người.

          An toàn vì hàng không có phần tử tương tác nào khác (đã rà: `ShiftCodeChip`,
          `DayTypePill`, `FlagList` đều 0 nút/0 link). Thêm cái thứ hai vào hàng thì phải
          xem lại lớp phủ này, kẻo nó nuốt mất. */}
      <SheetTrigger
        aria-label={`Chi tiết ${row.name}`}
        className="block max-w-[15rem] truncate text-left font-medium text-foreground transition-colors after:absolute after:inset-0 after:content-[''] hover:underline"
        title={row.name}
      >
        {row.name}
      </SheetTrigger>

      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{row.name}</SheetTitle>
          <SheetDescription>
            {row.dateLabel} · {row.blockLabel}
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ShiftCodeChip code={row.code} source={row.source} size="sm" />
            <DayTypePill type={row.dayType} />
            <FlagList codes={row.flags} max={4} />
          </div>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          {/* CA HÔM ĐÓ — người sắp sửa giờ phải thấy kế hoạch, không thì họ đang đoán. */}
          {row.ca && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ca làm việc hôm đó
              </h3>
              <p className="text-sm font-medium text-foreground">
                {row.ca.code} · {row.ca.name}
              </p>
              {row.ca.doan.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-sm">
                  {row.ca.doan.map((d, i) => (
                    <li key={`${d.start}-${d.end}-${i}`} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono tabular-nums text-foreground">
                        {d.start}–{d.end}
                      </span>
                      <span className="text-muted-foreground">
                        {d.kind === "PAID_BREAK" ? "nghỉ giữa giờ (tính công)" : "làm việc"}
                        {d.place ? ` · ${d.place}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {row.ca.gioChuan ? `Giờ chuẩn ${row.ca.gioChuan} · ` : ""}
                {row.ca.congChuan} công
                {row.ca.nghiGiuaGio ? ` · nghỉ ${row.ca.nghiGiuaGio}` : ""}
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Lượt quét trong ngày
            </h3>
            {row.taps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Không có lượt quét nào được nhận. Công vẫn đếm theo ca đã xếp —
                lượt quét chỉ sinh cờ để quản lý rà.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {row.taps.map((t, i) => (
                  <li
                    key={`${t.time}-${t.dir}-${i}`}
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-sm",
                      t.daBiThay && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "font-mono tabular-nums text-foreground",
                        t.daBiThay && "line-through",
                      )}
                    >
                      {t.time}
                    </span>
                    <span className="text-muted-foreground">
                      {t.dir === "IN" ? "Vào" : "Ra"}
                    </span>
                    {/* NƠI QUÉT của CHÍNH lượt này — check in ở CS1 rồi check out ở CS2 là
                        hợp lệ, nên nhãn phải theo từng mốc chứ không theo cả ngày. */}
                    {t.noiQuet && (
                      <span
                        className="text-muted-foreground"
                        title={t.diemCham ?? undefined}
                      >
                        · {t.noiQuet}
                        {t.diemCham ? ` (${t.diemCham})` : ""}
                      </span>
                    )}
                    {/* NGUỒN phải hiện: một mốc do người gõ trông y hệt một lượt quét thật,
                        và người rà tiếp theo sẽ đọc nhầm "máy ghi" thành bằng chứng. */}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        t.nguon === "QUET"
                          ? "bg-muted text-muted-foreground"
                          : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                      )}
                    >
                      {NHAN_NGUON[t.nguon]}
                    </span>
                    {t.daBiThay && (
                      <span className="text-xs text-muted-foreground">{NHAN_DA_BI_THAY}</span>
                    )}
                    <FlagList codes={t.flags} max={2} />
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ĐƠN ĐÃ ÁP LÊN NGÀY NÀY — để không sửa chồng lên một đơn vừa duyệt. */}
          {row.donDaAp.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Đơn đã duyệt cho ngày này
              </h3>
              <ul className="space-y-2 text-sm">
                {row.donDaAp.map((d) => (
                  <li key={d.id} className="rounded-md border border-border p-2">
                    <p className="font-medium text-foreground">
                      {d.kind}
                      {d.gioDeNghi ? ` · ${d.gioDeNghi}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.nguoiDuyet ? `${d.nguoiDuyet} duyệt` : "Đã duyệt"}
                      {d.luc ? ` lúc ${d.luc}` : ""}
                      {d.ghiChu ? ` — ${d.ghiChu}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* LỊCH SỬ SỬA của ngày này — ai đã dựng mốc nào, lúc nào, vì sao. */}
          {lichSuSua.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Lịch sử sửa giờ
              </h3>
              <ul className="space-y-2 text-sm">
                {lichSuSua.map((t, i) => (
                  <li key={`ls-${t.time}-${t.dir}-${i}`} className="rounded-md border border-border p-2">
                    <p className="font-medium text-foreground">
                      <span className={cn("font-mono tabular-nums", t.daBiThay && "line-through")}>
                        {t.time}
                      </span>{" "}
                      {t.dir === "IN" ? "Vào" : "Ra"} · {NHAN_NGUON[t.nguon]}
                      {t.daBiThay ? ` · ${NHAN_DA_BI_THAY}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.nguoiSua ?? "—"}
                      {t.suaLuc ? ` lúc ${t.suaLuc}` : ""}
                      {t.ghiChu ? ` — ${t.ghiChu}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* GHI ĐÈ GIỜ CHẤM CÔNG (đảo 06/10/2026 — trước là "ghi thêm mốc"). */}
          {canAdjust && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ghi đè giờ chấm công
              </h3>
              {!moSuaGio ? (
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  onClick={moFormGhiDe}
                  disabled={pending}
                >
                  Ghi đè giờ vào / ra
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Nhập lại <strong>toàn bộ</strong> mốc của ngày. Các lượt hiện có được giữ lại
                    để xem nhưng <strong>không còn tính công</strong> — công ngày tính lại chỉ từ
                    các mốc dưới đây.
                  </p>
                  {/* Lượt đang tính — người ghi đè phải thấy mình đang THAY cái gì. */}
                  <div className="rounded-md bg-muted/60 p-2 text-xs">
                    <p className="mb-1 font-semibold text-foreground">Đang tính công</p>
                    {tapsConTinh.length === 0 ? (
                      <p className="text-muted-foreground">Chưa có lượt nào.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {tapsConTinh.map((t, i) => (
                          <li key={`ct-${t.time}-${i}`} className="flex flex-wrap gap-1.5">
                            <span className="font-mono tabular-nums text-foreground">{t.time}</span>
                            <span className="text-muted-foreground">
                              {t.dir === "IN" ? "Vào" : "Ra"} · {NHAN_NGUON[t.nguon]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {canhBaoDienSan && (
                    <p className="text-xs text-state-warning-ink" role="note">
                      {canhBaoDienSan}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {moc.map((v, i) => (
                      <label key={`moc-${i}`} className="text-xs text-muted-foreground">
                        {NHAN_VI_TRI_MOC[i]}
                        <input
                          type="time"
                          className={cn(FIELD, "mt-1 w-full")}
                          value={v}
                          onChange={(e) =>
                            setMoc((cu) => cu.map((x, j) => (j === i ? e.target.value : x)))
                          }
                          disabled={pending}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {moc.length < SO_MOC_TOI_DA && (
                      <button
                        type="button"
                        className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                        onClick={() => setMoc((cu) => [...cu, "", ""])}
                        disabled={pending}
                      >
                        + Thêm cặp vào/ra
                      </button>
                    )}
                    {moc.length > 2 && (
                      <button
                        type="button"
                        className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                        onClick={() => setMoc((cu) => cu.slice(0, -2))}
                        disabled={pending}
                      >
                        Bớt cặp cuối
                      </button>
                    )}
                  </div>
                  {/* Chưa gõ gì thì không mắng — nút đã tắt sẵn. */}
                  {loiMoc && moc.some((x) => x.trim()) && (
                    <p className="text-xs text-state-danger-ink" role="alert">
                      {loiMoc}
                    </p>
                  )}
                  <label className="block text-xs text-muted-foreground">
                    Lý do (bắt buộc — đây là căn cứ thay cho đơn)
                    <input
                      className={cn(FIELD, "mt-1 w-full")}
                      placeholder="Quầy hỏng sáng 09/09, có mặt đúng giờ"
                      value={lyDoGio}
                      onChange={(e) => setLyDoGio(e.target.value)}
                      disabled={pending}
                    />
                  </label>
                  {locked && (
                    <label className="flex items-start gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={boQuaKhoa}
                        onChange={(e) => setBoQuaKhoa(e.target.checked)}
                        disabled={pending}
                      />
                      <span>
                        Kỳ đã chốt sổ. Chỉ cấp Hội sở sửa được — tích ô này để vẫn ghi, bảng
                        công đã ký sẽ lệch so với số cũ.
                      </span>
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={BTN_PRIMARY}
                      onClick={suaGio}
                      disabled={pending || lyDoGio.trim().length < 5 || loiMoc !== null}
                    >
                      Ghi đè giờ chấm công của ngày
                    </button>
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      onClick={() => setMoSuaGio(false)}
                      disabled={pending}
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Công của ngày
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Giờ làm / kế hoạch</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {row.worked} / {row.expected}
              </dd>
              {row.phutDon.map((p) => (
                <Fragment key={p.nhan}>
                  <dt className="text-muted-foreground">{p.nhan}</dt>
                  <dd className="text-right font-medium tabular-nums text-foreground">{p.giaTri}</dd>
                </Fragment>
              ))}
              <dt className="text-muted-foreground">Máy tính</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {row.engineCredit ?? "—"}
              </dd>
              <dt className="text-muted-foreground">Công ghi nhận</dt>
              <dd className="text-right font-semibold tabular-nums text-foreground">
                {row.credit ?? "Chờ tính"}
              </dd>
              {row.override && (
                <>
                  <dt className="text-muted-foreground">Lý do ghi đè</dt>
                  <dd className="text-right text-foreground">
                    {row.overrideNote ?? "—"}
                  </dd>
                </>
              )}
            </dl>
          </section>

          {hoiKetLuan && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Kết luận ngày vắng
              </h3>
              {/* Vì sao cần bước này: không có lượt quét nào KHÔNG đồng nghĩa nghỉ không phép —
                  còn do quên quét, quầy hỏng, đi công tác, làm ngoài trung tâm. Chủ dự án chốt
                  không tự trừ 2% từ cờ; chỉ ngày được kết luận ở đây mới vào cột trừ nội quy. */}
              {locked ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  Kỳ đã chốt — mở lại kỳ nếu cần đổi kết luận.
                </p>
              ) : !canAdjust ? (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  Kết luận ngày vắng cần quyền{" "}
                  <code className="rounded bg-card px-1 py-0.5 font-mono text-xs">
                    hr_attendance:adjust
                  </code>{" "}
                  tại {row.blockLabel}.
                </p>
              ) : row.absenceStatus ? (
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {row.absenceStatus === "UNAUTHORISED"
                      ? "Nghỉ không phép"
                      : "Vắng có lý do"}
                  </p>
                  {row.absenceNote && (
                    <p className="mt-1 text-muted-foreground">
                      {row.absenceNote}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => ketLuan(null)}
                    className={cn(BTN_OUTLINE, "mt-3 h-8 px-3 text-xs")}
                  >
                    Gỡ kết luận
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Ngày này có ca nhưng không có lượt quét nào. Chưa kết luận
                    thì <b>không trừ đồng nào</b> — nó chỉ nằm ở cột “chờ kết
                    luận”.
                  </p>
                  <div>
                    <label
                      htmlFor={`absence-${row.userId}`}
                      className="mb-1 block text-sm font-semibold text-foreground"
                    >
                      Căn cứ
                    </label>
                    <textarea
                      id={`absence-${row.userId}`}
                      value={absenceNote}
                      onChange={(e) => setAbsenceNote(e.target.value)}
                      rows={2}
                      maxLength={300}
                      placeholder="vd: không báo, gọi không nghe / quầy hỏng, đã xác minh qua camera"
                      className={cn(FIELD, "w-full resize-y py-2 leading-snug")}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Bắt buộc khi kết luận không phép — đây là căn cứ trừ % nội
                      quy.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending || !absenceNote.trim()}
                      onClick={() => ketLuan("UNAUTHORISED")}
                      className={cn(BTN_DANGER, "h-9 px-3 text-sm")}
                    >
                      Nghỉ không phép
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => ketLuan("EXCUSED")}
                      className={cn(BTN_OUTLINE, "h-9 px-3 text-sm")}
                    >
                      Có lý do — không trừ
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Ghi đè công
            </h3>

            {locked ? (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                <p className="flex items-start gap-2">
                  <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  Kỳ đã chốt — chỉ đổi qua đơn chỉnh công hoặc mở lại kỳ.
                </p>
                <Link
                  href={kyHref}
                  className="mt-2 inline-block font-medium text-primary hover:underline"
                >
                  Sang màn Kỳ công
                </Link>
              </div>
            ) : !canAdjust ? (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Ghi đè cần quyền{" "}
                <code className="rounded bg-card px-1 py-0.5 font-mono text-xs">
                  hr_attendance:adjust
                </code>{" "}
                tại {row.blockLabel}.
              </p>
            ) : !row.computed || row.credit == null ? (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Máy chưa tính ngày này. Chờ vài phút rồi tải lại — chưa có số
                máy tính thì không có gì để ghi đè.
              </p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!reason.trim() || units === "") return;
                  save(Number(units));
                }}
              >
                <div>
                  <label
                    htmlFor={`units-${row.userId}`}
                    className="mb-1 block text-sm font-semibold text-foreground"
                  >
                    Công ghi nhận
                  </label>
                  <input
                    id={`units-${row.userId}`}
                    type="number"
                    step="0.5"
                    min="0"
                    max="3"
                    value={units}
                    autoFocus
                    onChange={(e) => setUnits(e.target.value)}
                    className={cn(FIELD, "w-24")}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Máy tính {row.engineCredit ?? "—"} công. Nhấn Enter để lưu.
                  </p>
                </div>
                <div>
                  <label
                    htmlFor={`reason-${row.userId}`}
                    className="mb-1 block text-sm font-semibold text-foreground"
                  >
                    Lý do <span className="text-state-danger-ink">*</span>
                  </label>
                  <input
                    id={`reason-${row.userId}`}
                    value={reason}
                    maxLength={300}
                    required
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Vd: quên bấm ra, đã xác nhận với quản lý"
                    className={cn(FIELD, "w-full")}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={pending || !reason.trim() || units === ""}
                    className={BTN_PRIMARY}
                  >
                    Lưu
                  </button>
                  {row.override && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => save(null)}
                      className={BTN_OUTLINE}
                    >
                      Bỏ ghi đè
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Huỷ
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
