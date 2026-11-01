// app/(teacher)/teacher/cham-cong/page.tsx — mục menu "Chấm công" trên site GV.
//
// Mặc định chấm công là QUÉT MÃ QR tại quầy (mã trỏ thẳng vào ./checkin), nên trang này
// chủ yếu là hướng dẫn.
//
// ⚠️ ĐÍNH CHÍNH CHÚ THÍCH CŨ (đặt 05/09/2026). Bản trước viết: "không có nút chấm tay là
// CHỦ ĐÍCH: chấm ở đâu thì phải đứng ở đó quét." Câu đó ĐÚNG cho ca làm tại cơ sở và VẪN
// đúng — nhưng từ 15/09/2026 nó KHÔNG còn đúng cho MỌI ngày.
//
// Phần A chốt: ngày ĐI CÔNG TÁC không có quầy nào để đứng, không mã QR, và không ghim
// được toạ độ trước vì công tác nhiều nơi. Ngày đó hiện MỘT nút "Chấm công" (hai nút Check in /
// Check out cũ gộp làm một 06/10/2026 — máy chủ tự suy vào/ra theo ca, `suyHuongHomNay`).
//
// Điều kiện hiện nút: ca hôm nay có `placeMode === "OFFSITE"` — KHÔNG hardcode mã "NG".
// Mã là TÊN, `placeMode` là NGHĨA; mã nào sau này khai OFFSITE cũng tự có nút.
//
// Nút ẩn KHÔNG phải một cổng: `chamCongTac` tự kiểm lại điều kiện ấy ở phía server, vì
// Server Action là một endpoint riêng và gọi thẳng được.
import { QrCode, ScanLine } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMyShiftOfDay, getMyTapsOfDay } from "@/lib/cham-cong/my-schedule";
import { vnDateOnly } from "@/lib/time/vn";
import { PageHeader } from "../_components/ui/page-header";
import { NutChamNgoai } from "@/components/cham-cong/nut-cham-ngoai";
import { quyenChamNgoaiLucNay } from "@/lib/cham-cong/cham-ngoai-db";
import { suyHuongHomNay } from "@/lib/cham-cong/suy-huong-db";

export const metadata = { title: "Chấm công | Giáo viên", robots: { index: false } };

/** Giờ VN "HH:mm" của một mốc. */
const gioVN = (d: Date) =>
  new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(d);

export default async function TeacherChamCongPage() {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const now = new Date();
  const homNay = vnDateOnly(now);
  const ca = await getMyShiftOfDay(session.user.id, homNay);
  // Đợt 5–6 đơn từ: ca công tác HOẶC đơn công tác / làm từ xa đã duyệt phủ lúc này (`cham-ngoai.ts`).
  const quyen = await quyenChamNgoaiLucNay(session.user.id, now);
  const laCongTac = quyen !== null;

  const taps = laCongTac ? await getMyTapsOfDay(session.user.id, homNay) : [];
  const vao = taps.find((t) => t.direction === "CHECK_IN");
  // Lượt RA lấy cái CUỐI: bấm nhầm rồi bấm lại thì mốc đúng là mốc sau.
  const ra = [...taps].reverse().find((t) => t.direction === "CHECK_OUT");
  // Dự đoán hướng lượt kế tiếp cho nút công tác (MỘT nút, 06/10/2026) — `chamCongTac` suy lại
  // lúc bấm, đó mới là hướng được ghi. Chỉ tính khi có nút để bấm.
  const goiY = laCongTac ? await suyHuongHomNay({ userId: session.user.id, workLocationId: null, now: new Date() }) : null;
  const duDoan = goiY ? { huong: goiY.huong, nhanBuoi: goiY.nhanBuoi, trung: goiY.trung } : null;

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Chấm công"
        subtitle={
          laCongTac
            ? `${quyen!.nhan}${ca ? ` · ca ${ca.templateCode}` : ""} — bấm nút Chấm công dưới đây mỗi lần bắt đầu hoặc kết thúc.`
            : "Quét mã QR trên màn hình tại quầy cơ sở."
        }
      />

      {laCongTac && (
        <section className="mb-5 rounded-2xl border border-primary-soft bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-foreground">Chấm công ngoài cơ sở — {quyen!.nhan}</h2>
          <NutChamNgoai
            daVao={vao ? gioVN(vao.loggedAt) : null}
            daRa={ra ? gioVN(ra.loggedAt) : null}
            duDoan={duDoan}
            donChinhCongHref="/teacher/don-tu?type=TIMESHEET_FIX"
          />
        </section>
      )}

      {/* Hướng dẫn QR vẫn giữ nguyên cho MỌI ngày: người đi công tác buổi sáng vẫn có thể
          ghé cơ sở buổi chiều, và họ cần biết đường quét ở đó. */}
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <ol className="space-y-4 text-sm text-foreground">
          <li className="flex gap-3">
            <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              Mở camera điện thoại, quét mã QR trên màn hình chấm công tại quầy. Đường dẫn mở ra
              chính là trang chấm công của bạn.
            </span>
          </li>
          <li className="flex gap-3">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span>
              Bấm nút <b>Chấm công</b> — mỗi lần tới hoặc về bấm một lần, hệ thống tự biết là vào
              hay ra theo ca của bạn. Bật định vị (GPS) khi được hỏi. Mỗi lần bấm cần quét lại mã.
            </span>
          </li>
        </ol>
        <p className="mt-5 text-xs text-muted-foreground">
          Quét nhầm mã của cơ sở khác sẽ bị từ chối. Nếu bạn dạy thay ở cơ sở khác theo phân
          công, báo Quản lý cơ sở đó xác nhận công.
        </p>
      </div>
    </div>
  );
}
