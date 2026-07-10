import React from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "@dynatrace/strato-components/layouts";

export const Header = () => {
  return (
    <AppHeader>
      <AppHeader.Navigation>
        <AppHeader.Logo as={Link} to="/" />
        <AppHeader.NavigationItem as={Link} to="/">
          Ingest Telemetry
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/workflow">
          Workflow
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/srg">
          SRG
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/wccs">
          WCCS
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/dashboard-owner">
          Dashboard Owner
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/migration-prep">
          Migration Prep
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/sanitizer">
          JSON Sanitizer
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
    </AppHeader>
  );
};
