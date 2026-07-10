import React, { useEffect, useRef, useMemo, useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import { useAppFunction, useDql } from "@dynatrace-sdk/react-hooks";
import { useAppConsole, useConsoleError } from "../components/AppConsole";

type IngestKind = "log" | "bizevent" | "davis-event" | "davis-problem";
type AppTab = "ingest" | "workflow" | "srg";
type WorkflowPageMode = "import" | "export";
type SrgPageMode = "import" | "export";

type HomeProps = {
  activeTab?: AppTab;
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

type WorkflowResult = {
  action: "created" | "exported" | "updated" | "validated";
  apiPayload: unknown;
  id: string;
  title: string;
  note: string;
  workflow: unknown;
};

type SrgResult = {
  action: "created" | "exported" | "failed" | "updated" | "validated";
  apiPayload: unknown;
  objectId?: string;
  name: string;
  note: string;
  response: unknown;
};

type SafetyChecklist = {
  prodEntityIds: boolean;
  workflowActor: boolean;
  privateOrPublic: boolean;
  lowerEnvValidated: boolean;
};

type DavisOptions = {
  entitySelector: string;
  eventCategory: string;
  muteStatus: string;
  impactLevel: string;
  severity: string;
  underMaintenance: boolean;
  timeoutMinutes: string;
};

type EntitySelectionMode = "manual" | "picker";

type SmartscapeEntity = {
  id: string;
  name: string;
};

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

const helpTextStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  margin: 0,
  opacity: 0.78,
};

const davisGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 20,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
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

const davisFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const ingestKinds: IngestKind[] = [
  "log",
  "bizevent",
  "davis-event",
  "davis-problem",
];

const ingestKindLabels: Record<IngestKind, string> = {
  log: "Log",
  bizevent: "Business event",
  "davis-event": "Davis event",
  "davis-problem": "Davis problem",
};

const eventCategories = ["", "INFO", "AVAILABILITY", "ERROR", "RESOURCE", "PERFORMANCE"];
const muteStatuses = ["", "NOT_MUTED", "MUTED"];
const impactLevels = ["", "Environment", "Infrastructure", "Services", "Applications"];
const checklistLabels: Record<keyof SafetyChecklist, string> = {
  prodEntityIds: "Production entity IDs are verified",
  workflowActor: "Workflow actor is verified",
  privateOrPublic: "Private/public visibility is verified",
  lowerEnvValidated: "Validated in lower environment",
};

const emptyChecklist: SafetyChecklist = {
  prodEntityIds: false,
  workflowActor: false,
  privateOrPublic: false,
  lowerEnvValidated: false,
};

function escapeDqlString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildEntityQuery(search: string) {
  const trimmedSearch = search.trim().toLowerCase();
  const filter = trimmedSearch
    ? `\n| filter contains(lower(name), "${escapeDqlString(trimmedSearch)}")`
    : "";

  return `smartscapeNodes "*", from: -7d\n| fields id, name${filter}\n| limit 100`;
}

function buildPreviewPayload({
  attributes,
  description,
  effectiveEntitySelector,
  eventType,
  isDavisMode,
  kind,
  message,
  source,
  davisOptions,
}: {
  attributes: Record<string, unknown>;
  description: string;
  effectiveEntitySelector: string;
  eventType: string;
  isDavisMode: boolean;
  kind: IngestKind;
  message: string;
  source: string;
  davisOptions: DavisOptions;
}) {
  const id = "<generated-on-send>";
  const timestamp = "<generated-on-send>";

  if (kind === "bizevent") {
    return {
      specversion: "1.0",
      id,
      source,
      type: eventType,
      time: timestamp,
      data: {
        message,
        "robin.ingest.id": id,
        ...attributes,
      },
    };
  }

  if (isDavisMode) {
    const properties: Record<string, unknown> = {
      "robin.ingest.id": id,
      "robin.source": source,
      "robin.event.label": eventType,
      ...attributes,
    };

    if (davisOptions.eventCategory) {
      properties["event.category"] = davisOptions.eventCategory;
    }
    if (davisOptions.severity) {
      properties["event.severity"] = davisOptions.severity;
    }
    if (description) {
      properties["event.description"] = description;
    }
    properties["maintenance.is_under_maintenance"] =
      davisOptions.underMaintenance;

    return {
      eventType: kind === "davis-problem" ? "CUSTOM_ALERT" : "CUSTOM_INFO",
      title: message,
      startTime: timestamp,
      entitySelector: effectiveEntitySelector || undefined,
      timeout: Number(davisOptions.timeoutMinutes) || undefined,
      properties,
    };
  }

  return [
    {
      content: message,
      timestamp,
      severity: "info",
      "log.source": source,
      "event.type": eventType,
      "robin.ingest.id": id,
      ...attributes,
    },
  ];
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
  };
}

function parseAttributes(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(value);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return undefined;
}

