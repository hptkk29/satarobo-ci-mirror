/**
 * THỐNG KÊ CASE TRẢI NGHIỆM THEO SALE — định nghĩa từng chỉ tiêu, ở MỘT chỗ.
 *
 * Chủ dự án 22/09/2026: bảng "các case trial của từng sale với các cột tên sale, số case
 * trial …, số case đã hoàn thành trial, số case huỷ, số case trial xong đã chốt được, số
 * case trial hoàn thành nhưng im lặng, tỷ lệ thành công". Chốt thêm khi hỏi lại: tỷ lệ =
 * **chốt ÷ hoàn thành** (case HUỶ không vào mẫu số), và thêm cột "đang chờ" + "vắng".
 *
 * ── VÌ SAO LÀ HÀM THUẦN, VÀ VÌ SAO NÓ CŨNG DỰNG DANH SÁCH CHI TIẾT ────────────────────
 * Màn này cho bấm vào từng con số để xem danh sách case đằng sau. Nếu con số do một câu
 * `groupBy` đếm còn danh sách do một câu `findMany` khác lọc, thì hai bên sẽ lệch vào
 * đúng ngày ai đó sửa một trong hai điều kiện — và không lỗi nào báo, chỉ có người dùng
 * đếm tay rồi bảo "bấm vào số 7 mà chỉ thấy 5 dòng".
 *
 * Nên ở đây MỘT mảng case vào, và cả con số lẫn danh sách đều suy ra từ CHÍNH mảng đó
 * bằng cùng một vị từ (`THUOC_NHOM`). Con số chính là `danhSach.length`.
 *
 * ⚠️ KHÔNG đọc đồng hồ trong tệp này (luật 19) và không chạm DB.
 */

/** Trạng thái case — khớp `TrialEnrollmentStatus` của Prisma. */
export type TrangThaiCase = "ACTIVE" | "COMPLETED" | "WITHDRAWN";

export type CaseTrial = {
  id: string;
  /**
   * Sale PHỤ TRÁCH LEAD của bé (`Lead.assignedToId`) — KHÔNG phải người bấm thêm case.
   * `null` = lead chưa ai phụ trách. Luật ở `saleCuaCase`.
   */
  saleId: string | null;
  saleName: string | null;
  status: TrangThaiCase;
  /**
   * Con này ĐÃ ĐƯỢC CHỐT thành học viên chưa.
   *
   * ⚠️ Tín hiệu là `Enrollment.leadChildId`, KHÔNG phải `LeadTrialHistory.outcome`.
   * Đo 22/09/2026: `outcome` chỉ được bật `ENROLLED` cho đúng cặp (con × lớp đã điểm
   * danh) và chỉ khi dòng lịch sử đang ở `PENDING` — nó sinh ra để tính hoa hồng giáo
   * viên dạy Trial, không phải để đếm "đã chốt". Trên DB local có 2 dòng, cả hai PENDING.
   */
  daChot: boolean;
  /**
   * Con KHÔNG ĐẾN: có lượt điểm danh và MỌI lượt đều vắng.
   *
   * "Có ít nhất một lượt vắng" là định nghĩa SAI cho cột này: em đến buổi 1, nghỉ buổi 2
   * vẫn là em có đến. Cột này trả lời "khách hẹn rồi không xuất hiện".
   */
  vangHoanToan: boolean;
  tenCon: string;
  tenPhuHuynh: string | null;
  tenLop: string;
  trialClassId: string;
  /** Ngày lớp mở, "YYYY-MM-DD". `null` với lớp cũ không gắn ngày. */
  ngayLop: string | null;
  tenGiaoVien: string | null;
};

/** Các ô bấm được trên bảng. Mỗi mã là MỘT vị từ, khai ở `THUOC_NHOM`. */
export type MaChiTieu =
  | "tong"
  | "dangCho"
  | "hoanThanh"
  | "vang"
  | "huy"
  | "chot"
  | "imLang";

