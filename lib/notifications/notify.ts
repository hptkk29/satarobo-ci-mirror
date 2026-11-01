import "server-only";
import { db } from "@/lib/db";
import { broadcastMessages, notificationBumpBroadcasts } from "@/lib/chat/broadcast";
import { classifyNotification } from "./catalog";
import { cheSdt, kiemPii } from "./pii";
import { ghiOutboxPush } from "@/lib/push/outbox";

// =============================================================================
// ĐƯỜNG GHI DUY NHẤT của thông báo nhân sự.
//
// Trước đây 17 nơi tự gọi `db.staffNotification.upsert` với mỗi nơi một kiểu: nơi set href ở
// `create` mà quên `update` (bản ghi cũ giữ href sai vĩnh viễn), nơi quên href hẳn, không nơi nào
// khai nhóm/mức, và không nơi nào phát tín hiệu realtime. Gom về đây để bốn thứ đó đúng một lần:
//   1. nhóm + mức lấy từ `catalog.ts` — thông báo mới không bao giờ rơi vào "Hệ thống/P3" vì quên;
//   2. href ghi ở CẢ create lẫn update — vá được cả bản ghi sinh trước bản vá;
//   3. che số điện thoại trước khi lưu (PRD T5) — panel chuông mở giữa chỗ đông người;
//   4. bắn `notification.bumped` để badge nhảy ngay, thay vì đợi vòng poll.
//
// ⚠️ KHÔNG nhận `tx`: broadcast phải chạy SAU commit. Gọi hàm này sau khi transaction nghiệp vụ
// đã đóng. Nếu cần ghi thông báo TRONG transaction thì ghi thẳng bằng Prisma rồi tự bắn tín hiệu
// sau — đừng nới hàm này để nhận tx rồi bắn sớm.
// =============================================================================

export interface NotifyStaffParams {
  /** Danh sách người nhận. Trùng nhau/chuỗi rỗng được tự lọc. */
  userIds: readonly string[];
  /** Khoá chống trùng. ĐỪNG đổi format của loại đang chạy — xem chú thích ở catalog.ts. */
  dedupeKey: string;
  title: string;
  body: string;
  /** Đường admin clean-URL, KHÔNG tiền tố `/admin`. `teacherHref()` lo phần site giáo viên. */
  href?: string | null;
  /** Id của đối tượng đích — để sau này thu hồi thông báo khi đối tượng bị xoá. */
  entityId?: string | null;
  /** Giữ tương thích với cột cũ; bỏ trống thì lấy đoạn đầu của `dedupeKey`. */
  category?: string;
  /** Quá mốc này thì thôi đếm vào badge. */
  expiresAt?: Date | null;
  /**
   * true = kéo bản ghi đã đọc về CHƯA ĐỌC khi nội dung đổi.
   * Chỉ bật khi sự việc thật sự lặp lại và người nhận PHẢI xem lại (vd điểm danh bị sửa lần hai).
   * Bật bừa là biến chuông thành nguồn nhiễu — đúng thứ PRD dựng trần 30 mục/ngày để chặn.
   */
  reopen?: boolean;
}

/** Kết quả của một lượt ghi — ai vừa được ghi MỚI hoặc MỞ LẠI là người cần rung chuông. */
export interface GhiThongBaoKetQua {
  /** Số người trong danh sách nhận (sau khi lọc trùng/rỗng). */
  soNguoi: number;
  /** Người có bản ghi mới tạo hoặc vừa kéo về CHƯA ĐỌC — chỉ những người này cần `notification.bumped`. */
  canRung: string[];
}

/** Các cột nội dung được so để biết bản ghi có thực sự đổi hay không. */
const COT_NOI_DUNG = ["title", "body", "href", "groupKey", "priority", "entityType", "entityId"] as const;

/**
 * Ghi thông báo cho nhiều người, KHÔNG bắn realtime. Dùng cho cron quét hàng loạt (vd `sla-check`)
 * để gom mọi tín hiệu của một lượt chạy thành MỘT lần `broadcastNotificationBump` ở cuối.
 *
 * ⚠️ Vì sao phải so trước rồi mới ghi (sự cố egress 05/09/2026): bản cũ upsert vô điều kiện rồi
 * bắn `notification.bumped` cho MỌI người nhận ở MỌI lượt gọi. Cron `sla-check` (mỗi 15 phút) đi qua đây
 * ~1.800 vi phạm/lượt ⇒ 1,34 triệu INSERT cho một bảng chỉ có ~2.000 dòng, và ~170.000 POST
 * broadcast/ngày làm Realtime cạn pool (`DBConnection.ConnectionError`), rồi mỗi bump lại kéo mọi
 * tab admin gọi `/api/notifications/summary`. Kết quả: prod vượt trần egress 5 GB dù DB chỉ 57 MB.
 * Nay: bản ghi đã có và nội dung không đổi ⇒ KHÔNG ghi, KHÔNG rung. Chỉ rung khi tạo mới hoặc
 * khi `reopen` kéo một bản đã đọc về chưa đọc — đúng nghĩa của dedupeKey.
 */
