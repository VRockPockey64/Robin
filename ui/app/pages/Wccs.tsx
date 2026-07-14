import React, { useEffect, useMemo, useRef, useState } from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import { useAppFunction } from "@dynatrace-sdk/react-hooks";
import {
  Heading,
  Paragraph,
  Strong,
} from "@dynatrace/strato-components/typography";
import { useAppConsole, useConsoleError } from "../components/AppConsole";

type LibraryRecord = Record<string, unknown>;

type IssueSeverity = "error" | "warning";

type Issue = {
  actualValue?: string;
  field?: string;
  id: string;
  lineNumber?: number;
  location: string;
  message: string;
  recordIndex?: number;
  rule: string;
  severity: IssueSeverity;
  suggestedValue?: string;
};

type IssueState = {
  replacement?: string;
  reviewed?: boolean;
};

type ParseResult = {
  extractedText: string;
  issues: Issue[];
  records: LibraryRecord[];
  sourceKind: string;
};

type ExtractedPayload = {
  sourceKind: string;
  text: string;
};

type WccsAuditResult = {
  auditId: string;
  eventProvider: string;
  eventType: string;
  ok: boolean;
  timestamp: string;
  user: {
    email: string;
    id: string;
    name: string;
  };
};

type ValidationSummary = {
  errors: number;
  issueCount: number;
  recordsParsed: number;
  replacementDecisions: number;
  reviewedOverrides: number;
  sourceKind: string;
  unresolvedCount: number;
};

const sampleLibrary = `const payloads = [
  {
    "serviceName": "Retail-Core-Service",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_app",
    "criticality": "WEB_login_HIGH"
  },
  {
    "serviceName": "Retail-Web",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_web",
    "criticality": "WEB_login_HIGH"
  },
  {
    "serviceName": "Retail-Mobile",
    "type": "MOBILE_RUM",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_mobile",
    "criticality": "WEB_login_MEDIUM"
  },
  {
    "serviceName": "Retail-SPA",
    "type": "RUM",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_spa",
    "criticality": "WEB_login_MEDIUM"
  },
  {
    "serviceName": "Auth-Gateway",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_auth",
    "criticality": "WEB_login_HIGH"
  },
  {
    "serviceName": "Credential-Service",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_credsvc",
    "criticality": "WEB_login_HIGH"
  },
  {
    "serviceName": "Login-API-Gateway",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_gateway",
    "criticality": "WEB_login_MEDIUM"
  },
  {
    "serviceName": "Profile-Lookup",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_profile",
    "criticality": "WEB_login_MEDIUM"
  },
  {
    "serviceName": "Risk-Scoring",
    "type": "SERVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_risk",
    "criticality": "WEB_login_LOW"
  },
  {
    "serviceName": "Core-System-Login",
    "type": "CUSTOM_DEVICE",
    "world": "Retail_Banking",
    "country": "WEB",
    "city": "WEB_login",
    "street": "WEB_login_core",
    "criticality": "WEB_login_HIGH"
  }
];

return payloads;`;

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

const editorLineHeight = 21;

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

function issueId(parts: Array<string | number | undefined>) {
  return parts.map((part) => String(part ?? "")).join(":");
}

function asRecord(value: unknown): LibraryRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as LibraryRecord;
}

function stringField(record: LibraryRecord, field: string) {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}

function addIssue(issues: Issue[], issue: Omit<Issue, "id">) {
  issues.push({
    ...issue,
    id: issueId([
      issue.rule,
      issue.recordIndex,
      issue.field,
      issue.location,
      issue.actualValue,
    ]),
  });
}

function findMatchingBracket(value: string, startIndex: number) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractPayloadText(source: string): ExtractedPayload {
  const trimmed = source.trim();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return {
      sourceKind: trimmed.startsWith("[") ? "Raw JSON array" : "Raw JSON object",
      text: trimmed,
    };
  }

  const payloadMatch = /(?:const|let|var)\s+payloads\s*=\s*\[/m.exec(source);

  if (!payloadMatch) {
    throw new Error(
      'Could not find a payload array. Paste raw JSON or JavaScript containing `const payloads = [`.',
    );
  }

  const arrayStart = source.indexOf("[", payloadMatch.index);
  const arrayEnd = findMatchingBracket(source, arrayStart);

  if (arrayEnd === -1) {
    throw new Error("Could not find the closing `]` for the payload array.");
  }

  return {
    sourceKind: "JavaScript payloads array",
    text: source.slice(arrayStart, arrayEnd + 1),
  };
}

