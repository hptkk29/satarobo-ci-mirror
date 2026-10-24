/**
 * EL-08 — DÀN BÀI KHOÁ: sắp thứ tự chương và bài.
 *
 * ⚠️ Bài toán thật ở đây KHÔNG phải "đổi chỗ hai phần tử trong mảng" mà là
 * **khoá duy nhất chặn ngang giữa chừng**. `TrnModule` có
 * `@@unique([courseId, orderIndex])`, `TrnLesson` có `@@unique([moduleId, orderIndex])`.
 *
 * Kéo bài số 3 lên vị trí 1 rồi ghi lần lượt `3→1, 1→2, 2→3` sẽ VA KHOÁ ngay ở
 * bước đầu, vì lúc đó vẫn còn một bài mang số 1. Nó không hỏng dữ liệu — nó chỉ
 * làm thao tác kéo thả thất bại với một lỗi khó hiểu, và người soạn khoá sẽ nghĩ
 * hệ thống hỏng.
 *
 * Cách vá: ghi HAI PHA. Pha 1 đẩy toàn bộ sang dải âm (không ai dùng), pha 2 ghi
 * số thật. Dải âm không bao giờ va vì mọi số dương đã rời đi.
 */

export type BuocGhiThuTu = { id: string; orderIndex: number };

/**
 * Đổi vị trí một phần tử trong danh sách đã sắp.
 *
 * Trả về danh sách id theo THỨ TỰ MỚI. Không đụng DB, không biết gì về Prisma.
 */
export function chuyenViTri(ids: string[], id: string, viTriMoi: number): string[] {
  const cu = ids.indexOf(id);
  if (cu < 0) return [...ids];
  const dich = Math.max(0, Math.min(ids.length - 1, viTriMoi));
  if (cu === dich) return [...ids];
  const ra = [...ids];
  ra.splice(cu, 1);
  ra.splice(dich, 0, id);
  return ra;
}

/**
 * Từ thứ tự mong muốn ra HAI PHA lệnh ghi.
 *
 * Pha 1 dùng số ÂM để không va khoá duy nhất; pha 2 ghi số thật từ 0.
 *
 * ⚠️ Pha 1 phải phủ MỌI phần tử, kể cả phần tử không đổi chỗ. Chỉ đẩy những cái
 * "có đổi" thì vẫn còn số dương nằm lại, và pha 2 va đúng vào chúng.
 */
export function dungHaiPhaGhiThuTu(idsTheoThuTuMoi: string[]): {
  pha1: BuocGhiThuTu[];
  pha2: BuocGhiThuTu[];
} {
  const pha1 = idsTheoThuTuMoi.map((id, i) => ({ id, orderIndex: -(i + 1) }));
  const pha2 = idsTheoThuTuMoi.map((id, i) => ({ id, orderIndex: i }));
  return { pha1, pha2 };
}

/**
 * Kiểm dàn bài trước khi cho XUẤT BẢN.
 *
 * ⚠️ Đây là hàng rào cuối trước khi một khoá đi ra với người học. Mọi thứ lọt qua
 * đây sẽ được phát cho người thật, và họ sẽ mở một chương rỗng rồi tự hỏi mình
 * làm sai gì.
 */
export type LoiDanBai =
  | "KHONG_CO_CHUONG"
  | "CHUONG_RONG"
  | "KHONG_CO_BAI_BAT_BUOC"
  | "BAI_DOC_TRONG"
  | "BAI_THI_CHUA_CO_DE"
  | "BAI_TAP_CHUA_CO_KHUNG"
  | "BAI_VIDEO_THIEU_PHU_DE"
  | "CHUA_BIET_KHOA_CO_BAT_BUOC";

export type BaiTrongDanBai = {
  id: string;
  title: string;
  kind: string;
  contentMd: string | null;
  required: boolean;
  /** EL-10 (C10) — phụ đề tiếng Việt. Xem `kiemPhuDe`. */
  captionKey?: string | null;
  /** EL-14d — đề thi của bài `QUIZ`. */
  examId?: string | null;
  /** EL-15c — khung chấm của bài `TASK`. */
  rubricId?: string | null;
};

export type ChuongTrongDanBai = {
  id: string;
  title: string;
  lessons: BaiTrongDanBai[];
};

