import React, { useMemo, useRef, useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { useAppConsole, useConsoleError } from "../components/AppConsole";

type CandidateType =
  | "dashboard ID"
  | "Dynatrace URL"
  | "email"
  | "entity ID"
  | "object ID"
  | "service name in DQL"
  | "user ID";

type Candidate = {
  id: string;
  locations: string[];
  type: CandidateType;
  value: string;
};

type CandidateState = {
  replacement?: string;
  reviewed?: boolean;
};

const idPattern =
  /\b(?:SERVICE|HOST|PROCESS_GROUP|PROCESS_GROUP_INSTANCE|APPLICATION|CUSTOM_DEVICE|KUBERNETES_CLUSTER|KUBERNETES_NAMESPACE|KUBERNETES_WORKLOAD|CLOUD_APPLICATION|CLOUD_APPLICATION_NAMESPACE|SYNTHETIC_TEST|HTTP_CHECK|MOBILE_APPLICATION|BROWSER_MONITOR|FRONTEND|BACKEND|GENAI_SERVICE|GENAI_MODEL|GENAI_PROVIDER)-[A-Z0-9]+\b/g;
const entitySelectorPattern = /entityId\("([^"]+)"\)/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const urlPattern = /https:\/\/[A-Za-z0-9./?&=_%:#-]+/g;
const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const serviceNamePatterns = [
  /\b(?:name|serviceName|entityName|entity\.name|service\.name|dt\.entity\.service\.name)\s*(?:==|=)\s*"([^"]+)"/gi,
  /\b(?:name|serviceName|entityName|entity\.name|service\.name|dt\.entity\.service\.name)\s*(?:==|=)\s*'([^']+)'/gi,
  /\b(?:contains|matchesPhrase|matchesValue)\(\s*(?:name|serviceName|entityName|entity\.name|service\.name|dt\.entity\.service\.name)\s*,\s*"([^"]+)"/gi,
  /\b(?:contains|matchesPhrase|matchesValue)\(\s*(?:name|serviceName|entityName|entity\.name|service\.name|dt\.entity\.service\.name)\s*,\s*'([^']+)'/gi,
];

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
    warning: {
      background: dark ? "#3a2a10" : "#fff7df",
      border: dark ? "1px solid #c98a2a" : "1px solid #d99021",
      color: dark ? "#ffd89a" : "#5d3b00",
    },
    success: {
      background: dark ? "#123322" : "#e8fff1",
      border: dark ? "1px solid #38a36a" : "1px solid #35a866",
      color: dark ? "#b7ffd3" : "#0d5b32",
    },
  };
}

function candidateKey(type: CandidateType, value: string) {
  return `${type}:${value}`;
}

function addCandidate(
  map: Map<string, Candidate>,
  type: CandidateType,
  value: string,
  location: string,
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return;
  }

  const id = candidateKey(type, trimmed);
  const existing = map.get(id);

  if (existing) {
    if (!existing.locations.includes(location)) {
      existing.locations.push(location);
    }
    return;
  }

  map.set(id, {
    id,
    locations: [location],
    type,
    value: trimmed,
  });
}

function walkJson(value: unknown, path: string, visitString: (value: string, path: string) => void) {
  if (typeof value === "string") {
    visitString(value, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, `${path}[${index}]`, visitString));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walkJson(child, path ? `${path}.${key}` : key, visitString);
    }
  }
}

