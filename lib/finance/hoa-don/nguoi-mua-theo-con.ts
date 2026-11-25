// lib/finance/hoa-don/nguoi-mua-theo-con.ts — NGƯỜI MUA trên hoá đơn là BA/MẸ hay là CON. THUẦN: không Prisma, không DB, không đồng hồ.
//
// ─────────────────────────────────────────────────────────────────────────────
// KẾ TOÁN YÊU CẦU (17/11/2026) — chế độ ưu tiên thông tin xuất hoá đơn
//   Chia hai bên: ba/mẹ và con. Bên nào có ĐỦ HƠN trong ba thứ «họ tên · CCCD · địa chỉ» thì lấy bên đó làm người mua.
//   Địa chỉ DÙNG CHUNG (một khối địa chỉ trên đơn) nên cả hai bên có/không có như nhau ⇒ KHÔNG làm hai bên khác điểm — phép so chỉ còn là
//   «họ tên» + «CCCD». Hai bên BẰNG nhau ⇒ lấy CON.
//     TH1  mẹ: tên + CCCD · con: tên                      ⇒ MẸ   (mẹ nhiều thông tin hơn, nội dung hàng giữ như cũ)
//     TH2  mẹ: tên        · con: tên + CCCD               ⇒ CON  (con nhiều hơn)
//     TH3  mẹ: tên        · con: tên                      ⇒ CON  (bằng nhau ⇒ con)
//   Người mua là CON ⇒ dòng hàng ghi «Học phí khoá Sata4 (48 buổi) của <con> con của <ba/mẹ>» (xem `tenDongHocPhi`).
//
// ── NHỮNG CHỖ KHÔNG ĐƯỢC CHỌN CON (người mua phải là ĐÚNG người đã khai, không đoán) ─────────────────────
//   · đơn có TÊN ĐƠN VỊ / MST ⇒ người mua là doanh nghiệp, không phải trẻ;
//   · con KHÔNG có họ tên ⇒ không dựng được tờ hoá đơn;
//   · chứng từ GỘP khoản của hai bé trở lên ⇒ không có «bé của chứng từ» ⇒ ba/mẹ (đơn nhiều con: MỖI chứng từ một bé, so với ba/mẹ ĐỘC LẬP — xem `conChoChungTu`);
//   · đơn ĐÃ CÓ phiếu thu / hoá đơn phát hành TRƯỚC mốc áp dụng ⇒ GIỮ BA/MẸ (chủ dự án 17/11: tờ đã in không đổi người mua giữa chừng);
//   · chưa đặt mốc áp dụng (`hoaDon.nguoiMuaTheoConTuNgay` rỗng) ⇒ luật TẮT, mọi đơn như cũ.
// Cả bốn nhánh nằm ở `conChoNguoiMua` — MỘT chỗ; `nguoiMuaChoDon` chỉ ghép kết quả.

export type BenNguoiMua = { hoTen: string | null; cccd: string | null };

export type QuyetNguoiMua = "PHU_HUYNH" | "CON";

const sach = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/** Số thứ đã có trong «họ tên · CCCD» (địa chỉ dùng chung nên không tính — xem đầu tệp). */
export function diemThongTin(b: BenNguoiMua): number {
  return (sach(b.hoTen) ? 1 : 0) + (sach(b.cccd) ? 1 : 0);
}

/**
 * Người mua là ai khi ĐÃ có một «con ứng viên» hợp lệ. `con = null` ⇒ ba/mẹ.
 * Con phải có họ tên (không có tên thì không thể là người mua); đủ hơn hoặc BẰNG ba/mẹ ⇒ con.
 */
export function quyetNguoiMuaTheoCon(input: { phuHuynh: BenNguoiMua; con: BenNguoiMua | null; coDonVi: boolean; /** Kế toán CHỌN TAY (24/11/2026) — thắng phép so điểm, nhưng KHÔNG thắng ba loại loại trừ ở dòng đầu. */ ep?: QuyetNguoiMua }): QuyetNguoiMua {
  if (input.coDonVi || input.con === null || !sach(input.con.hoTen)) return "PHU_HUYNH";
  if (input.ep) return input.ep;
  return diemThongTin(input.con) >= diemThongTin(input.phuHuynh) ? "CON" : "PHU_HUYNH";
}

