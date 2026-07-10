import React from "react";

import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Paragraph } from "@dynatrace/strato-components/typography";

const bannerStyle: React.CSSProperties = {
  boxSizing: "border-box",
  maxWidth: "calc(100vw - 64px)",
  padding: "28px 32px 8px",
  textAlign: "center",
  width: "clamp(960px, 70vw, 1500px)",
};

export const BrandBanner = () => {
  const theme = useCurrentTheme();

  return (
    <Flex justifyContent="center" style={{ width: "100%" }}>
      <Flex
        flexDirection="column"
        gap={4}
        style={{
          ...bannerStyle,
          color: theme === "dark" ? "#f7f7ff" : "#14151f",
        }}
      >
        <Heading>Robin</Heading>
        <Paragraph>Quality-of-life tools for observability teams.</Paragraph>
      </Flex>
    </Flex>
  );
};
