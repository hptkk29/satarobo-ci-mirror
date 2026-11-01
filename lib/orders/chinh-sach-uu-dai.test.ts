// lib/orders/chinh-sach-uu-dai.test.ts — ƯU ĐÃI ANH EM: chính sách + hấp thụ. THUẦN.
//
// Số lấy từ TS-40 (`docs/thanh-toan-linh-hoat/05-TestScenarios…`):
//   *"gia đình chỉ có Bình (12.000.000, Đợt 1 đã trả, Đợt 2 chưa trả) … thêm An Sata3 mẫu
//   FULL … An (học phí thấp hơn) nhận 10% → 8.640.000 ngay từ buổi 1 của An; Bình không
//   đổi; không có quyết toán âm nào"*.
import { describe, expect, it } from "vitest";
import {
  CACH_HAP_THU,
  CHINH_SACH_MAC_DINH,
  DOI_TUONG_UU_DAI,
  keHoachHapThu,
  tinhUuDaiAnhEm,
  type ChinhSachUuDai,
  type DongDeTinhUuDai,
  type DotDeHapThu,
} from "./chinh-sach-uu-dai";

/** Chính sách BẬT, còn lại theo mặc định BA §10. */
const BAT: ChinhSachUuDai = { ...CHINH_SACH_MAC_DINH, tuDong: true };

const con = (
  p: Partial<DongDeTinhUuDai> & { orderItemId: string; ten: string; tamTinh: number },
): DongDeTinhUuDai => ({ thuTuVaoDon: 0, conDangHoc: true, ...p });

const BINH = con({ orderItemId: "oi-binh", ten: "Bình", tamTinh: 12_000_000, thuTuVaoDon: 0 });
const AN = con({ orderItemId: "oi-an", ten: "An", tamTinh: 9_600_000, thuTuVaoDon: 1 });

const tinh = (dong: readonly DongDeTinhUuDai[], cs: ChinhSachUuDai = BAT) =>
  new Map(tinhUuDaiAnhEm({ dong, chinhSach: cs }).map((u) => [u.orderItemId, u]));

