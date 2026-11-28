// Lịch làm việc › Danh sách (site GV) — các buổi quản lý cơ sở đã phân cho MÌNH, chia tab Sắp tới · Hôm nay · Đã qua · Cần xử lý · Đối soát.
// Thay màn "Công việc của tôi" (`/teacher/phan-cong`, gỡ khỏi menu 09/11/2026). Dữ liệu đọc một lần ở trang Lịch qua
// `docDanhSachCongViec` (CHÍNH các loader của màn cũ) — component này chỉ VẼ. Câu chữ trung tính: phân công có hiệu lực ngay, không phải
// bấm nhận; lời mời cũ (trước 20/10/2026) nếu còn thì tab "Cần xác nhận" hiện ra, có nút nhận / từ chối như cũ.
// Màn này KHÔNG tính công hay tiền (Đối soát chỉ để đối chiếu người đứng lớp).
import Link from "next/link";
import { CalendarCheck2, CalendarDays, ClipboardCheck, History, Inbox, Scale, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SO_NGAY_DA_QUA, SO_NGAY_SAP_TOI } from "@/lib/parttime/cong-viec";
import type { PhanCongCuaToi } from "@/lib/parttime/bang-phan-cong";
import type { NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { MA_TAB_LICH, NHAN_TAB_LICH, type DanhSachCongViec, type HoSoCuaToi, type MaTabLich } from "@/lib/parttime/danh-sach-cong-viec-db";
import { HoSoBuoi } from "@/components/cham-cong/ho-so-buoi";
import { EmptyState } from "../../_components/ui/empty-state";
import { DongThongTin, NhanVai, NhomCho, ONgayNho, ThayDoi } from "../../phan-cong/_components/nhom-cho";
import { NhanTruc } from "../../phan-cong/thang/_components/nhan-truc";

const RONG: Record<MaTabLich, { title: string; description?: string; icon: LucideIcon }> = {
  "can-xac-nhan": { icon: Inbox, title: "Không có lời mời nào chờ bạn xác nhận." },
  "sap-toi": { icon: CalendarDays, title: `Chưa có buổi nào được phân trong ${SO_NGAY_SAP_TOI} ngày tới.` },
  "hom-nay": {
    icon: CalendarCheck2,
    title: "Hôm nay bạn không có buổi nào được phân.",
    description: "Buổi được phân hôm nay hiện ở đây cùng giờ có mặt, cơ sở và phòng.",
  },
  "da-qua": { icon: History, title: `Chưa có buổi nào được phân trong ${SO_NGAY_DA_QUA} ngày qua.` },
  "can-xu-ly": {
    icon: ClipboardCheck,
    title: "Không có buổi nào cần xử lý.",
    description: "Buổi đã qua còn thiếu điểm danh, nhận xét hoặc lượt quét sẽ hiện ở đây. Xử lý xong buổi tự rời khỏi danh sách.",
  },
  "doi-soat": {
    icon: Scale,
    title: "Không có buổi nào cần đối soát.",
    description: "Buổi bạn được phân đứng chính mà người được ghi nhận đứng lớp lại là người khác sẽ hiện ở đây để bạn báo quản lý nếu sai.",
  },
};

const MO_TA: Partial<Record<MaTabLich, string>> = {
  "sap-toi": `Từ ngày mai đến ${SO_NGAY_SAP_TOI} ngày tới.`,
  "da-qua": `${SO_NGAY_DA_QUA} ngày gần nhất · mỗi buổi kèm hồ sơ buổi và trạng thái chấm công.`,
  "can-xu-ly": "Buổi đã qua còn thiếu điểm danh, nhận xét hoặc lượt quét. Xử lý xong buổi tự rời khỏi danh sách.",
  "can-xac-nhan": "Lời mời phân công cũ (trước 20/10/2026) còn chờ bạn nhận hoặc từ chối. Phân công mới có hiệu lực ngay, không cần bấm nhận.",
};

const TONE_BC: Record<NhanBangChung["tone"], string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  success: "bg-state-success-soft text-state-success-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

const THU_DAI = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const nhanNgay = (ymd: string) => `${THU_DAI[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Đường dẫn của chính trang Lịch (chỉ query) — giữ bộ lọc toolbar đang chọn. */
export function hrefTab(tab: MaTabLich, filterQS: string): string {
  return `?view=ds&tab=${tab}${filterQS}`;
}

export function TabMacDinh(d: DanhSachCongViec): MaTabLich {
  return d.tab["can-xac-nhan"].length > 0 ? "can-xac-nhan" : "sap-toi";
}

export function CongViecDanhSach({
  d,
  tab,
  filterQS,
  caTheoNgay,
  tuNgayOCong,
}: {
  d: DanhSachCongViec;
  /** Ngày bắt đầu luật công mới ("YYYY-MM-DD", null = chưa bật) — chỉ ngày từ đây mới có ô công để phản ánh. */
  tuNgayOCong: string | null;
  tab: MaTabLich;
  filterQS: string;
  /** Nhãn ca làm của ngày (lưới ca của chính mình) — in cạnh tiêu đề ngày. */
  caTheoNgay: ReadonlyMap<string, string>;
}) {
  const dem = Object.fromEntries(MA_TAB_LICH.map((k) => [k, d.tab[k].length])) as Record<MaTabLich, number>;
  // "Cần xác nhận" là tab của LỜI MỜI CŨ — chỉ hiện khi còn (trống thì nó là một tab chết).
  const tabs = MA_TAB_LICH.filter((k) => k !== "can-xac-nhan" || dem[k] > 0);
  const ds = d.tab[tab];
  const rong = RONG[tab];
  return (
    <div className="space-y-4">
      {d.trucCho.length > 0 && (
        <section aria-labelledby="truc-cho-nhan" className="t-card space-y-3 border-state-warning-ink/30 p-4">
          <h2 id="truc-cho-nhan" className="text-sm font-semibold">
            Ca trực vận hành chờ bạn xác nhận · {d.trucCho.length}
          </h2>
          <ul className="space-y-3">
            {d.trucCho.map((t) => (
              <li key={t.dutyId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  <b className="tabular-nums">
                    {t.ngay.slice(8, 10)}/{t.ngay.slice(5, 7)}
                  </b>{" "}
                  · ca {t.shiftCode} ({t.tu}–{t.den}) — Hỗ trợ vận hành
                </p>
                <NhanTruc dutyId={t.dutyId} phienBan={t.phienBan} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto">
        <nav className="flex min-w-max gap-1 border-b border-border" aria-label="Nhóm buổi">
          {tabs.map((k) => {
            const dangChon = k === tab;
            return (
              <Link
                key={k}
                href={hrefTab(k, filterQS)}
                scroll={false}
                aria-current={dangChon ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  dangChon ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {NHAN_TAB_LICH[k]}
                {dem[k] > 0 && k !== "hom-nay" && (
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
                      k === "can-xu-ly" || k === "can-xac-nhan" ? "bg-state-warning-soft text-state-warning-ink" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {dem[k]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {MO_TA[tab] && <p className="text-xs text-muted-foreground">{MO_TA[tab]}</p>}

      {ds.length === 0 ? (
        <EmptyState icon={rong.icon} title={rong.title} description={rong.description} />
      ) : tab === "can-xac-nhan" ? (
        <div className="@container">
          <div className="grid gap-4 @min-[1100px]:grid-cols-2 @min-[2000px]:grid-cols-3">
            {gomNhom(ds).map((n) => (
              <NhomCho key={n.key} ten={n.ten} phu={n.phu} ds={n.ds} homNay={d.homNay} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {theoNgay(ds).map(([ngay, muc]) => (
            <section key={ngay} aria-label={nhanNgay(ngay)} className="space-y-2">
              <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground">
                {nhanNgay(ngay)}
                {caTheoNgay.get(ngay) && (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-ink">{caTheoNgay.get(ngay)}</span>
                )}
              </h3>
              <ul className="space-y-2.5">
                {muc.map((x) => (
                  <TheBuoi
                    key={x.id}
                    x={x}
                    homNay={d.homNay}
                    doiSoat={tab === "doi-soat"}
                    bc={d.bangChung.get(x.id)}
                    hoSo={d.hoSo.get(x.id)}
                    coOCong={tuNgayOCong !== null && x.ngay >= tuNgayOCong}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

type Nhom = { key: string; ten: string; phu: string | null; ds: PhanCongCuaToi[] };
function gomNhom(ds: PhanCongCuaToi[]): Nhom[] {
  const m = new Map<string, Nhom>();
  for (const x of ds) {
    const n = m.get(x.nhom) ?? { key: x.nhom, ten: x.tenNhom, phu: x.phu, ds: [] };
    n.ds.push(x);
    m.set(x.nhom, n);
  }
  return [...m.values()].sort((a, b) => (a.ds[0].ngay + a.ds[0].gioBatDau).localeCompare(b.ds[0].ngay + b.ds[0].gioBatDau));
}

/** Gom theo ngày, GIỮ thứ tự của tab (Sắp tới tăng dần, Đã qua giảm dần — `chiaTab` đã xếp). */
function theoNgay(ds: PhanCongCuaToi[]): [string, PhanCongCuaToi[]][] {
  const m = new Map<string, PhanCongCuaToi[]>();
  for (const x of ds) m.set(x.ngay, [...(m.get(x.ngay) ?? []), x]);
  return [...m.entries()];
}

/** Một buổi: ô ngày · tên + giờ + nơi + chấm công + hồ sơ buổi · vai / trạng thái. Hẹp thì vai xuống dưới tên. */
function TheBuoi({
  x,
  homNay,
  doiSoat,
  bc,
  hoSo,
  coOCong,
}: {
  x: PhanCongCuaToi;
  homNay: string;
  doiSoat: boolean;
  bc: NhanBangChung | undefined;
  hoSo: HoSoCuaToi | undefined;
  /** Ngày đi luật công mới ⇒ có ô công ở Bảng công. Ngày luật cũ KHÔNG vẽ lối "phản ánh ô công" (luật 12 — không có gì để phản ánh). */
  coOCong: boolean;
}) {
  return (
    <li className="t-card flex gap-3 p-3.5 sm:gap-4 sm:p-4">
      <ONgayNho ngay={x.ngay} homNay={x.ngay === homNay} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{x.tenNhom}</p>
            <p className="text-sm tabular-nums text-foreground">
              {x.gioBatDau}–{x.gioKetThuc}
              {x.phu ? <span className="text-muted-foreground"> · {x.phu}</span> : null}
            </p>
          </div>
          <NhanVai x={x} coTrangThai />
        </div>
        <DongThongTin x={x} />
        <ThayDoi x={x} />
        {bc && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Chấm công:</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold", TONE_BC[bc.tone])}>
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
              {bc.nhan}
            </span>
            <span className="sr-only">{bc.chiTiet}</span>
          </p>
        )}
        {hoSo && (
          <div className="mt-2 max-w-xl rounded-lg border border-border px-3 py-2">
            <HoSoBuoi n={hoSo.n} diemDanhHref={hoSo.diemDanh} nhanXetHref={hoSo.nhanXet} />
          </div>
        )}
        {hoSo?.canXuLy && coOCong && (
          <Link
            href={`/teacher/bang-cong?thang=${x.ngay.slice(0, 7)}#o-can-xem`}
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted pointer-coarse:min-h-11"
          >
            <TriangleAlert className="h-3.5 w-3.5 text-state-warning-ink" aria-hidden />
            Phản ánh ô công ở Bảng công
          </Link>
        )}
        {x.status === "WAITING_ACCEPTANCE" && (
          <Link
            href="?view=ds&tab=can-xac-nhan"
            scroll={false}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary-ink underline underline-offset-2"
          >
            Chưa xác nhận — mở tab Cần xác nhận
          </Link>
        )}
        {doiSoat && x.nguoiDungLop && (
          <p className="mt-2 rounded-lg bg-state-info-soft px-3 py-2 text-xs text-state-info-ink">
            Người được ghi nhận đứng lớp: <b>{x.nguoiDungLop.ten}</b>. Nếu chính bạn đã dạy buổi này, báo quản lý cơ sở để sửa — màn này không
            tính công.
          </p>
        )}
      </div>
    </li>
  );
}
