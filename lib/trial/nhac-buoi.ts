import "server-only";

// lib/trial/nhac-buoi.ts — THÂN của cron `/api/cron/trial-reminder`.
//
// ── VÌ SAO TÁCH KHỎI `route.ts` (17/09/2026) ──────────────────────────────────────────
// Thân cũ nằm thẳng trong handler và mở màn bằng `const now = new Date()`. Hệ quả: KHÔNG
// có cách nào viết một ca test cho nó mà không đọc đồng hồ thật — tức toàn bộ phần rẽ mốc
// (thứ vừa được thêm một nhánh mới) nằm ngoài tầm mọi ca test. Luật 19 của repo gọi đúng
// tên lớp lỗi ấy: "ca hẹn giờ nổ" — mã không đổi, tờ lịch đổi.
//
// Nay `now` là THAM SỐ BẮT BUỘC, KHÔNG có mặc định (luật 7). Cố ý không cho `now = new Date()`:
// mặc định như vậy làm `tsc` im lặng ở mọi nơi gọi, và nơi nào quên truyền thì lại rơi về
// đồng hồ thật đúng như cũ. Bắt buộc ⇒ trình biên dịch liệt kê giúp toàn bộ call site.
//
// ⚠️ Route KHÔNG được nhận `?now=` từ query. Đây là endpoint chạy trên prod; mở tham số
// thời gian ra ngoài là mở đường cho người gọi tự chọn mốc và phát lại chuông tuỳ ý.
//
// ── HAI LOẠI NGƯỜI NHẬN ────────────────────────────────────────────────────────────────
// · `nhan: "sale"`  — mốc "1-ngay" và "2-gio": nhắc SALE để Sale tự nhắn phụ huynh qua Zalo
//   cá nhân. Hệ thống KHÔNG gửi tin tự động cho phụ huynh — chốt nghiệp vụ, không phải giới
//   hạn kỹ thuật. Nhánh này GIỮ NGUYÊN không đổi một chữ so với bản đang chạy.
// · `nhan: "giao-vien"` — mốc "1-gio" (V2-d, chủ dự án chốt 17/09): nhắc GIÁO VIÊN dạy buổi.
//
// Rẽ nhánh theo `moc.nhan` — TRƯỜNG DỮ LIỆU, không so `moc.ten` bằng chuỗi. Xem `NhanMoc`
// trong `_moc.ts` để biết vì sao (so theo tên thì mốc GV mới rơi vào nhánh Sale, và triệu
// chứng hiện ra ở người KHÔNG liên quan).
import { db } from "@/lib/db";
import { notifyStaff, notifyStaffChiTiet } from "@/lib/notifications/notify";
import { vnYmd } from "@/lib/time/vn";
import { layNguoiDaoTao } from "@/lib/trial/notify-training";
import { LOP_CU_WHERE } from "@/lib/trial/nghia-null";
import {
  chonMoc,
  mocBatDau,
  nhanThoiDiem,
} from "@/app/api/cron/trial-reminder/_moc";

export interface KetQuaNhacTrial {
  /** Số buổi lọt khoảng quét thô (trước khi lọc theo cửa sổ mốc). */
  buoiQuet: number;
  /** Số chuông đã gửi cho SALE (một chuông / một CA học thử). */
  daNhac: number;
  /**
   * Số chuông THẬT SỰ gửi cho GIÁO VIÊN (một chuông / một BUỔI / một NGÀY).
   *
   * "Thật sự" = có người rơi vào `canRung`. Lượt cron thứ hai trở đi trong cùng cửa sổ
   * chạm lại đúng bản ghi cũ và KHÔNG gửi gì, nên nó đếm 0 — khác `daNhac` của nhánh Sale,
   * vốn vẫn đếm theo lượt gọi (nhánh đó GIỮ NGUYÊN, không sửa trong đợt này).
   */
  daNhacGv: number;
  /** Số buổi tới mốc GV mà chưa ai dạy ⇒ leo thang cho Đào tạo. */
  leoThang: number;
  /** Buổi/ca bị bỏ vì thiếu dữ liệu (giờ hỏng, không có người nhận…). */
  boQua: number;
}

/**
 * Một lượt quét nhắc buổi trải nghiệm.
 *
 * @param now Thời điểm THAM CHIẾU. Bắt buộc — xem khối chú thích đầu tệp.
 */
