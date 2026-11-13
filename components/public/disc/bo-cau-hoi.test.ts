// @vitest-environment node
/** [BCH-*] Bảng "Bộ câu hỏi" của trang DISC đọc từ ĐỘNG CƠ, không gõ cứng. */
import { describe, expect, it } from "vitest";
import type { BoDeDisc, DiscEngine } from "@/lib/disc/engine";
import { boCauHoiTheoDoTuoi } from "./bo-cau-hoi";

const thang5 = ["Rất không đúng", "Không đúng lắm", "Nửa nọ nửa kia", "Khá đúng", "Rất đúng"].map((nhan, i) => ({ gia: i + 1, nhan }));
const thang3 = [
  { gia: 1, nhan: "Không phải", mat: "🙁" },
  { gia: 2, nhan: "Đôi khi", mat: "😐" },
  { gia: 3, nhan: "Đúng rồi", mat: "😀" },
];
const boGia = (ma: string, soCau: number, thang: BoDeDisc["thang"], ho = false): BoDeDisc => ({
  ma,
  phienBan: "t",
  doiTuong: "TH",
  nguoiLonTraLoiHo: ho,
  cauHoi: Array.from({ length: soCau }, (_, i) => ({ id: `${ma}-${i}`, noiDung: "x" })),
  thang,
});

// MN+1+2 dùng bộ A (ba/mẹ trả lời hộ) · 3–5 bộ B · 6–12 bộ C · PH bộ D
const engineGia: Pick<DiscEngine, "chonBoDe"> = {
  chonBoDe: ({ vai, bacHoc }) => {
    if (vai === "PH") return boGia("D", 31, thang5);
    if (bacHoc === "MN" || bacHoc === "1" || bacHoc === "2") return boGia("A", 17, thang5, true);
    if (["3", "4", "5"].includes(bacHoc ?? "")) return boGia("B", 19, thang3);
    return boGia("C", 29, thang5);
  },
};

describe("[BCH] bảng bộ câu hỏi theo độ tuổi", () => {
  it("[BCH-01] số câu / số mức / người trả lời lấy từ bộ đề của động cơ (không phải hằng số của giao diện)", () => {
    const dong = boCauHoiTheoDoTuoi(engineGia, 2026);
    expect(dong.map((d) => d.nhan)).toEqual(["Bé mầm non, lớp 1–2", "Lớp 3–5", "Lớp 6–12", "Ba/mẹ hoặc người giám hộ"]);
    expect(dong.map((d) => d.soCau)).toEqual([17, 19, 29, 31]);
    expect(dong[0]).toMatchObject({ nguoiLonTraLoiHo: true, soMuc: 5 });
    expect(dong[1]).toMatchObject({ nguoiLonTraLoiHo: false, soMuc: 3, coMat: true, nhanThang: "Không phải → Đúng rồi" });
    expect(dong[3]!.nhanThang).toBe("Rất không đúng → Rất đúng");
  });

  it("[BCH-02] đổi bộ đề thì bảng đổi theo (đối chứng: cùng engine nhưng số câu khác)", () => {
    const e2: Pick<DiscEngine, "chonBoDe"> = {
      chonBoDe: (d) => (d.vai === "PH" ? boGia("D", 40, thang5) : engineGia.chonBoDe(d)),
    };
    expect(boCauHoiTheoDoTuoi(e2, 2026).at(-1)!.soCau).toBe(40);
  });

  it("[BCH-03] bậc nào động cơ không chọn được bộ ⇒ bỏ qua, không dựng dòng giả", () => {
    const e3: Pick<DiscEngine, "chonBoDe"> = { chonBoDe: () => null };
    expect(boCauHoiTheoDoTuoi(e3, 2026)).toEqual([]);
  });

  it("[BCH-04] năm sinh giả định chỉ dùng để chọn bộ: truyền xuống đúng năm nay", () => {
    const thay: number[] = [];
    boCauHoiTheoDoTuoi({ chonBoDe: (d) => (thay.push(d.namNay), null) }, 2031);
    expect(thay.length).toBeGreaterThan(0);
    expect(new Set(thay)).toEqual(new Set([2031]));
  });
});
