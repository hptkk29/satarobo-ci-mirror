// [CNB-*] — luật THUẦN của case nhiều bài + điểm danh hai tầng (T07). Không chạm DB.
//
// Mỗi ca khẳng định MỘT luật; ca nào chỉ kiểm "ra gì đó" thì vô dụng. Các ca [CNB-04] duyệt TOÀN BỘ ma trận (từ × sang × dungLuot) — một cạnh
// mới trong bảng mà không ai khai ở đây là ca đỏ, không phải cạnh lặng lẽ tồn tại.
import { describe, expect, it } from "vitest";
import type { MakeupItemResult, MakeupParticipantAttendance } from "@prisma/client";
import {
  caseNhanThemV2,
  chotCase,
  chuyenMuc,
  guongTrangThai,
  keHoachDiemDanhBe,
  kiemBoBai,
  kiemNhomNhieuBai,
  TOI_DA_BAI_MOI_CASE,
  trangThaiCaseSauChot,
} from "@/lib/hoc-bu/case-nhieu-bai-thuan";
import { CANH_DONG, laCanhHopLe } from "@/lib/hoc-bu/dong-trang-thai";

const KET_QUA: MakeupItemResult[] = ["PLANNED", "COMPLETED", "NOT_COMPLETED", "RELEASED"];
const tv = (b: MakeupParticipantAttendance) => ({ attendanceStatus: b });

describe("[CNB] bộ bài của case", () => {
  it("[CNB-01] 1, 2, 3 bài hợp lệ và giữ thứ tự; 0 hoặc 4 bài hoặc trùng bị từ chối", () => {
    expect(TOI_DA_BAI_MOI_CASE).toBe(3);
    expect(kiemBoBai(["b5"])).toEqual({ ok: true, ids: ["b5"] });
    expect(kiemBoBai(["b7", "b5"])).toEqual({ ok: true, ids: ["b7", "b5"] });
    expect(kiemBoBai(["b5", "b6", "b7"])).toEqual({ ok: true, ids: ["b5", "b6", "b7"] });
    const bon = kiemBoBai(["b5", "b6", "b7", "b8"]);
    expect(bon.ok).toBe(false);
    expect(bon.ok ? "" : bon.lyDo).toContain("tối đa 3 bài");
    const rong = kiemBoBai([]);
    expect(rong.ok).toBe(false);
    const trung = kiemBoBai(["b5", "b5"]);
    expect(trung.ok).toBe(false);
    expect(trung.ok ? "" : trung.lyDo).toContain("hai lần");
  });

  const be = (hocVien: string, lessonId: string | null, o: { centerId?: string | null; courseId?: string } = {}) => ({
    hocVien,
    lessonId,
    centerId: o.centerId === undefined ? "cs1" : o.centerId,
    courseId: o.courseId ?? "k1",
  });

  it("[CNB-02] gom nhóm tạo case: A(5,6,7) + B(6,7) + C(7) ⇒ bộ bài 5,6,7; thêm D(8) ⇒ 4 bài ⇒ TỪ CHỐI; khác cơ sở / khoá / thiếu bài ⇒ từ chối", () => {
    const abc = [be("A", "b5"), be("A", "b6"), be("A", "b7"), be("B", "b6"), be("B", "b7"), be("C", "b7")];
    const ok = kiemNhomNhieuBai(abc);
    expect(ok).toEqual({ ok: true, centerId: "cs1", courseId: "k1", lessonIds: ["b5", "b6", "b7"] });
    const d = kiemNhomNhieuBai([...abc, be("D", "b8")]);
    expect(d.ok).toBe(false);
    expect(d.ok ? "" : d.lyDo).toContain("tối đa 3 bài");
    expect(kiemNhomNhieuBai([be("A", "b5"), be("B", "b6", { centerId: "cs2" })])).toMatchObject({ ok: false });
    expect(kiemNhomNhieuBai([be("A", "b5"), be("B", "b6", { courseId: "k2" })])).toMatchObject({ ok: false });
    expect(kiemNhomNhieuBai([be("A", null)])).toMatchObject({ ok: false });
    expect(kiemNhomNhieuBai([be("A", "b5", { centerId: null })])).toMatchObject({ ok: false });
    expect(kiemNhomNhieuBai([])).toMatchObject({ ok: false });
  });

  it("[CNB-03] case có sẵn nhận thêm CHỈ khi còn SCHEDULED, cùng cơ sở + khoá, và bài của bé nằm TRONG bộ bài của case", () => {
    const c = { status: "SCHEDULED", centerId: "cs1", courseId: "k1", lessonIds: ["b5", "b6", "b7"] };
    expect(caseNhanThemV2(c, [be("C", "b7")])).toEqual({ ok: true });
    const ngoai = caseNhanThemV2(c, [be("D", "b8")]);
    expect(ngoai.ok).toBe(false);
    expect(ngoai.ok ? "" : ngoai.lyDo).toContain("không nằm trong bộ bài");
    expect(caseNhanThemV2({ ...c, status: "COMPLETED" }, [be("C", "b7")])).toMatchObject({ ok: false });
    expect(caseNhanThemV2({ ...c, status: "NO_SHOW" }, [be("C", "b7")])).toMatchObject({ ok: false });
    expect(caseNhanThemV2(c, [be("C", "b7", { centerId: "cs2" })])).toMatchObject({ ok: false });
    expect(caseNhanThemV2(c, [be("C", "b7", { courseId: "k2" })])).toMatchObject({ ok: false });
    // Một bé trong nhóm lệch là cả nhóm bị từ chối (không xếp nửa chừng).
    expect(caseNhanThemV2(c, [be("C", "b7"), be("D", "b8")])).toMatchObject({ ok: false });
    expect(caseNhanThemV2(c, [be("C", null)])).toMatchObject({ ok: false });
  });
});