function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildSrgApiPreview(body: Record<string, unknown>) {
  const value =
    body.value && typeof body.value === "object" && !Array.isArray(body.value)
      ? body.value
      : body;
  const schemaVersion = stringField(body, "schemaVersion");
  const objectId = stringField(body, "objectId");

  if (objectId) {
    return {
      objectId,
      body: {
        ...(schemaVersion ? { schemaVersion } : {}),
        value,
      },
    };
  }

  return {
    body: [
      {
        schemaId:
          stringField(body, "schemaId") ??
          "app:dynatrace.site.reliability.guardian:guardians",
        ...(schemaVersion ? { schemaVersion } : {}),
        scope: stringField(body, "scope") ?? "environment",
        value,
      },
    ],
  };
}

function openDynatraceAppPath(path: string) {
  const environmentUrl = getEnvironmentUrl().replace(/\/$/, "");
  window.open(`${environmentUrl}${path}`, "_blank", "noopener,noreferrer");
}

function checklistComplete(checklist: SafetyChecklist) {
  return Object.values(checklist).every(Boolean);
}

function pageTitle(activeTab: AppTab) {
  if (activeTab === "workflow") {
    return "Workflow";
  }

  if (activeTab === "srg") {
    return "SRG";
  }

  return "Ingest telemetry";
}

function isSmartscapeEntity(value: unknown): value is SmartscapeEntity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.name === "string";
}

