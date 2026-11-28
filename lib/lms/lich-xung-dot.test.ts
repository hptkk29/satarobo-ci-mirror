import { describe, expect, it } from "vitest";
import {
  KHONG_XUNG_DOT,
  anDanhKetQua,
  biLoaiTru,
  dungThongDiep,
  khoangTuNgayGio,
  khungGioVn,
  timXungDot,
  type MucLich,
  type MucLichHocVien,
  type TenThamChieu,
} from "./lich-xung-dot";
import { khoangChongLan, overlaps } from "./scheduling";
import { trungKhungGio } from "@/lib/trial/lop-moi";
import { vnDateAt } from "@/lib/time/vn";

// Mọi mốc dựng bằng `vnDateAt` (đồng hồ VN) — KHÔNG đọc đồng hồ thật (luật 19) và không phụ thuộc múi giờ máy.
const NGAY = { y: 2026, m: 9, d: 15 }; // 15/10/2026 (tháng 0-based)
const t = (h: number, mi = 0) => vnDateAt(NGAY.y, NGAY.m, NGAY.d, h, mi);

function muc(p: Partial<MucLich> & { id: string }): MucLich {
  return {
    nguon: "CLASS_SESSION",
    tieuDe: "Robotics 6A",
    startAt: t(18),
    endAt: t(19, 30),
    teacherId: "gv-a",
    roomId: "r01",
    centerId: "cs-1",
    classId: "lop-1",
    ...p,
  };
}
const hv = (m: MucLich, hocVienId: string): MucLichHocVien => ({ ...m, hocVienId });

