"use client";

import { mlApiUrl, rewriteHost } from "./hostRewrite";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${mlApiUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[ML ${path}] ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export interface RemoveBgResponse {
  ok: boolean;
  cutoutId: string;
  cutoutUrl: string;
  studentId?: string;
}

export interface ClassifyResponse {
  ok: boolean;
  label: string;
  confidence: number;
  suggestedAnimation: string;
  candidates: string[];
}

export interface PrepareTextureResponse {
  ok: boolean;
  modelUrl: string;
  textureUrl: string;
  label: string;
  animationName?: string | null;
  studentId?: string | null;
  textureUsageHint: string;
}

export interface ApproveResponse {
  ok: boolean;
  roomId: string;
  studentId: string;
  manifest: {
    manifestId: string;
    authorId: string;
    authorName?: string | null;
    modelUrl: string;
    textureUrl?: string | null;
    animationName?: string | null;
    label?: string | null;
    createdAt: number;
  };
}

export async function mlRemoveBackground(imageDataUrl: string, studentId: string) {
  const res = await post<RemoveBgResponse>("/v1/remove-background.json", {
    imageDataUrl,
    studentId,
  });
  return { ...res, cutoutUrl: rewriteHost(res.cutoutUrl) };
}

export async function mlClassify(cutoutUrl: string, studentId: string) {
  return post<ClassifyResponse>("/v1/classify", { cutoutUrl, studentId });
}

export async function mlPrepareTextureModel(args: {
  cutoutUrl: string;
  label: string;
  studentId: string;
  animationName?: string;
}) {
  const res = await post<PrepareTextureResponse>("/v1/prepare-texture-model", args);
  return {
    ...res,
    modelUrl: rewriteHost(res.modelUrl),
    textureUrl: rewriteHost(res.textureUrl),
  };
}

export async function mlApproveGenerateAR(args: {
  roomId: string;
  studentId: string;
  authorId: string;
  authorName?: string;
  modelUrl: string;
  textureUrl?: string;
  animationName?: string;
  label?: string;
}) {
  const res = await post<ApproveResponse>("/v1/approve-generate-ar", args);
  const m = res.manifest;
  // Normalize nulls → undefined so the Zod schema on the realtime server accepts the payload.
  return {
    ok: res.ok,
    roomId: res.roomId,
    studentId: res.studentId,
    manifest: {
      manifestId: m.manifestId,
      authorId: m.authorId,
      authorName: m.authorName ?? args.authorName ?? undefined,
      modelUrl: rewriteHost(m.modelUrl),
      textureUrl: m.textureUrl ? rewriteHost(m.textureUrl) : undefined,
      animationName: m.animationName ?? undefined,
      label: m.label ?? undefined,
      createdAt: m.createdAt,
    },
  };
}
