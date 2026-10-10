// @vitest-environment node
/**
 * EL-08 — dàn bài khoá.
 *
 * Case đắt nhất là nhóm HAI PHA. Kéo thả là thao tác người soạn khoá làm hàng
 * chục lần mỗi khoá; nếu nó thất bại với một lỗi khoá duy nhất khó hiểu thì họ
 * kết luận hệ thống hỏng — và cổng nghiệm thu GĐ1 ("tự tạo trọn một khoá, 0 lần
 * nhờ lập trình viên") trượt vì đúng chỗ này.
 */
import { describe, it, expect } from "vitest";
import {
  chuyenViTri,
  dungHaiPhaGhiThuTu,
  kiemDanBai,
  kiemPhuDe,
  type ChuongTrongDanBai,
} from "@/lib/elearning/course-outline";

describe("đổi vị trí trong danh sách", () => {
  const ids = ["a", "b", "c", "d"];

  it("kéo lên đầu", () => {
    expect(chuyenViTri(ids, "c", 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("kéo xuống cuối", () => {
    expect(chuyenViTri(ids, "a", 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("giữ nguyên vị trí ⇒ danh sách không đổi", () => {
    expect(chuyenViTri(ids, "b", 1)).toEqual(ids);
  });

  it("vị trí ngoài khoảng bị kẹp vào biên, không ném lỗi", () => {
    // Kéo thả ở trình duyệt hay gửi lên chỉ số lệch một đơn vị. Ném lỗi ở đây là
    // biến một thao tác chuột thành một thông báo đỏ.
    expect(chuyenViTri(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(chuyenViTri(ids, "d", -5)).toEqual(["d", "a", "b", "c"]);
  });

  it("id không có trong danh sách ⇒ trả nguyên bản", () => {
    expect(chuyenViTri(ids, "z", 0)).toEqual(ids);
  });

  it("không làm mất hay nhân bản phần tử nào", () => {
    for (const dich of [0, 1, 2, 3]) {
      const ra = chuyenViTri(ids, "c", dich);
      expect([...ra].sort()).toEqual([...ids].sort());
    }
  });
});

describe("HAI PHA ghi thứ tự — vì khoá duy nhất chặn ngang giữa chừng", () => {
  it("pha 1 đẩy TOÀN BỘ sang dải âm", () => {
    // Chỉ đẩy những cái "có đổi chỗ" thì vẫn còn số dương nằm lại, và pha 2 va
    // đúng vào chúng.
    const { pha1 } = dungHaiPhaGhiThuTu(["a", "b", "c"]);
    expect(pha1).toHaveLength(3);
    expect(pha1.every((b) => b.orderIndex < 0)).toBe(true);
  });

  it("pha 1 không có hai số trùng nhau", () => {
    const { pha1 } = dungHaiPhaGhiThuTu(["a", "b", "c", "d"]);
    expect(new Set(pha1.map((b) => b.orderIndex)).size).toBe(4);
  });

  it("pha 2 ghi số thật từ 0, liên tục", () => {
    const { pha2 } = dungHaiPhaGhiThuTu(["c", "a", "b"]);
    expect(pha2).toEqual([
      { id: "c", orderIndex: 0 },
      { id: "a", orderIndex: 1 },
      { id: "b", orderIndex: 2 },
    ]);
  });

  it("hai pha KHÔNG bao giờ giao nhau về giá trị", () => {
    // Đây chính là điều làm cách này an toàn: mọi số dương đã rời đi trước khi
    // số dương mới được ghi.
    const { pha1, pha2 } = dungHaiPhaGhiThuTu(["a", "b", "c"]);
    const am = new Set(pha1.map((b) => b.orderIndex));
    expect(pha2.some((b) => am.has(b.orderIndex))).toBe(false);
  });

  it("danh sách rỗng ⇒ không có lệnh nào", () => {
    const { pha1, pha2 } = dungHaiPhaGhiThuTu([]);
    expect(pha1).toEqual([]);
    expect(pha2).toEqual([]);
  });
});

describe("hàng rào trước khi XUẤT BẢN", () => {
  const bai = (o: Record<string, unknown> = {}) => ({
    id: "b1",
    title: "Bài 1",
    kind: "READ",
    contentMd: "Nội dung đủ dài",
    required: true,
    ...o,
  });
  const chuong = (o: Partial<ChuongTrongDanBai> = {}): ChuongTrongDanBai => ({
    id: "c1",
    title: "Chương 1",
    lessons: [bai()],
    ...o,
  });

  it("dàn bài đủ ⇒ cho qua", () => {
    expect(kiemDanBai([chuong()]).ok).toBe(true);
  });

  it("khoá chưa có chương nào ⇒ chặn", () => {
    const r = kiemDanBai([]);
    expect(r.ok).toBe(false);
    expect(r.loi[0]?.code).toBe("KHONG_CO_CHUONG");
  });

  it("chương rỗng ⇒ chặn, và NÊU TÊN chương", () => {
    // "Có lỗi" không giúp gì; người soạn cần biết mở chương nào ra sửa.
    const r = kiemDanBai([chuong({ title: "Chương 2", lessons: [] })]);
    expect(r.ok).toBe(false);
    expect(r.loi[0]?.chiTiet).toContain("Chương 2");
  });

  it("bài ĐỌC rỗng nội dung ⇒ chặn", () => {
    // Người học mở ra thấy trang trắng — và vì tiến độ đọc tính theo số chữ, họ
    // không bao giờ đủ điều kiện hoàn thành.
    const r = kiemDanBai([chuong({ lessons: [bai({ contentMd: "   " })] })]);
    expect(r.ok).toBe(false);
    expect(r.loi.some((l) => l.code === "BAI_DOC_TRONG")).toBe(true);
  });

  it("bài dạng KHÁC không bị đòi nội dung markdown", () => {
    const r = kiemDanBai([chuong({ lessons: [bai({ kind: "VIDEO", contentMd: null })] })]);
    expect(r.ok).toBe(true);
  });

  it("không bài nào BẮT BUỘC ⇒ chặn", () => {
    // Phép cuộn tiến độ sẽ ra mẫu số 0 và KHÔNG AI từng "hoàn thành" khoá này —
    // im lặng, không có gì vỡ, và chỉ lộ ra ở báo cáo cuối tháng.
    const r = kiemDanBai([chuong({ lessons: [bai({ required: false })] })]);
    expect(r.ok).toBe(false);
    expect(r.loi.some((l) => l.code === "KHONG_CO_BAI_BAT_BUOC")).toBe(true);
  });

  it("gom ĐỦ mọi lỗi, không dừng ở lỗi đầu", () => {
    // Sửa một lỗi rồi bấm lại chỉ để gặp lỗi kế tiếp là bắt người soạn đi qua
    // năm vòng cho một dàn bài.
    const r = kiemDanBai([
      chuong({ id: "c1", title: "A", lessons: [] }),
      chuong({ id: "c2", title: "B", lessons: [bai({ contentMd: "", required: false })] }),
    ]);
    expect(r.loi.length).toBeGreaterThanOrEqual(3);
  });
});

describe("(C10) — phụ đề là ĐIỀU KIỆN XUẤT BẢN của khoá bắt buộc", () => {
  const video = (o: Record<string, unknown> = {}) => ({
    id: "v1",
    title: "Video 1",
    kind: "VIDEO",
    contentMd: null,
    required: true,
    captionKey: "elearning/caption/l1/x.vtt",
    ...o,
  });
  const ch = (lessons: unknown[]): ChuongTrongDanBai =>
    ({ id: "c1", title: "Chương 1", lessons }) as ChuongTrongDanBai;

  it("khoá BẮT BUỘC, video có phụ đề ⇒ cho qua", () => {
    const r = kiemPhuDe({ chuong: [ch([video()])], natureTag: "MANDATORY" });
    expect(r.ok).toBe(true);
  });

  it("khoá BẮT BUỘC, video THIẾU phụ đề ⇒ chặn, và nêu TÊN bài", () => {
    // Bổ sung phụ đề hồi tố cho khoá đã xuất bản là việc không ai làm nổi — cổng
    // chỉ chặn được ở đây, lúc khoá chưa ra.
    for (const k of [null, "", "   "]) {
      const r = kiemPhuDe({
        chuong: [ch([video({ captionKey: k, title: "Bài an toàn" })])],
        natureTag: "MANDATORY_COMPLIANCE",
      });
      expect(r.ok, JSON.stringify(k)).toBe(false);
      expect(r.loi[0]?.chiTiet).toContain("Bài an toàn");
    }
  });

  it("khoá KHUYẾN NGHỊ / TỰ CHỌN ⇒ không đòi phụ đề", () => {
    for (const t of ["RECOMMENDED", "OPTIONAL"]) {
      const r = kiemPhuDe({
        chuong: [ch([video({ captionKey: null })])],
        natureTag: t,
      });
      expect(r.ok, t).toBe(true);
    }
  });

  it("bài KHÔNG phải video thì không bị đòi phụ đề", () => {
    const r = kiemPhuDe({
      chuong: [ch([{ ...video(), kind: "READ", captionKey: null }])],
      natureTag: "MANDATORY",
    });
    expect(r.ok).toBe(true);
  });

  it("khoá CHƯA GẮN chương trình + có video ⇒ CHẶN, nêu hai đường thoát", () => {
    // Không biết khoá có bắt buộc hay không thì cho qua là chọn phía mà cái giá
    // của việc sai là VĨNH VIỄN.
    const r = kiemPhuDe({ chuong: [ch([video({ captionKey: null })])], natureTag: null });
    expect(r.ok).toBe(false);
    expect(r.loi[0]?.code).toBe("CHUA_BIET_KHOA_CO_BAT_BUOC");
    expect(r.loi[0]?.chiTiet).toContain("gắn chương trình");
    expect(r.loi[0]?.chiTiet).toContain("phụ đề");
  });

  it("khoá chưa gắn chương trình nhưng KHÔNG có video ⇒ không chặn", () => {
    // Cổng này chỉ nói về video; chặn một khoá toàn bài đọc là chặn nhầm.
    const r = kiemPhuDe({
      chuong: [ch([{ ...video(), kind: "READ" }])],
      natureTag: null,
    });
    expect(r.ok).toBe(true);
  });

  it("nêu ĐỦ mọi bài thiếu phụ đề, không dừng ở bài đầu", () => {
    const r = kiemPhuDe({
      chuong: [
        ch([video({ id: "a", title: "A", captionKey: null })]),
        ch([video({ id: "b", title: "B", captionKey: null })]),
      ],
      natureTag: "MANDATORY",
    });
    expect(r.loi).toHaveLength(2);
  });
});

describe("[EL-14d] cổng xuất bản: bài KIỂM TRA phải có đề", () => {
  const chuong = (bai: Record<string, unknown>) => [
    {
      id: "m1",
      title: "Chương 1",
      lessons: [
        {
          id: "l1",
          title: "Bài kiểm tra cuối",
          kind: "QUIZ",
          contentMd: null,
          required: true,
          ...bai,
        },
      ],
    },
  ];

  it("bài QUIZ thiếu đề ⇒ KHÔNG xuất bản được", () => {
    // Bài kiểm tra không đề thì người học mở ra là kẹt, và điều kiện hoàn thành
    // khoá không bao giờ đạt được — im lặng.
    const r = kiemDanBai(chuong({ examId: null }) as never);
    expect(r.ok).toBe(false);
    expect(r.loi.map((x) => x.code)).toContain("BAI_THI_CHUA_CO_DE");
  });

  it("bài QUIZ có đề ⇒ qua cổng", () => {
    const r = kiemDanBai(chuong({ examId: "de1" }) as never);
    expect(r.loi.map((x) => x.code)).not.toContain("BAI_THI_CHUA_CO_DE");
  });

  it("🔴 thiếu TRƯỜNG `examId` trong truy vấn ⇒ cổng vẫn nổ, không im lặng cho qua", () => {
    // Đây là ca nguy hiểm nhất: nếu đường gọi quên `select: { examId: true }` thì
    // trường về `undefined`. Cổng phải coi `undefined` như "chưa có đề", không
    // được coi là "có" — một cổng chặn im lặng không chặn gì còn tệ hơn không có.
    const r = kiemDanBai(chuong({}) as never);
    expect(r.loi.map((x) => x.code)).toContain("BAI_THI_CHUA_CO_DE");
  });

  it("bài loại khác KHÔNG bị cổng này chạm", () => {
    const r = kiemDanBai([
      {
        id: "m1",
        title: "Chương 1",
        lessons: [
          { id: "l1", title: "Video", kind: "VIDEO", contentMd: null, required: true },
        ],
      },
    ] as never);
    expect(r.loi.map((x) => x.code)).not.toContain("BAI_THI_CHUA_CO_DE");
  });
});
