import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';

export const VALIDATION_REPORT_SCHEMA_VERSION = '1.0.0' as const;

export const ValidationIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(['error', 'warning']),
  message: z.string().trim().min(1).max(500),
  sceneId: IdSchema.optional(),
  clipId: IdSchema.optional(),
  assetId: IdSchema.optional(),
  fieldPath: z.string().trim().max(200).optional(),
  fixHint: z.string().trim().max(300).optional(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z
  .strictObject({
    schemaVersion: z.literal(VALIDATION_REPORT_SCHEMA_VERSION),
    reportVersion: z.number().int().positive(),
    projectId: IdSchema,
    validatedRevision: z.number().int().nonnegative(),
    passed: z.boolean(),
    errors: z.array(ValidationIssueSchema),
    warnings: z.array(ValidationIssueSchema),
    validatedAt: IsoDateSchema,
  })
  .superRefine((report, ctx) => {
    if (report.passed && report.errors.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'passed report must not contain errors',
        path: ['passed'],
      });
    }

    if (!report.passed && report.errors.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'failed report must contain at least one error',
        path: ['errors'],
      });
    }

    report.errors.forEach((issue, position) => {
      if (issue.severity !== 'error') {
        ctx.addIssue({
          code: 'custom',
          message: 'errors[] items must have severity=error',
          path: ['errors', position, 'severity'],
        });
      }
    });

    report.warnings.forEach((issue, position) => {
      if (issue.severity !== 'warning') {
        ctx.addIssue({
          code: 'custom',
          message: 'warnings[] items must have severity=warning',
          path: ['warnings', position, 'severity'],
        });
      }
    });
  });

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
