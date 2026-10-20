"use client";

// Bảng tuần của màn Phân công buổi. Mỗi buổi một dòng (khối ngày rộng ≥ 56rem: lưới cột; hẹp hơn: khối xếp chồng — đo theo BỀ NGANG KHỐI bằng container query, không theo màn hình: ở 4K/8K khối ngày chia nhiều cột nên một khối có thể hẹp dù màn rất rộng). "Xử lý" mở một
// bảng thao tác NGAY DƯỚI dòng — không modal: QLCS đang so nhiều buổi cạnh nhau, che màn là mất ngữ cảnh.
//
// Nút chỉ hiện khi thao tác chắc chắn được nhận (luật 12): công tắc tắt / không có quyền / buổi đã đóng / buổi LEGACY ⇒
// bảng thao tác nói rõ vì sao thay vì vẽ nút ăn từ chối.
import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BellRing,
  ChevronDown,
  ClipboardCheck,
  History,
  Repeat2,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BuoiTrongTuan,
  DongPhanCong,
} from "@/lib/parttime/bang-phan-cong";
import type { NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import type { NhanTuanThu } from "@/lib/parttime/nhan-tuan-thu";
import { HoSoBuoi } from "@/components/cham-cong/ho-so-buoi";
import type { CanhBao } from "@/lib/parttime/control-tower";
import {
  BTN_DANGER,
  BTN_OUTLINE,
  BTN_PRIMARY,
  FIELD,
  PILL,
} from "@/components/admin/cham-cong/classes";
import { EmptyState } from "@/components/admin/ui/states";
import {
  datYeuCauTaAction,
  doiGvChinhAction,
  dungMacDinhAction,
  huyPhanCongAction,
  nhacLaiAction,
  phanCongAction,
} from "../_actions";
import { NHAN_TRANG_THAI, TONE_CLS, type Tone } from "./loc";

/** `bangChung`: nhãn bằng chứng chấm công P4 theo id phân công — tính ở server bằng `nhanBangChung` (một chỗ cho cả site GV). */
/** `hoSo`: hồ sơ buổi (tuân thủ) của GV đứng chính — `nhanTuanThu` ở server; null khi chưa tới giờ / huỷ / không có MAIN. */
export type BuoiHienThi = BuoiTrongTuan & { canhBao: CanhBao[]; bangChung: Record<string, NhanBangChung>; hoSo: NhanTuanThu | null };
export type NgayTrongTuan = {
  ngay: string;
  nhan: string;
  homNay: boolean;
  buoi: BuoiHienThi[];
};
type GiaoVien = { id: string; ten: string };
type Quyen = { bat: boolean; coQuyen: boolean };
type Nguon = { sourceType: BuoiTrongTuan["sourceType"]; sourceId: string };

const HOAT_DONG: Record<BuoiTrongTuan["activity"], string | null> = {
  REGULAR_CLASS: null,
  MAKEUP: "Dạy bù",
  ADVANCE: "Học vượt",
  TRIAL: "Trải nghiệm",
  SPECIAL: "Đặc biệt",
};

function Pill({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={cn(PILL, TONE_CLS[tone])}>
      {children}
    </span>
  );
}

/** Nhãn trạng thái của cả buổi — buổi đã đóng / LEGACY không mang trạng thái nhân lực. */
function TrangThaiBuoi({ b }: { b: BuoiTrongTuan }) {
  // CÙNG tình trạng với bộ đồng bộ: lớp đã huỷ / xoá / lớp trial đã huỷ cũng là "đã đóng" dù buổi vẫn SCHEDULED.
  if (b.tinhTrang === "DA_DONG")
    return <Pill tone="muted">{b.lyDoDong ?? "Buổi đã đóng"}</Pill>;
  if (b.tinhTrang === "DA_CHOT") return <Pill tone="muted">Đã kết thúc</Pill>;
  if (!b.apDung)
    return (
      <Pill tone="muted" title="Buổi trước 15/10/2026">
        Chính sách cũ
      </Pill>
    );
  const t = NHAN_TRANG_THAI[b.trangThai];
  return <Pill tone={t.tone}>{t.nhan}</Pill>;
}

function NhanXacNhan({ pc }: { pc: DongPhanCong }) {
  if (pc.daNhan) return <Pill tone="success">Đã nhận</Pill>;
  if (pc.status === "PROPOSED") return <Pill tone="muted">Đề xuất</Pill>;
  return (
    <Pill tone="warning">{pc.phienBan > 1 ? "Chờ nhận lại" : "Chờ nhận"}</Pill>
  );
}

/** Bằng chứng chấm công P4 — CHỈ để xem, chưa tính công. Chữ + biểu tượng + câu đầy đủ (không chỉ màu). */
function ChipChamCong({ n }: { n: NhanBangChung | undefined }) {
  if (!n) return null;
  return (
    <span title={n.chiTiet} className={cn(PILL, TONE_CLS[n.tone], "gap-1")}>
      <ClipboardCheck className="h-3 w-3" aria-hidden />
      <span className="sr-only">Chấm công: </span>
      {n.nhan}
      <span className="sr-only">. {n.chiTiet}</span>
    </span>
  );
}

const KIEU: Partial<Record<DongPhanCong["assignmentType"], string>> = {
  SUBSTITUTE: "Dạy thay",
  MANUAL: "Phân tay",
  // Q5 — nhập từ lịch đang chạy lúc chuyển đổi: CHƯA phải đã nhận (không xác nhận giả). Cảnh báo để QLCS nhắc / xếp lại.
  CUTOVER: "Nhập lúc chuyển đổi",
};

/** Một ô người (đứng chính / trợ giảng). */
function ONguoi({
  pc,
  trong,
  vai,
  bc,
}: {
  pc: DongPhanCong | null;
  trong: { nhan: string; tone: Tone } | null;
  vai: string;
  bc: NhanBangChung | undefined;
}) {
  return (
    <div className="min-w-0">
      <span className="block text-xs text-muted-foreground @4xl:sr-only">{vai}</span>
      {pc ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {pc.ten}
          </span>
          <NhanXacNhan pc={pc} />
          {KIEU[pc.assignmentType] && (
            <Pill tone={pc.assignmentType === "CUTOVER" ? "warning" : "info"}>{KIEU[pc.assignmentType]}</Pill>
          )}
          <ChipChamCong n={bc} />
        </div>
      ) : trong ? (
        <Pill tone={trong.tone}>{trong.nhan}</Pill>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}

function nhanYeuCauTa(b: BuoiTrongTuan): { nhan: string; tone: Tone } | null {
  switch (b.yeuCauTA) {
    case "REQUIRED":
      return { nhan: "Bắt buộc — chưa phân", tone: "danger" };
    case "OVERRIDDEN_REQUIRED":
      return { nhan: "Bắt buộc (QLCS) — chưa phân", tone: "danger" };
    default:
      return null;
  }
}

/** Lý do KHÔNG thao tác được — null là được. Một chỗ cho mọi nút của bảng thao tác. */
function lyDoKhoa(b: BuoiTrongTuan, q: Quyen): string | null {
  if (!q.bat) return "Phân công theo buổi chưa bật — màn này đang chỉ để xem.";
  if (!q.coQuyen)
    return "Bạn chỉ có quyền xem ở cơ sở này (cần quyền phân ca để phân công).";
  if (b.tinhTrang === "DA_DONG")
    return `${b.lyDoDong ?? "Buổi đã đóng"} — không phân công.`;
  if (b.tinhTrang === "DA_CHOT") return "Buổi đã kết thúc — đội hình đã khoá.";
  if (!b.apDung)
    return "Buổi trước 15/10/2026 thuộc chính sách cũ — không phân công theo SR.QD.238.";
  return null;
}

export function BangTuan({
  ngays,
  giaoVien,
  quyen,
  dangLoc,
  coLegacy,
  dungMacDinh,
}: {
  ngays: NgayTrongTuan[];
  giaoVien: GiaoVien[];
  quyen: Quyen;
  dangLoc: { nhan: string; boLoc: string } | null;
  coLegacy: boolean;
  dungMacDinh: Nguon[];
}) {
  const [mo, setMo] = useState<string | null>(null);
  const [dang, batDau] = useTransition();

  const dung = () =>
    batDau(async () => {
      const r = await dungMacDinhAction({ buoi: dungMacDinh });
      if (r.ok) toast.success(r.message ?? "Đã dựng phân công");
      else toast.error(r.error);
    });

  return (
    <div>
      {(dangLoc || dungMacDinh.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {dangLoc && (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              Đang lọc: <b className="text-foreground">{dangLoc.nhan}</b>
              <Link
                href={dangLoc.boLoc}
                className="text-xs font-medium text-primary hover:underline"
              >
                Bỏ lọc
              </Link>
            </span>
          )}
          {dungMacDinh.length > 0 && (
            <button
              type="button"
              onClick={dung}
              disabled={dang}
              className={cn(BTN_OUTLINE, "ml-auto")}
            >
              <Wand2 className="h-4 w-4" aria-hidden />
              {dang
                ? "Đang dựng…"
                : `Dựng từ giáo viên của lớp · ${dungMacDinh.length} buổi`}
            </button>
          )}
        </div>
      )}

      {ngays.length === 0 ? (
        <EmptyState
          title={
            dangLoc
              ? "Không có buổi nào khớp bộ lọc"
              : "Tuần này cơ sở chưa có buổi nào"
          }
          description={
            dangLoc
              ? "Bỏ lọc để xem cả tuần, hoặc chuyển tuần ở thanh trên."
              : "Buổi học, buổi dạy bù và buổi trải nghiệm của cơ sở sẽ hiện ở đây khi được xếp lịch."
          }
        />
      ) : (
        <div className="@container">
          <div className="grid gap-5 @min-[2200px]:grid-cols-2 @min-[3300px]:grid-cols-3">
            {ngays.map((n) => (
              <section
                key={n.ngay}
                aria-labelledby={`ngay-${n.ngay}`}
                className="@container min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              >
                <header className="flex items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <h2
                    id={`ngay-${n.ngay}`}
                    className="text-sm font-semibold text-foreground"
                  >
                    {n.nhan}
                    {n.homNay && (
                      <span
                        className={cn(
                          PILL,
                          "ml-2 bg-primary text-primary-foreground",
                        )}
                      >
                        Hôm nay
                      </span>
                    )}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {n.buoi.length} buổi
                  </span>
                </header>
                {/* Tiêu đề cột — chỉ ở ≥ lg, nơi dòng là lưới. */}
                <div className="hidden grid-cols-[5.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_6.5rem] gap-3 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground @4xl:grid">
                  <span className="whitespace-nowrap">Giờ</span>
                  <span className="whitespace-nowrap">Buổi</span>
                  <span className="whitespace-nowrap">Đứng chính</span>
                  <span className="whitespace-nowrap">Trợ giảng</span>
                  <span className="whitespace-nowrap">Trạng thái</span>
                  <span className="sr-only">Thao tác</span>
                </div>
                <ul className="divide-y divide-border">
                  {n.buoi.map((b) => (
                    <DongBuoi
                      key={b.key}
                      b={b}
                      mo={mo === b.key}
                      batTat={() => setMo(mo === b.key ? null : b.key)}
                      giaoVien={giaoVien}
                      quyen={quyen}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      {coLegacy && (
        <p className="mt-4 text-xs text-muted-foreground">
          Buổi gắn “Chính sách cũ” diễn ra trước 15/10/2026 — hiện để đối chiếu,
          không phân công theo SR.QD.238.
        </p>
      )}
    </div>
  );
}

function DongBuoi({
  b,
  mo,
  batTat,
  giaoVien,
  quyen,
}: {
  b: BuoiHienThi;
  mo: boolean;
  batTat: () => void;
  giaoVien: GiaoVien[];
  quyen: Quyen;
}) {
  const panelId = useId();
  const hd = HOAT_DONG[b.activity];
  const nhacTa = b.apDung && !b.daDong ? nhanYeuCauTa(b) : null;
  return (
    <li className={cn("transition-colors", mo && "bg-muted/30")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 @4xl:grid-cols-[5.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_8.5rem_6.5rem] @4xl:items-center @4xl:gap-3">
        <span className="col-start-1 row-start-1 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground @4xl:col-auto @4xl:row-auto">
          {b.gioBatDau}
          <span className="font-normal text-muted-foreground">
            –{b.gioKetThuc}
          </span>
        </span>
        <div className="col-span-2 min-w-0 @4xl:col-span-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {b.ten}
            </span>
            {hd && <Pill tone="info">{hd}</Pill>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[b.phu, b.phong ? `Phòng ${b.phong}` : null, b.siSo != null ? `${b.siSo} học viên` : null]
              .filter(Boolean)
              .join(" · ") || " "}
          </p>
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-3 @4xl:contents">
          <ONguoi
            vai="Đứng chính"
            pc={b.main}
            bc={b.main ? b.bangChung[b.main.id] : undefined}
            trong={
              b.apDung && !b.daDong
                ? { nhan: "Chưa phân", tone: "danger" }
                : null
            }
          />
          <ONguoi vai="Trợ giảng" pc={b.ta} trong={nhacTa} bc={b.ta ? b.bangChung[b.ta.id] : undefined} />
        </div>
        <span className="col-start-2 row-start-1 justify-self-end @4xl:col-auto @4xl:row-auto @4xl:justify-self-start">
          <TrangThaiBuoi b={b} />
        </span>
        <button
          type="button"
          onClick={batTat}
          aria-expanded={mo}
          aria-controls={panelId}
          className={cn(
            BTN_OUTLINE,
            "col-span-2 h-9 justify-center px-3 pointer-coarse:h-11 @4xl:col-span-1",
          )}
        >
          Xử lý
          {b.canhBao.length > 0 && (
            <span className="sr-only">
              {` — ${b.canhBao.length} cảnh báo`}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-150",
              mo && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>
      {b.hoSo && (
        // Hồ sơ buổi của GV đứng chính: KHÔNG có lối tắt điểm danh / nhận xét ở đây — QLCS không ghi hộ (cổng người đứng lớp).
        <div className="-mt-1 px-4 pb-2">
          <HoSoBuoi n={b.hoSo} gon />
        </div>
      )}
      {b.canhBao.length > 0 && (
        <ul
          aria-label="Cảnh báo của buổi"
          className="-mt-1 flex flex-wrap gap-1.5 px-4 pb-3"
        >
          {b.canhBao.map((c) => (
            <li key={c.ma}>
              <span className={cn(PILL, TONE_CLS[c.muc], "gap-1")}>
                <TriangleAlert className="h-3 w-3" aria-hidden />
                {c.nhan}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mo && (
        <div
          id={panelId}
          className="border-t border-dashed border-border px-4 pb-4 pt-3"
        >
          <BangThaoTac b={b} giaoVien={giaoVien} quyen={quyen} />
        </div>
      )}
    </li>
  );
}

function BangThaoTac({
  b,
  giaoVien,
  quyen,
}: {
  b: BuoiTrongTuan;
  giaoVien: GiaoVien[];
  quyen: Quyen;
}) {
  const khoa = lyDoKhoa(b, quyen);
  const nguon: Nguon = { sourceType: b.sourceType, sourceId: b.sourceId };
  return (
    <div className="space-y-4">
      {khoa && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {khoa}
        </p>
      )}
      {!khoa && (
        <div className="grid gap-4 md:grid-cols-2">
          <KhoiVai
            tieuDe="Giáo viên đứng chính"
            role="MAIN_TEACHER"
            pc={b.main}
            nguon={nguon}
            giaoVien={giaoVien.filter((g) => g.id !== b.ta?.userId)}
            macDinhId={b.macDinhMainId}
            nhanMacDinh={b.macDinhMainKieu === "SUBSTITUTE" ? " (dạy thay của buổi)" : " (của lớp)"}
          />
          <KhoiVai
            tieuDe="Trợ giảng"
            role="TEACHING_ASSISTANT"
            pc={b.ta}
            nguon={nguon}
            giaoVien={giaoVien.filter((g) => g.id !== b.main?.userId)}
            macDinhId={b.macDinhTaId}
            nhanMacDinh=" (của lớp)"
          />
        </div>
      )}
      {!khoa && b.classId && (
        <YeuCauTa classId={b.classId} hienTai={b.yeuCauTA} siSo={b.siSo} />
      )}
      {b.lichSu.length > 0 && <LichSu ds={b.lichSu} />}
    </div>
  );
}

function KhoiVai({
  tieuDe,
  role,
  pc,
  nguon,
  giaoVien,
  macDinhId,
  nhanMacDinh,
}: {
  tieuDe: string;
  role: "MAIN_TEACHER" | "TEACHING_ASSISTANT";
  pc: DongPhanCong | null;
  nguon: Nguon;
  giaoVien: GiaoVien[];
  macDinhId: string | null;
  nhanMacDinh: string;
}) {
  const [nguoi, setNguoi] = useState(pc ? "" : (macDinhId ?? ""));
  const [lyDo, setLyDo] = useState("");
  const [cheDo, setCheDo] = useState<"doi" | "huy" | null>(null);
  const [dang, batDau] = useTransition();
  const idChon = useId();
  const idLyDo = useId();

  const chay = (
    fn: () => Promise<
      { ok: true; message?: string } | { ok: false; error: string }
    >,
  ) =>
    batDau(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Đã lưu");
        setCheDo(null);
        setLyDo("");
      } else toast.error(r.error);
    });

  const chon = (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={idChon} className="text-xs text-muted-foreground">
        {pc ? "Người thay" : "Chọn người"}
      </label>
      <select
        id={idChon}
        value={nguoi}
        onChange={(e) => setNguoi(e.target.value)}
        className={cn(FIELD, "w-full min-w-0 pointer-coarse:h-11")}
      >
        <option value="">— Chọn giáo viên —</option>
        {giaoVien.map((g) => (
          <option key={g.id} value={g.id} disabled={g.id === pc?.userId}>
            {g.ten}
            {g.id === macDinhId ? nhanMacDinh : ""}
          </option>
        ))}
      </select>
    </div>
  );
  const oLyDo = (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={idLyDo} className="text-xs text-muted-foreground">
        Lý do (gửi kèm thông báo)
      </label>
      <input
        id={idLyDo}
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        maxLength={500}
        placeholder="Tối thiểu 5 ký tự"
        aria-invalid={lyDo.length > 0 && lyDo.trim().length < 5}
        className={cn(FIELD, "w-full pointer-coarse:h-11")}
      />
    </div>
  );
  const lyDoDu = lyDo.trim().length >= 5;

  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{tieuDe}</h3>
      {!pc ? (
        <div className="space-y-2">
          {chon}
          <button
            type="button"
            disabled={!nguoi || dang}
            onClick={() =>
              chay(() => phanCongAction({ ...nguon, userId: nguoi, role }))
            }
            className={cn(BTN_PRIMARY, "pointer-coarse:h-11")}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            {dang ? "Đang phân…" : "Phân công"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
            <b className="font-medium">{pc.ten}</b>
            <NhanXacNhan pc={pc} />
          </p>
          {cheDo === null && (
            <div className="flex flex-wrap gap-2">
              {role === "MAIN_TEACHER" && (
                <button
                  type="button"
                  onClick={() => setCheDo("doi")}
                  className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}
                >
                  <Repeat2 className="h-4 w-4" aria-hidden />
                  Đổi người
                </button>
              )}
              <button
                type="button"
                onClick={() => setCheDo("huy")}
                className={cn(BTN_DANGER, "pointer-coarse:h-11")}
              >
                <UserMinus className="h-4 w-4" aria-hidden />
                Huỷ phân công
              </button>
              {pc.status === "WAITING_ACCEPTANCE" && (
                <button
                  type="button"
                  disabled={dang}
                  onClick={() =>
                    chay(() => nhacLaiAction({ assignmentId: pc.id }))
                  }
                  className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}
                >
                  <BellRing className="h-4 w-4" aria-hidden />
                  {dang ? "Đang gửi…" : "Gửi lại nhắc"}
                </button>
              )}
            </div>
          )}
          {cheDo === "doi" && (
            <div className="space-y-2">
              {chon}
              {oLyDo}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!nguoi || !lyDoDu || dang}
                  onClick={() =>
                    chay(() =>
                      doiGvChinhAction({ ...nguon, userId: nguoi, lyDo }),
                    )
                  }
                  className={cn(BTN_PRIMARY, "pointer-coarse:h-11")}
                >
                  {dang ? "Đang đổi…" : "Đổi giáo viên"}
                </button>
                <button
                  type="button"
                  onClick={() => setCheDo(null)}
                  className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}
                >
                  Thôi
                </button>
              </div>
            </div>
          )}
          {cheDo === "huy" && (
            <div className="space-y-2">
              {oLyDo}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!lyDoDu || dang}
                  onClick={() =>
                    chay(() => huyPhanCongAction({ assignmentId: pc.id, lyDo }))
                  }
                  className={cn(BTN_DANGER, "pointer-coarse:h-11")}
                >
                  {dang ? "Đang huỷ…" : "Xác nhận huỷ"}
                </button>
                <button
                  type="button"
                  onClick={() => setCheDo(null)}
                  className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}
                >
                  Thôi
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NHAN_YC: Record<BuoiTrongTuan["yeuCauTA"], string> = {
  REQUIRED: "Bắt buộc theo quy định",
  OPTIONAL: "Không bắt buộc",
  OVERRIDDEN_REQUIRED: "Bắt buộc — quản lý cơ sở quyết",
  OVERRIDDEN_OPTIONAL: "Không bắt buộc — quản lý cơ sở quyết",
};

function YeuCauTa({
  classId,
  hienTai,
  siSo,
}: {
  classId: string;
  hienTai: BuoiTrongTuan["yeuCauTA"];
  siSo: number | null;
}) {
  const batBuoc = hienTai === "REQUIRED" || hienTai === "OVERRIDDEN_REQUIRED";
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const idLyDo = useId();
  const doi = () =>
    batDau(async () => {
      const r = await datYeuCauTaAction({
        classId,
        taRequired: !batBuoc,
        lyDo,
      });
      if (r.ok) {
        toast.success(r.message ?? "Đã lưu");
        setMo(false);
        setLyDo("");
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <span className="text-muted-foreground">Trợ giảng cho lớp này:</span>
      <b className="font-medium text-foreground">{NHAN_YC[hienTai]}</b>
      {siSo != null && (
        <span className="text-xs text-muted-foreground">({siSo} học viên)</span>
      )}
      {!mo ? (
        <button
          type="button"
          onClick={() => setMo(true)}
          className="ml-auto text-xs font-medium text-primary hover:underline pointer-coarse:min-h-11"
        >
          {batBuoc ? "Đặt thành không bắt buộc" : "Đặt thành bắt buộc"}
        </button>
      ) : (
        <div className="flex w-full flex-wrap items-end gap-2">
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <label htmlFor={idLyDo} className="text-xs text-muted-foreground">
              Lý do — áp cho MỌI buổi của lớp
            </label>
            <input
              id={idLyDo}
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              maxLength={500}
              placeholder="Tối thiểu 5 ký tự"
              className={cn(FIELD, "pointer-coarse:h-11")}
            />
          </div>
          <button
            type="button"
            disabled={lyDo.trim().length < 5 || dang}
            onClick={doi}
            className={cn(BTN_PRIMARY, "pointer-coarse:h-11")}
          >
            {dang ? "Đang lưu…" : "Lưu"}
          </button>
          <button
            type="button"
            onClick={() => setMo(false)}
            className={cn(BTN_OUTLINE, "pointer-coarse:h-11")}
          >
            Thôi
          </button>
        </div>
      )}
    </div>
  );
}

const NHAN_KET_THUC: Partial<
  Record<DongPhanCong["status"], { nhan: string; tone: Tone }>
> = {
  DECLINED: { nhan: "Từ chối", tone: "danger" },
  CANCELLED: { nhan: "Đã huỷ", tone: "muted" },
  REPLACED: { nhan: "Bị thay", tone: "muted" },
};

function LichSu({ ds }: { ds: DongPhanCong[] }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" aria-hidden />
        Đã kết thúc
      </h3>
      <ul className="space-y-1 text-sm">
        {ds.map((x) => {
          const t = NHAN_KET_THUC[x.status] ?? {
            nhan: x.status,
            tone: "muted" as Tone,
          };
          return (
            <li
              key={x.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
            >
              <span className="text-foreground">{x.ten}</span>
              <span className="text-xs text-muted-foreground">
                {x.role === "MAIN_TEACHER" ? "đứng chính" : "trợ giảng"}
              </span>
              <Pill tone={t.tone}>{t.nhan}</Pill>
              {x.status === "DECLINED" && x.lyDoTuChoi && (
                <span className="min-w-0 text-xs text-muted-foreground">
                  “{x.lyDoTuChoi}”
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