describe("[CNB] bảng chuyển trạng thái của một mục", () => {
  it("[CNB-04] mọi cạnh của bảng đều có dòng cần bù đi qua CẠNH HỢP LỆ của T05; ma trận đầy đủ (từ × sang × dungLuot) khớp bảng mong đợi", () => {
    const mong: Record<string, { luot: string; dong: [string, string, string] | null }> = {
      "PLANNED>RELEASED": { luot: "NHA", dong: ["SCHEDULED", "PENDING", "BE_VANG_CASE"] },
      "PLANNED>COMPLETED": { luot: "TIEU_TU_GIU", dong: ["SCHEDULED", "COMPLETED", "BE_CO_MAT_HOAN_THANH"] },
      "PLANNED>NOT_COMPLETED": { luot: "NHA", dong: ["SCHEDULED", "PENDING", "BE_VANG_CASE"] },
      "COMPLETED>NOT_COMPLETED": { luot: "DAO_TIEU", dong: ["COMPLETED", "PENDING", "SUA_DIEM_DANH_DAO_NGUOC"] },
      "COMPLETED>RELEASED": { luot: "DAO_TIEU", dong: ["COMPLETED", "PENDING", "SUA_DIEM_DANH_DAO_NGUOC"] },
      "NOT_COMPLETED>COMPLETED": { luot: "TIEU_KHONG_GIU", dong: ["PENDING", "COMPLETED", "SUA_DIEM_DANH_HOAN_THANH"] },
      "NOT_COMPLETED>RELEASED": { luot: "KHONG", dong: null },
    };
    let coCanh = 0;
    for (const tu of KET_QUA) {
      for (const den of KET_QUA) {
        for (const dungLuot of [true, false]) {
          const c = chuyenMuc(tu, den, dungLuot, "BE_VANG");
          const m = mong[`${tu}>${den}`];
          if (!m) {
            expect(c, `${tu}→${den} không phải cạnh`).toBeNull();
            continue;
          }
          expect(c, `${tu}→${den}`).not.toBeNull();
          coCanh++;
          // Mục KHÔNG xếp bằng lượt thì sổ lượt không bao giờ bị đụng (trả phí / miễn phí ngoại lệ không tiêu lượt).
          expect(c!.luot, `${tu}→${den} dungLuot=${dungLuot}`).toBe(dungLuot ? m.luot : "KHONG");
          if (m.dong === null) expect(c!.dong).toBeNull();
          else {
            expect([c!.dong!.tu, c!.dong!.sang, c!.dong!.lyDo]).toEqual(m.dong);
            // Mỗi bộ ba dòng cần bù phải nằm trong bảng cạnh T05 — nếu không, `chuyenTrangThaiDong` sẽ ném ở runtime.
            expect(laCanhHopLe(c!.dong!.tu, c!.dong!.sang, c!.dong!.lyDo), `${tu}→${den}`).toBe(true);
          }
        }
      }
    }
    expect(coCanh).toBe(7 * 2);
    // Mọi cạnh dòng được dùng nằm trong CANH_DONG (không cạnh nào bịa).
    expect(CANH_DONG.length).toBeGreaterThanOrEqual(11);
  });

  it("[CNB-04b] lý do gỡ quyết định lý do của cạnh dòng: bé vắng / gỡ khỏi case / huỷ case là ba câu chuyện khác nhau", () => {
    expect(chuyenMuc("PLANNED", "RELEASED", true, "BE_VANG")!.dong).toMatchObject({ lyDo: "BE_VANG_CASE" });
    expect(chuyenMuc("PLANNED", "RELEASED", true, "GO_KHOI")!.dong).toMatchObject({ lyDo: "GO_KHOI_CASE" });
    expect(chuyenMuc("PLANNED", "RELEASED", true, "HUY_CASE")!.dong).toMatchObject({ lyDo: "HUY_CASE" });
  });

  it("[CNB-05] bản gương `status`: PLANNED→PLACED, COMPLETED→PRESENT, NOT_COMPLETED→ABSENT; RELEASED→ABSENT nếu bé VẮNG, RELEASED nếu bị gỡ", () => {
    expect(guongTrangThai("PLANNED", false)).toBe("PLACED");
    expect(guongTrangThai("COMPLETED", false)).toBe("PRESENT");
    expect(guongTrangThai("NOT_COMPLETED", false)).toBe("ABSENT");
    expect(guongTrangThai("RELEASED", true)).toBe("ABSENT");
    expect(guongTrangThai("RELEASED", false)).toBe("RELEASED");
  });
});

