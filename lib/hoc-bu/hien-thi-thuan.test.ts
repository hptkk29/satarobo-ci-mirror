// lib/hoc-bu/hien-thi-thuan.test.ts — T16: luật hiển thị THUẦN của màn học bù (form điểm danh gửi gì · sức chứa · giải thích lượt).
import { describe, it, expect } from "vitest";
import { giaiThichLuot, kiemKetQuaGui, lyDoSuaThieu, nhanKetQuaMuc, trangThaiSucChua, type BieuGhiLuot, type LuaChonMuc } from "@/lib/hoc-bu/hien-thi-thuan";

const MUC = [
  { id: "m5", tenBai: "Bài 5" },
  { id: "m6", tenBai: "Bài 6" },
  { id: "m7", tenBai: "Bài 7" },
];

describe("[HTT-01..] kiemKetQuaGui — có mặt thì MỖI bài phải có kết quả, không tự suy", () => {
  it("[HTT-01] thiếu kết quả của bài nào thì NÓI bài đó, và không cho gửi", () => {
    const lc: LuaChonMuc = { m5: { ketQua: "COMPLETED", danhGia: "" }, m6: { ketQua: null, danhGia: "" }, m7: { ketQua: null, danhGia: "x" } };
    const r = kiemKetQuaGui(MUC, lc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.thieu).toEqual(["Bài 6", "Bài 7"]);
    expect(r.lyDo).toContain("Bài 6, Bài 7");
    expect(r.lyDo).toContain("các bài");
  });

  it("[HTT-01b] thiếu đúng một bài ⇒ câu số ít", () => {
    const r = kiemKetQuaGui(MUC.slice(0, 1), { m5: { ketQua: null, danhGia: "" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lyDo).toContain("cho bài:");
  });

  it("[HTT-02] đủ kết quả ⇒ gửi đúng từng bài; đánh giá trống = null, có chữ thì cắt khoảng trắng", () => {
    const r = kiemKetQuaGui(MUC, {
      m5: { ketQua: "COMPLETED", danhGia: "  Hiểu bài  " },
      m6: { ketQua: "COMPLETED", danhGia: "   " },
      m7: { ketQua: "NOT_COMPLETED", danhGia: "" },
    });
    expect(r).toEqual({
      ok: true,
      ketQuaMuc: {
        m5: { ketQua: "COMPLETED", danhGia: "Hiểu bài" },
        m6: { ketQua: "COMPLETED", danhGia: null },
        m7: { ketQua: "NOT_COMPLETED", danhGia: null },
      },
    });
  });

  it("[HTT-03] không có bài nào (bé chưa có mục sống) ⇒ gửi rỗng được, không bịa kết quả", () => {
    expect(kiemKetQuaGui([], {})).toEqual({ ok: true, ketQuaMuc: {} });
  });

  it("[HTT-04] lựa chọn của bài không có trong form bị BỎ, không lọt vào payload", () => {
    const r = kiemKetQuaGui(MUC.slice(0, 1), { m5: { ketQua: "COMPLETED", danhGia: "" }, laX: { ketQua: "COMPLETED", danhGia: "lạ" } });
    expect(r.ok && Object.keys(r.ketQuaMuc)).toEqual(["m5"]);
  });
});

describe("[HTT-05..] lyDoSuaThieu — ngưỡng 10 ký tự, cùng ngưỡng huỷ / miễn phí", () => {
  it("[HTT-05] 9 ký tự (sau khi cắt) ⇒ nói còn thiếu; 10 ⇒ đủ (null)", () => {
    expect(lyDoSuaThieu("123456789")).toContain("đang có 9");
    expect(lyDoSuaThieu("   123456789   ")).toContain("đang có 9");
    expect(lyDoSuaThieu("1234567890")).toBeNull();
    expect(lyDoSuaThieu("")).toContain("đang có 0");
  });
});

describe("[HTT-06..] trangThaiSucChua — nói thật khi chưa biết, cảnh báo khi vượt", () => {
  it("[HTT-06] chưa xếp phòng ⇒ KHONG_BIET, không bịa sức chứa", () => {
    const r = trangThaiSucChua(4, null);
    expect(r.muc).toBe("KHONG_BIET");
    expect(r.nhan).toContain("chưa xếp phòng");
  });
  it("[HTT-07] ranh giới: thoải mái · đầy · vượt", () => {
    expect(trangThaiSucChua(5, 6).muc).toBe("THOAI_MAI");
    expect(trangThaiSucChua(6, 6).muc).toBe("GAN_DAY");
    expect(trangThaiSucChua(7, 6).muc).toBe("VUOT");
    expect(trangThaiSucChua(7, 6).nhan).toContain("VƯỢT");
    expect(trangThaiSucChua(0, 6).muc).toBe("THOAI_MAI");
  });
});

describe("[HTT-08] nhanKetQuaMuc — mỗi kết quả một nhãn riêng", () => {
  it("[HTT-08] 4 kết quả ⇒ 4 nhãn khác nhau, 'chưa xong' nói sẽ xếp bù lại", () => {
    const nhan = (["PLANNED", "COMPLETED", "NOT_COMPLETED", "RELEASED"] as const).map((r) => nhanKetQuaMuc(r).nhan);
    expect(new Set(nhan).size).toBe(4);
    expect(nhanKetQuaMuc("NOT_COMPLETED").nhan).toContain("xếp bù lại");
    expect(nhanKetQuaMuc("COMPLETED").tone).toBe("success");
  });
});

describe("[HTT-09..] giaiThichLuot — đọc từ bút toán thật", () => {
  const t = (s: string) => new Date(`${s}T00:00:00Z`);
  const SO = { granted: 3, held: 1, consumed: 1 };
  const BUT: BieuGhiLuot[] = [
    { type: "GRANT", grantedDelta: 3, heldDelta: 0, consumedDelta: 0, reason: "Cấp theo khoá", createdAt: t("2026-09-01") },
    { type: "HOLD", grantedDelta: 0, heldDelta: 1, consumedDelta: 0, reason: null, createdAt: t("2026-09-10") },
    { type: "CONSUME", grantedDelta: 0, heldDelta: -1, consumedDelta: 1, reason: null, createdAt: t("2026-09-12") },
    { type: "HOLD", grantedDelta: 0, heldDelta: 1, consumedDelta: 0, reason: null, createdAt: t("2026-09-20") },
  ];

  it("[HTT-09] còn = cấp − giữ − dùng, và câu tóm tắt nói đủ ba vế", () => {
    const g = giaiThichLuot(SO, BUT);
    expect(g.con).toBe(1);
    expect(g.tomTat).toBe("Được cấp 3 lượt, đang giữ 1 cho buổi đã xếp case, đã dùng 1 cho buổi đã học ⇒ còn 1.");
  });

  it("[HTT-09b] không giữ / không dùng thì không nhắc vế đó", () => {
    expect(giaiThichLuot({ granted: 2, held: 0, consumed: 0 }, []).tomTat).toBe("Được cấp 2 lượt ⇒ còn 2.");
  });

  it("[HTT-10] bút toán xếp MỚI NHẤT TRƯỚC, mỗi dòng đọc được (không phải ba cột số trần)", () => {
    const g = giaiThichLuot(SO, BUT);
    expect(g.dong.map((d) => d.ngay.toISOString().slice(0, 10))).toEqual(["2026-09-20", "2026-09-12", "2026-09-10", "2026-09-01"]);
    expect(g.dong[0]).toMatchObject({ nhan: "Giữ lượt cho buổi đã xếp", thayDoi: "giữ 1" });
    expect(g.dong[1]).toMatchObject({ nhan: "Dùng lượt (đã học)", thayDoi: "dùng 1" });
    expect(g.dong[3]).toMatchObject({ nhan: "Cấp lượt", thayDoi: "+3 lượt được cấp", lyDo: "Cấp theo khoá" });
  });

  it("[HTT-11] nhả lượt và trả lại lượt đã dùng (sửa điểm danh có mặt → vắng) đọc ra đúng chiều", () => {
    const g = giaiThichLuot(
      { granted: 3, held: 0, consumed: 0 },
      [
        { type: "RELEASE", grantedDelta: 0, heldDelta: -1, consumedDelta: 0, reason: null, createdAt: t("2026-09-02") },
        { type: "ADJUSTMENT", grantedDelta: 0, heldDelta: 0, consumedDelta: -1, reason: "Sửa điểm danh", createdAt: t("2026-09-03") },
      ],
    );
    expect(g.dong.map((d) => d.thayDoi)).toEqual(["trả lại 1 đã dùng", "nhả 1"]);
  });

  it("[HTT-12] sổ trống ⇒ không có dòng nào, tóm tắt vẫn trả lời", () => {
    const g = giaiThichLuot({ granted: 0, held: 0, consumed: 0 }, []);
    expect(g.dong).toEqual([]);
    expect(g.con).toBe(0);
  });

  it("[HTT-13] không đổi mảng đầu vào (hàm thuần)", () => {
    const sao = [...BUT];
    giaiThichLuot(SO, BUT);
    expect(BUT).toEqual(sao);
  });
});
