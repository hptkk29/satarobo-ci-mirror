import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { makeToken, verifyToken } from "@/lib/portal/active-site-token";
import { HV_COOKIE, docTokenCheDo } from "@/lib/portal/hv-token";
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
  /**
   * Chế độ đang dùng. "hoc-sinh" CHỈ khi cookie `portal_hv` đã ký, ràng buộc ĐÚNG phụ huynh đang đăng nhập và một
   * con của họ (xem `lib/portal/hv-token.ts`). Ở chế độ này `activeStudent` LUÔN là con trong token — cookie
   * `portal_active_site` bị bỏ qua, nên con không đổi sang anh chị em được.
   */
  cheDo: "phu-huynh" | "hoc-sinh";
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
  let cheDo: PortalContext["cheDo"] = "phu-huynh";
  if (children.length > 0) {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    const studentId = raw ? verifySigned(raw) : null;
    // Chỉ chấp nhận nếu studentId thuộc danh sách con (chống tamper / chuyển con).
    activeStudent =
      (studentId && children.find((c) => c.id === studentId)) || children[0];

    // Cổng học sinh: token ký, đúng người đăng nhập, con còn thuộc danh sách ⇒ ép con theo token.
    const hv = docTokenCheDo(jar.get(HV_COOKIE)?.value, secret());
    const conTrongToken = hv && hv.parentUserId === parentUserId ? children.find((c) => c.id === hv.studentId) : undefined;
    if (conTrongToken) {
      activeStudent = conTrongToken;
      cheDo = "hoc-sinh";
    }
  }

  return {
    parentUserId,
    parentName: session.user.name ?? session.user.email ?? "Phụ huynh",
    children,
    activeStudent,
    cheDo,
  };
});

/**
 * Lấy con đang chọn cho 1 trang portal — redirect nếu không hợp lệ.
 * Dùng đầu mỗi page/server action cần data học sinh.
 */
export async function requireActiveStudent(opts?: { choHocSinh?: boolean }): Promise<{
  ctx: PortalContext;
  studentId: string;
}> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  // FAIL-CLOSED: đang ở chế độ học sinh thì MỌI trang/hành động của phụ huynh gọi hàm này bị đá về Cổng học sinh. Chỉ
  // trang/hành động của chính Cổng học sinh (hoc-sinh/**, nộp bài, làm bài thi, đánh giá giáo viên) mới truyền
  // `choHocSinh: true`. Thêm một trang phụ huynh mới thì mặc định đã an toàn — không phải nhớ gọi cổng nào.
  if (ctx.cheDo === "hoc-sinh" && !opts?.choHocSinh) redirect("/portal/hoc-sinh");
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

/** Đang ở chế độ học sinh không (đọc cookie đã ký — không đụng DB). Dùng cho hành động của phụ huynh KHÔNG đi qua `requireActiveStudent`. */
export async function dangOCheDoHocSinh(): Promise<boolean> {
  return (await getPortalContext())?.cheDo === "hoc-sinh";
}

/** Cổng cho trang/layout của phụ huynh không gọi `requireActiveStudent`: ở chế độ học sinh thì đá về Cổng học sinh. */
export async function chanKhiOCheDoHocSinh(): Promise<void> {
  if (await dangOCheDoHocSinh()) redirect("/portal/hoc-sinh");
}
