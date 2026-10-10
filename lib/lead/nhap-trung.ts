/**
 * NHẬP LẠI MỘT LEAD ĐÃ CÓ — luật ghi đè. Hàm THUẦN, không chạm DB.
 *
 * ── VÌ SAO TÁCH RA MỘT TỆP RIÊNG ─────────────────────────────────────────────────────────
 * Đây là chỗ DUY NHẤT trong repo cố ý ghi đè dữ liệu người dùng đã nhập tay. Mọi đường khác
 * chỉ thêm. Một phép ghi đè viết lỏng tay không ném lỗi, không làm test đỏ, và không ai phát
 * hiện cho tới khi Sale mở lead ra và thấy ghi chú cuộc gọi của mình biến mất — lúc đó không
 * khôi phục được.
 *
 * Nên luật nằm ở một hàm thuần, có tên, có test, thay vì trải ra trong một route handler cần
 * auth + phân tích xlsx mới chạy tới (luật 12b).
 *
 * ── CHỐT 15/09/2026, BẢN THỨ HAI — ĐẢO CHIỀU BẢN ĐẦU ─────────────────────────────────────
 * Bản đầu (sáng 15/09) làm theo câu "ghi đè các thông tin cũ, thông tin nào chưa có thì fill
 * vào": file THẮNG ở mọi ô file có giá trị.
 *
 * Chủ dự án xem bản chạy thật rồi chốt lại: "các trường hợp trùng thì các thông tin khác sẽ
 * ghi tiếp nối ở ghi chú, KHÔNG update thay thế hoàn toàn". Nếp của repo là quyết định ra SAU
 * thắng, nên luật hiện hành là:
 *
 *   ô file TRỐNG            → không đụng tới
 *   ô đang lưu TRỐNG        → ĐIỀN giá trị của file vào
 *   ô đang lưu ĐÃ CÓ, khác  → GIỮ NGUYÊN, và ghi lại giá trị của file vào ghi chú
 *   ô đang lưu ĐÃ CÓ, giống → không làm gì
 *
 * Vì sao bản hai đúng hơn: dữ liệu đang lưu là thứ Sale đã xác minh qua điện thoại, còn dữ
 * liệu trong file là thứ ai đó gõ vào Excel. Cho file thắng là để bản chưa xác minh đè lên
 * bản đã xác minh — mà lượt ghi đè ấy không ai thấy và không khôi phục được.
 *
 * Không mất gì cả: giá trị trong file vẫn được ghi lại nguyên văn ở ghi chú, nên người nào
 * muốn lấy nó vẫn lấy được bằng tay, sau khi tự quyết định bản nào đúng.
 *
 * ── HAI CỘT VẪN ĐƯỢC BẢO VỆ RIÊNG ────────────────────────────────────────────────────────
 * · `note`   — nhật ký gọi điện do Sale tự gõ. Chỉ NỐI THÊM, không bao giờ thay thế.
 * · `status` — trạng thái phễu. File nhập không có cột này, nhưng nếu đẩy một lead đang ở
 *              L3 về MOI thì báo cáo phễu và hoa hồng lệch theo. Không bao giờ đụng tới.
 *
 * ── CHỐT 16/09/2026 — THÊM ĐƯỜNG GHI ĐÈ, NGƯỜI DÙNG TỰ BẬT (`ghiDe`) ─────────────────────
 * Chủ dự án: "chỗ nhập lead = excel thiết kế thêm tuỳ chọn ghi đè riêng cho các lead bị
 * trùng nữa". Đây KHÔNG phải đảo lại chốt 15/09: luật mặc định vẫn y nguyên (giữ giá trị
 * đang lưu), chỉ thêm một đường người vận hành phải TỰ TICK cho từng dòng.
 *
 * Bật `ghiDe` thì đúng MỘT nhánh đổi chiều — nhánh "ô đang lưu đã có, file ghi khác":
 *
 *   ô file TRỐNG            → không đụng tới  (y như cũ: file im lặng KHÔNG phải lệnh xoá)
 *   ô đang lưu TRỐNG        → ĐIỀN            (y như cũ)
 *   ô đang lưu ĐÃ CÓ, khác  → ĐÈ bằng giá trị file, GIÁ TRỊ CŨ ghi vào ghi chú  ← đổi chiều
 *   ô đang lưu ĐÃ CÓ, giống → không làm gì    (y như cũ)
 *
 * ⚠️ BẤT BIẾN GIỮ NGUYÊN Ở CẢ HAI CHẾ ĐỘ: KHÔNG MẤT DỮ LIỆU. Chế độ nào cũng ghi bên THUA
 * vào ghi chú kèm ngày — chỉ đổi bên nào thắng. Ngày nào có người gỡ mất `dongGhiDe` thì
 * ghi đè thành phá huỷ thật: giá trị Sale xác minh qua điện thoại biến mất không dấu vết,
 * và không còn bản sao nào để lấy lại.
 *
 * ⚠️ `note` và `status` KHÔNG nằm trong phạm vi `ghiDe`. `ghiDe` nghĩa là "tin file hơn bản
 * ghi" cho DỮ LIỆU LIÊN HỆ; nhật ký gọi điện thì không có khái niệm đó — file làm gì có
 * nhật ký. Còn `status` thì file nhập không có cột nào sinh ra nó.
 */

