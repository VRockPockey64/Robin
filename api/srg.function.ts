import {
  settingsObjectsClient,
  type SettingsObjectCreate,
  type SettingsObjectUpdate,
} from "@dynatrace-sdk/client-classic-environment-v2";

const SRG_SCHEMA_ID = "app:dynatrace.site.reliability.guardian:guardians";

type SrgRequest = {
  action?: "export" | "save" | "validate";
  body?: unknown;
  id?: unknown;
  validateOnly?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSrgRequest(payload: unknown) {
  const request = isRecord(payload) ? (payload as SrgRequest) : {};
  const body = isRecord(request.body) ? request.body : undefined;

  if (!body) {
    throw new Error("SRG body must be a JSON object.");
  }

  const value = isRecord(body.value) ? body.value : body;
  const name = value.name;

  if (typeof name !== "string" || !name.trim()) {
    throw new Error("SRG JSON must include value.name or name.");
  }

  return body;
}

function parseRequest(payload: unknown): SrgRequest {
  return isRecord(payload) ? payload : {};
}

function getStringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toCreateBody(body: Record<string, unknown>): SettingsObjectCreate {
  return {
    externalId: getStringField(body, "externalId"),
    schemaId: getStringField(body, "schemaId") ?? SRG_SCHEMA_ID,
    schemaVersion: getStringField(body, "schemaVersion"),
    scope: getStringField(body, "scope") ?? "environment",
    value: isRecord(body.value) ? body.value : body,
  };
}

function toUpdateBody(body: Record<string, unknown>): SettingsObjectUpdate {
  return {
    schemaVersion: getStringField(body, "schemaVersion"),
    value: isRecord(body.value) ? body.value : body,
  };
}

function collectErrorValues(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string" || typeof value === "number") {
    return [`${value}`];
  }

  if (!isRecord(value) || seen.has(value)) {
    return [];
  }

  seen.add(value);

  const values: string[] = [];
  for (const key of ["message", "code", "status", "statusCode", "errorCode"]) {
    const field = value[key];
    if (typeof field === "string" || typeof field === "number") {
      values.push(`${field}`);
    }
  }

  for (const key of ["error", "details", "cause", "response", "body"]) {
    values.push(...collectErrorValues(value[key], seen));
  }

  return values;
}

function unknownLabel(value: unknown): string {
  if (typeof value === "undefined") {
    return "undefined";
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return value.toString();
  }

  return "Unserializable value";
}

function stringifyForError(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyForError(item, seen));
  }

  if (!isRecord(value)) {
    return unknownLabel(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  const output: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "function") {
      continue;
    }

    output[key] = stringifyForError(fieldValue, seen);
  }

  return output;
}

function describeError(error: unknown) {
  const collectedValues = collectErrorValues(error);
  const uniqueValues = Array.from(new Set(collectedValues)).filter(Boolean);
  const summary =
    uniqueValues.length > 0
      ? uniqueValues.join(" | ")
      : error instanceof Error
        ? error.message
        : "Unknown Settings API error";

  let details = "";
  try {
    details = JSON.stringify(stringifyForError(error), null, 2);
  } catch {
    details = unknownLabel(error);
  }

  return details ? `${summary}\nDetails:\n${details}` : summary;
}

function isNotFoundError(error: unknown) {
  return collectErrorValues(error).some((value) => {
    const normalized = value.toLowerCase();
    return (
      normalized === "404" ||
      normalized.includes("404") ||
      normalized.includes("not found") ||
      normalized.includes("notfound") ||
      normalized.includes("not_found")
    );
  });
}

function requireSuccessfulCreateResponse(
  response: Awaited<ReturnType<typeof settingsObjectsClient.postSettingsObjects>>,
) {
  const first = response[0];

  if (!first || first.code >= 400 || first.error) {
    throw new Error(
      `SRG create failed: ${JSON.stringify(first ?? response, null, 2)}`,
    );
  }

  return first;
}

async function upsertSrg(body: Record<string, unknown>) {
  const objectId = getStringField(body, "objectId");

  if (objectId) {
    try {
      const response = await settingsObjectsClient.putSettingsObjectByObjectId({
        objectId,
        body: toUpdateBody(body),
      });

      return {
        action: "updated" as const,
        objectId: response.objectId ?? objectId,
        response,
      };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  const createBody = toCreateBody(body);
  const response = await settingsObjectsClient.postSettingsObjects({
    body: [createBody],
  });
  const created = requireSuccessfulCreateResponse(response);

  return {
    action: "created" as const,
    objectId: created.objectId,
    response: created,
  };
}

async function validateSrg(body: Record<string, unknown>) {
  const objectId = getStringField(body, "objectId");

  if (objectId) {
    try {
      const response = await settingsObjectsClient.putSettingsObjectByObjectId({
        objectId,
        body: toUpdateBody(body),
        validateOnly: true,
      });

      return {
        action: "validated" as const,
        objectId: response.objectId ?? objectId,
        response,
      };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  const response = await settingsObjectsClient.postSettingsObjects({
    body: [toCreateBody(body)],
    validateOnly: true,
  });
  const validated = requireSuccessfulCreateResponse(response);

  return {
    action: "validated" as const,
    objectId: validated.objectId ?? objectId,
    response: validated,
  };
}

export default async function (payload: unknown = undefined) {
  const request = parseRequest(payload);

  try {
    if (request.action === "export") {
      const objectId = getStringField({ id: request.id }, "id");
      if (!objectId) {
        throw new Error("SRG object ID is required for export.");
      }

      const guardian = await settingsObjectsClient.getSettingsObjectByObjectId({
        objectId,
      });
      const value = isRecord(guardian.value) ? guardian.value : {};
      const name = typeof value.name === "string" ? value.name : "Site Reliability Guardian";

      return {
        action: "exported",
        apiPayload: { objectId },
        objectId: guardian.objectId ?? objectId,
        name,
        note: "SRG exported with settingsObjectsClient.getSettingsObjectByObjectId using the current user's app permissions.",
        response: guardian,
      };
    }

    const body = parseSrgRequest(payload);
    const createPayload = toCreateBody(body);
    const { action, objectId, response } =
      request.action === "validate" || request.validateOnly === true
        ? await validateSrg(body)
        : await upsertSrg(body);
    const value = isRecord(body.value) ? body.value : body;
    const name = typeof value.name === "string" ? value.name : "Site Reliability Guardian";

    return {
      action,
      apiPayload: action === "updated" ? toUpdateBody(body) : createPayload,
      objectId,
      name,
      note:
        action === "updated"
          ? "SRG updated with settingsObjectsClient.putSettingsObjectByObjectId using the current user's app permissions."
          : action === "validated"
            ? "SRG JSON validated with the Settings API validateOnly option. No SRG was saved."
          : "SRG created with settingsObjectsClient.postSettingsObjects using the current user's app permissions.",
      response,
    };
  } catch (error) {
    const action =
      request.action === "export"
        ? "export"
        : request.action === "validate" || request.validateOnly === true
          ? "validate"
          : "create/update";
    const body = isRecord(request.body) ? request.body : {};
    const value = isRecord(body.value) ? body.value : body;
    const name =
      typeof value.name === "string" && value.name.trim()
        ? value.name
        : "Site Reliability Guardian";
    const message = `SRG ${action} failed: ${describeError(error)}`;

    return {
      action: "failed" as const,
      apiPayload: body,
      name,
      note: message,
      response: {
        error: true,
        message,
        raw: stringifyForError(error),
      },
    };
  }
}
