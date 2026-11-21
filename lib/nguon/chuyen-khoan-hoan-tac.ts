/**
 * lib/nguon/chuyen-khoan-hoan-tac.ts — LÕI THUẦN của «HOÀN TÁC sau COMMIT» cho lệnh P7-B v2 (`chuyen-khoan-ghi-danh`). 27/10/2026.
 *
 * ── Vì sao có ───────────────────────────────────────────────────────────────────────────────────────────
 * Chủ hệ thống: «chưa có phương án hoàn tác sau COMMIT». Lệnh P7-B chỉ lùi được khi LỖI GIỮA CHỪNG (rollback transaction). Sau COMMIT thì không có đường quay lại ngoài sửa SQL tay — đúng thứ luật cứng #4 cấm.
 *
 * ── Hoàn tác làm gì ──────────────────────────────────────────────────────────────────────────────────────
 * Với MỖI cặp `cuId→moiId` do người ký chọn (KHÔNG tự chọn): đọc bản ghi lượt chạy P7-B gần nhất có cặp đó trong nhật ký (AuditLog `ChuyenKhoanGhiDanh`), rồi đưa đúng hai thứ về như trước lượt ấy:
 *   · `Payment.enrollmentId`: ghi danh mới → ghi danh cũ (đúng các khoản mà lượt ấy đã chuyển);
 *   · năm cột giá: ghi danh mới → NULL, ghi danh cũ → giá cũ (đúng giá nhật ký đã lưu).
 *
 * ── CHỈ khi trạng thái HIỆN TẠI đúng bằng trạng thái sau lượt ghi (đủ TẤT CẢ) ───────────────────────────────
 *   1. cặp có trong nhật ký một lượt ghi, và CHƯA bị hoàn tác kể từ lượt ấy;
 *   2. ghi danh cũ vẫn ĐÃ ĐÓNG, ghi danh mới vẫn CÒN HIỆU LỰC, cả hai chưa xoá mềm;
 *   3. giá ghi danh mới đúng bằng giá gói nhật ký đã ghi (năm cột), ghi danh cũ CẢ NĂM cột NULL — có ai sửa giá kể từ đó ⇒ dừng;
 *   4. tập khoản sống của ghi danh mới ĐÚNG BẰNG tập khoản lượt ấy đã chuyển (không thêm, không bớt), mỗi khoản vẫn `PAYMENT / RECORDED / CONFIRMED`, không điều chỉnh, Σ = tổng đã ghi; ghi danh cũ KHÔNG có khoản sống nào;
 *   5. ghi danh mới CHƯA có biên lai / hoa hồng / yêu cầu hoàn / bảo lưu (nếu đã có thì khoản đã "sống" ở ghi danh mới: kéo ngược sẽ tách biên lai khỏi khoản — dừng, để kế toán quyết).
 * Trượt bất kỳ điều kiện nào ⇒ DỪNG CẢ LÔ, không sửa nửa vời; không nới. Cổng ký RIÊNG (workflow `chuyen-khoan-ghi-danh-hoan-tac`), không dùng chung artifact với lệnh chuyển.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { shaDongWaveC } from "./wave-c-chung";
import { chuoiGiaWaveCB, type GiaGhiDanh } from "./wave-c-sua-gia-ghi-danh";
import { TRANG_THAI_GHI_DANH_DONG, cungGiaChuyen, laGiaTrong, type GhiDanhChuyen } from "./chuyen-khoan-ghi-danh";

export const KHUON_DONG_HOAN_TAC = "chuyen-khoan-hoan-tac/v1";
export const LY_DO_HOAN_TAC = "HOÀN TÁC P7-B v2: đưa khoản thu và giá gói về ghi danh cũ đúng như trước lượt chuyển (trạng thái hiện tại đã được kiểm đúng bằng trạng thái sau lượt chuyển)";
export const HANH_DONG_HOAN_TAC_KHOAN = "HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC";
export const HANH_DONG_HOAN_TAC_GIA = "HOAN_TAC_CHUYEN_GIA_SANG_GHI_DANH_DANG_HOC";
export const HANH_DONG_HOAN_TAC_LUOT = "HOAN_TAC_CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY";
export const ENTITY_LUOT_HOAN_TAC = "ChuyenKhoanGhiDanhHoanTac";

export type CapHoanTac = { cuId: string; moiId: string };

const RE_ID = /^[A-Za-z0-9_-]{8,40}$/;

/** `--cap=cuId:moiId[,cuId:moiId…]` — KHÔNG ngầm định. */
export function phanTichCapHoanTac(raw: string | null | undefined): { cap: CapHoanTac[] } | { loi: string } {
  if (raw === null || raw === undefined || raw.trim() === "") return { loi: "thiếu --cap=<cuId:moiId[,…]> — hoàn tác không tự chọn phạm vi." };
  const cap: CapHoanTac[] = [];
  for (const phan of raw.split(",").map((x) => x.trim())) {
    const t = phan.split(":");
    if (t.length !== 2 || !RE_ID.test(t[0]!) || !RE_ID.test(t[1]!) || t[0] === t[1]) return { loi: `cặp «${phan.slice(0, 60)}» sai khuôn — đúng: cuId:moiId.` };
    cap.push({ cuId: t[0]!, moiId: t[1]! });
  }
  if (new Set(cap.map((c) => c.cuId)).size !== cap.length || new Set(cap.map((c) => c.moiId)).size !== cap.length) return { loi: "--cap có ghi danh xuất hiện hai lần." };
  return { cap: cap.sort((a, b) => (a.cuId < b.cuId ? -1 : 1)) };
}

