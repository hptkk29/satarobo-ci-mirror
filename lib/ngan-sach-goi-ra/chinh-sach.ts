// =============================================================================
// TRẦN CHI PHÍ THÁNG cho lời gọi ra ngoài — phần LUẬT THUẦN (không DB, không env).
//
// Chốt 27/08/2026: Zalo 2.000.000đ · chấm điểm AI 1.000.000đ (trục cước gọi điện OmiCall
// đã gỡ 06/10/2026). Điểm chính KHÔNG phải các con số đó, mà là: phải có một con số TRƯỚC KHI bật lời
// gọi ra ngoài, và con số đó sửa được mà không phải triển khai lại. Vì vậy chúng
// nằm trong SystemSetting (`lib/settings/registry.ts`, nhóm "finance"), KHÔNG nằm
// trong env và KHÔNG nằm ở đây dưới dạng hằng số.
//
// TỔNG là SUY RA, không phải một ô nhập riêng. Đây là bài học đã trả giá
// ở `COMMISSION_TIERS` (xem CLAUDE.md): khi tổng được khai riêng bên cạnh các phần,
// hai nguồn sẽ trôi khỏi nhau và không ai biết nguồn nào đúng. Muốn đổi tổng thì đổi
// các con số thành phần — `tongTran()` luôn khớp theo định nghĩa.
//
// Ranh giới trách nhiệm của file này: nó KHÔNG phải cái cổng. Cổng thật là câu lệnh
// UPDATE có điều kiện ở `cau-lenh.ts` (một câu, khoá dòng — hai lời gọi cùng lúc lúc
// sát trần không cùng lọt được). File này giữ bất đẳng thức biên, cách tính kỳ tháng,
// mốc cảnh báo và câu chữ — để chỗ khác dùng lại và để test pin được.
// =============================================================================
import { vnParts } from "@/lib/time/vn";

/** Các trục chi tiêu ra ngoài. Danh sách ĐÓNG — thêm trục là thêm khoá cấu hình. */
export const TRUC_CHI_PHI = ["ZALO", "CHAM_DIEM_AI"] as const;
export type TrucChiPhi = (typeof TRUC_CHI_PHI)[number];

/** Nhãn tiếng Việt để ghép câu cho người đọc (log, thông báo, màn cấu hình). */
export const NHAN_TRUC: Record<TrucChiPhi, string> = {
  ZALO: "tin nhắn Zalo",
  CHAM_DIEM_AI: "chấm điểm AI",
};

/**
 * Khoá SystemSetting giữ trần THÁNG của từng trục.
 *
 * Khoá rời chứ không một khoá JSON nhiều số: các con số này độc lập, không có ràng
 * buộc chéo nào cần `.refine()`, và khoá rời thì màn "Cấu hình vận hành" hiện từng ô
 * số sửa riêng được thay vì một ô JSON gõ tay (tiền lệ `crm.sla.*`).
 */
export const KHOA_TRAN_THANG = {
  ZALO: "outbound.zaloMonthlyCapVnd",
  CHAM_DIEM_AI: "outbound.aiGradingMonthlyCapVnd",
} as const satisfies Record<TrucChiPhi, string>;

/** Khoá SystemSetting của mốc cảnh báo (%), dùng chung cho mọi trục. */
export const KHOA_MOC_CANH_BAO = "outbound.warnAtPercent" as const;

/**
 * Mã máy đọc khi bị chặn vì hết ngân sách.
 *
 * PHẢI là mã RIÊNG, không mượn mã lỗi gửi thường: "hết tiền" là việc của người vận
 * hành (nâng trần / chờ sang kỳ), còn "Zalo từ chối" là việc của kỹ thuật. Trộn hai
 * thứ vào một mã là biến một sự cố ngân sách thành một cuộc truy lỗi mạng.
 */
export const MA_CHAN_NGAN_SACH = "OUTBOUND_BUDGET_EXCEEDED" as const;

/**
 * Mã khi KHÔNG ĐỌC ĐƯỢC sổ chi (DB lỗi). Cố ý tách khỏi mã trên: đây không phải
 * "hết tiền", mà là "không đếm được tiền". Xử lý vẫn là TỪ CHỐI (xem `so-chi.ts`).
 */
export const MA_KHONG_DEM_DUOC = "OUTBOUND_BUDGET_UNAVAILABLE" as const;

/**
 * Kỳ tháng "YYYY-MM" theo LỊCH VIỆT NAM.
 *
 * Không dùng `getMonth()` trần: máy chạy prod/CI là UTC, nên 7 giờ cuối mỗi tháng sẽ
 * bị ghi vào kỳ TRƯỚC ⇒ sang ngày 1 ngân sách chưa thật sự reset. Đúng loại lỗi
 * "chạy máy tôi thì được" đã làm lệch lịch buổi học 06/08/2026.
 */
