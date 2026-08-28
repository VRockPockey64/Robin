import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { useAppFunction } from "@dynatrace-sdk/react-hooks";
import { useAppConsole, useConsoleError } from "../components/AppConsole";

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
  matchTerms: string[];
  matches: SloSummary[];
  name: string;
  performanceMatches: SloSummary[];
};

type ComparisonExportRow = {
  "API Name": string;
  "Match Terms Used": string;
  "Has Availability SLO": "Yes" | "No";
  "Availability SLO Count": number;
  "Availability SLO Names": string;
  "Has Performance SLO": "Yes" | "No";
  "Performance SLO Count": number;
  "Performance SLO Names": string;
  "Total Matching SLOs": number;
  "Other SLO Count": number;
  "Other SLO Names": string;
};

const ignoredMatchTerms = new Set([
  "api",
  "cdk",
  "dev",
  "development",
  "e2e",
  "nonprod",
  "nonproduction",
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
]);

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

function getMatchTerms(name: string): string[] {
  const seen = new Set<string>();
  const meaningfulTerms = name
    .split(/[-_\s]+/)
    .map((term, index) => ({
      index,
      normalized: normalizeForMatch(term),
      original: term.trim(),
    }))
    .filter(
      ({ normalized }) =>
        normalized.length >= 3 && !ignoredMatchTerms.has(normalized),
    )
    .filter(({ normalized }) => {
      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    })
    .sort(
      (left, right) =>
        right.normalized.length - left.normalized.length ||
        left.index - right.index,
    )
    .slice(0, 2)
    .sort((left, right) => left.index - right.index)
    .map(({ original }) => original);

  return meaningfulTerms.length > 0 ? meaningfulTerms : [name];
}