describe("[UDC] chọn con nào được ưu đãi", () => {
  it("[UDC-01] TS-40: hai con, con HỌC PHÍ THẤP HƠN nhận 10% → 8.640.000", () => {
    const r = tinh([BINH, AN]);
    expect(r.get("oi-an")).toMatchObject({ hang: 2, phanTram: 10, giam: 960_000 });
    expect(9_600_000 - r.get("oi-an")!.giam, "học phí thực của An").toBe(8_640_000);
    // Bình KHÔNG đổi — đây là vế thứ hai của TS-40, và là vế dễ vỡ nhất.
    expect(r.get("oi-binh")).toMatchObject({ hang: 1, phanTram: 0, giam: 0 });
    expect(r.get("oi-binh")!.viSaoKhongGiam).toBe("HANG_MOT");
  });

  it("[UDC-02] thêm con học khoá ĐẮT HƠN ⇒ ưu đãi CHUYỂN sang con cũ", () => {
    // ⚠️ Đây chính là ca AC3 của US-19, và là lý do phép hấp thụ phải tồn tại: con cũ đang
    // học, đã chia đợt, và bỗng được giảm muộn. Không phải hệ quả phụ — là hệ quả TRỰC TIẾP
    // của chính sách "con học phí thấp hơn".
    const conDat = con({ orderItemId: "oi-moi", ten: "Cường", tamTinh: 20_000_000, thuTuVaoDon: 1 });
    const r = tinh([BINH, conDat]);
    expect(r.get("oi-binh")).toMatchObject({ hang: 2, phanTram: 10, giam: 1_200_000 });
    expect(r.get("oi-moi")!.hang).toBe(1);
  });

  it("[UDC-03] chính sách 'CON ĐĂNG KÝ SAU' ⇒ con vào sau nhận, con cũ KHÔNG BAO GIỜ đổi", () => {
    const cs = { ...BAT, doiTuong: DOI_TUONG_UU_DAI.GHI_DANH_SAU };
    const conDat = con({ orderItemId: "oi-moi", ten: "Cường", tamTinh: 20_000_000, thuTuVaoDon: 1 });
    const r = tinh([BINH, conDat], cs);
    // Cùng một gia đình, cùng dữ liệu, hai chính sách ⇒ hai người được giảm khác nhau. Đây là
    // sự khác biệt về TIỀN THẬT mà màn cấu hình phải nói ra cho quản lý.
    expect(r.get("oi-moi")).toMatchObject({ hang: 2, phanTram: 10, giam: 2_000_000 });
    expect(r.get("oi-binh")!.hang).toBe(1);
  });

  it("[UDC-04] ba con: con thứ ba trở lên nhận bậc thứ hai", () => {
    const r = tinh([
      BINH,
      AN,
      con({ orderItemId: "oi-ba", ten: "Ba", tamTinh: 8_000_000, thuTuVaoDon: 2 }),
    ]);
    expect(r.get("oi-binh")!.hang).toBe(1);
    expect(r.get("oi-an")).toMatchObject({ hang: 2, phanTram: 10 });
    expect(r.get("oi-ba")).toMatchObject({ hang: 3, phanTram: 15, giam: 1_200_000 });
  });

  it("[UDC-05] hai con HỌC PHÍ BẰNG NHAU ⇒ 'ai là con thứ hai' phải ỔN ĐỊNH", () => {
    // Ca thật: hai con học cùng khoá. Không phá thế hoà thì thứ tự phụ thuộc cách sắp của
    // máy, nên cùng một gia đình ra hai kết quả khác nhau ở hai lượt đọc — lệch tiền, không
    // ai hiểu vì sao. Phá bằng `thuTuVaoDon` ⇒ con vào SAU là con thứ hai.
    const a = con({ orderItemId: "oi-1", ten: "Một", tamTinh: 10_000_000, thuTuVaoDon: 0 });
    const b = con({ orderItemId: "oi-2", ten: "Hai", tamTinh: 10_000_000, thuTuVaoDon: 1 });
    for (const dong of [[a, b], [b, a]]) {
      const r = tinh(dong);
      expect(r.get("oi-1")!.hang, "con vào TRƯỚC luôn là con thứ 1").toBe(1);
      expect(r.get("oi-2")!.hang).toBe(2);
    }
  });

  it("[UDC-06] bé ĐÃ DỪNG HỌC không tính là một con của gia đình", () => {
    const daDung = con({
      orderItemId: "oi-dung",
      ten: "Đã dừng",
      tamTinh: 20_000_000,
      thuTuVaoDon: 0,
      conDangHoc: false,
    });
    const r = tinh([daDung, BINH, AN]);
    // Còn hai con ĐANG học ⇒ vẫn là ca hai con, không phải ba con.
    expect(r.get("oi-an")).toMatchObject({ hang: 2, phanTram: 10 });
    expect(r.get("oi-binh")!.hang).toBe(1);
    // Dòng của bé đã dừng VẪN có mặt trong kết quả (hạng 1, giảm 0) — người gọi không phải
    // tự ghép lại hai danh sách.
    expect(r.get("oi-dung")).toMatchObject({ hang: 1, giam: 0 });
  });

  it("[UDC-07] bé BẢO LƯU vẫn tính (BA §5) — người gọi truyền `conDangHoc: true`", () => {
    // Luật nằm ở NGƯỜI GỌI, và ca này ghim ý nghĩa của cột: bảo lưu không phải dừng học.
    const baoLuu = con({ ...BINH, conDangHoc: true });
    expect(tinh([baoLuu, AN]).get("oi-an")!.phanTram).toBe(10);
  });
});

