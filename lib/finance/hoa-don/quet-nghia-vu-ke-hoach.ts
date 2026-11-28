// lib/finance/hoa-don/quet-nghia-vu-ke-hoach.ts — BỘ LẬP KẾ HOẠCH của scanner bóng nghĩa vụ hoá đơn (Invoice Hub S8). THUẦN: không Prisma,
// không DB, không env, không đồng hồ (mốc giờ là tham số). Người chạy DB (`quet-nghia-vu-db.ts`) nạp dữ liệu, gọi hàm này, rồi ghi đúng thứ
// kế hoạch nói — và chỉ thế.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN LUẬT KHÔNG THƯƠNG LƯỢNG
//
//   1. IDEMPOTENT. Kế hoạch là hàm của (kết quả engine, dòng bảng chiếu đang có, ngoại lệ đang mở): áp nó rồi lập lại thì không còn gì
//      tạo / sửa / mở thêm. Khoá nguồn `(nguonLoai, nguonId)` quyết định "đã có dòng chưa", băm nguồn quyết định "có đổi không".
//   2. KHÔNG SỬA nghĩa vụ đã gắn hoá đơn về số tiền / băm / loại (ERD-01: điều chỉnh, thay thế = nghĩa vụ MỚI trỏ về cũ). Trạng thái thì vẫn
//      được CHIẾU theo hoá đơn (DANG_XU_LY → DA_XUAT; hoá đơn bị thay thế ⇒ khoản nhả về CHO_XUAT, ADR §7.4) — đó là bản chiếu, không
//      phải sửa hoá đơn.
//   3. KHÔNG ĐOÁN. Thiếu ngày thu ⇒ không tạo dòng. Engine nói CHO_QUYET mà không kèm lý do ⇒ ném (CHECK của DB cấm dòng đó). Dữ liệu
//      của đơn khác / cơ sở khác lọt vào ⇒ ném (không bao giờ ghi chéo).
//   4. CHỈ THÊM. Ngoại lệ là hàng đợi người xử lý, đặt CẠNH các cờ suy ra hiện có (2-phase): kế hoạch không thay hay gỡ cờ nào của hàng chờ.
//
// Hub không ghi sổ tiền: file này không nhắc bảng tiền nào, và không có đường nào đọc bảng chiếu để tính nợ (TD-02).

import type { BaoCaoDoiChieu } from "./engine/doi-chieu-bong";
import type { KetQuaPhanLoai, LoaiNghiaVu, LyDoChoQuyet, TrangThaiNghiaVu } from "./engine/phan-loai-nghia-vu";

// ── KIỂU ──────────────────────────────────────────────────────────────────

/** Lý do chờ-quyết GHI vào bảng chiếu: các lý do của engine + một lý do chỉ scanner biết (khoản thu ở cơ sở khác với đơn). Cột là chuỗi mềm. */
export type LyDoCho = LyDoChoQuyet | "KHOAN_KHAC_CO_SO" | "NGUON_MAT";

export type TrangThaiBangChieu = TrangThaiNghiaVu | "MAT_NGUON";

export type MucNgoaiLe = "THONG_TIN" | "CAN_XU_LY" | "KHAN";

/**
 * Loại ngoại lệ do SCANNER sinh ra — và cũng là tập scanner được TỰ ĐÓNG khi hết điều kiện. MỘT danh sách cho cả hai việc: sinh mà không
 * đóng được là ngoại lệ ma; đóng loại mình không sinh là xoá việc của người khác. `[QNK-09]` ghim hai danh sách trùng nhau.
 * Các loại còn lại của danh mục (THIEU_NGUOI_MUA · THIEU_MAPPING_THUE · CHINH_SACH_… · KHONG_RO_QUA_HAN · TU_CHOI_NHA_CUNG_CAP · LECH_DAY_SO)
 * thuộc các lát sau (cần chính sách có hiệu lực / nhà cung cấp) — scanner S8 không sinh và không đụng.
 */
export const LOAI_NGOAI_LE_CUA_SCANNER = [
  "NGHI_TRUNG",
  "TIEN_THUA",
  "COC_CHUA_PHAN_LOAI",
  "LOAI_KHOAN_MO_HO",
  "HOAN_TIEN_SAU_XUAT",
  "PHAP_NHAN_KHAC_NOI_NHAN_TIEN",
  "NGUON_MAT",
  "LECH_SHADOW",
] as const;
export type LoaiNgoaiLeScanner = (typeof LOAI_NGOAI_LE_CUA_SCANNER)[number];

