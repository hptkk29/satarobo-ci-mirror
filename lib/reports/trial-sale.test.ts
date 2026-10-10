/**
 * THỐNG KÊ CASE TRẢI NGHIỆM THEO SALE — định nghĩa từng chỉ tiêu.
 *
 * Ca chịu lực là [TKS-05]: con số trên bảng và danh sách bung ra khi bấm vào nó phải
 * đến từ CÙNG một vị từ. Đó là lời hứa của màn hình ("bấm vào số 7 thì thấy 7 dòng"), và
 * nó là loại lời hứa không có gì báo khi bị phá — chỉ người dùng đếm tay mới biết.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  caseCuaO,
  dongTong,
  gomTheoSale,
  nhanTyLe,
  NHAN_CHI_TIEU,
  phamViCoSo,
  SALE_CHUA_CO,
  saleCuaCase,
  THUOC_NHOM,
  type CaseTrial,
  type MaChiTieu,
} from "./trial-sale";

let dem = 0;
function ca(p: Partial<CaseTrial> = {}): CaseTrial {
  dem += 1;
  return {
    id: `c${dem}`,
    saleId: "s1",
    saleName: "Trần Bình",
    status: "ACTIVE",
    daChot: false,
    vangHoanToan: false,
    tenCon: "Nguyễn An",
    tenPhuHuynh: "Nguyễn Văn B",
    tenLop: "TRIAL-CS1-26-001",
    trialClassId: "tc1",
    ngayLop: "2026-09-22",
    tenGiaoVien: "Lê Cường",
    ...p,
  };
}

describe("[TKS-01] định nghĩa từng chỉ tiêu", () => {
  it("đang chờ / hoàn thành / huỷ bám đúng trạng thái", () => {
    expect(THUOC_NHOM.dangCho(ca({ status: "ACTIVE" }))).toBe(true);
    expect(THUOC_NHOM.hoanThanh(ca({ status: "COMPLETED" }))).toBe(true);
    expect(THUOC_NHOM.huy(ca({ status: "WITHDRAWN" }))).toBe(true);
    expect(THUOC_NHOM.dangCho(ca({ status: "COMPLETED" }))).toBe(false);
  });

  it("chốt được đọc từ cờ `daChot`", () => {
    expect(THUOC_NHOM.chot(ca({ daChot: true }))).toBe(true);
    expect(THUOC_NHOM.chot(ca({ daChot: false }))).toBe(false);
  });

  it("⚠️ 'im lặng' = HOÀN THÀNH mà không chốt — không gộp case đang chờ hay huỷ", () => {
    // Case đang chờ chưa học xong thì chưa im lặng, chỉ là chưa tới lúc. Case huỷ thì
    // khách đã nói rồi. Gộp cả hai vào là thổi phồng con số mà quản lý dùng để nhắc Sale.
    expect(THUOC_NHOM.imLang(ca({ status: "COMPLETED", daChot: false }))).toBe(true);
    expect(THUOC_NHOM.imLang(ca({ status: "COMPLETED", daChot: true }))).toBe(false);
    expect(THUOC_NHOM.imLang(ca({ status: "ACTIVE", daChot: false }))).toBe(false);
    expect(THUOC_NHOM.imLang(ca({ status: "WITHDRAWN", daChot: false }))).toBe(false);
  });

  it("'vắng' là KHÔNG ĐẾN buổi nào, không phải 'có một buổi vắng'", () => {
    expect(THUOC_NHOM.vang(ca({ vangHoanToan: true }))).toBe(true);
    expect(THUOC_NHOM.vang(ca({ vangHoanToan: false }))).toBe(false);
  });

  it("mọi mã chỉ tiêu đều có nhãn tiếng Việt", () => {
    for (const ma of Object.keys(THUOC_NHOM) as MaChiTieu[]) {
      expect(NHAN_CHI_TIEU[ma], `thiếu nhãn cho ${ma}`).toBeTruthy();
    }
    expect(Object.keys(NHAN_CHI_TIEU).length).toBe(Object.keys(THUOC_NHOM).length);
  });
});

describe("[TKS-02] gom theo Sale", () => {
  const ds = [
    ca({ saleId: "s1", saleName: "Trần Bình", status: "COMPLETED", daChot: true }),
    ca({ saleId: "s1", saleName: "Trần Bình", status: "COMPLETED", daChot: false }),
    ca({ saleId: "s1", saleName: "Trần Bình", status: "ACTIVE" }),
    ca({ saleId: "s2", saleName: "Lê Dung", status: "WITHDRAWN" }),
  ];

  it("mỗi Sale một dòng, đếm đúng từng cột", () => {
    const r = gomTheoSale(ds);
    expect(r).toHaveLength(2);
    const s1 = r.find((x) => x.saleId === "s1")!;
    expect(s1.so.tong).toBe(3);
    expect(s1.so.hoanThanh).toBe(2);
    expect(s1.so.chot).toBe(1);
    expect(s1.so.imLang).toBe(1);
    expect(s1.so.dangCho).toBe(1);
    expect(s1.so.huy).toBe(0);
  });

  it("sắp xếp: nhiều case nhất lên trước", () => {
    expect(gomTheoSale(ds)[0]!.saleId).toBe("s1");
  });

  it("⚠️ case của lead CHƯA CÓ Sale phụ trách vẫn thành một dòng, không bị nuốt", () => {
    // Nuốt đi là tổng của bảng nhỏ hơn tổng số case, và người đọc sẽ đi tìm mấy case
    // thiếu — hoặc tệ hơn, tin vào con số thiếu đó.
    const r = gomTheoSale([...ds, ca({ saleId: null, saleName: null })]);
    const vo = r.find((x) => x.saleId === null)!;
    expect(vo, "case của lead chưa có Sale bị bỏ khỏi bảng").toBeTruthy();
    expect(vo.saleName).toBe(SALE_CHUA_CO);
    expect(r.reduce((s, x) => s + x.so.tong, 0)).toBe(5);
  });

  it("danh sách rỗng ⇒ bảng rỗng, không ném", () => {
    expect(gomTheoSale([])).toEqual([]);
  });
});

describe("[TKS-03] ⚠️ tỷ lệ thành công = chốt ÷ HOÀN THÀNH (huỷ không vào mẫu số)", () => {
  it("2 hoàn thành, 1 chốt ⇒ 50%", () => {
    const r = gomTheoSale([
      ca({ status: "COMPLETED", daChot: true }),
      ca({ status: "COMPLETED", daChot: false }),
    ]);
    expect(r[0]!.tyLe).toBe(0.5);
  });

  it("case HUỶ không làm tụt tỷ lệ", () => {
    // Chốt của chủ dự án 22/09: "chốt / hoàn thành, huỷ không tính luôn".
    const r = gomTheoSale([
      ca({ status: "COMPLETED", daChot: true }),
      ca({ status: "WITHDRAWN" }),
      ca({ status: "WITHDRAWN" }),
    ]);
    expect(r[0]!.tyLe, "case huỷ lọt vào mẫu số").toBe(1);
  });

  it("case ĐANG CHỜ cũng không vào mẫu số", () => {
    const r = gomTheoSale([
      ca({ status: "COMPLETED", daChot: true }),
      ca({ status: "ACTIVE" }),
      ca({ status: "ACTIVE" }),
    ]);
    expect(r[0]!.tyLe).toBe(1);
  });

  it("⚠️ chưa có case hoàn thành nào ⇒ `null`, KHÔNG phải 0", () => {
    // 0% nói rằng Sale đó thất bại; sự thật là chưa có gì để đánh giá. Con số này đi
    // thẳng vào bảng so sánh giữa người với người.
    const r = gomTheoSale([ca({ status: "ACTIVE" }), ca({ status: "WITHDRAWN" })]);
    expect(r[0]!.tyLe).toBeNull();
    expect(nhanTyLe(r[0]!.tyLe)).toBe("—");
  });

  it("in ra phần trăm nguyên", () => {
    expect(nhanTyLe(0.625)).toBe("63%");
    expect(nhanTyLe(1)).toBe("100%");
    expect(nhanTyLe(0)).toBe("0%");
  });
});

describe("[TKS-04] hàng TỔNG", () => {
  const ds = [
    ca({ saleId: "s1", status: "COMPLETED", daChot: true }),
    ca({ saleId: "s2", status: "COMPLETED", daChot: false }),
    ca({ saleId: "s2", status: "COMPLETED", daChot: false }),
  ];

  it("cộng trên TOÀN BỘ case", () => {
    const t = dongTong(ds);
    expect(t.so.tong).toBe(3);
    expect(t.so.chot).toBe(1);
  });

  it("⚠️ tỷ lệ tổng tính LẠI, không lấy trung bình các tỷ lệ của Sale", () => {
    // Trung bình các tỷ lệ: (100% + 0%) / 2 = 50%. Đúng là 1/3 = 33%.
    // Lấy trung bình cho Sale có 1 case cùng trọng số với Sale có 50 case.
    const t = dongTong(ds);
    expect(t.tyLe).toBeCloseTo(1 / 3, 5);
    const trungBinh =
      gomTheoSale(ds).reduce((s, x) => s + (x.tyLe ?? 0), 0) / gomTheoSale(ds).length;
    expect(t.tyLe, "tỷ lệ tổng đang là trung bình các dòng").not.toBeCloseTo(trungBinh, 5);
  });
});

describe("[TKS-05] ⚠️ con số và danh sách bung ra phải KHỚP NHAU", () => {
  const ds = [
    ca({ saleId: "s1", status: "COMPLETED", daChot: true }),
    ca({ saleId: "s1", status: "COMPLETED", daChot: false }),
    ca({ saleId: "s1", status: "ACTIVE" }),
    ca({ saleId: "s1", status: "WITHDRAWN" }),
    ca({ saleId: "s2", status: "COMPLETED", daChot: true }),
  ];

  it.each(Object.keys(THUOC_NHOM) as MaChiTieu[])(
    "bấm vào ô %s của một Sale ⇒ số dòng đúng bằng con số",
    (ma) => {
      // Đây là LỜI HỨA của màn hình. Nó vỡ vào đúng ngày ai đó sửa một trong hai bên, và
      // không có gì báo — chỉ người dùng đếm tay mới biết.
      for (const dong of gomTheoSale(ds)) {
        expect(caseCuaO(ds, dong.saleId, ma)).toHaveLength(dong.so[ma]);
      }
    },
  );

  it("danh sách của một Sale KHÔNG lẫn case của Sale khác", () => {
    const r = caseCuaO(ds, "s1", "tong");
    expect(r).toHaveLength(4);
    expect(r.every((c) => c.saleId === "s1")).toBe(true);
  });

  it("ô của Sale 'không rõ người thêm' cũng tra được", () => {
    const voDanh = ca({ saleId: null, saleName: null, status: "COMPLETED" });
    expect(caseCuaO([...ds, voDanh], null, "hoanThanh")).toHaveLength(1);
  });
});

// ── LƯỚI GHIM TẦNG TRUY VẤN ───────────────────────────────────────────────────────────
//
// Hai cờ chịu lực nhất của màn này — `daChot` và `vangHoanToan` — KHÔNG tính ở module
// thuần mà ở tầng chạm DB. Bộ trên test được mọi vị từ mà vẫn xanh khi hai cờ đó sai,
// vì nó nhận cờ như dữ liệu đầu vào. Canh bằng lưới ghim mã nguồn (luật 11: neo hẹp,
// không cờ `/s`, và đã cấy lại để thấy đỏ).
describe("[TKS-06] ⚠️ tầng truy vấn tính hai cờ đúng cách", () => {
  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };
  const TEP = "app/(admin)/admin/bao-cao/trial-sale/_lib/truy-van.ts";

  it("phép quét tự kiểm: đọc được tệp truy vấn", () => {
    expect(doc(TEP).length).toBeGreaterThan(1000);
  });

  it("'vắng' dùng EVERY, không phải SOME — và đòi có điểm danh", () => {
    // `some(ABSENT)` biến em đến buổi 1, nghỉ buổi 2 thành "không đến".
    // Thiếu `length > 0` thì case CHƯA điểm danh lượt nào cũng thành "vắng" —
    // `[].every(...)` là `true`.
    const s = doc(TEP);
    expect(s).toContain("diemDanh.length > 0 && diemDanh.every((a) => a.status === \"ABSENT\")");
  });

  it("'đã chốt' đọc từ `Enrollment.leadChildId`, KHÔNG từ `LeadTrialHistory.outcome`", () => {
    const s = doc(TEP);
    expect(s).toContain("sdb.enrollment.findMany(");
    expect(s).toContain("leadChildId: { in: idCon }");
    // `outcome` chỉ bật ENROLLED cho đúng cặp (con × lớp đã điểm danh) và chỉ khi dòng
    // lịch sử đang PENDING — nó phục vụ hoa hồng giáo viên, không phải đếm "đã chốt".
    expect(s).not.toContain("leadTrialHistory");
  });

  it("'đã chốt' so MỐC THỜI GIAN — không đếm em vốn đã là học viên trước khi đi thử", () => {
    expect(doc(TEP)).toContain("d.getTime() >= r.createdAt.getTime()");
  });

  it("⚠️ ngày CUỐI của khoảng được tính TRỌN — cộng một ngày trước khi so", () => {
    // `createdAt` là Timestamptz còn mốc là 00:00; thiếu vế này thì case tạo lúc 09:00
    // ngày cuối rơi ra ngoài, và người dùng thấy thiếu đúng những case hôm nay.
    const s = doc(TEP);
    expect(s).toContain("24 * 60 * 60 * 1000");
    expect(s).toMatch(/createdAt: \{ gte: tu, lt: denHet \}/);
  });

  it("cách ly cơ sở đi qua LỚP (TrialEnrollment không auto-scope)", () => {
    expect(doc(TEP)).toContain("trialClass: centerIds ? { centerId: { in: centerIds } } : {}");
  });

  it("tầng truy vấn GỌI `phamViCoSo`, không tự viết lại phép giao", () => {
    // Phép giao KHU VỰC × CƠ SỞ nay là hàm THUẦN có test hành vi ([TKS-07]). Luống
    // này chỉ còn canh một việc: tầng truy vấn thực sự gọi nó. Viết lại điều kiện tại
    // chỗ là quay về đúng tình huống mà lưới ghim đã XANH GIẢ một lần.
    const s = doc(TEP);
    expect(s).toContain("phamViCoSo({");
    expect(s).toContain("if (centerIds !== null && centerIds.length === 0) return");
  });
});

describe("[TKS-07] ⚠️ phạm vi cơ sở = giao giữa KHU VỰC và CƠ SỞ", () => {
  it("không lọc gì ⇒ null (không giới hạn)", () => {
    expect(phamViCoSo({ coSoCuaKhuVuc: null, centerId: null })).toBeNull();
  });

  it("chỉ chọn cơ sở ⇒ đúng cơ sở đó", () => {
    expect(phamViCoSo({ coSoCuaKhuVuc: null, centerId: "cs1" })).toEqual(["cs1"]);
  });

  it("chỉ chọn khu vực ⇒ mọi cơ sở của khu vực", () => {
    expect(phamViCoSo({ coSoCuaKhuVuc: ["cs1", "cs2"], centerId: null })).toEqual(["cs1", "cs2"]);
  });

  it("chọn cả hai ⇒ GIAO, không phải hợp", () => {
    expect(phamViCoSo({ coSoCuaKhuVuc: ["cs1", "cs2"], centerId: "cs2" })).toEqual(["cs2"]);
  });

  it("⚠️ khu vực RỖNG ⇒ mảng rỗng, KHÔNG phải null", () => {
    // `null` ở đây nghĩa là "không giới hạn" ⇒ màn hình hiện dữ liệu của MỌI khu vực
    // trong khi thanh lọc đang ghi tên một khu vực. Đây đúng là ca mà lưới ghim mã
    // nguồn từng XANH GIẢ, nên nó phải là một ca HÀNH VI.
    expect(phamViCoSo({ coSoCuaKhuVuc: [], centerId: null })).toEqual([]);
    expect(phamViCoSo({ coSoCuaKhuVuc: [], centerId: "cs1" })).toEqual([]);
  });

  it("⚠️ cơ sở NGOÀI khu vực ⇒ mảng rỗng, không lọt", () => {
    // Người Hội sở chọn khu vực Đà Nẵng rồi chọn một cơ sở ở khu vực khác: phải ra rỗng,
    // không phải ra cơ sở đó.
    expect(phamViCoSo({ coSoCuaKhuVuc: ["cs1"], centerId: "cs9" })).toEqual([]);
  });
});

describe("[TSL-SALE] case tính cho Sale PHỤ TRÁCH LEAD (26/09/2026)", () => {
  it("[TSL-SALE-01] lead có Sale phụ trách ⇒ đúng Sale đó", () => {
    expect(
      saleCuaCase({ assignedToId: "sale-lien", assignedTo: { name: "Lê Thị Phương Liên" } }),
    ).toEqual({ saleId: "sale-lien", saleName: "Lê Thị Phương Liên" });
  });

  it("[TSL-SALE-02] lead chưa ai phụ trách ⇒ null (gom vào dòng \"chưa có Sale\")", () => {
    expect(saleCuaCase({ assignedToId: null, assignedTo: null })).toEqual({
      saleId: null,
      saleName: null,
    });
    expect(saleCuaCase(null)).toEqual({ saleId: null, saleName: null });
  });

  const doc = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const boChuThich = (s: string) =>
    s
      .split(/\r?\n/)
      .filter((d) => {
        const t = d.trim();
        return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
      })
      .join("\n");

  it("[TSL-SALE-W1] ⚠️ báo cáo KHÔNG còn tính theo người bấm thêm case (addedById)", () => {
    // Trước 26/09: `saleId: r.addedById` ⇒ tài khoản quản trị xếp hộ một bé cũng thành
    // một dòng "Sale", còn Sale thật của lead thì mất case đó.
    const tv = boChuThich(doc("app/(admin)/admin/bao-cao/trial-sale/_lib/truy-van.ts"));
    expect(tv).not.toContain("addedById");
    expect((tv.match(/saleCuaCase\(/g) ?? []).length).toBe(1);
    expect(tv).toContain("assignedToId: true");
  });

  it("[TSL-SALE-W2] site GV in cột Sale theo CÙNG định nghĩa", () => {
    const ts = boChuThich(doc("lib/lms/teacher-schedule.ts"));
    expect(ts).toContain("saleName: saleCuaCase(");
  });
});
