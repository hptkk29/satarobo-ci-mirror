import Link from "next/link";
import { Award, BookOpen, FileText, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { tabDangMo, type SearchParamsTho } from "@/lib/elearning/tab-url";
import { napNguonTimKiem } from "@/lib/elearning/tim-kiem-view";
import {
  MA_TAB_TIM,
  TAB_TIM_KIEM,
  coTheTim,
  danhDauKhop,
  demTheoTab,
  lamSachTuKhoa,
  locKetQua,
  theoTab,
  type LoaiKetQua,
  type TabTim,
} from "@/lib/elearning/tim-kiem-pure";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState } from "@/components/admin/ui/states";
import { TabNav } from "../_components/ui/tab-nav";

/**
 * TÌM KIẾM — khoá, bài học và chứng nhận CỦA CHÍNH TÔI (`?q=` + `?tab=`). Chỉ tìm TIÊU ĐỀ; không tìm nội dung câu hỏi/bài
 * (luật cứng #7: nội dung đề thi đi qua chuỗi 4 điều kiện ở server — chỉ mục tìm kiếm là đường vòng). Mỗi tab là một liên kết thật.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tìm kiếm | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const ICON: Record<LoaiKetQua, typeof BookOpen> = { khoa: BookOpen, bai: FileText, "chung-nhan": Award };
const NHAN_LOAI: Record<LoaiKetQua, string> = { khoa: "Khoá", bai: "Bài học", "chung-nhan": "Chứng nhận" };

function mot(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TimKiemPage({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">Đăng nhập rồi mở lại trang này.</main>;
  }
  const sp = await searchParams;
  const q = lamSachTuKhoa(mot(sp.q));
  const tab = tabDangMo(sp, MA_TAB_TIM, "tat-ca") as TabTim;
  const tim = coTheTim(q);

  const actor = await resolveActor(session.user.id);
  const ds = tim ? locKetQua(await napNguonTimKiem(scopedDb(actor), session.user.id, new Date()), q) : [];
  const dem = demTheoTab(ds);
  const hien = theoTab(ds, tab);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <PageHeader title="Tìm kiếm" subtitle="Chỉ tìm trong khoá được giao cho bạn và chứng nhận của bạn." />

      <form action="/elearning/tim-kiem" method="GET" role="search" className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Tìm khoá, bài học, chứng nhận"
            aria-label="Tìm khoá, bài học, chứng nhận"
            className="h-11 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {tab !== "tat-ca" ? <input type="hidden" name="tab" value={tab} /> : null}
        <button
          type="submit"
          className="h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Tìm
        </button>
      </form>

      {!tim ? (
        <EmptyState
          title={q === "" ? "Nhập từ khoá để tìm" : "Từ khoá quá ngắn"}
          description="Gõ ít nhất 2 chữ. Tìm theo tên khoá, tên bài học hoặc tên khoá của chứng nhận; có dấu hay không dấu đều được."
        />
      ) : (
        <>
          <TabNav
            duongDan="/elearning/tim-kiem"
            tab={TAB_TIM_KIEM.map((t) => ({ id: t.id, nhan: t.nhan, dem: dem[t.id] }))}
            dangMo={tab}
            giuLai={{ q }}
            nhanDanhSach="Kết quả tìm kiếm"
          />
          {hien.length === 0 ? (
            <EmptyState
              title="Không có kết quả"
              description={`Không tìm thấy “${q}” trong ${tab === "tat-ca" ? "khoá, bài học hay chứng nhận" : NHAN_LOAI[tab as LoaiKetQua].toLowerCase()} của bạn.`}
            />
          ) : (
            <ul aria-label="Kết quả" className="divide-y divide-border rounded-xl border border-border bg-card">
              {hien.map((k) => {
                const Icon = ICON[k.loai];
                return (
                  <li key={k.id}>
                    <Link
                      href={k.href}
                      className="flex min-h-14 items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {danhDauKhop(k.tieuDe, q).map((d, i) =>
                            d.khop ? (
                              <mark key={i} className="rounded-sm bg-state-warning-soft px-0.5 text-state-warning-ink">
                                {d.chu}
                              </mark>
                            ) : (
                              <span key={i}>{d.chu}</span>
                            ),
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {NHAN_LOAI[k.loai]}
                          {k.nguCanh ? ` · ${k.nguCanh}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
