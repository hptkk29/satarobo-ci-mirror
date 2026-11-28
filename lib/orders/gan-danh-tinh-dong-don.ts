/**
 * GẮN DANH TÍNH CHO DÒNG ĐƠN — luật THUẦN [25/10/2026; mở rộng cho đường TẠO ĐƠN TAY 26/10/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỆP NÀY TỒN TẠI
 *
 * Đơn khoá học lập từ `/orders/new?leadId=…` ra đời TRƯỚC khi học viên tồn tại, nên
 * `Order.studentId`, `OrderItem.studentId` và `OrderItem.enrollmentId` đều NULL. `convertLeadV2`
 * rồi đúc `Student` + `Enrollment` và gắn TIỀN vào ghi danh (`linkRecordedPaymentsToEnrollments`),
 * nhưng chưa bao giờ quay lại gắn DÒNG ĐƠN. Đo PROD 25/10/2026: 48/48 đơn khoá học sống thiếu học
 * viên trên đơn, trong đó 31/35 ca có ứng viên duy nhất là ghi danh sinh SAU đơn (đường convert);
 * hai đơn mới nhất cùng ngày vẫn lặp lại lỗi. Dọn dữ liệu cũ (PHASE C) vô nghĩa nếu đường ghi
 * vẫn đẻ thêm dữ liệu hỏng, nên gốc phải vá trước.
 *
 * Rà soát đường tạo đơn 26/10/2026 (mục IX) tìm ra NỬA CÒN LẠI: đơn lập TAY (`createOrderManualAction`)
 * cho học viên ĐÃ có ghi danh (gia hạn, anh/chị/em, mua thêm) không bao giờ ghi `OrderItem.enrollmentId`,
 * và ghi danh sinh SAU đơn tay (giáo vụ xếp lớp sau) cũng không quay lại gắn dòng đơn. Luật dưới đây dùng
 * CHUNG cho cả ba đường; mỗi đường truyền `tuyChon` khai rõ nó cho phép gì.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * LUẬT (fail-closed — mơ hồ thì KHÔNG GẮN, không đoán)
 *
 * Cầu nối dòng đơn ↔ ghi danh (đường convert) là `leadChildId` (bé) + `courseId` (khoá) — đúng cầu nối
 * `lib/finance/gia-tu-dong-don.ts` đã dùng cho GIÁ, để giá và danh tính không bao giờ lấy từ hai
 * dòng khác nhau. Một dòng chỉ được gắn khi:
 *   · biết bé của dòng (metadata, hoặc `Order.leadChildId` khi đơn CHỈ có một dòng);
 *   · có ĐÚNG MỘT ghi danh còn hiệu lực của bé đó, cùng khoá, cùng cơ sở với đơn;
 *   · ghi danh đó chưa thuộc dòng đơn khác;
 *   · không có HAI dòng nào cùng nhắm một ghi danh (hai đơn cho một bé một khoá ⇒ cả hai bỏ qua);
 *   · liên kết có sẵn (nếu có) không mâu thuẫn — không bao giờ ĐÈ.
 * `Order.studentId` chỉ ghi khi MỌI dòng của đơn đều là dòng khoá học, đều đã có học viên, và đó
 * là CÙNG MỘT em (đơn nhiều con ⇒ NULL, như `studentIdChoDon`).
 *
 * ĐƯỜNG TẠO ĐƠN TAY (`tuyChon.cauNoiHocVien = true`) thêm HAI thứ, và chỉ ở đường này:
 *   · cầu nối thứ hai THEO HỌC VIÊN: dòng không có bé nhưng có `studentId` (sale chọn học viên đã có hồ sơ, đã gác
 *     scope + chủ nhà lúc tạo đơn) ⇒ ứng viên = ghi danh của CHÍNH học viên đó, cùng khoá, cùng cơ sở;
 *   · ghi danh `COMPLETED` KHÔNG phải ứng viên (một lần MUA MỚI không được dính vào suất đã học xong — đơn học lại
 *     cùng khoá);
 *   · HAI LƯỚI chống chiếm ghi danh của đơn cũ chưa gắn (trên PROD 48/48 đơn cũ còn thiếu cột này nên
 *     `dongKhacDangGiu` — chỉ nhìn `OrderItem.enrollmentId` — KHÔNG đủ): (1) ghi danh đã có khoản thu SỐNG của đơn KHÁC;
 *     (2) còn dòng đồng cấp (cùng học viên/bé + khoá + cơ sở) ở đơn khác chưa gắn ghi danh.
 *     Hệ quả nói thẳng: trên dữ liệu hôm nay độ phủ thấp tới khi PHASE C xong — nhưng KHÔNG gắn nhầm.
 *
 * THUẦN — không Prisma, không DB.
 */

/** Ghi danh ở các trạng thái này không còn là "suất học hiện hành" của bé. */
export const TRANG_THAI_GHI_DANH_KHONG_GAN = ["CANCELLED", "WITHDREW", "TRANSFERRED"] as const;
/** Đường TẠO ĐƠN TAY loại thêm ghi danh đã HOÀN THÀNH (xem đầu tệp). */
export const TRANG_THAI_GHI_DANH_KHONG_GAN_MOI = [...TRANG_THAI_GHI_DANH_KHONG_GAN, "COMPLETED"] as const;

