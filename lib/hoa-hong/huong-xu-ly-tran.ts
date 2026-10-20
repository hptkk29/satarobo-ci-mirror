// lib/hoa-hong/huong-xu-ly-tran.ts — HƯỚNG XỬ LÝ khi tổng tỉ lệ hoa hồng vượt TRẦN. THUẦN, an toàn cho client.
//
// Chủ dự án chốt 09/10/2026: có nâng trần 9% hay không là THAO TÁC CỦA ADMIN (sửa `crm.commissionMaxTotalRate` ở Cấu hình vận hành), KHÔNG phải một «quyết định kinh doanh còn
// mở» mà hệ thống phải chờ. Hệ thống không tự nâng, không tự cắt; guardrail vẫn CHẶN kích hoạt khi tổng vượt trần hiện hành — nhưng chặn mà không chỉ đường là bắt người dùng
// đoán. Nên mọi nơi nói «vượt trần» (hàng rào kích hoạt · bật lại «tham gia hoa hồng» · Thử tính) dùng MỘT hàm này để nói cùng bốn điều: tổng hiện tại, trần hiện tại, chênh lệch,
// và việc cần làm (nâng trần ở màn nào, hoặc chỉnh tỉ lệ, rồi kích hoạt lại).
//
// ⚠️ Nâng trần chỉ là một trong hai đường. Ô «Trần tổng hoa hồng» có giới hạn trên (`TRAN_HOA_HONG_TOI_DA`): tổng vượt cả giới hạn đó thì nâng trần không đủ — lời khuyên phải nói
// thẳng «chỉ còn chỉnh tỉ lệ» và KHÔNG đưa đường dẫn tới ô mà người dùng sẽ nhập rồi bị từ chối.
import { TRAN_HOA_HONG_TOI_DA } from "@/lib/settings/gioi-han-tran-hoa-hong";
import { microSangPhanTram } from "./phan-tram";

/** Khoá cấu hình của trần — MỘT nơi (lưới [HXT-03] đối chiếu với registry và nhãn vận hành). */
export const KHOA_TRAN_HOA_HONG = "crm.commissionMaxTotalRate" as const;

/**
 * Màn sửa trần. Không tiền tố `/admin` (cùng quy ước sidebar và các nơi khác: proxy gắn host). `tab=khach-hang` là tab chứa ô này theo `nhan-van-hanh.ts` — lưới [HXT-03] đọc tab
 * từ chính nhãn vận hành và đối chiếu, nên đổi tab của ô mà quên đây là đỏ.
 */
export const DUONG_CAU_HINH_TRAN = { href: "/cau-hinh-van-hanh?tab=khach-hang", nhan: "Cấu hình vận hành" } as const;

export type HuongXuLyTran = {
  /** Tổng tỉ lệ LỚN NHẤT trong các ngữ cảnh đã kiểm, theo phần trăm đọc được ("11", "9,5"). */
  tongPhanTram: string;
  /** Trần đang áp, theo phần trăm. */
  tranPhanTram: string;
  /** Tổng − trần, theo điểm phần trăm ("2"). */
  chenhLechPhanTram: string;
  /** Tổng nằm trong giới hạn của ô cấu hình ⇒ nâng trần là một lối ra hợp lệ. */
  coTheNangTran: boolean;
  /** Chỉ có khi `coTheNangTran`; null ⇒ UI không vẽ liên kết. */
  duongDan: { href: string; nhan: string } | null;
  /** Câu hướng dẫn hoàn chỉnh (đã nêu người làm, màn nào, việc gì, rồi kích hoạt lại). */
  loiKhuyen: string;
};

const MICRO_MOT = 1_000_000;

/** Tỉ lệ → micro, LÀM TRÒN LÊN (nâng trần tới đúng số này thì kiểm trần qua; làm tròn xuống là kẹt một micro). Tránh nhiễu dấu phẩy động bằng bước làm tròn 1e-9 trước. */
function microLenTren(tiLe: number): bigint {
  return BigInt(Math.ceil(Math.round(tiLe * 1e9) / 1000));
}

/** Trần là số cấu hình ≤ 6 chữ số thập phân: làm tròn gần nhất. */
function microGan(tiLe: number): bigint {
  return BigInt(Math.round(tiLe * MICRO_MOT));
}

const GIOI_HAN_MICRO = BigInt(Math.round(TRAN_HOA_HONG_TOI_DA * MICRO_MOT));

/**
 * Câu hướng dẫn. `tongToiDa = null` ⇒ không biết con số (Thử tính chỉ có danh sách đã cắt): nói chung, không bịa con số. Có số ⇒ nêu «tối thiểu X%» hoặc «vượt cả giới hạn».
 */
