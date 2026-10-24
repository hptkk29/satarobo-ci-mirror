import "server-only";

// lib/push/thu-hoi.ts — thu hồi đăng ký push PHÍA SERVER khi phiên kết thúc. Web Push Đợt 5.
//
// ── CA THẬT PHẢI ĐÓNG ───────────────────────────────────────────────────────────────────
// Service worker khoá theo ORIGIN, KHÔNG theo phiên đăng nhập. Máy lễ tân dùng chung, một hồ
// sơ Chrome: Sale A bật thông báo ⇒ dòng `(endpoint E, userId = A, ACTIVE)`. A đăng xuất, Sale B
// đăng nhập trên đúng hồ sơ đó. Đăng ký E vẫn sống và vẫn mang `userId = A`, nên mọi lead chia
// cho A từ đó nổ trên màn hình khoá của máy B đang cầm — kèm tên phụ huynh. B không có lý do
// nào để bấm "Bật thông báo" nên không có gì tự chữa.
//
// ── VÌ SAO PHẢI CÓ NỬA SERVER, KHÔNG CHỈ NỬA CLIENT ─────────────────────────────────────
// Nửa client (`lib/auth/logout-client.ts`) chỉ chạy khi người dùng CHỦ ĐỘNG bấm đăng xuất.
// Nhưng bốn layout (`admin`/`teacher`/`portal`/`sale`) còn tự `redirect("/dang-xuat?reason=…")`
// khi tài khoản bị XOÁ (`deletedAt`), bị VÔ HIỆU HOÁ (`!isActive`), hoặc `tokenVersion` lệch
// (đổi mật khẩu) — ba đường mà client tuyệt đối không chạy được gì. Đó cũng là ba ca NGUY HIỂM
// NHẤT: nhân viên vừa rời công ty mà đăng ký push của họ còn sống trên MỌI máy, và lưới thứ hai
// (chuyển chủ khi người mới đăng ký) cũng không với tới vì không ai bật thông báo trên máy đó.
//
// ⚠️ PHẠM VI hai hàm dưới đây CỐ Ý KHÁC NHAU, và đó là quyết định vận hành chứ không phải
// chuyện gọn gàng:
//  · người dùng TỰ bấm đăng xuất ⇒ chỉ gỡ ĐÚNG máy đang ngồi (nửa client, theo endpoint) —
//    gỡ hết là đăng xuất ở desktop công ty làm mất push trên điện thoại riêng, mà người ta
//    đăng xuất hằng ngày;
//  · server ĐÁ RA vì tài khoản chết ⇒ gỡ TẤT CẢ. Ở ca đó "gỡ hết" là ĐÚNG, không phải quá tay.

import { db } from "@/lib/db";

/**
 * Hai lý do khiến một tài khoản được coi là ĐÃ CHẾT.
 *
 * ⚠️ CỐ Ý KHÔNG có "đổi mật khẩu" / "đổi vai" / "đổi quyền" — xem `thuHoiNeuTaiKhoanChet`.
 */
export type LyDoThuHoiPush = "da-xoa" | "bi-vo-hieu-hoa";

const NHAN_LY_DO: Record<LyDoThuHoiPush, string> = {
  "da-xoa": "Tài khoản đã bị xoá",
  "bi-vo-hieu-hoa": "Tài khoản bị vô hiệu hoá",
};

/**
 * Thu hồi MỌI đăng ký còn sống của một người.
 *
 * @returns số dòng thật sự bị thu hồi (0 nếu người đó chưa bật thông báo ở đâu).
 *
 * ⚠️ KHÔNG BAO GIỜ NÉM. Hàm này nằm trên đường ĐĂNG XUẤT — mà route `/dang-xuat` tồn tại chính
 * để cứu người khỏi một phiên đã chết (nó vá vòng lặp `ERR_TOO_MANY_REDIRECTS`). Một lỗi ở đây
 * mà lọt ra ngoài sẽ giam người dùng lại trong đúng cái vòng lặp đó. Ca cụ thể đang chờ sẵn:
 * migration hai bảng push CHƯA chạy ở môi trường nào, nên Prisma ném P2021 ở mọi lượt gọi cho
 * tới lần merge đầu tiên. Nuốt lỗi + log là hành vi đúng: cùng lắm là push của một tài khoản đã
 * chết còn sống thêm một lúc, và push service sẽ trả 410 khi thiết bị thật gỡ ứng dụng.
 */
