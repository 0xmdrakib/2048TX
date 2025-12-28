import { NextRequest } from "next/server";
// Keep backward compatibility: /admin/weekly-snapshots
// Actual API path is /api/admin/weekly-snapshots
import { GET as apiGET } from "@/app/api/admin/weekly-snapshots/route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return apiGET(req);
}