import { vnParts } from "@/lib/time/vn";

/** Giá trị file mang tới. `undefined`/`null`/chuỗi rỗng đều nghĩa là "file không nói gì". */
export interface OLeadTuFile {
  parentName?: string | null;
  email?: string | null;
  childName?: string | null;
  childAge?: number | null;
  centerId?: string | null;
  orgUnitId?: string | null;
  courseId?: string | null;
  source?: string | null;
  note?: string | null;
}

/** Ảnh chụp lead đang có trong hệ thống. */
export interface OLeadDangCo {
  parentName?: string | null;
  email?: string | null;
  childName?: string | null;
  childAge?: number | null;
  centerId?: string | null;
  orgUnitId?: string | null;
  courseId?: string | null;
  source?: string | null;
  note?: string | null;
}

export interface KhacBiet {
  /** Nhãn tiếng Việt của cột. */
  cot: string;
  /** Giá trị đang lưu trong hệ thống. */
  dangLuu: string;
  /** Giá trị trong file. */
  trongFile: string;
}

export interface BanCapNhatLead {
  /** Chỉ chứa cột THỰC SỰ ghi — cột không đổi không có mặt, để `updatedAt` nói thật. */
  data: Record<string, unknown>;
  /** Nhãn những cột ĐANG TRỐNG vừa được điền từ file. */
  daDien: string[];
  /**
   * Cột file ghi KHÁC mà hệ GIỮ giá trị đang lưu; giá trị file chỉ vào ghi chú.
   * Chế độ `ghiDe` → luôn rỗng.
   */
  khacBiet: KhacBiet[];
  /**
   * Cột file ghi KHÁC mà hệ ĐÃ ĐÈ; giá trị cũ đã được ghi vào ghi chú.
   * Chế độ mặc định → luôn rỗng.
   *
   * Hai mảng tách đôi chứ không dùng chung một mảng kèm cờ: nhật ký và sổ kiểm toán phải
   * nói được ĐÚNG chuyện gì đã xảy ra với từng cột. Một dòng "có 3 ô khác nhau" mà không
   * nói ô nào thắng là dòng nhật ký vô dụng đúng vào lúc cần tra.
   */
  daDe: KhacBiet[];
  /** Ghi chú có được nối thêm gì không (nội dung file và/hoặc dòng đối chiếu). */
  daNoiGhiChu: boolean;
}

/** Nhãn người vận hành đọc được. Khoá phải trùng tên cột Prisma. */
const NHAN: Record<string, string> = {
  parentName: "tên phụ huynh",
  email: "email",
  childName: "tên con",
  childAge: "tuổi con",
  centerId: "cơ sở",
  courseId: "khoá quan tâm",
  source: "nguồn",
};

