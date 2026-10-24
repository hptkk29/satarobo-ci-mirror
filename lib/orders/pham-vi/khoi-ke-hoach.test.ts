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
import { LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA, LY_DO_DON_PHAM_VI_KHONG_THEM_CON } from "./cong-sua-don";

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

  it("[P-D-02] đơn thường / legacy / không dấu ⇒ THUONG, nguyên chữ (metadata null, rỗng, chỉ courseId+soBuoi, mảng, chuỗi)", () => {
    expect(khoiKeHoachTrangDon([dongThuong()])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([dongThuong(null)])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([dongThuong({})])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([dongThuong([])])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([dongThuong("phamVi")])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([{ type: "PRODUCT", metadata: null }])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([])).toBe("THUONG");
  });

  it("[P-D-03] đơn phí học bù ⇒ PHI_HOC_BU (đường cũ, xét TRƯỚC); đơn trộn học bù + khoá thường ⇒ THUONG như cũ", () => {
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: null }])).toBe("PHI_HOC_BU");
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: null }, dongThuong()])).toBe("THUONG");
    // Phí học bù thắng cả khi metadata mang dấu SCOPE (không tồn tại thật; ghim thứ tự để câu học bù không bị đổi).
    expect(khoiKeHoachTrangDon([{ type: "MAKEUP_FEE", metadata: metadataScope() }])).toBe("PHI_HOC_BU");
  });

  it("[P-D-04] dấu HỎNG / giả hình dạng ⇒ THUONG (fail-closed về 'không phải SCOPE', giống `docPhamViDong`) — mỗi phép cấy một vế", () => {
    const md = metadataScope();
    const khoi = md[KHOA_PHAM_VI] as Record<string, unknown>;
    const voi = (v: Record<string, unknown>, ngoai: Record<string, unknown> = {}) =>
      khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { ...md, ...ngoai, [KHOA_PHAM_VI]: { ...khoi, ...v } } }]);
    expect(voi({})).toBe("PHAM_VI"); // đối chứng dương
    expect(voi({ phienBan: 2 })).toBe("THUONG");
    expect(voi({ thanhTien: 1 })).toBe("THUONG");
    expect(voi({ soBuoiMua: 13 }, { soBuoi: 13 })).toBe("THUONG");
    expect(khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { ...md, soBuoi: 24 } }])).toBe("THUONG");
    expect(khoiKeHoachTrangDon([{ type: "COURSE_ENROLLMENT", metadata: { courseId: KHOA, soBuoi: 12, [KHOA_PHAM_VI]: true } }])).toBe("THUONG");
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
    // Thứ tự: nhánh phí học bù (đường cũ) → nhánh phạm vi → bảng đợt CŨ chỉ-xem. [20/10/2026] Khối NHẬP kế hoạch đã gỡ cho mọi đơn;
    // bảng chỉ-xem (`OrderInstallmentsView`) chỉ còn ở nhánh CUỐI.
    const phiBu = src.indexOf("laDonPhiHocBu(order.items) ?");
    const pv = src.indexOf('khoiKeHoach === "PHAM_VI" ?');
    const kh = src.indexOf("<OrderInstallmentsView");
    expect(phiBu).toBeGreaterThan(0);
    expect(pv).toBeGreaterThan(phiBu);
    expect(kh).toBeGreaterThan(pv);
    expect(dem(src, /<OrderInstallmentsView\b/g)).toBe(1);
    expect(src).not.toMatch(/OrderInstallmentPlan/);
    // Không tự suy luật phạm vi tại chỗ.
    expect(src).not.toContain("docPhamViDong");
    expect(src).not.toContain("KHOA_PHAM_VI");
  });

  it("[P-D-W5] PaymentRequestsSection: `donPhamVi` BẮT BUỘC (không `?`, không mặc định) và KHÔNG còn câu 'Muốn tách' (đã gỡ 20/10/2026); CongNoTheoCon: BẮT BUỘC + ép trần tạo đợt", () => {
    const pr = boChuThich(doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx"));
    expect(dem(pr, /^\s*donPhamVi: boolean;/gm)).toBe(1);
    expect(dem(pr, /donPhamVi\?:/g)).toBe(0);
    expect(dem(pr, /donPhamVi\s*=\s*false/g)).toBe(0);
    // Câu gợi ý "Muốn tách: lập kế hoạch ở mục Kế hoạch thanh toán" trỏ tới một mục không còn trên màn NÀO (luật 12) — gỡ hẳn, không chỉ tắt theo cờ.
    expect(dem(pr, /Muốn tách|chưa tách đợt/g)).toBe(0);

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
    // "Chưa gác (có chủ đích)" = CHỈ `mienGiamNo` (giảm tay trên dòng SCOPE — Q12/D3 còn MỞ, hiện trạng ghim ở [CD2-MG-01]).
    // `themConVaoDon` và `doiKhoa` ĐÃ GÁC từ 19/10/2026 — xem [P-D-W8..W11] bên dưới.
    const nguon = lietKeNguon(["app", "lib"]).map((f) => [f, doc(f)] as const); // đọc MỘT lần mỗi tệp
    // Lọc thô bằng `includes` TRƯỚC khi bóc chú thích (regex bóc chú thích trên ~2000 tệp mất vài giây).
    const goi = (tu: string, re: RegExp) =>
      nguon
        .filter(([, raw]) => raw.includes(tu))
        .map(([f, raw]) => [f, dem(boChuThich(raw), re)] as const)
        .filter(([, n]) => n > 0)
        .map(([f, n]) => `${f} x${n}`)
        .sort();
    // recordInstallmentPlan: CHỈ còn định nghĩa. [20/10/2026] Hai chỗ gọi ở action tạo đơn / action lưu kế hoạch đã gỡ cùng kế hoạch thanh toán;
    // thêm một chỗ gọi mới là đỏ ở đây — và buộc quyết định có phải đang dựng lại kế hoạch đợt mà chủ dự án đã bỏ không.
    expect(goi("recordInstallmentPlan", /\brecordInstallmentPlan\(/g)).toEqual(["lib/orders/installments.ts x1"]);
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

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// CỔNG D PHẦN CÒN LẠI [19/10/2026] — thêm con / đổi khoá. Hành vi trên Postgres thật: tests/finance/don-pham-vi-duong-con-lai-db.test.ts [CD2-*].
// Lưới này ghim DÂY NỐI mà ca hành vi không chứng minh được: cổng đọc ĐÚNG cột (`metadata`), đứng TRƯỚC phép ghi đầu tiên, đúng số lần.
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Thân của một hàm KHÔNG export (`async function ten(…)` hay `function ten(…)`) — từ chữ `function` tới dòng `}` ở cột 0. */
function thanHamNoiBo(src: string, ten: string): string {
  const bat = src.search(new RegExp(`(?:async )?function ${ten}\\(`));
  if (bat < 0) throw new Error(`không thấy hàm ${ten}`);
  // Tệp nguồn trên Windows là CRLF (autocrlf) — chấp nhận cả hai kiểu xuống dòng.
  const het = src.slice(bat).search(/\r?\n\}\r?\n/);
  if (het < 0) throw new Error(`không đóng được hàm ${ten}`);
  return src.slice(bat, bat + het + 2);
}
const GHI = /\b(?:tx|db)\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\bchuyenLopTrongTx\(|\bdungHocTrongTx\(|\bwriteAudit\(/;

describe("[P-D-W8..W14] lưới ghim dây nối — cổng D phần còn lại: thêm con / đổi khoá trên đơn SCOPE", () => {
  it("[P-D-W8] themConVaoDon: cổng `laDonPhamVi(don.items)` ĐÚNG MỘT LẦN, TRONG `ghiTienChoDon`, TRƯỚC phép ghi đầu tiên; `docDon` chọn `metadata`", () => {
    const src = boChuThich(doc("lib/finance/them-con-vao-don.ts"));
    // Thiếu `metadata` trong select của `docDon` thì `laDonPhamVi` đọc `undefined` ⇒ LUÔN false ⇒ cổng chết mà không lỗi nào báo.
    const docDon = thanHamNoiBo(src, "docDon");
    expect(dem(docDon, /\bmetadata:\s*true\b/g)).toBe(1);

    const than = thanHam(src, "themConVaoDon");
    expect(dem(than, /laDonPhamVi\(don\.items\)/g)).toBe(1);
    expect(dem(than, /LY_DO_DON_PHAM_VI_KHONG_THEM_CON/g)).toBe(1);
    const cong = than.indexOf("laDonPhamVi(don.items)");
    const khoa = than.indexOf("ghiTienChoDon(");
    expect(khoa).toBeGreaterThan(0);
    expect(cong).toBeGreaterThan(khoa); // đọc DƯỚI khoá đơn
    // Không phép ghi nào nằm trước cổng (kể cả ở phần ngoài `ghiTienChoDon`).
    expect(than.slice(0, cong)).not.toMatch(GHI);
    // …và `orderItem.create` (phép ghi đầu tiên của đường này) đứng SAU cổng.
    expect(than.indexOf("tx.orderItem.create(")).toBeGreaterThan(cong);
  });

  it("[P-D-W9] xemTruocThemCon nói ĐÚNG câu của lượt ghi (luật 12): cùng vị từ, cùng hằng, một lần, trước mọi tính toán", () => {
    const than = thanHam(boChuThich(doc("lib/finance/them-con-vao-don.ts")), "xemTruocThemCon");
    expect(dem(than, /laDonPhamVi\(don\.items\)/g)).toBe(1);
    expect(dem(than, /LY_DO_DON_PHAM_VI_KHONG_THEM_CON/g)).toBe(1);
    expect(than.indexOf("laDonPhamVi(don.items)")).toBeLessThan(than.indexOf("kiemConMoi("));
    expect(than.indexOf("laDonPhamVi(don.items)")).toBeLessThan(than.indexOf("dungXemTruoc("));
  });

  it("[P-D-W10] doiKhoaChoCon: cổng ở HAI chỗ (ngoài khoá — nói đúng nguyên nhân trước mọi câu chặn khác; TRONG khoá — trước `chuyenLopTrongTx`), mỗi chỗ MỘT lần; `docBoiCanh` chọn `items.metadata`", () => {
    const src = boChuThich(doc("lib/finance/doi-khoa-db.ts"));
    expect(dem(thanHamNoiBo(src, "docBoiCanh"), /items:\s*\{\s*select:\s*\{\s*metadata:\s*true\s*\}\s*\}/g)).toBe(1);

    const than = thanHam(src, "doiKhoaChoCon");
    expect(dem(than, /laDonPhamVi\(bcNgoai\.dong\.order\?\.items \?\? \[\]\)/g)).toBe(1);
    expect(dem(than, /laDonPhamVi\(bc\.dong\.order\?\.items \?\? \[\]\)/g)).toBe(1);
    expect(dem(than, /LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA/g)).toBe(2);
    const ngoai = than.indexOf("laDonPhamVi(bcNgoai.dong.order?.items ?? [])");
    const trong = than.indexOf("laDonPhamVi(bc.dong.order?.items ?? [])");
    const khoa = than.indexOf("ghiTienChoDon(");
    expect(ngoai).toBeGreaterThan(0);
    expect(khoa).toBeGreaterThan(ngoai); // cổng ngoài đứng TRƯỚC khi vào khoá
    expect(trong).toBeGreaterThan(khoa); // cổng trong ở BÊN TRONG khoá
    // Cả hai đứng trước các câu chặn khác (lớp đích / giá niêm yết) lẫn phép ghi đầu tiên.
    expect(ngoai).toBeLessThan(than.indexOf("Không tìm thấy lớp đích"));
    expect(ngoai).toBeLessThan(than.indexOf("soatGiaDon("));
    expect(than.indexOf("chuyenLopTrongTx(")).toBeGreaterThan(trong);
    expect(than.slice(0, ngoai)).not.toMatch(GHI);
    expect(than.slice(khoa, trong)).not.toMatch(GHI);
  });

  it("[P-D-W11] xemTruocDoiKhoa nói ĐÚNG câu của lượt ghi: một lần, trước `docSoTheoCon` (mọi tính toán)", () => {
    const than = thanHam(boChuThich(doc("lib/finance/doi-khoa-db.ts")), "xemTruocDoiKhoa");
    expect(dem(than, /laDonPhamVi\(bc\.dong\.order\?\.items \?\? \[\]\)/g)).toBe(1);
    expect(dem(than, /LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA/g)).toBe(1);
    expect(than.indexOf("laDonPhamVi(bc.dong.order?.items ?? [])")).toBeLessThan(than.indexOf("docSoTheoCon("));
  });

  it("[P-D-W12] trang đơn không vẽ nút 'Thêm con' / 'Đổi khoá…' cho đơn SCOPE (luật 12 — máy chủ từ chối cả hai); đúng một chỗ mỗi nút", () => {
    const src = boChuThich(doc("app/(admin)/admin/orders/[id]/page.tsx"));
    expect(dem(src, /khoaChonDuoc\.length > 0 && !laDonPhamVi\(order\.items\)/g)).toBe(1);
    expect(dem(src, /lopDoiKhoa=\{laDonPhamVi\(order\.items\) \? \[\] : lopChonDuoc\}/g)).toBe(1);
    expect(dem(src, /<NutThemCon\b/g)).toBe(1);
  });

  it("[P-D-W13] câu từ chối là HAI chuỗi riêng, mỗi chuỗi nói đúng nguyên nhân của đường nó (không mượn câu 'kế hoạch nhiều đợt')", () => {
    expect(LY_DO_DON_PHAM_VI_KHONG_THEM_CON).toContain("thêm con");
    expect(LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA).toContain("đổi khoá");
    for (const c of [LY_DO_DON_PHAM_VI_KHONG_THEM_CON, LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA]) {
      expect(c).not.toBe(LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT);
      expect(c).not.toContain("kế hoạch");
    }
    expect(LY_DO_DON_PHAM_VI_KHONG_THEM_CON).not.toBe(LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA);
  });

  it("[P-D-W14] QUÉT CẢ CÂY app/ + lib/: mọi nơi GHI `OrderItem` đều nằm trong danh sách đã biết — thêm một đường mới là đỏ ở đây và buộc quyết định đơn SCOPE đi qua nó ra sao", () => {
    const nguon = lietKeNguon(["app", "lib"]).map((f) => [f, doc(f)] as const);
    const GHI_DONG = /\borderItem\.(create|createMany|update|updateMany|upsert)\(/g;
    const ra = nguon
      .filter(([, raw]) => raw.includes("orderItem."))
      .map(([f, raw]) => [f, dem(boChuThich(raw), GHI_DONG)] as const)
      .filter(([, n]) => n > 0)
      .map(([f, n]) => `${f} x${n}`)
      .sort();
    // Từng tệp và vì sao đơn SCOPE an toàn (hoặc đang chờ quyết định):
    //  · app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts — chỉ gắn `enrollmentId`/`studentId` sau Chuyển đổi; không đổi giá/đợt.
    //  · lib/enrollments/gan-quyen-hoc-ghi-danh-tay.ts — ghi danh TAY nối `enrollmentId` vào dòng đơn của quyền học đang chờ xếp (phép ghi có điều kiện `enrollmentId: null`); không đổi giá/đợt/số buổi — [SCL-W5], [STX-08/09].
    //  · lib/finance/doi-khoa-db.ts — ĐÃ GÁC [P-D-W10] (cổng D phần còn lại).
    //  · lib/finance/dung-hoc-con.ts — đóng dấu quyết toán (status/usedValue/…) của dòng bị DỪNG; không tạo đợt, không đổi `unitPrice`/`discountAmount`.
    //    Cách quyết toán cho dòng SCOPE (theo số buổi đã mua hay theo `Course.totalSessions`) thuộc khu vực hoàn tiền KV5b — câu hỏi MỞ.
    //  · lib/finance/mien-giam-db.ts (x2) — CHƯA gác CÓ CHỦ ĐÍCH: miễn giảm trên dòng SCOPE là "giảm tay" (Q12/D3 còn MỞ); hiện trạng ghim ở [CD2-MG-01].
    //  · lib/finance/them-con-vao-don.ts (x2) — ĐÃ GÁC [P-D-W8].
    //  · lib/nguon/gan-danh-tinh-don-db.ts — Wave 1 PHASE A: gắn `studentId`/`enrollmentId` cho ĐÚNG 6 đơn sống (phạm vi cứng, có cổng ký owner); điều kiện «đang NULL» trong `where`; không đổi giá/đợt/số buổi.
    //  · lib/uat/nap-du-lieu-hoa-hong.ts — nạp dữ liệu UAT (môi trường thử), tạo đơn mới không dấu SCOPE.
    //  · lib/uat/nguon-final-db.ts — nạp dữ liệu UAT SOURCE FINAL (môi trường thử), tạo đơn mới không dấu SCOPE.
    expect(ra).toEqual([
      "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts x1",
      "lib/enrollments/gan-quyen-hoc-ghi-danh-tay.ts x1",
      "lib/finance/doi-khoa-db.ts x1",
      "lib/finance/dung-hoc-con.ts x1",
      "lib/finance/mien-giam-db.ts x2",
      "lib/finance/them-con-vao-don.ts x2",
      "lib/nguon/gan-danh-tinh-don-db.ts x1",
      "lib/uat/nap-du-lieu-hoa-hong.ts x1",
      "lib/uat/nguon-final-db.ts x1",
    ]);
  }, 30_000);
});