export async function ghiThongBaoNhanSu(params: NotifyStaffParams): Promise<GhiThongBaoKetQua> {
  const nguoiNhan = [...new Set(params.userIds.filter((id) => !!id))];
  if (nguoiNhan.length === 0) return { soNguoi: 0, canRung: [] };

  const canhBao = kiemPii(`${params.title}
${params.body}`);
  if (canhBao.coSdt || canhBao.coTien) {
    // Không chặn — chặn ở đây là nuốt mất một thông báo nghiệp vụ thật. Nhưng phải để lại vết:
    // loại nào lọt SĐT/học phí ra panel là loại cần sửa mẫu câu, không phải sửa chỗ này.
    console.warn(
      `[notifications] ${params.dedupeKey} có dữ liệu nhạy cảm trong tiêu đề/nội dung`,
      canhBao,
    );
  }

  const phanLoai = classifyNotification(params.dedupeKey);
  if (!phanLoai.known) {
    console.warn(
      `[notifications] dedupeKey "${params.dedupeKey}" chưa khai trong catalog — thông báo sẽ nằm chót panel. Thêm một dòng vào lib/notifications/catalog.ts.`,
    );
  }

  const noiDung = {
    title: cheSdt(params.title),
    body: cheSdt(params.body),
    href: params.href ?? null,
    groupKey: phanLoai.groupKey,
    priority: phanLoai.priority,
    entityType: phanLoai.entityType,
    entityId: params.entityId ?? null,
    expiresAt: params.expiresAt ?? null,
  };

  const category = params.category ?? params.dedupeKey.split(":")[0] ?? "system";

  // Một câu đọc cho cả danh sách người nhận — thay cho N upsert mù.
  const daCo = await db.staffNotification.findMany({
    where: { dedupeKey: params.dedupeKey, userId: { in: nguoiNhan } },
    select: {
      userId: true,
      readAt: true,
      title: true,
      body: true,
      href: true,
      groupKey: true,
      priority: true,
      entityType: true,
      entityId: true,
      expiresAt: true,
      // BẮT BUỘC (vá 08/09/2026): thiếu cột này thì `REVOKED` thành ngõ cụt MỘT CHIỀU —
      // nội dung y hệt ⇒ vòng dưới `continue` ⇒ dòng nằm REVOKED vĩnh viễn và người đó
      // KHÔNG BAO GIỜ được báo lại cho cùng một việc. Ca thật: lead A→B→A.
      state: true,
    },
  });
  const theoUser = new Map(daCo.map((r) => [r.userId, r]));

  const canRung: string[] = [];
  for (const userId of nguoiNhan) {
    const cu = theoUser.get(userId);
    if (!cu) {
      // Chưa có ⇒ tạo. Vẫn dùng upsert để hai lượt cron chồng nhau không đẻ P2002.
      await db.staffNotification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: params.dedupeKey } },
        create: { userId, dedupeKey: params.dedupeKey, category, ...noiDung },
        update: noiDung,
      });
      canRung.push(userId);
      continue;
    }

    const noiDungDoi =
      COT_NOI_DUNG.some((k) => cu[k] !== noiDung[k]) ||
      (cu.expiresAt?.getTime() ?? null) !== (noiDung.expiresAt?.getTime() ?? null);
    // Bản ghi đã bị THU HỒI (hoặc hết hạn) mà việc đó phát sinh LẠI ⇒ đây là một lần mới,
    // không phải bản trùng. Không có vế này thì `thuHoiThongBao` là cửa một chiều: đóng rồi
    // là đóng vĩnh viễn cặp (người, khoá) đó. Module cũ đã gặp đúng bẫy này và phải dựng khối
    // "MỞ LẠI" riêng — xem `lib/staff-notifications.ts` (EXPIRED → ACTIVE + reset mốc đọc).
    const daThuHoi = cu.state !== "ACTIVE";
    const moLai = (!!params.reopen && cu.readAt !== null) || daThuHoi;
    if (!noiDungDoi && !moLai) continue; // Y nguyên ⇒ không ghi, không rung.

    // Ghi lại nội dung là CÓ CHỦ ĐÍCH: đường duy nhất chữa được bản ghi sinh trước khi
    // href/nhóm/mức được sửa. Trạng thái đọc giữ nguyên trừ khi nơi gọi xin `reopen`,
    // hoặc bản ghi đang bị thu hồi và nay sống lại.
    await db.staffNotification.update({
      where: { userId_dedupeKey: { userId, dedupeKey: params.dedupeKey } },
      data: {
        ...noiDung,
        ...(moLai ? { readAt: null } : {}),
        ...(daThuHoi ? { state: "ACTIVE" } : {}),
      },
    });
    // Nội dung đổi nhưng vẫn đang chưa đọc ⇒ badge không đổi số, không cần rung.
    if (moLai) canRung.push(userId);
  }

  return { soNguoi: nguoiNhan.length, canRung };
}

