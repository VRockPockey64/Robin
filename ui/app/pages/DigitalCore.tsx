import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import {
  serviceLevelObjectivesClient,
  type SLO,
} from "@dynatrace-sdk/client-classic-environment-v2";
import { useAppConsole } from "../components/AppConsole";
import { GetDcSlos } from "./GetDcSlos";

type SloSummary = {
  description: string;
  enabled: boolean;
  evaluatedPercentage: number;
  id: string;
  name: string;
  status: string;
  target: number;
};

type DigitalCoreResult = {
  demo: boolean;
  error?: {
    code?: number | string;
    details?: string;
    message: string;
    missingPermissions?: string[];
    missingScopes?: string[];
    status?: number;
  };
  fetchedAt: string;
  note: string;
  ok: boolean;
  slos: SloSummary[];
  totalCount: number;
};

type ComparisonRow = {
  availabilityMatches: SloSummary[];
  candidates: MatchCandidate[];
  confidence: "high" | "review" | "none";
  matchTerms: string[];
  matches: SloSummary[];
  name: string;
  performanceMatches: SloSummary[];
  reviewed: boolean;
};

type MatchCandidate = {
  evidenceTerms: string[];
  score: number;
  slo: SloSummary;
};

type MatchTerm = {
  normalized: string;
  original: string;
};

type SloMatchIndex = {
  documentFrequency: Map<string, number>;
  entries: Array<{
    accountIdentifiers: string[];
    namespace?: "dc" | "sccg";
    slo: SloSummary;
    terms: Set<string>;
  }>;
  termToEntryIndexes: Map<string, number[]>;
};

type ComparisonExportRow = {
  "API Name": string;
  "Match Status": "High confidence" | "Reviewed" | "Pending" | "No match";
  "Match Terms Used": string;
  "Has Availability SLO": "Yes" | "No" | "Pending";
  "Availability SLO Count": number;
  "Availability SLO Names": string;
  "Has Performance SLO": "Yes" | "No" | "Pending";
  "Performance SLO Count": number;
  "Performance SLO Names": string;
  "Total Matching SLOs": number;
  "Other SLO Count": number;
  "Other SLO Names": string;
};

const ignoredMatchTerms = new Set([
  "api",
  "availability",
  "cdk",
  "cc1",
  "dev",
  "development",
  "e2e",
  "nonprod",
  "nonproduction",
  "performance",
  "prd",
  "prod",
  "production",
  "qa",
  "sccg",
  "slo",
  "sre",
  "stage",
  "staging",
  "test",
  "testing",
  "uat",
  "function",
  "lambda",
]);

const REVIEW_PAGE_SIZE = 25;

const fieldStyle: React.CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 6,
  font: "inherit",
  minHeight: 36,
  padding: "6px 10px",
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  minHeight: 36,
  padding: "9px 14px",
};

const disabledButtonStyle: React.CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.55,
};

const panelStyle: React.CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 8,
  maxWidth: "calc(100vw - 64px)",
  padding: 20,
  width: "clamp(960px, 70vw, 1500px)",
};

const codeBlockStyle: React.CSSProperties = {
  borderRadius: 6,
  boxSizing: "border-box",
  margin: 0,
  maxHeight: 460,
  maxWidth: "100%",
  overflow: "auto",
  padding: 12,
  whiteSpace: "pre-wrap",
};

const helpTextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  margin: 0,
  opacity: 0.78,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function toFetchError(error: unknown): NonNullable<DigitalCoreResult["error"]> {
  const errorRecord = isRecord(error) ? error : undefined;
  const response = isRecord(errorRecord?.response)
    ? errorRecord.response
    : undefined;
  const body = isRecord(errorRecord?.body) ? errorRecord.body : undefined;
  const apiError = isRecord(body?.error) ? body.error : body;
  const details = isRecord(apiError?.details) ? apiError.details : undefined;

  return {
    code:
      typeof apiError?.code === "number" || typeof apiError?.code === "string"
        ? apiError.code
        : typeof errorRecord?.name === "string"
          ? errorRecord.name
          : undefined,
    details: stringifyDetails(apiError?.details ?? body),
    message:
      (typeof apiError?.message === "string" && apiError.message) ||
      (error instanceof Error && error.message) ||
      "Dynatrace did not provide an error message.",
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

    all.push(...(response.slo ?? []).map(toSloSummary));
    nextPageKey = response.nextPageKey ?? undefined;
  } while (nextPageKey);

  return all;
}

