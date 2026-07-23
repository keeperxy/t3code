import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Keeps provider-native goal state in the canonical V2 thread projection.
 *
 * The event log remains the source of truth. This nullable payload column makes
 * current goal reads efficient and is rebuilt from goal events together with
 * the rest of the projection.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE orchestration_v2_projection_threads
    ADD COLUMN goal_payload_json TEXT
  `;
  yield* sql`
    ALTER TABLE orchestration_v2_projection_threads
    ADD COLUMN goal_revision_payload_json TEXT
  `;
});
