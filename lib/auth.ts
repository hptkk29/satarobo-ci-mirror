import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { thuHoiKhiAuthSignOut } from "@/lib/push/thu-hoi";
import { loginSchema } from "@/lib/validators/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  duocTatChanTanSuatDangNhap,
  ipChoRateLimit,
} from "@/lib/security/client-ip";
import { canonicalPhone } from "@/lib/phone";
// Phase T0.1 — map role cũ sang tên mới. Nguồn dùng chung với mọi chỗ đọc role từ DB.
import { migrateLegacyRole } from "@/lib/auth/legacy-role";

type SessionGrant = { action: string; grant: "ALLOW" | "DENY" };

/**
 * F2 (Q41) — SSO cookie đa subdomain. Kill-switch: chỉ bật khi env
 * `AUTH_COOKIE_DOMAIN` có giá trị (VD ".satarobo.vn"). MẶC ĐỊNH không set →
 * cookie session host-only (KHÔNG SSO, KHÔNG force-logout).
 *
 * ⚠️ SỰ CỐ 22/07→04/08/2026 — ĐỌC TRƯỚC KHI ĐỔI CHỖ NÀY.
 * Env này từng được bật ở CẢ Production LẪN môi trường `test`. Hai môi trường
 * dùng chung cookie `__Secure-sr.session-token` trên zone `.satarobo.vn` nhưng
 * ký bằng HAI KHOÁ KHÁC NHAU (prod chỉ có `NEXTAUTH_SECRET`; `test` có thêm
 * `AUTH_SECRET`, mà `next-auth/lib/env.js` ưu tiên `AUTH_SECRET`). Bên không
 * giải mã được cookie sẽ phát `Set-Cookie …; Max-Age=0; Domain=.satarobo.vn`
 * (@auth/core `sessionStore.clean()`) → XOÁ PHIÊN TRÊN MỌI HOST cùng lúc.
 * Triệu chứng: mọi vai trò bị đá về `/login?callbackUrl=…` **không kèm
 * `?reason=`** sau vài phút. (Có `?reason=` là chuyện khác: tokenVersion.)
 *
 * Vì vậy TÊN cookie nay MANG THEO TÊN MÔI TRƯỜNG — mỗi môi trường một cookie
 * riêng, nên không môi trường nào (kể cả **deployment CŨ còn sống**, thứ đã làm
 * lỗi kéo dài thêm sau khi vá env) đọc hay xoá được cookie của môi trường khác.
 *
 * `VERCEL_TARGET_ENV` trả cả tên môi trường TUỲ BIẾN ("test"); `VERCEL_ENV` chỉ
 * trả production|preview|development nên KHÔNG phân biệt được `test` với prod.
 * Không xác định được môi trường → KHÔNG bật cookie zone-wide (fail-safe).
 *
 * ⚠️ `AUTH_COOKIE_DOMAIN` phải là biến **Non-sensitive** trên Vercel: biến
 * Sensitive không tồn tại lúc build, mà middleware (edge) được build-time
 * inline ⇒ middleware và server sẽ lệch tên cookie → đá vô hạn về /login.
 */
const envSlug = (process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV)
  ?.trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-");
const authCookieDomain = envSlug
  ? process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined
  : undefined;

