import React, { useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { useAppConsole } from "../components/AppConsole";

const panelStyle: React.CSSProperties = {
  boxSizing: "border-box",
  borderRadius: 8,
  maxWidth: "calc(100vw - 64px)",
  padding: 20,
  width: "clamp(760px, 70vw, 1400px)",
};

const buttonStyle: React.CSSProperties = {
  borderRadius: 6,
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  minHeight: 36,
  padding: "9px 16px",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Dynatrace did not provide an error message.";
}

export const GetDcSlos = () => {
  const theme = useCurrentTheme();
  const { log } = useAppConsole();
  const [names, setNames] = useState<string[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const dark = theme === "dark";

  const getSloList = async () => {
    setIsLoading(true);
    setError("");
    setNames([]);
    setHasNextPage(false);
    setHasRun(false);
    log("info", "Get DC SLOs", "Requesting the first 500 tenant SLOs directly from the app UI.");

    try {
      const data = await serviceLevelObjectivesClient.getSlo({
        demo: false,
        enabledSlos: "all",
        evaluate: "false",
        pageSize: 500,
      });
      const fetchedNames = (data.slo ?? []).map((slo) => slo.name);

      setNames(fetchedNames);
      setHasNextPage(Boolean(data.nextPageKey));
      setHasRun(true);
      log(
        "info",
        "Get DC SLOs",
        `Fetched ${fetchedNames.length} SLO name(s). Next page available: ${Boolean(data.nextPageKey)}.`,
      );
    } catch (requestError) {
      const message = getErrorMessage(requestError);
      setError(message);
      setHasRun(true);
      log("error", "Get DC SLOs", message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex flexDirection="column" gap={8} style={panelStyle}>
        <Heading>Get DC SLOs</Heading>
        <Paragraph>
          Minimal direct SDK test. Fetch the first 500 real SLO definitions
          from this tenant without using a Robin backend function.
        </Paragraph>
      </Flex>

      <Flex
        flexDirection="column"
        gap={16}
        style={{
          ...panelStyle,
          background: dark ? "#18192a" : "#ffffff",
          border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
        }}
      >
        <Flex justifyContent="space-between" alignItems="center" gap={16}>
          <div>
            <Heading level={2}>Tenant SLO list</Heading>
            <Paragraph>
              Uses the same request that succeeded in the Dynatrace Notebook.
            </Paragraph>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void getSloList()}
            style={{
              ...buttonStyle,
              background: dark ? "#d7ddff" : "#243bdb",
              border: dark ? "1px solid #f2f4ff" : "1px solid #182bb3",
              color: dark ? "#111323" : "#ffffff",
              ...(isLoading ? { cursor: "not-allowed", opacity: 0.55 } : {}),
            }}
          >
            {isLoading ? "Fetching SLOs..." : "Get SLO list"}
          </button>
        </Flex>

        {error && (
          <div
            role="alert"
            style={{
              background: dark ? "#3b1820" : "#fff0f2",
              border: dark ? "1px solid #d9465f" : "1px solid #d22d4a",
              borderRadius: 6,
              color: dark ? "#ffd0d8" : "#731827",
              padding: 12,
            }}
          >
            <Strong>{error}</Strong>
          </div>
        )}

        {hasRun && !error && (
          <div role="status">
            <Strong>
              {names.length} SLO name(s) fetched. More pages available: {hasNextPage ? "Yes" : "No"}.
            </Strong>
          </div>
        )}

        <textarea
          aria-label="Fetched SLO names"
          readOnly
          value={names.join("\n")}
          placeholder="Click Get SLO list to display the fetched names here."
          style={{
            background: dark ? "#101221" : "#f6f7fb",
            border: dark ? "1px solid #555976" : "1px solid #b8bdcc",
            borderRadius: 6,
            boxSizing: "border-box",
            color: dark ? "#f7f7ff" : "#14151f",
            fontFamily: "monospace",
            lineHeight: 1.45,
            minHeight: 420,
            overflow: "auto",
            padding: 12,
            resize: "vertical",
            width: "100%",
          }}
        />
      </Flex>
    </Flex>
  );
};
