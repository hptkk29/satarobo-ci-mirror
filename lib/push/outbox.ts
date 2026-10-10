import "server-only";

// lib/push/outbox.ts — ghi việc-cần-đẩy vào `WebPushOutbox`. Web Push Đợt 4.
//
// Đây là NỬA GHI của kênh; nửa gửi nằm ở `engine.ts`. Tách đôi vì hai nửa chạy ở hai thời
// điểm khác nhau và có hai luật an toàn khác nhau: nửa này chạy TRONG đường nghiệp vụ (không
// được phép làm hỏng nó), nửa kia chạy trong cron (được phép hỏng và thử lại).
//
// ── VÌ SAO KHÔNG GỬI THẲNG Ở ĐÂY ────────────────────────────────────────────────────────
// Server Action trên Vercel bị giết ngay khi response trả về; một `void guiPush(...)` không
// `await` là mất tin ngẫu nhiên theo tải, và triệu chứng là "thỉnh thoảng không nhận được" —
// loại lỗi không tái hiện được, không đo được, không sửa được. Ghi một dòng rồi để cron gửi
// là cách duy nhất có sổ sách.

import { db } from "@/lib/db";
import { duocDayPush } from "./allowlist";
import { docTienToDuocDay, LY_DO_NGOAI_DANH_SACH } from "./cau-hinh-allowlist";

/**
 * Hạn sống mặc định của một việc đẩy — 6 giờ.
 *
 * KHÔNG phải con số trang trí. Công tắc `push.webPushEnabled` đang TẮT, mà điểm móc vẫn ghi
 * dòng `PENDING` (cố ý: để nghiệm thu được đường ghi trước khi mở kênh). Không có hạn thì
 * NGÀY BẬT CÔNG TẮC là ngày mọi dòng tồn từ trước bay ra cùng lúc — hàng chục lần rung máy
 * cho những lead đã xử xong từ tuần trước. Đó chính là ca mà cột `expiresAt` được khai để chặn.
 *
 * 6 giờ vì giá trị của kênh này nằm ở chữ "ngay": một lead báo sau 6 tiếng thì khách đã gọi
 * xong ba trung tâm khác. Quá hạn ⇒ engine ghi `SKIPPED`, có vết, không gửi.
 */
export const HAN_MAC_DINH_MS = 6 * 60 * 60_000;

/**
 * Ghi việc-cần-đẩy cho một danh sách người.
 *
 * @returns số dòng THẬT SỰ được tạo (0 nếu tất cả đã có sẵn — xem `skipDuplicates`).
 *
 * ⚠️ KHÔNG BAO GIỜ NÉM. Hàm này được gọi từ `notifyStaff`, tức đường ghi DUY NHẤT của mọi
 * thông báo nhân sự trong hệ thống. Một lỗi ở đây mà lọt ra ngoài sẽ làm hỏng điểm danh, giao
 * bài, chuyển lead… — mọi thứ có chuông. Ca cụ thể đang chờ sẵn: migration của hai bảng push
 * CHƯA chạy ở môi trường nào, nên tới ngày merge mà chưa `migrate deploy` thì Prisma ném
 * P2021 "table does not exist" ở mọi lượt gọi. Nuốt lỗi + log là hành vi đúng: push là kênh
 * phụ, thông báo trong ứng dụng đã nằm an toàn trong Postgres trước khi dòng này chạy.
 */
