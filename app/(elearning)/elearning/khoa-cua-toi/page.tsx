import Link from "next/link";
import { CalendarX, ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napDanhSachKhoaCuaToi } from "@/lib/elearning/course-view";
import { daXong, dongHanCuaBan, ngayDayDu, ngayNgan, trangThaiHienThi } from "@/lib/elearning/dashboard-pure";
import {
  BIET_DANH_TT,
  MA_TAB_KHOA,
  SAP_XEP_TAB,
  TAB_KHOA,
  TAB_MAC_DINH,
  docSapXepTab,
  locSapXepTheoTab,
  moTaPhuKhoa,
  nhomMauCuaKhoa,
  type KhoaDong,
} from "@/lib/elearning/khoa-cua-toi-tab";
import { OVERDUE_LOCKED_MESSAGE } from "@/lib/elearning/due-lock";
import { hrefTab, tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { EmptyState } from "@/components/admin/ui/states";
import { DanhSachDuLieu, type CotDuLieu } from "../_components/ui/danh-sach-du-lieu";
import { TabNav } from "../_components/ui/tab-nav";
import { ChamTrangThai } from "../_components/ui/trang-thai-nhom";
import { ChonTuGui } from "../_components/ui/chon-tu-gui";
import { NHAN_O, NUT_PHU, NUT_PHU_NHO, O_NHAP } from "../_components/ui/nut";
import { TienDoDam } from "../_components/ui/tien-do";

/**
 * KHOÁ CỦA TÔI — 3 tab theo URL (`?tab=can-lam|qua-han|da-xong`), mỗi tab mở thẳng được. Liên kết cũ `?tt=` (Tổng quan,
 * thông báo, chuông) vẫn đúng nhờ `BIET_DANH_TT`.
 *
 * Mọi trạng thái nằm trên URL; trang chạy được KHÔNG cần JavaScript. Dữ liệu từ `napDanhSachKhoaCuaToi` (3 truy vấn cố định) —
 * cùng nguồn `nhomHan` với KPI ở Tổng quan nên số "quá hạn" hai nơi không thể lệch.
 *
 * ⚠️ Quá hạn: KHÔNG có nút "Học ngay" (Q6/B-02 chưa chốt). Lời trên tab nói đúng `due-lock.ts`, không lời hứa hơn mã.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khoá của tôi | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const DUONG_DAN = "/elearning/khoa-cua-toi";

function mot(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function hrefTrang(tab: string, q: string, sx: string, p: number): string {
  const u = hrefTab(DUONG_DAN, tab, { q, sx: sx !== "han" ? sx : undefined });
  return p > 1 ? `${u}&p=${p}` : u;
}

/** Cột Hạn theo thiết kế: "12/11" (cùng năm), "02/12/2025" (khác năm). */
function ngayHan(d: Date, now: Date): string {
  const nam = (x: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(x);
  return nam(d) === nam(now) ? ngayNgan(d) : ngayDayDu(d);
}

/** Nhãn trạng thái của khoá ĐÃ XONG theo thiết kế: "Xong 01/11" (+ "· trễ hạn" nếu hoàn thành trễ). */
function nhanXong(k: { status: string; completedAt: Date | null }): string {
  const ngay = k.completedAt ? ` ${ngayNgan(k.completedAt)}` : "";
  return `Xong${ngay}${k.status === "COMPLETED_LATE" ? " · trễ hạn" : ""}`;
}

export default async function KhoaCuaToiPage({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const sp = await searchParams;
  const tab = tabDangMo(sp, MA_TAB_KHOA, TAB_MAC_DINH, { khoaCu: ["tt"], bietDanh: BIET_DANH_TT }) as (typeof MA_TAB_KHOA)[number];
  const sx = docSapXepTab(mot(sp.sx));
  const q = mot(sp.q).slice(0, 100).trim();
  const trangYeuCau = Number.parseInt(mot(sp.p) || "1", 10);

  const actor = await resolveActor(session.user.id);
  const khoa = await napDanhSachKhoaCuaToi(scopedDb(actor), session.user.id);
  const now = new Date();
  const kq = locSapXepTheoTab(khoa, { tab, q, sapXep: sx, trang: trangYeuCau }, now);
  const dangTim = q !== "";

  const cot: CotDuLieu<KhoaDong>[] = [
    {
      id: "khoa",
      nhan: "Khoá",
      dienThoai: "tieu-de",
      hien: (k) => {
        const phu = moTaPhuKhoa(k);
        return (
          <div className="min-w-0">
            <Link
              href={`/elearning/hoc/${k.enrollmentId}`}
              className="block max-w-[28rem] truncate rounded text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-[720px]:whitespace-normal"
            >
              {k.tenKhoa}
            </Link>
            {phu ? <span className="block text-[13px] leading-[18px] text-muted-foreground">{phu}</span> : null}
          </div>
        );
      },
    },
    {
      id: "tien-do",
      nhan: "Tiến độ",
      dienThoai: "thong-tin",
      // Chuỗi chấm "dầm" + "1/4" (n/m bài BẮT BUỘC — cùng định nghĩa với Tổng quan). Khoá chưa có bài bắt buộc: không bịa chuỗi chấm.
      hien: (k) =>
        k.tienDoBai.tong > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <TienDoDam
              tong={k.tienDoBai.tong}
              xong={k.tienDoBai.xong}
              dangHoc={k.tienDoBai.xong < k.tienDoBai.tong ? k.tienDoBai.xong : undefined}
              nhan={k.tenKhoa}
            />
            <span className="text-[13px] leading-[18px] tabular-nums text-muted-foreground">
              {k.tienDoBai.xong}/{k.tienDoBai.tong}
            </span>
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        ),
    },
    {
      id: "han",
      nhan: "Hạn",
      dienThoai: "thong-tin",
      hien: (k) => <span className="tabular-nums">{k.dueAt ? ngayHan(k.dueAt, now) : "—"}</span>,
    },
    {
      id: "trang-thai",
      nhan: "Trạng thái",
      hien: (k) => (
        <ChamTrangThai
          nhom={nhomMauCuaKhoa(k, now)}
          nhan={daXong(k.status) ? nhanXong(k) : dongHanCuaBan(k, now, k.tienDoBai.tong > 0 ? k.tienDoBai : undefined).nhan}
        />
      ),
    },
    {
      id: "thao-tac",
      nhan: "Thao tác",
      thaoTac: true,
      hien: (k) => (
        <Link href={`/elearning/hoc/${k.enrollmentId}`} className={NUT_PHU_NHO}>
          {tab === "da-xong" ? "Xem lại" : tab === "qua-han" ? "Xem đề cương" : k.progressPercent > 0 ? "Tiếp tục" : "Bắt đầu"}
        </Link>
      ),
    },
  ];

  const tabKhaiBao = TAB_KHOA.map((t) => ({ id: t.id, nhan: t.nhan, dem: kq.dem[t.id] }));
  const tabKhacKhop = TAB_KHOA.filter((t) => t.id !== tab && kq.dem[t.id] > 0);
  const tieuDeTrong = dangTim
    ? "Không có khoá nào khớp bộ lọc"
    : tab === "qua-han"
      ? "Bạn không có khoá nào quá hạn"
      : tab === "da-xong"
        ? "Bạn chưa hoàn thành khoá nào"
        : "Bạn không còn khoá nào cần làm";

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-[clamp(16px,4vw,40px)] pb-16 pt-8 max-[720px]:gap-6 max-[720px]:pb-6 max-[720px]:pt-6">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.01em] text-foreground max-[720px]:text-[23px] max-[720px]:leading-[30px]">
          Khoá của tôi
        </h1>
        <p className="max-w-[68ch] text-[color:var(--el-text2)]">Những khoá được giao cho bạn. Việc cần làm sớm nhất xếp lên trước</p>
      </header>
      {/* Lối vào THEO NGỮ CẢNH tới Đề nghị đào tạo — không phải mục điều hướng chính (DECISIONS D-05, Q14 chưa chốt). */}
      <p className="-mt-4 text-sm text-muted-foreground">
        Cần học thêm điều gì?{" "}
        <Link href="/elearning/de-nghi" className="rounded font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          Gửi đề nghị đào tạo
        </Link>
      </p>

      {khoa.length === 0 ? (
        <EmptyState
          title="Bạn chưa được giao khoá nào"
          description="Phòng Đào tạo là nơi giao khoá học. Liên hệ phòng Đào tạo nếu bạn nghĩ đây là nhầm lẫn."
          action={
            <Link
              href="/elearning/de-nghi"
              className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Gửi đề nghị đào tạo
            </Link>
          }
        />
      ) : (
        <>
          <form action={DUONG_DAN} method="GET" role="search" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value={tab} />
            <label className={`${NHAN_O} flex-[1_1_260px]`}>
              Tìm theo tên khoá
              <input type="search" name="q" defaultValue={q} placeholder="Ví dụ: an toàn" className={O_NHAP} />
            </label>
            <label className={`${NHAN_O} min-w-[11.5rem]`}>
              Sắp xếp
              <ChonTuGui name="sx" defaultValue={sx} className={O_NHAP}>
                {SAP_XEP_TAB.map((o) => (
                  <option key={o.ma} value={o.ma}>
                    {o.nhan}
                  </option>
                ))}
              </ChonTuGui>
            </label>
            {/* Không có JavaScript thì đổi cách sắp xếp cần một nút gửi; có JavaScript thì ô chọn tự gửi (đúng thiết kế: không có nút). */}
            <noscript>
              <button type="submit" className={NUT_PHU}>
                Áp dụng
              </button>
            </noscript>
            {dangTim ? (
              <Link
                href={hrefTab(DUONG_DAN, tab, { sx: sx !== "han" ? sx : undefined })}
                className="inline-flex h-10 items-center rounded text-[13px] text-primary-ink underline underline-offset-[3px] focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xoá bộ lọc
              </Link>
            ) : null}
          </form>

          <TabNav
            duongDan={DUONG_DAN}
            tab={tabKhaiBao}
            dangMo={tab}
            giuLai={{ q, sx: sx !== "han" ? sx : undefined }}
            nhanDanhSach="Khoá của tôi"
          />


          {tab === "qua-han" && kq.tong > 0 ? (
            // Đúng `due-lock.ts`: không hứa "vẫn học tiếp được" (Q6 chưa chốt).
            <p role="note" className="flex items-start gap-2.5 rounded-[10px] bg-state-danger-soft px-3.5 py-3 text-[13px] leading-[19px] text-state-danger-ink">
              <CalendarX className="size-[18px] flex-none" aria-hidden />
              <span>
                {OVERDUE_LOCKED_MESSAGE}. Khoá quá hạn không ghi nhận thêm tiến độ, trừ khi lượt giao cho phép học trễ.
              </span>
            </p>
          ) : null}

          {kq.tong === 0 ? (
            <EmptyState
              title={tieuDeTrong}
              description={
                dangTim
                  ? tabKhacKhop.length > 0
                    ? `Không có khoá nào tên có “${q}” ở tab này, nhưng có ở tab khác: ${tabKhacKhop
                        .map((t) => `${t.nhan} (${kq.dem[t.id]})`)
                        .join(", ")}.`
                    : `Không có khoá nào tên có “${q}”.`
                  : undefined
              }
              action={
                dangTim ? (
                  <Link
                    href={hrefTab(DUONG_DAN, tab)}
                    className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Xoá bộ lọc
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <DanhSachDuLieu
                hang={kq.dong}
                khoa={(k) => k.enrollmentId}
                cot={cot}
                nhomMau={(k) => nhomMauCuaKhoa(k, now)}
                nhanTrangThai={(k) => trangThaiHienThi(k, now).nhan}
                tenDonVi="khoá"
                nhanDanhSach="Danh sách khoá"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] leading-[18px] text-muted-foreground" aria-live="polite">
                  {kq.tong} khoá{dangTim ? " khớp bộ lọc" : ""}
                </span>
              </div>

              {kq.tongTrang > 1 ? (
                <nav aria-label="Phân trang" className="flex items-center justify-between gap-3">
                  {kq.trang > 1 ? (
                    <Link
                      href={hrefTrang(tab, q, sx, kq.trang - 1)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden /> Trang trước
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-sm text-muted-foreground">
                    Trang {kq.trang}/{kq.tongTrang}
                  </span>
                  {kq.trang < kq.tongTrang ? (
                    <Link
                      href={hrefTrang(tab, q, sx, kq.trang + 1)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Trang sau <ChevronRight className="h-4 w-4" aria-hidden />
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}
    </main>
  );
}
