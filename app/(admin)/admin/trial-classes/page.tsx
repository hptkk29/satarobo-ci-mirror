// app/(admin)/admin/trial-classes/page.tsx — GĐ6.
// Màn "Lớp trải nghiệm" cũ đã gộp vào "Lớp Trial". Xem ghi chú ở trials/page.tsx.
import { redirect } from "next/navigation";

export default function TrialClassesRedirectPage() {
  redirect("/lop-trial");
}