export type DongCanXet = {
  itemId: string;
  orderId: string;
  /** `Order.centerId` (Center.id). */
  orderCenterId: string | null;
  /** `Order.leadChildId` — chỉ dùng khi đơn có ĐÚNG MỘT dòng. */
  orderLeadChildId: string | null;
  /** Số dòng của đơn (mọi loại). */
  soDongCuaDon: number;
  /** Số dòng của đơn KHÔNG phải khoá học — có thì không suy `Order.studentId`. */
  soDongKhongPhaiKhoa: number;
  /** `OrderItem.metadata.leadChildId`. */
  leadChildId: string | null;
  /** `OrderItem.metadata.courseId`. */
  courseId: string | null;
  /** Giá trị HIỆN TẠI trên dòng. */
  studentId: string | null;
  enrollmentId: string | null;
  /** `Order.studentId` hiện tại. */
  orderStudentId: string | null;
};

export type GhiDanhUngVien = {
  enrollmentId: string;
  studentId: string;
  leadChildId: string | null;
  courseId: string | null;
  centerId: string | null;
  status: string;
  /** Đã có `OrderItem` KHÁC (không phải dòng đang xét) trỏ vào ghi danh này. */
  dongKhacDangGiu: ReadonlySet<string>;
  /** Mã đơn của MỌI khoản thu SỐNG đang gắn ghi danh này (lưới 1 — chỉ đường tạo đơn tay đọc). Convert truyền tập rỗng. */
  donCoKhoanThu: ReadonlySet<string>;
  /** Id các dòng khoá học ĐỒNG CẤP (cùng học viên/bé + khoá + cơ sở) của đơn KHÁC còn nhận tiền mà CHƯA gắn ghi danh (lưới 2). Convert truyền tập rỗng. */
  dongDongCapChuaGan: ReadonlySet<string>;
};

/** Mỗi đường GỌI khai rõ nó cho phép gì — tham số BẮT BUỘC (luật 7: `tsc` liệt kê chỗ gọi, không có «bật ngầm»). */
export type TuyChonGanDanhTinh = {
  /** `true` ⇒ chỉ đường TẠO ĐƠN TAY; xem đầu tệp. `convertLeadV2` truyền `false`. */
  cauNoiHocVien: boolean;
};

export type MaBoQua =
  | "KHONG_CAU_NOI_BE"
  | "KHONG_RO_KHOA"
  | "CHUA_CO_GHI_DANH"
  | "NHIEU_GHI_DANH"
  | "KHAC_CO_SO"
  | "GHI_DANH_DA_GAN_DONG_KHAC"
  | "XUNG_DOT_LIEN_KET"
  | "TRUNG_DONG"
  | "GHI_DANH_CO_KHOAN_DON_KHAC"
  | "DONG_DONG_CAP_CHUA_GAN";

export type KeHoachGanDanhTinh = {
  /** Chỉ chứa trường THẬT SỰ cần ghi (đang NULL). */
  dong: { itemId: string; orderId: string; studentId?: string; enrollmentId?: string }[];
  don: { orderId: string; studentId: string }[];
  boQua: { itemId: string; ma: MaBoQua }[];
};

