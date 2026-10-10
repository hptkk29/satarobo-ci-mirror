"use client";

/**
 * KHUNG NHẬP EXCEL — dùng chung cho 10 màn nhập (lead · học viên · nhân sự · lớp · phòng ·
 * kho · câu hỏi · cơ sở · ngày nghỉ · khách đã đăng ký).
 *
 * ── THIẾT KẾ LẠI 15/09/2026 ──────────────────────────────────────────────────────────────
 * Chủ dự án: "cần phân ra 3 danh sách: lead hợp lệ, lead trùng, lead lỗi để dễ nhìn thấy và
 * xử lý, thêm nút sửa ở sau cùng để sửa tay khi lỗi đỡ mất công phải sửa excel rồi nhập lại".
 *
 * Bản cũ dồn mọi dòng vào MỘT bảng với một cột "Status", nên việc thật của người dùng — phân
 * loại và xử lý — phải làm bằng mắt, cuộn dọc tìm ô đỏ. Màn này là một màn PHÂN LOẠI, nên
 * cấu trúc của nó phải là phân loại: ba nhóm, mỗi nhóm một việc khác nhau.
 *
 *   hợp lệ  → không phải làm gì, chỉ liếc qua cho yên tâm
 *   trùng   → đọc xem hệ thống sẽ làm gì với bản ghi cũ, sửa nếu không đúng ý
 *   lỗi     → phải sửa, nếu không dòng đó mất
 *
 * ── ĐO ĐƯỢC TRƯỚC KHI SỬA ────────────────────────────────────────────────────────────────
 * · **0 điểm ngắt responsive** trong toàn bộ 589 dòng của bản cũ. Một bảng 10 cột cố định
 *   trên màn 320px là không dùng được, mà 9/10 màn nhập đều đi qua đúng tệp này.
 * · `slice(0, 100)` — chỉ 100 dòng đầu hiện ra, và nút xoá cũng chỉ có ở 100 dòng đó. File
 *   300 dòng thì 200 dòng cuối không ai xem được trước khi bấm Nhập.
 * · `max-w-[200px] truncate` trên mọi ô, không có `title` — giá trị dài bị cắt và KHÔNG có
 *   cách nào đọc được nó.
 * · Trạng thái vẽ bằng emoji (✅ ❌ ⚠️ 🔀) thay cho bộ biểu tượng.
 *
 * ── VÌ SAO TỰ PHÂN TRANG, KHÔNG BỌC `PhanTrangBang` ──────────────────────────────────────
 * Vì cùng một trang dữ liệu phải hiện ra ở HAI hình dạng: bảng (từ `md`) và thẻ xếp dọc
 * (dưới `md`). `PhanTrangBang` giữ số trang bên trong nó và chỉ cắt `<tbody>`, nên hai hình
 * dạng sẽ lệch trang nhau. Trang được giữ ở đây, còn `DieuHuongTrang` vẫn là thanh điều
 * hướng dùng chung của repo — và cổng `bang-coverage.test.ts` nhận chính thẻ đó làm bằng
 * chứng "bảng này CÓ phân trang", nên không phải xin miễn trừ.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";
import {
  FileSpreadsheet,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Trash2,
  Pencil,
  Check,
  Copy,
  CircleAlert,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { DieuHuongTrang } from "@/components/ui/dieu-huong-trang";

export interface ImportResult {
  success: number;
  /** Bản ghi ĐÃ CÓ được cập nhật (màn upsert / nhập lại). Không khai = 0. */
  updated?: number;
  errors: { row: number; error: string }[];
}

/** Ngữ cảnh kèm theo khi Import: dòng Excel gốc của từng row + tập dòng đã "Xác nhận gộp". */
export interface ImportContext {
  /** excelRowOf[i] = số dòng Excel gốc của rows[i]. */
  excelRowOf: number[];
  /** Các số dòng Excel đã được bấm nút xác nhận (confirmDuplicates). */
  confirmed: Set<number>;
  /**
   * Các số dòng Excel người dùng đã tick "ghi đè" (`overwriteDuplicates`).
   *
   * Luôn có mặt (rỗng khi màn không bật tính năng), để trang gọi không phải kiểm `undefined`
   * trước khi đọc — một `ctx?.ghiDe?.has()` viết thiếu dấu chấm hỏi nào đó là im lặng trả
   * `false` cho MỌI dòng, tức nuốt sạch lệnh ghi đè mà không báo gì.
   */
  ghiDe: Set<number>;
}

/** Một cột của file nhập, như màn gọi khai báo. */
export interface GoiYCot {
  key: string;
  label: string;
  required?: boolean;
  /**
   * Đổi giá trị thô của ô thành dạng NGƯỜI ĐỌC trước khi bày ra.
   *
   * Sinh ra cho cột SĐT: file có thể ghi `84905123456`, `+84 905 123 456`, hay `905123456`
   * (Excel lưu kiểu number nên nuốt mất số 0 đầu) — cả ba đều được hệ thống coi là CÙNG một
   * số, nhưng bày nguyên văn thì người nhập không đối chiếu được với danh bạ của họ.
   *
   * ⚠️ Chỉ đổi phần HIỂN THỊ. Giá trị gốc vẫn đọc lại được ở tooltip, ô nhập lúc sửa tay vẫn
   * mang giá trị của file, và thứ gửi lên server cũng là giá trị gốc — tầng phân tích của
   * từng màn mới là nơi chuẩn hoá thật.
   */
  hienThi?: (giaTriTho: unknown) => string;
}

export interface ExcelImporterProps<T> {
  templateUrl: string;
  templateFilename: string;
  parseRow: (row: Record<string, unknown>, rowIndex: number) => T | { error: string };
  onImport: (rows: T[], ctx?: ImportContext) => Promise<ImportResult>;
  columnHints: {
    key: string;
    label: string;
    required?: boolean;
    /**
     * Đổi giá trị thô của ô thành dạng NGƯỜI ĐỌC trước khi bày ra.
     *
     * Sinh ra cho cột SĐT: file có thể ghi `84905123456`, `+84 905 123 456`, hay `905123456`
     * (Excel lưu kiểu number nên nuốt mất số 0 đầu) — cả ba đều được hệ thống coi là CÙNG
     * một số, nhưng bày nguyên văn thì người nhập không đối chiếu được với danh bạ của họ.
     *
     * ⚠️ Chỉ đổi phần HIỂN THỊ. Giá trị gốc vẫn nằm ở tooltip, ô nhập lúc sửa tay vẫn mang
     * giá trị của file, và thứ gửi lên server cũng là giá trị gốc — tầng phân tích của từng
     * màn mới là nơi chuẩn hoá thật.
     */
    hienThi?: (giaTriTho: unknown) => string;
  }[];
  title?: string;
  /**
   * Khoá chống trùng TRONG FILE, hiện ngay ở preview (server vẫn là chốt chặn
   * cuối). Trả về key chuẩn hoá từ dòng raw (vd SĐT bỏ ký tự lạ); null/"" = bỏ
   * qua dòng đó. Dòng TRÙNG (xuất hiện sau) bị đánh dấu "Trùng với dòng N" —
   * xoá dòng gốc thì dòng sau tự hết (tính lại động).
   */
  duplicateKey?: (raw: Record<string, unknown>) => string | null | undefined;
  /** Nhãn cột dùng trong thông báo trùng (vd "SĐT"). */
  duplicateLabel?: string;
  /**
   * Đối chiếu với dữ liệu ĐÃ CÓ trong hệ thống (gọi API sau khi parse xong).
   * Trả về Map<số dòng Excel, msg> (dòng KHÔNG nhập được) hoặc
   * {errors?, warnings?}: warnings = dòng VẪN nhập được và sẽ ghi đè bản ghi cũ.
   * Lỗi mạng → rỗng (server vẫn tự chặn).
   */
  checkExisting?: (
    raws: Record<string, unknown>[],
    excelRows: number[],
  ) => Promise<
    | Map<number, string>
    | { errors?: Map<number, string>; warnings?: Map<number, string> }
  >;
  /**
   * Cho phép NGƯỜI DÙNG XÁC NHẬN từng dòng trùng (trong-file + trùng DB) để vẫn
   * nhập theo nghĩa GỘP/GHI ĐÈ thay vì bị bỏ qua. Trang nhận biết qua
   * `ctx.confirmed` trong `onImport`.
   */
  confirmDuplicates?: { label: string };
  /**
   * Dòng trùng KHÔNG cần bấm xác nhận — server tự xử lý (vd lead: cùng SĐT = cùng nhà).
   * Ưu tiên hơn `confirmDuplicates`.
   */
  mergeDuplicates?: { label: string };
  /**
   * CỘT "ĐÈ" cho nhóm Trùng — người vận hành tự chọn dòng nào được ghi đè bản ghi cũ.
   *
   * Chủ dự án 16/09/2026: "thiết kế thêm tuỳ chọn ghi đè riêng cho các lead bị trùng nữa",
   * kèm yêu cầu cụ thể "có 1 ô tích ở hàng trên cùng chỗ chữ đè để tick tất cả nữa".
   *
   * ⚠️ Cột này CHỈ hiện ở tab Trùng. Ở tab Hợp lệ không có bản ghi cũ nào để đè, nên một ô
   * tick ở đó là một lời hứa suông — và affordance nói dối thì không ném lỗi, không làm test
   * đỏ, chỉ người bấm mới biết (luật 12).
   *
   * Không khai prop này = màn đó không có cột, không có state, không gửi gì thêm. 9 màn nhập
   * còn lại dùng chung tệp này nên mặc định phải là KHÔNG CÓ GÌ ĐỔI.
   */
  overwriteDuplicates?: {
    /** Nhãn cột, viết ngắn (vd "Đè"). */
    label: string;
    /** Câu giải thích ở đầu tab Trùng — nói rõ đè cái gì và cái gì được giữ. */
    moTa: string;
    /** Câu thay cho dòng lý do của những dòng ĐÃ tick. Phải nói đúng việc sẽ xảy ra. */
    chuKhiBat: string;
  };
}

