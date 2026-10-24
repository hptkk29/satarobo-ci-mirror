/**
 * lib/trial/gv-kha-dung.test.ts — canh luật PHỦ TRỌN + lọc giáo viên cho buổi trial.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * LUẬT 19 — không đọc đồng hồ thật. Mốc ngày là hằng `Date.UTC` khai ngay dưới đây và
 * mọi ca dùng lại nó. Không ca nào gọi `new Date()` trần, nên tờ lịch đổi không làm bộ
 * này đổi màu.
 *
 * LUẬT 18 — mỗi ca XANH khi chạy MỘT MÌNH: không `beforeEach` dựng trạng thái chung,
 * không biến module nào bị ca này ghi rồi ca kia đọc. `caTuDanhMuc` COPY mảng `segments`
 * của danh mục (`[...e.segments]`) nên kể cả khi có hàm nào lỡ ghi đè, ca sau vẫn sạch.
 *
 * FIXTURE MANG HÌNH DẠNG THẬT — ca lấy thẳng từ `catalogByCode` chứ không gõ tay
 * `segments`. Gõ tay là tự chọn dữ liệu tròn trịa: bản gõ tay của `CT` gần như chắc chắn
 * sẽ thiếu đoạn `PAID_BREAK`, tức là ca test tự bỏ qua đúng thứ nó phải canh.
 */

import { describe, expect, it } from "vitest";
import { catalogByCode } from "@/lib/cham-cong/catalog";
import {
  caPhuTronKhungGio,
  gopDoanCa,
  khoangThangChua,
  locGiaoVienChoBuoi,
  nhanChoDong,
  type BuoiBanCuaGv,
  type CaNgay,
  type GiaoVienChon,
  type KetQuaPhuCa,
  type ThamSoLocGv,
} from "@/lib/trial/gv-kha-dung";

// ── Mốc thời gian TUYỆT ĐỐI ────────────────────────────────────────────────────────
const NGAY_TRIAL = new Date(Date.UTC(2026, 8, 17)); // 17/09/2026
const YMD = NGAY_TRIAL.toISOString().slice(0, 10); // "2026-09-17"
const NGAY_KHAC = new Date(Date.UTC(2026, 8, 18));
const YMD_KHAC = NGAY_KHAC.toISOString().slice(0, 10); // "2026-09-18"

/** Dựng `CaNgay` từ danh mục ca THẬT. Ném ngay nếu gõ sai mã — đỡ "xanh vì không chạm". */
function caTuDanhMuc(ma: string, centerId: string | null): CaNgay {
  const e = catalogByCode(ma);
  if (!e) throw new Error(`Mã ca không có trong danh mục: ${ma}`);
  return { ma: e.code, kind: e.kind, centerId, segments: [...e.segments] };
}

function phu(ma: string, startTime: string, endTime: string) {
  return caPhuTronKhungGio({
    ca: caTuDanhMuc(ma, "cs1"),
    khung: { startTime, endTime },
    luoiDaSinh: true,
    // Người CÓ ô ca hôm nay thì hiển nhiên có trong lưới tháng. Nhánh `coTrongLuoi` chỉ
    // đọc được khi `ca === null`, nên giá trị ở đây không đổi kết quả ca nào bên dưới —
    // nó chỉ bắt buộc phải viết ra (luật 7).
    coTrongLuoi: true,
  });
}

// ── Khung mặc định cho các ca lọc danh sách ────────────────────────────────────────
const KHUNG = { ymd: YMD, startTime: "18:00", endTime: "19:30" };

/**
 * Tham số lọc, với nền là tình huống BÌNH THƯỜNG NHẤT trên prod.
 *
 * ⚠️ `coTrongLuoi` mặc định = **mọi người trong `giaoVien`**, không phải tập rỗng. Nền
 * của bộ này là "lưới tháng đã sinh và ai cũng đã có tên trong đó", nên một ô ca `null`
 * nghĩa là **hôm nay người này không đi làm** (`KHONG_CO_CA` ⇒ bị lọc). Để nền là tập
 * rỗng thì mọi ca cũ âm thầm đổi nghĩa sang `CHUA_VAO_LUOI` (⇒ được GIỮ) và cả bộ vẫn
 * xanh trong khi nó không còn canh thứ nó nói là đang canh.
 *
 * Ca nào muốn dựng "giáo viên MỚI, chưa từng vào lưới" thì truyền `coTrongLuoi` hẹp hơn
 * — tường minh, tại chỗ.
 */
function thamSo(over: Partial<ThamSoLocGv>): ThamSoLocGv {
  const nen: ThamSoLocGv = {
    giaoVien: [],
    caTheoGv: {},
    banTheoGv: {},
    khung: KHUNG,
    coTrongLuoi: new Set<string>(),
    mienLuat: new Set<string>(),
    luonGiu: new Set<string>(),
    coSoChoPhep: null,
    cheDo: "LOC_THEO_CA",
    luoiDaSinh: true,
    batLoc: true,
    hienTatCa: false,
    // Nền là NGƯỜI CÓ QUYỀN xem lịch chấm công, để mọi ca cũ vẫn đọc được đủ tập nhãn
    // ("ngày nghỉ", "chưa xếp ca ngày này"…) — chúng đang canh đúng những chuỗi đó. Vế
    // CHE nhãn có khối describe riêng ở cuối tệp, khai `duocXemLyDoNghi: false` tường minh.
    duocXemLyDoNghi: true,
  };
  const ra = { ...nen, ...over };
  if (!over.coTrongLuoi) ra.coTrongLuoi = new Set(ra.giaoVien.map((g) => g.id));
  return ra;
}

const GV: readonly GiaoVienChon[] = [
  { id: "u-kiet", name: "Kiệt" },
  { id: "u-nam", name: "Nam" },
];

