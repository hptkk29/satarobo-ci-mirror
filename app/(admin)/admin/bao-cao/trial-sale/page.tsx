// Thống kê case trải nghiệm theo Sale — chủ dự án 22/09/2026.
//
// Mode: Operate. Người dùng đến để TRẢ LỜI một câu hỏi ("Sale nào chốt tốt, ai đang để
// khách im lặng") rồi đi tiếp, không để bị thuyết phục.
//
// ⚠️ CỐ Ý KHÔNG có dải thẻ KPI số-to ở đầu trang. Hàng TỔNG cuối bảng đã trả lời đúng câu
// đó, ngay cạnh các con số mà nó cộng lại — tách ra thành bốn thẻ to phía trên là bắt
// người đọc nhìn hai chỗ cho một phép cộng, và là đúng cái khung trang mà DESIGN.md gọi
// là "mẫu hero-metric".
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getCenterOptions } from "@/lib/org/center-options";
import { vnParts } from "@/lib/time/vn";
import { layCaseTrial, TRAN_CASE } from "./_lib/truy-van";
import { BangSale } from "./_components/bang-sale";
import { duocXuatCuaPhienHienTai } from "@/lib/export/quyen-xuat";

export const metadata = { title: "Báo cáo trải nghiệm | Admin" };
export const dynamic = "force-dynamic";

function ymd(d: Date): string {
  const p = vnParts(d);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Ngày 1 của tháng hiện tại theo lịch VN. */
function dauThang(d: Date): string {
  const p = vnParts(d);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-01`;
}

const NGAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ThongKeCaseTrialTheoSalePage({
  searchParams,
}: {
  searchParams: Promise<{ tu?: string; den?: string; centerId?: string; khuVucId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Trạng thái thứ tư của DESIGN.md §5: KHÔNG redirect trần. Phân quyền ở hệ này chia
  // theo module × cơ sở nên người dùng gặp màn này hằng ngày — nó phải nói THIẾU QUYỀN
  // NÀO và HỎI AI, chứ không đá người ta về dashboard mà không giải thích gì.
  if (!(await checkPermission("trials:view"))) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">
          Bạn chưa có quyền xem thống kê lớp trải nghiệm
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Màn này cần quyền <code className="rounded bg-muted px-1 py-0.5">trials:view</code>.
          Nhờ Quản lý cơ sở hoặc Quản trị tối cao cấp giúp ở màn Phân quyền.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Về trang chính
        </Link>
      </div>
    );
  }

  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const now = new Date();

  // Mặc định: ngày 1 của tháng → hôm nay (chủ dự án chốt). Tính ở SERVER theo lịch VN —
  // để client đọc đồng hồ máy là máy đặt sai múi giờ sẽ lọc nhầm ngày.
  const tu = sp.tu && NGAY.test(sp.tu) ? sp.tu : dauThang(now);
  const den = sp.den && NGAY.test(sp.den) ? sp.den : ymd(now);
  const centerId = sp.centerId || null;
  const khuVucId = sp.khuVucId || null;

  const [centers, khuVucs] = await Promise.all([
    getCenterOptions(actor),
    // Khu vực = OrgUnit type REGION. Người chỉ quản một khu vực thì ô này không có gì để
    // chọn, nên nó ĐƯỢC GIẤU — bày một ô chọn chỉ có một lựa chọn là bắt người ta bấm
    // vào một thứ không đổi gì.
    sdb.orgUnit.findMany({
      where: {
        type: "REGION",
        ...(actor.isHoLevel ? {} : { id: { in: actor.visibleOrgUnitIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const { cases, batTran } = await layCaseTrial(actor, { tu, den, centerId, khuVucId });

  return (
    <div className="space-y-5">
      <div>
        {/* 23/09 — màn CHÍNH của báo cáo trải nghiệm (`/bao-cao/trial` đã gỡ). */}
        <h2 className="text-lg font-semibold text-foreground">Báo cáo trải nghiệm</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Thống kê case trải nghiệm theo Sale. Mỗi dòng là <strong>Sale phụ trách lead</strong> của bé (không phải người bấm thêm case), đếm theo <strong>ngày tạo case</strong> trong khoảng đã chọn.
        </p>
      </div>

      {/* Bộ lọc là FORM GET — bấm Áp dụng là đổi URL, nên trang chia sẻ được bằng link và
          bấm quay lại vẫn về đúng bộ lọc cũ. Không cần state client cho việc này. */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        {khuVucs.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Khu vực
            <select
              name="khuVucId"
              defaultValue={khuVucId ?? ""}
              className="min-w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="">Tất cả khu vực</option>
              {khuVucs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Cơ sở
          <select
            name="centerId"
            defaultValue={centerId ?? ""}
            className="min-w-48 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
          >
            {/* Người chỉ quản MỘT cơ sở vẫn thấy ô này (chủ dự án yêu cầu), và "Tất cả"
                với họ cũng chính là cơ sở đó — `scopedDb` đã cắt sẵn. */}
            <option value="">Tất cả cơ sở</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Từ ngày
          <input
            type="date"
            name="tu"
            defaultValue={tu}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Đến ngày
          <input
            type="date"
            name="den"
            defaultValue={den}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Áp dụng
        </button>
      </form>

      {batTran && (
        <p
          role="alert"
          className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink"
        >
          Khoảng ngày này có hơn {TRAN_CASE.toLocaleString("vi-VN")} case — bảng chỉ tính{" "}
          {TRAN_CASE.toLocaleString("vi-VN")} case gần nhất. Thu hẹp khoảng ngày để con số
          đúng hoàn toàn.
        </p>
      )}

      <BangSale cases={cases} xuatDuoc={await duocXuatCuaPhienHienTai("bao-cao-trial-sale")} />
    </div>
  );
}
