// lib/finance/doi-soat-hoc-phi.test.ts — "EM NÀO ĐÓNG ĐỦ, EM NÀO CÒN THIẾU".
//
// Chủ dự án 14/09/2026: "sau khi nhập giao dịch cũ… tiền này nhập vào chưa chắc đã đóng
// full 100% thì bây giờ tôi cần 1 thứ để merge lại cái nào đã đóng full cái nào thiếu,
// phải làm rõ ràng để tôi nhập liệu lại số liệu cũ 1 cách chính xác, vì phần này sẽ show
// cho phụ huynh thấy là đã đóng bao nhiêu tiền rồi và còn thiếu bao nhiêu."
//
// ─────────────────────────────────────────────────────────────────────────────
// BA CON SỐ, KHÔNG PHẢI HAI — và đây là chỗ cả màn hình lẫn người đọc dễ sai nhất
//
//   · PHẢI ĐÓNG  = `Enrollment.finalPrice` (mẫu số). KHÔNG phải `Order.totalAmount`:
//     đơn sinh từ nhập sheet cố ý đặt `totalAmount = Σ tiền đã thu` (biên lai gom), nên
//     đo theo đơn thì đơn nào cũng "đủ" — đúng cái câu hỏi này đi tìm.
//   · ĐÃ GHI NHẬN = Σ `Payment` có `saleStatus = RECORDED` (trục B). Tiền vừa nhập nằm ở
//     đây.
//   · ĐÃ XÁC NHẬN = Σ `Payment` có `accountantStatus = CONFIRMED` (trục A). **Đây mới là
//     thứ cổng phụ huynh cộng** (`lib/portal/billing-student.ts`).
//
// Nhập sheet xong, khoản để `accountantStatus = PENDING` ⇒ trục A vẫn 0 ⇒ **phụ huynh
// vẫn thấy nợ nguyên** cho tới khi kế toán xác nhận ở /payments. Nếu màn chỉ in một con
// số "còn thiếu" thì nó hoặc nói dối người vận hành (dùng trục B: "đã đủ rồi" trong khi
// phụ huynh vẫn thấy nợ), hoặc nói dối về công việc còn lại (dùng trục A: "còn thiếu
// 8tr" trong khi tiền đã nằm trong hệ thống, chỉ chờ bấm xác nhận).
//
// Nên hàm này trả CẢ HAI con số thiếu, và trạng thái phân biệt rõ hai ca đó.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { doiSoatHocPhi, TRANG_THAI_HOC_PHI, NHAN_TRANG_THAI_HOC_PHI } from "./doi-soat-hoc-phi";

