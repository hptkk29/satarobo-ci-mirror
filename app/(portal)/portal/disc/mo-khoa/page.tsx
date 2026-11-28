import { notFound, redirect } from "next/navigation";

import { ManMoKhoa } from "@/components/disc-portal/so/man-mo-khoa";
import { docTrangThaiPin } from "@/lib/disc/so-gia-dinh/mo-khoa";

import { docPhienDisc } from "../_lib/phien-disc";

export const dynamic = "force-dynamic";

/**
 * V8.31 — trang MỞ KHOÁ (đường bootstrap `phamVi: "KHONG"`: không đọc dữ liệu DISC). Chỉ hiện form khi sổ có PIN VÀ máy chủ đang ép VÀ phiên chưa mở khoá đầy đủ;
 * ngược lại đưa về `/portal/disc` (nơi guard tập trung quyết định tiếp). Không bao giờ trả dữ liệu sổ ở trang này.
 */
export default async function MoKhoaDiscPage() {
  const p = await docPhienDisc({ phamVi: "KHONG" });
  if (!p.ok) {
    if (p.loai === "CO_TAT") notFound();
    redirect("/login");
  }
  const tt = await docTrangThaiPin(p.ctx);
  if (!tt.ok) throw new Error("Không đọc được trạng thái PIN."); // fail-closed
  const t = tt.trangThai;
  if (!t.coSo || !t.coPin || !t.epMayChu) redirect("/portal/disc");
  if (t.daMoKhoa && t.cheDo === "DAY_DU") redirect("/portal/disc");
  return <ManMoKhoa khoaDenLuc={t.khoaDenLuc} cheDoTreEm={t.cheDo === "TRE_EM"} />;
}
