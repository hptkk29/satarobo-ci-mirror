/**
 * [NHH-KY-W1..W8] — LƯỚI GHIM MÃ NGUỒN cho dây nối của tab Kỳ (docs/source-commission 05 §5.4, 06 §5.4).
 *
 * Page và Server Action kéo next-auth + Prisma nên không dựng được trong vitest; test HÀNH VI của chúng nằm ở `tests/hoa-hong/ky-hanh-dong.spec.ts` (Postgres thật).
 * Lưới này canh những thứ mà ca hành vi KHÔNG phân biệt được — thứ tự "cổng trước phép ghi", và quyền mà nút vẽ ra có phải quyền mà action kiểm không. Ghim bằng văn bản mã
 * ĐÃ BỎ CHÚ THÍCH (luật 11): neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`. Mỗi ca đã được CẤY lại lỗi để thấy nó đỏ (báo cáo của đợt).
 *
 *   [NHH-KY-W1]  mọi Server Action: `vaoViec()` (auth + `commission_periods:manage`) đứng ĐẦU, TRƯỚC xác thực đầu vào và TRƯỚC lời gọi điều phối
 *   [NHH-KY-W2]  quyền mà NÚT vẽ ra (`scope.has(...)`) và quyền mà ACTION kiểm là CÙNG MỘT key (luật 12)
 *   [NHH-KY-W3]  mọi action đi qua `PHU_THUOC_THAT` (cờ + bối cảnh thật), đồng hồ lấy ở ĐÂY (ranh giới), không ở hàm lõi
 *   [NHH-KY-W4]  điều phối: cổng đứng TRƯỚC phép ghi (phạm vi trước `bamKy`; phạm vi trước so số; cờ trước dịch vụ)
 *   [NHH-KY-W5]  thành phần client KHÔNG tự xét điều kiện vòng đời, không chạm DB, và gửi đi bản chụp số liệu đã hiện
 *   [NHH-KY-W6]  đọc kỳ đi qua `scopedDb(actor)`, không `db.commissionPeriod.*` trần (ngoài một lần đọc theo id đã qua cổng phạm vi)
 *   [NHH-KY-W7]  `tinhKy` chặn kỳ không phải OPEN/CALCULATED TRƯỚC lượt quét
 *   [NHH-KY-W8]  page: một lời gọi `hanhDongCuaKy`, trần đọc từ setting, chip cơ sở từ tầm nhìn scope
 *   [NHH-KY-W9]  MỘT định nghĩa "hàng chờ chặn khoá": `demHangChoChanTheoMa` của ky-service; màn Kỳ (ky-doc) KHÔNG có phép đếm thứ hai; cổng khoá gọi đúng hàm đó
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

/** Thân từng `export async function ten(` — cắt đến hàm export kế tiếp. */
function cacHam(src: string): Map<string, string> {
  const ra = new Map<string, string>();
  const re = /export async function (\w+)\(/g;
  const moc = [...src.matchAll(re)].map((m) => ({ ten: m[1]!, tu: m.index! }));
  moc.forEach((m, i) => ra.set(m.ten, src.slice(m.tu, moc[i + 1]?.tu ?? src.length)));
  return ra;
}

const KY = "app/(admin)/admin/nguon-hoa-hong/ky";
const actions = doc(`${KY}/_actions.ts`);
const page = doc(`${KY}/page.tsx`);
const hanhDong = doc(`${KY}/_components/hanh-dong-ky.tsx`);
const dieuPhoi = doc("lib/hoa-hong/ky-hanh-dong.ts");
const kyDoc = doc("lib/hoa-hong/ky-doc.ts");
const kyService = doc("lib/hoa-hong/ky-service.ts");

const SAU_ACTION = ["tinhKyAction", "chuyenRaSoatAction", "traLaiAction", "khoaKyAction", "xuatKyAction", "doiHangChoSangKySauAction", "danhDauDaChiAction"] as const;
const DIEU_PHOI = ["tinhKyHanhDong", "chuyenRaSoatHanhDong", "traLaiHanhDong", "khoaHanhDong", "xuatHanhDong", "doiHangChoSangKyHanhDong", "danhDauDaChiHanhDong"] as const;
/** Hàng nút vòng đời (client `hanh-dong-ky.tsx`) chỉ gọi SÁU action — action thứ bảy do nút ở dòng hàng chờ (tab Sổ) gọi, có lưới riêng `[NHH-KY-W12]`. */
const ACTION_CUA_HANG_NUT = SAU_ACTION.filter((t) => t !== "doiHangChoSangKySauAction");
const KEY_QUYEN = "commission_periods:manage";

describe("[NHH-KY-W1] Server Action: quyền ĐỨNG ĐẦU", () => {
  const ham = cacHam(actions);

  it("đúng bảy action được export (thêm action mới ⇒ phải vào lưới này)", () => {
    expect([...ham.keys()].filter((t) => t !== "vaoViec" && t !== "chay")).toEqual([...SAU_ACTION]);
  });

  it("`vaoViec` gọi auth() rồi assertPermission(đúng một key) — và chỉ ở đó", () => {
    const v = actions.slice(actions.indexOf("async function vaoViec"), actions.indexOf("function lamMoi"));
    expect(dem(actions, /assertPermission\(/g)).toBe(1);
    expect(dem(v, new RegExp(`assertPermission\\("${KEY_QUYEN}"\\)`, "g"))).toBe(1);
    expect(v.indexOf("await auth()")).toBeGreaterThan(-1);
    expect(v.indexOf("await auth()")).toBeLessThan(v.indexOf("assertPermission("));
    expect(v.indexOf("assertPermission(")).toBeLessThan(v.indexOf("resolveActor("));
  });

  it("mỗi action: `await vaoViec()` TRƯỚC `safeParse` TRƯỚC lời gọi điều phối", () => {
    for (const [i, ten] of SAU_ACTION.entries()) {
      const than = ham.get(ten)!;
      const a = than.indexOf("await vaoViec()");
      const b = than.indexOf(".safeParse(");
      const c = than.indexOf(`${DIEU_PHOI[i]}(`);
      expect(a, `${ten}: thiếu vaoViec`).toBeGreaterThan(-1);
      expect(a, `${ten}: quyền phải đứng đầu`).toBeLessThan(b);
      expect(b, `${ten}: xác thực đầu vào trước điều phối`).toBeLessThan(c);
      expect(than.includes('if ("ok" in v) return v;'), `${ten}: không trả lỗi quyền`).toBe(true);
    }
  });
});

describe("[NHH-KY-W2] quyền của NÚT = quyền của ACTION (luật 12)", () => {
  it("page vẽ nút bằng scope.has(KEY) — đúng chuỗi mà `_actions.ts` kiểm", () => {
    expect(dem(page, new RegExp(`coQuyenQuanLy: scope\\.has\\("${KEY_QUYEN}"\\)`, "g"))).toBe(1);
    expect(dem(actions, new RegExp(`"${KEY_QUYEN}"`, "g"))).toBe(1);
  });
});

describe("[NHH-KY-W3] mọi action qua PHU_THUOC_THAT; đồng hồ ở ranh giới", () => {
  it("bảy lời gọi, mỗi lời gọi truyền PHU_THUOC_THAT + nguoi: v.nguoi + now: new Date()", () => {
    for (const t of DIEU_PHOI) {
      expect(dem(actions, new RegExp(`${t}\\(PHU_THUOC_THAT, \\{ nguoi: v\\.nguoi, now: new Date\\(\\),`, "g")), t).toBe(1);
    }
  });
  it("hàm lõi KHÔNG đọc đồng hồ thật (luật 19) — `now` là tham số bắt buộc", () => {
    expect(dem(dieuPhoi, /new Date\(/g)).toBe(0);
    expect(dem(kyDoc, /new Date\(/g)).toBe(0);
  });
});

describe("[NHH-KY-W4] điều phối: cổng TRƯỚC phép ghi", () => {
  const ham = cacHam(dieuPhoi);
  const truoc = (than: string, a: string, b: string) => {
    expect(than.indexOf(a), `thiếu ${a}`).toBeGreaterThan(-1);
    expect(than.indexOf(b), `thiếu ${b}`).toBeGreaterThan(-1);
    expect(than.indexOf(a), `${a} phải đứng trước ${b}`).toBeLessThan(than.indexOf(b));
  };

  it("Tính: phạm vi cơ sở TRƯỚC khi mở kỳ (bamKy là phép ghi), mở kỳ TRƯỚC tinhKy", () => {
    const t = ham.get("tinhKyHanhDong")!;
    truoc(t, "passesScope(", "bamKy(");
    truoc(t, "bamKy(", "tinhKy(");
    truoc(t, "pt.dungBoiCanh(", "passesScope(");
  });

  it("Khoá: phạm vi TRƯỚC khi đọc số, so bản chụp TRƯỚC khoá, và chỉ MỘT lần khoá", () => {
    const k = ham.get("khoaHanhDong")!;
    truoc(k, "pt.engineBat()", "batPhamViKy(");
    truoc(k, "batPhamViKy(", "chupSoLieuKy(");
    truoc(k, "soLieuKhop(", "khoaKyHoaHong(");
    expect(dem(k, /khoaKyHoaHong\(/g)).toBe(1);
  });

  it("Xuất · Đánh dấu đã chi: cờ engine, rồi cờ xuất, rồi mới đến dịch vụ", () => {
    truoc(ham.get("xuatHanhDong")!, "pt.engineBat()", "pt.xuatLuongBat()");
    truoc(ham.get("xuatHanhDong")!, "pt.xuatLuongBat()", "xuatBangChi(");
    truoc(ham.get("danhDauDaChiHanhDong")!, "pt.engineBat()", "pt.xuatLuongBat()");
    truoc(ham.get("danhDauDaChiHanhDong")!, "pt.xuatLuongBat()", "danhDauDaChi(");
  });

  it("Chuyển rà soát · Trả lại: cờ engine TRƯỚC dịch vụ", () => {
    truoc(ham.get("chuyenRaSoatHanhDong")!, "pt.engineBat()", "chuyenRaSoat(");
    truoc(ham.get("traLaiHanhDong")!, "pt.engineBat()", "traLaiKy(");
  });

  it("lỗi lạ KHÔNG lộ chi tiết ra client: nhánh catch chỉ log tên lỗi", () => {
    const bao = dieuPhoi.slice(dieuPhoi.indexOf("async function bao"), dieuPhoi.indexOf("const ENGINE_TAT"));
    expect(bao).toMatch(/console\.error\("\[hoa-hong\/ky\] thao tác lỗi", e instanceof Error \? e\.name : "\?"/);
    // `e.message` chỉ được phép trong nhánh HoaHongError (câu tiếng Việt do mình viết); nhánh lỗi lạ trả câu cố định.
    const nhanhLa = bao.slice(bao.indexOf("console.error"));
    expect(nhanhLa).not.toMatch(/\.message/);
    expect(nhanhLa).toMatch(/thatBai\("LOI_LA", "Có lỗi khi thực hiện/);
  });
});

describe("[NHH-KY-W5] thành phần client", () => {
  it("không tự xét vòng đời, không chạm DB / Prisma", () => {
    expect(dem(hanhDong, /kiemChuyenTrangThaiKy|hanhDongCuaKy|@\/lib\/db|@prisma/g)).toBe(0);
  });

  it("chỉ gọi sáu action của hàng nút vòng đời; hộp thoại khoá gửi CHÍNH bản chụp số liệu đã hiện (`daThay: d.soLieu`)", () => {
    const imp = hanhDong.match(/import \{([^}]+)\} from "\.\.\/_actions"/)?.[1]?.split(",").map((x) => x.trim()).sort();
    expect(imp).toEqual([...ACTION_CUA_HANG_NUT].sort());
    expect(dem(hanhDong, /khoaKyAction\(\{ periodId: d\.kyId!, lyDo, daThay: d\.soLieu \}\)/g)).toBe(1);
  });

  it("mọi <button> trong tệp là type=\"button\" (không nút nào vô tình submit form)", () => {
    expect(dem(hanhDong, /<button\b/g)).toBeGreaterThan(8);
    expect(dem(hanhDong, /type="button"/g)).toBe(dem(hanhDong, /<button\b/g));
  });
});

describe("[NHH-KY-W6] đọc kỳ qua scopedDb", () => {
  it("`docDanhSachKy` và `docManHinhKy` đọc kỳ/hàng chờ ĐẾM qua sdb; `db.commissionPeriod.` chỉ còn đúng MỘT lần (đọc theo id trong chupSoLieuKy)", () => {
    expect(dem(kyDoc, /scopedDb\(actor\)/g)).toBe(3);
    expect(dem(kyDoc, /\bdb\.commissionPeriod\./g)).toBe(1);
    expect(dem(kyDoc, /\bsdb\.commissionPeriod\./g)).toBe(5);
    expect(kyDoc.slice(kyDoc.indexOf("async function chupSoLieuKy"), kyDoc.indexOf("// ── Danh sách kỳ"))).toMatch(/db\.commissionPeriod\.findUnique/);
  });
});

describe("[NHH-KY-W7] tinhKy chặn kỳ sai trạng thái TRƯỚC lượt quét", () => {
  it("cổng OPEN/CALCULATED đứng trước `quetKy(` trong thân tinhKy", () => {
    const than = cacHam(kyService).get("tinhKy")!;
    expect(than).toContain('k0.status !== "OPEN" && k0.status !== "CALCULATED"');
    expect(than.indexOf('k0.status !== "OPEN"')).toBeLessThan(than.indexOf("await quetKy("));
  });
});

describe("[NHH-KY-W8] page", () => {
  it("MỘT lời gọi hanhDongCuaKy; chip cơ sở từ tầm nhìn scope của CommissionPeriod; trần từ setting; không hỏi can()/checkPermission", () => {
    expect(dem(page, /hanhDongCuaKy\(/g)).toBe(1);
    expect(dem(page, /scope\.coSoCua\("CommissionPeriod"\)/g)).toBe(1);
    expect(dem(page, /getSetting\("crm\.commissionMaxTotalRate"\)/g)).toBe(1);
    // Quyền của NÚT thao tác đến từ `scope.has(...)`, không từ can()/checkPermission. Ngoại lệ DUY NHẤT: `checkPermission("payments:manage")` cho liên kết sổ cũ (W4, ca [NHH-KY-W13]).
    expect(dem(page, /\bcan\(|checkAnyPermission\(/g)).toBe(0);
    expect(dem(page, /\bcheckPermission\(/g)).toBe(1);
    expect(dem(page, /vaoTab\("ky"\)/g)).toBe(1);
  });
  it("trang không import @/lib/db trần (cổng DB đã đóng)", () => {
    expect(dem(page, /from "@\/lib\/db"/g)).toBe(0);
  });
});

describe("[NHH-KY-W9] số blocker trên màn = số blocker của CỔNG khoá (MỘT định nghĩa)", () => {
  it("điều kiện hàng chờ chặn (`blockingPeriodId: { in: … }`) có đúng MỘT chỗ trong ky-service và KHÔNG chỗ nào trong ky-doc", () => {
    expect(dem(kyService, /blockingPeriodId: \{ in:/g)).toBe(1);
    expect(dem(kyDoc, /blockingPeriodId/g)).toBe(0);
  });

  it("ky-doc không tự đếm hàng chờ nào: chặn khoá = `demHangChoChanTheoMa(db, …)` (bảng kỳ + pill tab); «chưa phân giải người hưởng» = `docHangChoSo` (nguồn chung với tab Sổ)", () => {
    expect(dem(kyDoc, /demHangChoChanTheoMa\(db,/g)).toBe(2);
    expect(dem(kyDoc, /\bcommissionHold\./g)).toBe(0);
    expect(dem(kyDoc, /docHangChoSo\(db, actor, \{ nhom: "CHUA_PHAN_GIAI_NGUOI_HUONG"/g)).toBe(1);
  });

  it("cổng khoá: `chuyen` hỏi `demHangChoChan(tx, …)` — chỉ khi đích là LOCKED — và `demHangChoChan` đi qua `demHangChoChanTheoMa`", () => {
    expect(dem(kyService, /i\.den === "LOCKED" \? await demHangChoChan\(tx, i\.periodId\)/g)).toBe(1);
    const tu = kyService.indexOf("export async function demHangChoChan(");
    expect(tu).toBeGreaterThan(-1);
    expect(kyService.slice(tu, tu + 300)).toMatch(/demHangChoChanTheoMa\(client, \[periodId\]\)/);
  });

  it("hộp thoại khoá và quyết định nút cùng đọc `man.soLieu.soChan` (page truyền vào hai chỗ, không số khác)", () => {
    expect(dem(page, /man\?*\.soLieu\.soChan/g)).toBe(2);
  });
});


describe("[NHH-KY-W10] link từ tab Kỳ sang hàng chờ tab Sổ nói ĐÚNG tiếng của tab Sổ (ghép Stage 3)", () => {
  it("link lọc bằng `nhom` (LOẠI hàng chờ của tab Sổ) qua `loaiChungCuaCacMa` — KHÔNG còn `van-de` (tham số của tab Nguồn, tab Sổ bỏ qua nó) và không bỏ mã trần vào URL", () => {
    expect(dem(page, /hrefVoi\(TAB_HREF\.so, \{ coSo: coSoId, nhom: p\.loai \?\? null, ky: p\.ky \?\? null \}\)/g)).toBe(1);
    // link của hàng chờ CHẶN mang kỳ đang chọn (tab Sổ lọc đúng tập mà số "Chặn" ở đây đếm); link của vai TREO thì KHÔNG (nó không chặn kỳ nào — lọc theo kỳ sẽ ra 0)
    expect(dem(page, /hrefSoChung\(\{ loai: loaiChungCuaCacMa\(m\.ma\), ky: thang \}\)/g)).toBe(1);
    expect(dem(page, /hrefSoChung\(\{ loai: "CHUA_PHAN_GIAI_NGUOI_HUONG" \}\)/g)).toBe(1);
    expect(dem(page, /hrefSoChung\(\{ loai: "CHUA_PHAN_GIAI_NGUOI_HUONG" \}\)/g)).toBe(1); // không ky
    expect(dem(page, /ky: thang \}\)/g)).toBe(2); // chặn (mục chặn) + gợi ý dời — đúng hai chỗ
    expect(page).not.toMatch(/"van-de"/);
    expect(page).not.toMatch(/van: /);
  });
});

describe("[NHH-KY-W11] người khoá: một lượt tra cho cả trang, đúng cột, đúng nơi hiển thị", () => {
  const danhSach = kyDoc.slice(kyDoc.indexOf("export async function docDanhSachKy"), kyDoc.indexOf("// ── Kỳ đang chọn"));
  const bangKy = doc(`${KY}/_components/bang-ky.tsx`);

  it("docDanhSachKy: select `lockedById`, đúng MỘT `user.findMany` (gộp id, ngoài vòng lặp) và KHÔNG `user.findUnique`/`findFirst`; chỉ lấy `name` (không email)", () => {
    expect(dem(danhSach, /lockedById: true/g)).toBe(1);
    expect(dem(danhSach, /\.user\.findMany\(/g)).toBe(1);
    expect(dem(danhSach, /\.user\.find(?:Unique|First)\w*\(/g)).toBe(0);
    expect(dem(danhSach, /select: \{ id: true, name: true \}/g)).toBe(1);
    expect(dem(danhSach, /\bemail\b/g)).toBe(0);
    // gộp id TRƯỚC khi tra: `new Set(` đứng trước `findMany`, và lời gọi không nằm trong `.map(async` nào
    expect(danhSach.indexOf("new Set(")).toBeLessThan(danhSach.indexOf(".user.findMany("));
    expect(dem(danhSach, /\.map\(async/g)).toBe(0);
  });

  it("màn: người khoá vào ô 'Đã khoá' (KHÔNG có cột thứ 11): đúng 10 <th>, và tên đi qua `r.khoaBoi` ở cả bảng lẫn thẻ", () => {
    expect(dem(bangKy, /<th scope="col"/g)).toBe(10);
    expect(dem(bangKy, /<NguoiKhoa ten=\{r\.khoaBoi\} \/>/g)).toBe(2);
  });
});

describe("[NHH-KY-W12] \"Dời sang kỳ sau\": MỘT điều kiện, MỘT key quyền, cổng đứng TRƯỚC phép ghi (luật 12)", () => {
  const SO = "app/(admin)/admin/nguon-hoa-hong/so";
  const soPage = doc(`${SO}/page.tsx`);
  const bangHangCho = doc(`${SO}/_components/hang-cho-so-bang.tsx`);
  const nut = doc(`${SO}/_components/nut-doi-ky-sau.tsx`);
  const hangChoDoc = doc("lib/hoa-hong/hang-cho-so-doc.ts");
  const nhom = doc("lib/hoa-hong/hang-cho-so-nhom.ts");
  const doiHang = cacHam(dieuPhoi).get("doiHangChoSangKyHanhDong")!;

  it("điều phối: engine/mốc → hàng chờ có thật → phạm vi → `lyDoKhongDoiDuoc` → service; mỗi cổng MỘT lần và TRƯỚC `doiHangChoSangKySau(` (service gọi bamKy = phép ghi)", () => {
    expect(doiHang, "thiếu hàm điều phối").toBeTruthy();
    const vt = (re: string) => doiHang.indexOf(re);
    for (const mau of ["pt.dungBoiCanh(", "commissionHold.findUnique(", "batPhamViKy(", "lyDoKhongDoiDuoc(", "doiHangChoSangKySau("]) {
      expect(vt(mau), `thiếu ${mau}`).toBeGreaterThan(-1);
      expect(dem(doiHang, new RegExp(mau.split("").map((c) => (("().").includes(c) ? "\\" + c : c)).join(""), "g")), mau).toBe(1);
    }
    expect(vt("pt.dungBoiCanh(")).toBeLessThan(vt("commissionHold.findUnique("));
    expect(vt("commissionHold.findUnique(")).toBeLessThan(vt("batPhamViKy("));
    expect(vt("batPhamViKy(")).toBeLessThan(vt("lyDoKhongDoiDuoc("));
    expect(vt("lyDoKhongDoiDuoc(")).toBeLessThan(vt("doiHangChoSangKySau("));
    expect(dem(doiHang, /return thatBai\(tu\.ma, tu\.loi\)/g)).toBe(1);
  });

  it("quyền của NÚT = quyền của ACTION: tab Sổ vẽ nút bằng `scope.has(\"commission_periods:manage\")` (đúng một chỗ) và truyền xuống làm `coTheDoiKy`; action kiểm cùng key", () => {
    expect(dem(soPage, new RegExp(`const KEY_QUAN_LY_KY = "${KEY_QUYEN}"`, "g"))).toBe(1);
    expect(dem(soPage, /scope\.has\(KEY_QUAN_LY_KY\)/g)).toBe(1);
    expect(dem(soPage, /coTheDoiKy=\{scope\.has\(KEY_QUAN_LY_KY\)\}/g)).toBe(1);
    expect(dem(actions, new RegExp(`"${KEY_QUYEN}"`, "g"))).toBe(1);
  });

  it("tab Kỳ chỉ GỢI Ý dời khi người xem có cả quyền quản lý kỳ lẫn quyền thấy hàng chờ tab Sổ (nơi có nút), số khoản lấy từ chính tập mã dời được, và truyền xuống ViecDangDo", () => {
    expect(dem(page, /scope\.has\("commission_periods:manage"\) && scope\.has\("commission:view-center"\)/g)).toBe(1);
    expect(dem(page, /MA_DOI_DUOC_SANG_KY_SAU\.reduce\(/g)).toBe(1);
    expect(dem(page, /doiDuoc: hrefDoi \? \{ so: soDoiDuoc, href: hrefDoi \} : null/g)).toBe(1);
  });

  it("dòng bảng: nút chỉ khi `coTheDoiKy && d.doiDuoc`; KHÔNG tự xét mã hàng chờ ở component; nút chỉ gọi đúng MỘT action của tab Kỳ", () => {
    expect(dem(bangHangCho, /coTheDoiKy && d\.doiDuoc/g)).toBe(1);
    expect(dem(bangHangCho, /PENDING_REGULATION|MANUAL_REVIEW_REQUIRED|MA_DOI_DUOC_SANG_KY_SAU|lyDoKhongDoiDuoc|laDoiDuocSangKySau/g)).toBe(0);
    expect(dem(nut, /from "\.\.\/\.\.\/ky\/_actions"/g)).toBe(1);
    expect(nut.match(/import \{([^}]+)\} from "\.\.\/\.\.\/ky\/_actions"/)?.[1]?.trim()).toBe("doiHangChoSangKySauAction");
    expect(dem(nut, /@\/lib\/db|@prisma/g)).toBe(0);
    expect(dem(nut, /<button\b/g)).toBeGreaterThan(1);
    expect(dem(nut, /type="button"/g)).toBe(dem(nut, /<button\b/g));
  });

  it("cờ `doiDuoc` của dòng đọc ra từ `laDoiDuocSangKySau` (một nguồn với server), và `coTheDoiKy` là prop BẮT BUỘC (không `?`, không mặc định) — luật 11", () => {
    expect(dem(hangChoDoc, /doiDuoc: laDoiDuocSangKySau\(\{ code: ma, status: r\.status, blockingPeriodId: r\.blockingPeriodId \}\)/g)).toBe(1);
    expect(dem(bangHangCho, /coTheDoiKy: boolean;/g)).toBe(2); // ViecTiep + HangChoSoBang — cả hai bắt buộc
    expect(dem(bangHangCho, /coTheDoiKy\?|coTheDoiKy = /g)).toBe(0);
    expect(dem(nhom, /export function lyDoKhongDoiDuoc\(/g)).toBe(1);
  });
});

describe("[NHH-KY-W13] liên kết sang sổ cũ chỉ vẽ khi người xem MỞ ĐƯỢC /crm/commission (W4, luật 12)", () => {
  // `/crm/commission` gác `payments:manage` và đá về dashboard (đo ở app/(admin)/admin/crm/commission/page.tsx): vai vào tab Kỳ qua `commission:view-center` (HR, QLCS, Giám đốc)
  // không có khoá này, nên một liên kết vô điều kiện là lời hứa suông. Tab Sổ làm đúng ở `dai-so-cu.tsx` — tab Kỳ nay dùng đúng khoá ấy.
  it("page hỏi `checkPermission(\"payments:manage\")` đúng 1 lần (biến coTheMoSoCu, trong Promise.all) và KHÔNG khoá nào khác cho sổ cũ", () => {
    expect(dem(page, /\bcheckPermission\(\s*"payments:manage"\s*\)/g)).toBe(1);
    expect(dem(page, /\bconst \[[^\]]*\bcoTheMoSoCu\b[^\]]*\]\s*=\s*await Promise\.all\(/g)).toBe(1);
  });

  it("MỌI <Link href=\"/crm/commission\"> đứng ngay sau điều kiện coTheMoSoCu (đếm: có 2 liên kết, 2 điều kiện)", () => {
    const re = /<Link href="\/crm\/commission"/g;
    const cac = [...page.matchAll(re)];
    expect(cac.length).toBe(2);
    for (const m of cac) {
      const truoc = page.slice(Math.max(0, m.index! - 160), m.index!);
      expect(truoc, "liên kết sổ cũ không có cổng coTheMoSoCu ngay trước").toMatch(/\bcoTheMoSoCu\b/);
    }
  });
});