/** Một cặp trong nhật ký của MỘT lượt ghi P7-B (đúng thứ `ghiChuyenKhoanTrongTx` lưu). */
export type CapTrongNhatKy = {
  luotKhoa: string;
  cu: string;
  moi: string;
  khoan: readonly string[];
  tongTien: number;
  giaCu: GiaGhiDanh;
  giaMoi: GiaGhiDanh;
};

export type KhoanSongHoanTac = { id: string; amount: number; paymentType: string; saleStatus: string; accountantStatus: string; adjustmentOfId: string | null };

export type TrangThaiHoanTac = {
  cu: GhiDanhChuyen;
  moi: GhiDanhChuyen;
  khoanMoi: readonly KhoanSongHoanTac[];
  soKhoanSongCu: number;
  moiCo: { bienLai: number; hoaHong: number; hoanTien: number; baoLuu: number };
  /** Có bản ghi hoàn tác của cặp này MỚI HƠN lượt ghi đã chọn. */
  daHoanTac: boolean;
};

export type DongHoanTac = {
  cuId: string;
  moiId: string;
  khoanIds: readonly string[];
  tongTien: number;
  /** Giá hiện tại của ghi danh mới (= giá gói đã ghi) sẽ về NULL. */
  giaMoiHienTai: GiaGhiDanh;
  /** Giá sẽ khôi phục cho ghi danh cũ. */
  giaCuKhoiPhuc: GiaGhiDanh;
  luotKhoa: string;
};

export type LoiHoanTac = { cuId: string; ma: string; chiTiet: string };

export const MA_LOI_HOAN_TAC = {
  KHONG_CO_NHAT_KY_GHI: "KHONG_CO_NHAT_KY_GHI",
  DA_HOAN_TAC: "DA_HOAN_TAC",
  KHONG_DOC_DUOC_GHI_DANH: "KHONG_DOC_DUOC_GHI_DANH",
  TRANG_THAI_GHI_DANH_DOI: "TRANG_THAI_GHI_DANH_DOI",
  GIA_DA_BI_SUA: "GIA_DA_BI_SUA",
  TAP_KHOAN_DA_DOI: "TAP_KHOAN_DA_DOI",
  KHOAN_DA_DOI_TRANG_THAI: "KHOAN_DA_DOI_TRANG_THAI",
  GHI_DANH_MOI_DA_CO_CHUNG_TU: "GHI_DANH_MOI_DA_CO_CHUNG_TU",
  TRUNG_DICH: "TRUNG_DICH",
  TRUNG_NGUON: "TRUNG_NGUON",
} as const;