export function loiKhuyenNangTran(p: { tongToiDa: number | null }): string {
  const viec = "chỉnh lại tỉ lệ trong chính sách";
  const nguoi = "Quản trị hệ thống (người có quyền sửa cấu hình)";
  const khongTuLam = "Hệ thống không tự nâng trần và không tự cắt tỉ lệ.";
  if (p.tongToiDa === null) {
    return `Hướng xử lý: ${nguoi} nâng «Trần tổng hoa hồng» tại ${DUONG_CAU_HINH_TRAN.nhan}, hoặc ${viec}; sau đó kích hoạt lại. ${khongTuLam}`;
  }
  const tongMicro = microLenTren(p.tongToiDa);
  const tong = microSangPhanTram(tongMicro);
  if (tongMicro > GIOI_HAN_MICRO) {
    return `Hướng xử lý: tổng ${tong}% vượt cả giới hạn ${microSangPhanTram(GIOI_HAN_MICRO)}% mà ô «Trần tổng hoa hồng» cho phép, nên nâng trần cũng không đủ — chỉ còn cách ${viec} rồi kích hoạt lại. ${khongTuLam}`;
  }
  return `Hướng xử lý: ${nguoi} nâng «Trần tổng hoa hồng» lên tối thiểu ${tong}% tại ${DUONG_CAU_HINH_TRAN.nhan}, hoặc ${viec}; sau đó kích hoạt lại. ${khongTuLam}`;
}

/** Dựng hướng xử lý từ tổng LỚN NHẤT đã đo và trần đang áp (cả hai theo phân số: 0,11 · 0,09). */
export function dungHuongXuLyTran(p: { tongToiDa: number; tran: number }): HuongXuLyTran {
  const tongMicro = microLenTren(p.tongToiDa);
  const tranMicro = microGan(p.tran);
  const chenh = tongMicro > tranMicro ? tongMicro - tranMicro : BigInt(0);
  const coTheNangTran = tongMicro <= GIOI_HAN_MICRO;
  return {
    tongPhanTram: microSangPhanTram(tongMicro),
    tranPhanTram: microSangPhanTram(tranMicro),
    chenhLechPhanTram: microSangPhanTram(chenh),
    coTheNangTran,
    duongDan: coTheNangTran ? { href: DUONG_CAU_HINH_TRAN.href, nhan: DUONG_CAU_HINH_TRAN.nhan } : null,
    loiKhuyen: loiKhuyenNangTran({ tongToiDa: p.tongToiDa }),
  };
}

/** Một chính sách ĐANG CHẠY mà tổng tỉ lệ lớn nhất của nó vượt trần mới được đề nghị. */
export type ChinhSachVuotTranMoi = { policyCode: string; versionNo: number; tongToiDa: number };

/**
 * Câu TỪ CHỐI khi HẠ trần (`crm.commissionMaxTotalRate`) xuống dưới tổng của chính sách đang ACTIVE (W2, res1 R1-M4). `null` = không chính sách nào vượt ⇒ cho lưu. Nói đủ: tổng lớn nhất hiện hành, những chính
 * sách nào, hậu quả (MỌI khoản thu mới của chúng bị chặn «vượt trần», không sinh dòng hoa hồng — không có cảnh báo nào khác), và đường lui (giữ trần tối thiểu bằng tổng đó, hoặc hạ tỉ lệ trước). THUẦN.
 */
export function cauHaTranVuot(p: { tranMoi: number; vuot: readonly ChinhSachVuotTranMoi[] }): string | null {
  if (p.vuot.length === 0) return null;
  const caoNhat = p.vuot.reduce((a, b) => (b.tongToiDa > a.tongToiDa ? b : a));
  const tong = microSangPhanTram(microLenTren(caoNhat.tongToiDa));
  const tran = microSangPhanTram(microGan(p.tranMoi));
  const ten = p.vuot
    .slice(0, 3)
    .map((v) => `${v.policyCode} (bản ${v.versionNo}): ${microSangPhanTram(microLenTren(v.tongToiDa))}%`)
    .join("; ");
  const them = p.vuot.length > 3 ? ` và ${p.vuot.length - 3} chính sách khác` : "";
  return `Không hạ trần xuống ${tran}% được: chính sách đang chạy có tổng tỉ lệ cao nhất ${tong}% — ${ten}${them}. Hạ dưới mức đó thì MỌI khoản thu mới của các chính sách này bị chặn «vượt trần» và không sinh dòng hoa hồng nào. Hướng xử lý: giữ trần tối thiểu ${tong}%, hoặc hạ tỉ lệ trong các chính sách trên (ở mục Chính sách hoa hồng) trước rồi mới hạ trần. Hệ thống không tự cắt tỉ lệ.`;
}
