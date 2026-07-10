import {
  workflowsClient,
  type WorkflowCreate,
  type WorkflowUpdate,
} from "@dynatrace-sdk/client-automation";

type WorkflowRequest = {
  action?: "export" | "save" | "validate";
  body?: unknown;
  id?: unknown;
  validateOnly?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkflowRequest(payload: unknown): WorkflowCreate {
  const request = isRecord(payload) ? (payload as WorkflowRequest) : {};
  const body = isRecord(request.body) ? request.body : undefined;

  if (!body) {
    throw new Error("Workflow body must be a JSON object.");
  }

  if (typeof body.title !== "string" || !body.title.trim()) {
    throw new Error("Workflow body must include a non-empty title.");
  }

  return body as unknown as WorkflowCreate;
}

function parseRequest(payload: unknown): WorkflowRequest {
  return isRecord(payload) ? payload : {};
}

function parseId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getWorkflowId(body: WorkflowCreate) {
  return typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined;
}

function toWorkflowUpdate(body: WorkflowCreate): WorkflowUpdate {
  const updateBody = { ...body };
  delete updateBody.id;
  return updateBody;
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

function isNotFoundError(error: unknown) {
  const values = collectErrorValues(error);
  return values.some((value) => {
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

function isForbiddenError(error: unknown) {
  const values = collectErrorValues(error);
  return values.some((value) => {
    const normalized = value.toLowerCase();
    return normalized === "403" || normalized.includes("403") || normalized.includes("forbidden");
  });
}

async function exportWorkflowById(id: string) {
  try {
    const workflow = await workflowsClient.exportWorkflow({ id });

    return {
      note: "Workflow exported with workflowsClient.exportWorkflow using the current user's app permissions.",
      workflow,
    };
  } catch (error) {
    if (!isForbiddenError(error)) {
      throw error;
    }

    const workflow = await workflowsClient.getWorkflow({ id });

    return {
      note: "Workflow exported with workflowsClient.getWorkflow using the current user's app permissions.",
      workflow,
    };
  }
}

async function upsertWorkflow(body: WorkflowCreate) {
  const id = getWorkflowId(body);

  if (!id) {
    return {
      action: "created" as const,
      workflow: await workflowsClient.createWorkflow({ body }),
    };
  }

  try {
    return {
      action: "updated" as const,
      workflow: await workflowsClient.updateWorkflow({
        id,
        body: toWorkflowUpdate(body),
      }),
    };
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }

    return {
      action: "created" as const,
      workflow: await workflowsClient.createWorkflow({ body }),
    };
  }
}

export default async function (payload: unknown = undefined) {
  const request = parseRequest(payload);

  if (request.action === "export") {
    const id = parseId(request.id);
    if (!id) {
      throw new Error("Workflow ID is required for export.");
    }

    const { note, workflow } = await exportWorkflowById(id);

    return {
      action: "exported",
      apiPayload: { id },
      id,
      title: workflow.title,
      note,
      workflow,
    };
  }

  const body = parseWorkflowRequest(payload);

  if (request.action === "validate" || request.validateOnly === true) {
    const id = getWorkflowId(body) ?? "";
    return {
      action: "validated",
      apiPayload: body,
      id,
      title: body.title,
      note: "Workflow JSON passed validation. No workflow was saved.",
      workflow: body,
    };
  }

  const { action, workflow } = await upsertWorkflow(body);

  return {
    action,
    apiPayload: body,
    id: workflow.id,
    title: workflow.title,
    note:
      action === "updated"
        ? "Workflow updated with workflowsClient.updateWorkflow using the current user's app permissions."
        : "Workflow created with workflowsClient.createWorkflow using the current user's app permissions.",
    workflow,
  };
}
