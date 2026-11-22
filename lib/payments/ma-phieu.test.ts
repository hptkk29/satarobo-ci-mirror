// Ca [MP-*] — mã phiếu 5 ký tự + checksum.
//
// Checksum ở đây KHÔNG chỉ chống gõ sai: nó là ĐIỀU KIỆN NHẬN DẠNG của parser (cửa sổ trượt
// trên chuỗi đã xoá hết dấu phân cách). Nên hai họ lỗi mà spec đòi — sai 1 ký tự, đảo 2 ký tự
// liền kề — được kiểm VÉT CẠN, không tin suông vào định lý Damm.
import { describe, it, expect } from "vitest";
import {
  BANG_CHU,
  CHU_CAI_DAU,
  DAI_MA,
  DUNG_LUONG,
  KY_TU_LOAI,
  maDoiCuHopLe,
  maHopLe,
  NGUONG_CANH_BAO,
  sinhMa,
  tinhTrangKhoMa,
} from "./ma-phieu";

describe("[MP-01] BẢNG CHỮ — 27 ký tự, và không ký tự nào nhìn giống ký tự khác", () => {
  it("đúng 27 ký tự, không trùng lặp", () => {
    expect(BANG_CHU).toHaveLength(27);
    expect(new Set(BANG_CHU).size).toBe(27);
  });

  it("21 chữ cái + 6 chữ số", () => {
    expect(BANG_CHU.replace(/[^A-Z]/g, "")).toHaveLength(21);
    expect(BANG_CHU.replace(/[^0-9]/g, "")).toHaveLength(6);
    expect(CHU_CAI_DAU).toBe(BANG_CHU.replace(/[0-9]/g, ""));
  });

  it("KHÔNG chứa ký tự nào trong 9 ký tự bị loại", () => {
    // O/0 · I/1/L · B/8 · S/5. Mã này đi qua TAI NGƯỜI: sale đọc cho phụ huynh qua điện thoại.
    // Bảng chữ không có ký tự nhập nhằng thì câu "không, chữ O không phải số không" không bao
    // giờ phải nói.
    for (const c of KY_TU_LOAI) expect(BANG_CHU, `còn ${c}`).not.toContain(c);
  });

  it("dung lượng 21 × 27³ = 413.343 — khớp con số trong spec", () => {
    expect(DUNG_LUONG).toBe(21 * 27 ** 3);
    expect(DUNG_LUONG).toBe(413_343);
  });
});

describe("[MP-02] sinh mã", () => {
  it("dài đúng 5, ký tự đầu là CHỮ CÁI, và tự kiểm được", () => {
    for (const n of [0, 1, 26, 27, 1_000, 200_000, DUNG_LUONG - 1]) {
      const ma = sinhMa(n);
      expect(ma, String(n)).toHaveLength(DAI_MA);
      expect(CHU_CAI_DAU.includes(ma[0]!), `${ma} bắt đầu bằng số`).toBe(true);
      expect(maHopLe(ma), ma).toBe(true);
    }
  });

  it("KHÔNG tái sử dụng: 20.000 số thứ tự liên tiếp ra 20.000 mã khác nhau", () => {
    const thay = new Set<string>();
    for (let n = 0; n < 20_000; n++) thay.add(sinhMa(n));
    expect(thay.size).toBe(20_000);
  });

  it("số thứ tự ngoài kho ⇒ NÉM, không im lặng quay vòng", () => {
    // Quay vòng là tái sử dụng mã — tức hai phiếu khác nhau cùng một mã, và tiền của nhà này
    // rơi vào phiếu nhà khác. Ném ở đây là đúng chỗ: đường sinh phiếu dừng, người vận hành thấy.
    expect(() => sinhMa(DUNG_LUONG)).toThrow(RangeError);
    expect(() => sinhMa(-1)).toThrow(RangeError);
  });
});