export function kiemDanBai(chuong: ChuongTrongDanBai[]): {
  ok: boolean;
  loi: { code: LoiDanBai; chiTiet: string }[];
} {
  const loi: { code: LoiDanBai; chiTiet: string }[] = [];

  if (chuong.length === 0) {
    loi.push({ code: "KHONG_CO_CHUONG", chiTiet: "Khoá chưa có chương nào" });
  }

  for (const c of chuong) {
    if (c.lessons.length === 0) {
      loi.push({ code: "CHUONG_RONG", chiTiet: `Chương "${c.title}" chưa có bài nào` });
    }
    for (const b of c.lessons) {
      // Bài dạng ĐỌC mà rỗng thì người học mở ra thấy trang trắng — và vì tiến độ
      // đọc tính theo số chữ, họ không bao giờ "đủ điều kiện hoàn thành".
      if (b.kind === "READ" && !b.contentMd?.trim()) {
        loi.push({ code: "BAI_DOC_TRONG", chiTiet: `Bài "${b.title}" chưa có nội dung` });
      }
      // ⚠️ Cổng này thêm ĐÚNG ở PR mở loại bài `QUIZ`, không sớm hơn. Thêm cổng
      // lúc chưa có đường tạo đề chỉ đổi chỗ người bị kẹt: từ người học sang người
      // soạn, và họ cũng không có cách nào thoát (quy ước 20).
      //
      // Bài kiểm tra không đề thì người học mở ra là kẹt, và điều kiện hoàn thành
      // khoá không bao giờ đạt được — im lặng.
      if (b.kind === "QUIZ" && !b.examId) {
        loi.push({
          code: "BAI_THI_CHUA_CO_DE",
          chiTiet: `Bài kiểm tra "${b.title}" chưa gắn đề thi`,
        });
      }
      // ⚠️ Cổng này thêm ĐÚNG ở PR mở loại bài `TASK`, cùng lúc với đường nộp và
      // đường chấm — không sớm hơn, không muộn hơn.
      //
      // Bài tập không khung chấm thì người chấm mở ra không có tiêu chí nào để cho
      // điểm, lượt nộp nằm lại vĩnh viễn, và điều kiện hoàn thành khoá không bao
      // giờ đạt được — im lặng.
      if (b.kind === "TASK" && !b.rubricId) {
        loi.push({
          code: "BAI_TAP_CHUA_CO_KHUNG",
          chiTiet: `Bài tập "${b.title}" chưa gắn khung chấm`,
        });
      }
    }
  }

  const coBatBuoc = chuong.some((c) => c.lessons.some((b) => b.required));
  if (chuong.length > 0 && !coBatBuoc) {
    // Không bài nào bắt buộc thì phép cuộn tiến độ ra mẫu số 0 và KHÔNG AI từng
    // "hoàn thành" khoá này — im lặng, không có gì vỡ.
    loi.push({
      code: "KHONG_CO_BAI_BAT_BUOC",
      chiTiet: "Khoá phải có ít nhất một bài bắt buộc, nếu không sẽ không ai hoàn thành được",
    });
  }

  return { ok: loi.length === 0, loi };
}


/**
 * EL-10 (C10) — PHỤ ĐỀ TIẾNG VIỆT LÀ ĐIỀU KIỆN XUẤT BẢN, không phải tuỳ chọn.
 *
 * Áp cho mọi bài VIDEO của khoá thuộc chương trình `MANDATORY` hoặc
 * `MANDATORY_COMPLIANCE`.
 *
 * ⚠️ Vì sao là cổng CỨNG chứ không phải khuyến nghị: hoàn thành khoá bắt buộc là
 * nghĩa vụ lao động có hạn chót; không có phụ đề là loại trừ người khiếm thính
 * khỏi một nghĩa vụ. Và quan trọng hơn — ngày nào đó bổ sung phụ đề HỒI TỐ cho
 * toàn bộ khoá đã xuất bản là việc không ai làm nổi. Cổng chỉ chặn được ở đây,
 * lúc khoá chưa ra.
 *
 * ⚠️ `natureTag = null` (khoá chưa gắn chương trình) ⇒ CHẶN, không cho qua.
 * Không biết khoá có bắt buộc hay không thì cho qua là chọn phía mà cái giá của
 * việc sai là VĨNH VIỄN. Thông báo nói rõ hai đường thoát: gắn chương trình, hoặc
 * thêm phụ đề.
 */
export function kiemPhuDe(input: {
  chuong: ChuongTrongDanBai[];
  natureTag: string | null;
}): { ok: boolean; loi: { code: LoiDanBai; chiTiet: string }[] } {
  const loi: { code: LoiDanBai; chiTiet: string }[] = [];
  const coVideo = input.chuong.some((c) => c.lessons.some((b) => b.kind === "VIDEO"));

  if (input.natureTag === null) {
    if (coVideo) {
      loi.push({
        code: "CHUA_BIET_KHOA_CO_BAT_BUOC",
        chiTiet:
          "Khoá chưa gắn chương trình nên chưa biết có bắt buộc không — gắn chương trình, hoặc thêm phụ đề cho mọi bài video",
      });
    }
    return { ok: loi.length === 0, loi };
  }

  if (input.natureTag !== "MANDATORY" && input.natureTag !== "MANDATORY_COMPLIANCE") {
    return { ok: true, loi };
  }

  for (const c of input.chuong) {
    for (const b of c.lessons) {
      if (b.kind !== "VIDEO") continue;
      if (!b.captionKey?.trim()) {
        loi.push({
          code: "BAI_VIDEO_THIEU_PHU_DE",
          chiTiet: `Bài video "${b.title}" chưa có phụ đề tiếng Việt — khoá bắt buộc thì phụ đề là điều kiện xuất bản`,
        });
      }
    }
  }
  return { ok: loi.length === 0, loi };
}
