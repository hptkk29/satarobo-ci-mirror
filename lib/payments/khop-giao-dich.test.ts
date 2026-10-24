// Ca [KGD-*] — khớp tiền về với phiếu, ba bậc. Phủ nhóm test 5, 6, 7, 8 của spec US-10.
import { describe, it, expect } from "vitest";
import { khopGiaoDich, type PhieuUngVien } from "./khop-giao-dich";
import { docMemo } from "./memo-ck";
import { sinhMa } from "./ma-phieu";

const MA = sinhMa(12_345);
const SDT_CHU = "0905123456";
const SDT_BA_NGOAI = "0911222333";
const TIEN = 2_000_000;

const phieu = (x: Partial<PhieuUngVien> = {}): PhieuUngVien => ({
  billId: "KT-01",
  ma: MA,
  trangThai: "OPEN",
  conPhaiThu: TIEN,
  sdtChuPhieu: SDT_CHU,
  ...x,
});

/** Dựng đầu vào từ một chuỗi memo thật, để ca test đi qua CẢ parser chứ không gõ tay kết quả. */
function dauVao(memo: string, opts: { theoMa?: PhieuUngVien | null; theoSdt?: PhieuUngVien[] } = {}) {
  return {
    memo: docMemo(memo),
    soTienVe: TIEN,
    traTheoMa: (m: string) => (opts.theoMa && opts.theoMa.ma === m ? opts.theoMa : null),
    traTheoSdt: () => opts.theoSdt ?? [],
  };
}

describe("[KGD-01] BẬC 1 — mã ra phiếu", () => {
  it("memo đủ ba trường ⇒ khớp theo mã, không cờ gì", () => {
    const r = khopGiaoDich(dauVao(`PHUONG ${SDT_CHU} ${MA}`, { theoMa: phieu() }));
    expect(r.bac).toBe(1);
    expect(r.bac === 1 && r.maDung).toBe(MA);
    expect(r.bac === 1 && r.sdtLechChuPhieu).toBe(false);
  });

  it("memo CHỈ có mã (đường gõ tay khi QR hỏng) ⇒ vẫn khớp bậc 1", () => {
    // Spec: *"Đường gõ tay (QR hỏng, sale đọc qua điện thoại): chỉ dạy gõ MÃ — 5 ký tự."*
    const r = khopGiaoDich(dauVao(MA, { theoMa: phieu() }));
    expect(r.bac).toBe(1);
  });

  it("duyệt HẾT ứng viên: khối rác qua checksum đứng trước, mã thật đứng sau", () => {
    // Checksum lọc 26/27 khối rác chứ không lọc hết. Dừng ở ứng viên đầu mà không tra là tự đầu
    // hàng ở đúng ca hiếm đó — và hậu quả là "tiền về không khớp phiếu nào".
    const rac = sinhMa(777); // hợp lệ về checksum nhưng KHÔNG phiếu nào mang
    const r = khopGiaoDich(dauVao(`${rac} ${MA}`, { theoMa: phieu() }));
    expect(r.bac).toBe(1);
    expect(r.bac === 1 && r.maDung).toBe(MA);
  });
});

describe("[KGD-02] SPEC TEST 5 — SĐT lệch chủ phiếu ⇒ VẪN khớp theo mã, kèm cờ", () => {
  it("bà ngoại chuyển hộ: SĐT khác chủ phiếu ⇒ bậc 1 + cờ", () => {
    // Đây là điểm dễ làm ngược nhất. Ai chuyển tiền hộ là chuyện thường ngày, và trong mọi ca
    // đó SĐT lệch còn MÃ thì đúng — vì mã nằm trên tờ QR mà chính nhà đó đưa cho người chuyển.
    // Để SĐT phủ quyết mã nghĩa là mọi khoản "chuyển hộ" rơi vào hàng đợi và phụ huynh bị nhắc
    // nợ một khoản họ đã đóng.
    const r = khopGiaoDich(dauVao(`NGOAI ${SDT_BA_NGOAI} ${MA}`, { theoMa: phieu() }));
    expect(r.bac).toBe(1);
    expect(r.bac === 1 && r.sdtLechChuPhieu).toBe(true);
  });

  it("KHÔNG bật cờ khi thiếu một vế — cờ bật vì thiếu dữ liệu sẽ dạy kế toán bỏ qua cờ", () => {
    const khongSdt = khopGiaoDich(dauVao(`PHUONG ${MA}`, { theoMa: phieu() }));
    expect(khongSdt.bac === 1 && khongSdt.sdtLechChuPhieu).toBe(false);

    const phieuKhongChu = khopGiaoDich(
      dauVao(`PHUONG ${SDT_BA_NGOAI} ${MA}`, { theoMa: phieu({ sdtChuPhieu: null }) }),
    );
    expect(phieuKhongChu.bac === 1 && phieuKhongChu.sdtLechChuPhieu).toBe(false);
  });

  it("cờ KHÔNG chặn việc — bậc vẫn là 1, không rơi xuống hàng đợi", () => {
    const r = khopGiaoDich(dauVao(`NGOAI ${SDT_BA_NGOAI} ${MA}`, { theoMa: phieu() }));
    expect(r.bac).not.toBe(3);
  });
});