type Step = "idle" | "preview" | "importing" | "done";

/** Ba nhóm của màn phân loại. Thứ tự này là thứ tự tab, và là thứ tự người dùng xử lý. */
type Nhom = "hopLe" | "trung" | "loi";

const TEN_NHOM: Record<Nhom, string> = {
  hopLe: "Hợp lệ",
  trung: "Trùng",
  loi: "Lỗi",
};

const SO_DONG_MOI_TRANG = 25;

function isErrorRow<T>(row: T | { error: string }): row is { error: string } {
  return typeof row === "object" && row !== null && "error" in row;
}

/** Ô Excel → chuỗi hiển thị. `null`/`undefined` thành rỗng, KHÔNG thành chữ "null". */
function oThanhChuoi(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function ExcelImporter<T>({
  templateUrl,
  templateFilename,
  parseRow,
  onImport,
  columnHints,
  title = "Nhập từ Excel",
  duplicateKey,
  duplicateLabel = "dữ liệu",
  checkExisting,
  confirmDuplicates,
  mergeDuplicates,
  overwriteDuplicates,
}: ExcelImporterProps<T>) {
  const [step, setStep] = useState<Step>("idle");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [parsedRows, setParsedRows] = useState<(T | { error: string })[]>([]);
  // Số dòng Excel GỐC của từng row (bắt đầu 2 vì dòng 1 là header) — giữ nguyên
  // sau khi xoá bớt dòng, để người nhập tra ngược lại file của họ.
  const [excelRows, setExcelRows] = useState<number[]>([]);
  // Trùng với dữ liệu ĐÃ CÓ — key theo SỐ DÒNG EXCEL (ổn định khi xoá bớt dòng).
  const [dbDup, setDbDup] = useState<Map<number, string>>(new Map());
  // Cảnh báo GHI ĐÈ: dòng VẪN nhập được — key theo dòng Excel.
  const [dbWarn, setDbWarn] = useState<Map<number, string>>(new Map());
  const [confirmedDups, setConfirmedDups] = useState<Set<number>>(new Set());
  /**
   * Dòng người dùng tick "ghi đè" — key theo SỐ DÒNG EXCEL, không phải index.
   *
   * Cùng lý do với `confirmedDups`: xoá bớt dòng làm index trôi, và một lệnh GHI ĐÈ trôi
   * sang dòng khác là đè nhầm lead — hỏng theo kiểu không khôi phục được.
   */
  const [ghiDeRows, setGhiDeRows] = useState<Set<number>>(new Set());
  const [checkingDb, setCheckingDb] = useState(false);
  /** Lý do lượt nhập HỎNG — hiện tại chỗ, không phải hộp thoại. `null` = chưa hỏng. */
  const [loiNhap, setLoiNhap] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filename, setFilename] = useState("");

  const [nhom, setNhom] = useState<Nhom>("hopLe");
  const [trang, setTrang] = useState(1);
  /** Index (trong mảng hiện tại) của dòng đang sửa tay; `null` = không sửa dòng nào. */
  const [dangSua, setDangSua] = useState<number | null>(null);

  const parseFile = useCallback(
    async (file: File) => {
      try {
        setFilename(file.name);
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) {
          alert("File Excel không có sheet nào");
          return;
        }
        const sheet = wb.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: null,
        });
        if (rows.length === 0) {
          alert("File Excel rỗng hoặc sai format");
          return;
        }
        if (rows.length > 5000) {
          alert(`File quá lớn (${rows.length} dòng). Tối đa 5000.`);
          return;
        }
        setRawRows(rows);
        setParsedRows(rows.map((row, idx) => parseRow(row, idx)));
        const excelNos = rows.map((_, idx) => idx + 2);
        setExcelRows(excelNos);
        setDbDup(new Map());
        setDbWarn(new Map());
        setConfirmedDups(new Set());
        setGhiDeRows(new Set());
        setDangSua(null);
        setTrang(1);
        setStep("preview");
        if (checkExisting) {
          setCheckingDb(true);
          checkExisting(rows, excelNos)
            .then((res) => {
              if (res instanceof Map) {
                setDbDup(res);
              } else {
                setDbDup(res.errors ?? new Map());
                setDbWarn(res.warnings ?? new Map());
              }
            })
            .catch((err) => {
              // Không chặn nhập — server vẫn tự dedupe; chỉ mất phần báo sớm.
              console.error("[ExcelImporter] checkExisting lỗi:", err);
            })
            .finally(() => setCheckingDb(false));
        }
      } catch (err) {
        alert(`Lỗi đọc file: ${err instanceof Error ? err.message : "Unknown"}`);
      }
    },
    [parseRow, checkExisting],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    disabled: step === "importing",
    onDrop: (files) => {
      if (files[0]) parseFile(files[0]);
    },
  });

  // Trùng-trong-file tính ĐỘNG theo trạng thái hiện tại (không lưu vào parsedRows) →
  // xoá hoặc sửa dòng gốc là dòng sau tự hết trùng.
  const dupErrors = useMemo(() => {
    const map = new Map<number, string>();
    if (!duplicateKey) return map;
    const firstSeen = new Map<string, number>(); // key → excelRow đầu tiên
    for (let i = 0; i < parsedRows.length; i++) {
      if (isErrorRow(parsedRows[i])) continue; // dòng đã lỗi parse thì thôi
      const key = duplicateKey(rawRows[i] ?? {});
      if (!key) continue;
      const firstRow = firstSeen.get(key);
      if (firstRow === undefined) {
        firstSeen.set(key, excelRows[i] ?? i + 2);
      } else {
        map.set(i, `Trùng ${duplicateLabel} với dòng ${firstRow} trong file`);
      }
    }
    return map;
  }, [duplicateKey, duplicateLabel, parsedRows, rawRows, excelRows]);

  const isDupRow = (i: number) => dupErrors.has(i) || dbDup.has(excelRows[i] ?? -1);
  const isConfirmedRow = (i: number) => confirmedDups.has(excelRows[i] ?? -1);

  // ── PHÂN LOẠI ───────────────────────────────────────────────────────────────────────
  //
  // Hai câu hỏi KHÁC NHAU, cố ý tách rời:
  //   `nhomCua`  — dòng này thuộc nhóm nào (người dùng nhìn thấy)
  //   `seVao`    — dòng này có thực sự được ghi không (nút Nhập đếm theo cái này)
  //
  // Gộp hai câu lại là chỗ bản cũ sai: dòng trùng chờ xác nhận bị xếp vào "Lỗi", nên người
  // dùng đi sửa file trong khi thứ cần làm chỉ là bấm một nút.
  const nhomCua = (i: number): Nhom => {
    if (isErrorRow(parsedRows[i]!)) return "loi";
    if (isDupRow(i)) return "trung";
    if (dbWarn.has(excelRows[i] ?? -1)) return "trung"; // ghi đè bản ghi cũ = trùng
    return "hopLe";
  };

  const seVao = (i: number): boolean => {
    if (isErrorRow(parsedRows[i]!)) return false;
    if (!isDupRow(i)) return true;
    // Trùng: vào được khi server tự xử lý, hoặc người dùng đã bấm xác nhận.
    return Boolean(mergeDuplicates) || Boolean(confirmDuplicates && isConfirmedRow(i));
  };

  const theoNhom = useMemo(() => {
    const m: Record<Nhom, number[]> = { hopLe: [], trung: [], loi: [] };
    for (let i = 0; i < parsedRows.length; i++) m[nhomCua(i)].push(i);
    return m;
    // `nhomCua` đọc từ đúng các state dưới đây; khai đủ để không đọc giá trị cũ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedRows, dupErrors, dbDup, dbWarn, excelRows, confirmedDups, mergeDuplicates, confirmDuplicates]);

  const validIdx = useMemo(
    () => parsedRows.map((_, i) => i).filter((i) => seVao(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsedRows, dupErrors, dbDup, excelRows, confirmedDups, mergeDuplicates, confirmDuplicates],
  );
  const validRows = validIdx.map((i) => parsedRows[i] as T);

  /** Dòng nằm trong nhóm "trùng" nhưng sẽ KHÔNG được ghi — phải nói ra, đừng để họ tự đoán. */
  const trungBiBo = theoNhom.trung.filter((i) => !seVao(i)).length;

  // ── CỘT "ĐÈ" ────────────────────────────────────────────────────────────────────────
  //
  // Chỉ dựng khi màn có khai `overwriteDuplicates` VÀ người dùng đang đứng ở tab Trùng.
  // Xem chú thích của prop: một ô tick ở tab Hợp lệ là lời hứa suông.
  const coCotDe = Boolean(overwriteDuplicates) && nhom === "trung";
  /** Dòng trùng ĐƯỢC PHÉP tick: phải là dòng thực sự sẽ được ghi, tick dòng bị bỏ là vô nghĩa. */
  const dongDeDuoc = overwriteDuplicates
    ? theoNhom.trung.filter((i) => seVao(i)).map((i) => excelRows[i] ?? i + 2)
    : [];
  const soDaDe = dongDeDuoc.filter((r) => ghiDeRows.has(r)).length;
  const deTatCa = dongDeDuoc.length > 0 && soDaDe === dongDeDuoc.length;
  const laGhiDe = (i: number) => ghiDeRows.has(excelRows[i] ?? -1);

  const toggleGhiDe = (excelRow: number) => {
    setGhiDeRows((prev) => {
      const next = new Set(prev);
      if (next.has(excelRow)) next.delete(excelRow);
      else next.add(excelRow);
      return next;
    });
  };

  /**
   * Ô tick ở HÀNG TIÊU ĐỀ — bật/tắt cho TOÀN BỘ nhóm Trùng, không chỉ trang đang xem.
   *
   * Chủ dự án yêu cầu đúng ô này ("để tick tất cả nữa"), và phạm vi phải là cả nhóm: file
   * thật 145 dòng trùng thì "tất cả" mà chỉ được 25 dòng của trang hiện tại là một cái bẫy —
   * người dùng thấy ô tiêu đề đã tick, sang trang sau thấy trống, và không biết rốt cuộc
   * mình đã ra lệnh cho bao nhiêu dòng. Con số thật hiện ở `GiaiThichNhom` ngay trên bảng.
   */
  const toggleDeTatCa = () => {
    setGhiDeRows((prev) => {
      const next = new Set(prev);
      if (deTatCa) for (const r of dongDeDuoc) next.delete(r);
      else for (const r of dongDeDuoc) next.add(r);
      return next;
    });
  };

  // Trang hiện tại của nhóm đang xem. Đổi nhóm hoặc dữ liệu co lại thì kéo trang về hợp lệ.
  const dsNhom = theoNhom[nhom];
  const soTrang = Math.max(1, Math.ceil(dsNhom.length / SO_DONG_MOI_TRANG));
  useEffect(() => {
    setTrang((t) => Math.min(Math.max(1, t), soTrang));
  }, [soTrang, nhom]);
  const trangHienTai = Math.min(Math.max(1, trang), soTrang);
  const dsTrang = dsNhom.slice(
    (trangHienTai - 1) * SO_DONG_MOI_TRANG,
    trangHienTai * SO_DONG_MOI_TRANG,
  );

  const handleImport = async () => {
    setStep("importing");
    try {
      const res = await onImport(validRows, {
        excelRowOf: validIdx.map((i) => excelRows[i] ?? i + 2),
        confirmed: confirmedDups,
        ghiDe: ghiDeRows,
      });
      setResult(res);
      setStep("done");
    } catch (err) {
      // ⚠️ KHÔNG dùng `alert()` cho lỗi này.
      //
      // Đo 16/09/2026 (ảnh chụp prod): hộp thoại in đúng một câu "Nhập thất bại: Nhập thất
      // bại" rồi biến mất khi bấm OK. Ba cái sai cùng lúc: chữ không chọn được nên người
      // dùng không gửi được cho ai, hộp thoại chặn cả trang nên không mở DevTools xem tiếp
      // được, và đóng xong là mất luôn. Thông điệp ở đây có thể là một câu lỗi Prisma dài
      // — thứ PHẢI đọc và chép lại được.
      //
      // Để nguyên tại chỗ, có thể bôi đen, và danh sách dòng vẫn còn nguyên bên dưới để sửa.
      //
      // ⚠️ KHÔNG thêm `setLoiNhap(null)` ở đầu hàm cho "sạch". Đã thử: dòng đó KHÔNG QUAN
      // SÁT ĐƯỢC — trong lúc chạy thì panel không dựng (step `importing`), xong mà thành
      // công thì màn kết quả thay cả khung, xong mà hỏng thì chính dòng dưới đây ghi đè.
      // Cấy lỗi vào nó, cả bộ vẫn xanh. Một dòng không test nào chạm tới được là một dòng
      // trông như đang bảo vệ điều gì đó mà không bảo vệ gì cả.
      setLoiNhap(err instanceof Error ? err.message : "Không rõ lý do");
      setStep("preview");
    }
  };

  const reset = () => {
    setStep("idle");
    setRawRows([]);
    setParsedRows([]);
    setExcelRows([]);
    setDbDup(new Map());
    setDbWarn(new Map());
    setConfirmedDups(new Set());
    setGhiDeRows(new Set());
    setCheckingDb(false);
    setLoiNhap(null);
    setResult(null);
    setFilename("");
    setNhom("hopLe");
    setTrang(1);
    setDangSua(null);
  };

  /** Xoá các dòng theo index hiện tại (3 mảng song song đi cùng nhau); hết dòng → về idle. */
  const removeRows = (indexes: Set<number>) => {
    if (parsedRows.length - indexes.size <= 0) {
      reset();
      return;
    }
    setDangSua(null);
    setRawRows((prev) => prev.filter((_, i) => !indexes.has(i)));
    setParsedRows((prev) => prev.filter((_, i) => !indexes.has(i)));
    setExcelRows((prev) => prev.filter((_, i) => !indexes.has(i)));
  };

  /** Xoá mọi dòng sẽ KHÔNG được ghi (lỗi parse + trùng không xử lý được). */
  const xoaDongHong = () => {
    removeRows(new Set(parsedRows.map((_, i) => (seVao(i) ? -1 : i)).filter((i) => i >= 0)));
  };

  const toggleConfirm = (excelRow: number) => {
    setConfirmedDups((prev) => {
      const next = new Set(prev);
      if (next.has(excelRow)) next.delete(excelRow);
      else next.add(excelRow);
      return next;
    });
  };

  /**
   * GHI LẠI một dòng sau khi sửa tay.
   *
   * ⚠️ Phải XOÁ kết quả đối chiếu cũ của đúng dòng đó rồi hỏi lại server. Người dùng sửa số
   * điện thoại CHÍNH LÀ để thoát khỏi nhãn trùng; giữ nhãn cũ thì họ sửa xong vẫn thấy đỏ và
   * kết luận nút Sửa không hoạt động. Dấu trùng-trong-file thì tự tính lại, không cần dọn.
   */
  const luuDongDaSua = (i: number, oMoi: Record<string, unknown>) => {
    const excelNo = excelRows[i] ?? i + 2;
    setRawRows((prev) => prev.map((r, k) => (k === i ? oMoi : r)));
    setParsedRows((prev) => prev.map((r, k) => (k === i ? parseRow(oMoi, k) : r)));
    setDbDup((prev) => {
      if (!prev.has(excelNo)) return prev;
      const next = new Map(prev);
      next.delete(excelNo);
      return next;
    });
    setDbWarn((prev) => {
      if (!prev.has(excelNo)) return prev;
      const next = new Map(prev);
      next.delete(excelNo);
      return next;
    });
    // Sửa xong thì dòng không còn là dòng đã-xác-nhận nữa: nội dung đã khác, và một xác nhận
    // cho nội dung CŨ không có nghĩa gì với nội dung MỚI.
    setConfirmedDups((prev) => {
      if (!prev.has(excelNo)) return prev;
      const next = new Set(prev);
      next.delete(excelNo);
      return next;
    });
    // Lệnh GHI ĐÈ cũng vậy, và ở đây còn gắt hơn: người dùng vừa sửa SĐT thì dòng này có thể
    // đã trỏ sang một lead KHÁC — giữ lại cái tick là đè lên đúng người không liên quan. Bỏ
    // tick là fail-closed; muốn đè thì tick lại, một cú bấm.
    setGhiDeRows((prev) => {
      if (!prev.has(excelNo)) return prev;
      const next = new Set(prev);
      next.delete(excelNo);
      return next;
    });
    setDangSua(null);

    if (!checkExisting) return;
    setCheckingDb(true);
    checkExisting([oMoi], [excelNo])
      .then((res) => {
        const loi = res instanceof Map ? res : (res.errors ?? new Map());
        const canh = res instanceof Map ? new Map<number, string>() : (res.warnings ?? new Map());
        if (loi.has(excelNo)) setDbDup((p) => new Map(p).set(excelNo, loi.get(excelNo)!));
        if (canh.has(excelNo)) setDbWarn((p) => new Map(p).set(excelNo, canh.get(excelNo)!));
      })
      .catch((err) => console.error("[ExcelImporter] đối chiếu lại dòng vừa sửa:", err))
      .finally(() => setCheckingDb(false));
  };

  /** Câu mô tả trạng thái của một dòng — dùng chung cho cả bảng lẫn thẻ. */
  const trangThaiDong = (i: number) => {
    const row = parsedRows[i]!;
    if (isErrorRow(row)) return { kieu: "loi" as const, chu: row.error };
    // ⚠️ HAI loại trùng, và chúng KHÁC NHAU về nghĩa:
    //   · trùng trong FILE  — gộp với một dòng khác của chính file này, chưa liên quan gì
    //     tới bản ghi đang có trong hệ thống;
    //   · trùng với HỆ THỐNG — sẽ ghi đè lên một bản ghi thật.
    // Ảnh prod 15/09 cho thấy bản đầu dán chung một nhãn: "Sẽ cập nhật lead đang có — Trùng
    // SĐT với dòng 4 trong file". Câu đó đúng một nửa, mà nửa sai lại là nửa đáng sợ hơn.
    const dupFile = dupErrors.get(i);
    const dupDb = dbDup.get(excelRows[i] ?? -1);
    const dup = dupFile ?? dupDb;
    if (dup) {
      if (mergeDuplicates) {
        // ⚠️ Dòng ĐÃ TICK ghi đè thì câu này PHẢI đổi. Câu mặc định của màn lead hứa nguyên
        // văn "chỉ ĐIỀN những ô lead đó đang để trống; ô đã có giá trị thì giữ nguyên" —
        // để nguyên câu đó bên cạnh một ô tick đang bật là màn hình nói ngược với việc nó
        // sắp làm, và người dùng chỉ biết sau khi dữ liệu đã mất (luật 12).
        if (overwriteDuplicates && laGhiDe(i)) {
          return { kieu: "trung" as const, chu: overwriteDuplicates.chuKhiBat };
        }
        return {
          kieu: "trung" as const,
          chu: dupFile
            ? `${dupFile} — hai dòng sẽ gộp làm một khi nhập`
            : `${mergeDuplicates.label} — ${dupDb}`,
        };
      }
      if (confirmDuplicates && isConfirmedRow(i)) {
        return { kieu: "trung" as const, chu: "Đã xác nhận — sẽ xử lý khi nhập", hoanTac: true };
      }
      return { kieu: "chan" as const, chu: dup };
    }
    const warn = dbWarn.get(excelRows[i] ?? -1);
    if (warn) return { kieu: "trung" as const, chu: warn };
    return { kieu: "ok" as const, chu: "Sẵn sàng nhập" };
  };

  return (
    <div className="space-y-4">
      {step === "idle" && (
        <VungTha
          title={title}
          templateUrl={templateUrl}
          templateFilename={templateFilename}
          rootProps={getRootProps()}
          inputProps={getInputProps()}
          isDragActive={isDragActive}
        />
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <ThanhTepDaChon
            filename={filename}
            soDong={parsedRows.length}
            templateUrl={templateUrl}
            templateFilename={templateFilename}
            onChonLai={reset}
          />

          <BoLoc
            dem={{
              hopLe: theoNhom.hopLe.length,
              trung: theoNhom.trung.length,
              loi: theoNhom.loi.length,
            }}
            dangChon={nhom}
            onChon={(n) => {
              setNhom(n);
              setDangSua(null);
            }}
            dangDoiChieu={checkingDb}
          />

          <GiaiThichNhom
            nhom={nhom}
            soDong={dsNhom.length}
            trungBiBo={trungBiBo}
            coXacNhan={Boolean(confirmDuplicates)}
            nhanTrung={mergeDuplicates?.label ?? null}
            ghiDe={
              coCotDe && overwriteDuplicates
                ? {
                    moTa: overwriteDuplicates.moTa,
                    nhan: overwriteDuplicates.label,
                    daChon: soDaDe,
                    tong: dongDeDuoc.length,
                  }
                : null
            }
          />

          {dsNhom.length > 0 && (
            <>
              {/* Vùng cuộn ngang nằm ở thẻ TRONG, viền bo ở thẻ NGOÀI — hai thẻ khác nhau,
                  nếu không nội dung bị vạt góc khi kéo ngang (luật `bang-coverage`). */}
              {/* ⚠️ `bg-background` KHÔNG phải trang trí — nó là thứ giữ cho ô ghim khớp màu hàng.
                  Đo 15/09: cả chuỗi cha từ bảng lên tới `.admin-scope` đều TRONG SUỐT, nên hàng
                  không tô màu sẽ ăn nền xám `lab(96.52)` của khung admin, trong khi ô ghim buộc
                  phải đục nên ra `lab(100)` trắng tinh. Hai màu đó chính là dải trắng lệch mà
                  chủ dự án chụp được trên prod. Cho thẻ một nền ĐỤC của riêng nó thì hàng và ô
                  ghim cùng một màu, và thẻ trắng trên khung xám cũng đúng hình dạng một thẻ. */}
              <div className="hidden overflow-hidden rounded-xl border border-border bg-background md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[54rem] text-sm">
                    <thead>
                      {/* ⚠️ Nền hàng tiêu đề phải ĐẶC và TRÙNG KHỚP với nền ô ghim.
                          Đo 15/09: hàng là `bg-muted/60` (muted 60%) còn ô ghim là
                          `bg-muted` (100%) — hai sắc độ khác nhau, nên cột ghim hiện ra
                          thành một vệt sáng chạy dọc qua hàng tiêu đề. Ô ghim KHÔNG được
                          dùng màu trong suốt (dữ liệu sẽ chạy dưới nó khi kéo ngang), nên
                          bên phải nhượng bộ: hàng cũng dùng đặc. */}
                      <tr className="border-b border-border bg-muted">
                        {/* GHIM hai cột chrome vào hai mép. Đo 15/09 trước khi ghim: nút Sửa
                            nằm ở x=1971 trên màn 994px — phải kéo ngang 1165px mới tới đúng
                            thứ màn này sinh ra để dùng. Cột ghim để nền ĐỤC (`bg-muted`,
                            không phải nền màu trạng thái vốn là rgba 12%): nền trong suốt thì
                            dữ liệu chạy dưới nó khi kéo. */}
                        <th
                          scope="col"
                          className="sticky left-0 z-10 whitespace-nowrap border-r border-border bg-muted px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {coCotDe && overwriteDuplicates ? (
                            // Ô tick TẤT CẢ nằm ngay cạnh chữ "Đè" — đúng chỗ chủ dự án chỉ.
                            // Giữ luôn chữ "dòng" để cột số bên dưới không mất nhãn.
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer accent-primary"
                                checked={deTatCa}
                                // Tick một phần thì KHÔNG được vẽ như đã tick hết — ô
                                // "lửng" là cách duy nhất nói đúng trạng thái khi người
                                // dùng mới chọn vài dòng trong 145.
                                ref={(el) => {
                                  if (el) el.indeterminate = soDaDe > 0 && !deTatCa;
                                }}
                                onChange={toggleDeTatCa}
                                aria-label={`${overwriteDuplicates.label} tất cả ${dongDeDuoc.length} dòng trùng`}
                              />
                              <span>{overwriteDuplicates.label} / dòng</span>
                            </span>
                          ) : (
                            "Dòng"
                          )}
                        </th>
                        {columnHints.map((c) => (
                          <th
                            key={c.key}
                            scope="col"
                            className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {c.label}
                            {c.required && (
                              <span className="text-state-danger-ink" aria-label="bắt buộc">
                                {" "}
                                *
                              </span>
                            )}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="sticky right-0 z-10 whitespace-nowrap border-l border-border bg-muted px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          Sửa
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dsTrang.map((i) =>
                        dangSua === i ? (
                          <tr key={excelRows[i] ?? i} className="border-t border-border bg-primary-soft/40">
                            <td colSpan={columnHints.length + 2} className="p-0">
                              <FormSuaDong
                                soDong={excelRows[i] ?? i + 2}
                                columnHints={columnHints}
                                giaTri={rawRows[i] ?? {}}
                                onLuu={(o) => luuDongDaSua(i, o)}
                                onHuy={() => setDangSua(null)}
                              />
                            </td>
                          </tr>
                        ) : (
                          <DongBang
                            key={excelRows[i] ?? i}
                            soDong={excelRows[i] ?? i + 2}
                            columnHints={columnHints}
                            gia={rawRows[i] ?? {}}
                            trangThai={trangThaiDong(i)}
                            nhanXacNhan={
                              trangThaiDong(i).kieu === "chan" && confirmDuplicates
                                ? confirmDuplicates.label
                                : null
                            }
                            ghiDe={
                              coCotDe && overwriteDuplicates && seVao(i)
                                ? {
                                    nhan: overwriteDuplicates.label,
                                    bat: laGhiDe(i),
                                    onDoi: () => toggleGhiDe(excelRows[i] ?? -1),
                                  }
                                : null
                            }
                            onXacNhan={() => toggleConfirm(excelRows[i] ?? -1)}
                            onSua={() => setDangSua(i)}
                            onXoa={() => removeRows(new Set([i]))}
                          />
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dưới `md`: thẻ xếp dọc. Bảng 10 cột trên màn 320px là không đọc được, và màn
                  này tồn tại để người ta SỬA chứ không chỉ để liếc. */}
              {/* "Tick tất cả" cho màn nhỏ.
                  ⚠️ `md:hidden` — trên desktop ô này đã có ở hàng tiêu đề bảng, hai ô cùng
                  làm một việc trên một màn hình là mời người dùng đoán xem chúng khác nhau
                  chỗ nào. Đo 16/09 ở 320–640px: bảng không dựng nên ô tiêu đề KHÔNG tồn tại,
                  và file 145 dòng trùng thì thiếu nó là bắt tick tay 145 lần trên điện thoại
                  — đúng thứ chủ dự án yêu cầu để khỏi phải làm. */}
              {coCotDe && overwriteDuplicates && dongDeDuoc.length > 0 && (
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm md:hidden">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={deTatCa}
                    ref={(el) => {
                      if (el) el.indeterminate = soDaDe > 0 && !deTatCa;
                    }}
                    onChange={toggleDeTatCa}
                  />
                  <span className="font-medium">
                    {overwriteDuplicates.label} tất cả {dongDeDuoc.length} dòng trùng
                  </span>
                </label>
              )}

              <ul className="space-y-3 md:hidden">
                {dsTrang.map((i) => (
                  <li key={excelRows[i] ?? i}>
                    {dangSua === i ? (
                      <div className="rounded-xl border border-primary/40 bg-primary-soft/40">
                        <FormSuaDong
                          soDong={excelRows[i] ?? i + 2}
                          columnHints={columnHints}
                          giaTri={rawRows[i] ?? {}}
                          onLuu={(o) => luuDongDaSua(i, o)}
                          onHuy={() => setDangSua(null)}
                        />
                      </div>
                    ) : (
                      <TheDong
                        soDong={excelRows[i] ?? i + 2}
                        columnHints={columnHints}
                        gia={rawRows[i] ?? {}}
                        trangThai={trangThaiDong(i)}
                        nhanXacNhan={
                          trangThaiDong(i).kieu === "chan" && confirmDuplicates
                            ? confirmDuplicates.label
                            : null
                        }
                        ghiDe={
                          coCotDe && overwriteDuplicates && seVao(i)
                            ? {
                                nhan: overwriteDuplicates.label,
                                bat: laGhiDe(i),
                                onDoi: () => toggleGhiDe(excelRows[i] ?? -1),
                              }
                            : null
                        }
                        onXacNhan={() => toggleConfirm(excelRows[i] ?? -1)}
                        onSua={() => setDangSua(i)}
                        onXoa={() => removeRows(new Set([i]))}
                      />
                    )}
                  </li>
                ))}
              </ul>

              {soTrang > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Dòng {(trangHienTai - 1) * SO_DONG_MOI_TRANG + 1}–
                    {Math.min(trangHienTai * SO_DONG_MOI_TRANG, dsNhom.length)} trên{" "}
                    {dsNhom.length}
                  </p>
                  <DieuHuongTrang trang={trangHienTai} soTrang={soTrang} onDoi={setTrang} />
                </div>
              )}
            </>
          )}

          {dsNhom.length === 0 && <NhomRong nhom={nhom} soDongSeGhi={validRows.length} />}

          {loiNhap && (
            // `select-text` + `break-words`: câu lỗi Prisma dài và người dùng cần CHÉP nó
            // đi hỏi. `role="alert"` để trình đọc màn hình đọc ngay, vì lúc này tiêu điểm
            // đang ở nút Nhập chứ không ở đây.
            <div
              role="alert"
              className="rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3"
            >
              <p className="text-sm font-semibold text-state-danger-ink">
                Không ghi được — chưa dòng nào vào hệ thống
              </p>
              <p className="mt-1 select-text break-words text-sm text-state-danger-ink">
                {loiNhap}
              </p>
              <p className="mt-1.5 text-xs text-state-danger-ink/80">
                Danh sách bên trên vẫn còn nguyên: sửa rồi bấm Nhập lại, không cần chọn file lần nữa.
              </p>
            </div>
          )}

          {/* Thanh hành động dính đáy: ở màn nhỏ, danh sách dài đẩy nút ra khỏi tầm nhìn và
              người dùng cuộn mãi không thấy nút Nhập. `bottom` cộng safe-area cho máy có
              thanh gạt dưới. */}
          {/* ⚠️ `z-20` KHÔNG thừa. Ô ghim và hàng tiêu đề của bảng mang `z-10`; thanh này nếu
          để `z-auto` thì mọi ô ghim chồng lên nó đều VẼ ĐÈ LÊN TRÊN — chủ dự án chụp được
          đúng cảnh đó: danh sách 145 dòng che mất nút "Nhập". Vỏ bảng không tạo ngữ cảnh xếp
          lớp riêng (chỉ `overflow`, không `transform`/`filter`/`z-index`), nên `z-10` của ô
          ghim leo thẳng lên gốc và so trực tiếp với thanh này. */}
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
            {/* Nút chính chiếm TRỌN dòng ở màn hẹp: ở 320px ba nút xếp thành ba dòng và nút
                quan trọng nhất trông ngang hàng với nút xoá. */}
            <Button
              onClick={handleImport}
              disabled={validRows.length === 0 || checkingDb}
              className="min-h-11 w-full sm:w-auto"
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {checkingDb ? "Đang đối chiếu…" : `Nhập ${validRows.length} dòng`}
            </Button>
            {validRows.length < parsedRows.length && (
              <Button
                variant="outline"
                onClick={xoaDongHong}
                className="min-h-11 flex-1 border-state-danger text-state-danger-ink hover:bg-state-danger-soft hover:text-state-danger-ink sm:flex-none"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Xoá {parsedRows.length - validRows.length} dòng không nhập được
              </Button>
            )}
            <Button variant="ghost" onClick={reset} className="min-h-11">
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="rounded-xl border border-border p-10 text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Đang nhập {validRows.length} dòng…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Đừng đóng tab — dòng nào hỏng sẽ được liệt kê lại ở bước sau.
          </p>
        </div>
      )}

      {step === "done" && result && <ImportOutcome result={result} onReset={reset} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Các mảnh giao diện
// ─────────────────────────────────────────────────────────────────────────────────────────

function VungTha({
  title,
  templateUrl,
  templateFilename,
  rootProps,
  inputProps,
  isDragActive,
}: {
  title: string;
  templateUrl: string;
  templateFilename: string;
  rootProps: Record<string, unknown>;
  inputProps: Record<string, unknown>;
  isDragActive: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <a
          href={templateUrl}
          download={templateFilename}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-state-info-ink hover:underline"
        >
          <Download className="h-4 w-4" />
          Tải file mẫu
        </a>
      </div>
      <div
        {...rootProps}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          isDragActive
            ? "border-primary bg-primary-soft"
            : "border-border hover:border-primary/50 hover:bg-muted/50",
        )}
      >
        <input {...inputProps} />
        <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="font-medium">Kéo thả file Excel vào đây, hoặc bấm để chọn</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          .xlsx / .xls — tối đa 10MB, 5000 dòng
        </p>
      </div>
    </div>
  );
}

function ThanhTepDaChon({
  filename,
  soDong,
  templateUrl,
  templateFilename,
  onChonLai,
}: {
  filename: string;
  soDong: number;
  templateUrl: string;
  templateFilename: string;
  onChonLai: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3">
      <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
      {/* `basis-[calc(100%-2rem)]` ở màn hẹp: bản trước để tên tệp chia dòng với hai nút và
          nó rút còn "thu-nhap…" — tên tệp là thứ người dùng đối chiếu để biết mình đang xem
          đúng file nào, cắt nó đi là bỏ mất chỗ dựa duy nhất. */}
      <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-auto">
        <p className="truncate text-sm font-medium" title={filename}>
          {filename}
        </p>
        <p className="text-xs text-muted-foreground">{soDong} dòng đọc được</p>
      </div>
      <a
        href={templateUrl}
        download={templateFilename}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-state-info-ink hover:underline"
      >
        <Download className="h-4 w-4" />
        File mẫu
      </a>
      <Button variant="outline" size="sm" onClick={onChonLai} className="min-h-9">
        Chọn file khác
      </Button>
    </div>
  );
}

const MAU_NHOM: Record<Nhom, { on: string; off: string; icon: typeof CheckCircle2 }> = {
  hopLe: {
    on: "border-state-success bg-state-success-soft text-state-success-ink",
    off: "border-border text-muted-foreground hover:border-state-success/50 hover:text-foreground",
    icon: CheckCircle2,
  },
  trung: {
    on: "border-state-warning bg-state-warning-soft text-state-warning-ink",
    off: "border-border text-muted-foreground hover:border-state-warning/50 hover:text-foreground",
    icon: Copy,
  },
  loi: {
    on: "border-state-danger bg-state-danger-soft text-state-danger-ink",
    off: "border-border text-muted-foreground hover:border-state-danger/50 hover:text-foreground",
    icon: CircleAlert,
  },
};

/**
 * BA NHÓM — vừa là bộ đếm vừa là bộ lọc.
 *
 * Không tách thành "một dòng thống kê" + "một hàng tab": đó là hai lần nói cùng một con số,
 * và con số ở dòng thống kê thì không bấm được nên nó chỉ là trang trí.
 */
function BoLoc({
  dem,
  dangChon,
  onChon,
  dangDoiChieu,
}: {
  dem: Record<Nhom, number>;
  dangChon: Nhom;
  onChon: (n: Nhom) => void;
  dangDoiChieu: boolean;
}) {
  const thuTu: Nhom[] = ["hopLe", "trung", "loi"];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Dưới `sm`: LƯỚI ba cột đều nhau. Bản trước dùng `flex-1 flex-wrap` và ở 320px nó
          gãy thành "Hợp lệ" chiếm trọn một dòng, hai nhóm kia chen dòng dưới — ba nhóm ngang
          hàng nhau về nghĩa mà hiện ra lệch hẳn nhau về trọng lượng.
          Biểu tượng ẩn dưới `sm`: ở bề rộng đó chỗ chỉ đủ cho chữ và con số, mà con số mới là
          thứ người ta đọc. */}
      <div
        role="tablist"
        aria-label="Lọc dòng theo tình trạng"
        className="grid flex-1 grid-cols-3 gap-2 sm:flex sm:flex-wrap"
      >
        {thuTu.map((n, vt) => {
          const chon = n === dangChon;
          const mau = MAU_NHOM[n];
          const Icon = mau.icon;
          return (
            <button
              key={n}
              ref={(el) => {
                refs.current[vt] = el;
              }}
              role="tab"
              type="button"
              aria-selected={chon}
              tabIndex={chon ? 0 : -1}
              onClick={() => onChon(n)}
              onKeyDown={(e) => {
                // Mũi tên trái/phải là cách chuẩn để đi giữa các tab; thiếu nó thì Tab nhảy
                // thẳng ra khỏi bộ lọc và người dùng bàn phím không đổi nhóm được.
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const buoc = e.key === "ArrowRight" ? 1 : -1;
                const ke = (vt + buoc + thuTu.length) % thuTu.length;
                onChon(thuTu[ke]!);
                refs.current[ke]?.focus();
              }}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-xs font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-4 sm:text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                chon ? mau.on : mau.off,
              )}
            >
              <Icon className="hidden h-4 w-4 shrink-0 sm:block" />
              <span className="truncate whitespace-nowrap">{TEN_NHOM[n]}</span>
              <span
                className={cn(
                  "rounded-md px-1 py-0.5 text-xs font-bold tabular-nums sm:px-1.5",
                  chon ? "bg-background/70" : "bg-muted",
                )}
              >
                {dem[n]}
              </span>
            </button>
          );
        })}
      </div>
      {dangDoiChieu && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          đang đối chiếu dữ liệu có sẵn…
        </span>
      )}
    </div>
  );
}

