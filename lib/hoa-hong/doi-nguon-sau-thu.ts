// lib/hoa-hong/doi-nguon-sau-thu.ts — ĐỔI NGUỒN SAU KHI ĐÃ THU TIỀN → ĐỀ XUẤT ĐIỀU CHỈNH chờ duyệt (04 §10.4 bước 4, §11.4; 03 §3; hướng B+C 16/10/2026).
//
// PR2 (`lib/nguon/doi-nguon-lead.ts`) phát `nguon.da-doi-sau-thanh-toan` CÙNG transaction với lượt đổi và cố ý KHÔNG đụng sổ hoa hồng. Tệp này là phần của
// ENGINE: với MỌI khoản thu có ô của lead đó, so Σ ròng với kỳ vọng theo attribution MỚI (tính trên `coSoConLai`, rule tại `rateDate` GỐC) và — NẾU có chênh lệch do
// nguồn gây ra — LẬP MỘT ĐỀ XUẤT `CommissionAdjustmentRequest` (gói = chênh lệch cho mỗi (vai × người)). KHÔNG ghi sổ: tiền chỉ đổi khi người duyệt (một hoặc hai cấp, theo ngưỡng
// cấu hình) bấm duyệt, và khi đó dòng `SOURCE_CORRECTION` mới được ghi — ở `duyet-de-xuat.ts`, chỗ DUY NHẤT gọi chế độ `DOI_NGUON_CO_QUYEN` (lưới [DXD-W5]).
// Đổi nguồn KHÔNG ảnh hưởng tiền (không có chênh lệch) ⇒ không có đề xuất nào; chỗ gọi ghi một AuditLog tóm tắt.
//
// Idempotent: (1) ô đang có đề xuất mở ⇒ không lập thêm (chỉ mục từng phần DB + kiểm trong engine); (2) cùng sự kiện × ô chỉ có MỘT đề xuất kể cả đã bị từ chối (chỉ mục
// `…_su_kien_key`) nên retry của dispatcher không đẻ lại đề xuất đã bị bác. Ô có khiếu nại ⇒ rơi về INPUT_DRIFT cho người duyệt.
import type { PrismaClient } from "@prisma/client";

import type { BoiCanhQuet } from "./boi-canh";
import { docKhoan } from "./nap-khoan";
import { kyVongSauLichSu, soVoiO, tachChenhDoiNguon, type ChenhNguoi } from "./o-tinh";
import { docTrangThaiO } from "./o-tinh-db";
import { hashCuaKetQua, khoaLichSuCua, kyVongCua, lapThu, quetKhoan } from "./quet-khoan";
import { tongGoi } from "./quan-tri-dieu-chinh";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";

export type KetQuaDoiNguonSauThu = { soKhoan: number; theoKetQua: Record<string, number>; deXuat: string[] };

/**
 * @param refEventId  định danh SỰ KIỆN đổi nguồn: `DomainEvent.id` (đường sự kiện) hoặc `audit:<AuditLog.id>` (đường backfill từ AuditLog). Hai đường có thể
 *                    cùng xử lý MỘT lượt đổi — vẫn không lập hai đề xuất: ô đã có đề xuất mở thì bỏ qua, và sau khi đề xuất được duyệt chênh lệch = 0.
 * @param requestedById `User.id` người đã ĐỔI NGUỒN (người đề xuất): người duyệt phải khác người này, cũng như khác người hưởng (tách nhiệm). BẮT BUỘC (luật 7).
 */
export async function apDungDoiNguonSauThu(client: PrismaClient, bc: BoiCanhQuet, i: { leadId: string; refEventId: string; requestedById: string }): Promise<KetQuaDoiNguonSauThu> {
  // Mọi khoản thu CÓ Ô của lead. Sắp theo ngày thu để kết quả tất định.
  const slots = await client.commissionCalcSlot.findMany({
    where: { payment: { order: { leadId: i.leadId } } },
    select: { paymentId: true, payment: { select: { paidDate: true } } },
  });
  const theoKhoan = new Map(slots.map((s) => [s.paymentId, s.payment.paidDate]));
  const ids = [...theoKhoan.entries()].sort(([a, da], [b, db]) => da.getTime() - db.getTime() || (a < b ? -1 : 1)).map(([id]) => id);

  // MỘT sự kiện đổi nguồn chạm NHIỀU ô và mỗi ô lập đề xuất ở giao dịch riêng: nếu cái lập đầu tiên chỉ thấy gói của chính nó thì 4+4+4 triệu qua mặt ngưỡng 10 triệu (08 §17.v4.Q).
  // Dự báo tổng của CẢ sự kiện bằng đúng hàm xem trước (cùng các hàm thuần, cùng lựa chọn ô) rồi truyền vào từng lượt; chỗ quyết (`quyetDinhQuanTriTrongTx`) lấy MAX với tổng đo được nên
  // đếm dư chỉ đẩy về cấp hai. Dự báo hỏng/ném lỗi KHÔNG được nuốt: không lập đề xuất nào còn hơn lập đề xuất mang mức một người sai.
  const duBaoTongYeuCau = tongDuBaoCuaSuKien(await xemTruocDoiNguonSauThu(client, bc, i.leadId));
  const theoKetQua: Record<string, number> = {};
  const deXuat: string[] = [];
  for (const id of ids) {
    const r = await quetKhoan(client, bc, id, { cheDo: "DE_XUAT_DOI_NGUON", refEventId: i.refEventId, requestedById: i.requestedById, duBaoTongYeuCau });
    const nhan = r.loai === "BO_QUA" ? `BO_QUA:${r.lyDo}` : r.loai;
    theoKetQua[nhan] = (theoKetQua[nhan] ?? 0) + 1;
    if (r.loai === "DE_XUAT") deXuat.push(r.requestId);
  }
  return { soKhoan: ids.length, theoKetQua, deXuat };
}