describe("[XD] quy tắc trùng — nửa mở, MỘT nơi định nghĩa (T09)", () => {
  it("[XD-01] BIÊN: 18–19 và 19–20 KHÔNG trùng; 18–19 và 18:59–20 CÓ trùng; chứa nhau / giống hệt đều trùng", () => {
    const a = { startAt: t(18), endAt: t(19) };
    expect(overlaps(a, { startAt: t(19), endAt: t(20) })).toBe(false);
    expect(overlaps({ startAt: t(19), endAt: t(20) }, a)).toBe(false);
    expect(overlaps(a, { startAt: t(18, 59), endAt: t(20) })).toBe(true);
    expect(overlaps({ startAt: t(18, 59), endAt: t(20) }, a)).toBe(true);
    expect(overlaps(a, { startAt: t(17), endAt: t(18, 1) })).toBe(true);
    expect(overlaps(a, { startAt: t(18, 10), endAt: t(18, 20) })).toBe(true); // nằm trọn bên trong
    expect(overlaps(a, a)).toBe(true);
  });

  it("[XD-02] MỘT primitive cho cả ba nơi so: `overlaps` (mốc), `trungKhungGio` ('HH:mm' của lớp trial), `khoangChongLan` (số) cho CÙNG đáp án trên mọi biên", () => {
    const ca = [
      [18 * 60, 19 * 60, 19 * 60, 20 * 60],
      [18 * 60, 19 * 60, 18 * 60 + 59, 20 * 60],
      [18 * 60, 19 * 60, 17 * 60, 18 * 60],
      [18 * 60, 19 * 60, 17 * 60, 18 * 60 + 1],
    ] as const;
    const hhmm = (p: number) => `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`;
    for (const [a1, a2, b1, b2] of ca) {
      const goc = khoangChongLan(a1, a2, b1, b2);
      expect(trungKhungGio({ startTime: hhmm(a1), endTime: hhmm(a2) }, { startTime: hhmm(b1), endTime: hhmm(b2) })).toBe(goc);
      expect(overlaps({ startAt: t(0, a1), endAt: t(0, a2) }, { startAt: t(0, b1), endAt: t(0, b2) })).toBe(goc);
    }
  });

  it("[XD-03] GIÁO VIÊN: cùng GV, giờ đè ⇒ trùng ở MỌI nguồn (lớp chính / trial / case dạy bù); GV khác ⇒ không", () => {
    const dl = {
      muc: [
        muc({ id: "b1" }),
        muc({ id: "tr1", nguon: "TRIAL_CLASS_SESSION", tieuDe: "Trial 6", classId: null, startAt: t(18, 30), endAt: t(20), roomId: null }),
        muc({ id: "cs1", nguon: "MAKEUP_CASE", tieuDe: "Case dạy bù", classId: null, startAt: t(19), endAt: t(20, 30), roomId: null }),
        muc({ id: "khac", teacherId: "gv-b", roomId: "r09" }),
      ],
      mucHocVien: [],
    };
    const kq = timXungDot(dl, { startAt: t(18, 30), endAt: t(19, 30), teacherId: "gv-a" });
    expect(kq.teacherConflicts.map((x) => `${x.nguon}:${x.id}`)).toEqual(["CLASS_SESSION:b1", "TRIAL_CLASS_SESSION:tr1", "MAKEUP_CASE:cs1"]);
    expect(kq.roomConflicts).toEqual([]);
    expect(kq.coXungDot).toBe(true);
  });

  it("[XD-04] PHÒNG: chỉ so cùng roomId; ba nguồn đều thấy", () => {
    const dl = {
      muc: [
        muc({ id: "b1", teacherId: "gv-x", roomId: "r01" }),
        muc({ id: "tr1", nguon: "TRIAL_CLASS_SESSION", classId: null, teacherId: null, roomId: "r01" }),
        muc({ id: "cs1", nguon: "MAKEUP_CASE", classId: null, teacherId: "gv-y", roomId: "r01" }),
        muc({ id: "phong-khac", teacherId: "gv-z", roomId: "r02" }),
      ],
      mucHocVien: [],
    };
    const kq = timXungDot(dl, { startAt: t(18), endAt: t(19), roomId: "r01" });
    expect(kq.roomConflicts.map((x) => x.id)).toEqual(["b1", "cs1", "tr1"].sort((a, b) => a.localeCompare(b)));
    expect(kq.teacherConflicts).toEqual([]);
  });

  it("[XD-05] HỌC VIÊN theo lô: chỉ trả ĐÚNG bé bị trùng, mỗi bé kèm danh sách trùng; bé không trùng không có phần tử rỗng", () => {
    const lop = muc({ id: "b1" });
    const trial = muc({ id: "tr1", nguon: "TRIAL_CLASS_SESSION", classId: null, startAt: t(18, 45), endAt: t(19, 15) });
    const dl = { muc: [], mucHocVien: [hv(lop, "hv-1"), hv(trial, "hv-1"), hv(muc({ id: "cs9", nguon: "MAKEUP_CASE", classId: null }), "hv-3"), hv(muc({ id: "xa", startAt: t(8), endAt: t(9) }), "hv-4")] };
    const kq = timXungDot(dl, { startAt: t(18, 30), endAt: t(20), studentIds: ["hv-1", "hv-2", "hv-3", "hv-4"] });
    expect(kq.studentConflicts.map((h) => h.studentId)).toEqual(["hv-1", "hv-3"]);
    expect(kq.studentConflicts[0]!.xungDot.map((x) => x.id)).toEqual(["b1", "tr1"]);
    expect(kq.studentConflicts.find((h) => h.studentId === "hv-2")).toBeUndefined();
  });

  it("[XD-06] học viên hiện qua HAI đường cho CÙNG một buổi (lớp + ghi danh lặp) ⇒ gộp một trùng", () => {
    const lop = muc({ id: "b1" });
    const kq = timXungDot({ muc: [], mucHocVien: [hv(lop, "hv-1"), hv(lop, "hv-1")] }, { startAt: t(18), endAt: t(19), studentIds: ["hv-1"] });
    expect(kq.studentConflicts[0]!.xungDot).toHaveLength(1);
  });

  it("[XD-07] EXCLUDE: loại đúng bản ghi đang sửa (case của chính nó), loại CẢ LỚP, nhưng KHÔNG loại bản ghi khác cùng loại / cùng id khác nguồn", () => {
    const dl = {
      muc: [
        muc({ id: "cs1", nguon: "MAKEUP_CASE", classId: null }),
        muc({ id: "cs2", nguon: "MAKEUP_CASE", classId: null }),
        muc({ id: "b1", classId: "lop-1" }),
        muc({ id: "b2", classId: "lop-2" }),
        muc({ id: "cs1", nguon: "TRIAL_CLASS_SESSION", classId: null }), // cùng id, KHÁC nguồn
      ],
      mucHocVien: [],
    };
    const yc = { startAt: t(18), endAt: t(19), teacherId: "gv-a" };
    expect(timXungDot(dl, yc, [{ type: "MAKEUP_CASE", id: "cs1" }]).teacherConflicts.map((x) => `${x.nguon}:${x.id}`).sort()).toEqual(
      ["CLASS_SESSION:b1", "CLASS_SESSION:b2", "MAKEUP_CASE:cs2", "TRIAL_CLASS_SESSION:cs1"].sort(),
    );
    expect(timXungDot(dl, yc, [{ type: "CLASS", id: "lop-1" }]).teacherConflicts.map((x) => x.id)).not.toContain("b1");
    expect(timXungDot(dl, yc, [{ type: "CLASS", id: "lop-1" }]).teacherConflicts.map((x) => x.id)).toContain("b2");
    // chiều HỌC VIÊN cũng loại trừ: bé nằm trong case đang sửa thì không trùng với chính case đó, nhưng vẫn trùng case khác
    const hs = {
      muc: [],
      mucHocVien: [hv(muc({ id: "cs1", nguon: "MAKEUP_CASE", classId: null }), "hv-1"), hv(muc({ id: "cs2", nguon: "MAKEUP_CASE", classId: null }), "hv-1")],
    };
    const ycHs = { startAt: t(18), endAt: t(19), studentIds: ["hv-1"] };
    expect(timXungDot(hs, ycHs, [{ type: "MAKEUP_CASE", id: "cs1" }]).studentConflicts[0]!.xungDot.map((x) => x.id)).toEqual(["cs2"]);
    expect(timXungDot(hs, ycHs, [{ type: "MAKEUP_CASE", id: "cs1" }, { type: "MAKEUP_CASE", id: "cs2" }]).coXungDot).toBe(false);
    // mục không có classId không bao giờ khớp loại trừ CLASS
    expect(biLoaiTru({ nguon: "MAKEUP_CASE", id: "x", classId: null }, [{ type: "CLASS", id: "null" }])).toBe(false);
  });

  it("[XD-08] khác NGÀY không trùng (khoảng có ngày); khác GV/phòng/học viên không trùng; yêu cầu không có khoá ⇒ không có chiều đó", () => {
    const hom = muc({ id: "b1", startAt: vnDateAt(2026, 9, 16, 18), endAt: vnDateAt(2026, 9, 16, 19, 30) });
    const dl = { muc: [hom], mucHocVien: [hv(hom, "hv-1")] };
    const yc = { startAt: t(18), endAt: t(19, 30) };
    expect(timXungDot(dl, { ...yc, teacherId: "gv-a", roomId: "r01", studentIds: ["hv-1"] }).coXungDot).toBe(false);
    const cungNgay = { muc: [muc({ id: "b2" })], mucHocVien: [] };
    expect(timXungDot(cungNgay, { ...yc, teacherId: "gv-khac", roomId: "r-khac" }).coXungDot).toBe(false);
    expect(timXungDot(cungNgay, yc).coXungDot).toBe(false); // không khoá nào ⇒ không so
    expect(timXungDot(cungNgay, { ...yc, studentIds: [] })).toEqual(KHONG_XUNG_DOT);
  });

  it("[XD-09] khoangTuNgayGio: NGÀY (@db.Date, nửa đêm UTC) + 'HH:mm' VN ⇒ đúng mốc; giờ hỏng / ngược ⇒ null (không đoán)", () => {
    const k = khoangTuNgayGio(new Date("2026-10-15T00:00:00.000Z"), "18:00", "19:30")!;
    expect(k.startAt.getTime()).toBe(t(18).getTime());
    expect(k.endAt.getTime()).toBe(t(19, 30).getTime());
    expect(khoangTuNgayGio(new Date("2026-10-15T00:00:00.000Z"), "19:30", "18:00")).toBeNull();
    expect(khoangTuNgayGio(new Date("2026-10-15T00:00:00.000Z"), "18:00", "18:00")).toBeNull();
    expect(khoangTuNgayGio(new Date("2026-10-15T00:00:00.000Z"), "abc", "19:00")).toBeNull();
    expect(khoangTuNgayGio(new Date("2026-10-15T00:00:00.000Z"), null, "19:00")).toBeNull();
  });
});

