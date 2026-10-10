/**
 * Ca test cho lõi dựng + ghi dòng chỉnh giờ tay.
 *
 * Phần dựng dòng THUẦN nên kiểm được mọi tổ hợp không cần Postgres. `ghiDongChinhTay` kiểm
 * ở đây bằng một `tx` giả (đếm lời gọi, thứ tự phép ghi); hành vi trên Postgres THẬT — lượt
 * cũ còn trong DB với `DISMISSED`, engine chỉ tính từ mốc mới, kỳ chốt chặn mà không ghi gì
 * — kiểm ở `tests/cham-cong/sua-gio-quet-tay.spec.ts` và `tests/cham-cong/requests.spec.ts`
 * (luật 9: cổng phải được cho ăn bằng đường thật).
 *
 * ĐẢO 06/10/2026 (chủ dự án chốt): sửa tay của quản lý là GHI ĐÈ THẬT, đơn chỉnh công nâng
 * lên 4 mốc. Các ca "chỉ ghi thêm / sửa lẻ một mốc không kiểm thứ tự" cũ được viết lại theo
 * luật mới — ghi rõ trong từng ca.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CO_CHINH_TAY,
  LUOT_CON_TINH,
  cheDoChoDon,
  chuanHoaMoc,
  dungDongChinhTay,
  ghiChuDaBiThay,
  ghiDongChinhTay,
  kiemDanhSachMoc,
  laLuotDaBiThay,
  moTaMoc,
  mocDienSan,
  soMocCuaCa,
  vnTimeOn,
  type TxGhiChinhTay,
} from "./sua-gio-quet";

/** 09/09/2026, mốc `@db.Date` = nửa đêm UTC. */
const NGAY = new Date(Date.UTC(2026, 8, 9));
const LUC = new Date(Date.UTC(2026, 8, 9, 10, 0));

const CO_BAN = {
  userId: "u1",
  centerId: "cs1",
  orgUnitId: "ou1",
  workDate: NGAY,
  actorId: "quanly",
  now: LUC,
  lyDo: "Quầy hỏng, người này có mặt",
  canCu: { kieu: "SUA_TAY" } as const,
  cheDo: "GHI_DE" as const,
};

describe("vnTimeOn — 'HH:mm' giờ VN → thời điểm tuyệt đối", () => {
  it("trừ đúng 7 giờ: 08:00 VN = 01:00 UTC cùng ngày", () => {
    expect(vnTimeOn(NGAY, "08:00")?.toISOString()).toBe("2026-09-09T01:00:00.000Z");
  });

  it("giờ sáng sớm lùi sang NGÀY TRƯỚC theo UTC — đúng, đừng 'sửa'", () => {
    // 05:00 VN = 22:00 UTC hôm trước. Đây là hành vi đúng của một mốc tuyệt đối; ai thấy
    // ngày lệch mà đi kẹp lại là làm sai giờ thật.
    expect(vnTimeOn(NGAY, "05:00")?.toISOString()).toBe("2026-09-08T22:00:00.000Z");
  });

  it("nhận '8:00' thiếu số 0 đầu", () => {
    expect(vnTimeOn(NGAY, "8:00")?.toISOString()).toBe("2026-09-09T01:00:00.000Z");
  });

  it("cắt khoảng trắng hai đầu", () => {
    expect(vnTimeOn(NGAY, "  08:00 ")).not.toBeNull();
  });

  it.each(["", "8h00", "08:60", "24:00", "abc", "08", "08:0", "-1:00"])(
    "từ chối chuỗi giờ hỏng: %s",
    (s) => {
      expect(vnTimeOn(NGAY, s)).toBeNull();
    },
  );

  it("nhận 23:59 nhưng từ chối 24:00 — ngưỡng là <= 23, không phải < 24 rồi làm tròn", () => {
    expect(vnTimeOn(NGAY, "23:59")).not.toBeNull();
    expect(vnTimeOn(NGAY, "24:00")).toBeNull();
  });
});

