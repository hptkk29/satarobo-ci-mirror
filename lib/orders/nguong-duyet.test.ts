// Ca [NGD-*] — NGƯỠNG DUYỆT ĐƠN. Thuần, không DB.
//
// Luật gốc (chủ dự án chốt 22/09/2026): tối đa 4 đợt MỖI CON (cọc không tính) và tối đa
// 1 ưu đãi MỖI DÒNG. Vượt thì đơn vẫn lưu được nhưng vào hàng chờ duyệt và không xuất
// được mã QR.
//
// ⚠️ Hai đơn vị đếm KHÁC NHAU và đó là chỗ dễ sai nhất: đợt đếm theo CON, ưu đãi đếm theo
// DÒNG. Với đơn một con hai cái đó trùng nhau nên fixture một con KHÔNG phân biệt được —
// mọi ca dưới đây có ít nhất một fixture HAI CON.
import { describe, it, expect } from "vitest";
import { xetDuyetDon, loiChuaDuyet, type NguongDuyetDon } from "./nguong-duyet";

/** Ngưỡng mặc định của registry (`orders.maxInstallments` = 4, `maxDiscountItems` = 1). */
const NGUONG: NguongDuyetDon = { tranSoDot: 4, tranUuDaiMoiDong: 1 };

describe("[NGD-01] trong hạn mức → KHÔNG cần duyệt", () => {
  it("một con, 4 đợt, 1 ưu đãi — đúng mép trần, vẫn qua", () => {
    const r = xetDuyetDon({ keHoach: [{ soDot: 4 }], uuDaiTheoDong: [{ soUuDai: 1 }], soBuoiTheoDong: [], nguong: NGUONG });
    expect(r.canDuyet).toBe(false);
  });

  it("HAI CON, mỗi con 4 đợt — tổng 8 đợt trên đơn nhưng vẫn qua", () => {
    // Đây là ca phân biệt "đếm theo CON" với "đếm theo ĐƠN". Nếu ai đó đổi sang cộng tổng
    // đợt của cả đơn thì ca này đỏ — và nó PHẢI đỏ, vì gộp hai câu hỏi thành một con số
    // chính là chỗ bug tiền nằm (cùng bài học `tongConNo` vs `conNoDon` trong CLAUDE.md).
    const r = xetDuyetDon({
      keHoach: [{ soDot: 4, nhan: "Bé An" }, { soDot: 4, nhan: "Bé Bình" }],
      uuDaiTheoDong: [{ soUuDai: 1, nhan: "Bé An" }, { soUuDai: 1, nhan: "Bé Bình" }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(false);
  });

  it("HAI CON, mỗi con MỘT ưu đãi khác nhau — tổng 2 ưu đãi trên đơn nhưng vẫn qua", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 1 }],
      uuDaiTheoDong: [{ soUuDai: 1, nhan: "Bé An" }, { soUuDai: 1, nhan: "Bé Bình" }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(false);
  });

  it("đơn rỗng (chưa thêm dòng nào) → không cần duyệt", () => {
    expect(xetDuyetDon({ keHoach: [], uuDaiTheoDong: [], soBuoiTheoDong: [], nguong: NGUONG }).canDuyet).toBe(false);
  });
});

describe("[NGD-02] vượt trần → cần duyệt, và LÝ DO gọi đúng tên con", () => {
  it("vượt số đợt", () => {
    const r = xetDuyetDon({ keHoach: [{ soDot: 5, nhan: "Bé An" }], uuDaiTheoDong: [{ soUuDai: 1 }], soBuoiTheoDong: [], nguong: NGUONG });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(1);
    expect(r.lyDo[0]).toContain("Bé An");
    expect(r.lyDo[0]).toContain("5 đợt");
    // Câu lỗi phải nói rõ cọc KHÔNG tính — nếu không, sale gỡ cọc đi rồi vẫn thấy chặn.
    expect(r.lyDo[0]).toContain("cọc không tính");
  });

  it("vượt số ưu đãi", () => {
    const r = xetDuyetDon({ keHoach: [{ soDot: 1 }], uuDaiTheoDong: [{ soUuDai: 2, nhan: "Bé An" }], soBuoiTheoDong: [], nguong: NGUONG });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(1);
    expect(r.lyDo[0]).toContain("2 ưu đãi");
  });

  it("CHỈ MỘT con vượt trong đơn hai con → vẫn cần duyệt, và lý do chỉ nhắc con đó", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 4, nhan: "Bé An" }, { soDot: 6, nhan: "Bé Bình" }],
      uuDaiTheoDong: [{ soUuDai: 1, nhan: "Bé An" }, { soUuDai: 1, nhan: "Bé Bình" }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(1);
    expect(r.lyDo[0]).toContain("Bé Bình");
    expect(r.lyDo.join("\n")).not.toContain("Bé An");
  });

  it("một dòng vượt CẢ HAI → hai dòng lý do, không gộp làm một", () => {
    const r = xetDuyetDon({ keHoach: [{ soDot: 7, nhan: "Bé An" }], uuDaiTheoDong: [{ soUuDai: 3, nhan: "Bé An" }], soBuoiTheoDong: [], nguong: NGUONG });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(2);
  });

  it("không có nhãn → gọi theo số thứ tự dòng, không để trống", () => {
    const r = xetDuyetDon({ keHoach: [{ soDot: 1 }], uuDaiTheoDong: [{ soUuDai: 1 }, { soUuDai: 2 }], soBuoiTheoDong: [], nguong: NGUONG });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo[0]).toContain("Dòng 2");
  });
});