describe("[UDC] các vế TẮT ưu đãi", () => {
  it("[UDC-08] chính sách TẮT ⇒ không ai được giảm, và nói rõ vì sao", () => {
    const r = tinh([BINH, AN], CHINH_SACH_MAC_DINH);
    expect(r.get("oi-an")).toMatchObject({ phanTram: 0, giam: 0 });
    expect(r.get("oi-an")!.viSaoKhongGiam).toBe("CHINH_SACH_TAT");
  });

  it("[UDC-09] mặc định của repo là TẮT — bật cho cả nhà là việc chủ dự án quyết", () => {
    // Ghim con số mặc định: merge một PR KHÔNG được tự bật một máy tính tiền cho mọi cơ sở.
    expect(CHINH_SACH_MAC_DINH.tuDong).toBe(false);
  });

  it("[UDC-10] đã có ưu đãi ĐÓNG TRỌN KHOÁ ⇒ không cộng dồn, trừ khi quản lý cho phép", () => {
    const anDongFull = con({ ...AN, coUuDaiDongFull: true });
    expect(tinh([BINH, anDongFull]).get("oi-an")).toMatchObject({
      giam: 0,
      viSaoKhongGiam: "DA_CO_DONG_FULL",
    });
    const r = tinh([BINH, anDongFull], { ...BAT, congDonDongFull: true });
    expect(r.get("oi-an")).toMatchObject({ phanTram: 10, giam: 960_000, viSaoKhongGiam: null });
  });

  it("[UDC-11] mức 0% ⇒ không giảm gì, và KHÔNG báo là được giảm", () => {
    const r = tinh([BINH, AN], { ...BAT, phanTramConThu2: 0 });
    expect(r.get("oi-an")).toMatchObject({ phanTram: 0, giam: 0, viSaoKhongGiam: null });
  });

  it("[UDC-12] một con duy nhất ⇒ không có ưu đãi anh em", () => {
    expect(tinh([BINH]).get("oi-binh")).toMatchObject({ hang: 1, giam: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const dot = (p: Partial<DotDeHapThu> & { id: string; installmentNo: number; amountDue: number }): DotDeHapThu => ({
  dueDate: null,
  daRot: 0,
  ...p,
});

/** Bình: đợt 1 ĐÃ TRẢ, đợt 2 và 3 chưa — đúng hình dạng TS-40. */
const DOT_1_DA_TRA = dot({
  id: "pr-1",
  installmentNo: 1,
  amountDue: 6_000_000,
  dueDate: new Date("2699-08-01T00:00:00Z"),
  daRot: 6_000_000,
});
const DOT_2 = dot({ id: "pr-2", installmentNo: 2, amountDue: 6_000_000, dueDate: new Date("2699-10-01T00:00:00Z") });
const DOT_3 = dot({ id: "pr-3", installmentNo: 3, amountDue: 6_000_000, dueDate: new Date("2699-12-01T00:00:00Z") });

describe("[UDC] hấp thụ phần giảm muộn vào các đợt", () => {
  it("[UDC-13] đợt ĐÃ CÓ TIỀN không bao giờ bị sửa, và được liệt kê ra", () => {
    // ⚠️ Vế quan trọng nhất của cụm: AC3 nói *"KHÔNG tạo quyết toán âm cho đợt đã thu"*, và
    // sửa `amountDue` của đợt đã thu là đúng con bug đang GHIM ở repo (`[PR-02d]`).
    // ⚠️ Dùng ĐỢT GẦN NHẤT có chủ đích. Đợt ĐÃ TRẢ ở fixture là đợt có hạn SỚM NHẤT, nên
    // chỉ chiều này mới đặt nó vào ĐẦU hàng chờ bị trừ — tức chỉ chiều này CẮN. Đo bằng cấy
    // lỗi: bản đầu của ca này dùng `DOT_XA_NHAT` và cấy "cho hấp thụ cả đợt đã có tiền" ra
    // **0 ca đỏ** ở đây (đợt xa nhất hút hết phần giảm trước khi tới đợt đã trả), tức ca
    // mang đúng cái tên mình lại không canh được thứ mình nói.
    const r = keHoachHapThu({
      dot: [DOT_1_DA_TRA, DOT_2],
      canGiam: 1_200_000,
      cach: CACH_HAP_THU.DOT_GAN_NHAT,
    });
    expect(r.doi.map((d) => d.id), "đợt ĐÃ TRẢ không được có trong danh sách sửa").toEqual([
      "pr-2",
    ]);
    expect(r.boQuaVeDaCoTien).toEqual([{ id: "pr-1", installmentNo: 1, daRot: 6_000_000 }]);
  });

  it("[UDC-14] ĐỢT XA NHẤT trước: đợt gần nhất giữ nguyên số phụ huynh đã nhận", () => {
    const r = keHoachHapThu({
      dot: [DOT_1_DA_TRA, DOT_2, DOT_3],
      canGiam: 1_200_000,
      cach: CACH_HAP_THU.DOT_XA_NHAT,
    });
    expect(r.doi).toEqual([{ id: "pr-3", installmentNo: 3, soCu: 6_000_000, soMoi: 4_800_000 }]);
    expect(r.daHapThu).toBe(1_200_000);
    expect(r.chuaHapThuDuoc).toBe(0);
  });

  it("[UDC-15] ĐỢT GẦN NHẤT trước: phụ huynh hưởng ngay lần đóng tới", () => {
    const r = keHoachHapThu({
      dot: [DOT_1_DA_TRA, DOT_2, DOT_3],
      canGiam: 1_200_000,
      cach: CACH_HAP_THU.DOT_GAN_NHAT,
    });
    expect(r.doi).toEqual([{ id: "pr-2", installmentNo: 2, soCu: 6_000_000, soMoi: 4_800_000 }]);
  });

  it("[UDC-16] CHIA ĐỀU: tổng khớp KHÍT, phần dư làm tròn dồn vào đợt CUỐI", () => {
    // Số cố ý KHÔNG chia hết: 1.000.001 / 2 đợt. Rải phần dư ra cho "đều" là mỗi đợt lệch
    // một ít và không ai cộng lại được đúng số.
    const r = keHoachHapThu({
      dot: [DOT_2, DOT_3],
      canGiam: 1_000_001,
      cach: CACH_HAP_THU.CHIA_DEU,
    });
    expect(r.doi).toHaveLength(2);
    const tongGiam = r.doi.reduce((s, d) => s + (d.soCu - d.soMoi), 0);
    expect(tongGiam, "tổng phần giảm phải khớp KHÍT").toBe(1_000_001);
    expect(r.doi.find((d) => d.installmentNo === 2)!.soMoi).toBe(6_000_000 - 500_000);
    expect(r.doi.find((d) => d.installmentNo === 3)!.soMoi).toBe(6_000_000 - 500_001);
  });

  it("[UDC-17] hấp thụ KHÔNG đủ ⇒ trả ra phần còn lại, KHÔNG nuốt", () => {
    // Nghĩa của `chuaHapThuDuoc` rất cụ thể: phụ huynh đã đóng NHIỀU HƠN học phí mới, tức bé
    // đóng thừa thật. Nuốt con số ấy là làm sổ khớp bằng cách giấu tiền của phụ huynh.
    const r = keHoachHapThu({
      dot: [DOT_1_DA_TRA, DOT_2],
      canGiam: 9_000_000,
      cach: CACH_HAP_THU.DOT_XA_NHAT,
    });
    expect(r.daHapThu).toBe(6_000_000);
    expect(r.chuaHapThuDuoc).toBe(3_000_000);
    expect(r.doi).toEqual([{ id: "pr-2", installmentNo: 2, soCu: 6_000_000, soMoi: 0 }]);
  });

  it("[UDC-18] không có đợt nào sửa được ⇒ toàn bộ phần giảm thành 'sẽ đóng thừa'", () => {
    const r = keHoachHapThu({
      dot: [DOT_1_DA_TRA],
      canGiam: 1_200_000,
      cach: CACH_HAP_THU.DOT_XA_NHAT,
    });
    expect(r.doi).toEqual([]);
    expect(r.chuaHapThuDuoc).toBe(1_200_000);
  });

  it("[UDC-18b] KHÔNG có đợt nào sửa được: nhánh NGẮT SỚM cũng phải trả đúng phần còn lại", () => {
    // ⚠️ `keHoachHapThu` có HAI đường trả `chuaHapThuDuoc`: nhánh ngắt sớm (không đợt nào
    // sửa được) và nhánh tính thật. Cấy lỗi vào một nhánh KHÔNG làm ca của nhánh kia đỏ —
    // đo được đúng điều đó, nên phải có ca cho từng nhánh.
    const r = keHoachHapThu({ dot: [], canGiam: 1_200_000, cach: CACH_HAP_THU.CHIA_DEU });
    expect(r.doi).toEqual([]);
    expect(r.daHapThu).toBe(0);
    expect(r.chuaHapThuDuoc).toBe(1_200_000);
  });

  it("[UDC-19] không phải giảm gì ⇒ không sửa đợt nào", () => {
    const r = keHoachHapThu({ dot: [DOT_2, DOT_3], canGiam: 0, cach: CACH_HAP_THU.CHIA_DEU });
    expect(r.doi).toEqual([]);
    expect(r.daHapThu).toBe(0);
  });

  it("[UDC-20] đợt KHÔNG CÓ HẠN xếp CUỐI ở CẢ HAI chiều", () => {
    // Đặt nó lên đầu chiều "xa nhất" là một đợt chưa hẹn ngày lại bị sửa trước mọi đợt khác.
    const khongHan = dot({ id: "pr-x", installmentNo: 9, amountDue: 6_000_000, dueDate: null });
    const lo = [DOT_2, DOT_3, khongHan];
    for (const cach of [CACH_HAP_THU.DOT_XA_NHAT, CACH_HAP_THU.DOT_GAN_NHAT] as const) {
      // Phần giảm vừa đủ hai đợt CÓ HẠN ⇒ đợt không hạn không bị chạm.
      const vua = keHoachHapThu({ dot: lo, canGiam: 12_000_000, cach });
      expect(vua.doi.map((d) => d.id).sort(), cach).toEqual(["pr-2", "pr-3"]);
      // Vượt quá ⇒ đợt không hạn mới bị lấy tới, và nó là đợt CUỐI CÙNG.
      const vuot = keHoachHapThu({ dot: lo, canGiam: 13_000_000, cach });
      expect(vuot.doi.find((d) => d.id === "pr-x")!.soMoi, cach).toBe(5_000_000);
    }
  });

  it("[UDC-20b] HAI đợt cùng KHÔNG CÓ HẠN ⇒ thứ tự vẫn XÁC ĐỊNH", () => {
    // ⚠️ Ca này bắt một lỗi THẬT của bản đầu: `dueDate ?? Infinity` rồi trừ cho ra
    // `Infinity - Infinity = NaN`, và một `NaN` trong hàm so sánh là thứ tự không xác định.
    // Cùng dữ liệu có thể ra hai kết quả — trong một hàm quyết định đợt nào bị sửa SỐ TIỀN.
    const x = dot({ id: "pr-x", installmentNo: 4, amountDue: 3_000_000, dueDate: null });
    const y = dot({ id: "pr-y", installmentNo: 5, amountDue: 3_000_000, dueDate: null });
    for (const dsach of [[x, y], [y, x]]) {
      // Xa nhất ⇒ số đợt LỚN hơn bị lấy trước.
      expect(
        keHoachHapThu({ dot: dsach, canGiam: 1_000_000, cach: CACH_HAP_THU.DOT_XA_NHAT })
          .doi.map((d) => d.id),
      ).toEqual(["pr-y"]);
      // Gần nhất ⇒ số đợt NHỎ hơn bị lấy trước.
      expect(
        keHoachHapThu({ dot: dsach, canGiam: 1_000_000, cach: CACH_HAP_THU.DOT_GAN_NHAT })
          .doi.map((d) => d.id),
      ).toEqual(["pr-x"]);
    }
  });

  it("[UDC-21] đợt số 0đ bị bỏ qua — không có gì để trừ ở đó", () => {
    const rong = dot({ id: "pr-0", installmentNo: 5, amountDue: 0, dueDate: new Date("2699-12-31T00:00:00Z") });
    const r = keHoachHapThu({ dot: [rong, DOT_2], canGiam: 500_000, cach: CACH_HAP_THU.DOT_XA_NHAT });
    expect(r.doi.map((d) => d.id)).toEqual(["pr-2"]);
  });
});