describe("chuanHoaMoc / soMocCuaCa / cheDoChoDon / moTaMoc", () => {
  it("chuanHoaMoc: trim, rỗng → null, cắt ô trống ở CUỐI nhưng giữ chỗ ô trống ở GIỮA", () => {
    expect(chuanHoaMoc([" 08:00 ", "", null, undefined])).toEqual(["08:00"]);
    expect(chuanHoaMoc([null, "17:00"])).toEqual([null, "17:00"]);
    expect(chuanHoaMoc(["", "  "])).toEqual([]);
  });

  it("soMocCuaCa theo soCapQuetKyVong — KHÔNG theo số đoạn WORK (CG hai đoạn, một cặp)", () => {
    expect(soMocCuaCa(2)).toBe(4);
    expect(soMocCuaCa(1)).toBe(2);
    expect(soMocCuaCa(0)).toBe(2);
    expect(soMocCuaCa(null)).toBe(2);
  });

  it("cheDoChoDon: đủ bộ mốc của ca, liền nhau từ Vào 1 ⇒ GHI_DE", () => {
    expect(cheDoChoDon(["08:00", "17:30"], 2)).toBe("GHI_DE");
    expect(cheDoChoDon(["07:45", "11:30", "17:15", "21:00"], 4)).toBe("GHI_DE");
    // Ca một cặp mà đơn khai 4 mốc ⇒ vẫn đủ (≥ bộ).
    expect(cheDoChoDon(["07:45", "11:30", "13:30", "17:30"], 2)).toBe("GHI_DE");
  });

  it("cheDoChoDon: thiếu bộ ⇒ GHI_THEM — đơn 'quên quét ra' KHÔNG được xoá lượt vào thật", () => {
    expect(cheDoChoDon(["08:00"], 2)).toBe("GHI_THEM");
    expect(cheDoChoDon([null, "17:30"], 2)).toBe("GHI_THEM");
    expect(cheDoChoDon(["07:45", "11:30"], 4)).toBe("GHI_THEM");
    // Đủ 4 ô nhưng bỏ trống ô giữa ⇒ không phải một bộ liền ⇒ ghi thêm.
    expect(cheDoChoDon(["07:45", null, "17:15", "21:00"], 4)).toBe("GHI_THEM");
    expect(cheDoChoDon([], 2)).toBe("GHI_THEM");
  });

  it("moTaMoc: đơn hai mốc không in số thứ tự; có mốc lần 2 thì in đủ 'vào 1/ra 1/…'", () => {
    expect(moTaMoc(["08:00", "17:30"])).toBe("vào 08:00, ra 17:30");
    expect(moTaMoc([null, "17:30"])).toBe("ra 17:30");
    expect(moTaMoc(["07:45", "11:30", "17:15", "21:00"])).toBe(
      "vào 1 07:45, ra 1 11:30, vào 2 17:15, ra 2 21:00",
    );
    expect(moTaMoc([null, null, null, null])).toBe("");
  });

  it("LUOT_CON_TINH: ACCEPTED VÀ chưa bị thay — hằng duy nhất mọi câu tính công dùng", () => {
    expect(LUOT_CON_TINH).toEqual({ result: "ACCEPTED", reviewStatus: { not: "DISMISSED" } });
    expect(laLuotDaBiThay({ reviewStatus: "DISMISSED" })).toBe(true);
    expect(laLuotDaBiThay({ reviewStatus: "PENDING" })).toBe(false);
    expect(laLuotDaBiThay({ reviewStatus: "CONFIRMED" })).toBe(false);
  });
});