export const NHAN_CHI_TIEU: Record<MaChiTieu, string> = {
  tong: "Tổng case",
  dangCho: "Đang chờ",
  hoanThanh: "Hoàn thành",
  vang: "Vắng (không đến)",
  huy: "Huỷ",
  chot: "Chốt được",
  imLang: "Hoàn thành nhưng im lặng",
};

/**
 * Định nghĩa TỪNG chỉ tiêu, dưới dạng vị từ trên MỘT case.
 *
 * Đây là nơi duy nhất trả lời "cột đó đếm cái gì". Viết điều kiện thẳng trong câu truy
 * vấn là chép định nghĩa ra chỗ thứ hai, và chỗ thứ hai là chỗ sẽ lệch.
 */
export const THUOC_NHOM: Record<MaChiTieu, (c: CaseTrial) => boolean> = {
  tong: () => true,
  dangCho: (c) => c.status === "ACTIVE",
  hoanThanh: (c) => c.status === "COMPLETED",
  huy: (c) => c.status === "WITHDRAWN",
  vang: (c) => c.vangHoanToan,
  chot: (c) => c.daChot,
  // "Hoàn thành nhưng im lặng" = học xong mà không chốt. KHÔNG tính case đang chờ (chưa
  // học xong thì chưa im lặng, chỉ là chưa tới lúc) và không tính case huỷ (khách đã nói).
  imLang: (c) => c.status === "COMPLETED" && !c.daChot,
};

export type DongSale = {
  saleId: string | null;
  saleName: string;
  so: Record<MaChiTieu, number>;
  /**
   * Tỷ lệ thành công = chốt ÷ HOÀN THÀNH. `null` khi chưa có case hoàn thành nào —
   * KHÔNG phải 0%.
   *
   * Chủ dự án chốt 22/09: "chốt / hoàn thành, huỷ không tính luôn". Trả `0` cho mẫu số
   * rỗng là nói rằng Sale đó thất bại, trong khi sự thật là chưa có gì để đánh giá — và
   * con số 0% đó sẽ đi thẳng vào bảng so sánh giữa người với người.
   */
  tyLe: number | null;
};

/** Nhãn dòng gom các case mà lead chưa ai phụ trách. */
export const SALE_CHUA_CO = "(Lead chưa có Sale phụ trách)";

/**
 * Case này tính cho Sale nào — Sale PHỤ TRÁCH LEAD của bé.
 *
 * ~~Người THÊM case (`TrialEnrollment.addedById`)~~ **[ĐẢO 26/09/2026]** chủ dự án thấy
 * "Hoàng Phan Tuấn Kiệt" (không phải Sale) thành một dòng Sale chỉ vì tài khoản đó bấm
 * thêm hộ một bé. Người xếp hộ (Quản lý, Đào tạo, quản trị) KHÔNG phải người chăm khách;
 * tính theo họ là lấy case khỏi Sale thật và dựng ra "Sale" giả.
 *
 * ⚠️ Là Sale HIỆN TẠI của lead — hệ thống không lưu "ai phụ trách lúc tạo case", nên lead
 * đã chuyển Sale thì mọi case cũ của nó đi theo Sale mới.
 */
export function saleCuaCase(
  lead: { assignedToId: string | null; assignedTo: { name: string | null } | null } | null,
): { saleId: string | null; saleName: string | null } {
  const id = lead?.assignedToId ?? null;
  if (!id) return { saleId: null, saleName: null };
  return { saleId: id, saleName: lead?.assignedTo?.name?.trim() || null };
}

/** Gom case theo Sale. Thứ tự: nhiều case nhất lên trước, rồi theo tên cho ổn định. */
export function gomTheoSale(cases: readonly CaseTrial[]): DongSale[] {
  const theoSale = new Map<string, CaseTrial[]>();
  for (const c of cases) {
    const khoa = c.saleId ?? "";
    const ds = theoSale.get(khoa);
    if (ds) ds.push(c);
    else theoSale.set(khoa, [c]);
  }

  const ra: DongSale[] = [];
  for (const [khoa, ds] of theoSale) {
    ra.push({
      saleId: khoa || null,
      // Case của lead chưa ai phụ trách vẫn phải hiện thành MỘT dòng, không bị nuốt: tổng
      // của bảng phải bằng tổng số case, nếu không người đọc sẽ đi tìm mấy case thiếu.
      saleName: ds.find((c) => c.saleName)?.saleName ?? SALE_CHUA_CO,
      so: demTheoNhom(ds),
      tyLe: tinhTyLe(ds),
    });
  }
  ra.sort((a, b) => b.so.tong - a.so.tong || a.saleName.localeCompare(b.saleName, "vi"));
  return ra;
}