describe("[MP-03] CHECKSUM — vét cạn hai họ lỗi spec đòi", () => {
  const MAU = Array.from({ length: 20_000 }, (_, i) => sinhMa(i * 17 % DUNG_LUONG));

  it("SAI 1 KÝ TỰ ở bất kỳ vị trí nào ⇒ luôn bị bắt", () => {
    // 20.000 mã × 5 vị trí × 26 ký tự thay thế = 2,6 triệu phép thử.
    let lot = 0;
    for (const ma of MAU) {
      for (let i = 0; i < DAI_MA; i++) {
        for (const c of BANG_CHU) {
          if (c === ma[i]) continue;
          const hong = ma.slice(0, i) + c + ma.slice(i + 1);
          if (maHopLe(hong)) lot += 1;
        }
      }
    }
    expect(lot).toBe(0);
  });

  it("ĐẢO 2 KÝ TỰ LIỀN KỀ ở bất kỳ cặp nào ⇒ luôn bị bắt", () => {
    // ⚠️ Cặp CUỐI (ký tự thân cuối ↔ ký tự checksum) là chỗ dễ hụt nhất. Phép "tổng đan dấu"
    // cho tiện KHÔNG bắt được cặp đó — đã tính ra và loại trước khi viết. Ca này là bằng chứng.
    let lot = 0;
    let thu = 0;
    for (const ma of MAU) {
      for (let i = 0; i + 1 < DAI_MA; i++) {
        if (ma[i] === ma[i + 1]) continue; // đảo hai ký tự giống nhau thì không phải lỗi
        const hong = ma.slice(0, i) + ma[i + 1] + ma[i] + ma.slice(i + 2);
        thu += 1;
        if (maHopLe(hong)) lot += 1;
      }
    }
    expect(thu).toBeGreaterThan(50_000);
    expect(lot).toBe(0);
  });

  it("từ chối mã sai hình dạng — cả bốn điều kiện nhận dạng", () => {
    expect(maHopLe("")).toBe(false);
    expect(maHopLe("K7M2O")).toBe(false); // chứa ký tự ngoài bảng
  });

  it("KÝ TỰ ĐẦU LÀ SỐ ⇒ từ chối, kể cả khi checksum ĐÚNG", () => {
    // ⚠️ Ca này viết lại sau một lượt cấy LỌT. Bản đầu lấy một mã thật rồi thay ký tự đầu bằng
    // "2" — nhưng thay ký tự đầu cũng LÀM HỎNG CHECKSUM, nên nó xanh vì lý do sai: gỡ hẳn phép
    // kiểm "ký tự đầu là chữ cái" mà ca vẫn xanh.
    //
    // Cách đúng: duyệt cả bảng chữ để DỰNG RA khối bắt đầu bằng số mà checksum ĐÚNG. Đúng một
    // ký tự kiểm làm được điều đó, và nếu mỏ neo bị gỡ thì khối ấy được nhận.
    for (const than of ["27M2", "34KP", "9VXQ"]) {
      const nhan = [...BANG_CHU].filter((c) => maHopLe(than + c));
      expect(nhan, `${than}+? được nhận dù bắt đầu bằng số`).toEqual([]);
    }
    // Và mỏ neo phải thật sự là "chữ cái", không phải "ký tự bất kỳ".
    expect(CHU_CAI_DAU.includes("2")).toBe(false);
  });

  it("SAI ĐỘ DÀI ⇒ từ chối, kể cả khi checksum ĐÚNG", () => {
    // Cùng lỗ như ca trên: "K7M2" (4 ký tự) và "K7M2NX" (6 ký tự) tình cờ sai checksum nên ca
    // cũ xanh dù phép kiểm độ dài đã bị gỡ. Duyệt bảng chữ để dựng đúng khối có checksum hợp lệ.
    for (const than of ["K7M", "K7M2N"]) {
      const nhan = [...BANG_CHU].filter((c) => maHopLe(than + c));
      expect(nhan, `"${than}+?" dài ${than.length + 1} mà được nhận`).toEqual([]);
    }
  });

  it("tỉ lệ khối NGẪU NHIÊN qua được checksum ≈ 1/27 — con số này là cơ sở của `ungVien[]`", () => {
    // Đo, không đoán: checksum lọc 26/27 khối rác chứ không lọc hết. Đó chính là lý do parser
    // trả về DANH SÁCH ứng viên thay vì một mã.
    let hop = 0;
    let thu = 0;
    let hat = 7;
    const rnd = () => ((hat = (hat * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    for (let i = 0; i < 27_000; i++) {
      let s = CHU_CAI_DAU[Math.floor(rnd() * CHU_CAI_DAU.length)]!;
      for (let k = 1; k < DAI_MA; k++) s += BANG_CHU[Math.floor(rnd() * BANG_CHU.length)]!;
      thu += 1;
      if (maHopLe(s)) hop += 1;
    }
    const tiLe = hop / thu;
    expect(tiLe).toBeGreaterThan(1 / 27 / 1.5);
    expect(tiLe).toBeLessThan((1 / 27) * 1.5);
  });
});

describe("[MP-04] cảnh báo cạn kho", () => {
  it("ngưỡng là 50% — CON SỐ, không phải hằng tự tham chiếu", () => {
    // ⚠️ Bản đầu viết `tinhTrangKhoMa(DUNG_LUONG * NGUONG_CANH_BAO)`, tức lấy chính hằng ra để
    // dựng đầu vào. Đổi hằng thành 0.99 thì cả hai vế dịch theo và ca vẫn xanh — một tautology.
    // Spec ra con số 50%, nên ca phải neo vào con số đó.
    expect(NGUONG_CANH_BAO).toBe(0.5);
    expect(tinhTrangKhoMa(0).canhBao).toBe(false);
    expect(tinhTrangKhoMa(206_000).canhBao).toBe(false); // 49,8%
    expect(tinhTrangKhoMa(207_000).canhBao).toBe(true); // 50,1%
    expect(tinhTrangKhoMa(400_000).canhBao).toBe(true);
  });

  it("TRẢ cờ chứ KHÔNG ném — cạn kho không phải lý do để phụ huynh không quét được QR", () => {
    const t = tinhTrangKhoMa(DUNG_LUONG);
    expect(t.canhBao).toBe(true);
    expect(t.moTa).toContain("413.343");
  });
});

describe("[MP-05] mã ĐỜI CŨ — khuôn THẬT đang có trên DB", () => {
  it("nhận đúng ba độ dài đã đo trên `satarobo_local`", () => {
    // ⚠️ Spec nói "đời 8 ký tự cũ", nhưng đo `SELECT length("matchKey"), count(*)` ra ba độ
    // dài: 11 · 12 · 17 — khuôn `paymentMatchKey()`, không phải mã 8 ký tự của bản thiết kế
    // (`PaymentBill.code`; bảng đó 0 dòng vì vừa tạo hôm nay). Xem chú thích cuối `ma-phieu.ts`.
    expect(maDoiCuHopLe("ORDCS1101D0")).toBe(true); // 11
    expect(maDoiCuHopLe("ORDCS11210D0")).toBe(true); // 12
    expect(maDoiCuHopLe("ORD260915000011D3")).toBe(true); // 17
  });

  it("TỪ CHỐI khối 8 ký tự bất kỳ — nếu không thì `PHUONG09` cũng thành mã", () => {
    // Đây là cái bẫy mà khuôn neo hai đầu tránh được: nhận mọi `[A-Z0-9]{8}` nghĩa là mọi memo
    // có tên khách 6 ký tự đều sinh ra một "mã đời cũ" không tồn tại.
    expect(maDoiCuHopLe("PHUONG09")).toBe(false);
    expect(maDoiCuHopLe("ABCD1234")).toBe(false);
  });

  it("từ chối khuôn gần đúng", () => {
    expect(maDoiCuHopLe("ORD260915000011")).toBe(false); // thiếu D<số>
    expect(maDoiCuHopLe("XXX260915000011D3")).toBe(false); // sai tiền tố
    expect(maDoiCuHopLe("ORDD1")).toBe(false); // thân rỗng
  });
});
