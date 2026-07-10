import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";
import { businessEventsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { randomUUID } from "crypto";

type AuditRequest = {
  approvalStatement?: unknown;
  issueCount?: unknown;
  issues?: unknown;
  recordsParsed?: unknown;
  report?: unknown;
  sourceKind?: unknown;
  unresolvedCount?: unknown;
  validationSummary?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(payload: unknown): AuditRequest {
  return isRecord(payload) ? payload : {};
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function objectField(value: unknown) {
  return isRecord(value) ? value : undefined;
}

export default async function (payload: unknown = undefined) {
  const request = parseRequest(payload);
  const validationSummary = objectField(request.validationSummary);
  const timestamp = new Date().toISOString();
  const user = getCurrentUserDetails();
  const auditId = randomUUID();

  const cloudEventPayload = {
    specversion: "1.0",
    id: auditId,
    type: "WCCS",
    source: "weekly_test_audit",
    data: {
      approvalStatement: stringField(request.approvalStatement),
      auditId,
      auditTime: timestamp,
      auditUserEmail: user.email,
      auditUserId: user.id,
      auditUserName: user.name,
      errors: numberField(validationSummary?.errors),
      issueCount: numberField(request.issueCount),
      issues: Array.isArray(request.issues) ? request.issues : [],
      replacementDecisions: numberField(validationSummary?.replacementDecisions),
      recordsParsed: numberField(request.recordsParsed),
      report: stringField(request.report),
      reviewedOverrides: numberField(validationSummary?.reviewedOverrides),
      sourceKind: stringField(request.sourceKind),
      unresolvedCount: numberField(request.unresolvedCount),
      validationSummary,
    },
  };

  await businessEventsClient.ingest({
    body: cloudEventPayload,
    type: "application/cloudevent+json",
  });

  return {
    auditId,
    eventProvider: "weekly_test_audit",
    eventType: "WCCS",
    ok: true,
    timestamp,
    user,
  };
}
