// app/(teacher)/teacher/phan-cong/page.tsx — "Công việc của tôi" (SR.QD.238 · P2 → P3b): buổi trung tâm phân cho MÌNH.
//
// Đây là chỗ DUY NHẤT xác nhận nhận phân công — quản lý không bấm thay được. Câu chữ TRUNG TÍNH (Q7 — HR / pháp chế chưa duyệt câu
// cam kết nào): "đã xem và đồng ý nhận phân công này". Nhận = đồng ý đứng lớp / trợ giảng đúng
// buổi đó, đúng giờ đó; lịch buổi đổi thì phải nhận lại. Màn này KHÔNG tính công hay tiền (tab Đối soát chỉ để đối
// chiếu người đứng lớp, không có số công).
// Chỉ đọc phân công CỦA CHÍNH người đăng nhập (`docCongViecCuaToi` lọc theo userId của phiên). Công tắc tắt ⇒ dải thông
// báo + lối sang "Lịch làm việc" — KHÔNG dựng lịch từ nguồn thứ hai (luật 12b).
import Link from "next/link";
import { CalendarCheck, CalendarClock, CalendarDays, CalendarCheck2, ClipboardCheck, History, Inbox, Scale, type LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { vnYmd } from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { docCongViecCuaToi, type PhanCongCuaToi } from "@/lib/parttime/bang-phan-cong";
import { chiaTab, laMaTab, MA_TAB, NHAN_TAB, SO_NGAY_DA_QUA, SO_NGAY_SAP_TOI, type MaTab } from "@/lib/parttime/cong-viec";
import { hienMucCongViecCuaToi } from "@/lib/parttime/menu-parttime-db";
import { docBangChungCuaToi } from "@/lib/parttime/bang-chung-cong-db";
import { docTrucChoNhan } from "@/lib/parttime/truc-van-hanh-db";
import { NhanTruc } from "./thang/_components/nhan-truc";
import { nhanBangChung, type NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { docDichHoSo, docTuanThu } from "@/lib/parttime/tuan-thu-buoi-db";
import { duongHoSo, nhanTuanThu, type NhanTuanThu } from "@/lib/parttime/nhan-tuan-thu";
import { HoSoBuoi } from "@/components/cham-cong/ho-so-buoi";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";
import { TheDieuHuong } from "../_components/ui/the-dieu-huong";
import { DongThongTin, NhanVai, NhomCho, ONgayNho, ThayDoi } from "./_components/nhom-cho";

export const dynamic = "force-dynamic";
export const metadata = { title: "Công việc của tôi | Giáo viên Sata Robo" };


const ICON_TAB: Record<MaTab, LucideIcon> = {
  "hom-nay": CalendarClock,
  "sap-toi": CalendarDays,
  "can-xac-nhan": ClipboardCheck,
  "da-qua": History,
  "doi-soat": Scale,
};

const RONG: Record<MaTab, { title: string; description?: string; icon: LucideIcon }> = {
  "hom-nay": { icon: CalendarCheck2, title: "Hôm nay bạn không có buổi nào được phân." },
  "sap-toi": { icon: CalendarDays, title: `Chưa có buổi nào đã nhận trong ${SO_NGAY_SAP_TOI} ngày tới.` },
  "can-xac-nhan": {
    icon: Inbox,
    title: "Không có buổi nào chờ bạn xác nhận.",
    description: "Khi quản lý cơ sở phân bạn vào một buổi (đứng lớp, trợ giảng hay dạy thay), buổi sẽ hiện ở đây và bạn nhận được thông báo.",
  },
  "da-qua": { icon: History, title: `Chưa có buổi nào đã nhận trong ${SO_NGAY_DA_QUA} ngày qua.` },
  "doi-soat": {
    icon: Scale,
    title: "Không có buổi nào cần đối soát.",
    description: "Buổi bạn được phân đứng chính mà người được ghi nhận đứng lớp lại là người khác sẽ hiện ở đây để bạn báo quản lý nếu sai.",
  },
};

type Nhom = { key: string; ten: string; phu: string | null; ds: PhanCongCuaToi[] };

function gomNhom(ds: PhanCongCuaToi[]): Nhom[] {
  const m = new Map<string, Nhom>();
  for (const x of ds) {
    const n = m.get(x.nhom) ?? { key: x.nhom, ten: x.tenNhom, phu: x.phu, ds: [] };
    n.ds.push(x);
    m.set(x.nhom, n);
  }
  // Nhóm có buổi SỚM nhất lên trước — việc gấp nhất ở trên cùng.
  return [...m.values()].sort((a, b) => (a.ds[0].ngay + a.ds[0].gioBatDau).localeCompare(b.ds[0].ngay + b.ds[0].gioBatDau));
}

function TabBar({ active, dem }: { active: MaTab; dem: Record<MaTab, number> }) {
  return (
    <div className="overflow-x-auto">
      <nav className="flex min-w-max gap-1 border-b border-border" aria-label="Nhóm công việc">
        {MA_TAB.map((k) => {
          const Icon = ICON_TAB[k];
          const dangChon = k === active;
          return (
            <Link
              key={k}
              href={`?tab=${k}`}
              scroll={false}
              aria-current={dangChon ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                dangChon ? "border-primary text-primary-ink" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {NHAN_TAB[k]}
              {dem[k] > 0 && (
                <span
                  className={cn(
                    "ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
                    k === "can-xac-nhan" ? "bg-state-warning-soft text-state-warning-ink" : "bg-muted text-muted-foreground",
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
  );
}

/** Một dòng chỉ-đọc (hôm nay / sắp tới / đã qua / đối soát). */
const TONE_BC: Record<NhanBangChung["tone"], string> = {
  danger: "bg-state-danger-soft text-state-danger-ink",
  warning: "bg-state-warning-soft text-state-warning-ink",
  success: "bg-state-success-soft text-state-success-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

/** Bằng chứng chấm công của CHÍNH mình cho buổi này — cùng nhãn với màn QLCS (`nhanBangChung`). Không số công, không tiền. */
function DongBangChung({ bc }: { bc: NhanBangChung | undefined }) {
  if (!bc) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Chấm công:</span>
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold", TONE_BC[bc.tone])}>
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        {bc.nhan}
      </span>
      <span className="sr-only">{bc.chiTiet}</span>
    </p>
  );
}

/** Hồ sơ buổi của CHÍNH mình (tuân thủ) + lối tắt sang đúng màn điểm danh / nhận xét đã có. */
type HoSoCuaToi = { n: NhanTuanThu; diemDanh: string | null; nhanXet: string | null };

function DongXem({ x, homNay, doiSoat, bc, hoSo }: { x: PhanCongCuaToi; homNay: string; doiSoat: boolean; bc: NhanBangChung | undefined; hoSo: HoSoCuaToi | undefined }) {
  return (
    <li className="flex gap-3 px-4 py-3 sm:px-5">
      <ONgayNho ngay={x.ngay} homNay={x.ngay === homNay} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{x.tenNhom}</p>
            <p className="text-sm tabular-nums text-foreground">
              {x.gioBatDau}–{x.gioKetThuc}
              {x.phu ? <span className="text-muted-foreground"> · {x.phu}</span> : null}
            </p>
          </div>
          <NhanVai x={x} coTrangThai />
        </div>
        <DongThongTin x={x} />
        <ThayDoi x={x} />
        <DongBangChung bc={bc} />
        {hoSo && (
          <div className="mt-2 rounded-lg border border-border px-3 py-2">
            <HoSoBuoi n={hoSo.n} diemDanhHref={hoSo.diemDanh} nhanXetHref={hoSo.nhanXet} />
          </div>
        )}
        {x.status === "WAITING_ACCEPTANCE" && (
          <Link
            href="?tab=can-xac-nhan"
            scroll={false}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary-ink underline underline-offset-2"
          >
            Chưa xác nhận — mở tab Cần xác nhận
          </Link>
        )}
        {doiSoat && x.nguoiDungLop && (
          <p className="mt-2 rounded-lg bg-state-info-soft px-3 py-2 text-xs text-state-info-ink">
            Người được ghi nhận đứng lớp: <b>{x.nguoiDungLop.ten}</b>. Nếu chính bạn đã dạy buổi này, báo quản lý cơ sở để
            sửa — màn này không tính công.
          </p>
        )}
      </div>
    </li>
  );
}

export default async function CongViecCuaToiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const sp = await searchParams;
  const now = new Date();
  const homNay = vnYmd(now);
  const tuNgay = new Date(new Date(`${homNay}T00:00:00Z`).getTime() - SO_NGAY_DA_QUA * 86_400_000).toISOString().slice(0, 10);
  const [ds, bat, bangChung, trucCho] = await Promise.all([
    docCongViecCuaToi({ userId: session.user.id, homNay, soNgayDaQua: SO_NGAY_DA_QUA, soNgaySapToi: SO_NGAY_SAP_TOI }),
    // Phân công có bật ở CƠ SỞ LIÊN QUAN của chính người này không — CÙNG hàm quyết mục menu (layout). Trước 20/10/2026 hỏi "bật ở
    // đâu đó" ⇒ GV chỉ ở CS1 vào thẳng đường dẫn khi CS2 thí điểm không thấy dải "chưa bật", trong khi menu của họ ẩn mục này.
    hienMucCongViecCuaToi(session.user.id, homNay),
    // Bằng chứng P4 của CHÍNH mình (userId từ PHIÊN) — tới hôm nay; buổi tương lai chưa có gì để chứng minh.
    docBangChungCuaToi({ userId: session.user.id, tu: tuNgay, den: homNay, now }),
    // Trực vận hành TƯỜNG MINH đang chờ CHÍNH mình nhận (D-Q3) — cùng chỗ với buổi chờ xác nhận.
    docTrucChoNhan({ userId: session.user.id, now }),
  ]);
  // Tuân thủ buổi dạy của CHÍNH mình — đọc trên chính bằng chứng P4 vừa đọc (theo lô). Chỉ buổi đã bắt đầu có hồ sơ để xem.
  const [tuanThu, dich] = await Promise.all([docTuanThu(bangChung, now), docDichHoSo(bangChung)]);
  const hoSoTheoPc = new Map<string, HoSoCuaToi>();
  for (const [id, t] of tuanThu) {
    if (t.overallStatus === "NOT_STARTED" || t.overallStatus === "CANCELLED" || t.overallStatus === "POLICY_NOT_APPLICABLE") continue;
    const d = dich.get(id);
    hoSoTheoPc.set(id, { n: nhanTuanThu(t), diemDanh: d ? duongHoSo(d, "GIAO_VIEN", "diem-danh") : null, nhanXet: d ? duongHoSo(d, "GIAO_VIEN", "nhan-xet") : null });
  }
  const nhanTheoPc = new Map(bangChung.flatMap((r) => {
    const n = nhanBangChung(r);
    return n ? [[r.assignmentId, n] as const] : [];
  }));
  const tab = chiaTab(ds, homNay, session.user.id);
  const dem = Object.fromEntries(MA_TAB.map((k) => [k, tab[k].length])) as Record<MaTab, number>;
  const active: MaTab = laMaTab(sp.tab) ? sp.tab : dem["can-xac-nhan"] > 0 ? "can-xac-nhan" : "hom-nay";
  const rong = RONG[active];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công việc của tôi"
        subtitle="Buổi quản lý cơ sở đã gán cho bạn — có hiệu lực ngay, không cần bấm nhận. Không dạy được thì báo quản lý cơ sở. Lời mời cũ (trước 20/10/2026) nếu còn nằm ở tab Cần xác nhận."
      />

      {!bat && (
        <p className="rounded-lg border border-state-info-ink/20 bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
          <b>Trung tâm chưa bật phân công theo buổi.</b> Lịch dạy của bạn vẫn ở{" "}
          <Link href="/teacher/lich" className="font-semibold underline underline-offset-2">
            Lịch làm việc
          </Link>
          . Khi phân công được bật, các buổi cần bạn xác nhận sẽ hiện ở đây.
        </p>
      )}

      {trucCho.length > 0 && (
        <section aria-labelledby="truc-cho-nhan" className="t-card space-y-3 p-4">
          <h2 id="truc-cho-nhan" className="text-base font-semibold">Ca trực vận hành chờ bạn xác nhận · {trucCho.length}</h2>
          <ul className="space-y-3">
            {trucCho.map((t) => (
              <li key={t.dutyId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  <b className="tabular-nums">{t.ngay.slice(8, 10)}/{t.ngay.slice(5, 7)}</b> · ca {t.shiftCode} ({t.tu}–{t.den}) — Hỗ trợ vận hành
                </p>
                <NhanTruc dutyId={t.dutyId} phienBan={t.phienBan} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lối sang số tháng: THẺ bấm được (trước 20/10/2026 là một liên kết chữ lẫn trong đoạn văn — người dùng không nhận ra). */}
      <TheDieuHuong
        href="/teacher/phan-cong/thang"
        icon={CalendarCheck}
        title="Công tháng của tôi"
        description="Tiết dạy, ca trực quản lý đã xác nhận và khoản trừ (nếu có) theo tháng. Chưa phải phiếu lương."
        className="sm:max-w-xl"
      />
      {/* GĐ6 (kỳ ≥ 11/2026): ô công tính tự động theo lượt quét; ô thiếu / trễ lượt thì giáo viên phản ánh ở đây. */}
      <TheDieuHuong
        href="/teacher/phan-cong/cong-o"
        icon={ClipboardCheck}
        title="Ô công cần xem"
        description="Từ tháng 11/2026: ô đủ lượt quét được tính tự động; ô thiếu hoặc trễ lượt chờ bạn phản ánh trước khi kỳ chốt."
        className="sm:max-w-xl"
      />

      <TabBar active={active} dem={dem} />

      {tab[active].length === 0 ? (
        <EmptyState icon={rong.icon} title={rong.title} description={rong.description} />
      ) : active === "can-xac-nhan" ? (
        <div className="@container">
          {/* Chia cột theo BỀ NGANG VÙNG NỘI DUNG (container query), không theo màn hình — khung site GV có thể hẹp hơn màn. */}
          <div className="grid gap-4 @min-[1100px]:grid-cols-2 @min-[2000px]:grid-cols-3">
            {gomNhom(tab[active]).map((n) => (
              <NhomCho key={n.key} ten={n.ten} phu={n.phu} ds={n.ds} homNay={homNay} />
            ))}
          </div>
        </div>
      ) : (
        <div className="@container">
          <ul className="t-card divide-y divide-border overflow-hidden @min-[2000px]:grid @min-[2000px]:grid-cols-2 @min-[2000px]:divide-y-0">
            {tab[active].map((x) => (
              <DongXem key={x.id} x={x} homNay={homNay} doiSoat={active === "doi-soat"} bc={nhanTheoPc.get(x.id)} hoSo={hoSoTheoPc.get(x.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