// SEC-H01 — IP client cho rate-limit login.
//
// ⚠️ Bản cũ lấy phần tử ĐẦU của `x-forwarded-for`, tức đầu do CLIENT viết — kẻ dò mật khẩu
// tự chèn một IP khác mỗi request là trần 10 lượt/phút không bao giờ chạm tới. Luật chọn
// header + lý do đầy đủ nay ở `lib/security/client-ip.ts`; đừng đọc header thẳng ở đây nữa.
function getClientIp(request: Request | undefined): string {
  return ipChoRateLimit(request?.headers);
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      roles: string[]; // Đợt 3B — tất cả vai trò (union quyền)
      centerId: string | null;
      grants: SessionGrant[];
      tokenVersion: number;
      phone: string | null; // AUTH-SĐT P3 — canonical 84XXXXXXXXX
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    roles?: string[];
    centerId?: string | null;
    grants?: SessionGrant[];
    tokenVersion?: number;
    phone?: string | null; // AUTH-SĐT P3
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  // Trust the actual request Host header thay vì canonicalize sang
  // NEXTAUTH_URL/VERCEL_URL. Cần thiết khi production dùng custom domain
  // (satarobo.vn) trên Vercel — không thì redirect leak sang
  // satarobo-vn.vercel.app.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  // F2 (Q41) — chỉ ghi đè cookie sessionToken khi bật SSO đa subdomain qua env.
  // Không bật (mặc định) → NextAuth tự dùng cookie host-only mặc định.
  ...(authCookieDomain && envSlug
    ? {
        cookies: {
          sessionToken: {
            // Tên KÈM môi trường: khác `authjs.session-token` mặc định VÀ khác
            // mọi môi trường khác → không ai đọc/xoá nhầm cookie của nhau.
            // Đổi tên = mọi user re-login 1 lần (force-logout chủ đích).
            name: `__Secure-sr-${envSlug}.session-token`,
            options: {
              httpOnly: true,
              sameSite: "lax" as const,
              path: "/",
              secure: true,
              domain: authCookieDomain,
            },
          },
        },
      }
    : {}),
  providers: [
    Credentials({
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // AUTH-SĐT P3 — identifier là SĐT (canonical được) hoặc email; hai tập
        // không giao nhau nên RẼ NHÁNH thay vì OR — né hẳn bẫy `{ phone: null }`
        // (Prisma dịch thành `phone IS NULL` → khớp user ngẫu nhiên).
        const identifier = parsed.data.identifier;
        const canonical = canonicalPhone(identifier);

        // SEC-H01: chống brute-force / credential-stuffing — rate-limit theo IP + định danh.
        // Key CHUẨN HOÁ TRƯỚC (canonical/lowercase) — không thì `0818…` và `84818…`
        // là 2 key khác nhau = bypass. rateLimit() fail-soft (Upstash → memory khi
        // lỗi) nên KHÔNG khóa login hàng loạt khi Redis sự cố. Break-glass: đặt env
        // LOGIN_RATELIMIT_DISABLED=1 để tắt tạm.
        // ⚠️ KHÔNG đọc biến env của cửa tắt thẳng ở đây. Nó bị CHỐT CỨNG trên production
        // (bỏ qua + kêu to) — luật nằm ở `duocTatChanTanSuatDangNhap`, một chỗ, có test.
        //
        // ⚠️ Và đừng viết tên biến ấy ra trong chú thích: lưới `[CIP-14]` soi VĂN BẢN của
        // tệp này, nên một câu giải thích chứa đúng chuỗi đang cấm sẽ làm lưới đỏ. Đã dính
        // một lần lúc viết bản vá này.
        if (!duocTatChanTanSuatDangNhap()) {
          const ip = getClientIp(request);
          const idKey = canonical ?? identifier.toLowerCase();
          const [byIp, byId] = await Promise.all([
            rateLimit({ key: `login:ip:${ip}`, max: 10, windowMs: 60_000 }),
            rateLimit({ key: `login:id:${idKey}`, max: 5, windowMs: 60_000 }),
          ]);
          if (!byIp.success || !byId.success) return null;
        }

        // Email giữ NGUYÊN ngữ nghĩa so khớp cũ (raw, phân biệt hoa/thường) —
        // đổi sang lowercase là thay đổi hành vi, phải đo trùng lower(email)
        // trên PROD trước (scripts/sql/login-email-case.sql).
        const user = await db.user.findFirst({
          where: canonical ? { phone: canonical } : { email: identifier },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            password: true,
            role: true,
            roles: true,
            centerId: true,
            isActive: true,
            deletedAt: true,
            accountStatus: true,
          },
        });

        if (!user || !user.password || user.deletedAt || !user.isActive) {
          return null;
        }
        // AUTH-SĐT P0 §3.6 — chặn tường minh theo accountStatus.
        // PENDING_ACTIVATION/DISABLED trước đây bị chặn TÌNH CỜ vì các tài khoản
        // đó có `password = null`. Hàng rào ấy biến mất ngay khi có bất kỳ đường
        // đăng nhập nào không dựa vào mật khẩu, hoặc khi ai đó đặt mật khẩu cho
        // một tài khoản chưa kích hoạt.
        if (user.accountStatus !== "ACTIVE") return null;

        const valid = await bcrypt.compare(parsed.data.password, user.password);
        if (!valid) return null;

        // Phase 5.3.0: update lastLoginAt + load per-user grants + fresh
        // tokenVersion in parallel để giảm login latency.
        const [, grants, fresh] = await Promise.all([
          db.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          }),
          db.userPermissionGrant.findMany({
            where: { userId: user.id },
            select: { action: true, grant: true },
          }),
          db.user.findUnique({
            where: { id: user.id },
            select: { tokenVersion: true },
          }),
        ]);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          // Đợt 3B — đảm bảo roles luôn chứa vai trò chính (back-compat user cũ).
          roles: user.roles.length > 0 ? user.roles : [user.role],
          centerId: user.centerId,
          grants,
          tokenVersion: fresh?.tokenVersion ?? 0,
        };
      },
    }),
  ],
  // US-14b Đợt 6 — LƯỚI THỨ BA thu hồi đăng ký push khi tài khoản đã chết.
  //
  // Đây là điểm DUY NHẤT mà mọi lượt POST tới endpoint signout đều đi qua (đo ở
  // `@auth/core/lib/actions/signout.js`), nên nó phủ cả đường mà repo không tự gọi:
  // ai POST thẳng `/api/auth/signout`, gồm trang xác nhận đăng xuất mặc định của Auth.js.
  // Hai nửa đã có (`app/(auth)/dang-xuat/route.ts` + `lib/auth/logout-client.ts`) GIỮ NGUYÊN —
  // nửa client là thứ duy nhất biết endpoint của MÁY ĐANG NGỒI, mà event này không biết.
  //
  // ⚠️ Hàm được nối vào đây chỉ gỡ khi tài khoản THẬT SỰ chết. Nối một hàm "gỡ tất cả" vào đây
  // là đảo ngược quyết định vận hành ở `lib/push/thu-hoi.ts`: event phát ở MỌI lượt đăng xuất,
  // nên mỗi lần nhân viên đăng xuất khỏi máy công ty sẽ mất push trên điện thoại riêng.
  //
  // ⚠️ Dòng nối dây này có test canh (`lib/push/thu-hoi.test.ts` quét chính tệp này) — gỡ nó là
  // gỡ lưới thứ ba mà không cổng nào khác biết, đúng loại hỏng câm của bài học `soDong` ở Đợt 5.
  events: { signOut: thuHoiKhiAuthSignOut },
  callbacks: {
    async jwt({ token, user }) {
      // Khi user mới login (authorize trả user), copy fields vào token.
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "SALES_CSM";
        token.roles = user.roles ?? (user.role ? [user.role] : []);
        token.centerId = user.centerId ?? null;
        token.grants = user.grants ?? [];
        token.tokenVersion = user.tokenVersion ?? 0;
        token.phone = user.phone ?? null; // AUTH-SĐT P3
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string);
        // Phase T0.1 — compat shim: JWT cũ (trước rename) còn role MANAGER/SALES.
        // Map sang tên mới để staff đang đăng nhập không mất quyền cho tới khi
        // token hết hạn / re-login. Có thể bỏ shim sau 1-2 tuần.
        session.user.role = migrateLegacyRole(
          (token.role as string) ?? "SALES_CSM",
        );
        // Đợt 3B — roles (union), map legacy + đảm bảo chứa vai trò chính.
        // Token cũ (trước 3B) chưa có roles → fallback [role]. User cần re-login
        // để token mang roles đầy đủ khi được gán thêm vai trò.
        const rawRoles = (token.roles as string[] | undefined) ?? [];
        const mappedRoles = rawRoles.map(migrateLegacyRole);
        const withPrimary = mappedRoles.includes(session.user.role)
          ? mappedRoles
          : [session.user.role, ...mappedRoles];
        session.user.roles = withPrimary.length > 0 ? withPrimary : [session.user.role];
        session.user.centerId = (token.centerId as string | null) ?? null;
        session.user.grants = (token.grants as SessionGrant[]) ?? [];
        session.user.tokenVersion = (token.tokenVersion as number) ?? 0;
        session.user.phone = (token.phone as string | null) ?? null; // AUTH-SĐT P3
      }
      return session;
    },
  },
});
