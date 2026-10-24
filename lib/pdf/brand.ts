// lib/pdf/brand.ts — nhận diện thương hiệu dùng chung cho 2 phiếu đánh giá học viên
// (phiếu trải nghiệm + phiếu nhận xét buổi học). Bảng màu/tagline lấy đúng từ bản
// thiết kế gốc mà trung tâm đang phát cho phụ huynh, để PDF xuất ra không lệch với bản in.
import fs from "fs";
import path from "path";
import { Font } from "@react-pdf/renderer";

export const BRAND = {
  purple: "#4A2583",
  purpleLight: "#6B3EAF",
  orange: "#F38B35",
  /** Nền giấy phiếu trải nghiệm. */
  cream: "#FDFBF7",
  /** Nền hộp tiêu đề. */
  box: "#FCEBD7",
  /** Nền ô nhóm tiêu chí trong bảng. */
  cell: "#FAF8F5",
  gray: "#F9F9F9",
  line: "#E0E0E0",
  lineSoft: "#EEEEEE",
  text: "#333333",
  textStrong: "#222222",
  textMuted: "#777777",
} as const;

export const BRAND_TAGLINE = "TRUNG TÂM ĐÀO TẠO STEM LẬP TRÌNH ROBOTICS & AI";

const FONT_REGULAR = path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf");

Font.register({
  family: "NotoSans",
  fonts: [
    { src: FONT_REGULAR, fontWeight: "normal" },
    { src: FONT_BOLD, fontWeight: "bold" },
  ],
});

/** Tỉ lệ logo gốc (644×380) — dùng để suy chiều cao từ chiều rộng mong muốn. */
export const LOGO_RATIO = 644 / 380;

// ---------------------------------------------------------------------------
// Vá lỗi mất chữ khi 1 tiến trình xuất nhiều PDF
// ---------------------------------------------------------------------------
// @react-pdf/font ghi nhớ đối tượng fontkit trong `FontSource.loadResultPromise`
// và dùng lại cho MỌI tài liệu suốt vòng đời tiến trình. Bộ subset glyph của tài
// liệu ĐẦU TIÊN bị dùng lại cho các tài liệu sau ⇒ glyph nào tài liệu đầu không
// dùng sẽ biến mất không báo lỗi (triệu chứng đã gặp: thẻ dự án in ra "ự án 1"
// vì mất chữ "D", do phiếu trải nghiệm — không có chữ D nào — được xuất trước).
// `Font.reset()` của thư viện KHÔNG chữa được: nó chỉ xoá `data` mà giữ nguyên
// `loadResultPromise`, nên `load()` trả về promise cũ và không nạp lại.
// Vì vậy phải tự xoá cả hai. Đây là field nội bộ ⇒ dò an toàn, sai shape thì bỏ qua.
type MutableFontSource = { src?: unknown; data: unknown; loadResultPromise: unknown };

// ⚠️ TUYỆT ĐỐI KHÔNG xả 12 font chuẩn PDF. Chúng chỉ được nạp DUY NHẤT một lần trong
// constructor của FontStore; `fetchAssets` về sau chỉ nạp lại family nào có tên trong
// `style.fontFamily`, mà mọi phiếu của mình đều là "NotoSans". Xả nhầm ⇒ `data` của
// Helvetica còn null vĩnh viễn, trong khi @react-pdf luôn nhét 'Helvetica' làm font dự
// phòng cuối cho MỌI đoạn text và đọc `.data` đồng bộ ⇒ ký tự nào NotoSans không có
// (emoji, chữ Hán/Hàn/Nhật, ✓ ★ →) sẽ ném `Cannot read properties of null (reading
// 'unitsPerEm')` ⇒ 500 thay vì chỉ mất ký tự đó. Danh sách dưới đây là base-14 của
// chuẩn PDF (cố định, không đổi theo phiên bản thư viện).
const STANDARD_PDF_FONTS = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-Oblique",
  "Courier-BoldOblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-Oblique",
  "Helvetica-BoldOblique",
  "Times-Roman",
  "Times-Bold",
  "Times-Italic",
  "Times-BoldItalic",
  "Symbol",
  "ZapfDingbats",
]);

function flushFontCache(): void {
  const families = Font.getRegisteredFonts() as unknown as Record<
    string,
    { sources?: MutableFontSource[] } | undefined
  >;
  for (const family of Object.values(families)) {
    for (const source of family?.sources ?? []) {
      if (!source || typeof source !== "object" || !("loadResultPromise" in source)) continue;
      if (typeof source.src === "string" && STANDARD_PDF_FONTS.has(source.src)) continue;
      source.data = null;
      source.loadResultPromise = null;
    }
  }
}

let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Bọc quanh `renderToBuffer` để mỗi phiếu được dựng với font nạp lại từ đầu.
 *
 * Nối đuôi tuần tự vì cache font là trạng thái dùng chung toàn tiến trình: hai
 * request xuất PDF cùng lúc mà xả cache của nhau giữa chừng thì lại hỏng tiếp.
 * Xuất PDF là thao tác thưa nên xếp hàng không đáng kể; đổi lại kết quả ổn định.
 */
export function withFreshFonts<T>(render: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(() => {
    flushFontCache();
    return render();
  });
  // Đuôi hàng đợi phải quên kết quả: giữ nguyên `run` là ôm luôn Buffer PDF cuối cùng
  // trong biến module cho tới lần render sau.
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let logoCache: { data: Buffer; format: "png" } | null = null;

/**
 * Bytes của logo cho <Image>. ⚠️ @react-pdf coi `src` dạng chuỗi là URL và đi `fetch`,
 * nên truyền đường dẫn file sẽ im lặng không vẽ gì — bắt buộc nạp bytes thủ công.
 */
export function logoSrc(): { data: Buffer; format: "png" } {
  if (!logoCache) {
    logoCache = {
      data: fs.readFileSync(path.join(process.cwd(), "public/brand/logo-satarobo.png")),
      format: "png",
    };
  }
  return logoCache;
}
