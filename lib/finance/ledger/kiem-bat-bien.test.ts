// Ca [BB-*] — bộ kiểm bất biến B1–B9. Phủ TS-01 (US-02/AC2, AC4).
//
// Luật của US-02/AC4: **mỗi bất biến phải có ít nhất một ca "vi phạm thì bị bắt"**. Một bộ kiểm
// mà không ai từng thấy nó ĐỎ thì không khác gì một hàm trả về `[]`.
//
// Và luật ngược lại cũng phải canh: ảnh chụp GỐC và ảnh chụp SAU TÌNH HUỐNG A đều phải SẠCH.
// Một bộ kiểm quá tay còn tệ hơn không có — nó báo đỏ mỗi đêm, và người ta học cách bỏ qua.
import { describe, it, expect } from "vitest";
import { kiemBatBien, sachBatBien, type AnhChupGiaDinh } from "./kiem-bat-bien";
import {
  anhChupGoc,
  anhChupSauTinhHuongA,
  GD_MAU,
  KY_VONG_A,
  OI,
  PHAP_NHAN,
  PHAP_NHAN_KHAC,
  PR,
  SO_CHOT_DON,
  TXN_1,
} from "@/tests/fixtures/gia-dinh-mau";

const ma = (a: AnhChupGiaDinh) => kiemBatBien(a).map((x) => x.ma);

describe("[BB-00] KHÔNG dương tính giả — hai ảnh chụp đúng phải SẠCH", () => {
  it("ảnh chụp gốc (kỳ thu 01 đã trả đủ) sạch", () => {
    expect(kiemBatBien(anhChupGoc())).toEqual([]);
  });

  it("ảnh chụp SAU tình huống A sạch — kể cả khi có con đã STOPPED và một nghiệp vụ chuyển", () => {
    // Đây là ca có giá trị nhất của cả bộ: dữ liệu ĐÚNG nhưng phức tạp (bảng giá tách đoạn, một
    // dòng dừng học có quyết toán, một cặp chuyển tiền). Bộ kiểm quá tay sẽ đỏ ở đây.
    expect(kiemBatBien(anhChupSauTinhHuongA())).toEqual([]);
    expect(sachBatBien(anhChupSauTinhHuongA())).toBe(true);
  });
});

describe("[BB-01] B1 — 0 ≤ Đã thu ≤ Phải thu", () => {
  it("thêm 100.000 vào Bình vượt phải thu ⇒ B1", () => {
    // TS-01 bước 2. Ca này cũng làm đỏ B5 (tiền từ đâu ra?) — và đó ĐÚNG: một khoản tiền xuất
    // hiện không có giao dịch nào sinh ra nó thì cả hai bất biến đều phải kêu.
    const a = anhChupSauTinhHuongA();
    a.dong[1]!.daThu += 100_000;
    expect(ma(a)).toContain("B1");
  });

  it("đã thu ÂM cũng là B1 — không chỉ canh vế trên", () => {
    // Vế `daThu < 0` dễ bị bỏ vì "làm sao âm được". Nó âm được: một dòng điều chỉnh DELTA âm
    // lớn hơn phần đã thu, hoặc một phép trừ chạy hai lần.
    const a = anhChupGoc();
    a.dong[0]!.daThu = -1;
    const vp = kiemBatBien(a).filter((x) => x.ma === "B1");
    expect(vp).toHaveLength(1);
    expect(vp[0]!.moTa).toContain("ÂM");
  });

  it("đã thu ĐÚNG BẰNG phải thu là hợp lệ, không phải vi phạm", () => {
    const a = anhChupSauTinhHuongA();
    expect(a.dong[1]!.daThu).toBe(a.dong[1]!.phaiThu); // Bình: 5.000.000 / 5.000.000
    expect(ma(a)).not.toContain("B1");
  });
});

