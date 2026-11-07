/**
 * POST /api/disc/luu — lưu kết quả DISC của một gia đình (PRD v2.0 §Bước 3–4).
 * Hợp đồng đầy đủ: docs/disc-tich-hop/04-api-contract.md.
 *
 * Bất biến của lớp HTTP (luật nghiệp vụ nằm ở lib/disc/luu.ts):
 *  - cờ DISC_ENABLED tắt ⇒ 404 TRƯỚC mọi việc khác (không lộ route tồn tại);
 *  - chặn tần suất theo IP, theo CẶP (phoneKey, IP băm) và một trần cứng cao hơn theo phoneKey (N6); trần kích thước body;
 *  - sàn thời gian (F-12): sau khi đọc body, MỌI phản hồi (ok/lỗi/replay/trần) được kéo về cùng một ngưỡng tối thiểu
 *    (`denNguongThoiGian`) để độ trễ không phân biệt nhánh "SĐT đã là lead" với "SĐT mới" (CRM chạy `await` ở nhánh lưu mới);
 *  - phản hồi KHÔNG phân biệt SĐT đã có tài khoản hay chưa (route không tra User/Lead);
 *  - lỗi hạ tầng ⇒ 503 chung; KHÔNG log body (dữ liệu trẻ).
 */
import { NextResponse } from "next/server";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { denNguongThoiGian, phuThuocThoiGianThat } from "@/lib/security/dong-deu-thoi-gian";
import { congCrmThat } from "@/lib/disc/crm-that";
import { guiLinkXacMinh } from "@/lib/disc/email";
import { gocUngDungEmail } from "@/lib/disc/email-goc";
import { emailStore, gioiHanEmailThat, xepThuThat } from "@/lib/disc/email-prisma";
import { ensureDiscEngine } from "@/lib/disc/engine-dang-ky";
import { docBodyCoTran } from "@/lib/disc/doc-body";
import { luuKetQuaDisc, luuSchema, type KetQuaGuiEmail } from "@/lib/disc/luu";
import { ipDiscChoGioiHan, ipKeyTuIp, layKhoaDisc, phoneKeyCuaSdt } from "@/lib/disc/phone-key";
import { choPhepBaiMoiToanCuc } from "@/lib/disc/tran-toan-cuc";
import { discStore } from "@/lib/disc/store-prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trần body (byte; KHÔNG export — route Next chỉ được export handler/config). Hai hồ sơ + hai bộ câu trả lời thô nằm thoải mái dưới mức này. */
const TRAN_BODY_BYTE = 64 * 1024;
const LIMIT_IP = { max: 10, windowMs: 10 * 60_000 };
/** Theo CẶP (SĐT, IP băm): kẻ gõ 5 lần chỉ khoá chính IP của hắn với SĐT đó — chủ số từ IP khác không bị ảnh hưởng (N6). */
const LIMIT_CAP = { max: 5, windowMs: 60 * 60_000 };
/** Trần cứng theo SĐT ở mọi IP — chỉ chặn lạm dụng cực đoan. Chạm trần ⇒ phản hồi Y HỆT lỗi lưu chung (không oracle). */
const LIMIT_SDT_CUNG = { max: 30, windowMs: 60 * 60_000 };

/**
 * Xếp thư xác minh email (chỉ được gọi khi bài CÓ email). Gốc URL lấy từ cấu hình máy chủ (`gocUngDungEmail`), KHÔNG từ Host/Origin của
 * request; không có gốc hợp lệ ⇒ `THIEU_GOC`: không đoán tên miền, không gửi — lời thông báo sẽ nói thẳng là chưa gửi được.
 * Việc GỬI thật là của cron `processEmailQueue`; ở đây chỉ xếp hàng.
 */
async function guiEmailXacMinh(submissionId: string, now: Date): Promise<KetQuaGuiEmail> {
  const goc = gocUngDungEmail();
  if (!goc) return { ok: false, loi: "THIEU_GOC" };
  return guiLinkXacMinh({ submissionId, goc, store: emailStore, xepThu: xepThuThat, now, gioiHan: gioiHanEmailThat });
}

const KHONG_LUU_DEM = { "Cache-Control": "no-store" } as const;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: KHONG_LUU_DEM });