export function kyThangVn(now: Date): string {
  const p = vnParts(now);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}`;
}

/** "2026-08" → "08/2026" để đọc trong câu tiếng Việt. */
export function kyThangDeDoc(kyThang: string): string {
  const [nam, thang] = kyThang.split("-");
  return thang && nam ? `${thang}/${nam}` : kyThang;
}

/** Số tiền VND có dấu chấm phân nhóm — dùng trong câu giải thích cho người. */
export function dinhDangVnd(soTien: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(soTien));
}

export interface QuyetDinhNganSach {
  /** Lượt này có được tiêu không. */
  choPhep: boolean;
  /** Đã tiêu TRƯỚC lượt này. */
  daTieuVnd: number;
  /** Sẽ tiêu sau lượt này (kể cả khi bị chặn — để hiện "thiếu bao nhiêu"). */
  sauKhiTieuVnd: number;
  tranVnd: number;
  /** Còn lại sau lượt này; bị chặn thì tính trên mức đã tiêu. Không bao giờ âm. */
  conLaiVnd: number;
  /** % đã dùng sau lượt này (bị chặn thì % của mức đã tiêu). */
  phanTramVnd: number;
  mocCanhBaoVnd: number;
  /** Lượt này VỪA đẩy tổng vượt qua mốc cảnh báo (chỉ đúng ở đúng lượt vượt). */
  chamNguongCanhBao: boolean;
}

/**
 * Luật biên: cho đi khi `đã tiêu + chi phí ≤ trần`.
 *
 * Dùng `≤` chứ không `<`: tiêu vừa khít trần là hợp lệ, đồng tiếp theo mới bị chặn.
 * Câu lệnh SQL ở `cau-lenh.ts` PHẢI viết cùng bất đẳng thức này — `cau-lenh.test.ts`
 * pin lại chuyện đó.
 *
 * `tranVnd = 0` nghĩa là TẮT trục, không phải "không giới hạn": trạng thái an toàn
 * của mọi lời gọi ra ngoài trong kho này luôn là KHÔNG GỌI.
 */
export function quyetDinhNganSach(args: {
  daTieuVnd: number;
  chiPhiVnd: number;
  tranVnd: number;
  mocCanhBaoPhanTram: number;
}): QuyetDinhNganSach {
  const { daTieuVnd, chiPhiVnd, tranVnd, mocCanhBaoPhanTram } = args;
  if (!Number.isFinite(chiPhiVnd) || chiPhiVnd < 0) {
    throw new RangeError(`Chi phí một lượt phải là số ≥ 0, nhận được: ${chiPhiVnd}`);
  }

  const sauKhiTieuVnd = daTieuVnd + chiPhiVnd;
  const choPhep = sauKhiTieuVnd <= tranVnd;
  const mocThuc = choPhep ? sauKhiTieuVnd : daTieuVnd;

  const mocCanhBaoVnd = Math.floor((tranVnd * mocCanhBaoPhanTram) / 100);

  return {
    choPhep,
    daTieuVnd,
    sauKhiTieuVnd,
    tranVnd,
    conLaiVnd: Math.max(0, tranVnd - mocThuc),
    phanTramVnd: tranVnd > 0 ? Math.round((mocThuc / tranVnd) * 100) : 100,
    mocCanhBaoVnd,
    // Chỉ đúng ở lượt VƯỢT QUA mốc: lượt bị chặn không tiêu đồng nào nên không tính,
    // và lượt khi đã ở trên mốc từ trước cũng không tính (nếu không thì mỗi tin nhắn
    // sau mốc 80% lại kêu một lần — cảnh báo kêu mãi là cảnh báo bị tắt).
    chamNguongCanhBao: choPhep && daTieuVnd < mocCanhBaoVnd && sauKhiTieuVnd >= mocCanhBaoVnd,
  };
}

/** Tổng trần toàn hệ thống — SUY RA từ các trục, không phải ô nhập riêng. */
export function tongTran(tranTheoTruc: Record<TrucChiPhi, number>): number {
  return TRUC_CHI_PHI.reduce((tong, truc) => tong + tranTheoTruc[truc], 0);
}

/**
 * Câu giải thích khi bị chặn. Cố ý KHÔNG có chữ "thử lại sau": hết ngân sách thì chờ
 * không tự khỏi, phải có người nâng trần hoặc đợi sang kỳ sau.
 */
export function thongDiepChan(args: {
  truc: TrucChiPhi;
  kyThang: string;
  daTieuVnd: number;
  tranVnd: number;
}): string {
  const { truc, kyThang, daTieuVnd, tranVnd } = args;
  return (
    `Đã dùng hết ngân sách ${NHAN_TRUC[truc]} của kỳ ${kyThangDeDoc(kyThang)} ` +
    `(${dinhDangVnd(daTieuVnd)}đ / trần ${dinhDangVnd(tranVnd)}đ). ` +
    `Hệ thống tạm ngừng gửi ra cho tới khi quản trị nâng trần hoặc sang kỳ mới.`
  );
}
