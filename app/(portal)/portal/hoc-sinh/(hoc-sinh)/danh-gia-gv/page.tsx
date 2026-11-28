import { requireActiveStudent } from "@/lib/portal/session";
import { docHvDanhGia } from "@/lib/portal/hv-du-lieu";
import { HvDanhGiaTrang } from "@/components/portal/hv-danh-gia";

export const dynamic = "force-dynamic";
export const metadata = { title: "Đánh giá thầy cô | Cổng học sinh Sata Robo", robots: { index: false } };

// Dùng engine đánh giá hiện có (EVAL_V2); chưa mở đợt / tính năng tắt ⇒ trạng thái rỗng thân thiện.
export default async function HvDanhGiaRoute() {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  const d = await docHvDanhGia(studentId);
  return <HvDanhGiaTrang blocks={d.blocks} />;
}