describe("caPhuTronKhungGio — PHỦ TRỌN, không phải đè một phần", () => {
  // [1]
  it("T (17:15–21:00) phủ trọn buổi 18:00–19:30", () => {
    expect(phu("T", "18:00", "19:30")).toBe("PHU_TRON");
  });

  // [2]
  it("C (13:45–17:30) KHÔNG phủ buổi 18:00–19:30 — hết ca trước khi buổi bắt đầu", () => {
    expect(phu("C", "18:00", "19:30")).toBe("KHONG_PHU");
  });

  // [3] Đè một phần KHÔNG đủ: buổi bắt đầu 17:00, ca tối mới vào lúc 17:15.
  it("T KHÔNG phủ buổi 17:00–18:30 — buổi bắt đầu SỚM HƠN ca", () => {
    expect(phu("T", "17:00", "18:30")).toBe("KHONG_PHU");
  });

  // [4] ⭐ CA KHOÁ của quyết định PAID_BREAK.
  //     CT thô = 13:45–16:30 · [nghỉ tính công] 16:30–17:30 · 17:30–21:00.
  //     Bỏ PAID_BREAK ⇒ 17:00–18:30 rơi đúng vào khe 16:30–17:30 ⇒ kết luận SAI.
  it("CT phủ trọn buổi 17:00–18:30 vì PAID_BREAK TÍNH LÀ CÓ MẶT", () => {
    expect(phu("CT", "17:00", "18:30")).toBe("PHU_TRON");
    // Nói thẳng con số để ca này đỏ ngay tại chỗ gây lỗi, không phải đỏ ở hệ quả:
    const ct = caTuDanhMuc("CT", null);
    expect(ct.segments.some((s) => s.kind === "PAID_BREAK")).toBe(true);
    expect(gopDoanCa(ct.segments)).toEqual([{ start: 13 * 60 + 45, end: 21 * 60 }]);
  });

  // [5] ⭐ CA KHOÁ của bước GỘP. SCT chiều-tối là BA đoạn rời nhau trên giấy.
  it("SCT phủ trọn buổi 16:00–18:00 — ba mảnh gộp thành một khối 13:45–21:00", () => {
    expect(phu("SCT", "16:00", "18:00")).toBe("PHU_TRON");
    expect(gopDoanCa(caTuDanhMuc("SCT", null).segments)).toEqual([
      { start: 7 * 60 + 45, end: 11 * 60 + 30 },
      { start: 13 * 60 + 45, end: 21 * 60 },
    ]);
  });

  // [6] Mặt trái của bước gộp: KHÔNG được nối "từ đoạn đầu đến đoạn cuối".
  it("ST KHÔNG phủ buổi 12:00–13:00 — rơi vào KHE giữa hai khối rời", () => {
    expect(phu("ST", "12:00", "13:00")).toBe("KHONG_PHU");
    expect(gopDoanCa(caTuDanhMuc("ST", null).segments)).toHaveLength(2);
  });

  // [7]
  it("ST phủ trọn buổi 18:00–19:30 — nằm gọn trong khối tối 17:15–21:00", () => {
    expect(phu("ST", "18:00", "19:30")).toBe("PHU_TRON");
  });

  // [8] ⭐ CA KHOÁ của quyết định đọc `kind` thay vì `isLeave` (bug prod 10/09/2026).
  it("X là NGHI — dù `isLeave` của nó là FALSE", () => {
    const x = catalogByCode("X");
    expect(x?.kind).toBe("OFF");
    expect(x?.isLeave).toBe(false); // ← chính cái bẫy: lọc bằng isLeave thì X lọt qua
    expect(phu("X", "18:00", "19:30")).toBe("NGHI");
  });

  // [9]
  it("P (nghỉ phép) là NGHI", () => {
    expect(catalogByCode("P")?.kind).toBe("LEAVE");
    expect(phu("P", "18:00", "19:30")).toBe("NGHI");
  });

  // [10] Mã không mang giờ phải TỰ KHAI là không rõ, không được trả lời "không phủ".
  it("LD và D1 là KHONG_GIO, KHÔNG phải KHONG_PHU", () => {
    expect(phu("LD", "18:00", "19:30")).toBe("KHONG_GIO");
    expect(phu("D1", "18:00", "19:30")).toBe("KHONG_GIO");
  });

  // [11] BA ca TÁCH RỜI cho cùng một `ca === null`. Gộp bất kỳ hai cái nào cũng hỏng câm.
  it("không có ô ca, CÓ tên trong lưới tháng → KHONG_CO_CA (hôm nay nghỉ)", () => {
    expect(
      caPhuTronKhungGio({ ca: null, khung: KHUNG, luoiDaSinh: true, coTrongLuoi: true }),
    ).toBe("KHONG_CO_CA");
  });

  // [11b] ⭐ CA KHOÁ của bản vá 17/09 — giáo viên MỚI, chưa ai xếp ca lần nào.
  //       Cùng `ca: null`, cùng `luoiDaSinh: true` như ca trên; khác đúng một bit, và
  //       một bit đó quyết định họ có tồn tại trong ô chọn hay không.
  it("không có ô ca, KHÔNG có tên trong lưới tháng → CHUA_VAO_LUOI (dữ liệu THIẾU)", () => {
    expect(
      caPhuTronKhungGio({ ca: null, khung: KHUNG, luoiDaSinh: true, coTrongLuoi: false }),
    ).toBe("CHUA_VAO_LUOI");
  });

  it("không có ô ca vì lưới CHƯA sinh → CHUA_CO_LUOI (đứng TRƯỚC cả hai ca trên)", () => {
    // `coTrongLuoi: false` ở đây cố ý: chưa sinh lưới thì KHÔNG AI có ô nào, nên nếu
    // nhánh "chưa có lưới" bị đặt sau nhánh "chưa vào lưới" thì cả trung tâm biến thành
    // "giáo viên mới" — fail-open đúng hướng nhưng nói sai lý do, và câu chữ trên màn
    // hình sẽ khuyên người dùng đi làm một việc chẳng liên quan.
    expect(
      caPhuTronKhungGio({ ca: null, khung: KHUNG, luoiDaSinh: false, coTrongLuoi: false }),
    ).toBe("CHUA_CO_LUOI");
  });

  // [12] Dữ liệu hỏng chỉ được làm "không kết luận được", không được giết cả form.
  it("giờ buổi hỏng KHÔNG ném — trả KHONG_PHU", () => {
    expect(() => phu("T", "25:70", "19:30")).not.toThrow();
    expect(phu("T", "25:70", "19:30")).toBe("KHONG_PHU");
    expect(phu("T", "", "")).toBe("KHONG_PHU");
    expect(phu("T", "19:30", "18:00")).toBe("KHONG_PHU"); // ngược đầu
    // Đoạn ca hỏng thì bị BỎ chứ không ném, và không kéo theo khối nào.
    expect(() =>
      gopDoanCa([
        { start: "aa:bb", end: "19:00", kind: "WORK" },
        { start: "18:00", end: "18:00", kind: "WORK" },
      ]),
    ).not.toThrow();
    expect(gopDoanCa([{ start: "aa:bb", end: "19:00", kind: "WORK" }])).toEqual([]);
  });
});

describe("khoangThangChua — định nghĩa của 'trong lưới tháng'", () => {
  /** Đọc ra "YYYY-MM-DDTHH:mm" cho dễ đối chiếu bằng mắt khi ca đỏ. */
  function doc(d: Date): string {
    return d.toISOString().slice(0, 16);
  }

  it("giữa tháng → [01 tháng đó, 01 tháng sau)", () => {
    const k = khoangThangChua(new Date(Date.UTC(2026, 8, 17)));
    expect(doc(k.tu)).toBe("2026-09-01T00:00");
    expect(doc(k.den)).toBe("2026-10-01T00:00");
  });

  it("ngày ĐẦU tháng nằm TRONG khoảng (biên dưới đóng)", () => {
    const ngay = new Date(Date.UTC(2026, 8, 1));
    const k = khoangThangChua(ngay);
    expect(k.tu.getTime()).toBe(ngay.getTime());
    expect(ngay.getTime() < k.den.getTime()).toBe(true);
  });

  it("ngày CUỐI tháng nằm TRONG khoảng (biên trên MỞ, không nuốt 01 tháng sau)", () => {
    const ngay = new Date(Date.UTC(2026, 8, 30));
    const k = khoangThangChua(ngay);
    expect(ngay.getTime() < k.den.getTime()).toBe(true);
    expect(doc(k.den)).toBe("2026-10-01T00:00");
  });

  it("tháng 12 cuộn sang năm sau, KHÔNG phải tháng 13", () => {
    const k = khoangThangChua(new Date(Date.UTC(2026, 11, 25)));
    expect(doc(k.tu)).toBe("2026-12-01T00:00");
    expect(doc(k.den)).toBe("2027-01-01T00:00");
  });

  it("tháng 2 năm nhuận: khoảng kết thúc đúng 01/03", () => {
    const k = khoangThangChua(new Date(Date.UTC(2028, 1, 29)));
    expect(doc(k.tu)).toBe("2028-02-01T00:00");
    expect(doc(k.den)).toBe("2028-03-01T00:00");
  });
});

