// s3.ts — Tạo presigned PUT URL để client upload video record THẲNG lên S3.
//
// Credential AWS chỉ nằm ở backend (env). Client không bao giờ chạm credential —
// chỉ nhận một URL đã ký, hết hạn ngắn. Video đi thẳng client → S3, không qua
// backend, nên né hoàn toàn giới hạn payload/timeout của Vercel serverless.
//
// Xóa video: dùng S3 Lifecycle rule trên bucket (tự xóa sau N ngày) — không cần
// script backend.

import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_RECORDINGS_BUCKET || '';
const IDENTITY_BUCKET = process.env.S3_IDENTITY_BUCKET || '';
const URL_EXPIRES_SECONDS = 15 * 60; // presigned URL upload hết hạn 15 phút
const RECORDING_VIEW_EXPIRES_SECONDS = 5 * 60; // link xem lại hết hạn 5 phút

let s3Client: S3Client | null = null;

/** Cấu hình S3 đã đủ để hoạt động chưa (env có mặt). */
export function isS3Configured(): boolean {
  return Boolean(BUCKET);
}

/** Identity evidence is deliberately isolated from recording objects. */
export function isIdentityS3Configured(): boolean {
  return Boolean(IDENTITY_BUCKET);
}

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: REGION,
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? { credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    } } : {}),
    });
  }
  return s3Client;
}

/**
 * Tạo presigned PUT URL cho một phần video của một thí sinh.
 * Key được backend dựng từ batchId/studentId (lấy từ JWT — KHÔNG tin client),
 * nên thí sinh không thể ghi đè video của người khác.
 */
export async function createRecordingUploadUrl(params: {
  batchId: number;
  studentId: number;
  partIndex: number;
  contentType?: string;
}): Promise<{ url: string; key: string }> {
  const { batchId, studentId, partIndex, contentType } = params;
  const part = String(partIndex).padStart(3, '0');
  const key = `recordings/${batchId}/${studentId}/part${part}.webm`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || 'video/webm',
  });

  const url = await getSignedUrl(getClient(), command, { expiresIn: URL_EXPIRES_SECONDS });
  return { url, key };
}

export async function inspectRecordingObject(key: string): Promise<{ byteSize: number }> {
  const result = await getClient().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return { byteSize: Number(result.ContentLength || 0) };
}

/**
 * Presigned GET URL để trainer xem/tải lại một phần video.
 *
 * Hết hạn ngắn hơn URL upload (5 phút): link này mở ra được nguyên bằng chứng
 * chống gian lận của một thí sinh, nên không nên để nó sống lâu hay bị chia sẻ lại.
 * Key do backend đọc từ bảng recording_parts, không nhận từ client.
 */
export async function createRecordingViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: RECORDING_VIEW_EXPIRES_SECONDS });
}

export type IdentityImageKind = 'id' | 'face';

export function identityObjectKey(batchId: number, studentId: number, captureId: string, kind: IdentityImageKind): string {
  if (!/^[0-9a-f-]{36}$/.test(captureId)) throw new Error('Invalid identity capture id.');
  return `identity/${batchId}/${studentId}/${captureId}/${kind}.jpg`;
}

function identityStagingKey(batchId: number, studentId: number, captureId: string, kind: IdentityImageKind): string {
  if (!/^[0-9a-f-]{36}$/.test(captureId)) throw new Error('Invalid identity capture id.');
  return `identity/${batchId}/${studentId}/staging-${captureId}-${kind}.jpg`;
}

export async function createIdentityUploadUrls(params: {
  batchId: number;
  studentId: number;
  captureId: string;
  contentType: 'image/jpeg';
}): Promise<{ idUrl: string; faceUrl: string }> {
  const sign = (kind: IdentityImageKind) => getSignedUrl(getClient(), new PutObjectCommand({
    Bucket: IDENTITY_BUCKET,
    Key: identityStagingKey(params.batchId, params.studentId, params.captureId, kind),
    ContentType: params.contentType,
  }), { expiresIn: URL_EXPIRES_SECONDS });
  const [idUrl, faceUrl] = await Promise.all([sign('id'), sign('face')]);
  return { idUrl, faceUrl };
}

export async function inspectIdentityObject(key: string): Promise<{ byteSize: number; contentType: string }> {
  const result = await getClient().send(new HeadObjectCommand({ Bucket: IDENTITY_BUCKET, Key: key }));
  return { byteSize: Number(result.ContentLength || 0), contentType: String(result.ContentType || '') };
}

export async function finalizeIdentityObjects(params: {
  batchId: number;
  studentId: number;
  captureId: string;
}): Promise<{ idKey: string; faceKey: string }> {
  const finalize = async (kind: IdentityImageKind) => {
    const stagingKey = identityStagingKey(params.batchId, params.studentId, params.captureId, kind);
    const targetKey = identityObjectKey(params.batchId, params.studentId, params.captureId, kind);
    const image = await inspectIdentityObject(stagingKey);
    if (image.byteSize < 1 || image.byteSize > 10 * 1024 * 1024 || image.contentType !== 'image/jpeg') {
      throw new Error('Uploaded identity image is invalid.');
    }
    await getClient().send(new CopyObjectCommand({
      Bucket: IDENTITY_BUCKET,
      CopySource: `${IDENTITY_BUCKET}/${stagingKey}`,
      Key: targetKey,
      ContentType: 'image/jpeg',
      MetadataDirective: 'REPLACE',
    }));
    return targetKey;
  };
  const [idKey, faceKey] = await Promise.all([finalize('id'), finalize('face')]);
  return { idKey, faceKey };
}

export async function createIdentityViewUrl(key: string): Promise<string> {
  if (!/^identity\/\d+\/\d+\/[0-9a-f-]{36}\/(?:id|face)\.jpg$/.test(key)) throw new Error('Invalid identity object key.');
  const command = new GetObjectCommand({ Bucket: IDENTITY_BUCKET, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: RECORDING_VIEW_EXPIRES_SECONDS });
}
