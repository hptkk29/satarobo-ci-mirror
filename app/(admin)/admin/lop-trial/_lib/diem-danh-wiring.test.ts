import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Lưới ghim DÂY NỐI của "điểm danh bắt buộc + dời bé vắng sang lớp trial khác" (04/11/2026). Phần luật thuần có test
// hành vi (`lib/trial/diem-danh-bat-buoc.test.ts`); còn việc "cổng đứng TRƯỚC phép ghi" và "cửa nào gọi cổng nào" nằm ở
// hàm chạm DB nên chỉ ghim được bằng văn bản mã. Bỏ chú thích TRƯỚC khi tìm: khối giải thích bản vá chứa đúng các chuỗi
// đang canh. Neo theo THỨ TỰ + SỐ LẦN, không neo vào chỗ đặt `await`.

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const service = doc("lib/trial/service.ts");
const actions = doc("app/(admin)/admin/lop-trial/_actions.ts");
const queries = doc("app/(admin)/admin/lop-trial/_lib/queries.ts");
const bangCase = doc("app/(admin)/admin/lop-trial/_components/bang-case.tsx");

function than(src: string, batDau: string, ketThuc: string): string {
  const a = src.indexOf(batDau);
  expect(a, `không thấy ${batDau}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(ketThuc, a + batDau.length);
  return src.slice(a, b < 0 ? undefined : b);
}

describe("[DDW-1] hoàn tất buổi: điểm danh bắt buộc, cổng đứng TRƯỚC phép ghi", () => {
  const ham = than(service, "export async function completeTrialSession", "export async function goHocVienKhoiCase");

  it("có đúng MỘT lời gọi cổng", () => {
    expect(ham.match(/loiHoanTatThieuDiemDanh\(/g)?.length).toBe(1);
    expect(ham.match(/soBeChuaDiemDanh\(/g)?.length).toBe(1);
  });

  it("cổng nằm TRƯỚC phép ghi trạng thái buổi (return không rollback — luật rollback)", () => {
    expect(ham.indexOf("loiHoanTatThieuDiemDanh(")).toBeLessThan(ham.indexOf("trialClassSession.updateMany"));
  });

  it("tập bé đếm theo ĐÚNG luật `thuocCase` của bảng điểm danh", () => {
    expect(ham).toMatch(/thuocCase\(e,\s*session\.id,\s*laLopTheoKhung\(session\.trialClass\)\)/);
  });
});

describe("[DDW-2] dời bé vắng sang lớp trial khác", () => {
  const ham = than(service, "export async function doiBeVangSangLopKhac", "async function laGiaoVienHopLe");

  it("mọi cổng từ chối đứng TRƯỚC phép ghi đầu tiên", () => {
    const ghiDau = ham.indexOf("trialEnrollment.updateMany");
    expect(ghiDau).toBeGreaterThan(0);
    for (const cong of ["Đánh dấu bé VẮNG trước", "Bé đã có mặt ở lớp này", "Bé đã ở lớp đích", "Lớp đích đã đủ sĩ số", "Chỉ dời được sang lớp trial của CÙNG cơ sở"]) {
      const i = ham.indexOf(cong);
      expect(i, cong).toBeGreaterThan(0);
      expect(i, cong).toBeLessThan(ghiDau);
    }
  });

  it("case cũ hết bé tự huỷ qua ĐÚNG `huyCaseNeuTrong` (viec DOI), sau phép ghi", () => {
    expect(ham.match(/huyCaseNeuTrong\(/g)?.length).toBe(1);
    expect(ham).toMatch(/viec:\s*"DOI"/);
    expect(ham.indexOf("huyCaseNeuTrong(")).toBeGreaterThan(ham.indexOf("trialEnrollment.create"));
  });

  it("ghi vết TrialReschedule (chỉ số chất lượng chốt lịch của Sale)", () => {
    expect(ham.match(/trialReschedule\.create\(/g)?.length).toBe(1);
  });
});

describe("[DDW-3] action dời lớp: cùng cổng chủ lead / Quản lý với 'Xếp vào case'", () => {
  const ham = than(actions, "export async function doiBeVangSangLopKhacAction", "\nexport async function __het__");

  it("hỏi `quyenChuyenCase` TRƯỚC khi gọi phép ghi", () => {
    const q = ham.indexOf("quyenChuyenCase(");
    const ghi = ham.indexOf("doiBeVangSangLopKhac(");
    expect(q).toBeGreaterThan(0);
    expect(ghi).toBeGreaterThan(q);
  });

  it("kiểm GV vắng và trùng giờ học bù của case đích TRƯỚC phép ghi", () => {
    const ghi = ham.indexOf("doiBeVangSangLopKhac(");
    expect(ham.indexOf("layGvVangChoCase(")).toBeLessThan(ghi);
    expect(ham.indexOf("trialTrungHocBu(")).toBeLessThan(ghi);
  });
});

describe("[DDW-4] màn: cảnh báo quá giờ + nút dời lớp chỉ cho bé ĐÃ vắng", () => {
  it("queries dựng cảnh báo bằng `canhBaoCaseTrial` đúng một lần", () => {
    expect(queries.match(/canhBaoCaseTrial\(/g)?.length).toBe(1);
  });

  it("case card vẽ cảnh báo từ `s.canhBao`", () => {
    expect(bangCase).toMatch(/s\.canhBao\s*&&/);
  });

  it("nút `DoiBeVang` chỉ vẽ khi bé đã đánh VẮNG (không vẽ nút chắc chắn ăn từ chối)", () => {
    expect(bangCase.match(/<DoiBeVang/g)?.length).toBe(1);
    const i = bangCase.indexOf("<DoiBeVang");
    expect(bangCase.slice(Math.max(0, i - 400), i)).toMatch(/status\s*===\s*"ABSENT"/);
  });
});