/**
 * Cột được xét khi nhập lại, theo đúng thứ tự hiện trong nhật ký.
 *
 * ⚠️ `orgUnitId` KHÔNG có trong danh sách này dù nó đi theo cơ sở: nó là bản ghi kép của
 * `centerId` (`lib/org/dual-write.ts` cắm ở `lib/db.ts` tự lo). Liệt kê ra đây là nhật ký báo
 * "đã đổi 2 cột" cho một thay đổi mà người vận hành chỉ thấy là một.
 */
const COT_XET = [
  "parentName",
  "email",
  "childName",
  "childAge",
  "centerId",
  "courseId",
  "source",
] as const;

/** Có phải "không nói gì" không. `0` là giá trị THẬT, đừng để `!x` nuốt mất. */
function trong(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

/** So sánh để biết có thực sự khác không — chuỗi so sau khi cắt khoảng trắng hai đầu. */
function khac(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() !== b.trim();
  return a !== b;
}

function chuoi(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "");
}

/**
 * NỐI ghi chú mới xuống dưới ghi chú cũ.
 *
 * Bỏ qua khi nội dung mới ĐÃ nằm trong ghi chú cũ — nhập lại cùng một file hai lần là chuyện
 * thường (người vận hành sửa vài dòng rồi nhập lại cả file), và mỗi lần nối thêm một bản sao
 * thì sau ba lượt ô ghi chú không đọc được nữa.
 */
export function noiGhiChu(cu: string | null | undefined, moi: string | null | undefined): string | null {
  const m = (moi ?? "").trim();
  const c = (cu ?? "").trim();
  if (!m) return null; // không có gì để nối
  if (!c) return m;
  if (c.includes(m)) return null; // đã có rồi → không nối
  return `${c}\n${m}`;
}

/**
 * `15/09/2026` theo giờ Việt Nam.
 *
 * ⚠️ `vnParts().month` là 0–11 (cố ý giống `Date.getMonth`, có ghi trong `VnParts`), nên
 * PHẢI cộng 1. Bản đầu quên, và ghi chú của một lượt nhập tháng 9 in ra "15/08/2026" — sai
 * tháng trong chính dòng sinh ra để tra ngược, mà nhìn qua thì vẫn là một ngày hợp lệ.
 */
function ngayVn(d: Date): string {
  const { year, month, day } = vnParts(d);
  return `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`;
}

/**
 * Dòng ghi chú ghi lại những giá trị của file KHÔNG được dùng.
 *
 * Đây là thứ thay thế cho phép ghi đè: không mất dữ liệu nào của Sale, mà giá trị trong file
 * cũng không bốc hơi — ai muốn lấy vẫn lấy được bằng tay sau khi tự quyết định bản nào đúng.
 */
export function dongDoiChieu(khacBiet: readonly KhacBiet[], moc: Date): string | null {
  if (khacBiet.length === 0) return null;
  const ve = khacBiet
    .map((k) => `${k.cot} "${k.trongFile}" (đang lưu "${k.dangLuu}")`)
    .join("; ");
  return `${ngayVn(moc)} — nhập lại từ Excel, file ghi khác: ${ve}. Đã GIỮ giá trị đang lưu.`;
}

/**
 * Dòng ghi chú cho chế độ GHI ĐÈ — lưu lại những giá trị vừa BỊ ĐÈ MẤT.
 *
 * ⚠️ Đây là thứ giữ cho "ghi đè" không thành "phá huỷ". Cột vừa bị đè là dữ liệu Sale đã xác
 * minh qua điện thoại; người bấm nút ghi đè đang tin rằng bản trong file mới hơn, và họ có
 * thể tin nhầm. Dòng này là bản sao DUY NHẤT để lấy lại — `updatedAt` chỉ nói CÓ người đụng
 * chứ không nói đụng cái gì, còn `AuditLog` thì Sale không mở được (xem mục
 * `audit-logs:view` trong CLAUDE.md: trên prod chỉ Quản trị tối cao vào được trang đó).
 */
