// lib/finance/gan-ghi-danh-khoan.test.ts — GẮN KHOẢN THU VÀO GHI DANH.
//
// Chủ dự án 14/09/2026, chỉ vào màn Thanh toán: "bấm xem thử xong chỉ xem và không có
// thao tác gì nữa à?"
//
// Đúng. Khối "Học phí nhập từ file Excel" đếm được số khoản bị bỏ và nêu lý do, nhưng
// không cho làm gì với chúng. Mà lý do phổ biến nhất — **"Chưa gắn ghi danh — không sinh
// được phiếu thu"** (`LY_DO_BO.CHUA_GAN_GHI_DANH`) — là thứ SỬA ĐƯỢC: chỉ cần trỏ khoản
// đó vào đúng ghi danh của em. Không có đường sửa thì tiền nằm mãi ở trạng thái chờ, và
// cổng phụ huynh vẫn hiện nợ dù nhà đã đóng.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO KHÔNG TỰ GẮN LÚC NHẬP
//
// `ghi-giao-dich-cu.ts` CÓ tự gắn — nhưng chỉ khi KHÔNG MƠ HỒ: đúng một ghi danh còn
// sống. Em học hai lớp thì phải chia tiền theo `finalPrice`, và đoán hộ ở đó là ghi tiền
// vào lớp sai. Nên phần còn lại rơi xuống đây, cho người xử lý tay.
//
// Hàm này giữ NGUYÊN luật đó: gợi ý khi chắc, bắt chọn khi mơ hồ, không bao giờ tự quyết.
import { describe, it, expect } from "vitest";
import {
  chonGhiDanhChoKhoan,
  dongVuongMac,
  mucGanChoKhoan,
  vuongMacCuaKhoan,
  MUC_GAN,
  type KhoanChoGan,
} from "./gan-ghi-danh-khoan";
import { LY_DO_BO } from "./backfill-confirm";
import { NGUON_KHOAN, gatewayMarker, BACKFILL_PAYMENT_MARKER } from "./payment-markers";

const gd = (id: string, x: Partial<{ tenLop: string; tenKhoa: string; finalPrice: number | null }> = {}) => ({
  id,
  tenLop: x.tenLop ?? "Lớp A",
  tenKhoa: x.tenKhoa ?? "Sata 3",
  finalPrice: x.finalPrice ?? 10_560_000,
});

describe("[GGK-01] đúng MỘT ghi danh → gợi ý sẵn", () => {
  it("một ghi danh sống → CHAC_CHAN, có id", () => {
    const r = chonGhiDanhChoKhoan([gd("e1")]);
    expect(r.muc).toBe(MUC_GAN.CHAC_CHAN);
    expect(r.ghiDanhId).toBe("e1");
  });
});

describe("[GGK-02] nhiều ghi danh → BẮT CHỌN, tuyệt đối không đoán", () => {
  it("hai ghi danh → PHAI_CHON, KHÔNG trả id nào", () => {
    // Cám dỗ: lấy cái mới nhất, hoặc cái đắt nhất. Cả hai đều là ghi tiền vào lớp sai
    // mà không ai biết — khoản đã gắn rồi thì công nợ của lớp kia vẫn nguyên.
    const r = chonGhiDanhChoKhoan([gd("e1"), gd("e2", { tenLop: "Lớp B" })]);
    expect(r.muc).toBe(MUC_GAN.PHAI_CHON);
    expect(r.ghiDanhId).toBeNull();
  });

  it("trả ĐỦ danh sách để màn bày ra cho người chọn", () => {
    const ds = [gd("e1"), gd("e2"), gd("e3")];
    expect(chonGhiDanhChoKhoan(ds).ungVien).toHaveLength(3);
  });
});

describe("[GGK-03] không có ghi danh nào → nói ra, không im lặng", () => {
  it("rỗng → KHONG_CO, không id", () => {
    const r = chonGhiDanhChoKhoan([]);
    expect(r.muc).toBe(MUC_GAN.KHONG_CO);
    expect(r.ghiDanhId).toBeNull();
  });

  it("KHONG_CO là ca cần NGƯỜI làm việc khác — không phải lỗi của khoản", () => {
    // Em chưa được xếp lớp. Việc phải làm là tạo ghi danh, không phải sửa khoản thu.
    // Màn phải chỉ đúng chỗ đó thay vì bày một ô chọn rỗng.
    expect(chonGhiDanhChoKhoan([]).ungVien).toEqual([]);
  });
});

