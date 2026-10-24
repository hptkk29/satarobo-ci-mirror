import "server-only";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import type { VaiZaloCrm } from "./vai-tro";

/**
 * S1 — Vé SSO Sata → ZaloCRM (fork). Kế hoạch tích hợp §F1 + §S1.
 *
 * KHUÔN LẤY TỪ `lib/chat/realtime-token.ts` (cùng repo, cùng `SignJWT` HS256, cùng lớp
 * `*Error` mã EN/thông điệp VI, cùng cách kiểm `tokenVersion` chống đăng-xuất-cưỡng-bức).
 * Đừng thêm thư viện JWT thứ hai: `jose` đã là dependency trực tiếp.
 *
 * CÁCH DÙNG BÊN KIA: fork nhận vé ở `POST /api/v1/auth/sso`, kiểm `jti` chưa dùng (Redis),
 * rồi upsert `User` theo cột `external_id` = `sub` trong org có `code = orgCode`. Tài khoản
 * ZaloCRM vì thế KHÔNG tạo tay — mở màn lần đầu là có.
 *
 * ⚠️ ĐIỀU KHÔNG KIỂM ĐƯỢC ĐẦU-CUỐI Ở ĐÂY: fork chưa tồn tại (việc F1, repo khác). Nên
 * file này cố ý tách "việc KÝ" khỏi "việc DÙNG": `taoClaimsSso` thuần, `mintSsoToken` chỉ
 * chạm DB đúng một câu để kiểm tài khoản còn sống. `sso.test.ts` tự `jwtVerify` bằng chính
 * secret ⇒ kiểm được claims/exp/jti/secret-sai mà không cần fork.
 */

/**
 * Vé sống **60 giây**. Ngắn hơn hẳn vé realtime (5 phút) vì bản chất khác: vé này dùng
 * ĐÚNG MỘT LẦN ngay lúc khung nhúng tải xong, không gia hạn, không giữ lại. Nó lại nằm
 * trong `#fragment` của URL nên đọng trong lịch sử trình duyệt của máy Sale — 60 giây là
 * cửa sổ để một vé đọng đó còn dùng được.
 *
 * ⛔ Đừng nâng cho "đỡ phải tải lại": tải lại trang là ký vé mới, rẻ. Thứ đắt là một vé
 * đọng trong lịch sử duyệt web dùng được cả buổi.
 */
export const ZALOCRM_SSO_TTL_SECONDS = 60;

/**
 * BỘ CLAIM ĐÓNG — `sso.test.ts` ca [ZC-SSO-06] so bằng bộ khoá này, nên thêm một claim
 * là phải sửa ở đây và tự trả lời: dữ liệu đó có phải PII không?
 *
 * 🔴 KHÔNG có `phone`. Kế hoạch §F1 có nhắc `phone` trong danh sách claims, nhưng:
 *   · fork upsert `User` theo `external_id`, không cần số điện thoại để định danh;
 *   · SĐT nhân viên là dữ liệu cá nhân, mà vé này đi trong URL fragment ⇒ nằm lại trong
 *     lịch sử trình duyệt;
 *   · và quan trọng nhất: chỗ này KHÔNG BAO GIỜ được mang SĐT/email PHỤ HUYNH — bỏ hẳn
 *     trường `phone` là cách chắc chắn nhất để không ai vô tình truyền nhầm vào.
 * Cần đồng bộ SĐT nhân viên sang fork thì làm bằng API server→server (GĐ3), không nhét
 * vào vé đăng nhập.
 */
export const KHOA_CLAIM_SSO = ["sub", "orgCode", "role", "fullName", "email", "jti", "iat", "exp"] as const;

/**
 * Khuôn `orgCode` — GIỐNG HỆT ba nơi: ô cấu hình `zalocrm.orgCodes`
 * (`lib/settings/registry.ts`), đường webhook `/api/webhooks/zalocrm/<org>`, và đây.
 * Ba nơi nói cùng một câu thì khai sai ở đâu cũng lộ ngay tại chỗ khai.
 */
const KHUON_ORG_CODE = /^[a-z0-9-]{1,32}$/;

export class ZalocrmSsoError extends Error {
  constructor(
    /** Mã lỗi EN, thông điệp VI (quy ước API contract). */
    public readonly code:
      | "MISSING_SECRET"
      | "USER_NOT_FOUND"
      | "TOKEN_VERSION_MISMATCH"
      | "NO_ORG"
      | "NO_ROLE",
    message: string,
  ) {
    super(message);
    this.name = "ZalocrmSsoError";
  }
}

export type ZalocrmSsoInput = {
  /** `User.id` (cuid) — fork lưu vào `external_id`. */
  userId: string;
  /** `tokenVersion` trong phiên — so với DB để phát hiện đăng xuất cưỡng bức. */
  tokenVersion: number;
  /** `Organization.code` bên ZaloCRM, tra từ setting `zalocrm.orgCodes`. */
  orgCode: string;
  role: VaiZaloCrm;
  fullName: string;
  /** Email NHÂN VIÊN (không bao giờ là email phụ huynh). Vắng ⇒ claim biến mất. */
  email?: string | null;
};

export type ZalocrmSsoClaims = {
  sub: string;
  orgCode: string;
  role: VaiZaloCrm;
  fullName: string;
  email?: string;
  jti: string;
};

export type ZalocrmSsoToken = { token: string; expiresAt: Date };

/**
 * Phần THUẦN: dựng claims. Không đọc env, không chạm DB, không ký — nhờ vậy ca kiểm
 * "vé không mang PII phụ huynh" chạy được ở mọi môi trường.
 */
