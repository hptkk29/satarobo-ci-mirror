// Ca [MCK-*] — sinh và đọc nội dung chuyển khoản. Phủ 9 nhóm test spec US-10 đòi.
//
//   1 · bốn biến thể memo cùng một kết quả       → [MCK-03]
//   2 · bank chèn SỐ SÁT mã                      → [MCK-04]
//   3 · khối giả checksum-fail đứng TRƯỚC        → [MCK-04]
//   4 · gõ sai 1 ký tự / đảo 2 ký tự liền kề     → [MCK-05]
//   5 · SĐT lệch chủ phiếu                       → [KGD-02]  (khop-giao-dich.test.ts)
//   6 · bậc 2 duy nhất / không duy nhất          → [KGD-03]
//   7 · memo chỉ có tên → bậc 3                  → [KGD-04]
//   8 · mã đời cũ trong memo mới → bậc 1         → [KGD-05]
//   9 · tên có dấu/dài → memo đúng khuôn ≤25     → [MCK-01], [MCK-09]
import { describe, it, expect } from "vitest";
import { chuanHoaMemo, docMemo, dungMemo, sdtChuan, tenHienThi, TRAN_MEMO } from "./memo-ck";
import { sinhMa } from "./ma-phieu";

const MA = sinhMa(12_345); // mã thật, sinh bằng chính hàm sản xuất
const SDT = "0905123456";

describe("[MCK-01] TÊN hiển thị — từ CUỐI, in hoa, bỏ dấu, ≤8", () => {
  it("lấy TỪ CUỐI, không phải từ đầu", () => {
    // Tiếng Việt gọi nhau bằng tên. Lấy từ đầu sẽ ra "NGUYEN" cho một nửa số học viên — tức
    // trường hiển thị không phân biệt được ai với ai, mất sạch công dụng.
    expect(tenHienThi("Nguyễn Phương Quỳnh Anh")).toBe("ANH");
    expect(tenHienThi("Trần Minh Phương")).toBe("PHUONG");
  });

  it("bỏ dấu, kể cả `đ`", () => {
    expect(tenHienThi("Lê Hoàng Đức")).toBe("DUC");
    expect(tenHienThi("Đỗ Thị Hường")).toBe("HUONG");
  });

  it("cắt còn ≤8 ký tự", () => {
    expect(tenHienThi("Nguyễn Khánhh Nguyênnnn")).toHaveLength(8);
  });

  it("rỗng / rác ⇒ chuỗi rỗng, KHÔNG ném", () => {
    // Tên không tham gia khớp, nên thiếu tên chỉ làm memo ngắn đi. Ném ở đây là chặn cả một
    // phiếu vì một ô hồ sơ bỏ trống.
    for (const x of ["", "   ", "123", "!!!"]) expect(tenHienThi(x), JSON.stringify(x)).toBe("");
  });
});

describe("[MCK-02] SĐT — chuẩn hoá, và KHÔNG đoán", () => {
  it("`+84` / `84` ⇒ `0`", () => {
    expect(sdtChuan("+84905123456")).toBe(SDT);
    expect(sdtChuan("84905123456")).toBe(SDT);
    expect(sdtChuan("0905 123 456")).toBe(SDT);
    expect(sdtChuan("0905.123.456")).toBe(SDT);
  });

  it("9 hay 11 số ⇒ RỖNG, không tự thêm/bớt chữ số", () => {
    // 9 số là ca thật (ai đó lưu SĐT vào ô kiểu số nên mất số 0 đầu). Đoán ở đây nghĩa là tự
    // thêm một chữ số vào số điện thoại của khách rồi đi tìm phiếu theo nó.
    expect(sdtChuan("905123456")).toBe("");
    expect(sdtChuan("09051234567")).toBe("");
  });
});

