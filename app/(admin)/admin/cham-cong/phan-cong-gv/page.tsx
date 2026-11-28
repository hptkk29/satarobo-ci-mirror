// app/(admin)/admin/cham-cong/phan-cong-gv/page.tsx — STUB chuyển hướng 308 (GĐ3 phân công gộp, 26/10/2026).
// "Phân công giáo viên" (lưới tuần) và "Phân công buổi" đã GỘP thành một màn `/cham-cong/phan-cong`. Giữ route để link / bookmark
// cũ không 404; giữ nguyên `coSo` + `tuan`. Thành phần Excel + đồng bộ lại ở `_components/` vẫn được màn gộp dùng.
import { permanentRedirect } from "next/navigation";
import { hrefWith } from "@/lib/cham-cong/scope-href";

export const dynamic = "force-dynamic";

export default async function PhanCongGvChuyenHuong({ searchParams }: { searchParams: Promise<{ coSo?: string; tuan?: string }> }) {
  const sp = await searchParams;
  permanentRedirect(hrefWith("/cham-cong/phan-cong", { coSo: sp.coSo, tuan: sp.tuan }));
}