describe("[DSHP-01] chưa chốt giá — nguy hiểm nhất, và hôm nay đang BỊ GIẤU", () => {
  it("finalPrice null → CHUA_CHOT_GIA, kể cả khi đã có tiền vào", () => {
    // `getDebtRows` lọc `finalPrice: { not: null }` ⇒ nhóm này KHÔNG xuất hiện ở /cong-no.
    // Mà đó đúng là nhóm tệ nhất: nhà đã đóng tiền, hệ thống không biết phải đóng bao
    // nhiêu, nên không ai nợ ai trong sổ và không màn nào kêu.
    const r = doiSoatHocPhi({ hocPhi: null, daGhiNhan: 8_640_000, daXacNhan: 0 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA);
    expect(r.daThu).toBe(8_640_000);
  });

  it("finalPrice = 0 cũng là CHƯA CHỐT GIÁ, không phải 'đã đóng đủ'", () => {
    // 0đ mà gọi là "đủ" thì mọi em chưa chốt giá đều biến thành em ngoan.
    expect(doiSoatHocPhi({ hocPhi: 0, daGhiNhan: 0, daXacNhan: 0 }).trangThai).toBe(
      TRANG_THAI_HOC_PHI.CHUA_CHOT_GIA,
    );
  });

  it("chưa chốt giá thì KHÔNG bịa số còn thiếu", () => {
    const r = doiSoatHocPhi({ hocPhi: null, daGhiNhan: 1_000_000, daXacNhan: 1_000_000 });
    expect(r.conThieuPhuHuynhThay).toBe(0);
    expect(r.conThieuThucTe).toBe(0);
    expect(r.phaiDong).toBe(0);
  });
});

describe("[DSHP-02] hai con số THIẾU khác nhau — trục A và trục B", () => {
  it("vừa nhập sheet xong: tiền đã vào nhưng kế toán chưa xác nhận", () => {
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 8_640_000, daXacNhan: 0 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.CHO_XAC_NHAN);
    // Phụ huynh mở cổng ra vẫn thấy nợ nguyên — đây là sự thật, không được giấu.
    expect(r.conThieuPhuHuynhThay).toBe(8_640_000);
    // Còn việc thật sự phải làm là bấm xác nhận, không phải đi đòi tiền.
    expect(r.conThieuThucTe).toBe(0);
    expect(r.choXacNhan).toBe(8_640_000);
  });

  it("kế toán xác nhận rồi → ĐỦ, hai số thiếu cùng về 0", () => {
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 8_640_000, daXacNhan: 8_640_000 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.DU);
    expect(r.conThieuPhuHuynhThay).toBe(0);
    expect(r.conThieuThucTe).toBe(0);
    expect(r.choXacNhan).toBe(0);
  });

  it("đóng MỘT PHẦN, đã xác nhận hết phần đó → THIẾU, hai số thiếu bằng nhau", () => {
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 3_320_000, daXacNhan: 3_320_000 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.THIEU);
    expect(r.conThieuPhuHuynhThay).toBe(5_320_000);
    expect(r.conThieuThucTe).toBe(5_320_000);
  });

  it("đóng một phần, phần đó CHƯA xác nhận → vẫn THIẾU, nhưng hai số lệch nhau", () => {
    // Ca hay gặp nhất ngay sau khi nhập sheet cho em đóng chưa đủ.
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 3_320_000, daXacNhan: 0 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.THIEU);
    expect(r.conThieuPhuHuynhThay).toBe(8_640_000);
    expect(r.conThieuThucTe).toBe(5_320_000);
    expect(r.choXacNhan).toBe(3_320_000);
  });
});

describe("[DSHP-03] chưa đóng đồng nào", () => {
  it("có giá, chưa có tiền → CHUA_DONG (tách khỏi THIẾU)", () => {
    // Tách riêng vì việc phải làm khác hẳn: em THIẾU thì đi đòi phần còn lại, em
    // CHƯA ĐÓNG thì phải kiểm xem có phải quên nhập không.
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 0, daXacNhan: 0 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.CHUA_DONG);
    expect(r.conThieuPhuHuynhThay).toBe(8_640_000);
    expect(r.conThieuThucTe).toBe(8_640_000);
  });
});

describe("[DSHP-04] thu vượt", () => {
  it("ghi nhận nhiều hơn học phí → THU_VUOT, nêu phần vượt", () => {
    const r = doiSoatHocPhi({ hocPhi: 8_640_000, daGhiNhan: 10_000_000, daXacNhan: 10_000_000 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.THU_VUOT);
    expect(r.traVuot).toBe(1_360_000);
    expect(r.conThieuThucTe).toBe(0);
  });

  it("thu vượt đo theo trục B — tiền đã vào là đã vào, chưa xác nhận vẫn là vượt", () => {
    const r = doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 6_000_000, daXacNhan: 0 });
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.THU_VUOT);
    expect(r.traVuot).toBe(1_000_000);
  });
});

describe("[DSHP-05] số rác không được thành tiền", () => {
  it("âm / NaN / Infinity → coi như 0, không ném", () => {
    const r = doiSoatHocPhi({
      hocPhi: 5_000_000,
      daGhiNhan: Number.NaN,
      daXacNhan: -1_000,
    });
    expect(r.daThu).toBe(0);
    expect(r.daXacNhan).toBe(0);
    expect(r.trangThai).toBe(TRANG_THAI_HOC_PHI.CHUA_DONG);
  });

  it("đã xác nhận LỚN HƠN đã ghi nhận → không cho ra số âm", () => {
    // Không nên xảy ra, nhưng hai trục ghi ở hai đường nên lệch được. `choXacNhan` âm
    // in ra màn là một câu vô nghĩa.
    const r = doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 1_000_000, daXacNhan: 2_000_000 });
    expect(r.choXacNhan).toBe(0);
  });
});