/**
 * THU HỒI thông báo: đưa các bản ghi còn hiệu lực về trạng thái `REVOKED`.
 *
 * Vì sao cần (vá 08/09/2026): chuông của repo chưa từng có đường thu hồi — `entityId` được khai
 * với ý "để SAU NÀY thu hồi khi đối tượng bị xoá" nhưng chưa ai làm. Hệ quả cụ thể ở module lead:
 * lead chuyển từ A sang B thì B nhận chuông mới, còn A **giữ nguyên** dòng "Bạn có lead mới" trỏ
 * tới `/leads/<id>` — một lead họ không còn giữ. Nếu là chuyển XUYÊN CƠ SỞ thì tệ hơn: `Lead` nằm
 * trong `SCOPED_MODELS` nên `scopedDb` lọc mất, A bấm chuông ra trang "không tồn tại".
 *
 * `REVOKED` chứ không xoá: `conHieuLuc` (`service.ts`) chỉ đếm `state = "ACTIVE"`, nên đổi trạng
 * thái là đủ để mục biến khỏi badge lẫn panel — mà vẫn giữ được vết "đã từng báo cho ai" cho
 * việc đối soát. Xoá cứng là mất luôn dữ liệu đó.
 *
 * KHÔNG bắn realtime: badge chỉ có thể GIẢM, và người dùng không cần bị đánh động vì một mục vừa
 * biến mất. Nhịp poll kế tiếp sẽ đồng bộ. (Bắn ở đây là mời lại đúng bão broadcast của 05/09.)
 *
 * Chỉ đụng dòng đang `ACTIVE` — `updateMany` nên không ném khi không có gì để thu hồi.
 */
export async function thuHoiThongBao(params: {
  userIds: readonly string[];
  dedupeKey: string;
}): Promise<number> {
  const ds = [...new Set(params.userIds.filter((id) => !!id))];
  if (ds.length === 0 || !params.dedupeKey) return 0;
  const kq = await db.staffNotification.updateMany({
    where: { userId: { in: ds }, dedupeKey: params.dedupeKey, state: "ACTIVE" },
    data: { state: "REVOKED" },
  });
  return kq.count;
}

/**
 * Bắn `notification.bumped` cho danh sách người. Fail-and-forget: `broadcastMessages` cam kết
 * không throw, nhưng vẫn bọc — thông báo ĐÃ nằm trong Postgres, mất tín hiệu realtime chỉ có
 * nghĩa là badge nhảy ở nhịp poll kế tiếp. Người gọi hàng loạt gom một danh sách rồi gọi MỘT lần.
 */
export async function broadcastNotificationBump(userIds: readonly string[]): Promise<void> {
  const ds = [...new Set(userIds.filter((id) => !!id))];
  if (ds.length === 0) return;
  try {
    await broadcastMessages(notificationBumpBroadcasts(ds, { at: new Date().toISOString() }));
  } catch (err) {
    console.warn("[notifications] bắn tín hiệu realtime lỗi — thông báo vẫn đã lưu:", err);
  }
}

/**
 * Ghi thông báo cho nhiều người + bắn tín hiệu realtime cho ai cần.
 *
 * ── VÌ SAO CÓ BẢN "CHI TIẾT" (17/09/2026) ─────────────────────────────────────────────
 * `notifyStaff` trả `soNguoi` = SỐ NGƯỜI TRONG DANH SÁCH NHẬN, và con số đó **không** trả
 * lời được câu "lượt này có thật sự báo cho ai không". Bản ghi y nguyên từ lượt trước ⇒
 * `ghiThongBaoNhanSu` cố ý KHÔNG ghi, KHÔNG rung, KHÔNG đẩy push — nhưng `soNguoi` vẫn là
 * 1. Nơi gọi nào ĐẾM SỐ CHUÔNG ĐÃ GỬI (cron nhắc buổi trải nghiệm: `stats.daNhacGv`) mà
 * đọc `soNguoi` sẽ báo "đã nhắc" ở mọi lượt quét trong cửa sổ, kể cả những lượt không gửi
 * gì — con số trên nhật ký cron không còn kiểm được điều gì.
 *
 * `canRung` mới là "ai vừa có mục MỚI hoặc vừa được mở lại", tức đúng tập người thật sự
 * được đánh động. Bản này trả nguyên kết quả đó cho nơi cần đếm THẬT.
 *
 * ⚠️ Không đổi hành vi: `notifyStaff` chỉ còn là lớp mỏng lấy `soNguoi` của hàm này, nên
 * mọi nơi gọi cũ giữ nguyên từng chữ. Và vẫn chỉ có MỘT đường ghi — đừng thêm đường thứ
 * ba, đừng gọi thẳng `ghiThongBaoNhanSu` + tự broadcast/push ở nơi khác.
 */
