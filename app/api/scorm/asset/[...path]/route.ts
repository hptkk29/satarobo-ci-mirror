// app/api/scorm/asset/[...path]/route.ts — R7-12: resolver tài nguyên SCORM/PDF (RIÊNG TƯ).
// Tài liệu bài giảng là tài liệu NỘI BỘ CÔNG TY — KHÔNG public ra ngoài. Vì vậy KHÔNG
// redirect sang URL public; thay vào đó PROXY luồng byte từ R2 qua chính app (cùng origin,
// có đăng nhập). Xác vé (HMAC TTL 10p, buộc packageId+session+userId). Vé lấy từ query ?t
// (hop đầu index.html/source.pdf) HOẶC cookie (asset con relative bị mất query) → set cookie
// ở hop đầu. Same-origin ⇒ asset con SCORM resolve đúng + window.API hoạt động lại.
// Vé sai/hết hạn/IDOR/user không khớp (PARENT/HV/chia sẻ link) → 403. Path traversal → 403.
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isScormEnabled } from "@/lib/flags";
import { verifyScormTicket } from "@/lib/scorm/ticket";
import { getR2Client, getR2Bucket } from "@/lib/storage/r2-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKET_COOKIE = "scorm_at";

/** Segment nguy hiểm: rỗng, ".", "..", backslash, NUL → traversal/absolute. */
function isUnsafeSegments(segs: string[]): boolean {
  if (segs.length === 0) return true;
  for (const s of segs) {
    if (!s || s === "." || s === "..") return true;
    if (s.includes("\\") || s.includes("\0") || s.startsWith("/")) return true;
  }
  return false;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  if (!isScormEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  // 1. Vé: query ?t (hop đầu) hoặc cookie (asset con relative — đã mất query).
  const queryToken = req.nextUrl.searchParams.get("t");
  const token = queryToken ?? req.cookies.get(TICKET_COOKIE)?.value ?? "";
  const v = verifyScormTicket(token);
  if (!v.ok || !v.payload) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 2. Buộc vé theo user đăng nhập — chặn chia sẻ link + PARENT/HV.
  const session = await auth();
  if (!session?.user || session.user.id !== v.payload.userId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 3. Path traversal guard.
  const { path } = await ctx.params;
  if (isUnsafeSegments(path)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 4. Key R2 = storagePrefix gói (theo VÉ, không theo URL) + path → chống IDOR sang gói khác.
  const pkg = await db.scormPackage.findUnique({
    where: { id: v.payload.packageId },
    select: { storagePrefix: true },
  });
  if (!pkg) {
    return new NextResponse("Not found", { status: 404 });
  }
  const prefix = pkg.storagePrefix.endsWith("/")
    ? pkg.storagePrefix
    : `${pkg.storagePrefix}/`;
  const key = `${prefix}${path.join("/")}`;

  try {
    // 5. PROXY byte từ R2 (riêng tư — không lộ URL public). Buffer cả tệp (slide nhỏ).
    const obj = await getR2Client().send(
      new GetObjectCommand({ Bucket: getR2Bucket(), Key: key }),
    );
    if (!obj.Body) {
      return new NextResponse("Not found", { status: 404 });
    }
    const bytes = await obj.Body.transformToByteArray();
    const res = new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": obj.ContentType ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        // private: chỉ cache ở trình duyệt user, KHÔNG cache chia sẻ/CDN.
        "Cache-Control": "private, max-age=3600",
      },
    });
    // Hop đầu (có ?t) → đặt cookie vé để asset con (relative, mất query) xác thực tiếp.
    if (queryToken) {
      res.cookies.set(TICKET_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/scorm/asset",
        maxAge: 600,
      });
    }
    return res;
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
