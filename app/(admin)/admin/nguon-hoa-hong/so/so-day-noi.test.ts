// @vitest-environment node
/**
 * [NHH-SO-W*] — LƯỚI GHIM DÂY NỐI của tab Sổ hoa hồng (đọc MÃ NGUỒN).
 *
 * Dùng cho những luật mà test hành vi KHÔNG chứng minh được vì chúng là "chỗ này phải gọi chỗ kia": nút vẽ theo đúng khoá mà action kiểm (luật 12), MỘT hàm đọc
 * sổ (luật 12b), truy vấn mới nằm TRONG lô song song, trang không đọc DB trần.
 *
 * Quy tắc viết (CLAUDE.md luật 11, mẫu "LƯỚI GHIM MÃ NGUỒN"): so trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá luôn chứa đúng chuỗi đang cấm); neo chuỗi hẹp;
 * ĐẾM số lần khớp; không cờ `/s`. Mỗi lưới đã được cấy lỗi và thấy đỏ (xem nhật ký ở docs/source-commission/05).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const goc = (p: string): string => resolve(process.cwd(), p);
/**
 * Mã THẬT: bỏ dòng chú thích TRƯỚC, rồi mới bỏ khối chú thích. Thứ tự này không tuỳ ý: một dòng `//` có thể chứa `next/*` hay `app/**` (chuỗi mở khối giả) — bỏ khối
 * trước thì nó nuốt CẢ import lẫn mã cho tới dấu đóng khối kế tiếp, và mọi khẳng định "không có X" trên tệp đó xanh vì X đã bị nuốt (đo thật: cấy `Record<MaHold`
 * vào `hang-cho-so.ts` mà `[NHH-SO-W11b]` vẫn xanh).
 */
function ma(p: string): string {
  return readFileSync(goc(p), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const dem = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;

function cacTep(thuMuc: string, duoi: RegExp): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(goc(thuMuc))) {
    const p = join(thuMuc, ten);
    if (statSync(goc(p)).isDirectory()) ra.push(...cacTep(p, duoi));
    else if (duoi.test(ten) && !/\.test\.tsx?$/.test(ten)) ra.push(p);
  }
  return ra;
}

const SO = "app/(admin)/admin/nguon-hoa-hong/so";
const ACTION = `${SO}/_actions.ts`;
const PAGE = `${SO}/page.tsx`;

