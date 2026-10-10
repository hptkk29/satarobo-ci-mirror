// lib/scorm/manifest.ts — R7-11: parser imsmanifest.xml THUẦN (không cần DB/R2/browser).
// Parser tay tối giản (regex trên cấu trúc imsmanifest chuẩn) — KHÔNG thêm dependency.
// Đủ cho v1: đọc schemaversion + default organization → item đầu identifierref → resource href.

export type ScormVersion = "SCORM_12" | "SCORM_2004";

export type ParsedManifest = {
  /** null khi không xác định được phiên bản (manifest lỗi/thiếu). */
  version: ScormVersion | null;
  /** href bài giảng khởi chạy (tương đối so với manifest); null nếu không tìm được. */
  launchUrl: string | null;
  /** Lý do lỗi (VI) khi parse thất bại. */
  error?: string;
};

/** Tách attribute từ chuỗi thuộc tính của 1 thẻ mở. Trả map name(lowercase)→value. */
function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const name = (m[1] ?? m[3] ?? "").toLowerCase();
    const value = m[2] ?? m[4] ?? "";
    if (name) attrs[name] = value;
  }
  return attrs;
}

/** Khớp prefix namespace tuỳ chọn (vd <imsmd:schemaversion>). */
function tagContent(xml: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`,
    "i",
  );
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

/** Suy ra phiên bản SCORM từ chuỗi schemaversion. */
function detectVersion(schemaVersion: string): ScormVersion | null {
  const v = schemaVersion.toLowerCase();
  if (v.includes("1.2")) return "SCORM_12";
  // SCORM 2004 khai báo "2004 3rd Edition", "2004 4th Edition" hoặc "CAM 1.3".
  if (v.includes("2004") || v.includes("cam 1.3")) return "SCORM_2004";
  return null;
}

/**
 * Lấy block <organization>…</organization> theo identifier; nếu không truyền id
 * (no default) → lấy organization đầu tiên.
 */
function findOrganizationBlock(
  organizationsInner: string,
  defaultId: string | null,
): string | null {
  if (defaultId) {
    // organization KHÔNG lồng nhau → non-greedy an toàn.
    const re = new RegExp(
      `<organization\\b([^>]*)>([\\s\\S]*?)</organization>`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(organizationsInner)) !== null) {
      const attrs = parseAttrs(m[1]);
      if (attrs.identifier === defaultId) return m[2];
    }
    return null;
  }
  const first = /<organization\b[^>]*>([\s\S]*?)<\/organization>/i.exec(
    organizationsInner,
  );
  return first ? first[1] : null;
}

/** identifierref của <item> đầu tiên (document order) trong organization. */
function firstItemRef(organizationInner: string): string | null {
  const re = /<item\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(organizationInner)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.identifierref) return attrs.identifierref;
  }
  return null;
}

/** href của <resource> có identifier khớp resourceId. */
function resourceHref(xml: string, resourceId: string): string | null {
  const re = /<resource\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1]);
    if (attrs.identifier === resourceId && attrs.href) return attrs.href;
  }
  return null;
}

/**
 * Parse nội dung imsmanifest.xml.
 * Quy trình: schemaversion → default organization → item đầu (identifierref) →
 * resource (href) = launchUrl.
 */
export function parseManifest(xml: string): ParsedManifest {
  if (!xml || !xml.trim()) {
    return { version: null, launchUrl: null, error: "imsmanifest.xml rỗng" };
  }
  if (!/<manifest\b/i.test(xml)) {
    return {
      version: null,
      launchUrl: null,
      error: "Không tìm thấy thẻ <manifest> trong imsmanifest.xml",
    };
  }

  // 1. Phiên bản (từ <metadata>/<schemaversion>).
  const schemaVersion = tagContent(xml, "schemaversion");
  if (!schemaVersion) {
    return {
      version: null,
      launchUrl: null,
      error: "Thiếu <schemaversion> trong <metadata>",
    };
  }
  const version = detectVersion(schemaVersion);
  if (!version) {
    return {
      version: null,
      launchUrl: null,
      error: `schemaversion không nhận diện được: "${schemaVersion}"`,
    };
  }

  // 2. <organizations default="…">.
  const orgsMatch = /<organizations\b([^>]*)>([\s\S]*?)<\/organizations>/i.exec(
    xml,
  );
  if (!orgsMatch) {
    return {
      version,
      launchUrl: null,
      error: "Thiếu thẻ <organizations>",
    };
  }
  const defaultId = parseAttrs(orgsMatch[1]).default ?? null;
  const orgInner = findOrganizationBlock(orgsMatch[2], defaultId);
  if (!orgInner) {
    return {
      version,
      launchUrl: null,
      error: defaultId
        ? `Không tìm thấy organization mặc định "${defaultId}"`
        : "Không tìm thấy <organization> nào",
    };
  }

  // 3. item đầu → identifierref.
  const ref = firstItemRef(orgInner);
  if (!ref) {
    return {
      version,
      launchUrl: null,
      error: "Organization không có <item> với identifierref",
    };
  }

  // 4. resource → href.
  const href = resourceHref(xml, ref);
  if (!href) {
    return {
      version,
      launchUrl: null,
      error: `Không tìm thấy resource "${ref}" hoặc resource thiếu href`,
    };
  }

  return { version, launchUrl: href };
}