describe("[NGD-03] ngưỡng là THAM SỐ — đổi số thì đổi kết quả", () => {
  it("nới trần đợt lên 6 thì đơn 5 đợt hết phải duyệt", () => {
    const a = { keHoach: [{ soDot: 5 }], uuDaiTheoDong: [{ soUuDai: 1 }], soBuoiTheoDong: [] };
    expect(xetDuyetDon({ ...a, nguong: NGUONG }).canDuyet).toBe(true);
    expect(
      xetDuyetDon({ ...a, nguong: { tranSoDot: 6, tranUuDaiMoiDong: 1 } }).canDuyet,
    ).toBe(false);
  });

  it("siết trần ưu đãi về 1 thì đơn 2 ưu đãi phải duyệt, nới lên 3 thì thôi", () => {
    const a = { keHoach: [{ soDot: 1 }], uuDaiTheoDong: [{ soUuDai: 2 }], soBuoiTheoDong: [] };
    expect(xetDuyetDon({ ...a, nguong: NGUONG }).canDuyet).toBe(true);
    expect(
      xetDuyetDon({ ...a, nguong: { tranSoDot: 4, tranUuDaiMoiDong: 3 } }).canDuyet,
    ).toBe(false);
  });
});

describe("[NGD-04] câu lỗi nói bằng ngôn ngữ của NGUYÊN NHÂN", () => {
  it("liệt kê từng lý do thành dòng riêng, không nuốt thành một câu cụt", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 7, nhan: "Bé An" }],
      uuDaiTheoDong: [{ soUuDai: 3, nhan: "Bé An" }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    if (!r.canDuyet) throw new Error("không tới");
    const cau = loiChuaDuyet(r.lyDo);
    expect(cau).toContain("Quản lý cơ sở duyệt");
    expect(cau).toContain("xuất mã QR");
    // Mỗi lý do một gạch đầu dòng — sale đọc được "sửa gì thì khỏi phải chờ".
    expect(cau.split("\n").filter((d) => d.startsWith("•"))).toHaveLength(2);
  });
});

describe("[NGD-05] MỘT kế hoạch cấp ĐƠN → MỘT lý do, không lặp theo số con", () => {
  // ⚠️ CA NÀY SINH RA TỪ MỘT LỖI THẬT, phát hiện lúc nối dây chứ không lúc viết hàm.
  //
  // Bản đầu của `nguong-duyet.ts` gộp hai con số vào một `DongDeXet` mang cả `soDot` lẫn
  // `soUuDai` — hình dạng ấy đọc rất hợp lý, và 12 ca đầu tiên đều xanh. Nó chỉ lộ ra là
  // sai khi gặp chỗ gọi thật: hôm nay MỘT ĐƠN có ĐÚNG MỘT kế hoạch đợt (đo prod 23/09:
  // luồng "đợt theo con" có 0 dòng), nên muốn dùng hình dạng cũ thì phải chép `soDot` sang
  // mọi dòng ⇒ đơn 2 con với một kế hoạch 5 đợt báo CÙNG MỘT vi phạm HAI LẦN.
  //
  // Bài học: một hình dạng dữ liệu chỉ được kiểm bằng CHỖ GỌI THẬT. Test viết trước chỗ
  // gọi thì nó kiểm hàm, không kiểm hệ thống (luật 9).
  it("đơn HAI CON, một kế hoạch 5 đợt → đúng 1 lý do", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 5 }],
      uuDaiTheoDong: [{ soUuDai: 1, nhan: "Bé An" }, { soUuDai: 1, nhan: "Bé Bình" }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo, `lặp lý do theo số con: ${r.lyDo.join(" | ")}`).toHaveLength(1);
    // Không có tên con ⇒ gọi tên việc, không để trống cũng không bịa tên bé nào.
    expect(r.lyDo[0]).toContain("Kế hoạch thanh toán");
  });

  it("khi yêu cầu #3 bật (mỗi con một kế hoạch) → hai kế hoạch vượt thì hai lý do", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 5, nhan: "Bé An" }, { soDot: 6, nhan: "Bé Bình" }],
      uuDaiTheoDong: [{ soUuDai: 1 }, { soUuDai: 1 }],
      soBuoiTheoDong: [], nguong: NGUONG,
    });
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(2);
  });
});

