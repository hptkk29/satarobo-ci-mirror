import { withCron } from "@/lib/cron/handler";
import { kyCuaButToan } from "@/lib/crm/commission-thuc-thu";
import { db } from "@/lib/db";
import { dungBoiCanhQuet } from "@/lib/hoa-hong/boi-canh";
import { congThang } from "@/lib/hoa-hong/ky-hoa-hong";
import { quetKy } from "@/lib/hoa-hong/quet-ky";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PR5a — QUÉT hoa hồng theo kỳ (docs/source-commission/04 §12.1 tập Q1–Q4 + Q6, 05 PR5a).
//
// Engine KHÔNG cắm sự kiện vào đường tiền: cron này QUÉT các khoản thực thu của THÁNG NÀY và THÁNG TRƯỚC cho từng cơ sở rồi ghi sổ mới
// (ô tính + dòng ORIGINAL/LATE_ARRIVAL/REVERSAL + hàng chờ). Tháng trước được quét lại vì khoản xác nhận muộn / hoàn tiền / dữ liệu
// trôi của tháng đó vào sổ ở kỳ đang mở kế tiếp.
//
// ── CỜ TẮT ⇒ NO-OP TUYỆT ĐỐI ────────────────────────────────────────────────────────────────────
// `hoaHong.engineBat` mặc định TẮT và `hoaHong.kyCutover` mặc định CHƯA ĐẶT: khi merge lên `main` cron này chạy theo lịch ngay, nên cổng phải là
// CHÍNH các công tắc đó (`dungBoiCanhQuet` trả `TAT`) — không phải "vắng dữ liệu nên vòng lặp rỗng". Tắt ⇒ không đọc bảng nghiệp vụ nào.
//
// Quét TUẦN TỰ từng cơ sở: một lượt cron không phải chỗ để nhân đôi tải lên DB; mỗi khoản đã tự khoá và idempotent nên chạy lại bao nhiêu
// lượt cũng ra cùng một trạng thái. Q5 (đối soát nền nhiều tháng) KHÔNG chạy ở đây — nó thuộc `hoa-hong-doi-soat` (hằng tuần).
export const GET = withCron("hoa-hong-quet", async () => {
  const now = new Date();
  const b = await dungBoiCanhQuet(db, now);
  if (b.loai === "TAT") return { ok: true, data: { boQua: b.lyDo } };

  const thangNay = kyCuaButToan(now);
  const thang = [congThang(thangNay, -1), thangNay].filter((t) => t >= b.bc.kyCutover);
  const coSo = await db.orgUnit.findMany({ where: { type: "CENTER", centerId: { not: null }, deletedAt: null }, select: { centerId: true } });
  const ketQua: Record<string, unknown> = {};
  let loi = 0;
  for (const c of coSo) {
    for (const t of thang) {
      const r = await quetKy(db, b.bc, { thang: t, centerId: c.centerId!, soThangDoiSoat: 0 });
      ketQua[`${c.centerId}:${t}`] = { soKhoan: r.soKhoan, theoKetQua: r.theoKetQua, loi: r.loi.length };
      loi += r.loi.length;
    }
  }
  return { ok: loi === 0, data: { thang, ketQua, soKhoanLoi: loi } };
});