export async function chayNhacTrial({ now }: { now: Date }): Promise<KetQuaNhacTrial> {
  // Quét rộng một lần rồi lọc trong bộ nhớ: cột `date` chỉ có NGÀY nên không thể lọc
  // theo giờ ở tầng SQL. Số buổi trải nghiệm mỗi ngày rất nhỏ, không đáng lo về tải.
  // Khoảng quét (−24h…+72h) CỐ Ý rộng hơn cửa sổ nhắc (tối đa 25h): buổi 23:59 của ngày
  // VN lệch tới +31h so với mốc UTC-midnight của chính nó — cắt sát là mất buổi cuối ngày.
  const sessions = await db.trialClassSession.findMany({
    where: {
      status: "SCHEDULED",
      date: {
        gte: new Date(now.getTime() - 24 * 3_600_000),
        lte: new Date(now.getTime() + 72 * 3_600_000),
      },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      seq: true,
      // 17/09 — giáo viên của BUỔI. Trước đợt này không được `select`, nên nhánh nhắc GV
      // không có gì để bám. Giáo viên nằm ở TỪNG BUỔI chứ không ở lớp (xem schema
      // `TrialClassSession.teacherId`), và nó nullable — đó là đường mặc định của form.
      teacherId: true,
      // 17/09 — BẮT BUỘC cho nhánh (b) của câu tra ghi danh bên dưới. Thiếu cột này thì
      // không cách nào hỏi "em nào học cả lớp", và đó là ca thường gặp nhất.
      trialClassId: true,
      trialClass: { select: { name: true, centerId: true } },
    },
  });

  const stats: KetQuaNhacTrial = {
    buoiQuet: sessions.length,
    daNhac: 0,
    daNhacGv: 0,
    leoThang: 0,
    boQua: 0,
  };

  for (const s of sessions) {
    const batDau = mocBatDau(s.date, s.startTime);
    if (!batDau) {
      stats.boQua++;
      continue;
    }
    const conBaoLau = (batDau.getTime() - now.getTime()) / 3_600_000;
    const moc = chonMoc(conBaoLau);
    if (!moc) continue;

    // Ca ĐANG HỌC được xếp vào buổi này. Ca đã gỡ/đã xong thì không nhắc nữa.
    //
    // ⚠️ HAI DIỆN, KHÔNG PHẢI MỘT — vá 17/09/2026, lỗi này có sẵn trên `main` từ 28/08.
    //
    // Bản cũ chỉ hỏi `scheduledSessionId: s.id`. Nhưng từ 28/08 gỡ auto-gán buổi thì CẢ HAI
    // màn xếp chỗ bên admin đều CỐ Ý không truyền `sessionId` (`enroll-panel.tsx`,
    // `trial-enroll-widget.tsx`), nên `lib/trial/service.ts:381` ghi `scheduledSessionId = null`
    // và null ở bảng này KHÔNG có nghĩa "chưa xếp buổi" — nó nghĩa là **học TOÀN BỘ buổi của
    // lớp**. Lọc bằng `= s.id` không bao giờ khớp null ⇒ `cas` rỗng ⇒ cron đếm 0 ca ⇒ KHÔNG
    // nhắc ai, cho cả Sale lẫn giáo viên, và `ok: true` với `buoiQuet` dương nên hỏng CÂM.
    // Chỉ ghi danh ĐÃ DỜI LỊCH (`service.ts:927`) mới mang giá trị non-null — đủ để thỉnh
    // thoảng có một buổi chạy và trông như tính năng vẫn sống.
    //
    // Khuôn dưới đây chép từ `lib/lms/teacher-schedule.ts:757-771`, nơi repo ĐÃ vá đúng bẫy
    // này ngày 04/09 và tự chú nhánh (b) là "ca THƯỜNG GẶP NHẤT". Đừng thu lại còn một vế.
    const cas = await db.trialEnrollment.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          // (a) xếp riêng đúng buổi này (ghi danh đã dời lịch).
          { scheduledSessionId: s.id },
          // (b) học CẢ LỚP — đường mặc định của mọi lượt xếp chỗ từ 28/08, NHƯNG chỉ ở
          //     lớp slot CŨ. 23/09/2026: ở lớp theo khung, NULL là "chưa xếp case"
          //     (`lib/trial/nghia-null.ts`); đếm bé đó vào MỌI case là Sale nhận N chuông
          //     với N giờ khác nhau cho cùng một bé, và case không có ai vẫn nhắc GV.
          {
            scheduledSessionId: null,
            trialClassId: s.trialClassId,
            trialClass: LOP_CU_WHERE,
          },
        ],
      },
      select: {
        id: true,
        leadChild: {
          select: {
            fullName: true,
            lead: {
              select: { id: true, parentName: true, phone: true, assignedToId: true, adminId: true },
            },
          },
        },
      },
    });

    if (moc.nhan === "giao-vien") {
      await nhacGiaoVien({ s, soCa: cas.length, batDau, mocTen: moc.ten, stats });
      continue;
    }

    for (const ca of cas) {
      const lead = ca.leadChild?.lead;
      // Người nhận là Sale phụ trách; không có thì admin lead. Không ai thì bỏ qua —
      // gửi cho cả cơ sở là làm nhiễu chuông của người không liên quan.
      const userId = lead?.assignedToId ?? lead?.adminId;
      if (!userId) {
        stats.boQua++;
        continue;
      }

      const { gio, ngay } = nhanThoiDiem(batDau);

      await notifyStaff({
        userIds: [userId],
        // Khoá kèm MỐC nhắc: một buổi được nhắc hai lần (1 ngày và 2 giờ) là hai việc
        // khác nhau. Kèm cả id ca để hai bé cùng buổi không đè chuông của nhau.
        dedupeKey: `trial.reminder:${moc.ten}:${ca.id}:${s.id}`,
        category: "TRIAL",
        // Tiêu đề in NGÀY/GIỜ THẬT thay vì "ngày mai": cửa sổ cron rộng hơn mốc danh
        // nghĩa nên chữ tương đối có thể lệch hẳn một ngày (lỗi #21).
        title:
          moc.ten === "1-ngay"
            ? `Nhắc phụ huynh buổi trải nghiệm ${gio} ngày ${ngay}`
            : `Buổi trải nghiệm bắt đầu lúc ${gio} ngày ${ngay}`,
        // SĐT nằm trong body có chủ đích: nhắc việc mà phải mở lead ra mới gọi được thì
        // mất đúng cái tiện. `notifyStaff` tự che bớt số trước khi lưu.
        body: `Nhắn phụ huynh ${lead?.parentName ?? ""} (${lead?.phone ?? "chưa có SĐT"}) về buổi trải nghiệm của ${ca.leadChild?.fullName ?? "học viên"} — buổi ${s.seq} lớp ${s.trialClass?.name ?? ""}, lúc ${gio} ngày ${ngay}.`,
        href: lead?.id ? `/leads/${lead.id}` : "/lop-trial",
        entityId: ca.id,
      });
      stats.daNhac++;
    }
  }

  return stats;
}

