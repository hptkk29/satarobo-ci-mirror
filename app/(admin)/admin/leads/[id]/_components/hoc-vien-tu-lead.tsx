// Khối "Đã thành học viên" trên trang lead — chiều ngược Lead → Học viên (25/09/2026).
//
// Server Component: tự hỏi dữ liệu qua `hocVienCuaLead`, hàm đó tự gác (mở được phiếu mới
// trả gì) và tự che tên theo luật PII của lead. Component chỉ vẽ.
//
// Đặt ngay DƯỚI khối "Con của phụ huynh" ở cột ĐỌC (trái): cùng trả lời câu "các con của
// phiếu này đi tới đâu". Cột phải (3/10) của trang dành cho việc GHI — xem chú thích bố
// cục 7:3 trong page.tsx.
//
// Không có gì để nói (phiếu chưa thành học viên nào) ⇒ không vẽ gì: một khối rỗng trên
// mọi phiếu chưa chốt là nhiễu.
import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { hocVienCuaLead, NHAN_HV_NGOAI_PHAM_VI } from "@/lib/students/lead-nguon";

export async function DaThanhHocVien({
  leadId,
  childIds,
}: {
  leadId: string;
  childIds: string[];
}) {
  const session = await auth();
  if (!session?.user) return null;
  // `resolveActor` là cache theo request — trang cha đã gọi, ở đây không tốn thêm truy vấn.
  const actor = await resolveActor(session.user.id);
  const ds = await hocVienCuaLead({ actor, leadId, childIds });
  if (ds.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Đã thành học viên</h2>
      <ul className="divide-y divide-border">
        {ds.map((hv) => {
          const ngoaiPhamVi = hv.href === null && hv.trangThai === NHAN_HV_NGOAI_PHAM_VI;
          return (
            <li
              key={hv.studentId}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm first:pt-0 last:pb-0"
            >
              {hv.href ? (
                <Link
                  href={hv.href}
                  className="min-w-0 break-words font-medium text-primary underline-offset-2 hover:underline"
                >
                  {hv.ten}
                </Link>
              ) : (
                <span className="min-w-0 break-words font-medium text-foreground">{hv.ten}</span>
              )}
              {hv.maHocVien && (
                <span className="text-xs tabular-nums text-muted-foreground">{hv.maHocVien}</span>
              )}
              {ngoaiPhamVi ? (
                <span className="text-xs italic text-muted-foreground">ở cơ sở khác</span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {hv.trangThai}
                </span>
              )}
              {hv.noiQua === "VET_GHI_DANH" && (
                <span
                  className="text-xs text-muted-foreground"
                  title="Chưa gắn lead nguồn trên hồ sơ — nhận ra qua ghi danh chốt từ phiếu này"
                >
                  · qua ghi danh
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
