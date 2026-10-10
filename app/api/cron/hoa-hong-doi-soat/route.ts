import { withCron } from "@/lib/cron/handler";
import { db } from "@/lib/db";
import { dungBoiCanhQuet } from "@/lib/hoa-hong/boi-canh";
import { doiSoatNen } from "@/lib/hoa-hong/quet-ky";
import { getSetting } from "@/lib/settings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PR5a — ĐỐI SOÁT NỀN hằng tuần (docs/source-commission/04 §12.1 Q5, 05 PER-10).
//
// Quét lại MỌI khoản có ô trong `hoaHong.soThangDoiSoat` tháng gần nhất (mặc định 3), cùng khoản có hàng chờ đang mở và khoản đã rời thực thu
// (Q6), để phát hiện đầu vào TRÔI (đổi người phụ trách, nối đơn về lead, đổi nguồn…) mà KHÔNG ai bấm Tính. Chỉ PHÁT HIỆN: trôi ⇒ hàng chờ
// INPUT_DRIFT cho người duyệt; không bao giờ tự ghi lại tiền.
//
// Trần số khoản mỗi lượt (`GIOI_HAN`) để một lượt cron không giữ DB quá lâu; bị cắt ⇒ báo `biCat` + `canhBao` (không im lặng). Phần bị cắt được chọn theo "lần so gần nhất CŨ NHẤT
// trước" (`chonKhoanKhiBiCat`) nên lượt sau quét tiếp phần còn lại — không phải cùng 2000 khoản cũ nhất mỗi tuần.
//
// CỜ TẮT ⇒ NO-OP TUYỆT ĐỐI, cùng lý do `hoa-hong-quet`.
const GIOI_HAN = 2000;

export const GET = withCron("hoa-hong-doi-soat", async () => {
  const now = new Date();
  const b = await dungBoiCanhQuet(db, now);
  if (b.loai === "TAT") return { ok: true, data: { boQua: b.lyDo } };
  const soThang = await getSetting("hoaHong.soThangDoiSoat");
  const r = await doiSoatNen(db, b.bc, { soThang, gioiHan: GIOI_HAN });
  return {
    ok: r.loi.length === 0,
    data: {
      soThang,
      soKhoan: r.soKhoan,
      theoKetQua: r.theoKetQua,
      soKhoanLoi: r.loi.length,
      biCat: r.biCat,
      ...(r.biCat ? { canhBao: `Tập đối soát vượt ${GIOI_HAN} khoản — chỉ quét ${r.soKhoan}; phần còn lại được ưu tiên ở lượt sau (cũ nhất trước).` } : {}),
    },
  };
});