function normalizeJsonLike(value: string) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match: string, inner: string) =>
      JSON.stringify(inner.replace(/\\'/g, "'")),
    );
}

function parseErrorLineNumber(message: string) {
  const lineMatch = /\(line\s+(\d+)\s+column\s+\d+\)/i.exec(message);
  return lineMatch ? Number(lineMatch[1]) : undefined;
}

function parseLibrary(source: string): ParseResult {
  const issues: Issue[] = [];
  let extracted: ExtractedPayload;

  try {
    extracted = extractPayloadText(source);
  } catch (error) {
    addIssue(issues, {
      location: "source",
      message: error instanceof Error ? error.message : "Could not extract payloads.",
      rule: "syntax",
      severity: "error",
    });

    return {
      extractedText: "",
      issues,
      records: [],
      sourceKind: "Unrecognized",
    };
  }

  let parsed: unknown;
  const normalized = normalizeJsonLike(extracted.text);

  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Payload syntax is not valid.";

    addIssue(issues, {
      actualValue: "payloads",
      lineNumber: parseErrorLineNumber(errorMessage),
      location: "payloads",
      message:
        `Payload syntax is not valid JSON/object data after normalization: ${errorMessage}`,
      rule: "syntax",
      severity: "error",
    });

    return {
      extractedText: extracted.text,
      issues,
      records: [],
      sourceKind: extracted.sourceKind,
    };
  }

  const parsedRecords = Array.isArray(parsed) ? parsed : [parsed];
  const records: LibraryRecord[] = [];

  parsedRecords.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      addIssue(issues, {
        location: `payloads[${index}]`,
        message: "Each payload item must be an object.",
        recordIndex: index,
        rule: "schema",
        severity: "error",
      });
      return;
    }

    records.push(record);
  });

  return {
    extractedText: extracted.text,
    issues,
    records,
    sourceKind: extracted.sourceKind,
  };
}

