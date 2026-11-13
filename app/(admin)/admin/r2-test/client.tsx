"use client";

import { useState } from "react";
import { FileUploader, type UploadResult } from "@/components/admin/file-uploader";

interface UploadedFile extends UploadResult {
  uploadedAt: string;
}

export function R2TestClient() {
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-3">Upload file (tất cả categories)</h2>
        <FileUploader
          multiple
          onUploaded={(file) => {
            setUploaded((prev) => [
              { ...file, uploadedAt: new Date().toISOString() },
              ...prev,
            ]);
          }}
          onError={(err) => setErrors((prev) => [err, ...prev].slice(0, 5))}
        />
      </div>

      {errors.length > 0 && (
        <div className="bg-state-danger-soft border border-state-danger-soft rounded-lg p-4">
          <p className="font-semibold text-state-danger-ink mb-2">⚠️ Errors gần đây:</p>
          <ul className="text-sm text-state-danger-ink space-y-1">
            {errors.map((err, i) => (
              <li key={i}>• {err}</li>
            ))}
          </ul>
        </div>
      )}

      {uploaded.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            ✓ Files đã upload ({uploaded.length})
          </h2>
          <div className="space-y-2">
            {uploaded.map((file) => (
              <div key={file.key} className="border rounded-lg p-3 bg-card">
                <p className="font-medium text-sm">{file.filename}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {file.mime} · {(file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                  {new Date(file.uploadedAt).toLocaleString("vi-VN")}
                </p>
                <p className="text-xs mt-2">
                  <strong>Public URL:</strong>{" "}
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-state-info-ink break-all underline"
                  >
                    {file.url}
                  </a>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  <strong>R2 Key:</strong> <code>{file.key}</code>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
