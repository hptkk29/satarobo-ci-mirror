// lib/entitlements/dich-vu.pin.test.ts — LƯỚI GHIM MÃ NGUỒN của tầng ghi quyền học. THUẦN.
//
// Hành vi thật đo ở `tests/finance/quyen-hoc-dich-vu.test.ts` + `tests/finance/quyen-hoc-trong-tx.test.ts`
// (Postgres). Lưới này canh những thứ mà test hành vi KHÔNG chắc bắt được vì phụ thuộc môi trường (cỡ bể kết
// nối) hoặc vì nằm ở thứ tự câu lệnh.
//
// Neo vào chuỗi HẸP và đếm SỐ LẦN khớp trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng
// chuỗi đang tìm — bài học luật 11). KHÔNG neo vào chỗ đặt `await`.
//
// Cấu trúc tầng ghi có HAI LỚP: hàm `xTrongTx(tx, …)` chạy trong transaction của người gọi (chứa ruột) và vỏ
// mỏng `x(vao, dep)` giữ hành vi cũ. Các lưới dưới đây canh từng lớp một.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const nguon = readFileSync(resolve(process.cwd(), "lib/entitlements/dich-vu.ts"), "utf8");
const ma = nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Thân một hàm export, từ `export async function ten(` tới `export` kế tiếp. */
function than(ten: string): string {
  const i = ma.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`Không thấy hàm ${ten}`);
  const j = ma.indexOf("\nexport ", i + 10);
  return ma.slice(i, j < 0 ? undefined : j);
}

/** Vỏ mỏng (hành vi cũ) → bản chạy trong transaction của người gọi. */
const VO_VA_RUOT = {
  capQuyenHoc: "capQuyenHocTrongTx",
  xepLop: "xepLopTrongTx",
  ghiNhanBai: "ghiNhanBaiTrongTx",
  huyGhiNhanBai: "huyGhiNhanBaiTrongTx",
  dongBangQuyenHoc: "dongBangQuyenHocTrongTx",
  moBangQuyenHoc: "moBangQuyenHocTrongTx",
} as const;
const VO = Object.keys(VO_VA_RUOT) as (keyof typeof VO_VA_RUOT)[];

/** Bản TrongTx CÓ cổng công tắc (nhận `co`). */
const TRONG_TX_CO_CONG = [...Object.values(VO_VA_RUOT), "capNhatHanBangTrongTx"] as string[];
/** Bản TrongTx KHÔNG hỏi công tắc CÓ CHỦ ĐÍCH (bước ĐÓNG một chiều — xem chú thích ở `dungQuyenHocTrongTx`). */
const TRONG_TX_KHONG_CONG = ["dungQuyenHocTrongTx"] as string[];
const TRONG_TX = [...TRONG_TX_CO_CONG, ...TRONG_TX_KHONG_CONG];