export function dongGhiDe(daDe: readonly KhacBiet[], moc: Date): string | null {
  if (daDe.length === 0) return null;
  const ve = daDe.map((k) => `${k.cot} "${k.trongFile}" (giá trị cũ "${k.dangLuu}")`).join("; ");
  return `${ngayVn(moc)} — nhập lại từ Excel, ĐÃ GHI ĐÈ theo yêu cầu: ${ve}. Giá trị cũ lưu ở dòng này để đối chiếu.`;
}

/**
 * Dựng bản cập nhật cho một lead TRÙNG SĐT vừa gặp lại trong file nhập.
 *
 * `moc` là thời điểm của lượt nhập: nó luôn được ghi vào `lastInboundAt` vì một lượt nhập lại
 * CHÍNH LÀ một lần khách quay lại — đó là ý nghĩa của cột đó, và là thứ đẩy lead lên đầu danh
 * sách `/leads` để Sale thấy mà gọi.
 *
 * `ghiDe` CỐ Ý KHÔNG CÓ MẶC ĐỊNH (luật 7 — "tham số có mặc định NGUY HIỂM thì bỏ mặc định").
 * Đây là công tắc quyết định dữ liệu Sale nhập tay còn hay mất; để nó tuỳ chọn là một ngày
 * nào đó có người thêm đường gọi mới, quên truyền, và nhánh nào chạy thì tuỳ vào giá trị mặc
 * định chứ không tuỳ vào ý ai. Bắt buộc thì `tsc` liệt kê đủ call site ra màn hình.
 */
export function dungBanCapNhatLeadTrung(params: {
  cu: OLeadDangCo;
  file: OLeadTuFile;
  moc: Date;
  /** `true` = người vận hành đã TỰ TICK ghi đè cho đúng dòng này ở màn nhập. */
  ghiDe: boolean;
}): BanCapNhatLead {
  const { cu, file, moc, ghiDe } = params;
  const data: Record<string, unknown> = { lastInboundAt: moc };
  const daDien: string[] = [];
  const khacBiet: KhacBiet[] = [];
  const daDe: KhacBiet[] = [];

  for (const cot of COT_XET) {
    const vFile = file[cot];
    // File không nói gì → không đụng.
    //
    // ⚠️ Vế này ĐỨNG TRƯỚC `ghiDe` và không bao giờ được cho `ghiDe` vượt qua: "ghi đè"
    // nghĩa là tin giá trị TRONG FILE, mà ô trống thì file không mang giá trị nào cả. Cho
    // nó đè là biến một cột bỏ trống trong Excel thành lệnh XOÁ cả cột trên lead thật —
    // không ai bấm nút với ý đó, và file thật thì cột nào cũng có dòng bỏ trống.
    if (trong(vFile)) continue;

    const vSach = typeof vFile === "string" ? vFile.trim() : vFile;

    if (trong(cu[cot])) {
      // Ô đang TRỐNG → điền. Đây là nửa "thông tin nào chưa có thì fill vào" của chốt gốc,
      // và nó không ghi đè gì cả nên không có rủi ro mất dữ liệu. Giống nhau ở CẢ HAI chế độ.
      data[cot] = vSach;
      daDien.push(NHAN[cot] ?? cot);
      continue;
    }

    // Ô đã CÓ giá trị và file ghi KHÁC — đây là nhánh DUY NHẤT `ghiDe` đổi chiều.
    if (!khac(vFile, cu[cot])) continue;
    const ve: KhacBiet = {
      cot: NHAN[cot] ?? cot,
      dangLuu: chuoi(cu[cot]),
      trongFile: chuoi(vFile),
    };
    if (ghiDe) {
      data[cot] = vSach;
      daDe.push(ve);
    } else {
      khacBiet.push(ve);
    }
  }

  // Cơ sở được GHI (điền vào ô trống, hoặc đè khi người dùng bật) thì đơn vị tổ chức đi
  // theo — không kể vào `daDien`/`daDe` vì người vận hành chỉ thấy đó là MỘT thay đổi.
  if ("centerId" in data && !trong(file.orgUnitId)) data.orgUnitId = file.orgUnitId;

  // Ghi chú: nội dung file trước, rồi tới dòng lưu vết. Đúng MỘT trong hai dòng lưu vết có
  // nội dung — mảng còn lại rỗng nên hàm kia trả `null`.
  let ghiChu = cu.note ?? null;
  let daNoi = false;
  for (const phan of [file.note, dongDoiChieu(khacBiet, moc), dongGhiDe(daDe, moc)]) {
    const noi = noiGhiChu(ghiChu, phan);
    if (noi !== null) {
      ghiChu = noi;
      daNoi = true;
    }
  }
  if (daNoi) data.note = ghiChu;

  return { data, daDien, khacBiet, daDe, daNoiGhiChu: daNoi };
}

