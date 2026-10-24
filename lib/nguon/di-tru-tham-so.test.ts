/**
 * Ca [DTG-T*] — THAM SỐ DÒNG LỆNH của lệnh GHI backfill (hướng E). THUẦN. Mặc định = chạy thử; `--apply` đòi đủ bốn số đã duyệt.
 *
 *   [DTG-T1]  không cờ ⇒ CHAY_THU (đối chứng dương: không ghi); `--den` ở chạy thử được nhận
 *   [DTG-T2]  `--apply` đủ bốn số ⇒ GHI; thiếu MỘT trong bốn ⇒ từ chối, nêu đúng cái thiếu
 *   [DTG-T3]  sai hình (số âm · thập phân · hex ngắn · ISO không múi giờ) ⇒ từ chối
 *   [DTG-T4]  cờ lạ · trùng · thiếu giá trị · `--expect*` không có `--apply` ⇒ từ chối (không nuốt im lặng)
 *   [DTG-T5]  `--chap-nhan-nguon-chua-co-chu=MÃ,MÃ`: mặc định rỗng (không chấp nhận nguồn thiếu chủ nào); đã sắp; sai hình/trùng ⇒ lỗi; không có `--apply` ⇒ lỗi
 */
import { describe, expect, it } from "vitest";
import { kiemCode } from "./danh-muc-ghi-dau-vao";
import { docThamSoDiTru, dungLenhGhiDiTru } from "./di-tru-tham-so";

const SHA = "a".repeat(64);
const DEN = "2026-10-11T00:00:00+07:00";
const DAY_DU = ["--apply", "--expect=120", "--expect-review=7", `--den=${DEN}`, `--ke-hoach-sha=${SHA}`];

