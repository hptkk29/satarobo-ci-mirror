// Ca [CDC-*] — CHIA HỌC PHÍ TỪNG CON VÀO CÁC ĐỢT CỦA ĐƠN. Thuần, không DB.
//
// ⚠️ FIXTURE LÀ ĐƠN THẬT, KHÔNG PHẢI SỐ TRÒN. Đơn `ORD-260924-000001` trên
// `test.satarobo.vn` (chủ dự án gửi ảnh 24/09/2026):
//
//     tổng đơn 19.959.999đ · 4 đợt: 4.989.999 ×3 + 4.990.002
//     Sata 3 — Cảm biến & điều khiển   9.879.992đ   (10.399.992 − 520.000)
//     Sata 4 — Lập trình khối         10.080.007đ   (11.200.008 − 1.120.001)
//
// Số tròn trong test là số không kiểm được gì (luật đọc số: *"fixture phải mang hình dạng
// dữ liệu thật"*). Chính mấy đuôi lẻ 992 / 007 / 002 là thứ làm vỡ phép chia ngây thơ, và
// một fixture `10.000.000 / 2 con / 4 đợt` sẽ xanh với BẤT KỲ cách cài đặt nào.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chiaDotChoCon, type ConDeChia, type DotDonDeChia } from "./chia-dot-cho-con";

const han = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** 4 đợt của đơn thật. */
const DOT_THAT: DotDonDeChia[] = [
  { installmentNo: 1, amountDue: 4_989_999, dueDate: han("2026-09-24") },
  { installmentNo: 2, amountDue: 4_989_999, dueDate: han("2026-10-24") },
  { installmentNo: 3, amountDue: 4_989_999, dueDate: han("2026-11-23") },
  { installmentNo: 4, amountDue: 4_990_002, dueDate: han("2026-12-23") },
];

const CON_THAT: ConDeChia[] = [
  { orderItemId: "oi_sata3", ten: "Sata 3 — Cảm biến & điều khiển", phaiThu: 9_879_992, daThu: 0 },
  { orderItemId: "oi_sata4", ten: "Sata 4 — Lập trình khối", phaiThu: 10_080_007, daThu: 0 },
];

/**
 * 3 con × 12 đợt — bộ số ĐÃ CÂN: Σ học phí = Σ số tiền đợt = 19.960.001đ.
 *
 * ⚠️ Bản đầu của fixture này LỆCH 1đ (Σ đợt 19.960.000 / Σ con 19.960.001) và ca cột ĐỎ.
 * Đó là lưới làm đúng việc: cột chỉ khớp khi hai tổng bằng nhau — `khopKeHoach`. Giữ lại
 * ghi chú này vì cái đỏ ấy trông y hệt một lỗi cài đặt.
 */
const BA_CON_12_DOT = (() => {
  const dot12: DotDonDeChia[] = Array.from({ length: 12 }, (_, k) => ({
    installmentNo: k + 1,
    amountDue: k === 11 ? 1_663_338 : 1_663_333,
    dueDate: null,
  }));
  const con3: ConDeChia[] = [
    { orderItemId: "a", ten: "A", phaiThu: 6_666_661, daThu: 0 },
    { orderItemId: "b", ten: "B", phaiThu: 6_666_669, daThu: 0 },
    { orderItemId: "c", ten: "C", phaiThu: 6_626_671, daThu: 0 },
  ];
  return { dot12, con3 };
})();

function chia(dot = DOT_THAT, con = CON_THAT) {
  const r = chiaDotChoCon({ dot, con });
  if (!r.co) throw new Error(`mong đợi chia được, nhận: ${r.lyDo}`);
  return r;
}

describe("[CDC-01] fixture nói thật — đơn thật, số lẻ thật", () => {
  it("Σ học phí các con = Σ số tiền các đợt = tổng đơn", () => {
    // Ca kiểm chính FIXTURE. Thiếu nó thì mọi ca dưới có thể xanh vì hai vế cùng sai một
    // lượng — cùng bài học với `[CTD-01]` trong bộ cổng tạo đợt.
    expect(CON_THAT.reduce((s, c) => s + c.phaiThu, 0)).toBe(19_959_999);
    expect(DOT_THAT.reduce((s, d) => s + d.amountDue, 0)).toBe(19_959_999);
  });

  it("các đợt KHÔNG bằng nhau — nếu bằng nhau thì bất biến cột không kiểm được gì", () => {
    expect(new Set(DOT_THAT.map((d) => d.amountDue)).size).toBeGreaterThan(1);
  });
});

