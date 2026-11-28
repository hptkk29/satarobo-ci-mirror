// lib/entitlements/hang-doi/hang-doi-wiring.test.ts — LƯỚI GHIM DÂY NỐI của hàng đợi quyền học + cron đối soát. `[HD-W*]`.
//
// Luật cần khoá có dạng "lời gọi này phải có / không được có" — loại luật mà test thuần KHÔNG chứng minh được (thứ cần kiểm là lời gọi Prisma / hàm nội bộ).
// Mọi ca ĐẾM SỐ LẦN khớp trên mã ĐÃ BỎ CHÚ THÍCH và neo vào LỜI GỌI, không neo vào chỗ đặt `await` (luật 11 trong CLAUDE.md). Hành vi thật: `[HD-DB-*]`.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ADMIN_ROUTE_SEGMENTS } from "@/lib/auth/route-policy";
import { getModelPrefixes, SCOPED_MODELS } from "@/lib/db-scope";

const docTho = (tep: string): string => readFileSync(resolve(process.cwd(), tep), "utf8");
/** Bỏ chú thích (khối + dòng). Guard `[^:]` để không cắt nhầm `https://`. */
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (tep: string): string => boChuThich(docTho(tep));
const dem = (s: string, re: RegExp): number => (s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;

const DIR = "lib/entitlements/hang-doi";
const TEP_HANG_DOI = readdirSync(resolve(process.cwd(), DIR)).filter((t) => /\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t));
const CAP = doc("lib/entitlements/cap-tu-don.ts");
const XEP = doc("lib/entitlements/xep-lop-tu-don.ts");
const HICH = doc("lib/entitlements/hich.ts");
const DOI_SOAT = doc(`${DIR}/doi-soat.ts`);
const HANH_DONG = doc(`${DIR}/hanh-dong.ts`);
const DOC = doc(`${DIR}/doc-hang-doi.ts`);
const ACTIONS = doc("app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts");
const PAGE = doc("app/(admin)/admin/quyen-hoc-hang-doi/page.tsx");
const XU_LY = doc("app/(admin)/admin/quyen-hoc-hang-doi/_components/xu-ly-dong.tsx");