describe("[DTG-T1] mặc định là chạy thử", () => {
  it("không tham số ⇒ CHAY_THU, den null", () => {
    expect(docThamSoDiTru([])).toEqual({ ok: true, thamSo: { cheDo: "CHAY_THU", den: null } });
  });
  it("chạy thử nhận --den (để lập ĐÚNG kế hoạch sẽ duyệt) và đổi sang giờ UTC đúng", () => {
    const r = docThamSoDiTru([`--den=${DEN}`]);
    expect(r).toMatchObject({ ok: true, thamSo: { cheDo: "CHAY_THU" } });
    if (r.ok && r.thamSo.cheDo === "CHAY_THU") expect(r.thamSo.den?.toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });
});

describe("[DTG-T2] --apply đòi ĐỦ bốn số đã duyệt", () => {
  it("đủ ⇒ GHI với đúng số", () => {
    const r = docThamSoDiTru(DAY_DU);
    expect(r).toMatchObject({ ok: true, thamSo: { cheDo: "GHI", soDuyet: 120, soDuyetReview: 7, sha: SHA, choPhepEngineBat: false } });
  });
  it("0 là số hợp lệ (chạy lại sau khi đã ghi xong: N = 0, M = 0)", () => {
    const r = docThamSoDiTru(["--apply", "--expect=0", "--expect-review=0", `--den=${DEN}`, `--ke-hoach-sha=${SHA}`]);
    expect(r).toMatchObject({ ok: true, thamSo: { cheDo: "GHI", soDuyet: 0, soDuyetReview: 0 } });
  });
  it("thiếu MỘT trong bốn ⇒ từ chối và nêu đúng cái thiếu", () => {
    for (const bo of ["--expect=", "--expect-review=", "--den=", "--ke-hoach-sha="]) {
      const r = docThamSoDiTru(DAY_DU.filter((a) => !a.startsWith(bo)));
      expect(r.ok, bo).toBe(false);
      if (!r.ok) expect(r.loi, bo).toContain(bo.slice(0, -1));
    }
  });
  it("--cho-phep-engine-bat chỉ khi người chạy khai tường minh", () => {
    expect(docThamSoDiTru([...DAY_DU, "--cho-phep-engine-bat"])).toMatchObject({ ok: true, thamSo: { choPhepEngineBat: true } });
  });
});

describe("[DTG-T3] sai hình ⇒ từ chối", () => {
  const voi = (thay: Record<string, string>) =>
    DAY_DU.map((a) => {
      const khoa = a.split("=")[0]!;
      return thay[khoa] !== undefined ? `${khoa}=${thay[khoa]}` : a;
    });
  it("số âm · thập phân · chữ · có dấu cách ⇒ lỗi", () => {
    for (const v of ["-1", "1.5", "abc", "01", "1 2"]) {
      expect(docThamSoDiTru(voi({ "--expect": v })).ok, `expect=${v}`).toBe(false);
      expect(docThamSoDiTru(voi({ "--expect-review": v })).ok, `expect-review=${v}`).toBe(false);
    }
  });
  it("digest không phải 64 hex thường ⇒ lỗi", () => {
    for (const v of ["abc", "A".repeat(64), "g".repeat(64), "a".repeat(63)]) expect(docThamSoDiTru(voi({ "--ke-hoach-sha": v })).ok, v).toBe(false);
  });
  it("--den phải CÓ múi giờ: không múi giờ · không phải ngày · ngày không tồn tại ⇒ lỗi (cùng lệnh không được ra hai tập lead ở hai máy)", () => {
    for (const v of ["2026-10-11T00:00:00", "2026-10-11", "hôm nay", "2026-13-40T00:00:00Z"]) expect(docThamSoDiTru(voi({ "--den": v })).ok, v).toBe(false);
    expect(docThamSoDiTru(voi({ "--den": "2026-10-11T00:00:00Z" })).ok).toBe(true);
  });
});

describe("[DTG-T4] không nuốt tham số", () => {
  it("cờ lạ · tham số không có dấu -- · cờ khai hai lần ⇒ lỗi", () => {
    expect(docThamSoDiTru(["--force"]).ok).toBe(false);
    expect(docThamSoDiTru(["apply"]).ok).toBe(false);
    expect(docThamSoDiTru([...DAY_DU, "--expect=5"]).ok).toBe(false);
  });
  it("cờ không nhận giá trị / tham số bắt buộc giá trị mà trống ⇒ lỗi", () => {
    expect(docThamSoDiTru(["--apply=1"]).ok).toBe(false);
    expect(docThamSoDiTru(["--expect"]).ok).toBe(false);
    expect(docThamSoDiTru(["--den"]).ok).toBe(false);
  });
  it("--expect / --expect-review / --ke-hoach-sha / --cho-phep-engine-bat KHÔNG có --apply ⇒ lỗi (người chạy tưởng đã ghi, thật ra chỉ chạy thử)", () => {
    for (const a of ["--expect=5", "--expect-review=1", `--ke-hoach-sha=${SHA}`, "--cho-phep-engine-bat"]) {
      const r = docThamSoDiTru([a]);
      expect(r.ok, a).toBe(false);
      if (!r.ok) expect(r.loi).toMatch(/--apply/);
    }
  });
});

describe("[DTG-T5] --chap-nhan-nguon-chua-co-chu — chấp nhận nguồn thiếu chủ phải TƯỜNG MINH", () => {
  it("mặc định (không khai) ⇒ danh sách rỗng = KHÔNG chấp nhận nguồn nào", () => {
    expect(docThamSoDiTru(DAY_DU)).toMatchObject({ ok: true, thamSo: { cheDo: "GHI", chapNhanNguonChuaCoChu: [] } });
  });
  it("khai danh sách ⇒ nhận, đã SẮP (không phụ thuộc thứ tự gõ)", () => {
    expect(docThamSoDiTru([...DAY_DU, "--chap-nhan-nguon-chua-co-chu=UNKNOWN,CENTER_ORGANIC"])).toMatchObject({
      ok: true,
      thamSo: { chapNhanNguonChuaCoChu: ["CENTER_ORGANIC", "UNKNOWN"] },
    });
  });
  it("MỌI mã nguồn hợp lệ theo bộ kiểm của màn tạo nguồn (`kiemCode`: A–Z, 0–9, _; 3–40 ký tự) đều khai được — kể cả mã bắt đầu bằng CHỮ SỐ hoặc dài đúng 40 ký tự", () => {
    // Nguồn là master data do admin tạo: nếu cờ này hẹp hơn `kiemCode`, kế hoạch có nguồn mang mã «lạ» và chưa có chủ sẽ KHÔNG BAO GIỜ thoả cổng ⇒ backfill không ghi được.
    const rongNhat = ["7_ELEVEN", "2026_EVENT", "_AB", "9_".padEnd(40, "X"), "ABC"];
    for (const ma of rongNhat) {
      expect(kiemCode(ma), `tiền đề: «${ma}» phải hợp lệ theo màn tạo nguồn`).toBeNull();
      expect(docThamSoDiTru([...DAY_DU, `--chap-nhan-nguon-chua-co-chu=${ma}`]), ma).toMatchObject({ ok: true, thamSo: { chapNhanNguonChuaCoChu: [ma] } });
    }
  });
  it("sai hình (rỗng · phần tử rỗng · chữ thường · khoảng trắng · ký tự lạ) hoặc trùng mã ⇒ lỗi", () => {
    for (const v of ["", "A,,B", "unknown", "A, B", "A;B", "A-B", "UNKNOWN,UNKNOWN"]) {
      expect(docThamSoDiTru([...DAY_DU, `--chap-nhan-nguon-chua-co-chu=${v}`]).ok, v).toBe(false);
    }
  });
  it("KHÔNG có --apply ⇒ lỗi (như mọi cờ ghi khác: người chạy tưởng đã ghi)", () => {
    const r = docThamSoDiTru(["--chap-nhan-nguon-chua-co-chu=UNKNOWN"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi).toMatch(/--apply/);
  });
});

describe("[DTG-T6] lệnh GHI in ở báo cáo chạy thử PHẢI là lệnh mà bộ đọc tham số THẬT chấp nhận (runbook khớp CLI)", () => {
  // Vì sao cần (§18): báo cáo chạy thử in tên Ô WORKFLOW (`so_duyet`, `ke_hoach_sha`, `chap_nhan_nguon_chua_chu`) chứ không phải cờ dòng lệnh; runbook trong 09 viết «báo cáo in sẵn dòng
  // --chap-nhan-nguon-chua-co-chu=…» — câu đó SAI. Nay báo cáo in cả lệnh, và ca này khoá bằng ĐÒN BẨY ngược: parse(lệnh) ra đúng các số đã đưa vào.
  const DEN_D = new Date("2026-10-11T17:00:00.000Z");
  it("có nguồn thiếu chủ: parse(argv) khôi phục đúng N · M · digest · den · danh sách (đã sắp) và KHÔNG tự thêm cờ vượt rào", () => {
    const { argv, lenh } = dungLenhGhiDiTru({ soDuyet: 120, soDuyetReview: 7, sha: SHA, den: DEN_D, chapNhanNguonChuaCoChu: ["UNKNOWN", "CENTER_ORGANIC"] });
    const r = docThamSoDiTru(argv);
    expect(r).toMatchObject({ ok: true, thamSo: { cheDo: "GHI", soDuyet: 120, soDuyetReview: 7, sha: SHA, choPhepEngineBat: false, chapNhanNguonChuaCoChu: ["CENTER_ORGANIC", "UNKNOWN"] } });
    if (r.ok && r.thamSo.cheDo === "GHI") expect(r.thamSo.den.toISOString()).toBe(DEN_D.toISOString());
    expect(lenh).toBe(`pnpm exec tsx scripts/nguon/di-tru-nguon-cu-ghi.ts ${argv.join(" ")}`);
    expect(lenh).not.toContain("--cho-phep-engine-bat");
  });
  it("không có nguồn thiếu chủ: KHÔNG in cờ --chap-nhan… (khai mã khi không có nguồn thiếu chủ bị cổng từ chối) và vẫn parse được", () => {
    const { argv } = dungLenhGhiDiTru({ soDuyet: 0, soDuyetReview: 0, sha: SHA, den: DEN_D, chapNhanNguonChuaCoChu: [] });
    expect(argv.some((a) => a.startsWith("--chap-nhan"))).toBe(false);
    expect(docThamSoDiTru(argv)).toMatchObject({ ok: true, thamSo: { cheDo: "GHI", soDuyet: 0, soDuyetReview: 0, chapNhanNguonChuaCoChu: [] } });
  });
});