/**
 * Câu nhật ký cho lượt cập nhật — người vận hành mở lead ra phải đọc được ĐÚNG cái gì đã đổi.
 *
 * Một dòng "Cập nhật từ import Excel" trống rỗng là thứ tệ nhất có thể ghi: nó chứng minh có
 * người đụng vào, mà không nói đụng cái gì, nên ai nghi mất dữ liệu cũng không tra được.
 */
export function moTaLuotCapNhat(ban: BanCapNhatLead, chiaLai: boolean): string {
  const phan: string[] = [];
  phan.push(
    ban.daDien.length > 0
      ? `Nhập lại từ Excel — điền ${ban.daDien.join(", ")} (ô đang để trống)`
      : "Nhập lại từ Excel — không ô trống nào được điền",
  );
  if (ban.khacBiet.length > 0) {
    phan.push(
      `GIỮ NGUYÊN ${ban.khacBiet.length} ô file ghi khác (${ban.khacBiet
        .map((k) => k.cot)
        .join(", ")}) — giá trị trong file đã ghi vào ghi chú`,
    );
  }
  if (ban.daDe.length > 0) {
    // Phải nói thẳng chữ GHI ĐÈ. Đây là lần duy nhất hệ thống xoá dữ liệu người dùng nhập
    // tay; một câu nhật ký nói tránh ("đã cập nhật 3 ô") là thứ khiến người đọc lướt qua
    // đúng dòng họ cần dừng lại.
    phan.push(
      `GHI ĐÈ ${ban.daDe.length} ô theo yêu cầu (${ban.daDe
        .map((k) => k.cot)
        .join(", ")}) — giá trị cũ đã ghi vào ghi chú`,
    );
  }
  phan.push(
    chiaLai
      ? "lead được chia lại cho tư vấn viên mới"
      : "lead đã chốt nên GIỮ NGUYÊN người phụ trách",
  );
  return phan.join(" · ");
}

/**
 * Lead này còn được chia lại không.
 *
 * Chủ dự án chốt 15/09/2026: chỉ chia lại lead CHƯA chốt. Lead đã ghi danh xong thì hoa hồng
 * đã tính theo người đang giữ, và đổi chủ lúc đó là tranh chấp tiền chứ không phải dọn dữ liệu.
 *
 * ⚠️ `status` MỘT MÌNH LÀ THIẾU, và đây là cái bẫy đã có sẵn trong repo: tập trạng thái đóng
 * chỉ còn `DA_MAT`, nên lead convert xong vẫn mang `DA_DANG_KY` và trông như đang mở.
 * `convertedAt` mới là dấu "đã xong thật" — cùng lý lẽ với `LEAD_DANG_MO` ở
 * `lib/lead/assign.ts`, viết lại ở đây dưới dạng THUẦN vì đường nhập cầm sẵn bản ghi trong
 * tay chứ không đi qua một câu `where`.
 */
export function conMoDeChiaLai(params: {
  status: string;
  convertedAt: Date | null;
  trangThaiDong: readonly string[];
}): boolean {
  if (params.convertedAt !== null) return false;
  return !params.trangThaiDong.includes(params.status);
}
