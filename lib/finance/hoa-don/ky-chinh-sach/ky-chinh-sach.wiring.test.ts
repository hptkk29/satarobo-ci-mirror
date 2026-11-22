// Lưới ghim DÂY NỐI của «chính sách ký» (BGĐ 04/11/2026) — test hành vi không bắt được việc ai đó gỡ một lời gọi (chúng chạm DB / nhà cung cấp).
//   [KCS-W1] mọi action ghi cấu hình ký hỏi `settings:edit` (CHỈ Quản trị tối cao), không còn đường «kế toán Hội sở sửa»
//   [KCS-W2] mọi chỗ lấy cổng theo pháp nhân khai `muc` ("GUI" | "TRA_CUU"); chỉ đối soát / kiểm tra lại mới được «TRA_CUU»
//   [KCS-W3] lớp DB ghi cũng đòi Quản trị tối cao (lớp phòng thủ thứ hai)
//   [KCS-W4] công tắc tạm dừng được hỏi ở MỌI cổng GỬI (cổng · hai runner tự động · bước ký USB · quét tạo lệnh · cron)
//   [KCS-W5] hạn mức chặn đường TỰ ĐỘNG ở cả hai runner
//   [LK-W7]  lệnh ký do HỆ THỐNG tạo chỉ đi một đường: cron → quét → `taoLenhKyUsbHeThong` → `taoLenhKyHeThong`
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, "g"))?.length ?? 0;

const TRAN_QUET_MS = 60_000;
const ACT_KN = "app/(admin)/admin/payments/hoa-don/cau-hinh/_ket-noi-actions.ts";
const ACT_KCS = "app/(admin)/admin/payments/hoa-don/cau-hinh/_ky-chinh-sach-actions.ts";
const KCS_DB = "lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db.ts";
const KN_DB = "lib/finance/hoa-don/ket-noi/ket-noi-db.ts";
const GATEWAY = "lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan.ts";
const KYUSB = "lib/finance/hoa-don/ky-usb/ky-usb-lenh.ts";
const QUET = "lib/finance/hoa-don/ky-usb/quet-tao-lenh.ts";
const LO_DEM = "lib/finance/hoa-don/xuat-lo-dem/chay-lo-dem.ts";
const TU_XUAT = "lib/finance/hoa-don/xuat-lien/chay-xuat-lien.ts";
const CRON = "app/api/cron/hoa-don-misa-doi-soat/route.ts";
const LENH_DB = "lib/finance/hoa-don/lenh-ky-db.ts";
const TRANG_THAI = "lib/finance/hoa-don/lenh-ky-trang-thai.ts";

function maNguon(): { duong: string; src: string }[] {
  const ra = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib", "app", "components"], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return ra
    .split(/\r?\n/)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((duong) => {
      try {
        return { duong, src: doc(duong) };
      } catch {
        return { duong, src: "" };
      }
    });
}

