// lib/orders/pham-vi/khoi-ke-hoach.test.ts — CỔNG D: đơn theo PHẠM VI HỌC không dùng kế hoạch thanh toán nhiều đợt.
//
// Hai lớp, và vì sao cả hai đều cần:
//   1 · [P-D-01..07] hàm THUẦN `khoiKeHoachTrangDon` — vị từ duy nhất UI và máy chủ cùng hỏi.
//   2 · [P-D-W*]     LƯỚI GHIM DÂY NỐI — page.tsx là RSC, `recordInstallmentPlan`/`taoDotChoCon` chạm DB; không ca hành vi
//                    nào ở tầng này chứng minh được "cổng nằm TRƯỚC phép ghi" hay "prop được truyền đủ hai bậc". Theo luật 11 của
//                    CLAUDE.md: bóc chú thích TRƯỚC khi đếm, neo chuỗi hẹp, đếm SỐ LẦN, không cờ `/s`.
//   (Hành vi trên Postgres thật: tests/finance/don-pham-vi-ke-hoach-dot-db.test.ts [P-D-DB-*]; render thật: các ca
//    `[P-D-1x]` ở app/(admin)/admin/orders/_components/khoi-ke-hoach-don.test.tsx.)
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "./ke-hoach-don";
import { KHOA_PHAM_VI, metadataChoDong } from "./doc-dong";
import { LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT, khoiKeHoachTrangDon } from "./khoi-ke-hoach";

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: new Date("2026-10-11T03:00:00Z"), // luật 19: ngày tuyệt đối, không đồng hồ thật
  coKeHoachDot: false,
};
const KHOA = "khoa-sata3";
const dongVao = (o: Partial<DongVao> = {}): DongVao => ({
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: 2_640_000,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 12,
  gia48: 10_560_000,
  conKhoa: "con-a",
  ...o,
});

/** Metadata của MỘT dòng SCOPE thật — đi qua đúng planner + hàm ghi mà tạo đơn dùng. */
function metadataScope(): Record<string, unknown> {
  const kq = keHoachDon([dongVao()], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: 12 }, KHOA);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: dòng không SCOPE");
  return md;
}
const dongScope = () => ({ type: "COURSE_ENROLLMENT", metadata: metadataScope() });
const dongThuong = (metadata: unknown = { courseId: KHOA, soBuoi: 48 }) => ({ type: "COURSE_ENROLLMENT", metadata });

