import { db } from "@/lib/db";
import { lapLichNhac, lyDoHuy, type Moc, quaCuaSoBu } from "@/lib/elearning/reminder-schedule";

/**
 * EL-06 — CRON NHẮC, chạy mỗi 15 phút LỆCH PHA (`7,22,37,52 * * * *`).
 *
 * MỘT cron duy nhất tính CẢ 7 mốc trong mã — không phải bảy lịch cron. Lý do
 * nhịp 15 phút chứ không phải nhịp ngày: mốc **T-2 giờ** không có cách nào phục
 * vụ được bằng một lần chạy mỗi đêm.
 *
 * Lệch pha (phút 7/22/37/52) là có chủ đích: mọi phút chia hết cho 5 đã bị
 * `email-queue`, `sla-check` và `chat-zns-notify` chiếm — chồng giờ là hai tác
 * vụ nặng cùng tranh một kết nối.
 *
 * Ba việc, theo thứ tự:
 *   1. lập lịch cho lượt ghi danh CHƯA có lịch;
 *   2. huỷ lịch của lượt đã xong / bị thu hồi / đang tạm dừng;
 *   3. gửi các mốc đã tới hạn.
 *
 * ⚠️ Việc (2) chạy TRƯỚC việc (3): ngược lại thì người vừa học xong vẫn kịp nhận
 * "còn 2 giờ để hoàn thành" trong đúng nhịp này.
 */

import { nhacNguoiCham } from "@/lib/elearning/grader-reminder";
import { chayVongDoiChungNhan, type KetQuaHetHan } from "@/lib/elearning/cron-cert-expiry";
import { notifyStaff } from "@/lib/notifications/notify";
import {
  noiDungTheoMoc,
  khoaChongTrung,
} from "@/lib/elearning/reminder-send";

const LO = 200;
const TRAN_MS = 2 * 60 * 1000;

export type KetQuaNhac = {
  lapLich: number;
  huy: number;
  daGui: number;
  boQua: number;
  /**
   * EL-15d việc (4) — nhắc NGƯỜI CHẤM khi hàng đợi vỡ cam kết.
   *
   * `thieuNguoiNhan` nói ra khi không có ai để nhắc, thay vì im lặng coi như xong:
   * một hàng đợi tắc mà không ai nhận được nhắc là đúng cái hỏng khó thấy nhất.
   */
  nhacCham: { quaHan: number; daGui: number; thieuNguoiNhan: string | null };
  /** EL-16 việc (5) — nhắc T-30/T-7, chốt hết hạn, giao lại vòng tái chứng nhận. */
  chungNhan: KetQuaHetHan;
  /**
   * `true` = cờ `ELEARNING_REMINDER_ENABLED` đang TẮT nên bốn việc NHẮC (lập lịch, huỷ lịch, gửi, nhắc người
   * chấm) và nhắc T-30/T-7 của chứng nhận KHÔNG chạy lượt này. Nói ra thay vì để các con số 0 đọc như "không
   * có gì để nhắc". Vòng đời chứng nhận (chốt hết hạn, giao lại vòng) vẫn chạy.
   */
  nhacTat: boolean;
  loi: string[];
};

type DongEnroll = {
  id: string;
  status: string;
  dueAt: Date | null;
  pausedAt: Date | null;
  createdAt: Date;
};

/**
 * `opts.nhacBat` BẮT BUỘC (không mặc định — tsc liệt kê chỗ gọi): cờ `ELEARNING_REMINDER_ENABLED` chỉ được chặn
 * việc NHẮC. Cổng cờ trước đây đặt ở route (`return ok({skipped})` trước hàm này) nên cờ OFF còn tắt luôn
 * việc 5 — chốt chứng nhận hết hạn và giao lại vòng tái chứng nhận — vốn không phải "nhắc" (rà soát đối
 * kháng 24/10/2026). Cờ OFF: `TrnReminder` giữ `PENDING`; bật lại thì mốc trễ >24h chuyển SKIPPED (`quaCuaSoBu`).
 */
