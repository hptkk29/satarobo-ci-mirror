import { db } from "@/lib/db";

import { layKhoTepRieng, type KhoTepRieng } from "../kho-tep-rieng";

/**
 * SEC-07 (V8.45) — DỌN TỆP TẢI LÊN BỎ DỞ của kho riêng (bài nộp / câu trả lời lượt thi). Cron hằng ngày.
 *
 * Lỗ: URL PUT ký sẵn không ràng cỡ; vé `ISSUED` mà app không bao giờ báo «đã tải xong» (hoặc người dùng bỏ giữa chừng) để lại đối tượng trong R2 vĩnh viễn — 60 vé / 10 phút / phụ huynh
 * ⇒ chiếm dung lượng. Cũng vậy với tệp đã XÁC MINH (`UPLOADED`) mà không bao giờ được gắn vào bài nộp.
 *
 * Tập bị dọn (CHỈ hai loại, đều là vé CHƯA BAO GIỜ gắn vào bài nộp / lượt thi):
 *   · `ISSUED` với `expiresAt` quá `LUI_HET_HAN_MS` (1 giờ — bù cho `LUI_XAC_MINH_MS` của lượt báo hoàn tất trễ và cho việc xin lại vé đẩy `expiresAt` ra xa);
 *   · `UPLOADED` với `verifiedAt` quá `GIU_DA_TAI_LEN_MS` (7 ngày) mà không gắn.
 * KHÔNG BAO GIỜ đụng `ATTACHED` (tệp của bài nộp thật) / `REJECTED` / `EXPIRED` (đối tượng đã bị gỡ lúc từ chối).
 *
 * Thứ tự an toàn: NHẬN (đổi trạng thái có điều kiện, cùng điều kiện đã dùng để chọn) → rồi mới XOÁ đối tượng. Nếu giữa lúc chọn và lúc nhận app xin lại vé (đẩy `expiresAt` ra xa) hoặc báo
 * hoàn tất (chuyển UPLOADED) thì phép nhận đổi 0 dòng ⇒ bỏ qua, không đụng đối tượng. Xoá đối tượng lỗi ⇒ trả trạng thái cũ để lượt sau thử lại (xoá lặp trên kho là vô hại).
 * Bảng chỉ mang vé của học viên ⇒ đọc/ghi bằng `db` trần (đúng chỗ cho phép: lib/mobile-api/**).
 *
 * ⚠️ MẶC ĐỊNH CHỈ BÁO CÁO (`choPhepXoa=false`) — cùng khuôn các cron dọn tệp mồ côi khác (R2 không có thùng rác). Bật xoá thật bằng env `MOBILE_UPLOAD_DON_XOA=1` sau khi đã đọc vài lượt báo cáo.
 * Chưa phủ: đối tượng mồ côi vì HÀNG BỊ XOÁ (học viên bị xoá cứng kéo theo `MobileUpload` — onDelete Cascade) và tệp «nộp sản phẩm» Online (khoá `online/sp/…` chưa có bảng vé) —
 * cần liệt kê kho hoặc quy tắc vòng đời bucket (lifecycle), việc riêng.
 */
export const LUI_HET_HAN_MS = 60 * 60_000;
export const GIU_DA_TAI_LEN_MS = 7 * 24 * 60 * 60_000;
export const TRAN_MOI_LUOT = 200;

export type KetQuaDonVe = {
  boQua: "KHO_CHUA_CAU_HINH" | null;
  /** Số vé đủ điều kiện dọn trong lượt này (≤ trần). */
  seDon: number;
  daDon: number;
  /** Nhận được nhưng xoá đối tượng lỗi (đã trả trạng thái cũ). */
  loiXoa: number;
  /** Đã có người xin lại / báo hoàn tất giữa lúc chọn và lúc nhận ⇒ bỏ qua. */
  boQuaDua: number;
  choPhepXoa: boolean;
  catNgang: boolean;
};

export type TuyChonDonVe = { choPhepXoa: boolean; tran?: number; kho?: KhoTepRieng | null; /** CHỈ cho test: chạy giữa lúc chọn và lúc nhận. */ sauKhiChon?: () => Promise<void> };

export async function donVeTaiLenBoDo(now: Date, opts: TuyChonDonVe): Promise<KetQuaDonVe> {
  const kho = opts.kho === undefined ? layKhoTepRieng() : opts.kho;
  const tran = opts.tran ?? TRAN_MOI_LUOT;
  const trong: KetQuaDonVe = { boQua: null, seDon: 0, daDon: 0, loiXoa: 0, boQuaDua: 0, choPhepXoa: opts.choPhepXoa, catNgang: false };
  if (!kho) return { ...trong, boQua: "KHO_CHUA_CAU_HINH" };

  const hanIssued = new Date(now.getTime() - LUI_HET_HAN_MS);
  const hanUploaded = new Date(now.getTime() - GIU_DA_TAI_LEN_MS);
  const dieuKien = [
    { status: "ISSUED" as const, expiresAt: { lt: hanIssued } },
    { status: "UPLOADED" as const, verifiedAt: { lt: hanUploaded } },
  ];
  const ds = await db.mobileUpload.findMany({
    where: { OR: dieuKien },
    select: { id: true, storageKey: true, status: true },
    orderBy: { createdAt: "asc" },
    take: tran + 1,
  });
  const catNgang = ds.length > tran;
  const chon = ds.slice(0, tran);
  const ra: KetQuaDonVe = { ...trong, seDon: chon.length, catNgang };
  if (!opts.choPhepXoa || chon.length === 0) {
    console.info(`[mobile-upload-don-dep] ${JSON.stringify(ra)}`);
    return ra;
  }
  if (opts.sauKhiChon) await opts.sauKhiChon();

  for (const v of chon) {
    // NHẬN: cùng điều kiện đã dùng để chọn ⇒ vé vừa được xin lại / báo hoàn tất (đổi `expiresAt` / `status`) thì không còn khớp ⇒ 0 dòng.
    const nhan = await db.mobileUpload.updateMany({
      where: v.status === "ISSUED" ? { id: v.id, status: "ISSUED", expiresAt: { lt: hanIssued } } : { id: v.id, status: "UPLOADED", verifiedAt: { lt: hanUploaded } },
      data: { status: "EXPIRED" },
    });
    if (nhan.count !== 1) {
      ra.boQuaDua++;
      continue;
    }
    try {
      await kho.xoa(v.storageKey);
      ra.daDon++;
    } catch {
      ra.loiXoa++;
      await db.mobileUpload.updateMany({ where: { id: v.id, status: "EXPIRED" }, data: { status: v.status } }); // trả lại để lượt sau thử xoá lại
    }
  }
  console.info(`[mobile-upload-don-dep] ${JSON.stringify(ra)}`);
  return ra;
}