/** Một câu nói rõ nhóm đang xem NGHĨA LÀ GÌ và người dùng phải làm gì với nó. */
function GiaiThichNhom({
  nhom,
  soDong,
  trungBiBo,
  coXacNhan,
  nhanTrung,
  ghiDe,
}: {
  nhom: Nhom;
  soDong: number;
  trungBiBo: number;
  coXacNhan: boolean;
  nhanTrung: string | null;
  /** Cột "Đè" của nhóm Trùng — `null` khi màn không bật. */
  ghiDe: { moTa: string; nhan: string; daChon: number; tong: number } | null;
}) {
  if (soDong === 0) return null;
  const chu =
    nhom === "hopLe"
      ? "Những dòng này sẽ được ghi vào hệ thống, không cần làm gì thêm."
      : nhom === "loi"
        ? "Những dòng này sẽ KHÔNG được ghi. Bấm Sửa để chữa ngay tại đây — không cần mở lại file Excel."
        : trungBiBo > 0
          ? coXacNhan
            ? `${trungBiBo} dòng đang chờ bạn xác nhận; dòng nào không xác nhận sẽ bị bỏ qua.`
            : `${trungBiBo} dòng trùng sẽ bị bỏ qua. Sửa lại giá trị bị trùng, hoặc xoá dòng.`
          // ⚠️ KHÔNG nhắc tới "cột Tình trạng" nữa — cột đó đã bị bỏ khi lý do chuyển
          // xuống dòng riêng dưới mỗi dòng dữ liệu. Ảnh prod 15/09 còn in nguyên câu cũ:
          // một chỉ dẫn trỏ vào thứ không tồn tại trên màn hình (luật 12).
          : `Đã có bản ghi cùng khoá trong hệ thống.${nhanTrung ? ` ${nhanTrung}.` : ""} Dòng chữ dưới mỗi dòng nói rõ sẽ ghi đè lên ai — đọc trước khi nhập.`;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{chu}</p>
      {ghiDe && ghiDe.tong > 0 && (
        // ⚠️ Khối này CHỈ hiện ở nhóm Trùng (chỗ gọi đã gác), và nó phải in CON SỐ THẬT.
        // Ô tick ở hàng tiêu đề bật cho cả nhóm chứ không chỉ trang đang xem, nên nếu màn
        // hình không nói "đang đè N/M dòng" thì người dùng ở trang 3 không có cách nào biết
        // mình vừa ra lệnh cho bao nhiêu dòng.
        <div className="rounded-xl border border-state-warning/40 bg-state-warning-soft px-4 py-3 text-xs text-state-warning-ink">
          <p className="max-w-[86ch]">{ghiDe.moTa}</p>
          <p className="mt-1.5 font-semibold tabular-nums">
            {ghiDe.daChon === 0
              ? `Chưa tick dòng nào — cả ${ghiDe.tong} dòng đều GIỮ NGUYÊN thông tin đang có.`
              : `Đang ${ghiDe.nhan.toLowerCase()} ${ghiDe.daChon}/${ghiDe.tong} dòng trùng.`}
          </p>
        </div>
      )}
    </div>
  );
}