describe("[KGD-03] SPEC TEST 6 — BẬC 2 chỉ khi DUY NHẤT tuyệt đối", () => {
  const maHong = MA.slice(0, 4) + (MA[4] === "A" ? "C" : "A");

  it("1 phiếu chờ thu, số tiền ĐÚNG ⇒ khớp, và audit đọc được 'bậc 2'", () => {
    const p = phieu({ ma: "KHAC1" });
    const r = khopGiaoDich(dauVao(`PHUONG ${SDT_CHU} ${maHong}`, { theoSdt: [p] }));
    expect(r.bac).toBe(2);
    expect(r.bac === 2 && r.khopTheoSdt).toBe(true);
    expect(r.bac === 2 && r.phieu.billId).toBe(p.billId);
  });

  it("2 phiếu chờ thu CÙNG số tiền ⇒ KHÔNG tự khớp, vào hàng đợi", () => {
    const r = khopGiaoDich(
      dauVao(`PHUONG ${SDT_CHU} ${maHong}`, {
        theoSdt: [phieu({ billId: "A", ma: "M1" }), phieu({ billId: "B", ma: "M2" })],
      }),
    );
    expect(r.bac).toBe(3);
    expect(r.bac === 3 && r.ly).toBe("SDT_KHONG_DUY_NHAT");
    expect(r.bac === 3 && r.moTa).toContain(SDT_CHU);
  });

  it("2 phiếu chờ nhưng CHỈ MỘT khớp số tiền ⇒ vẫn khớp — 'duy nhất' tính sau khi lọc số", () => {
    // Nhà có hai phiếu chờ mà chỉ một phiếu khớp số thì vẫn là duy nhất; đó là ca có thật.
    const r = khopGiaoDich(
      dauVao(`PHUONG ${SDT_CHU} ${maHong}`, {
        theoSdt: [phieu({ billId: "A", ma: "M1" }), phieu({ billId: "B", ma: "M2", conPhaiThu: 999_000 })],
      }),
    );
    expect(r.bac).toBe(2);
    expect(r.bac === 2 && r.phieu.billId).toBe("A");
  });

  it("có phiếu chờ nhưng KHÔNG phiếu nào khớp số ⇒ hàng đợi, lý do nói đúng", () => {
    const r = khopGiaoDich(
      dauVao(`PHUONG ${SDT_CHU} ${maHong}`, { theoSdt: [phieu({ ma: "M1", conPhaiThu: 999_000 })] }),
    );
    expect(r.bac === 3 && r.ly).toBe("SDT_LECH_SO_TIEN");
  });

  it("phiếu KHÔNG mở (PAID/VOID) không được tính là 'đang chờ thu'", () => {
    const r = khopGiaoDich(
      dauVao(`PHUONG ${SDT_CHU} ${maHong}`, { theoSdt: [phieu({ ma: "M1", trangThai: "PAID" })] }),
    );
    expect(r.bac).toBe(3);
  });
});

describe("[KGD-04] SPEC TEST 7 — memo chỉ có TÊN ⇒ bậc 3", () => {
  it("'PHUONG' ⇒ hàng đợi trần, lý do KHONG_DOC_DUOC", () => {
    const r = khopGiaoDich(dauVao("PHUONG"));
    expect(r.bac).toBe(3);
    expect(r.bac === 3 && r.ly).toBe("KHONG_DOC_DUOC");
  });

  it("memo giữ nguyên văn để kế toán xử tay", () => {
    const r = docMemo("Chuyen tien hoc phi cho be Phuong");
    expect(r.ma).toBeNull();
    expect(r.sdt).toBeNull();
    expect(r.sach).toContain("PHUONG");
  });

  it("đọc được mã nhưng KHÔNG phiếu nào mang ⇒ lý do nói ĐÚNG chuyện đó", () => {
    // Khác hẳn "không đọc được gì": kế toán cần biết mã có tồn tại trong memo hay không, vì hai
    // ca đó dẫn tới hai việc khác nhau (tra lại phiếu vs. gọi hỏi khách).
    const r = khopGiaoDich(dauVao(`PHUONG ${MA}`, { theoMa: null }));
    expect(r.bac === 3 && r.ly).toBe("MA_KHONG_RA_PHIEU");
  });
});

describe("[KGD-05] SPEC TEST 8 — mã ĐỜI CŨ trong memo mới ⇒ vẫn bậc 1", () => {
  const CU = "ORD260915000011D3";

  it("khớp theo mã đời cũ", () => {
    const p = phieu({ ma: CU });
    const r = khopGiaoDich(dauVao(`PHUONG ${SDT_CHU} ${CU}`, { theoMa: p }));
    expect(r.bac).toBe(1);
    expect(r.bac === 1 && r.maDung).toBe(CU);
  });

  it("ĐỜI MỚI được thử TRƯỚC đời cũ khi memo có cả hai", () => {
    // Trường hợp thật: phiếu cũ bị huỷ, phát phiếu mới, phụ huynh dán cả hai dòng vào nội dung.
    // Mã mới là mã của phiếu đang sống.
    //
    // ⚠️ Ca này viết lại sau một lượt cấy LỌT. Bản đầu chỉ cho `traTheoMa` trả phiếu với mã MỚI,
    // nên đảo thứ tự vẫn ra cùng kết quả (đời cũ tra ra null rồi đi tiếp). Muốn ca phân biệt
    // được thứ tự thì CẢ HAI mã phải tra ra phiếu — và phải là HAI phiếu khác nhau.
    const phieuCu = phieu({ billId: "KT-CU", ma: CU });
    const phieuMoi = phieu({ billId: "KT-MOI", ma: MA });
    const r = khopGiaoDich({
      memo: docMemo(`${CU} ${MA}`),
      soTienVe: TIEN,
      traTheoMa: (m: string) => (m === CU ? phieuCu : m === MA ? phieuMoi : null),
      traTheoSdt: () => [],
    });
    expect(r.bac).toBe(1);
    expect(r.bac === 1 && r.maDung).toBe(MA);
    expect(r.bac === 1 && r.phieu.billId).toBe("KT-MOI");
  });
});