function demTheoNhom(ds: readonly CaseTrial[]): Record<MaChiTieu, number> {
  const ra = {} as Record<MaChiTieu, number>;
  for (const ma of Object.keys(THUOC_NHOM) as MaChiTieu[]) {
    ra[ma] = ds.filter(THUOC_NHOM[ma]).length;
  }
  return ra;
}

function tinhTyLe(ds: readonly CaseTrial[]): number | null {
  const mauSo = ds.filter(THUOC_NHOM.hoanThanh).length;
  if (mauSo === 0) return null;
  return ds.filter(THUOC_NHOM.chot).length / mauSo;
}

/** Hàng TỔNG — cộng TỪ CHÍNH danh sách case, không cộng các dòng Sale lại. */
export function dongTong(cases: readonly CaseTrial[]): DongSale {
  return {
    saleId: null,
    saleName: "TỔNG",
    so: demTheoNhom(cases),
    // Tỷ lệ tổng tính lại trên toàn bộ, KHÔNG lấy trung bình các tỷ lệ: trung bình của
    // các tỷ lệ cho Sale có 1 case cùng trọng số với Sale có 50 case.
    tyLe: tinhTyLe(cases),
  };
}

/** Danh sách case đằng sau MỘT ô số — cùng vị từ với chính con số đó. */
export function caseCuaO(
  cases: readonly CaseTrial[],
  saleId: string | null,
  ma: MaChiTieu,
): CaseTrial[] {
  return cases.filter((c) => (c.saleId ?? null) === saleId && THUOC_NHOM[ma](c));
}

/** "62%" — làm tròn tới phần trăm nguyên. `null` ⇒ "—". */
export function nhanTyLe(t: number | null): string {
  return t === null ? "—" : `${Math.round(t * 100)}%`;
}

/**
 * Phạm vi cơ sở cuối cùng của một lượt lọc: giao giữa KHU VỰC và CƠ SỞ đã chọn.
 *
 * ⚠️ Tách ra hàm THUẦN có lý do cụ thể, không phải cho đẹp. Lúc đầu phép này viết thẳng
 * trong tầng truy vấn và chỉ có lưới ghim mã nguồn canh; khi cấy thử "khu vực rỗng thì bỏ
 * qua bộ lọc", lưới ấy **XANH GIẢ** — nó thấy đủ chữ nhưng không thấy được là nhánh đã bị
 * vô hiệu hoá trước đó. Luật 11 nói đúng: ưu tiên khẳng định HÀNH VI.
 *
 * Trả `null` = không giới hạn cơ sở nào (người dùng chọn "tất cả"), `[]` = KHÔNG CÒN cơ sở
 * nào hợp lệ ⇒ caller phải trả rỗng chứ KHÔNG được coi như "tất cả".
 */
export function phamViCoSo(input: {
  /** Cơ sở trong cây con của khu vực đã chọn. `null` = không lọc theo khu vực. */
  coSoCuaKhuVuc: string[] | null;
  /** Cơ sở người dùng chọn. `null` = tất cả. */
  centerId: string | null;
}): string[] | null {
  const { coSoCuaKhuVuc, centerId } = input;
  if (coSoCuaKhuVuc === null) return centerId ? [centerId] : null;
  // Khu vực đã chọn nhưng không có cơ sở nào ⇒ `[]`, KHÔNG phải `null`. Trả `null` ở đây
  // là hiện dữ liệu của MỌI khu vực trong khi thanh lọc đang ghi tên một khu vực.
  if (!centerId) return coSoCuaKhuVuc;
  return coSoCuaKhuVuc.filter((c) => c === centerId);
}