export async function notifyStaffChiTiet(
  params: NotifyStaffParams,
): Promise<GhiThongBaoKetQua> {
  const kq = await ghiThongBaoNhanSu(params);
  await broadcastNotificationBump(kq.canRung);
  // Dòng thứ ba: ghi việc-cần-đẩy Web Push (US-14b Đợt 4). Ba điều kiện của chỗ móc này:
  //
  //  1. Bám `kq.canRung`, TUYỆT ĐỐI không `params.userIds`. `canRung` là "ai vừa có mục MỚI hoặc
  //     vừa được mở lại"; `userIds` là toàn bộ danh sách nhận, kể cả người đã có y nguyên mục đó
  //     từ lượt trước. Bám nhầm là đẻ lại đúng bão 05/09 mà khối chú thích ở
  //     `ghiThongBaoNhanSu` vừa vá — với hệ quả nặng hơn, vì lần này mỗi dòng là một lần rung
  //     điện thoại chứ không chỉ một POST realtime.
  //
  //  2. Ở `notifyStaff`, KHÔNG ở `ghiThongBaoNhanSu`. Ranh giới giữa hai hàm là cố ý: hàm dưới
  //     dành cho cron quét hàng loạt (`lib/crm/sla.ts`, ~1.800 vi phạm mỗi lượt) và nó đi cửa đó
  //     CHÍNH VÌ không muốn rung. Push đi theo realtime, không đi theo lượt quét.
  //
  //  3. Ngoài mọi transaction, sau khi chuông đã ghi xong. Hàm này vốn không nhận `tx` (xem đầu
  //     file). Hệ quả chấp nhận có ý thức: tiến trình chết ĐÚNG giữa hai dòng thì có chuông mà
  //     không có push, và lượt gọi lại thấy nội dung y hệt ⇒ `canRung` rỗng ⇒ không ghi bù.
  //     Mất một push, giữ được thông báo — đúng thứ tự ưu tiên; đảo lại (ghi outbox trước) là
  //     đẩy push cho một mục chưa chắc tồn tại.
  //
  // `ghiOutboxPush` cam kết KHÔNG NÉM, nên không cần bọc thêm ở đây.
  //
  // ⚠️ ĐÍNH CHÍNH 17/09/2026 — câu cũ ở đây giải thích cam kết đó bằng "migration hai bảng
  // push chưa chạy ở môi trường nào". Câu ấy KHÔNG CÒN ĐÚNG: migration
  // `20260908000000_web_push_ha_tang` vào repo ngày 08/09 (`cbf1ec71`) và lên `main` — tức
  // lên prod — qua PR #246 merge 13/09. Hai bảng push CÓ THẬT ở mọi môi trường.
  //
  // Lý do KHÔNG bọc try/catch thì vẫn nguyên, và nó không phụ thuộc vào migration: cam kết
  // "không ném" là THUỘC TÍNH của `ghiOutboxPush` (nó tự nuốt + log), và nó phải giữ nguyên
  // như vậy vì `notifyStaff` là đường ghi DUY NHẤT của mọi thông báo nhân sự — một lỗi lọt
  // ra từ dòng này làm hỏng điểm danh, giao bài, chuyển lead… mọi thứ có chuông. Bọc thêm
  // một lớp ở đây chỉ che mất việc cam kết kia bị ai đó phá.
  //
  // Nhưng cũng không được bỏ `await`: `void` trong Server Action là mất ngẫu nhiên theo tải
  // trên Vercel.
  await ghiOutboxPush({
    userIds: kq.canRung,
    dedupeKey: params.dedupeKey,
    expiresAt: params.expiresAt ?? null,
  });
  return kq;
}

/** Như `notifyStaffChiTiet` nhưng chỉ trả SỐ NGƯỜI NHẬN — chữ ký cũ, ~180 nơi gọi. */
export async function notifyStaff(params: NotifyStaffParams): Promise<number> {
  return (await notifyStaffChiTiet(params)).soNguoi;
}