function NhomRong({ nhom, soDongSeGhi }: { nhom: Nhom; soDongSeGhi: number }) {
  // ⚠️ Nhóm "Hợp lệ" rỗng KHÔNG đồng nghĩa với "chưa nhập được gì".
  //
  // Ảnh prod 15/09: file 146 dòng, 145 trùng — tab hiện "Hợp lệ 0" và câu rỗng bảo người
  // dùng "Xử lý nhóm Lỗi và Trùng trước đã", trong khi 145 dòng kia VẪN SẼ ĐƯỢC NHẬP. Câu đó
  // sai chỉ dẫn: nó bảo đi xử lý thứ không cần xử lý, và gieo nghi ngờ rằng lượt nhập hỏng.
  const chu =
    nhom === "hopLe"
      ? soDongSeGhi > 0
        ? `Không dòng nào là bản ghi mới — cả ${soDongSeGhi} dòng đều đã có trong hệ thống và sẽ được cập nhật. Xem nhóm Trùng.`
        : "Chưa có dòng nào sẵn sàng. Xử lý nhóm Lỗi và Trùng trước đã."
      : nhom === "trung"
        ? "Không dòng nào trùng với dữ liệu đang có — file này toàn bản ghi mới."
        : "Không dòng nào lỗi. File đọc được sạch.";

  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="mx-auto max-w-[60ch] text-sm text-muted-foreground">{chu}</p>
    </div>
  );
}

