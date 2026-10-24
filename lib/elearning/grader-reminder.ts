import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { userIdCuaVai } from "@/lib/elearning/_handlers/notify";
import { demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";
import { CANH_BAO_SO_BAI_QUA_SLA } from "@/lib/elearning/metrics/constants";

/**
 * EL-15d — NHẮC NGƯỜI CHẤM khi hàng đợi vỡ cam kết.
 *
 * ⚠️ Nhắc rơi vào NGƯỜI CHẤM và TRƯỞNG PHÒNG ĐÀO TẠO, **không** rơi vào người nộp.
 * Người nộp đã làm xong phần của mình; giục họ là đổ lỗi sai chỗ, và họ không có
 * hành động nào để làm cả. Hạn của họ đã được cron bù tự động.
 *
 * ⚠️ Nhắc theo NGÀY, một lần, không theo nhịp cron 15 phút. `dedupeKey` mang ngày
 * để hai lượt cron trong cùng ngày không sinh hai thông báo — nhắc mỗi 15 phút là
 * cách chắc chắn để người ta tắt thông báo đi, và khi đó cái nhắc thật cũng mất.
 *
 * ⚠️ MỘT thông báo cho CẢ hàng đợi, không phải mỗi bài một cái. Ba mươi bài trễ mà
 * gửi ba mươi dòng là làm ngập hộp thư đúng người cần đọc nó.
 */

export type KetQuaNhacCham = {
  quaHan: number;
  daGui: number;
  /** `null` = không có ai để nhắc; nói ra thay vì im lặng coi như xong. */
  thieuNguoiNhan: string | null;
};

/** Khoá ngày theo giờ Việt Nam — cron chạy UTC, và "hôm nay" là của người đọc. */
function ngayVN(now: Date): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function nhacNguoiCham(now = new Date()): Promise<KetQuaNhacCham> {
  const quaHanList = await db.trnSubmission.findMany({
    where: { status: "SUBMITTED", dueGradeAt: { lt: now } },
    select: { dueGradeAt: true },
    orderBy: { dueGradeAt: "asc" },
    take: 500,
  });

  if (quaHanList.length === 0) {
    return { quaHan: 0, daGui: 0, thieuNguoiNhan: null };
  }

  // Chỉ nhắc khi CHẠM ngưỡng cảnh báo, không nhắc từ bài đầu tiên: một bài trễ nửa
  // ngày là chuyện thường của một hàng đợi đang chạy, và nhắc nó là dạy người ta
  // bỏ qua thông báo.
  if (quaHanList.length < CANH_BAO_SO_BAI_QUA_SLA) {
    return { quaHan: quaHanList.length, daGui: 0, thieuNguoiNhan: null };
  }

  const cuNhat = quaHanList[0]!.dueGradeAt;
  const tuoi = cuNhat ? demNgayLamViec(cuNhat, now) : 0;

  const nguoiCham = await userIdCuaVai("TRAINING");
  if (nguoiCham.length === 0) {
    // ⚠️ Nói ra. Một cron báo "xong" trong khi không ai nhận được nhắc là đúng thứ
    // im lặng khiến hàng đợi tắc mà không ai biết.
    return {
      quaHan: quaHanList.length,
      daGui: 0,
      thieuNguoiNhan: "không có tài khoản nào mang vai TRAINING để nhắc",
    };
  }

  await notifyStaff({
    userIds: nguoiCham,
    // Ngày nằm trong khoá ⇒ đúng MỘT thông báo mỗi ngày, dù cron chạy 96 lượt.
    dedupeKey: `el.cham-tre:${ngayVN(now)}`,
    title: `${quaHanList.length} bài tập quá hạn chấm`,
    body:
      tuoi > 0
        ? `Bài chờ lâu nhất đã ${tuoi} ngày làm việc. Hạn của người nộp đang được hệ thống tự nới — họ không bị tính trễ vì việc này.`
        : "Mở hàng đợi để chấm.",
    href: "/elearning/cham-bai-tap",
    entityId: `cham-tre-${ngayVN(now)}`,
  });

  return { quaHan: quaHanList.length, daGui: nguoiCham.length, thieuNguoiNhan: null };
}