describe("[MDS] mocDienSan — form ghi đè điền sẵn lượt đã quét (07/10/2026)", () => {
  const t = (time: string, dir: "IN" | "OUT") => ({ time, dir });

  it("[MDS-01] ca thật 04/10: Vào, Ra, Ra, Ra (chiều sai) ⇒ VẪN điền đủ 4 ô theo giờ + cảnh báo", () => {
    const r = mocDienSan([t("07:48", "IN"), t("11:39", "OUT"), t("13:28", "OUT"), t("17:42", "OUT")], 2);
    expect(r.moc).toEqual(["07:48", "11:39", "13:28", "17:42"]);
    expect(r.canhBao).toMatch(/chiều Vào\/Ra chưa khớp/);
    // Điền sẵn phải qua được chính cổng của nút Ghi đè.
    expect(kiemDanhSachMoc(NGAY, r.moc, "GHI_DE").ok).toBe(true);
  });

  it("[MDS-02] chiều đúng khuôn ⇒ điền, KHÔNG cảnh báo; ít lượt hơn ca ⇒ ô còn lại trống", () => {
    expect(mocDienSan([t("08:00", "IN"), t("17:30", "OUT")], 2)).toEqual({ moc: ["08:00", "17:30"], canhBao: null });
    expect(mocDienSan([t("08:00", "IN"), t("11:30", "OUT")], 4)).toEqual({
      moc: ["08:00", "11:30", "", ""],
      canhBao: null,
    });
  });

  it("[MDS-03] sắp theo GIỜ, không theo thứ tự đầu vào; trùng phút giữ một", () => {
    const r = mocDienSan([t("17:30", "OUT"), t("08:00", "IN"), t("08:00", "IN")], 2);
    expect(r.moc).toEqual(["08:00", "17:30"]);
    expect(r.canhBao).toBeNull();
  });

  it("[MDS-04] > 4 lượt ⇒ lượt đầu + lượt cuối, KHÔNG đoán mốc giữa", () => {
    const nam = [t("07:50", "IN"), t("11:30", "OUT"), t("11:31", "IN"), t("13:30", "IN"), t("17:40", "OUT")];
    expect(mocDienSan(nam, 2).moc).toEqual(["07:50", "17:40"]);
    const r4 = mocDienSan(nam, 4);
    expect(r4.moc).toEqual(["07:50", "", "", "17:40"]);
    expect(r4.canhBao).toMatch(/5 lượt/);
  });

  it("[MDS-05] chưa quét lượt nào ⇒ ô trống theo số mốc của ca, không cảnh báo", () => {
    expect(mocDienSan([], 4)).toEqual({ moc: ["", "", "", ""], canhBao: null });
  });
});

describe("kiemDanhSachMoc", () => {
  it("4 mốc tăng dần ⇒ đúng chiều theo vị trí [vào, ra, vào, ra]", () => {
    const r = kiemDanhSachMoc(NGAY, ["07:45", "11:30", "17:15", "21:00"], "GHI_DE");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.moc.map((m) => m.direction)).toEqual(["CHECK_IN", "CHECK_OUT", "CHECK_IN", "CHECK_OUT"]);
  });

  it("Ra 1 trước Vào 1 ⇒ từ chối, câu nói đúng cặp", () => {
    const r = kiemDanhSachMoc(NGAY, ["17:00", "08:00"], "GHI_DE");
    expect(!r.ok && r.error).toContain("phải sau giờ vào");
  });

  it("Vào 2 KHÔNG sau Ra 1 ⇒ từ chối (hai cặp chồng nhau)", () => {
    const r = kiemDanhSachMoc(NGAY, ["07:45", "11:30", "11:00", "21:00"], "GHI_DE");
    expect(!r.ok && r.error).toContain("Vào 2 (11:00) phải sau Ra 1 (11:30)");
  });

  it("mốc trùng phút ⇒ từ chối (ngưỡng là <=, không phải <)", () => {
    expect(kiemDanhSachMoc(NGAY, ["08:00", "08:00"], "GHI_DE").ok).toBe(false);
  });

  it("GHI_DE: bỏ trống ô GIỮA ⇒ từ chối (sẽ dựng một ngày VÀO–VÀO)", () => {
    const r = kiemDanhSachMoc(NGAY, ["07:45", null, "13:30", "17:30"], "GHI_DE");
    expect(!r.ok && r.error).toContain("bỏ trống ô Ra 1");
  });

  it("GHI_THEM: bỏ trống ô giữa ĐƯỢC — đơn chỉ khai giờ ra", () => {
    const r = kiemDanhSachMoc(NGAY, [null, "17:45"], "GHI_THEM");
    expect(r.ok && r.moc.map((m) => m.direction)).toEqual(["CHECK_OUT"]);
  });

  it("quá 4 mốc ⇒ từ chối", () => {
    expect(kiemDanhSachMoc(NGAY, ["07:00", "08:00", "09:00", "10:00", "11:00"], "GHI_THEM").ok).toBe(false);
  });

  it("không mốc nào ⇒ từ chối", () => {
    expect(kiemDanhSachMoc(NGAY, [null, ""], "GHI_THEM").ok).toBe(false);
  });
});