/** Dòng bảng chiếu đang có của MỘT đơn (người chạy DB đọc, rút gọn đúng cột kế hoạch cần). */
export type HienCoNghiaVu = {
  id: string;
  nguonLoai: "PAYMENT" | "BILLING";
  nguonId: string;
  loai: LoaiNghiaVu;
  trangThai: TrangThaiBangChieu;
  lyDoCho: string | null;
  hoaDonId: string | null;
  orderItemId: string | null;
  sourceHash: string;
  soTienSnapshot: number;
  phienBan: number;
  centerId: string;
};

/** Ngoại lệ đang MỞ / ĐANG XỬ LÝ của MỘT đơn (đã có dedupeKey). */
export type NgoaiLeDangMo = { id: string; dedupeKey: string; trangThai: "MO" | "DANG_XU_LY"; loai: string };

export type DauVaoKeHoach = {
  orderId: string;
  /** `Order.centerId`. Null ⇒ không ghi được gì (cột `centerId` của hai bảng là NOT NULL). */
  centerId: string | null;
  /** BẮT BUỘC (luật 7): quên là dòng `BILLING:*` lặng lẽ bị coi nhầm là mất nguồn. */
  cheDo: "THEO_KHOAN_THU" | "THEO_KHOAN_THU_VA_DONG_DON";
  /** Mốc giờ của lượt chạy — kế hoạch KHÔNG đọc đồng hồ. */
  now: Date;
  engine: KetQuaPhanLoai;
  baoCao: BaoCaoDoiChieu;
  /** paymentId → `YYYY-MM-DD` (ngày thu, lịch VN). Thiếu ⇒ không tạo dòng của khoản đó. */
  ngayThu: ReadonlyMap<string, string>;
  /** Khoản mà `Payment.centerId` KHÁC `Order.centerId` (khác null) — chỉ người chạy DB biết (engine không có khái niệm này). */
  khoanKhacCoSo: ReadonlySet<string>;
  hienCo: readonly HienCoNghiaVu[];
  ngoaiLeMo: readonly NgoaiLeDangMo[];
  /**
   * `dedupeKey` của ngoại lệ đã được kế toán BỎ QUA có lý do (`BO_QUA_CO_LY_DO`). BẮT BUỘC (luật 7): quên truyền là "bỏ qua" lặng lẽ không có tác dụng —
   * nguyên nhân còn thì lượt sau mở lại đúng ngoại lệ vừa bỏ qua. Chỉ chặn ĐÚNG khoá đó; loại khác của cùng khoản vẫn mở. Ngoại lệ ĐÃ XỬ LÝ (`DA_XU_LY`)
   * thì KHÔNG nằm ở đây: nguyên nhân còn ⇒ mở lại là đúng (người ta tưởng đã xong mà chưa).
   */
  ngoaiLeBoQua: ReadonlySet<string>;
};

export type NghiaVuTao = {
  khoa: string;
  nguonLoai: "PAYMENT" | "BILLING";
  nguonId: string;
  loai: LoaiNghiaVu;
  centerId: string;
  orderId: string;
  orderItemId: string | null;
  trangThai: TrangThaiBangChieu;
  lyDoCho: string | null;
  /** `YYYY-MM-DD`. */
  ngayPhatSinh: string;
  /** Khoá nguồn của khoản GỐC (điều chỉnh giảm) — người chạy DB đổi sang id dòng sau khi tạo / tra. */
  nghiaVuGocKhoa: string | null;
  hoaDonId: string | null;
  soTienSnapshot: number;
  sourceHash: string;
};

export type DuLieuCapNhat = Partial<{
  loai: LoaiNghiaVu;
  trangThai: TrangThaiBangChieu;
  lyDoCho: string | null;
  hoaDonId: string | null;
  orderItemId: string | null;
  soTienSnapshot: number;
  sourceHash: string;
}>;

export type NghiaVuCapNhat = { id: string; khoa: string; phienBanCu: number; data: DuLieuCapNhat };

export type NgoaiLeTao = {
  dedupeKey: string;
  loai: LoaiNgoaiLeScanner;
  muc: MucNgoaiLe;
  centerId: string;
  orderId: string;
  /** Khoá nguồn của nghĩa vụ liên quan (null = ngoại lệ cấp đơn). Người chạy DB tra ra `nghiaVuId`. */
  nghiaVuKhoa: string | null;
  hoaDonId: string | null;
};

