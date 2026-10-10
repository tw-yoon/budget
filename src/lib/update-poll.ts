import type { UpdateStatusDTO } from "@/types";

// Where an Install stands, from one poll of GET /api/update. A failed request
// (null) is normal while the server is stopped for the update. Done is the
// update's end without a failure, not a version change: a release may ship
// without a version bump. POST writes the state files before it answers, so
// every poll after it sees `updating` until the update ends (or, when it
// succeeds, the launcher clears them).
export function pollOutcome(s: UpdateStatusDTO | null): "waiting" | "done" | "failed" {
  if (!s) return "waiting";
  if (s.failed) return "failed";
  if (!s.updating) return "done";
  return "waiting";
}