describe("[HD-W] chế độ CHI_GHI_NHAN của hàm xét: cron KHÔNG THỂ cấp", () => {
  it("[HD-W1] `cheDo` là tham số BẮT BUỘC (luật 7), và nhánh CHI_GHI_NHAN `continue` TRƯỚC lời cấp duy nhất", () => {
    expect(CAP).toMatch(/export async function xetCapQuyenHocChoDon\([^)]*,\s*cheDo: CheDoXetCap\)/);
    expect(CAP).not.toMatch(/cheDo\??:\s*CheDoXetCap\s*=/);
    expect(dem(CAP, /\bcapQuyenHocTrongTx\(/)).toBe(1);
    expect(dem(CAP, /cheDo === "CHI_GHI_NHAN"/)).toBe(1);
    const iNhanh = CAP.indexOf('cheDo === "CHI_GHI_NHAN"');
    const iCap = CAP.indexOf("capQuyenHocTrongTx(");
    expect(iNhanh).toBeGreaterThan(-1);
    expect(iNhanh).toBeLessThan(iCap);
    // Thân nhánh (đến lời cấp) phải thoát bằng `continue` và KHÔNG chứa lời cấp.
    const than = CAP.slice(iNhanh, iCap);
    expect(than).toMatch(/\bcontinue;/);
    expect(than).not.toMatch(/capQuyenHocTrongTx|studyEntitlement\.(create|update)|tx\.studyEntitlementUsage/);
    // Nhánh đứng SAU phép chọn học viên (không bao giờ ghi THIEU_QUYEN_HOC khi chưa biết học viên: khi đó là CHO_CHUYEN_DOI).
    expect(CAP.indexOf('hv.kieu !== "CO"')).toBeLessThan(iNhanh);
  });

  it("[HD-W2] hich.ts: HAI hàm bọc có kết quả, mỗi hàm đúng MỘT lời gọi xuống tầng DB; vỏ không-ném gọi chúng với chế độ \"CAP\"", () => {
    expect(HICH).toMatch(/export function xetCapQuyenHocCoKetQua\(orderId: string, nguon: NguonCapQuyenHoc, now: Date, cheDo: CheDoXetCap\)/);
    expect(HICH).toMatch(/export function xetXepLopCoKetQua\(orderId: string, nguon: NguonCapQuyenHoc, now: Date\)/);
    expect(dem(HICH, /\bxetCapQuyenHocChoDon\(/)).toBe(1);
    expect(dem(HICH, /\bxetXepLopChoDon\(/)).toBe(1);
    expect(dem(HICH, /\bxetCapQuyenHocCoKetQua\(orderId, nguon, now, "CAP"\)/)).toBe(1);
    expect(dem(HICH, /\bxetXepLopCoKetQua\(orderId, nguon, now\)/)).toBe(1);
  });

  it('[HD-W3] cron (doi-soat.ts) chỉ gọi hàm xét với "CHI_GHI_NHAN" — không "CAP", không import đường cấp / xếp lớp / thu hồi', () => {
    expect(dem(DOI_SOAT, /\bxetCapQuyenHocCoKetQua\(/)).toBe(1);
    expect(DOI_SOAT).toMatch(/xetCapQuyenHocCoKetQua\(orderId, "DOI_SOAT_DEM", now, "CHI_GHI_NHAN"\)/);
    expect(DOI_SOAT).not.toMatch(/"CAP"/);
    expect(DOI_SOAT).not.toMatch(/xetXepLopCoKetQua|xetXepLopChoDon/); // chốt phạm vi là GHI vào quyền học — cron không làm
    for (const tep of TEP_HANG_DOI) {
      if (tep === "hanh-dong.ts") continue; // hành động CỦA NGƯỜI được phép gọi dungQuyenHocTrongTx — xem [HD-W4]
      const ma = doc(`${DIR}/${tep}`);
      expect(ma, tep).not.toMatch(/from "\.\.\/(dich-vu|cap-tu-don|xep-lop-tu-don)"/);
      expect(ma, tep).not.toMatch(/\b(capQuyenHoc|capQuyenHocTrongTx|xepLop|xepLopTrongTx|dungQuyenHoc|dungQuyenHocTrongTx|ghiNhanBai|huyGhiNhanBai|dongBangQuyenHoc|moBangQuyenHoc)\(/);
    }
  });

  it("[HD-W4] hành động của NGƯỜI: chỉ dùng MỘT hàm ghi quyền học — dungQuyenHocTrongTx — và chỉ ở duyệt thu hồi; hai chế độ của hàm xét đúng chỗ", () => {
    expect(HANH_DONG).toMatch(/import \{ dungQuyenHocTrongTx, LoiQuyenHoc \} from "\.\.\/dich-vu";/);
    expect(dem(HANH_DONG, /\bdungQuyenHocTrongTx\(/)).toBe(1);
    expect(dem(HANH_DONG, /\bxetCapQuyenHocCoKetQua\(/)).toBe(2);
    expect(dem(HANH_DONG, /"CHI_GHI_NHAN"\)/)).toBe(1); // làm tươi trước khi duyệt thu hồi: không cấp
    expect(dem(HANH_DONG, /"CAP"\)/)).toBe(1); // "Thử cấp lại": đúng đường cấp có sẵn
    expect(dem(HANH_DONG, /\bxetXepLopCoKetQua\(/)).toBe(1);
    // Thu hồi dùng ĐÚNG hàm dịch vụ sẵn có, sau khi đã kiểm "chưa tiêu thụ" dưới khoá dòng quyền học.
    const i = HANH_DONG.indexOf("dungQuyenHocTrongTx(tx");
    const truoc = HANH_DONG.slice(0, i);
    expect(truoc).toMatch(/FOR UPDATE/);
    expect(truoc.lastIndexOf("daTieuThuBuoi(tx")).toBeGreaterThan(truoc.lastIndexOf("FOR UPDATE"));
    expect(truoc.lastIndexOf('cho("DUYET_THU_HOI"')).toBeGreaterThan(truoc.lastIndexOf("daTieuThuBuoi(tx"));
  });

  it("[HD-W5] hàng đợi / cron KHÔNG bao giờ GHI sổ cái buổi đã học và KHÔNG chạm các bảng tiền / ghi danh / dòng đơn (cột đó nuôi hoa hồng, hoàn tiền, bảo lưu)", () => {
    for (const tep of [...TEP_HANG_DOI.map((t) => `${DIR}/${t}`), "app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts", "app/api/cron/quyen-hoc-doi-soat/route.ts"]) {
      const ma = doc(tep);
      expect(ma, tep).not.toMatch(/studyEntitlementUsage\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\(/);
      expect(ma, tep).not.toMatch(/\b(orderItem|payment|paymentAllocation|paymentRequest|enrollment|student|order|bankTransaction)\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\(/);
    }
  });
});

describe("[HD-W] khuôn của hành động ghi (hanh-dong.ts)", () => {
  it("[HD-W6] mỗi transaction: khoá ĐƠN là câu đầu tiên; không có `db.` bên trong (kết nối thứ hai trong lúc tx giữ kết nối đầu)", () => {
    const soTx = dem(HANH_DONG, /\bdb\.\$transaction\(/);
    expect(soTx).toBeGreaterThanOrEqual(4);
    expect(dem(HANH_DONG, /\$transaction\(\s*async \(tx\)[^=]*=>\s*\{\s*await khoaDonTrongTx\(tx,/)).toBe(soTx);
    for (const doan of HANH_DONG.split("db.$transaction(").slice(1)) {
      const than = doan.slice(0, doan.indexOf("TX_OPTS"));
      expect(than, than.slice(0, 80)).not.toMatch(/\bdb\./);
    }
  });

  it("[HD-W7] mọi AuditLog ghi trong CÙNG transaction (`tx`), có người bấm, có lý do (trừ \"Thử cấp lại\" — không có lý do nhập)", () => {
    const khoi = HANH_DONG.split("writeAudit({").slice(1).map((d) => d.slice(0, d.indexOf("});")));
    expect(khoi.length).toBe(6); // 4 hành động cũ + `duyetHocVuot` ghi HAI dòng (dòng hàng đợi + quyền học)
    for (const k of khoi) {
      expect(k).toMatch(/\btx,/);
      expect(k).toMatch(/actor: vao\.nguoi/);
      expect(k).toMatch(/entityType: "StudyEntitlement(Xu\u004cy)?"/);
      expect(k).toMatch(/oldValues:/);
      expect(k).toMatch(/newValues:/);
    }
    // Dòng audit của QUYỀN HỌC chỉ có ở duyệt học vượt (đúng MỘT, cùng giao dịch với dòng audit của dòng hàng đợi).
    expect(khoi.filter((k) => /entityType: "StudyEntitlement"/.test(k)).length).toBe(1);
    expect(khoi.filter((k) => /reason: vao\.lyDo\.trim\(\)/.test(k)).length).toBe(5);
    // Idempotent: dòng đã đóng ⇒ trả "không có gì đổi" TRƯỚC khi ghi audit (không trùng audit khi bấm lại).
    expect(dem(HANH_DONG, /trangThai !== "OPEN"\) return khongDoi\(/)).toBe(6); // 4 cũ + duyệt học vượt (một lần NGOÀI tx, một lần trong tx dưới khoá)
  });

  it("[HD-W8] mọi hành động đi qua `chuanBi` (scopedDb + passesScope + can(entitlements:manage) + cờ) và qua `cho()` = xetHanhDong — MỘT chính sách", () => {
    expect(dem(HANH_DONG, /await chuanBi\(/)).toBe(4);
    expect(HANH_DONG).toMatch(/export const dongDongHangDoi = /);
    expect(HANH_DONG).toMatch(/export const giuQuyenHoc = /);
    for (const ten of ["danhDauCanDuyet", "duyetThuHoi", "thuCapLai"]) expect(HANH_DONG).toMatch(new RegExp(`export async function ${ten}\\(`));
    const chuanBi = HANH_DONG.slice(HANH_DONG.indexOf("async function chuanBi("), HANH_DONG.indexOf("type Client"));
    expect(chuanBi).toMatch(/scopedDb\(actor\)\.studyEntitlementXuLy\.findUnique/);
    expect(chuanBi).toMatch(/passesScope\("StudyEntitlementXuLy"/);
    expect(chuanBi).toMatch(/can\(actor, "entitlements:manage"/);
    expect(chuanBi).toMatch(/laThuHocPhiTheoPhamViBat\(/);
    expect(dem(HANH_DONG, /\bxetHanhDong\(/)).toBe(1);
    expect(dem(HANH_DONG, /\bcho\("(THU_LAI|DANH_DAU_CAN_DUYET|DUYET_THU_HOI)"/)).toBe(3);
    expect(dem(HANH_DONG, /\bcho\(hd,/)).toBe(1);
    // Cổng ĐỨNG TRƯỚC phép ghi đầu tiên của từng hành động: mọi `tx.studyEntitlementXuLy.update(` / `thiHanhHanhDongCho(` nằm SAU một lời gọi `cho(`.
    let soDoanCoGhi = 0;
    for (const doan of HANH_DONG.split("db.$transaction(").slice(1)) {
      const iGhi = Math.min(...["tx.studyEntitlementXuLy.update(", "thiHanhHanhDongCho(", "dungQuyenHocTrongTx(tx"].map((g) => (doan.indexOf(g) < 0 ? Infinity : doan.indexOf(g))));
      if (iGhi === Infinity) continue; // giao dịch chỉ ghi AuditLog của "Thử cấp lại": cổng của nó đứng NGOÀI giao dịch ([HD-W9])
      soDoanCoGhi++;
      expect(doan.slice(0, iGhi), doan.slice(0, 60)).toMatch(/\bcho\(/);
    }
    expect(soDoanCoGhi).toBe(4); // 3 cũ + duyệt học vượt
    // `duyetHocVuot` đi qua `chuanBiDuyet` (scopedDb + passesScope + can(manage) HOẶC can(approve-exception) + cờ) và qua `cho("DUYET_HOC_VUOT", …)` = xetHanhDong, TRƯỚC phép ghi đầu tiên.
    expect(dem(HANH_DONG, /await chuanBiDuyet\(/)).toBe(1);
    const cb = HANH_DONG.slice(HANH_DONG.indexOf("async function chuanBiDuyet("), HANH_DONG.indexOf("export async function duyetHocVuot("));
    expect(cb).toMatch(/scopedDb\(actor\)\.studyEntitlementXuLy\.findUnique/);
    expect(cb).toMatch(/passesScope\("StudyEntitlementXuLy"/);
    expect(cb).toMatch(/can\(actor, "entitlements:manage"/);
    expect(cb).toMatch(/can\(actor, "entitlements:approve-exception"/);
    expect(cb).toMatch(/laThuHocPhiTheoPhamViBat\(/);
    const duyet = HANH_DONG.slice(HANH_DONG.indexOf("export async function duyetHocVuot("));
    const iCho = duyet.search(/\bcho\(\s*"DUYET_HOC_VUOT"/);
    expect(iCho).toBeGreaterThan(-1);
    expect(iCho).toBeLessThan(duyet.indexOf("tx.studyEntitlement.update("));
    expect(iCho).toBeLessThan(duyet.indexOf("taoDongHocBu(tx"));
  });

  it("[HD-W9] \"Thử cấp lại\" gọi cap rồi xếp lớp rồi đối soát lệch, theo đúng thứ tự, và KHÔNG tự viết logic cấp", () => {
    const thuLai = HANH_DONG.slice(HANH_DONG.indexOf("export async function thuCapLai("), HANH_DONG.indexOf("interface ChuanBiDuyet"));
    const i1 = thuLai.indexOf("xetCapQuyenHocCoKetQua(");
    const i2 = thuLai.indexOf("xetXepLopCoKetQua(");
    const i3 = thuLai.indexOf("doiSoatLechMotDon(");
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(thuLai).not.toMatch(/studyEntitlement\.(create|update)|capQuyenHocTrongTx/);
  });
});

describe("[HD-W] Server Action + giao diện", () => {
  const dsAction = ACTIONS.split("export async function ").slice(1);

  it("[HD-W10] sáu action ghi, MỖI action gọi MỘT cổng vào (`vaoAction`: manage; `vaoActionDuyet`: manage HOẶC approve-exception) TRƯỚC khi giao cho dịch vụ", () => {
    expect(dsAction.map((a) => a.slice(0, a.indexOf("("))).sort()).toEqual(["danhDauCanDuyetAction", "dongDongAction", "duyetHocVuotAction", "duyetThuHoiAction", "giuQuyenAction", "thuCapLaiAction"]);
    for (const a of dsAction) {
      const laDuyet = a.startsWith("duyetHocVuotAction");
      expect(dem(a, laDuyet ? /\bawait vaoActionDuyet\(/ : /\bawait vaoAction\(/), a.slice(0, 40)).toBe(1);
      expect(dem(a, laDuyet ? /\bawait vaoAction\(/ : /\bawait vaoActionDuyet\(/), a.slice(0, 40)).toBe(0);
      expect(a.indexOf("vaoAction"), a.slice(0, 40)).toBeLessThan(a.search(/\bawait (thuCapLai|dongDongHangDoi|giuQuyenHoc|duyetThuHoi|danhDauCanDuyet|duyetHocVuot)\(|\bra\(await /));
    }
    const iDuyet = ACTIONS.indexOf("async function vaoActionDuyet(");
    const vao = ACTIONS.slice(ACTIONS.indexOf("async function vaoAction("), iDuyet);
    expect(vao).toMatch(/await auth\(\)/);
    expect(vao).toMatch(/scopedDb\(actor\)\.studyEntitlementXuLy\.findUnique/);
    expect(dem(vao, /checkPermission\("entitlements:manage"/)).toBe(1);
    expect(vao).not.toMatch(/approve-exception/);
    const vaoDuyet = ACTIONS.slice(iDuyet, ACTIONS.indexOf("function ra("));
    expect(vaoDuyet).toMatch(/await auth\(\)/);
    expect(vaoDuyet).toMatch(/scopedDb\(actor\)\.studyEntitlementXuLy\.findUnique/);
    expect(dem(vaoDuyet, /checkPermission\("entitlements:approve-exception"/)).toBe(1);
    expect(dem(vaoDuyet, /checkPermission\("entitlements:manage"/)).toBe(1);
    expect(dem(ACTIONS, /checkPermission\(/)).toBe(3);
  });

  it("[HD-W11] quyền: đọc = entitlements:view (PAGE_GATES), ghi = entitlements:manage; `approve-exception` CHỈ ở đúng ba nơi của đường duyệt học vượt (quyết định 5) — không nơi nào khác", () => {
    expect(PAGE_GATES["/quyen-hoc-hang-doi"]).toEqual(["entitlements:view"]);
    expect(PAGE).toMatch(/checkAnyPermission\(\[\.\.\.PAGE_GATES\["\/quyen-hoc-hang-doi"\]\]\)/);
    // Tên khoá xuất hiện ở CHÍNH XÁC các tệp sau (mỗi tệp một chỗ gọi): doc-hang-doi (tính nút), hanh-dong (chuanBiDuyet), _actions (vaoActionDuyet). Giao diện KHÔNG tự suy quyền.
    const CHO_PHEP = new Map<string, number>([
      [`${DIR}/doc-hang-doi.ts`, 1],
      [`${DIR}/hanh-dong.ts`, 1],
      ["app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts", 1],
    ]);
    for (const tep of [...TEP_HANG_DOI.map((t) => `${DIR}/${t}`), "app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts", "app/(admin)/admin/quyen-hoc-hang-doi/page.tsx", "app/(admin)/admin/quyen-hoc-hang-doi/_components/xu-ly-dong.tsx"]) {
      expect(dem(doc(tep), /"entitlements:approve-exception"/), tep).toBe(CHO_PHEP.get(tep) ?? 0);
    }
    // Không tự đẻ khoá mới: mọi chuỗi "entitlements:*" trong mã hàng đợi nằm trong bốn khoá đã có.
    const tatCa = [DOC, HANH_DONG, ACTIONS, PAGE, XU_LY].join("\n");
    const khoa = new Set([...tatCa.matchAll(/"(entitlements:[a-z-]+)"/g)].map((m) => m[1]));
    // (`entitlements:view`: PAGE_GATES ở trên + cổng đọc `canXem` của doc-hang-doi.ts.)
    expect([...khoa].sort()).toEqual(["entitlements:approve-exception", "entitlements:manage", "entitlements:view", "entitlements:view-money"]);
    expect(DOC).toMatch(/getEffectivePermissions\(actor\).has\("entitlements:view"\)/);
    expect(dem(DOC, /\bcanXem\(actor\);/)).toBe(2); // docHangDoi + demDangMo
  });

  it("[HD-W12] nút ≡ action (luật 12): trang vẽ nút từ `dong.hanhDong` do `hanhDongDuocPhep` tính; client KHÔNG tự suy quyền", () => {
    expect(dem(DOC, /\bhanhDongDuocPhep\(/)).toBe(1);
    expect(DOC).toMatch(/coQuyenManage = can\(actor, "entitlements:manage", target\)/);
    expect(dem(XU_LY, /\bdong\.hanhDong\b/)).toBeGreaterThanOrEqual(2);
    expect(XU_LY).not.toMatch(/\bcan\(|checkPermission|isSuperAdmin|\.roles?\b|["']entitlements:/);
    // Ô \"Xử lý\" chỉ khác \"Chi tiết\" bởi hanhDong.length — vai chỉ-xem vẫn mở được chi tiết nhưng không có nút ghi.
    expect(XU_LY).toMatch(/dong\.hanhDong\.length > 0 \? "Xử lý" : "Chi tiết"/);
    expect(PAGE).toMatch(/<XuLyDong dong=\{d\} \/>/);
  });

  it("[HD-W13] cách ly cơ sở: mọi đọc dòng hàng đợi đi qua scopedDb; `db` trần chỉ dùng cho đếm buổi đã tiêu thụ (sổ cái nằm dưới quyền học đã scoped)", () => {
    expect(dem(DOC, /\bdb\.studyEntitlementXuLy\b/)).toBe(0);
    expect(dem(DOC, /\bscopedDb\(actor\)/)).toBe(2);
    expect(dem(DOC, /\bdb\./)).toBe(1);
    expect(DOC).toMatch(/db\.studyEntitlementUsage\.groupBy/);
  });

  it("[HD-W14] đăng ký: route cấp quyền admin (segment + PAGE_GATES + sidebar KHÔNG gắn flag toàn cục — cờ phạm vi là cờ theo cơ sở)", () => {
    expect(ADMIN_ROUTE_SEGMENTS.has("quyen-hoc-hang-doi")).toBe(true);
    const sidebar = doc("components/admin/sidebar.tsx");
    const dong = sidebar.split("\n").find((d) => d.includes('href: "/quyen-hoc-hang-doi"'));
    expect(dong).toBeDefined();
    expect(dong).toMatch(/perm: \[\.\.\.PAGE_GATES\["\/quyen-hoc-hang-doi"\]\]/);
    expect(dong).not.toMatch(/flag:/);
  });
});

describe("[HD-W] cron `quyen-hoc-doi-soat`", () => {
  it("[HD-W15] route: withCron (cổng CRON_SECRET) + trần đơn truyền TƯỜNG MINH (đăng ký vercel.json / crontab: hang-doi-dang-ky-cron.test.ts — đọc deploy/ nên chỉ chạy ở CI private)", () => {
    const route = doc("app/api/cron/quyen-hoc-doi-soat/route.ts");
    expect(route).toMatch(/export const GET = withCron\("quyen-hoc-doi-soat"/);
    expect(route).toMatch(/gioiHanDonMoiCoSo: GIOI_HAN_DON_MOI_CO_SO/);
  });

  it("[HD-W16] khoá đơn TRƯỚC mọi phép ghi dòng LECH; `orgUnitId` tính TRƯỚC transaction; không `db.` trong tx", () => {
    const iTx = DOI_SOAT.indexOf("db.$transaction(");
    expect(DOI_SOAT.indexOf("orgUnitIdForCenter(truoc.centerId)")).toBeGreaterThan(-1);
    expect(DOI_SOAT.indexOf("orgUnitIdForCenter(truoc.centerId)")).toBeLessThan(iTx);
    const tx = DOI_SOAT.slice(iTx + "db.$transaction(".length, DOI_SOAT.indexOf("{ maxWait: 15_000, timeout: 30_000 }"));
    expect(tx.indexOf("khoaDonTrongTx(tx,")).toBeGreaterThan(-1);
    expect(tx.indexOf("khoaDonTrongTx(tx,")).toBeLessThan(tx.indexOf("thiHanhHanhDongCho("));
    expect(tx).not.toMatch(/\bdb\./);
    expect(dem(tx, /\bdocMatLech\(tx,/)).toBe(1); // đọc LẠI dưới khoá
    // Cơ sở TẮT cờ bị bỏ qua TRƯỚC khi đọc bất kỳ đơn nào.
    const cron = DOI_SOAT.slice(DOI_SOAT.indexOf("export async function chayDoiSoatQuyenHoc("));
    expect(cron.indexOf("laThuHocPhiTheoPhamViBat(orgUnitId)"), "cron phải CÓ lời gọi cổng cờ").toBeGreaterThan(-1);
    expect(cron.indexOf("laThuHocPhiTheoPhamViBat(orgUnitId)")).toBeLessThan(cron.indexOf("jsonb_exists("));
    // Và hàm đối soát lệch TỰ kiểm cờ của cơ sở của đơn (không tin chỗ gọi), TRƯỚC khi mở transaction.
    const lech = DOI_SOAT.slice(DOI_SOAT.indexOf("export async function doiSoatLechMotDon("), DOI_SOAT.indexOf("export async function doiSoatLechMotDon(") + 1600);
    expect(lech.indexOf("laThuHocPhiTheoPhamViBat(orgUnitId)")).toBeGreaterThan(-1);
    expect(lech.indexOf("laThuHocPhiTheoPhamViBat(orgUnitId)")).toBeLessThan(lech.indexOf("db.$transaction("));
  });

  it("[HD-W17] ghi dòng mới/mở lại: mang centerId + orgUnitId tường minh (scopedDb không che write)", () => {
    const g = doc(`${DIR}/ghi-dong.ts`);
    const create = g.slice(g.indexOf("studyEntitlementXuLy.create("));
    expect(create.slice(0, 500)).toMatch(/centerId: nc\.centerId/);
    expect(create.slice(0, 500)).toMatch(/orgUnitId: nc\.orgUnitId/);
    expect(dem(g, /\btx\.studyEntitlementXuLy\.(create|update)\(/)).toBe(4);
    expect(dem(g, /\bdb\./)).toBe(0);
  });
});

describe("[HD-W] vòng đời + schema", () => {
  it("[HD-W18] `daQuyetDauVan` là trường BẮT BUỘC ở cả hai hàm vòng đời, và MỌI nơi thi hành đều truyền nó + gỡ quyết định khi mở lại", () => {
    for (const tep of ["lib/entitlements/cho-chuyen-doi.ts", "lib/entitlements/cho-xep-lop.ts"]) {
      expect(doc(tep), tep).toMatch(/readonly daQuyetDauVan: string \| null;/);
    }
    expect(dem(CAP, /daQuyetDauVan: docDauVanDaQuyet\(cho\.payload\)/)).toBe(1);
    expect(dem(CAP, /\.\.\.payloadSauMoLai\(cho\.payload\)/)).toBe(1);
    expect(dem(XEP, /daQuyetDauVan: docDauVanDaQuyet\(hienCo\.payload\)/)).toBe(1);
    expect(dem(XEP, /\.\.\.payloadSauMoLai\(hienCo\.payload\)/)).toBe(1);
    expect(dem(DOI_SOAT, /daQuyetDauVan: docDauVanDaQuyet\(/)).toBe(1);
  });

  it("[HD-W19] enum 7 giá trị (CHO_DUYET_HOC_VUOT thêm ở PR5); migration CHỈ thêm hai giá trị (additive, không dùng chúng), dấu thời gian duy nhất và sau migration xếp lớp", () => {
    const schema = doc("prisma/schema.prisma");
    const enumBody = schema.match(/enum EntitlementXuLyLoai \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(enumBody.split(/\s+/).filter(Boolean).sort()).toEqual(["CAN_THU_HOI", "CHO_CHUYEN_DOI", "CHO_DUYET_HOC_VUOT", "CHO_XEP_LOP", "LECH_DU_LIEU", "THIEU_QUYEN_HOC", "TREO_DUYET_TAY"]);
    const TEN = "20261022100000_quyen_hoc_xu_ly_doi_soat";
    const sql = docTho(`prisma/migrations/${TEN}/migration.sql`).replace(/--[^\n]*/g, "").trim().split(/\s*\n\s*/).join("\n");
    expect(sql).toBe(
      `ALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'THIEU_QUYEN_HOC';\nALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'LECH_DU_LIEU';`,
    );
    const ten = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((t) => /^\d{14}_/.test(t));
    expect(ten.filter((t) => t.startsWith("20261022100000_"))).toEqual([TEN]);
    expect(TEN > "20261021100000_quyen_hoc_xu_ly_cho_xep_lop").toBe(true);
  });

  it("[HD-W20] [HD-SC] cách ly cơ sở của bảng hàng đợi (đã khai ở #655): SCOPED_MODELS + prefix quyền `entitlements:`", () => {
    expect(SCOPED_MODELS.has("StudyEntitlementXuLy")).toBe(true);
    expect(getModelPrefixes("StudyEntitlementXuLy")).toContain("entitlements:");
  });
});
