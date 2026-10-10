"use client";

import { useState, useTransition } from "react";
// 30/08 (từ `main`) — SĐT lưu dạng canonical `84…`; ô nhập phải hiện dạng người Việt
// đọc được `0…`. Lưu lại vẫn chuẩn hoá nên không có đường nào lệch.
import { formatPhoneVN } from "@/lib/phone";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { createLeadManual, updateLeadFields, addLeadChild } from "../actions";
import { groupTeachableCourses, type TeachableCourse } from "@/lib/courses/grouped";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { provinceIdByName, toNameOptions } from "@/lib/address/vn-address";
import { CAMPAIGN_NAME_CONVENTION_HINT } from "@/lib/ads/campaign-code";
import {
  ChildFields,
  childDraftToPayload,
  emptyChild,
  type ChildDraft,
} from "./lead-children";

type Option = { id: string; name: string };

export interface LeadFormInitial {
  id?: string;
  parentName?: string;
  phone?: string;
  email?: string;
  childName?: string;
  childAge?: number | null;
  orgUnitId?: string | null;
  courseId?: string | null;
  source?: string | null;
  note?: string | null;
  // ─── G-01 (26/08/2026) — 5 ô mới ở cấp phụ huynh ─────────────────────────
  parentGender?: string | null;
  /** ISO date ('yyyy-mm-dd' hoặc chuỗi ISO đầy đủ). PII — page phải che trước. */
  parentDob?: string | null;
  city?: string | null;
  ward?: string | null;
  addressLine?: string | null;
  // ─── G-06 (26/08/2026) — mã campaign + ngày hẹn kế tiếp ──────────────────
  campaignName?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  /** ISO date ('yyyy-mm-dd' hoặc ISO đầy đủ). */
  nextFollowUpAt?: string | null;
}

const GIOI_TINH_PH: { value: string; label: string }[] = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
];

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none";

