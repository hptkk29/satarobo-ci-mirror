import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { GhiChu, KhoiRong, QuayLai, TrangQuanTri } from "../_components/ui/trang";
import { NewRubricForm } from "./_components/new-rubric-form";
import { RubricBuilder } from "./_components/rubric-builder";
import { napKhungDeDung } from "./_lib/nap-khung";
import type { SearchParamsTho } from "@/lib/elearning/tab-url";

/**
 * EL-15b + P8 — KHUNG CHẤM theo thiết kế `QtKhungCham` (master-detail): danh sách khung bên trái, trình dựng của khung đang chọn bên phải (`?id=`).
 * Nghiệp vụ KHÔNG đổi: cùng `RubricBuilder` + cùng action lưu/kích hoạt (cổng `content:author` / `content:publish`); trang riêng
 * `/khung-cham/[rubricId]` vẫn dùng được (liên kết cũ).
 *
 * ⚠️ Khung KHÔNG tự tới người học. Nó tới qua một bài dạng `TASK`, đường nối là `TrnLesson.rubricId`. Màn nói rõ bước tiếp.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Khung chấm | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TT = (s: string) => (s === "ACTIVE" ? "Kích hoạt" : s === "ARCHIVED" ? "Đã lưu trữ" : "Nháp");

export default async function Page({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Khung chấm" />
        <NoPermission permission="elearning:content:author" what="khung chấm" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const cacKhung = await db.trnRubric.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, title: true, status: true, totalPoints: true, passPoints: true, _count: { select: { criteria: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const idTho = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  const idChon = idTho && cacKhung.some((k) => k.id === idTho) ? idTho : (cacKhung[0]?.id ?? null);

  // Lỗi đọc khung đang chọn ⇒ báo TRONG khung phải; danh sách bên trái vẫn dùng được.
  let nap: Awaited<ReturnType<typeof napKhungDeDung>> = null;
  let loiTai = false;
  if (idChon) {
    try {
      nap = await napKhungDeDung(db, idChon);
    } catch {
      loiTai = true;
    }
  }

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/chuong-trinh">Chương trình</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title="Khung chấm"
          subtitle="Thước đo cho bài tập và sản phẩm chấm tay: tiêu chí, mức, điểm."
        />
      </div>
      <GhiChu sac="info">
        Khung chỉ tới người học qua một bài dạng <strong>Bài tập</strong>: kích hoạt khung xong, mở bài đó ở màn soạn khoá rồi gắn khung vào.
      </GhiChu>

      <NewRubricForm />

      {cacKhung.length === 0 ? (
        <KhoiRong title="Chưa có khung nào" description="Tạo khung ở khối trên, rồi thêm tiêu chí và các mức điểm." />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section aria-label="Các khung chấm">
            <ul className="divide-y divide-border border-y border-border">
              {cacKhung.map((k) => {
                const chon = k.id === idChon;
                return (
                  <li key={k.id}>
                    <Link
                      href={`/elearning/khung-cham?id=${encodeURIComponent(k.id)}`}
                      aria-current={chon ? "true" : undefined}
                      className={`block border-l-2 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${chon ? "border-primary bg-card" : "border-transparent hover:bg-card/60"}`}
                    >
                      <span className="block font-mono text-xs text-foreground">{k.code}</span>
                      <span className="block text-sm text-muted-foreground">{k.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <TrangThaiBadge sac={k.status === "ACTIVE" ? "success" : "muted"}>{NHAN_TT(String(k.status))}</TrangThaiBadge>
                        <span className="tabular-nums">
                          {k._count.criteria} tiêu chí · đạt {k.passPoints}/{k.totalPoints}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label="Trình dựng khung" className="min-w-0 space-y-4">
            {loiTai ? (
              <EmptyState title="Không tải được khung này" description="Có lỗi khi đọc khung. Tải lại trang hoặc chọn khung khác; nếu vẫn lỗi, báo kỹ thuật." />
            ) : !nap ? (
              <EmptyState title="Không tìm thấy khung chấm này" description="Khung không tồn tại, đã bị xoá hoặc không thuộc phạm vi của bạn." />
            ) : (
              <>
                {nap.cacTieuChi.some((t) => t.levels.length === 0) ? (
                  <GhiChu sac="warning">
                    Có tiêu chí hệ thống không đọc được các mức. Mở ra, nhập lại mức rồi lưu — để nguyên thì kích hoạt sẽ bị từ chối.
                  </GhiChu>
                ) : null}
                <RubricBuilder
                  key={nap.khung.id}
                  rubricId={nap.khung.id}
                  code={nap.khung.code}
                  title={nap.khung.title}
                  status={nap.khung.status}
                  totalPoints={nap.khung.totalPoints}
                  passPoints={nap.khung.passPoints}
                  cacTieuChi={nap.cacTieuChi}
                  duocKichHoat={can(actor, "elearning:content:publish")}
                />
              </>
            )}
          </section>
        </div>
      )}
    </TrangQuanTri>
  );
}