describe("dungDongChinhTay", () => {
  it("dựng ĐỦ hai mốc, đúng hình dạng dòng MANUAL_ADJUST", () => {
    const r = dungDongChinhTay({ ...CO_BAN, moc: ["08:00", "17:30"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    const vao = r.rows.find((x) => x.direction === "CHECK_IN")!;
    expect(vao).toMatchObject({
      userId: "u1",
      centerId: "cs1",
      orgUnitId: "ou1",
      source: "MANUAL_ADJUST",
      result: "ACCEPTED",
      reviewStatus: "CONFIRMED",
      reviewedById: "quanly",
      adjustRequestId: null,
      flags: [CO_CHINH_TAY],
    });
    expect(vao.reviewedAt).toEqual(LUC);
    expect(vao.workDate).toEqual(NGAY);
    expect((vao.loggedAt as Date).toISOString()).toBe("2026-09-09T01:00:00.000Z");
  });

  it("dựng ĐỦ BỐN mốc (ca hai buổi) — đúng thứ tự, đúng chiều", () => {
    const r = dungDongChinhTay({ ...CO_BAN, moc: ["07:45", "11:30", "17:15", "21:00"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((x) => [x.direction, (x.loggedAt as Date).toISOString()])).toEqual([
      ["CHECK_IN", "2026-09-09T00:45:00.000Z"],
      ["CHECK_OUT", "2026-09-09T04:30:00.000Z"],
      ["CHECK_IN", "2026-09-09T10:15:00.000Z"],
      ["CHECK_OUT", "2026-09-09T14:00:00.000Z"],
    ]);
  });

  // ── KHÁC BIỆT giữa hai đường ────────────────────────────────────────────────
  it("đường qua ĐƠN mang adjustRequestId; đường SỬA TAY mang null", () => {
    const qua = dungDongChinhTay({
      ...CO_BAN,
      cheDo: "GHI_THEM",
      moc: ["08:00"],
      canCu: { kieu: "DON", requestId: "req-9" },
    });
    const tay = dungDongChinhTay({ ...CO_BAN, moc: ["08:00"] });
    expect(qua.ok && qua.rows[0]?.adjustRequestId).toBe("req-9");
    expect(tay.ok && tay.rows[0]?.adjustRequestId).toBeNull();
  });

  it("hai đường GIỐNG NHAU ở mọi trường còn lại — đó là lý do có file này", () => {
    const qua = dungDongChinhTay({
      ...CO_BAN,
      moc: ["08:00", "17:30"],
      canCu: { kieu: "DON", requestId: "req-9" },
    });
    const tay = dungDongChinhTay({ ...CO_BAN, moc: ["08:00", "17:30"] });
    expect(qua.ok && tay.ok).toBe(true);
    if (!qua.ok || !tay.ok) return;
    const boCanCu = (r: (typeof qua.rows)[number]) => ({ ...r, adjustRequestId: undefined });
    expect(qua.rows.map(boCanCu)).toEqual(tay.rows.map(boCanCu));
  });

  // ── ghi thêm một mốc (đơn quên quét) ────────────────────────────────────────
  it("GHI_THEM chỉ giờ VÀO ⇒ đúng một dòng CHECK_IN, KHÔNG dựng dòng ra rỗng", () => {
    const r = dungDongChinhTay({ ...CO_BAN, cheDo: "GHI_THEM", moc: ["08:15"] });
    expect(r.ok && r.rows).toHaveLength(1);
    expect(r.ok && r.rows[0]?.direction).toBe("CHECK_IN");
  });

  it("GHI_THEM chỉ giờ RA (ô Vào 1 trống) ⇒ đúng một dòng CHECK_OUT", () => {
    const r = dungDongChinhTay({ ...CO_BAN, cheDo: "GHI_THEM", moc: [null, "17:45"] });
    expect(r.ok && r.rows).toHaveLength(1);
    expect(r.ok && r.rows[0]?.direction).toBe("CHECK_OUT");
  });

  it("GHI_DE chỉ giờ RA (ô Vào 1 trống) ⇒ TỪ CHỐI — đảo 06/10: ghi đè phải liền nhau từ Vào 1", () => {
    // Trước 06/10 sửa tay một mình giờ ra là hợp lệ vì nó chỉ THÊM dòng. Nay sửa tay là ghi đè:
    // bức tranh sau lượt sửa CHỈ còn mốc vừa nhập, nên "chỉ một giờ ra" là một ngày không có
    // giờ vào — dữ liệu vô nghĩa do chính quản lý dựng ra.
    const r = dungDongChinhTay({ ...CO_BAN, moc: [null, "17:45"] });
    expect(r.ok).toBe(false);
  });

  it("không mốc nào ⇒ từ chối, và câu báo KHÁC nhau theo căn cứ", () => {
    const tay = dungDongChinhTay({ ...CO_BAN, moc: [null, null] });
    expect(tay.ok).toBe(false);
    expect(!tay.ok && tay.error).toContain("ít nhất một mốc");

    const don = dungDongChinhTay({
      ...CO_BAN, cheDo: "GHI_THEM", moc: [], canCu: { kieu: "DON", requestId: "r" },
    });
    expect(!don.ok && don.error).toContain("Đơn không có giờ");
  });

  // ── thứ tự mốc ──────────────────────────────────────────────────────────────
  it("giờ ra TRƯỚC giờ vào ⇒ từ chối, không để engine tính ra số âm rồi kẹp về 0", () => {
    const r = dungDongChinhTay({ ...CO_BAN, moc: ["17:00", "08:00"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("phải sau giờ vào");
  });

  it("giờ ra BẰNG giờ vào ⇒ từ chối (ngưỡng là <=, không phải <)", () => {
    expect(dungDongChinhTay({ ...CO_BAN, moc: ["08:00", "08:00"] }).ok).toBe(false);
  });

  it("một mốc đơn lẻ thì không có gì để so thứ tự — hợp lệ", () => {
    // Bản cũ có ca "sửa LẺ một mốc thì KHÔNG kiểm thứ tự — bức tranh đúng nằm ở DB". Nay mọi
    // mốc trong MỘT lượt đều được so với nhau; một mốc thì không có cặp nào để so.
    expect(dungDongChinhTay({ ...CO_BAN, cheDo: "GHI_THEM", moc: [null, "05:00"] }).ok).toBe(true);
  });

  // ── lý do ───────────────────────────────────────────────────────────────────
  it("lý do vào `reviewNote`, và khoảng trắng thuần ⇒ null chứ không phải chuỗi rỗng", () => {
    const co = dungDongChinhTay({ ...CO_BAN, moc: ["08:00"] });
    expect(co.ok && co.rows[0]?.reviewNote).toBe("Quầy hỏng, người này có mặt");

    const khong = dungDongChinhTay({ ...CO_BAN, lyDo: "   ", moc: ["08:00"] });
    expect(khong.ok && khong.rows[0]?.reviewNote).toBeNull();
  });

  it("giờ hỏng ⇒ từ chối CẢ LƯỢT, không ghi nửa vời một dòng", () => {
    // Ghi được dòng vào rồi mới phát hiện dòng ra hỏng là để lại một ngày méo.
    const r = dungDongChinhTay({ ...CO_BAN, moc: ["08:00", "25:00"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("25:00");
  });

  it("orgUnitId null được giữ nguyên là null, không đổi thành chuỗi rỗng", () => {
    const r = dungDongChinhTay({ ...CO_BAN, orgUnitId: null, moc: ["08:00"] });
    expect(r.ok && r.rows[0]?.orgUnitId).toBeNull();
  });
});

describe("ghiChuDaBiThay", () => {
  it("nêu căn cứ thay + lý do, và GIỮ ghi chú cũ của chính lượt bị thay", () => {
    expect(ghiChuDaBiThay({ lyDo: "Quầy hỏng", canCu: { kieu: "SUA_TAY" }, ghiChuCu: null })).toBe(
      "Đã được thay bằng chỉnh tay: Quầy hỏng",
    );
    expect(
      ghiChuDaBiThay({ lyDo: null, canCu: { kieu: "DON", requestId: "req-1" }, ghiChuCu: "lần sửa trước" }),
    ).toBe("Đã được thay theo đơn chỉnh công req-1 · trước đó: lần sửa trước");
  });
});

// ── ghiDongChinhTay với `tx` giả ─────────────────────────────────────────────────────────
//
// Hành vi trên DB thật nằm ở bộ `tests/cham-cong/*`. Ở đây chỉ khoá THỨ TỰ + ĐIỀU KIỆN của
// các phép ghi — thứ mà một `tx` giả nói được rõ nhất.
type Goi = { op: string; args: unknown };
function txGia(luotDangCo: { id: string; reviewNote: string | null }[], demUpdate = 1) {
  const goi: Goi[] = [];
  const tx = {
    $executeRaw: (...args: unknown[]) => {
      goi.push({ op: "lock", args });
      return Promise.resolve(1);
    },
    staffTimeLog: {
      findMany: (args: unknown) => {
        goi.push({ op: "findMany", args });
        return Promise.resolve(
          luotDangCo.map((l) => ({
            ...l,
            direction: "CHECK_IN",
            loggedAt: LUC,
            source: "TICKET",
            flags: [],
            centerId: "cs2",
            adjustRequestId: null,
            reviewedById: null,
          })),
        );
      },
      updateMany: (args: unknown) => {
        goi.push({ op: "updateMany", args });
        return Promise.resolve({ count: demUpdate });
      },
      createMany: (args: unknown) => {
        goi.push({ op: "createMany", args });
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as TxGhiChinhTay;
  return { tx, goi };
}

describe("ghiDongChinhTay", () => {
  const dung = dungDongChinhTay({ ...CO_BAN, moc: ["08:00", "17:30"] });
  const rows = dung.ok ? dung.rows : [];
  const nen = {
    userId: "u1",
    workDate: NGAY,
    rows,
    actorId: "quanly",
    now: LUC,
    lyDo: "Quầy hỏng",
    canCu: { kieu: "SUA_TAY" } as const,
  };

  it("GHI_DE: khoá → đọc lượt CÒN TÍNH → đánh dấu DISMISSED từng lượt → rồi mới tạo dòng mới", async () => {
    const { tx, goi } = txGia([
      { id: "a", reviewNote: null },
      { id: "b", reviewNote: "sửa tay cũ" },
    ]);
    const r = await ghiDongChinhTay(tx, { ...nen, cheDo: "GHI_DE" });
    expect(goi.map((g) => g.op)).toEqual(["lock", "findMany", "updateMany", "updateMany", "createMany"]);
    expect(r.thayThe.map((t) => t.id)).toEqual(["a", "b"]);

    // Đọc theo NGƯỜI × NGÀY, KHÔNG theo cơ sở — lượt quét ở cơ sở khác cũng phải bị thay.
    const doc = goi[1]!.args as { where: Record<string, unknown> };
    expect(doc.where).toEqual({ userId: "u1", workDate: NGAY, ...LUOT_CON_TINH });
    expect("centerId" in doc.where).toBe(false);

    const u = goi[3]!.args as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(u.where).toEqual({ id: "b", ...LUOT_CON_TINH });
    expect(u.data).toMatchObject({ reviewStatus: "DISMISSED", reviewedById: "quanly", reviewedAt: LUC });
    expect(u.data.reviewNote).toContain("trước đó: sửa tay cũ");
  });

  it("GHI_THEM: KHÔNG đọc, KHÔNG đánh dấu lượt nào — chỉ tạo dòng (hành vi cũ)", async () => {
    const { tx, goi } = txGia([{ id: "a", reviewNote: null }]);
    const r = await ghiDongChinhTay(tx, { ...nen, cheDo: "GHI_THEM" });
    expect(goi.map((g) => g.op)).toEqual(["lock", "createMany"]);
    expect(r.thayThe).toEqual([]);
  });

  it("lượt vừa đọc đã đổi giữa chừng (update đếm 0) ⇒ NÉM để rollback, không tạo dòng mới", async () => {
    const { tx, goi } = txGia([{ id: "a", reviewNote: null }], 0);
    await expect(ghiDongChinhTay(tx, { ...nen, cheDo: "GHI_DE" })).rejects.toThrow(/vừa thay đổi/);
    expect(goi.some((g) => g.op === "createMany")).toBe(false);
  });
});

// ── [GDE-W] LƯỚI GHIM DÂY NỐI: mọi chỗ đọc "lượt còn tính" đi qua `LUOT_CON_TINH` ─────────
//
// Test hành vi của các trang/hàm này cần Postgres hoặc RSC, nên quên lọc `DISMISSED` ở một chỗ
// là KHÔNG ca nào đỏ — triệu chứng chỉ là hai màn nói hai con số. Lưới đọc mã nguồn (mẫu lưới
// ghim, CLAUDE.md) và neo vào ĐÚNG thân hàm/câu đọc, đếm cả số lần khớp.
//
// Mã TRƯỚC bản vá 06/10/2026 ở cả bốn chỗ là `where: { …, result: "ACCEPTED" }`.
describe("[GDE-W] chỗ đọc lượt còn tính phải đi qua LUOT_CON_TINH", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const than = (src: string, dau: string) => {
    const i = src.indexOf(dau);
    expect(i, `không thấy "${dau}"`).toBeGreaterThan(-1);
    const j = src.indexOf("\n}", i);
    return src.slice(i, j);
  };

  it("[GDE-W1] recompute.acceptedLogsOfDay — đường DUY NHẤT vào engine", () => {
    const t = than(doc("lib/cham-cong/recompute.ts"), "export async function acceptedLogsOfDay");
    expect(t).toContain("...LUOT_CON_TINH");
    expect(t).not.toContain('result: "ACCEPTED"');
  });

  it("[GDE-W2] my-schedule.getMyTapsOfDay — ô Vào/Ra của trang công tác site GV", () => {
    const t = than(doc("lib/cham-cong/my-schedule.ts"), "export async function getMyTapsOfDay");
    expect(t).toContain("...LUOT_CON_TINH");
    expect(t).not.toContain('result: "ACCEPTED"');
  });

  it("[GDE-W3] /don-tu — lượt 'đang có' của cột Thay đổi", () => {
    const src = doc("app/(admin)/admin/don-tu/page.tsx");
    expect(src.match(/where: \{ \.\.\.LUOT_CON_TINH, userId: \{ in: tapUserIds \}/g)).toHaveLength(1);
  });

  it("[GDE-W4] /cham-cong — cột Quét / số lượt / cờ chỉ đếm lượt chưa bị thay", () => {
    const src = doc("app/(admin)/admin/cham-cong/page.tsx");
    expect(src.match(/const my = myAll\.filter\(\(l\) => !laLuotDaBiThay\(l\)\);/g)).toHaveLength(1);
  });
});