describe("[CNB] chốt case", () => {
  it("[CNB-06] không còn bé chờ: có bé PRESENT ⇒ COMPLETED; chỉ có bé vắng ⇒ NO_SHOW; không còn bé nào ⇒ CANCELLED; còn bé chờ ⇒ chưa chốt", () => {
    expect(chotCase([])).toBe("CANCELLED");
    expect(chotCase([tv("REMOVED"), tv("REMOVED")])).toBe("CANCELLED");
    expect(chotCase([tv("PENDING")])).toBe("CHUA_CHOT");
    expect(chotCase([tv("PENDING"), tv("PRESENT")])).toBe("CHUA_CHOT");
    expect(chotCase([tv("PRESENT")])).toBe("COMPLETED");
    expect(chotCase([tv("PRESENT"), tv("ABSENT"), tv("REMOVED")])).toBe("COMPLETED");
    expect(chotCase([tv("ABSENT")])).toBe("NO_SHOW");
    expect(chotCase([tv("ABSENT"), tv("ABSENT"), tv("REMOVED")])).toBe("NO_SHOW");
    // Bé bị gỡ KHÔNG được đếm: gỡ nốt bé chờ cuối cùng khi các bé còn lại đều vắng ⇒ NO_SHOW (giáo viên vẫn có mặt).
    expect(chotCase([tv("ABSENT"), tv("REMOVED")])).toBe("NO_SHOW");
    expect(trangThaiCaseSauChot("CHUA_CHOT")).toBeNull();
    expect(trangThaiCaseSauChot("NO_SHOW")).toBe("NO_SHOW");
  });
});

