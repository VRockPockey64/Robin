import { PageLayout } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { AppConsolePanel, AppConsoleProvider } from "./components/AppConsole";
import { BrandBanner } from "./components/BrandBanner";
import { Header } from "./components/Header";
import { DashboardOwner } from "./pages/DashboardOwner";
import { Home } from "./pages/Home";
import { MigrationPrep } from "./pages/MigrationPrep";
import { Sanitizer } from "./pages/Sanitizer";
import { Wccs } from "./pages/Wccs";

export const App = () => {
  return (
    <AppConsoleProvider>
      <PageLayout>
        <PageLayout.Header>
          <Header />
        </PageLayout.Header>
        <PageLayout.Content>
          <BrandBanner />
          <Routes>
            <Route path="/" element={<Home activeTab="ingest" />} />
            <Route path="/workflow" element={<Home activeTab="workflow" />} />
            <Route path="/srg" element={<Home activeTab="srg" />} />
            <Route path="/dashboard-owner" element={<DashboardOwner />} />
            <Route path="/migration-prep" element={<MigrationPrep />} />
            <Route path="/sanitizer" element={<Sanitizer />} />
            <Route path="/wccs" element={<Wccs />} />
          </Routes>
          <AppConsolePanel />
        </PageLayout.Content>
      </PageLayout>
    </AppConsoleProvider>
  );
};
