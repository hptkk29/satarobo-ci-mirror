// @vitest-environment node
/**
 * [DYN-CC-W*] — LƯỚI GHIM MÃ NGUỒN của đợt CỦNG CỐ LÕI sau rà soát đối kháng 09/10/2026 (res3 · res4). Hành vi đã có ca DB (`tests/hoa-hong/nguon-dong-{chup,cong}.spec.ts`,
 * `tests/lead-intake/nguon-doi-nguon.spec.ts`); lưới này canh thứ ca DB không thấy: một ĐƯỜNG THỨ HAI qua mặt cổng, và THỨ TỰ «cổng → khoá → phép ghi».
 *
 *   [DYN-CC-W1] bản chụp `signals.nguon`: engine đọc qua `nguonHieuLucChoEngine`, KHÔNG đọc thẳng cột nguồn; cả BA điểm ghi (resolver · đổi nguồn) đều chụp
 *   [DYN-CC-W2] TU_CLAIM CHỈ ở đường ĐỔI nguồn (so cả ba chủ lead + ba kiểu người nhận); đường TẠO ghi người gõ làm người giới thiệu (D12 giữ nguyên, 09/10/2026)
 *   [DYN-CC-W3] cổng quyền theo mức dính tiền: action hỏi `commission_policies:activate`, service quyết lượt nào cần nó TRƯỚC phép ghi đầu tiên; bật cờ chạy lại guardrail dưới khoá advisory
 *   [DYN-CC-W4] đích mặc định của quy nguồn: cả hai cổng ghi (sửa · đổi trạng thái) gọi `lamHongDichMacDinh`; setting nhóm nhân sự chặn Ở NƠI LƯU
 *   [DYN-CC-W5] doiNguonLead: nhóm đích đọc LẠI trong transaction SAU `FOR SHARE`; mọi quyết định dùng bản đọc trong transaction
 *   [DYN-CC-W6] ba hàm đọc chi tiết nguồn tự gác quyền; trần không đọc được KHÔNG giả 100%
 *
 * Quy tắc viết lưới (luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;
const doc = (t: string) => boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));

describe("[DYN-CC-W1] bản chụp nguồn", () => {
  it("engine đọc nguồn qua `nguonHieuLucChoEngine` (1 lời gọi) và chỉ trả `ownerEmployeeId`/`attributionWindowDays` ĐÃ QUA hàm ấy", () => {
    const d = doc("lib/nguon/doc-nguon-hoa-hong.ts");
    expect(dem(d, "nguonHieuLucChoEngine(")).toBe(1);
    expect(dem(d, /cuaSoRiengNgay:\s*hieuLuc\.cuaSoRiengNgay/)).toBe(1);
    expect(dem(d, /nguonChuEmployeeId:\s*hieuLuc\.chuNhanVienId/)).toBe(1);
    // chỗ DUY NHẤT nhắc hai cột nguồn sống là lời GỌI hàm hợp nhất (tham số `song`), không phải trường trả ra
    expect(dem(d, /nguonChuEmployeeId:\s*a\.group\./)).toBe(0);
    expect(dem(d, /cuaSoRiengNgay:\s*a\.group\./)).toBe(1); // trong tham số `song` của lời gọi
    expect(dem(d, "signals: true")).toBe(1);
  });

  it("màn «Gán nguồn» đọc hạn ghi công cũng qua `nguonHieuLucChoEngine` (cùng số với engine — luật 12b)", () => {
    const d = doc("lib/nguon/doc-gan-nguon.ts");
    expect(dem(d, "nguonHieuLucChoEngine(")).toBe(1);
    expect(dem(d, /cuaSoHieuLuc\(a\.group\.attributionWindowDays/)).toBe(0);
  });

  it("cả hai điểm GHI nguồn đều chụp: resolver (`chupNguon` trong hoanTat) và đổi nguồn có kiểm soát", () => {
    expect(dem(doc("lib/nguon/quy-nguon.ts"), "chupNguon(")).toBe(1);
    expect(dem(doc("lib/nguon/doi-nguon-lead.ts"), "chupNguon(")).toBe(1);
    expect(dem(doc("lib/nguon/quy-nguon.ts"), /signals\.nguon\s*=/)).toBe(1);
    // kế thừa chép NGUYÊN VĂN bản chụp của hàng gốc
    expect(dem(doc("lib/nguon/thu-thap-tin-hieu.ts"), "docNguonChup(")).toBe(1);
  });
});

describe("[DYN-CC-W2] TU_CLAIM", () => {
  it("`gian-lan.ts` không còn điều kiện cũ (nguồn cũ UNKNOWN · chỉ assignedToId · chỉ người nhận kiểu nhân sự); `doiNguonLead` không truyền chúng nữa", () => {
    const g = doc("lib/nguon/gian-lan.ts");
    for (const cu of ["nguonCuLaUnknown", "actorEmployeeId", "chuLeadId", "assignedToId"]) expect(dem(g, cu), cu).toBe(0);
    const d = doc("lib/nguon/doi-nguon-lead.ts");
    for (const cu of ["nguonCuLaUnknown", "actorEmployeeId", "chuLeadId"]) expect(dem(d, cu), cu).toBe(0);
  });

  it("đường ĐỔI: chủ lead = người bấm + assignedTo + convertedBy + admin (đọc cả ba cột), người nhận = cả BA kiểu (giới thiệu · Sale PH · chủ nguồn đích đọc trong giao dịch)", () => {
    const d = doc("lib/nguon/doi-nguon-lead.ts");
    expect(dem(d, /\[p\.actor\.userId, lead\.assignedToId, lead\.convertedById, lead\.adminId\]/)).toBe(1);
    expect(dem(d, "convertedById: true, adminId: true")).toBe(1);
    const i = d.indexOf("danhTinhNguoiNhan({");
    expect(i).toBeGreaterThan(-1);
    const khoi = d.slice(i, i + 400);
    for (const truong of ["referrerEmployeeId:", "referrerSaleUserId: anhChupMoi.referrerSaleUserId", "chuNguonEmployeeId: nhomMoi.ownerEmployeeId"]) expect(dem(khoi, truong), truong).toBe(1);
  });

  it("[DYN-CC-W2b] đường TẠO KHÔNG soi tự nhận (D12 giữ nguyên): resolver / thu thập tín hiệu / kiểu tín hiệu không còn dấu vết của cổng; `phanTuNhan` không còn trong gian-lan.ts", () => {
    // Cấy: thêm lại một cổng «người nhập = người hưởng» (chuLeadLucTao · phanTuNhan · cờ TU_CLAIM) vào đường tạo ⇒ ca này đỏ cùng [DYN-TC-01..03].
    for (const tep of ["lib/nguon/quy-nguon.ts", "lib/nguon/thu-thap-tin-hieu.ts", "lib/nguon/tin-hieu.ts"]) {
      const m = doc(tep);
      for (const cu of ["phanTuNhan", "phatHienGianLan", "chuLeadLucTao", "TU_CLAIM", "tuClaim"]) expect(dem(m, cu), `${tep} · ${cu}`).toBe(0);
    }
    expect(dem(doc("lib/nguon/gian-lan.ts"), /export function phanTuNhan\b/)).toBe(0);
    expect(dem(doc("lib/nguon/gian-lan.ts"), /export function phatHienGianLan\b/)).toBe(1);
  });

  it("[DYN-CC-W2c] đối chứng dương: người gõ (phiên đăng nhập) VẪN được ghi làm người giới thiệu — KHAI_TAY chụp vai + dấu vết từ `tin.nguoiNhap`; chỗ DUY NHẤT gọi `phatHienGianLan(` là `doiNguonLead`", () => {
    expect(dem(doc("lib/nguon/quy-nguon.ts"), /anhChupNhanSu\(tin\.nguoiNhap,\s*ch\.vaiSangNguon\)/)).toBe(1);
    expect(dem(doc("lib/nguon/doi-nguon-lead.ts"), "phatHienGianLan(")).toBe(1);
    // và không tệp mã nguồn nào khác gọi nó (đường tạo lọt cổng bằng cửa sau = thêm lời gọi ở đây)
    const khac = ["lib/nguon/noi-day.ts", "lib/nguon/thu-thap-tin-hieu.ts", "lib/nguon/quy-nguon.ts", "lib/lead/intake/ingest.ts", "lib/nguon/di-tru-db.ts"];
    for (const tep of khac) expect(dem(doc(tep), "phatHienGianLan("), tep).toBe(0);
  });
});

describe("[DYN-CC-W3] cổng quyền theo mức dính tiền + bật cờ kiểm trần", () => {
  it("Server Action hỏi `commission_policies:activate` qua checkPermission MỘT lần và truyền vào `suaNguon`; `doiTrangThaiNguon` nhận `now`", () => {
    const a = doc("app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts");
    // BỐN action ghi (Page · tạo · sửa · đổi trạng thái) mỗi nơi hỏi cờ MỘT lần — cờ, KHÔNG phải cổng của action (lưới NHH-H-GATE ghim khoá cổng = sources:manage)
    expect(dem(a, /await coQuyenKichHoatChinhSach\(\)/)).toBe(4);
    expect(dem(a, "commission_policies:activate")).toBe(0);
    // …và MỖI lời gọi dịch vụ ghi nhận cờ ấy (bỏ quên một nơi = cổng «đụng tiền» của nơi đó mất tác dụng)
    for (const f of ["luuNguonCuaPage", "taoNguon", "suaNguon", "doiTrangThaiNguon"]) {
      const i = a.indexOf(`await ${f}(`);
      expect(i, f).toBeGreaterThan(0);
      expect(a.slice(i, a.indexOf("});", i)), f).toMatch(/\bcoQuyenKichHoat\b/);
    }
    expect(dem(doc("lib/nguon/quyen-kich-hoat.ts"), /checkPermission\(KHOA_QUYEN_KICH_HOAT_CHINH_SACH\)/)).toBe(1);
    expect(dem(doc("lib/nguon/quyen-kich-hoat.ts"), /KHOA_QUYEN_KICH_HOAT_CHINH_SACH = "commission_policies:activate"/)).toBe(1);
    expect(dem(a, "now: new Date()")).toBe(3); // luuPage + sua + doiTrangThai
  });

  it("service: cổng `canQuyenKichHoat` đứng TRƯỚC `leadSourceGroup.update(`, và nhận cờ quyền bắt buộc (không mặc định)", () => {
    const g = doc("lib/nguon/danh-muc-ghi.ts");
    const iSua = g.indexOf("export async function suaNguon(");
    const khoi = g.slice(iSua, g.indexOf("export type KetQuaDoiTrangThai"));
    expect(dem(khoi, "canQuyenKichHoat(")).toBe(1);
    expect(dem(khoi, "!p.coQuyenKichHoat")).toBe(1);
    expect(khoi.indexOf("canQuyenKichHoat(")).toBeLessThan(khoi.indexOf("leadSourceGroup.update("));
    expect(dem(khoi, /coQuyenKichHoat:\s*boolean/)).toBe(1);
    expect(dem(khoi, /coQuyenKichHoat\?:/)).toBe(0);
    expect(dem(khoi, /now:\s*Date/)).toBe(1);
  });

  it("[FIX-F2-W] bỏ trống chủ nguồn: `chanBoChuNguon(` được gọi MỘT lần trong `suaNguon`, TRƯỚC cổng quyền kích hoạt và TRƯỚC phép ghi; truy vấn rule nhìn cả rule của CHÍNH nguồn lẫn rule không gắn nguồn", () => {
    const g = doc("lib/nguon/danh-muc-ghi.ts");
    const iSua = g.indexOf("export async function suaNguon(");
    const khoi = g.slice(iSua, g.indexOf("export type KetQuaDoiTrangThai"));
    expect(dem(khoi, "chanBoChuNguon(")).toBe(1);
    // kết quả PHẢI được dùng để ném (gọi mà bỏ kết quả là cổng chết nhưng vẫn «có lời gọi»)
    expect(dem(khoi, /if\s*\(chanChu\)\s*throw new LoiGhiNguon\(chanChu\.truong,\s*chanChu\.loi\)/)).toBe(1);
    expect(khoi.indexOf("chanBoChuNguon(")).toBeLessThan(khoi.indexOf("canQuyenKichHoat("));
    expect(khoi.indexOf("chanBoChuNguon(")).toBeLessThan(khoi.indexOf("leadSourceGroup.update("));
    // truy vấn «rule SOURCE_OWNER đang chạy trên nguồn này» viết ở ĐÚNG MỘT chỗ (helper dùng chung ba cổng): rule của chính nguồn + rule không gắn nguồn nào
    // (W2: từ MỘT hàm `coRuleChuNguonChay` trong tệp ghi sang MỘT loader `docDinhTienNguon` dùng chung với màn hình — nút trạng thái hỏi CÙNG câu, không còn truy vấn chép tay ở nơi thứ hai)
    expect(dem(khoi, "docDinhTienNguon(tx, [dong.id])")).toBe(1);
    expect(dem(khoi, "ruleChuChayChoNguon(dt, dong.id)")).toBe(1);
    const dt = doc("lib/nguon/dinh-tien-nguon.ts");
    expect(dem(dt, /scopeSourceGroupId:\s*\{\s*in:\s*ids\s*\}/)).toBe(1);
    expect(dem(dt, /scopeType:\s*\{\s*not:\s*"SOURCE_GROUP"\s*\}/)).toBe(1);
    // …và KHÔNG còn bản chép tay ở tệp ghi / tệp đọc biểu mẫu
    for (const f of ["lib/nguon/danh-muc-ghi.ts", "lib/nguon/doc-form-nguon.ts", "lib/nguon/bang-nguon-theo-page.ts"]) {
      expect(dem(doc(f), /resolverType:\s*"SOURCE_OWNER"/), f).toBe(0);
    }
  });

  it("[FIX-F2-W2] nguồn HOẠT ĐỘNG không người phụ trách: `taoNguon` và `doiTrangThaiNguon` mỗi nơi gọi `chanNguonHoatDongKhongChu(` MỘT lần, kết quả được dùng để ném, và TRƯỚC phép ghi", () => {
    // Cấy: bỏ lời gọi ở một trong hai hàm ⇒ đỏ DB [DYN-03d]; ca này canh cả việc «gọi mà bỏ kết quả» (cổng chết nhưng vẫn có lời gọi).
    const g = doc("lib/nguon/danh-muc-ghi.ts");
    const iTao = g.indexOf("export async function taoNguon(");
    const iSua = g.indexOf("export async function suaNguon(");
    const iDoi = g.indexOf("export async function doiTrangThaiNguon(");
    const tao = g.slice(iTao, iSua);
    const doi = g.slice(iDoi);
    for (const [ten, khoi, ghi] of [
      ["taoNguon", tao, "leadSourceGroup.create("],
      ["doiTrangThaiNguon", doi, "leadSourceGroup.update("],
    ] as const) {
      expect(dem(khoi, "chanNguonHoatDongKhongChu("), ten).toBe(1);
      expect(dem(khoi, /if\s*\(chanChu\)\s*throw new LoiGhiNguon\(chanChu\.truong,\s*chanChu\.loi\)/), ten).toBe(1);
      expect(khoi.indexOf("chanNguonHoatDongKhongChu("), ten).toBeLessThan(khoi.indexOf(ghi));
    }
    // `suaNguon` không dùng hàm này (nó có `chanBoChuNguon` riêng cho đường bỏ trống chủ)
    expect(dem(g.slice(iSua, iDoi), "chanNguonHoatDongKhongChu("), "suaNguon").toBe(0);
  });

  it("bật cờ: guardrail chạy NGOÀI transaction, rồi khoá advisory + so dấu vân tay TRONG transaction, cả hai TRƯỚC phép ghi", () => {
    const g = doc("lib/nguon/danh-muc-ghi.ts");
    const iSua = g.indexOf("export async function suaNguon(");
    const khoi = g.slice(iSua, g.indexOf("export type KetQuaDoiTrangThai"));
    expect(dem(khoi, "kiemChinhSachKhiBatHoaHongNguon(")).toBe(1);
    expect(dem(khoi, "khoaTapChinhSach(tx)")).toBe(1);
    expect(dem(khoi, "vanTayTapChinhSachActive(tx)")).toBe(1);
    const iTx = khoi.indexOf("db.$transaction(");
    expect(khoi.indexOf("kiemChinhSachKhiBatHoaHongNguon(")).toBeLessThan(iTx);
    expect(khoi.indexOf("khoaTapChinhSach(tx)")).toBeGreaterThan(iTx);
    expect(khoi.indexOf("vanTayTapChinhSachActive(tx)")).toBeLessThan(khoi.indexOf("leadSourceGroup.update("));
  });

  it("guardrail kích hoạt chặn SOURCE_OWNER thiếu chủ + REFERRER_PARENT_SALE sai kiểu nguồn, so KIỂU/KHOÁ vai chứ không so mã vai", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    expect(dem(g, /vaiQ\?\.resolverType === "SOURCE_OWNER" && !g\.ownerEmployeeId/)).toBe(1);
    expect(dem(g, /vaiQ\?\.resolverKey === "REFERRER_PARENT_SALE" && g\.referrerRequirement !== "PARENT"/)).toBe(1);
    expect(dem(g, /roleCode === "SOURCE_OWNER"|roleCode === "REFERRER_PARENT_SALE"/)).toBe(0);
  });
});

describe("[DYN-CC-W4] đích mặc định của quy nguồn", () => {
  it("cả hai cổng ghi (sửa · đổi trạng thái) gọi `lamHongDichMacDinh`, danh sách đích dựng bởi MỘT hàm `maDichMacDinh`", () => {
    const g = doc("lib/nguon/danh-muc-ghi.ts");
    expect(dem(g, "lamHongDichMacDinh(")).toBe(2);
    expect(dem(g, "maDichMacDinh(")).toBe(2);
    expect(dem(g, "lamHongNhomMacDinh")).toBe(0);
    const q = doc("lib/nguon/quy-nguon.ts");
    for (const nguon of ["...Object.values(DICH_MAC_DINH)", "...Object.values(DUONG_VAO_MAC_DINH)", "p.nhomNhanSuMacDinh", "...Object.values(p.bangPage)"]) expect(dem(q, nguon), nguon).toBe(1);
  });

  it("setting nhóm nhân sự mặc định: `setGlobalSetting` hỏi `kiemGiaTriTheoDb` SAU Zod và TRƯỚC `systemSetting.upsert`; khoá lấy từ `KHOA_NGUON` (không gõ chuỗi)", () => {
    const s = doc("lib/settings/service.ts");
    const iHam = s.indexOf("export async function setGlobalSetting(");
    const khoi = s.slice(iHam, s.indexOf("export async function setCenterSetting("));
    expect(dem(khoi, "kiemGiaTriTheoDb(")).toBe(1);
    expect(khoi.indexOf("validateSettingValue(")).toBeLessThan(khoi.indexOf("kiemGiaTriTheoDb("));
    expect(khoi.indexOf("kiemGiaTriTheoDb(")).toBeLessThan(khoi.indexOf("systemSetting.upsert("));
    const k = doc("lib/settings/kiem-theo-db.ts");
    expect(dem(k, "[KHOA_NGUON.nhomNhanSuMacDinh]")).toBe(1);
    expect(dem(k, /"nguon\./)).toBe(0);
  });
});

describe("[DYN-CC-W5] doiNguonLead: nhóm đích đọc lại sau khoá", () => {
  it("`FOR SHARE` đúng MỘT lần, TRONG transaction, rồi đọc lại nhóm; quyết định dùng bản đọc trong transaction (không còn `nhomGui.` sau khi mở transaction)", () => {
    const d = doc("lib/nguon/doi-nguon-lead.ts");
    expect(dem(d, 'FOR SHARE')).toBe(1);
    const iTx = d.indexOf("db.$transaction(");
    const sau = d.slice(iTx);
    expect(sau.indexOf("FOR SHARE")).toBeGreaterThan(-1);
    expect(sau.indexOf("FOR SHARE")).toBeLessThan(sau.indexOf("leadSourceGroup.findUnique({ where: { id: groupIdGhi }"));
    expect(dem(sau, "nhomGui.")).toBe(0);
    expect(dem(sau.slice(0, sau.indexOf("const r = await doiNguon(")), "await doiNguon(")).toBe(0);
  });

  it("đường thoát hold: `boSungSalePhuHuynh` đi qua `doiNguonLead` (không đường ghi thứ hai) và chỉ điền chỗ trống", () => {
    const d = doc("lib/nguon/doi-nguon-lead.ts");
    const i = d.indexOf("export async function boSungSalePhuHuynh(");
    expect(i).toBeGreaterThan(-1);
    const khoi = d.slice(i);
    expect(dem(khoi, "return doiNguonLead(")).toBe(1);
    expect(dem(khoi, "saleTay: { userId: p.saleUserId }")).toBe(1);
    expect(dem(khoi, "leadAttribution.update")).toBe(0);
    expect(dem(d, /cu\.referrerSaleUserId === null/)).toBe(1);
    // và hai hold trỏ về LEAD (chỗ sửa thật)
    const h = doc("lib/hoa-hong/hang-cho-so.ts");
    expect(dem(h, 'lyDo === "THIEU_SALE_PHU_HUYNH"')).toBe(1);
    expect(dem(h, 'lyDo === "NGUON_CHUA_CO_NGUOI_PHU_TRACH"')).toBe(1);
  });
});

describe("[DYN-CC-W6] hàm đọc chi tiết nguồn", () => {
  it("ba hàm gác `sources:view` NGAY ĐẦU hàm (ba lời gọi `batQuyenXemNguon(actor)`); trần không đọc được ⇒ null, KHÔNG `?? 1` giả 100% ở kết quả", () => {
    const d = doc("lib/nguon/doc-chi-tiet-nguon.ts");
    expect(dem(d, "batQuyenXemNguon(actor);")).toBe(3);
    for (const ham of ["docChinhSachApDungCuaNguon", "docLichSuNguon", "docNguonDeSua"]) {
      const i = d.indexOf(`export async function ${ham}(`);
      expect(i, ham).toBeGreaterThan(-1);
      const dau = d.slice(i, i + 220);
      expect(dem(dau, "batQuyenXemNguon(actor)"), ham).toBe(1);
    }
    expect(dem(d, /vuotTran:\s*dl\.tran === null \? null/)).toBe(1);
    expect(dem(d, /tranPhanTram:\s*dl\.tran === null \? null/)).toBe(1);
  });

  it("guard xoá user/nhân viên: `nguoiDangGioiThieuLead({ userId })` nhìn cả `referrerSaleUserId`", () => {
    const n = doc("lib/nguon/nguoi-gioi-thieu.ts");
    expect(dem(n, /\{ referrerSaleUserId: m\.userId \}/)).toBe(1);
    expect(dem(doc("lib/nguon/ghi-nguon.ts"), /referrerSaleUserId: \{ in: \[\.\.\.ids\.userIds\] \}/)).toBe(1);
  });
});