function getThemeStyles(theme: "light" | "dark") {
  const dark = theme === "dark";

  return {
    panel: {
      background: dark ? "#18192a" : "#ffffff",
      border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
    },
    field: {
      background: dark ? "#101221" : "#ffffff",
      border: dark ? "1px solid #555976" : "1px solid #b8bdcc",
      color: dark ? "#f7f7ff" : "#14151f",
      outlineColor: dark ? "#8ea0ff" : "#3f5fff",
    },
    idleButton: {
      background: dark ? "#23253a" : "#ffffff",
      border: dark ? "1px solid #4a4d68" : "1px solid #ccd1df",
      color: dark ? "#f7f7ff" : "#222633",
    },
    segment: {
      background: dark ? "#111323" : "#f3f5fb",
      border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
    },
    selectedButton: {
      background: dark ? "#d7ddff" : "#243bdb",
      border: dark ? "1px solid #f2f4ff" : "1px solid #182bb3",
      color: dark ? "#111323" : "#ffffff",
      boxShadow: dark
        ? "0 0 0 2px rgba(215, 221, 255, 0.2)"
        : "0 0 0 2px rgba(36, 59, 219, 0.14)",
    },
    primaryButton: {
      background: dark ? "#d7ddff" : "#243bdb",
      border: dark ? "1px solid #f2f4ff" : "1px solid #182bb3",
      color: dark ? "#111323" : "#ffffff",
      boxShadow: "0 8px 18px rgba(0, 0, 0, 0.2)",
    },
    code: {
      background: dark ? "#101221" : "#f6f7fb",
      border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
      color: dark ? "#f7f7ff" : "#14151f",
    },
    error: {
      background: dark ? "#3b1820" : "#fff0f2",
      border: dark ? "1px solid #d9465f" : "1px solid #d22d4a",
      color: dark ? "#ffd0d8" : "#731827",
    },
    success: {
      background: dark ? "#123322" : "#e8fff1",
      border: dark ? "1px solid #38a36a" : "1px solid #35a866",
      color: dark ? "#b7ffd3" : "#0d5b32",
    },
    warning: {
      background: dark ? "#3a2a10" : "#fff7df",
      border: dark ? "1px solid #c98a2a" : "1px solid #d99021",
      color: dark ? "#ffd89a" : "#5d3b00",
    },
  };
}

function parseWorkbookNames(
  buffer: ArrayBuffer,
  skipHeaderRow: boolean,
): string[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("The file has no sheets.");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });

  const dataRows = skipHeaderRow ? rows.slice(1) : rows;

  const names = dataRows
    .map((row) => (Array.isArray(row) ? row[0] : undefined))
    .map((cell) => {
      if (
        typeof cell === "string" ||
        typeof cell === "number" ||
        typeof cell === "boolean" ||
        typeof cell === "bigint"
      ) {
        return String(cell).trim();
      }

      return "";
    })
    .filter(Boolean);

  return [...new Set(names)];
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getNameTerms(name: string): MatchTerm[] {
  const terms = new Map<string, string>();

  for (const segment of name.split("-").map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalizeForMatch(segment);
    if (
      normalized.length >= 3 &&
      !ignoredMatchTerms.has(normalized) &&
      !terms.has(normalized)
    ) {
      terms.set(normalized, segment);
    }
  }

  return [...terms].map(([normalized, original]) => ({ normalized, original }));
}

function getAccountIdentifiers(name: string): string[] {
  return [
    ...new Set(
      name
        .split("-")
        .map(normalizeForMatch)
        // Cell-account identifiers follow the observed ep<cell><number><zone><number>
        // shape, for example epc20n1 or eps10n1. The cell letter is not hardcoded.
        .filter((term) => /^ep[a-z]\d+[a-z]\d+$/.test(term)),
    ),
  ].sort();
}

function getNameNamespace(name: string): "dc" | "sccg" | undefined {
  const segments = name.split("-").map(normalizeForMatch);
  if (segments.includes("dc")) {
    return "dc";
  }

  if (segments.includes("sccg")) {
    return "sccg";
  }

  return undefined;
}

function hasCompatibleNamespace(
  apiNamespace: "dc" | "sccg" | undefined,
  sloNamespace: "dc" | "sccg" | undefined,
): boolean {
  return !apiNamespace || !sloNamespace || apiNamespace === sloNamespace;
}

function hasCompatibleAccountIdentity(
  apiAccountIdentifiers: string[],
  sloAccountIdentifiers: string[],
): boolean {
  if (apiAccountIdentifiers.length !== sloAccountIdentifiers.length) {
    return false;
  }

  return apiAccountIdentifiers.every(
    (identifier, index) => identifier === sloAccountIdentifiers[index],
  );
}

function buildSloMatchIndex(slos: SloSummary[]): SloMatchIndex {
  const documentFrequency = new Map<string, number>();
  const termToEntryIndexes = new Map<string, number[]>();
  const entries = slos.map((slo, entryIndex) => {
    const accountIdentifiers = getAccountIdentifiers(slo.name);
    const namespace = getNameNamespace(slo.name);
    const terms = new Set(getNameTerms(slo.name).map((term) => term.normalized));
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      const entryIndexes = termToEntryIndexes.get(term) ?? [];
      entryIndexes.push(entryIndex);
      termToEntryIndexes.set(term, entryIndexes);
    }

    return { accountIdentifiers, namespace, slo, terms };
  });

  return { documentFrequency, entries, termToEntryIndexes };
}