describe("[CDC-02] BẤT BIẾN HÀNG — Σ ô của một con = học phí thực của con", () => {
  it("cả hai con đều khớp TUYỆT ĐỐI", () => {
    const r = chia();
    expect(r.hang[0]!.tong).toBe(9_879_992);
    expect(r.hang[1]!.tong).toBe(10_080_007);
  });

  it("đúng với kế hoạch có CỌC (đợt đầu lớn) — chia theo TỶ LỆ, không chia đều", () => {
    const coCoc: DotDonDeChia[] = [
      { installmentNo: 1, amountDue: 6_000_000, dueDate: han("2026-09-24") },
      { installmentNo: 2, amountDue: 4_653_333, dueDate: han("2026-10-24") },
      { installmentNo: 3, amountDue: 4_653_333, dueDate: han("2026-11-23") },
      { installmentNo: 4, amountDue: 4_653_333, dueDate: han("2026-12-23") },
    ];
    const r = chia(coCoc);
    expect(r.hang[0]!.tong).toBe(9_879_992);
    expect(r.hang[1]!.tong).toBe(10_080_007);
    // Đợt 1 của mỗi con phải LỚN HƠN các đợt sau — đó là toàn bộ điểm của "theo tỷ lệ".
    // Chia đều thì bốn ô bằng nhau và ca này đỏ.
    for (const h of r.hang) {
      expect(h.o[0]!.soTien).toBeGreaterThan(h.o[1]!.soTien);
      // ⚠️ KHÔNG đòi `o[1] === o[2]` dù hai đợt BẰNG TIỀN. Bản đầu của ca này đòi thế và
      // ĐỎ với lệch 1đ (2.303.351 vs 2.303.352) — không phải lỗi: làm tròn trên tích luỹ
      // đánh đổi "ô bằng nhau trông đẹp" lấy "cột khớp tuyệt đối", và cột mới là thứ người
      // đọc đối chiếu được. Đòi cả hai là đòi một thứ không tồn tại.
      expect(Math.abs(h.o[1]!.soTien - h.o[2]!.soTien)).toBeLessThanOrEqual(1);
    }
  });

  it("3 con, 12 đợt — hàng vẫn khớp tuyệt đối", () => {
    const { dot12, con3 } = BA_CON_12_DOT;
    const r = chia(dot12, con3);
    expect(r.hang.map((h) => h.tong)).toEqual([6_666_661, 6_666_669, 6_626_671]);
  });
});

describe("[CDC-03] BẤT BIẾN CỘT — Σ ô của một đợt = số tiền của đợt", () => {
  it("bốn cột khớp ĐÚNG số tiền từng đợt, kể cả đợt cuối lẻ 4.990.002", () => {
    // Đây là bất biến mà phép làm tròn từng ô sẽ làm vỡ. Cột phải khớp vì người đọc đối
    // chiếu thẳng với khối "PHIẾU THU & QR THEO ĐỢT" ngay bên dưới trên cùng màn hình.
    const r = chia();
    expect(r.tongTheoDot).toEqual([4_989_999, 4_989_999, 4_989_999, 4_990_002]);
    expect(r.khopKeHoach).toBe(true);
  });

  it("3 con × 12 đợt — mọi cột vẫn khớp", () => {
    const { dot12, con3 } = BA_CON_12_DOT;
    const r = chia(dot12, con3);
    expect(r.tongTheoDot).toEqual(dot12.map((d) => d.amountDue));
  });
});

describe("[CDC-04] kế hoạch KHÔNG phủ đúng học phí ⇒ nói ra, không im lặng", () => {
  it("`khopKeHoach` false, và HÀNG vẫn khớp", () => {
    // Ca thật: sửa giá sau khi đã lên kế hoạch. Hàng là thứ nói "bé này phải đóng bao
    // nhiêu" nên KHÔNG được sai; cột thì lệch, và màn hình phải cảnh báo.
    const lech = DOT_THAT.map((d) => ({ ...d, amountDue: d.amountDue - 1_000_000 }));
    const r = chia(lech);
    expect(r.khopKeHoach).toBe(false);
    expect(r.tongKeHoach).toBe(15_959_999);
    expect(r.tongPhaiThu).toBe(19_959_999);
    expect(r.hang[0]!.tong).toBe(9_879_992);
    expect(r.hang[1]!.tong).toBe(10_080_007);
  });
});

