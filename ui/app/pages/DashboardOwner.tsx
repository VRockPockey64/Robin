import React, { useEffect, useMemo, useRef, useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { useAppFunction, useDql } from "@dynatrace-sdk/react-hooks";
import { useAppConsole, useConsoleError } from "../components/AppConsole";

type UserMode = "search" | "manual";

type UserOption = {
  id: string;
  email: string;
  name?: string;
  lastSeen?: string;
};

type DashboardOwnerResult = {
  action: "metadata" | "blocked" | "transferred";
  access?: string[];
  adminAccess?: boolean;
  canWrite?: boolean;
  dashboardId: string;
  isPrivate?: boolean;
  name?: string;
  newOwnerId?: string;
  note?: string;
  ownerId?: string;
  previousOwnerId?: string;
  sendNotification?: boolean;
  type?: string;
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
  maxWidth: "calc(100vw - 64px)",
  padding: 20,
  width: "clamp(960px, 70vw, 1500px)",
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
    warning: {
      background: dark ? "#3a2a10" : "#fff7df",
      border: dark ? "1px solid #c98a2a" : "1px solid #d99021",
      color: dark ? "#ffd89a" : "#5d3b00",
    },
  };
}

function escapeDqlString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildRecentUsersQuery(search: string) {
  const trimmedSearch = search.trim().toLowerCase();
  const filter = trimmedSearch
    ? `\n| filter contains(lower(user.email), "${escapeDqlString(
        trimmedSearch,
      )}") or contains(lower(user.id), "${escapeDqlString(trimmedSearch)}")`
    : "";

  return `fetch dt.system.events, from: -7d
| fields timestamp, user.id, user.email
| filterOut isNull(user.email)${filter}
| sort timestamp desc
| dedup user.email
| limit 100`;
}

function toRecentUser(value: unknown): UserOption | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id = record["user.id"];
  const email = record["user.email"];
  const timestamp = record.timestamp;

  if (typeof id === "string" && typeof email === "string") {
    return {
      id,
      email,
      lastSeen: typeof timestamp === "string" ? timestamp : undefined,
    };
  }

  return undefined;
}

function friendlySearchError(message: string) {
  if (
    message.includes("storage:system:read") ||
    message.includes("NOT_AUTHORIZED_FOR_TABLE")
  ) {
    return "The current Robin app session is missing the storage:system:read OAuth scope for dt.system.events. If your IAM policy already has it, restart the local dev server and approve the updated Robin app scopes in Dynatrace.";
  }

  return message;
}

function openDynatraceAppPath(path: string) {
  const environmentUrl = getEnvironmentUrl().replace(/\/$/, "");
  window.open(`${environmentUrl}${path}`, "_blank", "noopener,noreferrer");
}

function dashboardAppPath(dashboardId: string) {
  return `/ui/apps/dynatrace.dashboards/dashboard/${encodeURIComponent(dashboardId)}`;
}

