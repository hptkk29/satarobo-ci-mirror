// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  KHOA,
  MIEN_EMAIL,
  TAI_KHOAN,
  TIEN_TO,
  emailCua,
  kiemKeHoach,
  maKhoaCua,
  maNhanVienCua,
  slugKhoaCua,
  tenDbDuocPhep,
  tongDiemDe,
  tongDiemKhung,
  type KhoaUat,
  type TaiKhoanUat,
} from "@/lib/elearning/uat-seed-plan";

describe("kế hoạch dữ liệu UAT E-learning", () => {
  it("kế hoạch hiện hành hợp lệ (0 lỗi bất biến)", () => {
    expect(kiemKeHoach()).toEqual([]);
  });

  it("mọi khoá bóc ra chuỗi mang tiền tố UAT — để dọn không đụng dữ liệu thật", () => {
    for (const t of TAI_KHOAN) {
      expect(emailCua(t.ten).startsWith(TIEN_TO)).toBe(true);
      expect(emailCua(t.ten).endsWith(`@${MIEN_EMAIL}`)).toBe(true);
      expect(maNhanVienCua(t.ten).startsWith("UATEL-")).toBe(true);
    }
    for (const k of KHOA) {
      expect(maKhoaCua(k.ma).startsWith("UATEL-")).toBe(true);
      expect(slugKhoaCua(k.ma).startsWith(TIEN_TO)).toBe(true);
    }
  });

  it("miền email là miền KHÔNG định tuyến (.invalid) — không bao giờ gửi tới người thật", () => {
    expect(MIEN_EMAIL.endsWith(".invalid")).toBe(true);
  });

  it("điểm đề khoá A = 5 và khung chấm = 100 (khớp luật kích hoạt)", () => {
    const a = KHOA.find((k) => k.ma === "A")!;
    const quiz = a.bai.find((b) => b.loai === "QUIZ");
    const task = a.bai.find((b) => b.loai === "TASK");
    expect(quiz && quiz.loai === "QUIZ" ? tongDiemDe(quiz.cauHoi) : -1).toBe(5);
    expect(task && task.loai === "TASK" ? tongDiemKhung(task.rubric.tieuChi) : -1).toBe(100);
  });
});

describe("🔴 lưới bất biến thật sự bắt lỗi (luật 11: đối chứng âm cho từng luật)", () => {
  const khoaA = KHOA[0]!;
  const them = (ds: readonly KhoaUat[]) => kiemKeHoach(TAI_KHOAN, ds);
  const bo = (ten: string) => TAI_KHOAN.filter((t) => t.ten !== ten) as TaiKhoanUat[];

  it("chỉ một người TRAINING ⇒ lỗi", () => {
    expect(kiemKeHoach(bo("daotao2"), KHOA).join("|")).toContain("TRAINING");
  });
  it("quản lý chỉ ở một cơ sở ⇒ lỗi", () => {
    expect(kiemKeHoach(bo("ql2"), KHOA).join("|")).toContain("2 cơ sở");
  });
  it("thiếu ca 'không hồ sơ' / 'đã nghỉ' ⇒ lỗi", () => {
    expect(kiemKeHoach(bo("khonghoso"), KHOA).join("|")).toContain("không có hồ sơ");
    expect(kiemKeHoach(bo("danghi"), KHOA).join("|")).toContain("đã nghỉ");
  });
  it("giao cho người đã nghỉ / không hồ sơ ⇒ lỗi (lượt giao sẽ bị bỏ qua)", () => {
    expect(them([{ ...khoaA, giaoCho: ["danghi"] }, ...KHOA.slice(1)]).join("|")).toContain("không có hồ sơ đang làm");
    expect(them([{ ...khoaA, giaoCho: ["khonghoso"] }, ...KHOA.slice(1)]).join("|")).toContain("không có hồ sơ đang làm");
  });
  it("giao lệch cơ sở ⇒ lỗi", () => {
    expect(them([{ ...khoaA, giaoCho: ["hv3"] }, ...KHOA.slice(1)]).join("|")).toContain("lệch cơ sở");
  });
  it("khoá nháp mà có người được giao ⇒ lỗi", () => {
    const c = KHOA.find((k) => k.ma === "C")!;
    expect(them(KHOA.map((k) => (k.ma === "C" ? { ...c, giaoCho: ["hv1"] } : k))).join("|")).toContain("khoá nháp");
  });
  it("khung chấm tổng ≠ 100 hoặc mức không tăng dần ⇒ lỗi", () => {
    const task = khoaA.bai.find((b) => b.loai === "TASK")!;
    if (task.loai !== "TASK") throw new Error("fixture");
    const hong = { ...task, rubric: { ...task.rubric, tieuChi: [{ label: "x", muc: [{ label: "a", points: 0 }, { label: "b", points: 40 }] }] } };
    expect(them([{ ...khoaA, bai: [hong] }, ...KHOA.slice(1)]).join("|")).toContain("≠ 100");
    const lon = { ...task, rubric: { ...task.rubric, tieuChi: [{ label: "x", muc: [{ label: "a", points: 50 }, { label: "b", points: 50 }] }, { label: "y", muc: [{ label: "a", points: 0 }, { label: "b", points: 50 }] }] } };
    expect(them([{ ...khoaA, bai: [lon] }, ...KHOA.slice(1)]).join("|")).toContain("tăng dần");
  });
  it("đề thiếu tự luận / SINGLE hai đáp án đúng ⇒ lỗi", () => {
    const quiz = khoaA.bai.find((b) => b.loai === "QUIZ")!;
    if (quiz.loai !== "QUIZ") throw new Error("fixture");
    const khongEssay = { ...quiz, cauHoi: quiz.cauHoi.filter((c) => c.loai !== "ESSAY") };
    expect(them([{ ...khoaA, bai: [khongEssay] }, ...KHOA.slice(1)]).join("|")).toContain("tự luận");
    const haiDung = { ...quiz, cauHoi: [{ loai: "SINGLE" as const, noiDung: "q", diem: 1, luaChon: [{ text: "a", dung: true }, { text: "b", dung: true }] }, ...quiz.cauHoi] };
    expect(them([{ ...khoaA, bai: [haiDung] }, ...KHOA.slice(1)]).join("|")).toContain("đúng 1 đáp án đúng");
  });
});

describe("🔴 cổng tên DB — PROD bị từ chối", () => {
  it("cho phép DB test/local theo tên", () => {
    for (const t of ["satarobo_test", "satarobo_lamviec", "ci_test", "satarobo_vitest", "satarobo_test_uatel"]) expect(tenDbDuocPhep(t), t).toBe(true);
  });
  it("TỪ CHỐI PROD và tên lạ", () => {
    for (const t of ["satarobo", "satarobo_prod", "postgres", "", "SATAROBO_TEST", "satarobo_testX-drop", "x_satarobo_test"]) expect(tenDbDuocPhep(t), t).toBe(false);
  });
});