function scoreMatches(name: string, index: SloMatchIndex): MatchCandidate[] {
  const apiAccountIdentifiers = getAccountIdentifiers(name);
  const apiNamespace = getNameNamespace(name);
  const apiTerms = getNameTerms(name).filter(
    (term) => !apiAccountIdentifiers.includes(term.normalized),
  );
  const maximumDistinctiveFrequency = Math.max(
    20,
    Math.ceil(index.entries.length * 0.02),
  );
  const minimumEvidenceRequired = apiAccountIdentifiers.length > 0 ? 1 : 2;
  const evidenceByEntry = new Map<number, MatchTerm[]>();

  for (const term of apiTerms) {
    for (const entryIndex of index.termToEntryIndexes.get(term.normalized) ?? []) {
      const evidence = evidenceByEntry.get(entryIndex) ?? [];
      evidence.push(term);
      evidenceByEntry.set(entryIndex, evidence);
    }
  }

  const candidates = [...evidenceByEntry]
    .map(([entryIndex, evidence]) => {
      const { accountIdentifiers, namespace, slo } = index.entries[entryIndex];
      if (
        !hasCompatibleNamespace(apiNamespace, namespace) ||
        !hasCompatibleAccountIdentity(apiAccountIdentifiers, accountIdentifiers)
      ) {
        return undefined;
      }

      const score = evidence.reduce((total, term) => {
        const frequency = index.documentFrequency.get(term.normalized) ?? 1;
        const rarity = Math.log2((index.entries.length + 1) / (frequency + 1)) + 1;
        const lengthWeight = 1 + Math.min(term.normalized.length, 16) / 16;
        return total + rarity * lengthWeight;
      }, 0);
      const hasDistinctiveTerm = evidence.some((term) => {
        const frequency = index.documentFrequency.get(term.normalized) ?? 0;
        return term.normalized.length >= 8 && frequency <= maximumDistinctiveFrequency;
      });

      return {
        candidate: {
          evidenceTerms: evidence.map((term) => term.original),
          score,
          slo,
        },
        eligible: evidence.length >= minimumEvidenceRequired || hasDistinctiveTerm,
      };
    })
    .filter(
      (
        result,
      ): result is { candidate: MatchCandidate; eligible: boolean } =>
        result !== undefined,
    )
    .filter((result) => result.eligible)
    .map((result) => result.candidate)
    .sort(
      (left, right) =>
        right.score - left.score || left.slo.name.localeCompare(right.slo.name),
    );

  const strongestEvidenceCount = candidates.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.evidenceTerms.length),
    0,
  );
  const strongestCandidates = candidates.filter(
    (candidate) => candidate.evidenceTerms.length === strongestEvidenceCount,
  );
  const bestScore = strongestCandidates[0]?.score ?? 0;
  return strongestCandidates
    .filter((candidate) => candidate.score >= bestScore * 0.95)
    .slice(0, 6);
}

function buildComparisonRow(name: string, index: SloMatchIndex): ComparisonRow {
  const candidates = scoreMatches(name, index);
  const matches = candidates.map((candidate) => candidate.slo);
  const strongestEvidenceCount = candidates[0]?.evidenceTerms.length ?? 0;
  const hasExactCellIdentity = getAccountIdentifiers(name).length > 0;
  const highConfidenceEvidenceRequired = hasExactCellIdentity ? 1 : 3;
  const confidence =
    candidates.length === 0
      ? "none"
      : candidates.length <= 4 &&
          strongestEvidenceCount >= highConfidenceEvidenceRequired
        ? "high"
        : "review";
  const matchTerms = [
    ...new Set(candidates.flatMap((candidate) => candidate.evidenceTerms)),
  ];

  return {
    availabilityMatches: matches.filter((slo) =>
      isSloType(slo, "availability"),
    ),
    candidates,
    confidence,
    matchTerms,
    matches,
    name,
    performanceMatches: matches.filter((slo) =>
      isSloType(slo, "performance"),
    ),
    reviewed: confidence !== "review",
  };
}

function isSloType(slo: SloSummary, type: "availability" | "performance") {
  return normalizeForMatch(slo.name).includes(type);
}