export function taoClaimsSso(input: ZalocrmSsoInput & { jti: string }): ZalocrmSsoClaims {
  const claims: ZalocrmSsoClaims = {
    sub: input.userId,
    orgCode: input.orgCode,
    role: input.role,
    fullName: input.fullName ?? "",
    jti: input.jti,
  };
  // Chỉ thêm khoá khi có giá trị thật — `email: null` trong JWT là một khoá vô nghĩa mà
  // bên nhận vẫn phải xử lý.
  if (typeof input.email === "string" && input.email.trim()) {
    claims.email = input.email.trim();
  }
  return claims;
}

/**
 * Ký vé SSO. Từ chối khi tài khoản không còn hiệu lực hoặc `tokenVersion` trong DB đã
 * lệch với phiên (người đã bị buộc đăng xuất, ví dụ nghỉ việc).
 *
 * Vì sao vẫn hỏi DB dù trang gọi đã có `auth()`: JWT phiên Auth.js sống lâu hơn 60 giây
 * rất nhiều, nên "đang có phiên" KHÔNG đồng nghĩa "tài khoản còn hiệu lực lúc này". Đây
 * là điểm duy nhất Sata còn chặn được người vừa bị khoá trước khi fork cấp phiên riêng
 * của nó cho họ.
 */
export async function mintSsoToken(input: ZalocrmSsoInput): Promise<ZalocrmSsoToken> {
  const secret = process.env.ZALOCRM_SSO_SECRET;
  if (!secret) {
    // Env chưa khai trên Vercel về đây dưới dạng chuỗi rỗng — cũng là "thiếu".
    throw new ZalocrmSsoError("MISSING_SECRET", "Thiếu cấu hình ZALOCRM_SSO_SECRET");
  }
  if (!KHUON_ORG_CODE.test(input.orgCode ?? "")) {
    throw new ZalocrmSsoError(
      "NO_ORG",
      "Cơ sở chưa được ánh xạ sang tổ chức ZaloCRM (cấu hình zalocrm.orgCodes)",
    );
  }
  if (input.role !== "admin" && input.role !== "member") {
    throw new ZalocrmSsoError("NO_ROLE", "Vai của bạn không được cấp quyền dùng Zalo CRM");
  }

  const fresh = await db.user.findUnique({
    where: { id: input.userId },
    select: { tokenVersion: true, isActive: true, deletedAt: true },
  });
  if (!fresh || fresh.deletedAt || !fresh.isActive) {
    throw new ZalocrmSsoError("USER_NOT_FOUND", "Tài khoản không còn hiệu lực");
  }
  if (fresh.tokenVersion !== input.tokenVersion) {
    throw new ZalocrmSsoError(
      "TOKEN_VERSION_MISMATCH",
      "Phiên đăng nhập đã bị thu hồi — vui lòng đăng nhập lại",
    );
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ZALOCRM_SSO_TTL_SECONDS;
  // `jti` ngẫu nhiên MỖI LẦN — fork đánh dấu đã dùng trong Redis, nên vé chụp lại được
  // từ lịch sử duyệt web cũng chỉ dùng được một lần. Lấy từ `node:crypto` (khuôn
  // `lib/chat/migrate-legacy.ts`) chứ không dùng `crypto` toàn cục: module này chỉ chạy
  // ở server, và bản toàn cục phụ thuộc phiên bản Node — không đáng đánh cược cho một
  // thứ mà thiếu nó là vé trùng `jti`.
  const claims = taoClaimsSso({ ...input, jti: randomUUID() });

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));

  return { token, expiresAt: new Date(exp * 1000) };
}

/** SĐT chuẩn để soạn tin: `84XXXXXXXXX` — không dấu `+`, không `0` đầu (kế hoạch §S2). */
const KHUON_SDT_84 = /^84\d{8,10}$/;

/**
 * Địa chỉ nhúng vào `<iframe>`: `<appUrl>/sso#token=…&next=/chat[?compose=…]`.
 *
 * 🔴 TOKEN NẰM TRONG FRAGMENT, KHÔNG PHẢI QUERY. Fragment không được trình duyệt gửi
 * lên máy chủ ⇒ vé không rơi vào access log của Cloudflare Tunnel, của fork, hay của bất
 * kỳ proxy nào ở giữa. Đổi sang `?token=` là làm hỏng đúng tính chất này.
 *
 * Dựng fragment bằng `URLSearchParams` để `next` (có chứa `?` và `=`) được mã hoá đúng —
 * phía fork đọc bằng `new URLSearchParams(location.hash.slice(1))` nên nhận lại nguyên văn.
 *
 * Trả `null` khi thiếu cấu hình hoặc thiếu vé: nơi gọi phải hiện hướng dẫn, KHÔNG dựng
 * một khung nhúng trỏ vào hư không.
 */
export function duongDanNhungZaloCrm(input: {
  appUrl: string | null | undefined;
  token: string;
  compose?: string | null;
}): string | null {
  if (!input.appUrl || !input.token) return null;

  let goc: URL;
  try {
    goc = new URL(input.appUrl);
  } catch {
    return null;
  }
  if (goc.protocol !== "https:" && goc.protocol !== "http:") return null;

  // SĐT đi thẳng vào truy vấn của ZaloCRM, và MỖI lần tra là một `PhoneSearchEvent` tính
  // vào hạn mức Zalo. Chuyển tiếp chuỗi lạ = đốt hạn mức bằng truy vấn chắc chắn không ra
  // ai, nên sai khuôn thì bỏ hẳn tham số chứ không "cứ gửi thử".
  const compose = typeof input.compose === "string" ? input.compose.trim() : "";
  const next = KHUON_SDT_84.test(compose) ? `/chat?compose=${compose}` : "/chat";

  const frag = new URLSearchParams({ token: input.token, next });
  return `${goc.origin}/sso#${frag.toString()}`;
}
