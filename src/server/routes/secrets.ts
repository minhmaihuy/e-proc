/**
 * Quản lý AWS Secrets Manager — CHỈ superadmin.
 *
 * Các route này chỉ ĐỌC trạng thái và thử kết nối; chúng không bao giờ trả về giá trị
 * secret, chỉ trả tên khóa. Việc bật/tắt cố ý KHÔNG làm qua API: APP_SECRETS_ENABLED và
 * APP_SECRETS_ARN nằm trong .env của máy chủ, nên một tài khoản admin bị chiếm quyền
 * cũng không thể trỏ ứng dụng sang secret khác rồi chiếm luôn database.
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import {
  AppSecretsError,
  MANAGED_SECRET_KEYS,
  getAppSecretsStatus,
  inspectAppSecret,
} from '../services/appSecrets.js';

const router = Router();
router.use(authMiddleware);
router.use(requireSuperAdmin);

// GET /api/admin/secrets/status — trạng thái lần nạp gần nhất (chỉ tên khóa)
router.get('/status', (_req: Request, res: Response) => {
  const status = getAppSecretsStatus();
  return res.json({
    ...status,
    // Nêu rõ khóa nào đang lấy từ .env để superadmin thấy được bức tranh đầy đủ.
    envFallbackKeys: MANAGED_SECRET_KEYS.filter(
      (key) => !status.appliedKeys.includes(key) && Boolean(process.env[key]),
    ),
  });
});

// POST /api/admin/secrets/test — thử đọc một secret mà KHÔNG áp dụng nó
router.post('/test', async (req: Request, res: Response) => {
  const secretArn = String(req.body?.secret_arn ?? req.body?.secretArn ?? '').trim();
  const region = String(req.body?.aws_region ?? req.body?.awsRegion ?? '').trim()
    || process.env.APP_SECRETS_REGION
    || process.env.AWS_REGION
    || '';

  try {
    const result = await inspectAppSecret(secretArn, region);
    return res.json({
      success: true,
      secretArn,
      region,
      appliedKeys: result.appliedKeys,
      ignoredKeys: result.ignoredKeys,
      message: `Đọc được secret. ${result.appliedKeys.length} khóa sẽ được áp dụng khi bật.`,
    });
  } catch (error) {
    const message = error instanceof AppSecretsError
      ? error.message
      : 'Không đọc được secret.';
    const code = error instanceof AppSecretsError ? error.code : 'FETCH_FAILED';
    const httpStatus = code === 'INVALID_ARN' || code === 'MISSING_REGION' ? 400 : 502;
    return res.status(httpStatus).json({ success: false, code, error: message });
  }
});

export default router;
