import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import {
  loadIntakeCenterOptions,
  loadIntakeCourseOptions,
} from "@/lib/lead/intake/center-options";
import { docPrefillTuQuery } from "@/lib/lead/intake/prefill";
import { QuickLeadForm } from "@/components/lead-intake/quick-lead-form";

export const metadata = { title: "Nhập khách hàng | Sata Robo" };
export const dynamic = "force-dynamic";

/**
 * `admin.satarobo.vn/nhap-khach-hang` — biểu mẫu nhập khách hàng nội bộ.
 *
 * 23/08/2026 — DỜI VÀO ADMIN (chủ dự án chốt). Trước đó trang đứng ở host public
 * (`app/(intake)/`), nên mục sidebar "Nhập khách hàng" bấm vào là **văng khỏi
 * khung admin** sang một site khác rồi phải bấm quay lại. Nay nó ở lại trong
 * admin: sidebar, thanh trên, quyền — cùng một khung với `/leads`.
 *
 * Segment `nhap-khach-hang` PHẢI có trong `ADMIN_ROUTE_SEGMENTS`
 * (`lib/auth/route-policy.ts`) — thiếu là admin host đá về public, public đá
 * ngược lại → vòng lặp chuyển hướng.
 *
 * Khác `/admin/leads/new` (biểu mẫu ĐẦY ĐỦ: khoá quan tâm, nhiều con, trạng
 * thái…): màn này gõ vài giây một phiếu, gõ xong ở lại nhập tiếp, và đi qua
 * đường nhận lead chung (`ingestIntakeLead`) nên có sẵn chống trùng + tự chia —
 * thứ `/admin/leads/new` không có.
 *
 * ⚠️ Thân trang cố ý MỎNG: dữ liệu lấy qua `loadIntakeCenterOptions()`, giao
 * diện là `<QuickLeadForm>` dùng chung. Site Sale sau này dựng bản của mình
 * bằng đúng hai mảnh đó, không chép lại logic.
 *
 * `?phone=&name=` — điền sẵn khi tới từ khung chat (chốt 9.13/9.5 đợt ZaloCRM).
 * Luật đọc query nằm ở `docPrefillTuQuery()`, dùng chung với bản site Sale; đừng
 * viết biểu thức đọc query tại chỗ, hai trang sẽ trôi lệch.
 */
export default async function NhapKhachHangPage({
  searchParams,
}: {
  // Next 16: `searchParams` là Promise, BẮT BUỘC await trước khi đọc.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fnhap-khach-hang");
  // Layout admin đã gác đăng nhập; đây là gate QUYỀN của riêng trang. Server
  // Action vẫn tự kiểm lần nữa — nó là endpoint riêng, gate trang chưa đủ.
  if (!(await checkAnyPermission(PAGE_GATES["/nhap-khach-hang"]))) {
    redirect("/dashboard?error=unauthorized");
  }

  const actor = await resolveActor(session.user.id);
  const [centers, courses] = await Promise.all([
    loadIntakeCenterOptions(actor),
    loadIntakeCourseOptions(),
  ]);
  const prefill = docPrefillTuQuery(await searchParams);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-foreground">Nhập khách hàng</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nhập nhanh khách thu được từ quảng cáo, sự kiện, hoặc tư vấn trực tiếp.
          Hệ thống tự kiểm tra trùng số điện thoại và tự giao cho tư vấn viên theo
          cơ sở.
        </p>
      </div>
      <QuickLeadForm centers={centers} courses={courses} initial={prefill} />
    </div>
  );
}