describe("[NGD-06] TRỤC THỨ BA — mốc học phần (chốt 25/09/2026)", () => {
  // 🔴 Chủ dự án: *"khi sale tạo đơn, nếu buổi học khác 12 24 36 48 tức 1 học phần, 2 học
  // phần, 3 học phần, 4 học phần thì phải qua quản lý duyệt"*.
  //
  // ⚠️ Hàm này KHÔNG tự xét mốc — phép xét cần `Course.totalSessions` nên nó ở
  // `so-buoi-hoc-phan.ts` (bộ ca `[SBH-*]`). Ở đây chỉ khoá đúng phần NỐI: kết quả xét
  // có đi vào `lyDo` và `phan.soBuoi` hay không.
  it("mọi thứ trong hạn mức nhưng MỘT dòng lệch mốc ⇒ vẫn phải duyệt", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 2 }],
      uuDaiTheoDong: [{ soUuDai: 1 }, { soUuDai: 1 }],
      soBuoiTheoDong: [
        { viPham: false, cau: null },
        { viPham: true, cau: "Bé Bình: mua 20 buổi — không khớp mốc học phần." },
      ],
      nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(true);
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(1);
    expect(r.lyDo[0]).toContain("Bé Bình");
    expect(r.phan).toEqual({ giamGia: false, traGop: false, soBuoi: true });
  });

  it("đối chứng dương: cùng fixture ấy, dòng KHÔNG lệch mốc ⇒ không phải duyệt", () => {
    // Thiếu ca này thì ca trên đạt được bằng một hàm luôn trả `canDuyet: true`.
    const r = xetDuyetDon({
      keHoach: [{ soDot: 2 }],
      uuDaiTheoDong: [{ soUuDai: 1 }, { soUuDai: 1 }],
      soBuoiTheoDong: [
        { viPham: false, cau: null },
        { viPham: false, cau: null },
      ],
      nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(false);
    expect(r.phan).toEqual({ giamGia: false, traGop: false, soBuoi: false });
  });

  it("BA lý do cùng lúc ⇒ ba dòng, và BA cờ cùng bật", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 7, nhan: "Bé An" }],
      uuDaiTheoDong: [{ soUuDai: 3, nhan: "Bé An" }],
      soBuoiTheoDong: [{ viPham: true, cau: "Bé An: mua 20 buổi — không khớp mốc học phần." }],
      nguong: NGUONG,
    });
    if (!r.canDuyet) throw new Error("không tới");
    expect(r.lyDo).toHaveLength(3);
    expect(r.phan).toEqual({ giamGia: true, traGop: true, soBuoi: true });
    const dong = loiChuaDuyet(r.lyDo).split(String.fromCharCode(10));
    expect(dong.filter((d) => d.startsWith("•"))).toHaveLength(3);
  });

  it("vi phạm mà KHÔNG kèm câu ⇒ vẫn bật cờ, không nhét dòng rỗng vào danh sách", () => {
    // Cờ và câu chữ là hai việc: cờ quyết định CỘT TRONG DB (đơn có vào hàng chờ không),
    // câu chữ chỉ để người đọc. Mất câu thì màn hình nghèo đi; mất cờ thì đơn lọt.
    const r = xetDuyetDon({
      keHoach: [],
      uuDaiTheoDong: [],
      soBuoiTheoDong: [{ viPham: true, cau: null }],
      nguong: NGUONG,
    });
    expect(r.phan.soBuoi).toBe(true);
    expect(r.canDuyet).toBe(false);
  });
});

describe("[NGD-07] `phan` có mặt ở CẢ HAI nhánh kết quả", () => {
  // ⚠️ Trước 25/09/2026 chỗ gọi tự tính lại ba điều kiện này BÊN CẠNH `canDuyet`
  // (`_actions.ts`: `xetDuyet.canDuyet && soDotHocPhi > tranSoDot`). Hai nguồn cho một
  // sự thật — cột trong DB nói một đằng, chữ trong chuông nói một nẻo. Nay `phan` là
  // nguồn DUY NHẤT, nên nó phải đọc được kể cả khi đơn không phải duyệt.
  it("đơn sạch ⇒ ba cờ đều false, KHÔNG phải undefined", () => {
    const r = xetDuyetDon({
      keHoach: [{ soDot: 1 }],
      uuDaiTheoDong: [{ soUuDai: 0 }],
      soBuoiTheoDong: [{ viPham: false, cau: null }],
      nguong: NGUONG,
    });
    expect(r.canDuyet).toBe(false);
    expect(r.phan).toEqual({ giamGia: false, traGop: false, soBuoi: false });
  });
});
