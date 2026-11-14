/**
 * POST /api/disc/tai  body {"token":"…","dinhDang":"html"?} — tải báo cáo lần đầu bằng token cấp ở bước lưu.
 * Hợp đồng: docs/disc-tich-hop/04-api-contract.md.
 *
 * F-11: KHÔNG còn GET — token (bearer 192 bit) nằm trong URL sẽ vào nhật ký truy cập của proxy/CDN, lịch sử trình duyệt và
 * Referer. Chỉ POST với token ở THÂN; `?token=` trên URL bị bỏ qua hoàn toàn (không đọc). Mọi phương thức khác ⇒ 405 của Next.
 * Token chết khi bài đã được nhận (CLAIMED) — xem `tai-bao-cao.ts`.
 *
 * Mọi lỗi token (không có/sai/hết hạn/bài đã xoá/đã nhận) ⇒ CÙNG một 404. Phản hồi không bao giờ vào cache
 * hay chỉ mục tìm kiếm, và mang `Referrer-Policy: no-referrer`.
 */
import { NextResponse } from "next/server";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { ipDiscChoGioiHan } from "@/lib/disc/phone-key";
import { dungBaoCaoHtml, taiBaoCao } from "@/lib/disc/tai-bao-cao";
import { taiStore } from "@/lib/disc/store-prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT_IP = { max: 30, windowMs: 10 * 60_000 };
const TRAN_BODY_BYTE = 4 * 1024;

const TIEU_DE_AN_TOAN = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

function htmlBaoCao(baoCao: Parameters<typeof dungBaoCaoHtml>[0]) {
  return new NextResponse(dungBaoCaoHtml(baoCao), {
    status: 200,
    headers: {
      ...TIEU_DE_AN_TOAN,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

async function xuLy(req: Request, token: unknown, dinhDang: string | null) {
  if (!isDiscEnabled()) return new NextResponse(null, { status: 404 });
  try {
    const gioiHan = await rateLimit({ key: `disc:tai:ip:${ipDiscChoGioiHan(req.headers)}`, ...LIMIT_IP });
    if (!gioiHan.success) return NextResponse.json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, { status: 429, headers: TIEU_DE_AN_TOAN });

    const r = await taiBaoCao({ token, store: taiStore, now: new Date() });
    if (!r.ok) return NextResponse.json({ ok: false, loi: "TOKEN_KHONG_HOP_LE" }, { status: 404, headers: TIEU_DE_AN_TOAN });

    // Không còn dựng PDF (chủ dự án 04/11/2026: bỏ phần tải PDF). `dinhDang=pdf` nay rơi về JSON như mọi giá trị lạ.
    if (dinhDang === "html") return htmlBaoCao(r.baoCao);
    return NextResponse.json({ ok: true, baoCao: r.baoCao }, { status: 200, headers: TIEU_DE_AN_TOAN });
  } catch {
    console.error("[disc/tai] loi ha tang");
    return NextResponse.json({ ok: false, loi: "TAI_THAT_BAI" }, { status: 503, headers: TIEU_DE_AN_TOAN });
  }
}

export async function POST(req: Request) {
  const dai = Number(req.headers.get("content-length"));
  if (Number.isFinite(dai) && dai > TRAN_BODY_BYTE) return NextResponse.json({ ok: false, loi: "BODY_QUA_LON" }, { status: 413, headers: TIEU_DE_AN_TOAN });
  let body: { token?: unknown; dinhDang?: unknown } | null;
  try {
    const doc = await docBodyCoTran(req, TRAN_BODY_BYTE); // theo luồng, huỷ khi vượt trần (S-11)
    if (!doc.ok) return NextResponse.json({ ok: false, loi: "BODY_QUA_LON" }, { status: 413, headers: TIEU_DE_AN_TOAN });
    body = JSON.parse(doc.text);
  } catch {
    body = null;
  }
  return xuLy(req, body?.token, typeof body?.dinhDang === "string" ? body.dinhDang : null);
}