type TrangThaiDong = ReturnType<
  // Kiểu trả về của `trangThaiDong` bên trên — khai lại ở đây để hai mảnh giao diện
  // (bảng và thẻ) không tự định nghĩa hai hình dạng khác nhau rồi trôi khỏi nhau.
  () => {
    kieu: "ok" | "trung" | "chan" | "loi";
    chu: string;
    hoanTac?: boolean;
  }
>;

const MAU_TRANG_THAI: Record<TrangThaiDong["kieu"], string> = {
  ok: "text-state-success-ink",
  trung: "text-state-warning-ink",
  chan: "text-state-danger-ink",
  loi: "text-state-danger-ink",
};

/**
 * NỀN DÒNG — chỉ tô những dòng sẽ KHÔNG được ghi.
 *
 * ⚠️ Bản đầu tô cả nhóm "trùng". Ảnh chụp prod 15/09 (file 146 dòng, 145 trùng) cho thấy hai
 * điều sai cùng lúc:
 *
 *  1. Tô cả 145 dòng trong tab "Trùng" là nói lại đúng thứ cái tab đã nói — trang trí, không
 *     phải thông tin. Thứ CẦN nổi bật là dòng khác với hàng xóm của nó, không phải dòng
 *     giống hệt 144 dòng còn lại.
 *  2. Nó làm HỎNG cột ghim: token `-soft` là `rgba(..., 0.12)`, còn ô ghim buộc phải có nền
 *     ĐỤC (nếu không dữ liệu chạy dưới nó khi kéo ngang). Hai thứ không khớp nên ô ghim hiện
 *     ra như một hộp TRẮNG rời khỏi hàng — xem ảnh, mỗi nút "Sửa" nằm trong một ô trắng nổi
 *     trên nền kem.
 *
 * Nay chỉ dòng sẽ bị bỏ mới có nền, và với đúng những dòng đó ô ghim đắp thêm một lớp
 * `::before` cùng màu (xem `NEN_GHIM`) để dải ghim không còn trắng.
 */