describe("locGiaoVienChoBuoi — ba tầng, miễn trừ, và không bao giờ rỗng câm", () => {
  // [13] ⭐ CA KHOÁ của nhánh `mienLuat` (chốt V1-c: Kiệt & Toại LUÔN hiện).
  it("GV trong mienLuat vẫn hiện dù hôm đó KHÔNG CÓ CA", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        caTheoGv: { "u-kiet": null, "u-nam": caTuDanhMuc("T", "cs1") },
        mienLuat: new Set(["u-kiet"]),
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
    expect(r.ds[0].phu).toBe("KHONG_CO_CA"); // được miễn, KHÔNG phải được "tô hồng"
    expect(r.lyDoRong).toBeNull();
  });

  it("GV trong luonGiu (đang chọn sẵn trên buổi) không bị lọc mất", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        caTheoGv: { "u-kiet": caTuDanhMuc("C", "cs1"), "u-nam": caTuDanhMuc("T", "cs1") },
        luonGiu: new Set(["u-kiet"]),
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
    expect(r.ds[0].phu).toBe("KHONG_PHU");
  });

  // [14a] Fail-open khi hạ tầng chưa sẵn.
  it("CHUA_CO_LUOI ⇒ trả ĐỦ danh sách kèm lyDoRong, không lọc ai", () => {
    const r = locGiaoVienChoBuoi(thamSo({ giaoVien: GV, luoiDaSinh: false }));
    expect(r.ds).toHaveLength(2);
    expect(r.ds.every((d) => d.phu === "CHUA_CO_LUOI")).toBe(true);
    expect(r.lyDoRong).not.toBeNull();
    expect(r.lyDoRong).toContain("lưới ca");
  });

  // [14b] Lọc xong còn 0 người ⇒ vẫn trả đủ + nói vì sao.
  // ⚠️ ĐẢO 17/09/2026 — trước đây ca này khẳng định "lọc còn 0 người ⇒ trả ĐỦ danh sách".
  // Chủ dự án chốt: "ẩn luôn không cần hiện đối với role sale, khi nào không có người thì
  // sale sẽ báo cho đào tạo hoặc quản lý xếp người của cs khác". Đó là một QUY TRÌNH, và
  // nó chỉ chạy được khi màn hình nói thật là KHÔNG CÒN AI — trả đủ danh sách là mời Sale
  // tự xếp đúng người hệ thống vừa kết luận là không rảnh.
  // Vế CÂM vẫn được giữ: rỗng nhưng `lyDoRong` phải nói vì sao VÀ phải làm gì tiếp.
  it("lọc còn 0 người ⇒ danh sách RỖNG, kèm lý do và việc cần làm — không rỗng câm", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        caTheoGv: { "u-kiet": caTuDanhMuc("S", "cs1"), "u-nam": caTuDanhMuc("C", "cs1") },
      }),
    );
    expect(r.ds).toEqual([]);
    expect(r.lyDoRong).not.toBeNull();
    expect(r.lyDoRong).toContain("18:00–19:30");
    // Không được dừng ở "không có ai" — phải chỉ ĐƯỜNG RA, đúng quy trình đã chốt.
    expect(r.lyDoRong).toContain("Đào tạo");
  });

  // ⚠️ ĐẢO 17/09/2026 — trước đây ca này khẳng định `LOC_THEO_CA` GIỮ mã không-giờ.
  // Chủ dự án bác, và lý do là nghiệp vụ: `LDGV` là ca đặt cho giáo viên ĐẾN DẠY lớp đã
  // phân công — chấm công được, lấy công BUỔI DẠY, nhưng KHÔNG lấy công của ca. Nó nói
  // "tôi có mặt cho lớp của tôi", không nói "tôi rảnh nhận thêm việc". `LD` thì còn
  // không cần đến Trung tâm. Cả hai đều không được hiện ra cho người đi xếp buổi.
  it("LOC_THEO_CA giữ PHU_TRON; LOẠI mã không-giờ (LD/LDGV) cùng NGHI / KHONG_PHU / KHONG_CO_CA", () => {
    const ds: readonly GiaoVienChon[] = [
      { id: "u-t", name: "Có ca tối" },
      { id: "u-ld", name: "Linh động" },
      { id: "u-x", name: "Nghỉ" },
      { id: "u-c", name: "Ca chiều" },
      { id: "u-trong", name: "Không ca" },
    ];
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: ds,
        caTheoGv: {
          "u-t": caTuDanhMuc("T", "cs1"),
          "u-ld": caTuDanhMuc("LD", "cs1"),
          "u-x": caTuDanhMuc("X", "cs1"),
          "u-c": caTuDanhMuc("C", "cs1"),
          "u-trong": null,
        },
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-t"]);
    expect(r.lyDoRong).toBeNull();
  });

  // `LDGV` KHÔNG có trong danh mục seed — nó do người vận hành tạo tay trên prod (màn danh
  // mục cho phép thêm mã không cần dev). Dựng thẳng từ hình dạng THẬT thay vì qua
  // `caTuDanhMuc`, đúng luật "fixture phải mang hình dạng dữ liệu thật".
  it("LDGV (mã chỉ có trên prod, không giờ) bị LOẠI khỏi ô chọn", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [{ id: "u-khoi", name: "Lê Khôi" }],
        caTheoGv: {
          "u-khoi": { ma: "LDGV", kind: "FLEXIBLE", centerId: "cs1", segments: [] },
        },
      }),
    );
    // Lọc hết sạch ⇒ danh sách RỖNG kèm lý do (chốt 17/09) — không còn fail-open ở đây.
    expect(r.ds).toEqual([]);
    expect(r.lyDoRong).not.toBeNull();
    // Trạng thái vẫn phải tính đúng, chỉ là không ai lọt qua bộ lọc.
    const r2 = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [{ id: "u-khoi", name: "Lê Khôi" }],
        caTheoGv: { "u-khoi": { ma: "LDGV", kind: "FLEXIBLE", centerId: "cs1", segments: [] } },
        hienTatCa: true,
      }),
    );
    expect(r2.ds[0].phu).toBe("KHONG_GIO");
  });

  // ⚠️ ĐẢO 17/09/2026 — ca này trước đây khẳng định `nhan === "ngày nghỉ"` khi `batLoc:
  // false`. Sai, và chủ dự án báo đúng chỗ: banner trên ô ghi "chưa bật lọc, hiện mọi giáo
  // viên" trong khi từng dòng vẫn dán nhãn của luật ca. Nhãn về CA chỉ được nói khi luật ca
  // đang THẬT SỰ áp cho dòng đó — `phu` thì vẫn tính đủ (nó là sự thật, chỉ không đem khoe).
  it("batLoc=false và cheDo=TAT_CA: KHÔNG lọc ai và KHÔNG dán nhãn ca, nhưng `phu` vẫn tính", () => {
    const vao = {
      giaoVien: GV,
      caTheoGv: { "u-kiet": caTuDanhMuc("X", "cs1"), "u-nam": caTuDanhMuc("C", "cs1") },
    };
    const tat = locGiaoVienChoBuoi(thamSo({ ...vao, batLoc: false }));
    expect(tat.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
    expect(tat.ds[0].phu).toBe("NGHI"); // sự thật vẫn được tính…
    expect(tat.ds[0].nhan).toBe(""); // …nhưng KHÔNG phát ra chữ nào
    expect(tat.ds[0].muc).toBe("KHONG");
    expect(tat.lyDoRong).toBeNull();

    // Tầng Đào tạo cũng không lọc theo ca ⇒ cũng không dán nhãn ca.
    const daoTao = locGiaoVienChoBuoi(thamSo({ ...vao, cheDo: "TAT_CA" }));
    expect(daoTao.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
    expect(daoTao.ds.every((d) => d.nhan === "")).toBe(true);
  });

  it("THEO_CO_SO lọc theo cơ sở và KHÔNG áp luật ca — GV ca chiều của CS1 vẫn hiện", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        cheDo: "THEO_CO_SO",
        coSoChoPhep: new Set(["cs1"]),
        caTheoGv: { "u-kiet": caTuDanhMuc("C", "cs1"), "u-nam": caTuDanhMuc("T", "cs2") },
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-kiet"]); // Nam ở CS2 bị loại
    expect(r.ds[0].phu).toBe("KHONG_PHU"); // nhưng KHÔNG bị loại vì ca
  });

  it("note ĐỎ khi trùng buổi trial khác / buổi lớp chính, và chỉ tính ĐÚNG NGÀY đó", () => {
    const ban: Record<string, BuoiBanCuaGv[]> = {
      "u-kiet": [
        { ymd: YMD, startTime: "19:00", endTime: "20:30", nhan: "Lớp CS1-sata4-Lớp trial 2", nguon: "TRIAL" },
      ],
      "u-nam": [
        // Cùng giờ nhưng NGÀY KHÁC ⇒ không đỏ.
        { ymd: YMD_KHAC, startTime: "18:00", endTime: "19:30", nhan: "Lớp Sata 3 A", nguon: "LOP_CHINH" },
      ],
    };
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        caTheoGv: { "u-kiet": caTuDanhMuc("T", "cs1"), "u-nam": caTuDanhMuc("T", "cs1") },
        banTheoGv: ban,
      }),
    );
    expect(r.ds[0].muc).toBe("DO");
    expect(r.ds[0].nhan).toBe("TRÙNG LỊCH: Lớp CS1-sata4-Lớp trial 2 19:00–20:30");
    expect(r.ds[1].muc).toBe("KHONG");
    expect(r.ds[1].nhan).toBe("");
  });

  it("GV được miễn luật ca VẪN bị note đỏ khi trùng buổi dạy", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [{ id: "u-kiet", name: "Kiệt" }],
        caTheoGv: { "u-kiet": null },
        mienLuat: new Set(["u-kiet"]),
        banTheoGv: {
          "u-kiet": [
            { ymd: YMD, startTime: "18:30", endTime: "20:00", nhan: "Lớp Sata 5 B", nguon: "LOP_CHINH" },
          ],
        },
      }),
    );
    expect(r.ds).toHaveLength(1);
    expect(r.ds[0].muc).toBe("DO");
  });

  it("buổi dạy SÁT NHAU (19:30–21:00) KHÔNG phải trùng lịch", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [{ id: "u-nam", name: "Nam" }],
        caTheoGv: { "u-nam": caTuDanhMuc("T", "cs1") },
        banTheoGv: {
          "u-nam": [{ ymd: YMD, startTime: "19:30", endTime: "21:00", nhan: "Lớp Sata 2 C", nguon: "LOP_CHINH" }],
        },
      }),
    );
    expect(r.ds[0].muc).toBe("KHONG");
  });

  it("danh sách giáo viên rỗng ⇒ ds rỗng nhưng lyDoRong nói rõ", () => {
    const r = locGiaoVienChoBuoi(thamSo({ giaoVien: [] }));
    expect(r.ds).toEqual([]);
    expect(r.lyDoRong).not.toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 (A) — GIÁO VIÊN MỚI KHÔNG ĐƯỢC ẨN CÂM
//
// Lớp lỗi được canh ở đây là loại KHÔNG cổng nào khác trong repo bắt được: một cái tên
// không xuất hiện trong `<select>`. Nó không ném, không đỏ test nào, console sạch — chỉ
// người đi xếp lịch mới biết, và thứ họ kết luận là "hệ thống chưa có anh này" rồi bỏ đi
// nhập tay chỗ khác (luật 12).
// ═════════════════════════════════════════════════════════════════════════════════════

describe("CHUA_VAO_LUOI — dữ liệu THIẾU thì fail-OPEN, kèm nhãn", () => {
  const BA_NGUOI: readonly GiaoVienChon[] = [
    { id: "u-moi", name: "Giáo viên mới tuyển" },
    { id: "u-nghi", name: "Người hôm nay nghỉ" },
    { id: "u-toi", name: "Người ca tối" },
  ];

  /** Cả ba đều KHÔNG có ô ca hôm nay; chỉ khác nhau ở chỗ có tên trong lưới THÁNG hay không. */
  function baNguoi(over: Partial<ThamSoLocGv> = {}) {
    return locGiaoVienChoBuoi(
      thamSo({
        giaoVien: BA_NGUOI,
        caTheoGv: {
          "u-moi": null,
          "u-nghi": null,
          "u-toi": caTuDanhMuc("T", "cs1"),
        },
        // `u-moi` VẮNG MẶT — đó là toàn bộ khác biệt so với `u-nghi`.
        coTrongLuoi: new Set(["u-nghi", "u-toi"]),
        ...over,
      }),
    );
  }

  // ⭐ CA KHOÁ — ĐẢO 17/09/2026. Trước đây ca này khẳng định `u-moi` (chưa vào lưới) được
  // GIỮ kèm nhãn, với lý do fail-open "dữ liệu thiếu về họ, không phải câu trả lời về họ".
  //
  // Đo trên prod bác lý do đó: phép đếm ô-trong-tháng đi qua `scopedDb`, nên nó trả lời
  // "tôi có NHÌN THẤY ca của người này không" chứ không phải "người này đã được xếp ca
  // chưa". Ảnh chụp 17/09 (Tư vấn CS2): 4 người CS2 không nhãn, 4 người CS1 và 2 người Hội
  // sở đều bị dán "CHƯA VÀO LƯỚI CA" — kể cả Kiệt & Toại vốn có 48 ô mã `HC`. Nhãn ấy chỉ
  // đang vẽ lại ranh giới CƠ SỞ dưới một cái tên sai.
  // Chủ dự án chốt: "nếu chưa có trong lưới thì ẩn luôn".
  it("GV chưa vào lưới bị LOẠI, y như GV có trong lưới mà hôm nay trống", () => {
    const r = baNguoi();
    expect(r.ds.map((d) => d.id)).toEqual(["u-toi"]);
    // Vẫn là danh sách ĐÃ LỌC — còn người nên không rơi vào fail-open cả cụm.
    expect(r.lyDoRong).toBeNull();
  });

  it("CHUA_VAO_LUOI vẫn là TRẠNG THÁI riêng, chỉ thôi làm NHÃN", () => {
    // Tách khỏi `KHONG_CO_CA` là có ích cho người đọc mã và cho test; cái bị gỡ là việc
    // đem nó ra nói với người dùng như một sự thật về họ.
    const r = baNguoi({ hienTatCa: true });
    const moi = r.ds.find((d) => d.id === "u-moi");
    expect(moi?.phu).toBe("CHUA_VAO_LUOI");
    expect(moi?.nhan).toBe("");
    expect(moi?.muc).toBe("KHONG");
  });

  it("người ĐƯỢC MIỄN luật ca thì hiện, và KHÔNG bị dán nhãn của luật vừa miễn", () => {
    // Đúng lỗi chủ dự án báo 17/09: khai Kiệt & Toại "luôn hiện" rồi vẫn thấy hai người
    // mang chữ "CHƯA VÀO LƯỚI CA" ngay cạnh tên.
    const r = baNguoi({ mienLuat: new Set(["u-moi"]) });
    const moi = r.ds.find((d) => d.id === "u-moi");
    expect(moi).toBeDefined();
    expect(moi?.nhan).toBe("");
    expect(moi?.muc).toBe("KHONG");
  });

  it("người ĐƯỢC MIỄN vẫn bị note ĐỎ khi trùng buổi dạy — miễn luật ca KHÔNG phải miễn cảnh báo", () => {
    const r = baNguoi({
      mienLuat: new Set(["u-moi"]),
      banTheoGv: {
        "u-moi": [
          { ymd: YMD, startTime: "18:30", endTime: "20:00", nhan: "Lớp Sata 5 B", nguon: "LOP_CHINH" },
        ],
      },
    });
    const dong = r.ds.find((d) => d.id === "u-moi");
    expect(dong?.muc).toBe("DO");
    expect(dong?.nhan).toContain("TRÙNG LỊCH");
  });

  it("lưới CHƯA sinh thì mọi người là CHUA_CO_LUOI, KHÔNG phải CHUA_VAO_LUOI", () => {
    // Thứ tự rẽ nhánh là hợp đồng: sai thứ tự thì cả trung tâm bị gọi là "giáo viên mới"
    // và câu giải thích trên màn hình khuyên người dùng đi làm một việc chẳng liên quan.
    const r = baNguoi({ luoiDaSinh: false, coTrongLuoi: new Set<string>() });
    expect(r.ds.every((d) => d.phu === "CHUA_CO_LUOI")).toBe(true);
    expect(r.lyDoRong).toContain("lưới ca");
  });

  it("tầng TAT_CA / batLoc=false vẫn TÍNH trạng thái, chỉ không lọc", () => {
    const r = baNguoi({ cheDo: "TAT_CA" });
    expect(r.ds.map((d) => d.id)).toEqual(["u-moi", "u-nghi", "u-toi"]);
    expect(r.ds[0].phu).toBe("CHUA_VAO_LUOI");
    expect(r.ds[1].phu).toBe("KHONG_CO_CA");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 (B) — ĐƯỜNG THOÁT KHI HỆ THỐNG SAI
//
// Bộ lọc đọc LƯỚI CA, và lưới lạc hậu được vì hàng chục lý do (đơn vừa duyệt, người vừa
// tuyển, đổi ca miệng, lưới tháng sau chưa bấm sinh). Người xếp lịch biết điều hệ thống
// không biết — nếu không có công tắc thì cách duy nhất vượt một bộ lọc sai là bỏ màn
// hình mà đi nhập tay chỗ khác.
// ═════════════════════════════════════════════════════════════════════════════════════

describe("hienTatCa — bỏ luật lọc cho MỘT lượt, nhưng không bỏ cảnh báo", () => {
  const AI_CUNG_RUNG: Partial<ThamSoLocGv> = {
    giaoVien: GV,
    caTheoGv: { "u-kiet": caTuDanhMuc("X", "cs1"), "u-nam": caTuDanhMuc("C", "cs1") },
  };

  it("TẮT (mặc định) ⇒ lọc như cũ", () => {
    const r = locGiaoVienChoBuoi(thamSo(AI_CUNG_RUNG));
    // Lọc sạch ⇒ fail-open trả đủ, nhưng lý do phải là lý do CỦA HỆ THỐNG.
    expect(r.lyDoRong).toContain("Không giáo viên nào có ca phủ trọn");
  });

  it("BẬT ⇒ giữ đủ danh sách và NÓI RA là đang bỏ lọc", () => {
    const r = locGiaoVienChoBuoi(thamSo({ ...AI_CUNG_RUNG, hienTatCa: true }));
    expect(r.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
    expect(r.lyDoRong).toContain("HIỆN TẤT CẢ");
    // Câu lý do phải là câu của NGƯỜI DÙNG vừa bấm, không phải lý do kỹ thuật khác.
    expect(r.lyDoRong).not.toContain("phủ trọn");
  });

  it("BẬT KHÔNG tô hồng ai — `phu`/`nhan` giữ nguyên sự thật", () => {
    const r = locGiaoVienChoBuoi(thamSo({ ...AI_CUNG_RUNG, hienTatCa: true }));
    expect(r.ds[0].phu).toBe("NGHI");
    expect(r.ds[0].nhan).toBe("ngày nghỉ");
    expect(r.ds[1].phu).toBe("KHONG_PHU");
  });

  // ⭐ CA KHOÁ: đây là thứ tuyệt đối không được mất khi tắt bộ lọc.
  it("BẬT vẫn giữ note ĐỎ trùng lịch", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        ...AI_CUNG_RUNG,
        hienTatCa: true,
        banTheoGv: {
          "u-kiet": [
            { ymd: YMD, startTime: "19:00", endTime: "20:30", nhan: "Lớp Sata 4 A", nguon: "LOP_CHINH" },
          ],
        },
      }),
    );
    expect(r.ds[0].muc).toBe("DO");
    expect(r.ds[0].nhan).toBe("TRÙNG LỊCH: Lớp Sata 4 A 19:00–20:30");
  });

  it("BẬT cũng bỏ luôn lọc theo CƠ SỞ (tầng THEO_CO_SO)", () => {
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: GV,
        cheDo: "THEO_CO_SO",
        coSoChoPhep: new Set(["cs1"]),
        caTheoGv: { "u-kiet": caTuDanhMuc("C", "cs1"), "u-nam": caTuDanhMuc("T", "cs2") },
        hienTatCa: true,
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-kiet", "u-nam"]);
  });

  it("BẬT mà danh sách giáo viên RỖNG ⇒ vẫn nói 'chưa có giáo viên nào', không nói 'đang hiện tất cả'", () => {
    // Một câu "đang hiện tất cả giáo viên" phía trên một ô chọn TRỐNG là lời nói dối
    // trắng trợn nhất mà màn này có thể phát ra.
    const r = locGiaoVienChoBuoi(thamSo({ giaoVien: [], hienTatCa: true }));
    expect(r.ds).toEqual([]);
    expect(r.lyDoRong).toBe("Chưa có giáo viên nào trong danh sách để chọn.");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// LƯỚI CA THẬT — chụp từ màn /cham-cong/phan-ca ngày 17/09/2026
//
// Vì sao khối này tồn tại: các ca trên dùng mã lẻ để canh từng nhánh luật. Khối này canh
// thứ khác — rằng luật ghép lại vẫn cho ra ĐÚNG NGƯỜI trên lịch đang chạy thật. Chủ dự án
// chốt hai khung trial:
//   · T3–T6  → buổi TỐI   17:30–21:00
//   · T7/CN  → buổi SÁNG hoặc CHIỀU (không ai trực tối cuối tuần)
// T2 cả trung tâm nghỉ (`X`) — đó là lý do phép đo prod ra "14/30 ngày không ai có ca tối":
// 4 thứ Hai + 4 thứ Bảy + 4 Chủ nhật, KHÔNG phải lỗ hổng phân ca.
//
// Con số chốt (đếm tay từ lưới, ghi ra đây để ai sửa luật còn biết mình vừa làm lệch cái gì):
//   CS1 tối  T3:2  T4:2  T5:3  T6:3      CS2 tối  T3:1  T4:1  T5:4  T6:1
// CS2 có ba tối chỉ đúng MỘT giáo viên — chủ dự án xác nhận 17/09 đó là kết quả ĐÚNG.
// ═════════════════════════════════════════════════════════════════════════════════════

/** Lưới tuần thật. "—" = ô trống (không có dòng ShiftAssignment nào). */
const LUOI_THAT: Record<string, { ten: string; cs: string; tuan: Record<string, string> }> = {
  // CS1 — 211 Nguyễn Hữu Thọ
  "u-khoi":   { ten: "Lê Khôi",              cs: "cs1", tuan: { T3: "T",  T4: "T",  T5: "T",  T6: "T",  T7: "LDGV", CN: "SC" } },
  "u-tramy":  { ten: "Hoàng Trà My",         cs: "cs1", tuan: { T3: "CT", T4: "T",  T5: "—",  T6: "—",  T7: "C",    CN: "SC" } },
  "u-uyen":   { ten: "Phan Trần Mai Uyên",   cs: "cs1", tuan: { T3: "C",  T4: "—",  T5: "CT", T6: "T",  T7: "C",    CN: "S"  } },
  "u-hoanganh": { ten: "Nguyễn Thị Hoàng Anh", cs: "cs1", tuan: { T3: "C", T4: "—", T5: "T",  T6: "T",  T7: "S",    CN: "SC" } },
  // CS2 — 114 Hoàng Diệu
  "u-baothu": { ten: "Nguyễn Trần Bảo Thư",  cs: "cs2", tuan: { T3: "—",  T4: "—",  T5: "CT", T6: "T",  T7: "C",    CN: "SC" } },
  "u-hien":   { ten: "Phạm Lê Thanh Hiền",   cs: "cs2", tuan: { T3: "—",  T4: "T",  T5: "CT", T6: "—",  T7: "C",    CN: "SC" } },
  "u-tuan":   { ten: "Nguyễn Đức Tuấn",      cs: "cs2", tuan: { T3: "T",  T4: "—",  T5: "T",  T6: "C",  T7: "SC",   CN: "S"  } },
  "u-tra":    { ten: "Nguyễn Bích Trà",      cs: "cs2", tuan: { T3: "C",  T4: "—",  T5: "CT", T6: "—",  T7: "C",    CN: "SC" } },
};

/** Ai của cơ sở `cs` lọt vào ô chọn, cho khung giờ này, vào thứ này. */
function aiChonDuoc(cs: string, thu: string, startTime: string, endTime: string): string[] {
  const gv: GiaoVienChon[] = [];
  const caTheoGv: Record<string, CaNgay | null> = {};
  for (const [id, r] of Object.entries(LUOI_THAT)) {
    if (r.cs !== cs) continue;
    gv.push({ id, name: r.ten });
    const ma = r.tuan[thu];
    caTheoGv[id] =
      ma === "—"
        ? null
        : ma === "LDGV"
          ? { ma: "LDGV", kind: "FLEXIBLE", centerId: cs, segments: [] } // mã chỉ có trên prod
          : caTuDanhMuc(ma, cs);
  }
  const r = locGiaoVienChoBuoi(
    thamSo({ giaoVien: gv, caTheoGv, khung: { ymd: YMD, startTime, endTime }, coSoChoPhep: new Set([cs]) }),
  );
  // Lọc sạch ⇒ fail-open trả ĐỦ danh sách; ở đây trả [] để phân biệt với "có người thật".
  return r.lyDoRong ? [] : r.ds.map((d) => d.id);
}

describe("lưới ca THẬT × khung trial THẬT (chốt 17/09/2026)", () => {
  describe("T3–T6 · buổi TỐI 17:30–21:00", () => {
    it.each([
      ["T3", ["u-khoi", "u-tramy"]],
      ["T4", ["u-khoi", "u-tramy"]],
      ["T5", ["u-khoi", "u-uyen", "u-hoanganh"]],
      ["T6", ["u-khoi", "u-uyen", "u-hoanganh"]],
    ])("CS1 %s", (thu, mong) => {
      expect(aiChonDuoc("cs1", thu, "17:30", "21:00")).toEqual(mong);
    });

    // CS2 ba tối chỉ MỘT người — đúng luật, không phải rule hỏng.
    it.each([
      ["T3", ["u-tuan"]],
      ["T4", ["u-hien"]],
      ["T5", ["u-baothu", "u-hien", "u-tuan", "u-tra"]],
      ["T6", ["u-baothu"]],
    ])("CS2 %s", (thu, mong) => {
      expect(aiChonDuoc("cs2", thu, "17:30", "21:00")).toEqual(mong);
    });

    it("ca C (13:45–17:30) KHÔNG lọt buổi tối — hết ca đúng lúc trial bắt đầu", () => {
      expect(aiChonDuoc("cs2", "T3", "17:30", "21:00")).not.toContain("u-tra"); // Bích Trà mang C
    });

    it("CT lọt được là nhờ GỘP qua khoảng nghỉ 16:30–17:30 (Trà My T3)", () => {
      expect(LUOI_THAT["u-tramy"].tuan.T3).toBe("CT");
      expect(aiChonDuoc("cs1", "T3", "17:30", "21:00")).toContain("u-tramy");
    });
  });

  describe("T7/CN · buổi SÁNG và CHIỀU", () => {
    it("CN sáng 09:00–10:30 — SC và S đều phủ", () => {
      expect(aiChonDuoc("cs1", "CN", "09:00", "10:30")).toEqual([
        "u-khoi", "u-tramy", "u-uyen", "u-hoanganh",
      ]);
    });

    it("CN chiều 14:00–15:30 — S (07:45–11:30) rụng, chỉ còn SC", () => {
      expect(aiChonDuoc("cs1", "CN", "14:00", "15:30")).toEqual([
        "u-khoi", "u-tramy", "u-hoanganh",
      ]); // Mai Uyên mang S → không phủ buổi chiều
    });

    it("T7 chiều 14:00–15:30 CS2 — ba người ca C, Đức Tuấn ca SC", () => {
      expect(aiChonDuoc("cs2", "T7", "14:00", "15:30")).toEqual([
        "u-baothu", "u-hien", "u-tuan", "u-tra",
      ]);
    });

    it("T7 CS1: Lê Khôi mang LDGV ⇒ KHÔNG hiện (đến dạy lớp đã phân công, không nhận thêm)", () => {
      expect(aiChonDuoc("cs1", "T7", "09:00", "10:30")).toEqual(["u-hoanganh"]); // chỉ ca S
    });

    it("cuối tuần KHÔNG ai nhận được buổi tối — nguồn của '14/30 ngày trống'", () => {
      expect(aiChonDuoc("cs1", "T7", "17:30", "21:00")).toEqual([]);
      expect(aiChonDuoc("cs1", "CN", "17:30", "21:00")).toEqual([]);
      expect(aiChonDuoc("cs2", "T7", "17:30", "21:00")).toEqual([]);
      expect(aiChonDuoc("cs2", "CN", "17:30", "21:00")).toEqual([]);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// VÁ 17/09/2026 (C) — CHE LÝ DO, KHÔNG CHE NGƯỜI
//
// Ô chọn giáo viên mở cho CẢ Sale (`trials:manage`), mà Sale CỐ Ý không có
// `hr_attendance:view`: màn `/admin/cham-cong` khoá sau đúng khoá đó
// (`lib/cham-cong/module-scope.ts`), khối "ai nghỉ 7 ngày tới" ở dashboard còn gác bằng
// `hr_attendance:approve`. Nhưng hàm này tính `nhan` cho MỌI dòng rồi trả xuống client, và
// ba nhãn trong đó CHÍNH LÀ lịch nghỉ/lịch làm cá nhân. Gọi lặp endpoint theo từng ngày là
// dựng lại lịch nghỉ cả tháng của mọi giáo viên trong tầm nhìn — không ném, không cảnh báo,
// chỉ là một trường trong payload mà không ai nhìn.
//
// Bộ này canh HAI chiều, và chiều thứ hai quan trọng ngang chiều thứ nhất:
//   · che rồi thì KHÔNG còn chữ nào nói về nghỉ/ca của một người;
//   · che rồi thì DANH SÁCH NGƯỜI, `phu`, `muc` và note đỏ KHÔNG ĐỔI một dòng nào.
//
// ── CẤY LẠI LỖI (luật 15) — đã chạy THẬT, số đo chứ không phải dự đoán ────────────────
//   · `nhanChoDong` bỏ hẳn vế che (trả thẳng `NHAN_THEO_PHU[phu]`) → **3 ĐỎ / 64**;
//   · che QUÁ TAY (thêm `KHONG_PHU`/`KHONG_GIO`/`CHUA_CO_LUOI` vào `PHU_LO_LICH_CA_NHAN`)
//     → **2 ĐỎ / 64** — ranh giới của bản vá cũng được canh, không chỉ chiều rò;
//   · che luôn note ĐỎ trùng lịch (`trung && input.duocXemLyDoNghi`) → **1 ĐỎ / 64**.
// ═════════════════════════════════════════════════════════════════════════════════════

describe("duocXemLyDoNghi — che LÝ DO, không che NGƯỜI", () => {
  const BA_CANH: readonly GiaoVienChon[] = [
    { id: "u-nghi", name: "Người xin nghỉ" },
    { id: "u-trong", name: "Người không xếp ca hôm nay" },
    { id: "u-moi", name: "Giáo viên mới tuyển" },
  ];

  /**
   * Ba người rơi vào ĐÚNG ba trạng thái khai ra lịch cá nhân: NGHI · KHONG_CO_CA ·
   * CHUA_VAO_LUOI.
   *
   * ⚠️ `batLoc: false` là HÌNH DẠNG THẬT đang chạy, không phải cho tiện: cờ
   * `trial.locGvTheoCaLamViec` mặc định TẮT, và đó chính là lý do cờ đó KHÔNG cứu được
   * chỗ rò này — hàm vẫn tính `phu`/`nhan` cho MỌI dòng rồi trả hết xuống client.
   * Ba đường khác cũng đẩy đủ nhãn ra ngoài (fail-open khi lọc sạch · `mienLuat`/`luonGiu`
   * luôn giữ · công tắc "Hiện tất cả") — có ca riêng ở dưới cho đường fail-open.
   */
  function baCanh(duocXem: boolean, over: Partial<ThamSoLocGv> = {}) {
    return locGiaoVienChoBuoi(
      thamSo({
        giaoVien: BA_CANH,
        caTheoGv: {
          "u-nghi": caTuDanhMuc("X", "cs1"), // mã nghỉ THẬT trong danh mục
          "u-trong": null,
          "u-moi": null,
        },
        coTrongLuoi: new Set(["u-nghi", "u-trong"]), // `u-moi` vắng ⇒ CHUA_VAO_LUOI
        batLoc: false,
        ...over,
        duocXemLyDoNghi: duocXem,
      }),
    );
  }

  // ⭐ CA KHOÁ — mạnh hơn bản trước, và mạnh hơn một cách ngoài dự tính.
  //
  // `baCanh` chạy với `batLoc: false`, tức ĐÚNG hình dạng đang chạy trên prod (cờ
  // `trial.locGvTheoCaLamViec` mặc định TẮT). Bản vá 17/09 — "nhãn ca chỉ nói khi luật ca
  // đang thật sự áp" — làm chỗ rò này đóng NGAY TẠI NGUỒN chứ không còn phải che chữ:
  // không nhãn nào được sinh ra thì không có gì để rò.
  //
  // Vế `duocXemLyDoNghi` KHÔNG thừa: nó là lớp thứ hai, cho lúc cờ lọc BẬT (ca dưới).
  it("cờ lọc TẮT (mặc định prod) ⇒ KHÔNG nhãn nào phát ra, bất kể có quyền chấm công hay không", () => {
    for (const coQuyen of [false, true]) {
      const r = baCanh(coQuyen);
      expect(r.ds.map((d) => d.nhan)).toEqual(["", "", ""]);
      const moiChu = `${r.ds.map((d) => d.nhan).join(" ")} ${r.lyDoRong ?? ""}`.toLowerCase();
      for (const cam of ["nghỉ", "xếp ca", "lưới tháng"]) {
        expect(moiChu, `coQuyen=${coQuyen}`).not.toContain(cam);
      }
    }
  });

  it("cờ lọc BẬT + KHÔNG quyền chấm công ⇒ nhãn gộp về MỘT chữ trung tính", () => {
    // Cả ba đều rớt luật ca ⇒ lọc sạch ⇒ danh sách RỖNG (chốt 17/09). Nên đường còn đẩy
    // nhãn ra ngoài là CÔNG TẮC "Hiện tất cả" — bật nó lên mới đọc được tập nhãn.
    const r = baCanh(false, { batLoc: true, hienTatCa: true });
    expect(r.ds.map((d) => d.nhan)).toEqual([
      "không nhận buổi này",
      "không nhận buổi này",
      // `CHUA_VAO_LUOI` KHÔNG có chữ — trạng thái đó bị nhiễu bởi phạm vi nhìn nên không
      // bao giờ đáng tin để đem nói (xem `nhanChoDong`).
      "",
    ]);
    const moiChu = `${r.ds.map((d) => d.nhan).join(" ")} ${r.lyDoRong ?? ""}`.toLowerCase();
    for (const cam of ["nghỉ", "xếp ca", "lưới tháng"]) {
      expect(moiChu).not.toContain(cam);
    }
  });

  it("cờ lọc BẬT + CÓ quyền ⇒ ba nhãn vẫn KHÁC NHAU và nói đúng lý do", () => {
    // Vế đối chứng: che nhầm cả người có quyền cũng là lỗi, chỉ ngược chiều.
    expect(baCanh(true, { batLoc: true, hienTatCa: true }).ds.map((d) => d.nhan)).toEqual([
      "ngày nghỉ",
      "chưa xếp ca ngày này",
      // Có quyền chấm công cũng KHÔNG mở được chữ cho `CHUA_VAO_LUOI`: vấn đề của nó
      // không phải quyền, mà là bản thân phép đếm không phân biệt nổi "chưa xếp ca" với
      // "làm ở cơ sở bạn không nhìn thấy".
      "",
    ]);
  });

  // ⭐ CA KHOÁ thứ hai: che CHỮ, không che CƠ CHẾ.
  it("che nhãn KHÔNG đổi danh sách người, KHÔNG đổi `phu`/`muc`", () => {
    const co = baCanh(true);
    const khong = baCanh(false);
    expect(khong.ds.map((d) => d.id)).toEqual(co.ds.map((d) => d.id));
    expect(khong.ds.map((d) => d.phu)).toEqual(co.ds.map((d) => d.phu));
    expect(khong.ds.map((d) => d.muc)).toEqual(co.ds.map((d) => d.muc));
    // Và `phu` vẫn là sự thật, không bị "tô hồng" thành PHU_TRON để giấu.
    expect(khong.ds.map((d) => d.phu)).toEqual(["NGHI", "KHONG_CO_CA", "CHUA_VAO_LUOI"]);
  });

  it("đường FAIL-OPEN (lọc sạch, trả ĐỦ danh sách) cũng phải che — đây là đường rò rộng nhất", () => {
    // ⚠️ ĐẢO 17/09 — đường fail-open "lọc sạch ⇒ trả đủ danh sách" ĐÃ BỊ GỠ, nên đường rò
    // rộng nhất bây giờ là CÔNG TẮC "Hiện tất cả giáo viên": người dùng tự bấm, và nó trả
    // nguyên danh sách kèm đủ nhãn. Vế che vẫn phải đứng ở đó.
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [BA_CANH[0], BA_CANH[1]],
        caTheoGv: { "u-nghi": caTuDanhMuc("X", "cs1"), "u-trong": null },
        coTrongLuoi: new Set(["u-nghi", "u-trong"]),
        batLoc: true,
        hienTatCa: true,
        duocXemLyDoNghi: false,
      }),
    );
    expect(r.ds.map((d) => d.id)).toEqual(["u-nghi", "u-trong"]);
    expect(r.lyDoRong).not.toBeNull();
    expect(r.ds.map((d) => d.nhan)).toEqual(["không nhận buổi này", "không nhận buổi này"]);
  });

  it("note ĐỎ trùng lịch KHÔNG bị che — nó nói về buổi dạy, không về ngày nghỉ", () => {
    const r = baCanh(false, {
      banTheoGv: {
        "u-nghi": [
          { ymd: YMD, startTime: "18:30", endTime: "20:00", nhan: "Lớp Sata 5 B", nguon: "LOP_CHINH" },
        ],
      },
    });
    const dong = r.ds.find((d) => d.id === "u-nghi");
    expect(dong?.muc).toBe("DO");
    expect(dong?.nhan).toBe("TRÙNG LỊCH: Lớp Sata 5 B 18:30–20:00");
  });

  it("KHONG_PHU / KHONG_GIO / CHUA_CO_LUOI KHÔNG bị che — chúng không nói về nghỉ phép", () => {
    // Ranh giới của bản vá, viết ra để lần sau ai nới/thu cũng thấy ngay: ba trạng thái
    // này nói về ca HÔM ĐÓ so với ĐÚNG khung giờ đang xếp (người vẫn đang đi làm), hoặc
    // nói về LƯỚI của cả trung tâm — không cái nào là thông tin nghỉ phép của một người.
    const r = locGiaoVienChoBuoi(
      thamSo({
        giaoVien: [
          { id: "u-c", name: "Ca chiều" },
          { id: "u-ld", name: "Linh động" },
        ],
        caTheoGv: {
          "u-c": caTuDanhMuc("C", "cs1"),
          "u-ld": caTuDanhMuc("LD", "cs1"),
        },
        // Cả hai đều rớt luật ca ⇒ danh sách rỗng; bật công tắc để đọc được tập nhãn.
        hienTatCa: true,
        duocXemLyDoNghi: false,
      }),
    );
    expect(r.ds.map((d) => d.nhan)).toEqual([
      "ca không phủ trọn giờ buổi",
      "ca không nhận thêm buổi",
    ]);

    const chuaLuoi = locGiaoVienChoBuoi(
      thamSo({ giaoVien: GV, luoiDaSinh: false, duocXemLyDoNghi: false }),
    );
    expect(chuaLuoi.ds[0].nhan).toBe("chưa sinh lưới ca tháng này");
  });

  it("nhanChoDong — bảng nhãn đầy đủ của CẢ HAI phía, đọc một lượt", () => {
    // Bảng này là hợp đồng. Thêm một `KetQuaPhuCa` mới mà quên xếp nó vào đúng phía thì
    // ca này đỏ ngay, thay vì im lặng rò một chuỗi mới.
    const moi: KetQuaPhuCa[] = [
      "PHU_TRON",
      "KHONG_PHU",
      "NGHI",
      "KHONG_GIO",
      "KHONG_CO_CA",
      "CHUA_VAO_LUOI",
      "CHUA_CO_LUOI",
    ];
    expect(moi.map((p) => nhanChoDong(p, false))).toEqual([
      "",
      "ca không phủ trọn giờ buổi",
      "không nhận buổi này",
      "ca không nhận thêm buổi",
      "không nhận buổi này",
      "", // CHUA_VAO_LUOI — không bao giờ thành chữ, cả hai phía quyền
      "chưa sinh lưới ca tháng này",
    ]);
    expect(moi.map((p) => nhanChoDong(p, true))).toEqual([
      "",
      "ca không phủ trọn giờ buổi",
      "ngày nghỉ",
      "ca không nhận thêm buổi",
      "chưa xếp ca ngày này",
      "", // CHUA_VAO_LUOI — quyền KHÔNG mở được chữ cho nó, xem dưới
      "chưa sinh lưới ca tháng này",
    ]);
  });

  // ⭐ CA KHOÁ của bản vá 17/09 — đọc CẢ HAI phía quyền trong MỘT khẳng định.
  it("CHUA_VAO_LUOI câm ở CẢ HAI phía quyền — nó không phải chuyện quyền", () => {
    expect(nhanChoDong("CHUA_VAO_LUOI", false)).toBe("");
    expect(nhanChoDong("CHUA_VAO_LUOI", true)).toBe("");
    // Vì sao không gộp nó vào nhóm "che vì thiếu quyền": người CÓ quyền chấm công cũng
    // không nên đọc chuỗi đó, vì chuỗi đó SAI với họ luôn. Phép đếm sinh ra trạng thái này
    // đi qua `scopedDb`, nên nó nói "tôi không nhìn thấy ca của người này" chứ không nói
    // "người này chưa được xếp ca" — và hai câu đó ngược nghĩa nhau về vận hành.
    // Chốt của chủ dự án 17/09 sau khi thấy Kiệt & Toại (48 ô mã `HC`) bị dán nhãn ấy.
  });
});
