import { withCron } from "@/lib/cron/handler";
import { chayDoiSoatQuyenHoc, GIOI_HAN_DON_MOI_CO_SO } from "@/lib/entitlements/hang-doi/doi-soat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trần thời gian một lượt: quét tối đa `GIOI_HAN_DON_MOI_CO_SO` đơn mỗi cơ sở bật cờ, mỗi đơn vài câu đọc + (hiếm) một transaction ngắn. */
export const maxDuration = 300;

// Thu học phí theo phạm vi học · cron đối soát quyền học (docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md). Mỗi đêm (`deploy/crontab.example`; `vercel.json`).
//
// 🔴 KHÔNG BAO GIỜ cấp / sửa / thu hồi quyền học. Chỉ TẠO hoặc CẬP NHẬT dòng hàng đợi (`StudyEntitlementXuLy`) và ĐẾM. Cơ sở nào TẮT cờ
// phạm vi (theo cơ sở) thì BỎ QUA hoàn toàn (không đọc đơn, không ghi gì) và chỉ ghi vào báo cáo. Chạy lại không tạo dòng trùng.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch JSON có cấu trúc. Báo cáo trả về trong `data` và in ra log một dòng tóm tắt.
export const GET = withCron("quyen-hoc-doi-soat", async () => {
  const bao = await chayDoiSoatQuyenHoc({ now: new Date(), gioiHanDonMoiCoSo: GIOI_HAN_DON_MOI_CO_SO });
  console.info(
    `[quyen-hoc-doi-soat] cơ sở quét ${bao.soCoSoQuet} · bỏ ${bao.soCoSoBoQua} · đơn ${bao.soDonQuet} (lỗi ${bao.soDonLoi}) · mới ${JSON.stringify(bao.moiTheoLoai)} · quá hạn ${bao.quaHan.tong}`,
  );
  return { ok: true, data: bao };
});
