import React, { useMemo, useRef, useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { useAppConsole } from "../components/AppConsole";

const idPattern =
  /\b(?:SERVICE|HOST|PROCESS_GROUP|PROCESS_GROUP_INSTANCE|APPLICATION|CUSTOM_DEVICE|KUBERNETES_CLUSTER|KUBERNETES_NAMESPACE|KUBERNETES_WORKLOAD|CLOUD_APPLICATION|CLOUD_APPLICATION_NAMESPACE|SYNTHETIC_TEST|HTTP_CHECK|MOBILE_APPLICATION|BROWSER_MONITOR|FRONTEND|BACKEND|GENAI_SERVICE|GENAI_MODEL|GENAI_PROVIDER)-[A-Z0-9]+\b/g;
const entitySelectorPattern = /entityId\("([^"]+)"\)/g;
const srgServerFields = [
  "objectId",
  "createdBy",
  "modifiedBy",
  "created",
  "modified",
  "author",
  "updateToken",
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
  padding: 20,
  maxWidth: "calc(100vw - 64px)",
  width: "clamp(960px, 70vw, 1500px)",
};

const codeBlockStyle: React.CSSProperties = {
  borderRadius: 6,
  boxSizing: "border-box",
  margin: 0,
  maxWidth: "100%",
  overflow: "auto",
  padding: 12,
  whiteSpace: "pre-wrap",
};

type ManualReplacement = {
  find: string;
  replace: string;
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
  };
}

function findCandidates(value: string) {
  const ids = new Set<string>();
  for (const match of value.matchAll(idPattern)) {
    ids.add(match[0]);
  }

  for (const match of value.matchAll(entitySelectorPattern)) {
    ids.add(match[1]);
  }

  return [...ids].sort();
}

function replaceAllLiteral(value: string, search: string, replacement: string) {
  return value.split(search).join(replacement);
}

function prepareSrgForNewGuardian(value: string) {
  const parsed: unknown = JSON.parse(value);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Source JSON must be an object.");
  }

  const copy = { ...(parsed as Record<string, unknown>) };
  for (const field of srgServerFields) {
    delete copy[field];
  }

  return JSON.stringify(copy, null, 2);
}

