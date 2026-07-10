import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph, Strong } from "@dynatrace/strato-components/typography";

type ConsoleLevel = "error" | "info" | "warn";

type ConsoleEntry = {
  id: string;
  level: ConsoleLevel;
  message: string;
  source?: string;
  timestamp: string;
};

type ConsoleContextValue = {
  clear: () => void;
  entries: ConsoleEntry[];
  log: (level: ConsoleLevel, source: string, message: unknown) => void;
};

const ConsoleContext = createContext<ConsoleContextValue | undefined>(undefined);

const MAX_ENTRIES = 80;

function stringifyMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getThemeStyles(theme: "light" | "dark") {
  const dark = theme === "dark";

  return {
    panel: {
      background: dark ? "#18192a" : "#ffffff",
      border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
      color: dark ? "#f7f7ff" : "#14151f",
    },
    output: {
      background: dark ? "#0d0f1d" : "#f6f7fb",
      border: dark ? "1px solid #3b3d55" : "1px solid #d8dae5",
      color: dark ? "#f7f7ff" : "#14151f",
    },
    idleButton: {
      background: dark ? "#23253a" : "#ffffff",
      border: dark ? "1px solid #4a4d68" : "1px solid #ccd1df",
      color: dark ? "#f7f7ff" : "#222633",
    },
    error: dark ? "#ffb4bd" : "#a11329",
    info: dark ? "#b9c8ff" : "#2341b5",
    warn: dark ? "#ffd89a" : "#735000",
  };
}

export const AppConsoleProvider = ({ children }: { children: React.ReactNode }) => {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);

  const log = useCallback((level: ConsoleLevel, source: string, message: unknown) => {
    const text = stringifyMessage(message).trim();

    if (!text) {
      return;
    }

    const timestamp = new Date().toISOString();
    setEntries((current) =>
      [
        ...current,
        {
          id: `${timestamp}-${Math.random().toString(36).slice(2)}`,
          level,
          message: text,
          source,
          timestamp,
        },
      ].slice(-MAX_ENTRIES),
    );
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args: unknown[]) => {
      originalError(...args);
      log("error", "browser console", args.map(stringifyMessage).join(" "));
    };

    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      log("warn", "browser console", args.map(stringifyMessage).join(" "));
    };

    const onError = (event: ErrorEvent) => {
      log("error", "window error", event.error || event.message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      log("error", "unhandled promise", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [log]);

  const value = useMemo(
    () => ({
      clear,
      entries,
      log,
    }),
    [clear, entries, log],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
};

export function useAppConsole() {
  const context = useContext(ConsoleContext);

  if (!context) {
    throw new Error("useAppConsole must be used inside AppConsoleProvider.");
  }

  return context;
}

export function useConsoleError(source: string, error: unknown) {
  const { log } = useAppConsole();
  const lastMessageRef = useRef("");

  useEffect(() => {
    if (!error) {
      lastMessageRef.current = "";
      return;
    }

    const message = stringifyMessage(error);
    if (message === lastMessageRef.current) {
      return;
    }

    lastMessageRef.current = message;
    log("error", source, message);
  }, [error, log, source]);
}

export function AppConsolePanel() {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { clear, entries } = useAppConsole();
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [entries]);

  const output =
    entries.length === 0
      ? "No console messages yet."
      : entries
          .map(
            (entry) =>
              `[${formatTime(entry.timestamp)}] ${entry.level.toUpperCase()} ${entry.source ? `${entry.source}: ` : ""}${entry.message}`,
          )
          .join("\n\n");

  const copyOutput = () => {
    void navigator.clipboard.writeText(output);
  };

  return (
    <Flex
      flexDirection="column"
      gap={12}
      style={{
        ...styles.panel,
        borderRadius: 8,
        boxSizing: "border-box",
        margin: "8px auto 32px",
        maxWidth: "calc(100vw - 64px)",
        padding: 20,
        width: "clamp(960px, 70vw, 1500px)",
      }}
    >
      <Flex alignItems="center" justifyContent="space-between" gap={16}>
        <div>
          <Heading level={3}>Console output</Heading>
          <Paragraph>
            <Strong>{entries.length}</Strong> messages captured from this Robin session.
          </Paragraph>
        </div>
        <Flex gap={8}>
          <button
            type="button"
            onClick={copyOutput}
            style={{
              ...styles.idleButton,
              borderRadius: 6,
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
              minHeight: 34,
              padding: "7px 12px",
            }}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={clear}
            style={{
              ...styles.idleButton,
              borderRadius: 6,
              cursor: "pointer",
              font: "inherit",
              fontWeight: 600,
              minHeight: 34,
              padding: "7px 12px",
            }}
          >
            Clear
          </button>
        </Flex>
      </Flex>
      <pre
        ref={outputRef}
        aria-label="Robin console output"
        style={{
          ...styles.output,
          borderRadius: 6,
          boxSizing: "border-box",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.5,
          margin: 0,
          maxHeight: 220,
          minHeight: 120,
          overflow: "auto",
          padding: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {output}
      </pre>
    </Flex>
  );
}