/** Tổng |tiền| mà MỌI ô của sự kiện sẽ đưa vào đề xuất (mỗi ô `absTotal` của gói do nguồn gây ra). THUẦN theo kết quả xem trước. */
export function tongDuBaoCuaSuKien(xem: readonly XemTruocKhoan[]): number {
  let tong = 0;
  for (const k of xem) if (k.ketQua === "DE_XUAT") tong += tongGoi(k.deXuat).absTotal;
  return tong;
}

export type XemTruocKhoan = {
  paymentId: string;
  /** Phần do NGUỒN gây ra — `--lap-de-xuat` sẽ LẬP MỘT ĐỀ XUẤT có đúng các dòng này làm gói (chờ duyệt; không ghi sổ). */
  deXuat: ChenhNguoi[];
  /** Phần lệch vì lý do KHÁC nguồn (vd người chốt đổi) — không vào đề xuất, để lại `INPUT_DRIFT` cho người duyệt. */
  choDuyet: ChenhNguoi[];
  /** `DE_XUAT` = sẽ lập đề xuất · `KHONG_DE_XUAT` = ô khớp / đã chấp nhận / có khiếu nại (rơi về duyệt) / không dựng được kỳ vọng. */
  ketQua: "DE_XUAT" | "KHONG_DE_XUAT";
  lyDo?: string;
};

/**
 * XEM TRƯỚC (CHỈ ĐỌC, không khoá, không ghi) những gì `apDungDoiNguonSauThu` sẽ làm với lead — dùng cho dry-run của script backfill để người vận hành thấy
 * từng (vai × người) × số tiền TRƯỚC khi `--lap-de-xuat`. Cùng các hàm thuần với đường ghi (`lapThu` · `tinhDongChoKhoan` · `soVoiO` · `tachChenhDoiNguon`) nên không có bản tính thứ hai.
 */
export async function xemTruocDoiNguonSauThu(client: PrismaClient, bc: BoiCanhQuet, leadId: string): Promise<XemTruocKhoan[]> {
  const slots = await client.commissionCalcSlot.findMany({
    where: { payment: { order: { leadId } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, paymentId: true },
  });
  const slotDauTheoKhoan = new Map<string, string>();
  for (const s of slots) if (!slotDauTheoKhoan.has(s.paymentId)) slotDauTheoKhoan.set(s.paymentId, s.id);

  const vaiAcq = new Set(bc.hoaHong.vaiHuong.filter((v) => v.isAcquisition).map((v) => v.code));
  const ra: XemTruocKhoan[] = [];
  for (const [paymentId, slotId] of slotDauTheoKhoan) {
    const p = await docKhoan(client, paymentId);
    if (!p) {
      ra.push({ paymentId, deXuat: [], choDuyet: [], ketQua: "KHONG_DE_XUAT", lyDo: "KHOAN_KHONG_TON_TAI" });
      continue;
    }
    const lap = await lapThu(client, bc, p);
    if (lap.loai !== "TINH") {
      ra.push({ paymentId, deXuat: [], choDuyet: [], ketQua: "KHONG_DE_XUAT", lyDo: `KHONG_DUNG_DUOC_KY_VONG:${lap.loai}` });
      continue;
    }
    const o = (await docTrangThaiO(client, [slotId])).get(slotId);
    if (!o) {
      ra.push({ paymentId, deXuat: [], choDuyet: [], ketQua: "KHONG_DE_XUAT", lyDo: "O_KHONG_TON_TAI" });
      continue;
    }
    const kq = tinhDongChoKhoan(lap.kh.dauVao(o.coSoConLai));
    if (kq.loai !== "OK") {
      ra.push({ paymentId, deXuat: [], choDuyet: [], ketQua: "KHONG_DE_XUAT", lyDo: `LOI_CAU_HINH:${kq.loai}` });
      continue;
    }
    // Cùng bất biến carry-forward với đường quét/duyệt: người nghỉ việc / affiliate ngưng / cờ nguồn tắt KHÔNG tạo chênh lệch "−x".
    const ls = kyVongSauLichSu(kyVongCua(kq), o.rong, khoaLichSuCua(lap.kh, o.coSoConLai));
    const r = soVoiO({ o, kyVong: ls.kyVong, hashMoi: hashCuaKetQua(lap.kh, bc, o.coSoConLai, kq), cheDo: "DOI_NGUON_CO_QUYEN" });
    if (r.loai === "GHI") {
      const { deXuat, choDuyet } = tachChenhDoiNguon(r.chenh, vaiAcq);
      ra.push({ paymentId, deXuat, choDuyet, ketQua: deXuat.length > 0 ? "DE_XUAT" : "KHONG_DE_XUAT", ...(deXuat.length === 0 ? { lyDo: "CHI_CO_PHAN_CHO_DUYET" } : {}) });
    } else {
      ra.push({ paymentId, deXuat: [], choDuyet: r.loai === "INPUT_DRIFT" ? r.chenh : [], ketQua: "KHONG_DE_XUAT", lyDo: r.loai === "INPUT_DRIFT" ? "O_CO_KHIEU_NAI" : r.lyDo });
    }
  }
  return ra;
}