function formatFetchError(result: DigitalCoreResult): string {
  if (!result.error) {
    return result.note;
  }

  return [
    result.error.message,
    result.error.status !== undefined
      ? `HTTP status: ${result.error.status}`
      : undefined,
    result.error.code !== undefined ? `Error code: ${result.error.code}` : undefined,
    result.error.missingScopes?.length
      ? `Missing scopes: ${result.error.missingScopes.join(", ")}`
      : undefined,
    result.error.missingPermissions?.length
      ? `Missing permissions: ${result.error.missingPermissions.join(", ")}`
      : undefined,
    result.error.details ? `Details:\n${result.error.details}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function toExportRows(rows: ComparisonRow[]): ComparisonExportRow[] {
  return rows.map((row) => {
    const typedMatchIds = new Set([
      ...row.availabilityMatches.map((slo) => slo.id),
      ...row.performanceMatches.map((slo) => slo.id),
    ]);
    const otherMatches = row.matches.filter((slo) => !typedMatchIds.has(slo.id));

    return {
      "API Name": row.name,
      "Match Status":
        row.confidence === "high"
          ? "High confidence"
          : !row.reviewed
            ? "Pending"
            : row.confidence === "review"
              ? "Reviewed"
              : "No match",
      "Match Terms Used": row.matchTerms.join(" + "),
      "Has Availability SLO": !row.reviewed
        ? "Pending"
        : row.availabilityMatches.length > 0
          ? "Yes"
          : "No",
      "Availability SLO Count": row.availabilityMatches.length,
      "Availability SLO Names": row.availabilityMatches
        .map((slo) => slo.name)
        .join("; "),
      "Has Performance SLO": !row.reviewed
        ? "Pending"
        : row.performanceMatches.length > 0
          ? "Yes"
          : "No",
      "Performance SLO Count": row.performanceMatches.length,
      "Performance SLO Names": row.performanceMatches
        .map((slo) => slo.name)
        .join("; "),
      "Total Matching SLOs": row.matches.length,
      "Other SLO Count": otherMatches.length,
      "Other SLO Names": otherMatches.map((slo) => slo.name).join("; "),
    };
  });
}

function buildReport(rows: ComparisonRow[], totalSlos: number) {
  const withAvailability = rows.filter(
    (row) => row.availabilityMatches.length > 0,
  );
  const withPerformance = rows.filter(
    (row) => row.performanceMatches.length > 0,
  );
  const withBoth = rows.filter(
    (row) =>
      row.availabilityMatches.length > 0 && row.performanceMatches.length > 0,
  );
  const pending = rows.filter((row) => !row.reviewed);
  const withoutSlos = rows.filter(
    (row) => row.reviewed && row.matches.length === 0,
  );

  return [
    "Digital Core SLO comparison report",
    `Uploaded names: ${rows.length}`,
    `SLOs in environment: ${totalSlos}`,
    `APIs with availability SLO: ${withAvailability.length}`,
    `APIs with performance SLO: ${withPerformance.length}`,
    `APIs with both: ${withBoth.length}`,
    `APIs pending review: ${pending.length}`,
    `APIs with no matching SLO: ${withoutSlos.length}`,
    "",
    "Per-API results:",
    ...rows.map(
      (row) => [
        `  ${row.name}`,
        `    Status: ${row.confidence === "high" ? "High confidence" : !row.reviewed ? "Pending review" : row.confidence === "review" ? "Reviewed" : "No match"}`,
        `    Match terms: ${row.matchTerms.join(" + ")}`,
        `    Availability: ${!row.reviewed ? "Pending" : row.availabilityMatches.length > 0 ? "Yes" : "No"} (${row.availabilityMatches.length})`,
        `    Performance: ${!row.reviewed ? "Pending" : row.performanceMatches.length > 0 ? "Yes" : "No"} (${row.performanceMatches.length})`,
        `    Total matching SLOs: ${row.matches.length}`,
        ...row.matches.map((match) => `      - ${match.name}`),
      ].join("\n"),
    ),
  ].join("\n");
}

export const DigitalCore = () => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [skipHeaderRow, setSkipHeaderRow] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [parseError, setParseError] = useState("");
  const [debugMode, setDebugMode] = useState(false);
  const [reviewSelections, setReviewSelections] = useState<
    Record<string, string[]>
  >({});
  const [reviewPage, setReviewPage] = useState(0);
  const [useDemoSlos, setUseDemoSlos] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const [activeSection, setActiveSection] = useState<
    "slo-status" | "get-dc-slos"
  >("slo-status");
  const [sloData, setSloData] = useState<DigitalCoreResult>();
  const [sloIsLoading, setSloIsLoading] = useState(false);

  const suggestedRows: ComparisonRow[] = useMemo(() => {
    if (!sloData?.ok) {
      return [];
    }

    const index = buildSloMatchIndex(sloData.slos);
    return names.map((name) => buildComparisonRow(name, index));
  }, [names, sloData]);

  const rows: ComparisonRow[] = useMemo(
    () =>
      suggestedRows.map((row) => {
        const selectedIds = reviewSelections[row.name];
        if (selectedIds === undefined && row.confidence !== "review") {
          return row;
        }

        const selectedIdSet = new Set(selectedIds ?? []);
        const candidates = row.candidates.filter((candidate) =>
          selectedIdSet.has(candidate.slo.id),
        );
        const matches = candidates.map((candidate) => candidate.slo);

        return {
          ...row,
          availabilityMatches: matches.filter((slo) =>
            isSloType(slo, "availability"),
          ),
          candidates,
          matchTerms:
            selectedIds === undefined
              ? row.matchTerms
              : [
                  ...new Set(
                    candidates.flatMap((candidate) => candidate.evidenceTerms),
                  ),
                ],
          matches,
          performanceMatches: matches.filter((slo) =>
            isSloType(slo, "performance"),
          ),
          reviewed: selectedIds !== undefined,
        };
      }),
    [reviewSelections, suggestedRows],
  );

  const reviewerRows = suggestedRows.filter((row) => row.confidence === "review");
  const reviewPageCount = Math.max(
    1,
    Math.ceil(reviewerRows.length / REVIEW_PAGE_SIZE),
  );
  const visibleReviewerRows = reviewerRows.slice(
    reviewPage * REVIEW_PAGE_SIZE,
    (reviewPage + 1) * REVIEW_PAGE_SIZE,
  );
  const highConfidenceCount = suggestedRows.filter(
    (row) => row.confidence === "high",
  ).length;
  const noCandidateCount = suggestedRows.filter(
    (row) => row.confidence === "none",
  ).length;

  const pendingCount = rows.filter((row) => !row.reviewed).length;
  const unmatchedCount = rows.filter(
    (row) => row.reviewed && row.matches.length === 0,
  ).length;
  const availabilityCount = rows.filter(
    (row) => row.availabilityMatches.length > 0,
  ).length;
  const performanceCount = rows.filter(
    (row) => row.performanceMatches.length > 0,
  ).length;
  const completeCount = rows.filter(
    (row) =>
      row.availabilityMatches.length > 0 && row.performanceMatches.length > 0,
  ).length;
  const report = useMemo(
    () => buildReport(rows, sloData?.totalCount ?? 0),
    [rows, sloData?.totalCount],
  );

  const handleFile = (file: File) => {
    setFileName(file.name);
    setParseError("");
    setNames([]);
    setReviewSelections({});
    setReviewPage(0);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (!(result instanceof ArrayBuffer)) {
        setParseError("Could not read the file.");
        return;
      }

      try {
        const parsed = parseWorkbookNames(result, skipHeaderRow);
        setNames(parsed);
        log(
          "info",
          "Digital Core",
          `Parsed ${parsed.length} name(s) from ${file.name}.`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not parse the file.";
        setParseError(message);
        log("error", "Digital Core", message);
      }
    };
    reader.onerror = () => {
      setParseError("Could not read the file.");
      log("error", "Digital Core", `Could not read ${file.name}.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const clearFile = () => {
    setFileName("");
    setNames([]);
    setParseError("");
    setReviewSelections({});
    setReviewPage(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const fetchSlos = async () => {
    setSloIsLoading(true);
    setSloData(undefined);
    setReviewSelections({});
    setReviewPage(0);

    try {
      const slos = await fetchAllSlos(useDemoSlos);
      const result: DigitalCoreResult = {
        demo: useDemoSlos,
        fetchedAt: new Date().toISOString(),
        note: useDemoSlos
          ? "Fetched Dynatrace's demo SLO definitions without evaluation."
          : "Fetched every tenant SLO definition directly from the app UI without evaluation.",
        ok: true,
        slos,
        totalCount: slos.length,
      };
      setSloData(result);
      log("info", "Digital Core", `Fetched ${result.totalCount} SLOs. ${result.note}`);
    } catch (error) {
      const result: DigitalCoreResult = {
        demo: useDemoSlos,
        error: toFetchError(error),
        fetchedAt: new Date().toISOString(),
        note: "The Dynatrace SLO API request failed in the app UI.",
        ok: false,
        slos: [],
        totalCount: 0,
      };
      setSloData(result);
      log("error", "Digital Core SLO fetch", formatFetchError(result));
    } finally {
      setSloIsLoading(false);
    }
  };

  const runComparison = () => {
    log(
      "info",
      "Digital Core",
      `Fetching SLOs to compare against ${names.length} uploaded name(s).`,
    );
    void fetchSlos();
  };

  const runButtonLabel = () => {
    if (sloIsLoading) {
      return "Fetching SLOs...";
    }

    return "Fetch SLOs & compare";
  };

  const setCandidateSelected = (
    row: ComparisonRow,
    sloId: string,
    selected: boolean,
  ) => {
    setReviewSelections((current) => {
      const selectedIds = new Set(current[row.name] ?? []);
      if (selected) {
        selectedIds.add(sloId);
      } else {
        selectedIds.delete(sloId);
      }

      return { ...current, [row.name]: [...selectedIds] };
    });
  };

  const copyText = (label: string, value: string) => {
    window.clearTimeout(copyStatusTimer.current);
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopyStatus(label);
        copyStatusTimer.current = window.setTimeout(() => setCopyStatus(""), 2000);
      },
      () => {
        log("error", "Clipboard", `Could not copy ${label}`);
        setCopyStatus(`error:${label}`);
        copyStatusTimer.current = window.setTimeout(() => setCopyStatus(""), 2000);
      },
    );
  };

  const copyButtonText = (label: string, defaultText: string) => {
    if (copyStatus === label) {
      return "Copied";
    }

    if (copyStatus === `error:${label}`) {
      return "Copy failed";
    }

    return defaultText;
  };

  const downloadComparison = () => {
    const worksheet = XLSX.utils.json_to_sheet(toExportRows(rows));
    worksheet["!cols"] = [
      { wch: 38 },
      { wch: 18 },
      { wch: 48 },
      { wch: 22 },
      { wch: 24 },
      { wch: 70 },
      { wch: 22 },
      { wch: 24 },
      { wch: 70 },
      { wch: 20 },
      { wch: 18 },
      { wch: 70 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "SLO Comparison");
    const baseName = fileName.replace(/\.[^.]+$/, "") || "digital-core";
    XLSX.writeFile(workbook, `${baseName}-slo-comparison.xlsx`, {
      compression: true,
    });
    log(
      "info",
      "Digital Core",
      `Downloaded SLO comparison for ${rows.length} API name(s).`,
    );
  };

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex flexDirection="column" gap={8} style={panelStyle}>
        <Heading>Digital Core</Heading>
        <Paragraph>
          Upload a spreadsheet of API or service names and compare it against
          the SLOs configured in this environment.
        </Paragraph>
      </Flex>

      <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
        <Flex
          gap={8}
          flexFlow="wrap"
          style={{
            ...styles.segment,
            borderRadius: 8,
            padding: 6,
            width: "fit-content",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveSection("slo-status")}
            style={{
              ...buttonStyle,
              ...(activeSection === "slo-status"
                ? styles.selectedButton
                : styles.idleButton),
            }}
          >
            SLO Status
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("get-dc-slos")}
            style={{
              ...buttonStyle,
              ...(activeSection === "get-dc-slos"
                ? styles.selectedButton
                : styles.idleButton),
            }}
          >
            Get DC SLOs
          </button>
        </Flex>

        {activeSection === "slo-status" ? (
          <>
        <Flex flexDirection="column" gap={6}>
          <Heading level={2}>SLO Status</Heading>
          <Paragraph>
            Upload API or service names and check which ones already have an
            availability or performance SLO configured in this environment.
          </Paragraph>
        </Flex>

        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Upload .xlsx or .csv</Strong>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFileInputChange}
            style={{ ...fieldStyle, ...styles.field, padding: 6 }}
          />
          <p style={helpTextStyle}>
            Reads the first column of the first sheet (or the whole CSV
            column). One name per row.
          </p>
        </label>

        <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
          <input
            type="checkbox"
            checked={skipHeaderRow}
            onChange={(event) => {
              setSkipHeaderRow(event.target.checked);
              if (fileInputRef.current?.files?.[0]) {
                handleFile(fileInputRef.current.files[0]);
              }
            }}
          />
          <Strong>First row is a header (skip it)</Strong>
        </label>

        <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(event) => {
              setDebugMode(event.target.checked);
              setReviewPage(0);
            }}
          />
          <Strong>Debug mode</Strong>
        </label>
        {debugMode && (
          <p style={helpTextStyle}>
            After matching, shows only ambiguous or unmatched APIs for review.
            High-confidence matches stay selected automatically.
          </p>
        )}

        <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
          <input
            type="checkbox"
            checked={useDemoSlos}
            onChange={(event) => setUseDemoSlos(event.target.checked)}
          />
          <Strong>Use demo SLOs (for testing)</Strong>
        </label>
        {useDemoSlos && (
          <p style={helpTextStyle}>
            Fetches Dynatrace&apos;s built-in sample SLO dataset instead of
            this tenant&apos;s real SLOs — useful on a trial account that
            doesn&apos;t have any SLOs configured yet.
          </p>
        )}

        {parseError && (
          <div
            role="alert"
            style={{
              ...styles.error,
              borderRadius: 6,
              boxSizing: "border-box",
              padding: 12,
            }}
          >
            <Strong>{parseError}</Strong>
          </div>
        )}

        {fileName && !parseError && (
          <Flex
            flexDirection="column"
            gap={8}
            style={{ ...panelStyle, ...styles.panel, width: "100%" }}
          >
            <Flex justifyContent="space-between" alignItems="center" gap={12}>
              <Paragraph>
                <Strong>{fileName}</Strong> &mdash; {names.length} name(s) parsed
              </Paragraph>
              <button
                type="button"
                onClick={clearFile}
                style={{ ...buttonStyle, ...styles.idleButton }}
              >
                Clear
              </button>
            </Flex>
            <pre style={{ ...styles.code, ...codeBlockStyle, maxHeight: 200 }}>
              {names.slice(0, 200).join("\n")}
              {names.length > 200 ? `\n... and ${names.length - 200} more` : ""}
            </pre>
          </Flex>
        )}

        <Flex justifyContent="flex-end">
          <button
            type="button"
            disabled={names.length === 0 || sloIsLoading}
            onClick={runComparison}
            style={{
              ...buttonStyle,
              ...styles.primaryButton,
              ...(names.length === 0 || sloIsLoading ? disabledButtonStyle : {}),
              paddingInline: 18,
            }}
          >
            {runButtonLabel()}
          </button>
        </Flex>

        {sloData && !sloData.ok && (
          <div
            role="alert"
            style={{
              ...styles.error,
              borderRadius: 6,
              boxSizing: "border-box",
              padding: 12,
            }}
          >
            <Strong>Could not fetch SLOs from this Dynatrace tenant.</Strong>
            <pre
              style={{
                font: "inherit",
                marginBottom: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {formatFetchError(sloData)}
            </pre>
          </div>
        )}

        {sloData?.ok && (
          <>
            <div
              role="status"
              style={{
                ...(unmatchedCount === 0 ? styles.success : styles.warning),
                borderRadius: 6,
                boxSizing: "border-box",
                padding: 12,
              }}
            >
              <Strong>
                {sloData.totalCount} {sloData.demo ? "demo " : ""}SLOs
                fetched. {availabilityCount} API(s) have availability SLOs, {" "}
                {performanceCount} have performance SLOs, {completeCount} have
                both, {pendingCount} are pending review, and {unmatchedCount} have
                no matching SLO.
              </Strong>
            </div>

            {debugMode && (
              <Flex
                flexDirection="column"
                gap={12}
                style={{ ...panelStyle, ...styles.panel, width: "100%" }}
              >
                <Flex flexDirection="column" gap={4}>
                  <div>
                    <Heading level={3}>Match reviewer</Heading>
                    <Paragraph>
                      {highConfidenceCount} high-confidence match(es) accepted
                      automatically. {reviewerRows.length} ambiguous API(s) need
                      review. {noCandidateCount} API(s) have no match and are not
                      shown here.
                    </Paragraph>
                  </div>
                  <p style={helpTextStyle}>
                    Only uncertain matches appear here. They remain Pending and
                    are not counted as Yes until you select the correct SLOs.
                  </p>
                </Flex>

                <div
                  style={{
                    ...styles.code,
                    borderRadius: 6,
                    boxSizing: "border-box",
                    maxHeight: 520,
                    overflow: "auto",
                    padding: 10,
                  }}
                >
                  {visibleReviewerRows.length === 0 ? (
                    <Paragraph>No exceptions require review.</Paragraph>
                  ) : (
                    <Flex flexDirection="column" gap={12}>
                      {visibleReviewerRows.map((row) => (
                        <Flex
                          key={row.name}
                          flexDirection="column"
                          gap={8}
                          style={{
                            ...styles.panel,
                            borderRadius: 6,
                            padding: 12,
                            width: "100%",
                          }}
                        >
                          <Flex
                            justifyContent="space-between"
                            alignItems="center"
                            gap={12}
                          >
                            <Strong>{row.name}</Strong>
                            <span
                              style={{
                                ...(row.confidence === "review"
                                  ? reviewSelections[row.name] === undefined
                                    ? styles.warning
                                    : styles.success
                                  : styles.error),
                                borderRadius: 999,
                                fontSize: 12,
                                padding: "3px 8px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {row.confidence === "review"
                                ? reviewSelections[row.name] === undefined
                                  ? "Pending review"
                                  : "Reviewed"
                                : "No candidate"}
                            </span>
                          </Flex>

                          {row.candidates.length === 0 ? (
                            <p style={helpTextStyle}>
                              No SLO shared enough meaningful name evidence.
                            </p>
                          ) : (
                            <>
                              {row.candidates.map((candidate) => {
                                const selectedIds = reviewSelections[row.name];
                                const checked =
                                  selectedIds?.includes(candidate.slo.id) ?? false;

                                return (
                                  <label
                                    key={candidate.slo.id}
                                    style={{
                                      alignItems: "flex-start",
                                      display: "flex",
                                      gap: 10,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) =>
                                        setCandidateSelected(
                                          row,
                                          candidate.slo.id,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <span>
                                      <Strong>{candidate.slo.name}</Strong>
                                      <br />
                                      <span style={helpTextStyle}>
                                        Shared evidence: {candidate.evidenceTerms.join(" + ")}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() =>
                                  setReviewSelections((current) => ({
                                    ...current,
                                    [row.name]: [],
                                  }))
                                }
                                style={{
                                  ...buttonStyle,
                                  ...styles.idleButton,
                                  alignSelf: "flex-start",
                                }}
                              >
                                None of these SLOs
                              </button>
                            </>
                          )}
                        </Flex>
                      ))}
                    </Flex>
                  )}
                </div>

                {reviewerRows.length > REVIEW_PAGE_SIZE && (
                  <Flex
                    justifyContent="space-between"
                    alignItems="center"
                    gap={12}
                  >
                    <Paragraph>
                      Page {reviewPage + 1} of {reviewPageCount} &mdash; showing
                      at most {REVIEW_PAGE_SIZE} APIs at once
                    </Paragraph>
                    <Flex gap={8}>
                      <button
                        type="button"
                        disabled={reviewPage === 0}
                        onClick={() => setReviewPage((page) => Math.max(0, page - 1))}
                        style={{
                          ...buttonStyle,
                          ...styles.idleButton,
                          ...(reviewPage === 0 ? disabledButtonStyle : {}),
                        }}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={reviewPage >= reviewPageCount - 1}
                        onClick={() =>
                          setReviewPage((page) =>
                            Math.min(reviewPageCount - 1, page + 1),
                          )
                        }
                        style={{
                          ...buttonStyle,
                          ...styles.idleButton,
                          ...(reviewPage >= reviewPageCount - 1
                            ? disabledButtonStyle
                            : {}),
                        }}
                      >
                        Next
                      </button>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            )}

            <Flex
              flexDirection="column"
              gap={8}
              style={{ ...panelStyle, ...styles.panel, width: "100%" }}
            >
              <Heading level={3}>Comparison results</Heading>
              <div style={{ maxHeight: 420, overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", minWidth: 780, width: "100%" }}>
                  <thead>
                    <tr>
                      {[
                        "Uploaded API name",
                        "Match status",
                        "Shared evidence",
                        "Availability SLO",
                        "Performance SLO",
                        "Total SLOs",
                        "Matched SLO name(s)",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            borderBottom:
                              theme === "dark"
                                ? "1px solid #3b3d55"
                                : "1px solid #d8dae5",
                            background: theme === "dark" ? "#18182b" : "#ffffff",
                            padding: "8px 10px",
                            position: "sticky",
                            textAlign: "left",
                            top: 0,
                          }}
                        >
                          <Strong>{heading}</Strong>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.name}>
                        <td style={{ padding: "8px 10px" }}>{row.name}</td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.confidence === "high"
                            ? "High confidence"
                            : !row.reviewed
                              ? "Pending review"
                              : row.confidence === "review"
                                ? "Reviewed"
                                : "No match"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <Flex gap={6} flexFlow="wrap">
                            {row.matchTerms.length > 0
                              ? row.matchTerms.map((term) => (
                                  <span
                                    key={term}
                                    style={{
                                      ...styles.segment,
                                      borderRadius: 999,
                                      fontSize: 12,
                                      padding: "3px 8px",
                                    }}
                                  >
                                    {term}
                                  </span>
                                ))
                              : "—"}
                          </Flex>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {!row.reviewed
                            ? "Pending"
                            : row.availabilityMatches.length > 0
                            ? `Yes (${row.availabilityMatches.length})`
                            : "No"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {!row.reviewed
                            ? "Pending"
                            : row.performanceMatches.length > 0
                            ? `Yes (${row.performanceMatches.length})`
                            : "No"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.reviewed ? row.matches.length : "Pending"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {!row.reviewed
                            ? "Pending review"
                            : row.matches.length > 0
                            ? row.matches
                                .map((match) => match.name)
                                .join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Flex>

            <Flex
              flexDirection="column"
              gap={8}
              style={{ ...panelStyle, ...styles.panel, width: "100%" }}
            >
              <Flex justifyContent="space-between" alignItems="center" gap={12}>
                <Heading level={3}>Report</Heading>
                <Flex gap={8} flexFlow="wrap">
                  <button
                    type="button"
                    onClick={downloadComparison}
                    style={{ ...buttonStyle, ...styles.primaryButton }}
                  >
                    Download .xlsx
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText("Report", report)}
                    style={{ ...buttonStyle, ...styles.idleButton }}
                  >
                    {copyButtonText("Report", "Copy report")}
                  </button>
                </Flex>
              </Flex>
              <pre style={{ ...styles.code, ...codeBlockStyle }}>{report}</pre>
            </Flex>
          </>
        )}
          </>
        ) : (
          <GetDcSlos />
        )}
      </Flex>
    </Flex>
  );
};