export function LeadForm({
  orgUnits,
  centers,
  courses,
  classes = [],
  provinces = [],
  initialWards = [],
  initial,
  courseFromChildren = false,
  duocDe = false,
}: {
  orgUnits: Option[];
  /**
   * Option cho ô "Cơ sở quan tâm" của khối CON — value là **Center.id**, KHÁC
   * `orgUnits` (value = OrgUnit.id) dùng cho ô "Đơn vị" của lead. Hai danh sách
   * trông giống hệt nhau trên màn hình nhưng lưu hai loại mã khác nhau: `LeadChild
   * .interestedCenterId` trỏ sang bảng Center, còn `Lead.orgUnitId` trỏ sang cây
   * tổ chức. Trước 25/08 chỗ này mượn thẳng `orgUnits` ⇒ con lưu OrgUnit.id, ra
   * màn chi tiết tra không thấy Center nào và mất trắng tên cơ sở.
   * Dựng danh sách bằng `leadChildCenterOptions()`, đừng map tay.
   */
  centers: Option[];
  courses: TeachableCourse[];
  /** G-01 — lớp đang mở, cho ô "Lớp tại trung tâm" của từng CON. */
  classes?: Option[];
  /**
   * G-01 — danh mục tỉnh/thành, nạp Ở SERVER từ `vietnam-address-data` (mô hình 2
   * cấp 2025) rồi truyền xuống. Danh sách phường được nạp LƯỜI theo tỉnh đã chọn,
   * đúng cách màn tạo đơn đang làm — kéo cả bảng phường xuống client là mấy trăm
   * KB cho một ô người ta hiếm khi mở.
   */
  provinces?: ComboboxOption[];
  /**
   * G-01 — phường/xã của tỉnh mà phiếu ĐANG lưu, nạp sẵn ở server.
   *
   * Không có nó thì mở phiếu cũ ra ô phường chỉ hiện đúng một mục (tên đang lưu)
   * và người sửa không đổi sang phường khác được nếu không bấm lại ô tỉnh —
   * một ngõ cụt im lặng. Nạp ở server thay vì `useEffect` để giữ luật server-first.
   * VALUE của option là CHÍNH TÊN phường (xem `toNameOptions`).
   */
  initialWards?: ComboboxOption[];
  initial?: LeadFormInitial;
  /**
   * Người dùng có `leads:overwrite` không (đến từ SERVER, xem trang gọi).
   *
   * Chốt 17/09/2026: SĐT · Đơn vị · Nguồn của một lead ĐÃ CÓ chỉ Quản lý cơ sở / Quản trị
   * hệ thống sửa được — "nguồn lead mặc định là nguồn đầu tiên khi vào hệ thống".
   *
   * ⚠️ CHỈ khoá ở chế độ SỬA. Lúc TẠO thì chính người nhập đang đặt ra nguồn đầu tiên, nên
   * khoá ở đó là chặn đúng việc mà luật này sinh ra để bảo vệ.
   *
   * ⚠️ Và đây chỉ là khoá ở GIAO DIỆN. Cổng thật nằm ở `updateLeadFields` — một form bị
   * disable không chặn được ai gọi thẳng Server Action.
   */
  duocDe?: boolean;
  /**
   * Lead đã có ít nhất 1 con ⇒ "Khoá quan tâm" của lead do khối con quyết định
   * (24/08/2026). Khoá ô lại thay vì để hai nơi cùng ghi một giá trị.
   */
  courseFromChildren?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = !!initial?.id;
  /** Ba ô khoá: chỉ chặn khi ĐANG SỬA và người dùng không có quyền đè. */
  const khoaO = isEdit && !duocDe;
  const courseGroups = groupTeachableCourses(courses);

  const [parentName, setParentName] = useState(initial?.parentName ?? "");
  const [phone, setPhone] = useState(formatPhoneVN(initial?.phone ?? ""));
  const [email, setEmail] = useState(initial?.email ?? "");
  const [childName, setChildName] = useState(initial?.childName ?? "");
  const [childAge, setChildAge] = useState(initial?.childAge != null ? String(initial.childAge) : "");
  const [orgUnitId, setOrgUnitId] = useState(initial?.orgUnitId ?? "");
  const [courseId, setCourseId] = useState(initial?.courseId ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  // ─── G-01 — 5 ô cấp phụ huynh ───────────────────────────────────────────────
  const [parentGender, setParentGender] = useState(initial?.parentGender ?? "");
  // <input type="date"> chỉ nhận 'yyyy-mm-dd'; giá trị vào có thể là ISO đầy đủ.
  const [parentDob, setParentDob] = useState(initial?.parentDob?.slice(0, 10) ?? "");
  const [addressLine, setAddressLine] = useState(initial?.addressLine ?? "");

  // ─── G-06 — mã campaign (4 ô) + ngày hẹn kế tiếp ────────────────────────────
  const [campaignName, setCampaignName] = useState(initial?.campaignName ?? "");
  const [campaignId, setCampaignId] = useState(initial?.campaignId ?? "");
  const [adsetId, setAdsetId] = useState(initial?.adsetId ?? "");
  const [adId, setAdId] = useState(initial?.adId ?? "");
  const [nextFollowUpAt, setNextFollowUpAt] = useState(
    initial?.nextFollowUpAt?.slice(0, 10) ?? "",
  );
  // Phiếu lưu TÊN tỉnh/phường, picker chạy bằng MÃ ⇒ mở phiếu cũ là một lượt dịch
  // ngược. Dịch trượt thì Combobox không khớp option nào, tụt về rỗng, và lượt bấm
  // Lưu kế tiếp XOÁ TRẮNG địa chỉ đúng — nên phép dịch nằm ở một hàm có test riêng
  // (`provinceIdByName`), không viết tay tại chỗ.
  const [provinceId, setProvinceId] = useState<string | null>(
    provinceIdByName(
      provinces.map((p) => ({ id: p.value, name: p.label })),
      initial?.city,
    ),
  );
  const [cityName, setCityName] = useState(initial?.city ?? "");
  const [wardName, setWardName] = useState(initial?.ward ?? "");
  const [wardOptions, setWardOptions] = useState<ComboboxOption[]>(initialWards);
  const [wardLoading, setWardLoading] = useState(false);
  // Lưới an toàn cuối: tên phường đang lưu KHÔNG có trong danh mục (phường đã bị
  // sáp nhập, hoặc dữ liệu nhập tay thời còn 3 cấp). Ghép một option tạm mang đúng
  // tên đó, nếu không Combobox hiện ô trống và lượt bấm Lưu kế tiếp xoá thật.
  const wardChoices: ComboboxOption[] =
    !wardName || wardOptions.some((w) => w.value === wardName)
      ? wardOptions
      : [{ value: wardName, label: wardName }, ...wardOptions];

  function chonTinh(next: string | null) {
    setProvinceId(next);
    const ten = provinces.find((p) => p.value === next)?.label ?? "";
    setCityName(ten);
    // Đổi tỉnh thì phường cũ chắc chắn sai — xoá luôn, đừng để một cặp
    // tỉnh/phường không tồn tại trôi xuống DB.
    setWardName("");
    setWardOptions([]);
    if (!next) return;
    setWardLoading(true);
    void import("vietnam-address-data")
      // `toNameOptions`, KHÔNG `toAddressOptions`: cột `Lead.ward` chứa TÊN. Đưa
      // option mã vào đây là ghi thẳng "48001001" xuống DB, im lặng.
      .then(({ getWardsByProvince }) => setWardOptions(toNameOptions(getWardsByProvince(next))))
      .catch(() => setWardOptions([]))
      .finally(() => setWardLoading(false));
  }

  // R7-01 — khi TẠO lead có thể khai báo sẵn N con (nháp). Sau khi tạo lead
  // thành công sẽ ghi lần lượt qua addLeadChild. Ở chế độ SỬA, danh sách con
  // được quản lý riêng (LeadChildrenManager) nên không hiển thị nháp ở đây.
  const [kids, setKids] = useState<ChildDraft[]>([]);
  const addKid = () => setKids((k) => [...k, { ...emptyChild }]);
  const removeKid = (i: number) => setKids((k) => k.filter((_, idx) => idx !== i));
  const patchKid = (i: number, p: Partial<ChildDraft>) =>
    setKids((k) => k.map((kid, idx) => (idx === i ? { ...kid, ...p } : kid)));

  function submit() {
    const payload = {
      parentName,
      phone,
      email,
      childName,
      childAge: childAge ? Number(childAge) : null,
      orgUnitId,
      courseId,
      source,
      note,
      // G-01 — gửi đủ 5 ô ở CẢ hai chế độ. Ô để trống gửi chuỗi rỗng: action đọc
      // đó là "xoá trắng về null", còn khoá VẮNG MẶT mới là "không đụng tới".
      parentGender,
      parentDob,
      city: cityName,
      ward: wardName,
      addressLine,
      // G-06 — gửi đủ ở CẢ hai chế độ, cùng luật với khối G-01: ô để trống gửi
      // chuỗi rỗng ("xoá trắng"), khoá vắng mặt mới là "không đụng".
      campaignName,
      campaignId,
      adsetId,
      adId,
      nextFollowUpAt,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updateLeadFields(initial!.id!, payload)
        : await createLeadManual(payload);
      if (!res.ok) {
        toast.error(res.error ?? "Lỗi");
        return;
      }
      if (isEdit) {
        toast.success("Đã lưu");
        router.refresh();
        return;
      }
      const newId = (res as { id?: string }).id ?? "";
      // Ghi các con đã khai (bỏ dòng chưa nhập tên). Lỗi 1 con không chặn tạo lead.
      const valid = kids.filter((k) => k.fullName.trim());
      let kidErr = 0;
      for (const k of valid) {
        const r = await addLeadChild({ leadId: newId, ...childDraftToPayload(k) });
        if (!r.ok) kidErr++;
      }
      if (kidErr > 0) toast.error(`Đã tạo lead, nhưng ${kidErr} con lưu lỗi — kiểm tra lại`);
      else toast.success("Đã tạo lead");
      router.push(`/leads/${newId}`);
    });
  }

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tên phụ huynh *">
          <input value={parentName} onChange={(e) => setParentName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="SĐT *">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            readOnly={khoaO}
            aria-readonly={khoaO}
            className={`${inputCls} ${khoaO ? "cursor-not-allowed bg-muted text-muted-foreground" : ""}`}
            placeholder="09xxxxxxxx"
          />
          {khoaO && <ChuKhoa />}
        </Field>
        <Field label="Email">
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        {/* G-01 — giới tính/ngày sinh của PHỤ HUYNH. Của CON nằm ở khối "Con của
            phụ huynh" bên dưới; hai tầng khác nhau, đừng gộp. */}
        <Field label="Giới tính phụ huynh">
          <select
            value={parentGender}
            onChange={(e) => setParentGender(e.target.value)}
            className={inputCls}
          >
            <option value="">—</option>
            {GIOI_TINH_PH.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ngày sinh phụ huynh">
          <input
            type="date"
            value={parentDob}
            onChange={(e) => setParentDob(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className={inputCls}
          />
        </Field>
        <Field label="Tên con">
          <input value={childName} onChange={(e) => setChildName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Tuổi con">
          <input type="number" min={3} max={18} value={childAge} onChange={(e) => setChildAge(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Đơn vị">
          <select
            value={orgUnitId}
            onChange={(e) => setOrgUnitId(e.target.value)}
            disabled={khoaO}
            className={`${inputCls} disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground`}
          >
            <option value="">Chưa xác định (tự chia đều theo cơ sở)</option>
            {orgUnits.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {khoaO && <ChuKhoa />}
        </Field>
        <Field label="Khoá quan tâm">
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className={inputCls}
          >
            <option value="">— Chưa chọn —</option>
            {courseGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {courseFromChildren && (
            // ⚠️ Câu này phải nói ĐÚNG hành vi mới. Chủ dự án chốt 17/09/2026 mở ô ra
            // ("làm hướng sửa được đi"), nên câu cũ — "Lấy theo khoá quan tâm của con — sửa
            // ở khối Con của phụ huynh bên dưới" — nay vừa sai (sửa được ngay đây) vừa chỉ
            // người dùng đi vòng một quãng không cần thiết.
            <p className="mt-1 text-xs text-muted-foreground">
              Lead này có con. Sửa ở đây thì hệ thống <b className="text-foreground">giữ nguyên</b>{" "}
              giá trị bạn chọn; để trống thì nó lấy theo khoá quan tâm của con.
            </p>
          )}
        </Field>
        <Field label="Nguồn">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            readOnly={khoaO}
            aria-readonly={khoaO}
            className={`${inputCls} ${khoaO ? "cursor-not-allowed bg-muted text-muted-foreground" : ""}`}
            placeholder="Sự kiện, walk-in…"
          />
          {khoaO && <ChuKhoa nguon />}
        </Field>
      </div>

      {/* G-01 — ĐỊA CHỈ NHÀ, ba ô riêng. Trước đây ba mẩu này bị nhét thành dòng
          chữ trong "Ghi chú" (nợ N-1): không lọc được theo địa bàn, và tệ hơn là
          ai không có quyền xem PII thì mất luôn địa chỉ vì cả ô ghi chú bị che.
          Danh mục 2 CẤP (hiệu lực 01/07/2025): tỉnh/thành → phường/xã, không còn
          cấp quận/huyện. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Địa chỉ (số nhà, đường)">
          <input
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            className={inputCls}
            placeholder="VD: 12 Lê Lợi"
          />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Tỉnh/Thành">
          {provinces.length > 0 ? (
            <Combobox
              options={provinces}
              value={provinceId}
              onValueChange={chonTinh}
              placeholder="Tìm tỉnh/thành..."
              emptyText="Không tìm thấy tỉnh/thành"
            />
          ) : (
            // Page quên truyền danh mục ⇒ vẫn cho gõ tay thay vì khoá cứng ô lại.
            <input
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
              className={inputCls}
            />
          )}
        </Field>
        <Field label="Phường/Xã">
          <Combobox
            options={wardChoices}
            value={wardName || null}
            onValueChange={(v) => setWardName(v ?? "")}
            disabled={provinces.length > 0 && (!provinceId || wardLoading)}
            placeholder={
              provinces.length > 0 && !provinceId
                ? "Chọn tỉnh/thành trước"
                : wardLoading
                  ? "Đang tải..."
                  : "Tìm phường/xã..."
            }
            emptyText="Không tìm thấy phường/xã"
          />
        </Field>
      </div>
      {/* G-06 — NGUỒN QUẢNG CÁO + LỊCH HẸN.
          · Mã campaign đi theo quy ước SR.QD.232 — CÙNG khuôn với tên campaign bên
            Meta (lib/ads/campaign-code.ts). Sai khuôn thì chi tiêu quy về một cơ sở
            còn lead quy về cơ sở khác, và cả hai màn đều trông bình thường.
          · Ba ô ID là mã của Meta, dùng để nối sang bảng chi tiêu (D-01) khi tính
            CPL/CPA. KHÁC nhóm utm_* đọc từ URL website: lead Messenger-first không
            đi qua website nên không có utm nào.
          · Ngày hẹn kế tiếp là thuộc tính của PHIẾU ("lần sau gọi khi nào"), khác
            bảng việc (LeadTask) — một lead nhiều việc, nhưng chỉ một cái hẹn kế. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mã campaign">
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            className={inputCls}
            placeholder="CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03"
          />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {CAMPAIGN_NAME_CONVENTION_HINT}
          </p>
        </Field>
        <Field label="Ngày hẹn liên hệ kế tiếp">
          <input
            type="date"
            value={nextFollowUpAt}
            onChange={(e) => setNextFollowUpAt(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Campaign ID (Meta)">
          <input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Ad set ID (Meta)">
          <input value={adsetId} onChange={(e) => setAdsetId(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Ad ID (Meta)">
          <input value={adId} onChange={(e) => setAdId(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Ghi chú">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls} />
        {khoaO && (
          <p className="mt-1 text-xs text-muted-foreground">
            Phần bạn gõ thêm sẽ được <b className="text-foreground">nối xuống dưới</b>; ghi chú
            của người khác không bị thay thế.
          </p>
        )}
      </Field>

      {/* R7-01 — khai báo con (chỉ ở chế độ tạo mới; sửa thì quản lý ở trang chi tiết) */}
      {!isEdit && (
        <div className="rounded-lg border border-border bg-muted/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Con của phụ huynh</span>
            <button
              type="button"
              onClick={addKid}
              className="inline-flex items-center gap-1 rounded-md border border-primary px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
            >
              <Plus size={12} /> Thêm con
            </button>
          </div>
          {kids.length === 0 ? (
            <p className="text-xs text-muted-foreground">Chưa khai báo con nào (có thể bổ sung sau khi tạo).</p>
          ) : (
            <div className="space-y-3">
              {kids.map((kid, i) => (
                <div key={i} className="rounded-lg border border-primary-soft bg-card p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Con #{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeKid(i)}
                      className="inline-flex items-center gap-1 rounded-md border border-state-danger px-2 py-1 text-xs text-state-danger-ink hover:bg-state-danger-soft"
                    >
                      <Trash2 size={12} /> Xoá
                    </button>
                  </div>
                  <ChildFields
                    value={kid}
                    onChange={(p) => patchKid(i, p)}
                    centers={centers}
                    courseGroups={courseGroups}
                    classes={classes}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Tạo lead"}
      </button>
    </div>
  );
}

/**
 * Câu giải thích dưới một ô bị khoá.
 *
 * ⚠️ Ô xám mà không nói vì sao là affordance nói dối kiểu khác: người dùng tưởng màn hình
 * hỏng, đi báo lỗi, và mất một vòng hỏi đáp cho một thứ vốn đúng ý (luật 12).
 */
function ChuKhoa({ nguon = false }: { nguon?: boolean }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {nguon
        ? "Nguồn giữ theo lần đầu lead vào hệ thống."
        : "Ô này khoá với lead đã có."}{" "}
      Cần đổi thì nhờ Quản lý cơ sở hoặc Quản trị hệ thống.
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