describe("[GGK-04] ghi danh CHƯA CHỐT GIÁ vẫn là ứng viên hợp lệ", () => {
  it("finalPrice null không loại ghi danh khỏi danh sách", () => {
    // Gắn khoản vào ghi danh chưa chốt giá là hợp lệ: tiền đã thu là có thật, còn mẫu số
    // sửa ở màn Đối soát học phí. Loại nó ra ở đây là bắt người dùng làm đúng thứ tự mà
    // không ai nói cho họ biết.
    const r = chonGhiDanhChoKhoan([gd("e1", { finalPrice: null })]);
    expect(r.muc).toBe(MUC_GAN.CHAC_CHAN);
    expect(r.ghiDanhId).toBe("e1");
  });
});

describe("[GGK-05] thứ tự đầu vào không đổi kết quả", () => {
  it("cùng tập ghi danh, đảo thứ tự → cùng mức", () => {
    const a = chonGhiDanhChoKhoan([gd("e1"), gd("e2")]);
    const b = chonGhiDanhChoKhoan([gd("e2"), gd("e1")]);
    expect(a.muc).toBe(b.muc);
    expect(a.ghiDanhId).toBe(b.ghiDanhId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI VÀO DANH SÁCH "KHOẢN BỊ BỎ" — bản vá 14/09/2026
//
// Bug: `khoanBiBoAction` lọc `note contains "[backfill-import]"`, nên khoản do webhook
// cổng thanh toán sinh (`[auto:payos:<txn>]`) KHÔNG BAO GIỜ hiện ra để gắn ghi danh —
// dù `payos-ingest.ts` CỐ Ý để `enrollmentId = null` mỗi khi mơ hồ và ghi rõ rằng ca đó
// nhường cho NGƯỜI quyết. Người đó không có màn nào để quyết, `confirmPayment` từ chối
// vì `!enrollmentId`, và tiền thật đã về tài khoản vẫn nằm ngoài công nợ.
const khoan = (x: Partial<KhoanChoGan> = {}): KhoanChoGan => ({
  id: x.id ?? "p1",
  note: x.note === undefined ? null : x.note,
  accountantStatus: x.accountantStatus ?? "PENDING",
  paymentType: x.paymentType ?? "PAYMENT",
  enrollmentId: x.enrollmentId === undefined ? null : x.enrollmentId,
  recordedById: x.recordedById === undefined ? "u-sale" : x.recordedById,
  amount: x.amount ?? 3_000_000,
  loaiDon: x.loaiDon === undefined ? "COURSE" : x.loaiDon,
});
const TOI = "u-ke-toan";

describe("[GGK-06] tiền về qua cổng, chưa gắn lớp → PHẢI hiện ra để gắn", () => {
  it("khoản [auto:payos:*] chưa gắn ghi danh → hiện, gắn được", () => {
    // ĐÂY LÀ CA BUG. Trước bản vá khoản này không lọt qua bộ lọc `note contains
    // [backfill-import]` nên không dòng nào hiện ra, và không thao tác nào tồn tại.
    const v = vuongMacCuaKhoan(
      khoan({ note: `Tiền về qua PAYOS 9912 ${gatewayMarker("payOS", "9912")}` }),
      TOI,
    );
    expect(v.hien).toBe(true);
    if (!v.hien) return;
    expect(v.lyDo).toBe(LY_DO_BO.CHUA_GAN_GHI_DANH);
    expect(v.nguon).toBe(NGUON_KHOAN.CONG_THANH_TOAN);
    expect(v.ganDuoc).toBe(true);
  });

  it("khoản kế toán GÕ TAY, chưa gắn lớp → cũng hiện (không marker nào cả)", () => {
    // Không có marker ≠ không phải tiền. Đường `recordPayment` cho phép ghi khoản không
    // gắn ghi danh, và nó vướng đúng một chỗ với khoản cổng.
    const v = vuongMacCuaKhoan(khoan({ note: "Phụ huynh đóng tiền mặt tại CS1" }), TOI);
    expect(v.hien).toBe(true);
    if (!v.hien) return;
    expect(v.nguon).toBe(NGUON_KHOAN.NGUOI_NHAP);
    expect(v.ganDuoc).toBe(true);
  });

  it("LÝ DO phải là câu SỬA ĐƯỢC, không phải 'không phải khoản nhập liệu ban đầu'", () => {
    // Cám dỗ: mở bộ lọc DB rồi vẫn hỏi `nenXacNhanHangLoat` cho mọi dòng. Khoản cổng sẽ
    // hiện ra với lý do `KHONG_PHAI_BACKFILL` — đúng về chữ, vô dụng với người cầm chuột,
    // và tệ hơn: nó bảo họ rằng ở đây không có việc gì để làm.
    const v = vuongMacCuaKhoan(khoan({ note: gatewayMarker("sepay", "T77") }), TOI);
    // Hai vế RỜI NHAU, cố ý: viết `expect(v.hien && v.lyDo).not.toBe(...)` thì ca `hien:
    // false` cho ra `false`, và `false !== "Không phải khoản..."` nên lưới XANH đúng lúc
    // khoản biến mất khỏi màn. Đã cấy thử và thấy nó xanh giả.
    expect(v.hien).toBe(true);
    if (!v.hien) return;
    expect(v.lyDo).not.toBe(LY_DO_BO.KHONG_PHAI_BACKFILL);
  });
});

describe("[GGK-07] khoản ĐÃ gắn lớp mà không phải backfill → KHÔNG hiện", () => {
  it("không đổ cả bảng Thanh toán vào danh sách việc-phải-làm", () => {
    // Đo satarobo_local 14/09: 44/45 khoản PENDING đã có `enrollmentId` và chỉ đang chờ
    // kế toán bấm xác nhận từng cái ở bảng chính. Cho chúng vào đây là nhân đôi màn hình
    // và chôn mất đúng những dòng cần người xử lý.
    const v = vuongMacCuaKhoan(
      khoan({ note: gatewayMarker("payos", "9912"), enrollmentId: "e1" }),
      TOI,
    );
    expect(v.hien).toBe(false);
  });
});

describe("[GGK-08] nhóm backfill giữ NGUYÊN luật cũ — không lệch với khối Xem thử", () => {
  const bf = (x: Partial<KhoanChoGan> = {}) =>
    khoan({ note: `học phí cũ ${BACKFILL_PAYMENT_MARKER}`, ...x });

  it("khoản backfill ĐỦ điều kiện vào lượt hàng loạt → KHÔNG phải 'bị bỏ'", () => {
    expect(vuongMacCuaKhoan(bf({ enrollmentId: "e1", recordedById: "u-khac" }), TOI).hien).toBe(
      false,
    );
  });

  it("backfill đã gắn lớp nhưng TỰ XÁC NHẬN → vẫn hiện, và KHÔNG gắn được", () => {
    // Cổng tách nhiệm vụ giữ nguyên. Điều phải đúng là màn KHÔNG bày nút Gắn cho dòng
    // này — nó đã có lớp rồi, bấm Gắn chỉ ăn một thông báo lỗi.
    const v = vuongMacCuaKhoan(bf({ enrollmentId: "e1", recordedById: TOI }), TOI);
    expect(v.hien).toBe(true);
    if (!v.hien) return;
    expect(v.lyDo).toBe(LY_DO_BO.TU_XAC_NHAN);
    expect(v.ganDuoc).toBe(false);
  });

  it("backfill chưa gắn lớp → hiện với đúng lý do cũ, và gắn được", () => {
    const v = vuongMacCuaKhoan(bf({ recordedById: "u-khac" }), TOI);
    expect(v.hien && v.lyDo).toBe(LY_DO_BO.CHUA_GAN_GHI_DANH);
    expect(v.hien && v.nguon).toBe(NGUON_KHOAN.NHAP_LICH_SU);
  });
});

describe("[GGK-09] ba nhóm KHÔNG BAO GIỜ hiện — lý do ở mỗi nhóm một khác", () => {
  it("bút toán ADJUSTMENT: ghi danh thuộc phiếu GỐC, không thuộc delta", () => {
    expect(
      vuongMacCuaKhoan(khoan({ paymentType: "ADJUSTMENT", amount: -500_000 }), TOI).hien,
    ).toBe(false);
  });

  it("dòng hoàn tiền (amount âm): trả tiền lại không phải 'khoản chưa có chỗ đậu'", () => {
    expect(vuongMacCuaKhoan(khoan({ amount: -2_000_000 }), TOI).hien).toBe(false);
    expect(vuongMacCuaKhoan(khoan({ amount: 0 }), TOI).hien).toBe(false);
  });

  it("đã có người quyết xong (CONFIRMED / REJECTED / REFUNDED) → không mời quyết lại", () => {
    for (const st of ["CONFIRMED", "REJECTED", "REFUNDED"]) {
      expect(vuongMacCuaKhoan(khoan({ accountantStatus: st }), TOI).hien, st).toBe(false);
    }
  });
});

describe("[GGK-10] mức gắn phải NÓI THẬT — luật 12", () => {
  const gd1 = [gd("e1")];

  it("khoản đã gắn lớp → DA_GAN, KHÔNG ứng viên nào (màn không bày nút Gắn)", () => {
    // Trước bản vá: action gọi thẳng `chonGhiDanhChoKhoan(ghi danh của em)` nên dòng này
    // ra CHAC_CHAN ⇒ ô chọn + nút "Gắn" ⇒ bấm vào thì đường ghi từ chối. Lời hứa suông
    // không ném lỗi, không làm test đỏ, console vẫn sạch.
    const r = mucGanChoKhoan({ daGanGhiDanh: true, coHocVien: true, ghiDanh: gd1 });
    expect(r.muc).toBe(MUC_GAN.DA_GAN);
    expect(r.ungVien).toEqual([]);
    expect(r.ghiDanhId).toBeNull();
  });

  it("đơn không gắn học viên → THIEU_HOC_VIEN, KHÁC 'em chưa có ghi danh nào'", () => {
    // Hai ca cùng ra mảng rỗng nhưng việc phải làm khác hẳn: ca này phải mở ĐƠN gắn học
    // viên, không phải sang trang Ghi danh tạo lớp cho một người chưa biết là ai.
    const r = mucGanChoKhoan({ daGanGhiDanh: false, coHocVien: false, ghiDanh: [] });
    expect(r.muc).toBe(MUC_GAN.THIEU_HOC_VIEN);
    expect(r.muc).not.toBe(MUC_GAN.KHONG_CO);
  });

  it("còn lại ủy quyền nguyên vẹn cho chonGhiDanhChoKhoan", () => {
    expect(mucGanChoKhoan({ daGanGhiDanh: false, coHocVien: true, ghiDanh: gd1 })).toEqual(
      chonGhiDanhChoKhoan(gd1),
    );
    expect(
      mucGanChoKhoan({ daGanGhiDanh: false, coHocVien: true, ghiDanh: [gd("e1"), gd("e2")] }).muc,
    ).toBe(MUC_GAN.PHAI_CHON);
    // Em có học viên nhưng chưa xếp lớp → vẫn là KHONG_CO, đường sang /enrollments đúng.
    expect(mucGanChoKhoan({ daGanGhiDanh: false, coHocVien: true, ghiDanh: [] }).muc).toBe(
      MUC_GAN.KHONG_CO,
    );
  });
});

describe("[GGK-11] dòng chữ trên màn phải nói KHOẢN NÀY Ở ĐÂU RA", () => {
  it("ghép lý do · nguồn · việc phải làm, bỏ vế rỗng", () => {
    // Sau bản vá danh sách TRỘN nhiều nguồn. "Chưa gắn ghi danh" của một khoản nhập Excel
    // và của một khoản tiền về qua QR là hai tình huống khác hẳn — cái sau nghĩa là khách
    // ĐÃ CHUYỂN TIỀN THẬT. Không nói nguồn thì hai dòng giống hệt nhau.
    expect(dongVuongMac(LY_DO_BO.CHUA_GAN_GHI_DANH, NGUON_KHOAN.CONG_THANH_TOAN)).toBe(
      "Chưa gắn ghi danh — không sinh được phiếu thu · tiền về qua cổng thanh toán",
    );
    expect(dongVuongMac("X", NGUON_KHOAN.NGUOI_NHAP, null)).toBe("X · người dùng ghi nhận tay");
    expect(dongVuongMac("X", NGUON_KHOAN.NHAP_LICH_SU, "làm Y trước")).toBe(
      "X · nhập từ file Excel · làm Y trước",
    );
  });
});

describe("[GGK-12] khoản đơn KIT / THI chưa gắn ghi danh KHÔNG vào danh sách 'chờ gắn'", () => {
  // Đơn kit/thi không có ghi danh nào để gắn (`lib/finance/can-ghi-danh.ts`); bày nó với lý do
  // "Chưa gắn ghi danh" + nút Gắn là lời hứa suông (luật 12) — lõi xác nhận đã nhận nó rồi.
  for (const loaiDon of ["PRODUCT", "EXAM"]) {
    it(`${loaiDon} · tiền về qua cổng ⇒ không hiện`, () => {
      expect(vuongMacCuaKhoan(khoan({ note: gatewayMarker("sepay", "K1"), loaiDon }), TOI).hien).toBe(false);
    });
  }
  it("đối chứng: COURSE / không có đơn ⇒ VẪN hiện 'chưa gắn ghi danh'", () => {
    for (const loaiDon of ["COURSE", null]) {
      const v = vuongMacCuaKhoan(khoan({ note: gatewayMarker("sepay", "K1"), loaiDon }), TOI);
      expect(v).toMatchObject({ hien: true, lyDo: LY_DO_BO.CHUA_GAN_GHI_DANH });
    }
  });
});