describe("[NHH-SO-W1] Server Action 'Vì sao': gác ĐẦU HÀM bằng đúng hai khoá mà tab Sổ dùng để vẽ nút (luật 12)", () => {
  const a = ma(ACTION);

  it("[NHH-SO-W1] auth() → zod → checkAnyPermission([view-self, view-center]) → cờ engine → resolveActor, đúng thứ tự, mỗi thứ một lần", () => {
    const vi = (re: RegExp) => a.search(re);
    const auth = vi(/await auth\(\)/);
    const quyen = vi(/checkAnyPermission\(\["commission:view-self", "commission:view-center"\]\)/);
    const co = vi(/laEngineHoaHongBat\(\)/);
    const actor = vi(/resolveActor\(/);
    const doc = vi(/docViSaoDayDu\(/);
    expect([auth, quyen, co, actor, doc].every((i) => i >= 0)).toBe(true);
    expect(auth).toBeLessThan(quyen);
    expect(quyen).toBeLessThan(co);
    expect(co).toBeLessThan(actor);
    expect(actor).toBeLessThan(doc);
    expect(dem(a, /checkAnyPermission\(/g)).toBe(1);
    expect(dem(a, /docViSaoDayDu\(/g)).toBe(1);
  });

  it("[NHH-SO-W1b] tập khoá của action = tập khoá của cổng trang (PAGE_GATES) — vẽ nút bằng quyền A rồi để action hỏi quyền B là lời hứa suông", () => {
    const gates = readFileSync(goc("lib/auth/page-gates.ts"), "utf8");
    const khoi = gates.match(/"\/nguon-hoa-hong\/so":\s*\[([^\]]*)\]/)?.[1] ?? "";
    const trongGate = [...khoi.matchAll(/"([a-z_]+:[a-z-]+)"/g)].map((m) => m[1]).sort();
    const trongAction = [...a.matchAll(/checkAnyPermission\(\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/"([a-z_]+:[a-z-]+)"/g)].map((x) => x[1]!)).sort();
    expect(trongGate.length).toBeGreaterThan(0);
    expect(trongAction).toEqual(trongGate);
  });

  it("[NHH-SO-W1c] action CHỈ ĐỌC và không chạm DB trần", () => {
    expect(a).not.toMatch(/from "@\/lib\/db"/);
    expect(a).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/);
    expect(a).not.toMatch(/revalidatePath|writeAudit/);
  });
});

describe("[NHH-SO-W2] trang Sổ: một cổng, một hàm đọc, không DB trần", () => {
  const p = ma(PAGE);

  it("[NHH-SO-W2] cổng quyền bằng PAGE_GATES literal NGAY TRONG page, đứng SAU vaoTab (cờ → 404 trước câu hỏi quyền)", () => {
    const vao = p.search(/vaoTab\("so"\)/);
    const gate = p.search(/PAGE_GATES\["\/nguon-hoa-hong\/so"\]/);
    expect(vao).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(vao);
    expect(dem(p, /vaoTab\(/g)).toBe(1);
  });

  it("[NHH-SO-W2b] cổng của TRANG và cổng của HÀM ĐỌC lệch nhau (cờ RBAC v2 tắt, vai cũ chưa có UserOrgRole) ⇒ màn 'không có quyền', KHÔNG phải 'máy chủ báo lỗi'; mọi lỗi khác ném tiếp", () => {
    expect(dem(p, /e instanceof PermissionError\) return <ThieuQuyen/g)).toBe(1);
    expect(dem(p, /throw e;/g)).toBe(1); // lỗi không phải quyền (kể cả NEXT_REDIRECT của `redirect`) KHÔNG bị nuốt
    expect(dem(p, /return await veSo\(/g)).toBe(1); // `await` TRONG try: bỏ `await` thì catch không bao giờ bắt được lỗi bất đồng bộ
  });

  it("[NHH-SO-W3] KHÔNG ai ngoài lib/hoa-hong đọc bảng sổ/hàng chờ: trang và component không có `.commissionTransaction.` / `.commissionHold.` và không import `@/lib/db`", () => {
    const tep = [...cacTep("app/(admin)/admin/nguon-hoa-hong/so", /\.tsx?$/), ...cacTep("components/admin/nguon-hoa-hong", /\.tsx?$/)];
    expect(tep.length).toBeGreaterThan(10);
    for (const t of tep) {
      const m = ma(t);
      expect(m, t).not.toMatch(/\.commission(Transaction|Hold|Period|CalcSlot)\./);
      expect(m, t).not.toMatch(/from "@\/lib\/db"/);
    }
  });

  it("[NHH-SO-W4] sổ 'Tất cả' đi qua `docTrangSo` (bọc `docSoHoaHong`), hàng chờ qua `docHangChoSo`/`demHangChoSo`: mỗi hàm đúng một chỗ gọi cho mỗi chế độ", () => {
    expect(dem(p, /docTrangSo\(/g)).toBe(1);
    expect(dem(p, /docHangChoSoCuaToi\(/g)).toBe(1);
    expect(dem(p, /demHangChoSo\(/g)).toBe(1); // chỉ chế độ sổ (đếm không đọc dòng, cho số trên công tắc); chế độ hàng chờ lấy số từ CHÍNH kết quả `docHangChoSoCuaToi` — một lần đọc, không đếm hai lần
    expect(dem(p, /docLuaChonBoLocSo\(/g)).toBe(1);
  });

  it("[NHH-SO-W5] hàng chờ CHỈ cho người có `commission:view-center`: cờ coHangCho đọc đúng khoá; chế độ mặc định rơi về sổ khi thiếu", () => {
    expect(p).toMatch(/const coHangCho = scope\.has\("commission:view-center"\)/);
    expect(p).toMatch(/coHangCho && motGiaTri\(sp\.xem\) !== "tat-ca" \? "can-xu-ly" : "tat-ca"/);
    // chip cơ sở và ô lọc người hưởng cũng chỉ khi có view-center
    expect(p).toMatch(/coSo=\{coHangCho \? scope\.coSoCua\("CommissionTransaction"\) : undefined\}/);
    expect(p).toMatch(/nguoi: coHangCho \?/);
  });

  it("[NHH-SO-W6] mỗi link của hàng chờ gắn với ĐÚNG cổng của trang đích (orders:view · leads:view-all|own · commission_policies:view · commission-assignee:manage)", () => {
    expect(p).toMatch(/checkPermission\("orders:view"\)/);
    expect(p).toMatch(/checkAnyPermission\(\["leads:view-all", "leads:view-own"\]\)/);
    expect(p).toMatch(/checkPermission\("commission-assignee:manage"\)/);
    expect(p).toMatch(/chinhSach: scope\.has\("commission_policies:view"\)/);
    // và các cổng ấy là cổng THẬT của trang đích (trang người phụ trách tự gác bằng đúng khoá đó rồi đá về dashboard)
    expect(ma("app/(admin)/admin/crm/commission/nguoi-huong/page.tsx")).toMatch(/checkPermission\("commission-assignee:manage"\)/);
    expect(ma("app/(admin)/admin/orders/[id]/page.tsx")).toMatch(/checkPermission\("orders:view"\)/);
  });

  it("[NHH-SO-W7] trang mở lại: `?trang=` vượt biên kẹp về trang cuối ở CẢ hai chế độ; bộ lọc người dùng gõ phải qua regex hình dạng", () => {
    expect(dem(p, /kepTrang\(/g)).toBe(2);
    expect(dem(p, /redirect\(/g)).toBe(2);
    expect(p).toMatch(/KY_HOP_LE = \/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\//);
    expect(dem(p, /mot\(sp\./g)).toBe(6); // thang · vai · nguoi · nguon · loai · tt và `ky` — thêm bộ lọc mới ⇒ qua regex hình dạng, rồi tăng số này có chủ đích
  });

  it("[NHH-SO-W7b] dòng đếm 'N việc chặn khoá kỳ · M không chặn' CHỈ khi KHÔNG lọc nhóm (đặt trên một nhóm đã lọc, nhất là nhóm rỗng, nó đọc như đang nói về nhóm đó)", () => {
    expect(dem(p, /ds\.canXuLy > 0 && !nhom && !ky && \(/g)).toBe(1); // lọc theo kỳ cũng bỏ dòng này: phần "không chặn khoá" luôn 0, đếm cả phạm vi sẽ lệch danh sách
  });

  it("[NHH-SO-W7c] `?ky=`: đọc qua KY_HOP_LE (chỉ khi người xem có hàng chờ), đi vào hàm đọc, sống sót qua phân trang / đổi nhóm / đổi cơ sở / redirect, và BỊ BỎ khi đổi chế độ xem hoặc bấm 'Bỏ lọc kỳ'", () => {
    expect(dem(p, /const ky = coHangCho \? mot\(sp\.ky, KY_HOP_LE\) : null;/g)).toBe(1);
    expect(dem(p, /\.\.\.\(ky \? \{ ky \} : \{\}\), trang, coTrang: KICH_THUOC_HANG_CHO_SO/g)).toBe(1); // vào docHangChoSoCuaToi ⇒ cùng điều kiện cho danh sách và các con số
    expect(dem(p, /hrefVoi\(BASE, \{ coSo: coSoId, nhom, ky, trang: t \}\)/g)).toBe(1); // phân trang
    expect(dem(p, /hrefVoi\(BASE, \{ coSo: coSoId, nhom, ky, trang: trangHopLe \}\)/g)).toBe(1); // redirect khi trang vượt biên
    expect(dem(p, /<ChipNhomHangCho basePath=\{BASE\} giu=\{\{ coSo: coSoId, ky \}\}/g)).toBe(1); // đổi nhóm giữ kỳ
    expect(dem(p, /giu=\{xem === "tat-ca" \? \{ xem: "tat-ca", \.\.\.giuLoc \} : \{ nhom, ky \}\}/g)).toBe(1); // đổi cơ sở giữ kỳ
    expect(dem(p, /<QueueToggle basePath=\{BASE\} dangXem="can-xu-ly" soCanXuLy=\{ds\.canXuLy\} giu=\{\{ coSo: coSoId \}\} \/>/g)).toBe(1); // đổi chế độ xem là BỎ lọc kỳ
    expect(dem(p, /hrefBo=\{hrefVoi\(BASE, \{ coSo: coSoId, nhom \}\)\}/g)).toBe(1); // 'Bỏ lọc kỳ' giữ cơ sở + nhóm, bỏ kỳ
  });
});

describe("[NHH-SO-W8] đọc ngăn 'Vì sao' và hàng chờ: dùng ĐÚNG cổng phạm vi", () => {
  const vs = ma("lib/hoa-hong/vi-sao-doc.ts");
  const hc = ma("lib/hoa-hong/hang-cho-so-doc.ts");
  const ds = ma("lib/hoa-hong/doc-so.ts");

  it("[NHH-SO-W8] vi-sao-doc: phạm vi lấy từ `phamViNguoiXem` và gắn vào CẢ dòng chính LẪN dòng liên quan; tổng tỉ lệ qua `duocXemTongTiLe`; nhật ký chỉ khi xemCoSo", () => {
    expect(dem(vs, /phamViNguoiXem\(actor\)/g)).toBe(1);
    expect(dem(vs, /\.\.\.dieuKien/g)).toBe(2); // dòng chính + dòng liên quan
    expect(vs).toMatch(/AND: \[\{ id: entryId \}, \.\.\.dieuKien\]/);
    expect(vs).toMatch(/hienTongTiLe: duocXemTongTiLe\(tamCoSo, d\.centerId\)/);
    expect(vs).toMatch(/xemCoSo && d\.calcSlotId/);
    // KHÔNG lấy giá trị cũ/mới của nhật ký (có thể chứa tiền của người khác)
    expect(vs).not.toMatch(/oldValues|newValues/);
  });

  it("[NHH-SO-W8c] ngăn 'Vì sao' nạp bảng TÊN nhóm nguồn từ danh mục (cùng lô Promise.all) và đưa vào `dungViSaoDayDu` — thiếu thì câu giải thích chính sách in MÃ nhóm", () => {
    expect(dem(vs, /leadSourceGroup\.findMany\(/g)).toBe(1);
    expect(dem(vs, /tenNhomTheoMa: Object\.fromEntries\(nhomNguon\.map\(/g)).toBe(1);
    expect(vs).toMatch(/const \[khoan, hocVien, lienQuan, nhatKy, nhomNguon\] = await Promise\.all\(\[/);
  });

  it("[NHH-SO-W9] docViSao (bản cũ) và docViSaoDayDu dùng CÙNG `duocXemTongTiLe` — không ai viết lại điều kiện", () => {
    expect(dem(ds, /duocXemTongTiLe\(/g)).toBe(2); // định nghĩa + docViSao
    expect(dem(ds, /tamCoSo\.includes\(/g)).toBe(1); // chỉ trong định nghĩa
  });

  it("[NHH-SO-W10] hàng chờ: thiếu `commission:view-center` ⇒ ném; cả đếm lẫn đọc gọi `batQuyen` ĐẦU HÀM; MỘT cổng tầm nhìn cơ sở và MỘT chỗ đếm cho mọi người gọi", () => {
    expect(dem(hc, /batQuyen\(actor\)/g)).toBe(2);
    expect(dem(hc, /can\(actor, KEY_XEM_CO_SO\)/g)).toBe(1); // khoá lấy từ doc-so (một khoá với sổ)…
    expect(hc).not.toMatch(/const KEY_XEM_CO_SO/); // …không khai lại một bản thứ hai
    expect(dem(hc, /getModelVisibleCenterIds\(/g)).toBe(1); // phamViChung: cả đếm lẫn đọc đi qua
    expect(dem(hc, /commissionHold\.groupBy\(/g)).toBe(1); // demTheoMa — pill, công tắc, chip và tab Kỳ cùng đi qua
    expect(hc).not.toMatch(/\bdb\.commissionHold\./); // `db` chỉ được truyền làm `client`, không đọc bảng trực tiếp
  });

  it("[NHH-SO-W11] số hàng chờ của pill tab chỉ tính cho người có view-center (Sale không thấy bảng công việc của người rà soát)", () => {
    const h = ma("lib/nguon-hoa-hong/hang-cho.ts");
    expect(h).toMatch(/scope\.tabMoDuoc\("so"\) && scope\.has\("commission:view-center"\) \? demHangChoSo\(actor, null\)/);
    expect(h).toMatch(/ra\.so = so\.canXuLy/);
  });
});

describe("[NHH-SO-W11b] MỘT định nghĩa hàng chờ sổ (hợp nhất với hfix)", () => {
  it("[NHH-SO-W11b] bảng nhóm/nhãn mã CHỈ ở hang-cho-so-nhom.ts; hang-cho-so.ts (trình bày) không khai bảng thứ hai; chỉ hang-cho-so-doc.ts đọc/đếm CommissionHold ở lib/hoa-hong", () => {
    const trinhBay = ma("lib/hoa-hong/hang-cho-so.ts");
    expect(trinhBay, "bộ bỏ chú thích không được nuốt mã (xem ghi chú ở `ma`)").toContain("export function hanhDongTiep(");
    // Bảng DUY NHẤT được phép ở đây: MÔ TẢ của mã (câu rơi về khi engine không ghi lý do) — khác nhãn pill. Nhóm/nhãn pill thì chỉ ở `hang-cho-so-nhom.ts`.
    expect(dem(trinhBay, /Record<MaHold/g)).toBe(1);
    expect(trinhBay).toMatch(/MO_TA_MA_HANG_CHO: Record<MaHold, string>/);
    expect(trinhBay).not.toMatch(/NHOM_CUA_MA|LOAI_CUA_MA|NHOM_VIEC|NHAN_NHOM|NHAN_LOAI/);
    // tab Sổ và tab Kỳ đếm hàng chờ ở MỘT nơi: ngoài hang-cho-so-doc.ts chỉ còn bộ đếm theo KỲ của cổng khoá (ky-service — định nghĩa riêng, đã ghi ở T3)
    const nguoiDem = cacTep("lib/hoa-hong", /\.ts$/)
      .filter((p) => /commissionHold\.(groupBy|count)\(/.test(ma(p)))
      .map((p) => p.replace(/\\/g, "/"))
      .sort();
    expect(nguoiDem).toEqual(["lib/hoa-hong/hang-cho-so-doc.ts", "lib/hoa-hong/ky-service.ts"]);
  });
});

describe("[NHH-SO-W12] khối 'Hoa hồng dự kiến của bạn' trên lead và đơn", () => {
  it("[NHH-SO-W12] lead: gác `commission:view-self` ∧ cờ engine, gọi bản an toàn đúng MỘT lần, nằm TRONG Promise.all (không `await` riêng)", () => {
    const l = ma("app/(admin)/admin/leads/[id]/page.tsx");
    expect(dem(l, /docDuKienChoManHienThi\(/g)).toBe(1);
    expect(l).not.toMatch(/await\s+docDuKienChoManHienThi\(/);
    expect(l).toMatch(/coQuyenXemHoaHong && engineBat \? docDuKienChoManHienThi\(actor, \{ leadId: lead\.id \}/);
    expect(l).toMatch(/checkPermission\("commission:view-self"\)/);
    const dau = l.indexOf("docDuKienChoManHienThi(");
    const lo = l.lastIndexOf("await Promise.all([", dau);
    expect(lo).toBeGreaterThan(-1);
    expect(l.slice(lo, dau)).not.toMatch(/\n\s*\]\);/);
    expect(dem(l, /<HoaHongDuKien /g)).toBe(1);
  });

  it("[NHH-SO-W13] đơn: cùng luật; cờ + quyền nằm trong lô QUYỀN, câu đọc nằm trong lô 'sau khi có đơn'; khối vẽ trong `khoiCuoi`", () => {
    const o = ma("app/(admin)/admin/orders/[id]/page.tsx");
    expect(o).toMatch(/coQuyenXemHoaHong && engineHoaHongBat \? docDuKienChoManHienThi\(actor, \{ orderId: order\.id \}/);
    expect(dem(o, /checkPermission\("commission:view-self"\)/g)).toBe(1);
    expect(dem(o, /laEngineHoaHongBat\(\)/g)).toBe(1);
    expect(dem(o, /<HoaHongDuKien /g)).toBe(1);
  });

  it("[NHH-SO-W14] cổng DB-an-toàn: `docDuKienChoManHienThi` bắt lỗi (LOI) — hỏng khối phụ không kéo sập trang lead/đơn; PermissionError ⇒ ẩn", () => {
    const d = ma("lib/hoa-hong/du-kien-man-hinh-doc.ts");
    expect(d).toMatch(/if \(e instanceof PermissionError\) return \{ loai: "AN" \}/);
    expect(d).toMatch(/return \{ loai: "LOI" \}/);
    expect(d).toMatch(/dungBoiCanhQuet\(db, now\)/); // cờ + mốc đi qua đúng một cửa
  });
});

describe("[NHH-SO-W19] thanh phạm vi", () => {
  it("[NHH-SO-W19] người chỉ xem phần của mình KHÔNG có ScopeBar (không có chip cơ sở để chọn — một khung chỉ mang con số trần là khung rỗng)", () => {
    expect(ma(PAGE)).toMatch(/const scopeBar = !coHangCho \? undefined : \(/);
  });
});

describe("[NHH-SO-W15] kỷ luật giao diện của các tệp mới (DESIGN.md §7, craft-floor)", () => {
  const tep = [
    ...cacTep(`${SO}/_components`, /\.tsx$/),
    "components/admin/nguon-hoa-hong/vi-sao-noi-dung.tsx",
    "components/admin/nguon-hoa-hong/vi-sao-sheet.tsx",
    "components/admin/nguon-hoa-hong/hoa-hong-du-kien.tsx",
    "components/admin/nguon-hoa-hong/commission-status-pill.tsx",
  ];

  it("[NHH-SO-W15] không hex rời, không gradient, không viền cạnh >1px, không framer/magic, không dangerouslySetInnerHTML", () => {
    expect(tep.length).toBeGreaterThanOrEqual(8);
    for (const t of tep) {
      const m = ma(t);
      expect(m, t).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/);
      expect(m, t).not.toMatch(/gradient/i);
      expect(m, t).not.toMatch(/border-[lr]-[2-9]|border-[lr]-\[/);
      expect(m, t).not.toMatch(/framer-motion|components\/(magic|motion)/);
      expect(m, t).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("[NHH-SO-W16] không `useEffect` để lấy dữ liệu: ngăn 'Vì sao' tải trong HÀM XỬ LÝ mở/đóng, không trong effect", () => {
    expect(ma("components/admin/nguon-hoa-hong/vi-sao-sheet.tsx")).not.toMatch(/useEffect/);
  });

  it("[NHH-SO-W17] bảng sổ: mọi ô dữ liệu và tiêu đề mang `whitespace-nowrap` qua adminTd/adminTh; vùng bấm = nút Sheet ở ô KHÔNG dính", () => {
    const b = ma(`${SO}/_components/bang-so.tsx`);
    expect(b).toMatch(/const TH = cn\(adminTh, "px-2"\)/);
    expect(b).toMatch(/const TD = cn\(adminTd, "px-2 py-2"\)/);
    expect(dem(b, /after:inset-0 after:z-20/g)).toBe(1);
    // ô dính nằm ở cột "Người hưởng" và KHÔNG chứa nút Sheet
    const i = b.indexOf('"sticky left-0 z-10 bg-card');
    expect(i).toBeGreaterThan(0);
    expect(b.slice(i, b.indexOf("</td>", i))).not.toContain("ViSaoSheet");
  });

  it("[NHH-SO-W17b] bề rộng: cột cố định cộng lại ≤ 800px để cột Người hưởng còn ≥ 168px trong khung 968px — con số HOA HỒNG nằm trong màn đầu ở 1280px (đo thật: bản 12 cột đẩy nó ra ngoài)", () => {
    const b = ma(`${SO}/_components/bang-so.tsx`);
    const thead = b.slice(b.indexOf("<thead>"), b.indexOf("</thead>"));
    const rong = [...thead.matchAll(/\bw-\[([\d.]+)rem\]/g)].map((m) => Number(m[1]) * 16);
    expect(rong.length).toBe(8); // mọi cột trừ "Người hưởng" đều khai bề rộng
    expect(rong.reduce((a, c) => a + c, 0)).toBeLessThanOrEqual(800);
    expect(b).toMatch(/table-fixed/);
    expect(b).toMatch(/md:min-w-\[968px\]/);
  });
});

describe("[NHH-SO-W18] bộ lọc trên URL không nói dối", () => {
  it("[NHH-SO-W18] biểu mẫu lọc có `key` theo giá trị lọc (defaultValue chỉ đọc lúc mount; điều hướng phía client không remount form)", () => {
    const f = ma(`${SO}/_components/bo-loc.tsx`);
    expect(f).toMatch(/<form key=\{Object\.values\(gia\)\.join\("\|"\)\}/);
    expect(f).toMatch(/method="get"/);
  });
});

describe("[NHH-SO-W12] nút khiếu nại (track Khiếu nại) nối vào chỗ neo `hanhDong` của BangSo — dây nối, không phải hành vi", () => {
  const p = ma(PAGE);
  const nut = ma(`${SO}/_components/nut-khieu-nai-dong.tsx`);

  it("[NHH-SO-W12a] trang 'Tất cả' truyền `hanhDong` cho BangSo ĐÚNG MỘT chỗ, qua `nutKhieuNaiDong(d, actor.userId, scope.has(KEY_TAO_KHIEU_NAI))` — cùng key mà Server Action đòi, không chuỗi gõ tay", () => {
    expect(dem(p, /hanhDong=\{\(d\) => nutKhieuNaiDong\(d, actor\.userId, scope\.has\(KEY_TAO_KHIEU_NAI\)\)\}/g)).toBe(1);
    expect(dem(p, /<BangSo\b/g)).toBe(1);
    expect(p).not.toMatch(/scope\.has\("commission:view-self"\)/); // key đi qua hằng của module khiếu nại
  });


  it("[NHH-SO-W12b] chỗ nối chỉ vẽ nút theo MỘT hàm quyết `veNutKhieuNaiDong` (dòng CỦA MÌNH ∧ có key), luôn trả một phần tử (việc ẩn nằm ở `coQuyenGui`); hàm quyết kiểm USER ∧ cùng id ∧ key", () => {
    expect(dem(nut, /coQuyenGui=\{veNutKhieuNaiDong\(d, nguoiXemId, coKeyTaoKhieuNai\)\}/g)).toBe(1);
    expect(dem(nut, /dich=\{\{ loai: "DONG", id: d\.id \}\}/g)).toBe(1);
    expect(nut).not.toMatch(/return null|\? null|&& <TaoKhieuNaiNut/);
    const quyet = ma("lib/hoa-hong/khieu-nai-ma.ts");
    expect(dem(quyet, /return coKey && d\.nguoiHuong\.kind === "USER" && d\.nguoiHuong\.id === nguoiXemId;/g)).toBe(1);
  });
});
