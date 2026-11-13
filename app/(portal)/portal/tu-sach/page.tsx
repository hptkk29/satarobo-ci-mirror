// app/(portal)/portal/tu-sach/page.tsx — «Tủ sách gia đình» của cổng phụ huynh (08/11/2026).
//
// Gói MIỄN PHÍ: mở được cả khi tài khoản chưa có học viên (layout cho đoạn `tu-sach` vào khi cờ bật ∧ PARENT).
// Cờ `TU_SACH_ENABLED` tắt ⇒ 404; chưa đăng nhập / không phải PARENT ⇒ /login; `userId` từ PHIÊN, không từ URL.
import { TuSachCong } from "@/components/portal/tu-sach/tu-sach-cong";
import { isTuSachEnabled } from "@/lib/flags";
import { yeuCauPhienMienPhi } from "@/lib/portal/phien-mien-phi";
import { docNguCanhTuSach } from "@/lib/portal/tu-sach";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Tủ sách gia đình | Sata Robo",
  robots: { index: false },
};

export default async function TuSachPortalPage() {
  const { userId } = await yeuCauPhienMienPhi(isTuSachEnabled());
  const nc = await docNguCanhTuSach(userId);
  return <TuSachCong coPhuongBanDau={nc.coPhuong} lopCuaCon={nc.lopCuaCon} phuongDs={nc.phuongDs} />;
}