interface BuoiCanNhac {
  id: string;
  seq: number;
  teacherId: string | null;
  trialClass: { name: string; centerId: string | null } | null;
}

/**
 * Nhánh GIÁO VIÊN — MỘT BUỔI, MỘT CHUÔNG.
 *
 * ⚠️ Cố ý nằm NGOÀI vòng lặp từng ca. Nhánh Sale nhắc theo CA vì mỗi ca là một phụ huynh
 * khác nhau phải gọi; giáo viên thì chỉ có một việc duy nhất — đứng lớp lúc đó. Nhắc theo
 * ca là 5 bé thành 5 lần rung điện thoại cho cùng một buổi, và `dedupeKey` cũng không cứu
 * được vì mỗi ca một khoá.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG đưa SĐT / tên phụ huynh / tên học viên vào `body`. Chuông này đi tiếp
 * ra Web Push, và push hiện trên MÀN HÌNH KHOÁ — kênh duy nhất trong hệ thống mà dữ liệu bay
 * ra ngoài phiên đăng nhập, không `can()` nào gác được (xem `lib/push/payload.ts`). Giáo viên
 * cần biết GIỜ và LỚP; danh sách học viên đã nằm sẵn trong màn buổi học.
 */
async function nhacGiaoVien(p: {
  s: BuoiCanNhac;
  /** SỐ ca ACTIVE của buổi — chỉ cần con số. Cố ý KHÔNG truyền danh sách ca vào đây:
   *  hàm này dựng nội dung đi ra Web Push, và thứ nó không cầm thì nó không lỡ tay in ra. */
  soCa: number;
  batDau: Date;
  mocTen: string;
  stats: KetQuaNhacTrial;
}): Promise<void> {
  const { s, soCa, batDau, mocTen, stats } = p;

  // Buổi chưa có em nào đang học ⇒ im. Nhắc một buổi rỗng là làm phiền, và buổi trải
  // nghiệm là slot tái sử dụng nên buổi rỗng hoàn toàn bình thường.
  if (soCa === 0) return;

  const { gio, ngay } = nhanThoiDiem(batDau);
  const tenLop = s.trialClass?.name ?? "";

  if (!s.teacherId) {
    // Tới mốc mà buổi vẫn chưa ai dạy ⇒ LEO THANG cho Đào tạo. Còn ~1 tiếng, không còn
    // chỗ cho việc "để mai tính".
    //
    // ⚠️ Khoá RIÊNG, KHÔNG dùng lại `trial.cho-phan-cong:<sessionId>` của lúc TẠO buổi
    // (`lib/trial/notify-training.ts`). `dedupeKey` có `@@unique([userId, dedupeKey])`:
    // trùng khoá là lượt sau ĐÈ lên bản ghi cũ — tin "chưa có giáo viên" gốc biến mất
    // khỏi panel và thay bằng tin gấp, nên người nhận mất luôn dấu vết việc này đã treo
    // từ lúc nào.
    const userIds = await layNguoiDaoTao(s.trialClass?.centerId ?? null);
    if (userIds.length === 0) {
      stats.boQua++;
      return;
    }
    await notifyStaff({
      userIds,
      dedupeKey: `trial.cho-phan-cong-gap:${s.id}`,
      category: "TRIAL",
      title: `GẤP: buổi trải nghiệm ${gio} ngày ${ngay} chưa có giáo viên`,
      body: `Lớp ${tenLop} — buổi ${s.seq} bắt đầu lúc ${gio} ngày ${ngay} mà chưa phân công giáo viên.`,
      href: "/lop-trial",
      entityId: s.id,
    });
    stats.leoThang++;
    return;
  }

  const kq = await notifyStaffChiTiet({
    userIds: [s.teacherId],
    // Khoá theo BUỔI (không theo ca): một buổi = một việc dạy. Kèm tên mốc để sau này
    // thêm mốc GV thứ hai không đè lên mốc này.
    //
    // ── VÌ SAO KÈM CẢ MỐC NGÀY (vá 17/09/2026) ────────────────────────────────────────
    // Bản cũ khoá đúng `<mocTen>:<sessionId>`, và `@@unique([userId, dedupeKey])` biến nó
    // thành khoá VĨNH VIỄN cho cặp (người, buổi). Đường hỏng đo được: buổi 14/11 18:00 đã
    // bắn chuông; Sale dời sang 15/11 18:00 (status vẫn `SCHEDULED`, `sessionId` không
    // đổi); hôm sau lượt cron tới mốc lại dựng ĐÚNG khoá đó ⇒ `ghiThongBaoNhanSu` chỉ
    // `update` nội dung, `canRung` rỗng ⇒ KHÔNG broadcast, KHÔNG Web Push, `readAt` giữ
    // nguyên "đã đọc". Giáo viên không được nhắc cho NGÀY MỚI, và màn hình không có gì
    // khác thường để ai nhận ra.
    // Dời lịch là một VIỆC NHẮC KHÁC, không phải cùng một việc — nên khoá phải mang ngày.
    //
    // ⚠️ Vì sao KHÔNG dùng `reopen: true` thay cho việc này: `reopen` kéo bản ĐÃ ĐỌC về
    // chưa đọc mỗi khi nội dung đổi, tức mỗi lần sửa là một lần `canRung` ⇒ một lần đẩy
    // push (`lib/push/allowlist.ts` liệt đúng 4 nơi đang bật cờ đó là mìn). Ở đây nội
    // dung đổi cả khi chỉ sửa tên lớp, nên `reopen` là mở đường cho push lặp. Khoá theo
    // ngày thì hẹp và tự hết: một buổi một ngày, tối đa một chuông.
    //
    // `vnYmd(batDau)` — KHÔNG dựng chuỗi ngày riêng: `batDau` cũng là mốc sinh ra chữ
    // `${ngay}` trong tiêu đề, nên khoá và nội dung không bao giờ nói hai ngày khác nhau.
    //
    // GIỚI HẠN CÒN LẠI, nói thẳng: dời trong CÙNG MỘT NGÀY (18:00 → 20:00) vẫn ra cùng
    // khoá ⇒ nội dung được `update` đúng giờ mới (panel đọc ra giờ đúng) nhưng KHÔNG có
    // push mới. Đổi giờ trong ngày thì chuông "1 tiếng trước" của ngày đó thường còn
    // chưa phát; ca đã phát rồi mới dời trong ngày là ca hiếm và đã có tin
    // `trial-session.updated:` của đường sửa buổi lo.
    dedupeKey: `trial.reminder-gv:${mocTen}:${s.id}:${vnYmd(batDau)}`,
    category: "TRIAL",
    title: `Sắp tới giờ dạy trải nghiệm ${gio} ngày ${ngay}`,
    body: `Lớp ${tenLop} — buổi ${s.seq} bắt đầu lúc ${gio} ngày ${ngay}.`,
    href: "/lop-trial",
    entityId: s.id,
  });
  // Chỉ đếm khi THẬT SỰ có người được đánh động. `canRung` = ai vừa có mục MỚI hoặc vừa
  // được mở lại; danh sách người nhận (`soNguoi`) thì luôn là 1 ở đây, kể cả những lượt
  // quét chạm lại đúng bản ghi cũ và không gửi gì. Đếm theo `soNguoi` là để nhật ký cron
  // báo "đã nhắc" ở mọi lượt trong cửa sổ 1,1 giờ — một con số không kiểm được gì.
  if (kq.canRung.length > 0) stats.daNhacGv++;
}