export function lapKeHoachGanDanhTinh(
  dong: readonly DongCanXet[],
  ghiDanh: readonly GhiDanhUngVien[],
  tuyChon: TuyChonGanDanhTinh,
): KeHoachGanDanhTinh {
  const boQua: KeHoachGanDanhTinh["boQua"] = [];
  const chon = new Map<string, GhiDanhUngVien>(); // itemId → ghi danh được chọn
  const trangThaiLoai: readonly string[] = tuyChon.cauNoiHocVien ? TRANG_THAI_GHI_DANH_KHONG_GAN_MOI : TRANG_THAI_GHI_DANH_KHONG_GAN;
  const conHieuLuc = (status: string) => !trangThaiLoai.includes(status);

  for (const d of dong) {
    // Dòng đã đủ cả hai cột ⇒ không việc gì để làm (idempotent), cũng không phải "bỏ qua".
    if (d.studentId && d.enrollmentId) continue;

    const be =
      d.leadChildId?.trim() ||
      (d.soDongCuaDon === 1 ? d.orderLeadChildId?.trim() || null : null);
    const khoa = d.courseId?.trim() || null;
    let ungVien: GhiDanhUngVien[];
    if (be) {
      ungVien = ghiDanh.filter((g) => g.leadChildId === be && conHieuLuc(g.status) && (khoa ? g.courseId === khoa : true));
    } else if (tuyChon.cauNoiHocVien && d.studentId) {
      // Cầu nối thứ hai: CHÍNH học viên trên dòng (không dò theo SĐT/tên/thứ tự).
      // Dòng KHÔNG khai khoá (`them-con-vao-don` tạo dòng không metadata) ⇒ không biết dòng này là khoá nào ⇒ KHÔNG gắn vào ghi danh duy nhất của học viên (có thể là khoá khác — review độc lập 26/10).
      if (!khoa) {
        boQua.push({ itemId: d.itemId, ma: "KHONG_RO_KHOA" });
        continue;
      }
      ungVien = ghiDanh.filter((g) => g.studentId === d.studentId && conHieuLuc(g.status) && (khoa ? g.courseId === khoa : true));
    } else {
      boQua.push({ itemId: d.itemId, ma: "KHONG_CAU_NOI_BE" });
      continue;
    }
    if (ungVien.length === 0) {
      boQua.push({ itemId: d.itemId, ma: "CHUA_CO_GHI_DANH" });
      continue;
    }
    const cungCoSo = ungVien.filter(
      (g) => !!g.centerId && !!d.orderCenterId && g.centerId === d.orderCenterId,
    );
    if (cungCoSo.length === 0) {
      boQua.push({ itemId: d.itemId, ma: "KHAC_CO_SO" });
      continue;
    }
    if (cungCoSo.length > 1) {
      boQua.push({ itemId: d.itemId, ma: "NHIEU_GHI_DANH" });
      continue;
    }
    const g = cungCoSo[0]!;
    if ([...g.dongKhacDangGiu].some((id) => id !== d.itemId)) {
      boQua.push({ itemId: d.itemId, ma: "GHI_DANH_DA_GAN_DONG_KHAC" });
      continue;
    }
    if (tuyChon.cauNoiHocVien) {
      // Lưới 1: tiền của ĐƠN KHÁC đã nằm ở ghi danh này ⇒ ghi danh "thuộc" đơn kia dù dòng đơn kia chưa trỏ vào.
      if ([...g.donCoKhoanThu].some((id) => id !== d.orderId)) {
        boQua.push({ itemId: d.itemId, ma: "GHI_DANH_CO_KHOAN_DON_KHAC" });
        continue;
      }
      // Lưới 2: còn dòng đồng cấp chưa gắn ở đơn khác ⇒ không biết dòng nào là suất thật.
      if ([...g.dongDongCapChuaGan].some((id) => id !== d.itemId)) {
        boQua.push({ itemId: d.itemId, ma: "DONG_DONG_CAP_CHUA_GAN" });
        continue;
      }
    }
    if (
      (d.studentId && d.studentId !== g.studentId) ||
      (d.enrollmentId && d.enrollmentId !== g.enrollmentId)
    ) {
      boQua.push({ itemId: d.itemId, ma: "XUNG_DOT_LIEN_KET" });
      continue;
    }
    chon.set(d.itemId, g);
  }

  // Hai dòng cùng nhắm MỘT ghi danh (vd hai đơn cho một bé một khoá) ⇒ không biết dòng nào là
  // suất thật. Bỏ cả hai — tệ nhất là để nguyên hiện trạng, không bao giờ gắn nhầm.
  const theoGhiDanh = new Map<string, string[]>();
  for (const [itemId, g] of chon) {
    const ds = theoGhiDanh.get(g.enrollmentId) ?? [];
    ds.push(itemId);
    theoGhiDanh.set(g.enrollmentId, ds);
  }
  for (const ids of theoGhiDanh.values()) {
    if (ids.length < 2) continue;
    for (const itemId of ids) {
      chon.delete(itemId);
      boQua.push({ itemId, ma: "TRUNG_DONG" });
    }
  }

  const ketQuaDong: KeHoachGanDanhTinh["dong"] = [];
  for (const d of dong) {
    const g = chon.get(d.itemId);
    if (!g) continue;
    const p: KeHoachGanDanhTinh["dong"][number] = { itemId: d.itemId, orderId: d.orderId };
    if (!d.studentId) p.studentId = g.studentId;
    if (!d.enrollmentId) p.enrollmentId = g.enrollmentId;
    ketQuaDong.push(p);
  }

  // ── Cấp ĐƠN ─────────────────────────────────────────────────────────────────────────────
  const theoDon = new Map<string, DongCanXet[]>();
  for (const d of dong) {
    const ds = theoDon.get(d.orderId) ?? [];
    ds.push(d);
    theoDon.set(d.orderId, ds);
  }
  const don: KeHoachGanDanhTinh["don"] = [];
  for (const [orderId, ds] of theoDon) {
    const d0 = ds[0]!;
    if (d0.orderStudentId) continue;
    if (d0.soDongKhongPhaiKhoa > 0) continue;
    // Đủ MỌI dòng của đơn (dòng không nằm trong `dong` nghĩa là không phải khoá học ⇒ đã loại ở trên).
    if (ds.length !== d0.soDongCuaDon) continue;
    const hocVien = new Set<string>();
    let thieu = false;
    for (const d of ds) {
      const sau = d.studentId ?? chon.get(d.itemId)?.studentId ?? null;
      if (!sau) {
        thieu = true;
        break;
      }
      hocVien.add(sau);
    }
    if (thieu || hocVien.size !== 1) continue;
    don.push({ orderId, studentId: [...hocVien][0]! });
  }

  return { dong: ketQuaDong, don, boQua };
}
