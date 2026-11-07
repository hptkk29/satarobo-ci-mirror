/**
 * POST /api/disc/xoa — xoá bài DISC chưa nhận theo yêu cầu của chủ số (F-07).
 * Body: { soDienThoai, otp, maNhan }.
 *
 * Xoá cần ĐỒNG THỜI: OTP của SĐT (purpose DISC_CLAIM — `verifyAndConsumeOtp`, phía gửi OTP do luồng
 * /kich-hoat của authcrm lo) VÀ mã nhận của bài (`xoaBangMa`, cùng bộ đếm thử sai với nhận bài). Chỉ
 * giữ SĐT chưa đủ — ai cũng gõ được SĐT người khác ở màn Lưu.
 *
 * Chống oracle: MỌI thất bại (SĐT sai, OTP sai/hết hạn/khoá, mã sai, không có bài, bài số khác) ⇒ MỘT
 * mã `KHONG_XOA_DUOC` (400); KHÔNG chuyển tiếp chuỗi lỗi của lớp OTP (có "Còn N lần thử"). Thời gian
 * phản hồi được kéo về một sàn (`denNguongThoiGian`).
 * Thứ tự: cờ (404) → giới hạn IP → body → giới hạn theo phoneKey (HMAC) → OTP → xoá.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { TOI_DA_LAN_THU_MA } from "@/lib/disc/chinh-sach";
import { bamMaNhan, chuanHoaMaNhan } from "@/lib/disc/luu";
import { maNhanStore } from "@/lib/disc/store-prisma";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { ipDiscChoGioiHan, layKhoaDisc, phoneKeyCuaSdt, phoneKeyTuSdtChuan } from "@/lib/disc/phone-key";
import { xoaBangMa } from "@/lib/disc/vong-doi";
import { isDiscEnabled } from "@/lib/flags";
import { verifyAndConsumeOtp } from "@/lib/otp/service";
import { rateLimit } from "@/lib/rate-limit";
import { denNguongThoiGian, phuThuocThoiGianThat } from "@/lib/security/dong-deu-thoi-gian";
import { canonicalPhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRAN_BODY_BYTE = 2 * 1024;
const LIMIT_IP = { max: 10, windowMs: 10 * 60_000 };
const LIMIT_SDT = { max: 5, windowMs: 60 * 60_000 };
const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });
const KHONG_XOA_DUOC = () => json({ ok: false, loi: "KHONG_XOA_DUOC" }, 400);

const xoaSchema = z.object({
  soDienThoai: z.string().min(1).max(32),
  otp: z.string().regex(/^\d{6}$/),
  maNhan: z.string().min(1).max(40),
});

export async function POST(req: Request) {
  if (!isDiscEnabled()) return new NextResponse(null, { status: 404 });
  // Một điểm đọc giờ: `them.now` là cổng đồng hồ tiêm được (test thay), dùng cho CẢ mốc bắt đầu của sàn thời gian LẪN `now` của nghiệp vụ.
  const them = phuThuocThoiGianThat();
  const now = them.now();
  const batDau = now.getTime();
  const xong = async (res: NextResponse) => {
    await denNguongThoiGian(them, batDau, "disc-xoa");
    return res;
  };
  try {
    const gioiHanIp = await rateLimit({ key: `disc:xoa:ip:${ipDiscChoGioiHan(req.headers)}`, ...LIMIT_IP });
    if (!gioiHanIp.success) return json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, 429);

    const khaiBao = Number(req.headers.get("content-length"));
    if (Number.isFinite(khaiBao) && khaiBao > TRAN_BODY_BYTE) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);
    const doc = await docBodyCoTran(req, TRAN_BODY_BYTE); // theo luồng, huỷ khi vượt trần (S-11)
    if (!doc.ok) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(doc.text);
    } catch {
      return xong(KHONG_XOA_DUOC());
    }
    const p = xoaSchema.safeParse(body);
    const sdt = p.success ? canonicalPhone(p.data.soDienThoai) : null;
    const sdtKey = p.success ? phoneKeyCuaSdt(p.data.soDienThoai) : null;
    if (!p.success || !sdt || !sdtKey) return xong(KHONG_XOA_DUOC());

    // Chặn đoán OTP/mã nhận theo từng SĐT, bất kể IP (khoá là HMAC, không chứa SĐT).
    const gioiHanSdt = await rateLimit({ key: `disc:xoa:sdt:${sdtKey.slice(0, 24)}`, ...LIMIT_SDT });
    if (!gioiHanSdt.success) return json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, 429);

    // S-05 — cổng TRƯỚC khi tiêu lượt OTP (cùng khuôn `choPhepThuOtp` của đường nhận): phải có đúng một bài chờ khớp
    // mã nhận băm (đọc thuần, KHÔNG đếm thử). Kẻ không có mã nhận không chạm tới OTP của chủ số, nên không đốt được
    // lượt thử OTP/khoá OTP của người khác. Mã hỏng định dạng ⇒ dừng luôn (cùng một phản hồi chung).
    const ma = chuanHoaMaNhan(p.data.maNhan);
    if (!ma) return xong(KHONG_XOA_DUOC());
    const khoa = layKhoaDisc();
    const coBaiKhop = await db.discSubmission.count({
      where: {
        phoneKey: phoneKeyTuSdtChuan(sdt, khoa),
        claimStatus: "PENDING_CLAIM",
        deletedAt: null,
        retainUntil: { gt: now },
        claimAttempts: { lt: TOI_DA_LAN_THU_MA },
        claimCodeHash: bamMaNhan(ma, khoa),
      },
    });
    if (coBaiKhop === 0) return xong(KHONG_XOA_DUOC());

    // OTP trả chuỗi lỗi có đếm lượt thử — KHÔNG chuyển ra ngoài.
    const otp = await verifyAndConsumeOtp({ target: sdt, purpose: "DISC_CLAIM", code: p.data.otp });
    if (!otp.ok) return xong(KHONG_XOA_DUOC());

    const r = await xoaBangMa({ sdtDaXacMinh: sdt, maNhan: p.data.maNhan, store: maNhanStore, now });
    if (!r.ok) return xong(KHONG_XOA_DUOC());
    return xong(json({ ok: true }, 200));
  } catch {
    // Không đính lỗi gốc (có thể mang mảnh dữ liệu cá nhân).
    return xong(json({ ok: false, loi: "XOA_THAT_BAI" }, 503));
  }
}
