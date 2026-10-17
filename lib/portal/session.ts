import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { makeToken, verifyToken } from "@/lib/portal/active-site-token";
import { getSigningSecret } from "@/lib/security/signing-key";

// =============================================================================
// PORTAL SESSION — Phase T2.2 (PHƯƠNG ÁN A)
// Học sinh KHÔNG có account riêng. Phụ huynh (role PARENT) đăng nhập rồi chọn
// "site con" (activeSite). activeSite lưu cookie httpOnly có ký HMAC; mọi truy
// cập data học sinh PHẢI verify studentId thuộc parent đang login (server-side).
// =============================================================================

const COOKIE_NAME = "portal_active_site";

export type PortalChild = {
  id: string;
  name: string;
  studentCode: string | null;
  avatarUrl: string | null;
  /** Cơ sở của con — notifications.ts tái dùng để resolve audience CENTER
   * (1 query Student duy nhất/request nhờ React cache, không query lại). */
  centerId: string | null;
  preferredCenterId: string | null;
};

export type PortalContext = {
  parentUserId: string;
  parentName: string;
  children: PortalChild[];
  activeStudent: PortalChild | null;
};

function secret(): string {
  return getSigningSecret(); // SEC-H05: bỏ fallback "" (forge được cookie active-site).
}

function verifySigned(token: string): string | null {
  return verifyToken(token, secret());
}

/** Tạo token đã ký cho studentId (dùng khi set cookie). */
export function makeActiveSiteToken(studentId: string): string {
  return makeToken(studentId, secret());
}

export const ACTIVE_SITE_COOKIE = COOKIE_NAME;

/**
 * Danh sách con của 1 PARENT (chưa xoá). Bọc React cache() — layout + page +
 * notification helpers gọi trong CÙNG request chỉ chạy 1 query Student.
 */
export const getChildren = cache(async (parentUserId: string): Promise<PortalChild[]> => {
  return db.student.findMany({
    where: { parentUserId, deletedAt: null },
    select: {
      id: true,
      name: true,
      studentCode: true,
      avatarUrl: true,
      centerId: true,
      preferredCenterId: true,
    },
    orderBy: { name: "asc" },
  });
});

/**
 * Context portal cho request hiện tại. Trả null nếu không phải PARENT đăng nhập.
 * activeStudent: con đang chọn (verify ownership) — fallback con đầu tiên.
 * Bọc React cache(): layout gọi + page gọi (qua requireActiveStudent) trong
 * cùng request chỉ tính 1 lần (auth/cookies/query con không lặp).
 */
export const getPortalContext = cache(async (): Promise<PortalContext | null> => {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") return null;

  const parentUserId = session.user.id;
  const children = await getChildren(parentUserId);

  let activeStudent: PortalChild | null = null;
  if (children.length > 0) {
    const raw = (await cookies()).get(COOKIE_NAME)?.value;
    const studentId = raw ? verifySigned(raw) : null;
    // Chỉ chấp nhận nếu studentId thuộc danh sách con (chống tamper / chuyển con).
    activeStudent =
      (studentId && children.find((c) => c.id === studentId)) || children[0];
  }

  return {
    parentUserId,
    parentName: session.user.name ?? session.user.email ?? "Phụ huynh",
    children,
    activeStudent,
  };
});

/**
 * Lấy con đang chọn cho 1 trang portal — redirect nếu không hợp lệ.
 * Dùng đầu mỗi page/server action cần data học sinh.
 */
export async function requireActiveStudent(): Promise<{
  ctx: PortalContext;
  studentId: string;
}> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  // PARENT không còn con nào (chưa liên kết / con bị xóa mềm): KHÔNG redirect("/")
  // — trên host portal "/" rewrite về /portal, PortalHome lại gọi hàm này →
  // ERR_TOO_MANY_REDIRECTS. Đẩy về /portal/ho-so (không cần activeStudent);
  // layout đã render empty-state "chưa liên kết học viên".
  if (!ctx.activeStudent) redirect("/portal/ho-so");
  return { ctx, studentId: ctx.activeStudent.id };
}

/** Verify 1 studentId thuộc parent đang login (dùng trước khi set cookie). */
export async function assertOwnsStudent(studentId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user || session.user.role !== "PARENT") return false;
  const owned = await db.student.findFirst({
    where: { id: studentId, parentUserId: session.user.id, deletedAt: null },
    select: { id: true },
  });
  return !!owned;
}
