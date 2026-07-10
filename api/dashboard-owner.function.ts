import { documentsClient } from "@dynatrace-sdk/client-document";

type DashboardOwnerRequest = {
  action?: "metadata" | "transfer";
  adminAccess?: unknown;
  dashboardId?: unknown;
  newOwnerId?: unknown;
  sendNotification?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequest(payload: unknown): DashboardOwnerRequest {
  return isRecord(payload) ? payload : {};
}

function requiredString(value: unknown, label: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`${label} is required.`);
}

function hasWriteAccess(access: unknown) {
  return Array.isArray(access) && access.includes("write");
}

export default async function (payload: unknown = undefined) {
  const request = parseRequest(payload);
  const dashboardId = requiredString(request.dashboardId, "Dashboard ID");
  const adminAccess = request.adminAccess === true;

  const metadata = await documentsClient.getDocumentMetadata({
    id: dashboardId,
    adminAccess,
  });

  if (request.action === "metadata") {
    return {
      action: "metadata",
      dashboardId,
      name: metadata.name,
      ownerId: metadata.owner,
      type: metadata.type,
      access: metadata.access,
      canWrite: hasWriteAccess(metadata.access),
      isPrivate: metadata.isPrivate,
    };
  }

  const newOwnerId = requiredString(request.newOwnerId, "New owner ID");

  if (!adminAccess && !hasWriteAccess(metadata.access)) {
    return {
      action: "blocked",
      dashboardId,
      name: metadata.name,
      ownerId: metadata.owner,
      type: metadata.type,
      access: metadata.access,
      canWrite: false,
      isPrivate: metadata.isPrivate,
      note: "You are trying to change the ownership of a dashboard you do not have edit access to. Kindly reach out to an admin or request the owner to give you edit access.",
    };
  }

  await documentsClient.transferDocumentOwner({
    id: dashboardId,
    body: { newOwnerId },
    adminAccess,
    sendNotification: request.sendNotification === true,
  });

  return {
    action: "transferred",
    dashboardId,
    name: metadata.name,
    previousOwnerId: metadata.owner,
    newOwnerId,
    adminAccess,
    sendNotification: request.sendNotification === true,
    note: "Dashboard ownership transferred with documentsClient.transferDocumentOwner using the current user's app permissions.",
  };
}