describe("[CDC-05] ĐÃ THU phủ đợt theo thứ tự SỚM TRƯỚC (waterfall)", () => {
  it("đóng đủ đợt 1 và một phần đợt 2", () => {
    const r = chia(DOT_THAT, [
      { ...CON_THAT[0]!, daThu: 3_000_000 },
      CON_THAT[1]!,
    ]);
    const o = r.hang[0]!.o;
    // Đợt 1 của Sata 3 là 2.469.998đ ⇒ 3.000.000 phủ trọn đợt 1, dư 530.002 sang đợt 2.
    expect(o[0]!.daPhu).toBe(o[0]!.soTien);
    expect(o[1]!.daPhu).toBe(3_000_000 - o[0]!.soTien);
    expect(o[2]!.daPhu).toBe(0);
    expect(o[3]!.daPhu).toBe(0);
  });

  it("chưa đóng gì ⇒ không ô nào được phủ", () => {
    const r = chia();
    for (const h of r.hang) for (const o of h.o) expect(o.daPhu).toBe(0);
  });

  it("đóng thừa ⇒ phủ hết, KHÔNG tràn quá số tiền ô", () => {
    // Bé đóng thừa là ca có thật (`conNo` âm ở `no-theo-con.ts`). `daPhu` không bao giờ
    // được lớn hơn `soTien`, nếu không màn hình in "đã đóng 12tr / phải đóng 2,4tr".
    const r = chia(DOT_THAT, [{ ...CON_THAT[0]!, daThu: 99_000_000 }, CON_THAT[1]!]);
    for (const o of r.hang[0]!.o) expect(o.daPhu).toBe(o.soTien);
  });

  it("`daThu` ÂM (dữ liệu bẩn) ⇒ coi như 0, không phủ ngược", () => {
    const r = chia(DOT_THAT, [{ ...CON_THAT[0]!, daThu: -5_000_000 }, CON_THAT[1]!]);
    for (const o of r.hang[0]!.o) expect(o.daPhu).toBe(0);
  });
});

describe("[CDC-06] không chia được thì nói lý do, không trả bảng rỗng", () => {
  it("đơn chưa có kế hoạch đợt", () => {
    const r = chiaDotChoCon({ dot: [], con: CON_THAT });
    expect(r.co).toBe(false);
    if (r.co) throw new Error("không tới");
    expect(r.lyDo).toContain("chưa có kế hoạch");
  });

  it("đợt 0đ bị loại — kế hoạch còn lại vẫn chia được", () => {
    const r = chia([...DOT_THAT, { installmentNo: 5, amountDue: 0, dueDate: null }]);
    expect(r.dot).toHaveLength(4);
  });

  it("học phí các con bằng 0", () => {
    const r = chiaDotChoCon({
      dot: DOT_THAT,
      con: [{ orderItemId: "x", ten: "X", phaiThu: 0, daThu: 0 }],
    });
    expect(r.co).toBe(false);
    if (r.co) throw new Error("không tới");
    expect(r.lyDo).toContain("bằng 0");
  });
});

describe("[CDC-07] ô ÂM thì TỪ CHỐI, không im lặng kẹp về 0", () => {
  it("kẹp về 0 sẽ phá bất biến hàng/cột mà không ai biết", () => {
    // Bốn phép làm tròn cộng lại sai tối đa 2đ, nên ô có giá trị thật dưới 2đ có thể ra
    // âm. Kẹp `Math.max(0, …)` làm bảng trông bình thường trong khi tổng đã lệch — đúng
    // lớp "số liệu khiến người ta tin nhầm". Thà từ chối và nói ra.
    //
    // Dựng ca cực đoan: một con 1đ bên cạnh một con lớn, chia 50 đợt.
    const dot50: DotDonDeChia[] = Array.from({ length: 50 }, (_, k) => ({
      installmentNo: k + 1,
      amountDue: k === 0 ? 1 : 2,
      dueDate: null,
    }));
    const con: ConDeChia[] = [
      { orderItemId: "a", ten: "Bé lẻ", phaiThu: 1, daThu: 0 },
      { orderItemId: "b", ten: "Bé lớn", phaiThu: 98, daThu: 0 },
    ];
    const r = chiaDotChoCon({ dot: dot50, con });
    // Không khẳng định PHẢI âm — khẳng định: nếu chia được thì MỌI ô không âm và hai bất
    // biến còn nguyên; nếu không chia được thì có lý do đọc được.
    if (r.co) {
      for (const h of r.hang) for (const o of h.o) expect(o.soTien).toBeGreaterThanOrEqual(0);
      expect(r.hang.map((h) => h.tong)).toEqual([1, 98]);
    } else {
      expect(r.lyDo).toContain("số âm");
    }
  });
});

describe("[CDC-08] một con, một đợt — ca biên không được ra 0", () => {
  it("một con duy nhất nhận trọn học phí ở đợt duy nhất", () => {
    const r = chia(
      [{ installmentNo: 1, amountDue: 9_879_992, dueDate: null }],
      [CON_THAT[0]!],
    );
    expect(r.hang[0]!.o[0]!.soTien).toBe(9_879_992);
    expect(r.tongTheoDot).toEqual([9_879_992]);
  });
});

