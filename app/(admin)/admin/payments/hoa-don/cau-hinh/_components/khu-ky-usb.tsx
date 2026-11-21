import type { Actor } from "@/lib/auth/actor";
import { laKyUsbBat } from "@/lib/finance/hoa-don/feature";
import { docHangChoKyUsb } from "@/lib/finance/hoa-don/ky-usb/hang-cho-ky-usb";
import { danhSachMayCuaToi } from "@/lib/finance/hoa-don/ky-usb/may-ky";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { TieuDeMuc } from "../../_components/tieu-de-muc";
import { KyUsbHangCho } from "./ky-usb-hang-cho";

/**
 * Khu «Ký USB token» (hub/13). Chỉ HIỆN khi cờ `hoaDon.kyUsb` BẬT và người xem là kế toán ở ít nhất một cơ sở — cờ tắt (mặc định) ⇒ trang y hệt trước, không nạp gì.
 */
export async function KhuKyUsb({ actor }: { actor: Actor }) {
  if (!(await laKyUsbBat())) return null;
  const pham = phamViKeToan(actor);
  if (pham !== "ALL" && pham.length === 0) return null;
  const [dong, may] = await Promise.all([docHangChoKyUsb(actor), danhSachMayCuaToi(actor.userId, new Date())]);
  return (
    <div id="ky-usb" className="mt-10">
      <TieuDeMuc tieuDe="Ký USB token" huongDan={huongDan("buoc-ky-usb")} nhanHuongDan="Xem hướng dẫn: ký USB token" moTa="Lệnh ký, ký lô và máy ký của pháp nhân ký bằng USB token." />
      <KyUsbHangCho dong={dong} may={may} nguoiXemId={actor.userId} />
    </div>
  );
}