describe("[MCK-03] SPEC TEST 1 — bốn biến thể memo cho CÙNG một kết quả", () => {
  const goc = `PHUONG ${SDT} ${MA}`;

  const BIEN_THE: [string, string][] = [
    ["nguyên bản", goc],
    ["lột sạch cách", goc.replace(/ /g, "")],
    ["thay cách bằng gạch", goc.replace(/ /g, "-")],
    ["bank chèn đầu đuôi", `MBVCB.3021234567.${goc}.CT tu NGUYEN VAN A`],
  ];

  it("cả bốn ra cùng MÃ và cùng SĐT", () => {
    const ket = BIEN_THE.map(([ten, memo]) => {
      const r = docMemo(memo);
      return { ten, ma: r.ma, sdt: r.sdt };
    });
    for (const k of ket) {
      expect(k.ma, `${k.ten}: mã`).toBe(MA);
      expect(k.sdt, `${k.ten}: sđt`).toBe(SDT);
    }
  });

  it("tầng normalize xoá SẠCH mọi ký tự không phải [A-Z0-9]", () => {
    expect(chuanHoaMemo("phương-0905.123_456 K7M2N!")).toBe("PHUONG0905123456K7M2N");
  });

  it("tiền tố của bank KHÔNG nuốt mất SĐT — vì memo bắt đầu bằng TÊN (chữ)", () => {
    // Đây là lý do khuôn đặt TÊN trước SĐT: chữ cái của tên là vách ngăn giữa dãy số của ngân
    // hàng và số điện thoại. Nếu memo mở đầu bằng số thì hai dãy dính liền và không tách được.
    const r = docMemo(`MBVCB.3021234567.PHUONG ${SDT} ${MA}`);
    expect(r.sach).toContain(`PHUONG${SDT}`);
    expect(r.sdt).toBe(SDT);
  });
});

describe("[MCK-04] SPEC TEST 2 & 3 — cửa sổ trượt + checksum", () => {
  it("bank chèn SỐ SÁT mã ⇒ vẫn bắt đúng", () => {
    const r = docMemo(`CT123${MA}456`);
    expect(r.ma).toBe(MA);
  });

  it("khối GIẢ checksum-fail đứng TRƯỚC khối thật ⇒ lấy khối thật", () => {
    // Dựng một khối 5 ký tự hợp bảng chữ nhưng SAI checksum, đặt trước mã thật.
    const gia = MA.slice(0, 4) + khacKyTuKiem(MA);
    expect(gia).not.toBe(MA);
    const r = docMemo(`${gia} ${MA}`);
    expect(r.ma).toBe(MA);
    expect(r.ungVien).toContain(MA);
    expect(r.ungVien).not.toContain(gia);
  });

  it("KHÔNG có mã hợp lệ ⇒ `ma` là null, không đoán khối gần đúng nhất", () => {
    const gia = MA.slice(0, 4) + khacKyTuKiem(MA);
    expect(docMemo(`PHUONG ${SDT} ${gia}`).ma).toBeNull();
  });

  it("trả DANH SÁCH ứng viên, không chỉ một", () => {
    const ma2 = sinhMa(999);
    const r = docMemo(`${MA} ${ma2}`);
    expect(r.ungVien).toEqual(expect.arrayContaining([MA, ma2]));
  });
});

describe("[MCK-05] SPEC TEST 4 — gõ sai ⇒ checksum fail ⇒ KHÔNG khớp nhầm", () => {
  it("sai 1 ký tự ⇒ không nhận là mã", () => {
    for (let i = 0; i < MA.length; i++) {
      const c = MA[i] === "A" ? "C" : "A";
      const hong = MA.slice(0, i) + c + MA.slice(i + 1);
      expect(docMemo(`PHUONG ${SDT} ${hong}`).ma, hong).toBeNull();
    }
  });

  it("đảo 2 ký tự liền kề ⇒ không nhận là mã", () => {
    for (let i = 0; i + 1 < MA.length; i++) {
      if (MA[i] === MA[i + 1]) continue;
      const hong = MA.slice(0, i) + MA[i + 1] + MA[i] + MA.slice(i + 2);
      expect(docMemo(`PHUONG ${SDT} ${hong}`).ma, hong).toBeNull();
    }
  });

  it("nhưng SĐT vẫn đọc được ⇒ còn đường rơi xuống bậc 2", () => {
    const hong = MA.slice(0, 4) + khacKyTuKiem(MA);
    const r = docMemo(`PHUONG ${SDT} ${hong}`);
    expect(r.ma).toBeNull();
    expect(r.sdt).toBe(SDT);
  });
});