describe("[BB-02] B2 — mỗi giao dịch vào chia hết, không đồng nào bốc hơi", () => {
  it("xoá một phần đã rót ⇒ B2 (và B5)", () => {
    // TS-01 bước 5.
    const a = anhChupGoc();
    a.giaoDich[0]!.daRot -= SO_CHOT_DON.binh.dot[0];
    a.dong[1]!.daThu -= SO_CHOT_DON.binh.dot[0];
    const codes = ma(a);
    expect(codes).toContain("B2");
    // B5 KHÔNG đỏ ở đây: cả hai vế cùng giảm 6.000.000 nên tổng vẫn cân. Đó là lý do B2 tồn tại
    // riêng — B5 một mình không bắt được ca "tiền về nhiều hơn số đã gán".
    expect(codes).not.toContain("B5");
  });

  it("phân bổ MỘT PHẦN ⇒ B2, kể cả khi thiếu đúng 1đ", () => {
    // Đây là điểm luật mới MẠNH HƠN bản BA: không có trạng thái "đã chia 8 triệu, còn 2 triệu ở
    // ví". Mỗi tình trạng trung gian là một thứ phải có màn để xử lý, quyền để gác, báo cáo để
    // theo dõi — luật mới xoá cả nhóm đó bằng cách không cho nó tồn tại.
    const a = anhChupGoc();
    a.giaoDich[0]!.daRot = SO_CHOT_DON.kyThu01 - 1;
    a.dong[0]!.daThu -= 1;
    const vp = kiemBatBien(a).find((x) => x.ma === "B2");
    expect(vp?.lech).toBe(-1);
  });

  it("phân bổ 0đ là HỢP LỆ — tiền lệch số nằm nguyên chờ kế toán hoàn", () => {
    const a = anhChupGoc();
    a.giaoDich.push({ bankTransactionId: "txn-lech", soTien: 3_000_000, daRot: 0 });
    expect(ma(a)).not.toContain("B2");
  });
});

describe("[BB-03] B3 — nghiệp vụ chuyển nội bộ cộng ra 0", () => {
  it("chuyển −500.000 nhưng chỉ ghi +400.000 ⇒ B3", () => {
    // TS-01 bước 3.
    const a = anhChupGoc();
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-lech",
      dong: [
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -500_000, nguonDaXacNhan: 6_000_000 },
        { tai: OI.an, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: 400_000 },
      ],
    });
    const vp = kiemBatBien(a).find((x) => x.ma === "B3");
    expect(vp?.lech).toBe(-100_000);
  });
});

describe("[BB-04] B4 — ví không âm", () => {
  it("ví −1 ⇒ B4", () => {
    // TS-01 bước 4. Số 1 đồng là có chủ ý: cổng phải bắt vi phạm NHỎ NHẤT, không chỉ vi phạm to.
    const a = anhChupGoc();
    a.vi.push({ phapNhanId: PHAP_NHAN, amount: -1 });
    expect(ma(a)).toContain("B4");
  });

  it("ví âm ở pháp nhân này KHÔNG được bù bằng ví dương ở pháp nhân kia", () => {
    // Bù chéo là đúng thứ B8 cấm, nhưng B4 phải tự bắt được nó: cộng tổng hai ví ra 0 trông
    // "cân", trong khi thực tế một pháp nhân đang âm tiền.
    const a = anhChupGoc();
    a.vi.push({ phapNhanId: PHAP_NHAN, amount: -500_000 });
    a.vi.push({ phapNhanId: PHAP_NHAN_KHAC, amount: 500_000 });
    expect(ma(a)).toContain("B4");
  });
});

describe("[BB-05] B5 — cân gia đình", () => {
  it("bốc hơi một khoản đã thu ⇒ B5", () => {
    const a = anhChupGoc();
    a.dong[0]!.daThu -= 320_000;
    const vp = kiemBatBien(a).find((x) => x.ma === "B5");
    expect(vp?.lech).toBe(320_000);
  });

  it("ví là một VẾ của B5 — tiền nằm ở ví vẫn phải cân", () => {
    // Ví nay CHỈ nhận tiền từ nghiệp vụ nội bộ (em nghỉ học, dư chuyển sang), không nhận trực
    // tiếp từ giao dịch ngân hàng nữa. Nên ca này dựng đúng đường đó: rút 500.000 khỏi dòng của
    // Bình đưa vào ví, tổng vẫn phải khớp.
    const a = anhChupGoc();
    a.dong[1]!.daThu -= 500_000;
    a.vi.push({ phapNhanId: PHAP_NHAN, amount: 500_000 });
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-du-vao-vi",
      dong: [
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -500_000, nguonDaXacNhan: 6_000_000 },
        { tai: "VI", giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: 500_000 },
      ],
    });
    expect(kiemBatBien(a)).toEqual([]);
  });

  it("giao dịch LỆCH SỐ (chưa phân bổ) KHÔNG làm B5 đỏ", () => {
    // Tính cả tiền chưa phân bổ thì mỗi khoản đang chờ kế toán hoàn sẽ làm kiểm cân đêm đỏ — và
    // một cảnh báo đỏ thường trực là một cảnh báo bị bỏ qua.
    //
    // Đây cũng là một TÍNH CHẤT ĐẸP của luật mới, đáng ghim: tiền chưa phân bổ KHÔNG BAO GIỜ vào
    // sổ gia đình, nên nó không thể làm lệch sổ. Hoàn nó chỉ là đánh dấu giao dịch đã xử lý +
    // lưu chứng từ, không sinh bút toán nào.
    const a = anhChupGoc();
    a.giaoDich.push({ bankTransactionId: "txn-lech-so", soTien: 3_000_000, daRot: 0 });
    expect(kiemBatBien(a)).toEqual([]);
  });
});