export async function ghiOutboxPush(params: {
  userIds: readonly string[];
  dedupeKey: string;
  /** Hạn của chính thông báo (nếu nơi gọi có khai). Lấy mốc SỚM HƠN giữa nó và hạn mặc định. */
  expiresAt?: Date | null;
  now?: Date;
}): Promise<number> {
  const nguoiNhan = [...new Set(params.userIds.filter((id) => !!id))];
  if (nguoiNhan.length === 0 || !params.dedupeKey) return 0;

  const now = params.now ?? new Date();
  const hanMacDinh = new Date(now.getTime() + HAN_MAC_DINH_MS);
  const han =
    params.expiresAt && params.expiresAt.getTime() < hanMacDinh.getTime()
      ? params.expiresAt
      : hanMacDinh;

  // Ngoài allowlist ⇒ vẫn ghi, nhưng ghi thẳng `SKIPPED`.
  //
  // Vì sao ghi chứ không bỏ qua: đây là sổ trả lời được câu "vì sao tôi không nhận được thông
  // báo X". Không có dòng nào thì câu trả lời chỉ có thể tìm bằng cách đọc mã nguồn, và người
  // hỏi sẽ không phân biệt được "loại này cố ý không đẩy" với "kênh hỏng". Cái giá là số dòng —
  // chấp nhận được vì `@@unique([userId, dedupeKey])` chặn nhân bản, và `notifyStaff` chỉ gọi
  // vào đây với `canRung` (người THẬT SỰ vừa có mục mới), không phải toàn bộ danh sách nhận.
  //
  // 13/09 — danh sách nay đọc từ cấu hình vận hành (`push.tienToDuocDay`).
  //
  // ⚠️ ĐỌC HỎNG THÌ GIỮ DÒNG Ở `PENDING`, KHÔNG chốt `SKIPPED`. Nhìn qua tưởng fail-OPEN —
  // KHÔNG PHẢI, và đừng "sửa" nó:
  //   · `SKIPPED` là trạng thái CHỐT: engine chỉ quét `PENDING`/`FAILED`, nên một dòng bị chốt
  //     vì pooler Supabase chập 2 giây là MẤT HẲN, không lượt nào cứu.
  //   · Quyết định GỬI không nằm ở đây. Engine kiểm LẠI danh sách ngay trước lúc bắn
  //     (`engine.ts`), và nếu chính nó cũng không đọc được cấu hình thì nó THOÁT cả lượt chứ
  //     không gửi. Tức là: không cú push nào rời máy mà chưa đọc được cấu hình một lần thành
  //     công. Giữ `PENDING` chỉ là "chưa biết, để lượt sau xét" — đúng nghĩa của `PENDING`.
  //   · Cái giá: trong lúc DB chập, vài dòng thuộc loại KHÔNG bật cũng nằm `PENDING`. Chúng
  //     chết ở cổng engine (ghi `SKIPPED` kèm lý do) hoặc hết hạn 6 giờ. Có sổ, không gửi.
  const cauHinh = await docTienToDuocDay();
  const duocDay = !cauHinh.docDuoc || duocDayPush(params.dedupeKey, cauHinh.tienTo);
  if (!cauHinh.docDuoc) {
    console.warn(
      `[push] chưa xét được danh sách loại cho "${params.dedupeKey}" — để PENDING, engine sẽ xét lại trước khi gửi.`,
    );
  }

  try {
    const kq = await db.webPushOutbox.createMany({
      data: nguoiNhan.map((userId) => ({
        userId,
        dedupeKey: params.dedupeKey,
        status: duocDay ? ("PENDING" as const) : ("SKIPPED" as const),
        // Dòng SKIPPED không bao giờ được gửi nên hạn của nó vô nghĩa — vẫn ghi để hai loại
        // dòng có cùng hình dạng, câu dọn về sau không phải viết hai nhánh.
        expiresAt: han,
        ...(duocDay ? {} : { lastError: LY_DO_NGOAI_DANH_SACH }),
      })),
      // Đã có dòng cho cặp (người, khoá) này ⇒ BỎ QUA, tuyệt đối không kéo về `PENDING`.
      //
      // Ca thật: `notifyStaff` có tham số `reopen` kéo một mục đã đọc về chưa đọc, và 4 nơi
      // đang bật nó. Nếu đây là `upsert` thì mỗi lần mở lại là một lần đẩy lại — kể cả khi
      // dòng cũ đã `SENT` và người ta đã cầm máy đọc rồi. `skipDuplicates` biến chuyện đó
      // thành không-làm-gì, ở tầng DB, không phụ thuộc nơi gọi nhớ hay quên.
      skipDuplicates: true,
    });
    return kq.count;
  } catch (err) {
    console.warn(
      `[push] không ghi được outbox cho "${params.dedupeKey}" (${nguoiNhan.length} người) — thông báo trong ứng dụng KHÔNG bị ảnh hưởng:`,
      err,
    );
    return 0;
  }
}
