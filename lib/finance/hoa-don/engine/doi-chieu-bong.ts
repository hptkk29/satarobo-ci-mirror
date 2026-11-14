// lib/finance/hoa-don/engine/doi-chieu-bong.ts — ĐỐI CHIẾU BÓNG: nghĩa vụ hoá đơn do engine dẫn xuất ↔ hàng chờ hoá đơn
// đang sống (`dungDongHangCho`). THUẦN: chỉ NHẬN kết quả của hai bên, không tự chạy `dungDongHangCho` (nó kéo theo
// `@/lib/utils`, POS, cổng env pháp nhân — engine giữ sạch; người gọi/ test chạy nó rồi đưa kết quả vào).
//
// Mục tiêu của lát S3: trên fixture hình dạng thật, engine và hàng chờ nói CÙNG MỘT chuyện về từng khoản thu trước khi
// ai đó dám nối engine vào luồng. Đơn vị so sánh là KHOẢN (`Payment`) — dòng hàng chờ là "lần thu" gom nhiều khoản,
// nên so qua `DongHangCho.khoan[]` (số RÒNG từng khoản) và bảng `NGAN_SANG_TRANG_THAI` (ngăn → trạng thái).
//
// ─────────────────────────────────────────────────────────────────────────────
// BA LOẠI KẾT QUẢ — đừng gộp
//
//   · `chenhLech`     — KHÔNG giải thích được. Mỗi dòng ở đây là một câu hỏi cho người viết engine.
//   · `khacCoChuDich` — KHÔNG THỂ trùng và đã được audit 02 §9 chủ ý: engine siết hơn hàng chờ (tiền thừa · loại khoản
//     mơ hồ · thu trước chờ quyết), hoặc hàng chờ có nhãn mà engine biểu diễn bằng nghĩa vụ riêng (điều chỉnh giảm).
//     Ghi rõ MÃ LÝ DO — không ép khớp, không giấu.
//   · `trungHoanToan` = cả hai danh sách rỗng.
//
// Thêm ngăn mới cho hàng chờ mà quên cho nó một trạng thái ⇒ `Record<NganHangCho, …>` đỏ ở `tsc` (không câm).

import type { DongHangCho, NganHangCho } from "../dong-hang-cho";
import type { KetQuaPhanLoai, LyDoChoQuyet, NghiaVu, TrangThaiNghiaVu } from "./phan-loai-nghia-vu";

/** Ngăn hàng chờ → trạng thái nghĩa vụ TƯƠNG ĐƯƠNG. Đây là phát biểu "hai bên nói cùng một chuyện". */
export const NGAN_SANG_TRANG_THAI: Record<NganHangCho, TrangThaiNghiaVu> = {
  cho: "CHO_XUAT",
  lech: "CHO_QUYET",
  "don-huy": "CHO_QUYET",
  nhap: "DANG_XU_LY",
  "phat-hanh": "DANG_XU_LY",
  "da-xuat": "DA_XUAT",
  "can-dieu-chinh": "DA_XUAT",
  "khong-xuat": "KHONG_XUAT",
};

/** Lý do chờ-quyết mà engine SIẾT HƠN hàng chờ có chủ ý: hàng chờ vẫn cho "Chờ xuất" ở ngăn `cho`. */
const LY_DO_ENGINE_SIET_HON: ReadonlySet<LyDoChoQuyet> = new Set<LyDoChoQuyet>(["TIEN_THUA", "LOAI_KHOAN_MO_HO", "THU_TRUOC_CHO_QUYET"]);

export type LoaiChenhLech =
  | "THIEU_O_NGHIA_VU"
  | "THUA_O_NGHIA_VU"
  | "KHAC_SO_TIEN"
  | "KHAC_TRANG_THAI"
  | "KHAC_THIEU_CO_SO"
  | "DIEU_CHINH_KHONG_CO_CO";

export type ChenhLech = { loai: LoaiChenhLech; khoa: string; thongDiep: string };

export type MaKhacCoChuDich =
  | "ENGINE_SIET_HON"
  | "DIEU_CHINH_GIAM_KHONG_CO_DONG_RIENG"
  | "CAN_DIEU_CHINH_NGUYEN_NHAN_KHAC";

export type KhacCoChuDich = { ma: MaKhacCoChuDich; khoa: string; lyDo: string; thongDiep: string };

export type BaoCaoDoiChieu = {
  trungHoanToan: boolean;
  /** Số khoản có mặt ở cả hai bên và khớp số tiền + trạng thái. */
  soKhop: number;
  soKhoanHangCho: number;
  soNghiaVuKhoanThu: number;
  /** Nghĩa vụ `BILLING:` — hàng chờ không có khái niệm này nên KHÔNG so (đếm để báo, không phải chênh lệch). */
  soNghiaVuTheoDong: number;
  chenhLech: ChenhLech[];
  khacCoChuDich: KhacCoChuDich[];
  canhBao: string[];
};