export const DashboardOwner = () => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const [dashboardId, setDashboardId] = useState("");
  const [adminAccess, setAdminAccess] = useState(false);
  const [sendNotification, setSendNotification] = useState(false);
  const [userMode, setUserMode] = useState<UserMode>("search");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [localWarning, setLocalWarning] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const copyStatusTimer = useRef<number>();
  const loggedOwnerResultRef = useRef("");
  const loggedMetadataResultRef = useRef("");

  const recentUsersQuery = useMemo(() => buildRecentUsersQuery(userSearch), [userSearch]);
  const { data: recentUsersData, error: recentUsersError, isLoading: recentUsersLoading } =
    useDql({ query: recentUsersQuery });
  useConsoleError("Dashboard Owner user search", recentUsersError);

  const {
    data: ownerData,
    error: ownerError,
    isLoading: ownerIsLoading,
    refetch: transferOwner,
  } = useAppFunction<DashboardOwnerResult>(
    {
      name: "dashboard-owner",
      data: {
        action: "transfer",
        adminAccess,
        dashboardId,
        newOwnerId: userMode === "manual" ? manualUserId : selectedUserId,
        sendNotification,
      },
    },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("Dashboard Owner transfer", ownerError);

  const {
    data: metadataData,
    error: metadataError,
    isLoading: metadataIsLoading,
    refetch: fetchMetadata,
  } = useAppFunction<DashboardOwnerResult>(
    {
      name: "dashboard-owner",
      data: {
        action: "metadata",
        adminAccess,
        dashboardId,
      },
    },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("Dashboard Owner metadata", metadataError);

  useEffect(() => {
    if (!ownerData) {
      return;
    }

    const resultKey = `${ownerData.action}:${ownerData.dashboardId}:${ownerData.newOwnerId ?? ""}:${ownerData.previousOwnerId ?? ""}`;
    if (resultKey === loggedOwnerResultRef.current) {
      return;
    }

    loggedOwnerResultRef.current = resultKey;
    log(
      ownerData.action === "blocked" ? "warn" : "info",
      "Dashboard Owner",
      ownerData.action === "transferred"
        ? `Transferred ${ownerData.dashboardId} to ${ownerData.newOwnerId}. ${ownerData.note ?? ""}`
        : ownerData.note ?? `Dashboard ownership request completed with action ${ownerData.action}.`,
    );
  }, [log, ownerData]);

  useEffect(() => {
    if (!metadataData) {
      return;
    }

    const resultKey = `${metadataData.dashboardId}:${metadataData.ownerId ?? ""}:${metadataData.canWrite ?? ""}`;
    if (resultKey === loggedMetadataResultRef.current) {
      return;
    }

    loggedMetadataResultRef.current = resultKey;
    log(
      "info",
      "Dashboard Owner",
      `Loaded metadata for ${metadataData.dashboardId}. Owner: ${metadataData.ownerId ?? "unknown"}.`,
    );
  }, [log, metadataData]);

  const recentUsers = useMemo(
    () =>
      (recentUsersData?.records ?? [])
        .map(toRecentUser)
        .filter((user): user is UserOption => Boolean(user)),
    [recentUsersData?.records],
  );
  const userLookup = useMemo(() => {
    const map = new Map<string, UserOption>();
    for (const user of recentUsers) {
      map.set(user.id, user);
    }

    return map;
  }, [recentUsers]);
  const selectedUser = userLookup.get(selectedUserId);
  const metadataOwnerLabel = metadataData?.ownerId
    ? userLookup.get(metadataData.ownerId)?.email ?? metadataData.ownerId
    : "";
  const ownerLabel = ownerData?.ownerId
    ? userLookup.get(ownerData.ownerId)?.email ?? ownerData.ownerId
    : ownerData?.previousOwnerId
      ? userLookup.get(ownerData.previousOwnerId)?.email ?? ownerData.previousOwnerId
      : "";
  const targetOwnerId = userMode === "manual" ? manualUserId.trim() : selectedUserId;
  const hasTargetOwner = Boolean(targetOwnerId);
  const canSubmit = Boolean(dashboardId.trim()) && hasTargetOwner && !ownerIsLoading;

  useEffect(() => {
    if (!dashboardId.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      void fetchMetadata();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [adminAccess, dashboardId, fetchMetadata]);

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

  const submit = () => {
    if (!canSubmit) {
      setLocalWarning("Enter a dashboard ID and select or enter the new owner ID.");
      log(
        "warn",
        "Dashboard Owner",
        "Transfer blocked because dashboard ID or target owner is missing.",
      );
      return;
    }

    setLocalWarning("");
    setCopyStatus("");
    log(
      "info",
      "Dashboard Owner",
      `Transferring ${dashboardId.trim()} to ${targetOwnerId}.`,
    );
    void transferOwner();
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
        <Heading>Dashboard Owner</Heading>
        <Paragraph>
          Transfer dashboard ownership using the Documents API with the current
          user's app permissions.
        </Paragraph>
      </Flex>

      <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
        <Flex gap={20} alignItems="center" flexFlow="wrap">
          <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <input
              type="checkbox"
              checked={adminAccess}
              onChange={(event) => {
                setAdminAccess(event.target.checked);
                setLocalWarning("");
              }}
            />
            <Strong>Use admin access</Strong>
          </label>
          <label style={{ alignItems: "center", display: "flex", gap: 10 }}>
            <input
              type="checkbox"
              checked={sendNotification}
              onChange={(event) => setSendNotification(event.target.checked)}
            />
            <Strong>Send notification</Strong>
          </label>
        </Flex>

        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Dashboard ID</Strong>
          <input
            value={dashboardId}
            onChange={(event) => setDashboardId(event.target.value)}
            placeholder="Paste dashboard/document ID"
            style={{ ...fieldStyle, ...styles.field }}
          />
        </label>

        <Flex gap={8} flexFlow="wrap" style={{ ...styles.segment, borderRadius: 8, padding: 6, width: "fit-content" }}>
          {(["search", "manual"] as UserMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setUserMode(mode);
                setLocalWarning("");
              }}
              style={{
                ...buttonStyle,
                ...(userMode === mode ? styles.selectedButton : styles.idleButton),
              }}
            >
              {mode === "search" ? "Search users" : "Manual user ID"}
              {userMode === mode ? "  Selected" : ""}
            </button>
          ))}
        </Flex>

        {userMode === "search" ? (
          <Flex flexDirection="column" gap={12}>
            <Flex gap={16} flexFlow="wrap" alignItems="flex-end">
              <label style={{ display: "grid", flex: "1 1 360px", gap: 6 }}>
                <Strong>User search</Strong>
                <input
                  value={userSearch}
                  onChange={(event) => {
                    setUserSearch(event.target.value);
                    setSelectedUserId("");
                  }}
                  placeholder="Search by email or user ID"
                  style={{ ...fieldStyle, ...styles.field }}
                />
              </label>
            </Flex>
            <label style={{ display: "grid", gap: 6 }}>
              <Strong>New owner</Strong>
              <select
                value={selectedUserId}
                onChange={(event) => setSelectedUserId(event.target.value)}
                style={{ ...fieldStyle, ...styles.field }}
              >
                <option value="">Select user</option>
                {recentUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email}
                    {user.name ? ` (${user.name})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <p style={helpTextStyle}>
              Uses recent users from dt.system.events over the last 7 days.{" "}
              {recentUsersLoading ? "Loading users..." : `${recentUsers.length} users loaded.`}
            </p>
            {selectedUser && (
              <p style={helpTextStyle}>
                Selected owner ID: <Strong>{selectedUser.id}</Strong>
              </p>
            )}
            {recentUsersError && renderWarning(friendlySearchError(recentUsersError.message))}
          </Flex>
        ) : (
          <label style={{ display: "grid", gap: 6 }}>
            <Strong>New owner user ID</Strong>
            <input
              value={manualUserId}
              onChange={(event) => setManualUserId(event.target.value)}
              placeholder="Paste SSO user ID"
              style={{ ...fieldStyle, ...styles.field }}
            />
            <p style={helpTextStyle}>
              Use this when the target user does not appear in recent activity.
            </p>
          </label>
        )}

        {dashboardId.trim() && (
          <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel, width: "100%" }}>
            <Heading level={3}>Current dashboard owner</Heading>
            {metadataIsLoading && <Paragraph>Looking up dashboard metadata...</Paragraph>}
            {metadataError && (
              renderWarning(
                `${metadataError.message} ${
                  adminAccess
                    ? ""
                    : "If you cannot read this dashboard, turn on admin access or ask the owner/admin for access."
                }`.trim(),
              )
            )}
            {metadataData && (
              <>
                <Paragraph>
                  <Strong>Dashboard:</Strong> {metadataData.name ?? metadataData.dashboardId}
                </Paragraph>
                <Paragraph>
                  <Strong>Owner:</Strong> {metadataOwnerLabel || "Not returned"}
                </Paragraph>
                <Paragraph>
                  <Strong>Access:</Strong> {(metadataData.access ?? []).join(", ") || "Not returned"}
                </Paragraph>
                {!adminAccess && metadataData.canWrite === false && (
                  renderWarning(
                    `You're trying to change the ownership of a dashboard you do not have edit access to. Kindly reach out to admin or request the owner to give you edit access. Current owner: ${
                      metadataOwnerLabel || "not returned"
                    }.`,
                  )
                )}
                <Flex>
                  <button
                    type="button"
                    onClick={() => openDynatraceAppPath(dashboardAppPath(metadataData.dashboardId))}
                    style={{ ...buttonStyle, ...styles.primaryButton }}
                  >
                    Navigate to Dashboard
                  </button>
                </Flex>
              </>
            )}
          </Flex>
        )}

        {localWarning && renderWarning(localWarning)}

        <Flex justifyContent="flex-end">
          <button
            type="button"
            disabled={ownerIsLoading}
            onClick={submit}
            style={{
              ...buttonStyle,
              ...styles.primaryButton,
              opacity: ownerIsLoading ? 0.65 : 1,
              paddingInline: 18,
            }}
          >
            {ownerIsLoading ? "Transferring..." : "Transfer ownership"}
          </button>
        </Flex>
      </Flex>

      {(ownerData || ownerError) && (
        <Flex flexDirection="column" gap={8} style={{ ...panelStyle, ...styles.panel }}>
          <Heading level={3}>
            {ownerError
              ? "Failed"
              : ownerData?.action === "blocked"
                ? "Access warning"
                : "Transferred"}
          </Heading>
          {ownerError && <Paragraph>{ownerError.message}</Paragraph>}
          {ownerData?.action === "blocked" && (
            <>
              {renderWarning(
                `${ownerData.note ?? "You do not have edit access to this dashboard."}${
                  ownerLabel ? ` Current owner: ${ownerLabel}.` : ""
                }`,
              )}
              <Paragraph>
                <Strong>Dashboard:</Strong> {ownerData.name ?? ownerData.dashboardId}
              </Paragraph>
            </>
          )}
          {ownerData?.action === "transferred" && (
            <>
              <Paragraph>
                <Strong>Dashboard:</Strong> {ownerData.name ?? ownerData.dashboardId}
              </Paragraph>
              <Paragraph>
                <Strong>Previous owner:</Strong>{" "}
                {ownerData.previousOwnerId
                  ? userLookup.get(ownerData.previousOwnerId)?.email ??
                    ownerData.previousOwnerId
                  : "Not returned"}
              </Paragraph>
              <Paragraph>
                <Strong>New owner:</Strong>{" "}
                {ownerData.newOwnerId
                  ? userLookup.get(ownerData.newOwnerId)?.email ?? ownerData.newOwnerId
                  : targetOwnerId}
              </Paragraph>
              <Paragraph>{ownerData.note}</Paragraph>
              <Flex gap={8} flexFlow="wrap">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "Result",
                      JSON.stringify(
                        {
                          dashboardId: ownerData.dashboardId,
                          previousOwnerId: ownerData.previousOwnerId,
                          newOwnerId: ownerData.newOwnerId,
                          adminAccess: ownerData.adminAccess,
                        },
                        null,
                        2,
                      ),
                    )
                  }
                  style={{ ...buttonStyle, ...styles.idleButton }}
                >
                  {copyButtonText("Result", "Copy result")}
                </button>
                <button
                  type="button"
                  onClick={() => openDynatraceAppPath(dashboardAppPath(ownerData.dashboardId))}
                  style={{ ...buttonStyle, ...styles.primaryButton }}
                >
                  Navigate to Dashboard
                </button>
              </Flex>
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
};