export type KeHoachDon = {
  /** `THIEU_CO_SO` = đơn không có cơ sở ⇒ kế hoạch rỗng. */
  boQua: "THIEU_CO_SO" | null;
  tao: NghiaVuTao[];
  capNhat: NghiaVuCapNhat[];
  /** Dòng đã khớp và KHÔNG đổi — chỉ để cập nhật nhịp tim `quetLanCuoiLuc` (một câu cho cả lô). */
  giu: string[];
  /** Nghĩa vụ không tạo được và vì sao (không đoán). */
  khongTao: { khoa: string; lyDo: "THIEU_NGAY_THU" }[];
  ngoaiLeTao: NgoaiLeTao[];
  ngoaiLeDong: { id: string }[];
};

// ── ÁNH XẠ LÝ DO → NGOẠI LỆ ───────────────────────────────────────────────

/**
 * Lý do chờ-quyết → ngoại lệ. Lý do VẮNG khỏi bảng (LAN_THU_THIEU · DOT_DA_HUY · DON_DA_HUY · LAP_THEO_DONG_CHUA_CHOT) KHÔNG sinh ngoại lệ:
 * hàng chờ đã có ngăn riêng cho chúng ("lệch" / "đơn huỷ"), thêm ngoại lệ là nhắc đôi cho cùng một việc; chúng vẫn nằm trong bảng chiếu.
 */
const NGOAI_LE_THEO_LY_DO: ReadonlyMap<string, { loai: LoaiNgoaiLeScanner; muc: MucNgoaiLe }> = new Map([
  ["NGHI_TRUNG", { loai: "NGHI_TRUNG", muc: "CAN_XU_LY" }],
  ["TIEN_THUA", { loai: "TIEN_THUA", muc: "CAN_XU_LY" }],
  ["THU_TRUOC_CHO_QUYET", { loai: "COC_CHUA_PHAN_LOAI", muc: "CAN_XU_LY" }],
  ["LOAI_KHOAN_MO_HO", { loai: "LOAI_KHOAN_MO_HO", muc: "CAN_XU_LY" }],
  // Hoá đơn khách ĐANG GIỮ đã lệch với sổ tiền (hoàn / đảo sau xuất) — việc có hạn luật định, nên KHẨN.
  ["DIEU_CHINH_CHUA_CHOT", { loai: "HOAN_TIEN_SAU_XUAT", muc: "KHAN" }],
  ["KHOAN_KHAC_CO_SO", { loai: "PHAP_NHAN_KHAC_NOI_NHAN_TIEN", muc: "CAN_XU_LY" }],
]);

/** Trạng thái "đã dính tới hoá đơn" — dòng ở đây KHÔNG bị đánh MAT_NGUON âm thầm; nguồn mất ⇒ ngoại lệ KHẨN, không sửa dòng. */
const TRANG_THAI_DA_CO_HOA_DON: ReadonlySet<TrangThaiBangChieu> = new Set(["DANG_XU_LY", "DA_XUAT", "KHONG_XUAT"]);

const khoaCua = (nguonLoai: string, nguonId: string) => `${nguonLoai}:${nguonId}`;

const soSanh = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── KẾ HOẠCH ──────────────────────────────────────────────────────────────