export async function POST(req: Request) {
  if (!isDiscEnabled()) return new NextResponse(null, { status: 404 });
  ensureDiscEngine();
  // Một điểm đọc giờ cho sàn thời gian (cùng khuôn /api/disc/xoa).
  const them = phuThuocThoiGianThat();
  const batDau = them.now().getTime();
  const xong = async (res: NextResponse) => {
    await denNguongThoiGian(them, batDau, "disc-luu");
    return res;
  };

  try {
    const ip = ipDiscChoGioiHan(req.headers); // IPv6 gộp /64 (S-04)
    const gioiHanIp = await rateLimit({ key: `disc:luu:ip:${ip}`, ...LIMIT_IP });
    if (!gioiHanIp.success) return json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, 429);

    const khaiBao = Number(req.headers.get("content-length"));
    if (Number.isFinite(khaiBao) && khaiBao > TRAN_BODY_BYTE) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);
    // Đọc theo luồng, huỷ khi vượt trần — không đệm body chunked không khai Content-Length vào RAM (S-11).
    const doc = await docBodyCoTran(req, TRAN_BODY_BYTE);
    if (!doc.ok) return json({ ok: false, loi: "BODY_QUA_LON" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(doc.text);
    } catch {
      return xong(json({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE" }, 400));
    }

    // Khoá đếm dùng HMAC (khoá đếm có thể bị log; sha256 trần của SĐT/IP vét cạn được). Bộ đếm này rơi về bộ nhớ-theo-tiến-trình
    // khi Upstash chết — lưới thứ hai là trần DB trong `luuKetQuaDisc`.
    const khoa = layKhoaDisc();
    // S-06: chỉ tính bộ đếm theo SĐT khi body ĐÃ qua zod — kẻ gửi body sai hình dạng kèm SĐT nạn nhân không đốt được trần của nạn nhân.
    // Body sai vẫn đi tiếp tới `luuKetQuaDisc` để nhận lỗi 400 chi tiết như cũ (không tốn lượt đếm SĐT).
    const hopLeHinhDang = luuSchema.safeParse(body).success;
    const sdtKey = hopLeHinhDang ? phoneKeyCuaSdt((body as { soDienThoai?: unknown } | null)?.soDienThoai, () => khoa) : null;
    if (sdtKey) {
      const ipKey = ipKeyTuIp(ip, khoa);
      const gioiHanCap = await rateLimit({ key: `disc:luu:cap:${sdtKey.slice(0, 24)}:${ipKey.slice(0, 24)}`, ...LIMIT_CAP });
      if (!gioiHanCap.success) return xong(json({ ok: false, loi: "QUA_NHIEU_YEU_CAU" }, 429));
      const gioiHanSdt = await rateLimit({ key: `disc:luu:sdt:${sdtKey.slice(0, 24)}`, ...LIMIT_SDT_CUNG });
      if (!gioiHanSdt.success) return xong(json({ ok: false, loi: "LUU_THAT_BAI" }, 503));
      // Cầu chì ngân sách TOÀN CỤC theo ngày (S-04). Chạm ⇒ thông điệp CHUNG (Y HỆT lỗi lưu khác), không lộ lý do.
      if (!(await choPhepBaiMoiToanCuc())) return xong(json({ ok: false, loi: "LUU_THAT_BAI" }, 503));
    }

    const r = await luuKetQuaDisc(body, { store: discStore, crm: congCrmThat, guiEmail: guiEmailXacMinh, nguonIp: ip });
    if (r.ok) {
      return xong(json({ ok: true, submissionId: r.submissionId, tokenTai: r.tokenTai, maNhan: r.maNhan, thongBao: r.thongBao }, 200));
    }
    if (r.loi === "QUA_NHIEU_YEU_CAU") return xong(json({ ok: false, loi: r.loi }, 429));
    if (r.loi === "ENGINE_CHUA_SAN_SANG") return xong(json({ ok: false, loi: r.loi }, 503));
    if (r.loi === "LUU_THAT_BAI") return xong(json({ ok: false, loi: "LUU_THAT_BAI" }, 503));
    return xong(json({ ok: false, loi: r.loi, chiTiet: r.chiTiet }, 400));
  } catch {
    // Không đính lỗi gốc: có thể mang mảnh dữ liệu cá nhân của trẻ.
    console.error("[disc/luu] loi ha tang");
    return xong(json({ ok: false, loi: "LUU_THAT_BAI" }, 503));
  }
}
