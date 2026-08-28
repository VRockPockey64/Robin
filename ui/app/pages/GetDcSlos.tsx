import React, { useState } from "react";

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

const FILTER_TERMS = ["26777", "DC", "SCCG"] as const;

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

async function fetchForTerm(term: string): Promise<SLO[]> {
  const results: SLO[] = [];
  let nextPageKey: string | undefined;

  do {
    const data: Awaited<ReturnType<typeof serviceLevelObjectivesClient.getSlo>> =
      await serviceLevelObjectivesClient.getSlo(
        nextPageKey
          ? { nextPageKey }
          : {
              demo: false,
              enabledSlos: "all",
              evaluate: "false",
              pageSize: 500,
              sloSelector: `text("${term}")`,
            },
      );

    results.push(...(data.slo ?? []));
    nextPageKey = data.nextPageKey ?? undefined;
  } while (nextPageKey);

  return results;
}

export const GetDcSlos = () => {
  const theme = useCurrentTheme();
  const { log } = useAppConsole();
  const [names, setNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const dark = theme === "dark";

  const getSloList = async () => {
    setIsLoading(true);
    setError("");
    setNames([]);
    setHasRun(false);
    log(
      "info",
      "Get DC SLOs",
      `Fetching tenant SLOs matching any hardcoded term: ${FILTER_TERMS.join(", ")}.`,
    );

    try {
      const resultSets = await Promise.all(FILTER_TERMS.map(fetchForTerm));
      const uniqueSlos = new Map<string, SLO>();

      for (const slo of resultSets.flat()) {
        if (
          FILTER_TERMS.some((term) =>
            slo.name.toLowerCase().includes(term.toLowerCase()),
          )
        ) {
          uniqueSlos.set(slo.id, slo);
        }
      }

      const fetchedNames = [...uniqueSlos.values()]
        .map((slo) => slo.name)
        .sort((left, right) => left.localeCompare(right));

      setNames(fetchedNames);
      setHasRun(true);
      log(
        "info",
        "Get DC SLOs",
        `Fetched ${fetchedNames.length} unique SLO name(s) containing 26777, DC, or SCCG.`,
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
    <Flex flexDirection="column" gap={16}>
      <Flex justifyContent="space-between" alignItems="center" gap={16}>
        <div>
          <Heading level={2}>Get DC SLOs</Heading>
          <Paragraph>
            Fetch SLO names containing 26777, DC, or SCCG directly from this
            tenant. Results from the three server-side searches are merged and
            deduplicated.
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
          {isLoading ? "Fetching SLOs..." : "Get filtered SLO list"}
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
          <Strong>{names.length} matching SLO name(s) fetched.</Strong>
        </div>
      )}

      <textarea
        aria-label="Filtered SLO names"
        readOnly
        value={names.join("\n")}
        placeholder="Click Get filtered SLO list to display matching names here."
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
  );
};
