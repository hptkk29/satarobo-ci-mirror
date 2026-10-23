// Ca [KGA-*] — ĐỌC cột JSON `OrderItem.discounts`. Thuần, không DB.
//
// 🔴 VÌ SAO CÓ BỘ NÀY, 25/09/2026. Thẻ duyệt đơn in giải trình bằng
// `Order.discountReason` — một chuỗi GỘP sẵn lúc ghi. Trên đơn thật `ORD-260925-000001`
// nó ra: `"Dòng 1: aaaa · Dòng 1: bbbbb"`. Người duyệt đọc được LÝ DO nhưng không biết
// mỗi lý do bớt BAO NHIÊU — mà số tiền mới là thứ họ đang gật.
//
// Chủ dự án: *"giải trình dòng nào, bao nhiêu tiền thì ghi rõ ra"*.
//
// ⚠️ Và bộ đọc này phải PHÒNG THỦ: `Json?` của Prisma tới tay là `unknown`, không kiểu
// nào ép nó. Một đơn cũ (cột NULL) hay một hàng sửa tay ở DB KHÔNG được làm trắng cả
// trang duyệt — nơi người ta đang quyết định về tiền.
import { describe, it, expect } from "vitest";
import { docKhoanGiam, khoanGiamCuaDon } from "./khoan-giam-da-ap";

/** Bộ số của đơn thật trên màn chủ dự án gửi. */
const SATA4 = {
  itemName: "Sata 4 — Lập trình khối",
  tenCon: "Nguyễn Minh An",
  discounts: [
    { kieu: "PHAN_TRAM", giaTri: 10, phanTram: 10, giam: 2_240_002, lyDo: "aaaa" },
    { kieu: "SO_TIEN", giaTri: 300_000, phanTram: null, giam: 300_000, lyDo: "bbbbb" },
  ],
};

describe("[KGA-01] đọc đủ ba vế: dòng nào · bao nhiêu tiền · vì sao", () => {
  it("giữ TỪNG khoản riêng, không gộp", () => {
    // Gộp là đúng cái làm mất số tiền. Hai ưu đãi trên một dòng là hai chương trình khác
    // nhau, và "giảm 2.540.002đ" không nói được đó là những chương trình nào.
    const ra = khoanGiamCuaDon([SATA4]);
    expect(ra).toHaveLength(2);
    expect(ra[0]).toMatchObject({ tenDong: SATA4.itemName, tenCon: "Nguyễn Minh An", giam: 2_240_002, phanTram: 10, lyDo: "aaaa" });
    expect(ra[1]).toMatchObject({ tenDong: SATA4.itemName, tenCon: "Nguyễn Minh An", giam: 300_000, phanTram: null, lyDo: "bbbbb" });
  });

  it("tổng các khoản khớp `discountAmount` của dòng", () => {
    // Bất biến ràng buộc bộ đọc với con số mà chân bảng in ra. Lệch là một trong hai sai.
    expect(khoanGiamCuaDon([SATA4]).reduce((s, k) => s + k.giam, 0)).toBe(2_540_002);
  });

  it("nhiều dòng ⇒ mỗi khoản mang đúng TÊN DÒNG của nó", () => {
    const ra = khoanGiamCuaDon([
      { itemName: "Bé A", tenCon: null, discounts: [{ giam: 1000, lyDo: "x" }] },
      { itemName: "Bé B", tenCon: null, discounts: [{ giam: 2000, lyDo: "y" }] },
    ]);
    expect(ra.map((k) => k.tenDong)).toEqual(["Bé A", "Bé B"]);
  });
});

describe("[KGA-05] HAI CON CÙNG KHOÁ — ca chủ dự án hỏi 25/09/2026", () => {
  // *"giải trình như thế này thì 2 con học cùng khoá thì sao biết là đang giảm đơn cho
  //  con nào?"* — trước bản vá: không biết. `itemName` trên `/orders/new` là tên KHOÁ,
  // nên hai dòng của hai đứa trẻ mang đúng MỘT chuỗi.
  const HAI_CON = [
    {
      itemName: "Sata 4 — Lập trình khối",
      tenCon: "Nguyễn Minh An",
      discounts: [{ giam: 1_000_000, lyDo: "em ruột HV Sata1" }],
    },
    {
      itemName: "Sata 4 — Lập trình khối",
      tenCon: "Nguyễn Minh Bình",
      discounts: [{ giam: 300_000, lyDo: "giới thiệu bạn" }],
    },
  ];

  it("`tenDong` TRÙNG NHAU — đó chính là con bug, giữ nguyên để thấy", () => {
    const ra = khoanGiamCuaDon(HAI_CON);
    expect(new Set(ra.map((k) => k.tenDong)).size).toBe(1);
  });

  it("`tenCon` PHÂN BIỆT ĐƯỢC hai khoản", () => {
    const ra = khoanGiamCuaDon(HAI_CON);
    expect(ra.map((k) => k.tenCon)).toEqual(["Nguyễn Minh An", "Nguyễn Minh Bình"]);
    expect(new Set(ra.map((k) => k.tenCon)).size).toBe(2);
  });
});

describe("[KGA-06] `tenCon` rỗng/khoảng trắng ⇒ `null`, KHÔNG phải chuỗi trắng", () => {
  // Chuỗi trắng in ra một khoảng lặng trông như đã có tên. `null` thì màn duyệt in được
  // câu "chưa gắn bé" — tức nói thật (luật 12).
  it.each([["", "rỗng"], ["   ", "khoảng trắng"]])("%s (%s)", (tenCon) => {
    const ra = khoanGiamCuaDon([{ itemName: "X", tenCon, discounts: [{ giam: 1, lyDo: "z" }] }]);
    expect(ra[0]!.tenCon).toBeNull();
  });
});