export async function thuHoiMoiThietBiCuaNguoi(params: {
  userId: string;
  lyDo: LyDoThuHoiPush;
  now?: Date;
}): Promise<number> {
  if (!params.userId) return 0;
  const now = params.now ?? new Date();
  try {
    const kq = await db.webPushSubscription.updateMany({
      // Chỉ đụng dòng đang `ACTIVE`: `REVOKED`/`EXPIRED` đã chốt, ghi lại là xoá mất mốc
      // `revokedAt` thật và lý do thật của lần thu hồi trước.
      where: { userId: params.userId, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedReason: NHAN_LY_DO[params.lyDo],
      },
    });
    return kq.count;
  } catch (err) {
    console.warn(
      `[push] không thu hồi được thiết bị lúc đăng xuất (${params.lyDo}) — phiên vẫn được dọn:`,
      err,
    );
    return 0;
  }
}

/**
 * Thu hồi MỌI thiết bị NHƯNG CHỈ KHI tài khoản thật sự đã chết.
 *
 * ── VÌ SAO KHÔNG DÙNG `checkSessionLiveness` — LỖ DO BẢN VÁ ĐỢT 5 ĐẺ RA, LĂNG KÍNH TÌM RA ──
 * Bản trước của route `/dang-xuat` gọi `checkSessionLiveness` rồi thu hồi khi `live: false`.
 * Nhưng hàm đó trả CÙNG MỘT NHÃN `session-invalidated` cho hai việc khác nhau hẳn:
 *   · tài khoản bị XOÁ / VÔ HIỆU HOÁ  — chết thật, gỡ hết là đúng;
 *   · `tokenVersion` LỆCH             — chỉ là "buộc đăng nhập lại", tài khoản còn sống nguyên.
 *
 * Mà bump `tokenVersion` là thao tác THƯỜNG NGÀY của repo này — đo được 9 nơi: đổi vai
 * (`nhan-su/actions.ts`, `users/_actions.ts`), cấp/thu quyền per-user
 * (`users/[id]/permissions/_actions.ts`, 3 nơi), force logout, tự đặt lại mật khẩu. Hệ quả của
 * bản trước: SUPER_ADMIN cấp thêm một quyền cho một Sale ⇒ lượt tải trang kế tiếp bị layout đá
 * qua `/dang-xuat?reason=session-invalidated` ⇒ **gỡ sạch push trên MỌI máy của người đó**.
 * Không màn nào báo; họ chỉ đơn giản không nhận lead nữa — đúng loại hỏng câm mà cả đợt này
 * sinh ra để tránh.
 *
 * Nên hàm này tự đọc DB và tự quyết, chỉ theo hai cột NÓI VỀ SỰ SỐNG của tài khoản. Cố ý KHÔNG
 * nới `SessionLiveness` thêm lý do thứ ba: kiểu đó do đường auth sở hữu và ba layout đang dùng,
 * đổi hợp đồng của nó để phục vụ một việc của module push là đặt rủi ro ở sai chỗ.
 *
 * @returns `chet` = tài khoản đã chết (đã thu hồi), `soDong` = số thiết bị bị gỡ.
 *
 * ⚠️ KHÔNG BAO GIỜ NÉM — cùng lý do như `thuHoiMoiThietBiCuaNguoi`: hàm này nằm trên đường
 * ĐĂNG XUẤT, mà route `/dang-xuat` tồn tại chính để cứu người khỏi vòng lặp redirect.
 */
export async function thuHoiNeuTaiKhoanChet(params: {
  userId: string;
  now?: Date;
}): Promise<{ chet: boolean; soDong: number }> {
  if (!params.userId) return { chet: false, soDong: 0 };
  let lyDo: LyDoThuHoiPush | null = null;
  try {
    const u = await db.user.findUnique({
      where: { id: params.userId },
      select: { isActive: true, deletedAt: true },
    });
    // Không tìm thấy cũng là chết: bản ghi đã bị xoá cứng.
    if (!u || u.deletedAt) lyDo = "da-xoa";
    else if (!u.isActive) lyDo = "bi-vo-hieu-hoa";
  } catch (err) {
    console.warn("[push] không đọc được tình trạng tài khoản khi đăng xuất — bỏ thu hồi:", err);
    return { chet: false, soDong: 0 };
  }
  if (!lyDo) return { chet: false, soDong: 0 };
  const soDong = await thuHoiMoiThietBiCuaNguoi({ userId: params.userId, lyDo, now: params.now });
  return { chet: true, soDong };
}

