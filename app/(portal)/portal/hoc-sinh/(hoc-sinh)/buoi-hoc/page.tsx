import { redirect } from "next/navigation";

// Màn "Buổi học" cũ đã gộp vào "Lịch học" (danh sách Sắp tới / Đã học) theo thiết kế mới.
export default function HvBuoiHocCu() {
  redirect("/portal/hoc-sinh/lich");
}