const NEN_DONG: Record<TrangThaiDong["kieu"], string> = {
  ok: "",
  trung: "",
  chan: "bg-state-danger-soft",
  loi: "bg-state-danger-soft",
};

/**
 * Nền cho Ô GHIM của dòng sẽ bị bỏ.
 *
 * Ô ghim cần nền đục để che dữ liệu chạy phía dưới, nhưng cũng phải mang màu của dòng. Không
 * đặt được hai `background` trên một phần tử, nên: nền đục ở chính ô, màu dòng đắp lên bằng
 * `::before`, và nội dung nâng lên `relative` để không bị lớp đó phủ mất.
 */
const NEN_GHIM: Record<TrangThaiDong["kieu"], string> = {
  ok: "",
  trung: "",
  chan: "before:absolute before:inset-0 before:bg-state-danger-soft before:content-['']",
  loi: "before:absolute before:inset-0 before:bg-state-danger-soft before:content-['']",
};

/**
 * Hai nút của một dòng.
 *
 * `gon` = bản cho BẢNG. Đo 15/09: nút cao 36px trong ô đệm `py-3` đẩy dòng lên 61px, trong
 * khi DESIGN.md §2 chốt 44px — và chính con số 61 là thứ tài liệu đó viết ra để diệt. Bản gọn
 * hạ nút xuống 32px để dòng về đúng 44px.
 *
 * ⚠️ Chỉ hạ ở BẢNG, không hạ ở thẻ: thẻ là hình dạng của màn hình nhỏ, nơi người ta bấm bằng
 * ngón tay và vùng chạm phải ≥44px.
 */