/**
 * Trần thời gian cho lưới `events.signOut` — 1,5 giây, cùng bậc với `CHO_GO_PUSH_MS` của
 * `lib/auth/logout-client.ts`.
 *
 * BẮT BUỘC phải có, và lý do là một phép đo chứ không phải phòng xa: `@auth/core` gọi
 * `await events.signOut?.({ token })` (`lib/actions/signout.js`) **KHÔNG có timeout nào**. Handler
 * chậm là ĐĂNG XUẤT TREO đúng bằng thời gian đó, mà hàm này chạm DB hai lượt trên Supabase.
 * Người bấm "Đăng xuất" trên máy dùng chung là đang muốn đứng lên đi.
 */
export const CHO_SIGNOUT_MS = 1_500;

/**
 * Lưới THỨ BA: thu hồi khi tài khoản đã chết, cắm vào `events.signOut` của Auth.js.
 *
 * ── VÌ SAO CẦN LƯỚI THỨ BA ────────────────────────────────────────────────────────────────
 * Hai nửa đã có (`app/(auth)/dang-xuat/route.ts` và `lib/auth/logout-client.ts`) chỉ phủ hai
 * nơi gọi `signOut` mà repo tự viết. `events.signOut` là điểm mà MỌI lượt POST tới endpoint
 * signout đều đi qua — đo được ở `@auth/core/lib/actions/signout.js`. Cái nó phủ THÊM là ai POST
 * thẳng `/api/auth/signout` — gồm trang xác nhận đăng xuất mặc định của Auth.js ở
 * `GET /api/auth/signout` (repo không khai `pages.signOut`, và không link nào trỏ tới, nên đường
 * đó reachable chứ chưa ai dùng).
 *
 * ⚠️ HAI NỬA CŨ ĐI QUA ĐÂY THEO HAI CÁCH KHÁC NHAU, và khác biệt đó quyết định vì sao KHÔNG nửa
 * nào thay thế được nửa nào (lăng kính Đợt 6 sửa chỗ này — bản đầu gộp chúng làm một):
 *  · nửa SERVER (`/dang-xuat` → `signOut()` của `@/lib/auth`) dựng một POST NỘI TIẾN TRÌNH rồi
 *    gọi `Auth()` (`next-auth/lib/actions.js`) ⇒ không thể bị huỷ giữa đường;
 *  · nửa CLIENT (`logoutToGate` → `signOut` của `next-auth/react`) là một `fetch` TỪ TRÌNH DUYỆT
 *    ⇒ HUỶ ĐƯỢC: mất mạng đúng lúc bấm, người dùng bấm Stop, hay đóng tab giữa lúc chờ thì server
 *    KHÔNG BAO GIỜ chạy event. Nên `goDangKyPushCuaMayNay` vẫn là nửa không thay thế được, và
 *    đừng đọc lưới thứ ba như thể nó đã phủ đường client.
 *
 * ⚠️ ĐỪNG viết tài liệu như thể nó phủ "mọi đường đăng xuất", và kể cả trên đường nó phủ thì nó
 * chỉ phủ NẾU hai truy vấn xong dưới trần chờ dưới đây. Đo được ba ca nó KHÔNG phủ:
 *  · `jwt.decode` ném ở `signout.js` (cookie rác, khoá lệch) ⇒ event không chạy, vì cùng `try`;
 *  · `GET /api/auth/signout` chỉ render trang xác nhận, không bắn event;
 *  · và `if (!sessionToken) return` ở đầu hàm ⇒ phiên đã hết cookie thì cũng không bắn.
 * Nhóm 4 của §14.4 (đóng tab, JWT hết hạn, xoá cookie tay) vẫn nguyên.
 *
 * ⚠️ GỌI `thuHoiNeuTaiKhoanChet`, TUYỆT ĐỐI KHÔNG `thuHoiMoiThietBiCuaNguoi`. Event này phát ở
 * MỌI lượt đăng xuất, kể cả lượt thường ngày của một tài khoản còn sống. Đặt sai hàm là đảo
 * ngược quyết định vận hành ở đầu tệp này — đăng xuất ở máy công ty thành mất push trên điện
 * thoại riêng, im lặng, không màn nào báo.
 *
 * KHÔNG BAO GIỜ NÉM. `@auth/core` có bọc `try/catch` quanh lời gọi (đã đọc mã), và
 * `sessionStore.clean()` nằm NGOÀI khối đó nên cookie vẫn được xoá — tức người dùng vẫn đăng
 * xuất được dù handler ném. Vẫn không dựa vào điều đó: một thư viện đổi hành vi ở bản sau là
 * giam người dùng trong một phiên không thoát được.
 */