/** Mọi lời gọi cần KẾT NỐI GỐC — cấm trong thân hàm TrongTx. */
const KET_NOI_GOC = /\bdb\.|\$transaction\(|\bcanBat\(|batChoCoSo|getSetting|laThuHocPhiTheoPhamViBat|orgUnitIdForCenter\(|docCoPhamVi\(|chuanBiCapQuyenHoc\(/;
/** Phép GHI (hoặc khoá) đầu tiên — mọi cổng phải đứng trước. */
const PHEP_GHI = /\btx\.studyEntitlement(Usage)?\.(create|update|upsert|delete|updateMany)|ganLaiTieuThu\(tx|writeAudit\(/;
/** Lời gọi `tx.` / `khoaVaDoc(tx` đầu tiên (kể cả đọc) — cổng công tắc phải đứng trước. */
const CHAM_TX = /\btx\.|khoaVaDoc\(tx/;
/** Cổng công tắc: ném `TAT`, hoặc (ghi/huỷ nhận bài) trả kết quả bỏ qua. */
const CONG_CONG_TAC = /canCoDaBat\(co\)|if \(!co\.bat\) return/;

describe("[DVU-PIN] tầng ghi quyền học", () => {
  it("[DVU-PIN-01] CHỈ MỘT chỗ gán cột consumedSessions (ganLaiTieuThu) — cache không cộng dồn", () => {
    // Mọi HÌNH THỨC gán: `consumedSessions: …` (kể cả `{ increment }`), `x.consumedSessions = …`, `+=`, `++`.
    const GAN = /consumedSessions\s*(?::|=(?!=)|\+=|-=|\+\+|--)/g;
    expect(ma.match(GAN)?.length).toBe(1);
    expect(than("ganLaiTieuThu").match(GAN)?.length).toBe(1);
    expect(ma).not.toMatch(/\b(increment|decrement)\b/);
  });

  it("[DVU-PIN-02] vỏ mỏng: hỏi công tắc ĐÚNG MỘT LẦN, TRƯỚC khi mở transaction, rồi gọi bản TrongTx ĐÚNG MỘT LẦN", () => {
    for (const ten of VO) {
      const b = than(ten);
      const iCong = b.indexOf("await canBat(");
      const iTx = b.indexOf("$transaction(");
      expect({ ten, coCong: iCong >= 0, truoc: iCong < iTx }).toEqual({ ten, coCong: true, truoc: true });
      expect({ ten, soLan: b.match(/await canBat\(/g)?.length }).toEqual({ ten, soLan: 1 });
      expect({ ten, soTx: b.match(/\$transaction\(/g)?.length }).toEqual({ ten, soTx: 1 });
      expect({ ten, goiRuot: b.match(new RegExp(`${VO_VA_RUOT[ten]}\\(tx,`, "g"))?.length }).toEqual({ ten, goiRuot: 1 });
      // Vỏ MỎNG: không tự đọc/ghi bảng quyền học trong transaction (ruột nằm ở bản TrongTx).
      expect({ ten, tuGhi: /\btx\.studyEntitlement/.test(b) || /khoaVaDoc\(/.test(b) }).toEqual({ ten, tuGhi: false });
    }
  });

  it("[DVU-PIN-02b] bản TrongTx: KHÔNG tự mở transaction, KHÔNG dùng kết nối gốc, KHÔNG tự đọc cờ / OrgUnit", () => {
    for (const ten of TRONG_TX) expect({ ten, dungKetNoiGoc: KET_NOI_GOC.test(than(ten)) }).toEqual({ ten, dungKetNoiGoc: false });
  });

  it("[DVU-PIN-02c] bản TrongTx có cổng: cổng công tắc đứng TRƯỚC lời gọi tx đầu tiên; cổng cơ sở TRƯỚC phép ghi đầu tiên", () => {
    for (const ten of TRONG_TX_CO_CONG) {
      const b = than(ten);
      const iCong = b.search(CONG_CONG_TAC);
      const iCham = b.search(CHAM_TX);
      expect({ ten, coCong: iCong >= 0, coCham: iCham >= 0 }).toEqual({ ten, coCong: true, coCham: true });
      expect({ ten, congTruocTx: iCong < iCham }).toEqual({ ten, congTruocTx: true });
      expect({ ten, soCongCongTac: b.match(new RegExp(CONG_CONG_TAC.source, "g"))?.length }).toEqual({ ten, soCongCongTac: 1 });

      const iCoSo = b.indexOf("canCoDungCoSo(co,");
      const iGhi = b.search(PHEP_GHI);
      expect({ ten, coCoSo: iCoSo >= 0, coGhi: iGhi >= 0 }).toEqual({ ten, coCoSo: true, coGhi: true });
      expect({ ten, coSoTruocGhi: iCoSo < iGhi }).toEqual({ ten, coSoTruocGhi: true });
    }
  });

  it("[DVU-PIN-02d] dungQuyenHocTrongTx KHÔNG nhận công tắc (cố ý): đóng quyền học phải chạy được cả khi cờ đã tắt", () => {
    const b = than("dungQuyenHocTrongTx");
    expect(b).not.toMatch(/CoPhamVi|canCoDaBat|canCoDungCoSo|\bco\b/);
    // …nhưng vẫn từ chối bằng `throw` TRƯỚC phép ghi đầu tiên (đi qua máy trạng thái).
    expect(b.indexOf("chuyenTrangThaiHopLe(")).toBeGreaterThan(0);
    expect(b.indexOf("chuyenTrangThaiHopLe(")).toBeLessThan(b.search(PHEP_GHI));
  });

  it("[DVU-PIN-02e] danh sách hàm *TrongTx được xuất = danh sách đã canh ở đây (thêm hàm mới mà quên lưới ⇒ đỏ)", () => {
    const thay = [...ma.matchAll(/export async function (\w+TrongTx)\(/g)].map((m) => m[1]).sort();
    expect(thay).toEqual([...TRONG_TX].sort());
  });

  it("[DVU-PIN-02f] cờ chỉ được ĐỌC ở MỘT chỗ (PHU_THUOC_MAC_DINH) và `batChoCoSo` chỉ được gọi ở canBat + docCoPhamVi", () => {
    expect(ma.match(/laThuHocPhiTheoPhamViBat\(/g)?.length).toBe(1);
    expect(ma.match(/dep\.batChoCoSo\(/g)?.length).toBe(2);
    expect(ma.match(/getSetting/g)?.length ?? 0).toBe(0);
  });

  it("[DVU-PIN-03] orgUnitId được suy TRƯỚC transaction và ĐIỀN TƯỜNG MINH vào create (kể cả null) — tránh kết nối thứ hai", () => {
    // Bản TrongTx: nhận orgUnitId từ ngoài, không tự tra, và khoá `orgUnitId` PHẢI có mặt trong `data` của create.
    const r = than("capQuyenHocTrongTx");
    expect(r.match(/orgUnitIdForCenter\(/g)?.length ?? 0).toBe(0);
    expect(r).toMatch(/centerId: vao\.centerId,\s*orgUnitId,/);
    expect(r.match(/studyEntitlement\.create\(/g)?.length).toBe(1);
    // Vỏ: tra ĐÚNG MỘT LẦN, trước transaction.
    const v = than("capQuyenHoc");
    expect(v.match(/orgUnitIdForCenter\(/g)?.length).toBe(1);
    expect(v.indexOf("orgUnitIdForCenter(")).toBeLessThan(v.indexOf("$transaction("));
    // Người gọi bên ngoài lấy cả hai từ MỘT hàm, cả hai đều đọc trước.
    expect(than("chuanBiCapQuyenHoc").match(/orgUnitIdForCenter\(/g)?.length).toBe(1);
  });

  it("[DVU-PIN-04] mọi hàm GHI khoá dòng hoặc khoá advisory trước khi quyết", () => {
    expect(than("capQuyenHocTrongTx")).toMatch(/pg_advisory_xact_lock/);
    for (const ten of TRONG_TX.filter((t) => t !== "capQuyenHocTrongTx")) expect(than(ten), ten).toMatch(/khoaVaDoc\(tx/);
    expect(ma).toMatch(/FOR UPDATE/);
  });

  it("[DVU-PIN-05] không dùng `return` từ chối SAU phép ghi đầu tiên trong ghiNhanBaiTrongTx ngoài ba lối ra đã biết", () => {
    // Mọi `return { ghi: false` phải đứng TRƯỚC `studyEntitlementUsage.upsert(` — sau upsert chỉ được `ghi: true`.
    const b = than("ghiNhanBaiTrongTx");
    const iGhi = b.indexOf("studyEntitlementUsage.upsert(");
    expect(iGhi).toBeGreaterThan(0);
    expect(b.slice(iGhi)).not.toMatch(/ghi:\s*false/);
    // Tương tự: huỷ nhận bài chỉ trả `daHuy: false` trước khi vô hiệu dòng sổ cái.
    const h = than("huyGhiNhanBaiTrongTx");
    expect(h.slice(h.indexOf("studyEntitlementUsage.update("))).not.toMatch(/daHuy:\s*false/);
  });

  it("[DVU-PIN-07] KHÔNG dùng `db.` (kết nối gốc) bên trong thân $transaction — mọi phép trong transaction đi qua `tx`", () => {
    // Một kết nối thứ hai trong lúc transaction đang giữ kết nối đầu là cách N lượt đồng thời ≥ cỡ bể treo nhau.
    // Pre-read TRƯỚC `$transaction(` (để hỏi công tắc theo cơ sở) là hợp lệ và nằm ngoài chunk được quét.
    const chunks = ma.split("$transaction(").slice(1);
    expect(chunks.length).toBe(VO.length);
    for (const [i, c] of chunks.entries()) {
      const toiHam = c.split("\nexport ")[0];
      expect({ i, dungDbGoc: /\bdb\./.test(toiHam) }).toEqual({ i, dungDbGoc: false });
    }
  });

  it("[DVU-PIN-06] hàm đọc không tự bypass cách ly: chỉ nhận `client`, không import db trần cho đường đọc", () => {
    for (const ten of ["docQuyenHocDangMo", "docQuyenHocTheoHocVien", "timQuyenHocChoBai"]) {
      const i = ma.indexOf(`function ${ten}(`);
      expect(i, ten).toBeGreaterThan(0);
      const j = ma.indexOf("\nexport ", i + 10);
      const b = ma.slice(i, j < 0 ? undefined : j);
      expect({ ten, dungDbTran: /\bdb\./.test(b) }).toEqual({ ten, dungDbTran: false });
    }
  });

  it("[DVU-PIN-08] đọc theo lô: MỘT câu `in`, mọi trạng thái trừ VOIDED, khử trùng id, rỗng thì không truy vấn", () => {
    const b = than("docQuyenHocTheoHocVien");
    expect(b.match(/findMany\(/g)?.length).toBe(1);
    expect(b).toMatch(/studentId: \{ in: ids \}/);
    expect(b).toMatch(/status: \{ not: "VOIDED" \}/);
    expect(b).toMatch(/new Set\(studentIds\)/);
    expect(b.indexOf("ids.length === 0")).toBeGreaterThan(0);
    expect(b.indexOf("ids.length === 0")).toBeLessThan(b.indexOf("findMany("));
  });
});

// ── BỔ SUNG SAU LƯỢT CẤY ĐỘC LẬP ───────────────────────────────────────────────────────────────────────────
// Cấy `co: CoPhamVi = { centerId: vao.centerId, bat: true }` vào chữ ký `capQuyenHocTrongTx` ⇒ 100% ca cũ XANH
// (mọi ca đều truyền `co`; `tsc` cũng im vì tham số tuỳ chọn): người gọi quên cờ là TỰ BẬT cờ. Tham số NGUY
// HIỂM (cờ phạm vi) không được có mặc định — để `tsc` liệt kê chỗ gọi.
describe("[DVU-PIN] tham số nguy hiểm không có mặc định", () => {
  /** Chữ ký: từ `export async function` tới `{` mở thân (dòng kết thúc bằng `{`). */
  const chuKy = (ten: string) => than(ten).split(/\{\n/)[0];

  it("[DVU-PIN-09] bản TrongTx: `co` là tham số BẮT BUỘC (không `=`, không `?`); `tx` cũng vậy", () => {
    expect(ma).not.toMatch(/\bco\??\s*:\s*CoPhamVi\s*=/);
    for (const ten of TRONG_TX) {
      const k = chuKy(ten);
      expect({ ten, tx: /\(\s*tx: Tx[,\s)]/.test(k) }).toEqual({ ten, tx: true });
      expect({ ten, tuyChon: /\b(tx|co)\?\s*:/.test(k), macDinh: /\b(tx|co)\s*(:\s*[\w<>[\]| ]+)?\s*=/.test(k.replace(/=>/g, "")) }).toEqual({ ten, tuyChon: false, macDinh: false });
    }
    for (const ten of TRONG_TX_CO_CONG) expect({ ten, coCo: /\bco: CoPhamVi\b/.test(chuKy(ten)) }).toEqual({ ten, coCo: true });
  });

  it("[DVU-PIN-09b] đọc theo lô: `courseId` là tham số BẮT BUỘC (quên lọc khoá = lẫn quyền học của khoá khác)", () => {
    const k = chuKy("docQuyenHocTheoHocVien");
    expect(k).toMatch(/courseId: string \| null\b/);
    expect(k).not.toMatch(/courseId\?|courseId: string \| null\s*=/);
  });

  it("[DVU-PIN-10] MỌI lời gọi writeAudit( trong dich-vu.ts truyền `tx` — audit ghi bằng kết nối gốc sống sót khi người gọi cuộn ngược", () => {
    const cac = ma.split("writeAudit(").slice(1).map((c) => c.slice(0, c.indexOf("});")));
    expect(cac.length).toBe(9); // cap · xep · ghi · BONUS_LEARN (học bù miễn phí) · huy · dung · dongBang · moBang · capNhatHanBang
    for (const [i, c] of cac.entries()) expect({ i, coTx: /\n\s*tx,\s*(\n|$)/.test(c) }).toEqual({ i, coTx: true });
  });
});
