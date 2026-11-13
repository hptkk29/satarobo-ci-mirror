"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { precheckUpsert } from "@/components/admin/import-precheck";
import {
  ExcelImporter,
  type ImportResult,
} from "@/components/admin/ExcelImporter";
import { docLoiPhanHoi } from "@/lib/ui/loi-phan-hoi";

/** Bản xem trước của một lượt CHẠY THỬ — do route trả về, không tính lại ở client. */
interface XemTruoc {
  dryRun: true;
  errors: { row: number; error: string }[];
  cotCoTrongFile: string[];
  thayDoi: {
    row: number;
    employeeCode: string;
    loai: "TAO_MOI" | "CAP_NHAT";
    cot: { ten: string; truoc: unknown; sau: unknown }[];
  }[];
}

/** In một giá trị cho người đọc — `null` là Ô TRỐNG, phải nhìn ra ngay. */
function inGiaTri(v: unknown): string {
  if (v === null || v === undefined) return "(trống)";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    // Chuỗi ngày ISO từ JSON — cắt phần giờ cho dễ đọc.
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
    return v === "" ? "(trống)" : v;
  }
  if (Array.isArray(v)) return v.length === 0 ? "(rỗng)" : v.join(", ");
  return String(v);
}

interface EmployeeImportRow {
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  department: string;
  status?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string | number | Date;
  gender?: string;
  nationalId?: string;
  contractType?: string;
  centerSlug?: string;
  managerCode?: string;
  joinedAt?: string | number | Date;
  endDate?: string | number | Date;
  address?: string;
  subjects?: string;
  certifications?: string;
  bio?: string;
  emergencyContact?: string;
  notes?: string;
}

const VALID_DEPARTMENTS = new Set([
  "BAN_GIAM_DOC",
  "DAO_TAO",
  "MARKETING",
  "KINH_DOANH",
  "IT",
  "HANH_CHANH_NHAN_SU",
  "KE_TOAN",
  "TUYEN_SINH",
  "GIAO_VU",
  "GIANG_DAY",
]);
const VALID_CONTRACT_TYPES = new Set([
  "FULLTIME",
  "PARTTIME",
  "INTERN",
  "FREELANCE",
  "THU_VIEC",
  "CHINH_THUC_XAC_DINH",
  "CHINH_THUC_KHONG_XAC_DINH",
]);
const VALID_STATUSES = new Set([
  "ACTIVE",
  "ON_LEAVE",
  "RESIGNED",
  "TERMINATED",
]);
const VALID_GENDERS = new Set(["MALE", "FEMALE", "OTHER"]);

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/**
 * Ô ngày: giữ nguyên giá trị thật, biến "ô trống" thành `undefined`.
 *
 * ⚠️ CA SINH RA HÀM NÀY — sự cố PROD 08/09/2026. Ba cột `dateOfBirth`/`joinedAt`/
 * `endDate` là ba cột DUY NHẤT trước đây đi thẳng (`row.joinedAt as …`) trong khi mọi
 * cột khác qua `asString()`. `ExcelImporter` đọc sheet với `{ defval: null }`, và
 * `JSON.stringify` rụng `undefined` nhưng GIỮ `null` — nên đúng ba cột này lọt vào
 * payload dưới dạng `null` và bị ghi thành NULL trên 9 hồ sơ thật.
 *
 * Cổng CHẶN thật nằm ở `cotCoMat()` phía route (nơi ghi). Hàm này là đối xứng client:
 * không client nào nên phát ra `null` cho một ô người dùng bỏ trống.
 */
function asDate(v: unknown): string | number | Date | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  return v as string | number | Date;
}

function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return true;
    if (!Number.isNaN(Date.parse(s))) return true;
  }
  return false;
}