describe("[CDC-09] đơn MỘT CON không vẽ bảng chia đợt", () => {
  // 🔴 Chủ dự án chốt 25/09/2026: *"phần công nợ theo con, nếu 1 con thì không cần hiển thị"*.
  //
  // Với một con, MỖI Ô của bảng này bằng đúng số tiền đợt tương ứng ở khối "Phiếu thu &
  // QR theo đợt" ngay trên, và cột "Tổng" bằng đúng học phí của bé. Một bảng chỉ in lại
  // thứ vừa in là nhiễu thuần tuý.
  //
  // ⚠️ GHIM Ở TẦNG MÃ NGUỒN vì luật này sống trong JSX (`so.con.length >= 2 && …`), không
  // phải trong giá trị trả về của hàm thuần — `chiaDotChoCon` vẫn chia đúng cho một con,
  // và nên tiếp tục chia đúng (luật 11: neo hẹp, đếm số lần, đã cấy thử).
  const ui = readFileSync(
    resolve(process.cwd(), "app/(admin)/admin/orders/_components/cong-no-theo-con.tsx"),
    "utf8",
  );

  it("CẢ KHỐI không dựng khi dưới hai con", () => {
    // Chốt 25/09 lần hai: không chỉ giấu bảng chia đợt mà BỎ LUÔN cả khối — vì với một
    // con nó in lại y nguyên bốn con số của khối "Công nợ đơn hàng" ngay trên.
    expect(ui.match(/if \(so\.con\.length < 2\) return null;/g) ?? []).toHaveLength(1);
  });

  it("bảng chia đợt vẫn có cổng riêng — hai cổng, hỏng một vẫn còn một", () => {
    expect(ui.match(/so\.con\.length >= 2 && ketChiaDot && <BangChiaDot/g) ?? []).toHaveLength(1);
  });

  it("hàng TỔNG cũng vậy — tổng của một dòng không phải một phép cộng", () => {
    expect(ui.match(/so\.con\.length >= 2 && \(\s*<tfoot>/g) ?? []).toHaveLength(1);
  });

  it("nhưng HÀM THUẦN vẫn chia đúng cho một con — cổng là ở hiển thị, không ở phép tính", () => {
    // Đối chứng: siết nhầm vào hàm thì đơn một con mất luôn số liệu ở mọi chỗ gọi khác.
    const r = chiaDotChoCon({
      dot: [{ installmentNo: 1, amountDue: 9_879_992, dueDate: null }],
      con: [{ orderItemId: "a", ten: "Bé A", phaiThu: 9_879_992, daThu: 0 }],
    });
    expect(r.co).toBe(true);
  });
});

describe("[CDC-10] NỢ ĐANG GHIM — năm việc theo con mất lối vào trên đơn MỘT CON", () => {
  // 🔴 ĐO ĐƯỢC 25/09/2026, chưa vá, ghim bằng `it.fails` (luật: `it.fails` là HẸN,
  // `it.skip` là quên).
  //
  // Khối "Công nợ theo con" nay chỉ dựng khi đơn có từ HAI con. Nhưng nó là LỐI VÀO DUY
  // NHẤT của năm việc theo con: `Dừng học` · `Đổi khoá/đổi lớp` · `Miễn giảm nợ` ·
  // `Chuyển tiền sang bé khác` · `Gắn khoản đã thu cho bé`.
  //
  // Ba việc đầu vẫn có nghĩa với đơn một con (bé nghỉ giữa chừng, đổi khoá, miễn phần
  // nợ), nhưng nay không còn nút nào bấm tới. "Chuyển tiền sang bé khác" thì đúng là vô
  // nghĩa với một con — nó đã có cổng `so.con.length >= 2` riêng từ trước.
  //
  // Chỗ ĐÚNG cho chúng là hàng của dòng hàng trong khối "Sản phẩm": một dòng hàng là một
  // bé, và đây là hành động CỦA DÒNG chứ không phải của bảng công nợ. Vá xong thì ca này
  // ĐỎ và người vá phải gỡ ghim.
  const sp = readFileSync(
    resolve(process.cwd(), "app/(admin)/admin/orders/_components/order-detail-client.tsx"),
    "utf8",
  );

  it.fails("khối 'Sản phẩm' có lối vào `Dừng học` cho từng dòng", () => {
    expect(sp).toContain("NutDungHoc");
  });

  it.fails("khối 'Sản phẩm' có lối vào `Đổi khoá / đổi lớp` cho từng dòng", () => {
    expect(sp).toContain("NutDoiKhoa");
  });
});