export function xetHoanTac(y: CapHoanTac, nhatKy: CapTrongNhatKy | null, tt: TrangThaiHoanTac | null): { dong: DongHoanTac } | { loi: LoiHoanTac } {
  const loi = (ma: string, chiTiet: string) => ({ loi: { cuId: y.cuId, ma, chiTiet } });
  if (nhatKy === null) return loi(MA_LOI_HOAN_TAC.KHONG_CO_NHAT_KY_GHI, "không có lượt ghi P7-B nào trong nhật ký chứa cặp này — không có gì để hoàn tác");
  if (tt === null) return loi(MA_LOI_HOAN_TAC.KHONG_DOC_DUOC_GHI_DANH, "không đọc được một trong hai ghi danh");
  if (tt.daHoanTac) return loi(MA_LOI_HOAN_TAC.DA_HOAN_TAC, "cặp này đã được hoàn tác kể từ lượt ghi gần nhất");
  // 2
  if (!(TRANG_THAI_GHI_DANH_DONG as readonly string[]).includes(tt.cu.status) || tt.cu.deletedAt !== null) return loi(MA_LOI_HOAN_TAC.TRANG_THAI_GHI_DANH_DOI, `ghi danh cũ không còn ở trạng thái đóng («${tt.cu.status}»)`);
  if ((TRANG_THAI_GHI_DANH_DONG as readonly string[]).includes(tt.moi.status) || tt.moi.deletedAt !== null) return loi(MA_LOI_HOAN_TAC.TRANG_THAI_GHI_DANH_DOI, `ghi danh mới không còn hiệu lực («${tt.moi.status}»)`);
  // 3
  if (!cungGiaChuyen(tt.moi.gia, nhatKy.giaMoi)) return loi(MA_LOI_HOAN_TAC.GIA_DA_BI_SUA, `giá ghi danh mới (${chuoiGiaWaveCB(tt.moi.gia)}) ≠ giá gói lượt ghi đã đặt (${chuoiGiaWaveCB(nhatKy.giaMoi)}) — có người sửa sau lượt ghi`);
  if (!laGiaTrong(tt.cu.gia)) return loi(MA_LOI_HOAN_TAC.GIA_DA_BI_SUA, `ghi danh cũ không còn trống giá (${chuoiGiaWaveCB(tt.cu.gia)})`);
  // 4
  const dangCo = new Set(tt.khoanMoi.map((k) => k.id));
  const daChuyen = new Set(nhatKy.khoan);
  if (dangCo.size !== daChuyen.size || [...daChuyen].some((id) => !dangCo.has(id)) || tt.soKhoanSongCu > 0) {
    return loi(MA_LOI_HOAN_TAC.TAP_KHOAN_DA_DOI, `tập khoản sống của ghi danh mới (${dangCo.size}) ≠ tập lượt ghi đã chuyển (${daChuyen.size}) hoặc ghi danh cũ lại có ${tt.soKhoanSongCu} khoản — có phiên khác thêm/bớt khoản`);
  }
  const xau = tt.khoanMoi.filter((k) => k.paymentType !== "PAYMENT" || k.saleStatus !== "RECORDED" || k.accountantStatus !== "CONFIRMED" || k.adjustmentOfId !== null);
  if (xau.length > 0) return loi(MA_LOI_HOAN_TAC.KHOAN_DA_DOI_TRANG_THAI, `${xau.length} khoản không còn PAYMENT/RECORDED/CONFIRMED hoặc đã thành bút toán điều chỉnh`);
  const tong = tt.khoanMoi.reduce((s, k) => s + k.amount, 0);
  if (tong !== nhatKy.tongTien) return loi(MA_LOI_HOAN_TAC.KHOAN_DA_DOI_TRANG_THAI, `Σ khoản ${tong} ≠ tổng lượt ghi đã chuyển ${nhatKy.tongTien}`);
  // 5
  const c = tt.moiCo;
  if (c.bienLai + c.hoaHong + c.hoanTien + c.baoLuu > 0) {
    return loi(MA_LOI_HOAN_TAC.GHI_DANH_MOI_DA_CO_CHUNG_TU, `ghi danh mới đã có ${c.bienLai} biên lai · ${c.hoaHong} dòng hoa hồng · ${c.hoanTien} yêu cầu hoàn · ${c.baoLuu} bảo lưu kể từ lượt ghi — kế toán quyết, lệnh không tự kéo ngược`);
  }
  return {
    dong: {
      cuId: y.cuId,
      moiId: y.moiId,
      khoanIds: [...nhatKy.khoan].sort(),
      tongTien: tong,
      giaMoiHienTai: tt.moi.gia,
      giaCuKhoiPhuc: nhatKy.giaCu,
      luotKhoa: nhatKy.luotKhoa,
    },
  };
}

export function dongDauRaHoanTac(ghi: readonly DongHoanTac[]): string[] {
  return ghi.map((g) => [KHUON_DONG_HOAN_TAC, g.cuId, g.moiId, g.khoanIds.join(","), String(g.tongTien), chuoiGiaWaveCB(g.giaMoiHienTai), chuoiGiaWaveCB(g.giaCuKhoiPhuc), g.luotKhoa].join("|"));
}

export type KeHoachHoanTac = { ghi: readonly DongHoanTac[]; loiLo: readonly LoiHoanTac[]; dung: boolean; dongDauRa: readonly string[]; sha: string };

export function lapKeHoachHoanTac(
  cap: readonly CapHoanTac[],
  nhatKy: ReadonlyMap<string, CapTrongNhatKy>,
  trangThai: ReadonlyMap<string, TrangThaiHoanTac>,
): KeHoachHoanTac {
  const ghi: DongHoanTac[] = [];
  const loiLo: LoiHoanTac[] = [];
  for (const y of [...cap].sort((a, b) => (a.cuId < b.cuId ? -1 : 1))) {
    const r = xetHoanTac(y, nhatKy.get(`${y.cuId}>${y.moiId}`) ?? null, trangThai.get(y.cuId) ?? null);
    if ("loi" in r) loiLo.push(r.loi);
    else ghi.push(r.dong);
  }
  const lap = (k: (g: DongHoanTac) => string, ma: string) => {
    const m = new Map<string, DongHoanTac[]>();
    for (const g of ghi) m.set(k(g), [...(m.get(k(g)) ?? []), g]);
    for (const [id, v] of m) if (v.length > 1) loiLo.push({ cuId: v.map((g) => g.cuId).join(","), ma, chiTiet: `${id} xuất hiện ${v.length} lần` });
  };
  lap((g) => g.moiId, MA_LOI_HOAN_TAC.TRUNG_DICH);
  lap((g) => g.cuId, MA_LOI_HOAN_TAC.TRUNG_NGUON);
  const dung = loiLo.length > 0;
  const ra = dung ? [] : ghi;
  const dongDauRa = dongDauRaHoanTac(ra);
  return { ghi: ra, loiLo, dung, dongDauRa, sha: shaDongWaveC(dongDauRa) };
}