function splitCommaValues(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasComma(value: string) {
  return value.includes(",");
}

function hasEmptyCommaPart(value: string) {
  return value.split(",").some((part) => part.trim() === "");
}

function citySuffix(country: string, city: string) {
  const prefix = `${country}_`;
  return city.startsWith(prefix) ? city.slice(prefix.length) : city;
}

function streetSuffix(city: string, street: string) {
  const prefix = `${city}_`;
  return street.startsWith(prefix) ? street.slice(prefix.length) : street;
}

function startsWithAnyCity(value: string, cities: string[]) {
  return cities.some((city) => value.startsWith(`${city}_`));
}

function valuesForCity(values: string[], city: string) {
  return values.filter((value) => value.startsWith(`${city}_`));
}

function suffixForMatchingCity(value: string, cities: string[]) {
  const city = cities.find((candidate) => value.startsWith(`${candidate}_`));
  return city ? streetSuffix(city, value) : value;
}

function streetSuffixPartsForMatchingCity(value: string, cities: string[]) {
  return suffixForMatchingCity(value, cities)
    .split("_")
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeCriticality(value: string) {
  return /_(?:LOW|MEDIUM|HIGH|ULTRA)$/i.test(value.trim());
}

function severityToken(value: string) {
  return /_(LOW|MEDIUM|HIGH|ULTRA)$/i.exec(value.trim())?.[1].toUpperCase();
}

function validateRecords(records: LibraryRecord[]) {
  const issues: Issue[] = [];
  const requiredFields = [
    "serviceName",
    "type",
    "world",
    "country",
    "city",
    "street",
    "criticality",
  ];
  const serviceTypes = new Map<string, Map<string, number[]>>();
  const worlds = new Map<string, number[]>();
  let hasInvalidWorldField = false;

  records.forEach((record, index) => {
    for (const field of requiredFields) {
      if (!stringField(record, field)) {
        addIssue(issues, {
          field,
          location: `payloads[${index}].${field}`,
          message: `Missing required field \`${field}\`.`,
          recordIndex: index,
          rule: "required-field",
          severity: "error",
        });
      }
    }

    const world = stringField(record, "world");
    const country = stringField(record, "country");
    const city = stringField(record, "city");
    const criticality = stringField(record, "criticality");
    const cityValues = splitCommaValues(city);
    const criticalityValues = splitCommaValues(criticality);
    const serviceName = stringField(record, "serviceName");
    const street = stringField(record, "street");
    const streetValues = splitCommaValues(street);
    const type = stringField(record, "type");
    const emptyCommaFields = new Set<string>();

    for (const field of requiredFields) {
      const value = stringField(record, field);

      if (value && hasComma(value) && hasEmptyCommaPart(value)) {
        emptyCommaFields.add(field);
        addIssue(issues, {
          actualValue: value,
          field,
          location: `payloads[${index}].${field}`,
          message:
            "Comma-separated fields must not contain empty values. Remove the extra comma or add the missing value.",
          recordIndex: index,
          rule: "comma-empty-value",
          severity: "error",
        });
      }
    }

    const worldHasSingleValueError =
      Boolean(world) &&
      !emptyCommaFields.has("world") &&
      (hasComma(world) || splitCommaValues(world).length !== 1);
    const typeHasSingleValueError =
      Boolean(type) &&
      !emptyCommaFields.has("type") &&
      (hasComma(type) || splitCommaValues(type).length !== 1);

    if (emptyCommaFields.has("world") || worldHasSingleValueError) {
      hasInvalidWorldField = true;
    }

    if (world && !emptyCommaFields.has("world") && !worldHasSingleValueError) {
      const seen = worlds.get(world) ?? [];
      seen.push(index);
      worlds.set(world, seen);
    }

    if (serviceName && type && !emptyCommaFields.has("type") && !typeHasSingleValueError) {
      const typeMap = serviceTypes.get(serviceName) ?? new Map<string, number[]>();
      const seen = typeMap.get(type) ?? [];
      seen.push(index);
      typeMap.set(type, seen);
      serviceTypes.set(serviceName, typeMap);
    }

    if (worldHasSingleValueError) {
      addIssue(issues, {
        actualValue: world,
        field: "world",
        location: `payloads[${index}].world`,
        message: "World must be one string in an individual library record.",
        recordIndex: index,
        rule: "world-single-value",
        severity: "error",
      });
    }

    if (typeHasSingleValueError) {
      addIssue(issues, {
        actualValue: type,
        field: "type",
        location: `payloads[${index}].type`,
        message: "Type must be one value. Do not use comma-separated type values.",
        recordIndex: index,
        rule: "type-single-value",
        severity: "error",
      });
    }

    if (
      country &&
      !emptyCommaFields.has("country") &&
      (hasComma(country) || splitCommaValues(country).length !== 1)
    ) {
      addIssue(issues, {
        actualValue: country,
        field: "country",
        location: `payloads[${index}].country`,
        message: "Country must be one string in an individual library record.",
        recordIndex: index,
        rule: "country-single-value",
        severity: "error",
      });
    }

    for (const field of ["world", "country", "city", "street"]) {
      const value = stringField(record, field);

      if (value && looksLikeCriticality(value)) {
        addIssue(issues, {
          actualValue: value,
          field,
          location: `payloads[${index}].${field}`,
          message:
            "This field looks like a criticality value. Criticality values must be in the `criticality` field.",
          recordIndex: index,
          rule: "criticality-in-wrong-field",
          severity: "error",
        });
      }
    }

    if (country.includes("_")) {
      addIssue(issues, {
        actualValue: country,
        field: "country",
        location: `payloads[${index}].country`,
        message: "Country must not contain underscores.",
        recordIndex: index,
        rule: "country-no-underscore",
        severity: "error",
      });
    }

    if (country && city) {
      for (const cityValue of cityValues) {
        if (!cityValue.startsWith(`${country}_`)) {
          addIssue(issues, {
            actualValue: city,
            field: "city",
            location: `payloads[${index}].city`,
            message:
              "Each city value must start with the country value followed by an underscore.",
            recordIndex: index,
            rule: "city-prefix",
            severity: "error",
            suggestedValue: `${country}_${cityValue}`,
          });
          break;
        }
      }
    }

    if (country && cityValues.length > 0 && street) {
      const streetCardinalityValid = streetValues.length === cityValues.length;

      if (!streetCardinalityValid) {
        addIssue(issues, {
          actualValue: street,
          field: "street",
          location: `payloads[${index}].street`,
          message:
            "Street must have a 1:1 mapping with city. Provide exactly one street value for each city value.",
          recordIndex: index,
          rule: "city-street-cardinality",
          severity: "error",
          suggestedValue: cityValues.map((cityValue) => `${cityValue}_street`).join(","),
        });
      }

      if (streetCardinalityValid) {
        for (const streetValue of streetValues) {
          if (!startsWithAnyCity(streetValue, cityValues)) {
            addIssue(issues, {
              actualValue: street,
              field: "street",
              location: `payloads[${index}].street`,
              message:
                "Each street value must start with one of the city values followed by an underscore.",
              recordIndex: index,
              rule: "street-prefix",
              severity: "error",
              suggestedValue: `${cityValues[0]}_${citySuffix(country, cityValues[0])}`,
            });
            break;
          }
        }

        for (const cityValue of cityValues) {
          const matchingStreets = valuesForCity(streetValues, cityValue);

          if (matchingStreets.length !== 1) {
            addIssue(issues, {
              actualValue: street,
              field: "street",
              location: `payloads[${index}].street`,
              message:
                "Each city value must have exactly one matching street value. A single city cannot map to zero or multiple streets.",
              recordIndex: index,
              rule: "city-street-one-to-one",
              severity: "error",
              suggestedValue: cityValues.map((item) => `${item}_street`).join(","),
            });
            break;
          }
        }
      }
    }

    const extraLayerStreet = streetValues.find((streetValue) => {
      if (!startsWithAnyCity(streetValue, cityValues)) {
        return false;
      }

      return streetSuffixPartsForMatchingCity(streetValue, cityValues).length > 2;
    });

    if (extraLayerStreet) {
      const allowedStreetSuffix = streetSuffixPartsForMatchingCity(
        extraLayerStreet,
        cityValues,
      )
        .slice(0, 2)
        .join("_");

      addIssue(issues, {
        actualValue: extraLayerStreet,
        field: "street",
        location: `payloads[${index}].street`,
        message:
          "Street must follow `<country>_<city>_<street>` and may include one optional extra segment, like `<country>_<city>_<street>_<detail>`.",
        recordIndex: index,
        rule: "street-no-extra-layer",
        severity: "error",
        suggestedValue: `${cityValues[0]}_${allowedStreetSuffix}`,
      });
    }

    if (cityValues.length > 0 && criticality) {
      const criticalityCardinalityValid = criticalityValues.length === cityValues.length;

      if (!criticalityCardinalityValid) {
        addIssue(issues, {
          actualValue: criticality,
          field: "criticality",
          location: `payloads[${index}].criticality`,
          message:
            "Criticality must have a 1:1 mapping with city. Provide exactly one criticality value for each city value.",
          recordIndex: index,
          rule: "city-criticality-cardinality",
          severity: "error",
          suggestedValue: cityValues.map((cityValue) => `${cityValue}_HIGH`).join(","),
        });
      }

      if (criticalityCardinalityValid) {
        for (const cityValue of cityValues) {
          const matchingCriticalities = valuesForCity(criticalityValues, cityValue);

          if (matchingCriticalities.length !== 1) {
            addIssue(issues, {
              actualValue: criticality,
              field: "criticality",
              location: `payloads[${index}].criticality`,
              message:
                "Each city value must have exactly one matching criticality value.",
              recordIndex: index,
              rule: "city-criticality-one-to-one",
              severity: "error",
              suggestedValue: cityValues.map((item) => `${item}_HIGH`).join(","),
            });
            break;
          }
        }
      }
    }

    const invalidCriticalitySeverity = criticalityValues.find(
      (criticalityValue) => !severityToken(criticalityValue),
    );

    if (criticality && invalidCriticalitySeverity) {
      addIssue(issues, {
        actualValue: invalidCriticalitySeverity,
        field: "criticality",
        location: `payloads[${index}].criticality`,
        message:
          "Criticality must end with one severity suffix: `_LOW`, `_MEDIUM`, `_HIGH`, or `_ULTRA`.",
        recordIndex: index,
        rule: "criticality-severity-suffix",
        severity: "error",
      });
    }

    if (cityValues.length > 0 && criticality) {
      for (const criticalityValue of criticalityValues) {
        const criticalitySeverity = severityToken(criticalityValue);

        if (criticalitySeverity && !startsWithAnyCity(criticalityValue, cityValues)) {
          addIssue(issues, {
            actualValue: criticalityValue,
            field: "criticality",
            location: `payloads[${index}].criticality`,
            message:
              "Each criticality value must start with one of the city values followed by a severity suffix.",
            recordIndex: index,
            rule: "criticality-city-prefix",
            severity: "error",
            suggestedValue: `${cityValues[0]}_${criticalitySeverity}`,
          });
          break;
        }
      }
    }
  });

  if (!hasInvalidWorldField && worlds.size > 1) {
    addIssue(issues, {
      actualValue: [...worlds.keys()].join(", "),
      field: "world",
      location: "payloads[*].world",
      message: "An individual library should contain exactly one World across all records.",
      rule: "library-one-world",
      severity: "error",
    });
  }

  for (const [serviceName, typeMap] of serviceTypes) {
    if (typeMap.size <= 1) {
      continue;
    }

    const details = [...typeMap.entries()]
      .map(([type, indexes]) => `${type} at payloads[${indexes.join(", ")}]`)
      .join("; ");

    for (const [type, indexes] of typeMap) {
      for (const index of indexes) {
        addIssue(issues, {
          actualValue: type,
          field: "type",
          location: `payloads[${index}].type`,
          message: `Service \`${serviceName}\` has conflicting type values across records: ${details}.`,
          recordIndex: index,
          rule: "service-type-conflict",
          severity: "error",
        });
      }
    }
  }

  return issues;
}

function applyIssueReplacements(
  source: string,
  issues: Issue[],
  states: Record<string, IssueState>,
) {
  return issues.reduce((current, issue) => {
    const replacement = states[issue.id]?.replacement?.trim();

    if (!replacement || !issue.actualValue) {
      return current;
    }

    return current.split(issue.actualValue).join(replacement);
  }, source);
}

function buildReport(
  parseResult: ParseResult,
  validationIssues: Issue[],
  states: Record<string, IssueState>,
) {
  const summary = buildValidationSummary(parseResult, validationIssues, states);
  const allIssues = [...parseResult.issues, ...validationIssues];

  return [
    "WCCS library validation report",
    `Source kind: ${summary.sourceKind}`,
    `Records parsed: ${summary.recordsParsed}`,
    `Issues found: ${summary.issueCount}`,
    `Errors: ${summary.errors}`,
    `Replacement decisions: ${summary.replacementDecisions}`,
    `Reviewed overrides: ${summary.reviewedOverrides}`,
    `Unresolved: ${summary.unresolvedCount}`,
    "",
    ...allIssues.map((issue) => {
      const decision = states[issue.id]?.replacement?.trim()
        ? `replacement=${states[issue.id]?.replacement}`
        : states[issue.id]?.reviewed
          ? "reviewed override"
          : "unresolved";

      const line = issue.lineNumber ? `line ${issue.lineNumber} ` : "";
      return `[${issue.severity}] ${line}${issue.location} ${issue.rule}: ${issue.message} (${decision})`;
    }),
  ].join("\n");
}

function buildValidationSummary(
  parseResult: ParseResult,
  validationIssues: Issue[],
  states: Record<string, IssueState>,
): ValidationSummary {
  const allIssues = [...parseResult.issues, ...validationIssues];

  return {
    errors: allIssues.filter((issue) => issue.severity === "error").length,
    issueCount: allIssues.length,
    recordsParsed: parseResult.records.length,
    replacementDecisions: allIssues.filter((issue) =>
      states[issue.id]?.replacement?.trim(),
    ).length,
    reviewedOverrides: allIssues.filter((issue) => states[issue.id]?.reviewed).length,
    sourceKind: parseResult.sourceKind,
    unresolvedCount: allIssues.filter(
      (issue) =>
        !states[issue.id]?.reviewed && !states[issue.id]?.replacement?.trim(),
    ).length,
  };
}

function formatLocalTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function lineContainsField(line: string, field: string) {
  return (
    line.includes(`"${field}"`) ||
    line.includes(`'${field}'`) ||
    line.includes(`${field}:`)
  );
}

function locateIssueLine(source: string, issue: Issue) {
  if (issue.lineNumber) {
    return issue.lineNumber;
  }

  const lines = source.split(/\r\n|\r|\n/);
  let currentRecord = -1;
  let currentRecordStart = 1;
  let firstFieldLine: number | undefined;
  let firstValueLine: number | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (lineContainsField(line, "serviceName")) {
      currentRecord += 1;
      currentRecordStart = lineNumber;
    }

    const recordMatches =
      issue.recordIndex === undefined || currentRecord === issue.recordIndex;

    if (issue.field && lineContainsField(line, issue.field)) {
      if (recordMatches) {
        return lineNumber;
      }

      firstFieldLine ??= lineNumber;
    }

    if (issue.actualValue && line.includes(issue.actualValue)) {
      if (recordMatches) {
        return lineNumber;
      }

      firstValueLine ??= lineNumber;
    }

    if (
      issue.recordIndex !== undefined &&
      currentRecord === issue.recordIndex &&
      !issue.field &&
      !issue.actualValue
    ) {
      return currentRecordStart;
    }
  }

  return firstFieldLine ?? firstValueLine;
}

function issueWithLine(source: string, issue: Issue): Issue {
  return {
    ...issue,
    lineNumber: locateIssueLine(source, issue),
  };
}

export const Wccs = () => {
  const theme = useCurrentTheme();
  const styles = getThemeStyles(theme);
  const { log } = useAppConsole();
  const [sourceCode, setSourceCode] = useState(sampleLibrary);
  const [states, setStates] = useState<Record<string, IssueState>>({});
  const [copyStatus, setCopyStatus] = useState("");
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [approvedSignature, setApprovedSignature] = useState("");
  const copyStatusTimer = useRef<number>();
  const loggedAuditResultRef = useRef("");

  const parseResult = useMemo(() => parseLibrary(sourceCode), [sourceCode]);
  const parseErrorMessage = useMemo(
    () =>
      parseResult.issues
        .filter((issue) => issue.rule === "syntax")
        .map((issue) => issue.message)
        .join("\n"),
    [parseResult.issues],
  );
  useConsoleError("WCCS Library Validator", parseErrorMessage);
  const validationIssues = useMemo(
    () => validateRecords(parseResult.records),
    [parseResult.records],
  );
  const allIssues = useMemo(
    () =>
      [...parseResult.issues, ...validationIssues].map((issue) =>
        issueWithLine(sourceCode, issue),
      ),
    [parseResult.issues, sourceCode, validationIssues],
  );
  const outputCode = useMemo(
    () => applyIssueReplacements(sourceCode, allIssues, states),
    [allIssues, sourceCode, states],
  );
  const unresolvedCount = allIssues.filter(
    (issue) => !states[issue.id]?.reviewed && !states[issue.id]?.replacement?.trim(),
  ).length;
  const approvalStatement =
    "I confirm this WCCS library validation is complete and all flagged findings are resolved or intentionally approved.";
  const validationSummary = useMemo(
    () => buildValidationSummary(parseResult, validationIssues, states),
    [parseResult, validationIssues, states],
  );
  const report = useMemo(
    () => buildReport(parseResult, validationIssues, states),
    [parseResult, validationIssues, states],
  );
  const auditPayload = useMemo(
    () => ({
      approvalStatement,
      issueCount: allIssues.length,
      issues: allIssues.map((issue) => ({
        actualValue: issue.actualValue,
        field: issue.field,
        lineNumber: issue.lineNumber,
        location: issue.location,
        message: issue.message,
        recordIndex: issue.recordIndex,
        replacement: states[issue.id]?.replacement?.trim() || undefined,
        reviewed: states[issue.id]?.reviewed === true,
        rule: issue.rule,
        severity: issue.severity,
        status: states[issue.id]?.replacement?.trim()
          ? "edited"
          : states[issue.id]?.reviewed
            ? "reviewed_approved"
            : "needs_review",
        suggestedValue: issue.suggestedValue,
      })),
      recordsParsed: validationSummary.recordsParsed,
      report,
      sourceKind: parseResult.sourceKind,
      validationSummary,
      unresolvedCount,
    }),
    [
      allIssues,
      approvalStatement,
      parseResult.sourceKind,
      report,
      states,
      unresolvedCount,
      validationSummary,
    ],
  );
  const approvalSignature = useMemo(
    () => JSON.stringify(auditPayload),
    [auditPayload],
  );
  const {
    data: auditData,
    error: auditError,
    isLoading: auditIsLoading,
    refetch: sendAudit,
  } = useAppFunction<WccsAuditResult>(
    { name: "wccs-audit", data: auditPayload },
    { autoFetch: false, autoFetchOnUpdate: false },
  );
  useConsoleError("WCCS approval audit", auditError);
  useEffect(() => {
    if (!auditData?.ok || auditData.auditId === loggedAuditResultRef.current) {
      return;
    }

    loggedAuditResultRef.current = auditData.auditId;
    log(
      "info",
      "WCCS approval audit",
      `Validation approved by ${auditData.user.email} at ${formatLocalTimestamp(
        auditData.timestamp,
      )}.`,
    );
  }, [auditData, log]);
  const outputApproved =
    auditData?.ok === true && approvedSignature === approvalSignature && !auditError;
  const canApproveOutput = parseResult.records.length > 0 && unresolvedCount === 0;
  const statusStyle = allIssues.length === 0 ? styles.success : styles.warning;
  const lineNumbers = useMemo(
    () => sourceCode.split(/\r\n|\r|\n/).map((_line, index) => index + 1),
    [sourceCode],
  );

  const copyText = (label: string, value: string) => {
    if (label === "Output" && !outputApproved) {
      return;
    }

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

  const approveOutput = async () => {
    if (!canApproveOutput || auditIsLoading) {
      return;
    }

    try {
      const result = await sendAudit();
      if (result) {
        setApprovedSignature(approvalSignature);
      }
    } catch (error) {
      setApprovedSignature("");
      log("error", "WCCS approval audit", error);
    }
  };

  return (
    <Flex flexDirection="column" alignItems="center" padding={32} gap={24}>
      <Flex flexDirection="column" gap={8} style={panelStyle}>
        <Heading>WCCS</Heading>
        <Paragraph>
          Validate WCCS service library payloads before promoting GitHub changes
          into Dynatrace workflows.
        </Paragraph>
      </Flex>

      <Flex flexDirection="column" gap={24} style={{ ...panelStyle, ...styles.panel }}>
        <Heading level={2}>Library Validator</Heading>
        <label style={{ display: "grid", gap: 6 }}>
          <Strong>Paste GitHub library code or JSON</Strong>
          <div
            style={{
              ...fieldStyle,
              ...styles.field,
              alignItems: "stretch",
              display: "flex",
              height: 420,
              overflow: "hidden",
              padding: 0,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                background: theme === "dark" ? "#171a2b" : "#eef0f7",
                borderRight:
                  theme === "dark" ? "1px solid #3b3d55" : "1px solid #d8dae5",
                boxSizing: "border-box",
                color: theme === "dark" ? "#8b91b1" : "#667085",
                flex: "0 0 54px",
                fontFamily: "monospace",
                fontSize: 14,
                lineHeight: `${editorLineHeight}px`,
                overflow: "hidden",
                padding: "6px 8px",
                textAlign: "right",
                userSelect: "none",
              }}
            >
              <div style={{ transform: `translateY(-${editorScrollTop}px)` }}>
                {lineNumbers.map((lineNumber) => (
                  <div key={lineNumber} style={{ height: editorLineHeight }}>
                    {lineNumber}
                  </div>
                ))}
              </div>
            </div>
            <textarea
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={sourceCode}
              onChange={(event) => {
                setSourceCode(event.target.value);
                setStates({});
                setApprovedSignature("");
              }}
              onScroll={(event) => setEditorScrollTop(event.currentTarget.scrollTop)}
              style={{
                background: "transparent",
                border: 0,
                boxSizing: "border-box",
                color: "inherit",
                flex: "1 1 auto",
                font: "inherit",
                fontFamily: "monospace",
                fontSize: 14,
                lineHeight: `${editorLineHeight}px`,
                outline: "none",
                padding: "6px 10px",
                resize: "vertical",
                whiteSpace: "pre",
              }}
            />
          </div>
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
            {allIssues.length === 0
              ? `${parseResult.records.length} records parsed. No issues found.`
              : `${parseResult.records.length} records parsed. ${allIssues.length} issues found, ${unresolvedCount} unresolved.`}
          </Strong>
          <Paragraph>Detected source: {parseResult.sourceKind}</Paragraph>
        </div>

        <Flex flexDirection="column" gap={12}>
          <Heading level={3}>Flagged details and reviewer actions</Heading>
          {allIssues.length === 0 ? (
            <div
              style={{
                ...styles.success,
                borderRadius: 6,
                boxSizing: "border-box",
                padding: 12,
              }}
            >
              <Strong>No flagged schema or syntax details.</Strong>
            </div>
          ) : (
            allIssues.map((issue, issueIndex) => {
              const state = states[issue.id] ?? {};
              const edited = Boolean(state.replacement?.trim());
              const approved = Boolean(state.reviewed);
              const resolved = edited || approved;
              const issueStyle = resolved
                ? styles.success
                : issue.severity === "error"
                  ? styles.error
                  : styles.warning;
              const issueStatus = edited
                ? "Edited"
                : approved
                  ? "Reviewed & approved"
                  : "Needs review";

              return (
                <div
                  key={issue.id}
                  style={{
                    ...styles.panel,
                    borderRadius: 8,
                    boxSizing: "border-box",
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      ...issueStyle,
                      borderRadius: 6,
                      boxSizing: "border-box",
                      marginBottom: 12,
                      padding: 10,
                    }}
                  >
                    <Strong>
                      Error {issueIndex + 1}
                      {issue.lineNumber ? ` | Line ${issue.lineNumber}` : ""}
                      {` | ${issue.location}`}
                      {` - ${issueStatus}`}
                    </Strong>
                    <Paragraph>{issue.message}</Paragraph>
                  </div>

                  <div
                    style={{
                      alignItems: "end",
                      display: "grid",
                      gap: 12,
                      gridTemplateColumns:
                        "minmax(120px, 0.7fr) minmax(240px, 1.5fr) minmax(240px, 1.5fr) minmax(180px, 0.8fr)",
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <Strong>Line</Strong>
                      <input
                        readOnly
                        value={issue.lineNumber ? `Line ${issue.lineNumber}` : "N/A"}
                        style={{ ...fieldStyle, ...styles.field }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <Strong>Current field</Strong>
                      <input
                        readOnly
                        value={issue.actualValue ?? issue.location}
                        style={{ ...fieldStyle, ...styles.field }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <Strong>Expected / new field</Strong>
                      <input
                        value={state.replacement ?? ""}
                        onChange={(event) =>
                          setStates((current) => ({
                            ...current,
                            [issue.id]: {
                              ...current[issue.id],
                              replacement: event.target.value,
                              reviewed: false,
                            },
                          }))
                        }
                        onInput={() => setApprovedSignature("")}
                        placeholder={issue.suggestedValue ?? "Enter corrected value"}
                        style={{ ...fieldStyle, ...styles.field }}
                      />
                    </label>

                    <label
                      style={{
                        alignItems: "center",
                        display: "flex",
                        gap: 8,
                        minHeight: 36,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={state.reviewed ?? false}
                        onChange={(event) =>
                          setStates((current) => ({
                            ...current,
                            [issue.id]: {
                              ...current[issue.id],
                              replacement: "",
                              reviewed: event.target.checked,
                            },
                          }))
                        }
                        onInput={() => setApprovedSignature("")}
                      />
                      <Strong>Reviewed and override</Strong>
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </Flex>

        <Flex flexDirection="column" gap={8} style={{ ...styles.panel, borderRadius: 8, padding: 12 }}>
          <Flex flexDirection="column" gap={8}>
            <Heading level={3}>Approval gate</Heading>
            <div
              style={{
                ...(outputApproved
                  ? styles.success
                  : canApproveOutput
                    ? styles.warning
                    : styles.error),
                borderRadius: 6,
                boxSizing: "border-box",
                padding: 12,
              }}
            >
              <Strong>
                {outputApproved
                  ? "Approved."
                  : canApproveOutput
                    ? "Validation is resolved."
                    : "Resolve all validation findings before approval is available."}
              </Strong>
              <Paragraph>{approvalStatement}</Paragraph>
              {auditData && outputApproved && (
                <Paragraph>
                  Approved by {auditData.user.email} at{" "}
                  {formatLocalTimestamp(auditData.timestamp)}
                </Paragraph>
              )}
              {auditError && (
                <Paragraph>
                  Approval event failed:{" "}
                  {auditError instanceof Error ? auditError.message : String(auditError)}
                </Paragraph>
              )}
            </div>
            {!outputApproved && (
              <button
                type="button"
                disabled={!canApproveOutput || auditIsLoading}
                onClick={() => void approveOutput()}
                style={{
                  ...buttonStyle,
                  ...styles.primaryButton,
                  ...(!canApproveOutput || auditIsLoading ? disabledButtonStyle : {}),
                  alignSelf: "flex-start",
                }}
              >
                {auditIsLoading ? "Recording approval..." : "Approve"}
              </button>
            )}
          </Flex>

          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Corrected output preview</Heading>
            {outputApproved && (
              <button
                type="button"
                onClick={() => copyText("Output", outputCode)}
                style={{ ...buttonStyle, ...styles.primaryButton }}
              >
                {copyButtonText("Output", "Copy output")}
              </button>
            )}
          </Flex>
          <pre
            onCopy={(event) => {
              if (!outputApproved) {
                event.preventDefault();
              }
            }}
            style={{
              ...styles.code,
              ...codeBlockStyle,
              userSelect: outputApproved ? "text" : "none",
            }}
          >
            {outputCode}
          </pre>
        </Flex>

        <Flex flexDirection="column" gap={8} style={{ ...styles.panel, borderRadius: 8, padding: 12 }}>
          <Flex justifyContent="space-between" alignItems="center" gap={12}>
            <Heading level={3}>Validation report</Heading>
            <Flex gap={8} alignItems="center">
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
      </Flex>
    </Flex>
  );
};