describe("[BB-06] B6 — Σ đợt = học phí (STOPPED: = giá trị quyết toán)", () => {
  it("Σ đợt lệch học phí ⇒ B6", () => {
    const a = anhChupGoc();
    a.dong[0]!.phaiThu -= 1_000;
    const vp = kiemBatBien(a).find((x) => x.ma === "B6");
    expect(vp?.lech).toBe(-1_000);
  });

  it("dòng STOPPED so với GIÁ TRỊ QUYẾT TOÁN, không so với học phí gốc", () => {
    // Bình: học phí 12.000.000 nhưng sau quyết toán phải thu 5.000.000. So với học phí gốc thì
    // ca ĐÚNG này sẽ đỏ — đó là cách bộ kiểm tự phá chính nó.
    const a = anhChupSauTinhHuongA();
    expect(a.dong[1]!.thanhTien).toBe(SO_CHOT_DON.binh.hocPhiThuc);
    expect(a.dong[1]!.phaiThu).toBe(KY_VONG_A.binhPhaiThu);
    expect(ma(a)).not.toContain("B6");
  });

  it("STOPPED mà THIẾU giá trị quyết toán ⇒ B6 (không im lặng bỏ qua)", () => {
    const a = anhChupSauTinhHuongA();
    a.dong[1]!.giaTriQuyetToan = null;
    const vp = kiemBatBien(a).find((x) => x.ma === "B6");
    expect(vp?.moTa).toContain("chưa có giá trị quyết toán");
  });
});

describe("[BB-07] B7 — mỗi đợt tối đa MỘT phiếu gộp đang mở", () => {
  it("hai phiếu OPEN cùng chứa một đợt ⇒ B7", () => {
    const a = anhChupGoc();
    a.phieuGop = [
      { billId: "KT-A", trangThai: "OPEN", dongPhieu: [PR.anD2] },
      { billId: "KT-B", trangThai: "OPEN", dongPhieu: [PR.anD2, PR.binhD2] },
    ];
    const vp = kiemBatBien(a).find((x) => x.ma === "B7");
    expect(vp?.tai).toBe(PR.anD2);
  });

  it("phiếu ĐÃ HUỶ / ĐÃ THU ĐỦ không tính — nếu không thì không bao giờ phát lại được phiếu", () => {
    const a = anhChupGoc();
    a.phieuGop = [
      { billId: "KT-cu", trangThai: "VOID", dongPhieu: [PR.anD2] },
      { billId: "KT-da-thu", trangThai: "PAID", dongPhieu: [PR.anD2] },
      { billId: "KT-moi", trangThai: "OPEN", dongPhieu: [PR.anD2] },
    ];
    expect(ma(a)).not.toContain("B7");
  });
});

describe("[BB-08] B8 — chuyển nội bộ cùng gia đình, cùng pháp nhân", () => {
  it("chuyển giữa hai pháp nhân ⇒ B8", () => {
    // TS-01 bước 6. ⚠️ Hôm nay CS1 và CS2 CÙNG pháp nhân (gate-0 X4) nên ca này chỉ dựng được
    // bằng fixture. Vẫn phải có: mở cơ sở pháp nhân khác là thêm DỮ LIỆU, không ai sửa mã, và
    // không ai nhớ ra rằng lúc đó luật này mới bắt đầu có việc.
    const a = anhChupGoc();
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-cheo-phap-nhan",
      dong: [
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -100_000, nguonDaXacNhan: 6_000_000 },
        { tai: OI.an, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN_KHAC, amount: 100_000 },
      ],
    });
    expect(ma(a)).toContain("B8");
  });

  it("chuyển sang gia đình khác cũng ⇒ B8", () => {
    const a = anhChupGoc();
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-cheo-gia-dinh",
      dong: [
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -100_000, nguonDaXacNhan: 6_000_000 },
        { tai: "oi-nha-khac", giaDinhId: "GD-KHAC", phapNhanId: PHAP_NHAN, amount: 100_000 },
      ],
    });
    expect(ma(a)).toContain("B8");
  });
});