describe("[CNB] kế hoạch điểm danh một bé", () => {
  const muc = (id: string, result: MakeupItemResult, dungLuot = true) => ({ id, result, dungLuot });

  it("[CNB-07] bé VẮNG ⇒ mọi mục PLANNED thành RELEASED (nhả lượt nếu giữ, dòng về PENDING); KHÔNG cần kết quả từng bài", () => {
    const kh = keHoachDiemDanhBe({ sau: "ABSENT", muc: [muc("m5", "PLANNED"), muc("m6", "PLANNED", false)], ketQua: {} });
    expect(kh.ok).toBe(true);
    if (!kh.ok) return;
    expect(kh.viec.map((v) => [v.id, v.den, v.chuyen.luot])).toEqual([
      ["m5", "RELEASED", "NHA"],
      ["m6", "RELEASED", "KHONG"],
    ]);
  });

  it("[CNB-08] bé CÓ MẶT: mỗi bài PHẢI có kết quả — thiếu một bài là từ chối (không tự suy 'có mặt ⇒ xong'); xong ⇒ tiêu, chưa xong ⇒ nhả", () => {
    const thieu = keHoachDiemDanhBe({ sau: "PRESENT", muc: [muc("m5", "PLANNED"), muc("m6", "PLANNED"), muc("m7", "PLANNED")], ketQua: { m5: "COMPLETED", m6: "COMPLETED" } });
    expect(thieu.ok).toBe(false);
    expect(thieu.ok ? "" : thieu.lyDo).toContain("không tự suy");
    const du = keHoachDiemDanhBe({
      sau: "PRESENT",
      muc: [muc("m5", "PLANNED"), muc("m6", "PLANNED"), muc("m7", "PLANNED")],
      ketQua: { m5: "COMPLETED", m6: "COMPLETED", m7: "NOT_COMPLETED" },
    });
    expect(du.ok).toBe(true);
    if (!du.ok) return;
    expect(du.viec.map((v) => [v.id, v.den, v.chuyen.luot, v.chuyen.dong?.sang])).toEqual([
      ["m5", "COMPLETED", "TIEU_TU_GIU", "COMPLETED"],
      ["m6", "COMPLETED", "TIEU_TU_GIU", "COMPLETED"],
      ["m7", "NOT_COMPLETED", "NHA", "PENDING"],
    ]);
    // Kết quả ngoài {xong, chưa xong} (vd. 'PLANNED' hay giá trị lạ) cũng là thiếu.
    const la = keHoachDiemDanhBe({ sau: "PRESENT", muc: [muc("m5", "PLANNED")], ketQua: { m5: "PLANNED" as never } });
    expect(la.ok).toBe(false);
  });

  it("[CNB-09] SỬA điểm danh: có mặt→vắng đảo mục đã xong (trả lượt) và bỏ mục chưa xong; bài ghi 'chưa xong' đổi thành 'xong' tiêu lại lượt; không đổi thì không có việc", () => {
    const dao = keHoachDiemDanhBe({ sau: "ABSENT", muc: [muc("m5", "COMPLETED"), muc("m7", "NOT_COMPLETED")], ketQua: {} });
    expect(dao.ok).toBe(true);
    if (!dao.ok) return;
    expect(dao.viec.map((v) => [v.id, v.tu, v.den, v.chuyen.luot, v.chuyen.dong?.lyDo ?? null])).toEqual([
      ["m5", "COMPLETED", "RELEASED", "DAO_TIEU", "SUA_DIEM_DANH_DAO_NGUOC"],
      ["m7", "NOT_COMPLETED", "RELEASED", "KHONG", null],
    ]);
    const doiBai = keHoachDiemDanhBe({ sau: "PRESENT", muc: [muc("m5", "COMPLETED"), muc("m7", "NOT_COMPLETED")], ketQua: { m5: "COMPLETED", m7: "COMPLETED" } });
    expect(doiBai.ok).toBe(true);
    if (!doiBai.ok) return;
    expect(doiBai.viec.map((v) => [v.id, v.chuyen.luot])).toEqual([["m7", "TIEU_KHONG_GIU"]]);
    const giu = keHoachDiemDanhBe({ sau: "PRESENT", muc: [muc("m5", "COMPLETED")], ketQua: { m5: "COMPLETED" } });
    expect(giu).toEqual({ ok: true, viec: [] });
  });

  it("[CNB-10] mục đã GỠ (RELEASED) bị bỏ qua; bé không còn mục sống nào ⇒ từ chối", () => {
    const kh = keHoachDiemDanhBe({ sau: "PRESENT", muc: [muc("m5", "RELEASED"), muc("m6", "PLANNED")], ketQua: { m6: "COMPLETED" } });
    expect(kh.ok).toBe(true);
    if (!kh.ok) return;
    expect(kh.viec.map((v) => v.id)).toEqual(["m6"]);
    expect(keHoachDiemDanhBe({ sau: "ABSENT", muc: [muc("m5", "RELEASED")], ketQua: {} })).toMatchObject({ ok: false });
  });

  it("[CNB-11] mục KHÔNG xếp bằng lượt (trả phí / miễn phí ngoại lệ) thì không bao giờ có việc với sổ lượt, dù xong / chưa xong / vắng / đảo", () => {
    for (const sau of ["PRESENT", "ABSENT"] as const) {
      for (const result of ["PLANNED", "COMPLETED", "NOT_COMPLETED"] as const) {
        const kh = keHoachDiemDanhBe({ sau, muc: [muc("m", result, false)], ketQua: { m: "COMPLETED" } });
        if (!kh.ok) continue;
        for (const v of kh.viec) expect(v.chuyen.luot, `${result}→${sau}`).toBe("KHONG");
      }
    }
  });
});
