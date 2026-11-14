import { requireActiveStudent } from "@/lib/portal/session";
import { vnParts } from "@/lib/time/vn";
import { docHvLich } from "@/lib/portal/hv-du-lieu";
import { HvLichTrang } from "@/components/portal/hv-lich";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lịch học | Cổng học sinh Sata Robo", robots: { index: false } };

function so(v: string | undefined, macDinh: number, min: number, max: number): number {
  const n = v ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : macDinh;
}

export default async function HvLichRoute({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const { studentId } = await requireActiveStudent({ choHocSinh: true });
  const sp = await searchParams;
  // Tháng mặc định theo LỊCH VN (không theo múi giờ máy chủ).
  const nay = vnParts(new Date());
  const d = await docHvLich(studentId, so(sp.y, nay.year, 2000, 2100), so(sp.m, nay.month, 0, 11));
  return <HvLichTrang d={d} />;
}
