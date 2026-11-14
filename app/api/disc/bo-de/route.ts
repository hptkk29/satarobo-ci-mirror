/**
 * POST /api/disc/bo-de — phát BỘ ĐỀ cho khách (quyết định D1: engine chạy Ở SERVER, client không chấm).
 * Hợp đồng: docs/disc-tich-hop/04-api-contract.md §2.
 *
 * Body: { vai: "PH" | "HS", bacHoc?: string, namSinh: number }  →  200 { ok:true, boDe }.
 *  - cờ DISC_ENABLED tắt ⇒ 404 rỗng TRƯỚC mọi việc khác;
 *  - chưa có engine ⇒ 503 ENGINE_CHUA_SAN_SANG (mã bộ đề/câu hỏi chưa có giấy phép — không bịa);
 *  - bộ đề chọn bằng CHÍNH `engine.chonBoDe` mà đường lưu dùng để đối chiếu `maBoDe`, năm theo giờ VN
 *    (`namHienTaiVN`) — bộ đề phát ra luôn là bộ đề `/api/disc/luu` sẽ chấp nhận;
 *  - serialize bằng pick tường minh (`boDeChoKhach`), không rò trọng số chấm;
 *  - không đọc/ghi DB, không log body.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { boDeChoKhach, layEngine } from "@/lib/disc/engine";
import { ensureDiscEngine } from "@/lib/disc/engine-dang-ky";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { BAC_HOC, namHienTaiVN } from "@/lib/disc/ho-so";
import { ipDiscChoGioiHan } from "@/lib/disc/phone-key";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAN_BODY_BYTE = 2 * 1024;
const LIMIT_IP = { max: 60, windowMs: 10 * 60_000 };
const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });

const boDeSchema = z.object({
  vai: z.enum(["PH", "HS"]),
  bacHoc: z.enum(BAC_HOC).optional(),
  namSinh: z.number().int(),
});

export async function POST(req: Request) {
  if (!isDiscEnabled()) return new NextResponse(null, { status: 404 });
  // Giờ đọc ở MỘT điểm đầu route rồi truyền xuống (lưới [DISC-QA-CLOCK-02]); test đóng băng đồng hồ hệ thống để khống chế.
  const now = new Date();
  try {
    const gioiHan = await rateLimit({ key: `disc:bo-de:ip:${ipDiscChoGioiHan(req.headers)}`, ...LIMIT_IP });
    if (!gioiHan.success) return json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, 429);

    const khaiBao = Number(req.headers.get("content-length"));
    if (Number.isFinite(khaiBao) && khaiBao > TRAN_BODY_BYTE) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);
    const doc = await docBodyCoTran(req, TRAN_BODY_BYTE); // theo luồng, huỷ khi vượt trần (S-11)
    if (!doc.ok) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(doc.text);
    } catch {
      return json({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" }, 400);
    }
    const p = boDeSchema.safeParse(body);
    const namNay = namHienTaiVN(now);
    // Học sinh bắt buộc có bậc học; năm sinh ngoài khoảng sống hợp lý là gõ nhầm (kiểm kỹ ở bước lưu).
    if (!p.success || (p.data.vai === "HS" && !p.data.bacHoc) || p.data.namSinh < namNay - 100 || p.data.namSinh > namNay) {
      return json({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" }, 400);
    }

    ensureDiscEngine();
    const engine = layEngine();
    if (!engine) return json({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" }, 503);

    const boDe = boDeChoKhach(engine, { vai: p.data.vai, bacHoc: p.data.bacHoc, namSinh: p.data.namSinh, namNay });
    if (!boDe) return json({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" }, 400);
    return json({ ok: true, boDe }, 200);
  } catch {
    // Không đính lỗi gốc; lỗi ở đây không chạm dữ liệu trẻ nhưng giữ cùng khuôn với các route DISC khác.
    return json({ ok: false, loi: "BO_DE_THAT_BAI" }, 503);
  }
}
