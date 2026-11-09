"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

/** Uploads a file to Convex storage and returns its public URL. */
export function useUploader() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getPublicUrl = useMutation(api.files.getPublicUrl);
  return useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = await res.json();
      return await getPublicUrl({ storageId });
    },
    [generateUploadUrl, getPublicUrl],
  );
}