describe("[XD-M] câu nói cho người dùng (T09)", () => {
  const ten: TenThamChieu = {
    giaoVien: (id) => ({ "gv-a": "Nguyễn A" })[id],
    phong: (id) => ({ r01: "R01" })[id],
    hocVien: (id) => ({ "hv-b": "Nguyễn B" })[id],
  };
  const kq = timXungDot(
    {
      muc: [muc({ id: "b1", tieuDe: "Robotics 6A" }), muc({ id: "b2", tieuDe: "Robotics 7B", teacherId: "gv-z", startAt: t(18), endAt: t(19, 30) })],
      mucHocVien: [hv(muc({ id: "b3", tieuDe: "Robotics 6A", teacherId: "gv-q", roomId: "r-q" }), "hv-b")],
    },
    { startAt: t(18), endAt: t(19, 30), teacherId: "gv-a", roomId: "r01", studentIds: ["hv-b"] },
  );

  it("[XD-10] đúng mẫu của chủ dự án: GV · phòng · học viên, kèm khung giờ VN", () => {
    expect(khungGioVn(t(18), t(19, 30))).toBe("18:00–19:30");
    const cau = dungThongDiep(kq, ten);
    expect(cau).toContain("GV Nguyễn A đang có lớp Robotics 6A từ 18:00–19:30.");
    expect(cau).toContain("Phòng R01 đang được dùng bởi lớp Robotics 6A từ 18:00–19:30.");
    expect(cau).toContain("Học viên Nguyễn B đang có lịch học lớp Robotics 6A từ 18:00–19:30.");
  });

  it("[XD-11] NHIỀU trùng ⇒ trả đủ danh sách, không chỉ trùng đầu tiên", () => {
    const hai = timXungDot({ muc: [muc({ id: "b1" }), muc({ id: "b2", tieuDe: "Robotics 7B" })], mucHocVien: [] }, { startAt: t(18), endAt: t(19), teacherId: "gv-a" });
    expect(dungThongDiep(hai, ten)).toHaveLength(2);
  });

  it("[XD-12] nguồn thuộc cơ sở NGƯỜI XEM không đọc được ⇒ chỉ nói LOẠI việc, KHÔNG lộ tên lớp; nguồn đọc được vẫn nói tên", () => {
    const anCs2 = (centerId: string | null) => centerId === "cs-2";
    const kin = timXungDot(
      { muc: [muc({ id: "b1", tieuDe: "Lớp bí mật CS2", centerId: "cs-2" }), muc({ id: "tr", nguon: "TRIAL_CLASS_SESSION", classId: null, tieuDe: "Trial CS1", centerId: "cs-1", startAt: t(18, 10), endAt: t(18, 40) })], mucHocVien: [] },
      { startAt: t(18), endAt: t(19), teacherId: "gv-a" },
    );
    const cau = dungThongDiep(kin, ten, anCs2).join("|");
    expect(cau).not.toContain("bí mật");
    expect(cau).toContain("một buổi lớp chính");
    expect(cau).toContain("lớp trải nghiệm Trial CS1");
  });

  it("[XD-13] không có trùng ⇒ không có câu nào", () => {
    expect(dungThongDiep(KHONG_XUNG_DOT, ten)).toEqual([]);
  });

describe("[XD-A] kết quả cấu trúc ẩn danh + câu nói học viên (T09-F1)", () => {
  const kq = timXungDot(
    {
      muc: [],
      mucHocVien: [
        hv(muc({ id: "cs-x", nguon: "MAKEUP_CASE", tieuDe: "Case bí mật", classId: null, centerId: "cs-2" }), "hv-1"),
        hv(muc({ id: "b-y", tieuDe: "Lớp CS1", centerId: "cs-1" }), "hv-1"),
      ],
    },
    { startAt: t(18), endAt: t(19), studentIds: ["hv-1"] },
  );
  const ten: TenThamChieu = { giaoVien: () => undefined, phong: () => undefined, hocVien: (id) => ({ "hv-1": "Nguyễn A" })[id] };

  it("[XD-14] câu cho học viên: 'Học viên … đang có lịch học bù …' / '… lịch học lớp …'", () => {
    const cau = dungThongDiep(kq, ten);
    expect(cau).toContain("Học viên Nguyễn A đang có lịch học bù từ 18:00–19:30.");
    expect(cau).toContain("Học viên Nguyễn A đang có lịch học lớp Lớp CS1 từ 18:00–19:30.");
    expect(dungThongDiep(kq, { ...ten, hocVien: () => undefined })[0]).toMatch(/^Học viên đang có /);
  });

  it("[XD-15] `anDanhKetQua`: nguồn ngoài tầm nhìn bị gỡ tên / id / cơ sở / lớp, nguồn trong tầm nhìn giữ nguyên; số lượng và giờ KHÔNG đổi (vẫn là một trùng thật)", () => {
    const an = anDanhKetQua(kq, (c) => c === "cs-2");
    const [a, b] = an.studentConflicts[0]!.xungDot;
    const ngoai = [a!, b!].find((x) => x.nguon === "MAKEUP_CASE")!;
    const trong = [a!, b!].find((x) => x.nguon === "CLASS_SESSION")!;
    expect(ngoai).toMatchObject({ id: "", tieuDe: "một case dạy bù", centerId: null, classId: null });
    expect(JSON.stringify(ngoai)).not.toContain("bí mật");
    expect(trong).toMatchObject({ id: "b-y", tieuDe: "Lớp CS1", centerId: "cs-1" });
    expect(an.coXungDot).toBe(true);
    expect(ngoai.startAt.getTime()).toBe(t(18).getTime());
    // gốc không bị sửa tại chỗ
    expect(kq.studentConflicts[0]!.xungDot.find((x) => x.nguon === "MAKEUP_CASE")!.tieuDe).toBe("Case bí mật");
  });
});
});