export async function runElearningReminders(
  now: Date,
  opts: { nhacBat: boolean },
): Promise<KetQuaNhac> {
  const batDau = Date.now();
  const conGio = () => Date.now() - batDau < TRAN_MS;
  const ket: KetQuaNhac = {
    lapLich: 0,
    huy: 0,
    daGui: 0,
    boQua: 0,
    nhacCham: { quaHan: 0, daGui: 0, thieuNguoiNhan: null },
    chungNhan: { daNhac: 0, chotHetHan: 0, giaoLai: 0, khongGiaoLaiDuoc: 0, loi: [] },
    nhacTat: !opts.nhacBat,
    loi: [],
  };

  // Bốn việc NHẮC — chỉ chạy khi cờ REMINDER bật.
  if (opts.nhacBat) {
    // ── 1. Lập lịch cho lượt ghi danh chưa có dòng nhắc nào ───────────────────
    try {
      const chuaCo = (await db.trnEnrollment.findMany({
        where: {
          status: { in: ["NOT_STARTED", "IN_PROGRESS"] },
          reminders: { none: {} },
        },
        select: { id: true, status: true, dueAt: true, pausedAt: true, createdAt: true },
        take: LO,
      })) as DongEnroll[];

      for (const e of chuaCo) {
        if (!conGio()) break;
        const lich = lapLichNhac({
          // `createdAt` của lượt ghi danh LÀ mốc được giao: dòng này sinh ra đúng
          // lúc lượt giao chạy.
          assignedAt: e.createdAt,
          dueAt: e.dueAt,
          now,
        });
        // `skipDuplicates` + khoá `@@unique([enrollmentId, milestone])`: hai nhịp
        // cron chồng nhau (chạy lâu quá 15 phút) không đẻ lịch đôi.
        const r = await db.trnReminder.createMany({
          data: lich.map((d) => ({
            enrollmentId: e.id,
            milestone: d.milestone,
            scheduledAt: d.scheduledAt,
            status: d.status,
            reason: d.reason ?? null,
          })),
          skipDuplicates: true,
        });
        ket.lapLich += r.count;
      }
    } catch (e) {
      ket.loi.push(`lap-lich: ${String(e)}`);
    }

    // ── 2. Huỷ lịch của lượt đã đóng hoặc đang tạm dừng ───────────────────────
    try {
      const dong: { dk: Record<string, unknown>; ly: string }[] = [
        { dk: { status: "COMPLETED" }, ly: lyDoHuy("COMPLETED") },
        { dk: { status: "COMPLETED_LATE" }, ly: lyDoHuy("COMPLETED_LATE") },
        { dk: { status: "REVOKED" }, ly: lyDoHuy("REVOKED") },
        { dk: { pausedAt: { not: null } }, ly: lyDoHuy("PAUSED") },
      ];
      for (const d of dong) {
        const r = await db.trnReminder.updateMany({
          // ⚠️ CHỈ đụng dòng `PENDING`. Dòng `SENT` là bản ghi việc đã xảy ra, không
          // phải kế hoạch — huỷ nó là sửa lại lịch sử.
          where: { status: "PENDING", enrollment: d.dk },
          data: { status: "CANCELLED", reason: d.ly },
        });
        ket.huy += r.count;
      }
    } catch (e) {
      ket.loi.push(`huy: ${String(e)}`);
    }

    // ── 3. Gửi các mốc đã tới hạn ─────────────────────────────────────────────
    try {
      while (conGio()) {
        const den = (await db.trnReminder.findMany({
          where: { status: "PENDING", scheduledAt: { lte: now } },
          select: {
            id: true,
            milestone: true,
            scheduledAt: true,
            enrollment: {
              select: {
                id: true,
                userId: true,
                status: true,
                courseId: true,
                // ⚠️ Cần cho CÂU CHỮ. Thiếu thì thông báo chỉ nói "bạn có khoá cần
                // hoàn thành" — người nhận không phân biệt được mốc nào.
                dueAt: true,
              },
            },
          },
          orderBy: { scheduledAt: "asc" },
          take: LO,
        })) as {
          id: string;
          milestone: Moc;
          scheduledAt: Date;
          enrollment: {
            id: string;
            userId: string;
            status: string;
            courseId: string;
            dueAt: Date | null;
          };
        }[];
        if (!den.length) break;

        // Tên khoá nạp theo LÔ, không tra từng dòng: một lô 200 mốc mà tra 200 lần là
        // 200 lượt đi vòng, và cron có trần 2 phút.
        const khoaIds = [...new Set(den.map((x) => x.enrollment.courseId))];
        const dsKhoa = await db.trnCourse.findMany({
          where: { id: { in: khoaIds } },
          select: { id: true, title: true },
        });
        const tenKhoaCua = new Map(dsKhoa.map((c) => [c.id, c.title]));

        for (const r of den) {
          // Cửa sổ nhắc BÙ 24 giờ (đặc tả EL-06 mục 7): mốc trễ quá 24h không gửi nữa, chuyển SKIPPED —
          // bật lại cờ REMINDER sau khi tắt lâu không được dội tin về những mốc đã mất ý nghĩa.
          if (quaCuaSoBu(r.scheduledAt, now)) {
            await db.trnReminder.update({
              where: { id: r.id },
              data: { status: "SKIPPED", reason: "quá cửa sổ nhắc bù 24 giờ — không gửi" },
            });
            ket.boQua += 1;
            continue;
          }

          // Người đã xong mà mốc vẫn còn `PENDING` (vừa xong giữa hai nhịp) ⇒ bỏ
          // qua chứ không gửi. Việc (2) đã quét, nhưng khoảng hở giữa hai việc vẫn
          // là khoảng hở.
          const xong =
            r.enrollment.status === "COMPLETED" || r.enrollment.status === "COMPLETED_LATE";
          if (xong) {
            await db.trnReminder.update({
              where: { id: r.id },
              data: { status: "SKIPPED", reason: "đã hoàn thành trước khi tới mốc" },
            });
            ket.boQua += 1;
            continue;
          }

          // ⚠️ GỬI THẬT — bản trước CHỈ ghi sổ `SENT` rồi return, không gửi gì.
          //
          // Chú thích cũ viết "gửi thật đi qua hàng sự kiện", nhưng không sự kiện nào
          // được phát và không handler nào lắng nghe. Cách hỏng của nó im lặng và
          // KHÔNG TỰ SỬA: sổ đã `SENT` nên lần quét sau bỏ qua — người học không nhận
          // một lời nhắc nào cho cả bảy mốc, còn báo cáo vận hành thấy "đã gửi" đủ.
          const tenKhoa = tenKhoaCua.get(r.enrollment.courseId) ?? "khoá được giao";
          const noiDung = noiDungTheoMoc({
            moc: r.milestone,
            tenKhoa,
            han: r.enrollment.dueAt,
          });
          const soNguoi = await notifyStaff({
            userIds: [r.enrollment.userId],
            dedupeKey: khoaChongTrung(r.enrollment.id, r.milestone),
            title: noiDung.title,
            body: noiDung.body,
            href: `/elearning/hoc/${r.enrollment.id}`,
            entityId: r.enrollment.id,
            reopen: noiDung.keoVeChuaDoc,
          });

          // ⚠️ Ghi ĐÚNG kênh đã gửi, không ghi sẵn `["IN_APP","EMAIL"]`.
          //
          // Bản trước khai cả EMAIL trong khi không gửi email nào — một dòng sổ nói
          // dối về việc đã làm, và nó là thứ người vận hành dựa vào khi người học báo
          // "tôi không nhận được gì".
          await ghiNhanDaGui(r.id, now, soNguoi > 0 ? ["IN_APP"] : []);
          ket.daGui += soNguoi > 0 ? 1 : 0;
          if (soNguoi === 0) ket.boQua += 1;
        }

        if (den.length < LO) break;
      }
    } catch (e) {
      ket.loi.push(`gui: ${String(e)}`);
    }

    // ── Việc 4: nhắc NGƯỜI CHẤM khi hàng đợi vỡ cam kết ───────────────────────
    //
    // ⚠️ Chạy trong khe cron ĐÃ CÓ. Ngân sách module là đúng 2 khe và đã dùng hết —
    // không xin khe thứ ba (QĐ-CDA-14 điểm 2).
    //
    // ⚠️ Nhắc rơi vào người CHẤM, không vào người nộp. Người nộp đã làm xong phần của
    // mình, và hạn của họ đang được cron đêm tự nới.
    try {
      ket.nhacCham = await nhacNguoiCham(now);
    } catch (e) {
      ket.loi.push(`nhacCham: ${(e as Error).message}`);
    }
  }

  // ── Việc 5: vòng đời HẾT HIỆU LỰC của chứng nhận (EL-16) ──────────────────
  //
  // ⚠️ Cũng nằm trong khe cron NÀY. Ngân sách module là đúng 2 khe; đây là việc thứ
  // năm chia nhau một khe, không phải khe thứ ba.
  //
  // ⚠️ Đặt CUỐI cùng và bọc try riêng: ba việc trên phục vụ người đang học và có
  // mốc T-2 GIỜ — chúng không được chết theo một lỗi của việc chạy hằng ngày này.
  try {
    ket.chungNhan = await chayVongDoiChungNhan(now, { nhacBat: opts.nhacBat });
  } catch (e) {
    ket.loi.push(`chungNhan: ${(e as Error).message}`);
  }

  return ket;
}

/**
 * Ghi sổ một mốc ĐÃ GỬI.
 *
 * ⚠️ `kenh` là danh sách kênh THẬT SỰ đã gửi, do chỗ gọi truyền vào. Ghi cứng
 * `["IN_APP","EMAIL"]` như bản trước là để lại một dòng sổ nói dối về việc đã làm —
 * và đó chính là dòng người vận hành mở ra khi người học báo "tôi không nhận được
 * gì". KHÔNG có ZNS (QĐ-CDA-08).
 */
async function ghiNhanDaGui(reminderId: string, now: Date, kenh: string[]) {
  await db.trnReminder.update({
    where: { id: reminderId },
    data: {
      // Không gửi được cho ai thì KHÔNG đánh `SENT`: để `PENDING` cho nhịp sau thử
      // lại, thay vì đóng sổ một việc chưa xảy ra.
      status: kenh.length > 0 ? "SENT" : "PENDING",
      ...(kenh.length > 0 ? { sentAt: now } : {}),
      sentChannels: kenh,
    },
  });
}
