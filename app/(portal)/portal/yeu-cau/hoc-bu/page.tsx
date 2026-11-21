import { redirect } from "next/navigation";
import { isPortalV2Enabled } from "@/lib/flags";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { docLuotBuChoCon } from "@/lib/portal/yeu-cau-hub";
import { vnParts, vnYmd } from "@/lib/time/vn";
import { KhungYeuCau } from "@/components/portal/yeu-cau/khung-yeu-cau";
import { ManHocBu, type BuoiCanBu } from "@/components/portal/yeu-cau/man-hoc-bu";

export const dynamic = "force-dynamic";
export const metadata = { title: "Học bù | Sata Robo", robots: { index: false } };

const nhanNgay = (iso: string | null): string | null => {
  if (!iso) return null;
  const p = vnParts(new Date(iso));
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}`;
};

// Màn «Học bù» (board M-Yeu-cau-hoc-bu): CHỈ buổi đang cần bù + lượt bù còn lại; gửi yêu cầu bằng popup ngày/giờ/ghi chú.
export default async function HocBuPage({ searchParams }: { searchParams: Promise<{ bu?: string }> }) {
  if (!isPortalV2Enabled()) redirect("/portal/yeu-cau");
  const { ctx, studentId } = await requireActiveStudent();
  const [data, luot, sp] = await Promise.all([getStudentMakeup(studentId), docLuotBuChoCon(studentId), searchParams]);

  // Buổi đang CẦN bù (chờ ba mẹ gửi yêu cầu) → đã gửi (chờ xếp) → đã xếp lịch. Buổi đã bù xong không hiện ở đây.
  const dong = [...data.needList, ...data.history.filter((h) => h.status === "SCHEDULED")];
  const buoi: BuoiCanBu[] = dong.map((n) => ({
    id: n.id,
    tenBuoi: n.lessonTitle,
    ngayVang: nhanNgay(n.missedDate),
    lyDo: n.reason,
    lop: n.className || null,
    // CHỈ dòng còn PENDING và chưa có đơn mở mới được vẽ nút gửi (máy chủ từ chối mọi dòng khác). «Đã xếp» mà chưa có giờ bù thật thì coi là chờ xếp.
    trangThai: n.status === "SCHEDULED" ? (n.buoiBu ? "DA_XEP" : "CHO_XEP") : n.yeuCauMo ? "CHO_XEP" : "CAN_BU",
    lichBu: n.buoiBu?.nhanNgay ?? null,
  }));

  return (
    <KhungYeuCau
      tieuDe="Học bù"
      moTa={`Con nghỉ buổi nào, trung tâm xếp buổi bù đúng nội dung buổi đó${data.centerName ? ` tại cơ sở ${data.centerName}` : ""}.`}
    >
      <ManHocBu
        tenCon={ctx.activeStudent?.name ?? ""}
        luot={luot}
        buoi={buoi}
        homNay={vnYmd(new Date())}
        moSan={sp.bu ?? null}
      />
    </KhungYeuCau>
  );
}