describe("[DSHP-06] mọi trạng thái đều có nhãn đọc được", () => {
  it("không thiếu nhãn nào — thiếu một cái là màn in ra mã máy", () => {
    for (const t of Object.values(TRANG_THAI_HOC_PHI)) {
      expect(NHAN_TRANG_THAI_HOC_PHI[t]).toBeTruthy();
    }
  });
});

describe("[DSHP-07] KHÔNG đẻ phép tính tiền thứ hai", () => {
  it("phaiDong/daThu/traVuot khớp với congNoDon — cùng một nhà", () => {
    // `lib/finance/cong-no-don.ts` đã là nơi tính bộ số này cho ĐƠN. Hàm ở đây chỉ đổi
    // mẫu số (finalPrice thay cho totalAmount) và thêm phần phân loại — nó GỌI lại,
    // không chép công thức. Hai công thức là hai con số, và người ta sẽ tin con số trên màn.
    const r = doiSoatHocPhi({ hocPhi: 8_000_000, daGhiNhan: 9_000_000, daXacNhan: 7_000_000 });
    expect(r.phaiDong).toBe(8_000_000);
    expect(r.daThu).toBe(9_000_000);
    expect(r.daXacNhan).toBe(7_000_000);
    expect(r.traVuot).toBe(1_000_000);
    expect(r.choXacNhan).toBe(2_000_000);
  });
});

describe("[DSHP-08] TRỤC A > TRỤC B — hình dạng KHÔNG THỂ CÓ trên dữ liệu thật", () => {
  // Kế toán chỉ xác nhận được khoản mà sale đã ghi nhận, nên A ⊆ B. A > B nghĩa là một
  // trong hai trục đang đọc sai — và nó CÓ THẬT trên mọi môi trường test:
  // `prisma/seed-uat/04-tai-chinh.ts` đặt toàn bộ `saleStatus = COLLECT_CONFIRMED`, mà
  // `KHOAN_DA_GHI_NHAN` lọc BẰNG "RECORDED" ⇒ trục B ra 0đ trong khi trục A có tiền
  // (đo 14/09 trên satarobo_local: 379/380 khoản COLLECT_CONFIRMED, Σ RECORDED = 1 khoản).
  //
  // Trên PROD không có hình dạng này (đo 07/09: 1 Payment, không đường ghi
  // COLLECT_CONFIRMED nào trong mã chạy thật — nó chỉ là nhãn UI + seed). Nhưng nếu nó
  // xuất hiện thì đó là tín hiệu webhook/ghi sổ hỏng, đúng thứ hai trục sinh ra để bắt.
  // Nên cờ này phục vụ CẢ HAI: không để người nghiệm thu tưởng màn hỏng, và không để
  // lỗi thật trôi qua.
  it("nêu cờ khi đã xác nhận NHIỀU HƠN đã ghi nhận", () => {
    const r = doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 0, daXacNhan: 4_000_000 });
    expect(r.lechTrucBatThuong).toBe(true);
  });

  it("không nêu cờ ở ca bình thường", () => {
    expect(
      doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 5_000_000, daXacNhan: 0 }).lechTrucBatThuong,
    ).toBe(false);
    expect(
      doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 5_000_000, daXacNhan: 5_000_000 })
        .lechTrucBatThuong,
    ).toBe(false);
  });

  it("trục A vẫn được DÙNG, không bị vứt — phụ huynh đang thấy nó", () => {
    // Cám dỗ: thấy lệch thì lấy max(A,B) cho "đẹp". Làm vậy là bịa ra một con số thứ ba
    // không trục nào có, và số phụ huynh thấy vẫn là A.
    const r = doiSoatHocPhi({ hocPhi: 5_000_000, daGhiNhan: 0, daXacNhan: 4_000_000 });
    expect(r.daXacNhan).toBe(4_000_000);
    expect(r.conThieuPhuHuynhThay).toBe(1_000_000);
  });
});