/** Thân các hàm `export async function xxxAction(` của một tệp action. */
function cacAction(src: string): { ten: string; than: string }[] {
  const vi = [...src.matchAll(/export async function (\w+Action)\(/g)];
  return vi.map((m, i) => ({ ten: m[1]!, than: src.slice(m.index!, vi[i + 1]?.index ?? undefined) }));
}

describe("[KCS-W1] action ghi cấu hình ký: CHỈ Quản trị tối cao (settings:edit)", () => {
  for (const f of [ACT_KN, ACT_KCS]) {
    it(`${f}: mọi action gọi congQuanTri() TRƯỚC khi chạm tầng ghi; cổng hỏi đúng \`settings:edit\` một lần; không còn đường «kế toán Hội sở»`, () => {
      const src = doc(f);
      const ds = cacAction(src);
      expect(ds.length).toBeGreaterThanOrEqual(2);
      for (const a of ds) expect(dem(a.than, /\bawait congQuanTri\(\)/), a.ten).toBe(1);
      expect(dem(src, /checkPermission\("settings:edit"\)/)).toBe(1);
      expect(dem(src, /payments:confirm|laKeToanHoiSo|congHoiSo/)).toBe(0);
    });
  }
  it("cổng đứng TRƯỚC phép ghi trong từng action (không ghi rồi mới hỏi quyền)", () => {
    for (const f of [ACT_KN, ACT_KCS]) {
      for (const a of cacAction(doc(f))) {
        const iCong = a.than.indexOf("congQuanTri()");
        const iGhi = a.than.search(/\b(luuKetNoi|ghiKetQuaKiemTra|luuHanMucKy|tamDungKy|batLaiKy|taoCongVin)\(/);
        expect(iCong, a.ten).toBeGreaterThan(-1);
        expect(iGhi, a.ten).toBeGreaterThan(iCong);
      }
    }
  });
});

describe("[KCS-W2] cổng theo pháp nhân khai mức GUI / TRA_CUU", () => {
  const tep = maNguon();
  it("quét được đủ tệp (chống cổng rỗng)", () => {
    expect(tep.length).toBeGreaterThan(500);
  });
  it("MỌI lời gọi layCongHsm/UsbChoPhapNhan truyền `\"GUI\"` hoặc `\"TRA_CUU\"` làm tham số thứ hai (không còn lời gọi quên khai)", { timeout: TRAN_QUET_MS }, () => {
    let tong = 0;
    let khaiDu = 0;
    for (const t of tep) {
      if (t.duong === GATEWAY) continue; // nơi định nghĩa
      tong += dem(t.src, /\blayCong(?:Hsm|Usb)ChoPhapNhan\(/);
      khaiDu += dem(t.src, /\blayCong(?:Hsm|Usb)ChoPhapNhan\([^,()]+, "(?:GUI|TRA_CUU)"/);
    }
    expect(tong).toBeGreaterThanOrEqual(6);
    expect(khaiDu).toBe(tong);
  });
  it("«TRA_CUU» (không bị chặn khi tạm dừng) chỉ ở ĐỐI SOÁT của cron và `kiemTraLaiUsb` — mọi nơi khác là «GUI»", { timeout: TRAN_QUET_MS }, () => {
    const noi = tep.filter((t) => t.duong !== GATEWAY && /"TRA_CUU"/.test(t.src) && /\blayCong(?:Hsm|Usb)ChoPhapNhan\(/.test(t.src)).map((t) => t.duong).sort();
    expect(noi).toEqual([CRON, KYUSB].sort());
    expect(dem(doc(CRON), /layCongHsmChoPhapNhan\(phapNhanMa, "TRA_CUU"\)/)).toBe(1);
    expect(dem(doc(KYUSB), /layCongUsbChoPhapNhan\(p\.phapNhanMa, "TRA_CUU"/)).toBe(1);
  });
  it("cổng chặn khi tạm dừng CHỈ với mức GUI, và hỏi TRƯỚC khi đọc cấu hình", () => {
    const g = doc(GATEWAY);
    expect(dem(g, /if \(muc !== "GUI"\) return null;/)).toBe(1);
    expect(dem(g, /const dung = await chanNeuTamDung\(phapNhanMa, muc\);\s*\n\s*if \(dung\) return/)).toBe(2);
    expect(g.indexOf("chanNeuTamDung(phapNhanMa, muc)")).toBeLessThan(g.indexOf("await giai(phapNhanMa, tc)", g.indexOf("export async function layCongHsmChoPhapNhan")));
  });
});

describe("[KCS-W3] lớp DB ghi cũng đòi Quản trị tối cao", () => {
  it("ba hàm ghi chính sách + luuKetNoi từ chối khi `actor.isSuperAdmin` không đúng", () => {
    const k = doc(KCS_DB);
    expect(dem(k, /if \(!i\.actor\.isSuperAdmin\) return \{ ok: false, error: CHI_QUAN_TRI \};/)).toBe(3);
    expect(dem(doc(KN_DB), /if \(!input\.actor\.isSuperAdmin\) return \{ ok: false, error: /)).toBe(1);
  });
  it("ghi chính sách LUÔN kèm nhật ký trước/sau trong CÙNG giao dịch (writeAudit với tx) — 3 hàm ghi, 3 lần ghi nhật ký", () => {
    const k = doc(KCS_DB);
    expect(dem(k, /await writeAudit\(\{\s*\n\s*tx,/)).toBe(3);
    expect(dem(k, /\bdb\.\$transaction\(/)).toBe(3);
  });
});

describe("[KCS-W4] công tắc tạm dừng được hỏi ở MỌI cổng gửi", () => {
  it("cổng · hai runner (cổng nhớ trong lượt vẫn hỏi lại) · bước ký USB (3 chỗ) · quét tạo lệnh · tạo lệnh · cron", () => {
    expect(dem(doc(GATEWAY), /\bkyDangTamDung\(/)).toBe(1);
    expect(dem(doc(LO_DEM), /\(await kyDangTamDung\(da\.phapNhanMa\)\)\.tamDung/)).toBe(1);
    expect(dem(doc(TU_XUAT), /\(await kyDangTamDung\(da\.phapNhanMa\)\)\.tamDung/)).toBe(1);
    const k = doc(KYUSB);
    expect(dem(k, /\bkyDangTamDung\(/)).toBe(2); // tạo lệnh + ngay trước khi gửi
    expect(dem(k, /layCongUsbChoPhapNhan\(p\.phapNhanMa, "GUI"/)).toBe(1);
    expect(dem(k, /layCongUsbChoPhapNhan\(phapNhanMa, "GUI"/)).toBe(1);
    expect(dem(k, /\{ ok: false, ma: "TAM_DUNG", thongDiepNgan: "tam-dung" \}/)).toBe(1);
    // …và TRƯỚC khi giành lượt gửi (không đốt lượt rồi mới hỏi dừng).
    expect(k.indexOf("ma: \"TAM_DUNG\", thongDiepNgan")).toBeLessThan(k.indexOf("await giaiLuotGuiChoKyUsb(l.hoaDonId, i.now)"));
    expect(dem(doc(QUET), /\bkyDangTamDung\(/)).toBe(2);
    expect(dem(doc("lib/finance/hoa-don/ky-usb/viec-ky.ts"), /\(await kyDangTamDung\(pn\)\)\.tamDung\) return \{ ok: false, ma: "TAM_DUNG"/)).toBe(1); // không giao việc khi dừng
    expect(dem(doc(CRON), /\bkyDangTamDung\(/)).toBe(1);
  });
  it("cron: việc GỬI LẠI của đối soát bị khoá theo trạng thái dừng (`khoaGui`) — tra cứu thì không", () => {
    expect(dem(doc(CRON), /khoaGui: async \(phapNhanMa\) => \(await kyDangTamDung\(phapNhanMa\)\)\.tamDung/)).toBe(1);
    expect(dem(doc("lib/finance/hoa-don/phat-hanh-misa.ts"), /choGuiLai: \(hd\) => !chiTraCuu && guiLaiDuoc\(hd\)/)).toBe(1);
  });
});

describe("[KCS-W5] hạn mức chặn đường TỰ ĐỘNG — kiểm + giữ chỗ NGUYÊN TỬ trong giao dịch tạo hoá đơn", () => {
  const PHAT_HANH = "lib/finance/hoa-don/phat-hanh-misa.ts";
  const CHINH_SACH_DB = "lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db.ts";
  for (const f of [LO_DEM, TU_XUAT]) {
    it(`${f}: KHÔNG tự kiểm hạn mức ở ngoài giao dịch (đó là kiểu đọc-rồi-ghi, hai worker cùng lọt); truyền kieu theo pháp nhân; chạm hạn mức / tạm dừng ⇒ bỏ qua VUOT_HAN_MUC, KHÔNG tính vào trần mỗi lượt; báo MỘT lần cuối lượt`, () => {
      const s = doc(f);
      expect(dem(s, /\bkiemHanMucTuDong\b/)).toBe(0);
      expect(dem(s, /kieu: cn\.ok \? "TU_DONG_HSM" : "TU_DONG_USB"/)).toBe(1);
      expect(dem(s, /e instanceof LoiPhatHanh && \(e\.ma === "VUOT_HAN_MUC" \|\| e\.ma === "TAM_DUNG_KY"\)/)).toBe(1);
      expect(dem(s, /bo\("VUOT_HAN_MUC", e\.message\)/)).toBe(1);
      // MỘT lần cuối MỖI lượt: lô cuối ngày (một lượt = nhiều đơn) và «Xuất liền» (một lượt = một đơn) đều chỉ có MỘT lời gọi.
      expect(dem(s, /await baoHanMuc\(gom, input\.now\)/)).toBe(1);
    });
  }
  it("`batDauPhatHanh`: cổng chỉ chạy cho TU_DONG_HSM, TRONG giao dịch, SAU mọi cổng nghiệp vụ và TRƯỚC phép ghi hoá đơn; từ chối = NÉM (rollback), dùng mã pháp nhân đã đóng dấu lên hoá đơn", () => {
    const s = doc(PHAT_HANH);
    expect(dem(s, /giuChoHanMucTrongTx\(tx, \{ phapNhanMa: pnPhatHanh\.phapNhan\.ma, soTien: tongTien, now: input\.now \}\)/)).toBe(1);
    expect(dem(s, /if \(input\.kieu === "TU_DONG_HSM"\) \{/)).toBe(1);
    expect(dem(s, /if \(!giu\.ok\) throw new LoiPhatHanh\(giu\.ma === "TAM_DUNG" \? "TAM_DUNG_KY" : "VUOT_HAN_MUC", giu\.lyDo\)/)).toBe(1);
    const iCong = s.indexOf("giuChoHanMucTrongTx(tx");
    expect(s.indexOf("chanPhieuKhongHopLe(phieu);")).toBeLessThan(iCong);
    expect(iCong).toBeLessThan(s.indexOf("const hd = await tx.hoaDonDienTu.create("));
  });
  it("`kieu` là tham số BẮT BUỘC và MỌI nơi gọi `batDauPhatHanh` tự khai: nút kế toán ⇒ BAM_TAY (không qua hạn mức), hai runner ⇒ theo pháp nhân", () => {
    const tep = maNguon();
    const goi = tep.filter((t) => t.duong !== PHAT_HANH && /\bbatDauPhatHanh\(\{/.test(t.src));
    expect(goi.map((t) => t.duong).sort()).toEqual(["app/(admin)/admin/payments/hoa-don/_actions.ts", LO_DEM, TU_XUAT].sort());
    expect(dem(doc("app/(admin)/admin/payments/hoa-don/_actions.ts"), /kieu: "BAM_TAY"/)).toBe(1);
    expect(dem(doc(PHAT_HANH), / {2}kieu: KieuPhatHanh;/)).toBe(1);
  });
  it("cổng khoá ĐÚNG dòng chính sách (`FOR UPDATE`, tham số hoá) rồi đếm trên CHÍNH giao dịch đó; chỉ đếm hoá đơn do HỆ THỐNG tạo; luu/tạm dừng/bật lại cùng ghi dòng ấy nên áp ngay", () => {
    const s = doc(CHINH_SACH_DB);
    expect(dem(s, /WHERE "phapNhanMa" = \$\{i\.phapNhanMa\} FOR UPDATE/)).toBe(1);
    expect(dem(s, /docSuDungHanMuc\(i\.phapNhanMa, cs\.cuaSoPhut, i\.now, tx\)/)).toBe(1);
    expect(dem(s, /taoBoiId: SYSTEM_USER_ID, trangThai: \{ in: TRANG_THAI_TINH_HAN_MUC \}/)).toBe(1);
    expect(dem(s, /tx\.hoaDonKyChinhSach\.(update|updateMany|create)\(/)).toBe(5); // lưu (2) · tạm dừng (2) · bật lại (1); cổng giữ chỗ KHÔNG ghi gì vào dòng này, chỉ khoá
    expect(dem(s, /xacNhanNoiLong !== true/)).toBe(1);
  });
  it("cron đối soát kiểm lại bản HỆ THỐNG chưa gửi trước khi gửi (`chanChuaGui`), và CHỈ bản chưa từng gửi (`misaGuiLuc === null`) — không giả định thu hồi được thứ đã gửi", () => {
    expect(dem(doc(CRON), /chanChuaGui: lyDoKhongGuiDuocHoaDonHeThong/)).toBe(1);
    expect(dem(doc(PHAT_HANH), /misaGuiLuc === null && input\.chanChuaGui/)).toBe(1);
  });
  it("hạn mức KHÔNG chặn nút «Phát hành» của kế toán (người bấm đã là bước kiểm tra)", () => {
    const a = doc("app/(admin)/admin/payments/hoa-don/_actions.ts");
    expect(dem(a, /kiemHanMuc|giuChoHanMucTrongTx|TU_DONG_HSM/)).toBe(0);
  });
});

describe("[LK-W7] lệnh ký do HỆ THỐNG tạo chỉ đi MỘT đường", () => {
  const tep = maNguon();
  it("`taoLenhKyHeThong(` chỉ được gọi từ ky-usb-lenh.ts; `taoLenhKyUsbHeThong(` chỉ từ quet-tao-lenh.ts — không action, không route, không component", { timeout: TRAN_QUET_MS }, () => {
    const a = tep.filter((t) => t.duong !== LENH_DB && /\btaoLenhKyHeThong\(/.test(t.src)).map((t) => t.duong);
    expect(a).toEqual([KYUSB]);
    const b = tep.filter((t) => t.duong !== KYUSB && /\btaoLenhKyUsbHeThong\(/.test(t.src)).map((t) => t.duong);
    expect(b).toEqual([QUET]);
  });
  it("hằng NGUOI_YEU_CAU_HE_THONG chỉ được GHI ở lenh-ky-db.ts (taoLenhKyHeThong) và định nghĩa / miễn trừ ở lenh-ky-trang-thai.ts", { timeout: TRAN_QUET_MS }, () => {
    const noi = tep.filter((t) => /\bNGUOI_YEU_CAU_HE_THONG\b/.test(t.src)).map((t) => t.duong).sort();
    expect(noi).toEqual([LENH_DB, TRANG_THAI].sort());
    expect(dem(doc(LENH_DB), /nguoiYeuCauId: NGUOI_YEU_CAU_HE_THONG/)).toBe(1);
    // `taoLenhKy` của người dùng LUÔN ghi `actor.userId` — không có tham số để truyền người yêu cầu.
    expect(dem(doc(LENH_DB), /nguoiYeuCauId: i\.actor\.userId,\s*\n\s*nguoi: nguoiGhi/)).toBe(1);
  });
  it("KHÔNG có nhánh miễn tách nhiệm vụ theo giá trị người yêu cầu: `kiemTachNhiemVu` không nhắc hằng hệ thống và chỉ còn đúng các lối ra đã duyệt", () => {
    const t = doc(TRANG_THAI);
    const than = t.slice(t.indexOf("export function kiemTachNhiemVu("), t.indexOf("// ── HẠN LỆNH"));
    expect(dem(than, /NGUOI_YEU_CAU_HE_THONG/)).toBe(0);
    expect(dem(than, /return \{ ok: true \}/)).toBe(3); // không cần duyệt · khác người · cơ sở khai `khacNguoi=false`
  });
  it("quét chỉ chạy khi cờ `hoaDon.kyUsb` BẬT (hỏi ngay đầu) và bỏ qua hoá đơn có ngoại lệ mở", () => {
    const q = doc(QUET);
    expect(dem(q, /if \(!\(await laKyUsbBat\(\)\)\) return null;/)).toBe(1);
    expect(dem(q, /boQuaNgoaiLe \+= 1/)).toBe(1);
    expect(q.indexOf("laKyUsbBat()")).toBeLessThan(q.indexOf("db.hoaDonDienTu.findMany"));
  });
  it("người KÝ phải đúng pháp nhân: bước bắt đầu phiên và hoàn tất đều hỏi `duocKyChoPhapNhan`", () => {
    expect(dem(doc(KYUSB), /await duocKyChoPhapNhan\(/)).toBe(2);
  });
  it("hash nội dung được kiểm LẠI ở cả bắt đầu phiên lẫn hoàn tất; chứng thư thực tế được so với chứng thư đã khai TRƯỚC khi gửi", () => {
    const k = doc(KYUSB);
    expect(dem(k, /await chanNeuNoiDungDoi\(/)).toBe(2);
    expect(dem(k, /cungSerial\(ct\.serial, tk\.hang\.chungThuSerial\)/)).toBe(1);
    expect(k.indexOf("cungSerial(ct.serial")).toBeLessThan(k.indexOf("await hoanTatKy("));
  });
});
