import "server-only";

import { upstashCommand, getRateLimitBackend } from "@/lib/rate-limit";
import { KHOA_PHAT_TTL_GIAY } from "@/lib/elearning/video-heartbeat-contract";

/**
 * EL-12b — KHOÁ PHÁT, cơ chế chống XEM SONG SONG.
 *
 * Một người mở cùng một khoá trên hai máy rồi để cả hai chạy là cách rẻ nhất để
 * nhân đôi giờ xem mà không xem. Khoá theo NGƯỜI (không theo bài): mở hai bài khác
 * nhau cùng lúc cũng là hai luồng tiến độ chạy song song từ một đôi mắt.
 *
 * ⚠️ TTL ngắn (30 giây) và gia hạn bằng chính nhịp. Khoá dài thì đóng sập máy đột
 * ngột sẽ khoá chính người đó ra khỏi bài mình đang học, và họ phải ngồi đợi hết
 * hạn mà không hiểu vì sao — một cơ chế chống gian lận biến thành lỗi sản phẩm.
 *
 * 🔴 Redis chết thì VẪN CHO HỌC (chốt của chủ dự án 24/08) — quyết định và cái giá
 * của nó nằm ở `quyetDinhKhoaPhat` trong `video-heartbeat-contract.ts`. Ở đây chỉ
 * làm đúng một việc: nói THẬT về việc có khoá dùng chung hay không, để đường gọi
 * đếm được số lượt rơi vào nhánh fail-open.
 */

export type KetQuaGianhKhoa = {
  /** `"upstash"` = có khoá dùng chung; mọi giá trị khác = KHÔNG có. */
  backend: string;
  /** Khoá đang do một phiên KHÁC giữ. */
  khoaThuocNguoiKhac: boolean;
};

export const khoaPhatCua = (userId: string) => `play-lock:${userId}`;

/**
 * Giành hoặc gia hạn khoá phát.
 *
 * `sessionId` phân biệt hai tab của CÙNG một người: chủ khoá hiện tại gia hạn được,
 * người khác thì không. Không có nó thì mọi nhịp của chính chủ cũng trông như
 * tranh chấp, và người học bị đá ra khỏi bài của chính mình mỗi 30 giây.
 */
export async function gianhKhoaPhat(input: {
  userId: string;
  sessionId: string;
  ttlGiay?: number;
}): Promise<KetQuaGianhKhoa> {
  const backend = getRateLimitBackend();
  if (backend !== "upstash") return { backend, khoaThuocNguoiKhac: false };

  const key = khoaPhatCua(input.userId);
  const ttl = String((input.ttlGiay ?? KHOA_PHAT_TTL_GIAY) * 1000);

  // SET NX: chỉ đặt nếu chưa ai giữ. Trả "OK" ⇒ khoá vừa về tay mình.
  const dat = await upstashCommand(["SET", key, input.sessionId, "NX", "PX", ttl]);
  if (dat === "OK") return { backend, khoaThuocNguoiKhac: false };

  // Đã có người giữ — có thể là chính mình ở nhịp trước.
  const chu = await upstashCommand(["GET", key]);
  if (chu === null) {
    // Vừa đọc thì khoá hết hạn, hoặc Redis lỗi. Không kết luận có tranh chấp: đoán
    // sai theo hướng CHẶN là chặn nhầm người đang học thật.
    return { backend, khoaThuocNguoiKhac: false };
  }
  if (chu !== input.sessionId) return { backend, khoaThuocNguoiKhac: true };

  // Chính mình ⇒ gia hạn. Nhịp là thứ giữ khoá sống, nên không cần cron nào cả.
  await upstashCommand(["PEXPIRE", key, ttl]);
  return { backend, khoaThuocNguoiKhac: false };
}

/**
 * Nhả khoá khi người học rời trang.
 *
 * Chỉ nhả nếu khoá đang thuộc về chính phiên này — kiểm tra rồi mới xoá, để một tab
 * vừa đóng không cướp mất khoá của tab người khác vừa giành được.
 *
 * ⚠️ Không phải đường sống còn: quên gọi thì khoá tự hết sau 30 giây. Nó chỉ rút
 * ngắn khoảng chờ cho lần mở tiếp theo.
 */
export async function nhaKhoaPhat(input: {
  userId: string;
  sessionId: string;
}): Promise<void> {
  if (getRateLimitBackend() !== "upstash") return;
  const key = khoaPhatCua(input.userId);
  const chu = await upstashCommand(["GET", key]);
  if (chu === input.sessionId) await upstashCommand(["DEL", key]);
}
