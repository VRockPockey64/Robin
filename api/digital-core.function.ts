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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(payload: unknown): DigitalCoreRequest {
  return isRecord(payload) ? payload : {};
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

  const slos = await fetchAllSlos(demo);

  return {
    demo,
    fetchedAt: new Date().toISOString(),
    note: demo
      ? "Fetched Dynatrace's demo SLO definitions without evaluation."
      : "Fetched SLO definitions without evaluation using the current user's app permissions.",
    slos,
    totalCount: slos.length,
  };
}
