import { requireActiveStudent } from "@/lib/portal/session";
import { getChildDetail } from "@/lib/portal/child-detail";
import { ChildDetailPage } from "@/components/portal/child-detail-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hồ sơ con | Sata Robo",
  robots: { index: false },
};

// Chi tiết + sửa hồ sơ CON ĐANG CHỌN (PHƯƠNG ÁN A — KHÔNG lộ studentId trên URL).
export default async function ChildDetailRoute() {
  const { studentId } = await requireActiveStudent();
  const data = await getChildDetail(studentId);
  if (!data) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Không tìm thấy hồ sơ con.
      </p>
    );
  }
  return <ChildDetailPage data={data} />;
}
