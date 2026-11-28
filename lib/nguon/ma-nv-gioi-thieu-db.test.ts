/**
 * Ca [MNV-DB-*] — tầng đọc của cột "Mã NV giới thiệu": CHẠY KHÔNG CẦN DB (job `Unit tests` của CI không dựng Postgres).
 *
 * Khẳng định bằng một `db` GIẢ mà chạm vào bất cứ thuộc tính nào cũng NÉM **và được GHI LẠI**: "không tốn truy vấn nào" là thứ test thuần mới
 * chứng minh được — ca DB chỉ thấy kết quả đúng, không thấy câu hỏi thừa. Phải ghi lại chứ không chỉ ném: hàm nuốt lỗi tra cứu (T4) và trả
 * KHONG_CO cho dòng không mã, nên một phép chạm thừa bị nuốt thì kết quả vẫn y hệt — chỉ danh sách chạm mới lộ ra.
 */
import { describe, expect, it } from "vitest";
import { giaiMaNvGioiThieuTheoLo } from "./ma-nv-gioi-thieu-db";
import type { DbKhongScope } from "./thu-thap-tin-hieu";

function dbCamVaDem(): { db: DbKhongScope; chamVao: string[] } {
  const chamVao: string[] = [];
  const db = new Proxy(
    {},
    {
      get(_t, prop) {
        chamVao.push(String(prop));
        throw new Error(`đã chạm db.${String(prop)} — lẽ ra không được truy vấn`);
      },
    },
  ) as unknown as DbKhongScope;
  return { db, chamVao };
}

const BAY_GIO = new Date("2026-10-09T03:00:00.000Z");
const dong = (maTho: string | null) => ({ maTho, nhanKhai: null, ngayGiaiMa: BAY_GIO });

describe("[MNV-DB-01] KHÔNG dòng nào có mã ⇒ 0 truy vấn, mọi phần tử KHONG_CO (đường nhập cũ y hệt)", () => {
  it("cờ BẬT", async () => {
    const { db, chamVao } = dbCamVaDem();
    const r = await giaiMaNvGioiThieuTheoLo(db, { nguonBat: true, bayGio: BAY_GIO, dong: [dong(null), dong(""), dong("   ")] });
    expect(r).toEqual([{ kieu: "KHONG_CO" }, { kieu: "KHONG_CO" }, { kieu: "KHONG_CO" }]);
    expect(chamVao).toEqual([]);
  });
  it("lô rỗng", async () => {
    const { db, chamVao } = dbCamVaDem();
    expect(await giaiMaNvGioiThieuTheoLo(db, { nguonBat: true, bayGio: BAY_GIO, dong: [] })).toEqual([]);
    expect(chamVao).toEqual([]);
  });
});

describe("[MNV-DB-02] cờ quản lý nguồn TẮT ⇒ 0 truy vấn; dòng có mã báo TAT (để đường gọi nói một lần), dòng không mã vẫn KHONG_CO", () => {
  it("TAT chỉ ở dòng có mã", async () => {
    const { db, chamVao } = dbCamVaDem();
    const r = await giaiMaNvGioiThieuTheoLo(db, { nguonBat: false, bayGio: BAY_GIO, dong: [dong("SR.NV.002"), dong(null), dong(" x ")] });
    expect(r).toEqual([{ kieu: "TAT" }, { kieu: "KHONG_CO" }, { kieu: "TAT" }]);
    expect(chamVao).toEqual([]);
  });
});

describe("[MNV-DB-03] tra DB lỗi ⇒ KHÔNG đoán người: dòng có mã BO_QUA (lead vẫn tạo), dòng không mã KHONG_CO", () => {
  it("db ném ⇒ BO_QUA có lý do hệ thống, không ném ra ngoài", async () => {
    const { db, chamVao } = dbCamVaDem();
    const r = await giaiMaNvGioiThieuTheoLo(db, { nguonBat: true, bayGio: BAY_GIO, dong: [dong("SR.NV.002"), dong(null)] });
    expect(chamVao.length).toBeGreaterThan(0); // đối chứng dương: có mã thì CÓ tra (không phải bỏ qua vì lý do khác)
    expect(r[0]!.kieu).toBe("BO_QUA");
    if (r[0]!.kieu === "BO_QUA") expect(r[0]!.lyDo).toMatch(/lỗi hệ thống/);
    expect(r[1]).toEqual({ kieu: "KHONG_CO" });
  });
});
