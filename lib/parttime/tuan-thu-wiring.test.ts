// [TT-W*] — lưới ghim DÂY NỐI tuân thủ buổi dạy vào ba màn (Control Tower · Công việc của tôi · thẻ Chấm công). Test hành vi của
// từng hàm không đỏ khi trang quên gọi hàm — lưới này đỏ. Neo theo LỜI GỌI (không theo dòng import), đếm số lần khớp.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const dem = (s: string, x: string) => s.split(x).length - 1;

const CT = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
const BANG = doc("app/(admin)/admin/cham-cong/phan-cong/_components/bang-tuan.tsx");
const GV = doc("app/(teacher)/teacher/phan-cong/page.tsx");
const NC_DB = doc("lib/parttime/ngu-canh-cham-cong-db.ts");
const KHOI = doc("components/cham-cong/khoi-ngu-canh.tsx");
const CLIENT = doc("components/cham-cong/checkin-client.tsx");
const THANG = doc("app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx");
const BCT_DB = doc("lib/parttime/bao-cao-thang-db.ts");

describe("[TT-W] dây nối tuân thủ buổi dạy", () => {
  it("[TT-W1] Control Tower: đọc tuân thủ trên CHÍNH bằng chứng P4, đưa vấn đề học viên vào cảnh báo + hồ sơ buổi; KHÔNG có lối tắt ghi hộ", () => {
    expect(dem(CT, "await docTuanThu(bc.phanCong, now)")).toBe(1);
    expect(dem(CT, "...canhBaoTuTuanThu(b.main ? tuanThu.get(b.main.id) : null)")).toBe(1);
    expect(dem(CT, "hoSo: b.main ? (hoSoTheoPc[b.main.id] ?? null) : null")).toBe(1);
    expect(dem(BANG, "<HoSoBuoi n={b.hoSo} gon />")).toBe(1);
    expect(BANG).not.toMatch(/HoSoBuoi[^>]*(diemDanhHref|nhanXetHref)/);
  });

  it("[TT-W2] Công việc của tôi: tuân thủ đọc trên bằng chứng của CHÍNH mình (userId từ phiên) và hiện ở dòng xem", () => {
    expect(GV).toContain("docBangChungCuaToi({ userId: session.user.id,");
    expect(dem(GV, "docTuanThu(bangChung, now)")).toBe(1);
    expect(dem(GV, "docDichHoSo(bangChung)")).toBe(1);
    expect(dem(GV, "hoSo={hoSoTheoPc.get(x.id)}")).toBe(1);
    expect(dem(GV, '<HoSoBuoi n={hoSo.n} diemDanhHref={hoSo.diemDanh} nhanXetHref={hoSo.nhanXet} />')).toBe(1);
  });

  it("[TT-W3] thẻ Chấm công: hồ sơ gọn từ cùng bộ đọc; site truyền BẮT BUỘC; MỘT nút chấm công (không nút vào/ra lớp)", () => {
    expect(dem(NC_DB, "docTuanThu(day, p.now)")).toBe(1);
    expect(dem(NC_DB, "docDichHoSo(day)")).toBe(1);
    expect(dem(KHOI, "<HoSoGon t={t} site={site} />")).toBe(1);
    expect(dem(CLIENT, "site={site}")).toBe(3);
    expect(CLIENT).not.toMatch(/Chấm vào lớp|Chấm ra lớp/);
    expect(KHOI).not.toMatch(/Chấm vào lớp|Chấm ra lớp/);
  });

  it("[TT-W4] báo cáo tuân thủ tuần (Control Tower) + tháng: cùng MỘT hàm `tuanThuTheoNguoi`, đọc trên dòng đối soát / bằng chứng đã có", () => {
    expect(dem(CT, "tuanThuTheoNguoi([...tuanThu.values()])")).toBe(1);
    expect(dem(CT, "<BangTuanThu ds={tuanThuTuan}")).toBe(1);
    expect(dem(BCT_DB, "tuanThuTheoNguoi(")).toBe(2); // QLCS theo cơ sở + GV theo chính mình
    expect(dem(THANG, "<BangTuanThu ds={bc.tuanThu}")).toBe(1);
  });
});