export async function thuHoiKhiAuthSignOut(message: unknown): Promise<void> {
  try {
    // `message` là UNION `{ session } | { token }` (đọc kiểu ở `@auth/core`), và nhánh `token`
    // là `JWT | null` — cần CẢ `in`-guard cho TypeScript strict LẪN null-guard cho lúc chạy.
    // Repo khai `session: { strategy: "jwt" }` nên thực tế luôn là nhánh `token`.
    if (typeof message !== "object" || message === null || !("token" in message)) return;
    const token = (message as { token: Record<string, unknown> | null }).token;
    if (!token) return;

    // `token.id` do `callbacks.jwt` của repo đặt; `token.sub` là mặc định của Auth.js. Thứ tự
    // này trùng thứ tự `callbacks.session` đang dùng, và vế lùi `sub` có một lý do THẬT: một JWT
    // đúc TRƯỚC khi `callbacks.jwt` bắt đầu đặt `token.id` thì chỉ mang `sub`, nên vế lùi phục vụ
    // token cũ còn hiệu lực. (Bản đầu của chú thích này nói hai giá trị "có thể lệch nhau sau khi
    // đổi tài khoản" — lăng kính Đợt 6 phản bác: đổi tài khoản là đúc một token MỚI với hai khoá
    // bằng nhau, nên ca đó không tồn tại. Giữ thứ tự, bỏ lý lẽ bịa.)
    const userId =
      (typeof token.id === "string" && token.id) ||
      (typeof token.sub === "string" && token.sub) ||
      null;
    if (!userId) return;

    // Trần chờ PHẢI để lại vết khi nó thắng. Nhánh "tài khoản đã chết" tốn HAI lượt DB
    // (findUnique + updateMany) — tức nhánh duy nhất bắt buộc phải xong lại là nhánh chậm gấp
    // đôi, nên nó là nhánh dễ vượt trần nhất. Khi vượt: `Promise.race` nhả, `signout.js` dọn
    // cookie, response flush, và Vercel có thể đóng băng thực thể giữa câu `UPDATE`. Vế thua
    // không bao giờ settle nên `catch` dưới đây KHÔNG chạy và `console.warn` của
    // `thuHoiMoiThietBiCuaNguoi` cũng không chạy ⇒ không dòng nào nói rằng việc thu hồi đã bị bỏ.
    // Lỗ ở đây không phải "chậm" mà là "IM LẶNG"; một dòng log biến nó thành thứ đo được.
    let hetGio: ReturnType<typeof setTimeout> | undefined;
    try {
      const xong = await Promise.race([
        thuHoiNeuTaiKhoanChet({ userId }).then(() => true as const),
        new Promise<false>((r) => {
          hetGio = setTimeout(() => r(false), CHO_SIGNOUT_MS);
        }),
      ]);
      if (!xong) {
        console.warn(
          `[push] lưới events.signOut quá ${CHO_SIGNOUT_MS}ms — BỎ QUA thu hồi cho ${userId}. ` +
            "Đăng xuất vẫn hoàn tất; nếu tài khoản đã chết thì thiết bị có thể còn ACTIVE.",
        );
      }
    } finally {
      // Ca thường (DB trả trong vài chục ms) nếu không dọn sẽ để lại một timer 1,5s còn cắm.
      // Trên serverless gần như vô hại, nhưng nó là một open handle làm khó chẩn đoán một treo
      // THẬT sau này, và nó hiện ra trong bộ test chạy fake timers.
      if (hetGio) clearTimeout(hetGio);
    }
  } catch (err) {
    console.warn("[push] lưới thu hồi ở events.signOut lỗi — đăng xuất vẫn xong:", err);
  }
}