describe("[MCK-06] SĐT trong memo — đúng 10 số, không đoán", () => {
  it("dãy 9 hay 11 số ⇒ coi như KHÔNG có SĐT", () => {
    expect(docMemo(`PHUONG 905123456 ${MA}`).sdt).toBeNull();
    expect(docMemo(`PHUONG 09051234567 ${MA}`).sdt).toBeNull();
  });

  it("dãy 10 số KHÔNG bắt đầu bằng 0 ⇒ không phải SĐT", () => {
    expect(docMemo(`PHUONG 3021234567 ${MA}`).sdt).toBeNull();
  });
});

describe("[MCK-07] SPEC TEST 8 — mã ĐỜI CŨ trong memo mới", () => {
  it("đọc ra `maDoiCu`", () => {
    const r = docMemo(`PHUONG ${SDT} ORD260915000011D3`);
    expect(r.maDoiCu).toBe("ORD260915000011D3");
    expect(r.sdt).toBe(SDT);
  });

  it("đời cũ có dấu chấm / gạch của bank vẫn đọc được", () => {
    expect(docMemo("CT.ORD-CS1101-D0.TU ABC").maDoiCu).toBe("ORDCS1101D0");
  });
});

describe("[MCK-08] dựng memo — khuôn và ngân sách", () => {
  it("khuôn đúng `<TÊN> <SĐT> <MÃ>`", () => {
    expect(dungMemo({ hoTen: "Trần Minh Phương", sdt: "+84905123456", ma: MA })).toBe(
      `PHUONG ${SDT} ${MA}`,
    );
  });

  it("thiếu tên / thiếu SĐT ⇒ bỏ hẳn phần đó, KHÔNG để chỗ trống thừa", () => {
    expect(dungMemo({ ma: MA })).toBe(MA);
    expect(dungMemo({ hoTen: "Lê Đức", ma: MA })).toBe(`DUC ${MA}`);
  });
});

describe("[MCK-09] SPEC TEST 9 — tên có dấu / dài ⇒ memo đúng khuôn, ≤25, không dấu", () => {
  const HO_SO = [
    "Nguyễn Phương Quỳnh Anh",
    "Đặng Hoàng Bảo Nguyên",
    "Lê Thị Mỹ Duyên",
    "Trần Nguyễn Khánh Vy",
    "Phạm Đình Trường Giang",
  ];

  it("mọi hồ sơ mẫu ⇒ ≤25 ký tự, không ký tự có dấu, đọc lại ra đúng mã", () => {
    HO_SO.forEach((ten, i) => {
      const ma = sinhMa(1_000 + i);
      const memo = dungMemo({ hoTen: ten, sdt: SDT, ma });
      expect(memo.length, `${ten} → "${memo}"`).toBeLessThanOrEqual(TRAN_MEMO);
      expect(/^[A-Z0-9 ]+$/.test(memo), `${ten} → "${memo}"`).toBe(true);
      const r = docMemo(memo);
      expect(r.ma, memo).toBe(ma);
      expect(r.sdt, memo).toBe(SDT);
    });
  });

  it("tên DÀI NHẤT vẫn khít ngân sách 8+1+10+1+5 = 25", () => {
    const memo = dungMemo({ hoTen: "Nguyen Khanhhhhhhhhh", sdt: SDT, ma: MA });
    expect(memo).toHaveLength(25);
    expect(docMemo(memo).ma).toBe(MA);
  });
});

/** Đổi ký tự kiểm sang một ký tự KHÁC — dựng khối sai checksum một cách tất định. */
function khacKyTuKiem(ma: string): string {
  const cuoi = ma[ma.length - 1]!;
  return cuoi === "A" ? "C" : "A";
}