type HangChoKhoan = { soTien: number; ngan: NganHangCho; keyDong: string; mong: TrangThaiNghiaVu };

/**
 * Trạng thái nghĩa vụ mà một dòng hàng chờ NÓI. Ngăn "Cần điều chỉnh" là NHÃN phủ lên hoá đơn đã chốt, không phải một
 * trạng thái: nó gồm cả tờ ĐÃ XÁC NHẬN lẫn tờ KHONG_XUAT mang lý do "Đã xuất ngoài hệ thống" (`canDieuChinh`, nhánh
 * `xuatNgoai`) — khoản của tờ sau vẫn là KHONG_XUAT. Ánh xạ một-một theo ngăn sẽ báo oan ca này.
 */
function trangThaiMongDoi(d: DongHangCho): TrangThaiNghiaVu {
  if (d.ngan === "can-dieu-chinh" && d.hoaDon?.trangThai === "KHONG_XUAT") return "KHONG_XUAT";
  return NGAN_SANG_TRANG_THAI[d.ngan];
}

export function doiChieuBong(input: {
  engine: KetQuaPhanLoai;
  hangCho: { dong: readonly DongHangCho[]; thieuCoSo: number };
}): BaoCaoDoiChieu {
  const chenhLech: ChenhLech[] = [];
  const khacCoChuDich: KhacCoChuDich[] = [];
  const canhBao: string[] = [];

  // ── Bên hàng chờ: khoản → ngăn.
  const hangCho = new Map<string, HangChoKhoan>();
  for (const d of input.hangCho.dong) {
    for (const k of d.khoan) {
      if (hangCho.has(k.id)) {
        canhBao.push(`Khoản ${k.id} xuất hiện ở hơn một dòng hàng chờ (${hangCho.get(k.id)!.keyDong}, ${d.key}) — giữ dòng đầu.`);
        continue;
      }
      hangCho.set(k.id, { soTien: k.soTien, ngan: d.ngan, keyDong: d.key, mong: trangThaiMongDoi(d) });
    }
  }

  // ── Bên engine: khoản thu (PAYMENT, không phải điều chỉnh) · điều chỉnh giảm · theo dòng.
  const khoanThu = new Map<string, NghiaVu>();
  const dieuChinh: NghiaVu[] = [];
  let soTheoDong = 0;
  for (const n of input.engine.nghiaVu) {
    if (n.nguon.loai === "BILLING") {
      soTheoDong += 1;
      continue;
    }
    if (n.loai === "DIEU_CHINH_GIAM") dieuChinh.push(n);
    else khoanThu.set(n.nguon.paymentId, n);
  }
  const khongSinhCua = new Map(input.engine.khongSinh.map((k) => [k.paymentId, k.lyDo]));

  // Các dòng điều chỉnh giảm tham chiếu khoản gốc nào — để biết ngăn `can-dieu-chinh` nào đã có nghĩa vụ giải thích.
  const gocCoDieuChinh = new Set(dieuChinh.map((n) => n.khoanGocId).filter((x): x is string => x != null));

  let soKhop = 0;
  const tatCa = new Set([...hangCho.keys(), ...khoanThu.keys()]);
  for (const id of [...tatCa].sort()) {
    const h = hangCho.get(id);
    const n = khoanThu.get(id);
    if (h && !n) {
      const ly = khongSinhCua.get(id);
      chenhLech.push({
        loai: "THIEU_O_NGHIA_VU",
        khoa: `PAYMENT:${id}`,
        thongDiep: `Hàng chờ có khoản ${id} (${h.soTien}đ, ngăn ${h.ngan}) mà engine không sinh nghĩa vụ${ly ? ` — engine xếp nó vào "không sinh": ${ly}` : ""}.`,
      });
      continue;
    }
    if (!h && n) {
      chenhLech.push({
        loai: "THUA_O_NGHIA_VU",
        khoa: n.khoa,
        thongDiep: `Engine sinh nghĩa vụ ${n.khoa} (${n.soTien}đ, ${n.trangThai}) mà hàng chờ không có khoản này.`,
      });
      continue;
    }
    if (!h || !n) continue;
    if (h.soTien !== n.soTien) {
      chenhLech.push({ loai: "KHAC_SO_TIEN", khoa: n.khoa, thongDiep: `Số tiền khác nhau: hàng chờ ${h.soTien}đ · engine ${n.soTien}đ.` });
      continue;
    }
    const mong = h.mong;
    if (n.trangThai === mong) {
      soKhop += 1;
      continue;
    }
    if (n.trangThai === "CHO_QUYET" && h.ngan === "cho" && n.lyDoChoQuyet != null && LY_DO_ENGINE_SIET_HON.has(n.lyDoChoQuyet)) {
      khacCoChuDich.push({
        ma: "ENGINE_SIET_HON",
        khoa: n.khoa,
        lyDo: n.lyDoChoQuyet,
        thongDiep: `Hàng chờ cho xuất (ngăn cho) nhưng engine để chờ người quyết vì ${n.lyDoChoQuyet} (audit 02 §9.1).`,
      });
      continue;
    }
    chenhLech.push({
      loai: "KHAC_TRANG_THAI",
      khoa: n.khoa,
      thongDiep: `Trạng thái khác nhau: hàng chờ ngăn "${h.ngan}" (⇒ ${mong}) · engine ${n.trangThai}${n.lyDoChoQuyet ? ` (${n.lyDoChoQuyet})` : ""}.`,
    });
  }

  // ── Điều chỉnh giảm: hàng chờ KHÔNG có dòng riêng, chỉ bật ngăn "can-dieu-chinh" trên dòng của khoản gốc.
  for (const n of dieuChinh) {
    const goc = n.khoanGocId ? hangCho.get(n.khoanGocId) : undefined;
    if (!goc || goc.ngan !== "can-dieu-chinh") {
      chenhLech.push({
        loai: "DIEU_CHINH_KHONG_CO_CO",
        khoa: n.khoa,
        thongDiep: `Engine có điều chỉnh giảm ${n.soTien}đ trên khoản gốc ${n.khoanGocId ?? "?"} nhưng hàng chờ ${goc ? `để nó ở ngăn "${goc.ngan}"` : "không có khoản gốc đó"} chứ không phải "can-dieu-chinh".`,
      });
    } else {
      khacCoChuDich.push({
        ma: "DIEU_CHINH_GIAM_KHONG_CO_DONG_RIENG",
        khoa: n.khoa,
        lyDo: "DIEU_CHINH_CHUA_CHOT",
        thongDiep: "Hàng chờ biểu diễn điều chỉnh giảm bằng NHÃN 'Cần điều chỉnh' trên dòng khoản gốc; engine biểu diễn bằng nghĩa vụ riêng.",
      });
    }
  }

  // ── Ngăn "can-dieu-chinh" mà engine không sinh nghĩa vụ điều chỉnh nào cho các khoản của nó: hàng chờ còn các nguyên
  //    nhân khác (yêu cầu hoàn đã duyệt chưa chi · đơn huỷ sau xuất · tổng ròng đổi · "đã xuất ngoài hệ thống").
  const daBaoDong = new Set<string>();
  for (const d of input.hangCho.dong) {
    if (d.ngan !== "can-dieu-chinh" || daBaoDong.has(d.key)) continue;
    daBaoDong.add(d.key);
    if (d.khoanIds.some((id) => gocCoDieuChinh.has(id))) continue;
    khacCoChuDich.push({
      ma: "CAN_DIEU_CHINH_NGUYEN_NHAN_KHAC",
      khoa: d.key,
      lyDo: d.canDieuChinh.join("; "),
      thongDiep: `Dòng ${d.key} ở ngăn "Cần điều chỉnh" vì lý do engine chưa sinh nghĩa vụ điều chỉnh: ${d.canDieuChinh.join("; ") || "(không ghi)"}.`,
    });
  }

  // ── Khoản thiếu cơ sở.
  const engineThieuCoSo = input.engine.khongSinh.filter((k) => k.lyDo === "THIEU_CO_SO").length;
  if (engineThieuCoSo !== input.hangCho.thieuCoSo) {
    chenhLech.push({
      loai: "KHAC_THIEU_CO_SO",
      khoa: "THIEU_CO_SO",
      thongDiep: `Số khoản thiếu cơ sở khác nhau: hàng chờ ${input.hangCho.thieuCoSo} · engine ${engineThieuCoSo}.`,
    });
  }

  chenhLech.sort((a, b) => a.loai.localeCompare(b.loai) || a.khoa.localeCompare(b.khoa));
  khacCoChuDich.sort((a, b) => a.ma.localeCompare(b.ma) || a.khoa.localeCompare(b.khoa));
  return {
    trungHoanToan: chenhLech.length === 0 && khacCoChuDich.length === 0,
    soKhop,
    soKhoanHangCho: hangCho.size,
    soNghiaVuKhoanThu: khoanThu.size,
    soNghiaVuTheoDong: soTheoDong,
    chenhLech,
    khacCoChuDich,
    canhBao,
  };
}