export const Home = ({ activeTab = "ingest" }: HomeProps) => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const [kind, setKind] = useState<IngestKind>("log");
  const [message, setMessage] = useState("Robin sample telemetry");
  const [description, setDescription] = useState(
    "Optional details for the Davis event.",
  );
  const [eventType, setEventType] = useState("robin.sample.created");
  const [source, setSource] = useState("robin.custom.app");
  const [rawAttributes, setRawAttributes] = useState(
    '{\n  "team": "platform",\n  "env": "dev"\n}',
  );
  const [davisOptions, setDavisOptions] = useState<DavisOptions>({
    entitySelector: "",
    eventCategory: "",
    muteStatus: "",
    impactLevel: "",
    severity: "5",
    underMaintenance: false,
    timeoutMinutes: "15",
  });
  const [entitySelectionMode, setEntitySelectionMode] =
    useState<EntitySelectionMode>("manual");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const [submittedKind, setSubmittedKind] = useState<IngestKind>();
  const [workflowJson, setWorkflowJson] = useState(
    '{\n  "title": "Robin workflow from JSON",\n  "description": "Created from Robin",\n  "isDeployed": false\n}',
  );
  const [workflowMode, setWorkflowMode] = useState<WorkflowPageMode>("import");
  const [workflowExportId, setWorkflowExportId] = useState("");
  const [workflowValidateOnly, setWorkflowValidateOnly] = useState(true);
  const [workflowChecklist, setWorkflowChecklist] =
    useState<SafetyChecklist>(emptyChecklist);
  const [workflowChecklistMessage, setWorkflowChecklistMessage] = useState("");
  const [srgJson, setSrgJson] = useState(
    '{\n  "schemaId": "app:dynatrace.site.reliability.guardian:guardians",\n  "schemaVersion": "1.9.1",\n  "scope": "environment",\n  "value": {\n    "name": "Robin guardian from JSON",\n    "tags": [],\n    "variables": [],\n    "objectives": [\n      {\n        "name": "Logs",\n        "objectiveType": "DQL",\n        "dqlQuery": "fetch logs\\n| summarize count = count()",\n        "comparisonOperator": "LESS_THAN_OR_EQUAL",\n        "target": 500,\n        "segments": [],\n        "links": []\n      }\n    ],\n    "eventKind": "BIZ_EVENT"\n  }\n}',
  );
  const [srgMode, setSrgMode] = useState<SrgPageMode>("import");
  const [srgExportId, setSrgExportId] = useState("");
  const [srgValidateOnly, setSrgValidateOnly] = useState(true);
  const [srgChecklist, setSrgChecklist] =
    useState<SafetyChecklist>(emptyChecklist);
  const [srgChecklistMessage, setSrgChecklistMessage] = useState("");
  const loggedIngestResultRef = useRef("");
  const loggedWorkflowResultRef = useRef("");
  const loggedSrgResultRef = useRef("");

  const entityQuery = useMemo(() => buildEntityQuery(entitySearch), [entitySearch]);
  const { data: entityData, error: entityError, isLoading: entitiesLoading } =
    useDql({ query: entityQuery });
  useConsoleError("Ingest telemetry entity picker", entityError);

  const isDavisMode = kind === "davis-event" || kind === "davis-problem";
  const davisPanelTitle =
    kind === "davis-problem" ? "Davis problem fields" : "Davis event fields";
  const entities = useMemo(
    () => (entityData?.records ?? []).filter(isSmartscapeEntity),
    [entityData?.records],
  );
  const effectiveEntitySelector =
    entitySelectionMode === "picker" && selectedEntityId
      ? `entityId("${selectedEntityId}")`
      : davisOptions.entitySelector;

  const updateDavisOption = <Key extends keyof DavisOptions>(
    key: Key,
    value: DavisOptions[Key],
  ) => {
    setDavisOptions((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const payload = useMemo(() => {
    let attributes: Record<string, unknown> = {};
    try {
      attributes = parseAttributes(rawAttributes) ?? {};
    } catch {
      attributes = {};
    }

    return {
      kind,
      message,
      description: isDavisMode ? description : undefined,
      eventType,
      source,
      attributes,
      davis: {
        ...davisOptions,
        entitySelector: effectiveEntitySelector,
        timeoutMinutes: Number(davisOptions.timeoutMinutes) || undefined,
      },
    };
  }, [
    davisOptions,
    description,
    eventType,
    effectiveEntitySelector,
    isDavisMode,
    kind,
    message,
    rawAttributes,
    source,
  ]);

  const { data, error, isLoading, refetch } = useAppFunction<IngestResult>(
    { name: "ingest", data: payload },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("Ingest telemetry submit", error);

  const workflowBody = useMemo(() => {
    try {
      return parseJsonObject(workflowJson);
    } catch {
      return undefined;
    }
  }, [workflowJson]);
  const workflowJsonIsValid = workflowBody !== undefined;
  const {
    data: workflowData,
    error: workflowError,
    isLoading: workflowIsLoading,
    refetch: createWorkflow,
  } = useAppFunction<WorkflowResult>(
    {
      name: "workflow",
      data: {
        action:
          workflowMode === "export"
            ? "export"
            : workflowValidateOnly
              ? "validate"
              : "save",
        body: workflowBody,
        id: workflowExportId,
        validateOnly: workflowValidateOnly,
      },
    },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("Workflow", workflowError);
  const srgBody = useMemo(() => {
    try {
      return parseJsonObject(srgJson);
    } catch {
      return undefined;
    }
  }, [srgJson]);
  const srgJsonIsValid = srgBody !== undefined;
  const srgApiPreview = useMemo(
    () => (srgBody ? buildSrgApiPreview(srgBody) : undefined),
    [srgBody],
  );
  const {
    data: srgData,
    error: srgError,
    isLoading: srgIsLoading,
    refetch: saveSrg,
  } = useAppFunction<SrgResult>(
    {
      name: "srg",
      data: {
        action:
          srgMode === "export" ? "export" : srgValidateOnly ? "validate" : "save",
        body: srgBody,
        id: srgExportId,
        validateOnly: srgValidateOnly,
      },
    },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("SRG", srgError);

  useEffect(() => {
    if (!data?.ok || data.id === loggedIngestResultRef.current) {
      return;
    }

    loggedIngestResultRef.current = data.id;
    log(
      "info",
      "Ingest telemetry",
      `${ingestKindLabels[data.kind]} sent. ID: ${data.id}. ${data.note}`,
    );
  }, [data, log]);

  useEffect(() => {
    if (!workflowData) {
      return;
    }

    const resultKey = `${workflowData.action}:${workflowData.id}:${workflowData.title}`;
    if (resultKey === loggedWorkflowResultRef.current) {
      return;
    }

    loggedWorkflowResultRef.current = resultKey;
    log(
      "info",
      "Workflow",
      `${workflowData.action} workflow "${workflowData.title}" (${workflowData.id}). ${workflowData.note}`,
    );
  }, [log, workflowData]);

  useEffect(() => {
    if (!srgData) {
      return;
    }

    const resultKey = `${srgData.action}:${srgData.objectId ?? ""}:${srgData.name}`;
    if (resultKey === loggedSrgResultRef.current) {
      return;
    }

    loggedSrgResultRef.current = resultKey;
    log(
      srgData.action === "failed" ? "error" : "info",
      "SRG",
      srgData.action === "failed"
        ? srgData.note
        : `${srgData.action} SRG "${srgData.name}"${srgData.objectId ? ` (${srgData.objectId})` : ""}. ${srgData.note}`,
    );
  }, [log, srgData]);

  const attributesAreValid = useMemo(() => {
    try {
      return parseAttributes(rawAttributes) !== undefined;
    } catch {
      return false;
    }
  }, [rawAttributes]);
  const parsedAttributes = useMemo(() => {
    try {
      return parseAttributes(rawAttributes);
    } catch {
      return undefined;
    }
  }, [rawAttributes]);
  const apiPayloadPreview = useMemo(() => {
    if (!parsedAttributes) {
      return undefined;
    }

    return buildPreviewPayload({
      attributes: parsedAttributes,
      description,
      effectiveEntitySelector,
      eventType,
      isDavisMode,
      kind,
      message,
      source,
      davisOptions,
    });
  }, [
    davisOptions,
    description,
    effectiveEntitySelector,
    eventType,
    isDavisMode,
    kind,
    message,
    parsedAttributes,
    source,
  ]);

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
  const copyStatusMessage = () => {
    if (!copyStatus) {
      return "";
    }

    if (copyStatus.startsWith("error:")) {
      return `Could not copy ${copyStatus.replace("error:", "")}`;
    }

    return `${copyStatus} copied`;
  };

  const submit = () => {
    setSubmittedKind(kind);
    setCopyStatus("");
    log("info", "Ingest telemetry", `Sending ${ingestKindLabels[kind]} sample.`);
    void refetch();
  };

  const submitWorkflow = () => {
    setCopyStatus("");
    if (
      workflowMode === "import" &&
      !workflowValidateOnly &&
      !checklistComplete(workflowChecklist)
    ) {
      setWorkflowChecklistMessage(
        "Check all pre-flight checklist items before creating or updating a workflow.",
      );
      log(
        "warn",
        "Workflow",
        "Pre-flight checklist blocked workflow create/update.",
      );
      return;
    }

    setWorkflowChecklistMessage("");
    const workflowTitle = stringField(workflowBody ?? {}, "title") || "untitled";
    log(
      "info",
      "Workflow",
      workflowMode === "export"
        ? `Exporting workflow ${workflowExportId || "(missing ID)"}.`
        : workflowValidateOnly
          ? `Validating workflow "${workflowTitle}".`
          : `Creating or updating workflow "${workflowTitle}".`,
    );
    void createWorkflow();
  };

  const submitSrg = () => {
    setCopyStatus("");
    if (
      srgMode === "import" &&
      !srgValidateOnly &&
      !checklistComplete(srgChecklist)
    ) {
      setSrgChecklistMessage(
        "Check all pre-flight checklist items before creating or updating an SRG.",
      );
      log("warn", "SRG", "Pre-flight checklist blocked SRG create/update.");
      return;
    }

    setSrgChecklistMessage("");
    const srgValue = srgBody?.value;
    const srgName =
      stringField(srgBody ?? {}, "summary") ||
      stringField(
        srgValue && typeof srgValue === "object"
          ? (srgValue as Record<string, unknown>)
          : {},
        "name",
      ) ||
      "untitled";
    log(
      "info",
      "SRG",
      srgMode === "export"
        ? `Exporting SRG ${srgExportId || "(missing ID)"}.`
        : srgValidateOnly
          ? `Validating SRG "${srgName}".`
          : `Creating or updating SRG "${srgName}".`,
    );
    void saveSrg();
  };

  const visibleData = submittedKind === kind ? data : undefined;
  const visibleError = submittedKind === kind ? error : undefined;
  const renderChecklist = (
    checklist: SafetyChecklist,
    setChecklist: React.Dispatch<React.SetStateAction<SafetyChecklist>>,
  ) => (
    <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel, width: "100%" }}>
      <Heading level={3}>Pre-flight checklist</Heading>
      {(Object.keys(checklistLabels) as Array<keyof SafetyChecklist>).map((key) => (
        <label
          key={key}
          style={{
            alignItems: "center",
            display: "flex",
            gap: 10,
          }}
        >
          <input
            type="checkbox"
            checked={checklist[key]}
            onChange={(event) =>
              setChecklist((current) => ({
                ...current,
                [key]: event.target.checked,
              }))
            }
          />
          <Strong>{checklistLabels[key]}</Strong>
        </label>
      ))}
    </Flex>
  );
  const renderCodeWithCopy = (label: string, value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);

    return (
      <div style={{ position: "relative" }}>
        <button
          type="button"
          title={`Copy ${label}`}
          aria-label={`Copy ${label}`}
          onClick={() => copyText(label, text)}
          style={{
            ...buttonStyle,
            ...styles.idleButton,
            minHeight: 30,
            padding: "4px 8px",
            position: "absolute",
            right: 12,
            top: 12,
            zIndex: 1,
          }}
        >
          {copyButtonText(label, "Copy")}
        </button>
        <pre style={{ ...styles.code, ...codeBlockStyle, paddingTop: 46 }}>
          {text}
        </pre>
      </div>
    );
  };
  const renderWarning = (message: string) => (
    <div
      role="alert"
      style={{
        ...styles.warning,
        borderRadius: 6,
        boxSizing: "border-box",
        padding: 12,
        width: "100%",
      }}
    >
      <Strong>{message}</Strong>
    </div>
  );

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex
        flexDirection="column"
        gap={8}
        style={{
          maxWidth: "calc(100vw - 64px)",
          width: "clamp(960px, 70vw, 1500px)",
        }}
      >
        <Heading>{pageTitle(activeTab)}</Heading>
        <Paragraph>
          Send logs and events, create workflows, and import Site Reliability
          Guardians using Dynatrace SDK calls in the backend. No token is stored
          in this app.
        </Paragraph>
      </Flex>

      {activeTab === "ingest" && (
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
          {ingestKinds.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setKind(item)}
              style={{
                ...buttonStyle,
                ...(kind === item ? styles.selectedButton : styles.idleButton),
              }}
            >
              {ingestKindLabels[item]}
              {kind === item ? "  Selected" : ""}
            </button>
          ))}
        </Flex>

        <label style={{ display: "grid", gap: 6 }}>
          <Strong>{isDavisMode ? "event.name" : "Message"}</Strong>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            style={{ ...fieldStyle, ...styles.field }}
          />
        </label>

        {isDavisMode && (
          <label style={{ display: "grid", gap: 6 }}>
            <Strong>event.description</Strong>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              style={{ ...fieldStyle, ...styles.field, lineHeight: 1.5 }}
            />
          </label>
        )}

        <Flex gap={20} flexFlow="wrap">
          <label style={{ display: "grid", flex: "1 1 280px", gap: 6 }}>
            <Strong>Event type</Strong>
            <input
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              style={{ ...fieldStyle, ...styles.field }}
            />
          </label>
          <label style={{ display: "grid", flex: "1 1 280px", gap: 6 }}>
            <Strong>Source</Strong>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              style={{ ...fieldStyle, ...styles.field }}
            />
          </label>
        </Flex>

        {isDavisMode && (
          <Flex
            flexDirection="column"
            gap={20}
            style={{
              ...panelStyle,
              ...styles.panel,
              boxSizing: "border-box",
              padding: 16,
              width: "100%",
            }}
          >
            <Heading level={3}>{davisPanelTitle}</Heading>
            <Flex flexDirection="column" gap={12}>
              <Flex gap={8} flexFlow="wrap">
                {(["manual", "picker"] as EntitySelectionMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEntitySelectionMode(mode)}
                    style={{
                      ...buttonStyle,
                      ...(entitySelectionMode === mode
                        ? styles.selectedButton
                        : styles.idleButton),
                    }}
                  >
                    {mode === "manual" ? "Manual selector" : "Entity picker"}
                    {entitySelectionMode === mode ? "  Selected" : ""}
                  </button>
                ))}
              </Flex>

              <div style={davisGridStyle}>
                <label style={{ ...davisFieldStyle, gridColumn: "span 2" }}>
                  <Strong>Entity selector</Strong>
                  <input
                    disabled={entitySelectionMode === "picker"}
                    placeholder='entityId("HOST-your-host-id")'
                    value={
                      entitySelectionMode === "picker"
                        ? effectiveEntitySelector
                        : davisOptions.entitySelector
                    }
                    onChange={(event) =>
                      updateDavisOption("entitySelector", event.target.value)
                    }
                    style={{
                      ...fieldStyle,
                      ...styles.field,
                      opacity: entitySelectionMode === "picker" ? 0.65 : 1,
                    }}
                  />
                  <p style={helpTextStyle}>
                    Usage: use <code>entityId("HOST-&lt;id&gt;")</code> or{" "}
                    <code>entityId("SERVICE-&lt;id&gt;")</code>.
                  </p>
                </label>

                <label style={davisFieldStyle}>
                  <Strong>Pick entity</Strong>
                  <input
                    disabled={entitySelectionMode === "manual"}
                    placeholder="Search entity name"
                    value={entitySearch}
                    onChange={(event) => setEntitySearch(event.target.value)}
                    style={{
                      ...fieldStyle,
                      ...styles.field,
                      opacity: entitySelectionMode === "manual" ? 0.65 : 1,
                    }}
                  />
                  <select
                    disabled={entitySelectionMode === "manual"}
                    value={selectedEntityId}
                    onChange={(event) => setSelectedEntityId(event.target.value)}
                    style={{
                      ...fieldStyle,
                      ...styles.field,
                      opacity: entitySelectionMode === "manual" ? 0.65 : 1,
                    }}
                  >
                    <option value="">
                      {entitiesLoading ? "Loading entities..." : "Select entity"}
                    </option>
                    {entities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </select>
                  <p style={helpTextStyle}>
                    Populated by <code>smartscapeNodes "*"</code>.{" "}
                    {entitySearch
                      ? `${entities.length} matching entities. `
                      : `${entities.length} entities loaded. `}
                    {entityError ? `Query failed: ${entityError.message}` : ""}
                  </p>
                </label>
              </div>
            </Flex>

            <div style={davisGridStyle}>
              <label style={davisFieldStyle}>
                <Strong>event.category</Strong>
                <select
                  value={davisOptions.eventCategory}
                  onChange={(event) =>
                    updateDavisOption("eventCategory", event.target.value)
                  }
                  style={{ ...fieldStyle, ...styles.field }}
                >
                  {eventCategories.map((category) => (
                    <option key={category || "default"} value={category}>
                      {category || "Dynatrace default"}
                    </option>
                  ))}
                </select>
              </label>

              <label style={davisFieldStyle}>
                <Strong>dt.davis.mute.status</Strong>
                <select
                  value={davisOptions.muteStatus}
                  onChange={(event) =>
                    updateDavisOption("muteStatus", event.target.value)
                  }
                  style={{ ...fieldStyle, ...styles.field }}
                >
                  {muteStatuses.map((status) => (
                    <option key={status || "default"} value={status}>
                      {status || "Dynatrace default"}
                    </option>
                  ))}
                </select>
              </label>

              <label style={davisFieldStyle}>
                <Strong>dt.davis.impact_level</Strong>
                <select
                  value={davisOptions.impactLevel}
                  onChange={(event) =>
                    updateDavisOption("impactLevel", event.target.value)
                  }
                  style={{ ...fieldStyle, ...styles.field }}
                >
                  {impactLevels.map((level) => (
                    <option key={level || "default"} value={level}>
                      {level || "Dynatrace default"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={davisGridStyle}>
              <label style={davisFieldStyle}>
                <Strong>event.severity</Strong>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={davisOptions.severity}
                  onChange={(event) =>
                    updateDavisOption("severity", event.target.value)
                  }
                  style={{ ...fieldStyle, ...styles.field }}
                />
              </label>

              <label style={davisFieldStyle}>
                <Strong>Timeout minutes</Strong>
                <input
                  type="number"
                  min={1}
                  max={360}
                  value={davisOptions.timeoutMinutes}
                  onChange={(event) =>
                    updateDavisOption("timeoutMinutes", event.target.value)
                  }
                  style={{ ...fieldStyle, ...styles.field }}
                />
              </label>

              <label
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: 10,
                  minHeight: 36,
                  paddingTop: 26,
                }}
              >
                <input
                  type="checkbox"
                  checked={davisOptions.underMaintenance}
                  onChange={(event) =>
                    updateDavisOption("underMaintenance", event.target.checked)
                  }
                />
                <Strong>maintenance.is_under_maintenance</Strong>
              </label>
            </div>

            <p style={helpTextStyle}>
              Dynatrace rejects direct writes to reserved <code>dt.davis.*</code>{" "}
              payload keys through this API. The Davis fields stay visible here
              as controls, while Davis derives canonical <code>dt.davis.*</code>{" "}
              values from the event type and selected entity.
            </p>
          </Flex>
        )}

        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Optional attributes JSON</Strong>
          <textarea
            value={rawAttributes}
            onChange={(event) => setRawAttributes(event.target.value)}
            rows={7}
            style={{
              ...fieldStyle,
              ...styles.field,
              fontFamily: "monospace",
              lineHeight: 1.5,
            }}
          />
        </label>

        {!attributesAreValid && (
          <Paragraph>
            Attributes must be a JSON object before sending.
          </Paragraph>
        )}

        <Flex
          flexDirection="column"
          gap={8}
          style={{ ...panelStyle, ...styles.panel, boxSizing: "border-box", width: "100%" }}
        >
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>API payload preview</Heading>
            <Flex gap={8} alignItems="center">
              {copyStatus && <Paragraph>{copyStatusMessage()}</Paragraph>}
              {apiPayloadPreview && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "Payload",
                      JSON.stringify(apiPayloadPreview, null, 2),
                    )
                  }
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("Payload", "Copy payload")}
                </button>
              )}
            </Flex>
          </Flex>
          <pre
            style={{
              ...styles.code,
              ...codeBlockStyle,
            }}
          >
            {apiPayloadPreview
              ? JSON.stringify(apiPayloadPreview, null, 2)
              : "Fix optional attributes JSON to preview the API payload."}
          </pre>
        </Flex>

        <Flex justifyContent="flex-end">
          <button
            type="button"
            disabled={isLoading || !attributesAreValid}
            onClick={submit}
            style={{
              ...buttonStyle,
              ...styles.primaryButton,
              opacity: isLoading ? 0.65 : 1,
              paddingInline: 18,
            }}
          >
            {isLoading ? "Sending..." : "Send sample"}
          </button>
        </Flex>
      </Flex>
      )}

      {activeTab === "workflow" && (
        <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
          <Flex gap={8} flexFlow="wrap" style={{ ...styles.segment, borderRadius: 8, padding: 6, width: "fit-content" }}>
            {(["import", "export"] as WorkflowPageMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setWorkflowMode(mode);
                  setCopyStatus("");
                }}
                style={{
                  ...buttonStyle,
                  ...(workflowMode === mode ? styles.selectedButton : styles.idleButton),
                }}
              >
                {mode === "import" ? "Import workflow" : "Export workflow"}
                {workflowMode === mode ? "  Selected" : ""}
              </button>
            ))}
          </Flex>

          {workflowMode === "import" ? (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <Strong>Workflow JSON body</Strong>
                <textarea
                  value={workflowJson}
                  onChange={(event) => setWorkflowJson(event.target.value)}
                  rows={14}
                  style={{
                    ...fieldStyle,
                    ...styles.field,
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                  }}
                />
              </label>

              {!workflowJsonIsValid && (
                <Paragraph>Workflow body must be a JSON object before creating.</Paragraph>
              )}

              {renderChecklist(workflowChecklist, setWorkflowChecklist)}

              <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={workflowValidateOnly}
                  onChange={(event) => setWorkflowValidateOnly(event.target.checked)}
                />
                <Strong>Validate only</Strong>
              </label>

              <Flex
                flexDirection="column"
                gap={8}
                style={{ ...panelStyle, ...styles.panel, boxSizing: "border-box", width: "100%" }}
              >
                <Flex justifyContent="space-between" alignItems="center" gap={12}>
                  <Heading level={3}>Workflow API payload preview</Heading>
                  <Flex gap={8} alignItems="center">
                    {copyStatus && <Paragraph>{copyStatusMessage()}</Paragraph>}
                    {workflowBody && (
                      <button
                        type="button"
                        onClick={() =>
                          copyText("Payload", JSON.stringify(workflowBody, null, 2))
                        }
                        style={{ ...buttonStyle, ...styles.idleButton }}
                      >
                        {copyButtonText("Payload", "Copy payload")}
                      </button>
                    )}
                  </Flex>
                </Flex>
                <pre style={{ ...styles.code, ...codeBlockStyle }}>
                  {workflowBody
                    ? JSON.stringify(workflowBody, null, 2)
                    : "Fix workflow JSON to preview the API payload."}
                </pre>
              </Flex>
            </>
          ) : (
            <label style={{ display: "grid", gap: 6 }}>
              <Strong>Workflow ID</Strong>
              <input
                value={workflowExportId}
                onChange={(event) => setWorkflowExportId(event.target.value)}
                placeholder="26f135f3-ba11-4bcb-a3e2-c212ae4c3e68"
                style={{ ...fieldStyle, ...styles.field }}
              />
            </label>
          )}

          <Flex justifyContent="flex-end">
            <button
              type="button"
              disabled={
                workflowIsLoading ||
                (workflowMode === "import" && !workflowJsonIsValid) ||
                (workflowMode === "export" && !workflowExportId.trim())
              }
              onClick={submitWorkflow}
              style={{
                ...buttonStyle,
                ...styles.primaryButton,
                opacity: workflowIsLoading ? 0.65 : 1,
                paddingInline: 18,
              }}
            >
              {workflowIsLoading
                ? "Working..."
                : workflowMode === "export"
                  ? "Export workflow"
                  : workflowValidateOnly
                    ? "Validate workflow"
                    : "Create or update workflow"}
            </button>
          </Flex>
          {workflowChecklistMessage && (
            renderWarning(workflowChecklistMessage)
          )}
        </Flex>
      )}

      {activeTab === "workflow" && (workflowData || workflowError) && (
        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel }}>
          <Heading level={3}>
            {workflowError
              ? "Failed"
              : workflowData?.action === "updated"
                ? "Updated"
                : workflowData?.action === "exported"
                  ? "Exported"
                  : workflowData?.action === "validated"
                    ? "Validated"
                : "Created"}
          </Heading>
          {workflowError && <Paragraph>{workflowError.message}</Paragraph>}
          {workflowData && (
            <>
              <Paragraph>
                <Strong>ID:</Strong> {workflowData.id || "Not provided"}
              </Paragraph>
              <Paragraph>
                <Strong>Title:</Strong> {workflowData.title}
              </Paragraph>
              <Paragraph>{workflowData.note}</Paragraph>
              <Flex gap={8} flexFlow="wrap">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "Payload",
                      JSON.stringify(workflowData.apiPayload, null, 2),
                    )
                  }
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("Payload", "Copy sent payload")}
                </button>
                {workflowData.id && (
                  <button
                    type="button"
                    onClick={() =>
                      openDynatraceAppPath(
                        `/ui/apps/dynatrace.automations/workflows/${encodeURIComponent(
                          workflowData.id,
                        )}?view=live`,
                      )
                    }
                    style={{ ...buttonStyle, ...styles.primaryButton }}
                  >
                    Navigate to Workflow
                  </button>
                )}
              </Flex>
              {renderCodeWithCopy("workflow JSON", workflowData.workflow)}
            </>
          )}
        </Flex>
      )}

      {activeTab === "srg" && (
        <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
          <Flex gap={8} flexFlow="wrap" style={{ ...styles.segment, borderRadius: 8, padding: 6, width: "fit-content" }}>
            {(["import", "export"] as SrgPageMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setSrgMode(mode);
                  setCopyStatus("");
                }}
                style={{
                  ...buttonStyle,
                  ...(srgMode === mode ? styles.selectedButton : styles.idleButton),
                }}
              >
                {mode === "import" ? "Import SRG" : "Export SRG"}
                {srgMode === mode ? "  Selected" : ""}
              </button>
            ))}
          </Flex>

          {srgMode === "import" ? (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <Strong>Site Reliability Guardian JSON body</Strong>
                <textarea
                  value={srgJson}
                  onChange={(event) => setSrgJson(event.target.value)}
                  rows={18}
                  style={{
                    ...fieldStyle,
                    ...styles.field,
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                  }}
                />
              </label>

              {!srgJsonIsValid && (
                <Paragraph>SRG body must be a JSON object before saving.</Paragraph>
              )}

              {renderChecklist(srgChecklist, setSrgChecklist)}

              <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={srgValidateOnly}
                  onChange={(event) => setSrgValidateOnly(event.target.checked)}
                />
                <Strong>Validate only</Strong>
              </label>

              <Flex
                flexDirection="column"
                gap={8}
                style={{ ...panelStyle, ...styles.panel, boxSizing: "border-box", width: "100%" }}
              >
                <Flex justifyContent="space-between" alignItems="center" gap={12}>
                  <Heading level={3}>SRG Settings API payload preview</Heading>
                  <Flex gap={8} alignItems="center">
                    {copyStatus && <Paragraph>{copyStatusMessage()}</Paragraph>}
                    {srgApiPreview && (
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            "Payload",
                            JSON.stringify(srgApiPreview, null, 2),
                          )
                        }
                        style={{ ...buttonStyle, ...styles.idleButton }}
                      >
                        {copyButtonText("Payload", "Copy payload")}
                      </button>
                    )}
                  </Flex>
                </Flex>
                <pre style={{ ...styles.code, ...codeBlockStyle }}>
                  {srgApiPreview
                    ? JSON.stringify(srgApiPreview, null, 2)
                    : "Fix SRG JSON to preview the API payload."}
                </pre>
              </Flex>
            </>
          ) : (
            <label style={{ display: "grid", gap: 6 }}>
              <Strong>Guardian object ID</Strong>
              <input
                value={srgExportId}
                onChange={(event) => setSrgExportId(event.target.value)}
                placeholder="vu9U3hXa3q0AAA..."
                style={{ ...fieldStyle, ...styles.field }}
              />
            </label>
          )}

          <Flex justifyContent="flex-end">
            <button
              type="button"
              disabled={
                srgIsLoading ||
                (srgMode === "import" && !srgJsonIsValid) ||
                (srgMode === "export" && !srgExportId.trim())
              }
              onClick={submitSrg}
              style={{
                ...buttonStyle,
                ...styles.primaryButton,
                opacity: srgIsLoading ? 0.65 : 1,
                paddingInline: 18,
              }}
            >
              {srgIsLoading
                ? "Working..."
                : srgMode === "export"
                  ? "Export SRG"
                  : srgValidateOnly
                    ? "Validate SRG"
                    : "Create or update SRG"}
            </button>
          </Flex>
          {srgChecklistMessage && renderWarning(srgChecklistMessage)}
        </Flex>
      )}

      {activeTab === "srg" && (srgData || srgError) && (
        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel }}>
          <Heading level={3}>
            {srgError
              ? "Failed"
              : srgData?.action === "failed"
                ? "Failed"
              : srgData?.action === "updated"
                ? "Updated"
                : srgData?.action === "exported"
                  ? "Exported"
                  : srgData?.action === "validated"
                    ? "Validated"
                : "Created"}
          </Heading>
          {srgError && <Paragraph>{srgError.message}</Paragraph>}
          {srgData && (
            <>
              <Paragraph>
                <Strong>Object ID:</Strong> {srgData.objectId ?? "Not returned"}
              </Paragraph>
              <Paragraph>
                <Strong>Name:</Strong> {srgData.name}
              </Paragraph>
              <Paragraph>{srgData.note}</Paragraph>
              <Flex gap={8} flexFlow="wrap">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "Payload",
                      JSON.stringify(srgData.apiPayload, null, 2),
                    )
                  }
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("Payload", "Copy sent payload")}
                </button>
                {typeof srgData.objectId === "string" && (
                  <button
                    type="button"
                    onClick={() =>
                      openDynatraceAppPath(
                        `/ui/apps/dynatrace.site.reliability.guardian/analysis/${encodeURIComponent(
                          srgData.objectId as string,
                        )}`,
                      )
                    }
                    style={{ ...buttonStyle, ...styles.primaryButton }}
                  >
                    Navigate to SRG
                  </button>
                )}
              </Flex>
              {renderCodeWithCopy("Settings response", srgData.response)}
            </>
          )}
        </Flex>
      )}

      {activeTab === "ingest" && (visibleData || visibleError) && (
        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel }}>
          <Heading level={3}>{visibleError ? "Failed" : "Sent"}</Heading>
          {visibleError && <Paragraph>{visibleError.message}</Paragraph>}
          {visibleData && (
            <>
              <Paragraph>
                <Strong>ID:</Strong> {visibleData.id}
              </Paragraph>
              <Paragraph>
                <Strong>Timestamp:</Strong> {visibleData.timestamp}
              </Paragraph>
              <Paragraph>{visibleData.note}</Paragraph>
              <Flex gap={8} flexFlow="wrap">
                <button
                  type="button"
                  onClick={() => copyText("DQL", visibleData.query)}
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("DQL", "Copy DQL")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "Payload",
                      JSON.stringify(visibleData.apiPayload ?? {}, null, 2),
                    )
                  }
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("Payload", "Copy sent payload")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const link = getIntentLink({ "dt.query": visibleData.query });
                    window.open(link, "_blank", "noopener,noreferrer");
                  }}
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  Query in Notebook
                </button>
              </Flex>
              <pre
                style={{
                  ...styles.code,
                  ...codeBlockStyle,
                }}
              >
                {visibleData.query}
              </pre>
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
};
