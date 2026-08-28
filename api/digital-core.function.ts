import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-classic-environment-v2";
import type { SLO } from "@dynatrace-sdk/client-classic-environment-v2";

type DigitalCoreRequest = {
  action?: "list-slos";
  demo?: boolean;
};

type SloSummary = {
  description: string;
  enabled: boolean;
  evaluatedPercentage: number;
  id: string;
  name: string;
  status: string;
  target: number;
};

type DigitalCoreFetchError = {
  code?: number | string;
  details?: string;
  message: string;
  missingPermissions?: string[];
  missingScopes?: string[];
  status?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(payload: unknown): DigitalCoreRequest {
  return isRecord(payload) ? payload : {};
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function stringifyDetails(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2).slice(0, 6000);
  } catch {
    return "Additional error details could not be serialized.";
  }
}

function toFetchError(error: unknown): DigitalCoreFetchError {
  const errorRecord = isRecord(error) ? error : undefined;
  const response = isRecord(errorRecord?.response)
    ? errorRecord.response
    : undefined;
  const body = isRecord(errorRecord?.body) ? errorRecord.body : undefined;
  const apiError = isRecord(body?.error) ? body.error : body;
  const details = isRecord(apiError?.details) ? apiError.details : undefined;
  const message =
    (typeof apiError?.message === "string" && apiError.message) ||
    (error instanceof Error && error.message) ||
    "Dynatrace did not provide an error message.";
  const code =
    typeof apiError?.code === "number" || typeof apiError?.code === "string"
      ? apiError.code
      : typeof errorRecord?.name === "string"
        ? errorRecord.name
        : undefined;

  return {
    code,
    details: stringifyDetails(apiError?.details ?? body),
    message,
    missingPermissions: readStringArray(details?.missingPermissions),
    missingScopes: readStringArray(details?.missingScopes),
    status: typeof response?.status === "number" ? response.status : undefined,
  };
}

function toSloSummary(slo: SLO): SloSummary {
  return {
    description: slo.description ?? "",
    enabled: slo.enabled ?? true,
    evaluatedPercentage: slo.evaluatedPercentage ?? -1,
    id: slo.id,
    name: slo.name,
    status: slo.status ?? "NONE",
    target: slo.target ?? 0,
  };
}

// Fetch every SLO in the environment, paginating through nextPageKey.
// Uses the app's existing settings:objects:read scope (the classic SLO
// API accepts that scope for OAuth/platform token auth).
//
// demo:true returns Dynatrace's built-in sample SLO dataset instead of the
// tenant's real SLOs — useful for testing on a trial account with no SLOs
// configured yet. Only the first page request can carry it: per the API,
// once nextPageKey is set every other query parameter must be omitted.
async function fetchAllSlos(demo: boolean): Promise<SloSummary[]> {
  const all: SloSummary[] = [];
  let nextPageKey: string | undefined;

  do {
    const response: Awaited<ReturnType<typeof serviceLevelObjectivesClient.getSlo>> =
      await serviceLevelObjectivesClient.getSlo(
        nextPageKey
          ? { nextPageKey }
          : { demo, enabledSlos: "all", evaluate: "false", pageSize: 500 },
      );

    for (const slo of response.slo ?? []) {
      all.push(toSloSummary(slo));
    }

    nextPageKey = response.nextPageKey ?? undefined;
  } while (nextPageKey);

  return all;
}

export default async function (payload: unknown = undefined) {
  const request = parseRequest(payload);
  void request.action;
  const demo = request.demo === true;

  try {
    const slos = await fetchAllSlos(demo);

    return {
      demo,
      fetchedAt: new Date().toISOString(),
      note: demo
        ? "Fetched Dynatrace's demo SLO definitions without evaluation."
        : "Fetched SLO definitions without evaluation using the current user's app permissions.",
      ok: true as const,
      slos,
      totalCount: slos.length,
    };
  } catch (error) {
    const fetchError = toFetchError(error);
    console.error("Digital Core SLO fetch failed", fetchError);

    // Return the upstream error as data. Throwing here would make the app
    // function runtime replace it with the generic HTTP 540 failure message.
    return {
      demo,
      error: fetchError,
      fetchedAt: new Date().toISOString(),
      note: "The Dynatrace SLO API request failed.",
      ok: false as const,
      slos: [],
      totalCount: 0,
    };
  }
}