export const Sanitizer = () => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const [sourceJson, setSourceJson] = useState(
    '{\n  "summary": "Sample Guardian",\n  "objectId": "vu9U3hXa3q0AAA-sample",\n  "createdBy": "lower-env-user",\n  "modifiedBy": "lower-env-user",\n  "created": 1783341025756,\n  "modified": 1783341025756,\n  "author": "user@example.com",\n  "updateToken": "sample-token",\n  "schemaId": "app:dynatrace.site.reliability.guardian:guardians",\n  "schemaVersion": "1.9.1",\n  "scope": "environment",\n  "value": {\n    "name": "Sample Guardian",\n    "objectives": []\n  }\n}',
  );
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [manualReplacements, setManualReplacements] = useState<ManualReplacement[]>([
    { find: "", replace: "" },
  ]);
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const [actionStatus, setActionStatus] = useState("");

  const candidates = useMemo(() => findCandidates(sourceJson), [sourceJson]);
  const sanitized = useMemo(
    () =>
      manualReplacements.reduce((current, replacement) => {
        const find = replacement.find.trim();
        return find
          ? replaceAllLiteral(current, find, replacement.replace)
          : current;
      }, candidates.reduce((current, candidate) => {
        const replacement = replacements[candidate]?.trim();
        return replacement
          ? replaceAllLiteral(current, candidate, replacement)
          : current;
      }, sourceJson)),
    [candidates, manualReplacements, replacements, sourceJson],
  );

  const jsonStatus = useMemo(() => {
    try {
      JSON.parse(sanitized);
      return "Valid JSON";
    } catch {
      return "Output is not valid JSON yet";
    }
  }, [sanitized]);

  const copyText = (value: string) => {
    window.clearTimeout(copyStatusTimer.current);
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopyStatus("Copied");
        copyStatusTimer.current = window.setTimeout(() => setCopyStatus(""), 2000);
      },
      () => {
        log("error", "Clipboard", "Could not copy sanitized JSON.");
        setCopyStatus("Copy failed");
        copyStatusTimer.current = window.setTimeout(() => setCopyStatus(""), 2000);
      },
    );
  };

  const prepareSrg = () => {
    try {
      setSourceJson(prepareSrgForNewGuardian(sourceJson));
      setActionStatus("Removed SRG server-managed fields for a new guardian.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not prepare SRG JSON.";
      setActionStatus(message);
      log("error", "JSON Sanitizer", message);
    }
  };

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex flexDirection="column" gap={8} style={panelStyle}>
        <Heading>JSON Sanitizer</Heading>
        <Paragraph>
          Replace lower-environment Dynatrace IDs or names before importing JSON
          into another tenant.
        </Paragraph>
      </Flex>

      <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Source JSON</Strong>
          <textarea
            value={sourceJson}
            onChange={(event) => setSourceJson(event.target.value)}
            rows={14}
            style={{
              ...fieldStyle,
              ...styles.field,
              fontFamily: "monospace",
              lineHeight: 1.5,
            }}
          />
        </label>

        <Flex gap={8} flexFlow="wrap" alignItems="center">
          <button
            type="button"
            onClick={prepareSrg}
            style={{ ...buttonStyle, ...styles.primaryButton }}
          >
            Prepare JSON for new SRG
          </button>
          {actionStatus && <Paragraph>{actionStatus}</Paragraph>}
        </Flex>

        <Flex flexDirection="column" gap={12}>
          <Heading level={3}>Detected values</Heading>
          {candidates.length === 0 ? (
            <Paragraph>
              No Dynatrace entity IDs detected. If the JSON uses service names,
              add them in manual replacements below.
            </Paragraph>
          ) : (
            candidates.map((candidate) => (
              <label
                key={candidate}
                style={{
                  display: "grid",
                  gap: 6,
                  gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1fr)",
                }}
              >
                <input
                  readOnly
                  value={candidate}
                  style={{ ...fieldStyle, ...styles.field }}
                />
                <input
                  value={replacements[candidate] ?? ""}
                  onChange={(event) =>
                    setReplacements((current) => ({
                      ...current,
                      [candidate]: event.target.value,
                    }))
                  }
                  placeholder="Replacement production ID"
                  style={{ ...fieldStyle, ...styles.field }}
                />
              </label>
            ))
          )}
        </Flex>

        <Flex flexDirection="column" gap={12}>
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Manual replacements</Heading>
            <button
              type="button"
              onClick={() =>
                setManualReplacements((current) => [
                  ...current,
                  { find: "", replace: "" },
                ])
              }
              style={{ ...buttonStyle, ...styles.idleButton }}
            >
              Add row
            </button>
          </Flex>
          {manualReplacements.map((replacement, index) => (
            <label
              key={`${index}-${replacement.find}`}
              style={{
                display: "grid",
                gap: 6,
                gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1fr)",
              }}
            >
              <input
                value={replacement.find}
                onChange={(event) =>
                  setManualReplacements((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, find: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Lower env service name or text"
                style={{ ...fieldStyle, ...styles.field }}
              />
              <input
                value={replacement.replace}
                onChange={(event) =>
                  setManualReplacements((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, replace: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Production service name or text"
                style={{ ...fieldStyle, ...styles.field }}
              />
            </label>
          ))}
        </Flex>

        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel, width: "100%" }}>
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Sanitized output</Heading>
            <Flex gap={8} alignItems="center">
              <Paragraph>{copyStatus || jsonStatus}</Paragraph>
              <button
                type="button"
                onClick={() => copyText(sanitized)}
                style={{ ...buttonStyle, ...styles.primaryButton }}
              >
                {copyStatus || "Copy sanitized JSON"}
              </button>
            </Flex>
          </Flex>
          <pre style={{ ...styles.code, ...codeBlockStyle }}>{sanitized}</pre>
        </Flex>
      </Flex>
    </Flex>
  );
};