describe("[P-D-01..07] khoiKeHoachTrangDon — vị từ DUY NHẤT: đơn nào dùng khối kế hoạch nhiều đợt", () => {
  it("[P-D-01] đơn có dòng SCOPE hợp lệ ⇒ PHAM_VI (đối chứng dương cho cả nhóm: hàm CÓ khả năng trả PHAM_VI)", () => {
    expect(khoiKeHoachTrangDon([dongScope()])).toBe("PHAM_VI");
  });

  it("[P-D-02] đơn thường / legacy / không dấu ⇒ KE_HOACH, nguyên chữ (metadata null, rỗng, chỉ courseId+soBuoi, mảng, chuỗi)", () => {
    expect(khoiKeHoachTrangDon([dongThuong()])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([dongThuong(null)])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([dongThuong({})])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([dongThuong([])])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([dongThuong("phamVi")])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([{ type: "PRODUCT", metadata: null }])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([])).toBe("KE_HOACH");
  });

  it("[P-D-03] đơn phí học bù ⇒ PHI_HOC_BU (đường cũ, xét TRƯỚC); đơn trộn học bù + khoá thường ⇒ KE_HOACH như cũ", () => {
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: null }])).toBe("PHI_HOC_BU");
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: null }, dongThuong()])).toBe("KE_HOACH");
    // Phí học bù thắng cả khi metadata mang dấu SCOPE (không tồn tại thật; ghim thứ tự để câu học bù không bị đổi).
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: metadataScope() }])).toBe("PHI_HOC_BU");
  });

  it("[P-D-04] dấu HỎNG / giả hình dạng ⇒ KE_HOACH (fail-closed về 'không phải SCOPE', giống `docPhamViDong`) — mỗi phép cấy một vế", () => {
    const md = metadataScope();
    const khoi = md[KHOA_PHAM_VI] as Record<string, unknown>;
    const voi = (v: Record<string, unknown>, ngoai: Record<string, unknown> = {}) =>
      khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { ...md, ...ngoai, [KHOA_PHAM_VI]: { ...khoi, ...v } } }]);
    expect(voi({})).toBe("PHAM_VI"); // đối chứng dương
    expect(voi({ phienBan: 2 })).toBe("KE_HOACH");
    expect(voi({ thanhTien: 1 })).toBe("KE_HOACH");
    expect(voi({ soBuoiMua: 13 }, { soBuoi: 13 })).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { ...md, soBuoi: 24 } }])).toBe("KE_HOACH");
    expect(khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { courseId: KHOA, soBuoi: 12, [KHOA_PHAM_VI]: true } }])).toBe("KE_HOACH");
  });

  it("[P-D-05] đơn TRỘN (một dòng SCOPE + dòng khác) ⇒ PHAM_VI: gác phía chặt (đơn trộn bị tạo-đơn từ chối nên không có thật)", () => {
    expect(khoiKeHoachTrangDon([dongThuong(), dongScope()])).toBe("PHAM_VI");
    expect(khoiKeHoachTrangDon([dongScope(), { type: "PRODUCT", metadata: null }])).toBe("PHAM_VI");
  });

  it("[P-D-06] chỉ đọc DỮ LIỆU: hàm có đúng một tham số (không nhận cờ) và tệp không hỏi cờ/setting nào", () => {
    expect(khoiKeHoachTrangDon.length).toBe(1);
    const src = boChuThich(doc("lib/orders/pham-vi/khoi-ke-hoach.ts"));
    for (const cam of ["getSetting", "laThuHocPhiTheoPhamViBat", "phamViDangBat", "scopePurchaseEnabled", "@/lib/flags", "@/lib/db", "centerSetting", "KHOA_CONG_TAC_PHAM_VI", "process.env"]) {
      expect(src, cam).not.toContain(cam);
    }
  });

  it("[P-D-07] câu chữ ghim NGUYÊN VĂN (chủ dự án chốt) và là MỘT chuỗi cho cả UI lẫn máy chủ", () => {
    expect(LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT).toBe("Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LƯỚI GHIM DÂY NỐI
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bóc chú thích khối, chú thích dòng và chú thích JSX TRƯỚC khi đếm (luật 11: chú thích giải thích bản vá chứa đúng chuỗi đang cấm). */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
/** Thân hàm `export async function <ten>(…) { … }` — đếm ngoặc nhọn. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) throw new Error(`không thấy hàm ${ten}`);
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  // Thân hàm = dấu `{` đầu tiên đứng ngay sau `)` hoặc `>` (kiểu trả về `Promise<{ … }>` có `{` đứng sau `<` nên bị bỏ qua).
  let mo = i;
  do mo = src.indexOf("{", mo + 1);
  while (mo >= 0 && !/[)>]\s*$/.test(src.slice(0, mo)));
  if (mo < 0) throw new Error(`không thấy thân hàm ${ten}`);
  let dem = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") dem++;
    else if (src[j] === "}" && --dem === 0) return src.slice(mo, j + 1);
  }
  throw new Error(`không đóng được hàm ${ten}`);
}
/** Liệt kê mọi tệp nguồn .ts/.tsx (không test) dưới các thư mục gốc, đường dẫn dùng "/" . */
function lietKeNguon(goc: string[]): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const e of readdirSync(resolve(process.cwd(), d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        di(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) ra.push(p);
    }
  };
  for (const g of goc) di(g);
  // Phép quét phải THẤY tệp: rỗng là lưới chết mà vẫn xanh.
  if (ra.length < 500) throw new Error(`lietKeNguon chỉ thấy ${ra.length} tệp`);
  return ra;
}
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[P-D-W1..W6] lưới ghim dây nối — cổng máy chủ đứng TRƯỚC phép ghi; prop truyền đủ hai bậc", () => {
  it("[P-D-W1] recordInstallmentPlan: cổng `laDonPhamVi(order.items)` ĐÚNG MỘT LẦN, sau cổng phí học bù, TRƯỚC `$transaction`, và `items` có `select metadata`", () => {
    const than = boChuThich(thanHam(boChuThich(doc("lib/orders/installments.ts")), "recordInstallmentPlan"));
    expect(dem(than, /laDonPhamVi\(order\.items\)/g)).toBe(1);
    expect(dem(than, /LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT/g)).toBe(1);
    const cong = than.indexOf("laDonPhamVi(order.items)");
    const phiBu = than.indexOf("laDonPhiHocBu(order.items)");
    const giaoDich = than.indexOf("db.$transaction(");
    expect(phiBu).toBeGreaterThan(0);
    expect(cong).toBeGreaterThan(phiBu);
    expect(giaoDich).toBeGreaterThan(cong);
    // Thiếu `metadata` trong select thì `laDonPhamVi` đọc `undefined` ⇒ LUÔN false ⇒ cổng chết mà không lỗi nào báo.
    expect(dem(than, /items:\s*\{\s*select:\s*\{\s*type:\s*true,\s*metadata:\s*true\s*\}\s*\}/g)).toBe(1);
    // Trả `{ ok: false … }` (không `throw`) là chấp nhận được CHỈ vì đứng trước mọi phép ghi: không phép ghi nào nằm trước cổng.
    const truocCong = than.slice(0, cong);
    expect(truocCong).not.toMatch(/\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/);
  });

  it("[P-D-W2] taoDotChoCon: cổng đọc dấu TRONG khoá đơn, TRƯỚC `taoDotChoConTrongTx` (phép ghi), đúng một lần; `taoDotChoConTrongTx` KHÔNG bị gác (đổi khoá dùng nó)", () => {
    const src = boChuThich(doc("lib/finance/ghi-tien-don.ts"));
    const than = thanHam(src, "taoDotChoCon");
    expect(dem(than, /laDonPhamVi\(dong\)/g)).toBe(1);
    expect(dem(than, /tx\.orderItem\.findMany\(\s*\{\s*where:\s*\{\s*orderId:\s*input\.orderId\s*\}\s*,\s*select:\s*\{\s*metadata:\s*true\s*\}\s*\}\s*\)/g)).toBe(1);
    expect(than.indexOf("laDonPhamVi(dong)")).toBeGreaterThan(0);
    expect(than.indexOf("taoDotChoConTrongTx(tx, so, input)")).toBeGreaterThan(than.indexOf("laDonPhamVi(dong)"));
    expect(than).toContain("ghiTienChoDon(");
    expect(dem(thanHam(src, "taoDotChoConTrongTx"), /laDonPhamVi/g)).toBe(0);
  });

  it("[P-D-W3] trang đơn: CongNoTheoCon nhận `donPhamVi={laDonPhamVi(order.items)}` — đúng một chỗ gọi, đúng một lần", () => {
    const src = boChuThich(doc("app/(admin)/admin/orders/[id]/page.tsx"));
    expect(dem(src, /<CongNoTheoCon\b/g)).toBe(1);
    expect(dem(src, /donPhamVi=\{laDonPhamVi\(order\.items\)\}/g)).toBe(1);
    // Và nó ở BÊN TRONG phần tử CongNoTheoCon, không phải ở phần tử khác.
    const tu = src.indexOf("<CongNoTheoCon");
    const den = src.indexOf("/>", tu);
    expect(src.slice(tu, den)).toContain("donPhamVi={laDonPhamVi(order.items)}");
  });

  it("[P-D-W4] OrderDetailClient: quyết định khối qua `khoiKeHoachTrangDon(order.items)` ĐÚNG MỘT LẦN; nhánh PHAM_VI thay khối kế hoạch; PaymentRequestsSection nhận cờ", () => {
    const src = boChuThich(doc("app/(admin)/admin/orders/_components/order-detail-client.tsx"));
    expect(dem(src, /khoiKeHoachTrangDon\(order\.items\)/g)).toBe(1);
    // [14/10/2026, vá sau smoke] 3 chỗ: một nhánh thay khối, một prop xuống bảng phiếu thu, một prop xuống khối Công nợ (nhãn "Đã thu" của đơn phạm vi).
    expect(dem(src, /khoiKeHoach === "PHAM_VI"/g)).toBe(3);
    expect(dem(src, /donPhamVi=\{khoiKeHoach === "PHAM_VI"\}/g)).toBe(2);
    // Thứ tự: nhánh phí học bù (đường cũ) → nhánh phạm vi → khối kế hoạch. Khối kế hoạch chỉ còn ở nhánh CUỐI.
    const phiBu = src.indexOf("laDonPhiHocBu(order.items) ?");
    const pv = src.indexOf('khoiKeHoach === "PHAM_VI" ?');
    const kh = src.indexOf("<OrderInstallmentPlan");
    expect(phiBu).toBeGreaterThan(0);
    expect(pv).toBeGreaterThan(phiBu);
    expect(kh).toBeGreaterThan(pv);
    expect(dem(src, /<OrderInstallmentPlan\b/g)).toBe(1);
    // Không tự suy luật phạm vi tại chỗ.
    expect(src).not.toContain("docPhamViDong");
    expect(src).not.toContain("KHOA_PHAM_VI");
  });

  it("[P-D-W5] PaymentRequestsSection: `donPhamVi` BẮT BUỘC (không `?`, không mặc định) và tắt câu 'Muốn tách'; CongNoTheoCon: BẮT BUỘC + ép trần tạo đợt", () => {
    const pr = boChuThich(doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx"));
    expect(dem(pr, /^\s*donPhamVi: boolean;/gm)).toBe(1);
    expect(dem(pr, /donPhamVi\?:/g)).toBe(0);
    expect(dem(pr, /donPhamVi\s*=\s*false/g)).toBe(0);
    expect(dem(pr, /!donPhamVi && requests\.filter\(\(r\) => r\.installmentNo > 0\)\.length === 0/g)).toBe(1);

    const cn = boChuThich(doc("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx"));
    expect(dem(cn, /^\s*donPhamVi: boolean;/gm)).toBe(1);
    expect(dem(cn, /donPhamVi\?:/g)).toBe(0);
    expect(dem(cn, /donPhamVi\s*=\s*false/g)).toBe(0);
    expect(dem(cn, /const tran[^=]*=\s*donPhamVi\s*\?\s*\{\s*duoc:\s*false,\s*loi:\s*LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT\s*\}\s*:\s*tranTaoDot\(/g)).toBe(1);
  });

  it("[P-D-W7] màn gắn giao dịch (bien-dong-so-du): loader trả `donPhamVi` từ DẤU trên dòng đơn; màn thay nút 'Tạo đợt cho…' bằng lý do; kiểu BẮT BUỘC", () => {
    const gan = boChuThich(doc("app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts"));
    expect(dem(gan, /donPhamVi:\s*laDonPhamVi\(cong\.order\.items\)/g)).toBe(1);
    expect(dem(gan, /items:\s*\{\s*select:\s*\{\s*metadata:\s*true\s*\}\s*\}/g)).toBe(1);
    expect(dem(gan, /^\s*donPhamVi: boolean;/gm)).toBe(1);
    expect(dem(gan, /donPhamVi\?:/g)).toBe(0);
    const man = boChuThich(doc("app/(admin)/admin/bien-dong-so-du/_components/xu-ly-giao-dich.tsx"));
    expect(dem(man, /chiTiet\.donPhamVi\s*\?/g)).toBe(1);
    // Nhánh phạm vi đứng TRƯỚC nút mở form: nút chỉ còn ở nhánh cuối.
    expect(man.indexOf("chiTiet.donPhamVi ?")).toBeGreaterThan(0);
    expect(man.indexOf("setMoTaoDot(c.orderItemId)}")).toBeGreaterThan(man.indexOf("chiTiet.donPhamVi ?"));
  });

  it("[P-D-W6] QUÉT CẢ CÂY app/ + lib/: mọi nơi GHI kế hoạch/đợt đều nằm trong danh sách đã biết — thêm một đường mới là đỏ ở đây và buộc quyết định có gác không", () => {
    // Danh sách này là BẢN KIỂM KÊ của cổng D. "Đã gác" = đi qua `recordInstallmentPlan` / `taoDotChoCon` (cổng phạm vi ở trong).
    // "Chưa gác (có chủ đích)" = phần còn lại của PR "D": `mienGiamNo`, `themConVaoDon`, `doiKhoa` — xem NOI-TAO-DON.md.
    const nguon = lietKeNguon(["app", "lib"]).map((f) => [f, doc(f)] as const); // đọc MỘT lần mỗi tệp
    // Lọc thô bằng `includes` TRƯỚC khi bóc chú thích (regex bóc chú thích trên ~2000 tệp mất vài giây).
    const goi = (tu: string, re: RegExp) =>
      nguon
        .filter(([, raw]) => raw.includes(tu))
        .map(([f, raw]) => [f, dem(boChuThich(raw), re)] as const)
        .filter(([, n]) => n > 0)
        .map(([f, n]) => `${f} x${n}`)
        .sort();
    // recordInstallmentPlan: định nghĩa + 2 chỗ gọi ở action tạo đơn / action lưu kế hoạch.
    expect(goi("recordInstallmentPlan", /\brecordInstallmentPlan\(/g)).toEqual(["app/(admin)/admin/orders/_actions.ts x2", "lib/orders/installments.ts x1"]);
    // taoDotChoCon: định nghĩa + 2 cửa (trang đơn, màn gắn giao dịch). `taoDotChoConTrongTx` (đổi khoá) KHÔNG khớp vì `\(` đứng ngay sau tên.
    expect(goi("taoDotChoCon", /\btaoDotChoCon\(/g)).toEqual(["app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts x1", "app/(admin)/admin/orders/_actions.ts x1", "lib/finance/ghi-tien-don.ts x1"]);
    expect(goi("taoDotChoConTrongTx", /\btaoDotChoConTrongTx\(/g)).toEqual(["lib/finance/doi-khoa-db.ts x1", "lib/finance/ghi-tien-don.ts x2"]); // x2 = gọi từ taoDotChoCon + định nghĩa
    // Ghi `OrderInstallment` trực tiếp: kế hoạch (đã gác) + backfill từ lead (tạo đơn riêng, không bao giờ là đơn phạm vi).
    expect(goi("orderInstallment.", /orderInstallment\.(create|createMany|upsert)\b/g)).toEqual(["lib/crm/backfill-order.ts x1", "lib/orders/installments.ts x1"]);
    // Sinh phiếu theo đợt từ kế hoạch: gọi từ kế hoạch (đã gác), duyệt/từ chối kế hoạch (đơn phạm vi không có kế hoạch để duyệt), backfill, và miễn giảm (CHƯA gác).
    expect(goi("materializeInstallmentRequests", /\bmaterializeInstallmentRequests\(/g)).toEqual([
      "lib/crm/backfill-order.ts x1",
      "lib/finance/mien-giam-db.ts x1",
      "lib/orders/installments.ts x2",
      "lib/payments/payment-request.ts x1",
    ]);
    // Không action nào tạo đợt/kế hoạch trực tiếp từ tầng action.
    const actions = boChuThich(doc("app/(admin)/admin/orders/_actions.ts"));
    expect(dem(actions, /orderInstallment\.(create|createMany|update|upsert)/g)).toBe(0);
    expect(dem(actions, /paymentRequest\.create\(/g)).toBe(0);
  }, 30_000);

});

describe("[P7-2W] lưới ghim dây nối — hai con số 'Đã thu' của đơn phạm vi (luật 11: prop BẮT BUỘC, truyền đủ hai bậc)", () => {
  it("[P7-2W1] OrderDebtSummary: `donPhamVi` BẮT BUỘC (không `?`, không mặc định); trang đơn truyền đúng vị từ cùng khối kế hoạch", () => {
    const ds = boChuThich(doc("app/(admin)/admin/orders/_components/order-debt-summary.tsx"));
    expect(dem(ds, /^\s*donPhamVi: boolean;/gm)).toBe(1);
    expect(dem(ds, /donPhamVi\?:/g)).toBe(0);
    expect(dem(ds, /donPhamVi\s*=\s*false/g)).toBe(0);
    const od = boChuThich(doc("app/(admin)/admin/orders/_components/order-detail-client.tsx"));
    expect(dem(od, /<OrderDebtSummary\b/g)).toBe(1);
    expect(dem(od, /<OrderDebtSummary congNo=\{congNo\} donPhamVi=\{khoiKeHoach === "PHAM_VI"\} \/>/g)).toBe(1);
  });

  it("[P7-2W2] PaymentRequestsSection: `daGhiNhanDon` BẮT BUỘC; trang đơn truyền CHÍNH `congNo.daThu` (số in ở ô Công nợ), không số khác", () => {
    const pr = boChuThich(doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx"));
    expect(dem(pr, /^\s*daGhiNhanDon: number;/gm)).toBe(1);
    expect(dem(pr, /daGhiNhanDon\?:/g)).toBe(0);
    expect(dem(pr, /daGhiNhanDon\s*=\s*\d/g)).toBe(0);
    expect(dem(pr, /chuThichDaThuLech\(\{ donPhamVi, daGhiNhanDon, phieu: requests \}\)/g)).toBe(1);
    const od = boChuThich(doc("app/(admin)/admin/orders/_components/order-detail-client.tsx"));
    expect(dem(od, /daGhiNhanDon=\{congNo\.daThu\}/g)).toBe(1);
  });

  it("[P7-2W3] chữ 'Đã đối khớp' / chú thích chỉ do `nhan-da-thu.ts` quyết — hai component không tự gõ lại", () => {
    for (const p of [
      "app/(admin)/admin/orders/_components/payment-requests-section.tsx",
      "app/(admin)/admin/orders/_components/order-debt-summary.tsx",
    ]) {
      const src = boChuThich(doc(p));
      expect(src, p).not.toContain("Đã đối khớp");
      expect(src, p).not.toContain("Đã ghi nhận, kể cả");
    }
  });
});