describe("[KGA-02] khoản 0đ không phải một khoản", () => {
  it("bỏ qua khoản `giam = 0`", () => {
    // Form cho thêm dòng ưu đãi rồi để trống; in ra "−0đ · (trống)" là nhiễu thuần tuý.
    const ra = khoanGiamCuaDon([
      { itemName: "Bé A", tenCon: null, discounts: [{ giam: 0, lyDo: "chưa nhập" }, { giam: 500, lyDo: "thật" }] },
    ]);
    expect(ra).toHaveLength(1);
    expect(ra[0]!.giam).toBe(500);
  });
});

describe("[KGA-03] ĐỌC PHÒNG THỦ — dữ liệu lạ không được làm trắng màn duyệt", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["chuỗi", "linh tinh"],
    ["số", 42],
    ["object rỗng", {}],
    ["mảng phần tử null", [null, undefined]],
    ["mảng phần tử không có `giam`", [{ lyDo: "x" }]],
    ["mảng `giam` sai kiểu", [{ giam: "500", lyDo: "x" }]],
  ])("%s ⇒ mảng rỗng, KHÔNG ném", (_ten, raw) => {
    expect(() => docKhoanGiam(raw)).not.toThrow();
    expect(docKhoanGiam(raw)).toEqual([]);
  });

  it("thiếu trường phụ ⇒ rơi về mặc định an toàn, vẫn đọc được số tiền", () => {
    const ra = docKhoanGiam([{ giam: 700 }]);
    expect(ra).toHaveLength(1);
    expect(ra[0]).toMatchObject({ giam: 700, kieu: "SO_TIEN", giaTri: 0, phanTram: null, lyDo: null });
  });
});

describe("[KGA-04] `lyDo` RỖNG phải thành `null`, không thành chuỗi trắng", () => {
  it.each([["", "chuỗi rỗng"], ["   ", "toàn khoảng trắng"]])("%s (%s)", (lyDo) => {
    // Nếu trả chuỗi trắng thì màn duyệt in `· ` rồi hết — trông như có giải trình mà
    // không đọc được gì. `null` thì nó in được câu "CHƯA có giải trình", tức nói THẬT.
    expect(docKhoanGiam([{ giam: 100, lyDo }])[0]!.lyDo).toBeNull();
  });

  it("giải trình thật thì giữ nguyên, không trim mất nội dung", () => {
    expect(docKhoanGiam([{ giam: 100, lyDo: "Em ruột HV Sata1" }])[0]!.lyDo).toBe("Em ruột HV Sata1");
  });
});

describe("[KGA-07] `voucherId` — phân biệt khoản THEO CHƯƠNG TRÌNH với khoản gõ tay", () => {
  // 🔴 VÌ SAO CÓ CA NÀY [28/09/2026]: `voucherId` được GHI vào `OrderItem.discounts` từ
  // sáng 28/09, nhưng `docKhoanGiam` — đường đọc DUY NHẤT của cột JSON ấy — bỏ qua nó.
  // Cột ghi mà không ai đọc thì mọi thứ dựng trên nó câm 100% và xanh 100%; đúng bài học
  // `OrderItem.soBuoi` đã ghi trong CLAUDE.md (0/519 dòng có dữ liệu suốt nhiều tháng).

  it("khoản theo chương trình giữ được `voucherId`", () => {
    const [k] = docKhoanGiam([
      {
        kieu: "PHAN_TRAM",
        giaTri: 15,
        phanTram: 15,
        giam: 1_584_000,
        lyDo: "SR.QD.240 · FULL4HP15 — Ưu đãi đóng đủ 4 học phần",
        voucherId: "v-full",
      },
    ]);
    expect(k!.voucherId).toBe("v-full");
    expect(k!.lyDo).toContain("SR.QD.240");
  });

  it("khoản GÕ TAY ⇒ `null`, không phải chuỗi rỗng", () => {
    // `null` và `""` trông giống nhau ở chỗ gọi nhưng đọc NGƯỢC nhau: màn chi tiết dùng
    // `k.voucherId ?` để chọn nhãn, và `""` là falsy nên vẫn đúng — nhưng một chỗ gọi
    // khác dùng `voucherId != null` thì `""` lại hoá "có chương trình".
    const [k] = docKhoanGiam([
      { kieu: "SO_TIEN", giaTri: 500_000, phanTram: null, giam: 500_000, lyDo: "em ruột HV" },
    ]);
    expect(k!.voucherId).toBeNull();
    const [r] = docKhoanGiam([
      { kieu: "SO_TIEN", giaTri: 1, phanTram: null, giam: 1, voucherId: "   " },
    ]);
    expect(r!.voucherId).toBeNull();
  });

  it("ĐƠN CŨ (trước 28/09, không có khoá này) vẫn đọc bình thường ⇒ `null`", () => {
    const [k] = docKhoanGiam([
      { kieu: "PHAN_TRAM", giaTri: 10, phanTram: 10, giam: 100_000, lyDo: "đóng sớm" },
    ]);
    expect(k!.voucherId).toBeNull();
    expect(k!.giam).toBe(100_000);
  });

  it("kiểu SAI (số, object) ⇒ `null`, không ném — đọc phòng thủ", () => {
    for (const bay of [123, { id: "x" }, ["v1"], true]) {
      const [k] = docKhoanGiam([
        { kieu: "SO_TIEN", giaTri: 1, phanTram: null, giam: 1, voucherId: bay },
      ]);
      expect(k!.voucherId, `voucherId = ${JSON.stringify(bay)}`).toBeNull();
    }
  });
});
