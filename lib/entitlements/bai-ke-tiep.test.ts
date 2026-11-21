import { describe, expect, it } from "vitest";
import { baiKeTiepCuaLop, type BuoiCuaLop } from "./bai-ke-tiep";

// Mọi ngày TUYỆT ĐỐI (luật 19). "Hôm nay" là 11/10/2026 giờ VN: đầu ngày VN = 2026-10-10T17:00:00Z.
const NOW = new Date("2026-10-11T08:00:00Z"); // 15:00 11/10 giờ VN
const DAU_NGAY_VN = new Date("2026-10-10T17:00:00Z");

const buoi = (iso: string, planOrder: number | null, o: Partial<BuoiCuaLop> = {}): BuoiCuaLop => ({
  date: new Date(iso),
  status: "SCHEDULED",
  planOrder,
  lessonOrder: null,
  ...o,
});

describe("[BKT] baiKeTiepCuaLop — bài giáo trình của buổi sống sớm nhất chưa diễn ra", () => {
  it("[BKT-01] lớp chưa bắt đầu ⇒ bài 1", () => {
    const ds = [buoi("2026-10-20T11:00:00Z", 0), buoi("2026-10-27T11:00:00Z", 1)];
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(1);
  });

  it("[BKT-02] giữa chừng ⇒ bài của buổi sắp tới; buổi đã qua không ảnh hưởng", () => {
    const ds = [
      buoi("2026-09-20T11:00:00Z", 11, { status: "COMPLETED" }),
      buoi("2026-10-04T11:00:00Z", 12, { status: "COMPLETED" }),
      buoi("2026-10-18T11:00:00Z", 13),
      buoi("2026-10-25T11:00:00Z", 14),
    ];
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(14);
  });

  it("[BKT-03] NGHỈ-LÙI: buổi đã huỷ không làm bài kế tiếp lệch — đếm theo LỘ TRÌNH, không theo số buổi đã qua", () => {
    // 5 buổi đã dạy (plan 0..4), 1 buổi (plan 5) bị huỷ trong quá khứ, buổi sống kế tiếp là plan 6 ⇒ bài 7.
    // Cách đếm theo NGÀY (kể cả buổi huỷ) sẽ ra một con số khác; theo lộ trình thì luôn là plan + 1.
    const ds = [
      ...[0, 1, 2, 3, 4].map((p) => buoi(`2026-09-${10 + p}T11:00:00Z`, p, { status: "COMPLETED" })),
      buoi("2026-09-30T11:00:00Z", 5, { status: "CANCELLED" }),
      buoi("2026-10-18T11:00:00Z", 6),
    ];
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(7);
  });

  it("[BKT-04] buổi sắp tới bị HUỶ thì bỏ qua, lấy buổi sống kế tiếp", () => {
    const ds = [buoi("2026-10-12T11:00:00Z", 8, { status: "CANCELLED" }), buoi("2026-10-19T11:00:00Z", 9)];
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(10);
  });

  it("[BKT-05] buổi HÔM NAY (đã qua giờ học trong ngày) vẫn là bài kế tiếp — đồng bộ với layUngVienLop của bảo lưu: mốc là ĐẦU NGÀY VN", () => {
    const homNay = buoi("2026-10-11T01:00:00Z", 20); // 08:00 11/10 VN, trước NOW 7 tiếng
    const sau = buoi("2026-10-18T01:00:00Z", 21);
    expect(baiKeTiepCuaLop([sau, homNay], NOW)).toBe(21);
  });

  it("[BKT-06] biên đầu ngày VN: 00:00:00 VN tính, 23:59:59.999 VN hôm trước thì không", () => {
    const dung = buoi(DAU_NGAY_VN.toISOString(), 30);
    const truoc = buoi(new Date(DAU_NGAY_VN.getTime() - 1).toISOString(), 29);
    const sau = buoi("2026-10-25T11:00:00Z", 31);
    expect(baiKeTiepCuaLop([truoc, dung, sau], NOW)).toBe(31);
    expect(baiKeTiepCuaLop([truoc, sau], NOW)).toBe(32);
  });

  it("[BKT-07] đã hết buổi (mọi buổi trong quá khứ hoặc đã huỷ) ⇒ null; danh sách rỗng ⇒ null", () => {
    expect(baiKeTiepCuaLop([], NOW)).toBeNull();
    const ds = [buoi("2026-09-01T11:00:00Z", 0, { status: "COMPLETED" }), buoi("2026-10-20T11:00:00Z", 1, { status: "CANCELLED" })];
    expect(baiKeTiepCuaLop(ds, NOW)).toBeNull();
  });

  it("[BKT-08] buổi sớm nhất chưa ghim giáo trình ⇒ null, KHÔNG nhảy sang buổi sau có số bài (sẽ trả sai bài)", () => {
    const ds = [buoi("2026-10-18T11:00:00Z", null), buoi("2026-10-25T11:00:00Z", 5)];
    expect(baiKeTiepCuaLop(ds, NOW)).toBeNull();
  });

  it("[BKT-09] không có kế hoạch buổi nhưng có bài giáo trình ⇒ lấy số bài (nấc hai của thang)", () => {
    const ds = [buoi("2026-10-18T11:00:00Z", null, { lessonOrder: 6 })];
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(6);
    // kế hoạch buổi (nấc một) thắng bài giáo trình khi cả hai cùng có
    expect(baiKeTiepCuaLop([buoi("2026-10-18T11:00:00Z", 3, { lessonOrder: 9 })], NOW)).toBe(4);
  });

  it("[BKT-10] thứ tự đầu vào không ảnh hưởng, và đầu vào không bị đổi", () => {
    const ds = Object.freeze([
      buoi("2026-11-01T11:00:00Z", 16),
      buoi("2026-10-18T11:00:00Z", 14),
      buoi("2026-10-25T11:00:00Z", 15),
      buoi("2026-09-01T11:00:00Z", 2, { status: "COMPLETED" }),
    ]);
    expect(baiKeTiepCuaLop(ds, NOW)).toBe(15);
    expect(baiKeTiepCuaLop([...ds].reverse(), NOW)).toBe(15);
  });

  it("[BKT-11] hai buổi cùng thời điểm ⇒ lấy bài NHỎ hơn (kết quả không phụ thuộc thứ tự đầu vào)", () => {
    const a = buoi("2026-10-18T11:00:00Z", 9);
    const b = buoi("2026-10-18T11:00:00Z", 8);
    expect(baiKeTiepCuaLop([a, b], NOW)).toBe(9);
    expect(baiKeTiepCuaLop([b, a], NOW)).toBe(9);
  });

  it("[BKT-12] buổi sớm nhất chưa ghim + buổi cùng giờ có số bài ⇒ vẫn null (chưa ghim thì không đoán)", () => {
    const a = buoi("2026-10-18T11:00:00Z", null);
    const b = buoi("2026-10-18T11:00:00Z", 8);
    expect(baiKeTiepCuaLop([b, a], NOW)).toBeNull();
    expect(baiKeTiepCuaLop([a, b], NOW)).toBeNull();
  });
});