function detectCandidates(source: string) {
  const map = new Map<string, Candidate>();
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    return { candidates: [], parseError: "Source must be valid JSON before migration scanning." };
  }

  walkJson(parsed, "$", (value, path) => {
    for (const match of value.matchAll(idPattern)) {
      addCandidate(map, "entity ID", match[0], path);
    }

    for (const match of value.matchAll(entitySelectorPattern)) {
      addCandidate(map, "entity ID", match[1], path);
    }

    for (const match of value.matchAll(emailPattern)) {
      addCandidate(map, "email", match[0], path);
    }

    for (const match of value.matchAll(urlPattern)) {
      addCandidate(map, "Dynatrace URL", match[0], path);
    }

    for (const pattern of serviceNamePatterns) {
      pattern.lastIndex = 0;
      for (const match of value.matchAll(pattern)) {
        addCandidate(map, "service name in DQL", match[1], path);
      }
    }

    if (path.match(/\.(?:actor|owner|createdBy|modifiedBy)$/)) {
      for (const match of value.matchAll(uuidPattern)) {
        addCandidate(map, "user ID", match[0], path);
      }
    } else if (path.match(/\.(?:id|documentId|dashboardId)$/)) {
      for (const match of value.matchAll(uuidPattern)) {
        addCandidate(map, "dashboard ID", match[0], path);
      }
    }

    if (path.match(/\.(?:objectId|guardianId)$/) && value.length > 30) {
      addCandidate(map, "object ID", value, path);
    }
  });

  return {
    candidates: [...map.values()].sort((left, right) =>
      `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
    ),
    parseError: "",
  };
}

function replaceAllLiteral(value: string, search: string, replacement: string) {
  return value.split(search).join(replacement);
}

function applyMappings(source: string, candidates: Candidate[], states: Record<string, CandidateState>) {
  return candidates.reduce((current, candidate) => {
    const replacement = states[candidate.id]?.replacement?.trim();
    return replacement ? replaceAllLiteral(current, candidate.value, replacement) : current;
  }, source);
}

function buildReport(candidates: Candidate[], states: Record<string, CandidateState>) {
  const mapped = candidates.filter((candidate) => states[candidate.id]?.replacement?.trim());
  const reviewed = candidates.filter(
    (candidate) => states[candidate.id]?.reviewed && !states[candidate.id]?.replacement?.trim(),
  );
  const unresolved = candidates.filter(
    (candidate) =>
      !states[candidate.id]?.reviewed && !states[candidate.id]?.replacement?.trim(),
  );

  return [
    "Migration prep report",
    `Mapped: ${mapped.length}`,
    `Reviewed and kept: ${reviewed.length}`,
    `Unresolved: ${unresolved.length}`,
    "",
    ...mapped.map(
      (candidate) =>
        `Mapped ${candidate.type}: ${candidate.value} -> ${states[candidate.id]?.replacement}`,
    ),
    ...reviewed.map((candidate) => `Reviewed ${candidate.type}: ${candidate.value}`),
    ...unresolved.map((candidate) => `Unresolved ${candidate.type}: ${candidate.value}`),
  ].join("\n");
}

export const MigrationPrep = () => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const [sourceJson, setSourceJson] = useState(
    '{\n  "value": {\n    "name": "Sample guardian",\n    "objectives": [\n      {\n        "name": "Service errors",\n        "objectiveType": "DQL",\n        "dqlQuery": "fetch logs | filter entity.name == \\"lower-service-name\\" | summarize count()"\n      }\n    ]\n  }\n}',
  );
  const [states, setStates] = useState<Record<string, CandidateState>>({});
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const scan = useMemo(() => detectCandidates(sourceJson), [sourceJson]);
  useConsoleError("Migration Prep source JSON", scan.parseError);
  const outputJson = useMemo(
    () => applyMappings(sourceJson, scan.candidates, states),
    [scan.candidates, sourceJson, states],
  );
  const report = useMemo(
    () => buildReport(scan.candidates, states),
    [scan.candidates, states],
  );
  const unresolvedCount = scan.candidates.filter(
    (candidate) =>
      !states[candidate.id]?.reviewed && !states[candidate.id]?.replacement?.trim(),
  ).length;
  const outputStatus = useMemo(() => {
    try {
      JSON.parse(outputJson);
      return "Valid JSON";
    } catch {
      return "Output is not valid JSON yet";
    }
  }, [outputJson]);

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

  const statusStyle = unresolvedCount === 0 && !scan.parseError ? styles.success : styles.warning;

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex flexDirection="column" gap={8} style={panelStyle}>
        <Heading>Migration Prep</Heading>
        <Paragraph>
          Review lower-environment references in exported SRG, workflow, or
          dashboard JSON before handing it to another tenant.
        </Paragraph>
      </Flex>

      <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Source JSON</Strong>
          <textarea
            value={sourceJson}
            onChange={(event) => {
              setSourceJson(event.target.value);
              setStates({});
            }}
            rows={14}
            style={{
              ...fieldStyle,
              ...styles.field,
              fontFamily: "monospace",
              lineHeight: 1.5,
            }}
          />
        </label>

        <div
          role="status"
          style={{
            ...statusStyle,
            borderRadius: 6,
            boxSizing: "border-box",
            padding: 12,
          }}
        >
          <Strong>
            {scan.parseError ||
              `${scan.candidates.length} references found. ${unresolvedCount} still need mapping or review.`}
          </Strong>
        </div>

        {!scan.parseError && (
          <Flex flexDirection="column" gap={12}>
            <Heading level={3}>Review table</Heading>
            {scan.candidates.length === 0 ? (
              <Paragraph>
                No migration candidates detected. Service names only appear when
                the scanner can recognize them inside DQL predicates.
              </Paragraph>
            ) : (
              scan.candidates.map((candidate) => {
                const state = states[candidate.id] ?? {};

                return (
                  <Flex
                    key={candidate.id}
                    flexDirection="column"
                    gap={8}
                    style={{ ...panelStyle, ...styles.panel, width: "100%" }}
                  >
                    <Flex justifyContent="space-between" gap={12} flexFlow="wrap">
                      <div>
                        <Strong>{candidate.type}</Strong>
                        <Paragraph>{candidate.value}</Paragraph>
                      </div>
                      <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={state.reviewed ?? false}
                          onChange={(event) =>
                            setStates((current) => ({
                              ...current,
                              [candidate.id]: {
                                ...current[candidate.id],
                                reviewed: event.target.checked,
                              },
                            }))
                          }
                        />
                        <Strong>Reviewed / keep as-is</Strong>
                      </label>
                    </Flex>
                    <input
                      value={state.replacement ?? ""}
                      onChange={(event) =>
                        setStates((current) => ({
                          ...current,
                          [candidate.id]: {
                            ...current[candidate.id],
                            replacement: event.target.value,
                            reviewed: false,
                          },
                        }))
                      }
                      placeholder="Paste prod replacement value"
                      style={{ ...fieldStyle, ...styles.field }}
                    />
                    <Paragraph>
                      Found at: {candidate.locations.slice(0, 5).join(", ")}
                      {candidate.locations.length > 5 ? " ..." : ""}
                    </Paragraph>
                  </Flex>
                );
              })
            )}
          </Flex>
        )}

        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel, width: "100%" }}>
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Migrated JSON</Heading>
            <Flex gap={8} alignItems="center">
              <Paragraph>{copyStatus === "JSON" ? "Copied" : outputStatus}</Paragraph>
              <button
                type="button"
                onClick={() => copyText("JSON", outputJson)}
                style={{ ...buttonStyle, ...styles.primaryButton }}
              >
                {copyButtonText("JSON", "Copy migrated JSON")}
              </button>
            </Flex>
          </Flex>
          <pre style={{ ...styles.code, ...codeBlockStyle }}>{outputJson}</pre>
        </Flex>

        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel, width: "100%" }}>
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Migration report</Heading>
            <button
              type="button"
              onClick={() => copyText("Report", report)}
              style={{ ...buttonStyle, ...styles.idleButton }}
            >
              {copyButtonText("Report", "Copy report")}
            </button>
          </Flex>
          <pre style={{ ...styles.code, ...codeBlockStyle }}>{report}</pre>
        </Flex>
      </Flex>
    </Flex>
  );
};