function NutDong({
  onSua,
  onXoa,
  soDong,
  gon,
}: {
  onSua: () => void;
  onXoa: () => void;
  soDong: number;
  gon?: boolean;
}) {
  const cao = gon ? "h-8" : "min-h-11";
  const vuong = gon ? "h-8 w-8" : "h-11 w-11";
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onSua}
        aria-label={`Sửa dòng ${soDong}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          cao,
        )}
      >
        <Pencil className="h-3.5 w-3.5" />
        Sửa
      </button>
      <button
        type="button"
        onClick={onXoa}
        aria-label={`Xoá dòng ${soDong} khỏi danh sách nhập`}
        className={cn(
          "inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-state-danger-soft hover:text-state-danger-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          vuong,
        )}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function NutXacNhan({ nhan, onBam }: { nhan: string; onBam: () => void }) {
  return (
    <button
      type="button"
      onClick={onBam}
      className="mt-1 inline-flex min-h-8 items-center gap-1 rounded-lg border border-state-warning bg-state-warning-soft px-2 text-xs font-semibold text-state-warning-ink transition-colors hover:bg-state-warning-soft-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Check className="h-3.5 w-3.5" />
      {nhan}
    </button>
  );
}

/**
 * MỘT DÒNG TRONG BẢNG — thật ra là HAI `<tr>`: dòng dữ liệu, và dòng lý do bên dưới nó.
 *
 * ⚠️ Lý do NẰM DƯỚI chứ không phải một cột, và đây là bản sửa sau khi đo:
 *   · cột lý do đẩy bảng rộng 1787px, nút Sửa văng ra x=1971 trên màn 994px;
 *   · đoạn văn dài trong một ô làm chiều cao dòng thành 61/73/61/60 — đúng lỗi
 *     "65–71px và không đều nhau" mà DESIGN.md §2 viết ra để diệt.
 *
 * Lý do là câu văn, không phải giá trị bảng. Ép nó vào lưới cột là hỏng cả hai.
 * Dòng "sẵn sàng nhập" KHÔNG có dòng lý do — không có gì để nói thì đừng chiếm chỗ.
 */
/** Ô tick "ghi đè" của một dòng. `null` = màn này không có cột đó. */
export interface OGhiDe {
  nhan: string;
  bat: boolean;
  onDoi: () => void;
}

function DongBang({
  soDong,
  columnHints,
  gia,
  trangThai,
  nhanXacNhan,
  ghiDe,
  onXacNhan,
  onSua,
  onXoa,
}: {
  soDong: number;
  columnHints: GoiYCot[];
  gia: Record<string, unknown>;
  trangThai: TrangThaiDong;
  nhanXacNhan: string | null;
  ghiDe: OGhiDe | null;
  onXacNhan: () => void;
  onSua: () => void;
  onXoa: () => void;
}) {
  const coLyDo = trangThai.kieu !== "ok";
  return (
    <>
      <tr className={cn("border-t border-border", NEN_DONG[trangThai.kieu])}>
        <td
          className={cn(
            // ⚠️ KHÔNG thêm `relative` ở đây. `relative` và `sticky` cùng là thuộc tính
            // `position`, nên cái nào đứng sau trong CSS sinh ra sẽ thắng — thêm vào là
            // cột MẤT GHIM trong khi tiêu đề vẫn ghim, và bảng trông như lệch hàng.
            // `position: sticky` tự nó đã là phần tử được định vị, nên lớp `::before`
            // `absolute inset-0` neo vào nó sẵn rồi.
            "sticky left-0 z-10 whitespace-nowrap border-r border-border bg-background px-4 py-3 text-xs tabular-nums text-muted-foreground",
            NEN_GHIM[trangThai.kieu],
          )}
        >
          <span className="relative flex items-center gap-2">
            {ghiDe && (
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={ghiDe.bat}
                onChange={ghiDe.onDoi}
                aria-label={`${ghiDe.nhan} dòng ${soDong}`}
              />
            )}
            {soDong}
          </span>
        </td>
        {columnHints.map((c) => {
          const tho = oThanhChuoi(gia[c.key]);
          const v = tho && c.hienThi ? c.hienThi(gia[c.key]) : tho;
          return (
            <td
              key={c.key}
              className="max-w-[22ch] truncate whitespace-nowrap px-4 py-3"
              // Cắt chữ mà không cho cách nào đọc lại là giấu dữ liệu. Tên tiếng Việt và tên
              // cơ sở dài hơn 22 ký tự là chuyện thường, không phải ca biên.
              // Giá trị GỐC luôn đọc lại được, kể cả khi ô đã đổi dạng hiển thị.
              title={v !== tho ? `${v}  (trong file ghi: ${tho})` : tho || undefined}
            >
              {v || <span className="text-muted-foreground">—</span>}
            </td>
          );
        })}
        <td
          className={cn(
            "sticky right-0 z-10 whitespace-nowrap border-l border-border bg-background px-4 py-1.5",
            NEN_GHIM[trangThai.kieu],
          )}
        >
          <div className="relative">
            <NutDong soDong={soDong} onSua={onSua} onXoa={onXoa} gon />
          </div>
        </td>
      </tr>
      {coLyDo && (
        <tr className={NEN_DONG[trangThai.kieu]}>
          {/* ⚠️ Lý do GHIM THEO MÉP TRÁI vùng cuộn, không trôi theo bảng.
              Đo 15/09: để nó nằm trong vùng cuộn thì kéo bảng sang phải là chữ "Thiếu SĐT"
              biến mất sau cột ghim — mà ở nhóm Lỗi, lý do CHÍNH LÀ nội dung người dùng đang
              đọc. Một dòng đỏ không nói vì sao đỏ thì đỏ để làm gì. */}
          <td colSpan={columnHints.length + 2} className="p-0">
            <div className="sticky left-0 w-[min(76ch,100%)] px-4 pb-3">
              <p className={cn("text-xs", MAU_TRANG_THAI[trangThai.kieu])}>
                {trangThai.chu}
                {trangThai.hoanTac && (
                  <button
                    type="button"
                    onClick={onXacNhan}
                    className="ml-1.5 underline underline-offset-2 hover:no-underline"
                  >
                    Hoàn tác
                  </button>
                )}
              </p>
              {nhanXacNhan && <NutXacNhan nhan={nhanXacNhan} onBam={onXacNhan} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TheDong({
  soDong,
  columnHints,
  gia,
  trangThai,
  nhanXacNhan,
  ghiDe,
  onXacNhan,
  onSua,
  onXoa,
}: {
  soDong: number;
  columnHints: GoiYCot[];
  gia: Record<string, unknown>;
  trangThai: TrangThaiDong;
  nhanXacNhan: string | null;
  ghiDe: OGhiDe | null;
  onXacNhan: () => void;
  onSua: () => void;
  onXoa: () => void;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-background", NEN_DONG[trangThai.kieu])}>
      <div className="flex items-start justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          Dòng {soDong}
        </span>
        <NutDong soDong={soDong} onSua={onSua} onXoa={onXoa} />
      </div>
      {/* Ở thẻ, ô tick phải có NHÃN CHỮ đi kèm: bảng còn có hàng tiêu đề để giải nghĩa, thẻ
          thì không có gì cả — một ô vuông trơ trọi trên điện thoại là câu đố. Vùng chạm lấy
          trọn bề ngang và cao 44px theo DESIGN.md §2. */}
      {ghiDe && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-border/70 px-4 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-primary"
            checked={ghiDe.bat}
            onChange={ghiDe.onDoi}
          />
          <span className="font-medium">
            {ghiDe.nhan} thông tin cũ bằng dữ liệu dòng này
          </span>
        </label>
      )}
      {/* ⚠️ Nhãn NẰM TRÊN giá trị, không nằm cạnh.
          Đo 15/09 ở 390px: để nhãn và giá trị chia đôi hàng thì nhãn dài ("Sale phụ trách
          (email hoặc mã NV, để trống)") ăn gần hết bề ngang, giá trị còn một cột hẹp tới mức
          `break-words` bẻ tên người thành từng chữ cái — "Ng / uy". Xếp dọc thì giá trị luôn
          được trọn bề ngang của ô.
          Hai cột từ 420px trở lên để thẻ 10 trường không dài thượt. */}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 px-4 py-3 text-sm min-[420px]:grid-cols-2">
        {columnHints.map((c) => {
          const tho = oThanhChuoi(gia[c.key]);
          const v = tho && c.hienThi ? c.hienThi(gia[c.key]) : tho;
          return (
            <div key={c.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{c.label}</dt>
              {/* `break-words` chứ không `truncate`: trên điện thoại người ta đang SỬA dòng
                  này, giấu mất giá trị là bắt họ mở file Excel ra xem — đúng việc màn này
                  sinh ra để khỏi phải làm. */}
              <dd className="min-w-0 break-words">
                {v || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {/* Giống bảng: dòng SẴN SÀNG không có phần lý do. Người dùng đang đứng trong nhóm
          "Hợp lệ" rồi — nhắc lại "sẵn sàng nhập" ở từng thẻ là nói thừa, và nó chiếm đúng
          chỗ mà màn hình nhỏ không có để thừa.
          ⚠️ Bản trước bảng bỏ mà thẻ vẫn in, tức hai hình dạng của CÙNG một dòng nói hai
          điều khác nhau — bộ test dựng cả hai mới lộ ra. */}
      {trangThai.kieu !== "ok" && (
        <div className={cn("border-t border-border/70 px-4 py-2.5 text-xs", MAU_TRANG_THAI[trangThai.kieu])}>
          {trangThai.chu}
          {trangThai.hoanTac && (
            <button
              type="button"
              onClick={onXacNhan}
              className="ml-1.5 underline underline-offset-2 hover:no-underline"
            >
              Hoàn tác
            </button>
          )}
          {nhanXacNhan && <NutXacNhan nhan={nhanXacNhan} onBam={onXacNhan} />}
        </div>
      )}
    </div>
  );
}

/**
 * SỬA TAY MỘT DÒNG.
 *
 * Chủ dự án: "thêm nút sửa ở sau cùng để sửa tay khi lỗi đỡ mất công phải sửa excel rồi nhập
 * lại nếu có ít lead bị lỗi". Nên đây phải sửa TẠI CHỖ, không phải hộp thoại: người dùng cần
 * nhìn thấy các dòng xung quanh khi sửa (đặc biệt ca trùng — dòng trùng với dòng nào).
 *
 * Chỉ sửa các cột đã khai trong `columnHints`. Cột lạ trong file được giữ NGUYÊN, không bị
 * xoá — file thật hay có cột phụ do người nhập tự thêm, và làm mất chúng là mất dữ liệu.
 */
function FormSuaDong({
  soDong,
  columnHints,
  giaTri,
  onLuu,
  onHuy,
}: {
  soDong: number;
  columnHints: GoiYCot[];
  giaTri: Record<string, unknown>;
  onLuu: (o: Record<string, unknown>) => void;
  onHuy: () => void;
}) {
  const [nhap, setNhap] = useState<Record<string, string>>(() =>
    Object.fromEntries(columnHints.map((c) => [c.key, oThanhChuoi(giaTri[c.key])])),
  );
  const oDau = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    oDau.current?.focus();
  }, []);

  const luu = () => {
    // Giữ nguyên mọi khoá gốc, chỉ ghi đè cột đã khai. Ô để trống trả về `null` cho khớp
    // `defval: null` lúc đọc file — tầng phân tích của từng màn đang trông đợi hình dạng đó.
    const o: Record<string, unknown> = { ...giaTri };
    for (const c of columnHints) {
      const v = (nhap[c.key] ?? "").trim();
      o[c.key] = v === "" ? null : v;
    }
    onLuu(o);
  };

  return (
    <form
      className="space-y-3 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        luu();
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Sửa dòng {soDong}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {columnHints.map((c, vt) => (
          <label key={c.key} className="block space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">
              {c.label}
              {c.required && (
                <span className="text-state-danger-ink" aria-label="bắt buộc">
                  {" "}
                  *
                </span>
              )}
            </span>
            <input
              ref={vt === 0 ? oDau : undefined}
              value={nhap[c.key] ?? ""}
              onChange={(e) => setNhap((p) => ({ ...p, [c.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onHuy();
                }
              }}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="min-h-10">
          <Check className="mr-1.5 h-4 w-4" />
          Lưu dòng
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onHuy} className="min-h-10">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          Huỷ sửa
        </Button>
      </div>
    </form>
  );
}

/**
 * Kết quả sau khi ghi.
 *
 * ⚠️ Các API nhập dùng CHUNG mảng `errors` cho hai thứ khác hẳn nhau: lỗi thật (dòng KHÔNG
 * vào được) và thông báo vô hại (dòng đã có sẵn nên bỏ qua, đã gộp con vào lead cùng SĐT…).
 * Thông báo vô hại được đánh dấu bằng tiền tố "ℹ️".
 *
 * Trước 03/08 màn này đếm tất cả là "Lỗi" — nhập 37 dòng lead thật ra bảng "Thành công: 6 |
 * Lỗi: 28" trong khi KHÔNG có dòng nào hỏng. Người nhập liệu đọc xong sẽ tưởng nhập fail và
 * nhập lại → nhân đôi dữ liệu.
 */
export function ImportOutcome({
  result,
  onReset,
}: {
  result: ImportResult;
  onReset: () => void;
}) {
  const notices = result.errors.filter((e) => e.error.trimStart().startsWith("ℹ️"));
  const failures = result.errors.filter((e) => !e.error.trimStart().startsWith("ℹ️"));
  const updated = result.updated ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TheDem nhan="Tạo mới" so={result.success} kieu="ok" />
        {updated > 0 && <TheDem nhan="Cập nhật" so={updated} kieu="trung" />}
        <TheDem nhan="Lỗi" so={failures.length} kieu={failures.length > 0 ? "loi" : "im"} />
      </div>

      {failures.length === 0 && (
        <Alert className="border-state-success">
          <CheckCircle2 className="h-4 w-4 text-state-success-ink" />
          <AlertDescription>
            Không dòng nào lỗi.
            {notices.length > 0 && " Xem ghi chú bên dưới để biết hệ thống đã xử lý gì."}
          </AlertDescription>
        </Alert>
      )}

      {failures.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-state-danger/40">
          <div className="flex items-center gap-2 border-b border-state-danger/40 bg-state-danger-soft px-4 py-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-state-danger-ink" />
            <p className="text-sm font-semibold text-state-danger-ink">
              {failures.length} dòng KHÔNG được ghi
            </p>
          </div>
          <ul className="max-h-[320px] divide-y divide-border overflow-y-auto">
            {failures.map((e, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                {e.row > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    Dòng {e.row}
                  </span>
                )}
                <span className="min-w-0 break-words text-state-danger-ink">{e.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notices.length > 0 && (
        <details className="overflow-hidden rounded-xl border border-border">
          <summary className="cursor-pointer bg-muted/50 px-4 py-2.5 text-sm font-medium">
            Ghi chú ({notices.length}) — hệ thống đã xử lý, không cần làm gì
          </summary>
          <ul className="max-h-[260px] divide-y divide-border overflow-y-auto">
            {notices.map((e, i) => (
              <li key={i} className="px-4 py-2.5 text-sm break-words text-muted-foreground">
                {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Button onClick={onReset} className="min-h-11">
        Nhập file khác
      </Button>
    </div>
  );
}

function TheDem({
  nhan,
  so,
  kieu,
}: {
  nhan: string;
  so: number;
  kieu: "ok" | "trung" | "loi" | "im";
}) {
  const mau = {
    ok: "border-state-success/40 bg-state-success-soft text-state-success-ink",
    trung: "border-state-warning/40 bg-state-warning-soft text-state-warning-ink",
    loi: "border-state-danger/40 bg-state-danger-soft text-state-danger-ink",
    im: "border-border text-muted-foreground",
  }[kieu];
  return (
    <div className={cn("min-w-0 rounded-xl border px-4 py-3", mau)}>
      {/* `text-xl`, KHÔNG `text-4xl`: DESIGN.md §3 — số lớn là thứ đã tràn ra ngoài thẻ KPI. */}
      <p className="text-xl font-bold tabular-nums">{so}</p>
      <p className="truncate text-xs font-medium">{nhan}</p>
    </div>
  );
}
