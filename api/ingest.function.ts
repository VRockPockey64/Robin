import {
  businessEventsClient,
  eventsClient,
  logsClient,
} from "@dynatrace-sdk/client-classic-environment-v2";
import type { EventIngest } from "@dynatrace-sdk/client-classic-environment-v2";

type IngestKind = "bizevent" | "davis-event" | "davis-problem" | "log";

type IngestPayload = {
  kind?: IngestKind;
  message?: string;
  description?: string;
  eventType?: string;
  source?: string;
  attributes?: Record<string, unknown>;
  davis?: DavisOptions;
};

type IngestResult = {
  apiPayload?: unknown;
  ok: boolean;
  kind: IngestKind;
  id: string;
  timestamp: string;
  query: string;
  note: string;
};

type DavisOptions = {
  entitySelector?: string;
  eventCategory?: string;
  muteStatus?: string;
  impactLevel?: string;
  severity?: string;
  underMaintenance?: boolean;
  timeoutMinutes?: number;
};

const DEFAULT_SOURCE = "robin.custom.app";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function parseDavisOptions(value: unknown): DavisOptions {
  const body = isRecord(value) ? value : {};

  return {
    entitySelector: parseString(body.entitySelector),
    eventCategory: parseString(body.eventCategory),
    muteStatus: parseString(body.muteStatus),
    impactLevel: parseString(body.impactLevel),
    severity: parseString(body.severity),
    underMaintenance:
      typeof body.underMaintenance === "boolean"
        ? body.underMaintenance
        : undefined,
    timeoutMinutes: parsePositiveNumber(body.timeoutMinutes),
  };
}

function parsePayload(payload: unknown): Required<IngestPayload> {
  const body = isRecord(payload) ? payload : {};
  const rawKind = body.kind;
  const kind: IngestKind =
    rawKind === "bizevent" ||
    rawKind === "davis-event" ||
    rawKind === "davis-problem" ||
    rawKind === "log"
      ? rawKind
      : "log";

  return {
    kind,
    message:
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : `Robin ${kind} sample`,
    description: parseString(body.description) ?? "",
    eventType:
      typeof body.eventType === "string" && body.eventType.trim()
        ? body.eventType.trim()
        : "robin.sample.created",
    source:
      parseString(body.source) ?? DEFAULT_SOURCE,
    attributes: isRecord(body.attributes) ? body.attributes : {},
    davis: parseDavisOptions(body.davis),
  };
}

function buildResult(
  kind: IngestKind,
  id: string,
  timestamp: string,
): IngestResult {
  if (kind === "bizevent") {
    return {
      ok: true,
      kind,
      id,
      timestamp,
      query: `fetch bizevents\n| filter event.id == "${id}"`,
      note: "Business event ingested with businessEventsClient.ingest using the current user's app permissions.",
    };
  }

  if (kind === "davis-event" || kind === "davis-problem") {
    const eventKind =
      kind === "davis-event" ? "DAVIS_EVENT" : "DAVIS_PROBLEM";

    return {
      ok: true,
      kind,
      id,
      timestamp,
      query: `fetch events\n| filter event.kind == "${eventKind}"\n| filter robin.ingest.id == "${id}"`,
      note:
        kind === "davis-event"
          ? "Custom Davis event sample ingested with eventsClient.createEvent as CUSTOM_INFO."
          : "Custom Davis problem sample ingested with eventsClient.createEvent as CUSTOM_ALERT.",
    };
  }

  return {
    ok: true,
    kind,
    id,
    timestamp,
    query: `fetch logs | filter robin.ingest.id == "${id}"`,
    note: "Log record ingested with logsClient.storeLog using the current user's app permissions.",
  };
}

function stringifyEventProperties(
  attributes: Record<string, unknown>,
): Record<string, string> {
  const properties: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) {
      continue;
    }

    properties[key] =
      typeof value === "string" ? value : JSON.stringify(value);
  }

  return properties;
}

function addProperty(
  properties: Record<string, string>,
  key: string,
  value: string | boolean | number | undefined,
) {
  if (value !== undefined && `${value}`.trim()) {
    properties[key] = `${value}`;
  }
}

function buildBusinessEventPayload(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
) {
  return {
    specversion: "1.0",
    id,
    source: request.source,
    type: request.eventType,
    time: new Date(timestamp),
    data: {
      message: request.message,
      "robin.ingest.id": id,
      ...request.attributes,
    },
  };
}

function buildLogPayload(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
) {
  return [
    {
      content: request.message,
      timestamp,
      severity: "info",
      "log.source": request.source,
      "event.type": request.eventType,
      "robin.ingest.id": id,
      ...request.attributes,
    },
  ];
}

function buildDavisEventPayload(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
): EventIngest {
  const isProblem = request.kind === "davis-problem";
  const properties = {
    "robin.ingest.id": id,
    "robin.source": request.source,
    "robin.event.label": request.eventType,
    ...stringifyEventProperties(request.attributes),
  };

  addProperty(properties, "event.category", request.davis.eventCategory);
  addProperty(properties, "event.severity", request.davis.severity);
  addProperty(properties, "event.description", request.description);
  addProperty(
    properties,
    "maintenance.is_under_maintenance",
    request.davis.underMaintenance,
  );

  return {
    eventType: isProblem ? "CUSTOM_ALERT" : "CUSTOM_INFO",
    title: request.message,
    startTime: new Date(timestamp).getTime(),
    entitySelector: request.davis.entitySelector,
    timeout: request.davis.timeoutMinutes ?? (isProblem ? 15 : undefined),
    properties,
  };
}

async function ingestBusinessEvent(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
) {
  await businessEventsClient.ingest({
    type: "application/cloudevent+json",
    body: buildBusinessEventPayload(request, id, timestamp),
  });
}

async function ingestLog(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
) {
  await logsClient.storeLog({
    type: "application/json; charset=utf-8",
    body: buildLogPayload(request, id, timestamp),
  });
}

async function ingestDavisEvent(
  request: Required<IngestPayload>,
  id: string,
  timestamp: string,
) {
  await eventsClient.createEvent({
    body: buildDavisEventPayload(request, id, timestamp),
  });
}

export default async function (payload: unknown = undefined) {
  const request = parsePayload(payload);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  let apiPayload: unknown;

  if (request.kind === "bizevent") {
    apiPayload = buildBusinessEventPayload(request, id, timestamp);
    await ingestBusinessEvent(request, id, timestamp);
  } else if (
    request.kind === "davis-event" ||
    request.kind === "davis-problem"
  ) {
    apiPayload = buildDavisEventPayload(request, id, timestamp);
    await ingestDavisEvent(request, id, timestamp);
  } else {
    apiPayload = buildLogPayload(request, id, timestamp);
    await ingestLog(request, id, timestamp);
  }

  return {
    ...buildResult(request.kind, id, timestamp),
    apiPayload,
  };
}