function findMatches(matchTerms: string[], slos: SloSummary[]): SloSummary[] {
  const normalizedTerms = matchTerms.map(normalizeForMatch).filter(Boolean);

  return slos.filter((slo) => {
    const normalizedSloName = normalizeForMatch(slo.name);
    return normalizedTerms.every((term) => normalizedSloName.includes(term));
  });
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
      "Match Terms Used": row.matchTerms.join(" + "),
      "Has Availability SLO": row.availabilityMatches.length > 0 ? "Yes" : "No",
      "Availability SLO Count": row.availabilityMatches.length,
      "Availability SLO Names": row.availabilityMatches
        .map((slo) => slo.name)
        .join("; "),
      "Has Performance SLO": row.performanceMatches.length > 0 ? "Yes" : "No",
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
  const withoutSlos = rows.filter((row) => row.matches.length === 0);

  return [
    "Digital Core SLO comparison report",
    `Uploaded names: ${rows.length}`,
    `SLOs in environment: ${totalSlos}`,
    `APIs with availability SLO: ${withAvailability.length}`,
    `APIs with performance SLO: ${withPerformance.length}`,
    `APIs with both: ${withBoth.length}`,
    `APIs with no matching SLO: ${withoutSlos.length}`,
    "",
    "Per-API results:",
    ...rows.map(
      (row) => [
        `  ${row.name}`,
        `    Match terms: ${row.matchTerms.join(" + ")}`,
        `    Availability: ${row.availabilityMatches.length > 0 ? "Yes" : "No"} (${row.availabilityMatches.length})`,
        `    Performance: ${row.performanceMatches.length > 0 ? "Yes" : "No"} (${row.performanceMatches.length})`,
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
  const [debugPaused, setDebugPaused] = useState(false);
  const [useDemoSlos, setUseDemoSlos] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const loggedFetchRef = useRef("");

  const {
    data: sloData,
    error: sloError,
    isLoading: sloIsLoading,
    refetch: fetchSlos,
  } = useAppFunction<DigitalCoreResult>(
    { name: "digital-core", data: { action: "list-slos", demo: useDemoSlos } },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("Digital Core SLO fetch", sloError);

  const rows: ComparisonRow[] = useMemo(() => {
    if (!sloData?.ok) {
      return [];
    }

    return names.map((name) => {
      const matchTerms = getMatchTerms(name);
      const matches = findMatches(matchTerms, sloData.slos);

      return {
        availabilityMatches: matches.filter((slo) =>
          isSloType(slo, "availability"),
        ),
        matchTerms,
        matches,
        name,
        performanceMatches: matches.filter((slo) =>
          isSloType(slo, "performance"),
        ),
      };
    });
  }, [names, sloData]);

  const parsedNameDebug = useMemo(
    () => names.map((name) => ({ matchTerms: getMatchTerms(name), name })),
    [names],
  );

  const matchedCount = rows.filter((row) => row.matches.length > 0).length;
  const unmatchedCount = rows.length - matchedCount;
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

  React.useEffect(() => {
    if (!sloData || sloData.fetchedAt === loggedFetchRef.current) {
      return;
    }

    loggedFetchRef.current = sloData.fetchedAt;
    if (!sloData.ok) {
      log("error", "Digital Core SLO fetch", formatFetchError(sloData));
      return;
    }

    log("info", "Digital Core", `Fetched ${sloData.totalCount} SLOs. ${sloData.note}`);
  }, [log, sloData]);

  const handleFile = (file: File) => {
    setFileName(file.name);
    setParseError("");
    setNames([]);
    setDebugPaused(false);

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
    setDebugPaused(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const runComparison = () => {
    if (debugMode && !debugPaused) {
      // Step 1 (array creation) is already done by this point — the file
      // upload parses it. Pause here and surface the array before doing
      // anything that talks to the Dynatrace API.
      setDebugPaused(true);
      log(
        "info",
        "Digital Core",
        `Debug mode: paused after Step 1 (array creation). ${names.length} name(s) ready — see the array below. Click Continue to run Step 2 (fetch SLOs & compare).`,
      );
      return;
    }

    if (debugMode) {
      setDebugPaused(false);
    }

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

    if (debugMode && debugPaused) {
      return "Continue";
    }

    return "Fetch SLOs & compare";
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
            style={{
              ...buttonStyle,
              ...styles.selectedButton,
              cursor: "default",
            }}
          >
            SLO Status
          </button>
        </Flex>

        <Flex flexDirection="column" gap={6}>
          <Heading level={2}>SLO Status</Heading>
          <Paragraph>
            Upload API or service names and check which ones already have an
            availability or performance SLO configured in this environment.
          </Paragraph>
          <p style={helpTextStyle}>
            Matching ignores case and punctuation, removes common environment
            and platform terms, and requires the two strongest API-name terms
            to appear in the SLO name.
          </p>
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
              setDebugPaused(false);
            }}
          />
          <Strong>Debug mode</Strong>
        </label>
        {debugMode && (
          <p style={helpTextStyle}>
            Pauses after Step 1 (array creation) and shows you the parsed
            array plus the two strongest extracted match terms before Step 2
            (fetch SLOs &amp; compare) runs.
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
              {debugMode
                ? parsedNameDebug
                    .slice(0, 200)
                    .map(
                      ({ matchTerms, name }) =>
                        `${name}\n  Match terms: ${matchTerms.join(" + ")}`,
                    )
                    .join("\n\n")
                : names.slice(0, 200).join("\n")}
              {names.length > 200 ? `\n... and ${names.length - 200} more` : ""}
            </pre>
          </Flex>
        )}

        {debugMode && debugPaused && (
          <Flex
            flexDirection="column"
            gap={8}
            style={{ ...panelStyle, ...styles.panel, width: "100%" }}
          >
            <div
              role="status"
              style={{
                ...styles.warning,
                borderRadius: 6,
                boxSizing: "border-box",
                padding: 12,
              }}
            >
              <Strong>
                Paused after Step 1 (array creation). Click Continue to run
                Step 2 (fetch SLOs &amp; compare).
              </Strong>
            </div>
            <Heading level={3}>
              Step 1 output — parsed names and extracted match terms
            </Heading>
            <pre style={{ ...styles.code, ...codeBlockStyle }}>
              {JSON.stringify(parsedNameDebug, null, 2)}
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

        {sloError && (
          <div
            role="alert"
            style={{
              ...styles.error,
              borderRadius: 6,
              boxSizing: "border-box",
              padding: 12,
            }}
          >
            <Strong>{sloError.message}</Strong>
          </div>
        )}

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
                both, and {unmatchedCount} have no matching SLO.
              </Strong>
            </div>

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
                        "Match terms",
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
                          {row.matchTerms.join(" + ")}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.availabilityMatches.length > 0
                            ? `Yes (${row.availabilityMatches.length})`
                            : "No"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.performanceMatches.length > 0
                            ? `Yes (${row.performanceMatches.length})`
                            : "No"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.matches.length}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {row.matches.length > 0
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
      </Flex>
    </Flex>
  );
};