/** Dữ kiện để chọn «con ứng viên» cho MỘT bé — hàm `conChoChungTu` dựng, hàm thuần này quyết. */
export type DuKienConUngVien = {
  /** Luật có đang áp dụng không (đã đặt mốc `hoaDon.nguoiMuaTheoConTuNgay`). */
  apDung: boolean;
  /** Đơn có phiếu thu / hoá đơn phát hành TRƯỚC mốc áp dụng. */
  chungTuTruocMoc: boolean;
  /** Ô học viên ĐÃ LƯU trên đơn cho bé này (khối «Người mua trên hoá đơn»). */
  tenTrenDon: string | null;
  cccdTrenDon: string | null;
  /** Hồ sơ học viên (khi đơn chưa lưu ô tương ứng). */
  tenHoSo: string | null;
  cccdHoSo: string | null;
};

/**
 * «Con ứng viên» của MỘT bé, hoặc `null` khi luật không được phép chọn con (tắt / đã có chứng từ trước mốc / không có họ tên). Giá trị trên ĐƠN thắng hồ sơ — cùng chiều với
 * `hieuLuc` của khối «Người mua trên hoá đơn»: đơn là thứ kế toán đã nhìn và lưu, hồ sơ chỉ để khỏi gõ lại.
 */
export function conChoNguoiMua(d: DuKienConUngVien): BenNguoiMua | null {
  if (!d.apDung || d.chungTuTruocMoc) return null;
  const hoTen = sach(d.tenTrenDon) ?? sach(d.tenHoSo);
  if (!hoTen) return null;
  return { hoTen, cccd: sach(d.cccdTrenDon) ?? sach(d.cccdHoSo) };
}

// ─── Đơn NHIỀU CON: mỗi hoá đơn / phiếu thu một bé (chủ dự án 17/11: «con = hoặc nhiều hơn ba/mẹ thì tách hoá đơn cho từng con») ──────────────────────────────────
//
// Hoá đơn của đơn nhiều con đã được TÁCH theo con ở mức lần thu (`lan-thu.ts`: khoá `<nhóm>#<orderItemId>`). Cái còn thiếu là NGƯỜI MUA theo từng tờ: mỗi tờ biết «bé của tờ này» từ các
// DÒNG ĐƠN (`OrderItem.studentId`) của khoản thu trong tờ, rồi so thông tin bé đó với ba/mẹ — MỖI TỜ ĐỘC LẬP: bé A đủ hơn ba/mẹ ⇒ tờ của A đứng tên A; bé B kém ba/mẹ ⇒ tờ của B vẫn đứng tên ba/mẹ.
// Một tờ GỘP khoản của hai bé trở lên (kế toán gộp tay) ⇒ không có «bé của tờ» ⇒ ba/mẹ.

/** Hồ sơ một học viên của đơn. */
export type HocVienCuaDon = { ten: string; cccd: string | null };

/** Mọi dữ kiện cần để biết «bé của một chứng từ» — LOADER dựng (cần DB), hàm thuần `conChoChungTu` quyết. */
export type ThongTinConDon = {
  apDung: boolean;
  chungTuTruocMoc: boolean;
  /** Ô học viên đã lưu trên đơn: EM THỨ NHẤT (`invoiceStudentName` / `invoiceStudentCccd`) + các em khai thêm (`invoiceHocVienThem`). */
  tenTrenDon: string | null;
  cccdTrenDon: string | null;
  khaiThem: readonly { ten: string; cccd: string | null }[];
  /** `Order.studentId` — bé mặc định của đơn (dùng cho khoản chưa gắn dòng đơn nào). */
  hocVienCuaDon: string | null;
  /** Mọi học viên có mặt trên đơn (học viên của đơn + học viên các dòng đơn), theo id. */
  hocVien: Readonly<Record<string, HocVienCuaDon>>;
  /** `OrderItem.id` → `studentId` (null = dòng chưa gắn học viên). */
  hocVienCuaDong: Readonly<Record<string, string | null>>;
};