export function lapKeHoachDon(vao: DauVaoKeHoach): KeHoachDon {
  const rong: KeHoachDon = { boQua: null, tao: [], capNhat: [], giu: [], khongTao: [], ngoaiLeTao: [], ngoaiLeDong: [] };
  if (!vao.centerId) return { ...rong, boQua: "THIEU_CO_SO" };
  const centerId = vao.centerId;

  // ── Kiểm đầu vào TRƯỚC mọi việc: một dòng sai đơn / sai cơ sở thì cả kế hoạch hỏng, không ghi nửa chừng.
  for (const n of vao.engine.nghiaVu) {
    if (n.orderId !== vao.orderId) throw new Error(`Nghĩa vụ ${n.khoa} thuộc đơn khác (${n.orderId}) — không lập kế hoạch cho đơn ${vao.orderId}.`);
    if (n.centerId !== centerId) throw new Error(`Nghĩa vụ ${n.khoa} mang cơ sở ${n.centerId}, đơn thuộc cơ sở ${centerId} — không ghi chéo cơ sở.`);
  }
  for (const e of vao.hienCo) {
    if (e.centerId !== centerId) throw new Error(`Dòng bảng chiếu ${e.id} thuộc cơ sở ${e.centerId}, đơn thuộc cơ sở ${centerId} — không sửa chéo cơ sở.`);
  }

  const hienCoTheoKhoa = new Map(vao.hienCo.map((e) => [khoaCua(e.nguonLoai, e.nguonId), e] as const));
  const tao: NghiaVuTao[] = [];
  const capNhat: NghiaVuCapNhat[] = [];
  const giu: string[] = [];
  const khongTao: KeHoachDon["khongTao"] = [];
  const mong = new Map<string, NgoaiLeTao>();
  const doiNgoaiLe = (n: NgoaiLeTao) => {
    if (!mong.has(n.dedupeKey)) mong.set(n.dedupeKey, n);
  };

  const khoaDaCo = new Set<string>();
  for (const n of vao.engine.nghiaVu) {
    khoaDaCo.add(n.khoa);
    const nguonId = n.nguon.loai === "PAYMENT" ? n.nguon.paymentId : n.nguon.orderItemId;

    // Khoản thu ở cơ sở khác với đơn: scanner KHÔNG đề xuất (ADR §2.1) — việc đang chờ xuất thì chuyển sang chờ người quyết.
    const khacCoSo = n.nguon.loai === "PAYMENT" && vao.khoanKhacCoSo.has(n.nguon.paymentId);
    let trangThai: TrangThaiBangChieu = n.trangThai;
    let lyDoCho: string | null = n.trangThai === "CHO_QUYET" ? n.lyDoChoQuyet : null;
    if (khacCoSo && n.trangThai === "CHO_XUAT") {
      trangThai = "CHO_QUYET";
      lyDoCho = "KHOAN_KHAC_CO_SO";
    }
    if (trangThai === "CHO_QUYET" && (lyDoCho == null || lyDoCho.trim() === "")) {
      throw new Error(`Nghĩa vụ ${n.khoa} ở CHO_QUYET mà không có lý do — DB sẽ từ chối dòng này (HoaDonNghiaVu_cho_quyet_ly_do_check).`);
    }

    // Ngoại lệ: lý do chờ-quyết của chính dòng; thêm ngoại lệ pháp nhân khi khoản thu ở cơ sở khác và việc còn chờ (đã xuất rồi thì không còn gì để làm).
    const ngoaiLeLyDo = lyDoCho ? NGOAI_LE_THEO_LY_DO.get(lyDoCho) : undefined;
    const vienDan = { centerId, orderId: vao.orderId, nghiaVuKhoa: n.khoa, hoaDonId: n.hoaDonId };
    if (trangThai === "CHO_QUYET" && ngoaiLeLyDo) {
      doiNgoaiLe({ dedupeKey: `${ngoaiLeLyDo.loai}:${n.khoa}`, loai: ngoaiLeLyDo.loai, muc: ngoaiLeLyDo.muc, ...vienDan });
    }
    if (khacCoSo && (n.trangThai === "CHO_XUAT" || n.trangThai === "CHO_QUYET")) {
      const nl = NGOAI_LE_THEO_LY_DO.get("KHOAN_KHAC_CO_SO")!;
      doiNgoaiLe({ dedupeKey: `${nl.loai}:${n.khoa}`, loai: nl.loai, muc: nl.muc, ...vienDan });
    }

    const e = hienCoTheoKhoa.get(n.khoa);
    if (!e) {
      const ngay = n.nguon.loai === "PAYMENT" ? vao.ngayThu.get(n.nguon.paymentId) : undefined;
      if (!ngay) {
        khongTao.push({ khoa: n.khoa, lyDo: "THIEU_NGAY_THU" });
        continue;
      }
      tao.push({
        khoa: n.khoa,
        nguonLoai: n.nguon.loai,
        nguonId,
        loai: n.loai,
        centerId,
        orderId: vao.orderId,
        orderItemId: n.orderItemId,
        trangThai,
        lyDoCho,
        ngayPhatSinh: ngay,
        nghiaVuGocKhoa: n.khoanGocId ? khoaCua("PAYMENT", n.khoanGocId) : null,
        hoaDonId: n.hoaDonId,
        soTienSnapshot: n.soTien,
        sourceHash: n.sourceHash,
      });
      continue;
    }

    // Dòng đã gắn hoá đơn VÀ vẫn cùng hoá đơn đó: chỉ chiếu trạng thái, không đụng số tiền / băm / loại (luật 2).
    const giuAnhChup = e.hoaDonId != null && n.hoaDonId === e.hoaDonId;
    const data: DuLieuCapNhat = {};
    if (!giuAnhChup) {
      if (e.loai !== n.loai) data.loai = n.loai;
      if (e.hoaDonId !== n.hoaDonId) data.hoaDonId = n.hoaDonId;
      if (e.orderItemId !== n.orderItemId) data.orderItemId = n.orderItemId;
      if (e.soTienSnapshot !== n.soTien) data.soTienSnapshot = n.soTien;
      if (e.sourceHash !== n.sourceHash) data.sourceHash = n.sourceHash;
    }
    if (e.trangThai !== trangThai) data.trangThai = trangThai;
    if ((e.lyDoCho ?? null) !== (lyDoCho ?? null)) data.lyDoCho = lyDoCho;
    if (Object.keys(data).length === 0) giu.push(e.id);
    else capNhat.push({ id: e.id, khoa: n.khoa, phienBanCu: e.phienBan, data });
  }

  // ── Dòng bảng chiếu mà engine KHÔNG còn sinh.
  for (const e of vao.hienCo) {
    const khoa = khoaCua(e.nguonLoai, e.nguonId);
    if (khoaDaCo.has(khoa)) continue;
    // Chế độ chỉ-theo-khoản-thu: dòng BILLING:* không phải của lượt quét này (OD-05 chưa chốt) — không coi là mất nguồn.
    if (e.nguonLoai === "BILLING" && vao.cheDo === "THEO_KHOAN_THU") continue;
    if (e.trangThai === "MAT_NGUON") continue;
    const daCoHoaDon = e.hoaDonId != null || TRANG_THAI_DA_CO_HOA_DON.has(e.trangThai);
    if (daCoHoaDon) {
      // Không sửa dòng đã dính hoá đơn: nguồn của nó biến mất là việc người phải nhìn.
      doiNgoaiLe({ dedupeKey: `NGUON_MAT:${khoa}`, loai: "NGUON_MAT", muc: "KHAN", centerId, orderId: vao.orderId, nghiaVuKhoa: khoa, hoaDonId: e.hoaDonId });
      continue;
    }
    capNhat.push({ id: e.id, khoa, phienBanCu: e.phienBan, data: { trangThai: "MAT_NGUON", lyDoCho: "NGUON_MAT" } });
  }

  // ── Đối chiếu bóng: mỗi dòng `chenhLech` là một câu hỏi chưa có lời giải thích. `khacCoChuDich` đã được giải thích ⇒ không ngoại lệ.
  for (const c of vao.baoCao.chenhLech) {
    const laKhoaNguon = /^(PAYMENT|BILLING):/.test(c.khoa);
    doiNgoaiLe({
      dedupeKey: `LECH_SHADOW:${vao.orderId}:${c.loai}:${c.khoa}`,
      loai: "LECH_SHADOW",
      muc: "CAN_XU_LY",
      centerId,
      orderId: vao.orderId,
      nghiaVuKhoa: laKhoaNguon ? c.khoa : null,
      hoaDonId: null,
    });
  }

  // ── Ngoại lệ: mở cái còn thiếu, đóng cái hết điều kiện (chỉ loại của scanner, chỉ khi còn MO — DANG_XU_LY là có người đang làm).
  const daMo = new Set(vao.ngoaiLeMo.map((m) => m.dedupeKey));
  const ngoaiLeTao = [...mong.values()].filter((n) => !daMo.has(n.dedupeKey) && !vao.ngoaiLeBoQua.has(n.dedupeKey));
  const cuaScanner: readonly string[] = LOAI_NGOAI_LE_CUA_SCANNER;
  const ngoaiLeDong = vao.ngoaiLeMo
    .filter((m) => m.trangThai === "MO" && cuaScanner.includes(m.loai) && !mong.has(m.dedupeKey))
    .map((m) => ({ id: m.id }));

  return {
    boQua: null,
    tao: tao.sort((a, b) => soSanh(a.khoa, b.khoa)),
    capNhat: capNhat.sort((a, b) => soSanh(a.khoa, b.khoa)),
    giu: giu.sort(soSanh),
    khongTao: khongTao.sort((a, b) => soSanh(a.khoa, b.khoa)),
    ngoaiLeTao: ngoaiLeTao.sort((a, b) => soSanh(a.dedupeKey, b.dedupeKey)),
    ngoaiLeDong: ngoaiLeDong.sort((a, b) => soSanh(a.id, b.id)),
  };
}