describe("[BB-09] B9 — chỉ phần ĐÃ XÁC NHẬN mới chuyển đi được", () => {
  it("chuyển nhiều hơn phần đã xác nhận ⇒ B9", () => {
    const a = anhChupGoc();
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-chuyen-tien-hua",
      dong: [
        // Bình đã thu 6.000.000 nhưng mới 4.000.000 được kế toán xác nhận.
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -5_000_000, nguonDaXacNhan: 4_000_000 },
        { tai: OI.an, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: 5_000_000 },
      ],
    });
    const vp = kiemBatBien(a).find((x) => x.ma === "B9");
    expect(vp?.lech).toBe(1_000_000);
  });

  it("THIẾU số 'nguồn đã xác nhận' là VI PHẠM, và phải nói ĐÚNG là thiếu", () => {
    // Một bất biến im lặng khi không đo được là một bất biến không tồn tại.
    //
    // ⚠️ Ca này ban đầu chỉ khẳng định `toContain("B9")` và một lượt cấy đã LỌT: bỏ hẳn nhánh
    // "thiếu số" thì `tron(undefined)` ra 0, nên `raKhoi > 0` vẫn sinh B9 — cùng MÃ, khác
    // NGHĨA. Hai chẩn đoán đó dẫn tới hai việc khác hẳn nhau:
    //   · "chỉ 0đ đã được kế toán xác nhận" ⇒ kế toán đi duyệt khoản đó;
    //   · "không biết nguồn đã xác nhận bao nhiêu" ⇒ BỘ DỰNG DÒNG quên khai, kế toán duyệt bao
    //     nhiêu cũng không sửa được.
    // Nên lưới phải neo vào câu chữ, không chỉ vào mã.
    const a = anhChupGoc();
    a.nghiepVuChuyen.push({
      nghiepVuId: "op-khong-biet-nguon",
      dong: [
        { tai: OI.binh, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: -100_000 },
        { tai: OI.an, giaDinhId: GD_MAU, phapNhanId: PHAP_NHAN, amount: 100_000 },
      ],
    });
    const vp = kiemBatBien(a).filter((x) => x.ma === "B9");
    expect(vp).toHaveLength(1);
    expect(vp[0]!.moTa).toContain("không biết nguồn đã xác nhận");
  });

  it("vế NHẬN không phải chứng minh nguồn — chỉ vế RA", () => {
    // Bắt cả vế nhận là buộc mọi bộ dựng dòng khai một con số vô nghĩa, và một trường bắt buộc
    // vô nghĩa thì người ta điền bừa.
    expect(kiemBatBien(anhChupSauTinhHuongA())).toEqual([]);
  });
});

describe("[BB-10] trả về MỌI vi phạm, không dừng ở cái đầu tiên", () => {
  it("một ảnh chụp hỏng nhiều chỗ ra nhiều mã", () => {
    // Một lỗi tiền thường kéo vài bất biến cùng đỏ; người sửa cần thấy đủ bộ để biết lỗi nằm ở
    // đâu, chứ không phải sửa một cái rồi chạy lại để thấy cái tiếp theo.
    const a = anhChupGoc();
    a.dong[0]!.daThu = a.dong[0]!.phaiThu + 1; // B1 + B5
    a.vi.push({ phapNhanId: PHAP_NHAN, amount: -1 }); // B4
    a.phieuGop = [
      { billId: "x", trangThai: "OPEN", dongPhieu: [PR.anD1] },
      { billId: "y", trangThai: "OPEN", dongPhieu: [PR.anD1] },
    ]; // B7
    const codes = new Set(ma(a));
    expect([...codes].sort()).toEqual(["B1", "B4", "B5", "B7"]);
  });

  it("mọi vi phạm đều nói được TẠI ĐÂU", () => {
    const a = anhChupGoc();
    a.dong[1]!.daThu = a.dong[1]!.phaiThu + 1;
    const vp = kiemBatBien(a).find((x) => x.ma === "B1");
    expect(vp?.tai).toBe(OI.binh);
    expect(vp?.moTa).toContain(SO_CHOT_DON.binh.ten); // gọi TÊN con, không chỉ id
  });

  it("giao dịch gốc vẫn được nêu đích danh khi B2 đỏ", () => {
    const a = anhChupGoc();
    a.giaoDich[0]!.daRot -= 1;
    expect(kiemBatBien(a).find((x) => x.ma === "B2")?.tai).toBe(TXN_1);
  });
});