const chuanTen = (s: string | null | undefined): string => (s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");

/**
 * «Bé của chứng từ» + thông tin của bé đó, hoặc `null` (⇒ người mua là ba/mẹ). `orderItemIds` = các DÒNG ĐƠN của khoản thu trong chứng từ (`null` = khoản chưa gắn dòng ⇒ bé mặc định của đơn);
 * `undefined` = cả đơn (màn đơn, nơi không có một chứng từ cụ thể). Hai bé khác nhau trở lên trong cùng chứng từ ⇒ `null`.
 */
export function conChoChungTu(thongTin: ThongTinConDon | null, orderItemIds?: readonly (string | null)[], opts?: { /** Kế toán CHỌN TAY con làm người mua (24/11/2026): bỏ qua công tắc «chưa đặt mốc» và «đã có chứng từ trước mốc» — đó là cổng của luật TỰ ĐỘNG, không phải của quyết định có người đứng tên. */ boQuaMoc?: boolean }): BenNguoiMua | null {
  const t = opts?.boQuaMoc && thongTin ? { ...thongTin, apDung: true, chungTuTruocMoc: false } : thongTin;
  if (!t || !t.apDung || t.chungTuTruocMoc) return null;
  const idsHocVien = new Set<string>();
  const dongCanXet = orderItemIds ?? Object.keys(t.hocVienCuaDong);
  for (const id of dongCanXet) {
    const sid = id === null ? t.hocVienCuaDon : (t.hocVienCuaDong[id] ?? t.hocVienCuaDon);
    if (sid) idsHocVien.add(sid);
  }
  if (orderItemIds === undefined && t.hocVienCuaDon) idsHocVien.add(t.hocVienCuaDon);
  const tatCaHocVien = Object.keys(t.hocVien);

  // Không có học viên nào gắn với chứng từ: chỉ còn ô «em thứ nhất» Sale/kế toán đã gõ trên đơn — dùng được khi đơn KHÔNG khai thêm em (không biết ô đó thuộc em nào).
  // Đơn có khai thêm em mà các em đó KHÔNG gắn hồ sơ học viên riêng (≤ 1 học viên trên đơn) ⇒ không biết khoản nào của em nào ⇒ ba/mẹ. Có ≥ 2 học viên thì chứng từ phải truy được về dòng đơn của bé;
  // khoản chưa gắn dòng (null) trên đơn như vậy cũng không truy được ⇒ ba/mẹ.
  if (t.khaiThem.length > 0 && (tatCaHocVien.length <= 1 || dongCanXet.some((id) => id === null || !(id in t.hocVienCuaDong)))) return null;
  if (idsHocVien.size === 0) {
    if (t.khaiThem.length > 0 || tatCaHocVien.length > 0) return null;
    return conChoNguoiMua({ apDung: true, chungTuTruocMoc: false, tenTrenDon: t.tenTrenDon, cccdTrenDon: t.cccdTrenDon, tenHoSo: null, cccdHoSo: null });
  }
  if (idsHocVien.size > 1) return null;
  const sid = [...idsHocVien][0]!;
  const hoSo = t.hocVien[sid] ?? null;

  // Đơn có đúng MỘT học viên và không khai thêm em: ô «em thứ nhất» trên đơn là của bé đó (đơn thắng hồ sơ) — hành vi của đơn một con từ #1247, không đổi.
  if (tatCaHocVien.length <= 1 && t.khaiThem.length === 0) {
    return conChoNguoiMua({ apDung: true, chungTuTruocMoc: false, tenTrenDon: t.tenTrenDon, cccdTrenDon: t.cccdTrenDon, tenHoSo: hoSo?.ten ?? null, cccdHoSo: hoSo?.cccd ?? null });
  }
  // Đơn nhiều con: ô trên đơn thuộc em nào thì ghép theo HỌ TÊN (em thứ nhất, rồi các em khai thêm); không khớp ⇒ hồ sơ của chính bé.
  const ten = chuanTen(hoSo?.ten);
  let tenTrenDon: string | null = null;
  let cccdTrenDon: string | null = null;
  if (ten !== "" && chuanTen(t.tenTrenDon) === ten) {
    tenTrenDon = t.tenTrenDon;
    cccdTrenDon = t.cccdTrenDon;
  } else if (ten !== "") {
    const them = t.khaiThem.find((e) => chuanTen(e.ten) === ten);
    if (them) {
      tenTrenDon = them.ten;
      cccdTrenDon = them.cccd;
    }
  }
  return conChoNguoiMua({ apDung: true, chungTuTruocMoc: false, tenTrenDon, cccdTrenDon, tenHoSo: hoSo?.ten ?? null, cccdHoSo: hoSo?.cccd ?? null });
}