export default function ImportEmployeesPage() {
  const router = useRouter();
  // ── CHẠY THỬ là mặc định (08/09/2026) ──────────────────────────────────────
  //
  // Vì sao: bản vá "ô trống = giữ nguyên" đã một lần được tuyên bố kín rồi vẫn xoá trắng
  // ba cột ngày trên 9 hồ sơ PROD. Thứ DUY NHẤT phát hiện ra là ảnh chụp trước/sau của
  // người vận hành. Bước này biến việc chụp đó thành một bước của chính công cụ.
  const [xemTruoc, setXemTruoc] = useState<XemTruoc | null>(null);
  const [rowsChoGhi, setRowsChoGhi] = useState<EmployeeImportRow[]>([]);
  const [dangGhi, setDangGhi] = useState(false);
  const [ketQuaGhi, setKetQuaGhi] = useState<ImportResult | null>(null);
  const [loiGhi, setLoiGhi] = useState<string | null>(null);

  const goiApi = async (
    rows: EmployeeImportRow[],
    dryRun: boolean,
  ): Promise<unknown> => {
    const res = await fetch("/api/admin/import/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dryRun ? { rows, dryRun: true } : { rows }),
    });
    if (!res.ok) {
      // Route tra loi theo HAI hinh dang; `docLoiPhanHoi` doc du ca hai.
      const than = (await res.json().catch(() => null)) as {
        error?: string;
        errors?: { row: number; error: string }[];
      } | null;
      throw new Error(docLoiPhanHoi(res.status, than));
    }
    return res.json();
  };

  const ghiThat = async () => {
    setDangGhi(true);
    setLoiGhi(null);
    try {
      // Gửi ĐÚNG mảng rows đã chạy thử — không dựng lại, không lọc thêm. Gửi mảng khác
      // là bản xem trước không còn nói về lượt ghi này nữa.
      const kq = (await goiApi(rowsChoGhi, false)) as ImportResult;
      setKetQuaGhi(kq);
      setXemTruoc(null);
      setTimeout(() => router.refresh(), 1000);
    } catch (err) {
      setLoiGhi(err instanceof Error ? err.message : "Không rõ lỗi");
    } finally {
      setDangGhi(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/nhan-su"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Nhân viên từ Excel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mã nhân viên (<code>employeeCode</code>) là khoá upsert — trùng mã sẽ
          UPDATE, mã mới sẽ CREATE.
        </p>
      </div>

      <ExcelImporter<EmployeeImportRow>
        title="Import Nhân viên"
        templateUrl="/templates/mau-nhan-vien-v2.xlsx"
        templateFilename="mau-nhan-vien-v2.xlsx"
        duplicateLabel="Mã NV"
        duplicateKey={(raw) => String(raw.employeeCode ?? "").trim() || null}
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "employees",
            raws.map((r) => String(r.employeeCode ?? "").trim() || null),
            nos,
            "Mã NV",
          )
        }
        columnHints={[
          { key: "employeeCode", label: "Mã NV", required: true },
          { key: "fullName", label: "Họ tên", required: true },
          { key: "jobTitle", label: "Chức danh", required: true },
          { key: "department", label: "Phòng ban", required: true },
          { key: "status", label: "Trạng thái" },
          { key: "phone", label: "SĐT" },
          { key: "email", label: "Email" },
          { key: "dateOfBirth", label: "Ngày sinh" },
          { key: "gender", label: "Giới tính" },
          { key: "nationalId", label: "CCCD" },
          { key: "contractType", label: "Loại HĐ" },
          { key: "centerSlug", label: "Slug cơ sở" },
          { key: "managerCode", label: "Mã quản lý" },
          { key: "joinedAt", label: "Ngày vào làm" },
          { key: "endDate", label: "Ngày kết thúc HĐ" },
          { key: "address", label: "Địa chỉ" },
          { key: "subjects", label: "Môn dạy (,)" },
          { key: "certifications", label: "Chứng chỉ (,)" },
          { key: "bio", label: "Giới thiệu" },
          { key: "emergencyContact", label: "LH khẩn cấp" },
          { key: "notes", label: "Ghi chú" },
        ]}
        parseRow={(row) => {
          const employeeCode = asString(row.employeeCode);
          const fullName = asString(row.fullName);
          const jobTitle = asString(row.jobTitle);
          const department = asString(row.department);

          if (!employeeCode)
            return { error: "Thiếu mã nhân viên (employeeCode)" };
          if (!/^[A-Za-z0-9.-]+$/.test(employeeCode)) {
            return { error: "Mã NV chỉ chứa chữ, số, dấu chấm/gạch" };
          }
          if (!fullName) return { error: "Thiếu họ tên" };
          if (!jobTitle) return { error: "Thiếu chức danh" };
          if (!department) return { error: "Thiếu phòng ban" };
          if (!VALID_DEPARTMENTS.has(department)) {
            return { error: `Phòng ban không hợp lệ: ${department}` };
          }

          const status = asString(row.status);
          if (status && !VALID_STATUSES.has(status)) {
            return { error: `Trạng thái không hợp lệ: ${status}` };
          }
          const gender = asString(row.gender);
          if (gender && !VALID_GENDERS.has(gender)) {
            return { error: `Giới tính phải là MALE/FEMALE/OTHER` };
          }
          const contractType = asString(row.contractType);
          if (contractType && !VALID_CONTRACT_TYPES.has(contractType)) {
            return { error: `Loại HĐ không hợp lệ: ${contractType}` };
          }
          if (row.dateOfBirth && !looksLikeDate(row.dateOfBirth)) {
            return { error: "Ngày sinh phải dạng YYYY-MM-DD" };
          }
          if (row.joinedAt && !looksLikeDate(row.joinedAt)) {
            return { error: "Ngày vào làm phải dạng YYYY-MM-DD" };
          }
          if (row.endDate && !looksLikeDate(row.endDate)) {
            return { error: "Ngày kết thúc HĐ phải dạng YYYY-MM-DD" };
          }
          const email = asString(row.email);
          if (email && email.trim() !== "") {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
              return { error: "Email không hợp lệ" };
            }
          }

          return {
            employeeCode,
            fullName,
            jobTitle,
            department,
            status,
            phone: asString(row.phone),
            email,
            dateOfBirth: asDate(row.dateOfBirth),
            gender,
            nationalId: asString(row.nationalId),
            contractType,
            centerSlug: asString(row.centerSlug),
            managerCode: asString(row.managerCode),
            joinedAt: asDate(row.joinedAt),
            endDate: asDate(row.endDate),
            address: asString(row.address),
            subjects: asString(row.subjects),
            certifications: asString(row.certifications),
            bio: asString(row.bio),
            emergencyContact: asString(row.emergencyContact),
            notes: asString(row.notes),
          };
        }}
        onImport={async (rows) => {
          // Bấm "Import" ở đây KHÔNG ghi — nó chạy thử. Ghi thật là nút riêng bên dưới.
          const kq = (await goiApi(rows, true)) as XemTruoc;
          setXemTruoc(kq);
          setRowsChoGhi(rows);
          setKetQuaGhi(null);
          setLoiGhi(null);
          return {
            success: 0,
            // Tiền tố "ℹ️" = thông báo vô hại, không đếm vào ô "Lỗi" (xem `ImportOutcome`).
            errors: [
              {
                row: 0,
                error:
                  'ℹ️ Đây là CHẠY THỬ — chưa ghi gì vào hệ thống. Xem bảng "Sẽ thay đổi" bên dưới rồi bấm Ghi thật.',
              },
              ...(kq.errors ?? []),
            ],
          };
        }}
      />

      {/* ── CHẠY THỬ: sẽ đổi cột nào của ai, trước → sau (08/09/2026) ────────── */}
      {xemTruoc && (
        <div className="mt-4 rounded-xl border-2 border-state-warning-ink/40 bg-state-warning-soft/40 p-4">
          <h3 className="text-base font-semibold text-state-warning-ink">
            Chạy thử — CHƯA ghi gì
          </h3>
          <p className="mt-1 text-sm">
            Cột có trong file:{" "}
            {xemTruoc.cotCoTrongFile.length === 0 ? (
              <em>không cột nào ghi được</em>
            ) : (
              <code>{xemTruoc.cotCoTrongFile.join(", ")}</code>
            )}
            . Cột KHÔNG có trong danh sách này sẽ không bị đụng tới.
          </p>

          {xemTruoc.thayDoi.every((t) => t.cot.length === 0) ? (
            <p className="mt-3 text-sm font-medium">
              Không hồ sơ nào thay đổi. Ghi thật cũng sẽ không đổi gì.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Dòng</th>
                    <th className="px-3 py-2 font-medium">Mã NV</th>
                    <th className="px-3 py-2 font-medium">Cột</th>
                    <th className="px-3 py-2 font-medium">Trước</th>
                    <th className="px-3 py-2 font-medium">Sau</th>
                  </tr>
                </thead>
                <tbody>
                  {xemTruoc.thayDoi.flatMap((t) =>
                    t.cot.map((c, j) => {
                      // MẤT DỮ LIỆU: đang có giá trị, sau khi ghi thành trống.
                      const mat =
                        (c.sau === null || c.sau === undefined) &&
                        c.truoc !== null &&
                        c.truoc !== undefined;
                      return (
                        <tr
                          key={`${t.row}-${c.ten}`}
                          className={
                            mat
                              ? "border-t border-border bg-state-danger-soft"
                              : "border-t border-border"
                          }
                        >
                          <td className="px-3 py-1.5">
                            {j === 0 ? t.row : ""}
                          </td>
                          <td className="px-3 py-1.5">
                            {j === 0 ? (
                              <>
                                {t.employeeCode}
                                {t.loai === "TAO_MOI" && (
                                  <span className="ml-1 text-xs text-state-info-ink">
                                    (tạo mới)
                                  </span>
                                )}
                              </>
                            ) : (
                              ""
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">
                            {c.ten}
                          </td>
                          <td className="px-3 py-1.5">{inGiaTri(c.truoc)}</td>
                          <td
                            className={
                              mat
                                ? "px-3 py-1.5 font-semibold text-state-danger-ink"
                                : "px-3 py-1.5"
                            }
                          >
                            {inGiaTri(c.sau)}
                            {mat && " ← MẤT DỮ LIỆU"}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {loiGhi && (
            <p className="mt-3 text-sm font-medium text-state-danger-ink">
              Ghi thất bại: {loiGhi}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <Button onClick={ghiThat} disabled={dangGhi}>
              {dangGhi ? "Đang ghi…" : "Ghi thật"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setXemTruoc(null)}
              disabled={dangGhi}
            >
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {ketQuaGhi && (
        <div className="mt-4 rounded-xl border border-state-success-ink/30 bg-state-success-soft p-4 text-sm">
          <p className="font-semibold text-state-success-ink">
            Đã ghi {ketQuaGhi.success} hồ sơ.
          </p>
          {ketQuaGhi.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {ketQuaGhi.errors.map((e, i) => (
                <li key={i}>
                  Dòng {e.row}: {e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Việc 9 (08/09/2026) — cảnh báo phải nằm NGAY TRÊN MÀN, không chỉ trong docs.
          Docs không đến được tay người dán file Excel. Quy ước "ô trống = giữ nguyên"
          là chiều AN TOÀN (nhập nhầm không xoá được dữ liệu) nhưng PHẢN TRỰC GIÁC:
          người dùng sẽ để trống một ô mong xoá dữ liệu, và không có gì xảy ra. */}
      <div className="mt-4 rounded-xl border border-state-warning-ink/30 bg-state-warning-soft p-4 text-sm text-state-warning-ink">
        <p className="font-semibold">
          Ô để trống nghĩa là GIỮ NGUYÊN, không phải xoá.
        </p>
        <p className="mt-1">
          File chỉ cần những cột bạn muốn sửa. Cột không có trong file — hoặc ô
          để trống — sẽ <strong>không bị đụng tới</strong>. Muốn{" "}
          <strong>xoá</strong> một trường thì sửa ở màn hồ sơ nhân sự, không qua
          nhập file.
        </p>
        <p className="mt-1">
          Riêng <code>status</code>: thiếu cột này thì trạng thái hiện tại giữ
          nguyên — người đã nghỉ không bị cho đi làm lại.
        </p>
      </div>

      <div className="text-sm text-muted-foreground mt-4 space-y-1 rounded-xl border border-border bg-muted p-4">
        <p className="font-semibold text-foreground">Lưu ý:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <code>employeeCode</code> bắt buộc, là khoá. Trùng = CẬP NHẬT (chỉ
            những cột có trong file); mới = TẠO MỚI (cần đủ{" "}
            <code>fullName</code>, <code>jobTitle</code>,{" "}
            <code>department</code>).
          </li>
          <li>
            <code>department</code> bắt buộc KHI TẠO MỚI — một trong các enum:
            BAN_GIAM_DOC / DAO_TAO / MARKETING / KINH_DOANH / IT /
            HANH_CHANH_NHAN_SU / KE_TOAN / TUYEN_SINH / GIAO_VU / GIANG_DAY.
          </li>
          <li>
            <code>contractType</code> nếu có: FULLTIME / PARTTIME / INTERN /
            FREELANCE / THU_VIEC / CHINH_THUC_XAC_DINH /
            CHINH_THUC_KHONG_XAC_DINH.
          </li>
          <li>
            <code>centerSlug</code>: THIẾU CỘT = giữ nguyên cơ sở hiện tại. Sai
            slug → row bị bỏ qua.
          </li>
          <li>
            <code>managerCode</code> là <code>employeeCode</code> của người quản
            lý trực tiếp. Phải đã tồn tại trong DB (có thể import từ file khác
            trước).
          </li>
          <li>
            <code>subjects</code> / <code>certifications</code>: phân tách bằng
            dấu phẩy. VD: <code>Robotics, RoboSim</code>.
          </li>
          <li>Avatar KHÔNG import — upload qua admin form sau.</li>
        </ul>
      </div>
    </div>
  );
}
